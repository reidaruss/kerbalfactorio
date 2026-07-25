"""
of_lib.py - Orbital Foundry shared Blender authoring helpers.

Run inside Blender only:
    blender --background --python tools/blender/build_<asset>.py

WHY HEADLESS PYTHON: every asset is a script, so it is deterministic,
diffable, re-runnable and reviewable. A .blend produced by hand in the GUI is
none of those things. Nothing in this module touches the GUI, and nothing
depends on the user's Blender preferences.

CONVENTIONS THIS MODULE ENFORCES (see docs/web/ASSET-SPECS.md for the full
contract; this is the machine-readable half):

  Units      1 Blender unit == 1 metre. Metric, scale_length 1.0.
  Up         Blender +Z. Exported with export_yup=True, so three.js gets +Y up.
  Forward    Blender -Y. After the Y-up conversion that becomes three.js +Z,
             which is what Object3D.lookAt() aims for a non-camera object.
  Right      Blender +X -> three.js +X.
  Pivot      Footprint centre in X/Y, base at Z = 0. A machine therefore sits
             on terrain with zero offset and snaps to the 1 m build grid at
             floor(p) + 0.5.

  Axis map   Blender (x, y, z)  ->  glTF / three.js (x, z, -y)

Naming inside a file:
  <Name>_LOD0 / _LOD1 / _LOD2   render meshes (LOD0 required)
  col_<Name>                    collision proxy, never rendered
  socket_<role>                 an Empty the game code attaches things to
  OF_<Role>                     every material name
"""

import json
import math
import os
import sys

import bpy


# ---------------------------------------------------------------------------
# Palette. sRGB hex + PBR constants. Roles, not object names: an asset picks
# roles so the whole game stays inside one coherent set of surfaces.
# ---------------------------------------------------------------------------
# role -> (hex sRGB, metallic, roughness, alpha, emission hex or None)
PALETTE = {
    # --- industrial ---
    "Steel":        ("8A9199", 0.85, 0.45, 1.0, None),
    "SteelDark":    ("4A5057", 0.85, 0.55, 1.0, None),
    "SteelLight":   ("B9C0C7", 0.80, 0.35, 1.0, None),
    "Accent":       ("FF8A1E", 0.00, 0.50, 1.0, None),
    "Hazard":       ("F2C531", 0.00, 0.60, 1.0, None),
    "Rubber":       ("23262B", 0.00, 0.85, 1.0, None),
    "Glass":        ("9FD8E8", 0.00, 0.05, 0.35, None),
    # --- materials / ores ---
    "Iron":         ("B4BAC0", 1.00, 0.40, 1.0, None),
    "Copper":       ("C06B3E", 1.00, 0.35, 1.0, None),
    "Coal":         ("1C1C1F", 0.00, 0.90, 1.0, None),
    "Rock":         ("7A756C", 0.00, 0.90, 1.0, None),
    "RockDark":     ("57534C", 0.00, 0.92, 1.0, None),
    "Sand":         ("C9B283", 0.00, 0.95, 1.0, None),
    "Soil":         ("5B4A38", 0.00, 1.00, 1.0, None),
    "Regolith":     ("6E6A66", 0.00, 0.95, 1.0, None),
    "Oil":          ("14100D", 0.00, 0.25, 1.0, None),
    "Water":        ("2F6E8C", 0.00, 0.10, 0.65, None),
    # --- nature ---
    "Bark":         ("4E3B2A", 0.00, 0.95, 1.0, None),
    "Leaf":         ("4C7A38", 0.00, 0.80, 1.0, None),
    "LeafDry":      ("8A7A3E", 0.00, 0.85, 1.0, None),
    "Ice":          ("CFE6F0", 0.00, 0.25, 1.0, None),
    # --- character ---
    "Suit":         ("D8D3C6", 0.00, 0.65, 1.0, None),
    "SuitAccent":   ("2E7DBE", 0.00, 0.55, 1.0, None),
    "Skin":         ("C08A63", 0.00, 0.70, 1.0, None),
    # --- state light: ONE material per machine, driven at runtime ---
    # base is near-black so an unlit chip reads as "off"; emission is white and
    # three.js recolours material.emissive per FFactoryEntityState.VisualState.
    "EmissiveState": ("101216", 0.00, 0.30, 1.0, "FFFFFF"),
}

# Roles that must render double-sided. Everything else is backface-culled,
# which is roughly half the fragment work on a scene made of boxes.
DOUBLE_SIDED = {"Glass", "Leaf", "LeafDry", "Water"}

# FFactoryEntityState.VisualState -> emissive colour, straight off
# FactorySim::entityVisualState() in core/include/of/factory_sim.h.
STATE_EMISSIVE = {
    0: "1E5A66",   # idle      dim cyan
    1: "3BE07A",   # working   green
    2: "FFB020",   # blocked   amber
    3: "FF3B30",   # no-power  red
}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear_rgba(hexstr, alpha=1.0):
    h = hexstr.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), alpha)


# ---------------------------------------------------------------------------
# Scene setup / teardown
# ---------------------------------------------------------------------------

def reset_scene():
    """Empty the file and force metre units. Call first in every build script."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    scn.unit_settings.system = "METRIC"
    scn.unit_settings.scale_length = 1.0
    scn.unit_settings.length_unit = "METERS"
    # 60 fps so ONE animation frame == ONE sim tick (of::SimClock runs at
    # 1/60 s). A machine's work clip is then authored with exactly as many
    # frames as its reference recipe has craftTimeTicks, and the renderer
    # retimes to any other recipe with
    #     action.timeScale = referenceTicks / recipe.craftTimeTicks
    scn.render.fps = 60
    scn.render.fps_base = 1.0
    scn.frame_start = 1
    scn.frame_end = 1
    return scn


def get_material(role):
    """Fetch or create the OF_<role> material. Roles come from PALETTE."""
    if role not in PALETTE:
        raise KeyError("unknown palette role %r (see of_lib.PALETTE)" % role)
    name = "OF_" + role
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    hexstr, metallic, rough, alpha, emit = PALETTE[role]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = role not in DOUBLE_SIDED
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = hex_to_linear_rgba(hexstr, alpha)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = rough
    if "Alpha" in bsdf.inputs:
        bsdf.inputs["Alpha"].default_value = alpha
    if alpha < 1.0:
        mat.blend_method = "BLEND" if hasattr(mat, "blend_method") else mat.blend_method
    if emit is not None:
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = hex_to_linear_rgba(emit)
        elif "Emission" in bsdf.inputs:
            bsdf.inputs["Emission"].default_value = hex_to_linear_rgba(emit)
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = 1.0
    return mat


# ---------------------------------------------------------------------------
# Primitive geometry. Built as plain vertex/face lists rather than through
# bpy.ops so the result is bit-identical on any machine and never depends on
# operator context, selection state, or the 3D cursor.
# ---------------------------------------------------------------------------

def _box_data(size, loc):
    sx, sy, sz = (s * 0.5 for s in size)
    cx, cy, cz = loc
    x0, x1 = cx - sx, cx + sx
    y0, y1 = cy - sy, cy + sy
    z0, z1 = cz - sz, cz + sz
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
         (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return v, f, [False] * len(f)


def _rot_axis(p, axis):
    x, y, z = p
    if axis == "Z":
        return (x, y, z)
    if axis == "X":                 # +Z -> +X
        return (z, y, -x)
    if axis == "Y":                 # +Z -> +Y
        return (x, z, -y)
    raise ValueError("axis must be X, Y or Z")


def _cyl_data(radius, depth, loc, axis="Z", segments=12, smooth_sides=True,
              radius_top=None):
    n = segments
    h = depth * 0.5
    r_b = radius
    r_t = radius if radius_top is None else radius_top
    ring_b, ring_t = [], []
    for i in range(n):
        a = 2.0 * math.pi * i / n
        ca, sa = math.cos(a), math.sin(a)
        ring_b.append(_rot_axis((r_b * ca, r_b * sa, -h), axis))
        ring_t.append(_rot_axis((r_t * ca, r_t * sa, h), axis))
    cx, cy, cz = loc
    verts = [(p[0] + cx, p[1] + cy, p[2] + cz) for p in ring_b + ring_t]
    faces, smooth = [], []
    faces.append(tuple(range(n - 1, -1, -1)))          # bottom cap
    smooth.append(False)
    faces.append(tuple(range(n, 2 * n)))               # top cap
    smooth.append(False)
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
        smooth.append(smooth_sides)
    return verts, faces, smooth


class MeshBuilder:
    """Accumulate primitives into ONE mesh with one material slot per role.

    glTF splits a mesh into a primitive per material anyway, so one object with
    N material slots is exactly the right shape for three.js: one draw-call
    bucket per palette role, one node per LOD.
    """

    def __init__(self):
        self.verts = []
        self.faces = []
        self.smooth = []
        self.face_role = []
        self.roles = []

    def _role_index(self, role):
        if role not in self.roles:
            self.roles.append(role)
        return self.roles.index(role)

    def _add(self, v, f, sm, role):
        base = len(self.verts)
        ri = self._role_index(role)
        self.verts.extend(v)
        for face, s in zip(f, sm):
            self.faces.append(tuple(i + base for i in face))
            self.smooth.append(s)
            self.face_role.append(ri)
        return self

    def box(self, size, loc=(0, 0, 0), role="Steel"):
        return self._add(*_box_data(size, loc), role)

    def cylinder(self, radius, depth, loc=(0, 0, 0), axis="Z", segments=12,
                 role="Steel", smooth_sides=True):
        v, f, sm = _cyl_data(radius, depth, loc, axis, segments, smooth_sides)
        return self._add(v, f, sm, role)

    def frustum(self, radius, radius_top, depth, loc=(0, 0, 0), axis="Z",
                segments=8, role="Steel", smooth_sides=True):
        """Tapered cylinder. radius_top 0 gives a cone (the drill bit, the
        insulator caps); a non-zero top gives a taper (chimney collars, hoppers)."""
        v, f, sm = _cyl_data(radius, depth, loc, axis, segments, smooth_sides,
                             radius_top=radius_top)
        return self._add(v, f, sm, role)

    def ring_boxes(self, size, radius, count, loc=(0, 0, 0), role="Steel",
                   phase=0.0):
        """`count` axis-aligned boxes spaced evenly around a Z circle. Used for
        drill flutes, flywheel spokes and rivet rows: a small axis-aligned box
        reads correctly at any angle and costs no rotation machinery."""
        for i in range(count):
            a = 2.0 * math.pi * i / count + phase
            self.box(size, (loc[0] + radius * math.cos(a),
                            loc[1] + radius * math.sin(a),
                            loc[2]), role)
        return self

    def repeat_box(self, size, start, step, count, role="Steel"):
        """count boxes marching from `start` by `step`. Belt slats, ribs, teeth."""
        for i in range(count):
            loc = tuple(start[k] + step[k] * i for k in range(3))
            self.box(size, loc, role)
        return self

    def tri_count(self):
        """Triangles after export triangulation (quad -> 2, n-gon -> n-2)."""
        return sum(max(0, len(f) - 2) for f in self.faces)

    def build(self, name, parent=None):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.verts, [], self.faces)
        mesh.validate(verbose=False)
        for role in self.roles:
            mesh.materials.append(get_material(role))
        for poly, ri, sm in zip(mesh.polygons, self.face_role, self.smooth):
            poly.material_index = ri
            poly.use_smooth = sm
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        if parent is not None:
            obj.parent = parent
        return obj


# ---------------------------------------------------------------------------
# Roots, sockets, collision, LODs
# ---------------------------------------------------------------------------

def add_root(name):
    """The asset's root Empty. Everything else parents to it."""
    root = bpy.data.objects.new(name, None)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.25
    bpy.context.scene.collection.objects.link(root)
    return root


def add_pivot(name, loc=(0, 0, 0), parent=None):
    """A bare Empty used as an animation pivot. A part that needs two motions
    (the miner drill spins AND bobs) hangs its spin mesh under a bob pivot, so
    each clip still drives exactly one object - see add_clip_multi."""
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = "PLAIN_AXES"
    e.empty_display_size = 0.15
    e.location = loc
    bpy.context.scene.collection.objects.link(e)
    if parent is not None:
        e.parent = parent
    return e


def add_socket(name, loc, rot=(0.0, 0.0, 0.0), parent=None, extras=None):
    """An attachment point. Exports as a childless glTF node; three.js finds it
    with root.getObjectByName('socket_...'). `name` must start with 'socket_'."""
    if not name.startswith("socket_"):
        raise ValueError("socket names must start with 'socket_': %r" % name)
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = "ARROWS"
    e.empty_display_size = 0.15
    e.location = loc
    e.rotation_euler = rot
    bpy.context.scene.collection.objects.link(e)
    if parent is not None:
        e.parent = parent
    for k, v in (extras or {}).items():
        e[k] = v
    return e


def add_collision_box(name, size, loc=(0, 0, 0), parent=None, role="SteelDark"):
    """Convex proxy. Name must start with 'col_'; the renderer hides these.

    `role` never reaches a pixel, but it DOES count against the asset's
    material budget in contracts.json, so a stone asset passes a stone role
    rather than dragging OF_SteelDark into a file that has no steel in it."""
    if not name.startswith("col_"):
        raise ValueError("collision proxies must start with 'col_': %r" % name)
    mb = MeshBuilder().box(size, loc, role=role)
    return mb.build(name, parent)


def add_lod_decimate(src, level, ratio, parent=None):
    """Generic LOD from a COLLAPSE decimate. Good for organic assets (rock,
    tree, character). For hard-surface machines prefer a hand-built LOD: a
    decimator wrecks a box silhouette long before it saves anything."""
    obj = src.copy()
    obj.data = src.data.copy()
    obj.name = "%s_LOD%d" % (src.name.rsplit("_LOD", 1)[0], level)
    obj.data.name = obj.name
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent if parent is not None else src.parent
    m = obj.modifiers.new("LOD%d" % level, "DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.ratio = ratio
    return obj


# ---------------------------------------------------------------------------
# Animation. One Action per clip; the exporter turns each Action into a named
# three.js AnimationClip. Clip names are part of the asset contract.
# ---------------------------------------------------------------------------

def _fcurves_for(act, obj):
    """Blender 4.4+ moved fcurves into slot/layer channelbags. Handle both."""
    if hasattr(act, "slots"):
        slot = act.slots[0] if len(act.slots) else act.slots.new(
            id_type="OBJECT", name=obj.name)
        if obj.animation_data is None:
            obj.animation_data_create()
        obj.animation_data.action = act
        try:
            obj.animation_data.action_slot = slot
        except Exception:
            pass
        layer = act.layers[0] if len(act.layers) else act.layers.new("Layer")
        strip = layer.strips[0] if len(layer.strips) else layer.strips.new(
            type="KEYFRAME")
        return strip.channelbag(slot, ensure=True).fcurves
    if obj.animation_data is None:
        obj.animation_data_create()
    obj.animation_data.action = act
    return act.fcurves


def add_clip(obj, clip_name, channel, keys, interpolation="LINEAR"):
    """Author one animation clip on ONE channel of ONE object.

    obj            the object to animate
    clip_name      the three.js AnimationClip name, e.g. 'Belt_Scroll'
    channel        'location' | 'rotation_euler' | 'scale'
    keys           [(frame, (x, y, z)), ...]

    ROTATION WARNING: glTF stores rotation as a quaternion, so a two-key
    0 -> 360 degree euler curve exports as "no rotation at all" (both keys are
    the same quaternion) and a 0 -> 180 curve has an ambiguous direction. Any
    turn of half a revolution or more must be keyed in steps below 180 degrees;
    the spin clips in this repo use 120 degree steps.
    """
    return add_clip_multi(obj, clip_name, {channel: keys}, interpolation)


def add_clip_multi(obj, clip_name, channels, interpolation="LINEAR"):
    """Author one clip that drives SEVERAL channels of ONE object.

    channels       {'rotation_euler': [(frame, vec), ...], 'location': [...]}

    One object per clip is deliberate. In ACTIONS export mode one Blender
    Action becomes one named AnimationClip, and two same-named Actions on two
    different objects are not guaranteed to merge into a single clip - the
    validator checks the clip name set EXACTLY, so a silent '.001' suffix is a
    build failure. A machine whose motion needs two moving parts therefore
    either builds them as one object or uses one clip each.
    """
    act = bpy.data.actions.new(clip_name)
    act.use_fake_user = True                      # survives to ACTIONS export
    fcurves = _fcurves_for(act, obj)
    last = 1
    for channel, keys in channels.items():
        for axis in range(3):
            fc = fcurves.new(data_path=channel, index=axis)
            for frame, vec in keys:
                kp = fc.keyframe_points.insert(float(frame), float(vec[axis]))
                kp.interpolation = interpolation
        last = max(last, max(int(f) for f, _ in keys))
    scn = bpy.context.scene
    scn.frame_end = max(scn.frame_end, last)
    return act


def deg3(x=0.0, y=0.0, z=0.0):
    """Degrees to the radians tuple rotation_euler keys want."""
    return (math.radians(x), math.radians(y), math.radians(z))


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

# The three.js-facing export contract. Anything the running Blender does not
# recognise is dropped with a printed warning rather than crashing the build,
# so one script survives a Blender point release.
GLTF_SETTINGS = dict(
    export_format="GLB",
    export_yup=True,                # Blender +Z up -> glTF/three.js +Y up
    export_apply=True,              # bake modifiers (decimate, mirror, ...)
    export_materials="EXPORT",
    export_cameras=False,
    export_lights=False,
    export_extras=True,             # custom props ride along on nodes
    export_animations=True,
    export_animation_mode="ACTIONS",    # one Action -> one named AnimationClip
    export_bake_animation=False,
    export_optimize_animation_size=True,
    # Sampling is correct for skinned rigs (IK, constraints, drivers). Assets
    # whose clips are plain object transforms should override this to False in
    # their build script: a 2-key LINEAR curve then stays 2 keys instead of
    # being baked out to one key per frame.
    export_force_sampling=True,
    export_skins=True,
    export_morph=True,
    export_texcoords=True,
    export_normals=True,
    export_tangents=False,
    export_draco_mesh_compression_enable=False,
    export_image_format="AUTO",
    use_selection=False,
    use_visible=False,
    use_renderable=False,
    export_hierarchy_full_collections=False,
)


def _supported(kwargs):
    try:
        props = bpy.ops.export_scene.gltf.get_rna_type().properties
        names = {p.identifier for p in props}
    except Exception:
        return dict(kwargs), []
    ok = {k: v for k, v in kwargs.items() if k in names}
    dropped = sorted(set(kwargs) - set(ok))
    return ok, dropped


def export_glb(filepath, **overrides):
    """Write the whole scene to a .glb under the pinned export contract."""
    filepath = os.path.abspath(filepath)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    settings = dict(GLTF_SETTINGS)
    settings.update(overrides)
    settings, dropped = _supported(settings)
    if dropped:
        print("[of_lib] note: this Blender ignores %s" % ", ".join(dropped))
    bpy.ops.export_scene.gltf(filepath=filepath, **settings)
    size = os.path.getsize(filepath)
    print("[of_lib] wrote %s (%d bytes)" % (filepath, size))
    return filepath


def repo_root():
    """Repo root, derived from this file's location (tools/blender/of_lib.py)."""
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def dist_path(*parts):
    return os.path.join(repo_root(), "assets", "models", "dist", *parts)


def report(name, meshes):
    """Print the tri budget the build actually produced, so a script's own
    numbers can be pasted straight into contracts.json."""
    print("[of_lib] %s:" % name)
    total = 0
    for obj_name, mb in meshes:
        t = mb.tri_count()
        total += t
        print("[of_lib]   %-28s %5d tris  roles=%s"
              % (obj_name, t, ",".join(mb.roles)))
    print("[of_lib]   %-28s %5d tris" % ("TOTAL", total))
    return total
