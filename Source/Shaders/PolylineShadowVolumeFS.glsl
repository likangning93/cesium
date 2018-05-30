#ifdef GL_EXT_frag_depth
#extension GL_EXT_frag_depth : enable
#endif

varying vec4 v_startPlaneEC;
varying vec4 v_endPlaneEC;
varying vec4 v_rightPlaneEC;
varying vec3 v_forwardDirectionEC;
varying vec3 v_texcoordNormalization_and_halfWidth;

#ifdef PER_INSTANCE_COLOR
varying vec4 v_color;
#else
varying vec2 v_alignedPlaneDistances;
#endif

float rayPlaneDistanceUnsafe(vec3 origin, vec3 direction, vec3 planeNormal, float planeDistance) {
    // We don't expect the ray to ever be parallel to the plane
    return (-planeDistance - dot(planeNormal, origin)) / dot(planeNormal, direction);
}

void main(void)
{
 //   float logDepthOrDepth = czm_unpackDepth(texture2D(czm_globeDepthTexture, gl_FragCoord.xy / czm_viewport.zw));

    // Discard for sky
 //   bool shouldDiscard = logDepthOrDepth == 0.0;

    vec4 eyeCoordinate = gl_FragCoord;//czm_windowToEyeCoordinates(gl_FragCoord.xy, logDepthOrDepth);
    eyeCoordinate /= eyeCoordinate.w;

    float halfMaxWidth = v_texcoordNormalization_and_halfWidth.z * czm_metersPerPixel(eyeCoordinate);
    // Check distance of the eye coordinate against the right-facing plane
    float width = czm_planeDistance(v_rightPlaneEC, eyeCoordinate.xyz);

    // Check distance of the eye coordinate against the forward-facing plane
    float distanceFromStart = rayPlaneDistanceUnsafe(eyeCoordinate.xyz, -v_forwardDirectionEC, v_startPlaneEC.xyz, v_startPlaneEC.w);
    float distanceFromEnd = rayPlaneDistanceUnsafe(eyeCoordinate.xyz, v_forwardDirectionEC, v_endPlaneEC.xyz, v_endPlaneEC.w);

    //shouldDiscard = shouldDiscard || (abs(width) > halfMaxWidth || distanceFromStart < 0.0 || distanceFromEnd < 0.0);

    //if (shouldDiscard) {
#ifdef DEBUG_SHOW_VOLUME
    //    gl_FragColor = vec4(1.0, 0.0, 0.0, 0.5);
    //    return;
#else // DEBUG_SHOW_VOLUME
    //    discard;
#endif // DEBUG_SHOW_VOLUME
    //}

#ifdef PICK
    gl_FragColor.a = 1.0;
#else // PICK
#ifdef PER_INSTANCE_COLOR
    gl_FragColor = v_color;
#else // PER_INSTANCE_COLOR
    // Use distances for planes aligned with segment to prevent skew in dashing
    distanceFromStart = rayPlaneDistanceUnsafe(eyeCoordinate.xyz, -v_forwardDirectionEC, v_forwardDirectionEC.xyz, v_alignedPlaneDistances.x);
    distanceFromEnd = rayPlaneDistanceUnsafe(eyeCoordinate.xyz, v_forwardDirectionEC, -v_forwardDirectionEC.xyz, v_alignedPlaneDistances.y);

    // Clamp - distance to aligned planes may be negative due to mitering
    distanceFromStart = max(0.0, distanceFromStart);
    distanceFromEnd = max(0.0, distanceFromEnd);

    float s = distanceFromStart / (distanceFromStart + distanceFromEnd);
    s = (s * v_texcoordNormalization_and_halfWidth.y) + v_texcoordNormalization_and_halfWidth.x;
    float t = (width + halfMaxWidth) / (2.0 * halfMaxWidth);

    czm_materialInput materialInput;

    materialInput.s = s;
    materialInput.st = vec2(s, t);
    materialInput.str = vec3(s, t, 0.0);

    czm_material material = czm_getMaterial(materialInput);
    gl_FragColor = vec4(material.diffuse + material.emission, material.alpha);
#endif // PER_INSTANCE_COLOR

#endif // PICK
}
