uniform mat4 u_modifiedModelViewProjection;

attribute vec3 position;

void main() {
    gl_Position = u_modifiedModelViewProjection * vec4(position, 1.0);
}
