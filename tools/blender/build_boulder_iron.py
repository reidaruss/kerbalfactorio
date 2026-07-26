"""build_boulder_iron.py - Iron boulder harvest node.

    blender --background --python tools/blender/build_boulder_iron.py

Produces assets/models/dist/nodes/boulder_iron.glb.
Shape, sockets and depletion logic live in boulder_common.py; this file only
picks the dressing.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import boulder_common  # noqa: E402

if __name__ == "__main__":
    boulder_common.build("iron")
