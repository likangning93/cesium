uniform sampler2D u_colorTexture;
uniform mat4 u_eyeSpaceToTangentSpace;
uniform highp sampler2D u_boundsTexture;

varying vec2 v_textureCoordinates;

bool inCascade(vec4 tangentPos, vec4 cascade) {
  return cascade.x <= tangentPos.x && tangentPos.x <= cascade.z &&
    cascade.y <= tangentPos.z && tangentPos.z <= cascade.w;
}

void main()
{
  float logDepthOrDepth = czm_branchFreeTernary(czm_sceneMode == czm_sceneMode2D, gl_FragCoord.z, czm_unpackDepth(texture2D(czm_globeDepthTexture, v_textureCoordinates)));

  // Discard for sky
  if (logDepthOrDepth == 0.0) {
    discard;
  }

  // Cascade data locations in texture space
  // 1 c2 c3
  // 0 c0 c1
  //   0  1
  vec4 cascades[4];
  cascades[0] = texture2D(u_boundsTexture, vec2(0.125, 0.125));
  cascades[1] = texture2D(u_boundsTexture, vec2(0.375, 0.125));
  cascades[2] = texture2D(u_boundsTexture, vec2(0.125, 0.375));
  cascades[3] = texture2D(u_boundsTexture, vec2(0.375, 0.375));

  vec4 eyeCoordinate = czm_windowToEyeCoordinates(gl_FragCoord.xy, logDepthOrDepth);
  eyeCoordinate /= eyeCoordinate.w;

  vec4 tangentSpace = u_eyeSpaceToTangentSpace * eyeCoordinate;
  tangentSpace /= tangentSpace.w;

  // Compute which cascade the tangentSpace point is in
  int cascadeIndex = -1;
  vec4 cascade;
  for (int i = 0; i < 4; i++) {
    cascadeIndex = czm_branchFreeTernary(inCascade(tangentSpace, cascades[i]), i, cascadeIndex);
    cascade = czm_branchFreeTernary(cascadeIndex == i, cascades[i], cascade);
  }

  vec2 offset;
  offset.x = mod(float(cascadeIndex), 2.0) - 0.5;
  offset.y = czm_branchFreeTernary(cascadeIndex < 2, -0.5, 0.5);

  vec2 textureSpace;
  float minX = cascade.x;
  float minZ = cascade.y;

  textureSpace.x = (tangentSpace.x - minX) / (cascade.z - minX);
  textureSpace.y = (tangentSpace.z - minZ) / (cascade.w - minZ);

  if (textureSpace.x < 0.0 || 1.0 < textureSpace.x ||
      textureSpace.y < 0.0 || 1.0 < textureSpace.y) {
  #ifdef DEBUG_SHOW_TEXTURE_COORDINATES
    tangentSpace.w = 0.2;
  #else
    discard;
  #endif
  }

  vec2 cascadeTexcoord = textureSpace;

  // Scale down to 1/2
  cascadeTexcoord *= 0.5;

  // shift over to the correct location in texture
  cascadeTexcoord += (offset + vec2(0.5, 0.5)) * 0.5;

  #ifdef DEBUG_SHOW_TEXTURE_COORDINATES
  vec2 uv = textureSpace;
  uv.x = floor(uv.x * 10.0) / 10.0;
  uv.y = floor(uv.y * 10.0) / 10.0;
  float cascadeColor = float(cascadeIndex) / 4.0;
  gl_FragColor = texture2D(u_colorTexture, cascadeTexcoord) + vec4(uv, cascadeColor, tangentSpace.w);
  #else
  gl_FragColor = texture2D(u_colorTexture, cascadeTexcoord);
  #endif

  #ifdef DEBUG_SHOW_INTERMEDIATE_TEXTURE
  float currentFrustum = czm_currentAndNumberFrustums.x;
  vec2 start;
  vec2 end;

  float viewportWidth = czm_viewport.z;
  float viewportHeight = czm_viewport.w;
  float quarterHeight = viewportHeight / 4.0;

  if (currentFrustum == 0.0) {
    start = vec2(viewportWidth - quarterHeight, 0.0);
  }
  if (currentFrustum == 1.0) {
    start = vec2(viewportWidth - quarterHeight, quarterHeight);
  }
  if (currentFrustum == 2.0) {
    start = vec2(viewportWidth - quarterHeight, 2.0 * quarterHeight);
  }

  end = start + vec2(quarterHeight, quarterHeight);

  if (start.x < gl_FragCoord.x && gl_FragCoord.x < end.x &&
      start.y < gl_FragCoord.y && gl_FragCoord.y < end.y) {
    float u = (gl_FragCoord.x - start.x) / quarterHeight;
    float v = 1.0 - ((gl_FragCoord.y - start.y) / quarterHeight);
    vec4 color = texture2D(u_colorTexture, vec2(u, v));
    color.a = 1.0;
    gl_FragColor = color;
  }

  #endif
}
