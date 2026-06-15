#pragma once
#include <cstdint>
#include "of/vec3.h"

namespace of {

// Identifies a reference frame (star=root, planet, moon, vessel, ...).
using FrameId = uint32_t;
constexpr FrameId kRootFrame = 0;  // the star / universe root frame

// A 64-bit authoritative position, meaningless without the frame it lives in.
// (spike1-core-engine §5: a UniverseCoord carries its FrameId — never a bare vector.)
struct UniverseCoord {
  Vec3 pos;                     // metres, double precision, expressed in `frame`
  FrameId frame = kRootFrame;

  UniverseCoord() = default;
  explicit UniverseCoord(Vec3 p, FrameId f = kRootFrame) : pos(p), frame(f) {}
};

}  // namespace of
