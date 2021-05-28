uniform mat4 u_eyeSpaceToTangentSpace;
uniform vec4 u_boundingBoxXZ;
uniform vec2 u_boundingBoxMinMaxY;
uniform vec4 u_cascadesXZ[4];

uniform float u_fov;
uniform float u_aspectRatio;
uniform float u_frustumSseDenominator;
uniform float u_pixelRatioTimesMetersPerPixel;

uniform mat4 u_tangentSpaceToEyeSpace;

varying vec2 v_textureCoordinates;

float getCameraDistance(vec4 tangentPoint) {
  vec4 ec = u_tangentSpaceToEyeSpace * tangentPoint;
  ec /= ec.w;
  return abs(min(ec.z, 0.0));
}

float getFrustumHalfWidthAt(vec4 tangentPoint) {
  float dist = getCameraDistance(tangentPoint);
  float height = 2.0 * dist * tan(u_fov * 0.5);
  return height * u_aspectRatio * 0.5;
}

bool inBounds(vec4 tangentSpace) {
  return u_boundingBoxXZ.x <= tangentSpace.x && tangentSpace.x <= u_boundingBoxXZ.z &&
    u_boundingBoxXZ.y <= tangentSpace.z && tangentSpace.z <= u_boundingBoxXZ.w;
}

float logCascade(float breakIndex, float cameraNear, float cameraFar, float minZ, float maxZ) {
  float cameraRange = cameraFar - cameraNear;
  float cameraRatio = cameraFar / cameraNear;
  float lambda = 0.9;

  float p = breakIndex / 4.0;
  float logScale = cameraNear * pow(cameraRatio, p);
  float uniformScale = cameraNear + cameraRange * p;
  float cameraSplit = mix(uniformScale, logScale, lambda);
  float norm = (cameraSplit - cameraNear) / cameraRange;

  return mix(minZ, maxZ, norm);
}

void main()
{
  float dw = czm_viewport.z / float(SAMPLES_X - 1);
  float dh = czm_viewport.w / float(SAMPLES_Y - 1);

  float minX = czm_infinity;
  float minY = czm_infinity;
  float minZ = czm_infinity;
  float maxX = -czm_infinity;
  float maxY = -czm_infinity;
  float maxZ = -czm_infinity;

  float currentFrustumNumber = czm_currentAndNumberFrustums.x;
  float numberFrustums = czm_currentAndNumberFrustums.y;

  float samplesFound = 0.0;
  float averageInBoundsDepth = 0.0;
  float samplesInBounds = 0.0;

  for (int y = 0; y < SAMPLES_Y; y++) {
    for (int x = 0; x < SAMPLES_X; x++) {
      vec2 xy;
      xy.x = min(dw * float(x), czm_viewport.z);
      xy.y = min(dh * float(y), czm_viewport.w);
      vec2 uv;
      uv.x = xy.x / czm_viewport.z;
      uv.y = xy.y / czm_viewport.w;

      float logDepthOrDepth = czm_branchFreeTernary(czm_sceneMode == czm_sceneMode2D, 0.5, czm_unpackDepth(texture2D(czm_globeDepthTexture, uv)));

      samplesFound += czm_branchFreeTernary(logDepthOrDepth == 0.0, 0.0, 1.0);

      vec4 eyeCoordinate = czm_windowToEyeCoordinates(xy, logDepthOrDepth);
      eyeCoordinate /= eyeCoordinate.w;

      vec4 tangentSpace = u_eyeSpaceToTangentSpace * eyeCoordinate;
      tangentSpace /= tangentSpace.w;

      minX = min(tangentSpace.x, minX);
      minY = min(tangentSpace.y, minY);
      minZ = min(tangentSpace.z, minZ);
      maxX = max(tangentSpace.x, maxX);
      maxY = max(tangentSpace.y, maxY);
      maxZ = max(tangentSpace.z, maxZ);

      bool sampleInBounds = inBounds(tangentSpace);

      averageInBoundsDepth += czm_branchFreeTernary(sampleInBounds, abs(eyeCoordinate.z), 0.0);
      samplesInBounds += czm_branchFreeTernary(sampleInBounds, 1.0, 0.0);
    }
  }

  // Intersect with bounding box around the tile content
  minX = max(minX, u_boundingBoxXZ.x);
  minY = max(minY, u_boundingBoxMinMaxY.x);
  minZ = max(minZ, u_boundingBoxXZ.y);
  maxX = min(maxX, u_boundingBoxXZ.z);
  maxY = min(maxY, u_boundingBoxMinMaxY.y);
  maxZ = min(maxZ, u_boundingBoxXZ.w);

  bool allSamplesFound = samplesFound == float(SAMPLES_Y * SAMPLES_X);

  // Locations of cascade params in texture space:
  // 1 c2 c3
  // 0 c0 c1
  //   0  1
  float cascadeIndex = 0.0;
  cascadeIndex += czm_branchFreeTernary(gl_FragCoord.x <= 1.0, 0.0, 1.0);
  cascadeIndex += czm_branchFreeTernary(gl_FragCoord.y <= 1.0, 0.0, 2.0);

  if (2.0 < gl_FragCoord.x) {
    float distanceToTexCenter = averageInBoundsDepth / samplesInBounds;

    float texRadiusSampled = distance(vec2(minX, minZ), vec2(maxX, maxZ)) * 0.5;
    float texRadiusUniform = distance(u_boundingBoxXZ.xy, u_boundingBoxXZ.zw) * 0.5;
    float texRadius = czm_branchFreeTernary(allSamplesFound, texRadiusSampled, texRadiusUniform);

    float screenSpaceWidth = (texRadius * czm_viewport.w) / (distanceToTexCenter * u_frustumSseDenominator);
    screenSpaceWidth /= czm_pixelRatio;

    float texMetersSampled = ((maxZ - minZ) + (maxX - minX)) * 0.5;
    float texMetersUniform = u_boundingBoxXZ.z - u_boundingBoxXZ.x;
    texMetersUniform += u_boundingBoxXZ.w - u_boundingBoxXZ.y;
    texMetersUniform *= 0.5;

    float texMeters = czm_branchFreeTernary(allSamplesFound, texMetersSampled, texMetersUniform);

    float ratio = texMeters / screenSpaceWidth;
    ratio = czm_branchFreeTernary(samplesFound == 0.0, u_pixelRatioTimesMetersPerPixel, ratio);

    gl_FragColor = vec4(ratio);
    return;
  }

  if (!allSamplesFound) {
    vec4 cascadeBounds = u_cascadesXZ[0];
    cascadeBounds = czm_branchFreeTernary(cascadeIndex == 1.0, u_cascadesXZ[1], cascadeBounds);
    cascadeBounds = czm_branchFreeTernary(cascadeIndex == 2.0, u_cascadesXZ[2], cascadeBounds);
    cascadeBounds = czm_branchFreeTernary(cascadeIndex == 3.0, u_cascadesXZ[3], cascadeBounds);
    gl_FragColor = cascadeBounds;

    return;
  }

  // If all samples were found, override the cascades.
  float midY = (minY + maxY) * 0.5;

  float cameraNear = getCameraDistance(vec4(minX, midY, minZ, 1.0));
  float cameraFar = getCameraDistance(vec4(maxX, midY, maxZ, 1.0));

  minZ = logCascade(cascadeIndex, cameraNear, cameraFar, minZ, maxZ);
  maxZ = logCascade(cascadeIndex + 1.0, cameraNear, cameraFar, minZ, maxZ);

  float cameraPosTanX = (u_eyeSpaceToTangentSpace * vec4(0.0, 0.0, 0.0, 1.0)).x;
  float halfSubFrustumWidth = getFrustumHalfWidthAt(vec4(cameraPosTanX, midY, maxZ, 1.0));
  float camLeft = cameraPosTanX - halfSubFrustumWidth;
  float camRight = cameraPosTanX + halfSubFrustumWidth;

  minX = max(minX, camLeft);
  maxX = min(maxX, camRight);

  gl_FragColor = vec4(minX, minZ, maxX, maxZ);
}
