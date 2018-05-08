#ifdef GL_EXT_frag_depth
#extension GL_EXT_frag_depth : enable
#endif

varying vec4 v_forwardPlane;
varying vec4 v_rightPlane;
varying float v_forwardExtent;

void main(void)
{
    float logDepthOrDepth = czm_unpackDepth(texture2D(czm_globeDepthTexture, gl_FragCoord.xy / czm_viewport.zw));
    if (logDepthOrDepth < czm_log2FarDistance) {
        discard;
    }
    vec4 eyeCoordinate = czm_windowToEyeCoordinates(gl_FragCoord.xy, logDepthOrDepth);
    eyeCoordinate /= eyeCoordinate.w;

    // Check distance of the eye coordinate against the right-facing plane
    bool outOfBounds = abs(czm_planeDistance(v_rightPlane, eyeCoordinate.xyz)) > 2.0 * czm_metersPerPixel(eyeCoordinate); // 4 pixels wide?

    // Check distance of the eye coordinate against the forward-facing plane
    float distanceAlongForward = czm_planeDistance(v_forwardPlane, eyeCoordinate.xyz);
    outOfBounds = outOfBounds || (distanceAlongForward < 0.0 || v_forwardExtent < distanceAlongForward);

    if (outOfBounds) {
        discard;
    } else {
        gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0);
    }

    czm_writeDepthClampedToFarPlane();
}
