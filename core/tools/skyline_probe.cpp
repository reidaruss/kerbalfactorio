// =============================================================================
// skyline_probe.cpp (WG-240): world-gen DIAGNOSTIC. A pure CONSUMER of of_core,
// like terrain_probe / spawn_site; not a ctest.
//
// IT ANSWERS ONE QUESTION: what does the SILHOUETTE look like from a given eye?
//
// Every instrument this project has for the far ground measures a RECTANGLE of
// pixels, i.e. tone. The complaint that produced this tool is not about tone:
// rendering's lane N1 (rendering.md 2.30.9) closed the tone gap by 34 per cent
// at 250 m and wrote down that "at 1x the frame still reads as a plane meeting
// the sky at a razor line", and named the residue a HEIGHT-FIELD property. A
// silhouette is the upper envelope of the ground against the sky, so the
// quantity is an ANGLE per AZIMUTH, and no rectangle can hold it.
//
// THE MEASUREMENT. For each azimuth the tool marches a great circle out to
// --range metres, samples the surface authority (biome.h sampleDesignedHeight,
// the SAME function the client's oracle and mesher consume), and records the
// maximum ELEVATION ANGLE of any point on that ray as seen from the eye. That
// maximum IS the silhouette: the skyline in that direction is the highest thing
// the eye can see, and everything below it is ground. Spherical geometry is
// exact rather than flat-plane, which matters more here than anywhere else in
// the project: Forge is 600 km in radius, so the geometric horizon at a
// standing eye is about 1.4 km and the drop over 10 km is 83 m. A flat-plane
// tool would report relief that curvature has already hidden.
//
// THE STATISTIC IS THE SPREAD, NOT THE LEVEL. A perfectly smooth sphere returns
// the SAME elevation at every azimuth (the limb, -sqrt(2h/R) radians), so its
// spread is exactly zero and its picture is a ruler-straight line. A real
// skyline has spread. The tool therefore reports sd / p05 / p95 / peak-to-peak
// of the elevation profile, in millidegrees AND in PIXELS at the hero frame's
// own scale, because "0.3 degrees of relief" means nothing until it is read as
// "4 pixels on a 900 px frame".
//
// PIXELS. --fov (default 60, CameraRig.ts) and --hpx (default 900, the shot
// manifest's height) give the on-axis scale (hpx/2) / tan(fov/2) px per radian.
// It is the ON-AXIS scale and it is stated as that: a perspective frame is not
// linear in angle, and near the frame edge the same angle covers fewer pixels.
// For a horizon sitting near the frame centre, which is what every ground pose
// in the shot manifest does, the error is a few per cent.
//
// THE RANGE AT THE MAXIMUM is printed beside the angle and it is the diagnostic
// half. If every azimuth's silhouette is found at the same range, that range is
// the geometric limb and the skyline is the PLANET, not the terrain: no relief
// within it is tall enough to break the tangent plane and everything beyond it
// is under the curve. That is a different defect from "the relief is there and
// the LOD flattened it", and the two are indistinguishable in a screenshot.
//
// Usage:
//   skyline_probe [--body forge|cinder] [--seed <hex|dec>]
//                 [--site plains|spawn|mtn|pond] | [--lat D --lon D]
//                 [--eye M] [--range M] [--az0 D --az1 D --azn N]
//                 [--fov D] [--hpx N] [--yaw D] [--field designed|raw|nopad]
//                 [--csv <path>] [--profile]
//
// --field raw drops the design layer (sampleHeightField), which is the arm that
// says whether the design gain is what removed the relief; --field nopad drops
// the home pad only. Default is `designed`, the surface authority.
// =============================================================================
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "of/vec3.h"
#include "of/cubed_sphere.h"
#include "of/biome.h"

using namespace of;
using namespace of::worldgen;

namespace {

constexpr double kDeg = 3.14159265358979323846 / 180.0;

enum class Field { Designed, NoPad, Raw };

Vec3 unit(const Vec3& v) {
  const double l = v.length();
  return l > 0.0 ? Vec3(v.x / l, v.y / l, v.z / l) : v;
}

Vec3 crossOf(const Vec3& a, const Vec3& b) {
  return Vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

double heightAt(const BodyParams& b, const Vec3& dir, Field f) {
  switch (f) {
    case Field::Raw:   return sampleHeightField(b, dir);
    case Field::NoPad: return designedHeightNoPad(b, dir);
    default:           return sampleDesignedHeight(b, dir);
  }
}

// Orthonormal frame at `up`: (east, north, up). `north` is the component of the
// polar axis perpendicular to `up`, so azimuth 0 is true north and azimuth 90 is
// east, which is the convention the client's compass uses.
void frameAt(const Vec3& up, Vec3& east, Vec3& north) {
  const Vec3 pole(0.0, 1.0, 0.0);
  Vec3 n = pole - up * up.dot(pole);
  if (n.length() < 1e-9) n = Vec3(1.0, 0.0, 0.0) - up * up.dot(Vec3(1, 0, 0));
  north = unit(n);
  east = unit(crossOf(north, up));
}

struct Stats {
  double mean = 0, sd = 0, mn = 0, mx = 0, p05 = 0, p50 = 0, p95 = 0;
};

Stats statsOf(std::vector<double> v) {
  Stats s;
  if (v.empty()) return s;
  std::sort(v.begin(), v.end());
  double sum = 0;
  for (double x : v) sum += x;
  s.mean = sum / static_cast<double>(v.size());
  double acc = 0;
  for (double x : v) acc += (x - s.mean) * (x - s.mean);
  s.sd = std::sqrt(acc / static_cast<double>(v.size()));
  s.mn = v.front();
  s.mx = v.back();
  auto q = [&](double f) {
    const double idx = f * static_cast<double>(v.size() - 1);
    const size_t i = static_cast<size_t>(idx);
    const double t = idx - static_cast<double>(i);
    return i + 1 < v.size() ? v[i] * (1 - t) + v[i + 1] * t : v[i];
  };
  s.p05 = q(0.05);
  s.p50 = q(0.50);
  s.p95 = q(0.95);
  return s;
}

}  // namespace

int main(int argc, char** argv) {
  const char* bodyName = "forge";
  uint64_t worldSeed = 0x0bf00d01ull;
  double latDeg = -7.9675, lonDeg = 116.53189;   // the plains hero site
  const char* siteName = "plains";
  double eyeM = 1.62;          // artframe.js: the pose stands at 1.62 m, not 2.0
  double rangeM = 40000.0;
  double az0 = 0.0, az1 = 360.0;
  int azn = 720;
  double fovDeg = 60.0;
  double heroYawDeg = 120.0;   // artframe.js `meadow`: the hero bearing
  double hpx = 900.0;
  Field field = Field::Designed;
  const char* csvPath = nullptr;
  bool wantProfile = false;

  for (int i = 1; i < argc; ++i) {
    auto next = [&](const char* what) -> const char* {
      if (i + 1 >= argc) { std::fprintf(stderr, "skyline_probe: %s needs a value\n", what); std::exit(2); }
      return argv[++i];
    };
    if (!std::strcmp(argv[i], "--body")) bodyName = next("--body");
    else if (!std::strcmp(argv[i], "--seed")) worldSeed = std::strtoull(next("--seed"), nullptr, 0);
    else if (!std::strcmp(argv[i], "--lat")) { latDeg = std::atof(next("--lat")); siteName = "custom"; }
    else if (!std::strcmp(argv[i], "--lon")) { lonDeg = std::atof(next("--lon")); siteName = "custom"; }
    else if (!std::strcmp(argv[i], "--eye")) eyeM = std::atof(next("--eye"));
    else if (!std::strcmp(argv[i], "--range")) rangeM = std::atof(next("--range"));
    else if (!std::strcmp(argv[i], "--az0")) az0 = std::atof(next("--az0"));
    else if (!std::strcmp(argv[i], "--az1")) az1 = std::atof(next("--az1"));
    else if (!std::strcmp(argv[i], "--azn")) azn = std::atoi(next("--azn"));
    else if (!std::strcmp(argv[i], "--fov")) fovDeg = std::atof(next("--fov"));
    else if (!std::strcmp(argv[i], "--yaw")) heroYawDeg = std::atof(next("--yaw"));
    else if (!std::strcmp(argv[i], "--hpx")) hpx = std::atof(next("--hpx"));
    else if (!std::strcmp(argv[i], "--csv")) csvPath = next("--csv");
    else if (!std::strcmp(argv[i], "--profile")) wantProfile = true;
    else if (!std::strcmp(argv[i], "--field")) {
      const char* f = next("--field");
      if (!std::strcmp(f, "raw")) field = Field::Raw;
      else if (!std::strcmp(f, "nopad")) field = Field::NoPad;
      else field = Field::Designed;
    } else if (!std::strcmp(argv[i], "--site")) {
      siteName = next("--site");
      if (!std::strcmp(siteName, "plains"))      { latDeg = -7.9675;   lonDeg = 116.53189; }
      else if (!std::strcmp(siteName, "spawn"))  { latDeg = -3.41413;  lonDeg = 150.27984; }
      else if (!std::strcmp(siteName, "mtn"))    { latDeg = 2.036;     lonDeg = 144.056; }
      else if (!std::strcmp(siteName, "pond"))   { latDeg = -3.4077676; lonDeg = 150.277209; }
      else { std::fprintf(stderr, "skyline_probe: unknown --site '%s'\n", siteName); return 2; }
    } else {
      std::fprintf(stderr, "skyline_probe: unknown arg '%s'\n", argv[i]);
      return 2;
    }
  }

  const bool wantCinder = !std::strcmp(bodyName, "cinder");
  BodyParams body = wantCinder ? makeCinder(worldSeed) : makeForge(worldSeed);
  const double R = body.radiusM;

  const Vec3 up = latLonToDir(latDeg * kDeg, lonDeg * kDeg);
  Vec3 east, north;
  frameAt(up, east, north);
  const double groundM = heightAt(body, up, field);
  const Vec3 eye = up * (R + groundM + eyeM);

  // The limb of a SMOOTH sphere THROUGH THIS SITE's ground, seen from this eye.
  //
  // The reference sphere has radius R + groundM, NOT R: a sphere at the datum
  // seen from 332 m up has a limb 20 km away at -1.9 degrees, which describes
  // an observer floating over an ocean and not a player standing on a plain.
  // The right null hypothesis is "this ground, perfectly smooth", and its limb
  // is -sqrt(2 * eye / (R + ground)) radians at sqrt(2 * (R+ground) * eye)
  // metres. Every skyline number below is read against THAT, because it is
  // what "no terrain relief at all" looks like and it is not zero.
  const double Rg = R + groundM;
  const double limbRad = -std::acos(Rg / (Rg + eyeM));
  const double limbRangeM = std::sqrt((Rg + eyeM) * (Rg + eyeM) - Rg * Rg);

  const double pxPerRad = (hpx * 0.5) / std::tan(0.5 * fovDeg * kDeg);

  std::printf("skyline_probe  body=%s R=%.1f km seed=0x%llx field=%s\n",
              bodyName, R / 1000.0, (unsigned long long)worldSeed,
              field == Field::Raw ? "raw" : field == Field::NoPad ? "nopad" : "designed");
  std::printf("  site=%s lat=%.5f lon=%.5f ground=%.2f m eye=+%.2f m\n",
              siteName, latDeg, lonDeg, groundM, eyeM);

  // THE GATE READOUT. `uplift` is the one macro-scale amplitude switch in the
  // planet stack and every design here turns on what it actually reads at a
  // site, so it is printed rather than reasoned about. Mean |uplift| over a
  // 40 km cap is printed beside the point value because the silhouette is won
  // kilometres away, not underfoot, and a point reading at the eye would be the
  // wrong number to size a term with.
  {
    const double L0p = fbm(body.bodySeed, up, 2.5, 4, 11);
    const double upl = smoothstep(0.10, 0.62, L0p);
    double sumU = 0.0, minU = 2.0, maxU = -1.0;
    int n = 0;
    for (int a = 0; a < 64; ++a) {
      const double azRad = (a * 360.0 / 64.0) * kDeg;
      const Vec3 tangent = north * std::cos(azRad) + east * std::sin(azRad);
      for (double r = 2000.0; r <= 40000.0; r += 2000.0) {
        const double ang = r / R;
        const Vec3 d = unit(up * std::cos(ang) + tangent * std::sin(ang));
        const double u = smoothstep(0.10, 0.62, fbm(body.bodySeed, d, 2.5, 4, 11));
        sumU += u; if (u < minU) minU = u; if (u > maxU) maxU = u; ++n;
      }
    }
    std::printf("  GATE at the eye: L0 %.4f  uplift %.4f   |  over a 40 km cap:"
                " uplift mean %.4f  min %.4f  max %.4f\n",
                L0p, upl, sumU / n, minU, maxU);
  }
  std::printf("  march to %.0f m, %d azimuths over [%.1f, %.1f) deg\n",
              rangeM, azn, az0, az1);
  std::printf("  SMOOTH-SPHERE LIMB: elev %.4f deg at %.0f m (this is the razor)\n",
              limbRad / kDeg, limbRangeM);
  std::printf("  pixel scale: %.2f px/deg on axis (fov %.1f, %.0f px tall)\n",
              pxPerRad * kDeg, fovDeg, hpx);

  std::vector<double> elevDeg(azn), atRangeM(azn), atHeightM(azn);
  // Step law: 2 m near the eye, growing to range/500, so a 40 km march is about
  // 5,000 samples and the near field, where a small rise subtends the most
  // angle, is sampled finest. A coarser near field misses the crest that
  // actually forms the skyline at a standing eye.
  for (int a = 0; a < azn; ++a) {
    const double azRad = (az0 + (az1 - az0) * static_cast<double>(a) / static_cast<double>(azn)) * kDeg;
    const Vec3 tangent = north * std::cos(azRad) + east * std::sin(azRad);
    double best = -1e9, bestR = 0, bestH = 0;
    double r = 2.0;
    while (r <= rangeM) {
      const double ang = r / R;                       // great-circle arc angle
      const Vec3 d = unit(up * std::cos(ang) + tangent * std::sin(ang));
      const double h = heightAt(body, d, field);
      const Vec3 p = d * (R + h);
      const Vec3 v = p - eye;
      const double len = v.length();
      const double elev = std::asin(v.dot(up) / len);
      if (elev > best) { best = elev; bestR = r; bestH = h; }
      r += std::max(2.0, r / 500.0);
    }
    elevDeg[a] = best / kDeg;
    atRangeM[a] = bestR;
    atHeightM[a] = bestH;
  }

  const Stats e = statsOf(elevDeg);
  const Stats rr = statsOf(atRangeM);
  const Stats hh = statsOf(atHeightM);

  // THE FRAME WINDOW, and it is the number the eye judges rather than the
  // whole-circle spread. One 1600x900 frame at fov 60 VERTICAL covers
  // 2*atan(tan(30) * 16/9) = 91.5 degrees of azimuth, so a whole-circle sd
  // averages over four disjoint pictures and can be carried entirely by a
  // massif behind the camera. Every contiguous window of hfov degrees is
  // scored, and the report gives the best, median and worst window as well as
  // the one centred on --yaw, which is the hero pose's own bearing.
  const double hfovDeg = 2.0 * std::atan(std::tan(0.5 * fovDeg * kDeg) * 16.0 / 9.0) / kDeg;
  const double azStep = (az1 - az0) / static_cast<double>(azn);
  const int win = std::max(2, static_cast<int>(hfovDeg / azStep));
  std::vector<double> winSd, winP2p;
  const bool fullCircle = std::fabs((az1 - az0) - 360.0) < 1e-9;
  const int winStarts = fullCircle ? azn : std::max(1, azn - win);
  for (int a = 0; a < winStarts; ++a) {
    std::vector<double> w(win);
    for (int k = 0; k < win; ++k) w[k] = elevDeg[(a + k) % azn];
    const Stats s = statsOf(w);
    winSd.push_back(s.sd);
    winP2p.push_back(s.mx - s.mn);
  }
  const Stats wsd = statsOf(winSd), wp2p = statsOf(winP2p);

  std::printf("\nSKYLINE ELEVATION over %d azimuths\n", azn);
  std::printf("  deg   mean %+.4f  sd %.4f  min %+.4f  p05 %+.4f  p50 %+.4f  p95 %+.4f  max %+.4f\n",
              e.mean, e.sd, e.mn, e.p05, e.p50, e.p95, e.mx);
  std::printf("  mdeg  sd %8.2f   p95-p05 %8.2f   peak-to-peak %8.2f\n",
              e.sd * 1000.0, (e.p95 - e.p05) * 1000.0, (e.mx - e.mn) * 1000.0);
  std::printf("  PX    sd %8.3f   p95-p05 %8.3f   peak-to-peak %8.3f   (on axis)\n",
              e.sd * kDeg * pxPerRad, (e.p95 - e.p05) * kDeg * pxPerRad,
              (e.mx - e.mn) * kDeg * pxPerRad);
  std::printf("  above the smooth limb: mean %+.4f deg (%.2f px)\n",
              e.mean - limbRad / kDeg, (e.mean - limbRad / kDeg) * kDeg * pxPerRad);
  std::printf("  RANGE AT THE SILHOUETTE: p05 %8.0f  p50 %8.0f  p95 %8.0f m"
              "   (smooth limb %.0f m)\n", rr.p05, rr.p50, rr.p95, limbRangeM);
  std::printf("  GROUND HEIGHT THERE:     p05 %8.1f  p50 %8.1f  p95 %8.1f m"
              "   (eye ground %.1f m)\n", hh.p05, hh.p50, hh.p95, groundM);

  std::printf("\nFRAME WINDOW (%.1f deg of azimuth, %d samples: ONE 16:9 frame)\n",
              hfovDeg, win);
  std::printf("  sd  px : best %6.3f  median %6.3f  worst %6.3f\n",
              wsd.mn * kDeg * pxPerRad, wsd.p50 * kDeg * pxPerRad, wsd.mx * kDeg * pxPerRad);
  std::printf("  p2p px : best %6.3f  median %6.3f  worst %6.3f\n",
              wp2p.mn * kDeg * pxPerRad, wp2p.p50 * kDeg * pxPerRad, wp2p.mx * kDeg * pxPerRad);
  {
    // The window centred on the hero bearing.
    const int c = static_cast<int>(std::floor(((heroYawDeg - az0) / azStep))) - win / 2;
    std::vector<double> w(win);
    for (int k = 0; k < win; ++k) w[k] = elevDeg[((c + k) % azn + azn) % azn];
    const Stats s = statsOf(w);
    std::printf("  yaw %6.1f: sd %6.3f px  p2p %6.3f px  (mean %+.4f deg, "
                "%.2f px above the smooth limb)\n",
                heroYawDeg, s.sd * kDeg * pxPerRad, (s.mx - s.mn) * kDeg * pxPerRad,
                s.mean, (s.mean - limbRad / kDeg) * kDeg * pxPerRad);
  }

  // The band decomposition: the skyline restricted to rays no further than X.
  // It says WHERE on the ray the silhouette is won and therefore which
  // wavelength band a fix has to act in.
  if (wantProfile) {
    const double bands[] = {200.0, 500.0, 1000.0, 1400.0, 2000.0, 5000.0,
                            10000.0, 20000.0, 40000.0};
    std::printf("\nBAND DECOMPOSITION: skyline if the march stopped at X metres\n");
    std::printf("  %8s  %10s  %10s  %10s\n", "X (m)", "sd (mdeg)", "sd (px)", "mean (deg)");
    for (double X : bands) {
      if (X > rangeM) break;
      std::vector<double> v(azn);
      for (int a = 0; a < azn; ++a) {
        const double azRad = (az0 + (az1 - az0) * static_cast<double>(a) / static_cast<double>(azn)) * kDeg;
        const Vec3 tangent = north * std::cos(azRad) + east * std::sin(azRad);
        double best = -1e9;
        double r = 2.0;
        while (r <= X) {
          const double ang = r / R;
          const Vec3 d = unit(up * std::cos(ang) + tangent * std::sin(ang));
          const double h = heightAt(body, d, field);
          const Vec3 p = d * (R + h);
          const Vec3 vv = p - eye;
          const double elev = std::asin(vv.dot(up) / vv.length());
          if (elev > best) best = elev;
          r += std::max(2.0, r / 500.0);
        }
        v[a] = best / kDeg;
      }
      const Stats s = statsOf(v);
      std::printf("  %8.0f  %10.2f  %10.3f  %+10.4f\n",
                  X, s.sd * 1000.0, s.sd * kDeg * pxPerRad, s.mean);
    }
  }

  if (csvPath) {
    FILE* f = std::fopen(csvPath, "w");
    if (!f) { std::fprintf(stderr, "skyline_probe: cannot write %s\n", csvPath); return 1; }
    std::fprintf(f, "azimuth_deg,elev_deg,elev_px,range_m,height_m\n");
    for (int a = 0; a < azn; ++a) {
      const double az = az0 + (az1 - az0) * static_cast<double>(a) / static_cast<double>(azn);
      std::fprintf(f, "%.4f,%.6f,%.4f,%.1f,%.3f\n", az, elevDeg[a],
                   elevDeg[a] * kDeg * pxPerRad, atRangeM[a], atHeightM[a]);
    }
    std::fclose(f);
    std::printf("\nwrote %s\n", csvPath);
  }
  return 0;
}
