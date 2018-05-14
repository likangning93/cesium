#ifdef GL_EXT_frag_depth
#extension GL_EXT_frag_depth : enable
#endif

varying vec4 v_startPlane;
varying vec4 v_endPlane;
varying vec4 v_rightPlane;

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
    float distanceFromStart = czm_planeDistance(v_startPlane, eyeCoordinate.xyz);
    float distanceFromEnd = czm_planeDistance(v_endPlane, eyeCoordinate.xyz);
    outOfBounds = outOfBounds || distanceFromStart < 0.0 || distanceFromEnd < 0.0;

    if (outOfBounds) {
        discard;
        //gl_FragColor = vec4(1.0, 0.0, 0.0, 0.1);
    } else {
        gl_FragColor = vec4(0.0, 1.0, 0.0, 0.9);
    }

    czm_writeDepthClampedToFarPlane();
}
