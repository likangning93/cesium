attribute vec3 position3DHigh;
attribute vec3 position3DLow;

attribute vec4 startHi_and_forwardOffsetX;
attribute vec4 startLo_and_forwardOffsetY;
attribute vec4 startNormal_and_forwardOffsetZ;
attribute vec4 endNormal_andTextureCoordinateNormalizationX;
attribute vec4 rightNormal_andTextureCoordinateNormalizationY;
attribute vec4 startHiLo2D;
attribute vec4 offsetAndRight2D;
attribute vec4 startEndNormals2D;
attribute vec2 texcoordNormalization2D;

attribute float batchId;

varying vec4 v_startPlaneEC;
varying vec4 v_endPlaneEC;
varying vec4 v_rightPlaneEC;
varying vec3 v_forwardDirectionEC;
varying vec3 v_texcoordNormalization_and_halfWidth;

// For materials
varying float v_width;
varying float v_polylineAngle;

#ifdef PER_INSTANCE_COLOR
varying vec4 v_color;
#else
varying vec2 v_alignedPlaneDistances;
#endif

vec3 morphVector(vec3 startNorm, vec4 startPos, vec3 endNorm, vec4 endPos, float t) {
    vec3 startNormPos = startNorm + startPos.xyz;
    vec3 endNormPos = endNorm + endPos.xyz;

    vec3 medNormPos = mix(startNormPos, endNormPos, t);
    vec3 medPos = mix(startPos.xyz, endPos.xyz, t);
    //return normalize(medNormPos - medPos);
    return normalize(mix(startNorm, endNorm, t));
}

void main()
{
//#ifdef COLUMBUS_VIEW_2D
    vec4 ecStart2D = czm_modelViewRelativeToEye * czm_translateRelativeToEye(vec3(0.0, startHiLo2D.xy), vec3(0.0, startHiLo2D.zw));

    vec3 forwardDirectionEC2D = czm_normal * vec3(0.0, offsetAndRight2D.xy);
    vec4 ecEnd2D = vec4(forwardDirectionEC2D, 0.0) + ecStart2D;
    forwardDirectionEC2D = normalize(forwardDirectionEC2D);

    // Right plane
    vec4 rightPlaneEC2D;
    rightPlaneEC2D.xyz = czm_normal * vec3(0.0, offsetAndRight2D.zw);
    //rightPlaneEC2D.w = -dot(rightPlaneEC2D.xyz, ecStart2D);

    // start plane
    vec4 startPlaneEC2D;
    startPlaneEC2D.xyz =  czm_normal * vec3(0.0, startEndNormals2D.xy);
    //startPlaneEC2D.w = -dot(startPlaneEC2D.xyz, ecStart2D);

    // end plane
    vec4 endPlaneEC2D;
    endPlaneEC2D.xyz =  czm_normal * vec3(0.0, startEndNormals2D.zw);
    //endPlaneEC2D.w = -dot(endPlaneEC2D.xyz, ecEnd2D);

    vec3 texcoordNormalization_and_halfWidth2D;
    texcoordNormalization_and_halfWidth2D.xy = texcoordNormalization2D;

//#else // COLUMBUS_VIEW_2D
    vec4 ecStart3D = czm_modelViewRelativeToEye * czm_translateRelativeToEye(startHi_and_forwardOffsetX.xyz, startLo_and_forwardOffsetY.xyz);
    vec3 offset3D = czm_normal * vec3(startHi_and_forwardOffsetX.w, startLo_and_forwardOffsetY.w, startNormal_and_forwardOffsetZ.w);
    vec4 ecEnd3D = ecStart3D + vec4(offset3D, 0.0);

    vec3 forwardDirectionEC3D = normalize(offset3D);

    // start plane
    vec4 startPlaneEC3D;
    startPlaneEC3D.xyz = czm_normal * startNormal_and_forwardOffsetZ.xyz;
    //startPlaneEC3D.w = -dot(startPlaneEC3D.xyz, ecStart3D);

    // end plane
    vec4 endPlaneEC3D;
    endPlaneEC3D.xyz = czm_normal * endNormal_andTextureCoordinateNormalizationX.xyz;
    //endPlaneEC3D.w = -dot(endPlaneEC3D.xyz, ecEnd3D);

    // Right plane
    vec4 rightPlaneEC3D;
    rightPlaneEC3D.xyz = czm_normal * rightNormal_andTextureCoordinateNormalizationY.xyz;
    //rightPlaneEC3D.w = -dot(rightPlaneEC3D.xyz, ecStart3D);

    vec3 texcoordNormalization_and_halfWidth3D;
    texcoordNormalization_and_halfWidth3D.xy = vec2(endNormal_andTextureCoordinateNormalizationX.w, rightNormal_andTextureCoordinateNormalizationY.w);

//#endif // COLUMBUS_VIEW_2D

    vec4 p = mix(ecStart2D, ecStart3D, czm_morphTime);

    vec3 ecStart = p.xyz;
    vec3 ecEnd = ecStart + mix(czm_normal * vec3(0.0, offsetAndRight2D.xy), offset3D, czm_morphTime);

    v_startPlaneEC.xyz = morphVector(startPlaneEC2D.xyz, ecStart2D, startPlaneEC3D.xyz, ecStart3D, czm_morphTime);
    v_endPlaneEC.xyz = morphVector(endPlaneEC2D.xyz, ecEnd2D, endPlaneEC3D.xyz, ecEnd3D, czm_morphTime);
    v_rightPlaneEC.xyz = morphVector(rightPlaneEC2D.xyz, ecStart2D, rightPlaneEC3D.xyz, ecStart3D, czm_morphTime);

    v_startPlaneEC.w = -dot(v_startPlaneEC.xyz, ecStart);
    v_endPlaneEC.w = -dot(v_endPlaneEC.xyz, ecEnd);
    v_rightPlaneEC.w = -dot(v_rightPlaneEC.xyz, ecStart);

    v_forwardDirectionEC = morphVector(forwardDirectionEC2D, ecStart2D, forwardDirectionEC3D, ecStart3D, czm_morphTime);
    v_texcoordNormalization_and_halfWidth = mix(texcoordNormalization_and_halfWidth2D, texcoordNormalization_and_halfWidth3D, czm_morphTime);

#ifdef PER_INSTANCE_COLOR
    v_color = czm_batchTable_color(batchId);
#else // PER_INSTANCE_COLOR
    // For computing texture coordinates

    v_alignedPlaneDistances.x = -dot(v_forwardDirectionEC, ecStart);
    v_alignedPlaneDistances.y = -dot(-v_forwardDirectionEC, ecEnd);
#endif // PER_INSTANCE_COLOR

    // Compute a normal along which to "push" the position out, extending the miter depending on view distance.
    // Position has already been "pushed" by unit length along miter normal, and miter normals are encoded in the planes.
    // Decode the normal to use at this specific vertex, push the position back, and then push to where it needs to be.
    vec4 positionRelativeToEye = czm_computePosition();

    // Check distance to the end plane and start plane, pick the plane that is closer
    vec4 positionEC = czm_modelViewRelativeToEye * positionRelativeToEye; // w = 1.0, see czm_computePosition
    float absStartPlaneDistance = abs(czm_planeDistance(v_startPlaneEC, positionEC.xyz));
    float absEndPlaneDistance = abs(czm_planeDistance(v_endPlaneEC, positionEC.xyz));
    vec3 planeDirection = czm_branchFreeTernary(absStartPlaneDistance < absEndPlaneDistance, v_startPlaneEC.xyz, v_endPlaneEC.xyz);
    vec3 upOrDown = normalize(cross(v_rightPlaneEC.xyz, planeDirection)); // Points "up" for start plane, "down" at end plane.
    vec3 normalEC = normalize(cross(planeDirection, upOrDown));           // In practice, the opposite seems to work too.

    // Check distance to the right plane to determine if the miter normal points "left" or "right"
    normalEC *= sign(czm_planeDistance(v_rightPlaneEC, positionEC.xyz));

    // A "perfect" implementation would push along normals according to the angle against forward.
    // In practice, just extending the shadow volume more than needed works for most cases,
    // and for very sharp turns we compute attributes to "break" the miter anyway.
    float width = czm_batchTable_width(batchId);
    v_width = width;
    v_texcoordNormalization_and_halfWidth.z = width * 0.5;
    positionEC.xyz -= normalEC; // undo the unit length push
    positionEC.xyz += width * max(0.0, czm_metersPerPixel(positionEC)) * normalEC; // prevent artifacts when czm_metersPerPixel is negative (behind camera)
    gl_Position = czm_projection * positionEC;

    // Approximate relative screen space direction of the line.
    vec2 approxLineDirection = normalize(vec2(v_forwardDirectionEC.x, -v_forwardDirectionEC.y));
    approxLineDirection.y = czm_branchFreeTernary(approxLineDirection.x == 0.0 && approxLineDirection.y == 0.0, -1.0, approxLineDirection.y);
    v_polylineAngle = czm_fastApproximateAtan(approxLineDirection.x, approxLineDirection.y);
}
