import Buffer from '../Renderer/Buffer.js';
import BufferUsage from '../Renderer/BufferUsage.js';
import Cartesian2 from '../Core/Cartesian2.js';
import Cartesian3 from '../Core/Cartesian3.js';
import Cartesian4 from '../Core/Cartesian4.js';
import Check from '../Core/Check.js';
import ClearCommand from '../Renderer/ClearCommand.js';
import Color from '../Core/Color.js';
import ComponentDatatype from '../Core/ComponentDatatype.js';
import createGuid from '../Core/createGuid.js';
import defaultValue from '../Core/defaultValue.js';
import defined from '../Core/defined.js';
import defineProperties from '../Core/defineProperties.js';
import destroyObject from '../Core/destroyObject.js';
import DrawCommand from '../Renderer/DrawCommand.js';
import Framebuffer from '../Renderer/Framebuffer.js';
import PixelDatatype from '../Renderer/PixelDatatype.js';
import PixelFormat from '../Core/PixelFormat.js';
import PlanarReflectionPolygon from './PlanarReflectionPolygon.js';
import PlanarReflectionScatterFS from '../Shaders/PostProcessStages/PlanarReflectionScatterFS.js';
import PlanarReflectionScatterVS from '../Shaders/PostProcessStages/PlanarReflectionScatterVS.js';
import PlanarReflectionComposite from '../Shaders/PostProcessStages/PlanarReflectionComposite.js';
import Plane from '../Core/Plane.js';
import PostProcessStageSampleMode from './PostProcessStageSampleMode.js';
import PrimitiveType from '../Core/PrimitiveType.js';
import RenderState from '../Renderer/RenderState.js';
import ShaderProgram from '../Renderer/ShaderProgram.js';
import ShaderSource from '../Renderer/ShaderSource.js';
import StencilFunction from './StencilFunction.js';
import Texture from '../Renderer/Texture.js';
import VertexArray from '../Renderer/VertexArray.js';

    var dir0Scratch = new Cartesian3();
    var dir1Scratch = new Cartesian3();
    var normalScratch = new Cartesian3();
    var scratchPlane = new Plane(Cartesian3.UNIT_X, 0.0);

    function PlanarReflectionPostProcessStage(options) {
        var positions = options.positions;
        var plane = options.plane;
        var ignoreHeight = options.ignoreHeight;
        var reflectionBlendAmount = options.reflectionBlendAmount;

        var tileWidth = defaultValue(options.tileWidth, 256);
        var tileHeight = defaultValue(options.tileHeight, 256);
        var name = options.name;
        if (!defined(name)) {
            name = createGuid();
        }

        Check.defined('options.positions', positions);

        if (!defined(plane)) {
            var firstPos = positions[0];
            var dir0 = Cartesian3.subtract(positions[1], firstPos, dir0Scratch);
            var dir1 = Cartesian3.subtract(positions[2], firstPos, dir1Scratch);
            var normal = Cartesian3.cross(dir0, dir1, normalScratch);
            Cartesian3.normalize(normal, normal);
            plane = Plane.fromPointNormal(firstPos, normal, scratchPlane);
        }

        this._plane = Plane.clone(plane);
        this._ignoreHeight = defaultValue(ignoreHeight, 0.1);
        this.reflectionBlendAmount = defaultValue(reflectionBlendAmount, 0.5);

        this._tileWidth = tileWidth;
        this._tileHeight = tileHeight;
        this._screenWidth = 0;
        this._screenHeight = 0;

        this._mirrorColorTexture = undefined;
        this._mirrorDepthStencil = undefined;
        this._mirrorFrameBuffer = undefined;

        this._mirrorClearCommand = undefined;
        this._mirrorDrawCommand = undefined;
        this._mirrorVertexArray = undefined;

        this._compositeCommand = undefined;

        this._planarReflectionPolygon = new PlanarReflectionPolygon(positions);
        this._outputFramebuffer = undefined;

        this._ready = true;
        this._name = name;

        this._useLogDepth = undefined;

        this._colorTexture = undefined;
        this._depthTexture = undefined;
        this._pixelToNDC = new Cartesian2();
        this._pixelOffset = new Cartesian2();
        this._planeEC = new Cartesian4();

        // set by PostProcessStageCollection
        this._textureCache = undefined;
        this._index = undefined;

        /**
         * Whether or not to execute this post-process stage when ready.
         *
         * @type {Boolean}
         */
        this.enabled = true;
        this._enabled = true;

        this._textureScale = 1.0;
        this._forcePowerOfTwo = false;
        this._pixelFormat = PixelFormat.RGBA;
        this._pixelDatatype = PixelDatatype.UNSIGNED_BYTE;
        this._clearColor = new Color(0.0, 0.0, 0.0, 1.0);
    }

    defineProperties(PlanarReflectionPostProcessStage.prototype, {
        /**
         * Determines if this post-process stage is ready to be executed. A stage is only executed when both <code>ready</code>
         * and {@link PlanarReflectionPostProcessStage#enabled} are <code>true</code>. A stage will not be ready while it is waiting on textures
         * to load.
         *
         * @memberof PlanarReflectionPostProcessStage.prototype
         * @type {Boolean}
         * @readonly
         */
        ready : {
            get : function() {
                return this._ready;
            }
        },
        /**
         * The unique name of this post-process stage for reference by other stages in a {@link PostProcessStageComposite}.
         *
         * @memberof PlanarReflectionPostProcessStage.prototype
         * @type {String}
         * @readonly
         */
        name : {
            get : function() {
                return this._name;
            }
        },
        /**
         * A number in the range (0.0, 1.0] used to scale the output texture dimensions. A scale of 1.0 will render this post-process stage to a texture the size of the viewport.
         *
         * @memberof PlanarReflectionPostProcessStage.prototype
         * @type {Number}
         * @readonly
         */
        textureScale : {
            get : function() {
                return this._textureScale;
            }
        },
        /**
         * Whether or not to force the output texture dimensions to be both equal powers of two. The power of two will be the next power of two of the minimum of the dimensions.
         *
         * @memberof PlanarReflectionPostProcessStage.prototype
         * @type {Number}
         * @readonly
         */
        forcePowerOfTwo : {
            get : function() {
                return this._forcePowerOfTwo;
            }
        },
        /**
         * How to sample the input color texture.
         *
         * @memberof PlanarReflectionPostProcessStage.prototype
         * @type {PostProcessStageSampleMode}
         * @readonly
         */
        sampleMode : {
            get : function() {
                return PostProcessStageSampleMode.NEAREST;
            }
        },
        /**
         * The color pixel format of the output texture.
         *
         * @memberof PlanarReflectionPostProcessStage.prototype
         * @type {PixelFormat}
         * @readonly
         */
        pixelFormat : {
            get : function() {
                return this._pixelFormat;
            }
        },
        /**
         * The pixel data type of the output texture.
         *
         * @memberof PlanarReflectionPostProcessStage.prototype
         * @type {PixelDatatype}
         * @readonly
         */
        pixelDatatype : {
            get : function() {
                return this._pixelDataType;
            }
        },
        /**
         * The color to clear the output texture to.
         *
         * @memberof PlanarReflectionPostProcessStage.prototype
         * @type {Color}
         * @readonly
         */
        clearColor : {
            get : function() {
                return this._clearColor;
            }
        },
        /**
         * A reference to the texture written to when executing this post process stage.
         *
         * @memberof PlanarReflectionPostProcessStage.prototype
         * @type {Texture}
         * @readonly
         * @private
         */
        outputTexture : {
            get : function() {
                if (defined(this._textureCache)) {
                    var framebuffer = this._textureCache.getFramebuffer(this._name);
                    if (defined(framebuffer)) {
                        return framebuffer.getColorTexture(0);
                    }
                }
                return undefined;
            }
        }
        // TODO: a bunch of things should be undefined here prolly
    });

    /**
    * @private
    */
    PlanarReflectionPostProcessStage.prototype._isSupported = function(context) {
        return context.depthTexture;
    };

    function createMirrorFrameBuffer(stage, context) {
        var screenWidth = context.drawingBufferWidth;
        var screenHeight = context.drawingBufferHeight;

        var mirrorColorTexture = new Texture({
            context : context,
            width : screenWidth,
            height : screenHeight,
            pixelFormat : PixelFormat.RGBA,
            pixelDatatype : PixelDatatype.UNSIGNED_BYTE
        });

        var mirrorDepthStencil = new Texture({
            context : context,
            width : screenWidth,
            height : screenHeight,
            pixelFormat : PixelFormat.DEPTH_STENCIL,
            pixelDatatype : PixelDatatype.UNSIGNED_INT_24_8
        });

        var mirrorFrameBuffer = new Framebuffer({
            context : context,
            colorTextures : [mirrorColorTexture],
            depthStencilTexture : mirrorDepthStencil,
            destroyAttachments : false
        });

        stage._mirrorColorTexture = mirrorColorTexture;
        stage._mirrorDepthStencil = mirrorDepthStencil;
        stage._mirrorFrameBuffer = mirrorFrameBuffer;

        if (defined(stage._mirrorClearCommand)) {
            stage._mirrorClearCommand.framebuffer = mirrorFrameBuffer;
        }

        if (defined(stage._mirrorDrawCommand)) {
            stage._mirrorDrawCommand.framebuffer = mirrorFrameBuffer;
        }
    }

    var scatterPositionLocation = 0;
    var scatterAttributeLocations = {
        tilePosition : scatterPositionLocation
    };
    function createMirrorVertexArray(stage, context) {
        var tileWidth = stage._tileWidth;
        var tileHeight = stage._tileHeight;
        var positions = new Float32Array(tileWidth * tileHeight * 2);
        for (var y = 0; y < tileHeight; y++) {
            for (var x = 0; x < tileWidth; x++) {
                var index = ((y * tileWidth) + x) * 2;
                positions[index] = x;
                positions[index + 1] = y;
            }
        }

        var positionsVertexBuffer = Buffer.createVertexBuffer({
            context : context,
            typedArray : positions,
            usage : BufferUsage.STATIC_DRAW
        });
        var attributes = [{
            index : scatterPositionLocation,
            vertexBuffer : positionsVertexBuffer,
            componentsPerAttribute : 2,
            ComponentDatatype : ComponentDatatype.FLOAT, // Uint16Array and UNSIGNED_SHORT together don't work, although that'd be nice
            normalize : false,
            offsetInBytes : 0,
            strideInBytes : 0
        }];
        stage._mirrorVertexArray = new VertexArray({
            context : context,
            attributes : attributes
        });
    }

    function createMirrorCommands(stage, context) {
        var renderState = RenderState.fromCache({
            depthTest : {
                enabled : true
            },
            stencilTest : {
                enabled : true,
                reference : PlanarReflectionPolygon.STENCIL_REFERENCE,
                frontFunction : StencilFunction.EQUAL
            }
        });

        var vertexShader = new ShaderSource({
            defines : [stage._useLogDepth ? 'LOG_DEPTH' : ''],
            sources : [PlanarReflectionScatterVS]
        });

        var uniformMap = {
            u_colorTexture : function() {
                return stage._colorTexture;
            },
            u_depthTexture : function() {
                return stage._depthTexture;
            },
            u_scale : function() {
                return stage._pixelToNDC;
            },
            u_pixelOffset : function() {
                return stage._pixelOffset;
            },
            u_planeEC : function() {
                return stage._planeEC;
            },
            u_ignoreHeight : function() {
                return stage._ignoreHeight;
            }
        };

        stage._mirrorClearCommand = new ClearCommand({
            framebuffer : stage._mirrorFrameBuffer,
            color : new Color(0.0, 0.0, 0.0, 0.0),
            stencil : 0,
            depth : 1.0,
            renderState : RenderState.fromCache(),
            owner : stage
        });

        stage._mirrorDrawCommand = new DrawCommand({
            vertexArray : stage._mirrorVertexArray,
            primitiveType : PrimitiveType.POINTS,
            renderState : renderState,
            shaderProgram : ShaderProgram.fromCache({
                context : context,
                vertexShaderSource : vertexShader,
                fragmentShaderSource : PlanarReflectionScatterFS,
                attributeLocations : scatterAttributeLocations
            }),
            uniformMap : uniformMap,
            framebuffer : stage._mirrorFrameBuffer,
            owner : stage
        });
    }

    function createCompositeCommand(stage, context) {
        var uniformMap = {
            u_colorTexture : function() {
                return stage._colorTexture;
            },
            u_depthTexture : function() {
                return stage._depthTexture;
            },
            u_mirrorColorTexture : function() {
                return stage._mirrorColorTexture;
            },
            u_planeEC : function() {
                return stage._planeEC;
            },
            u_ignoreHeight : function() {
                return stage._ignoreHeight;
            },
            u_reflectionBlendAmount : function() {
                return stage.reflectionBlendAmount;
            }
        };

        var compositeShader = new ShaderSource({
            defines : [stage._useLogDepth ? 'LOG_DEPTH' : ''],
            sources : [PlanarReflectionComposite]
        });

        stage._compositeCommand = context.createViewportQuadCommand(compositeShader, {
            uniformMap : uniformMap,
            owner : stage
        });
    }

    PlanarReflectionPostProcessStage.prototype.update = function(context, useLogDepth) {
        if (this.enabled !== this._enabled && !this.enabled) {
            releaseResources(this);
        }

        this._enabled = this.enabled;
        if (!this._enabled) {
            return;
        }

        var logDepthChanged = useLogDepth !== this._useLogDepth;
        this._useLogDepth = useLogDepth;

        if (logDepthChanged) {
            destroyMirrorCommands(this);
            destroyCompositeCommand(this);
        }

        var screenWidth = context.drawingBufferWidth;
        var screenHeight = context.drawingBufferHeight;

        var bufferSizeChanged = screenWidth !== this._screenWidth || screenHeight !== this._screenHeight;
        if (bufferSizeChanged) {
            destroyMirrorFrameBuffer(this);
        }

        this._screenWidth = screenWidth;
        this._screenHeight = screenHeight;
        var pixelToNDC = this._pixelToNDC;
        pixelToNDC.x = 1.0 / screenWidth;
        pixelToNDC.y = 1.0 / screenHeight;

        if (!defined(this._mirrorVertexArray)) {
            createMirrorVertexArray(this, context);
        }

        if (!defined(this._mirrorFrameBuffer)) {
            createMirrorFrameBuffer(this, context);
        }

        if (!defined(this._mirrorDrawCommand)) {
            createMirrorCommands(this, context);
        }

        if (!defined(this._compositeCommand)) {
            createCompositeCommand(this, context);
        }

        this._planarReflectionPolygon.update(context);

        this._outputFramebuffer = this._textureCache.getFramebuffer(this._name);
        this._compositeCommand.framebuffer = this._outputFramebuffer;
    };

    var planeEcScratch = new Plane(Cartesian3.UNIT_X, 0.0);
    PlanarReflectionPostProcessStage.prototype.execute = function(context, colorTexture, depthTexture) {
        if (!defined(this._outputFramebuffer) || !this._ready || !this._enabled) {
            return;
        }

        this._colorTexture = colorTexture;
        this._depthTexture = depthTexture;

        // Transform plane to eyespace
        var planeEC = Plane.transform(this._plane, context.uniformState.modelView,planeEcScratch);
        var planeNormal = planeEC.normal;
        var planeEcVec4 = this._planeEC;
        planeEcVec4.x = planeNormal.x;
        planeEcVec4.y = planeNormal.y;
        planeEcVec4.z = planeNormal.z;
        planeEcVec4.w = planeEC.distance;

        // Clear mirror framebuffer
        this._mirrorClearCommand.execute(context);

        // Draw polygon and write stencil.
        this._planarReflectionPolygon.execute(context, this._mirrorFrameBuffer);

        // Execute reflection commands.
        var tileWidth = this._tileWidth;
        var tileHeight = this._tileHeight;
        var pixelOffset = this._pixelOffset;
        var tilesX = Math.ceil(this._screenWidth / tileWidth);
        var tilesY = Math.ceil(this._screenHeight / tileHeight);
        var mirrorDrawCommand = this._mirrorDrawCommand;

        for (var y = 0; y < tilesY; y++) {
            for (var x = 0; x < tilesX; x++) {
                pixelOffset.x = x * tileWidth;
                pixelOffset.y = y * tileHeight;
                mirrorDrawCommand.execute(context);
            }
        }

        // Comp with what's currently in the scene
        this._compositeCommand.execute(context);
    };

    PlanarReflectionPostProcessStage.prototype.isDestroyed = function() {
        return false;
    };

    function destroyMirrorFrameBuffer(stage) {
        var framebuffer = stage._mirrorFrameBuffer;
        if (!defined(framebuffer)) {
            return;
        }

        stage._mirrorColorTexture.destroy();
        stage._mirrorDepthStencil.destroy();
        framebuffer.destroy();

        stage._mirrorFrameBuffer = undefined;
        stage._mirrorColorTexture = undefined;
    }

    function destroyMirrorVertexArray(stage) {
        var vertexArray = stage._mirrorVertexArray;
        stage._mirrorVertexArray = vertexArray && vertexArray.destroy();
    }

    function destroyMirrorCommands(stage) {
        var mirrorDrawCommand = stage._mirrorDrawCommand;
        if (!defined(mirrorDrawCommand)) {
            return;
        }
        mirrorDrawCommand.shaderProgram = mirrorDrawCommand.shaderProgram && mirrorDrawCommand.shaderProgram.destroy();

        stage._mirrorDrawCommand = undefined;
        stage._mirrorClearCommand = undefined;
    }

    function destroyCompositeCommand(stage) {
        var compositeCommand = stage._compositeCommand;
        if (defined(!compositeCommand)) {
            return;
        }
        compositeCommand.shaderProgram = compositeCommand.shaderProgram && compositeCommand.shaderProgram.destroy();

        stage._compositeCommand = undefined;
    }

    function releaseResources(stage) {
        destroyMirrorFrameBuffer(stage);
        destroyMirrorVertexArray(stage);
        destroyMirrorCommands(stage);
        destroyCompositeCommand(stage);

        stage._planarReflectionPolygon = stage._planarReflectionPolygon && stage._planarReflectionPolygon.destroy();
    }

    PlanarReflectionPostProcessStage.prototype.destroy = function() {
        releaseResources(this);
        return destroyObject(this);
    };
export default PlanarReflectionPostProcessStage;
