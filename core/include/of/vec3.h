#pragma once
#include <cmath>

namespace of {

// Double-precision 3-vector. The 64-bit authority type (positions, velocities).
struct Vec3 {
  double x = 0, y = 0, z = 0;
  Vec3() = default;
  Vec3(double X, double Y, double Z) : x(X), y(Y), z(Z) {}

  Vec3 operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
  Vec3 operator-(const Vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
  Vec3 operator*(double s) const { return {x * s, y * s, z * s}; }

  double dot(const Vec3& o) const { return x * o.x + y * o.y + z * o.z; }
  double lengthSq() const { return dot(*this); }
  double length() const { return std::sqrt(lengthSq()); }
};

// Single-precision 3-vector. The engine/GPU/physics type (always near the
// floating origin, so 32-bit precision is sufficient there).
struct Vec3f {
  float x = 0, y = 0, z = 0;
  Vec3f() = default;
  Vec3f(float X, float Y, float Z) : x(X), y(Y), z(Z) {}
};

inline Vec3f toFloat(const Vec3& v) {
  return Vec3f(static_cast<float>(v.x),
               static_cast<float>(v.y),
               static_cast<float>(v.z));
}

}  // namespace of
