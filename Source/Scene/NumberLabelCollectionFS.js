/*eslint-disable*/
export default `
uniform sampler2D u_glyphs;

varying vec2 v_texcoords;

void main() {
  gl_FragColor = texture2D(u_glyphs, v_texcoords);
}
`;
