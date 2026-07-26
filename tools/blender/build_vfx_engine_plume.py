"""
build_vfx_engine_plume.py - Tier 2, the engine plume shell.

    blender --background --python tools/blender/build_vfx_engine_plume.py

Produces assets/models/dist/rocket/vfx_engine_plume.glb.

GEOMETRY ONLY. The shader belongs to the rendering domain, so this file is the
handoff, and the handoff is only useful if the assumptions behind it are
written down. They are, in full:

1. UNIT PLUME, EXACTLY. The mesh fills the unit box: 1.00 m across the MOUTH,
   1.00 m long. Attach and scale, nothing else:

       const plume = gltf.scene.getObjectByName('EnginePlume_LOD0').clone();
       engine.getObjectByName('socket_muzzle').add(plume);
       plume.scale.set(exitDiameter, exitDiameter, plumeLength);

   The mouth is the widest ring, so a plume scaled by the nozzle's exit
   diameter meets the bell lip exactly and never leaves a visible seam.

2. IT POINTS ALONG THE SOCKET. Authored down Blender -Y, which is three.js +Z,
   which is what a socket's facing is (ASSET-SPECS 2.6). socket_muzzle already
   faces down the thrust axis, so socket.add(plume) with an IDENTITY transform
   aims it correctly and no per-engine rotation exists anywhere.

3. ORIGIN AT THE MOUTH, so pivot_mode is "none". The plume grows away from its
   own origin, which means throttle can be a scale on Z alone and the mouth
   stays welded to the bell.

4. UVs: U wraps 0..1 around the plume with the seam on +X; V runs 0 at the
   mouth to 1 at the tip, LINEAR IN LENGTH rather than in radius, so scrolling
   noise in V travels at a constant speed down the plume and a mix(hot, cool,
   v) gradient is physically the right shape. This is the only asset in the
   game with UVs at all (ASSET-SPECS 2.8), and it has them because a plume
   without a length parameter cannot be shaded.

5. ONE MATERIAL SLOT, OF_EmissiveState: near-black base, white emission. That
   is the palette role for genuine fire (section 1 reserves emissive for state
   and for fire, and a rocket exhaust is the second one). The rendering domain
   is expected to REPLACE it with an additive ShaderMaterial (blending
   Additive, depthWrite false, and side DoubleSide if the camera can fly
   through the plume). It is authored BACKFACE-CULLED because
   of_lib.DOUBLE_SIDED is palette-wide, and putting EmissiveState in it would
   quietly double-side the state chip on all thirteen machines.

6. Normals are smooth, so the fallback lit material still reads as a cone
   rather than as a faceted funnel. An additive shader will ignore them.

NOT AUTHORED: the shock diamonds of a sea-level plume and the wide flare of a
vacuum one. Both are a function of ambient pressure, which the shader knows
(atmospheric density at the vessel) and a static mesh does not. A monotone
taper is the shape both cases start from.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

NAME = "EnginePlume"
OUT = of.dist_path("rocket", "vfx_engine_plume.glb")

SEG = 16          # divisible by 4, so the mouth AABB is exactly 1.00 x 1.00
# (v, radius). v is BOTH the UV coordinate and the fraction of the length, so
# the two cannot drift apart.
RINGS = ((0.00, 0.500), (0.25, 0.440), (0.50, 0.340), (0.75, 0.200),
         (1.00, 0.060))


def plume():
    """A tapered tube of SEG+1 columns: the extra column duplicates column 0
    at u = 1.0, which is how a wrapped UV gets a seam without the shader
    having to fract() around it."""
    cols = SEG + 1
    verts, uvs = [], []
    for v, r in RINGS:
        for i in range(cols):
            a = 2.0 * math.pi * (i % SEG) / SEG
            verts.append((r * math.cos(a), -v, r * math.sin(a)))
            # 1 - v, not v: glTF's texture origin is the TOP left and
            # Blender's is the bottom left, so the exporter writes 1 - v for
            # every UV it touches. Authoring the flip here is what makes the
            # SHIPPED file say V = 0 at the mouth, which is what the docstring
            # promises and what a shader author will assume. Verified by
            # reading TEXCOORD_0 back out of the .glb, not by trusting it.
            uvs.append((i / float(SEG), 1.0 - v))
    faces, smooth = [], []
    for b in range(len(RINGS) - 1):
        lo, hi = b * cols, (b + 1) * cols
        for i in range(SEG):
            faces.append((lo + i, hi + i, hi + i + 1, lo + i + 1))
            smooth.append(True)
    last = (len(RINGS) - 1) * cols
    faces.append(tuple(range(last + SEG - 1, last - 1, -1)))   # tip cap
    smooth.append(False)
    return verts, faces, smooth, uvs


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    v, f, sm, uv = plume()
    mb = of.MeshBuilder()
    mb.add_raw(v, f, sm, "EmissiveState", uvs=uv)
    mb.build(NAME + "_LOD0", root)

    of.add_socket("socket_muzzle", (0.0, 0.0, 0.0), of.deg3(x=0.0), root,
                  {"of_role": "plume_root"})

    of.report(NAME, [(NAME + "_LOD0", mb)])
    lo, hi = mb.bounds()
    print("[plume] dims %s  min %s  (mouth diameter %.3f, length %.3f)"
          % ([round(hi[k] - lo[k], 4) for k in range(3)],
             [round(x, 4) for x in lo], 2 * RINGS[0][1], RINGS[-1][0]))
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
