"""build_crude_axe.py - the crude axe, the wood-harvest tool.

    blender --background --python tools/blender/build_crude_axe.py

Produces assets/models/dist/tools/crude_axe.glb. Geometry, the grip-point pivot
rule and the sockets live in tool_common.py.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tool_common  # noqa: E402

if __name__ == "__main__":
    tool_common.build("axe")
