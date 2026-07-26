"""build_crude_pickaxe.py - the crude pickaxe, the player's first tool.

    blender --background --python tools/blender/build_crude_pickaxe.py

Produces assets/models/dist/tools/crude_pickaxe.glb. Geometry, the grip-point
pivot rule and the sockets live in tool_common.py.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tool_common  # noqa: E402

if __name__ == "__main__":
    tool_common.build("pickaxe")
