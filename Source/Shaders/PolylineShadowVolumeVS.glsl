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

void main()
{
    // Start and End positions
    vec4 startRelativeToEye2D = czm_translateRelativeToEye(vec3(0.0, startHiLo2D.xy), vec3(0.0, startHiLo2D.zw));
    vec4 startRelativeToEye3D = czm_translateRelativeToEye(startHi_and_forwardOffsetX.xyz, startLo_and_forwardOffsetY.xyz);
    vec4 startRelativeToEye = czm_columbusViewMorph(startRelativeToEye2D, startRelativeToEye3D, czm_morphTime);
    vec3 ecStart = (czm_modelViewRelativeToEye * startRelativeToEye).xyz;
    vec3 ecStart2D = (czm_modelViewRelativeToEye * startRelativeToEye2D).xyz;
    vec3 ecStart3D = (czm_modelViewRelativeToEye * startRelativeToEye3D).xyz;

    vec4 endRelativeToEye2D = startRelativeToEye2D + vec4(0.0, offsetAndRight2D.xy, 0.0);
    vec4 endRelativeToEye3D = startRelativeToEye3D + vec4(startHi_and_forwardOffsetX.w, startLo_and_forwardOffsetY.w, startNormal_and_forwardOffsetZ.w, 0.0);
    vec4 endRelativeToEye = czm_columbusViewMorph(endRelativeToEye2D, endRelativeToEye3D, czm_morphTime);
    vec3 ecEnd = (czm_modelViewRelativeToEye * endRelativeToEye).xyz;
    vec3 ecEnd2D = (czm_modelViewRelativeToEye * endRelativeToEye2D).xyz;
    vec3 ecEnd3D = (czm_modelViewRelativeToEye * endRelativeToEye3D).xyz;

    // Start plane
    vec3 startPlaneDir2D = czm_normal * vec3(0.0, startEndNormals2D.xy);
    vec3 startPlaneDir3D = czm_normal * startNormal_and_forwardOffsetZ.xyz;
    vec4 startPlane2D = vec4(startPlaneDir2D, -dot(startPlaneDir2D, ecStart2D));
    vec4 startPlane3D = vec4(startPlaneDir3D, -dot(startPlaneDir3D, ecStart3D));
    v_startPlaneEC = mix(startPlane2D, startPlane3D, czm_morphTime);

    // End plane
    vec3 endPlaneDir2D = czm_normal * vec3(0.0, startEndNormals2D.zw);
    vec3 endPlaneDir3D = czm_normal * endNormal_andTextureCoordinateNormalizationX.xyz;
    vec4 endPlane2D = vec4(endPlaneDir2D, -dot(endPlaneDir2D, ecEnd2D));
    vec4 endPlane3D = vec4(endPlaneDir3D, -dot(endPlaneDir3D, ecEnd3D));
    v_endPlaneEC = mix(endPlane2D, endPlane3D, czm_morphTime);

    // Right plane
    vec3 right2D = czm_normal * vec3(0.0, offsetAndRight2D.zw);
    vec3 right3D = czm_normal * rightNormal_andTextureCoordinateNormalizationY.xyz;
    vec4 rightPlane2D = vec4(right2D, -dot(right2D, ecStart2D));
    vec4 rightPlane3D = vec4(right3D, -dot(right3D, ecStart3D));
    v_rightPlaneEC = mix(rightPlane2D, rightPlane3D, czm_morphTime);

    // Forward direction
    vec3 forwardDirectionEC = normalize(ecEnd - ecStart);
    v_forwardDirectionEC = forwardDirectionEC;

    v_texcoordNormalization_and_halfWidth.xy = mix(texcoordNormalization2D, vec2(endNormal_andTextureCoordinateNormalizationX.w, rightNormal_andTextureCoordinateNormalizationY.w), czm_morphTime);

#ifdef PER_INSTANCE_COLOR
    v_color = czm_batchTable_color(batchId);
#else // PER_INSTANCE_COLOR
    // For computing texture coordinates

    v_alignedPlaneDistances.x = -dot(v_forwardDirectionEC, ecStart);
    v_alignedPlaneDistances.y = -dot(-v_forwardDirectionEC, ecEnd);
#endif // PER_INSTANCE_COLOR

    float width = czm_batchTable_width(batchId);
    v_width = width;
    v_texcoordNormalization_and_halfWidth.z = width * 0.5;

    // Compute a normal along which to "push" the position out, extending the miter depending on view distance.
    // Position has already been "pushed" by unit length along miter normal, and miter normals are encoded in the planes.
    // Decode the normal to use at this specific vertex, push the position back, and then push to where it needs to be.
    //vec4 positionRelativeToEye2D = czm_translateRelativeToEye(position2DHigh.zxy, position2DLow.zxy);
    //vec4 positionRelativeToEye3D = czm_translateRelativeToEye(position3DHigh, position3DLow);

    // Check distance to the end plane and start plane, pick the plane that is closer

    // 3D
    vec4 positionEC3D = czm_modelViewRelativeToEye * czm_translateRelativeToEye(position3DHigh, position3DLow); // w = 1.0, see czm_computePosition
    float absStartPlaneDistance = abs(czm_planeDistance(startPlane3D, positionEC3D.xyz));
    float absEndPlaneDistance = abs(czm_planeDistance(endPlane3D, positionEC3D.xyz));
    vec3 planeDirection = czm_branchFreeTernary(absStartPlaneDistance < absEndPlaneDistance, startPlane3D.xyz, endPlane3D.xyz);
    vec3 upOrDown = normalize(cross(rightPlane3D.xyz, planeDirection)); // Points "up" for start plane, "down" at end plane.
    vec3 normalEC = normalize(cross(planeDirection, upOrDown));           // In practice, the opposite seems to work too.

    // Check distance to the right plane to determine if the miter normal points "left" or "right"
    normalEC *= sign(czm_planeDistance(rightPlane3D, positionEC3D.xyz));

    // A "perfect" implementation would push along normals according to the angle against forward.
    // In practice, just extending the shadow volume more than needed works for most cases,
    // and for very sharp turns we compute attributes to "break" the miter anyway.
    positionEC3D.xyz -= normalEC; // undo the unit length push
    positionEC3D.xyz += 0.5 * width * max(0.0, czm_metersPerPixel(positionEC3D)) * normalEC; // prevent artifacts when czm_metersPerPixel is negative (behind camera)

    // 2D
    vec4 positionEC2D = czm_modelViewRelativeToEye * czm_translateRelativeToEye(position2DHigh.zxy, position2DLow.zxy); // w = 1.0, see czm_computePosition
    absStartPlaneDistance = abs(czm_planeDistance(startPlane2D, positionEC2D.xyz));
    absEndPlaneDistance = abs(czm_planeDistance(endPlane2D, positionEC2D.xyz));
    planeDirection = czm_branchFreeTernary(absStartPlaneDistance < absEndPlaneDistance, startPlane2D.xyz, endPlane2D.xyz);
    upOrDown = normalize(cross(rightPlane2D.xyz, planeDirection)); // Points "up" for start plane, "down" at end plane.
    normalEC = normalize(cross(planeDirection, upOrDown));           // In practice, the opposite seems to work too.

    // Check distance to the right plane to determine if the miter normal points "left" or "right"
    normalEC *= sign(czm_planeDistance(rightPlane2D, positionEC2D.xyz));

    // A "perfect" implementation would push along normals according to the angle against forward.
    // In practice, just extending the shadow volume more than needed works for most cases,
    // and for very sharp turns we compute attributes to "break" the miter anyway.
    positionEC2D.xyz -= normalEC; // undo the unit length push
    positionEC2D.xyz += 0.5 * width * max(0.0, czm_metersPerPixel(positionEC2D)) * normalEC; // prevent artifacts when czm_metersPerPixel is negative (behind camera)

    // Blend
    gl_Position = czm_projection * mix(positionEC2D, positionEC3D, czm_morphTime);

    // Approximate relative screen space direction of the line.
    vec2 approxLineDirection = normalize(vec2(v_forwardDirectionEC.x, -v_forwardDirectionEC.y));
    approxLineDirection.y = czm_branchFreeTernary(approxLineDirection.x == 0.0 && approxLineDirection.y == 0.0, -1.0, approxLineDirection.y);
    v_polylineAngle = czm_fastApproximateAtan(approxLineDirection.x, approxLineDirection.y);
}
