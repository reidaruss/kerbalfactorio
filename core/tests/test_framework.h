#pragma once
// Minimal, dependency-free test harness for the headless Wave-0 cores.
// (Kept self-contained on purpose — no network fetch, no external test lib.)
#include <cmath>
#include <cstdio>
#include <functional>
#include <string>
#include <vector>

namespace tf {

struct TestCase {
  std::string name;
  std::function<void()> fn;
};

inline std::vector<TestCase>& registry() {
  static std::vector<TestCase> r;
  return r;
}
inline int& failures() { static int f = 0; return f; }
inline int& checks() { static int c = 0; return c; }

struct Registrar {
  Registrar(const std::string& n, std::function<void()> fn) {
    registry().push_back({n, std::move(fn)});
  }
};

inline void check(bool cond, const char* expr, const char* file, int line) {
  ++checks();
  if (!cond) {
    ++failures();
    std::printf("    FAIL %s:%d:  %s\n", file, line, expr);
  }
}

inline void check_near(double a, double b, double tol, const char* expr,
                       const char* file, int line) {
  ++checks();
  if (std::fabs(a - b) > tol) {
    ++failures();
    std::printf("    FAIL %s:%d:  %s  (|%.17g - %.17g| = %.3g > %.3g)\n", file,
                line, expr, a, b, std::fabs(a - b), tol);
  }
}

inline int run_all() {
  int failed = 0;
  for (auto& t : registry()) {
    const int before = failures();
    std::printf("[ RUN  ] %s\n", t.name.c_str());
    t.fn();
    if (failures() > before) {
      std::printf("[ FAIL ] %s\n", t.name.c_str());
      ++failed;
    } else {
      std::printf("[  OK  ] %s\n", t.name.c_str());
    }
  }
  std::printf("\n%d checks run, %d failed across %d test(s).\n", checks(),
              failures(), failed);
  std::printf("%s\n", failed == 0 ? "ALL TESTS PASSED" : "TESTS FAILED");
  return failed == 0 ? 0 : 1;
}

}  // namespace tf

#define TEST(name)                                      \
  static void name();                                   \
  static ::tf::Registrar tf_reg_##name(#name, name);    \
  static void name()

#define CHECK(cond) ::tf::check((cond), #cond, __FILE__, __LINE__)
#define CHECK_NEAR(a, b, tol) \
  ::tf::check_near((a), (b), (tol), #a " ~= " #b, __FILE__, __LINE__)
