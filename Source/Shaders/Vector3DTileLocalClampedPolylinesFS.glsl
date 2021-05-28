uniform vec4 u_highlightColor;

varying vec4 v_textureViewportCorners;

void main()
{
    float x = gl_FragCoord.x;
    float y = gl_FragCoord.y;

    bool outOfBounds = x < v_textureViewportCorners.x ||
        y < v_textureViewportCorners.y ||
        v_textureViewportCorners.z < x ||
        v_textureViewportCorners.w < y;

    vec4 color = u_highlightColor;
    color.a = czm_branchFreeTernary(outOfBounds, 0.0, color.a);

    gl_FragColor = color;
}
