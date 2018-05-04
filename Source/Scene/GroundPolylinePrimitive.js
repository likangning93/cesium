define([
    '../Core/defined',
    '../Core/defineProperties',
    '../Core/destroyObject',
    '../Renderer/DrawCommand',
    '../Renderer/Pass',
    '../Renderer/RenderState',
    '../Renderer/ShaderProgram',
    '../Renderer/ShaderSource',
    '../Shaders/PolylineShadowVolumeVS',
    '../Shaders/PolylineShadowVolumeFS',
    '../ThirdParty/when',
    './BlendingState',
    './PerInstanceColorAppearance',
    './PolylineShadowVolume',
    './Primitive',
    './SceneMode'
], function(
    defined,
    defineProperties,
    destroyObject,
    DrawCommand,
    Pass,
    RenderState,
    ShaderProgram,
    ShaderSource,
    PolylineShadowVolumeVS,
    PolylineShadowVolumeFS,
    when,
    BlendingState,
    PerInstanceColorAppearance,
    PolylineShadowVolume,
    Primitive,
    SceneMode) {
    'use strict';

    // TODO: tbh this could probably just be done using a custom MaterialAppearance since none of this primitive stuff is very special
    function GroundPolylinePrimitive(ellipsoid, cartographics) {
        this.geometryInstances = PolylineShadowVolume._createGeometryInstances(ellipsoid, cartographics);

        this._primitive = undefined;
        this._shaderProgram = undefined;
        this._rsColorPass = undefined;

        this._ready = false;
        this._readyPromise = when.defer();

        this._primitiveOptions = {
            geometryInstances : undefined,
            appearance : new PerInstanceColorAppearance(), // faaaaake
            asynchronous : false,
            _createRenderStatesFunction : undefined,
            _createShaderProgramFunction : undefined,
            _createCommandsFunction : undefined,
            _updateAndQueueCommandsFunction : undefined,
            compressVertices : false // otherwise normals will be weird
        };

        this._uniformMap = {};
    }

    defineProperties(GroundPolylinePrimitive.prototype, {
        /**
         * Determines if the primitive is complete and ready to render.  If this property is
         * true, the primitive will be rendered the next time that {@link GroundPolylinePrimitive#update}
         * is called.
         *
         * @memberof GroundPolylinePrimitive.prototype
         *
         * @type {Boolean}
         * @readonly
         */
        ready : {
            get : function() {
                return this._ready;
            }
        },

        /**
         * Gets a promise that resolves when the primitive is ready to render.
         * @memberof GroundPolylinePrimitive.prototype
         * @type {Promise.<GroundPolylinePrimitive>}
         * @readonly
         */
        readyPromise : {
            get : function() {
                return this._readyPromise.promise;
            }
        }
    });

    function createShaderProgram(groundPolylinePrimitive, frameState) {
        if (defined(groundPolylinePrimitive._shaderProgram)) {
            return;
        }

        var context = frameState.context;
        var primitive = groundPolylinePrimitive._primitive;
        var vs = PolylineShadowVolumeVS;
        vs = primitive._batchTable.getVertexShaderCallback()(vs);
        vs = Primitive._appendDistanceDisplayConditionToShader(primitive, vs);
        vs = Primitive._modifyShaderPosition(groundPolylinePrimitive, vs, frameState.scene3DOnly);

        var vsSource = new ShaderSource({
            defines : ['ENABLE_GL_POSITION_LOG_DEPTH_AT_HEIGHT'],
            sources : [vs]
        });
        var fsSource = new ShaderSource({
            sources : [PolylineShadowVolumeFS]
        });

        var attributeLocations = primitive._attributeLocations;
        groundPolylinePrimitive._shaderProgram = ShaderProgram.replaceCache({
            context : context,
            shaderProgram : groundPolylinePrimitive._shaderProgram,
            vertexShaderSource : vsSource,
            fragmentShaderSource : fsSource,
            attributeLocations : attributeLocations
        });
    }

    function createColorCommands(groundPolylinePrimitive, colorCommands) {
        var primitive = groundPolylinePrimitive._primitive;
        var uniformMap = primitive._batchTable.getUniformMapCallback()(groundPolylinePrimitive._uniformMap);
        colorCommands.length = 1;
        var colorCommand = colorCommands[0];
        if (!defined(colorCommand)) {
            colorCommand = colorCommands[0] = new DrawCommand({
                owner : groundPolylinePrimitive,
                primitiveType : primitive._primitiveType
            });
        }
        colorCommand.vertexArray = primitive._va[0];
        colorCommand.shaderProgram = groundPolylinePrimitive._shaderProgram;
        colorCommand.uniformMap = uniformMap;
        colorCommand.renderState = groundPolylinePrimitive._rsColorPass;
    }

    function createCommands(groundPolylinePrimitive, colorCommands, pickCommands) {
        createColorCommands(groundPolylinePrimitive, colorCommands);
    }

    function getColorRenderState() {
        return {
            depthTest : {
                enabled : false
            },
            depthMask : false,
            blending : BlendingState.ALPHA_BLEND
        };
    }

    function createRenderStates(groundPolylinePrimitive, context) {
        if (defined(groundPolylinePrimitive._rsColorPass)) {
            return;
        }
        groundPolylinePrimitive._rsColorPass = RenderState.fromCache(getColorRenderState());
    }

    function updateAndQueueCommands(groundPolylinePrimitive, frameState, colorCommands, pickCommands, modelMatrix, cull, debugShowBoundingVolume, twoPasses) {
        var primitive = groundPolylinePrimitive._primitive;
        Primitive._updateBoundingVolumes(primitive, frameState, modelMatrix);

        var boundingVolumes;
        if (frameState.mode === SceneMode.SCENE3D) {
            boundingVolumes = primitive._boundingSphereWC;
        } else if (frameState.mode === SceneMode.COLUMBUS_VIEW) {
            boundingVolumes = primitive._boundingSphereCV;
        } else if (frameState.mode === SceneMode.SCENE2D && defined(primitive._boundingSphere2D)) {
            boundingVolumes = primitive._boundingSphere2D;
        } else if (defined(primitive._boundingSphereMorph)) {
            boundingVolumes = primitive._boundingSphereMorph;
        }

        var commandList = frameState.commandList;
        var passes = frameState.passes;

        if (passes.render) {
            var colorCommand;
            var colorLength = colorCommands.length;
            for (var i = 0; i < colorLength; ++i) {
                colorCommand = colorCommands[i];
                colorCommand.modelMatrix = modelMatrix;
                colorCommand.boundingVolume = boundingVolumes[i];
                colorCommand.cull = cull;
                colorCommand.debugShowBoundingVolume = debugShowBoundingVolume;
                colorCommand.pass = Pass.TERRAIN_CLASSIFICATION;

                commandList.push(colorCommand);
            }
        }
    }

    GroundPolylinePrimitive.prototype.update = function(frameState) {
        if (!defined(this._primitive)) {
            var that = this;
            var primitiveOptions = this._primitiveOptions;

            primitiveOptions.geometryInstances = this.geometryInstances;
            primitiveOptions._createRenderStatesFunction = function(primitive, context, appearance, twoPasses) {
                createRenderStates(that, context);
            };
            primitiveOptions._createShaderProgramFunction = function(primitive, frameState, appearance) {
                createShaderProgram(that, frameState);
            };
            primitiveOptions._createCommandsFunction = function(primitive, appearance, material, translucent, twoPasses, colorCommands, pickCommands) {
                createCommands(that, colorCommands, pickCommands);
            };
            primitiveOptions._updateAndQueueCommandsFunction = function(primitive, frameState, colorCommands, pickCommands, modelMatrix, cull, debugShowBoundingVolume, twoPasses) {
                updateAndQueueCommands(that, frameState, colorCommands, pickCommands, modelMatrix, cull, debugShowBoundingVolume, twoPasses);
            };

            this._primitive = new Primitive(primitiveOptions);
            this._primitive.readyPromise.then(function(primitive) {
                that._ready = true;

                var error = primitive._error;
                if (!defined(error)) {
                    that._readyPromise.resolve(that);
                } else {
                    that._readyPromise.reject(error);
                    that._readyPromise.reject(error);
                }
            });
        }

        this._primitive.update(frameState);
    }

    /**
     * Returns true if this object was destroyed; otherwise, false.
     * <p>
     * If this object was destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.
     * </p>
     *
     * @returns {Boolean} <code>true</code> if this object was destroyed; otherwise, <code>false</code>.
     *
     * @see GroundPolylinePrimitive#destroy
     */
    GroundPolylinePrimitive.prototype.isDestroyed = function() {
        return false;
    };

    /**
     * Destroys the WebGL resources held by this object.  Destroying an object allows for deterministic
     * release of WebGL resources, instead of relying on the garbage collector to destroy this object.
     * <p>
     * Once an object is destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.  Therefore,
     * assign the return value (<code>undefined</code>) to the object as done in the example.
     * </p>
     *
     * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
     *
     * @example
     * e = e && e.destroy();
     *
     * @see GroundPolylinePrimitive#isDestroyed
     */
    GroundPolylinePrimitive.prototype.destroy = function() {
        this._primitive = this._primitive && this._primitive.destroy();
        this._shaderProgram = this._shaderProgram && this._shaderProgram.destroy();

        return destroyObject(this);
    };

    return GroundPolylinePrimitive;
});
