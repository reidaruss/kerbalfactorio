"""
surface_preview.py - wire the shipped surface maps onto the OF_* materials,
for PREVIEW RENDERS ONLY. Runs inside Blender.

    import surface_preview
    surface_preview.apply_all()          # after the asset is built or imported
    surface_preview.apply_all(off=True)  # the "before" half of a comparison

WHY THIS IS NOT PART OF ANY BUILD SCRIPT. The maps are NOT embedded in the
.glb files and must never be. Two reasons, and the second is the load-bearing
one:

  1. 48 assets sharing two textures means 48 copies of those textures if each
     file carries its own, and 48 separate GPU uploads of identical pixels.

  2. `MachineBatch` merges every machine, belt and structure into ONE
     BatchedMesh with ONE material, so per-file materials are DISCARDED at load
     time (their colour is baked to a vertex attribute and their name to an
     integer role). A texture embedded in a .glb would be thrown away by the
     client before it ever reached a pixel. The maps have to be attached to the
     batch material, which is client-side by construction.

So the .glb ships geometry and UVs, `assets/textures/dist/` ships the pixels
and the manifest, and the consumer joins them. This module is that consumer,
written against the published manifest exactly as the client will be, which is
the point: if the preview needs something the manifest does not carry, the
manifest is wrong and it is cheaper to find that out here.

WHAT THIS REPRODUCES, and it is three.js's arithmetic, not Blender's taste:

    roughness  = material.roughness * ormMap.g      (MeshStandardMaterial)
    metalness  = material.metalness * ormMap.b
    baseColour = material.color * ormMap.r          (aoMapIntensity = 1)
    normal     = tangent-space from normalMap, +Y up

ONE KNOWN AND DELIBERATE DIFFERENCE FROM THE SHIPPED RESULT. glTF's texture
origin is top-left and Blender's is bottom-left, so the exporter writes `1 - v`
into TEXCOORD_0. This preview samples the UNFLIPPED v, so the pattern is
mirrored in V relative to what the browser will show. Both families tile and
neither is directional, so no feature moves; a rivet is a rivet either way.
Stated here rather than discovered later, because a preview that differs from
the shipped result in a way nobody wrote down is worse than no preview.
"""

import json
import os

import bpy

import texgen

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

# `OF_TEX_DIR` PREVIEWS A TEXTURE SET THAT HAS NOT SHIPPED, and it exists
# because `texgen.generate()` is ALL-OR-NOTHING (RN-554). It loops every entry
# in `FAMILIES` and rewrites the whole manifest, so a lane that regenerates to
# look at its own family also writes every OTHER lane's in-flight family into
# `assets/textures/dist` and into the manifest. RN-151 is the recorded case of
# exactly that laundering a sibling's work into HEAD, and on 2026-08-01 the
# working tree held two uncommitted families belonging to another lane, which
# made regenerating in place unsafe for anybody.
#
# So a lane generates to a scratch directory with `texgen.py --out DIR` and
# points this at it. Nothing shared is written, the preview is honest about
# which bytes it is showing, and the shipped set is untouched.
TEX_DIR = os.environ.get("OF_TEX_DIR") or os.path.join(
    ROOT, "assets", "textures", "dist")
MANIFEST = os.path.join(TEX_DIR, "surfaces.json")

_MARK = "of_surface_preview"          # node label, so apply is idempotent


def load_manifest():
    if os.environ.get("OF_TEX_DIR"):
        # Said out loud on every run. A preview reading bytes other than the
        # shipped ones and not saying so is the same class of quiet fiction as
        # a render under the wrong view transform.
        print("[surface_preview] OF_TEX_DIR: reading UNSHIPPED textures from %s"
              % TEX_DIR)
    if not os.path.isfile(MANIFEST):
        raise RuntimeError(
            "%s is missing. Run:  python tools/blender/texgen.py" % MANIFEST)
    with open(MANIFEST, "r", encoding="utf-8") as fh:
        m = json.load(fh)
    if m.get("version") != texgen.MANIFEST_VERSION:
        raise RuntimeError(
            "surfaces.json is version %r but this tool speaks %d. Regenerate "
            "it, or update the tool - do not guess."
            % (m.get("version"), texgen.MANIFEST_VERSION))
    return m


def _image(path):
    """Load once and reuse. Non-Color for both maps: a normal map and an ORM
    pack are DATA, and running either through sRGB decode is the single most
    common way to get a normal map that looks almost right and is wrong."""
    name = os.path.basename(path)
    img = bpy.data.images.get(name)
    if img is None:
        img = bpy.data.images.load(path, check_existing=True)
        img.name = name
    img.colorspace_settings.name = "Non-Color"
    return img


def _clear(mat):
    """Remove any nodes a previous apply() added, and restore the constants."""
    nt = mat.node_tree
    doomed = [n for n in nt.nodes if n.label == _MARK]
    for n in doomed:
        nt.nodes.remove(n)
    return nt


def apply_material(mat, manifest, role, merged=False, force=None):
    """Wire the family's maps onto one OF_<role> material. Returns the family
    name, or None if the role is deliberately flat.

    `merged` reproduces what a merge-to-one-material asset can actually draw,
    and it exists for one instrument-honesty reason (RN-456): a studio render
    showing something the game cannot draw flatters in the direction nobody
    double-checks.

    RN-491 CHANGED WHAT THAT MEANS, and the change is almost all deletion.
    The old version forced ONE roughness and ONE metalness onto every role,
    because SpiderFlock's merge threw the per-part values away and only colour
    survived. The merge now carries them (web/src/render/materials/
    PartMaterial.ts), and the client computes `authored role value x family
    ORM channel`, which is exactly what this module already wired with no
    forcing at all. So the two agree by construction and there is nothing left
    to force.

    What remains merged-specific is the BARE set: roles that are not members
    of their asset's dominant family and wear no family maps at all. Those are
    drawn here as flat authored colour, roughness and metalness, which is what
    the client's `vPartMat.z` path produces.

    `force` is (roughness, metalness) and is THE STUDIO'S `?partmat=0`: it
    restores the pre-RN-491 collapse, one roughness and one metalness on every
    role and no bare set, so a before/after pair can be one flag apart on ONE
    build under ONE light instead of being two commits apart. A control that
    only exists in the client cannot photograph the thing it controls."""
    if force is None and merged and role in of_lib_bare_roles():
        return None
    fam_name = texgen.ROLE_FAMILY.get(role)
    nt = _clear(mat)
    bsdf = nt.nodes.get("Principled BSDF")
    if bsdf is None:
        return None
    # Palette constants, re-read every time so a second apply() is not
    # compounding on the first.
    hexstr, metallic, rough, alpha, _ = texgen_palette()[role]
    if force is not None:
        rough, metallic = force
    base = hex_to_linear_rgba(hexstr, alpha)
    bsdf.inputs["Base Color"].default_value = base
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = rough
    if fam_name is None:
        return None

    fam = manifest["families"][fam_name]
    tile = fam["tile_m"]

    def node(kind, x, y):
        n = nt.nodes.new(kind)
        n.label = _MARK
        n.location = (x, y)
        return n

    uvn = node("ShaderNodeTexCoord", -1400, 0)
    mapn = node("ShaderNodeMapping", -1200, 0)
    # UVs are in METRES, so the tile size is applied here and only here. This
    # is texture.repeat = 1 / tile_m on the three.js side.
    mapn.inputs["Scale"].default_value = (1.0 / tile, 1.0 / tile, 1.0)
    nt.links.new(uvn.outputs["UV"], mapn.inputs["Vector"])

    ntex = node("ShaderNodeTexImage", -950, 250)
    ntex.image = _image(os.path.join(TEX_DIR, fam["normal"]["file"]))
    ntex.extension = "REPEAT"
    nt.links.new(mapn.outputs["Vector"], ntex.inputs["Vector"])

    otex = node("ShaderNodeTexImage", -950, -250)
    otex.image = _image(os.path.join(TEX_DIR, fam["orm"]["file"]))
    otex.extension = "REPEAT"
    nt.links.new(mapn.outputs["Vector"], otex.inputs["Vector"])

    nrm = node("ShaderNodeNormalMap", -650, 250)
    nrm.inputs["Strength"].default_value = 1.0
    nt.links.new(ntex.outputs["Color"], nrm.inputs["Color"])
    nt.links.new(nrm.outputs["Normal"], bsdf.inputs["Normal"])

    sep = node("ShaderNodeSeparateColor", -650, -250)
    nt.links.new(otex.outputs["Color"], sep.inputs["Color"])

    # roughness = constant * G, metalness = constant * B. Sockets addressed by
    # INDEX, because ShaderNodeMath's two operands are both named "Value" and
    # a name lookup silently returns the first one.
    rmul = node("ShaderNodeMath", -400, -150)
    rmul.operation = "MULTIPLY"
    rmul.inputs[0].default_value = rough
    nt.links.new(sep.outputs["Green"], rmul.inputs[1])
    nt.links.new(rmul.outputs[0], bsdf.inputs["Roughness"])

    mmul = node("ShaderNodeMath", -400, -350)
    mmul.operation = "MULTIPLY"
    mmul.inputs[0].default_value = metallic
    nt.links.new(sep.outputs["Blue"], mmul.inputs[1])
    nt.links.new(mmul.outputs[0], bsdf.inputs["Metallic"])

    # baseColour * AO. VectorMath rather than Mix: its two operands are at
    # stable indices 0 and 1 in every Blender since 2.8, where ShaderNodeMix's
    # RGBA sockets sit at version-dependent indices behind duplicate names.
    ao = node("ShaderNodeCombineColor", -400, 100)
    for k in ("Red", "Green", "Blue"):
        nt.links.new(sep.outputs["Red"], ao.inputs[k])
    tint = node("ShaderNodeVectorMath", -200, 100)
    tint.operation = "MULTIPLY"
    # A TILING ALBEDO (RN-455), reproducing Surfaces.ts exactly:
    #     material.color = palette / albedo_mean
    #     diffuse        = material.color * albedoMap * aoMap.r
    # The divide is what makes the modulation mean-neutral, so the map decides
    # variance and hue and the palette role decides level. Without it the
    # preview would show the creature darkened by the map's own 0.5954 mean
    # and the render would disagree with the game by a factor nobody wrote
    # down, which is the failure this whole module exists to prevent.
    if "albedo" in fam:
        mean = fam.get("albedo_mean") or 1.0
        atex = node("ShaderNodeTexImage", -950, 550)
        atex.image = _image(os.path.join(TEX_DIR, fam["albedo"]["file"]))
        atex.image.colorspace_settings.name = "sRGB"
        atex.extension = "REPEAT"
        nt.links.new(mapn.outputs["Vector"], atex.inputs["Vector"])
        amul = node("ShaderNodeVectorMath", -400, 400)
        amul.operation = "MULTIPLY"
        amul.inputs[0].default_value = tuple(c / mean for c in base[:3])
        nt.links.new(atex.outputs["Color"], amul.inputs[1])
        nt.links.new(amul.outputs["Vector"], tint.inputs[0])
    else:
        tint.inputs[0].default_value = base[:3]
    nt.links.new(ao.outputs["Color"], tint.inputs[1])
    nt.links.new(tint.outputs["Vector"], bsdf.inputs["Base Color"])
    return fam_name


def texgen_palette():
    """of_lib.PALETTE, imported lazily so this module can be read outside a
    build script."""
    import of_lib
    return of_lib.PALETTE


def of_lib_bare_roles():
    """of_lib.BARE_ROLES: the roles that wear no family maps (RN-491). One
    source of truth, read rather than repeated, because a studio preview that
    keeps its own copy of this set is the exact class of fiction this module
    exists to prevent."""
    import of_lib
    return of_lib.BARE_ROLES


def hex_to_linear_rgba(hexstr, alpha=1.0):
    import of_lib
    return of_lib.hex_to_linear_rgba(hexstr, alpha)


def apply_all(off=False, quiet=False, merged=False, force=None):
    """Wire every OF_<role> material in the file. Returns a report dict.

    `off=True` strips the maps and restores the flat palette constants, which
    is how the BEFORE half of a comparison is produced: same scene, same
    camera, same lighting, same build, one flag.
    """
    manifest = load_manifest()
    mapped, flat, skipped = [], [], []
    for mat in bpy.data.materials:
        if not mat.name.startswith("OF_") or not mat.use_nodes:
            skipped.append(mat.name)
            continue
        role = mat.name[3:]
        if role not in texgen_palette():
            skipped.append(mat.name)
            continue
        if off:
            _clear(mat)
            bsdf = mat.node_tree.nodes.get("Principled BSDF")
            hexstr, metallic, rough, alpha, _ = texgen_palette()[role]
            if bsdf is not None:
                bsdf.inputs["Base Color"].default_value = hex_to_linear_rgba(
                    hexstr, alpha)
                bsdf.inputs["Metallic"].default_value = metallic
                bsdf.inputs["Roughness"].default_value = rough
            flat.append(role)
            continue
        fam = apply_material(mat, manifest, role, merged, force)
        (mapped if fam else flat).append(role)

    if not quiet:
        # Report what was NOT touched, by name and count. A preview that says
        # "12 materials textured" while silently ignoring three is how a render
        # comes to disagree with the game.
        print("[surface_preview] %s: %d mapped %s, %d flat %s%s"
              % ("OFF" if off else "ON", len(mapped), sorted(set(mapped)),
                 len(flat), sorted(set(flat)),
                 ("  [PARTMAT OFF (control): roughness %.2f metalness %.2f "
                  "forced on every role and no bare set, reproducing the "
                  "pre-RN-491 one-material collapse]" % force)
                 if force is not None
                 else "" if not merged
                 else "  [MERGED: bare roles %s wear no family maps, "
                      "reproducing the client's vPartMat.z path; every other "
                      "role's authored roughness and metalness now survive "
                      "the merge and need no forcing]"
                      % sorted(of_lib_bare_roles())))
        if skipped:
            print("[surface_preview] NOT EXAMINED: %d material(s) not in the "
                  "palette: %s" % (len(skipped), sorted(set(skipped))))
    return {"mapped": sorted(set(mapped)), "flat": sorted(set(flat)),
            "skipped": sorted(set(skipped))}
