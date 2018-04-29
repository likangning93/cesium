define([
        '../Core/Cartographic',
        '../Core/Cartesian2',
        '../Core/Cartesian3',
        '../Core/Math',
        '../Core/Check',
        '../Core/ComponentDatatype',
        '../Core/defaultValue',
        '../Core/defined',
        '../Core/defineProperties',
        '../Core/Ellipsoid',
        '../Core/EncodedCartesian3',
        '../Core/GeometryInstanceAttribute',
        '../Core/Matrix2',
        '../Core/Matrix4',
        '../Core/Plane',
        '../Core/Rectangle',
        '../Core/Transforms',
        '../Renderer/ShaderSource',
        '../Scene/PerInstanceColorAppearance'
], function(
        Cartographic,
        Cartesian2,
        Cartesian3,
        CesiumMath,
        Check,
        ComponentDatatype,
        defaultValue,
        defined,
        defineProperties,
        Ellipsoid,
        EncodedCartesian3,
        GeometryInstanceAttribute,
        Matrix2,
        Matrix4,
        Plane,
        Rectangle,
        Transforms,
        ShaderSource,
        PerInstanceColorAppearance) {
    'use strict';

    /**
     * Creates shaders for a ClassificationPrimitive to use a given Appearance, as well as for picking.
     *
     * @param {Boolean} extentsCulling Discard fragments outside the instance's texture coordinate extents.
     * @param {Boolean} planarExtents If true, texture coordinates will be computed using planes instead of spherical coordinates.
     * @param {Appearance} appearance An Appearance to be used with a ClassificationPrimitive via GroundPrimitive.
     * @private
     */
    function ShadowVolumeAppearance(extentsCulling, planarExtents, appearance) {
        //>>includeStart('debug', pragmas.debug);
        Check.typeOf.bool('extentsCulling', extentsCulling);
        Check.typeOf.bool('planarExtents', planarExtents);
        Check.typeOf.object('appearance', appearance);
        //>>includeEnd('debug');

        // Compute shader dependencies
        var shaderDependencies = new ShaderDependencies();
        shaderDependencies.requiresTextureCoordinates = extentsCulling;
        shaderDependencies.requiresEC = !appearance.flat;

        if (appearance instanceof PerInstanceColorAppearance) {
            // PerInstanceColorAppearance doesn't have material.shaderSource, instead it has its own vertex and fragment shaders
            shaderDependencies.requiresNormalEC = !appearance.flat;
        } else {
            // Scan material source for what hookups are needed. Assume czm_materialInput materialInput.
            var materialShaderSource = appearance.material.shaderSource + '\n' + appearance.fragmentShaderSource;

            shaderDependencies.normalEC = materialShaderSource.includes('materialInput.normalEC') || materialShaderSource.includes('czm_getDefaultMaterial');
            shaderDependencies.positionToEyeEC = materialShaderSource.includes('materialInput.positionToEyeEC');
            shaderDependencies.tangentToEyeMatrix = materialShaderSource.includes('materialInput.tangentToEyeMatrix');
            shaderDependencies.st = materialShaderSource.includes('materialInput.st');
        }

        this._shaderDependencies = shaderDependencies;
        this._appearance = appearance;
        this._extentsCulling = extentsCulling;
        this._planarExtents = planarExtents;
    }

    /**
     * Create the fragment shader for a ClassificationPrimitive's color pass when rendering for color.
     *
     * @param {Boolean} columbusView2D Whether the shader will be used for Columbus View or 2D.
     * @returns {String} Shader source for the fragment shader including its material.
     */
    ShadowVolumeAppearance.prototype.createAppearanceFragmentShader = function(columbusView2D) {
        //>>includeStart('debug', pragmas.debug);
        Check.typeOf.bool('columbusView2D', columbusView2D);
        //>>includeEnd('debug');

        var appearance = this._appearance;
        var materialHookups = createShadowVolumeAppearanceFS(this._shaderDependencies, appearance, this._extentsCulling, this._planarExtents, columbusView2D);
        if (appearance instanceof PerInstanceColorAppearance) {
            return materialHookups;
        }
        return appearance.material.shaderSource + '\n' + materialHookups;
    };

    /**
     * Create the fragment shader for a ClassificationPrimitive's color pass when rendering for pick.
     *
     * @param {Boolean} columbusView2D Whether the shader will be used for Columbus View or 2D.
     * @returns {String} Shader source for the fragment shader.
     */
    ShadowVolumeAppearance.prototype.createPickingFragmentShader = function(columbusView2D) {
        //>>includeStart('debug', pragmas.debug);
        Check.typeOf.bool('columbusView2D', columbusView2D);
        //>>includeEnd('debug');

        return getPickShaderFS(this._extentsCulling, this._planarExtents, columbusView2D);
    };

    /**
     * Create the vertex shader for a ClassificationPrimitive's color pass, both when rendering for color and for pick.
     *
     * @param {String} vertexShaderSource Vertex shader source.
     * @param {Boolean} columbusView2D Whether the shader will be used for Columbus View or 2D.
     * @returns {String} Shader source for the vertex shader.
     */
    ShadowVolumeAppearance.prototype.createVertexShader = function(vertexShaderSource, columbusView2D) {
        //>>includeStart('debug', pragmas.debug);
        Check.typeOf.string('vertexShaderSource', vertexShaderSource);
        Check.typeOf.bool('columbusView2D', columbusView2D);
        //>>includeEnd('debug');

        return createShadowVolumeAppearanceVS(this._shaderDependencies, this._appearance, this._planarExtents, columbusView2D, vertexShaderSource);
    };

    function getTexcoordVaryings(planarExtents, columbusView2D) {
        var glsl = '';
        if (columbusView2D) {
            glsl +=
                'varying vec2 v_inversePlaneExtents;\n' +
                'varying vec4 v_westPlane;\n' +
                'varying vec4 v_southPlane;\n';
        } else if (planarExtents) {
            glsl +=
                'varying vec4 v_northPlane;\n' +
                'varying vec4 v_southPlane;\n' +
                'varying vec4 v_eastPlane;\n' +
                'varying vec4 v_westPlane;\n';
        } else {
            glsl +=
                'varying vec4 v_sphericalExtents;\n';
        }
        return glsl;
    }

    function createShadowVolumeAppearanceFS(shaderDependencies, appearance, extentsCull, planarExtents, columbusView2D) {
        if (appearance instanceof PerInstanceColorAppearance) {
            return getPerInstanceColorShaderFS(shaderDependencies, extentsCull, appearance.flat, planarExtents, columbusView2D);
        }

        var usesNormalEC = shaderDependencies.normalEC;
        var usesPositionToEyeEC = shaderDependencies.positionToEyeEC;
        var usesTangentToEyeMat = shaderDependencies.tangentToEyeMatrix;
        var usesSt = shaderDependencies.st;

        var glsl =
            '#ifdef GL_EXT_frag_depth\n' +
            '#extension GL_EXT_frag_depth : enable\n' +
            '#endif\n';
        if (extentsCull || usesSt) {
            glsl += getTexcoordVaryings(planarExtents, columbusView2D);
        }
        if (usesSt) {
            glsl +=
                'varying vec4 v_stSineCosineUVScale;\n';
        }

        // Get local functions
        glsl += getLocalFunctionsFS(shaderDependencies, planarExtents, columbusView2D);

        glsl +=
            'void main(void)\n' +
            '{\n';

        // Compute material input stuff and cull if outside texture coordinate extents
        glsl += getDependenciesAndCullingFS(shaderDependencies, extentsCull, planarExtents, columbusView2D);

        glsl += '    czm_materialInput materialInput;\n';
        if (usesNormalEC) {
            glsl += '    materialInput.normalEC = normalEC;\n';
        }
        if (usesPositionToEyeEC) {
            glsl += '    materialInput.positionToEyeEC = -eyeCoordinate.xyz;\n';
        }
        if (usesTangentToEyeMat) {
            glsl += '    materialInput.tangentToEyeMatrix = czm_eastNorthUpToEyeCoordinates(worldCoordinate, normalEC);\n';
        }
        if (usesSt) {
            // Scale texture coordinates and rotate around 0.5, 0.5
            glsl +=
                '    materialInput.st.x = v_stSineCosineUVScale.y * (v - 0.5) * v_stSineCosineUVScale.z + v_stSineCosineUVScale.x * (u - 0.5) * v_stSineCosineUVScale.w + 0.5;\n' +
                '    materialInput.st.y = v_stSineCosineUVScale.y * (u - 0.5) * v_stSineCosineUVScale.w - v_stSineCosineUVScale.x * (v - 0.5) * v_stSineCosineUVScale.z + 0.5;\n';
        }
        glsl += '    czm_material material = czm_getMaterial(materialInput);\n';

        if (appearance.flat) {
            glsl += '    gl_FragColor = vec4(material.diffuse + material.emission, material.alpha);\n';
        } else {
            glsl += '    gl_FragColor = gl_FragCoord.x / czm_viewport.z > 0.5 ? vec4(u, 0.0, 0.0, 1.0) : czm_phong(normalize(-eyeCoordinate.xyz), material); //vec4(u, v, 0.0, 1.0);\n';
        }
        glsl += '    czm_writeDepthClampedToFarPlane();\n';
        glsl += '}\n';
        return glsl;
    }

    var pickingShaderDependenciesScratch = new ShaderDependencies();
    function getPickShaderFS(extentsCulling, planarExtents, columbusView2D) {
        var glsl =
            '#ifdef GL_EXT_frag_depth\n' +
            '#extension GL_EXT_frag_depth : enable\n' +
            '#endif\n';
        if (extentsCulling) {
            glsl += getTexcoordVaryings(planarExtents, columbusView2D);
        }
        var shaderDependencies = pickingShaderDependenciesScratch;
        shaderDependencies.reset();
        shaderDependencies.requiresTextureCoordinates = extentsCulling;
        shaderDependencies.requiresNormalEC = false;

        glsl += getLocalFunctionsFS(shaderDependencies, planarExtents, columbusView2D);

        glsl += 'void main(void)\n' +
                '{\n';
        glsl += '    bool culled = false;\n';
        var outOfBoundsSnippet =
                '        culled = true;\n';
        glsl += getDependenciesAndCullingFS(shaderDependencies, extentsCulling, planarExtents, columbusView2D, outOfBoundsSnippet);
        glsl += '    if (!culled) {\n' +
                '        gl_FragColor.a = 1.0;\n' + // 0.0 alpha leads to discard from ShaderSource.createPickFragmentShaderSource
                '        czm_writeDepthClampedToFarPlane();\n' +
                '    }\n' +
                '}\n';
        return glsl;
    }

    function getPerInstanceColorShaderFS(shaderDependencies, extentsCulling, flatShading, planarExtents, columbusView2D) {
        var glsl =
            '#ifdef GL_EXT_frag_depth\n' +
            '#extension GL_EXT_frag_depth : enable\n' +
            '#endif\n' +
            'varying vec4 v_color;\n';
        if (extentsCulling) {
            glsl += getTexcoordVaryings(planarExtents, columbusView2D);
        }

        glsl += getLocalFunctionsFS(shaderDependencies, planarExtents, columbusView2D);

        glsl += 'void main(void)\n' +
                '{\n';

        glsl += getDependenciesAndCullingFS(shaderDependencies, extentsCulling, planarExtents, columbusView2D);

        if (flatShading) {
            glsl +=
                '    gl_FragColor = v_color;\n';
        } else {
            glsl +=
                '    czm_materialInput materialInput;\n' +
                '    materialInput.normalEC = normalEC;\n' +
                '    materialInput.positionToEyeEC = -eyeCoordinate.xyz;\n' +
                '    czm_material material = czm_getDefaultMaterial(materialInput);\n' +
                '    material.diffuse = v_color.rgb;\n' +
                '    material.alpha = v_color.a;\n' +

                '    gl_FragColor = czm_phong(normalize(-eyeCoordinate.xyz), material);\n';
        }
        glsl += '    czm_writeDepthClampedToFarPlane();\n';
        glsl += '}\n';
        return glsl;
    }

    function getDependenciesAndCullingFS(shaderDependencies, extentsCulling, planarExtents, columbusView2D, outOfBoundsSnippet) {
        var glsl = '';
        if (shaderDependencies.requiresEC) {
            glsl +=
                '    vec4 eyeCoordinate = getEyeCoordinate(gl_FragCoord.xy);\n';
        }
        if (shaderDependencies.requiresWC) {
            glsl +=
                '    vec4 worldCoordinate4 = czm_inverseView * eyeCoordinate;\n' +
                '    vec3 worldCoordinate = worldCoordinate4.xyz / worldCoordinate4.w;\n';
        }
        if (shaderDependencies.requiresTextureCoordinates) {
            if (columbusView2D) {
                glsl +=
                '    // Unpack planes and transform to eye space\n' + // TODO update comments...
                '    float u = computePlanarTextureCoordinates(v_southPlane, eyeCoordinate.xyz / eyeCoordinate.w, v_inversePlaneExtents.y);\n' +
                '    float v = computePlanarTextureCoordinates(v_westPlane, eyeCoordinate.xyz / eyeCoordinate.w, v_inversePlaneExtents.x);\n';
            } else if (planarExtents) {
                glsl +=
                '    // Unpack planes and transform to eye space\n' +
                '    float u = computePlanarTextureCoordinates(v_southPlane, v_northPlane, eyeCoordinate.xyz / eyeCoordinate.w);\n' +
                '    float v = computePlanarTextureCoordinates(v_westPlane, v_eastPlane, eyeCoordinate.xyz / eyeCoordinate.w);\n';
            } else {
                glsl +=
                '    // Treat world coords as a sphere normal for spherical coordinates\n' +
                '    vec2 sphericalLatLong = czm_approximateSphericalCoordinates(worldCoordinate);\n' +
                '    float u = (sphericalLatLong.x - v_sphericalExtents.x) * v_sphericalExtents.z;\n' +
                '    float v = (sphericalLatLong.y - v_sphericalExtents.y) * v_sphericalExtents.w;\n';
            }
        }
        if (extentsCulling) {
            if (!defined(outOfBoundsSnippet)) {
                outOfBoundsSnippet =
                '        gl_FragColor = vec4(0.0, 0.0, 1.0, 1.0); return;//discard;\n';
            }
            glsl +=
                '    if (u <= 0.0 || 1.0 <= u || v <= 0.0 || 1.0 <= v) {\n' +
                    outOfBoundsSnippet +
                '    }\n';
        }
        // Lots of texture access, so lookup after discard check
        if (shaderDependencies.requiresNormalEC) {
            glsl +=
                '    // compute normal. sample adjacent pixels in 2x2 block in screen space\n' +
                '    vec3 downUp = getVectorFromOffset(eyeCoordinate, gl_FragCoord.xy, vec2(0.0, 1.0));\n' +
                '    vec3 leftRight = getVectorFromOffset(eyeCoordinate, gl_FragCoord.xy, vec2(1.0, 0.0));\n' +
                '    vec3 normalEC = normalize(cross(leftRight, downUp));\n' +
                '\n';
        }
        return glsl;
    }

    function getLocalFunctionsFS(shaderDependencies, planarExtents, columbusView2D) {
        var glsl = '';
        if (shaderDependencies.requiresEC || shaderDependencies.requiresNormalEC) {
            glsl +=
                'vec4 windowToEyeCoordinates(vec2 xy, float depthOrLogDepth) {\n' +
                // See reverseLogDepth.glsl. This is separate to re-use the pow.
                '#ifdef LOG_DEPTH\n' +
                '    float near = czm_currentFrustum.x;\n' +
                '    float far = czm_currentFrustum.y;\n' +
                '    float unscaledDepth = pow(2.0, depthOrLogDepth * czm_log2FarPlusOne) - 1.0;\n' +
                '    vec4 windowCoord = vec4(xy, far * (1.0 - near / unscaledDepth) / (far - near), 1.0);\n' +
                '    vec4 eyeCoordinate = czm_windowToEyeCoordinates(windowCoord);\n' +
                '    eyeCoordinate.w = 1.0 / unscaledDepth;\n' + // Better precision
                '#else\n' +
                '    vec4 windowCoord = vec4(xy, depthOrLogDepth, 1.0);\n' +
                '    vec4 eyeCoordinate = czm_windowToEyeCoordinates(windowCoord);\n' +
                '#endif\n' +
                '    return eyeCoordinate;\n' +
                '}\n';
        }
        if (shaderDependencies.requiresEC) {
            glsl +=
                'vec4 getEyeCoordinate(vec2 fragCoord) {\n' +
                '    vec2 coords = fragCoord / czm_viewport.zw;\n' +
                '    float logDepthOrDepth = czm_unpackDepth(texture2D(czm_globeDepthTexture, coords));\n' +
                '    return windowToEyeCoordinates(fragCoord, logDepthOrDepth);\n' +
                '}\n';
        }
        if (shaderDependencies.requiresNormalEC) {
            glsl +=
                'vec3 getEyeCoordinate3FromWindowCoordinate(vec2 fragCoord, float logDepthOrDepth) {\n' +
                '    vec4 eyeCoordinate = windowToEyeCoordinates(fragCoord, logDepthOrDepth);\n' +
                '    return eyeCoordinate.xyz / eyeCoordinate.w;\n' +
                '}\n' +

                'vec3 getVectorFromOffset(vec4 eyeCoordinate, vec2 glFragCoordXY, vec2 positiveOffset) {\n' +
                '    // Sample depths at both offset and negative offset\n' +
                '    float upOrRightLogDepth = czm_unpackDepth(texture2D(czm_globeDepthTexture, (glFragCoordXY + positiveOffset) / czm_viewport.zw));\n' +
                '    float downOrLeftLogDepth = czm_unpackDepth(texture2D(czm_globeDepthTexture, (glFragCoordXY - positiveOffset) / czm_viewport.zw));\n' +
                '    // Explicitly evaluate both paths\n' + // Necessary for multifrustum and for GroundPrimitives at the edges of the screen
                '    bvec2 upOrRightInBounds = lessThan(glFragCoordXY + positiveOffset, czm_viewport.zw);\n' +
                '    float useUpOrRight = float(upOrRightLogDepth > 0.0 && upOrRightInBounds.x && upOrRightInBounds.y);\n' +
                '    float useDownOrLeft = float(useUpOrRight == 0.0);\n' +
                '    vec3 upOrRightEC = getEyeCoordinate3FromWindowCoordinate(glFragCoordXY + positiveOffset, upOrRightLogDepth);\n' +
                '    vec3 downOrLeftEC = getEyeCoordinate3FromWindowCoordinate(glFragCoordXY - positiveOffset, downOrLeftLogDepth);\n' +

                '    return (upOrRightEC - (eyeCoordinate.xyz / eyeCoordinate.w)) * useUpOrRight + ((eyeCoordinate.xyz / eyeCoordinate.w) - downOrLeftEC) * useDownOrLeft;\n' +
                '}\n';
        }
        if (shaderDependencies.requiresTextureCoordinates && columbusView2D) {
            // 2D planar case just requires distance to a single plane
            glsl +=
                'float computePlanarTextureCoordinates(vec4 plane, vec3 eyeCoordinates, float inverseExtent) {\n' +
                '    return (dot(plane.xyz, eyeCoordinates) + plane.w) * inverseExtent;\n' +
                '}\n';
        } else if (shaderDependencies.requiresTextureCoordinates && planarExtents) {
            // 3D planar case requires distance to a pair of planes centered at the origin of CBF
            // compute distance to each plane, then compute 0-1 range as dist0 / (dist0 + dist1)
            glsl +=
                'float computePlanarTextureCoordinates(vec4 plane0, vec4 plane1, vec3 eyeCoordinates) {\n' +
                '    float distance0 = dot(plane0.xyz, eyeCoordinates) + plane0.w;\n' +
                '    return distance0 / (distance0 + dot(plane1.xyz, eyeCoordinates) + plane1.w);\n' +
                '}\n';
        }
        return glsl;
    }

    function createShadowVolumeAppearanceVS(shaderDependencies, appearance, planarExtents, columbusView2D, shadowVolumeVS) {
        var glsl = ShaderSource.replaceMain(shadowVolumeVS, 'computePosition');

        var isPerInstanceColor = defined(appearance) && appearance instanceof PerInstanceColorAppearance;
        if (isPerInstanceColor) {
            glsl += 'varying vec4 v_color;\n';
        }

        if (shaderDependencies.requiresTextureCoordinates) {
            glsl += getTexcoordVaryings(planarExtents, columbusView2D);
            glsl += 'varying vec4 v_stSineCosineUVScale;\n';
        }

        glsl +=
            'void main()\n' +
            '{\n' +
            '   computePosition();\n';
        if (isPerInstanceColor) {
            glsl += 'v_color = czm_batchTable_color(batchId);\n';
        }

        // Add code for computing texture coordinate dependencies
        if (shaderDependencies.requiresTextureCoordinates) {
            // Two varieties of planar texcoords
            if (columbusView2D) {
                // 2D/CV case is in a 2D plane and thus only needs two planes, but may have very large "plane extents,"
                // so planes and distances encoded as 3 64 bit positions,
                // which in 2D can be encoded as 2 64 bit vec2s.
                glsl +=
                    'vec4 planes2D_high = czm_batchTable_planes2D_HIGH(batchId);\n' +
                    'vec4 planes2D_low = czm_batchTable_planes2D_LOW(batchId);\n' +
                    'vec3 southWestCorner = (czm_modelViewRelativeToEye * czm_translateRelativeToEye(vec3(0.0, planes2D_high.xy), vec3(0.0, planes2D_low.xy))).xyz;\n' +
                    'vec3 northWestCorner = (czm_modelViewRelativeToEye * czm_translateRelativeToEye(vec3(0.0, planes2D_high.x, planes2D_high.z), vec3(0.0, planes2D_low.x, planes2D_low.z))).xyz;\n' +
                    'vec3 southEastCorner = (czm_modelViewRelativeToEye * czm_translateRelativeToEye(vec3(0.0, planes2D_high.w, planes2D_high.y), vec3(0.0, planes2D_low.w, planes2D_low.y))).xyz;\n' +

                    'vec3 eastWard = southEastCorner - southWestCorner;\n' +
                    'float eastExtent = length(eastWard);\n' +
                    'eastWard /= eastExtent;\n' +

                    'vec3 northWard = northWestCorner - southWestCorner;\n' +
                    'float northExtent = length(northWard);\n' +
                    'northWard /= northExtent;\n' +

                    'v_westPlane = vec4(eastWard, -dot(eastWard, southWestCorner));\n' +
                    'v_southPlane = vec4(northWard, -dot(northWard, southWestCorner));\n' +
                    'v_inversePlaneExtents = vec2(1.0 / eastExtent, 1.0 / northExtent);\n';
            } else if (planarExtents) {
                glsl +=
                    // 3D case has 4 planes centered at the origin in world space
                    'vec4 eastWest = czm_batchTable_eastWestPlanes(batchId);\n' +
                    'v_northPlane = czm_transformPlane(czm_batchTable_northPlane(batchId), czm_modelView);\n' +
                    'v_southPlane = czm_transformPlane(czm_batchTable_southPlane(batchId), czm_modelView);\n' +
                    'v_eastPlane = czm_transformPlane(vec4(eastWest.xy, 0.0, 0.0), czm_modelView);\n' +
                    'v_westPlane = czm_transformPlane(vec4(eastWest.zw, 0.0, 0.0), czm_modelView);\n';
            } else {
                glsl += 'v_sphericalExtents = czm_batchTable_sphericalExtents(batchId);\n';
            }
            glsl += 'v_stSineCosineUVScale = czm_batchTable_stSineCosineUVScale(batchId);\n';
        }

        glsl +=
            '}\n';

        return glsl;
    }

    /**
     * Tracks shader dependencies.
     * @private
     */
    function ShaderDependencies() {
        this._requiresEC = false;
        this._requiresWC = false; // depends on eye coordinates, needed for material and for phong
        this._requiresNormalEC = false; // depends on eye coordinates, needed for material
        this._requiresTextureCoordinates = false; // depends on world coordinates, needed for material and for culling

        this._usesNormalEC = false;
        this._usesPositionToEyeEC = false;
        this._usesTangentToEyeMat = false;
        this._usesSt = false;
    }

    ShaderDependencies.prototype.reset = function() {
        this._requiresEC = false;
        this._requiresWC = false;
        this._requiresNormalEC = false;
        this._requiresTextureCoordinates = false;

        this._usesNormalEC = false;
        this._usesPositionToEyeEC = false;
        this._usesTangentToEyeMat = false;
        this._usesSt = false;
    };

    defineProperties(ShaderDependencies.prototype, {
        // Set when assessing final shading (flat vs. phong) and culling using computed texture coordinates
        requiresEC : {
            get : function() {
                return this._requiresEC;
            },
            set : function(value) {
                this._requiresEC = value || this._requiresEC;
            }
        },
        requiresWC : {
            get : function() {
                return this._requiresWC;
            },
            set : function(value) {
                this._requiresWC = value || this._requiresWC;
                this.requiresEC = this._requiresWC;
            }
        },
        requiresNormalEC : {
            get : function() {
                return this._requiresNormalEC;
            },
            set : function(value) {
                this._requiresNormalEC = value || this._requiresNormalEC;
                this.requiresEC = this._requiresNormalEC;
            }
        },
        requiresTextureCoordinates : {
            get : function() {
                return this._requiresTextureCoordinates;
            },
            set : function(value) {
                this._requiresTextureCoordinates = value || this._requiresTextureCoordinates;
                this.requiresWC = this._requiresTextureCoordinates;
            }
        },
        // Get/Set when assessing material hookups
        normalEC : {
            set : function(value) {
                this.requiresNormalEC = value;
                this._usesNormalEC = value;
            },
            get : function() {
                return this._usesNormalEC;
            }
        },
        tangentToEyeMatrix : {
            set : function(value) {
                this.requiresWC = value;
                this.requiresNormalEC = value;
                this._usesTangentToEyeMat = value;
            },
            get : function() {
                return this._usesTangentToEyeMat;
            }
        },
        positionToEyeEC : {
            set : function(value) {
                this.requiresEC = value;
                this._usesPositionToEyeEC = value;
            },
            get : function() {
                return this._usesPositionToEyeEC;
            }
        },
        st : {
            set : function(value) {
                this.requiresTextureCoordinates = value;
                this._usesSt = value;
            },
            get : function() {
                return this._usesSt;
            }
        }
    });

    var cartographicScratch = new Cartographic();
    var rectangleCenterScratch = new Cartographic();
    var northCenterScratch = new Cartesian3();
    var southCenterScratch = new Cartesian3();
    var eastCenterScratch = new Cartesian3();
    var westCenterScratch = new Cartesian3();
    var points2DScratch = [new Cartesian2(), new Cartesian2(), new Cartesian2(), new Cartesian2()];
    var rotation2DScratch = new Matrix2();
    var min2DScratch = new Cartesian2();
    var max2DScratch = new Cartesian2();
    function getTextureCoordinateRotationAttribute(rectangle, ellipsoid, textureCoordinateRotation) {
        var theta = defaultValue(textureCoordinateRotation, 0.0);

        // Compute approximate scale such that the rectangle, if scaled and rotated,
        // will completely enclose the unrotated/unscaled rectangle.
        var cosTheta = Math.cos(theta);
        var sinTheta = Math.sin(theta);

        // Build a rectangle centered in 2D space approximating the input rectangle's dimensions
        var cartoCenter = Rectangle.center(rectangle, rectangleCenterScratch);

        var carto = cartographicScratch;
        carto.latitude = cartoCenter.latitude;

        carto.longitude = rectangle.west;
        var westCenter = Cartographic.toCartesian(carto, ellipsoid, westCenterScratch);

        carto.longitude = rectangle.east;
        var eastCenter = Cartographic.toCartesian(carto, ellipsoid, eastCenterScratch);

        carto.longitude = cartoCenter.longitude;
        carto.latitude = rectangle.north;
        var northCenter = Cartographic.toCartesian(carto, ellipsoid, northCenterScratch);

        carto.latitude = rectangle.south;
        var southCenter = Cartographic.toCartesian(carto, ellipsoid, southCenterScratch);

        var northSouthHalfDistance = Cartesian3.distance(northCenter, southCenter) * 0.5;
        var eastWestHalfDistance = Cartesian3.distance(eastCenter, westCenter) * 0.5;

        var points2D = points2DScratch;
        points2D[0].x = eastWestHalfDistance;
        points2D[0].y = northSouthHalfDistance;

        points2D[1].x = -eastWestHalfDistance;
        points2D[1].y = northSouthHalfDistance;

        points2D[2].x = eastWestHalfDistance;
        points2D[2].y = -northSouthHalfDistance;

        points2D[3].x = -eastWestHalfDistance;
        points2D[3].y = -northSouthHalfDistance;

        // Rotate the dimensions rectangle and compute min/max in rotated space
        var min2D = min2DScratch;
        min2D.x = Number.POSITIVE_INFINITY;
        min2D.y = Number.POSITIVE_INFINITY;
        var max2D = max2DScratch;
        max2D.x = Number.NEGATIVE_INFINITY;
        max2D.y = Number.NEGATIVE_INFINITY;

        var rotation2D = Matrix2.fromRotation(-theta, rotation2DScratch);
        for (var i = 0; i < 4; ++i) {
            var point2D = points2D[i];
            Matrix2.multiplyByVector(rotation2D, point2D, point2D);
            Cartesian2.minimumByComponent(point2D, min2D, min2D);
            Cartesian2.maximumByComponent(point2D, max2D, max2D);
        }

        // Depending on the rotation, east/west may be more appropriate for vertical scale than horizontal
        var scaleU, scaleV;
        if (Math.abs(sinTheta) < Math.abs(cosTheta)) {
            scaleU = eastWestHalfDistance / ((max2D.x - min2D.x) * 0.5);
            scaleV = northSouthHalfDistance / ((max2D.y - min2D.y) * 0.5);
        } else {
            scaleU = eastWestHalfDistance / ((max2D.y - min2D.y) * 0.5);
            scaleV = northSouthHalfDistance / ((max2D.x - min2D.x) * 0.5);
        }

        return new GeometryInstanceAttribute({
            componentDatatype: ComponentDatatype.FLOAT,
            componentsPerAttribute: 4,
            normalize: false,
            value : [sinTheta, cosTheta, scaleU, scaleV] // Precompute trigonometry for rotation and inverse of scale
        });
    }

    var cornerScratch = new Cartesian3();
    var northWestScratch = new Cartesian3();
    var southEastScratch = new Cartesian3();
    var highLowScratch = {high : 0.0, low : 0.0};
    function add2DTextureCoordinateAttributes(rectangle, projection, attributes) {
        // Compute corner positions in double precision
        var carto = cartographicScratch;
        carto.height = 0.0;

        carto.longitude = rectangle.west;
        carto.latitude = rectangle.south;

        var southWestCorner = projection.project(carto, cornerScratch);

        carto.latitude = rectangle.north;
        var northWest = projection.project(carto, northWestScratch);

        carto.longitude = rectangle.east;
        carto.latitude = rectangle.south;
        var southEast = projection.project(carto, southEastScratch);

        // Since these positions are all in the 2D plane, there's a lot of zeros
        // and a lot of repetition. So we only need to encode 4 values.
        // Encode:
        // x: x value for southWestCorner
        // y: y value for southWestCorner
        // z: y value for northWest
        // w: x value for southEast
        var valuesHigh = [0, 0, 0, 0];
        var valuesLow = [0, 0, 0, 0];
        var encoded = EncodedCartesian3.encode(southWestCorner.x, highLowScratch);
        valuesHigh[0] = encoded.high;
        valuesLow[0] = encoded.low;

        encoded = EncodedCartesian3.encode(southWestCorner.y, highLowScratch);
        valuesHigh[1] = encoded.high;
        valuesLow[1] = encoded.low;

        encoded = EncodedCartesian3.encode(northWest.y, highLowScratch);
        valuesHigh[2] = encoded.high;
        valuesLow[2] = encoded.low;

        encoded = EncodedCartesian3.encode(southEast.x, highLowScratch);
        valuesHigh[3] = encoded.high;
        valuesLow[3] = encoded.low;

        attributes.planes2D_HIGH = new GeometryInstanceAttribute({
            componentDatatype: ComponentDatatype.FLOAT,
            componentsPerAttribute: 4,
            normalize: false,
            value : valuesHigh
        });

        attributes.planes2D_LOW = new GeometryInstanceAttribute({
            componentDatatype: ComponentDatatype.FLOAT,
            componentsPerAttribute: 4,
            normalize: false,
            value : valuesLow
        });
    }

    var longitudinalCartographicScratch = new Cartographic();
    var longitudinalCartesianScratch = new Cartesian3();
    function computeLongitudeTangentNormal(longitude, ellipsoid, invert, result) {
        var cartographic = longitudinalCartographicScratch;
        cartographic.height = 0.0;
        cartographic.latitude = 0.0;
        cartographic.longitude = longitude;
        var cartesian = Cartographic.toCartesian(cartographic, ellipsoid, longitudinalCartesianScratch);
        var out = Cartesian3.normalize(cartesian, cartesian);
        Cartesian3.cross(out, Cartesian3.UNIT_Z, result);
        if (invert) {
            Cartesian3.multiplyByScalar(result, -1.0, result);
        }
        return result;
    }

    var eastPositionScratch = new Cartesian3();
    var westPositionScratch = new Cartesian3();
    var rightVectorScratch = new Cartesian3();
    function computeSingleLatitudeTangentNormal(east, west, latitude, ellipsoid, invert, result) {
        // Compute normal for a plane such that the midpoint of long1 and long2 with latitude is in the plane.
        // Use for:
        // * South plane when South is above the equator
        // * North plane when North is below the equator
        var eastCarto = cartographicScratch;
        eastCarto.longitude = east;
        eastCarto.latitude = latitude;
        eastCarto.height = 0.0;
        var eastPosition = Cartographic.toCartesian(eastCarto, ellipsoid, eastPositionScratch);

        var westCarto = cartographicScratch;
        westCarto.longitude = west;
        westCarto.latitude = latitude;
        westCarto.height = 0.0;
        var westPosition = Cartographic.toCartesian(westCarto, ellipsoid, westPositionScratch);

        var rightVector = Cartesian3.subtract(eastPosition, westPosition, rightVectorScratch);
        rightVector = Cartesian3.normalize(rightVector, rightVector);

        var centerCarto = cartographicScratch;
        centerCarto.longitude = (east + west) * 0.5;
        centerCarto.latitude = latitude;
        centerCarto.height = 0.0;
        var outPosition = Cartographic.toCartesian(centerCarto, ellipsoid, westPositionScratch);
        var outVector = ellipsoid.geodeticSurfaceNormalCartographic(westCarto, new Cartesian3());

        // TODO: see if Ellipsoid.prototype.geodeticSurfaceNormalCartographic gives better results
        // Requires a distance to the plane as well.

        Cartesian3.cross(outVector, rightVector, result);
        Cartesian3.normalize(result, result);
        var plane = Plane.fromPointNormal(westPosition, result);

        if (invert) {
            Cartesian3.multiplyByScalar(result, -1.0, result);
            plane.distance *= -1.0;
        }
        return plane.distance;
    }

    function computeDoubleLatitudeTangentNormal(east, west, latitude, ellipsoid, invert, result) {
        // Compute normal for a plane such that east and west with latitude are in the plane.
        // Use for:
        // * both planes when the rectangle straddles the equator
        // * North plane when South is above the equator
        // * South plane when North is below the equator
        var eastCarto = cartographicScratch;
        eastCarto.longitude = east;
        eastCarto.latitude = latitude;
        eastCarto.height = 0.0;
        var eastPosition = Cartographic.toCartesian(eastCarto, ellipsoid, eastPositionScratch);

        var westCarto = cartographicScratch;
        westCarto.longitude = west;
        westCarto.latitude = latitude;
        westCarto.height = 0.0;
        var westPosition = Cartographic.toCartesian(westCarto, ellipsoid, westPositionScratch);

        var rightVector = Cartesian3.subtract(eastPosition, westPosition, rightVectorScratch);
        rightVector = Cartesian3.normalize(rightVector, rightVector);
/*
        var outVector = Cartesian3.normalize(westPosition, westPosition);
        console.log(JSON.stringify(outVector));

        var modelView = {"0":-0.8289827533242462,"1":0.2183784027932938,"2":-0.5148771386305688,"3":0,"4":-0.1406767111396828,"5":-0.9724367481587494,"6":-0.18594847074756904,"7":0,"8":-0.5412925804349016,"9":-0.0817168527531937,"10":0.836854048411214,"11":0,"12":-0.09858469665050507,"13":-2750685.723301648,"14":-5745102.184897642,"15":1};
        var testPlane = new Plane(outVector, 0.0);
        testPlane = Plane.transform(testPlane, modelView);
*/
        var outVector = ellipsoid.geodeticSurfaceNormalCartographic(westCarto, new Cartesian3());

        // TODO: see if Ellipsoid.prototype.geodeticSurfaceNormalCartographic gives better results
        // Requires a distance to the plane as well.

        Cartesian3.cross(outVector, rightVector, result);
        Cartesian3.normalize(result, result);
        var plane = Plane.fromPointNormal(westPosition, result);

        if (invert) {
            Cartesian3.multiplyByScalar(result, -1.0, result);
            plane.distance *= -1.0;
        }

        //var modelView = {"0":-0.8289827533242462,"1":0.2183784027932938,"2":-0.5148771386305688,"3":0,"4":-0.1406767111396828,"5":-0.9724367481587494,"6":-0.18594847074756904,"7":0,"8":-0.5412925804349016,"9":-0.0817168527531937,"10":0.836854048411214,"11":0,"12":-0.09858469665050507,"13":-2750685.723301648,"14":-5745102.184897642,"15":1};
        //var testPlane = Plane.transform(plane, modelView);

        return plane.distance;
    }

    /**
     * Gets an attributes object containing:
     * - 3 high-precision points as 6 GeometryInstanceAttributes. These points are used to compute eye-space planes.
     * - 1 texture coordinate rotation GeometryInstanceAttributes
     * - 2 GeometryInstanceAttributes used to compute high-precision points in 2D and Columbus View.
     *   These points are used to compute eye-space planes like above.
     *
     * Used to compute texture coordinates for small-area ClassificationPrimitives with materials or multiple non-overlapping instances.
     *
     * @see ShadowVolumeAppearance
     * @private
     *
     * @param {Rectangle} rectangle Rectangle object that the points will approximately bound
     * @param {Ellipsoid} ellipsoid Ellipsoid for converting Rectangle points to world coordinates
     * @param {MapProjection} projection The MapProjection used for 2D and Columbus View.
     * @param {Number} [textureCoordinateRotation=0] Texture coordinate rotation
     * @returns {Object} An attributes dictionary containing planar texture coordinate attributes.
     */
    ShadowVolumeAppearance.getPlanarTextureCoordinateAttributes = function(rectangle, ellipsoid, projection, textureCoordinateRotation) {
        //>>includeStart('debug', pragmas.debug);
        Check.typeOf.object('rectangle', rectangle);
        Check.typeOf.object('ellipsoid', ellipsoid);
        Check.typeOf.object('projection', projection);
        //>>includeEnd('debug');

        var west = rectangle.west;
        var east = rectangle.east;
        var south = rectangle.south;
        var north = rectangle.north;

        // Get a plane for each dimension of the rectangle
        // These planes are Z 0.0, so pack them to a single vec4
        var westPlane = computeLongitudeTangentNormal(west, ellipsoid, true, new Cartesian3());
        var eastPlane = computeLongitudeTangentNormal(east, ellipsoid, false, new Cartesian3());
        var northPlane = new Cartesian3();
        var southPlane = new Cartesian3();
        var northDistance = 0.0;
        var southDistance = 0.0;

        if (south > 0.0) {
            northDistance = computeDoubleLatitudeTangentNormal(east, west, north, ellipsoid, true, northPlane);
            southDistance = computeSingleLatitudeTangentNormal(east, west, south, ellipsoid, false, southPlane);
        } else if (north < 0.0) {
            northDistance = computeSingleLatitudeTangentNormal(east, west, north, ellipsoid, true, northPlane);
            southDistance = computeDoubleLatitudeTangentNormal(east, west, south, ellipsoid, false, southPlane);
        } else {
            northDistance = computeDoubleLatitudeTangentNormal(east, west, north, ellipsoid, true, northPlane);
            southDistance = computeDoubleLatitudeTangentNormal(east, west, south, ellipsoid, false, southPlane);
        }

        var eastWestAttribute = new GeometryInstanceAttribute({
            componentDatatype: ComponentDatatype.FLOAT,
            componentsPerAttribute: 4,
            normalize: false,
            value : [eastPlane.x, eastPlane.y, westPlane.x, westPlane.y]
        });

        //console.log(eastWestAttribute.value);
        //console.log('north: ' + northPlane);
        //console.log('south: ' + southPlane);

        var northAttribute = new GeometryInstanceAttribute({
            componentDatatype: ComponentDatatype.FLOAT,
            componentsPerAttribute: 4,
            normalize: false,
            value : [northPlane.x, northPlane.y, northPlane.z, northDistance]
        });

        var southAttribute = new GeometryInstanceAttribute({
            componentDatatype: ComponentDatatype.FLOAT,
            componentsPerAttribute: 4,
            normalize: false,
            value : [southPlane.x, southPlane.y, southPlane.z, southDistance]
        });

        var attributes = {
            eastWestPlanes : eastWestAttribute,
            northPlane : northAttribute,
            southPlane : southAttribute,
            stSineCosineUVScale : getTextureCoordinateRotationAttribute(rectangle, ellipsoid, textureCoordinateRotation)
        };

        add2DTextureCoordinateAttributes(rectangle, projection, attributes);
        return attributes;
    };

    var spherePointScratch = new Cartesian3();
    function latLongToSpherical(latitude, longitude, ellipsoid, result) {
        var cartographic = cartographicScratch;
        cartographic.latitude = latitude;
        cartographic.longitude = longitude;
        cartographic.height = 0.0;

        var spherePoint = Cartographic.toCartesian(cartographic, ellipsoid, spherePointScratch);

        // Project into plane with vertical for latitude
        var magXY = Math.sqrt(spherePoint.x * spherePoint.x + spherePoint.y * spherePoint.y);

        // Use fastApproximateAtan2 for alignment with shader
        var sphereLatitude = CesiumMath.fastApproximateAtan2(magXY, spherePoint.z);
        var sphereLongitude = CesiumMath.fastApproximateAtan2(spherePoint.x, spherePoint.y);

        result.x = sphereLatitude;
        result.y = sphereLongitude;

        return result;
    }

    var sphericalScratch = new Cartesian2();
    /**
     * Gets an attributes object containing:
     * - the southwest corner of a rectangular area in spherical coordinates, as well as the inverse of the latitude/longitude range.
     *   These are computed using the same atan2 approximation used in the shader.
     * - 1 texture coordinate rotation GeometryInstanceAttributes
     * - 2 GeometryInstanceAttributes used to compute high-precision points in 2D and Columbus View.
     *   These points are used to compute eye-space planes like above.
     *
     * Used when computing texture coordinates for large-area ClassificationPrimitives with materials or
     * multiple non-overlapping instances.
     * @see ShadowVolumeAppearance
     * @private
     *
     * @param {Rectangle} rectangle Rectangle object that the spherical extents will approximately bound
     * @param {Ellipsoid} ellipsoid Ellipsoid for converting Rectangle points to world coordinates
     * @param {MapProjection} projection The MapProjection used for 2D and Columbus View.
     * @param {Number} [textureCoordinateRotation=0] Texture coordinate rotation
     * @returns {Object} An attributes dictionary containing spherical texture coordinate attributes.
     */
    ShadowVolumeAppearance.getSphericalExtentGeometryInstanceAttributes = function(rectangle, ellipsoid, projection, textureCoordinateRotation) {
        //>>includeStart('debug', pragmas.debug);
        Check.typeOf.object('rectangle', rectangle);
        Check.typeOf.object('ellipsoid', ellipsoid);
        Check.typeOf.object('projection', projection);
        //>>includeEnd('debug');

        // rectangle cartographic coords !== spherical because it's on an ellipsoid
        var southWestExtents = latLongToSpherical(rectangle.south, rectangle.west, ellipsoid, sphericalScratch);

        // Slightly pad extents to avoid floating point error when fragment culling at edges.
        var south = southWestExtents.x - CesiumMath.EPSILON5;
        var west = southWestExtents.y - CesiumMath.EPSILON5;

        var northEastExtents = latLongToSpherical(rectangle.north, rectangle.east, ellipsoid, sphericalScratch);
        var north = northEastExtents.x + CesiumMath.EPSILON5;
        var east = northEastExtents.y + CesiumMath.EPSILON5;

        var longitudeRangeInverse = 1.0 / (east - west);
        var latitudeRangeInverse = 1.0 / (north - south);

        var attributes = {
            sphericalExtents : new GeometryInstanceAttribute({
                componentDatatype: ComponentDatatype.FLOAT,
                componentsPerAttribute: 4,
                normalize: false,
                value : [south, west, latitudeRangeInverse, longitudeRangeInverse]
            }),
            stSineCosineUVScale : getTextureCoordinateRotationAttribute(rectangle, ellipsoid, textureCoordinateRotation)
        };

        add2DTextureCoordinateAttributes(rectangle, projection, attributes);
        return attributes;
    };

    ShadowVolumeAppearance.hasAttributesForTextureCoordinatePlanes = function(attributes) {
        return defined(attributes.eastWestPlanes) &&
            defined(attributes.northPlane) && defined(attributes.southPlane) &&
            defined(attributes.planes2D_HIGH) && defined(attributes.planes2D_LOW) &&
            defined(attributes.stSineCosineUVScale);
    };

    ShadowVolumeAppearance.hasAttributesForSphericalExtents = function(attributes) {
        return defined(attributes.sphericalExtents) &&
        defined(attributes.planes2D_HIGH) && defined(attributes.planes2D_LOW) &&
        defined(attributes.stSineCosineUVScale);
    };

    function shouldUseSpherical(rectangle) {
        return Math.max(rectangle.width, rectangle.height) > ShadowVolumeAppearance.MAX_WIDTH_FOR_PLANAR_EXTENTS;
    }

    /**
     * Computes whether the given rectangle is wide enough that texture coordinates
     * over its area should be computed using spherical extents instead of distance to planes.
     *
     * @param {Rectangle} rectangle A rectangle
     * @private
     */
    ShadowVolumeAppearance.shouldUseSphericalCoordinates = function(rectangle) {
        //>>includeStart('debug', pragmas.debug);
        Check.typeOf.object('rectangle', rectangle);
        //>>includeEnd('debug');

        return shouldUseSpherical(rectangle);
    };

    /**
     * Texture coordinates for ground primitives are computed either using spherical coordinates for large areas or
     * using distance from planes for small areas.
     *
     * @type {Number}
     * @constant
     * @private
     */
    ShadowVolumeAppearance.MAX_WIDTH_FOR_PLANAR_EXTENTS = CesiumMath.toRadians(1.0);

    return ShadowVolumeAppearance;
});
