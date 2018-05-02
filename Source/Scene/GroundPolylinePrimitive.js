define([
    '../Core/BoundingSphere',
    '../Core/Cartesian2',
    '../Core/Cartesian3',
    '../Core/Cartographic',
    '../Core/Math',
    '../Core/ComponentDatatype',
    '../Core/defined',
    '../Core/Geometry',
    '../Core/GeometryAttribute',
    '../Core/GeometryAttributes'
], function(
    BoundingSphere,
    Cartesian2,
    Cartesian3,
    Cartographic,
    CesiumMath,
    ComponentDatatype,
    defined,
    Geometry,
    GeometryAttribute,
    GeometryAttributes
) {
    'use strict';

    function pointLineDistance2D(start, end, point) {
        var denominator = Cartesian2.distance(start, end);
        return Math.abs((end.y - start.y) * point.x - (end.x - start.x) * point.y + end.x * start.y - end.y * start.x) / denominator;
    }

    var direction1Scratch = new Cartesian3();
    var direction2Scratch = new Cartesian3();
    var handednessScratch = new Cartesian3();
    function rightHanded(start1, end1, start2, end2) { // return true if the vector formed by start2 -> end2 crossed with start1 -> end1 is Z-up
        var direction1 = direction1Scratch;
        var direction2 = direction2Scratch;
        direction1.x = end1.longitude - start1.longitude;
        direction1.y = end1.latitude - start1.latitude;
        direction2.x = end2.longitude - start2.longitude;
        direction2.y = end2.latitude - start2.latitude;
        var handedness = Cartesian3.cross(direction2, direction1, handednessScratch);
        return handedness.z > 0.0;
    }

    var startScratch = new Cartesian2();
    var endScratch = new Cartesian2();
    var pointScratch = new Cartesian2();
    function approximatelyColinear(start, end, cartographic) {
        startScratch.x = start.latitude;
        startScratch.y = start.longitude;
        endScratch.x = end.latitude;
        endScratch.y = end.longitude;
        pointScratch.x = cartographic.latitude;
        pointScratch.y = cartographic.longitude;
        var distanceToLine = pointLineDistance2D(startScratch, endScratch, pointScratch);
        return CesiumMath.equalsEpsilon(distanceToLine, 0.0, CesiumMath.EPSILON7);
    }

    var projectingCartographicScratch = new Cartographic();
    function getPosition(ellipsoid, cartographic, height, result) {
        var projectingCarto = Cartographic.clone(cartographic, projectingCartographicScratch);
        projectingCarto.height = height;
        return ellipsoid.cartographicToCartesian(projectingCarto, result);
    }

    var miterCartesianScratch = new Cartesian3();
    var lineDirectionScratch = new Cartesian3();
    var normal0RightScratch = new Cartesian3();
    var normal1RightScratch = new Cartesian3();
    var positionsScratch = [new Cartesian3(), new Cartesian3(), new Cartesian3(), new Cartesian3()];
    function createWallSegment(ellipsoid, start, end, minimumHeight, maximumHeight, preStart, postEnd) {
        // Compute positions for the wall.
        var minPosition0 = getPosition(ellipsoid, start, minimumHeight, positionsScratch[0]);
        var minPosition1 = getPosition(ellipsoid, end,   minimumHeight, positionsScratch[1]);
        var maxPosition0 = getPosition(ellipsoid, start, maximumHeight, positionsScratch[2]);
        var maxPosition1 = getPosition(ellipsoid, end,   maximumHeight, positionsScratch[3]);

        // Compute normals that will approximately work for mitering
        var normal0Right = normal0RightScratch;
        var normal1Right = normal1RightScratch;

        var lineDirection = Cartesian3.subtract(minPosition1, minPosition0, lineDirectionScratch);
        lineDirection = Cartesian3.normalize(lineDirection, lineDirection);
        if (defined(preStart) && !approximatelyColinear(start, end, preStart)) {
            // Average directions from (start to end) and (start to preStart) to compute a miter vector.
            // In theory this won't perfectly match the adjacent segments because their heights will be different,
            // but in practice it should be sufficient.
            var preStartPosition = getPosition(ellipsoid, preStart, minimumHeight, miterCartesianScratch);
            var preStartDirection = Cartesian3.subtract(preStartPosition, minPosition0, miterCartesianScratch);
            preStartDirection = Cartesian3.normalize(preStartDirection, preStartDirection);
            normal0Right = Cartesian3.add(preStartDirection, lineDirection, normal0Right);
            normal0Right = Cartesian3.multiplyByScalar(normal0Right, -0.5, normal0Right);

            normal0Right = Cartesian3.normalize(normal0Right, normal0Right);
            if (rightHanded(start, end, preStart, start)) {
                normal0Right = Cartesian3.multiplyByScalar(normal0Right, -1.0, normal0Right);
            }
        } else {
            // If no preStart is given or preStart is colinear,
            // push the normal out at 90 degrees from the direction but roughly tangent to the ellipsoid
            var out = Cartesian3.normalize(minPosition0, miterCartesianScratch);
            Cartesian3.normalize(out, out);
            Cartesian3.cross(out, lineDirection, normal0Right);
            normal0Right = Cartesian3.normalize(normal0Right, normal0Right);
        }

        if (defined(postEnd) && !approximatelyColinear(start, end, postEnd)) {
            // Average directions from (start to end) and (postEnd to end) to compute a miter vector.
            var postEndPosition = getPosition(ellipsoid, postEnd, minimumHeight, miterCartesianScratch);
            var postEndDirection = Cartesian3.subtract(minPosition1, postEndPosition, miterCartesianScratch);
            postEndDirection = Cartesian3.normalize(postEndDirection, postEndDirection);
            normal1Right = Cartesian3.add(postEndDirection, lineDirection, normal1Right);
            normal1Right = Cartesian3.multiplyByScalar(normal1Right, -0.5, normal1Right);

            normal1Right = Cartesian3.normalize(normal1Right, normal1Right);
            if (rightHanded(start, end, end, postEnd)) {
                normal0Right = Cartesian3.multiplyByScalar(normal0Right, -1.0, normal0Right);
            }
        } else {
            // If no preStart is given or preStart is colinear,
            // push the normal out at 90 degrees from the direction but roughly tangent to the ellipsoid
            var out = Cartesian3.normalize(minPosition1, miterCartesianScratch);
            Cartesian3.normalize(out, out);
            Cartesian3.cross(out, lineDirection, normal1Right);
            normal1Right = Cartesian3.normalize(normal1Right, normal1Right);
        }

        // Create a geometry, whoop whoop!
        var positions = new Float64Array(24); // 8 vertices
        var normals = new Float32Array(24);

        Cartesian3.pack(minPosition0, positions, 0);
        Cartesian3.pack(minPosition1, positions, 1 * 3);
        Cartesian3.pack(maxPosition1, positions, 2 * 3);
        Cartesian3.pack(maxPosition0, positions, 3 * 3);

        Cartesian3.pack(minPosition0, positions, 4 * 3);
        Cartesian3.pack(minPosition1, positions, 5 * 3);
        Cartesian3.pack(maxPosition1, positions, 6 * 3);
        Cartesian3.pack(maxPosition0, positions, 7 * 3);

        Cartesian3.pack(normal0Right, normals, 0);
        Cartesian3.pack(normal1Right, normals, 1 * 3);
        Cartesian3.pack(normal1Right, normals, 2 * 3);
        Cartesian3.pack(normal0Right, normals, 3 * 3);

        var normal0Left = Cartesian3.multiplyByScalar(normal0Right, -1.0, normal0Right);
        var normal1Left = Cartesian3.multiplyByScalar(normal1Right, -1.0, normal1Right);
        Cartesian3.pack(normal0Left, normals, 4 * 3);
        Cartesian3.pack(normal1Left, normals, 5 * 3);
        Cartesian3.pack(normal1Left, normals, 6 * 3);
        Cartesian3.pack(normal0Left, normals, 7 * 3);

        // debug - check mitering stuff
        for (var i = 0; i < 24; i++) {
            positions[i] += normals[i] * 10000.0;
        }

        var indices = [
            0, 1, 2, 0, 2, 3,
            0, 3, 7, 0, 7, 4,
            0, 4, 5, 0, 5, 1,
            5, 4, 7, 5, 7, 6,
            5, 6, 2, 5, 2, 1,
            3, 2, 6, 3, 6, 7
        ];
        var geometryAttributes = new GeometryAttributes({
            position : new GeometryAttribute({
                componentDatatype : ComponentDatatype.DOUBLE,
                componentsPerAttribute : 3,
                normalize : false,
                values : positions
            }),
            normal : new GeometryAttribute({
                componentDatatype : ComponentDatatype.FLOAT,
                componentsPerAttribute : 3,
                normalize : true,
                values : normals
            })
        });

        return new Geometry({
            attributes : geometryAttributes,
            indices : new Uint16Array(indices),
            boundingSphere : BoundingSphere.fromPoints(positionsScratch)
        });
    }

    function GroundPolylinePrimitive() {

    }

    GroundPolylinePrimitive._createGeometries = function(ellipsoid, cartographics) {
        var cartoCount = cartographics.length;
        var geometries = [];
        for (var i = 0; i < cartoCount - 1; i++) {
            var start = cartographics[i];
            var end = cartographics[i + 1];
            var preStart = undefined;
            var postEnd = undefined;
            if (i > 0) {
                preStart = cartographics[i - 1];
            }
            if (i + 2 < cartoCount) {
                postEnd = cartographics[i + 2];
            }
            var minimumHeight = -i;
            var maximumHeight = (i + 1) * 20000.0;
            geometries.push(createWallSegment(ellipsoid, start, end, minimumHeight, maximumHeight, preStart, postEnd));
        }
        return geometries;
    };

    /**
     * Create Geometry for a mitered wall formed from the given line segment.
     * If preStart and postEnd are not provided, the wall segment will end without mitering.
     * Provide normals such that the wall's thickness can be modulated by pushing positions along the normals.
     *
     * Exposed for testing.
     *
     * @param {Ellipsoid} ellipsoid
     * @param {Cartographic} start
     * @param {Cartographic} end
     * @param {Number} minimumHeight
     * @param {Number} maximumHeight
     * @param {Cartographic} [preStart]
     * @param {Cartographic} [postEnd]
     * @private
     */
    GroundPolylinePrimitive._createWallSegment = function(ellipsoid, start, end, minimumHeight, maximumHeight, preStart, postEnd) {
        return createWallSegment(ellipsoid, start, end, minimumHeight, maximumHeight, preStart, postEnd);
    };

    return GroundPolylinePrimitive;
});
