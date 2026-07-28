// =============================================================================
// of_map_api.inc: §19, THE MAP SAMPLES THE WORLD (surface_field.h + biome.h
// + discovery.h). ABI 14.
//
// #included into of_core_api.cpp AFTER of_discovery_api.inc, because it reads
// that file's `g_disc` for the survey layer. One translation unit is the
// contract, so `g_bodies`, `resetF64` and the `wg` alias above are in scope.
//
// WHY THIS EXISTS. DW-37: "cant see the terrain from the map, even in sandbox."
// The map drew every instrument correctly over an empty grey plane, and since
// DISCOVERY REVEALS TERRAIN, a map with no terrain has nothing to reveal and the
// whole feature could not be evaluated. So the map needs the WORLD, not just the
// set of cells the player has seen.
//
// WHAT IT IS NOT: a second terrain. Standing rule 1 — every height here is
// `surfaceHeight`, the surface oracle itself, the same function the mesh, the
// collision and the walker all read. Every biome is `biomeAt`. Nothing is
// re-derived, approximated or cached against a second definition; if this file
// disagreed with the ground the player walks on, that disagreement would be the
// sixth surface definition this project has spent a year deleting.
//
// IT WAS THE DESIGNED BASE AND THAT WAS A DEFECT (WG-33, ABI 14). ABI 13 read
// `sampleDesignedHeight`, which is the base BEFORE the player's own voxel edits.
// The consequence is not cosmetic and it is not subtle: a dug hole, a levelled
// pad and a tunnel mouth could not appear on the map AT ALL, by construction,
// however the painter shaded them. A close-in map whose whole job is to show you
// your own work was reading the one field guaranteed not to contain any of it.
// The oracle already publishes the right answer (`surfaceHeight(body, dir,
// edits)`, WG-21's clamp included) and §3 already exports it per-direction; this
// export simply stopped taking the shortcut. With `edits <= 0` the two are
// EXACTLY equal by surface_field.h's own undug overload, so a world with no
// digs in it is bit-identical to ABI 13's output.
//
// IT IS SPECIFIED IN VIEW-REGION TERMS, NOT IN PIXELS, and deliberately. DW-37
// also says the map will become a rotatable 3D camera, and when it does the
// PAINTER on the other side of this bridge is replaced while THIS is not: a
// centre, two in-plane axes, a span and a grid density describe a region of a
// sphere, which is a question a camera asks too.
//
// THE RAY SOLVE IS EXACT AND HAS NO TRANSCENDENTALS. The projection is
// orthographic, so "what ground is under this sample" is a line parallel to the
// view axis meeting a sphere: drop the component along the axis, and what is
// left is a right triangle. Dot products and one sqrt (CE-11 / DW-15 — the same
// reason discovery.h's own horizon test is algebraic). No trig, no iteration,
// no marching.
// =============================================================================

namespace {
// A ceiling on ONE call, in the spirit of §17's kMnMaxSamples and §18's window
// cap: it bounds a mistyped argument from asking for gigabytes of scratch. The
// caller picks its own grid by MEASUREMENT far below this; this is the guard
// rail, not the budget.
const int kMapMaxSamples = 1 << 20;

// Unit, or a null vector if the input is degenerate. Local rather than borrowed
// from disc:: because this file must not depend on the discovery header's
// internals for arithmetic it does itself.
Vec3 mapUnit(const Vec3& v) {
  const double l2 = v.dot(v);
  if (!(l2 > 0.0)) return Vec3(0.0, 0.0, 0.0);
  const double inv = 1.0 / std::sqrt(l2);
  return Vec3(v.x * inv, v.y * inv, v.z * inv);
}
}  // namespace

// THE MAP'S ONE DRAW CALL FOR THE GROUND.
//
// Samples the world over the VIEW REGION, at the resolution the view needs:
//
//   body                a §1 body handle (the height and the biome are the
//                       body's, so this is not a bodyId 0/1 constant)
//   edits               a §2 DensityField handle, or <= 0 for the pristine
//                       procedural world. THE PLAYER'S OWN TERRAIN, without
//                       which the map cannot show a hole they dug (WG-33)
//   cx,cy,cz            the view CENTRE, body-frame metres (MapScene.centreM)
//   ux,uy,uz            planeU — right on screen; need not be unit
//   vx,vy,vz            planeV — up on screen; need not be unit
//   spanM               metres across the SHORT screen axis
//   aspect              width / height
//   n                   samples across the SHORT axis
//
// Writes an `n` row by `round(n*aspect)` column grid into the f64 arena, THREE
// doubles per sample — [biomeId, heightM, surveyed] — row-major, TOP ROW FIRST,
// which is the order an ImageData wants. Returns the SAMPLE count written (rows
// times columns), or 0 if anything was refused.
//
// For each sample, its offset from the centre in metres (sx, sy) gives
// p = centre + planeU*sx + planeV*sy, and the ground under it is found EXACTLY:
//
//   a     = normalize(planeU x planeV)      the view axis, toward the viewer
//   pPerp = p - a*(p . a)                   p flattened onto the view plane
//   if |pPerp| > R there is no ground under that sample at all — it is off the
//         limb, and it writes biomeId = -1 and is skipped entirely
//   t     = sqrt(R^2 - |pPerp|^2)
//   dir   = normalize(pPerp + a*t)          the NEAR hit, toward the viewer
//
// The near hit and not the far one, for the reason MapLayers' back-face cull
// existed: under an orthographic projection the antipode lands on exactly the
// same pixel, so taking the wrong root paints the ground under your feet with
// the ground on the other side of the planet.
//
// `surveyed` is `of_disc_has(SURVEY, dir)` — 1 or 0 — read from the SAME field
// the map already gates ore with. It is a FINER mask than a 9,375 m discovery
// quad because it is asked per sample, and it is the whole negative control:
// the painter draws a sample only when this is 1, unless the MODE reveals all.
// With no discovery field at all every sample reads 0, which is the honest
// answer ("nothing has been seen") and not a refusal dressed as one.
OF_API int of_map_sample(int body, int edits, double cx, double cy, double cz,
                         double ux, double uy, double uz,
                         double vx, double vy, double vz,
                         double spanM, double aspect, int n) {
  resetF64(0);
  const wg::BodyParams* b = g_bodies.get(body);
  if (!b) return 0;
  // Borrowed once, exactly as the survey grid below is: the oracle's own undug
  // overload is taken when there is no field, so "no edits" is a call into the
  // same authority and not a branch that skips it.
  const wg::DensityField* ed = g_edits.get(edits);
  if (!(spanM > 0.0) || !(aspect > 0.0) || n <= 0) return 0;
  const Vec3 u = mapUnit(vec(ux, uy, uz));
  const Vec3 v = mapUnit(vec(vx, vy, vz));
  if (!(u.dot(u) > 0.0) || !(v.dot(v) > 0.0)) return 0;
  const Vec3 a = mapUnit(Vec3(u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z,
                              u.x * v.y - u.y * v.x));
  if (!(a.dot(a) > 0.0)) return 0;  // u parallel to v: there is no plane

  const double R = b->radiusM;
  if (!(R > 0.0)) return 0;
  int cols = static_cast<int>(aspect * static_cast<double>(n) + 0.5);
  if (cols < 1) cols = 1;
  // The ceiling binds the COLUMNS against the row count already asked for, so a
  // wild aspect cannot multiply its way past the guard.
  if (static_cast<long long>(cols) * n > kMapMaxSamples) return 0;
  const int total = cols * n;
  resetF64(static_cast<size_t>(total) * 3);

  // The SURVEY grid, borrowed once. Null when no field has been built, in which
  // case nothing is surveyed — see the header.
  const disc::DiscoveryGrid* survey = g_disc ? &g_disc->survey() : nullptr;

  const double halfH = 0.5 * spanM;
  const double halfW = 0.5 * spanM * aspect;
  const Vec3 c = vec(cx, cy, cz);
  for (int j = 0; j < n; ++j) {
    // TOP ROW FIRST: v is UP in world metres and row 0 is the top of the image,
    // so sy runs from +halfH down. Sampled at cell CENTRES (the +0.5), so the
    // grid is symmetric about the centre and a 1x1 grid samples the centre.
    const double sy = halfH
        - spanM * ((static_cast<double>(j) + 0.5) / static_cast<double>(n));
    for (int i = 0; i < cols; ++i) {
      const double sx = -halfW
          + (spanM * aspect) * ((static_cast<double>(i) + 0.5)
                                / static_cast<double>(cols));
      const Vec3 p(c.x + u.x * sx + v.x * sy, c.y + u.y * sx + v.y * sy,
                   c.z + u.z * sx + v.z * sy);
      const double pa = p.dot(a);
      const Vec3 perp(p.x - a.x * pa, p.y - a.y * pa, p.z - a.z * pa);
      const double d2 = perp.dot(perp);
      if (d2 > R * R) {  // off the limb: there is no ground under this sample
        g_f64.push_back(-1.0); g_f64.push_back(0.0); g_f64.push_back(0.0);
        continue;
      }
      const double t = std::sqrt(R * R - d2);
      const Vec3 dir = mapUnit(Vec3(perp.x + a.x * t, perp.y + a.y * t,
                                    perp.z + a.z * t));
      if (!(dir.dot(dir) > 0.0)) {  // p exactly at the centre of the body
        g_f64.push_back(-1.0); g_f64.push_back(0.0); g_f64.push_back(0.0);
        continue;
      }
      g_f64.push_back(static_cast<double>(wg::biomeAt(*b, dir)));
      g_f64.push_back(ed ? wg::surfaceHeight(*b, dir, *ed)
                         : wg::surfaceHeight(*b, dir));
      g_f64.push_back(survey && survey->hasDir(dir) ? 1.0 : 0.0);
    }
  }
  return total;
}
