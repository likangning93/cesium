/**
 * Check if a 2D line segment intersects a 2D axis-aligned bounding box.
 *
 * @name czm_intersectLineSegmentAABB2D
 * @glslFunction
 *
 * param {vec2} start Start point of the line segment.
 * param {vec2} end End point of the line segment.
 * param {vec2} boxMin Minimum of the axis aligned bounding box
 * param {vec2} boxMax Maximum of the axis aligned bounding box
 * returns {bool} Whether or not the line segment intersects the AABB.
 */
bool czm_intersectLineSegmentAABB2D(vec2 start, vec2 end, vec2 boxMin, vec2 boxMax) {
  vec2 delta = end - start;
  vec2 boxCenter = (boxMin + boxMax) * 0.5;
  vec2 halfAxes = (boxMax - boxMin) * 0.5;

  float scaleX = 1.0 / delta.x;
  float scaleY = 1.0 / delta.y;
  float signX = sign(scaleX);
  float signY = sign(scaleY);
  float nearTimeX = (boxCenter.x - signX * (halfAxes.x) - start.x) * scaleX;
  float nearTimeY = (boxCenter.y - signY * (halfAxes.y) - start.y) * scaleY;
  float farTimeX = (boxCenter.x + signX * (halfAxes.x) - start.x) * scaleX;
  float farTimeY = (boxCenter.y + signY * (halfAxes.y) - start.y) * scaleY;

  bool noISX = (nearTimeX > farTimeY || nearTimeY > farTimeX);

  float nearTime = czm_branchFreeTernary(nearTimeX > nearTimeY, nearTimeX, nearTimeY);
  float farTime = czm_branchFreeTernary(farTimeX < farTimeY, farTimeX, farTimeY);

  noISX = noISX || (nearTime >= 1.0 || farTime <= 0.0);

  return !noISX;
}
