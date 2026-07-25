"""
build_belt_curve_r.py - Belt curve right, TypeId 0x11.

    blender --background --python tools/blender/build_belt_curve_r.py

Produces assets/models/dist/machines/belt_curve_r.glb.

The mirror of build_belt_curve_l.py: flow enters the +Y edge and leaves the +X
edge, turning about the (+0.5, +0.5) cell corner.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import belt_curve_common as bc  # noqa: E402
import of_lib as of  # noqa: E402


def main():
    bc.build(name="BeltCurveR",
             out=of.dist_path("machines", "belt_curve_r.glb"),
             cx=0.5, a_entry=180.0, a_exit=270.0, exit_x=0.5)


if __name__ == "__main__":
    main()
