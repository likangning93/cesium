#ifdef GL_EXT_frag_depth
#extension GL_EXT_frag_depth : enable
#endif

varying vec4 v_startPlaneEC_vectorLengthHalfWidth;
varying vec4 v_endPlaneEC;
varying vec4 v_rightPlaneEC;
varying vec4 v_forwardOffsetEC_and_ecStartX;
varying vec4 v_texcoordNormalization_and_ecStartYZ;

#ifdef PER_INSTANCE_COLOR
varying vec4 v_color;
#endif

//float getAlignedPlane()

float rayPlaneDistanceUnsafe(vec3 origin, vec3 direction, vec3 planeNormal, float planeDistance) {
    // We don't expect the ray to ever be parallel to the plane
    return (-planeDistance - dot(planeNormal, origin)) / dot(planeNormal, direction);
}

void main(void)
{
    float logDepthOrDepth = czm_unpackDepth(texture2D(czm_globeDepthTexture, gl_FragCoord.xy / czm_viewport.zw));
    vec3 forwardDirectionEC = normalize(v_forwardOffsetEC_and_ecStartX.xyz);
    vec3 ecStart = vec3(v_forwardOffsetEC_and_ecStartX.w, v_texcoordNormalization_and_ecStartYZ.zw);
    vec3 ecEnd = ecStart + v_forwardOffsetEC_and_ecStartX.xyz;

    // Discard for sky
    bool shouldDiscard = logDepthOrDepth == 0.0;

    vec4 eyeCoordinate = czm_windowToEyeCoordinates(gl_FragCoord.xy, logDepthOrDepth);
    eyeCoordinate /= eyeCoordinate.w;

    float halfWidth = length(v_startPlaneEC_vectorLengthHalfWidth.xyz);
    float halfMaxWidth = halfWidth * czm_metersPerPixel(eyeCoordinate);
    // Check distance of the eye coordinate against the right-facing plane
    float widthWiseDistance = czm_planeDistance(v_rightPlaneEC, eyeCoordinate.xyz);

    // Check distance of the eye coordinate against the forward-facing plane
    vec4 startPlaneEC = vec4(v_startPlaneEC_vectorLengthHalfWidth.xyz / halfWidth, v_startPlaneEC_vectorLengthHalfWidth.w);
    float distanceFromStart = rayPlaneDistanceUnsafe(eyeCoordinate.xyz, -forwardDirectionEC, startPlaneEC.xyz, startPlaneEC.w);
    float distanceFromEnd = rayPlaneDistanceUnsafe(eyeCoordinate.xyz, forwardDirectionEC, v_endPlaneEC.xyz, v_endPlaneEC.w);

    shouldDiscard = shouldDiscard || (abs(widthWiseDistance) > halfMaxWidth || distanceFromStart < 0.0 || distanceFromEnd < 0.0);

    // Use distances for planes aligned with segment to determine if fragment is part of a rounded corner.
    // Also to prevent skew in dashing when computing texcoords.
    distanceFromStart = rayPlaneDistanceUnsafe(eyeCoordinate.xyz, -forwardDirectionEC, forwardDirectionEC, -dot(forwardDirectionEC, ecStart));
    distanceFromEnd = rayPlaneDistanceUnsafe(eyeCoordinate.xyz, forwardDirectionEC, -forwardDirectionEC, -dot(-forwardDirectionEC, ecEnd));

    // Rounding of corners
    // Compute line of intersection for nearer miter plane and right plane
    bool closerToStart = abs(distanceFromStart) < abs(distanceFromEnd);
    vec3 lineVector = czm_branchFreeTernary(closerToStart, cross(startPlaneEC.xyz, v_rightPlaneEC.xyz), cross(v_endPlaneEC.xyz, v_rightPlaneEC.xyz));
    ecStart = czm_branchFreeTernary(closerToStart, ecStart, ecEnd);

    // Reduces floating point problems if one of the line points given is closer to eyeCoordinate
    float lineDistance = distance(ecStart, eyeCoordinate.xyz);
    lineDistance = czm_lineDistance(ecStart - lineVector * lineDistance, ecStart + lineVector * lineDistance, eyeCoordinate.xyz);
    widthWiseDistance = czm_branchFreeTernary(distanceFromStart < 0.0 || distanceFromEnd < 0.0, lineDistance, widthWiseDistance);

    shouldDiscard = shouldDiscard || widthWiseDistance > halfMaxWidth;

    if (shouldDiscard) {
#ifdef DEBUG_SHOW_VOLUME
        gl_FragColor = vec4(1.0, 0.0, 0.0, 0.5);
        return;
#else // DEBUG_SHOW_VOLUME
        discard;
#endif // DEBUG_SHOW_VOLUME
    }

#ifdef PICK
    gl_FragColor.a = 1.0;
#else // PICK
#ifdef PER_INSTANCE_COLOR
    gl_FragColor = v_color;
#else // PER_INSTANCE_COLOR

    // Clamp - distance to aligned planes may be negative due to mitering
    distanceFromStart = max(0.0, distanceFromStart);
    distanceFromEnd = max(0.0, distanceFromEnd);

    float s = distanceFromStart / (distanceFromStart + distanceFromEnd);
    s = (s * v_texcoordNormalization_and_ecStartYZ.y) + v_texcoordNormalization_and_ecStartYZ.x;
    float t = (widthWiseDistance + halfMaxWidth) / (2.0 * halfMaxWidth);

    czm_materialInput materialInput;

    materialInput.s = s;
    materialInput.st = vec2(s, t);
    materialInput.str = vec3(s, t, 0.0);

    czm_material material = czm_getMaterial(materialInput);
    gl_FragColor = vec4(material.diffuse + material.emission, material.alpha);
#endif // PER_INSTANCE_COLOR

#endif // PICK
}
