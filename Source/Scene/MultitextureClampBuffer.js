import Cartesian2 from "../Core/Cartesian2.js";
import Cartesian3 from "../Core/Cartesian3.js";
import Cartesian4 from "../Core/Cartesian4.js";
import CesiumMath from "../Core/Math.js";
import Color from "../Core/Color.js";
import defined from "../Core/defined.js";
import destroyObject from "../Core/destroyObject.js";
import Matrix4 from "../Core/Matrix4.js";
import PixelFormat from "../Core/PixelFormat.js";

import ClearCommand from "../Renderer/ClearCommand.js";
import ContextLimits from "../Renderer/ContextLimits.js";
import Framebuffer from "../Renderer/Framebuffer.js";
import Pass from "../Renderer/Pass.js";
import PixelDatatype from "../Renderer/PixelDatatype.js";
import RenderState from "../Renderer/RenderState.js";
import Sampler from "../Renderer/Sampler.js";
import ShaderSource from "../Renderer/ShaderSource.js";
import Texture from "../Renderer/Texture.js";
import TextureWrap from "../Renderer/TextureWrap.js";
import TextureMinificationFilter from "../Renderer/TextureMinificationFilter.js";
import TextureMagnificationFilter from "../Renderer/TextureMagnificationFilter.js";

import compositeClampedVctrsLocalFS from "../Shaders/compositeClampedVctrsLocalFS.js";
import computeTangentToTextureSpaceFS from "../Shaders/computeTangentToTextureSpaceFS.js";

import BlendingState from "./BlendingState.js";

var NUMBER_OF_CASCADES = 4;

/**
 * Texture, uniforms, and compositing pass for a multitexturing buffer.
 * Draw content into the buffer to be clamped to terrain.
 */
function MultitextureClampBuffer() {
  this._u_eyeSpaceToTangentSpace = new Matrix4();
  this._u_tangentSpaceToEyeSpace = new Matrix4();
  this._u_pixelRatioTimesMetersPerPixel = 0.0;

  this._colorTexture = undefined;
  this._depthStencilTexture = undefined;
  this._framebuffer = undefined;

  this._clearCommand = new ClearCommand({
    color: new Color(0.0, 0.0, 0.0, 0.0),
    owner: this,
  });

  this._u_boundingBoxXZ = new Cartesian4();
  this._u_cascadesXZ = [
    new Cartesian4(),
    new Cartesian4(),
    new Cartesian4(),
    new Cartesian4(),
  ];

  this._u_boundingBoxMinMaxY = new Cartesian2(); // TODO: just use approx terrain heights default

  this._computeBoundsTexture = undefined;
  this._computeBoundsFramebuffer = undefined;
  this._computeBoundsCommand = undefined;

  this._localCompositeCommand = undefined;

  this._debugShowTextureCoordinates = false;
  this._debugShowIntermediateTexture = false;

  this._useLogDepth = false;

  /**
   * Multiplier for the screen width/height when creating cascades for clamped
   * vector tile features.
   *
   * @type {Number}
   * @default 1.0
   */
  this.cascadeWidthMultiplier = 1.0;
}

Object.defineProperties(MultitextureClampBuffer.prototype, {
  /**
   * Gets the framebuffer associated with this VectorTilesClamp.
   *
   * @memberof VectorTilesClamping.prototype
   *
   * @type {Framebuffer}
   * @readonly
   * @private
   */
  framebuffer: {
    get: function () {
      // TODO: count how many times this has been accessed this frustum/frame?
      return this._framebuffer;
    },
  },

  /**
   * Gets the matrix to go from eye space to the tangent space.
   *
   * @memberof VectorTilesClamping.prototype
   *
   * @type {Matrix4}
   * @readonly
   */
  eyeSpaceToTangentSpace: {
    get: function () {
      return this._u_eyeSpaceToTangentSpace;
    },
  },

  /**
   * Gets the texture with bounds information derived from the depth buffer.
   *
   * @memberof VectorTilesClamping.prototype
   *
   * @type {Texture}
   * @private
   * @readonly
   */
  boundsTexture: {
    get: function () {
      return this._computeBoundsTexture;
    },
  },

  /**
   * Gets a min/max height bound for this area of tangent space.
   * Useful for normalizing heights of vector features being
   * rendered into the intermediate texture.
   *
   * @memberof VectorTilesClamping.prototype
   *
   * @type {Cartesian2}
   * @readonly
   */
  boundingBoxMinMaxY: {
    get: function () {
      return this._u_boundingBoxMinMaxY;
    },
  },

  /**
   * Width of the texture in use here.
   *
   * @memberof VectorTilesClamping.prototype
   *
   * @type {Number}
   * @readonly
   */
  textureWidth: {
    get: function () {
      return this._textureWidth;
    },
  },

  /**
   * Number of meters per pixel in the texture space multipled by the
   * approximate ratio between the texture width in pixels and the number of
   * pixels wide the texture appears in screenspace.
   *
   * The pixel ratio makes sure the polylines draw wider in meters when the
   * camera is zooming away while the metersPerPixel help the polylines draw
   * narrower in meters when the camera is zooming in close.
   *
   * @memberof VectorTilesClamping.prototype
   *
   * @type {Number}
   * @readonly
   */
  pixelRatioTimesMetersPerPixel: {
    get: function () {
      return this._u_pixelRatioTimesMetersPerPixel;
    },
  },

  /**
   * Whether or not to show texture coordinates for the current view.
   *
   * @memberof VectorTilesClamping.prototype
   *
   * @type {Boolean}
   */
  debugShowTextureCoordinates: {
    get: function () {
      return this._debugShowTextureCoordinates;
    },
    set: function (value) {
      if (value !== this._debugShowTextureCoordinates) {
        this._localCompositeCommand = undefined;
      }
      this._debugShowTextureCoordinates = value;
    },
  },

  /**
   * Whether or not to show the intermediate texture for the current view.
   *
   * @memberof VectorTilesClamping.prototype
   *
   * @type {Boolean}
   */
  debugShowIntermediateTexture: {
    get: function () {
      return this._debugShowIntermediateTexture;
    },
    set: function (value) {
      if (value !== this._debugShowIntermediateTexture) {
        this._localCompositeCommand = undefined;
      }
      this._debugShowIntermediateTexture = value;
    },
  },
});

function destroyColorTexturesAndFramebuffers(clamp) {
  clamp._colorTexture =
    clamp._colorTexture &&
    !clamp._colorTexture.isDestroyed() &&
    clamp._colorTexture.destroy();

  clamp._depthStencilTexture =
    clamp._depthStencilTexture &&
    !clamp._depthStencilTexture.isDestroyed() &&
    clamp._depthStencilTexture.destroy();

  clamp._framebuffer =
    clamp._framebuffer &&
    !clamp._framebuffer.isDestroyed() &&
    clamp._framebuffer.destroy();
}

function destroyComputeBoundsTextureAndFramebuffer(clamp) {
  clamp._computeBoundsTexture =
    clamp._computeBoundsTexture &&
    !clamp._computeBoundsTexture.isDestroyed() &&
    clamp._computeBoundsTexture.destroy();

  clamp._computeBoundsFramebuffer =
    clamp._computeBoundsFramebuffer &&
    !clamp._computeBoundsFramebuffer.isDestroyed() &&
    clamp._computeBoundsFramebuffer.destroy();
}

function updateResources(clampClass, frameState) {
  var context = frameState.context;

  var contextWidth = context.drawingBufferWidth;
  var contextHeight = context.drawingBufferHeight;

  // Allocate texture for 4 cascades, each about as wide as the screen
  var colorTexWidth = Math.max(contextWidth, contextHeight);
  colorTexWidth *= clampClass.cascadeWidthMultiplier;
  colorTexWidth *= 2.0; // 4 cascades are laid out in a 2x2 square
  colorTexWidth = CesiumMath.nextPowerOfTwo(colorTexWidth);
  colorTexWidth = Math.min(colorTexWidth, ContextLimits.maximumTextureSize);

  var sampler;
  var colorTex;
  var framebuffer;

  var useLogDepth = frameState.useLogDepth;
  if (clampClass._useLogDepth !== useLogDepth) {
    clampClass._useLogDepth = useLogDepth;

    clampClass._computeBoundsCommand = undefined;
    clampClass._localCompositeCommand = undefined;
  }

  if (clampClass._textureWidth !== colorTexWidth) {
    destroyColorTexturesAndFramebuffers(clampClass);

    sampler = new Sampler({
      wrapS: TextureWrap.CLAMP_TO_EDGE,
      wrapT: TextureWrap.CLAMP_TO_EDGE,
      minificationFilter: TextureMinificationFilter.NEAREST,
      magnificationFilter: TextureMagnificationFilter.NEAREST,
    });

    colorTex = new Texture({
      context: context,
      width: colorTexWidth,
      height: colorTexWidth,
      pixelFormat: PixelFormat.RGBA,
      pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
      sampler: sampler,
    });

    var depthStencilTexture = new Texture({
      context: context,
      width: colorTexWidth,
      height: colorTexWidth,
      pixelFormat: PixelFormat.DEPTH_STENCIL,
      pixelDatatype: PixelDatatype.UNSIGNED_INT_24_8,
      sampler: sampler,
    });

    framebuffer = new Framebuffer({
      context: context,
      colorTextures: [colorTex],
      depthStencilTexture: depthStencilTexture,
      destroyAttachments: false,
    });

    clampClass._textureWidth = colorTexWidth;

    clampClass._colorTexture = colorTex;
    clampClass._depthStencilTexture = depthStencilTexture;
    clampClass._framebuffer = framebuffer;
  }

  if (!defined(clampClass._localCompositeCommand)) {
    var compositeUniformMap = {
      u_colorTexture: function () {
        return clampClass._colorTexture;
      },
      u_boundsTexture: function () {
        return clampClass._computeBoundsTexture;
      },
      u_eyeSpaceToTangentSpace: function () {
        return clampClass._u_eyeSpaceToTangentSpace;
      },
    };

    var compositeDefines = [];
    if (clampClass._debugShowTextureCoordinates) {
      compositeDefines.push("DEBUG_SHOW_TEXTURE_COORDINATES");
    }

    if (clampClass._debugShowIntermediateTexture) {
      compositeDefines.push("DEBUG_SHOW_INTERMEDIATE_TEXTURE");
    }

    if (useLogDepth) {
      compositeDefines.push("LOG_DEPTH");
    }

    var compositeFS = new ShaderSource({
      sources: [compositeClampedVctrsLocalFS],
      defines: compositeDefines,
    });

    var compositeCommand = context.createViewportQuadCommand(compositeFS, {
      uniformMap: compositeUniformMap,
      owner: clampClass,
      pass: Pass.TERRAIN_CLASSIFICATION,
      renderState: RenderState.fromCache({
        blending: BlendingState.ALPHA_BLEND,
      }),
    });

    clampClass._localCompositeCommand = compositeCommand;
  }

  if (!defined(clampClass._computeBoundsTexture)) {
    sampler = new Sampler({
      wrapS: TextureWrap.CLAMP_TO_EDGE,
      wrapT: TextureWrap.CLAMP_TO_EDGE,
      minificationFilter: TextureMinificationFilter.NEAREST,
      magnificationFilter: TextureMagnificationFilter.NEAREST,
    });

    colorTex = new Texture({
      context: context,
      width: 4,
      height: 4,
      pixelFormat: PixelFormat.RGBA,
      pixelDatatype: PixelDatatype.FLOAT,
      sampler: sampler,
    });

    framebuffer = new Framebuffer({
      context: context,
      colorTextures: [colorTex],
      destroyAttachments: false,
    });

    clampClass._computeBoundsTexture = colorTex;
    clampClass._computeBoundsFramebuffer = framebuffer;
  }

  if (!defined(clampClass._computeBoundsCommand)) {
    // Compute transforms from ellipsoid tangent space to texture space by finding
    // bounds of what's visible via depth buffer on the GPU.
    /**************************************
     *    *--------max     (0,1)-----(1,1)
     *    |\       /|        |\       /|
     *    | \     / |        | \     / |
     *    |  \   /  |   =>   |  \   /  |
     *    |   \ /   |        |   \ /   |
     *    |   cam   |        |   cam   |
     *   min--------*      (0,0)-----(1,0)
     */

    var boundsDefines = ["SAMPLES_X 10", "SAMPLES_Y 10"];

    if (useLogDepth) {
      boundsDefines.push("LOG_DEPTH");
    }

    var boundsFS = new ShaderSource({
      sources: [computeTangentToTextureSpaceFS],
      defines: boundsDefines,
    });

    var boundsUniformMap = {
      u_eyeSpaceToTangentSpace: function () {
        return clampClass._u_eyeSpaceToTangentSpace;
      },
      u_boundingBoxXZ: function () {
        return clampClass._u_boundingBoxXZ;
      },
      u_boundingBoxMinMaxY: function () {
        return clampClass._u_boundingBoxMinMaxY;
      },
      u_cascadesXZ: function () {
        return clampClass._u_cascadesXZ;
      },
      u_tangentSpaceToEyeSpace: function () {
        return clampClass._u_tangentSpaceToEyeSpace;
      },
      u_fov: function () {
        return clampClass._u_fov;
      },
      u_aspectRatio: function () {
        return clampClass._u_aspectRatio;
      },
      u_frustumSseDenominator: function () {
        return clampClass._u_frustumSseDenominator;
      },
      u_pixelRatioTimesMetersPerPixel: function () {
        return clampClass._u_pixelRatioTimesMetersPerPixel;
      },
    };

    var computeCommand = context.createViewportQuadCommand(boundsFS, {
      uniformMap: boundsUniformMap,
      owner: clampClass,
      pass: Pass.TERRAIN_CLASSIFICATION,
      renderState: RenderState.fromCache({
        blending: BlendingState.DISABLED,
      }),
      framebuffer: clampClass._computeBoundsFramebuffer,
      // Don't mess with the viewport, we need that to be screen-size
    });

    clampClass._computeBoundsCommand = computeCommand;
  }
}

var upScratch = new Cartesian3();
var rightScratch = new Cartesian3();
var dirScratch = new Cartesian3();

function getEllipsoidTangentViewMatrix(ellipsoid, camera, result) {
  var position = camera.position;
  var direction = camera.direction;

  var up = ellipsoid.geodeticSurfaceNormal(position, upScratch);
  var right = Cartesian3.cross(direction, up, rightScratch);
  right = Cartesian3.normalize(right, right);

  direction = Cartesian3.cross(up, right, dirScratch);
  direction = Cartesian3.normalize(direction, direction);

  // make +Z in this coordinate space further from the camera
  Cartesian3.multiplyByScalar(direction, -1.0, direction);
  Cartesian3.multiplyByScalar(right, -1.0, right);

  return Matrix4.computeView(position, direction, up, right, result);
}

var frustumCornersNDC = new Array(8);
frustumCornersNDC[0] = new Cartesian4(-1.0, -1.0, -1.0, 1.0);
frustumCornersNDC[1] = new Cartesian4(1.0, -1.0, -1.0, 1.0);
frustumCornersNDC[2] = new Cartesian4(1.0, 1.0, -1.0, 1.0);
frustumCornersNDC[3] = new Cartesian4(-1.0, 1.0, -1.0, 1.0);
frustumCornersNDC[4] = new Cartesian4(-1.0, -1.0, 1.0, 1.0);
frustumCornersNDC[5] = new Cartesian4(1.0, -1.0, 1.0, 1.0);
frustumCornersNDC[6] = new Cartesian4(1.0, 1.0, 1.0, 1.0);
frustumCornersNDC[7] = new Cartesian4(-1.0, 1.0, 1.0, 1.0);
var scratchMatrix = new Matrix4();

var scratchFrustumCorner = new Cartesian4();

function computeFrustumBounds(frustum, viewMatrix, tanView, min, max) {
  // Matrix for projecting from NDC back to world space, then to tangent space
  var viewProjection = Matrix4.multiply(
    frustum.projectionMatrix,
    viewMatrix,
    scratchMatrix
  );
  var inverseViewProj = Matrix4.inverse(viewProjection, scratchMatrix);
  var ndcToTanView = Matrix4.multiply(tanView, inverseViewProj, scratchMatrix);

  // Project each corner from NDC space to tangent space,
  // and calculate a min and max in tangent space
  var frustumMin = Cartesian3.fromElements(
    Number.MAX_VALUE,
    Number.MAX_VALUE,
    Number.MAX_VALUE,
    min
  );
  var frustumMax = Cartesian3.fromElements(
    -Number.MAX_VALUE,
    -Number.MAX_VALUE,
    -Number.MAX_VALUE,
    max
  );

  for (var i = 0; i < 8; ++i) {
    var corner = Cartesian4.clone(frustumCornersNDC[i], scratchFrustumCorner);

    Matrix4.multiplyByVector(ndcToTanView, corner, corner);
    Cartesian3.divideByScalar(corner, corner.w, corner); // Handle the perspective divide
    Cartesian3.minimumByComponent(corner, frustumMin, frustumMin);
    Cartesian3.maximumByComponent(corner, frustumMax, frustumMax);
  }
}

var splitPointScratch = new Cartesian3();
function getCameraDistance(tangentPoint, tangentToEC) {
  var ec = splitPointScratch;
  ec = Matrix4.multiplyByPoint(tangentToEC, tangentPoint, ec);
  return Math.abs(Math.min(ec.z, 0.0));
}

function getFrustumHalfWidthAt(tangentPoint, tangentToEC, frustum) {
  var distance = getCameraDistance(tangentPoint, tangentToEC);
  var height = 2.0 * distance * Math.tan(frustum.fov * 0.5);
  return height * frustum.aspectRatio * 0.5;
}

var tangentViewScratch = new Matrix4();
var inverseTangentViewScratch = new Matrix4();

var localMinScratch = new Cartesian3();
var localMaxScratch = new Cartesian3();
var localMidScratch = new Cartesian3();
var localMax2dScratch = new Cartesian2();

var subMinScratch = new Cartesian3();
var subMaxScratch = new Cartesian3();

var localMid2dScratch = new Cartesian2();
var midECEFScratch = new Cartesian3();

var cameraPosTangentScratch = new Cartesian3();
var distancePointScratch = new Cartesian3();

var zBoundsScratch = [0, 0, 0, 0, 0];

MultitextureClampBuffer.prototype.updateResources = function (frameState) {
  // create or recreate framebuffers and textures if needed
  updateResources(this, frameState);
};

/**u
 * Updates the framebuffer for the current view
 *
 * @param {FrameState} frameState The current frame state.
 */
MultitextureClampBuffer.prototype.updateBounds = function (
  frameState,
  passState
) {
  var context = frameState.context;
  var camera = frameState.camera;
  var currentFrustumNumber = context.uniformState.currentFrustumNumber;
  var frustumSplits = frameState.frustumSplits;

  var tanView = getEllipsoidTangentViewMatrix(
    frameState.mapProjection.ellipsoid,
    camera,
    tangentViewScratch
  );
  var inverseTanView = Matrix4.inverse(tanView, inverseTangentViewScratch);

  // adjust rendering parameters based on current view
  var localMin = localMinScratch;
  var localMax = localMaxScratch;
  var localMid = localMidScratch;

  // TODO: Just use the frustum corners for now, better bounds to come:
  var cameraViewMatrix = camera.viewMatrix;
  var currentFrustum = camera.frustum.clone();
  currentFrustum.near = frustumSplits[currentFrustumNumber];
  currentFrustum.far = frustumSplits[currentFrustumNumber + 1];
  computeFrustumBounds(
    currentFrustum,
    cameraViewMatrix,
    tanView,
    localMin,
    localMax
  );

  localMid = Cartesian3.add(localMin, localMax, localMidScratch);
  localMid = Cartesian3.multiplyByScalar(localMid, 0.5, localMid);

  // Come up with backup partitions for localMin/localMax along Z
  var tangentToEC = this._u_tangentSpaceToEyeSpace;
  tangentToEC = Matrix4.multiply(cameraViewMatrix, inverseTanView, tangentToEC);
  this._u_tangentSpaceToEyeSpace = tangentToEC;

  var midY = localMid.y;

  var maxMidY = Cartesian3.clone(localMax, distancePointScratch);
  maxMidY.y = midY;
  var cameraFar = getCameraDistance(maxMidY, tangentToEC);

  var minMidY = Cartesian3.clone(localMin, distancePointScratch);
  maxMidY.y = midY;
  var cameraNear = getCameraDistance(minMidY, tangentToEC);

  var cameraRange = cameraFar - cameraNear;
  var inverseCameraRange = 1.0 / cameraRange;
  var cameraRatio = cameraFar / cameraNear;
  var lambda = 0.9;

  var minZ = localMin.z;
  var maxZ = localMax.z;

  var zBounds = zBoundsScratch;
  zBounds[0] = minZ;
  var i;
  for (i = 1; i < NUMBER_OF_CASCADES; i++) {
    var p = i / NUMBER_OF_CASCADES;
    var logScale = cameraNear * Math.pow(cameraRatio, p);
    var uniformScale = cameraNear + cameraRange * p;
    var cameraSplit = CesiumMath.lerp(uniformScale, logScale, lambda);
    var norm = (cameraSplit - cameraNear) * inverseCameraRange;
    zBounds[i] = CesiumMath.lerp(minZ, maxZ, norm);
  }
  zBounds[NUMBER_OF_CASCADES] = maxZ;

  // Compute width for each cascade region:
  // For each cascade region, compute its near/far range in camera space
  // Use these to get a subfrustum with full covereage
  // Compute subfrustum's width in tangent space and ISX with that
  var u_cascadesXZ = this._u_cascadesXZ;

  var cameraPosTan = cameraPosTangentScratch;
  cameraPosTan = Matrix4.multiplyByPoint(
    tanView,
    camera.position,
    cameraPosTan
  );
  var cameraPosTanX = cameraPosTan.x;
  var frustum = camera.frustum;

  for (i = 0; i < NUMBER_OF_CASCADES; i++) {
    var zStart = zBounds[i];
    var zEnd = zBounds[i + 1];

    var subMin = Cartesian3.clone(localMin, subMinScratch);
    var subMax = Cartesian3.clone(localMax, subMaxScratch);

    subMin.z = zStart;
    subMax.z = zEnd;

    var distancePointMax = Cartesian3.clone(subMax, distancePointScratch);
    distancePointMax.y = midY;
    var halfSubFrustumWidth = getFrustumHalfWidthAt(
      distancePointMax,
      tangentToEC,
      frustum
    );

    var camLeft = cameraPosTanX - halfSubFrustumWidth;
    var camRight = cameraPosTanX + halfSubFrustumWidth;

    subMin.x = Math.max(subMin.x, camLeft);
    subMax.x = Math.min(subMax.x, camRight);

    var boundsMinMax = u_cascadesXZ[i];
    boundsMinMax.x = subMin.x;
    boundsMinMax.y = subMin.z;
    boundsMinMax.z = subMax.x;
    boundsMinMax.w = subMax.z;
  }

  this._u_fov = frustum.fov;
  this._u_aspectRatio = frustum.aspectRatio;
  this._u_frustumSseDenominator = frustum.sseDenominator;

  this._u_boundingBoxXZ.x = localMin.x;
  this._u_boundingBoxXZ.y = localMin.z;
  this._u_boundingBoxXZ.z = localMax.x;
  this._u_boundingBoxXZ.w = localMax.z;

  this._u_boundingBoxMinMaxY.x = localMin.y;
  this._u_boundingBoxMinMaxY.y = localMax.y;

  // Get world-space bounding sphere around the texture so we can approximate
  // the ratio between intermediate texture pixels and onscreen pixels.
  // Compute the width of intermediate texture pixels in meters.
  // In most views this will be overridden in the shader.
  var localMid2D = localMid2dScratch;
  localMid2D.x = localMid.x;
  localMid2D.y = localMid.z;
  var localMax2D = localMax2dScratch;
  localMax2D.x = localMax.x;
  localMax2D.y = localMax.z;

  var midECEF = Matrix4.multiplyByPoint(
    inverseTanView,
    localMid,
    midECEFScratch
  );
  var cascadeWidth = this._textureWidth * 0.5; // cascadeWidth actually cancels out
  var h = context.drawingBufferHeight;

  var distanceToTexCenter = Cartesian3.distance(camera.position, midECEF);
  var sseDenom = frustum.sseDenominator;
  var texRadius = Cartesian2.distance(localMid2D, localMax2D);
  var screenSpaceWidth = (texRadius * h) / (distanceToTexCenter * sseDenom);

  screenSpaceWidth /= frameState.pixelRatio;
  var pixelRatio = cascadeWidth / screenSpaceWidth;

  var pixelWidthMeters = (localMax.x - localMin.x) / cascadeWidth;
  var pixelHeightMeters = (localMax.z - localMin.z) / cascadeWidth;

  var metersPerPixel = (pixelWidthMeters + pixelHeightMeters) * 0.5;

  this._u_pixelRatioTimesMetersPerPixel = pixelRatio * metersPerPixel;

  var ecToTan = this._u_eyeSpaceToTangentSpace;
  Matrix4.multiply(tanView, camera.inverseViewMatrix, ecToTan);
  this._u_eyeSpaceToTangentSpace = ecToTan;

  var framebuffer = passState.framebuffer;

  passState.framebuffer = this._framebuffer;
  this._clearCommand.execute(context, passState);

  passState.framebuffer = this._computeBoundsFramebuffer;
  this._computeBoundsCommand.execute(context, passState);

  passState.framebuffer = framebuffer;
};

/**
 * Queues commands to composite the clamped vector tiles into the frame.
 *
 * @param {FrameState} frameState The current frame state.
 * @private
 */
MultitextureClampBuffer.prototype.composite = function (context, passState) {
  this._localCompositeCommand.execute(context, passState);
};

/**
 * Returns true if this object was destroyed; otherwise, false.
 * <p>
 * If this object was destroyed, it should not be used; calling any function other than
 * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.
 * </p>
 *
 * @returns {Boolean} <code>true</code> if this object was destroyed; otherwise, <code>false</code>.
 */
MultitextureClampBuffer.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys the WebGL resources held by this object.  Destroying an object allows for deterministic
 * release of WebGL resources, instead of relying on the garbage collector to destroy this object.
 * <p>
 * Once an object is destroyed, it should not be used; calling any function other than
 * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.  Therefore,
 * assign the return value (<code>undefined</code>) to the object as done in the example.
 * </p>
 *
 * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
 */
MultitextureClampBuffer.prototype.destroy = function () {
  destroyColorTexturesAndFramebuffers(this);
  destroyComputeBoundsTextureAndFramebuffer(this);

  this._clearCommand = undefined;
  this._computeBoundsCommand = undefined;
  this._localCompositeCommand = undefined;

  return destroyObject(this);
};

export default MultitextureClampBuffer;
