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

// https://keithmaggio.wordpress.com/2011/02/15/math-magician-lerp-slerp-and-nlerp/
vec3 slerp(vec3 start, vec3 end, float percent)
{
     // Dot product - the cosine of the angle between 2 vectors.
     float dotProduct = dot(start, end);
     // Clamp it to be in the range of Acos()
     // This may be unnecessary, but floating point
     // precision can be a fickle mistress.
     clamp(dotProduct, -1.0, 1.0);
     // Acos(dot) returns the angle between start and end,
     // And multiplying that by percent returns the angle between
     // start and the final result.
     float theta = acos(dotProduct)*percent;
     vec3 relativeVec = normalize(end - start*dotProduct); // Orthonormal basis
     // The final result.
     return ((start*cos(theta)) + (relativeVec*sin(theta)));
}

vec3 morphNormal(vec3 norm2D, vec4 pos2D, vec3 norm3D, vec4 pos3D) {
    vec3 normPos2D = 100000.0 * norm2D + pos2D.xyz;
    vec3 normPos3D = 100000.0 * norm3D + pos3D.xyz;

    vec3 normPos = mix(normPos2D, normPos3D, czm_morphTime);
    vec3 pos = mix(pos2D.xyz, pos3D.xyz, czm_morphTime);
    return normalize(normPos - pos); // bad for 3D unless normals padded out a LOT, doesn't work when morphing, ok for 2D?
    //return normalize(slerp(norm2D, norm3D, czm_morphTime)); // doesn't produce great results for 3D, doesn't work when morphing
    //return normalize(mix(norm2D, norm3D, czm_morphTime)); // pure 2D and 3D work fine, but morph doesn't work
}

void main()
{
    // Start and End positions
    vec4 startRelativeToEye2D = czm_translateRelativeToEye(vec3(0.0, startHiLo2D.xy), vec3(0.0, startHiLo2D.zw));
    vec4 startRelativeToEye3D = czm_translateRelativeToEye(startHi_and_forwardOffsetX.xyz, startLo_and_forwardOffsetY.xyz);
    vec4 startRelativeToEye = czm_columbusViewMorph(startRelativeToEye2D, startRelativeToEye3D, czm_morphTime);
    vec3 ecStart = (czm_modelViewRelativeToEye * startRelativeToEye).xyz;

    vec4 endRelativeToEye2D = startRelativeToEye2D + vec4(0.0, offsetAndRight2D.xy, 0.0);
    vec4 endRelativeToEye3D = startRelativeToEye3D + vec4(startHi_and_forwardOffsetX.w, startLo_and_forwardOffsetY.w, startNormal_and_forwardOffsetZ.w, 0.0);
    vec4 endRelativeToEye = czm_columbusViewMorph(endRelativeToEye2D, endRelativeToEye3D, czm_morphTime);
    vec3 ecEnd = (czm_modelViewRelativeToEye * endRelativeToEye).xyz;

    // Start plane
    vec3 startPlaneDir2D = vec3(0.0, startEndNormals2D.xy);
    vec3 startPlaneDir3D = startNormal_and_forwardOffsetZ.xyz;
    vec3 startPlaneDirEC = czm_normal * morphNormal(startPlaneDir2D, startRelativeToEye2D, startPlaneDir3D, startRelativeToEye3D);
    v_startPlaneEC.xyz = startPlaneDirEC;
    v_startPlaneEC.w = -dot(startPlaneDirEC, ecStart);

    // End plane
    vec3 endPlaneDir2D = vec3(0.0, startEndNormals2D.zw);
    vec3 endPlaneDir3D = endNormal_andTextureCoordinateNormalizationX.xyz;
    vec3 endPlaneDirEC = czm_normal * morphNormal(endPlaneDir2D, endRelativeToEye2D, endPlaneDir3D, endRelativeToEye3D);
    v_endPlaneEC.xyz = endPlaneDirEC;
    v_endPlaneEC.w = -dot(endPlaneDirEC, ecEnd);

    // Right plane
    vec3 right2D = vec3(0.0, offsetAndRight2D.zw);
    vec3 right3D = rightNormal_andTextureCoordinateNormalizationY.xyz;
    vec3 rightEC = czm_normal * morphNormal(right2D, startRelativeToEye2D, right3D, startRelativeToEye3D);
    v_rightPlaneEC.xyz = rightEC;
    v_rightPlaneEC.w = -dot(rightEC, ecStart);

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
