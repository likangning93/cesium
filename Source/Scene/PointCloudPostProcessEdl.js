/*global define*/
define([
        '../Core/Cartesian2',
        '../Core/clone',
        '../Core/Color',
        '../Core/combine',
        '../Core/ComponentDatatype',
        '../Core/defined',
        '../Core/destroyObject',
        '../Core/Geometry',
        '../Core/GeometryAttribute',
        '../Core/PixelFormat',
        '../Core/PrimitiveType',
        '../Renderer/BufferUsage',
        '../Renderer/ClearCommand',
        '../Renderer/DrawCommand',
        '../Renderer/Framebuffer',
        '../Renderer/Pass',
        '../Renderer/PixelDatatype',
        '../Renderer/RenderState',
        '../Renderer/Sampler',
        '../Renderer/ShaderSource',
        '../Renderer/ShaderProgram',
        '../Renderer/Texture',
        '../Renderer/TextureMagnificationFilter',
        '../Renderer/TextureMinificationFilter',
        '../Renderer/TextureWrap',
        '../Renderer/VertexArray',
        '../Scene/BlendEquation',
        '../Scene/BlendFunction',
        '../Scene/BlendingState',
        '../Scene/StencilFunction',
        '../Scene/StencilOperation',
        '../Shaders/PostProcessFilters/PointCloudEyeDomeLighting'
    ], function(
        Cartesian2,
        clone,
        Color,
        combine,
        ComponentDatatype,
        defined,
        destroyObject,
        Geometry,
        GeometryAttribute,
        PixelFormat,
        PrimitiveType,
        BufferUsage,
        ClearCommand,
        DrawCommand,
        Framebuffer,
        Pass,
        PixelDatatype,
        RenderState,
        Sampler,
        ShaderSource,
        ShaderProgram,
        Texture,
        TextureMagnificationFilter,
        TextureMinificationFilter,
        TextureWrap,
        VertexArray,
        BlendEquation,
        BlendFunction,
        BlendingState,
        StencilFunction,
        StencilOperation,
        PointCloudEyeDomeLighting
    ) {
    'use strict';

     /**
     * @private
     */
    function PointCloudPostProcessEdl() {
        this._framebuffers = undefined;
        this._colorTexture = undefined; // color gbuffer
        this._ecTexture = undefined; // depth gbuffer
        this._stencilMaskTexture = undefined; // needed to write depth so camera based on depth works
        this._drawCommands = undefined;
        this._clearCommands = undefined;

        this.edlStrength = 1.0;
        this.radius = 1.0;

        this._testingFunc = StencilFunction.EQUAL;
        this._testingOp = {
            fail : StencilOperation.KEEP,
            zFail : StencilOperation.KEEP,
            zPass : StencilOperation.KEEP
        };
        this._writeFunc = StencilFunction.ALWAYS;
        this._writeOp = {
            fail : StencilOperation.KEEP,
            zFail : StencilOperation.KEEP,
            zPass : StencilOperation.ZERO
        };

        this._positiveStencilTest = {
            enabled : true,
            reference : 0,
            mask : 1,
            frontFunction : this._testingFunc,
            backFunction : this._testingFunc,
            frontOperation : this._testingOp,
            backOperation : this._testingOp
        };
        this._negativeStencilTest = {
            enabled : true,
            reference : 1,
            mask : 1,
            frontFunction : this._testingFunc,
            backFunction : this._testingFunc,
            frontOperation : this._testingOp,
            backOperation : this._testingOp
        };
    }

    function createSampler() {
        return new Sampler({
            wrapS : TextureWrap.CLAMP_TO_EDGE,
            wrapT : TextureWrap.CLAMP_TO_EDGE,
            minificationFilter : TextureMinificationFilter.NEAREST,
            magnificationFilter : TextureMagnificationFilter.NEAREST
        });
    }

    function destroyFramebuffers(processor) {
        var framebuffers = processor._framebuffers;
        if (!defined(framebuffers)) {
            return;
        }

        processor._colorTexture.destroy();
        processor._ecTexture.destroy();
        processor._sectorLUTTexture.destroy();
        processor._stencilMaskTexture.destroy();
        for (var name in framebuffers) {
            if (framebuffers.hasOwnProperty(name)) {
                framebuffers[name].destroy();
            }
        }

        this._framebuffers = undefined;
        this._colorTexture = undefined;
        this._ecTexture = undefined;
        this._stencilMaskTexture = undefined;
        this._drawCommands = undefined;
        this._clearCommands = undefined;
    }

    function createFramebuffers(processor, context) {
        var screenWidth = context.drawingBufferWidth;
        var screenHeight = context.drawingBufferHeight;

        var colorTexture = new Texture({
            context : context,
            width : screenWidth,
            height : screenHeight,
            pixelFormat : PixelFormat.RGBA,
            pixelDatatype : PixelDatatype.UNSIGNED_BYTE,
            sampler : createSampler()
        });

        var ecTexture = new Texture({
            context : context,
            width : screenWidth,
            height : screenHeight,
            pixelFormat : PixelFormat.RGBA,
            pixelDatatype : PixelDatatype.FLOAT,
            sampler : createSampler()
        });

        var stencilMaskTexture = new Texture({
            context : context,
            width : screenWidth,
            height : screenHeight,
            pixelFormat : PixelFormat.DEPTH_STENCIL,
            pixelDatatype : PixelDatatype.UNSIGNED_INT_24_8,
            sampler : createSampler()
        });

        processor._framebuffers = {
            prior : new Framebuffer({
                context : context,
                colorTextures : [
                    colorTexture,
                    ecTexture
                ],
                depthStencilTexture : stencilMaskTexture,
                destroyAttachments : false
            })
        };
        processor._colorTexture = colorTexture;
        processor._ecTexture = ecTexture;
        processor._stencilMaskTexture = stencilMaskTexture;
    }

    var edlStrengthAndRadiusScratch = new Cartesian2();

    function createCommands(processor, context) {
        processor._drawCommands = {};

        var blendFS = PointCloudEyeDomeLighting;
        var blendUniformMap = {
            u_pointCloud_colorTexture : function() {
                return processor._colorTexture;
            },
            u_pointCloud_ecTexture : function() {
                return processor._ecTexture;
            },
            u_edlStrengthAndDistance : function() {
                edlStrengthAndRadiusScratch.x = processor.edlStrength;
                edlStrengthAndRadiusScratch.y = processor.radius;
                return edlStrengthAndRadiusScratch;
            }
        };

        var blendRenderState = RenderState.fromCache({
            blending : BlendingState.ALPHA_BLEND,
            depthMask : true,
            depthTest : {
                enabled : true
            }
        });

        var blendCommand = context.createViewportQuadCommand(blendFS, {
            uniformMap : blendUniformMap,
            renderState : blendRenderState,
            pass : Pass.CESIUM_3D_TILE,
            owner : processor
        });

        // set up clear commands for all frame buffers
        var framebuffers = processor._framebuffers;
        var clearCommands = {};
        for (var name in framebuffers) {
            if (framebuffers.hasOwnProperty(name)) {
                clearCommands[name] = new ClearCommand({
                    framebuffer : framebuffers[name],
                    color : new Color(0.0, 0.0, 0.0, 0.0),
                    depth : 1.0,
                    stencil : 0,
                    renderState : RenderState.fromCache(),
                    pass : Pass.CESIUM_3D_TILE,
                    owner : processor
                });
            }
        }

        processor._drawCommands.blendCommand = blendCommand;
        processor._clearCommands = clearCommands;
    }

    function createResources(processor, context, dirty) {
        var screenWidth = context.drawingBufferWidth;
        var screenHeight = context.drawingBufferHeight;
        var colorTexture = processor._colorTexture;
        var nowDirty = false;
        var resized = defined(colorTexture) &&
            ((colorTexture.width !== screenWidth) ||
             (colorTexture.height !== screenHeight));

        if (!defined(colorTexture) || resized || dirty) {
            destroyFramebuffers(processor);
            createFramebuffers(processor, context);
            createCommands(processor, context);
            nowDirty = true;
        }
        return nowDirty;
    }

    function processingSupported(context) {
        return context.floatingPointTexture && context.drawBuffers && context.fragmentDepth;
    }

    function getECShaderProgram(context, shaderProgram) {
        var shader = context.shaderCache.getDerivedShaderProgram(shaderProgram, 'EC');
        if (!defined(shader)) {
            var attributeLocations = shaderProgram._attributeLocations;

            var vs = shaderProgram.vertexShaderSource.clone();
            var fs = shaderProgram.fragmentShaderSource.clone();

            vs.sources = vs.sources.map(function(source) {
                source = ShaderSource.replaceMain(source, 'czm_point_cloud_post_process_main');
                return source;
            });

            fs.sources = fs.sources.map(function(source) {
                source = ShaderSource.replaceMain(source, 'czm_point_cloud_post_process_main');
                source = source.replace(/gl_FragColor/g, 'gl_FragData[0]');
                return source;
            });

            vs.sources.push(
                'varying vec3 v_positionECPS; \n' +
                'void main() \n' +
                '{ \n' +
                '    czm_point_cloud_post_process_main(); \n' +
                '    v_positionECPS = (czm_inverseProjection * gl_Position).xyz; \n' +
                '}');
            fs.sources.unshift('#extension GL_EXT_draw_buffers : enable \n');
            fs.sources.push(
                'varying vec3 v_positionECPS; \n' +
                'void main() \n' +
                '{ \n' +
                '    czm_point_cloud_post_process_main(); \n' +
                // Write log base 2 depth to alpha for EDL
                '    gl_FragData[1] = vec4(v_positionECPS, log2(-v_positionECPS.z)); \n' +
                '}');

            shader = context.shaderCache.createDerivedShaderProgram(shaderProgram, 'EC', {
                vertexShaderSource : vs,
                fragmentShaderSource : fs,
                attributeLocations : attributeLocations
            });
        }

        return shader;
    }

    PointCloudPostProcessEdl.prototype.update = function(frameState, commandStart, tileset) {
        if (!processingSupported(frameState.context)) {
            return;
        }

        var dirty = false;
        dirty |= createResources(this, frameState.context, dirty);

        // Hijack existing point commands to render into an offscreen FBO.
        var i;
        var commandList = frameState.commandList;
        var commandEnd = commandList.length;

        for (i = commandStart; i < commandEnd; ++i) {
            var command = commandList[i];
            if (command.primitiveType !== PrimitiveType.POINTS) {
                continue;
            }

            var derivedCommand = command.derivedCommands.pointCloudProcessor;
            if (!defined(derivedCommand) || command.dirty || dirty) {
                derivedCommand = DrawCommand.shallowClone(command);
                command.derivedCommands.pointCloudProcessor = derivedCommand;

                derivedCommand.framebuffer = this._framebuffers.prior;
                derivedCommand.shaderProgram = getECShaderProgram(frameState.context, command.shaderProgram);
                derivedCommand.castShadows = false;
                derivedCommand.receiveShadows = false;

                var derivedCommandRenderState = clone(derivedCommand.renderState);
                derivedCommand.renderState = RenderState.fromCache(
                    derivedCommandRenderState
                );

                derivedCommand.pass = Pass.CESIUM_3D_TILE; // Overrides translucent commands
            }

            commandList[i] = derivedCommand;
        }

        var clearCommands = this._clearCommands;
        var blendCommand = this._drawCommands.blendCommand;

        // Blend EDL into the main FBO
        commandList.push(blendCommand);
        commandList.push(clearCommands.prior);
    };

    /**
     * Returns true if this object was destroyed; otherwise, false.
     * <br /><br />
     * If this object was destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.
     *
     * @returns {Boolean} <code>true</code> if this object was destroyed; otherwise, <code>false</code>.
     *
     * @see PointCloudPostProcessEdl#destroy
     */
    PointCloudPostProcessEdl.prototype.isDestroyed = function() {
        return false;
    };

    /**
     * Destroys the WebGL resources held by this object.  Destroying an object allows for deterministic
     * release of WebGL resources, instead of relying on the garbage collector to destroy this object.
     * <br /><br />
     * Once an object is destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.  Therefore,
     * assign the return value (<code>undefined</code>) to the object as done in the example.
     *
     * @returns {undefined}
     *
     * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
     *
     * @example
     * processor = processor && processor.destroy();
     *
     * @see PointCloudPostProcessEdl#isDestroyed
     */
    PointCloudPostProcessEdl.prototype.destroy = function() {
        destroyFramebuffers(this);
        return destroyObject(this);
    };

    return PointCloudPostProcessEdl;
});
