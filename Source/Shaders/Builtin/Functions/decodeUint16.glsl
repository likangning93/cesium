/**
 * Decodes a uint16 value packed into two uint8 values.
 *
 * @name czm_decodeUint16
 * @glslFunction
 *
 * @param {int} uint8Low Normalized low-magnitude portion of the uint16.
 * @param {int} uint8High Normalized high-magnitude portion of the uint16.
 *
 * @returns {int} an integer representing the uint16 value
 */
int czm_decodeUint16(int uint8Low, int uint8High) {
    return uint8Low + 256 * uint8High;
}
