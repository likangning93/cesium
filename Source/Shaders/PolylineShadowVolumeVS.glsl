attribute vec3 position3DHigh;
attribute vec3 position3DLow;
attribute float batchId;
attribute vec3 normal;

varying vec3 v_ecStart;
varying vec3 v_ecEnd;
varying vec3 v_ecNormal;

void main()
{
    vec4 startHi_andNormalX = czm_batchTable_startHi_andNormalX(batchId);
    vec4 startLo_andNormalY = czm_batchTable_startLo_andNormalY(batchId);
    vec4 offset_andNormalZ = czm_batchTable_offset_andNormalZ(batchId);

    v_ecStart = (czm_modelViewRelativeToEye * czm_translateRelativeToEye(startHi_andNormalX.xyz, startLo_andNormalY.xyz)).xyz;
    v_ecEnd = v_ecStart + czm_normal * offset_andNormalZ.xyz;
    v_ecNormal = czm_normal * vec3(startHi_andNormalX.w, startLo_andNormalY.w, offset_andNormalZ.w);

    vec4 positionRelativeToEye = czm_computePosition();
    positionRelativeToEye.xyz += 10000.0 * normal;
    gl_Position = czm_depthClampFarPlane(czm_modelViewProjectionRelativeToEye * positionRelativeToEye);
}
