attribute vec4 currentPosition;
attribute vec4 previousPosition;
attribute vec4 nextPosition;
attribute vec2 expandAndWidth;
attribute float a_batchId;
attribute float a_cascadeIndex;

uniform mat4 u_modifiedModelViewToTangentSpace;
uniform highp sampler2D u_boundsTexture;
uniform vec2 u_boundingBoxMinMaxY;

varying vec4 v_textureViewportCorners;

bool segmentOutOfBounds(vec2 p0, vec2 p1, vec2 aabbMin, vec2 aabbMax, float width) {
    vec2 dir = normalize(p1 - p1);
    vec2 offset = vec2(-dir.y, dir.x) * width;

    bool sideA = czm_intersectLineSegmentAABB2D(p0 + offset, p1 + offset, aabbMin, aabbMax);
    bool sideB = czm_intersectLineSegmentAABB2D(p0 - offset, p1 - offset, aabbMin, aabbMax);

    return !(sideA || sideB);
}

void main()
{
    // Pass writeable area to the FS to emulate a viewport

    // Cascade locations in texture space
    // 1 c2 c3
    // 0 c0 c1
    //   0  1
    vec2 offset;
    offset.x = mod(a_cascadeIndex, 2.0) - 0.5;
    offset.y = czm_branchFreeTernary(a_cascadeIndex < 2.0, -0.5, 0.5);

    float halfWidth = czm_viewport.z * 0.5;
    float halfHeight = czm_viewport.w * 0.5;

    vec4 textureViewportCorners;
    textureViewportCorners.xy = offset + vec2(0.5, 0.5);
    textureViewportCorners.x *= halfWidth;
    textureViewportCorners.y *= halfHeight;

    textureViewportCorners.zw = textureViewportCorners.xy;
    textureViewportCorners.zw += vec2(halfWidth, halfHeight);

    v_textureViewportCorners = textureViewportCorners;

    // Handle polyline width
    float expandDir = expandAndWidth.x;
    float width = abs(expandAndWidth.y) * 0.5;
    bool usePrev = expandAndWidth.y < 0.0;

    vec4 p = u_modifiedModelViewToTangentSpace * currentPosition;
    vec4 prev = u_modifiedModelViewToTangentSpace * previousPosition;
    vec4 next = u_modifiedModelViewToTangentSpace * nextPosition;

    vec2 directionToPrev = normalize(prev.xz - p.xz);
    vec2 directionToNext = normalize(next.xz - p.xz);

    vec2 thisSegmentForward, otherSegmentForward;
    if (usePrev)
    {
        thisSegmentForward = -directionToPrev;
        otherSegmentForward = directionToNext;
    }
    else
    {
        thisSegmentForward = directionToNext;
        otherSegmentForward =  -directionToPrev;
    }

    vec2 ratioLookup = vec2(3.0 / 4.0, 0.5);
    float pixelRatioTimesMetersPerPixel = texture2D(u_boundsTexture, ratioLookup).r;
    width *= pixelRatioTimesMetersPerPixel;

    vec2 thisSegmentLeft = vec2(-thisSegmentForward.y, thisSegmentForward.x);
    p.x += thisSegmentLeft.x * width * expandDir;
    p.z += thisSegmentLeft.y * width * expandDir;

    vec2 cascadeLookup = (offset + vec2(1.0, 1.0)) * 0.25;
    vec4 cascadeMinMax = texture2D(u_boundsTexture, cascadeLookup);
    vec2 aabbMin = cascadeMinMax.xy;
    vec2 aabbMax = cascadeMinMax.zw;

    p.x = ((p.x - aabbMin.x) / (aabbMax.x - aabbMin.x) - 0.5) * 2.0;
    p.z = ((p.z - aabbMin.y) / (aabbMax.y - aabbMin.y) - 0.5) * 2.0;
    p.y = (p.y - u_boundingBoxMinMaxY.x) / (u_boundingBoxMinMaxY.y - u_boundingBoxMinMaxY.x);

    // Move to the "viewport" for the current cascade
    p.xz *= 0.5;
    p.xz += offset;

    // Check if p + prev + width or p + next + width is definitely of bounds,
    // in which case:
    // * don't just move this somewhere random or it might pull across the cascade
    // * probably safe to move it somewhere far in a direction that's out-of-bounds
    // * this won't distort any features that should draw, b/c both prev and next must be OOB
    bool oob = segmentOutOfBounds(p.xz, prev.xz, aabbMin, aabbMax, width);
    oob = segmentOutOfBounds(p.xz, next.xz, aabbMin, aabbMax, width) && oob;
    p.y -= czm_branchFreeTernary(oob, czm_infinity, 0.0);

    gl_Position = p.xzyw;
}
