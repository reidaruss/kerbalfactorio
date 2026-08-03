#pragma once
#include <unordered_map>
#include "of/universe_coord.h"

namespace of {

// One node in the reference-frame hierarchy (star -> planet -> moon -> ...).
//
// FRAMES MOVE (D-014, PH-172). This used to say "for the Wave-0 core, frames
// are static offsets; orbital motion is layered on by the physics core", and
// that placeholder was correct until something looked at both copies of where
// a moon is. `setOffset` below is the layering-on: the OFFSET is still a plain
// vector and this file still has no opinion about ephemerides, because where a
// body is belongs to `of::orbital` (DW-18's rule about mu, applied to
// position). What changed is that the offset is no longer assumed constant.
struct Frame {
  FrameId id = kRootFrame;
  FrameId parent = kRootFrame;
  Vec3 offsetFromParent{};   // metres, in the parent frame
  double soiRadius = 0.0;    // sphere-of-influence radius (for SOI switching)
};

// The frame graph. Re-expresses a UniverseCoord between frames (same physical
// point, different frame of reference) — the foundation for SOI transitions.
class FrameGraph {
 public:
  FrameId addFrame(FrameId parent, Vec3 offsetFromParent, double soiRadius = 0.0) {
    const FrameId id = static_cast<FrameId>(frames_.size()) + 1;  // 0 = root
    frames_[id] = Frame{id, parent, offsetFromParent, soiRadius};
    return id;
  }

  // MOVE A FRAME. The caller owns the ephemeris and this owns the graph, which
  // is the split that keeps there being ONE answer to where a body is: nothing
  // here computes a position, and nothing outside here re-implements the walk
  // up the parent chain. A frame that does not exist is ignored rather than
  // created, because silently creating one would put a body at an offset
  // nobody asked for.
  void setOffset(FrameId f, const Vec3& offsetFromParent) {
    auto it = frames_.find(f);
    if (it != frames_.end()) it->second.offsetFromParent = offsetFromParent;
  }

  // Position of a frame's origin expressed in root (star) coordinates.
  Vec3 rootOffset(FrameId f) const {
    Vec3 acc{};
    FrameId cur = f;
    while (cur != kRootFrame) {
      auto it = frames_.find(cur);
      if (it == frames_.end()) break;
      acc = acc + it->second.offsetFromParent;
      cur = it->second.parent;
    }
    return acc;
  }

  // Re-express a coordinate into `target` frame (identical physical point).
  UniverseCoord toFrame(const UniverseCoord& uc, FrameId target) const {
    const Vec3 root = uc.pos + rootOffset(uc.frame);
    return UniverseCoord(root - rootOffset(target), target);
  }

  UniverseCoord toRoot(const UniverseCoord& uc) const {
    return toFrame(uc, kRootFrame);
  }

  const Frame& frame(FrameId id) const { return frames_.at(id); }
  bool has(FrameId id) const { return frames_.count(id) != 0; }
  size_t size() const { return frames_.size(); }

 private:
  std::unordered_map<FrameId, Frame> frames_;
};

}  // namespace of
