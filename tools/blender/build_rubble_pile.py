"""
build_rubble_pile.py - WHAT IS LEFT WHERE A BUILDING USED TO STAND.

    blender --background --python tools/blender/build_rubble_pile.py

Produces assets/models/dist/props/rubble_pile.glb.

--------------------------------------------------------------------------
THE DEBT THIS PAYS, AND THE PLACEHOLDER IT REPLACES.

D1 (`web/src/game/Wreckage.ts`, docs/scope/SE-MECHANICS-SCOPE-2026-08-13.md)
made a destroyed building VANISH and leave a pile. It had no pile to leave, so
it borrowed `assets/nodes/boulder_stone.glb`, squashed it to 0.45 of its own
height and scaled it to the footprint of whatever fell. That file's header is
blunt about what that is worth:

    "It reads as a low pile of broken material at the right size, which is what
     a rubble prop has to do; it does not read as a broken SMELTER."

and it published `meshIsPlaceholder: true` in `report()` so nobody had to guess
whether the art had landed. GP-745 to GP-753 and ASSET-SPECS owe
`rubble_pile.glb` IN THREE FOOTPRINT SIZES. This is that.

--------------------------------------------------------------------------
WHY THREE AUTHORED SIZES AND NOT ONE MESH SCALED, which is the whole point.

`Wreckage.SPAN_M` runs from 0.70 m (a power pole) to 8.00 m (a launch pad),
and one asset stretched across that range is stretched by a factor of ELEVEN.
Every authored proportion - plate thickness, how big a shard is against the
pile, how far a beam sticks out - is destroyed by that, and the small piles get
boulders with metre-thick plates in them while the big ones get tinfoil.

Three sizes bracket the table instead, so the residual scale a client applies
is small and every pile in the game keeps its authored plate gauge:

    Small   0.90 m   belt tile (0.90), power pole (0.70)
    Med     2.20 m   wall 2.60, door 2.20, miner 2.00, smelter 2.20,
                     generator 2.40, furnace 1.60, and DEFAULT_SPAN_M 1.60
    Large   3.40 m   foundation 3.40, floor 3.40, assembler 3.00

The launch pad at 8.00 m is the one entry still stretched, by 2.35x off Large,
and it is ONE building the player builds ONCE. Every other kind in the table
lands inside 1.45x of an authored size. The three spans are transcribed from
`SPAN_M` and the client picks the nearest, so neither side re-derives the
other's numbers.

THEY ARE NOT ONE ARRANGEMENT AT THREE SCALES. Each size is laid out from its
own seed, and more than that, each is a DIFFERENT KIND OF WRECK, because the
things that leave them are different: a belt tile leaves a bent deck and a
length of frame, a wall leaves plate and studs, a foundation leaves broken
slab with rebar in it. A player who has demolished twenty things should not be
able to see that they were all the same model.

--------------------------------------------------------------------------
WHAT MAKES IT READ AS WRECKAGE AND NOT AS A ROCK, at the SE bar.

D-020 puts the target at Space Engineers: functional industrial realism,
machined surfaces, engineered forms. A rock pile and a wreck differ in four
things, and this file spends its triangles on exactly those:

  1. TWISTED PLATE. The single strongest signal. A plate that was flat and is
     no longer flat says a force did this; a rock has never been flat. Every
     size gets plates whose four corners sit at DIFFERENT heights (`_plate`),
     which is the same trick `machine_form.warped` uses to say a machine has
     been hit, applied to something that has been hit much harder.

  2. BROKEN STRUCTURAL MEMBERS. Box-section stubs lying at angles, crossing
     each other, sticking out of the heap. They are what tells the eye the
     thing had a FRAME. Each one is cut short with a torn end (`_member`'s
     `tear`), because a member that ends in a clean square face reads as a
     part somebody put down rather than one that failed.

  3. THE EXPOSED STEEL IS RUSTED AND THE SKIN IS NOT. `texgen`'s own header
     says `rust` depicts steel that has GONE, not a used machine. Wreckage is
     the one thing in this game where that is the literal truth, so the TORN
     faces and the cut ends take `SteelRust` while intact plate stays
     `SteelDark`. That is the rule the miner's wet-ore pass established
     (RN-1558) read one step further along.

  4. ONE SURVIVING PAINTED FRAGMENT. A single `Hazard` piece per pile: a
     scrap of a keep-out band that outlived the building. It is the cheapest
     part of this asset and it does more than the rest put together, because
     paint is manufactured and nothing in nature is that colour. It is ONE
     fragment and never a stripe - a wreck with tidy paint on it is a kit.

--------------------------------------------------------------------------
NO COLLISION PROXY, AND THAT IS DELIBERATE AND LOAD-BEARING.

`Wreckage.ts` says why, and it is not an omission to be tidied up later:

    "RUBBLE HAS NO `Solid`, DELIBERATELY. A pile of broken wall is ankle
     height and a walker steps over it; more to the point, 'the part is gone'
     is only a real claim if the walker can now cross where it stood, and a
     rubble collider would make that claim untestable and the feature
     indistinguishable from the bug. `probes/destruction.js` inverts the
     CE-50 occupancy technique on exactly this."

So this file exports NO `col_` node of any kind, and `contracts.json` carries
no `collision` key for it, which is the same shape `detail_cards`,
`vfx_engine_plume` and `body_sphere_lod` already have. A proxy added here would
break a shipped probe's assertion, not merely add weight.

--------------------------------------------------------------------------
HEIGHTS. A pile is WIDE AND LOW: 0.28 of its own span, one ratio for all three,
so the family reads as one family. That puts Small at 0.25 m (a step-over),
Med at 0.62 and Large at 0.95. It also replaces `Wreckage.SQUASH`, which was
the boulder-squash factor and existed only because the mesh was a boulder.

LODs. Three tiers per size, hand-built rather than decimated: a collapse
decimator eats a thin plate whole and leaves a shard, which is the same reason
`props_common` gives for rebuilding foliage instead of decimating it. LOD1
drops the debris and keeps the members and the big plates; LOD2 is the heap's
envelope, because at that range a pile is a bump with a colour.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import machine_form as mf  # noqa: E402
import of_lib as of  # noqa: E402

NAME = "RubblePile"
OUT = of.dist_path("props", "rubble_pile.glb")

# --- the three sizes -------------------------------------------------------
# Spans transcribed from Wreckage.SPAN_M; see the docstring for which building
# kinds each one is the nearest authored size for.
SPANS = (("Small", 0.90), ("Med", 2.20), ("Large", 3.40))
HEIGHT_RATIO = 0.28

# Plate gauge as a fraction of span. A wreck's plate is THIN and that is most
# of why it reads as plate: at 0.9 m across this is 14 mm and at 3.4 m it is
# 54 mm, which are both believable sheet and both survive the exporter.
PLATE_T = 0.016


def _rand(seed):
    """A deterministic stream. Wreckage places a pile per destroyed building
    and a probe has to be able to replay it, so nothing here may be random;
    the same rule `Wreckage.pile` follows for its yaw."""
    h = seed & 0xFFFFFFFF

    def nxt(lo=0.0, hi=1.0):
        nonlocal h
        h = (h ^ (h << 13)) & 0xFFFFFFFF
        h ^= h >> 17
        h = (h ^ (h << 5)) & 0xFFFFFFFF
        return lo + (hi - lo) * (h / 4294967296.0)
    return nxt


def _plate(mb, c, w, l, yaw, corner_z, t, role):
    """A four-cornered plate whose corners sit at DIFFERENT heights.

    THE ONE SHAPE THAT SAYS A FORCE DID THIS. A rock is never flat, so it can
    never be bent; a plate that used to be flat and is not any more is the
    whole read. Twelve triangles, the same as the box it replaces, which is
    `machine_form.warped`'s own accounting for the same trick.

    Winding goes through `mf.oriented` rather than being reasoned about: the
    signed volume of the closed solid is one test that cannot be wrong, and a
    face wound backwards on a backface-culled role is an invisible hole."""
    ca, sa = math.cos(yaw), math.sin(yaw)
    top, bot = [], []
    for (du, dv, dz) in ((-w * 0.5, -l * 0.5, corner_z[0]),
                         (w * 0.5, -l * 0.5, corner_z[1]),
                         (w * 0.5, l * 0.5, corner_z[2]),
                         (-w * 0.5, l * 0.5, corner_z[3])):
        x = c[0] + du * ca - dv * sa
        y = c[1] + du * sa + dv * ca
        bot.append((x, y, c[2] + dz))
        top.append((x, y, c[2] + dz + t))
    verts, faces = mf.oriented(
        top + bot, [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1),
                    (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)])
    mb.add_raw(verts, faces, [False] * len(faces), role)


def _member(mb, c, length, sect, yaw, pitch, role, tear=None,
            tear_role="SteelRust"):
    """A broken structural member: a box section lying at a yaw AND a pitch,
    with a torn stub at one end.

    THE PITCH IS WHY THIS IS NOT `mb.box(..., rot_z=)`. Everything else in this
    project is axis-aligned or yawed, because everything else is a machine that
    was BUILT and built things are level. A wreck's members are the one place
    in the game where a solid has no business being level, and a heap of level
    beams reads as a stack in a yard rather than as a collapse.

    `tear` is the length of a smaller, offset stub welded on the far end. A
    member that ends in a clean square face reads as a part somebody cut and
    set down; a member that ends in a smaller ragged section reads as one that
    FAILED, and it takes `SteelRust` because the torn face is the one surface
    on this asset where the steel is genuinely open to the air."""
    cy_, sy_ = math.cos(yaw), math.sin(yaw)
    cp, sp = math.cos(pitch), math.sin(pitch)
    # Local axes: `ax` along the member, `bx` across it, `cx` normal to both.
    ax = (cy_ * cp, sy_ * cp, sp)
    bx = (-sy_, cy_, 0.0)
    nx = (-cy_ * sp, -sy_ * sp, cp)

    def prism(centre, ln, s0, s1, role_):
        verts = []
        for sa in (-0.5, 0.5):
            for sb in (-0.5, 0.5):
                for sc in (-0.5, 0.5):
                    verts.append(tuple(
                        centre[k] + ax[k] * sa * ln + bx[k] * sb * s0
                        + nx[k] * sc * s1 for k in range(3)))
        v, f = mf.oriented(verts, [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1),
                                   (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)])
        mb.add_raw(v, f, [False] * len(f), role_)

    prism(c, length, sect, sect, role)
    if tear is None:
        return
    off = (length + tear) * 0.5
    stub = tuple(c[k] + ax[k] * off + nx[k] * sect * 0.18 for k in range(3))
    prism(stub, tear, sect * 0.62, sect * 0.55, tear_role)


def _shard(mb, nxt, x, y, base, r, h, role):
    """A chunk of broken material: a low, yawed, unequal box RESTING ON `base`.

    Deliberately the CHEAPEST thing in the file at twelve triangles. Debris is
    what fills the gaps between the parts that carry the read, and a heap needs
    a lot of it; spending anything on an individual shard buys nothing, because
    no one of them is ever looked at.

    IT TAKES ITS BOTTOM AND NOT ITS CENTRE, which is not a stylistic choice.
    Given a centre and a random height a shard can end up below z = 0, and the
    two things that go wrong there are both silent: `mf.assert_inside` refuses
    the build if it happens to draw a tall one, and if it draws a short one the
    shard's underside lands on the ground plane the apron already owns, which
    is a coplanar pair `check_coplanar` finds in the shipped bytes days later.
    Placing from the bottom makes both impossible by construction."""
    dz = h * nxt(0.5, 1.2)
    mb.box((r * nxt(0.6, 1.4), r * nxt(0.6, 1.4), dz),
           (x, y, base + dz * 0.5), role, rot_z=nxt(0.0, math.pi))


def _pile(mb, span, height, seed, kind, tier):
    """One pile. `tier` is 0, 1 or 2; `kind` picks WHAT FELL.

    The three kinds are not decoration. A belt tile, a wall and a foundation
    fail differently and leave different things, so the small pile is a bent
    deck with a length of frame under it, the medium one is plate and studs off
    a wall, and the large one is broken slab with its reinforcement standing
    out of it. See the module docstring.

    TWO PARTS OWN THE DECLARED BOX AND NOTHING ELSE MAY REACH IT, which is the
    discipline every machine in this project already follows (the miner's foot
    pads own its 4 x 4, the belt's rail ends own the cell edge). Here the two
    mounds own the footprint - one spans X exactly, the other spans Y exactly,
    and neither is yawed, because a yawed box's corners leave the box it was
    given - and the CREST plate owns the height. Everything after them is
    placed strictly inside, and `mf.assert_inside` refuses the build rather
    than letting `validate_glb` find it in the shipped bytes.

    That is also why the pivot lands where the contract wants it: the pile is
    centred on x and y because the two parts that define its extent are, not
    because a measured offset was subtracted back out afterwards."""
    nxt = _rand(seed)
    s, h = span, height
    heavy = "SteelDark"
    t = s * PLATE_T
    half = s * 0.5

    # --- THE APRON: material thrown clear, and it owns the footprint ---------
    # TWO THIN SLABS IN A CROSS AND NOT ONE FULL-SQUARE MOUND, and the first
    # draft of this file is why. It gave the footprint to two big unyawed
    # boxes at half the pile's height, and the Cycles receipt showed exactly
    # what that is: a low square PLATFORM with a few small parts on top. It
    # read as a crate. A collapse does not leave a plinth; it leaves a heap in
    # the middle and material thrown outward that thins toward the edge.
    #
    # So the parts that own the declared box are the LOWEST things in the pile,
    # at a ninth of its height, crossing at right angles so the outline is not
    # a square. Everything with mass sits inside them.
    # FOUR SHEETS, ONE PER EDGE, AND NOT A PAD. The second draft made the apron
    # two full-span slabs crossing at the centre, and the receipt showed that
    # is still a plinth: a hard-edged plus-shaped skirt under every pile,
    # reading as a base plate the wreck was set down on. Four separate sheets,
    # each holding ONE edge and each a different width, hold the same declared
    # box while reading as what they are - flat material thrown clear, landing
    # at the four points of the compass and not joined to each other.
    edge = s * 0.13
    for k in range(4):
        w = s * nxt(0.26, 0.44)
        off = nxt(-0.18, 0.18) * s
        thick = h * nxt(0.07, 0.13)
        if k < 2:
            sx = 1.0 if k == 0 else -1.0
            mb.box((edge, w, thick), (sx * (half - edge * 0.5), off,
                                      thick * 0.5), heavy)
        else:
            sy = 1.0 if k == 2 else -1.0
            mb.box((w, edge, thick), (off, sy * (half - edge * 0.5),
                                      thick * 0.5), heavy)
        if tier == 2 and k == 1:
            # LOD2 keeps the four sheets and one core block, because at that
            # range a pile is a bump with a colour and the only thing it still
            # owes is its footprint.
            continue
    if tier == 2:
        mb.box((s * 0.60, s * 0.52, h * 0.62), (0.0, 0.0, h * 0.31), heavy)
        return

    # --- the core: three yawed slabs, none of them square to the world -------
    # Yawed and unequal so the heap has a broken outline from every bearing.
    # They are kept clear of the declared box by their own half-diagonals, and
    # `mf.assert_inside` is what proves it rather than this comment.
    mb.box((s * 0.50, s * 0.42, h * 0.58), (nxt(-0.05, 0.05) * s,
           nxt(-0.05, 0.05) * s, h * 0.29), heavy, rot_z=nxt(0.0, math.pi))
    mb.box((s * 0.38, s * 0.46, h * 0.76), (nxt(-0.07, 0.07) * s,
           nxt(-0.07, 0.07) * s, h * 0.38), heavy, rot_z=nxt(0.0, math.pi))
    # THE THIRD BLOCK IS LIFTED CLEAR OF THE GROUND PLANE, and that is a fix
    # rather than a taste. It is the only `Steel` part in the core, so its
    # underside sitting on z = 0 - where the `SteelDark` apron sheets already
    # have theirs - was 38 same-facing coplanar pairs across the three sizes,
    # found by `check_coplanar` in the shipped bytes. The apron owns the ground
    # plane, so nothing of another material may have a face on it: the same
    # rule the smelter's launder was fixed under, one asset over.
    # 0.18 is above the apron's own thickest sheet (0.13), so no draw of the
    # random stream can put an apron top on this block's bottom either.
    mb.box((s * 0.32, s * 0.28, h * 0.46), (nxt(-0.14, 0.14) * s,
           nxt(-0.14, 0.14) * s, h * (0.18 + 0.23)), "Steel",
           rot_z=nxt(0.0, math.pi))

    # --- THE CREST: the part that owns the height ---------------------------
    # A big plate levered up out of the heap, its high corner exactly at the
    # declared top. This is the most legible thing on the asset from a
    # distance - a flat sheet standing at an angle where nothing around it is
    # flat - so giving it the z extreme means the pile's height is a property
    # of the one part a player actually reads it from.
    crest_lift = h * 0.42
    _plate(mb, (nxt(-0.08, 0.08) * s, nxt(-0.08, 0.08) * s,
                h - t - crest_lift),
           s * 0.50, s * 0.38, nxt(0.0, math.pi),
           [0.0, crest_lift * 0.30, crest_lift, crest_lift * 0.50], t,
           "SteelDark")

    # --- the members, and they have to PROTRUDE ------------------------------
    # Long enough to come out of the heap and lie on the apron, because a beam
    # buried in the mass says nothing: the whole job of a member is to tell the
    # eye the thing had a FRAME. Each is placed low, so it reads as fallen
    # rather than balanced on top.
    sect = s * 0.055
    for i in range(4 if kind == "slab" else 3):
        ln = s * nxt(0.52, 0.62)
        # THE PITCH IS BOUNDED BY THE PILE'S OWN HEIGHT AND NOT CHOSEN FREELY.
        # A pile is 0.28 of its span tall, so a member more than half that span
        # long cannot tilt as far as one in a deep heap without pushing an end
        # through the ground - which is exactly what the first version did, and
        # `mf.assert_inside` refused the build with "Z below the ground plane by
        # 0.01564" rather than letting it reach the exporter. Solving for the
        # tilt that fits is the fix; clamping the result afterwards would have
        # made every member on the big piles lie at the same angle.
        rise_max = max(0.0, h * 0.44 - sect * 0.9)
        pitch = nxt(-1.0, 1.0) * math.asin(min(1.0, 2.0 * rise_max / ln))
        rise = ln * 0.5 * abs(math.sin(pitch)) + sect * 0.9
        # The 0.02 lift is the shard rule again: a member whose tilt exactly
        # fills the height would otherwise put its low end ON the ground plane,
        # which the apron owns.
        _member(mb, (nxt(-0.06, 0.06) * s, nxt(-0.06, 0.06) * s,
                     rise + h * 0.02
                     + max(0.0, h * 0.86 - 2.0 * rise) * nxt(0.10, 0.90)),
                ln, sect, nxt(0.0, math.pi), pitch, "Steel",
                tear=sect * 1.6 if i < 3 else None)
    if kind == "slab":
        # Reinforcement standing OUT of the broken slab: thin bars at steep
        # angles. Nothing else in the pile is both thin and steep, so this is
        # what makes a concrete failure look unlike a steel one.
        for i in range(5):
            # A bar this steep has its LENGTH solved from the height, the other
            # way round from the members above: the steepness is the whole read
            # and is what must survive, so the bar gets shorter rather than
            # flatter when the pile is shallow.
            pitch = nxt(0.75, 1.15)
            ln = min(s * nxt(0.24, 0.36), h * 0.92 / math.sin(pitch))
            rise = ln * 0.5 * math.sin(pitch)
            _member(mb, (nxt(-0.22, 0.22) * s, nxt(-0.22, 0.22) * s,
                         rise + max(0.0, h - 2.0 * rise) * nxt(0.35, 0.65)),
                    ln, sect * 0.30, nxt(0.0, math.pi), pitch, "SteelRust")

    # --- the twisted plate --------------------------------------------------
    for i in range(4 if kind == "deck" else 3):
        w = s * nxt(0.34, 0.48)
        ln = s * nxt(0.28, 0.42)
        # Corner heights spread by nearly half the pile's own height. A plate
        # bent less than that reads as a plate laid on an uneven heap.
        spread = h * 0.44
        cz = [nxt(0.0, spread) for _ in range(4)]
        base = (h - spread - t) * nxt(0.10, 0.80)
        _plate(mb, (nxt(-0.10, 0.10) * s, nxt(-0.10, 0.10) * s, base),
               w, ln, nxt(0.0, math.pi), cz, t,
               "SteelDark" if i % 2 == 0 else "SteelRust")

    if tier == 1:
        return

    # --- debris, and the one painted fragment -------------------------------
    # Out on the apron rather than on the heap: debris is what fills the space
    # between the parts that carry the read, and on top of the core it would
    # only be hidden by the crest.
    for i in range(7 if kind == "slab" else 6):
        _shard(mb, nxt, nxt(-0.36, 0.36) * s, nxt(-0.36, 0.36) * s,
               h * nxt(0.03, 0.20), s * 0.085, h * 0.18,
               "Rock" if kind == "slab" and i % 2 == 0 else "SteelRust")
    # ONE fragment of a keep-out band that outlived the building. See the
    # module docstring: paint is manufactured and nothing in nature is that
    # colour, so this is the cheapest part of the file and the loudest. It is
    # put HIGH and canted, on the crest's flank, because a scrap of paint flat
    # on the floor of a heap is a scrap of paint nobody sees.
    _plate(mb, (nxt(-0.16, 0.16) * s, nxt(-0.16, 0.16) * s,
                h * nxt(0.46, 0.66)),
           s * 0.28, s * 0.11, nxt(0.0, math.pi),
           [0.0, h * 0.05, h * 0.09, h * 0.04], t * 1.2, "Hazard")


def build(root, label, span, seed, kind):
    """One size: three tiers under the shared root, named the way
    `boulder_stone` names its depletion variants, because a consumer that can
    already pick `BoulderStone_Half_LOD0` out of a file can pick these."""
    made = []
    height = span * HEIGHT_RATIO
    for tier in (0, 1, 2):
        mb = of.MeshBuilder()
        _pile(mb, span, height, seed, kind, tier)
        node = "%s_%s_LOD%d" % (NAME, label, tier)
        mf.assert_inside(mb, span * 0.5, span * 0.5, height, node)
        mb.build(node, root)
        made.append((("%s_LOD%d" % (label, tier)), mb))
        if tier == 0:
            lo, hi = mb.bounds()
            # MEASURED, not declared: the number that goes into contracts.json
            # comes from the geometry, and a pile that grew is caught here and
            # not by the validator afterwards.
            print("[rubble] %-6s span %.2f  bbox x %.3f..%.3f  y %.3f..%.3f"
                  "  z %.3f..%.3f" % (label, span, lo[0], hi[0], lo[1], hi[1],
                                      lo[2], hi[2]))
    return made


def main():
    of.reset_scene()
    root = of.add_root(NAME)
    kinds = {"Small": "deck", "Med": "plate", "Large": "slab"}
    seeds = {"Small": 0x5217A3, "Med": 0x9E31C7, "Large": 0x1D4F0B}
    meshes = []
    for label, span in SPANS:
        meshes += build(root, label, span, seeds[label], kinds[label])
    # NO col_ NODE. See the module docstring: rubble having no collider is the
    # claim `probes/destruction.js` tests, not an omission.
    of.report(NAME, meshes)
    of.export_glb(OUT)


if __name__ == "__main__":
    main()
