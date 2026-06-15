#pragma once
#include <cstdint>

namespace of {

// Fixed-timestep simulation clock decoupled from render (decision CE-3).
// Render interpolates between sim ticks using alpha(); networking/determinism
// keys off tickIndex().
class SimClock {
 public:
  explicit SimClock(double fixedDt = 1.0 / 60.0) : fixedDt_(fixedDt) {}

  // Advance by a wall-clock delta; returns how many fixed ticks elapsed.
  int advance(double wallDt) {
    acc_ += wallDt;
    int n = 0;
    while (acc_ >= fixedDt_) {
      acc_ -= fixedDt_;
      ++tick_;
      ++n;
    }
    return n;
  }

  uint64_t tickIndex() const { return tick_; }
  double fixedDt() const { return fixedDt_; }
  double simTime() const { return static_cast<double>(tick_) * fixedDt_; }

  // Interpolation factor in [0, 1) for the render frame between two sim ticks.
  double alpha() const { return acc_ / fixedDt_; }

 private:
  double fixedDt_;
  double acc_ = 0.0;
  uint64_t tick_ = 0;
};

}  // namespace of
