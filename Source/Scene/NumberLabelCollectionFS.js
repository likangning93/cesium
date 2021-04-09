/*eslint-disable*/
export default `
uniform sampler2D u_glyphs;
uniform vec4 u_backgroundColor;

varying vec2 v_texcoords;

//varying float v_position;

void main() {
  bool texcoordsInBounds = 0.0 <= v_texcoords.x && v_texcoords.x <= 1.0;
  texcoordsInBounds = texcoordsInBounds && 0.0 <= v_texcoords.y && v_texcoords.y <= 1.0;

  vec4 tex = czm_branchFreeTernary(texcoordsInBounds, texture2D(u_glyphs, v_texcoords), vec4(0.0));
  gl_FragColor = vec4(tex.rgb * tex.a, 0.0) + u_backgroundColor;

  //gl_FragColor.r = v_position /3.0;
}
`;
