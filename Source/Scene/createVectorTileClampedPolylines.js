define([
        '../Core/AttributeCompression',
        '../Core/Cartesian2',
        '../Core/Cartesian3',
        '../Core/Cartesian4',
        '../Core/Cartographic',
        '../Core/Ellipsoid',
        '../Core/IndexDatatype',
        '../Core/Math',
        '../Core/Matrix3',
        '../Core/OrientedBoundingBox',
        '../Core/Plane',
        '../Core/Rectangle',
        './createTaskProcessorWorker'
    ], function(
        AttributeCompression,
        Cartesian2,
        Cartesian3,
        Cartesian4,
        Cartographic,
        Ellipsoid,
        IndexDatatype,
        CesiumMath,
        Matrix3,
        OrientedBoundingBox,
        Plane,
        Rectangle,
        createTaskProcessorWorker) {
    'use strict';

    var cartesian4Scratch = new Cartesian4();
    function unpackCartesian4ToPlane(buffer, offset, result) {
        var unpacked = Cartesian4.unpack(buffer, offset, cartesian4Scratch);
        return Plane.fromCartesian4(unpacked, result);
    }

    var MAX_USHORT = 65535;
    var MAX_SHORT = 32767;
    var INVERSE_MAX_SHORT = 1.0 / MAX_SHORT;

    var MITER_BREAK = Math.cos(CesiumMath.toRadians(150.0));

    var scratchBVCartographic = new Cartographic();
    var scratchEncodedPosition = new Cartesian3();
    var scratchTranscoded = new Cartesian2();
    var scratchObb = new OrientedBoundingBox();

    /**
     *      +y
     *    3-----7
     *  / |   / |
     * 2-[1]-6  5 +x
     * | /   | /
     * 0-----4
     */

    var unitCorner0 = new Cartesian3(-0.5, -0.5, 0.5);
    var unitCorner1 = new Cartesian3(-0.5, -0.5, -0.5);
    var unitCorner2 = new Cartesian3(-0.5, 0.5, -0.5);
    var unitCorner3 = new Cartesian3(-0.5, 0.5, 0.5);
    var unitCorner4 = new Cartesian3(0.5, -0.5, 0.5);
    var unitCorner5 = new Cartesian3(0.5, -0.5, -0.5);
    var unitCorner6 = new Cartesian3(0.5, 0.5, 0.5);
    var unitCorner7 = new Cartesian3(0.5, 0.5, -0.5);

    // Winding order is reversed so each segment's volume is inside-out
    var REFERENCE_INDICES = [
        0, 2, 6, 0, 6, 4,
        0, 1, 3, 0, 3, 2,
        0, 4, 5, 0, 5, 1,
        5, 3, 1, 5, 7, 3,
        7, 5, 4, 7, 4, 6,
        7, 6, 2, 7, 2, 3
    ];
    var REFERENCE_INDICES_LENGTH = REFERENCE_INDICES.length;

    var transformedCornerScratch = new Cartesian3();
    function packCorner(unitCorner, orientedBoundingBox, center, index, floatArray) {
        var transformedCorner = Matrix3.multiplyByVector(orientedBoundingBox.halfAxes, unitCorner, transformedCornerScratch);
        transformedCorner = Cartesian3.add(transformedCorner, orientedBoundingBox.center, transformedCorner);
        transformedCorner = Cartesian3.subtract(transformedCorner, center, transformedCorner);

        Cartesian3.pack(transformedCorner, floatArray, index);
    }

    function positionToUv(position, eastPlane, westPlane, northPlane, southPlane, result) {
        var eastDistance = Plane.getPointDistance(eastPlane, position);
        var westDistance = Plane.getPointDistance(westPlane, position);
        var northDistance = Plane.getPointDistance(northPlane, position);
        var southDistance = Plane.getPointDistance(southPlane, position);

        result.x = Math.floor((MAX_USHORT * eastDistance) / (westDistance + eastDistance));
        result.y = Math.floor((MAX_USHORT * northDistance) / (northDistance + southDistance));
    }

    function transcodeUVBuffer(uBuffer, vBuffer, rectangle, ellipsoid, eastPlane, westPlane, northPlane, southPlane) {
        var positionsLength = uBuffer.length;
        for (var i = 0; i < positionsLength; i++) {
            var u = uBuffer[i];
            var v = vBuffer[i];

            var lon = CesiumMath.lerp(rectangle.west, rectangle.east, u * INVERSE_MAX_SHORT);
            var lat = CesiumMath.lerp(rectangle.south, rectangle.north, v * INVERSE_MAX_SHORT);

            var cartographic = Cartographic.fromRadians(lon, lat, 0.0, scratchBVCartographic);
            var decodedPosition = ellipsoid.cartographicToCartesian(cartographic, scratchEncodedPosition);

            var recodedPosition = positionToUv(decodedPosition, eastPlane, westPlane, northPlane, southPlane, scratchTranscoded);
            uBuffer[i] = recodedPosition.x;
            vBuffer[i] = recodedPosition.y;
        }
    }

    var inverse256 = 1.0 / 256;
    function encodeUint16(uint16, result) {
        var high = Math.floor(uint16 * inverse256);
        var low = uint16 - (high * 256);
        result.x = high;
        result.y = low;
        return result;
    }

    function getHigherPow2Res(pixelsNeeded) {
        var resolution = 16;
        while(resolution * resolution < pixelsNeeded) {
            resolution *= 2;
        }
        return resolution;
    }

    var previousCompressedCartographicScratch = new Cartographic();
    var currentCompressedCartographicScratch = new Cartographic();
    function removeDuplicates(uBuffer, vBuffer, heightBuffer, counts) {
        var countsLength = counts.length;
        var positionsLength = uBuffer.length;
        var markRemoval = new Uint8Array(positionsLength);
        var previous = previousCompressedCartographicScratch;
        var current = currentCompressedCartographicScratch;
        var offset = 0;
        for (var i = 0; i < countsLength; i++) {
            var count = counts[i];
            var updatedCount = count;
            for (var j = 1; j < count; j++) {
                var index = offset + j;
                var previousIndex = index - 1;
                current.longitude = uBuffer[index];
                current.latitude = vBuffer[index];
                previous.longitude = uBuffer[previousIndex];
                previous.latitude = vBuffer[previousIndex];

                if (Cartographic.equals(current, previous)) {
                    updatedCount--;
                    markRemoval[previousIndex] = 1;
                }
            }
            counts[i] = updatedCount;
            offset += count;
        }

        var nextAvailableIndex = 0;
        for (var k = 0; k < positionsLength; k++) {
            if (markRemoval[k] !== 1) {
                uBuffer[nextAvailableIndex] = uBuffer[k];
                vBuffer[nextAvailableIndex] = vBuffer[k];
                heightBuffer[nextAvailableIndex] = heightBuffer[k];
                nextAvailableIndex++;
            }
        }
    }

    function VertexAttributesAndIndices(volumesCount) {
        var vertexCount = volumesCount * 8;
        var vec3Floats = vertexCount * 3;
        var vec4Floats = vertexCount * 4;
        this.startEllipsoidNormals = new Float32Array(vec3Floats);
        this.endEllipsoidNormals = new Float32Array(vec3Floats);
        this.startPositionAndHeights = new Float32Array(vec4Floats);
        this.startFaceNormalAndVertexCorners = new Float32Array(vec4Floats);
        this.endPositionAndHeights = new Float32Array(vec4Floats);
        this.endFaceNormalAndHalfWidths = new Float32Array(vec4Floats);
        this.vertexBatchIds = new Uint16Array(vertexCount);

        this.indices = IndexDatatype.createTypedArray(vertexCount, 36 * volumesCount);

        this.vec3Offset = 0;
        this.vec4Offset = 0;
        this.batchIdOffset = 0;
        this.indexOffset = 0;

        this.volumeStartIndex = 0;
    }

    var towardCurrScratch = new Cartesian3();
    var towardNextScratch = new Cartesian3();
    function computeMiteredNormal(previousPosition, position, nextPosition, ellipsoidSurfaceNormal, result) {
        var towardNext = Cartesian3.subtract(nextPosition, position, towardNextScratch);
        var towardCurr = Cartesian3.subtract(position, previousPosition, towardCurrScratch);
        Cartesian3.normalize(towardNext, towardNext);
        Cartesian3.normalize(towardCurr, towardCurr);

        if (Cartesian3.dot(towardNext, towardCurr) < MITER_BREAK) {
            towardCurr = Cartesian3.multiplyByScalar(towardCurr, -1.0, towardCurrScratch);
        }

        Cartesian3.add(towardNext, towardCurr, result);
        if (Cartesian3.equals(result, Cartesian3.ZERO)) {
            result = Cartesian3.subtract(previousPosition, position);
        }

        // Make sure the normal is orthogonal to the ellipsoid surface normal
        Cartesian3.cross(result, ellipsoidSurfaceNormal, result);
        Cartesian3.cross(ellipsoidSurfaceNormal, result, result);
        Cartesian3.normalize(result, result);
        return result;
    }

    // Winding order is reversed so each segment's volume is inside-out
    //          3-----------7
    //         /|   left   /|
    //        / | 1       / |
    //       2-----------6  5  end
    //       | /         | /
    // start |/  right   |/
    //       0-----------4
    //
    //var REFERENCE_INDICES = [
    //    0, 2, 6, 0, 6, 4, // right
    //    0, 1, 3, 0, 3, 2, // start face
    //    0, 4, 5, 0, 5, 1, // bottom
    //    5, 3, 1, 5, 7, 3, // left
    //    7, 5, 4, 7, 4, 6, // end face
    //    7, 6, 2, 7, 2, 3 // top
    //];
    //var REFERENCE_INDICES_LENGTH = REFERENCE_INDICES.length;

    var positionScratch = new Cartesian3();
    var scratchStartEllipsoidNormal = new Cartesian3();
    var scratchStartFaceNormal = new Cartesian3();
    var scratchEndEllipsoidNormal = new Cartesian3();
    var scratchEndFaceNormal = new Cartesian3();
    VertexAttributesAndIndices.prototype.addVolume = function(preStartRTC, startRTC, endRTC, postEndRTC, startHeight, endHeight, halfWidth, batchId, center, ellipsoid) {
        var position = Cartesian3.add(startRTC, center, positionScratch);
        var startEllipsoidNormal = ellipsoid.geodeticSurfaceNormal(position, scratchStartEllipsoidNormal);
        position = Cartesian3.add(endRTC, center, positionScratch);
        var endEllipsoidNormal = ellipsoid.geodeticSurfaceNormal(position, scratchEndEllipsoidNormal);

        var startFaceNormal = computeMiteredNormal(preStartRTC, startRTC, endRTC, startEllipsoidNormal, scratchStartFaceNormal);
        var endFaceNormal = computeMiteredNormal(postEndRTC, endRTC, startRTC, endEllipsoidNormal, scratchEndFaceNormal);

        var startEllipsoidNormals = this.startEllipsoidNormals;
        var endEllipsoidNormals = this.endEllipsoidNormals;
        var startPositionAndHeights = this.startPositionAndHeights;
        var startFaceNormalAndVertexCorners = this.startFaceNormalAndVertexCorners;
        var endPositionAndHeights = this.endPositionAndHeights;
        var endFaceNormalAndHalfWidths = this.endFaceNormalAndHalfWidths;
        var vertexBatchIds = this.vertexBatchIds;

        var batchIdOffset = this.batchIdOffset;
        var vec3Offset = this.vec3Offset;
        var vec4Offset = this.vec4Offset;

        var i;
        for (i = 0; i < 8; i++) {
            Cartesian3.pack(startEllipsoidNormal, startEllipsoidNormals, vec3Offset);
            Cartesian3.pack(endEllipsoidNormal, endEllipsoidNormals, vec3Offset);

            Cartesian3.pack(startRTC, startPositionAndHeights, vec4Offset);
            startPositionAndHeights[vec4Offset + 3] = startHeight;

            Cartesian3.pack(endRTC, endPositionAndHeights, vec4Offset);
            endPositionAndHeights[vec4Offset + 3] = endHeight;

            Cartesian3.pack(startFaceNormal, startFaceNormalAndVertexCorners, vec4Offset);
            startFaceNormalAndVertexCorners[vec4Offset + 3] = i;

            Cartesian3.pack(endFaceNormal, endFaceNormalAndHalfWidths, vec4Offset);
            endFaceNormalAndHalfWidths[vec4Offset + 3] = halfWidth;

            vertexBatchIds[batchIdOffset++] = batchId;

            vec3Offset += 3;
            vec4Offset += 4;
        }

        this.batchIdOffset = batchIdOffset;
        this.vec3Offset = vec3Offset;
        this.vec4Offset = vec4Offset;
        var indices = this.indices;
        var volumeStartIndex = this.volumeStartIndex;

        var indexOffset = this.indexOffset;
        for (i = 0; i < REFERENCE_INDICES_LENGTH; i++) {
            indices[indexOffset + i] = REFERENCE_INDICES[i] + volumeStartIndex;
        }

        this.volumeStartIndex += 8;
        this.indexOffset += REFERENCE_INDICES_LENGTH;
    };

    var scratchRectangle = new Rectangle();
    var scratchEllipsoid = new Ellipsoid();
    var scratchCenter = new Cartesian3();

    var widthEncodedScatch = new Cartesian2();
    var batchIdEncodedScratch = new Cartesian2();
    var uint8EncodedScratch = new Cartesian2();
    function createVectorTileClampedPolylines(parameters, transferableObjects) {
        var encodedPositions = new Uint16Array(parameters.positions);
        var widths = new Uint16Array(parameters.widths);
        var counts = new Uint32Array(parameters.counts);
        var batchIds = new Uint16Array(parameters.batchIds);

        // Unpack tile decoding parameters and planes
        var rectangle = scratchRectangle;
        var ellipsoid = scratchEllipsoid;
        var center = scratchCenter;
        var packedBuffer = new Float64Array(parameters.packedBuffer);
        var eastPlane = new Plane();
        var westPlane = new Plane();
        var northPlane = new Plane();
        var southPlane = new Plane();

        var offset = 0;
        var minimumHeight = packedBuffer[offset++];
        var maximumHeight = packedBuffer[offset++];

        Rectangle.unpack(packedBuffer, offset, rectangle);
        offset += Rectangle.packedLength;

        Ellipsoid.unpack(packedBuffer, offset, ellipsoid);
        offset += Ellipsoid.packedLength;

        Cartesian3.unpack(packedBuffer, offset, center);
        offset += Cartesian3.packedLength;

        unpackCartesian4ToPlane(packedBuffer, offset, eastPlane);
        offset += Cartesian4.packedLength;

        unpackCartesian4ToPlane(packedBuffer, offset, westPlane);
        offset += Cartesian4.packedLength;

        unpackCartesian4ToPlane(packedBuffer, offset, northPlane);
        offset += Cartesian4.packedLength;

        unpackCartesian4ToPlane(packedBuffer, offset, southPlane);

        var i;

        // Unpack positions and generate volumes
        var positionsLength = encodedPositions.length / 3;
        var uBuffer = encodedPositions.subarray(0, positionsLength);
        var vBuffer = encodedPositions.subarray(positionsLength, 2 * positionsLength);
        var heightBuffer = encodedPositions.subarray(2 * positionsLength, 3 * positionsLength);
        AttributeCompression.zigZagDeltaDecode(uBuffer, vBuffer, heightBuffer);

        removeDuplicates(uBuffer, vBuffer, heightBuffer, counts);

        // Transcode compressed positions to planar distances
        transcodeUVBuffer(uBuffer, vBuffer, rectangle, ellipsoid, eastPlane, westPlane, northPlane, southPlane);

        // Figure out how many segments there will be
        var countsLength = counts.length;
        var totalSegmentsCount = 0;
        for (i = 0; i < countsLength; i++) {
            var polylinePositionCount = counts[i];
            totalSegmentsCount += polylinePositionCount - 1;
        }

        // Each segment contains:
        // * 2 U/V positions at 16-bit precision: total 8 uint8s
        // * 1 16-bit batchId: 2 uint8s
        // * 1 16-bit width: 2 uint8s
        // So each segment is 12 bytes, aka 3 pixels
        var pixelsNeeded = totalSegmentsCount * 3;
        var textureWidth = getHigherPow2Res(pixelsNeeded);
        var table = new Uint8Array(textureWidth * textureWidth * 4);

        var currentPositionIndex = 0;
        var currentTableIndex = 0;
        for (i = 0; i < countsLength; i++) {
            var segmentsCount = counts[i] - 1;
            var linewidth = encodeUint16(widths[i], widthEncodedScatch);
            var batchId = encodeUint16(batchIds[i], batchIdEncodedScratch);
            for (var j = 0; j < segmentsCount; j++) {
                var startU = encodeUint16(uBuffer[currentPositionIndex], uint8EncodedScratch);
                table[currentTableIndex++] = startU.x;
                table[currentTableIndex++] = startU.y;

                var startV = encodeUint16(vBuffer[currentPositionIndex], uint8EncodedScratch);
                table[currentTableIndex++] = startV.x;
                table[currentTableIndex++] = startV.y;

                currentPositionIndex++;
                var endU = encodeUint16(uBuffer[currentPositionIndex], uint8EncodedScratch);
                table[currentTableIndex++] = endU.x;
                table[currentTableIndex++] = endU.y;

                var endV = encodeUint16(vBuffer[currentPositionIndex], uint8EncodedScratch);
                table[currentTableIndex++] = endV.x;
                table[currentTableIndex++] = endV.y;

                table[currentTableIndex++] = linewidth.x;
                table[currentTableIndex++] = linewidth.y;

                table[currentTableIndex++] = batchId.x;
                table[currentTableIndex++] = batchId.y;
            }
        }

        // Create geometry for an oriented bounding box around the tile's region
        var boundingBox = OrientedBoundingBox.fromRectangle(rectangle, minimumHeight, maximumHeight, ellipsoid, scratchObb);
        var positions = new Float32Array(8 * 3);
        var indices = new Uint16Array(REFERENCE_INDICES);

        packCorner(unitCorner0, boundingBox, center, 0, positions);
        packCorner(unitCorner1, boundingBox, center, 3, positions);
        packCorner(unitCorner2, boundingBox, center, 6, positions);
        packCorner(unitCorner3, boundingBox, center, 9, positions);
        packCorner(unitCorner4, boundingBox, center, 12, positions);
        packCorner(unitCorner5, boundingBox, center, 15, positions);
        packCorner(unitCorner6, boundingBox, center, 18, positions);
        packCorner(unitCorner7, boundingBox, center, 21, positions);

        return {
            vertexPositions: positions, // TODO: geometry for this should really just live on the main thread and get transformed as an RTC OBB
            indices: indices,
            lineSegmentTable: table,
            tableTextureWidth: textureWidth,
            tableTextureHeight: textureWidth
        };
    }

    return createTaskProcessorWorker(createVectorTileClampedPolylines);
});
