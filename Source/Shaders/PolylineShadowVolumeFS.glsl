#ifdef GL_EXT_frag_depth
#extension GL_EXT_frag_depth : enable
#endif

varying vec4 v_startPlaneEC;
varying vec4 v_endPlaneEC;
varying vec4 v_rightPlaneEC;
varying vec3 v_forwardDirectionEC;
varying vec2 v_alignedPlaneDistances;
varying vec3 v_texcoordNormalization;

float rayPlaneDistance(vec3 origin, vec3 direction, vec3 planeNormal, float planeDistance) {
    // We don't expect the ray to ever be parallel to the plane
    return (-planeDistance - dot(planeNormal, origin)) / dot(planeNormal, direction);
}

void main(void)
{
    float logDepthOrDepth = czm_unpackDepth(texture2D(czm_globeDepthTexture, gl_FragCoord.xy / czm_viewport.zw));

    // Discard for sky
    if (logDepthOrDepth == 0.0) {
        discard;
    }

    vec4 eyeCoordinate = czm_windowToEyeCoordinates(gl_FragCoord.xy, logDepthOrDepth);
    eyeCoordinate /= eyeCoordinate.w;

    float halfMaxWidth = 2.0 * czm_metersPerPixel(eyeCoordinate); // ~4 pixels wide
    // Check distance of the eye coordinate against the right-facing plane
    float width = czm_planeDistance(v_rightPlaneEC, eyeCoordinate.xyz);

    // Check distance of the eye coordinate against the forward-facing plane
    float distanceFromStart = rayPlaneDistance(eyeCoordinate.xyz, -v_forwardDirectionEC, v_startPlaneEC.xyz, v_startPlaneEC.w);
    float distanceFromEnd = rayPlaneDistance(eyeCoordinate.xyz, v_forwardDirectionEC, v_endPlaneEC.xyz, v_endPlaneEC.w);

    if (abs(width) > halfMaxWidth || distanceFromStart < 0.0 || distanceFromEnd < 0.0) {
        discard;
    }

    // Use distances for planes aligned with segment to prevent skew in dashing
    distanceFromStart = rayPlaneDistance(eyeCoordinate.xyz, -v_forwardDirectionEC, v_forwardDirectionEC.xyz, v_alignedPlaneDistances.x);
    distanceFromEnd = rayPlaneDistance(eyeCoordinate.xyz, v_forwardDirectionEC, -v_forwardDirectionEC.xyz, v_alignedPlaneDistances.y);

    // Clamp - distance to aligned planes may be negative due to mitering
    distanceFromStart = max(0.0, distanceFromStart);
    distanceFromEnd = max(0.0, distanceFromEnd);

    float s = distanceFromStart / (distanceFromStart + distanceFromEnd);
    s = ((s * v_texcoordNormalization.y) + v_texcoordNormalization.x) / v_texcoordNormalization.z;
    float t = (width + halfMaxWidth) / (2.0 * halfMaxWidth);

/*
    // dashing for "science" aka PARTY GUY
    float rez = 0.01;
    float blue = czm_branchFreeTernaryFloat((mod(floor(s / rez), 4.0) == 1.0), 0.0, 1.0);
    gl_FragColor = vec4(s, t, blue, 1.0);
*/

    czm_materialInput materialInput;

    materialInput.s = s;
    materialInput.st = vec2(s, t);
    materialInput.str = vec3(s, t, 0.0);

    czm_material material = czm_getMaterial(materialInput);
    gl_FragColor = vec4(material.diffuse + material.emission, material.alpha);

    czm_writeDepthClampedToFarPlane();
}
