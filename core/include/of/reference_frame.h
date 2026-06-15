#pragma once
#include <unordered_map>
#include "of/universe_coord.h"

namespace of {

// One node in the reference-frame hierarchy (star -> planet -> moon -> ...).
// For the Wave-0 core, frames are static offsets; orbital motion (frames moving
// over SimTime) is layered on by the physics core (spike2).
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
