uniform sampler2D u_colorTexture;
uniform sampler2D u_depthTexture;
uniform vec2 u_scale;
uniform vec2 u_pixelOffset;
uniform vec4 u_planeEC;
uniform float u_ignoreHeight;

attribute vec2 tilePosition;

varying vec4 v_rgba;

vec3 toEye(vec2 uv, float depth)
{
   vec2 xy = vec2((uv.x * 2.0 - 1.0), ((1.0 - uv.y) * 2.0 - 1.0));
   vec4 posInCamera = czm_inverseProjection * vec4(xy, depth, 1.0);
   posInCamera = posInCamera / posInCamera.w;
   posInCamera.y = -posInCamera.y;
   return posInCamera.xyz;
}

void main()
{
    vec2 uv = (tilePosition + u_pixelOffset) * u_scale;

    uv.x = clamp(uv.x, 0.0, 1.0);
    uv.y = clamp(uv.y, 0.0, 1.0);

    vec3 positionEC = toEye(uv, czm_readDepth(u_depthTexture, uv));

    float distanceAbovePlane = czm_planeDistance(u_planeEC, positionEC) + u_planeEC.w; // dunno why this needs the extra add here but *it doooo* :(

    bool ignoreSample = distanceAbovePlane < u_ignoreHeight;

    vec4 rgba = texture2D(u_colorTexture, uv);
    rgba.a = czm_branchFreeTernary(ignoreSample, 0.0, rgba.a);

    v_rgba = rgba;

    // Reflect in eye space and re-project
    float displacementDistance = czm_branchFreeTernary(ignoreSample, 6378137.0, distanceAbovePlane + distanceAbovePlane);
    positionEC -= (displacementDistance * u_planeEC.xyz);
    gl_Position = czm_projection * vec4(positionEC, 1.0);
    gl_PointSize = 1.0;
}
