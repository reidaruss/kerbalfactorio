"""
build_belt_curve_l.py - Belt curve left, TypeId 0x11.

    blender --background --python tools/blender/build_belt_curve_l.py

Produces assets/models/dist/machines/belt_curve_l.glb.

1 x 1 m cell, 0.30 m tall. Flow enters the +Y edge and leaves the -X edge, so
the tile turns about the (-0.5, +0.5) cell corner. Shape, rails, deck height
and sockets all come from belt_curve_common.py.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import belt_curve_common as bc  # noqa: E402
import of_lib as of  # noqa: E402


def main():
    bc.build(name="BeltCurveL",
             out=of.dist_path("machines", "belt_curve_l.glb"),
             cx=-0.5, a_entry=0.0, a_exit=-90.0, exit_x=-0.5)


if __name__ == "__main__":
    main()
