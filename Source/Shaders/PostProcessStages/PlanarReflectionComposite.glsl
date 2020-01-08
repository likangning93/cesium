uniform sampler2D u_colorTexture;
uniform sampler2D u_depthTexture;
uniform sampler2D u_mirrorColorTexture;
varying vec2 v_textureCoordinates;
uniform vec4 u_planeEC;
uniform float u_ignoreHeight;
uniform float u_reflectionBlendAmount;

vec3 toEye(vec2 uv, float depth)
{
   vec2 xy = vec2((uv.x * 2.0 - 1.0), ((1.0 - uv.y) * 2.0 - 1.0));
   vec4 posInCamera = czm_inverseProjection * vec4(xy, depth, 1.0);
   posInCamera = posInCamera / posInCamera.w;
   posInCamera.y = -posInCamera.y;
   return posInCamera.xyz;
}

void main() {
    vec3 scenePositionEC = toEye(v_textureCoordinates, czm_readDepth(u_depthTexture, v_textureCoordinates));

    float distanceAbovePlane = czm_planeDistance(u_planeEC, scenePositionEC) + u_planeEC.w;

    vec4 mirrorColor = texture2D(u_mirrorColorTexture, v_textureCoordinates);

    mirrorColor.a = czm_branchFreeTernary(distanceAbovePlane > u_ignoreHeight, 0.0, mirrorColor.a);

    vec4 sourceColor = texture2D(u_colorTexture, v_textureCoordinates);
    mirrorColor = mirrorColor * (mirrorColor.a) + sourceColor * (1.0 - mirrorColor.a);

    gl_FragColor = sourceColor * (1.0 - u_reflectionBlendAmount) + (mirrorColor * u_reflectionBlendAmount);
}
