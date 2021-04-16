/*eslint-disable*/
export default `
uniform vec2 u_glyphPixelSize;
uniform vec2 u_singlePixelSize;

attribute float position;
attribute float batchId;

varying vec2 v_texcoords;
//varying float v_position;
//varying vec3 v_pointNormalEC;

const float SHIFT_RIGHT1 = 1.0 / 2.0;

void main() {
  float characterId = czm_batchTable_characterId(batchId);
  vec2 characterBottomLeftAlign = czm_batchTable_characterBottomLeftAlign(batchId);
  vec2 labelRotation = czm_batchTable_labelRotation(batchId);
  vec3 pos3D = czm_batchTable_labelTranslationFromCenter(batchId);

  vec4 pos3dEC = czm_modelView * vec4(pos3D, 1.0);
  float metersPerPixel = max(0.0, czm_metersPerPixel(pos3dEC));

  vec3 pointNormalEC = czm_normal * vec3(0.0, 0.0, 1.0);
  float xyMagnitude = length(pointNormalEC.xy);
  bool towardsCamera = xyMagnitude > abs(pointNormalEC.z);

  //v_pointNormalEC = pointNormalEC;

  // Figure out where this vertex goes in the glyph card
  // 1--3  // 0 - 00 - lower left
  // |\ |  // 1 - 01 - upper left
  // | \|  // 2 - 10 - lower right
  // 0--2  // 3 - 11 - upper right
  vec3 vertexOffset;
  vertexOffset.x = floor(position * SHIFT_RIGHT1);
  vertexOffset.y = position - (2.0 * floor(position / 2.0)); // modulo

  v_texcoords = vec2((characterId + vertexOffset.x) / ALLOWED_CHARS_LENGTH, vertexOffset.y);
  v_texcoords.x -= u_singlePixelSize.x;
  // scale and translate Y texcoords a bit so there's a bit of vertical padding
  v_texcoords.y *= ((u_glyphPixelSize.y + 4.0) / (u_glyphPixelSize.y));
  v_texcoords.y -= u_singlePixelSize.y * 2.0;

  //v_position = position;

  vertexOffset.x = (vertexOffset.x + characterBottomLeftAlign.x) * u_glyphPixelSize.x * metersPerPixel;

  float yOffset = (characterBottomLeftAlign.y * 0.5) - 0.5;
  vertexOffset.y = (vertexOffset.y + yOffset) * u_glyphPixelSize.y * metersPerPixel;

  if (towardsCamera) {
    vertexOffset.z = vertexOffset.y;
    vertexOffset.y = 0.0;
  }

  mat2 rotation = mat2(labelRotation.x, labelRotation.y, -labelRotation.y, labelRotation.x);

  vertexOffset.xy = rotation * vertexOffset.xy;
  pos3D += vertexOffset;

  gl_Position = czm_modelViewProjection * vec4(pos3D, 1.0);
}
`;
