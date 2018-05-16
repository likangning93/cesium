attribute vec3 position3DHigh;
attribute vec3 position3DLow;
attribute float batchId;
attribute vec3 normal;

varying vec4 v_startPlaneEC;
varying vec4 v_endPlaneEC;
varying vec4 v_rightPlaneEC;
varying vec3 v_forwardDirectionEC;
varying vec2 v_alignedPlaneDistances;
varying vec3 v_texcoordNormalization;
varying float v_width;
varying float v_polylineAngle;

void main()
{
    vec4 entry1 = czm_batchTable_startHi_and_forwardOffsetX(batchId);
    vec4 entry2 = czm_batchTable_startLo_and_forwardOffsetY(batchId);

    vec3 ecStart = (czm_modelViewRelativeToEye * czm_translateRelativeToEye(entry1.xyz, entry2.xyz)).xyz;
    vec3 offset = vec3(entry1.w, entry2.w, 0.0);

    entry1 = czm_batchTable_startNormal_and_forwardOffsetZ(batchId);

    offset.z = entry1.w;
    offset = czm_normal * offset;
    vec3 ecEnd = ecStart + offset;

    vec3 forwardDirectionEC = normalize(offset);
    v_forwardDirectionEC = forwardDirectionEC;

    // end plane
    vec3 ecEndNormal = czm_normal * czm_batchTable_endNormal(batchId);
    v_endPlaneEC.xyz = ecEndNormal;
    v_endPlaneEC.w = -dot(ecEndNormal, ecEnd);

    // Right plane
    vec3 ecRight = czm_normal * czm_batchTable_rightNormal(batchId);
    v_rightPlaneEC.xyz = ecRight;
    v_rightPlaneEC.w = -dot(ecRight, ecStart);

    // start plane
    vec3 ecStartNormal = czm_normal * entry1.xyz;
    v_startPlaneEC.xyz = ecStartNormal;
    v_startPlaneEC.w = -dot(ecStartNormal, ecStart);

    v_alignedPlaneDistances.x = -dot(forwardDirectionEC, ecStart);
    v_alignedPlaneDistances.y = -dot(-forwardDirectionEC, ecEnd);

    v_texcoordNormalization = czm_batchTable_texcoordNormalization(batchId);

    // Position stuff
    vec4 positionRelativeToEye = czm_computePosition();

    // A "perfect" implementation would push along normals according to angle against forward instead of by unit amount.
    // In practice, just extending the shadow volume a bit more than needed works for most cases,
    // and for very sharp turns we compute attributes to "break" the miter anyway.
    positionRelativeToEye.xyz += 8.0 * czm_metersPerPixel(positionRelativeToEye) * normal;
    gl_Position = czm_depthClampFarPlane(czm_modelViewProjectionRelativeToEye * positionRelativeToEye);

    v_width = 8.0;

    // Approximate relative screen space direction of the line.
    // This doesn't work great if the view direction is roughly aligned with the line
    // Directly copying what PolylineCommon.glsl does using ecStart and ecEnd is even worse.
    vec2 approxLineDirection = normalize(vec2(forwardDirectionEC.x, -forwardDirectionEC.y));
    v_polylineAngle = czm_fastApproximateAtan(approxLineDirection.x, approxLineDirection.y);
}
