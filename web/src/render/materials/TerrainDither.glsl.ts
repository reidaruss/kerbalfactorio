// The terrain's ordered-dither threshold, moved out of TerrainShader.ts at
// RN-148 purely for the 400-line cap, exactly as CASCADE_GLSL moved at RN-78:
// the GLSL is unchanged to the character. It backs the stream-in cross-fade
// (mechanism 3, ARCHITECTURE.md section 4.5): complementary thresholds on the
// outgoing and incoming chunk so every pixel is covered by exactly one of the
// two mid-dissolve.

/** Ordered 4x4 Bayer threshold, in [0,1). */
export const BAYER = /* glsl */`
  float ofBayer4(vec2 p) {
    int x = int(mod(p.x, 4.0));
    int y = int(mod(p.y, 4.0));
    const float M[16] = float[16](
      0.0,  8.0,  2.0, 10.0,
     12.0,  4.0, 14.0,  6.0,
      3.0, 11.0,  1.0,  9.0,
     15.0,  7.0, 13.0,  5.0);
    return (M[y * 4 + x] + 0.5) * 0.0625;
  }
`;
