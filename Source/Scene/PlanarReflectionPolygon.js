import Cartesian3 from '../Core/Cartesian3.js';
import ComponentDatatype from '../Core/ComponentDatatype.js';
import CoplanarPolygonGeometry from '../Core/CoplanarPolygonGeometry.js';
import defined from '../Core/defined.js';
import destroyObject from '../Core/destroyObject.js';
import DrawCommand from '../Renderer/DrawCommand.js';
import GeometryAttribute from '../Core/GeometryAttribute.js';
import GeometryPipeline from '../Core/GeometryPipeline.js';
import Matrix4 from '../Core/Matrix4.js';
import PlanarReflectionPolygonVS from '../Shaders/PostProcessStages/PlanarReflectionPolygonVS.js';
import PlanarReflectionPolygonFS from '../Shaders/PostProcessStages/PlanarReflectionPolygonFS.js';
import PrimitiveType from '../Core/PrimitiveType.js';
import RenderState from '../Renderer/RenderState.js';
import ShaderProgram from '../Renderer/ShaderProgram.js';
import StencilFunction from './StencilFunction.js';
import StencilOperation from './StencilOperation.js';
import VertexArray from '../Renderer/VertexArray.js';
import VertexFormat from '../Core/VertexFormat.js';

    function PlanarReflectionPolygon(positions) {
        var coplanarPolygon = CoplanarPolygonGeometry.fromPositions({
            positions : positions,
            vertexFormat : VertexFormat.POSITION_AND_ST
        });

        var geometry = CoplanarPolygonGeometry.createGeometry(coplanarPolygon);
        var center = Cartesian3.clone(geometry.boundingSphere.center);

        // Make it RTC
        var positionValues = geometry.attributes.position.values;
        var doublesLength = positionValues.length;
        var rtcPositionValues = new Float32Array(doublesLength);
        for (var i = 0; i < doublesLength; i += 3) {
            rtcPositionValues[i] = positionValues[i] - center.x;
            rtcPositionValues[i + 1] = positionValues[i + 1] - center.y;
            rtcPositionValues[i + 2] = positionValues[i + 2] - center.z;
        }

        geometry.attributes.position = new GeometryAttribute({
            componentDatatype : ComponentDatatype.FLOAT,
            componentsPerAttribute : 3,
            values : rtcPositionValues
        });

        this._center = center;
        this._geometry = geometry;
        this._attributeLocations = GeometryPipeline.createAttributeLocations(geometry);

        this._vertexArray = undefined;
        this._drawCommand = undefined;
    }

    var centerEyeScratch = new Cartesian3();
    var modifiedModelViewProjectionScratch = new Matrix4();
    PlanarReflectionPolygon.prototype.update = function(context) {
        if (!defined(this._vertexArray)) {
            this._vertexArray = VertexArray.fromGeometry({
                context : context,
                geometry : this._geometry
            });
            this._geometry = undefined;
        }

        if (!defined(this._drawCommand)) {
            var that = this;
            var uniformMap = {
                u_modifiedModelViewProjection : function() {
                    var viewMatrix = context.uniformState.view;
                    var projectionMatrix = context.uniformState.projection;
                    var centerEye = Matrix4.multiplyByPoint(viewMatrix, that._center, centerEyeScratch);
                    Matrix4.setTranslation(viewMatrix, centerEye, modifiedModelViewProjectionScratch);
                    Matrix4.multiply(projectionMatrix, modifiedModelViewProjectionScratch, modifiedModelViewProjectionScratch);
                    return modifiedModelViewProjectionScratch;
                }
            };

            this._drawCommand = new DrawCommand({
                vertexArray : this._vertexArray,
                primitiveType : PrimitiveType.TRIANGLES,
                shaderProgram : ShaderProgram.fromCache({
                    context : context,
                    vertexShaderSource : PlanarReflectionPolygonVS,
                    fragmentShaderSource : PlanarReflectionPolygonFS,
                    attributeLocations : this._attributeLocations
                }),
                uniformMap : uniformMap,
                renderState : RenderState.fromCache({
                    stencilTest : {
                        enabled : true,
                        reference : PlanarReflectionPolygon.STENCIL_REFERENCE,
                        frontFunction : StencilFunction.ALWAYS,
                        frontOperation : {
                            fail : StencilOperation.REPLACE,
                            zFail : StencilOperation.REPLACE,
                            zPass : StencilOperation.REPLACE
                        }
                    }
                }),
                owner : this
            });
        }
    };

    PlanarReflectionPolygon.prototype.execute = function(context, frameBuffer) {
        this._drawCommand.framebuffer = frameBuffer;
        this._drawCommand.execute(context);
    };

    function destroyDrawCommand(poly) {
        var drawCommand = poly._drawCommand;
        if (defined(drawCommand) && defined(drawCommand.shaderProgram)) {
            drawCommand.shaderProgram.destroy();
        }

        poly._drawCommand = undefined;
    }

    PlanarReflectionPolygon.prototype.isDestroyed = function() {
        return false;
    };

    PlanarReflectionPolygon.prototype.destroy = function() {
        this._vertexArray = this._vertexArray && this._vertexArray.destroy();

        destroyDrawCommand(this);

        return destroyObject(this);
    };

    PlanarReflectionPolygon.STENCIL_REFERENCE = 1;

export default PlanarReflectionPolygon;
