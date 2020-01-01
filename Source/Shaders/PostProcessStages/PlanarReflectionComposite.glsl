uniform sampler2D u_colorTexture;
uniform sampler2D u_mirrorColorTexture;
varying vec2 v_textureCoordinates;

void main() {
    vec4 mirrorColor = texture2D(u_mirrorColorTexture, v_textureCoordinates);
    vec4 color = texture2D(u_colorTexture, v_textureCoordinates);
    gl_FragColor = mirrorColor * (mirrorColor.a) + color * (1.0 - mirrorColor.a);
}
