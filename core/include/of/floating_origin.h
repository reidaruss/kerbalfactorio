#pragma once
#include "of/universe_coord.h"

namespace of {

// Floating origin (spike1-core-engine §1, decisions CE-4/CE-5/CE-6).
//
// The engine/GPU/physics only ever see coordinates relative to `originPos`,
// kept near zero. The 64-bit authority lives in UniverseCoord; this class is
// the bridge to the 32-bit near-origin world. We drive the rebase explicitly
// (CE-5) rather than trusting the engine's automatic origin shifting.
class FloatingOrigin {
 public:
  explicit FloatingOrigin(double rebaseThresholdM = 4000.0)
      : threshold_(rebaseThresholdM) {}

  FrameId frame() const { return frame_; }
  Vec3 originPos() const { return originPos_; }
  int rebaseCount() const { return rebases_; }
  Vec3 lastDelta() const { return lastDelta_; }

  // Engine-space (double) position of a same-frame universe coord.
  Vec3 toEngineD(const UniverseCoord& uc) const { return uc.pos - originPos_; }

  // Engine-space (float) position — what the GPU/physics actually consume.
  Vec3f toEngine(const UniverseCoord& uc) const { return toFloat(toEngineD(uc)); }

  // Inverse: lift an engine-space position back to a 64-bit universe coord.
  UniverseCoord fromEngine(const Vec3& enginePos) const {
    return UniverseCoord(originPos_ + enginePos, frame_);
  }

  // CE-6 position trigger: if the observer drifts past the threshold, rebase the
  // world under it. Returns true iff a rebase happened. Relative positions are
  // invariant across a rebase (the correctness property the tests pin down).
  bool maybeRebase(const UniverseCoord& observer) {
    const Vec3 d = observer.pos - originPos_;
    if (d.length() > threshold_) {
      originPos_ = observer.pos;
      frame_ = observer.frame;
      lastDelta_ = d;
      ++rebases_;
      return true;
    }
    return false;
  }

 private:
  double threshold_;
  Vec3 originPos_{};
  FrameId frame_ = kRootFrame;
  Vec3 lastDelta_{};
  int rebases_ = 0;
};

}  // namespace of
