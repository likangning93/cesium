#ifdef GL_EXT_frag_depth
#extension GL_EXT_frag_depth : enable
#endif

varying vec3 v_ecStart;
varying vec3 v_ecEnd;
varying vec3 v_ecNormal;

void main(void)
{
    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
    czm_writeDepthClampedToFarPlane();
}
