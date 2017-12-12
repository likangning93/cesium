#extension GL_EXT_frag_depth : enable

uniform sampler2D u_pointCloud_colorTexture;
uniform sampler2D u_pointCloud_ecTexture; // TODO: document that log2 depth is in alpha
uniform vec2 u_edlStrengthAndDistance;
varying vec2 v_textureCoordinates;

float neighborContribution(float log2Depth, vec2 texcoord)
{
    return max(0.0, log2Depth - texture2D(u_pointCloud_ecTexture, texcoord).a);
}

void main()
{
    // early termination
    vec4 color = texture2D(u_pointCloud_colorTexture, v_textureCoordinates);
    if (color.a == 0.0)
    {
        return;
    }

    vec4 ecAlphaDepth = texture2D(u_pointCloud_ecTexture, v_textureCoordinates);

    float log2Depth = ecAlphaDepth.a;

    // sample from neighbors up, down, left, right
    float edlStrength = u_edlStrengthAndDistance.x;
    float edlDistance = u_edlStrengthAndDistance.y;
    float padx = (1.0 / czm_viewport.z) * edlDistance;
    float pady = (1.0 / czm_viewport.w) * edlDistance;

    float response = 0.0;

    response += neighborContribution(log2Depth, v_textureCoordinates + vec2(0, pady));
    response += neighborContribution(log2Depth, v_textureCoordinates - vec2(0, pady));

    response += neighborContribution(log2Depth, v_textureCoordinates + vec2(padx, 0));
    response += neighborContribution(log2Depth, v_textureCoordinates - vec2(padx, 0));
    response /= 4.0;

    float shade = exp(-response * 300.0 * edlStrength);
    gl_FragColor = vec4(color.rgb * shade, color.a);
/*
    if (czm_equalsEpsilon(czm_currentFrustum.x, -ecAlphaDepth.z, 5.0)) {
        gl_FragColor = vec4(1.0, 0.0, 0.0, color.a);
    }

    if (czm_equalsEpsilon(czm_currentFrustum.y, -ecAlphaDepth.z, 5.0)) {
        gl_FragColor = vec4(0.0, 0.0, 1.0, color.a);
    }*/

    // write depth for camera/picking
    gl_FragDepthEXT = czm_eyeToWindowCoordinates(vec4(ecAlphaDepth.xyz, 1.0)).z;
}
