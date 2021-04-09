/*eslint-disable*/
export default `
uniform vec2 u_glyphDimensions;

attribute float position;
attribute float batchId;

varying vec2 v_texcoords;

const float SHIFT_RIGHT1 = 1.0 / 2.0;

void main() {
  float characterId = czm_batchTable_characterId(batchId);
  float characterLeftAlign = czm_batchTable_characterLeftAlign(batchId);
  vec2 labelRotation = czm_batchTable_labelRotation(batchId);
  vec3 pos3D = czm_batchTable_labelTranslationFromCenter(batchId);

  // Figure out where this vertex goes in the glyph card
  // 1--3  // 0 - 00 - lower left
  // |\ |  // 1 - 01 - upper left
  // | \|  // 2 - 10 - lower right
  // 0--2  // 3 - 11 - upper right
  vec2 vertexOffset;
  vertexOffset.x = floor(position * SHIFT_RIGHT1);
  vertexOffset.y = position - (2.0 * floor(position / 2.0)); // modulo

  pos3D.x += (vertexOffset.x + characterLeftAlign) * u_glyphDimensions.x;
  pos3D.y += vertexOffset.y * u_glyphDimensions.y;
  mat2 rotation = mat2(labelRotation.x, labelRotation.y, -labelRotation.y, labelRotation.x);
  pos3D.xy *= rotation;

  v_texcoords = vec2((characterId + vertexOffset.x) / ALLOWED_CHARS_LENGTH, vertexOffset.y);

  // TODO: if it's a space, throw the geometry out

  gl_Position = czm_modelViewProjection * vec4(pos3D, 1.0);
}
`;
