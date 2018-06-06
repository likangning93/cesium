/**
 * Computes distance from an point in 2D to a line in 2D.
 *
 * @name czm_lineDistance
 * @glslFunction
 *
 * param {vec2} point1 A point along the line.
 * param {vec2} point2 A point along the line.
 * param {vec2} point A point that may or may not be on the line.
 * returns {float} The distance from the point to the line.
 */
float czm_lineDistance(vec2 point1, vec2 point2, vec2 point) {
    return abs((point2.y - point1.y) * point.x - (point2.x - point1.x) * point.y + point2.x * point1.y - point2.y * point1.x) / distance(point2, point1);
}

float magnitudeSquared(vec3 v) {
    return v.x * v.x + v.y * v.y + v.z * v.z;
}

/**
 * Computes distance from an point in 3D to a line in 3D.
 *
 * @name czm_lineDistance
 * @glslFunction
 *
 * param {vec3} point1 A point along the line.
 * param {vec3} point2 A point along the line.
 * param {vec3} point A point that may or may not be on the line.
 * returns {float} The distance from the point to the line.
 */
float czm_lineDistance(vec3 point1, vec3 point2, vec3 point) {
    return (length(cross(point - point1, point - point2)) / length(point2 - point1));
}
