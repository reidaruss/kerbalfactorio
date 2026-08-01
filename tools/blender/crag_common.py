"""crag_common.py - the harvestable rock spire, and the scree that lies at its
foot.

    build_rock_spire.py              (assets/models/dist/nodes/rock_spire.glb)
    build_props_mountains.py, _hills   (the sub-threshold rock decor)

WHY THE SPIRE IS A HARVEST NODE AND NOT A PROP.

WG-68's ruling: there are no inert rocks. Anything rock-shaped and at or above
the interaction-derived threshold IS a harvest node and gives stone, because a
rock the crosshair cannot catch is a lie the player learns after one swing and
never unlearns. Mtn_RockSpire was 3.40 m of decoration, so it was retired, and
the rocks lane named the loss out loud: "Mountains lose their spires until
either a harvestable spire form exists in the node family or the terrain grows
real crags."

This is that form. It is a node, in `assets/models/dist/nodes/`, with the two
sockets and the three depletion variants every node carries, so the same shape
that broke the ridgeline now also gives stone when you hit it.

WHAT A FROST-SHATTERED PINNACLE ACTUALLY IS, and what the old one was not. The
retired prop was three `hc.lobe` cones stacked with the radius pulled in hard:
a smooth tapering tooth. Real frost shattering works along JOINTS, so a spire
is a STACK OF BLOCKS, each one bounded above and below by a bedding surface and
on its flanks by vertical fracture planes, with the joints between blocks
offset from each other and the top block broken off at an angle rather than
tapering to a point. Every mechanism that needs is already in rock_form.py, so
this file is a plan and not a new primitive.

THE APRON IS PART OF THE FORM, not decoration around it. A spire sheds; the
debris piles against its own foot; and the pile is what stops the shaft looking
like a post pushed into the ground. It also carries the base of the silhouette
outward, which is the difference between a tooth and a crag.

THE SIZE RULE, RE-DERIVED RATHER THAN COPIED, AND IT MOVED (RN-247).

RockTuning.DECOR_ROCK_MAX_H is 0.27 m: 0.90 m authored stone-boulder height,
times the 0.40 Low z scale, times ROCK_SCALE_MIN 0.75. Nothing in this pass
moves any of those three, and the spire's own Low variant is 3.40 * 0.30 =
1.02 m authored, which at ROCK_SCALE_MIN is 0.765 m, so the smallest
harvestable silhouette in the world is still the stone boulder's and the
threshold is still 0.27 m.

But the threshold and the decoration it gates are measured on DIFFERENT SIDES
of a scale, and only one side was priced. A node is placed at a UNIFORM scale
(NodeField multiplies one scalar), so taking ROCK_SCALE_MIN for the smallest
node is right. A scatter prop is NOT: ScatterLook.scaleFor gives a non-foliage
prop a height of w * (MINERAL_H_LO .. MINERAL_H_HI), i.e. up to 1.24, on top of
w = 1 +/- jitter, which is 0.25 for a Registry `P` prop and 0.30 for a `D`
detail prop. So a decoration authored at height h is DRAWN at up to

    h * (1 + jitter) * MINERAL_H_HI  =  h * 1.55   (P)   or   h * 1.61   (D)

and the retirement compared h against 0.27 with that factor missing. The bar an
authored decoration has to clear is therefore

    DECOR_AUTHORED_MAX = 0.27 / 1.25 / 1.24 = 0.174 m   for a P prop

and every rock decoration in this file is authored under it. Two survivors of
the WG-68 sweep are NOT under it and are named rather than quietly fixed:
Hills_ScreePatch at 0.24 m draws at up to 0.372 m and Plains_PebbleA at 0.18 m
draws at up to 0.279 m, both above the threshold they were cleared against.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harvest_common as hc    # noqa: E402
import rock_form as rf         # noqa: E402


# The scatter height band ceiling and the two jitter values, transcribed from
# web/src/render/ScatterLook.ts and web/src/assets/Registry.ts. They live in
# the client and this is a build tool, so they cannot be imported; naming them
# with their source means a reader can check the transcription in one grep
# instead of rediscovering the derivation.
MINERAL_H_HI = 1.24            # ScatterLook.MINERAL_H_HI
PROP_JITTER = 0.25             # Registry.P default
DETAIL_JITTER = 0.30           # Registry.D default
DECOR_ROCK_MAX_H = 0.27        # RockTuning.DECOR_ROCK_MAX_H


def decor_authored_max(jitter=PROP_JITTER):
    """The tallest a rock decoration may be AUTHORED so that it can never be
    DRAWN at or above the harvest threshold. See the module docstring."""
    return DECOR_ROCK_MAX_H / (1.0 + jitter) / MINERAL_H_HI


def check_decor_height(name, height_m, jitter=PROP_JITTER):
    """Raise if a rock decoration could be drawn at or above the threshold.

    A rule that lives only in a comment is a rule that gets broken by the next
    person to add a prop, and this one has already been applied with a factor
    missing once. Called by every rock decoration below, so the build is what
    enforces it."""
    cap = decor_authored_max(jitter)
    if height_m >= cap:
        raise ValueError(
            "%s is %.3f m authored, which is drawn at up to %.3f m and "
            "reaches the %.2f m harvest threshold; the authored cap at jitter "
            "%.2f is %.3f m"
            % (name, height_m, height_m * (1.0 + jitter) * MINERAL_H_HI,
               DECOR_ROCK_MAX_H, jitter, cap))
    return height_m


# ---------------------------------------------------------------------------
# The spire
# ---------------------------------------------------------------------------

# EVERY LIFT'S BASE SITS BELOW THE LOWEST POINT OF THE CROWN UNDER IT, and
# `seam_margins()` below measures it rather than trusting these numbers.
#
# The first attempt seated each lift AT the nominal top of the one below, which
# is where a mason would put it and is wrong here twice over: a tipped block is
# re-seated on its LOWEST corner (rock_form.place), and a fracture plane is
# TILTED, so its lowest point is well under rz. Both errors point the same way
# and the stack came out with daylight through it in two places, which renders
# as a black slot across the shaft. It looked like a shadow under a bedding
# ledge, which is exactly what the ledges elsewhere on the same shaft do
# produce, so the eye could not tell the two apart and the arithmetic could.
#
# Measured on that build: seam 1 +0.086, seam 2 -0.035, seam 3 -0.007 local
# units. Two negative, both real, neither visible as a defect in the frame.
#
# Blocks in REMOVAL ORDER: a depleted spire keeps blocks[:n], so the list runs
# base, buttress, second lift, toe, third lift, broken point. Taking the tail
# away therefore shortens the tower from the top, which is how a spire wears
# down, rather than dissolving it from the bottom, which is how nothing does.
SPIRE_BLOCKS = (
    # The base lift. Widest, two bedding ledges, one vertical joint face on
    # the -X side running the full height of the block.
    dict(loc=(0.00, 0.00, 0.00), r=(0.35, 0.31, 0.68), seg=8,
         role="body", rings=rf.BED5, top=0.90, tilt=(0.12, 0.09),
         ring_jit=0.05, rim_bites=2, flank_bites=4, pits=3,
         shears=((0.20, 0.24, 0.00, 1.0),),
         clasts=((0.55, 0.30, 0.15, 20.0, 35.0),
                 (0.12, 0.62, 0.13, -26.0, 20.0))),
    # The big buttress: a slab that has slid off the shaft and come to rest
    # against it, leaning IN. It is what carries the base of the silhouette
    # out sideways, and it is the difference between a crag and a post.
    dict(loc=(0.30, 0.22, 0.00), r=(0.22, 0.19, 0.66), seg=6,
         role="second", rings=rf.BED4, top=0.54, tilt=(-0.60, -0.42),
         ring_jit=0.06, rim_bites=2, flank_bites=3, pits=1,
         lean=(-0.13, -0.10), shears=((0.08, 0.19, 0.24, 1.0),)),
    # Second lift, OFFSET and TILTED. The offset is the whole trick: lifts
    # stacked concentrically read as a machined tower, which is what the first
    # attempt at this asset did and why it photographed as a rocket. A real
    # jointed stack steps sideways at every bedding surface.
    dict(loc=(-0.09, 0.06, 0.40), r=(0.30, 0.26, 0.66), seg=7,
         role="body", rings=rf.BED4, top=0.88, tilt=(-0.16, 0.12),
         ring_jit=0.05, rim_bites=2, flank_bites=4, pits=2, crown_pit=0.07,
         lean=(0.10, -0.06), tip=7.0,
         shears=((0.63, 0.20, 0.00, 1.0),),
         clasts=((0.18, 0.50, 0.16, -24.0, 40.0),
                 (0.72, 0.24, 0.13, 18.0, -30.0))),
    # The second buttress, on the far side and much lower: a spire that
    # buttresses on one side only leans, and this one is meant to stand.
    dict(loc=(-0.28, -0.20, 0.00), r=(0.19, 0.21, 0.46), seg=6,
         role="second", rings=rf.BED4, top=0.58, tilt=(0.46, 0.40),
         ring_jit=0.07, rim_bites=2, flank_bites=2, spin=24.0,
         lean=(0.09, 0.07)),
    # Third lift, offset back the other way and tilted the other way, so the
    # shaft zigzags rather than leaning steadily.
    dict(loc=(0.08, -0.05, 0.78), r=(0.24, 0.21, 0.64), seg=7,
         role="body", rings=rf.BED4, top=0.84, tilt=(0.18, -0.14),
         ring_jit=0.05, rim_bites=3, flank_bites=3, pits=2,
         lean=(-0.09, 0.05), tip=-8.0,
         shears=((0.36, 0.16, 0.18, 1.0),),
         clasts=((0.40, 0.58, 0.17, 26.0, -45.0),)),
    # The broken point. NOT a taper to an apex: a lift whose crown has come
    # off at a steep angle, with a joint face down one side of it. A tapering
    # cone is what the retired prop did and it is why it read as a tooth.
    dict(loc=(0.02, 0.02, 1.10), r=(0.19, 0.16, 0.66), seg=6,
         role="body", rings=rf.R3, top=0.62, tilt=(0.52, -0.34),
         ring_jit=0.06, rim_bites=3, flank_bites=3, pits=1,
         lean=(-0.06, 0.03), tip=6.0,
         shears=((0.82, 0.13, 0.00, 1.0),)),
)

# The apron. `sink` is 0 for the same reason the coal boulder's rubble is:
# Parts.fit() re-pins the pile base to z = 0, so a fragment buried below zero
# would lift the whole spire off the ground by exactly what it was buried.
SPIRE_APRON = dict(area=(0.38, 0.34), size=(0.12, 0.11, 0.085), seed=6207,
                   seg=5, sink=0.0)

# (name, bbox scale, block count, apron count). The z scales are chosen to
# match the natural height of the blocks that survive, so a depleted spire is
# SHORTER rather than a full spire squashed: with blocks[:4] the tallest
# surviving block tops out at about 0.55 of the full stack, and with blocks[:2]
# at about 0.28, which is where these two numbers come from.
SPIRE_VARIANTS = (
    ("Full", (1.00, 1.00, 1.00), 6, 5),
    ("Half", (1.00, 1.00, 0.55), 4, 5),
    ("Low",  (1.00, 1.00, 0.28), 2, 4),
)


def seam_margins(blocks=None):
    """Vertical overlap at every joint in the shaft, in local units.

    For each pair of consecutive SHAFT lifts (the `body` entries; the
    buttresses and the toe stand on the ground and have no joint), this is

        lower crown's LOWEST point  minus  upper lift's base

    and it must be positive or the stack has a hole in it. The lower bound on
    the crown is conservative and analytic: the crown of a mass sits at
    rz * (1 + tilt.u*u + tilt.v*v) with u and v bounded by the crown's own
    radius factor, so rz * (1 - (|tilt.u| + |tilt.v|) * top * 1.2) is under the
    real minimum for every jitter the seed can produce. The 1.2 covers the
    radius wobble that can push a crown column past `top`.

    A tipped lift is re-seated on its lowest corner at exactly its own loc z
    (rock_form.place), so the upper term is loc z with no correction needed.
    """
    out = []
    lifts = [e for e in (blocks or SPIRE_BLOCKS)
             if e.get("role", "body") == "body"]
    for a, b in zip(lifts, lifts[1:]):
        tilt = a.get("tilt", (0.0, 0.0))
        reach = (abs(tilt[0]) + abs(tilt[1])) * a.get("top", 0.56) * 1.2
        crown_lo = a["loc"][2] + a["r"][2] * (1.0 - reach)
        out.append(crown_lo - b["loc"][2])
    return out

def spire_pile(roles, seed, blocks, apron, pit_scale=1.0, clast_scale=1.0):
    p = hc.Parts()
    n = min(blocks, len(SPIRE_BLOCKS))
    for k in range(n):
        e = dict(SPIRE_BLOCKS[k])
        e["loc"] = (e["loc"][0], e["loc"][1], e["loc"][2] + k * rf.BASE_DZ)
        if pit_scale != 1.0 and "pits" in e:
            e["pits"] = int(e["pits"] * pit_scale)
        if clast_scale != 1.0 and "clasts" in e:
            e["clasts"] = e["clasts"][:int(len(e["clasts"]) * clast_scale)]
        rf.place(p, e, roles, seed + k * 17)
    kw = dict(SPIRE_APRON)
    kw["count"] = apron
    kw["role"] = roles["second"]
    kw["alt_role"] = roles["body"]
    kw["alt_every"] = 3
    kw["loc"] = (0.0, 0.0, n * rf.BASE_DZ)
    p.extend(rf.rubble(**kw))
    return p


# ---------------------------------------------------------------------------
# Scree, talus and rubble: the small stuff, all under the derived cap
# ---------------------------------------------------------------------------

# A DECORATION'S FRAGMENTS ALL STAND ON z = 0, and `sink` is 0 in all three
# makers below for a reason that is not obvious and cost a render to find.
#
# rock_form.rubble can bury each fragment by a fraction of its own height, and
# on a boulder pile that is meaningless (Parts.fit re-pins the pile base to
# zero) but harmless. On a pile that is ENTIRELY fragments it is worse than
# meaningless: fit shifts the whole pile up by the DEEPEST burial, so every
# fragment shallower than the deepest one ends up hovering above the ground by
# the difference. Photographed, that is a scree field of floating chips.
#
# Burying decoration in the terrain is a placement job in any case, not an
# authoring one: the prop is dropped on a surface whose slope the builder has
# never seen.


def scree_sheet(name, seed, role, alt_role, height, count=13,
                area=(0.58, 0.49), size=(0.145, 0.13, 0.09),
                jitter=PROP_JITTER):
    """A broad, thin sheet of fractured plate: the ground a rockfall lands on.

    Every fragment is a real rock_form.mass with its own fracture plane, rim
    bite and bent body, so the sheet reads as broken plate at 1 m rather than
    as a handful of dice. `sink` buries a third of each fragment, which is what
    makes a scree field read as ground rather than as gravel poured onto it;
    the pile is fitted as a whole here, so unlike the boulder aprons it can
    afford to."""
    check_decor_height(name, height, jitter)
    # FOUR columns per fragment, not five, and the trade is the whole design
    # of a scree field: `fit` scales the pile into a fixed box, so fragments
    # per square metre is decided by COUNT alone, and at this size the reader
    # is looking at how thickly the ground is covered rather than at any one
    # chip. Four columns buys a third more chips for the same triangles.
    return rf.rubble(count, area, size, seed, role, alt_role=alt_role,
                     alt_every=3, seg=4, jit=0.34, rings=rf.R1,
                     tilt=(0.55, 0.45), z_var=0.36, sink=0.0)


def talus_cluster(name, seed, role, alt_role, height, count=7,
                  area=(0.34, 0.30), size=(0.17, 0.15, 0.13),
                  jitter=PROP_JITTER):
    """Fewer, chunkier blocks piled tight: the heap under a cliff rather than
    the sheet spread away from it. Bigger fragments, smaller footprint, and
    they lean on each other instead of lying flat."""
    check_decor_height(name, height, jitter)
    return rf.rubble(count, area, size, seed, role, alt_role=alt_role,
                     alt_every=2, seg=5, jit=0.30, rings=rf.R2,
                     tilt=(0.42, 0.38), z_var=0.34, sink=0.0)


def frost_shards(name, seed, role, alt_role, height, count=9,
                 area=(0.40, 0.34), size=(0.18, 0.085, 0.14),
                 jitter=PROP_JITTER):
    """Thin platy splinters standing on edge, which is what frost shattering
    leaves and what neither of the other two produces.

    The silhouette difference is the whole point: a scree sheet and a talus
    heap are both low and lumpy, so a biome dressed in only those reads as one
    texture.

    IT DOES NOT GO THROUGH rock_form.rubble, and the reason is the shape. A
    shard is deliberately anisotropic (long in x, thin in y) and rx / ry are
    world axes, so without a per-fragment rotation about Z every splinter in
    the field would lie along the same bearing and the field would read as
    combed. `rubble` has no such rotation and giving it one would have taken an
    extra draw from a stream the coal boulder's apron already uses, moving that
    asset's bytes for a parameter it does not want."""
    check_decor_height(name, height, jitter)
    nxt = hc.rng(seed)
    p = hc.Parts()
    for i in range(count):
        a = 2.0 * math.pi * i / count + (nxt() - 0.5) * 1.5
        rr = math.sqrt(nxt())
        s = 1.0 - 0.30 * nxt()
        cx = area[0] * rr * math.cos(a)
        cy = area[1] * rr * math.sin(a)
        h = size[2] * s
        spin = 360.0 * nxt()
        rl = alt_role if (alt_role and i % 4 == 0) else role
        v, f, sm, roles = rf.mass(size[0] * s, size[1] * s, h,
                                  loc=(cx, cy, i * rf.BASE_DZ),
                                  seg=5, seed=seed + 37 * i, jit=0.26,
                                  rings=rf.R2, top=0.70,
                                  tilt=(0.42 * (nxt() * 2.0 - 1.0), 0.18),
                                  ring_jit=0.10, rim_bites=1, role=rl)
        p.extend(hc.Parts().add(v, f, sm, roles)
                 .rotate("Z", spin, pivot=(cx, cy, 0.0)))
    return p
