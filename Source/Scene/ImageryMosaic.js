define([
        '../Core/Cartesian2',
        '../Core/Cartesian3',
        '../Core/Cartesian4',
        '../Core/Cartographic',
        '../Core/Math',
        '../Core/Check',
        '../Core/Color',
        '../Core/Credit',
        '../Core/defaultValue',
        '../Core/defined',
        '../Core/defineProperties',
        '../Core/DeveloperError',
        '../Core/FeatureDetection',
        '../Core/getAbsoluteUri',
        '../Core/Matrix4',
        '../Core/IntersectionTests',
        '../Core/Plane',
        '../Core/Rectangle',
        '../Core/Ray',
        '../Core/TaskProcessor',
        '../Core/SerializedMapProjection',
        '../ThirdParty/when',
        './BitmapImageryProvider',
        './ImageryLayer',
        './SceneMode'
    ], function(
        Cartesian2,
        Cartesian3,
        Cartesian4,
        Cartographic,
        CesiumMath,
        Check,
        Color,
        Credit,
        defaultValue,
        defined,
        defineProperties,
        DeveloperError,
        FeatureDetection,
        getAbsoluteUri,
        Matrix4,
        IntersectionTests,
        Plane,
        Rectangle,
        Ray,
        TaskProcessor,
        SerializedMapProjection,
        when,
        BitmapImageryProvider,
        ImageryLayer,
        SceneMode) {
    'use strict';

    var insetWaitFrames = 3;
    /**
     * Manages imagery layers for asynchronous pixel-perfect imagery reprojection.
     * TODO: only available in Chrome 69+, support coming for Firefox: https://bugzilla.mozilla.org/show_bug.cgi?id=801176
     *
     * @alias ImageryMosaic
     * @constructor
     *
     * @param {Object} options Object with the following properties:
     * @param {String[]} options.urls the url for the imagery sources.
     * // TODO: add optional parallel list of IDs for Z order and show/hide
     * @param {Rectangle[]} options.projectedRectangles The rectangles covered by the images in their source Spatial Reference Systems
     * @param {MapProjection[]} options.projections The map projections for each image.
     * @param {Credit|String} [options.credit] A credit for all the images, which is displayed on the canvas.
     * @param {Scene} options.scene The current Cesium scene.
     * @param {Number} [options.concurrency=4] The number of web workers across which the load should be distributed.
     * @param {Number} [options.imageCacheSize=100] Number of cached images to hold in memory at once
     */
    function ImageryMosaic(options, viewer) {
        if (!FeatureDetection.isChrome() || FeatureDetection.chromeVersion()[0] < 69) {
            throw new DeveloperError('ImageryMosaic is only supported in Chrome version 69 or later.');
        }

        //>>includeStart('debug', pragmas.debug);
        Check.defined('options', options);
        Check.defined('options.urls', options.urls);
        Check.defined('options.projectedRectangles', options.projectedRectangles);
        Check.defined('options.projections', options.projections);
        Check.defined('options.scene', options.scene);
        //>>includeEnd('debug');

        var urls = options.urls;
        var projectedRectangles = options.projectedRectangles;
        var projections = options.projections;

        var imagesLength = urls.length;

        // Make URLs absolute, serialize projections
        var absoluteUrls = new Array(imagesLength);
        var serializedMapProjections = new Array(imagesLength);
        var i;
        for (i = 0; i < imagesLength; i++) {
            absoluteUrls[i] = getAbsoluteUri(urls[i]);
            serializedMapProjections[i] = new SerializedMapProjection(projections[i]);
        }

        this._projectedRectangles = projectedRectangles;
        this._projections = projections;
        this._urls = absoluteUrls;

        var credit = options.credit;
        var scene = options.scene;

        if (typeof credit === 'string') {
            credit = new Credit(credit);
        }
        this._credit = credit;
        this._rectangle = new Rectangle();

        var concurrency = defaultValue(options.concurrency, 2);
        var taskProcessors = new Array(concurrency);
        for (i = 0; i < concurrency; i++) {
            taskProcessors[i] = new TaskProcessor('createReprojectedImagery');
        }
        this._taskProcessors = taskProcessors;

        this._localRenderingBounds = new Rectangle();

        this._fullCoverageImageryLayer = undefined;
        this._localImageryLayer = undefined;
        this._reprojectionPromise = undefined;
        this._iteration = 0;

        this._freeze = false;

        this._scene = scene;

        this._waitedFrames = 0;

        this._entityCollection = viewer.entities;

        this._boundsRectangle = undefined;
        this._debugShowBoundsRectangle = false;

        var longitudeSamplingResolution = 20;
        var latitudeSamplingResolution = 20;
        var samplePointsCount = longitudeSamplingResolution * latitudeSamplingResolution;
        var samplePoints2D = new Array(samplePointsCount); // TODO: maybe resolution should be configurable?
        var samplePoints3D = new Array(samplePointsCount);
        var samplePointsSurfaceNormals = new Array(samplePointsCount);
        var samplePointsCartographic = new Array(samplePointsCount);

        for (i = 0; i < samplePointsCount; i++) {
            samplePoints2D[i] = new Cartesian3();
            samplePoints3D[i] = new Cartesian3();
            samplePointsSurfaceNormals[i] = new Cartesian3();
            samplePointsCartographic[i] = new Cartographic();
        }

        this._samplePoints2D = samplePoints2D;
        this._samplePoints3D = samplePoints3D;
        this._samplePointsSurfaceNormals = samplePointsSurfaceNormals;
        this._samplePointsCartographic = samplePointsCartographic;

        var that = this;

        var urlGroups = new Array(concurrency);
        var serializedProjectionGroups = new Array(concurrency);
        var projectedRectangleGroups = new Array(concurrency);

        for (i = 0; i < concurrency; i++) {
            urlGroups[i] = [];
            serializedProjectionGroups[i] = [];
            projectedRectangleGroups[i] = [];
        }

        for (i = 0; i < imagesLength; i++) {
            var index = i % concurrency;
            urlGroups[index].push(absoluteUrls[i]);
            serializedProjectionGroups[index].push(serializedMapProjections[i]);
            projectedRectangleGroups[index].push(projectedRectangles[i]);
        }

        var initializationPromises = new Array(concurrency);
        for (i = 0; i < concurrency; i++) {
            initializationPromises[i] = taskProcessors[i].scheduleTask({
                initialize : true,
                urls : urlGroups[i],
                serializedMapProjections : serializedProjectionGroups[i],
                projectedRectangles : projectedRectangleGroups[i],
                imageCacheSize : defaultValue(options.imageCacheSize, 100)
            });
        }

        this.readyPromise = when.all(initializationPromises)
            .then(function(rectangles) {
                // Merge rectangles
                var thatRectangle = Rectangle.clone(rectangles[0], that._rectangle);
                for (var i = 1; i < concurrency; i++) {
                    var rectangle = rectangles[i];
                    thatRectangle.east = Math.max(thatRectangle.east, rectangle.east);
                    thatRectangle.west = Math.min(thatRectangle.west, rectangle.west);
                    thatRectangle.north = Math.max(thatRectangle.north, rectangle.north);
                    thatRectangle.south = Math.min(thatRectangle.south, rectangle.south);
                }
                that._rectangle = thatRectangle;

                // Compute points in a grid over the total mosaic area
                var projection = viewer.scene.mapProjection;
                var ellipsoid = projection.ellipsoid;
                var west = thatRectangle.west;
                var south = thatRectangle.south;
                var longitudeStep = thatRectangle.width / (longitudeSamplingResolution - 1);
                var latitudeStep = thatRectangle.height / (latitudeSamplingResolution - 1);

                for (var latIndex = 0; latIndex < latitudeSamplingResolution; latIndex++) {
                    for (var longIndex = 0; longIndex < longitudeSamplingResolution; longIndex++) {
                        var pointIndex = latIndex * longitudeSamplingResolution + longIndex;
                        var samplePointCartographic = samplePointsCartographic[pointIndex];
                        samplePointCartographic.longitude = west + longIndex * longitudeStep;
                        samplePointCartographic.latitude = south + latIndex * latitudeStep;
                        projection.project(samplePointCartographic, samplePoints2D[pointIndex]);
                        ellipsoid.cartographicToCartesian(samplePointCartographic, samplePoints3D[pointIndex]);
                        ellipsoid.geodeticSurfaceNormalCartographic(samplePointCartographic, samplePointsSurfaceNormals[pointIndex]);
                    }
                }

                // Create the full-coverage version
                return requestProjection(taskProcessors, 1024, 1024, thatRectangle);
            })
            .then(function(reprojectedBitmap) {
                var bitmapImageryProvider = new BitmapImageryProvider({
                    bitmap : reprojectedBitmap,
                    rectangle : that._rectangle,
                    credit : that._credit
                });
                var imageryLayer = new ImageryLayer(bitmapImageryProvider, {rectangle : bitmapImageryProvider.rectangle});

                that._fullCoverageImageryLayer = imageryLayer;
                scene.imageryLayers.add(imageryLayer);
            })
            .then(function() {
                // Listen for camera changes
                scene.camera.moveEnd.addEventListener(function() {
                    if (that._freeze) {
                        return;
                    }
                    that.refresh(scene);
                });

                scene.postRender.addEventListener(function() {
                    if (that._waitedFrames < insetWaitFrames) {
                        that._waitedFrames++;
                        if (that._waitedFrames === insetWaitFrames) {
                            that._fullCoverageImageryLayer.cutoutRectangle = that._localRenderingBounds;
                        }
                    }
                });

                // Refresh now that we're loaded
                that.refresh(scene);
            })
            .otherwise(function(error) {
                console.log(error);
            });
    }

    defineProperties(ImageryMosaic.prototype, {
        freeze : {
            get: function() {
                return this._freeze;
            },
            set: function(value) {
                this._freeze = value;
                if (value === false) {
                    this.refresh(this._scene);
                }
            }
        },
        debugShowBoundsRectangle : {
            get: function() {
                return this._debugShowBoundsRectangle;
            },
            set: function(value) {
                if (value) {
                    this._debugShowBoundsRectangle = true;
                    if (defined(this._boundsRectangle)) {
                        this._boundsRectangle.show = true;
                    }
                } else {
                    this._debugShowBoundsRectangle = false;
                    if (defined(this._boundsRectangle)) {
                        this._boundsRectangle.show = false;
                    }
                }
            }
        }
    });

    ImageryMosaic.prototype.uploadImageToWorker = function(image) {
        // Read pixels and upload to web worker
        var canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        var context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        var imagedata = context.getImageData(0, 0, image.width, image.height);

        return this._taskProcessor.scheduleTask({
            upload : true,
            url : this._url,
            imageData : imagedata
        });
    };

    var samplePoint3Scratch = new Cartesian3();
    var surfaceNormalScratch = new Cartesian3();
    var cvPositionScratch = new Cartesian3();
    var samplePointCartographicScratch = new Cartographic();
    var autofocusPointScratch = new Cartesian2();
    var autofocusRayScratch = new Ray();
    var cvPlane = new Plane(Cartesian3.UNIT_X, 0.0);

    ImageryMosaic.prototype.refresh = function(scene) {

        // Compute an approximate geographic rectangle that we're rendering
        var quadtreePrimitive = scene.globe._surface;
        var quadtreeTilesToRender = quadtreePrimitive._tilesToRender;
        var quadtreeTilesToRenderLength = quadtreeTilesToRender.length;
        if (quadtreeTilesToRenderLength < 1) {
            return;
        }

        var renderingBounds = new Rectangle(); // Create new to avoid race condition with in-flight refreshes
        renderingBounds.west = Number.POSITIVE_INFINITY;
        renderingBounds.east = Number.NEGATIVE_INFINITY;
        renderingBounds.south = Number.POSITIVE_INFINITY;
        renderingBounds.north = Number.NEGATIVE_INFINITY;

        // Just use quadtree tiles - bad at close views + horizon facing
        /*
        for (var i = 0; i < quadtreeTilesToRenderLength; i++) {
            var tileRectangle = quadtreeTilesToRender[i].rectangle;
            renderingBounds.west = Math.min(renderingBounds.west, tileRectangle.west);
            renderingBounds.east = Math.max(renderingBounds.east, tileRectangle.east);
            renderingBounds.south = Math.min(renderingBounds.south, tileRectangle.south);
            renderingBounds.north = Math.max(renderingBounds.north, tileRectangle.north);
        }*/

        // Use computeViewRectangle approximation - bad at horizon facing, possibly inaccurate in CV
        //scene.camera.computeViewRectangle(undefined, renderingBounds);

        // Use "autofocus points" against plane or ellipsoid - don't use scene picking, too slow
        var sqrtAfPoints = 10;
        var camera = scene.camera;
        var drawingBufferWidth = scene.drawingBufferWidth;
        var drawingBufferHeight = scene.drawingBufferHeight;
        var afWidthInterval = drawingBufferWidth / (sqrtAfPoints - 1);
        var afHeightInterval = drawingBufferHeight / (sqrtAfPoints - 1);
        var afPoint = autofocusPointScratch;

        var ellipsoid = scene.globe.ellipsoid;
        var mapProjection = scene.mapProjection;
        var viewProjection = scene.context.uniformState.viewProjection;
        var cameraPosition = scene.camera.positionWC;

        for (var y = 0; y < sqrtAfPoints; y++) {
            for (var x = 0; x < sqrtAfPoints; x++) {
                afPoint.x = x * afWidthInterval;
                afPoint.y = y * afHeightInterval;

                var autofocusRay = camera.getPickRay(afPoint, autofocusRayScratch);
                var intersectionCartographic;
                var samplePoint3 = samplePoint3Scratch;
                var surfaceNormal = surfaceNormalScratch;
                if (scene.mode === SceneMode.SCENE3D) {
                    var interval = IntersectionTests.rayEllipsoid(autofocusRay, ellipsoid);
                    if (!defined(interval)) {
                        continue;
                    }
                    Ray.getPoint(autofocusRay, interval.start, samplePoint3);
                    intersectionCartographic = ellipsoid.cartesianToCartographic(samplePoint3, samplePointCartographicScratch);
                    ellipsoid.geodeticSurfaceNormal(samplePoint3, surfaceNormal);
                } else {
                    IntersectionTests.rayPlane(autofocusRay, cvPlane, samplePoint3);
                    if (!defined(samplePoint3)) {
                        continue;
                    }
                    var cvPosition = cvPositionScratch;
                    cvPosition.x = samplePoint3.y;
                    cvPosition.y = samplePoint3.z;
                    cvPosition.z = samplePoint3.x;

                    intersectionCartographic = mapProjection.unproject(cvPosition, samplePointCartographicScratch);
                    surfaceNormal = Cartesian3.UNIT_X;
                }

                if (pointVisible(samplePoint3, viewProjection, cameraPosition, surfaceNormal)) {
                    renderingBounds.west = Math.min(renderingBounds.west, intersectionCartographic.longitude);
                    renderingBounds.east = Math.max(renderingBounds.east, intersectionCartographic.longitude);
                    renderingBounds.south = Math.min(renderingBounds.south, intersectionCartographic.latitude);
                    renderingBounds.north = Math.max(renderingBounds.north, intersectionCartographic.latitude);
                }
            }
        }

        // Use pre-sampled points - bad at close views
        /*
        // Compute an approximate geographic rectangle that we should render using the sample points we precomputed
        var renderingBounds = new Rectangle(); // Create new to avoid race condition with in-flight refreshes
        renderingBounds.west = Number.POSITIVE_INFINITY;
        renderingBounds.east = Number.NEGATIVE_INFINITY;
        renderingBounds.south = Number.POSITIVE_INFINITY;
        renderingBounds.north = Number.NEGATIVE_INFINITY;

        var samplePoints2D = this._samplePoints2D;
        var samplePoints3D = this._samplePoints3D;
        var surfaceNormals = this._samplePointsSurfaceNormals;
        var samplePointsCartographic = this._samplePointsCartographic;
        var samplePointsLength = samplePointsCartographic.length;
        var i;
        var viewProjection = scene.context.uniformState.viewProjection;
        var scene3D = scene.mode === SceneMode.SCENE3D;
        var cameraPosition = scene.camera.positionWC;
        var samplePoint3 = samplePoint3Scratch;
        for (i = 0; i < samplePointsLength; i++) {
            var samplePoint = scene3D ? samplePoints3D[i] : samplePoints2D[i];
            var surfaceNormal = scene3D ? surfaceNormals : Cartesian3.UNIT_X;
            samplePoint3.x = scene3D ? samplePoint.x : samplePoint.z;
            samplePoint3.y = scene3D ? samplePoint.y : samplePoint.x;
            samplePoint3.z = scene3D ? samplePoint.z : samplePoint.y;

            if (pointVisible(samplePoint3, viewProjection, cameraPosition, surfaceNormal)) {
                var cartographic = samplePointsCartographic[i];
                renderingBounds.west = Math.min(renderingBounds.west, cartographic.longitude);
                renderingBounds.east = Math.max(renderingBounds.east, cartographic.longitude);
                renderingBounds.south = Math.min(renderingBounds.south, cartographic.latitude);
                renderingBounds.north = Math.max(renderingBounds.north, cartographic.latitude);
            }
        }
*/
        var imageryBounds = this._rectangle;
        renderingBounds.west = Math.max(renderingBounds.west, imageryBounds.west);
        renderingBounds.east = Math.min(renderingBounds.east, imageryBounds.east);
        renderingBounds.south = Math.max(renderingBounds.south, imageryBounds.south);
        renderingBounds.north = Math.min(renderingBounds.north, imageryBounds.north);

        // Don't bother projecting if the view is out-of-bounds
        if (renderingBounds.north <= renderingBounds.south || renderingBounds.east <= renderingBounds.west) {
            return;
        }

        // Don't bother projecting if we're looking at the whole thing
        if (Rectangle.equals(renderingBounds, this._rectangle)) {
            return;
        }

        // Don't bother projecting if bounds haven't changed
        if (defined(this._localImageryLayer) && Rectangle.equals(renderingBounds, this._localRenderingBounds)) {
            return;
        }

        var that = this;
        this._iteration++;
        var iteration = this._iteration;

        if (defined(this._boundsRectangle)) {
            this._entityCollection.remove(this._boundsRectangle);
        }
        this._boundsRectangle = this._entityCollection.add({
            name : 'cutout',
            rectangle : {
                coordinates : renderingBounds,
                material : Color.WHITE.withAlpha(0.0),
                height : 10.0,
                outline : true,
                outlineWidth : 4.0,
                outlineColor : Color.WHITE
            },
            show : this._debugShowBoundsRectangle
        });

        requestProjection(this._taskProcessors, 1024, 1024, renderingBounds)
            .then(function(reprojectedBitmap) {
                if (that._iteration !== iteration) {
                    // cancel
                    return;
                }

                var bitmapImageryProvider = new BitmapImageryProvider({
                    bitmap : reprojectedBitmap,
                    rectangle : renderingBounds,
                    credit : that._credit
                });

                var newLocalImageryLayer = new ImageryLayer(bitmapImageryProvider, {rectangle : bitmapImageryProvider.rectangle});
                scene.imageryLayers.add(newLocalImageryLayer);

                if (defined(that._localImageryLayer)) {
                    scene.imageryLayers.remove(that._localImageryLayer);
                }
                that._localImageryLayer = newLocalImageryLayer;
                that._localRenderingBounds = Rectangle.clone(renderingBounds, that._localRenderingBounds);
                that._fullCoverageImageryLayer.cutoutRectangle = undefined;
                that._waitedFrames = 0;
            })
            .otherwise(function(e) {
                console.log(e); // TODO: handle or throw?
            });
    };

    var samplePointVec4Scratch = new Cartesian4();
    var cameraDirectionScratch = new Cartesian3();
    var maxCosineAngle = CesiumMath.toRadians(80);
    function pointVisible(samplePoint3, viewProjection, cameraPosition, surfaceNormal) {
        var samplePoint = samplePointVec4Scratch;
        samplePoint.x = samplePoint3.x;
        samplePoint.y = samplePoint3.y;
        samplePoint.z = samplePoint3.z;
        samplePoint.w = 1.0;

        Matrix4.multiplyByVector(viewProjection, samplePoint, samplePoint);
        var x = samplePoint.x / samplePoint.w;
        var y = samplePoint.y / samplePoint.w;
        var z = samplePoint.z / samplePoint.w;

        if (x < -1.0 || 1.0 < x || y < -1.0 || 1.0 < y || z < -1.0 || 1.0 < z) {
            return false;
        }

        var cameraDirection = Cartesian3.subtract(cameraPosition, samplePoint3, cameraDirectionScratch);
        Cartesian3.normalize(cameraDirection, cameraDirection);
        var cameraAngle = Math.acos(Cartesian3.dot(cameraDirection, surfaceNormal));

        return cameraAngle < maxCosineAngle; // TODO: do we need the acos here? something tells me no...
    }

    function requestProjection(taskProcessors, width, height, rectangle) {
        var concurrency = taskProcessors.length;
        var promises = new Array(concurrency);
        for (var i = 0; i < concurrency; i++) {
            promises[i] = taskProcessors[i].scheduleTask({
                reproject : true,
                width : width,
                height : height,
                rectangle : rectangle
            });
        }
        return when.all(promises)
            .then(function(bitmaps) {
                // alpha over
                var targetData = bitmaps[0].data;
                var pixelCount = width * height;
                for (var i = 1; i < concurrency; i++) {
                    var portionData = bitmaps[i].data;
                    for (var j = 0; j < pixelCount; j++) {
                        var index = j * 4;
                        var alpha = portionData[index + 3];
                        if (alpha > 0) {
                            targetData[index] = portionData[index];
                            targetData[index + 1] = portionData[index + 1];
                            targetData[index + 2] = portionData[index + 2];
                            targetData[index + 3] = alpha;
                        }
                    }
                }

                return bitmaps[0];
            });
    }

    return ImageryMosaic;
});
