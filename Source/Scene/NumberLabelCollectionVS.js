/*eslint-disable*/
export default `
uniform vec2 u_glyphDimensions;
uniform vec2 u_glyphPixelSize;

attribute float position;
attribute float batchId;

varying vec2 v_texcoords;
//varying float v_position;

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

  v_texcoords = vec2((characterId + vertexOffset.x) / ALLOWED_CHARS_LENGTH, vertexOffset.y);
  v_texcoords.x -= u_glyphPixelSize.x;
  // scale and translate Y texcoords a bit so there's a bit of vertical padding
  v_texcoords.y *= ((u_glyphDimensions.y + 4.0) / (u_glyphDimensions.y));
  v_texcoords.y -= u_glyphPixelSize.y * 2.0;

  //v_position = position;

  vertexOffset.x = (vertexOffset.x + characterLeftAlign) * u_glyphDimensions.x;
  vertexOffset.y = vertexOffset.y * u_glyphDimensions.y;

  mat2 rotation = mat2(labelRotation.x, labelRotation.y, -labelRotation.y, labelRotation.x);
  pos3D.xy += vertexOffset * rotation;

  gl_Position = czm_modelViewProjection * vec4(pos3D, 1.0);
}
`;
