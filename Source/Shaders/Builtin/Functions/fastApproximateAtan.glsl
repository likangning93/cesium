// Based on Michal Drobot's approximation from ShaderFastLibs, which in turn is based on
// "Efficient approximations for the arctangent function," Rajan, S. Sichun Wang Inkol, R. Joyal, A., May 2006.
// Adapted from ShaderFastLibs under MIT License.
//
// Chosen for the following characteristics over range [0, 1]:
// - basically no error at 0 and 1, important for getting around range limit (naive atan2 via atan requires infinite range atan)
// - no visible artifacts from first-derivative discontinuities, unlike latitude via range-reduced sqrt asin approximations (at equator)
//
// The original code is x * (-0.1784 * abs(x) - 0.0663 * x * x + 1.0301);
// Removed the abs() in here because it isn't needed, the input range is guaranteed as [0, 1] by how we're approximating atan2.
float czm_fastApproximateAtan(float x) {
    return x * (-0.1784 * x - 0.0663 * x * x + 1.0301);
}

// Range reduction math based on nvidia's cg reference implementation for atan2: http://developer.download.nvidia.com/cg/atan2.html
// However, we replaced their atan curve with Michael Drobot's.
float czm_fastApproximateAtan(float x, float y) {
    // atan approximations are usually only reliable over [-1, 1], or, in our case, [0, 1] due to modifications.
    // So range-reduce using abs and by flipping whether x or y is on top.
    float t = abs(x); // t used as swap and atan result.
    float opposite = abs(y);
    float adjacent = max(t, opposite);
    opposite = min(t, opposite);

    t = czm_fastApproximateAtan(opposite / adjacent);

    // Undo range reduction
    t = czm_branchFreeTernaryFloat(abs(y) > abs(x), czm_piOverTwo - t, t);
    t = czm_branchFreeTernaryFloat(x < 0.0, czm_pi - t, t);
    t = czm_branchFreeTernaryFloat(y < 0.0, -t, t);
    return t;
}
