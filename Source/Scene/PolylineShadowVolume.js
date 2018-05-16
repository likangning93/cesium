define([
    '../Core/BoundingSphere',
    '../Core/Cartesian2',
    '../Core/Cartesian3',
    '../Core/Cartographic',
    '../Core/Math',
    '../Core/ComponentDatatype',
    '../Core/defined',
    '../Core/EncodedCartesian3',
    '../Core/Geometry',
    '../Core/GeometryAttribute',
    '../Core/GeometryAttributes',
    '../Core/GeometryInstance',
    '../Core/GeometryInstanceAttribute',
    '../Core/Matrix3',
    '../Core/Quaternion',
    '../Core/WebGLConstants',
    '../Shaders/PolylineShadowVolumeVS',
    '../Shaders/PolylineShadowVolumeFS',
    '../Renderer/RenderState',
    './BlendingState',
    './MaterialAppearance',
    './Primitive'
], function(
    BoundingSphere,
    Cartesian2,
    Cartesian3,
    Cartographic,
    CesiumMath,
    ComponentDatatype,
    defined,
    EncodedCartesian3,
    Geometry,
    GeometryAttribute,
    GeometryAttributes,
    GeometryInstance,
    GeometryInstanceAttribute,
    Matrix3,
    Quaternion,
    WebGLConstants,
    PolylineShadowVolumeVS,
    PolylineShadowVolumeFS,
    RenderState,
    BlendingState,
    MaterialAppearance,
    Primitive
) {
    'use strict';

    var MITER_BREAK = Math.cos(CesiumMath.toRadians(30));

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

    var encodeScratch = new EncodedCartesian3();
    var offsetScratch = new Cartesian3();
    var normal1Scratch = new Cartesian3();
    var normal2Scratch = new Cartesian3();
    var rightScratch = new Cartesian3();
    // Computing whether or not a fragment is part of the line requires:
    // - plane at the beginning of the segment
    // - plane at the end of the segment
    // - right plane for the segment (compute in VS)
    function getAttributes(startCartesianLow, endCartesianLow, startCartesianHigh, endCartesianHigh,
        startCartesianLeftNormal, endCartesianLeftNormal,
        lengthSoFar, segmentLength, totalLength) {
        var encodedStart = EncodedCartesian3.fromCartesian(startCartesianLow, encodeScratch);

        var forwardOffset = Cartesian3.subtract(endCartesianLow, startCartesianLow, offsetScratch);

        var startHi_and_forwardOffsetX_Attribute = new GeometryInstanceAttribute({
            componentDatatype: ComponentDatatype.FLOAT,
            componentsPerAttribute: 4,
            normalize: false,
            value : Cartesian3.pack(encodedStart.high, [0, 0, 0, forwardOffset.x])
        });

        var startLo_and_forwardOffsetY_Attribute = new GeometryInstanceAttribute({
            componentDatatype: ComponentDatatype.FLOAT,
            componentsPerAttribute: 4,
            normalize: false,
            value : Cartesian3.pack(encodedStart.low, [0, 0, 0, forwardOffset.y])
        });

        var arr = [0, 0, 0, forwardOffset.z];
        var forward = Cartesian3.normalize(forwardOffset, forwardOffset);

        var startUp = Cartesian3.subtract(startCartesianHigh, startCartesianLow, normal1Scratch);
        startUp = Cartesian3.normalize(startUp, startUp);

        var right = Cartesian3.cross(forward, startUp, rightScratch);
        right = Cartesian3.normalize(right, right);

        var rightNormal_attribute = new GeometryInstanceAttribute({
            componentDatatype: ComponentDatatype.FLOAT,
            componentsPerAttribute: 3,
            normalize: false,
            value : Cartesian3.pack(right, [0, 0, 0])
        });

        var startNormal = Cartesian3.cross(startUp, startCartesianLeftNormal, normal1Scratch);
        startNormal = Cartesian3.normalize(startNormal, startNormal);

        // Plane normals will be almost antiparallel, and start plane normal will be very similar to normalize(endLow - startLow).
        // This makes computing the segment's right vector less accurate, especially on the GPU in eyespace.
        // So pass "up" in the start plane instead of start plane normal.
        var startNormal_and_forwardOffsetZ_attribute = new GeometryInstanceAttribute({
            componentDatatype: ComponentDatatype.FLOAT,
            componentsPerAttribute: 4,
            normalize: false,
            value : Cartesian3.pack(startNormal, arr)
        });

        var endUp = Cartesian3.subtract(endCartesianHigh, endCartesianLow, normal2Scratch);
        endUp = Cartesian3.normalize(endUp, endUp);
        var endNormal = Cartesian3.cross(endCartesianLeftNormal, endUp, normal2Scratch);
        endNormal = Cartesian3.normalize(endNormal, endNormal);

        var endNormal_attribute = new GeometryInstanceAttribute({
            componentDatatype: ComponentDatatype.FLOAT,
            componentsPerAttribute: 3,
            normalize: false,
            value : Cartesian3.pack(endNormal, [0, 0, 0])
        });

        // Texture coordinate localization params
        var texcoordNormalization_attribute = new GeometryInstanceAttribute({
            componentDatatype: ComponentDatatype.FLOAT,
            componentsPerAttribute: 3,
            normalize: false,
            value : [lengthSoFar, segmentLength, totalLength]
        });

        return {
            startHi_and_forwardOffsetX : startHi_and_forwardOffsetX_Attribute,
            startLo_and_forwardOffsetY : startLo_and_forwardOffsetY_Attribute,
            startNormal_and_forwardOffsetZ : startNormal_and_forwardOffsetZ_attribute,
            endNormal : endNormal_attribute,
            rightNormal : rightNormal_attribute,
            texcoordNormalization : texcoordNormalization_attribute
        };
    }

    var miterCartesianScratch = new Cartesian3();
    var lineDirectionScratch = new Cartesian3();
    var normal0RightScratch = new Cartesian3();
    var normal1RightScratch = new Cartesian3();
    var positionsScratch = [new Cartesian3(), new Cartesian3(), new Cartesian3(), new Cartesian3()];
    var matrix3Scratch = new Matrix3();
    var quaternionScratch = new Quaternion();
    var normalUpScratch = new Cartesian3();
    function createWallSegment(ellipsoid, start, end, minimumHeight, maximumHeight, preStart, postEnd, lengthSoFar, segmentLength, totalLength) {
        // Compute positions for the wall.
        var minPosition0 = getPosition(ellipsoid, start, minimumHeight, positionsScratch[0]);
        var minPosition1 = getPosition(ellipsoid, end,   minimumHeight, positionsScratch[1]);
        var maxPosition0 = getPosition(ellipsoid, start, maximumHeight, positionsScratch[2]);
        var maxPosition1 = getPosition(ellipsoid, end,   maximumHeight, positionsScratch[3]);

        // Compute normals that will approximately work for mitering
        var normal0Right = normal0RightScratch;
        var normal1Right = normal1RightScratch;

        var out;
        var normalUp;
        var quaternion;
        var rotationMatrix;

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

            // If the angle between preStart and line direction is too acute,
            // break the miter by rotating the normal 90 degrees.
            if (Cartesian3.dot(lineDirection, preStartDirection) > MITER_BREAK) {
                normalUp = Cartesian3.cross(lineDirection, preStartDirection, normalUpScratch);
                quaternion = Quaternion.fromAxisAngle(normalUp, CesiumMath.PI_OVER_TWO, quaternionScratch);
                rotationMatrix = Matrix3.fromQuaternion(quaternion, matrix3Scratch);
                normal0Right = Matrix3.multiplyByVector(rotationMatrix, normal0Right, normal0Right);
            }

            // Flip the normal to face the correct direction
            if (rightHanded(start, end, preStart, start)) {
                normal0Right = Cartesian3.multiplyByScalar(normal0Right, -1.0, normal0Right);
            }
        } else {
            // If no preStart is given or preStart is colinear,
            // push the normal out at 90 degrees from the direction but roughly tangent to the ellipsoid
            out = Cartesian3.normalize(minPosition0, miterCartesianScratch);
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

            // If the angle between line direction and postEnd is too acute,
            // break the miter by rotating the normal 90 degrees.
            if (Cartesian3.dot(lineDirection, postEndDirection) > MITER_BREAK) {
                normalUp = Cartesian3.cross(lineDirection, postEndDirection, normalUpScratch);
                quaternion = Quaternion.fromAxisAngle(normalUp, CesiumMath.PI_OVER_TWO, quaternionScratch);
                rotationMatrix = Matrix3.fromQuaternion(quaternion, matrix3Scratch);
                normal1Right = Matrix3.multiplyByVector(rotationMatrix, normal1Right, normal1Right);
            }

            // Flip the normal to face the correct direction
            if (rightHanded(start, end, end, postEnd)) {
                normal1Right = Cartesian3.multiplyByScalar(normal1Right, -1.0, normal1Right);
            }
        } else {
            // If no preStart is given or preStart is colinear,
            // push the normal out at 90 degrees from the direction but roughly tangent to the ellipsoid
            out = Cartesian3.normalize(minPosition1, miterCartesianScratch);
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

        // debug - for checking mitering stuff, normals
        for (var i = 0; i < 24; i++) {
            //positions[i] += normals[i] * 100.0;
        }

        var indices = [
            0, 1, 2, 0, 2, 3, // right
            0, 3, 7, 0, 7, 4, // start
            0, 4, 5, 0, 5, 1, // bottom
            5, 4, 7, 5, 7, 6, // left
            5, 6, 2, 5, 2, 1, // end
            3, 2, 6, 3, 6, 7 // top
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

        var geometry = new Geometry({
            attributes : geometryAttributes,
            indices : new Uint16Array(indices),
            boundingSphere : BoundingSphere.fromPoints(positionsScratch)
        });

        return new GeometryInstance({
            geometry : geometry,
            attributes : getAttributes(minPosition0, minPosition1, maxPosition0, maxPosition1, normal0Left, normal1Left, lengthSoFar, segmentLength, totalLength)
        });
    }

    function PolylineShadowVolume() {}

    var worldStartScratch = new Cartesian3();
    var worldEndScratch = new Cartesian3();
    function createGeometryInstances(ellipsoid, cartographics) {
        var cartoCount = cartographics.length;
        var geometryInstances = [];
        var i;
        var worldStart;
        var worldEnd;

        // Compute total length in cartesian space
        var totalLength = 0.0;
        for (i = 0; i < cartoCount - 1; i++) {
            worldStart = Cartographic.toCartesian(cartographics[i], ellipsoid, worldStartScratch);
            worldEnd = Cartographic.toCartesian(cartographics[i + 1], ellipsoid, worldEndScratch);
            totalLength += Cartesian3.distance(worldStart, worldEnd);
        }

        var lengthSoFar = 0.0;
        for (i = 0; i < cartoCount - 1; i++) {
            worldStart = Cartographic.toCartesian(cartographics[i], ellipsoid, worldStartScratch);
            worldEnd = Cartographic.toCartesian(cartographics[i + 1], ellipsoid, worldEndScratch);
            var segmentLength = Cartesian3.distance(worldStart, worldEnd);

            var cartoStart = cartographics[i];
            var cartoEnd = cartographics[i + 1];
            var preStart;
            var postEnd;
            if (i > 0) {
                preStart = cartographics[i - 1];
            }
            if (i + 2 < cartoCount) {
                postEnd = cartographics[i + 2];
            }
            var minimumHeight = -10.0;//-4000.0;// 100000.0;// -i * 10000.0;
            var maximumHeight = 4000;// (i + 1) * 20000.0;
            geometryInstances.push(createWallSegment(ellipsoid, cartoStart, cartoEnd, minimumHeight, maximumHeight, preStart, postEnd, lengthSoFar, segmentLength, totalLength));

            lengthSoFar += segmentLength;
        }
        return geometryInstances;
    }

    PolylineShadowVolume._createGeometryInstances = function(ellipsoid, cartographics) {
        return createGeometryInstances(ellipsoid, cartographics);
    };

    function getColorRenderState() {
        return {
            depthTest : {
                enabled : false // Helps prevent problems when viewing very closely
            }
            //depthMask : false, // ?
            //blending : BlendingState.ALPHA_BLEND // ?
        };
    }

    PolylineShadowVolume.getPrimitive = function(ellipsoid, cartographics, polylineMaterial) {
        var geometryInstances = createGeometryInstances(ellipsoid, cartographics);
        var material = new MaterialAppearance({
            flat : true,
            translucent : true,
            closed : false,
            materialSupport : MaterialAppearance.MaterialSupport.BASIC,
            vertexShaderSource : PolylineShadowVolumeVS,
            fragmentShaderSource : PolylineShadowVolumeFS,
            material : polylineMaterial,
            renderState : RenderState.fromCache(getColorRenderState())
        });

        return new Primitive({
            geometryInstances : geometryInstances,
            appearance : material,
            asynchronous : false,
            compressVertices : false // otherwise normals will be weird
        });
    };

    return PolylineShadowVolume;
});
