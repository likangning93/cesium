define([
        '../Core/ApproximateTerrainHeights',
        '../Core/arraySlice',
        '../Core/Cartesian2',
        '../Core/Cartesian3',
        '../Core/Cartesian4',
        '../Core/Cartographic',
        '../Core/Color',
        '../Core/ComponentDatatype',
        '../Core/defaultValue',
        '../Core/defined',
        '../Core/defineProperties',
        '../Core/destroyObject',
        '../Core/Ellipsoid',
        '../Core/EllipsoidGeodesic',
        '../Core/IndexDatatype',
        '../Core/Matrix4',
        '../Core/PixelFormat',
        '../Core/Plane',
        '../Core/Rectangle',
        '../Core/TaskProcessor',
        '../Renderer/Buffer',
        '../Renderer/BufferUsage',
        '../Renderer/DrawCommand',
        '../Renderer/Pass',
        '../Renderer/PixelDatatype',
        '../Renderer/RenderState',
        '../Renderer/ShaderProgram',
        '../Renderer/ShaderSource',
        '../Renderer/Texture',
        '../Renderer/VertexArray',
        '../Shaders/Vector3DTileClampedPolylinesVS',
        '../Shaders/Vector3DTileClampedPolylinesFS',
        '../ThirdParty/when',
        './BlendingState',
        './Cesium3DTileFeature',
        './ClassificationType',
        './StencilConstants',
        './StencilFunction',
        './StencilOperation'
    ], function(
        ApproximateTerrainHeights,
        arraySlice,
        Cartesian2,
        Cartesian3,
        Cartesian4,
        Cartographic,
        Color,
        ComponentDatatype,
        defaultValue,
        defined,
        defineProperties,
        destroyObject,
        Ellipsoid,
        EllipsoidGeodesic,
        IndexDatatype,
        Matrix4,
        PixelFormat,
        Plane,
        Rectangle,
        TaskProcessor,
        Buffer,
        BufferUsage,
        DrawCommand,
        Pass,
        PixelDatatype,
        RenderState,
        ShaderProgram,
        ShaderSource,
        Texture,
        VertexArray,
        Vector3DTileClampedPolylinesVS,
        Vector3DTileClampedPolylinesFS,
        when,
        BlendingState,
        Cesium3DTileFeature,
        ClassificationType,
        StencilConstants,
        StencilFunction,
        StencilOperation) {
    'use strict';

    var edgeCartesianScratch = new Cartesian3();
    /**
     * Creates a batch of polylines as volumes with shader-adjustable width.
     *
     * @alias Vector3DTileClampedPolylines
     * @constructor
     *
     * @param {Object} options An object with following properties:
     * @param {Uint16Array} options.positions The positions of the polylines
     * @param {Uint32Array} options.counts The number or positions in the each polyline.
     * @param {Uint16Array} options.widths The width of each polyline.
     * @param {Number} options.minimumHeight The minimum height of the tile's region.
     * @param {Number} options.maximumHeight The maximum height of the tile's region.
     * @param {Rectangle} options.rectangle The rectangle containing the tile.
     * @param {Cartesian3} [options.center=Cartesian3.ZERO] The RTC center.
     * @param {Cesium3DTileBatchTable} options.batchTable The batch table for the tile containing the batched polylines.
     * @param {Uint16Array} options.batchIds The batch ids for each polyline.
     * @param {BoundingSphere} options.boundingVolume The bounding volume for the entire batch of polylines.
     * @param {Cesium3DTileset} options.tileset Tileset carrying minimum and maximum clamping heights.
     *
     * @private
     */
    function Vector3DTileClampedPolylines(options) {
        // these arrays hold data from the tile payload
        // and are all released after the first update.
        this._positions = options.positions;
        this._widths = options.widths;
        this._counts = options.counts;
        this._batchIds = options.batchIds;

        var ellipsoid = defaultValue(options.ellipsoid, Ellipsoid.WGS84);
        var rectangle = Rectangle.clone(options.rectangle);
        var center = Cartesian3.clone(options.center);

        this._ellipsoid = ellipsoid;
        this._minimumHeight = options.minimumHeight;
        this._maximumHeight = options.maximumHeight;

        this._center = center;
        this._rectangle = rectangle;

        var midLat = (rectangle.north + rectangle.south) * 0.5;
        var edgeCartesian = edgeCartesianScratch;

        edgeCartesian = Cartesian3.fromRadians(rectangle.east, midLat, 0.0, ellipsoid, edgeCartesianScratch);
        var eastPlane = computeTangentNormalPlane(edgeCartesian, center, ellipsoid);

        edgeCartesian = Cartesian3.fromRadians(rectangle.west, midLat, 0.0, ellipsoid, edgeCartesianScratch);
        var westPlane = computeTangentNormalPlane(edgeCartesian, center, ellipsoid);

        edgeCartesian = computeLatitudeBound(rectangle.north, rectangle.east, rectangle.west, ellipsoid, edgeCartesianScratch);
        var northPlane = computeTangentNormalPlane(edgeCartesian, center, ellipsoid);

        edgeCartesian = computeLatitudeBound(rectangle.south, rectangle.east, rectangle.west, ellipsoid, edgeCartesianScratch);
        var southPlane = computeTangentNormalPlane(edgeCartesian, center, ellipsoid);

        this._eastPlane = eastPlane;
        this._westPlane = westPlane;
        this._northPlane = northPlane;
        this._southPlane = southPlane;

        this._boundingVolume = options.boundingVolume;
        this._batchTable = options.batchTable;

        this._va = undefined;
        this._sp = undefined;
        this._rs = undefined;
        this._uniformMap = undefined;
        this._command = undefined;
        this._lineSegmentTableTexture = undefined;

        this._transferrableBatchIds = undefined;
        this._packedBuffer = undefined;
        this._tileset = options.tileset;
        this._minimumMaximumVectorHeights = new Cartesian2(ApproximateTerrainHeights._defaultMinTerrainHeight, ApproximateTerrainHeights._defaultMaxTerrainHeight);

        this._vertexPositions = undefined;
        this._lineSegmentTable = undefined;
        this._tableTextureWidth = undefined;
        this._tableTextureHeight = undefined;
        this._indices = undefined;

        this._constantColor = Color.clone(Color.WHITE);
        this._highlightColor = this._constantColor;

        this._trianglesLength = 0;
        this._geometryByteLength = 0;

        this._ready = false;
        this._readyPromise = when.defer();

        this._verticesPromise = undefined;

        var that = this;
        ApproximateTerrainHeights.initialize().then(function() {
            updateMinimumMaximumHeights(that, that._rectangle, that._ellipsoid);
        }).otherwise(function(error) {
            this._readyPromise.reject(error);
        });
    }

    function cartesian4FromPlane(plane, result) {
        var norm = plane.normal;
        return Cartesian4.fromElements(norm.x, norm.y, norm.z, plane.distance, result);
    }

    var surfaceNormalScratch = new Cartesian3();
    var towardsCenterScratch = new Cartesian3();
    var scratchPlane = new Plane(Cartesian3.UNIT_X, 0.0);
    // Compute a plane whose normal is tangent to the ellipsoid and points towards the center
    function computeTangentNormalPlane(edgeCartesian, centerCartesian, ellipsoid) {
        var surfaceNormal = ellipsoid.geodeticSurfaceNormal(edgeCartesian, surfaceNormalScratch);
        var towardsCenter = Cartesian3.subtract(centerCartesian, edgeCartesian, towardsCenterScratch);
        Cartesian3.normalize(towardsCenter, towardsCenter);
        var right = Cartesian3.cross(towardsCenter, surfaceNormal, towardsCenterScratch);
        Cartesian3.normalize(right, right);
        var planeNormal = Cartesian3.cross(surfaceNormal, right, towardsCenterScratch);
        var plane = Plane.fromPointNormal(edgeCartesian, planeNormal, scratchPlane);
        return cartesian4FromPlane(plane, new Cartesian4());
    }

    var onRectangleScratch = new Cartesian3();
    var onGeodesicScratch = new Cartesian3();
    var corner0Scratch = new Cartographic();
    var corner1Scratch = new Cartographic();
    var geodesicCenterScratch = new Cartographic();
    var ellipsoidGeodesicScratch = new EllipsoidGeodesic(undefined, undefined, Ellipsoid.WGS84);
    // Compute a point on the globe such that a plane intersecting it and tangent to the surface
    // normal will bound both longitudes at the given latitude.
    function computeLatitudeBound(latitude, longitude0, longitude1, ellipsoid, result) {
        var onRectangle = Cartesian3.fromRadians((longitude0 + longitude1) * 0.5, latitude, 0.0, ellipsoid, onRectangleScratch);
        var corner0 = corner0Scratch;
        var corner1 = corner1Scratch;
        corner0.latitude = latitude;
        corner1.latitude = latitude;
        corner0.longitude0 = longitude0;
        corner1.longitude1 = longitude1;

        var ellipsoidGeodesic = ellipsoidGeodesicScratch;
        if (ellipsoid !== Ellipsoid.WGS84) {
            ellipsoidGeodesic = new EllipsoidGeodesic(undefined, undefined, ellipsoid);
        }
        ellipsoidGeodesic.setEndPoints(corner0, corner1);
        var geodesicCenter = ellipsoidGeodesic.interpolateUsingFraction(0.5, geodesicCenterScratch);
        var onGeodesicCenter = Cartographic.toCartesian(geodesicCenter, onGeodesicScratch);
        if (Math.abs(onGeodesicCenter.z) > Math.abs(onRectangle.z)) {
            return Cartesian3.clone(onGeodesicCenter, result);
        }
        return Cartesian3.clone(onRectangle, result);
    }

    defineProperties(Vector3DTileClampedPolylines.prototype, {
        /**
         * Gets the number of triangles.
         *
         * @memberof Vector3DTileClampedPolylines.prototype
         *
         * @type {Number}
         * @readonly
         */
        trianglesLength : {
            get : function() {
                return this._trianglesLength;
            }
        },

        /**
         * Gets the geometry memory in bytes.
         *
         * @memberof Vector3DTileClampedPolylines.prototype
         *
         * @type {Number}
         * @readonly
         */
        geometryByteLength : {
            get : function() {
                return this._geometryByteLength;
            }
        },

        /**
         * Gets a promise that resolves when the primitive is ready to render.
         * @memberof Vector3DTileClampedPolylines.prototype
         * @type {Promise}
         * @readonly
         */
        readyPromise : {
            get : function() {
                return this._readyPromise.promise;
            }
        }
    });

    function updateMinimumMaximumHeights(polylines, rectangle, ellipsoid) {
        var result = ApproximateTerrainHeights.getMinimumMaximumHeights(rectangle, ellipsoid);
        var minimumMaximumVectorHeights = polylines._minimumMaximumVectorHeights;
        minimumMaximumVectorHeights.x = result.minimumTerrainHeight;
        minimumMaximumVectorHeights.y = result.maximumTerrainHeight;
    }

    function packBuffer(polylines) {
        var rectangle = polylines._rectangle;
        var minimumHeight = polylines._minimumHeight;
        var maximumHeight = polylines._maximumHeight;
        var ellipsoid = polylines._ellipsoid;
        var center = polylines._center;

        var packedLength = 2 + Rectangle.packedLength + Ellipsoid.packedLength + Cartesian3.packedLength + (4 * Plane.packedLength);
        var packedBuffer = new Float64Array(packedLength);

        var offset = 0;
        packedBuffer[offset++] = minimumHeight;
        packedBuffer[offset++] = maximumHeight;

        Rectangle.pack(rectangle, packedBuffer, offset);
        offset += Rectangle.packedLength;

        Ellipsoid.pack(ellipsoid, packedBuffer, offset);
        offset += Ellipsoid.packedLength;

        Cartesian3.pack(center, packedBuffer, offset);
        offset += Cartesian3.packedLength;

        Cartesian4.pack(this._eastPlane, packedBuffer, offset);
        offset += Cartesian4.packedLength;

        Cartesian4.pack(this._westPlane, packedBuffer, offset);
        offset += Cartesian4.packedLength;

        Cartesian4.pack(this._northPlane, packedBuffer, offset);
        offset += Cartesian4.packedLength;

        Cartesian4.pack(this._southPlane, packedBuffer, offset);

        return packedBuffer;
    }

    var createVerticesTaskProcessor = new TaskProcessor('createVectorTileClampedPolylines');
    var attributeLocations = {
        vertexPositions : 0
    };

    function createVertexArray(polylines, context) {
        if (defined(polylines._va)) {
            return;
        }

        if (!defined(polylines._verticesPromise)) {
            var positions = polylines._positions;
            var widths = polylines._widths;
            var counts = polylines._counts;
            var batchIds = polylines._transferrableBatchIds;

            var packedBuffer = polylines._packedBuffer;

            if (!defined(packedBuffer)) {
                // Copy because they may be the views on the same buffer.
                positions = polylines._positions = arraySlice(positions);
                widths = polylines._widths = arraySlice(widths);
                counts = polylines._counts = arraySlice(counts);

                batchIds = polylines._transferrableBatchIds = arraySlice(polylines._batchIds);

                packedBuffer = polylines._packedBuffer = packBuffer(polylines);
            }

            var transferrableObjects = [positions.buffer, widths.buffer, counts.buffer, batchIds.buffer, packedBuffer.buffer];
            var parameters = {
                positions : positions.buffer, // TODO: eventually, don't send heights?
                widths : widths.buffer,
                counts : counts.buffer,
                batchIds : batchIds.buffer,
                packedBuffer : packedBuffer.buffer
            };

            var verticesPromise = polylines._verticesPromise = createVerticesTaskProcessor.scheduleTask(parameters, transferrableObjects);
            if (!defined(verticesPromise)) {
                // Postponed
                return;
            }

            when(verticesPromise, function(result) {
                polylines._vertexPositions = new Float32Array(result.vertexPositions);
                polylines._indices = new Uint16Array(result.indices);
                polylines._lineSegmentTable = new Uint8Array(result.lineSegmentTable);
                polylines._tableTextureWidth = result.tableTextureWidth;
                polylines._tableTextureHeight = result.tableTextureHeight;

                polylines._ready = true;
            }).otherwise(function(error) {
                polylines._readyPromise.reject(error);
            });
        }

        if (polylines._ready && !defined(polylines._va)) {
            var vertexPositions = polylines._vertexPositions;
            var lineSegmentTable = polylines._lineSegmentTable;

            var indices = polylines._indices;

            var byteLength = indices.byteLength + vertexPositions.byteLength + lineSegmentTable.byteLength;

            polylines._trianglesLength = indices.length / 3;
            polylines._geometryByteLength = byteLength;

            var vertexPositionsBuffer = Buffer.createVertexBuffer({
                context : context,
                typedArray : vertexPositions,
                usage : BufferUsage.STATIC_DRAW
            });

            var indexBuffer = Buffer.createIndexBuffer({
                context : context,
                typedArray : indices,
                usage : BufferUsage.STATIC_DRAW,
                indexDatatype : (indices.BYTES_PER_ELEMENT === 2) ? IndexDatatype.UNSIGNED_SHORT : IndexDatatype.UNSIGNED_INT
            });

            var vertexAttributes = [{
                index : attributeLocations.vertexPositions,
                vertexBuffer : vertexPositionsBuffer,
                componentDatatype : ComponentDatatype.FLOAT,
                componentsPerAttribute : 3
            }];

            polylines._va = new VertexArray({
                context : context,
                attributes : vertexAttributes,
                indexBuffer : indexBuffer
            });

            var tableTextureWidth = this._tableTextureWidth;
            var tableTextureHeight = this._tableTextureHeight;

            polylines._lineSegmentTableTexture = new Texture({
                context : context,
                width : tableTextureWidth,
                height : tableTextureHeight,
                pixelFormat : PixelFormat.RGBA,
                PixelDatatype : PixelDatatype.UNSIGNED_BYTE,
                source : {
                    arrayBufferView : lineSegmentTable,
                    width : tableTextureWidth,
                    height : tableTextureHeight
                }
            });

            polylines._positions = undefined;
            polylines._widths = undefined;
            polylines._counts = undefined;

            polylines._ellipsoid = undefined;
            polylines._minimumHeight = undefined;
            polylines._maximumHeight = undefined;
            polylines._rectangle = undefined;

            polylines._transferrableBatchIds = undefined;
            polylines._packedBuffer = undefined;

            polylines._vertexPositions = undefined;
            polylines._lineSegmentTable = undefined;
            polylines._indices = undefined;

            polylines._readyPromise.resolve();
        }
    }

    var modifiedModelViewScratch = new Matrix4();
    var rtcScratch = new Cartesian3();
    var transformedPlaneCart4Scratch = new Cartesian4();

    function createUniformMap(primitive, context) {
        if (defined(primitive._uniformMap)) {
            return;
        }

        primitive._uniformMap = {
            u_modifiedModelView : function() {
                var viewMatrix = context.uniformState.view;
                Matrix4.clone(viewMatrix, modifiedModelViewScratch);
                Matrix4.multiplyByPoint(modifiedModelViewScratch, primitive._center, rtcScratch);
                Matrix4.setTranslation(modifiedModelViewScratch, rtcScratch, modifiedModelViewScratch);
                return modifiedModelViewScratch;
            },
            u_highlightColor : function() {
                return primitive._highlightColor;
            },
            u_minimumMaximumVectorHeights : function() {
                return primitive._minimumMaximumVectorHeights;
            },
            u_lineSegmentTable : function() {
                return primitive._lineSegmentTableTexture;
            },
            u_eastPlaneEC : function() {
                var viewMatrix = context.uniformState.view;
                var plane = Plane.fromCartesian4(primitive._eastPlane, scratchPlane);
                plane = Plane.transform(viewMatrix, plane);
                return cartesian4FromPlane(plane, transformedPlaneCart4Scratch);
            },
            u_westPlaneEC : function() {
                var viewMatrix = context.uniformState.view;
                var plane = Plane.fromCartesian4(primitive._westPlane, scratchPlane);
                plane = Plane.transform(viewMatrix, plane);
                return cartesian4FromPlane(plane, transformedPlaneCart4Scratch);
            },
            u_northPlaneEC : function() {
                var viewMatrix = context.uniformState.view;
                var plane = Plane.fromCartesian4(primitive._northPlane, scratchPlane);
                plane = Plane.transform(viewMatrix, plane);
                return cartesian4FromPlane(plane, transformedPlaneCart4Scratch);
            },
            u_southPlaneEC : function() {
                var viewMatrix = context.uniformState.view;
                var plane = Plane.fromCartesian4(primitive._southPlane, scratchPlane);
                plane = Plane.transform(viewMatrix, plane);
                return cartesian4FromPlane(plane, transformedPlaneCart4Scratch);
            }
        };
    }

    function getRenderState(mask3DTiles) {
        return RenderState.fromCache({
            cull : {
                enabled : true // prevent double-draw. Geometry is "inverted" (reversed winding order) so we're drawing backfaces.
            },
            blending : BlendingState.ALPHA_BLEND,
            depthMask : false,
            stencilTest : {
                enabled : mask3DTiles,
                frontFunction : StencilFunction.EQUAL,
                frontOperation : {
                    fail : StencilOperation.KEEP,
                    zFail : StencilOperation.KEEP,
                    zPass : StencilOperation.KEEP
                },
                backFunction : StencilFunction.EQUAL,
                backOperation : {
                    fail : StencilOperation.KEEP,
                    zFail : StencilOperation.KEEP,
                    zPass : StencilOperation.KEEP
                },
                reference : StencilConstants.CESIUM_3D_TILE_MASK,
                mask : StencilConstants.CESIUM_3D_TILE_MASK
            }
        });
    }

    function createRenderStates(primitive) {
        if (defined(primitive._rs)) {
            return;
        }

        primitive._rs = getRenderState(false);
        primitive._rs3DTiles = getRenderState(true);
    }

    function createShaders(primitive, context) {
        if (defined(primitive._sp)) {
            return;
        }

        var batchTable = primitive._batchTable;

        var vsSource = batchTable.getVertexShaderCallback(false, 'a_batchId', undefined)(Vector3DTileClampedPolylinesVS);
        var fsSource = batchTable.getFragmentShaderCallback()(Vector3DTileClampedPolylinesFS, false, undefined);

        var vs = new ShaderSource({
            defines : ['VECTOR_TILE'],
            sources : [vsSource]
        });
        var fs = new ShaderSource({
            defines : ['VECTOR_TILE'],
            sources : [fsSource]
        });

        primitive._sp = ShaderProgram.fromCache({
            context : context,
            vertexShaderSource : vs,
            fragmentShaderSource : fs,
            attributeLocations : attributeLocations
        });
    }

    function queueCommands(primitive, frameState) {
        var command = primitive._command;
        if (!defined(primitive._command)) {
            var uniformMap = primitive._batchTable.getUniformMapCallback()(primitive._uniformMap);
            command = primitive._command = new DrawCommand({
                owner : primitive,
                vertexArray : primitive._va,
                renderState : primitive._rs,
                shaderProgram : primitive._sp,
                uniformMap : uniformMap,
                boundingVolume : primitive._boundingVolume,
                pass : Pass.TERRAIN_CLASSIFICATION,
                pickId : primitive._batchTable.getPickId()
            });

            var derivedTilesetCommand = DrawCommand.shallowClone(command, command.derivedCommands.tileset);
            derivedTilesetCommand.renderState = primitive._rs3DTiles;
            derivedTilesetCommand.pass = Pass.CESIUM_3D_TILE_CLASSIFICATION;
            command.derivedCommands.tileset = derivedTilesetCommand;
        }

        var classificationType = primitive._tileset.classificationType;
        if (classificationType === ClassificationType.TERRAIN || classificationType === ClassificationType.BOTH) {
            frameState.commandList.push(command);
        }
        if (classificationType === ClassificationType.CESIUM_3D_TILE || classificationType === ClassificationType.BOTH) {
            frameState.commandList.push(command.derivedCommands.tileset);
        }
    }

    /**
     * Creates features for each polyline and places it at the batch id index of features.
     *
     * @param {Vector3DTileContent} content The vector tile content.
     * @param {Cesium3DTileFeature[]} features An array of features where the polygon features will be placed.
     */
    Vector3DTileClampedPolylines.prototype.createFeatures = function(content, features) {
        var batchIds = this._batchIds;
        var length = batchIds.length;
        for (var i = 0; i < length; ++i) {
            var batchId = batchIds[i];
            features[batchId] = new Cesium3DTileFeature(content, batchId);
        }
    };

    /**
     * Colors the entire tile when enabled is true. The resulting color will be (polyline batch table color * color).
     *
     * @param {Boolean} enabled Whether to enable debug coloring.
     * @param {Color} color The debug color.
     */
    Vector3DTileClampedPolylines.prototype.applyDebugSettings = function(enabled, color) {
        this._highlightColor = enabled ? color : this._constantColor;
    };

    function clearStyle(polygons, features) {
        var batchIds = polygons._batchIds;
        var length = batchIds.length;
        for (var i = 0; i < length; ++i) {
            var batchId = batchIds[i];
            var feature = features[batchId];

            feature.show = true;
            feature.color = Color.WHITE;
        }
    }

    var scratchColor = new Color();

    var DEFAULT_COLOR_VALUE = Color.WHITE;
    var DEFAULT_SHOW_VALUE = true;

    /**
     * Apply a style to the content.
     *
     * @param {Cesium3DTileStyle} style The style.
     * @param {Cesium3DTileFeature[]} features The dictionary of features.
     */
    Vector3DTileClampedPolylines.prototype.applyStyle = function(style, features) {
        if (!defined(style)) {
            clearStyle(this, features);
            return;
        }

        var batchIds = this._batchIds;
        var length = batchIds.length;
        for (var i = 0; i < length; ++i) {
            var batchId = batchIds[i];
            var feature = features[batchId];

            feature.color = defined(style.color) ? style.color.evaluateColor(feature, scratchColor) : DEFAULT_COLOR_VALUE;
            feature.show = defined(style.show) ? style.show.evaluate(feature) : DEFAULT_SHOW_VALUE;
        }
    };

    /**
     * Updates the batches and queues the commands for rendering.
     *
     * @param {FrameState} frameState The current frame state.
     */
    Vector3DTileClampedPolylines.prototype.update = function(frameState) {
        var context = frameState.context;

        createVertexArray(this, context);
        createUniformMap(this, context);
        createShaders(this, context);
        createRenderStates(this);

        if (!this._ready) {
            return;
        }

        var passes = frameState.passes;
        if (passes.render || passes.pick) {
            queueCommands(this, frameState);
        }
    };

    /**
     * Returns true if this object was destroyed; otherwise, false.
     * <p>
     * If this object was destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.
     * </p>
     *
     * @returns {Boolean} <code>true</code> if this object was destroyed; otherwise, <code>false</code>.
     */
    Vector3DTileClampedPolylines.prototype.isDestroyed = function() {
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
     */
    Vector3DTileClampedPolylines.prototype.destroy = function() {
        this._va = this._va && this._va.destroy();
        this._sp = this._sp && this._sp.destroy();
        this._lineSegmentTableTexture = this._lineSegmentTableTexture && this._lineSegmentTableTexture.destroy();
        return destroyObject(this);
    };

    return Vector3DTileClampedPolylines;
});
