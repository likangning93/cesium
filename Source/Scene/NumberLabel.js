import BoundingSphere from "../Core/BoundingSphere.js";
import Cartesian3 from "../Core/Cartesian3.js";

/**
 * A NumberLabel oriented in 3D space, for use with elevation contours and such.
 * Automatically rotates to face up or towards the horizon based on camera position.
 *
 * @param {Object} options Options Object containing:
 * @param {String} options.numberString A string representing the number to be displayed, with desired truncation, decimal separation, etc. Should only contain characters 0123456789,.e+-.
 * @param {Cartesian3} options.position the Position at which to display the number label
 * @param {Number} options.heading the heading for the NumberLabel
 * @param {NumberLabelCollection} The NumberLabelCollection that this NumberLabel belongs to.
 */
function NumberLabel(options, numberLabelCollection) {
  // TODO: checks, also check if numberString only contains valid chars

  this._numberString = options.numberString;
  this._position = Cartesian3.clone(options.position);
  this._heading = options.heading;
  this._numberLabelCollection = numberLabelCollection;

  this._boundingSphere = new BoundingSphere(Cartesian3.ZERO, 0.0);
  this._batchIds = [];
}

function makeDirty(numberLabel) {
  numberLabel._numberLabelCollection._updateLabel(numberLabel);
}

Object.defineProperties(NumberLabel.prototype, {
  /**
   * Gets or sets the Cartesian position of this label.
   * @memberof NumberLabel.prototype
   * @type {Cartesian3}
   */
  position: {
    get: function () {
      return this._position;
    },
    set: function (value) {
      var currentPosition = this._position;
      if (!Cartesian3.equals(currentPosition, value)) {
        Cartesian3.clone(value, currentPosition);
        makeDirty(this);
      }
    },
  },
  /**
   * Gets or sets the String to be shown.
   * @memberof NumberLabel.prototype
   * @type {String}
   */
  numberString: {
    get: function () {
      return this._numberString;
    },
    set: function (value) {
      if (this._numberString === value) {
        return;
      }
      this._numberString = value;
      makeDirty(this);
    },
  },

  /**
   * Heading for the NumberLabel. When viewed from above, the NumberLabel's top
   * will point towards this heading. When viewed from horizon-view, the NumberLabel's
   * backside will point towards this heading.
   * @memberof NumberLabel.prototype
   * @type {String}
   */
  heading: {
    get: function () {
      return this._heading;
    },
    set: function (value) {
      if (this._heading === value) {
        return;
      }
      this._heading = value;
      makeDirty(this);
    },
  },
});

export default NumberLabel;
