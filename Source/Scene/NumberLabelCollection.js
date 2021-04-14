import Appearance from "../Scene/Appearance.js";
import BlendingState from "../Scene/BlendingState.js";
import BoundingSphere from "../Core/BoundingSphere.js";
import Cartesian2 from "../Core/Cartesian2.js";
import Cartesian3 from "../Core/Cartesian3.js";
import Color from "../Core/Color.js";
import ComponentDatatype from "../Core/ComponentDatatype.js";
import createGuid from "../Core/createGuid.js";
import Geometry from "../Core/Geometry.js";
import defaultValue from "../Core/defaultValue.js";
import defined from "../Core/defined.js";
import destroyObject from "../Core/destroyObject.js";
import DrawCommand from "../Renderer/DrawCommand.js";
import Ellipsoid from "../Core/Ellipsoid.js";
import GeometryAttribute from "../Core/GeometryAttribute.js";
import GeometryInstance from "../Core/GeometryInstance.js";
import GeometryInstanceAttribute from "../Core/GeometryInstanceAttribute.js";
import Matrix4 from "../Core/Matrix4.js";
import NumberLabel from "./NumberLabel.js";
import NumberLabelCollectionVS from "./NumberLabelCollectionVS.js";
import NumberLabelCollectionFS from "./NumberLabelCollectionFS.js";
import Pass from "../Renderer/Pass.js";
import Primitive from "./Primitive.js";
import PrimitiveType from "../Core/PrimitiveType.js";
import RenderState from "../Renderer/RenderState.js";
import Sampler from "../Renderer/Sampler.js";
import Texture from "../Renderer/Texture.js";
import TextureMagnificationFilter from "../Renderer/TextureMagnificationFilter.js";
import TextureMinificationFilter from "../Renderer/TextureMinificationFilter.js";
import Transforms from "../Core/Transforms.js";
import VerticalOrigin from "./VerticalOrigin.js";
import writeTextToCanvas from "../Core/writeTextToCanvas.js";

var FONT = "px monospace";
var ALLOWED_CHARS = "0123456789-+.,e";
var ALLOWED_CHARS_LENGTH = ALLOWED_CHARS.length;

var SPACE_INDEX = ALLOWED_CHARS_LENGTH;
var CHARS_TO_INDICES = {};
for (var c = 0; c < ALLOWED_CHARS_LENGTH; c++) {
  CHARS_TO_INDICES[ALLOWED_CHARS[c]] = c;
}
CHARS_TO_INDICES[" "] = ALLOWED_CHARS_LENGTH;

function NumberLabelCollection(ellipsoid, backgroundColor, pixelHeight) {
  this._labels = [];
  this._boundingSphere = new BoundingSphere(Cartesian3.ZERO, 0.0);
  this._pixelHeight = defaultValue(pixelHeight, 24);

  this._glyphTexture = undefined;
  this._glyphPixelSize = new Cartesian2();
  this._singlePixelSize = new Cartesian2();

  this._primitive = undefined;
  this._recreatePrimitive = true;
  this._typesetAll = false;

  this._enuToFixedFrame = new Matrix4();
  this._fixedFrameToEnu = new Matrix4();
  this._ellipsoid = defaultValue(ellipsoid, Ellipsoid.WGS84);

  this._backgroundColor = defaultValue(backgroundColor, Color.BLACK);
  this._renderState = RenderState.fromCache({
    cull: {
      enabled: true,
    },
    blending: BlendingState.PRE_MULTIPLIED_ALPHA_BLEND,
    depthTest: {
      enabled: true,
    },
  });

  var that = this;
  this._uniformMap = {
    u_glyphPixelSize: function () {
      return that._glyphPixelSize;
    },
    u_singlePixelSize: function () {
      return that._singlePixelSize;
    },
    u_glyphs: function () {
      return that._glyphTexture;
    },
    u_backgroundColor: function () {
      return that._backgroundColor;
    },
  };

  this.show = true;
}

NumberLabelCollection.prototype._updateLabel = function (numberLabel) {
  if (numberLabel.numberString.length > numberLabel._batchIds.length) {
    this._recreatePrimitive = true; // not enough geometry, make more
  } else {
    typeSetLabel(numberLabel, this); // just update the batch table
  }
};

/**
 * Creates and adds a label with the specified initial properties to the collection.
 * The added label is returned so it can be modified or removed from the collection later.
 *
 * @param {Object} options Options Object containing:
 * @param {String} options.numberString A string representing the number to be displayed, with desired truncation, decimal separation, etc. Should only contain characters 0123456789,.e+-.
 * @param {Cartesian3} options.position the Position at which to display the number label
 * @param {Number} options.heading the heading for the NumberLabel
 * @returns {NumberLabel} the NumberLabel that was added to the collection
 */
NumberLabelCollection.prototype.add = function (options) {
  var label = new NumberLabel(options, this);
  this._labels.push(label);
  this._recreatePrimitive = true;

  // TODO: maybe assign the label to a set of GeometryInstances instead of recreating?

  return label;
};

NumberLabelCollection.prototype.remove = function (label) {
  var index = this._labels.indexOf(label);
  if (index !== -1) {
    this._labels.splice(index, 1);
    this._recreatePrimitive = true;
    return true;
  }
  return false;
};

/**
 * 1--3  // 0 - 00 - lower left
 * |\ |  // 1 - 01 - upper left
 * | \|  // 2 - 10 - lower right
 * 0--2  // 3 - 11 - upper right
 */
var VERTEX_INDICES = new Uint8Array([0, 2, 1, 2, 3, 1]);

function createGeometryInstancesForLabel(numberLabel, charCount, instances) {
  var batchIds = numberLabel._batchIds;
  batchIds.length = charCount;

  for (var i = 0; i < charCount; i++) {
    var geometry = new Geometry({
      attributes: {
        position: new GeometryAttribute({
          componentDatatype: ComponentDatatype.UNSIGNED_BYTE,
          componentsPerAttribute: 1,
          normalize: false,
          values: VERTEX_INDICES,
        }),
      },
      primitiveType: PrimitiveType.TRIANGLES,
      boundingSphere: numberLabel._boundingSphere,
    });

    var instanceAttributes = {
      characterId: new GeometryInstanceAttribute({
        componentDatatype: ComponentDatatype.UNSIGNED_BYTE,
        componentsPerAttribute: 1,
        normalize: false,
        value: [SPACE_INDEX],
      }),
      characterBottomLeftAlign: new GeometryInstanceAttribute({
        componentDatatype: ComponentDatatype.BYTE,
        componentsPerAttribute: 2,
        normalize: false,
        value: [0, 0],
      }),
      labelRotation: new GeometryInstanceAttribute({
        componentDatatype: ComponentDatatype.FLOAT,
        componentsPerAttribute: 2,
        normalize: false,
        value: [0.0, 0.0], // cosine and sine of heading, make a matrix in VS
      }),
      labelTranslationFromCenter: new GeometryInstanceAttribute({
        componentDatatype: ComponentDatatype.FLOAT,
        componentsPerAttribute: 3,
        normalize: false,
        value: [0.0, 0.0, 0.0],
      }),
    };

    var batchId = createGuid();

    instances.push(
      new GeometryInstance({
        geometry: geometry,
        attributes: instanceAttributes,
        id: batchId,
      })
    );

    batchIds[i] = batchId;
  }
}

var offsetFromCenterScratch = new Cartesian3();
function typeSetLabel(numberLabel, numberLabelCollection) {
  var primitive = numberLabelCollection._primitive;

  // compute label's current offset from collection center
  var offsetFromCenter = offsetFromCenterScratch;
  Matrix4.multiplyByPoint(
    numberLabelCollection._fixedFrameToEnu,
    numberLabel.position,
    offsetFromCenter
  );
  var packedTranslation = Cartesian3.pack(offsetFromCenter, [0, 0, 0]);

  // compute 2D rotation params in collection-local space for heading
  var heading = numberLabel.heading;
  var rotationComponents = [Math.cos(heading), Math.sin(heading)];

  var numberString = numberLabel.numberString;
  var numberStringLength = numberString.length;
  var batchIds = numberLabel._batchIds;
  var i;
  var attributes;

  var verticalOrigin = numberLabel.verticalOrigin;
  var charVerticalOffset = 0;
  if (verticalOrigin === VerticalOrigin.BOTTOM) {
    charVerticalOffset = 1;
  } else if (verticalOrigin === VerticalOrigin.TOP) {
    charVerticalOffset = -1;
  }

  var stringLeftAlign = -Math.floor(numberStringLength * 0.5); // signed byte
  for (i = 0; i < numberStringLength; i++) {
    attributes = primitive.getGeometryInstanceAttributes(batchIds[i]);

    // character and offset to the right place in the string
    attributes.characterId = [CHARS_TO_INDICES[numberString[i]]];
    attributes.characterBottomLeftAlign = [
      stringLeftAlign + i,
      charVerticalOffset,
    ];

    // common across all chars in label
    attributes.labelRotation = rotationComponents;
    attributes.labelTranslationFromCenter = packedTranslation;
  }

  // "deactivate" the rest of the digit labels by making them into spaces
  var batchIdsLength = batchIds.length;
  for (i = numberStringLength; i < batchIdsLength; i++) {
    attributes = primitive.getGeometryInstanceAttributes(batchIds[i]);
    attributes.characterId = [SPACE_INDEX];
  }
}

function createGlyphTexture(numberLabelCollection, frameState) {
  var canvas = writeTextToCanvas(ALLOWED_CHARS, {
    font: numberLabelCollection._pixelHeight + FONT,
  });

  var glyphPixelSize = numberLabelCollection._glyphPixelSize;
  var singlePixelSize = numberLabelCollection._singlePixelSize;

  var canvasWidth = canvas.width;
  var canvasHeight = canvas.height;

  glyphPixelSize.x = canvasWidth / ALLOWED_CHARS_LENGTH;
  glyphPixelSize.y = canvasHeight;

  console.log("canvas width:     " + canvasWidth);
  console.log("canvas height:    " + canvasHeight);
  console.log("allowed chars:    " + ALLOWED_CHARS_LENGTH);
  console.log("glyph dimensions: " + glyphPixelSize.x);

  singlePixelSize.x = 1.0 / canvasWidth;
  singlePixelSize.y = 1.0 / canvasHeight;

  numberLabelCollection._glyphTexture = new Texture({
    context: frameState.context,
    width: canvasWidth,
    height: canvasHeight,
    source: canvas,
    sampler: new Sampler({
      minificationFilter: TextureMinificationFilter.LINEAR,
      magnificationFilter: TextureMagnificationFilter.LINEAR,
    }),
  });
}

function createCommands(numberLabelCollection, colorCommands) {
  var primitive = numberLabelCollection._primitive;
  var length = primitive._va.length;
  colorCommands.length = length;

  var uniformMap = primitive._batchTable.getUniformMapCallback()(
    numberLabelCollection._uniformMap
  );

  for (var i = 0; i < length; i++) {
    var vertexArray = primitive._va[i];

    var command = colorCommands[i];
    if (!defined(command)) {
      command = colorCommands[i] = new DrawCommand({
        owner: numberLabelCollection,
        primitiveType: primitive._primitiveType,
      });
    }

    command.vertexArray = vertexArray;
    command.renderState = numberLabelCollection._renderState;
    command.shaderProgram = primitive._sp;
    command.uniformMap = uniformMap;
    command.pass = Pass.OVERLAY;
  }
}

function createPrimitive(numberLabelCollection) {
  // each glyph is a GeometryInstance
  // * vertices have:
  //   - which vert is this in the quad
  //   - batchID
  // * batch table provides:
  //   - uint8 character ID for looking up char texture
  //   - int8 char offset in label local space, scalable by distance to eye
  //   - vec2 2d rotation for whole label in collection-local space
  //   - vec3 translation for whole label to the right place in collection-local space
  // * uniforms:
  //   - transformation from collection-local space to eyespace
  //   - glyph texture
  //   - multipliers for char width/height
  //   - eye coordinates in collection-local space, so we know when to flip glyph cards (TODO)

  var boundingSphere = numberLabelCollection._boundingSphere;
  var enuToFixedFrame = numberLabelCollection._enuToFixedFrame;
  var labels = numberLabelCollection._labels;
  var labelsLength = labels.length;
  var maxCharWidth = 0;
  var i;

  // Figure out the longest label string, and make all labels double that length
  // so there's room for changes with just batch table updates.
  for (i = 0; i < labelsLength; i++) {
    var numberLabel = labels[i];
    maxCharWidth = Math.max(maxCharWidth, numberLabel.numberString.length);
  }

  // Compute bounding sphere
  Cartesian3.clone(labels[0].position, boundingSphere.center);
  boundingSphere.radius = 0.0;
  for (i = 1; i < labelsLength; i++) {
    BoundingSphere.expand(boundingSphere, labels[i].position);
  }

  if (labelsLength === 1) {
    boundingSphere.radius = 1.0;
  }

  var charCount = maxCharWidth + maxCharWidth;

  Transforms.eastNorthUpToFixedFrame(
    boundingSphere.center,
    numberLabelCollection._ellipsoid,
    enuToFixedFrame
  );

  Matrix4.inverse(enuToFixedFrame, numberLabelCollection._fixedFrameToEnu);

  // Create GeometryInstances for character cards
  var geometryInstances = [];
  for (i = 0; i < labelsLength; i++) {
    createGeometryInstancesForLabel(labels[i], charCount, geometryInstances);
  }

  var vs3D = "";
  vs3D +=
    "#define ALLOWED_CHARS_LENGTH " + ALLOWED_CHARS_LENGTH.toFixed(1) + "\n";
  vs3D += "#define SPACE_INDEX " + SPACE_INDEX.toFixed(1) + "\n";
  vs3D += NumberLabelCollectionVS;

  var primitiveOptions = {
    geometryInstances: geometryInstances,
    vertexCacheOptimize: false,
    interleave: false,
    releaseGeometryInstances: true,
    allowPicking: false,
    asynchronous: false,
    compressVertices: false,
    debugShowBoundingVolume: true,
    appearance: new Appearance({
      renderState: numberLabelCollection._renderState,
      vertexShaderSource: vs3D,
      fragmentShaderSource: NumberLabelCollectionFS,
    }),
    modelMatrix: numberLabelCollection._enuToFixedFrame,
  };
  primitiveOptions._createCommandsFunction = function (
    primitive,
    appearance,
    material,
    translucent,
    twoPasses,
    colorCommands,
    pickCommands
  ) {
    createCommands(numberLabelCollection, colorCommands);
  };

  numberLabelCollection._primitive = new Primitive(primitiveOptions);
  numberLabelCollection._recreatePrimitive = false;
  numberLabelCollection._typesetAll = true;
}

NumberLabelCollection.prototype.update = function (frameState) {
  if (this._labels.length === 0) {
    return;
  }

  if (!defined(this._glyphTexture)) {
    createGlyphTexture(this, frameState);
  }

  if (this._typesetAll) {
    // Now that we have a primitive, typeset all the labels
    var labels = this._labels;
    var labelsLength = labels.length;
    for (var i = 0; i < labelsLength; i++) {
      typeSetLabel(labels[i], this);
      this._typesetAll = false;
    }
  }

  var primitive = this._primitive;
  if (this._recreatePrimitive) {
    this._primitive = this._primitive && this._primitive.destroy();
    createPrimitive(this);
    primitive = this._primitive;
  }

  primitive.show = this.show;
  primitive.update(frameState);
};

NumberLabelCollection.prototype.isDestroyed = function () {
  return false;
};

NumberLabelCollection.prototype.destroy = function () {
  this._primitive = this._primitive && this._primitive.destroy();
  this._glyphTexture = this._glyphTexture && this._glyphTexture.destroy();

  return destroyObject(this);
};

export default NumberLabelCollection;
