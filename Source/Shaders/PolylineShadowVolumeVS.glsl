attribute vec3 position3DHigh;
attribute vec3 position3DLow;
attribute float batchId;
attribute vec3 normal;

varying vec4 v_startPlane;
varying vec4 v_endPlane;
varying vec4 v_rightPlane;

void main()
{
    vec4 entry1 = czm_batchTable_startHi_and_forwardOffsetX(batchId);
    vec4 entry2 = czm_batchTable_startLo_and_forwardOffsetY(batchId);

    vec3 ecStart = (czm_modelViewRelativeToEye * czm_translateRelativeToEye(entry1.xyz, entry2.xyz)).xyz;
    vec3 offset = vec3(entry1.w, entry2.w, 0.0);

    entry1 = czm_batchTable_startUp_and_forwardOffsetZ(batchId);

    offset.z = entry1.w;
    offset = czm_normal * offset;
    vec3 ecEnd = ecStart + offset;

    vec3 ecStartUp = czm_normal * entry1.xyz;

    // end plane
    vec3 ecEndNormal = czm_normal * czm_batchTable_endNormal(batchId);
    v_endPlane.xyz = ecEndNormal;
    v_endPlane.w = -dot(ecEndNormal, ecEnd);

    // Right plane
    vec3 ecRight = normalize(cross(ecStartUp, ecEndNormal));
    v_rightPlane.xyz = ecRight;
    v_rightPlane.w = -dot(ecRight, ecStart);

    // start plane
    vec3 ecStartNormal = cross(ecStartUp, ecRight); // Should be orthogonal, so no need to normalize.
    v_startPlane.xyz = ecStartNormal;
    v_startPlane.w = -dot(ecStartNormal, ecStart);

    // Position stuff
    vec4 positionRelativeToEye = czm_computePosition();

    positionRelativeToEye.xyz += 4.0 * czm_metersPerPixel(czm_modelViewProjectionRelativeToEye * positionRelativeToEye) * normal; // TODO: may want to adjust based on angle of normal relative to line
    gl_Position = czm_depthClampFarPlane(czm_modelViewProjectionRelativeToEye * positionRelativeToEye);
}
