attribute vec3 position3DHigh;
attribute vec3 position3DLow;
attribute float batchId;
attribute vec3 normal;

varying vec4 v_forwardPlane;
varying vec4 v_rightPlane;
varying float v_forwardExtent;

void main()
{
    vec4 startHi_andRightX = czm_batchTable_startHi_andRightX(batchId);
    vec4 startLo_andRightY = czm_batchTable_startLo_andRightY(batchId);
    vec4 offset_andRightZ = czm_batchTable_offset_andRightZ(batchId);

    vec3 ecStart = (czm_modelViewRelativeToEye * czm_translateRelativeToEye(startHi_andRightX.xyz, startLo_andRightY.xyz)).xyz;
    vec3 ecOffset = czm_normal * offset_andRightZ.xyz;
    float offsetExtent = length(ecOffset);
    v_forwardExtent = offsetExtent;

    vec3 ecForward = ecOffset / offsetExtent;
    v_forwardPlane.xyz = ecForward;
    v_forwardPlane.w = -dot(ecForward, ecStart);

    vec3 ecRight = czm_normal * vec3(startHi_andRightX.w, startLo_andRightY.w, offset_andRightZ.w);
    v_rightPlane.xyz = ecRight;
    v_rightPlane.w = -dot(ecRight, ecStart);

    vec4 positionRelativeToEye = czm_computePosition();

    positionRelativeToEye.xyz += 4.0 * czm_metersPerPixel(czm_modelViewProjectionRelativeToEye * positionRelativeToEye) * normal; // TODO: may want to adjust based on angle of normal relative to line
    gl_Position = czm_depthClampFarPlane(czm_modelViewProjectionRelativeToEye * positionRelativeToEye);
}
