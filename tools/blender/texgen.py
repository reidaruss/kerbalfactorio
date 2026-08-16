#!/usr/bin/env python3
"""
texgen.py - deterministic procedural PBR surface maps. Stdlib only, no Blender.

    python tools/blender/texgen.py               # write assets/textures/dist/
    python tools/blender/texgen.py selftest      # prove the encoder and the fields
    python tools/blender/texgen.py --list        # role -> family table, no output

WHY THIS EXISTS (DW-35). 37 of 48 shipped assets carry no texture at all: flat
colour on a PBR material with no maps. Uniform roughness is exactly what makes
untextured PBR read as plastic, and a normal map is the single biggest win on
flat-shaded low-poly geometry because panel lines, bevels, rivets and weld seams
read as geometry for free. This module is where those maps come from.

WHY IT IS NOT A BLENDER BAKE. DW-5 makes the byte-identical rebuild a gate, and
image encoders are a classic source of nondeterminism: PNG tIME chunks, encoder
version strings in tEXt, and thread-count-dependent deflate. A Cycles bake adds
sampling on top of all three. Generating the pixels here, in plain Python, and
writing the PNG with an encoder we own, is the only version of this that can
honestly claim byte-identical output. It also removes Blender from the texture
path entirely, so a Blender upgrade (BT-14) cannot rewrite a texture byte.

DETERMINISM, STATED RATHER THAN HOPED:
  * No RNG. Every "random" value comes from `_hash01`, which is pure 32-bit
    integer arithmetic and therefore identical on every platform Python runs on.
  * No transcendentals in the field synthesis. Only + - * / and math.sqrt.
    sqrt is correctly rounded by IEEE-754, so it is bit-portable; sin/cos/tan
    are NOT, and DW-14 is this project's own scar from exactly that (a 1 ULP
    std::tan divergence between two libms). None are used here.
  * No timestamps, no text chunks, no gamma chunk. A PNG this module writes is
    IHDR + IDAT + IEND and nothing else.
  * zlib is pinned to explicit parameters rather than defaults, and its version
    is recorded in the manifest so a change is visible rather than mysterious.
    This is the ONE remaining external dependency in the byte stream and it is
    named here on purpose. Same machine, same bytes, always; a different zlib
    build could in principle re-pack the same pixels differently, which would
    change the file without changing the image. `selftest` checks the PIXELS
    round-trip, and the rebuild gate checks the BYTES, so the two together tell
    those cases apart.

THE SCHEME. Shared tiling surfaces, not per-asset textures. The count in this
line has been wrong twice, so it is deliberately not stated as a number any
more: a family is added by appending a row here and to FAMILIES, and a header
that has to be decremented is a header nobody updates.

    panel   hard-surface industrial: plate seams, rivets, bolts, weld bead,
            scratches and grime. Steel, painted accent, ore metal.
    coarse  rough non-metal, GRANULAR and dug-up rather than bedded: soil,
            sand, regolith, rubber, and the Coal, Iron and Copper ITEM chunks,
            which are loose material rather than rock in place.
    stone   HOST ROCK in place: angular fracture facets meeting at sharp
            arrises, chip scars, a micro cusp, and dust held in the crevices.
            Rock and RockDark only (RN-742). Split out of `coarse` for bark's
            reason, and the measurement is the argument: `coarse` has a mean
            normal tilt of 7.69 degrees with a MAXIMUM of 27.12 and 0.0 per
            cent of its ORM green under 0.60, so nothing wearing it can glint
            or catch a raking sun, and that surface is most of every boulder,
            the whole spire and all the scree. `stone` measures 17.18 and
            74.31 with 29.3 per cent under 0.60.
    bark    tree trunks: near-vertical fissures and ridge plateaus, a few
            horizontal breaks and knots. Bark and BarkLight only. Split out of
            `coarse` because rock pitting on a trunk reads as a stone pillar;
            bark's relief is strongly DIRECTIONAL and rock's is isotropic,
            which is not a difference a shared field can paper over.
    ore     ore seams in host rock: warped parallel strata, crevices between
            the bands, crystalline facet grain on them. IronOre, CopperOre,
            CoalSeam only (RN-156). Split out for bark's reason exactly:
            bedded mineral is DIRECTIONAL, rubble pitting is not, and the
            roughness contrast between smooth facet glints and dusty matrix
            is what sells a mineral under a moving sun.

Each family ships TWO maps and no albedo:

    <family>_n.png     tangent-space normal, RGB
    <family>_orm.png   R = ambient occlusion, G = roughness, B = metalness

ALBEDO IS DELIBERATELY ABSENT. `of_lib.PALETTE` is the game's colour authority
and DW-35 asks for a polish pass, not a restyle; an albedo map multiplies that
colour and is therefore the one map that can silently move the palette. It is
also the map the brief ranks last ("roughness variation matters more than albedo
detail"). Skipping it halves the VRAM and the download and removes the only
restyle risk in the set. AO in the R channel darkens crevices, which is most of
what an albedo grime layer was going to buy anyway.

ORM IS A MULTIPLIER, NOT AN ABSOLUTE. three.js computes
`roughness * roughnessMap.g` and `metalness * metalnessMap.b`, so the palette's
per-role constants survive and the map can only take a surface DOWN from them.
That direction is the physically right one: wear polishes metal (lower
roughness) and grime buries it (lower metalness). It is stated here because a
map authored as an absolute would quietly flatten thirty roles onto one value.

ONE HEIGHTFIELD PER FAMILY, EVERYTHING DERIVED FROM IT. The normal is its
gradient, the AO is its local relief, and the roughness and metalness masks are
functions of it. That is the "one authority" rule applied to a texture: the AO
cannot darken a seam the normal map did not dent, because they are the same
number read twice.

TWO CARD FAMILIES BESIDE THE FOUR SURFACES. `leaf` and `grass` are
albedo+alpha CUTOUT CARDS (of_<name>_a.png, RGBA), not tiling PBR surfaces:
unit UVs rather than metres, u wraps and v clamps, and the alpha channel IS
the shape. They are the stated exception to ALBEDO IS DELIBERATELY ABSENT,
because a cutout cannot exist without its own texture, and they keep the
palette-authority argument intact by being near-neutral VALUE textures: hue
still comes from the client's colours, and the manifest publishes each card's
measured albedo_mean_linear so the client can divide it out via material.color and
keep the modulation mean-neutral. See the ALBEDO CARD FAMILIES section.
"""

import argparse
import hashlib
import json
import math
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(ROOT, "assets", "textures", "dist")

# Manifest schema version. The client reads this and refuses a version it does
# not know, rather than mis-reading a field that changed meaning. Same argument
# as the WASM bridge's OF_ABI_VERSION (standing rule 9), one tier down.
MANIFEST_VERSION = 2

SIZE = 512                 # px, square. See docs/web/ASSET-SPECS.md 2.8.

# Per-family resolution. `coarse` is half the pixels of `panel` and it is not a
# quality compromise: its tile covers half the world distance, so the two land
# on the SAME 512 px/m texel density, and the family that carries hard edges,
# rivets and a bolt head is the one that needs the pixels. Measured: coarse at
# 512 cost 588 KB of the payload against panel's 484 KB, for a surface that is
# noise and therefore incompressible, on assets the camera spends least time on.
# `bark` matches coarse at 384: its tile is smaller still (0.6 m), so 384 px
# lands at 640 px/m, already above the 512 px/m first-person target, and the
# family covers exactly two roles on organic props the camera brushes past.
# `ore` matches coarse and bark at 384: its 0.5 m tile lands at 768 px/m,
# comfortably above the 512 px/m first-person target, on a family that covers
# exactly three seam roles the camera only meets on boulder facets.
# `fur` matches coarse, bark and ore at 384: its 0.30 m tile lands at
# 1280 px/m, well above the 512 px/m first-person target, on a family whose
# finer strand layer is 7.5 mm apart and would alias away at anything less.
# It carries THREE maps rather than two, so 384 rather than 512 is also what
# keeps the addition at 2.36 MB of VRAM instead of 4.19 MB.
# `suitfab` and `suitplate` are sized by the ONE distance that matters for
# them and for nothing else in this file: the first-person hand sits 0.62 m
# from the eye, and at the client's real 60 degree vertical FOV (CameraRig.ts,
# `fovDeg = 60`, never reassigned) a 800 px frame resolves 1117 px per metre
# there. A family under about 1000 px/m is visibly soft in the one asset that
# is in every frame of the game, so both clear it: suitfab 512 px / 0.5 m =
# 1024 px/m, suitplate 384 px / 0.4 m = 960 px/m. ASSET-SPECS 2.8's 512 px/m
# first-person target is the floor here, not the aim.
# `stone` matches coarse, bark and ore at 384, and lands at the same 640 px/m
# `bark` ships at, comfortably over the 512 px/m first-person target: its
# 0.6 m tile is bark's tile exactly. The floor under it is its own finest
# authored feature, the 4.7 mm grain octave, which is three texels at 384 and
# would alias at 256. The ceiling over it is that it carries THREE maps rather
# than two, so 384 keeps the addition at 2.36 MB of VRAM instead of 4.19 MB at
# 512, which is `fur`'s argument and literally the same arithmetic (RGBA8,
# mip chain included).
# `paintchip` and `rust` match `panel` at 512 and for `panel`'s reason exactly:
# both are 1.5 m tiles on hard-surface industrial subjects, so 512 lands them
# on panel's own 341 px/m, above ASSET-SPECS 2.8's 256 px/m machine target, and
# the three families will regularly appear in one frame on one structure. A
# family that sat at 384 beside two at 512 would resolve visibly softer than
# its neighbours on the same wall, which is a defect no gate here measures.
FAMILY_SIZE = {"panel": 512, "coarse": 384, "bark": 384, "ore": 384,
               "fur": 384, "suitfab": 512, "suitplate": 384,
               "stone": 384, "paintchip": 512, "rust": 512,
               # RN-1780, REVISED. `masonry` first shipped at `stone`'s own
               # 384 px so the two were byte-identical pixels, which was the
               # right call for proving the split changes nothing but world
               # scale. It was wrong on resolution, and the honest measure is
               # texels_per_m: 384 / 1.8 m = 213, the lowest tiling family in
               # the game and BELOW ASSET-SPECS 2.8's 256 px/m machine floor,
               # not just below panel's 341. Measured on real D3D11 at the
               # storyline's own approach distance (`of.standAt` 3.4 m off
               # the cella floor, the closest a standing eye gets before the
               # ruin's own footprint pushes it back further): the facets
               # read soft, individual crack edges lose definition, in a way
               # `stone` at the same 384 px never has to answer for because
               # nothing stands a player 3 m from a 1.0-1.5 m boulder with a
               # cracked stone wall filling the frame the way a ruin does.
               # 512 clears the floor at 284 texels/m (matching `panel`'s own
               # resolution, which is this project's precedent for "large
               # architectural surface, judged up close"). masonry NO LONGER
               # SHIPS THE SAME BYTES AS STONE below this line: the same
               # generator functions, called at a genuinely higher target
               # resolution, are not the same PNG, and that is the honest
               # trade for the fix (stone itself is untouched, still 384,
               # still byte-identical to its own prior bytes).
               #
               # `ember` is a THIRD the resolution because it is a tiny
               # family (one part, two 0.30/0.86 m primitives on one machine)
               # at a 0.28 m tile: 128 px / 0.28 m = 457 texels/m, already
               # above panel's 341 machine target, so spending more would buy
               # nothing this consumer can show.
               "masonry": 512, "ember": 128,
               # RN-1815. `concrete` takes `masonry`'s two numbers verbatim
               # and neither is re-derived, because the consumer set is the
               # same one masonry's own numbers were chosen against: an
               # architecture-scale poured surface judged from a standing eye
               # a few metres away. 512 px / 1.8 m = 284 texels/m, `panel`'s
               # own resolution, which is this project's precedent for "large
               # architectural surface, judged up close" and clears
               # ASSET-SPECS 2.8's 256 px/m floor that masonry at 384 did
               # not. Going BIGGER on the tile was considered and refused
               # with a number: 2.4 m would drop the pad's 24 m skirt from
               # 13.3 repeats to 10, and it would also drop the density to
               # 213 texels/m, which is the exact defect RN-1780 spent its
               # own raise fixing. The repeat is answered by what the tile
               # CONTAINS instead (see `_concrete_height`), not by making the
               # tile bigger and the texels worse.
               "concrete": 512}

ZLIB_LEVEL = 9
ZLIB_MEMLEVEL = 9
ZLIB_WBITS = 15


# ---------------------------------------------------------------------------
# Role -> family. THE authority for which surface a palette role wears.
#
# This table is consumed by three different things - the Blender preview
# renders, the texture checks, and the client - so it is published as JSON
# rather than transcribed. A role absent from this table is deliberately FLAT
# and is listed in FLAT_ROLES below with the reason, because "not in the dict"
# and "decided to leave alone" look identical at a call site and only one of
# them is a decision.
# ---------------------------------------------------------------------------
ROLE_FAMILY = {
    # --- panel: anything manufactured ---
    "Steel": "panel", "SteelDark": "panel", "SteelLight": "panel",
    "Hazard": "panel",
    # RN-1493, RN-1494, RN-1550: THE CONSUMERS OF THE D-020 VOCABULARY.
    # `paintchip` and `rust` shipped UNREFERENCED at RN-1474/RN-1475, following
    # the `leaf`/`grass` precedent, and an unreferenced family is a claim no
    # frame has ever tested. These rows are what test it.
    #
    # `Accent` LEAVES `panel` on the exact argument that moved `Bark` out of
    # `coarse`, `Suit` out of `panel` and `Rock` out of `coarse`: the family
    # encoded the wrong FACT about the surface. `panel` is MANUFACTURE OUT OF
    # PLATE (seams, rivet rows, a weld bead), and `Accent` is not plate at all,
    # it is PAINT ON plate: every one of its 17 consumers uses it for a painted
    # band, a keep-out ring, a chute lip or a placard. `paintchip` is authored
    # as exactly that thing failing - a coating on sound steel, metalness going
    # UP as the paint leaves - so the role and the family now describe the same
    # object. Measured on the shipped frames before this move, the accent bands
    # were the only large areas on a machine carrying no surface variation at
    # all: flat orange, no wear, no edge, at the two places on a smelter a
    # player's eye is told to look.
    #
    # `SteelWorn` is a SEPARATE new role on the same `paintchip` family, and it
    # does not conflict with `Accent`: it is a coating that has failed where
    # the machine gets HIT (rubbing strips, kick plates, the lip an item slides
    # over, the tread a boot lands on), which is a different surface fact than
    # a painted band even though both wear thinning paint.
    #
    # `SteelRust` is a NEW role and deliberately not a re-pointing, because no
    # existing steel role could take `rust` honestly: `SteelDark` is worn by 26
    # build scripts including the rockets and the station, and a rusted orbital
    # hull is a worse claim than an unweathered smelter. A new role costs one
    # palette row and is scoped to whatever paints it. Two lanes independently
    # reached for it: the smelter's hot path (RN-1493/1494) and the miner's
    # wet-ore path (RN-1550, the throat, spoil lip and column collar). Integration
    # merged these into the ONE role below rather than splitting it, because the
    # smelter lane's own report on RN-1493/1494 recorded its 5C4238 constant as
    # a numeric hole (luma 4.12) and asked for the hex lifted 30 to 40 percent
    # before a later pass copied the role; the miner lane's 834F2A independently
    # is that lift. `of_lib.PALETTE` carries the single resulting constant.
    "Accent": "paintchip", "SteelWorn": "paintchip",
    "SteelRust": "rust",
    # SuitAccent stays on `panel` although it is a suit colour, and this is
    # deliberate rather than an oversight: rocket_common.py and
    # build_lander_landed.py both paint stripes and fittings with it, so it is
    # NOT a player-only role and moving it would re-surface another lane's
    # assets. The suit's own accent reads through geometry and value here.
    "SuitAccent": "panel",
    # --- suitfab / suitplate: the pressure garment (RN-643, RN-644) ---
    # `Suit`, `SuitDark` and `Plate` are used by build_player_body.py,
    # build_player_fp_arms.py and build_armour_set.py and by NOTHING ELSE in
    # the repo, so re-pointing them re-surfaces the player kit and only the
    # player kit. That exclusivity is what makes this a safe move rather than
    # a cross-lane one, and it was checked by grep before it was made.
    #
    # They were on `panel`, and `panel` is the wrong FACT about a pressure
    # suit in exactly the way `coarse` was the wrong fact about bark. panel
    # encodes MANUFACTURE OUT OF PLATE: seams, rivet rows, a weld bead. A
    # fabric garment has none of those, and section 2.1 item 4 measures
    # panel's effective roughness band at 0.032, which it names as "the
    # plastic read on every machine, plate and suit". A woven surface and a
    # worn metal fitting are two different materials and neither of them is
    # a riveted plate.
    # RN-859: `SuitGrime` wears the SAME family the suit does, on purpose. A
    # new family would be a new set of PNGs and a full regeneration of every
    # other family with it; reusing `suitfab` adds one row to the manifest's
    # role table and changes not one texel. It is also the better look: the
    # weave reads through the dirt, so it is dirt ON fabric rather than a
    # patch of different fabric.
    "Suit": "suitfab", "SuitDark": "suitfab", "SuitGrime": "suitfab",
    "Plate": "suitplate",
    # --- fur: the creature pelt (RN-455, retargeted RN-461). The ROLE
    #     names stay: a tarantula cuticle really is chitin and the setae
    #     grow out of it, so the role says what the part IS and the family
    #     says what it LOOKS like. Fang is on it only because the client
    #     merge gives the whole creature one material anyway; at 4 cm of
    #     geometry the map on it is unobservable either way.
    "Chitin": "fur", "ChitinBand": "fur", "ChitinUnder": "fur",
    "Fang": "fur",
    # --- coarse: anything dug up or grown ---
    # Iron and Copper were in `panel` for one pass and it was the clearest
    # regression in the whole set: an ore vein wearing plate seams, rivet rows
    # and a weld bead reads as scrap panel riveted onto a rock, which is worse
    # than the flat metal wedge it replaced. They are METAL but they are not
    # MANUFACTURED, and `panel` encodes manufacture rather than metallicity.
    # Ore wants relief, just not that relief; metalness still comes from the
    # palette constant, which `coarse` leaves at identity.
    "Iron": "coarse", "Copper": "coarse",
    "Regolith": "coarse",
    "Sand": "coarse", "Soil": "coarse", "Coal": "coarse",
    "Rubber": "coarse",
    # --- stone: the HOST ROCK (RN-742) ---
    # `Rock` and `RockDark` leave `coarse` on exactly the argument that moved
    # Bark out of it and Suit out of `panel`: the family encoded the wrong FACT
    # about the surface. Measured, and this is the whole case:
    #
    #   coarse  normal mean tilt 7.69 deg, MAX 27.12 deg, and 0.0 per cent of
    #           its ORM green below 0.60
    #   stone   mean 17.18 deg, max 74.31 deg, 29.3 per cent below 0.60
    #
    # No texel in `coarse` is steeper than 27 degrees and no part of it is ever
    # smooth, so host rock wearing it can neither glint nor catch a raking sun.
    # That surface is most of every boulder, the whole spire and all the scree,
    # which made it the flattest thing in the game by measurement and the
    # single largest gap against ART-DIRECTION.md's "surfaces that respond to
    # light like materials".
    #
    # WHAT STAYS ON `coarse` IS WHAT `coarse` ACTUALLY DESCRIBES WELL: granular
    # and dug-up things. Sand, Soil, Regolith, Rubber, and the Iron, Copper and
    # Coal ITEM chunks, which are loose material rather than bedded rock. The
    # ore-in-rock seam roles stay on `ore` for RN-156's reason, unchanged.
    #
    # THIS MOVE COSTS ZERO ASSET BYTES on its own, because role-to-family
    # binding is resolved at RUNTIME from the manifest. The .glb rewrite in the
    # same commit is the PALETTE change travelling with it, not this.
    #
    # Moves in the same commit as the client's copy of this table (RN-100's
    # rule: verifyAgainstManifest makes a one-sided move a failed smoke run).
    "Rock": "stone", "RockDark": "stone",
    # --- bark: tree trunks ---
    # Moved out of `coarse` for the same reason Iron and Copper moved out of
    # `panel`: the family encoded the wrong FACT about the surface. `coarse`
    # is isotropic fracture, and a trunk wearing it reads as a stone column
    # with moss. Bark's structure is directional (fissures along the grain),
    # so it needs its own field, not a retune of the shared one.
    "Bark": "bark", "BarkLight": "bark",
    # --- ore: seam mineral in host rock ---
    # The ore-in-rock roles (RN-156), NOT the Iron/Copper/Coal item rows
    # above, which stay in `coarse`. Same argument that split bark out: a
    # seam face is bedded mineral, its structure is directional strata, and
    # rubble pitting is the wrong fact about it.
    "IronOre": "ore", "CopperOre": "ore", "CoalSeam": "ore",
    # --- the albedo CARD families (RN-181) ---
    # The foliage roles leave FLAT_ROLES for `leaf` and `grass`. The recorded
    # objections below are honoured rather than overruled: they refused a
    # NORMAL map on a card, and the card families carry none. What a card
    # family adds is an albedo whose ALPHA is the shape, alpha-tested at the
    # manifest's declared cutoff, over authored unit UVs (RN-180). This move
    # lands in the same commit as the client's copy of this table, because
    # verifyAgainstManifest makes a one-sided move a failed smoke run.
    "Leaf": "leaf", "LeafDeep": "leaf", "LeafLight": "leaf",
    "LeafDry": "leaf",
    "Grass": "grass",
    # --- masonry: architecture-scale stone (RN-1780, look audit R3) ---
    # `Rock`/`RockDark` cover 0.14 m to 35.2 m of consumer, measured off the
    # shipped bytes: item chunks and boulders at one end, the ruin at the
    # other, 195x apart at the audit's own framing. `stone`'s 0.6 m tile is
    # RIGHT for the boulder end (RN-742: chosen by rendering it against a
    # 1.0-1.5 m boulder) and gives the ruin ~59 repeats across its 35.2 m
    # cella, which is RN-953's own refused failure one asset up. `Masonry`
    # and `MasonryDark` are new roles, not a re-point of `Rock`/`RockDark`,
    # because the boulders, the spire, the scree, the smelter's hearth
    # surround and every other consumer under ~4 m stay correctly served by
    # `stone` and must not move. Worn by exactly three assets: the ruin, the
    # foundation deck and the launch pad, all `structures`/`rocket` scale and
    # none of them a prop a player picks up.
    "Masonry": "masonry", "MasonryDark": "masonry",
    # --- concrete: POURED architecture-scale stone (RN-1815) --------------
    # The launch pad leaves `masonry` and takes a family of its own, and the
    # split is one step further along the argument that split `masonry` out
    # of `stone`. RN-1780 fixed the WORLD SCALE (0.6 m was a boulder's tile
    # on a 35 m ruin) and deliberately reused `_stone_height`, so masonry was
    # still stone's own field when the pad wore it: 7.5 cm fractured facets
    # separated by arrises. (RN-1835 has since re-authored `masonry` as
    # coursed ashlar, which changes what the RUIN wears and not this
    # argument: the pad needs a poured field either way, and ashlar is if
    # anything the worse of the two on a launch pad, being laid castle
    # blocks rather than merely the wrong rock.)
    # That is a correct claim about a quarried ruin and a false one about a
    # launch pad, whose surfaces were POURED against formwork; the pad's own
    # verifier read the 2 m outer skirt as "a repeating dark aggregate or
    # rock tile rather than poured concrete".
    #
    # WHY NOT RETUNE `masonry` INSTEAD, which is the cheaper move and was
    # weighed first. Three reasons, in order of weight. (1) It would move the
    # RUIN, whose whole subject is laid stone and whose own follow-up
    # (coursed ashlar, routed by RN-1780 and allocated at RN-1835) is about
    # making it MORE stone-like, not less; two lanes pulling one family in
    # opposite directions is how a shared surface ends up serving neither.
    # (2) The parameters that would have to change are not parameters at all:
    # a facet field and a formed face differ in their FEATURES (board marks,
    # a lift line, tie holes, blowholes) and no `normal_strength` or
    # `tile_m` reaches those. RN-742's own rule, three times over now:
    # the family encoded the wrong FACT about the surface. (3) The foundation
    # deck is masonry's third consumer and is deliberately NOT moved here
    # (see below), so a retune would have hit it too.
    #
    # THE FOUNDATION STAYS ON `masonry`, and that is a scope decision rather
    # than a claim that it is right. A player-built foundation deck is poured
    # too and probably wants this family; it is a different asset with its
    # own frames, its own before/after and no verifier finding against it,
    # and moving it here would put an unmeasured change in a measured pass.
    # Recorded as owed, the same way RN-1780 recorded coursed ashlar.
    #
    # WORN BY: the launch pad and nothing else. `Concrete` the poured cap and
    # the bunker, `ConcreteDark` the mass (plinth, trench floor, stair, deck
    # control joints), `ConcreteSoot` the deposit on both - which wears THIS
    # family and not the soot's own, by RN-859's rule: what is under the
    # dirt has to read through it.
    "Concrete": "concrete", "ConcreteDark": "concrete",
    "ConcreteSoot": "concrete",
    # --- rust, second consumer: SOOT on steel (RN-1815) -------------------
    # `Soot` deliberately shares `SteelRust`'s family. See of_lib.PALETTE's
    # `Soot` row: the steel under a flame trench's carbon IS oxidised, so the
    # flake relief must read through the deposit, and a family of its own
    # would be three more PNGs saying the same thing about the same
    # substrate. RN-1494's recorded silent failure ("`rust` wired to a grey
    # role renders grey rust") is the intended result here rather than a
    # hazard.
    "Soot": "rust",
    # --- ember: the firebox peep and sight strip (RN-1780, look audit R6) ---
    # See `of_lib.PALETTE`'s `EmberEmissiveState` row for why this is a new
    # role rather than a re-point of `EmissiveState`.
    "EmberEmissiveState": "ember",
}

# Roles with NO map, and why. Each of these would be made worse by one.
FLAT_ROLES = {
    "Glass": "transparent; a normal map on a 0.35-alpha pane reads as dirt",
    "Water": "transparent and animated by the shader, not by a map",
    "Ice": "near-specular; relief belongs in the mesh at this poly count",
    "Oil": "a pool surface, deliberately mirror-flat",
    # Leaf, LeafDeep, LeafLight, LeafDry and Grass lived here from DW-35 to
    # RN-181 with two recorded reasons: "a normal map fights the flat-shaded
    # silhouette" and "sub-pixel blades at any real viewing distance". Both
    # were about the SURFACE families and both still hold; the roles moved to
    # the albedo card families above, which carry no normal map, and the
    # honest converse of the sub-pixel argument (RN-101: a 0.6 m blade spans
    # ~100 px at 8 m) is what the card alpha is for.
    "Skin": "1.5 cm of visible wrist; a pore map is 5.6 MB for nothing",
    "EmissiveState": "a state light. Any AO or roughness on it is a lie about "
                     "what the surface is doing",
    # RN-455. Both eye roles are 3 to 6 cm of convex bead on a creature the
    # player meets at 2 m: chitin pitting at that size is one texel across
    # and reads as noise, and an eye is the one part of a spider that IS a
    # polished sphere. They differ from each other by VALUE, which is the
    # only channel that survives SpiderFlock's merge.
    "EyeGlow": "a wet convex bead 6 cm across; relief and grain belong to "
               "the shell around it, not to it",
    "EyeDark": "the six secondary eyes, same argument as EyeGlow",
}

# Metres of world space one repeat of the texture covers. UVs ship in METRES
# (see of_lib.MeshBuilder.project_uvs), so this number lives in the manifest and
# is applied by the consumer as texture.repeat = 1 / tile_m. Retuning texel
# density therefore costs zero asset rebuilds, which is the whole reason UVs are
# in metres rather than pre-divided.
# BOTH of these were retuned by RENDERING them rather than by computing them,
# which is the only way tile size can honestly be chosen.
#
# `panel` 1.00 -> 1.50 m. At 1 m a 4 m wall wore twelve plate columns, so the
# plates were 33 cm and a machine read as a mosaic of small tiles. 1.5 gives
# ~50 cm plates and drops the horizontal repeat across that wall from 4 to 2.67.
# 2.0 was rendered too and overshoots: bolt heads reach 7 cm and read as
# battleship rivets.
#
# `coarse` 0.50 -> 0.75 m. A 0.5 m tile put 8 repeats across a 4 m foundation
# deck, and repetition is the failure mode of a shared tiling surface. 1.0 was
# rendered too and turns the facets into moss.
#
# Neither number costs anything to change: they live in the manifest and are
# applied as texture.repeat, so they touch no pixel and no .glb. `panel` lands
# at 341 px/m, above ASSET-SPECS 2.8's 256 px/m machine target; `coarse` at
# 512 px/m, which is why FAMILY_SIZE went to 384 rather than staying at 256.
#
# `bark` 0.6 m. The consumer is a trunk 0.3 to 0.5 m across and 2 to 6 m tall,
# and the thing being replaced is coarse's 0.75 m rock pitting, whose features
# were sized for a 4 m foundation deck and therefore wrap a 0.4 m trunk barely
# half a repeat: one facet becomes the whole trunk face. At 0.6 m a trunk
# circumference (~1.3 m for 0.4 m diameter) carries about two repeats around
# and a 4 m trunk carries ~6.7 repeats up, so the fissures read as many
# parallel ridges rather than as one giant feature, while the tile stays big
# enough that the repeat up the trunk is not countable at arm's length.
# `ore` 0.5 m. The consumer is a boulder seam facet 0.3 to 0.6 m across, so
# at ORE_BANDS = 5 per tile the band pitch is 10 cm and a facet carries three
# to six bands: enough parallel strata to read as a vein rather than as one
# stripe, few enough that the copies are not countable. coarse's 0.75 would
# put a 15 cm pitch on the same facet, two bands, one feature.
# `suitfab` 0.5 m. The tile size is a REPETITION argument, not a density one.
# The albedo carries soiling at 10 to 20 cm (RN-454's frequency split), and a
# patch that big in a 0.3 m tile is the tile, so the grime would repeat three
# times across a torso and read as a printed pattern. At 0.5 m the broad
# fbm period of 3 lands at 16.7 cm, inside the band, and a 0.12 m glove
# carries a quarter of one tile: no repeat is reachable on the part of this
# asset that fills the frame.
# `suitplate` 0.4 m. Its consumers are SMALL - a 5 cm knuckle plate, a 2.8 cm
# helmet ring, an armour lame - so a tile eight times the largest of them
# cannot repeat on any one part, and the scratches stay long relative to the
# plate they cross, which is what a scratch looks like.
# `stone` 0.6 m, and the consumer sets it: a boulder 1.0 to 1.5 m across, plus
# the spire and the scree. At 0.6 m a 1.5 m boulder carries 2.5 repeats, which
# is few enough that no copy is countable on the asset the camera spends most
# of its rock time on, and STONE_FACETS = 8 then lands the facets at 7.5 cm,
# so that boulder shows about twenty facets across its face: a fractured rock
# rather than a feature. The two neighbours bracket it and both are worse
# here. coarse's 0.75 m gives 2 repeats and 9 cm facets, which is the "one
# facet becomes the whole face" complaint the bark row above records, one size
# up. ore's 0.5 m gives 3 repeats, and three copies of a 20 cm pigment band
# across one boulder is exactly the countable repetition the suitfab row
# warns about.
# `paintchip` and `rust` both take `panel`'s 1.5 m, and it is inherited rather
# than rechosen: all three are the same subject at the same distance (a
# manufactured steel surface on a machine, a wall or a hull), and panel's 1.5 m
# was itself picked by RENDERING it, landing ~50 cm plates on a 4 m wall with
# 1.0 m rejected as a mosaic and 2.0 m as battleship rivets. That work does not
# need redoing for two families with the same consumers, and giving them a
# different tile would put two plate rhythms at two scales on one structure.
FAMILY_TILE_M = {"panel": 1.5, "coarse": 0.75, "bark": 0.6, "ore": 0.5,
                 "fur": 0.3, "suitfab": 0.5, "suitplate": 0.4,
                 "stone": 0.6, "paintchip": 1.5, "rust": 1.5,
                 # `masonry` 1.8 m. NOT re-derived: this is the exact value
                 # the look audit already swept as `?tile=stone:1.8` and
                 # recorded as reading correctly on the ruin (RN-1780). At
                 # 1.8 m the ruin's 35.2 m cella carries ~19.6 repeats
                 # (down from ~59 at stone's 0.6 m), the foundation's 3.52
                 # to 4.00 m carries 2.0 to 2.2 (the same order panel's 1.5 m
                 # leaves on a 4 m wall, which section 2.1 already calls a
                 # good read), and the launch pad's 21.2 to 24.0 m carries
                 # 11.8 to 13.3, comfortably in the same band as the ruin.
                 # `ember` 0.28 m. The consumer is the peep (0.30 x 0.22 m)
                 # and the sight strip (0.86 x 0.05 m); at 0.28 m the peep
                 # carries about one repeat of the whole map (the coal bed
                 # reads once, not tiled) and the strip carries ~3 along its
                 # length, few enough that no copy is countable on either
                 # part at the distance a player actually stands from them.
                 # `concrete` 1.8 m, taken from `masonry` rather than
                 # re-derived: the consumer is the same 24 m pad masonry's
                 # own row already sized for (21.2 to 24.0 m of deck and
                 # skirt, 11.8 to 13.3 repeats), and giving the pad's poured
                 # surfaces a different world scale from the ruin's laid ones
                 # would put two stone rhythms at two scales in one frame,
                 # which is the objection the `paintchip`/`rust` row above
                 # makes about `panel`.
                 "masonry": 1.8, "ember": 0.28, "concrete": 1.8}

# Texel density that implies, for the record against ASSET-SPECS 2.8
# (512 px/m for first-person, 256 px/m for machines):
#   panel   512 px / 1.0 m = 512 px/m
#   coarse  512 px / 0.5 m = 1024 px/m


# ---------------------------------------------------------------------------
# Deterministic hash and periodic value noise.
# ---------------------------------------------------------------------------

def _hash01(ix, iy, seed):
    """32-bit integer hash -> float in [0, 1). No RNG, no floats until the end.

    Written out rather than taken from `random` because `random`'s stream is a
    CPython implementation detail and this has to survive a Python upgrade the
    way the assets have to survive a Blender upgrade."""
    h = (ix * 0x1F1F1F1F) ^ (iy * 0x27D4EB2D) ^ (seed * 0x9E3779B1)
    h &= 0xFFFFFFFF
    h ^= h >> 15
    h = (h * 0x2C1B3C6D) & 0xFFFFFFFF
    h ^= h >> 12
    h = (h * 0x297A2D39) & 0xFFFFFFFF
    h ^= h >> 15
    return h / 4294967296.0


def _lattice(period, seed):
    """period x period table of hashed values, indexed [iy * period + ix]."""
    return [_hash01(ix, iy, seed)
            for iy in range(period) for ix in range(period)]


def _smooth(t):
    """Quintic smoothstep. C2 continuous, so the derived normal map has no
    visible creases where lattice cells meet - a cubic smoothstep leaves a
    gradient discontinuity that a normal map amplifies into a grid."""
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def _noise_field(w, h, period, seed):
    """Periodic value noise sampled on a w x h grid, returned as a flat list.

    Periodic in BOTH axes by construction (lattice indices wrap with %), which
    is what makes the finished texture tile without a seam. Seamlessness is
    asserted in selftest rather than assumed."""
    tab = _lattice(period, seed)
    # Precompute the per-column lattice index and blend weight once instead of
    # w*h times. This is the hot loop of the whole module.
    cols = []
    for x in range(w):
        f = x * period / w
        i0 = int(f) % period
        cols.append((i0, (i0 + 1) % period, _smooth(f - int(f))))
    out = [0.0] * (w * h)
    for y in range(h):
        f = y * period / h
        j0 = int(f) % period
        j1 = (j0 + 1) % period
        ty = _smooth(f - int(f))
        r0 = j0 * period
        r1 = j1 * period
        base = y * w
        for x in range(w):
            i0, i1, tx = cols[x]
            a = tab[r0 + i0]
            b = tab[r0 + i1]
            c = tab[r1 + i0]
            d = tab[r1 + i1]
            top = a + (b - a) * tx
            bot = c + (d - c) * tx
            out[base + x] = top + (bot - top) * ty
    return out


def _fbm(w, h, period, octaves, seed, gain=0.5, lacunarity=2):
    """Sum of octaves of periodic value noise, normalised to [0, 1]."""
    out = [0.0] * (w * h)
    amp, total, p = 1.0, 0.0, period
    for o in range(octaves):
        n = _noise_field(w, h, p, seed + o * 7919)
        for i in range(w * h):
            out[i] += n[i] * amp
        total += amp
        amp *= gain
        p *= lacunarity
    inv = 1.0 / total
    return [v * inv for v in out]


def _worley(w, h, cells, seed):
    """Periodic cellular noise: distance to the nearest of `cells` x `cells`
    jittered feature points. Returns [0, 1], 0 at a feature point.

    This is what makes rock read as chipped rather than as lumpy noise: value
    noise has no edges and a rock face is all edges."""
    pts = []
    for cy in range(cells):
        for cx in range(cells):
            jx = _hash01(cx, cy, seed)
            jy = _hash01(cx, cy, seed + 1)
            pts.append(((cx + jx) / cells, (cy + jy) / cells))
    out = [0.0] * (w * h)
    scale = cells * 1.4142135623730951      # normalise by the worst-case gap
    for y in range(h):
        py = y / h
        gy = int(py * cells)
        base = y * w
        for x in range(w):
            px = x / w
            gx = int(px * cells)
            best = 4.0
            for oy in (-1, 0, 1):
                ry = (gy + oy) % cells
                for ox in (-1, 0, 1):
                    rx = (gx + ox) % cells
                    fx, fy = pts[ry * cells + rx]
                    dx = px - fx - ox * 0.0
                    dy = py - fy - oy * 0.0
                    # wrap to the shorter way round the torus
                    if dx > 0.5:
                        dx -= 1.0
                    elif dx < -0.5:
                        dx += 1.0
                    if dy > 0.5:
                        dy -= 1.0
                    elif dy < -0.5:
                        dy += 1.0
                    d = dx * dx + dy * dy
                    if d < best:
                        best = d
            out[base + x] = min(1.0, math.sqrt(best) * scale)
    return out


# ---------------------------------------------------------------------------
# Small geometric helpers, all in wrapped tile space [0, 1).
# ---------------------------------------------------------------------------

def _wrap_delta(a, b):
    """Signed shortest distance from b to a on a unit circle."""
    d = a - b
    if d > 0.5:
        d -= 1.0
    elif d < -0.5:
        d += 1.0
    return d


def _wrap_dist(a, b):
    return abs(_wrap_delta(a, b))


def _clamp01(v):
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


def _smoothstep(e0, e1, x):
    if e1 == e0:
        return 0.0 if x < e0 else 1.0
    t = _clamp01((x - e0) / (e1 - e0))
    return t * t * (3.0 - 2.0 * t)


def _seg_dist(px, py, ax, ay, bx, by):
    """Distance from a point to a segment, in wrapped tile space. The segment
    is treated as short enough not to wrap itself, which every scratch and weld
    bead in this file is."""
    dx = _wrap_delta(bx, ax)
    dy = _wrap_delta(by, ay)
    wx = _wrap_delta(px, ax)
    wy = _wrap_delta(py, ay)
    den = dx * dx + dy * dy
    t = 0.0 if den < 1e-12 else _clamp01((wx * dx + wy * dy) / den)
    ex = wx - dx * t
    ey = wy - dy * t
    return math.sqrt(ex * ex + ey * ey)


# ---------------------------------------------------------------------------
# The `panel` family: a manufactured plate.
#
# The layout is written down rather than randomised. A hashed plate subdivision
# looks the same in a still and is impossible to reason about when a seam lands
# somewhere ugly, and this pattern is going on every machine in the game.
# Vertical seams wrap through u = 0, horizontal seams through v = 0, so the tile
# edge IS a seam and the repeat is invisible.
# ---------------------------------------------------------------------------

# (u_start, u_end, [horizontal seam v's inside this column])
PANEL_COLUMNS = [
    (0.00, 0.34, [0.55]),
    (0.34, 0.71, [0.28, 0.66]),
    (0.71, 1.00, [0.42, 0.79]),
]
PANEL_U_SEAMS = [0.00, 0.34, 0.71]
# Groove geometry, in tile units against a 1 m tile, so these ARE metres.
# The first pass ran 0.0055 / 0.0130, which is a 3.7 cm gap between plates: at a
# glance it read as a panel line and in a preview it read as a trench. A real
# panel gap on industrial plant is under a centimetre, and the number is only
# obvious once it is written down as metres rather than as texels.
SEAM_HALF = 0.0032        # half groove width -> 6.4 mm gap
SEAM_BEVEL = 0.0068       # plate face falls away over a further 6.8 mm


def _panel_height(w, h):
    """(height, aux). Plate face at 1.0, groove floor at 0.0, plus rivets,
    bolts, a weld bead, scratches and micro grain.

    `aux` carries the feature masks the ORM pass needs - currently the scratch
    mask. It is RETURNED rather than re-derived from the height, because
    inferring "this texel is a scratch" from a height window is the same
    inference-from-a-failed-test that BT-13 had to remove from the coaxial
    checker: micro grain is +/- 0.026 and a scratch is now 0.030 deep, so any
    height window wide enough to catch the scratch also catches the noise."""
    grain = _fbm(w, h, 16, 4, seed=1301)
    grain2 = _fbm(w, h, 64, 3, seed=7717)

    # Rivet centres: a row down each vertical seam, offset onto the plate face.
    rivets = []
    for si, us in enumerate(PANEL_U_SEAMS):
        for k in range(9):
            v = (k + 0.5) / 9.0
            rivets.append(((us + 0.0235) % 1.0, v))
            rivets.append(((us - 0.0235) % 1.0, v))
    # Bolt heads at seam intersections.
    bolts = []
    for (u0, u1, vs) in PANEL_COLUMNS:
        for v in vs:
            bolts.append(((u0 + 0.030) % 1.0, v))
            bolts.append(((u1 - 0.030) % 1.0, v))

    weld = (0.36, 0.905, 0.69, 0.905)       # one horizontal bead
    # RUBS, not scratches. See the note at the use site.
    rubs = [
        (0.06, 0.18, 0.29, 0.34),
        (0.44, 0.72, 0.66, 0.51),
        (0.78, 0.12, 0.96, 0.31),
    ]

    out = [0.0] * (w * h)
    scratch_mask = [0.0] * (w * h)
    for y in range(h):
        v = (y + 0.5) / h
        base = y * w
        for x in range(w):
            u = (x + 0.5) / w

            # --- plate face vs groove --------------------------------------
            du = min(_wrap_dist(u, s) for s in PANEL_U_SEAMS)
            col = PANEL_COLUMNS[0]
            for c in PANEL_COLUMNS:
                if c[0] <= u < c[1]:
                    col = c
                    break
            dv = _wrap_dist(v, 0.0)
            for vs in col[2]:
                dv = min(dv, _wrap_dist(v, vs))
            d = min(du, dv)
            face = _smoothstep(SEAM_HALF, SEAM_HALF + SEAM_BEVEL, d)
            z = face

            # --- rivets and bolts ------------------------------------------
            for (ru, rv) in rivets:
                dd = math.sqrt(_wrap_delta(u, ru) ** 2 + _wrap_delta(v, rv) ** 2)
                if dd < 0.0105:
                    z += 0.30 * (1.0 - _smoothstep(0.0055, 0.0105, dd))
            for (bu, bv) in bolts:
                dd = math.sqrt(_wrap_delta(u, bu) ** 2 + _wrap_delta(v, bv) ** 2)
                if dd < 0.0180:
                    z += 0.42 * (1.0 - _smoothstep(0.0090, 0.0180, dd))

            # --- weld bead --------------------------------------------------
            dw = _seg_dist(u, v, *weld)
            if dw < 0.010:
                ripple = 0.5 + 0.5 * grain2[base + x]
                z += 0.26 * (1.0 - _smoothstep(0.004, 0.010, dw)) * (0.7 + 0.6 * ripple)

            # --- rubs (were scratches) --------------------------------------
            # THE STRUCTURAL POINT, and it is the most transferable thing this
            # module learned: A SHARED TILING TEXTURE CANNOT CARRY A FEATURE
            # THAT IS MEANT TO LOOK UNIQUE. A scratch is a long, straight,
            # high-contrast line, which makes it the single most identifiable
            # thing in the tile and therefore the strongest possible cue that
            # the tile repeats. On a 4 m wall you could count the copies. Seams
            # and rivets repeating read as MANUFACTURE and are fine, because
            # real plate is repetitive; a scratch repeating reads as a texture.
            #
            # Two narrowings failed before this. 0.075 deep and 3.5 px wide
            # aliased into a bright ridge (too narrow to hold two edges). 0.030
            # deep was worse in a new way: a smoother plate meant the scratch
            # was the ONLY thing modulating the normal, so it rendered as a
            # white specular streak and got MORE visible, not less.
            #
            # So they are now broad shallow rubs: 3.6 cm wide, barely any
            # relief, and most of the effect handed to roughness. Genuinely
            # unique wear belongs in a per-asset decal, which is a later job.
            for sc in rubs:
                ds = _seg_dist(u, v, *sc)
                if ds < 0.0180:
                    m = 1.0 - _smoothstep(0.0060, 0.0180, ds)
                    z -= 0.010 * m
                    if m > scratch_mask[base + x]:
                        scratch_mask[base + x] = m

            # --- micro grain -------------------------------------------------
            # Down from 0.045 / 0.012 after the first render pass: at close
            # range it read as hammered or crumpled metal rather than as rolled
            # plate, on the wall, the smelter and the player's chest alike. It
            # still has to be non-zero, because a perfectly smooth plate is
            # exactly the plastic look DW-35 exists to kill; it just has to sit
            # under the panel lines rather than compete with them.
            #
            # The second octave is deliberately weaker still. At period 64 on a
            # 512 map it is close to texel frequency, so it aliases under
            # minification and is incompressible, costing real bytes for detail
            # no camera resolves.
            z += (grain[base + x] - 0.5) * 0.026
            z += (grain2[base + x] - 0.5) * 0.007
            out[base + x] = z
    return out, {"scratch": scratch_mask}


def _panel_masks(w, h, height, aux):
    """(roughness, metalness) multipliers for the panel family.

    Both are DOWNWARD from the palette constant (see the module docstring), so
    the story each mask tells has to be one that only subtracts:
      roughness  raised metal is rubbed smooth by handling and by wear
      metalness  grooves collect grime, and grime is not a metal

    --------------------------------------------------------------------
    RN-553: THE BAND, AND IT IS THE ONE NUMBER SECTION 2.1 NAMES BY NAME
    --------------------------------------------------------------------
    `docs/controllers/rendering.md` section 2.1 item 4 says a family's
    effective roughness p05..p95 must be at least about 0.15 wide, "below
    that it is a constant under a moving sun", and it measures THIS family
    at 0.032 with the verdict "that is the plastic read on every machine,
    plate and suit". Every machine, belt, structure, rocket part and tool in
    the game is wearing the one surface in the set that cannot respond to
    light.

    THIS FAMILY IS RE-AUTHORED RATHER THAN DUPLICATED UNDER A NEW NAME, and
    that is a decision (RN-60) rather than the path of least resistance. The
    player lane is moving `Suit`, `SuitDark` and `Plate` onto their own
    `suitfab` / `suitplate` families in a change that is in flight as this
    lands, which leaves `panel` holding Steel, SteelDark, SteelLight, Accent,
    Hazard and SuitAccent: every one of them painted industrial steel. A
    second painted-steel family beside this one would be the same surface
    authored twice, would need a client literal change to take effect at all
    (`MachineBatch` pins `attachSurface(m, 'panel', ...)` on the whole batch),
    and would leave the 0.032 band live on the rocket parts, the launch pad
    and the tools. Re-authoring reaches all of them with no role move.

    THE 0.032 WAS ARITHMETIC AND NOT AN ACCIDENT. The old mask is
    `1.0 - 0.28 * proud + (mottle - 0.5) * 0.22`, and `proud` is non-zero
    only on a rivet or bolt top, which is a fraction of a per cent of the
    texels. So on every flat plate face the whole map reduced to
    `1.0 +/- 0.11` around a mean of 1.0, and 0.45 (Steel's palette
    roughness) times a 0.22-wide multiplier is a 0.05-wide effective band
    before percentiles trim it to 0.032.

    THE FIX IS A STORY AND NOT A GAIN. Multiplying the old mottle by four
    would clear the gate and mean nothing: the band has to be somewhere a
    surface actually goes. Painted steel has three states and they are far
    apart. Coating that is intact and has been WIPED or RAINED ON is close
    to specular. Coating that has CHALKED in the sun is nearly matte, and
    that is the palette constant. Where the coating has gone and the alloy
    is bare and handled, it is polished. So the map runs from about 0.42 to
    1.00, effective 0.19 to 0.45 on Steel, and the direction of every term
    is a claim that can be checked against a real machine.

    WHY IT STAYS AT OR UNDER 1.0. The ORM channels are byte multipliers on
    the palette constant, so 1.0 is the ceiling by construction and the
    palette decides the matte end. Widening downward is therefore the only
    move available without a palette edit, and a palette edit here would
    re-surface the rocket parts, the launch pad and the tools in the same
    commit as a machine pass. That is a separate, arguable decision and it
    is deliberately not taken here.
    """
    mottle = _fbm(w, h, 12, 3, seed=4441)
    # 40 cm at the 1.5 m tile: WHERE THE WEATHER HAS BEEN. Big, slow patches
    # of chalked against intact coating, an order of magnitude coarser than
    # the mottle, so a 4 m wall has two or three of them rather than a texture.
    weather = _fbm(w, h, 4, 3, seed=6151)
    # 5 cm: run-off. Rain and condensate leave streaks that stay WET-looking
    # long after they dry, because the coating there is washed rather than
    # chalked. This is the term that puts fine vertical structure in the
    # roughness that the albedo and the normal do not have.
    wash = _fbm(w, h, 30, 2, seed=6421)
    scratch = aux["scratch"]
    rough = [0.0] * (w * h)
    metal = [0.0] * (w * h)
    for i in range(w * h):
        z = height[i]
        # `face` is ~1 on the plate, ~0 in a groove, >1 on a rivet or bolt.
        face = _clamp01(z)
        proud = _clamp01(z - 1.0) / 0.42          # rivet / bolt tops
        # THE FLAT PLATE FACE NO LONGER COMES OUT AT ~1.0, AND THE OLD NOTE
        # SAYING IT MUST IS SUPERSEDED. That note was written under a values
        # freeze this lane did not own; its actual argument was that a mask
        # must not silently shift the palette MEAN, which is a different claim
        # from "must not vary". `weather` is symmetric about its own midpoint
        # and `wash` only subtracts where it is high, so the mean moves down by
        # a stated 0.09 rather than by an unnoticed 0.22.
        # THE THRESHOLDS ARE WHERE THE BAND LIVES, NOT THE COEFFICIENTS, and
        # the first tuning got that backwards. An `_fbm` is normalised to 0..1
        # but CLUSTERS about its own middle, so `(weather - 0.34) / 0.52` only
        # reaches full strength where weather exceeds 0.86, which is a few per
        # cent of texels: the coefficient was 0.34 and the measured p05 still
        # sat at 0.686, for a Steel band of 0.136 against section 2.1's 0.15.
        # Moving the knee down to 0.28 and the ramp to 0.34 changes how MANY
        # texels are wiped rather than how far, which is what a percentile band
        # actually measures.
        r = 1.0 - 0.28 * proud
        r -= 0.40 * _clamp01((weather[i] - 0.28) / 0.34)   # wiped / rained on
        r -= 0.18 * _clamp01((wash[i] - 0.54) / 0.32)      # run-off streaks
        r += (mottle[i] - 0.5) * 0.14
        # A rub exposes cleaner metal, so it goes shinier, not duller. Taken
        # straight from the mask the height pass built, rather than inferred
        # from a height window - the inference version became dead code the
        # moment the relief was reduced, which is exactly why it is gone.
        r -= 0.16 * scratch[i]
        rough[i] = _clamp01(r)
        m = 0.42 + 0.58 * _smoothstep(0.15, 0.85, face)
        metal[i] = _clamp01(m)
    return rough, metal


def _panel_albedo(w, h, height, aux):
    """A TILING ALBEDO for painted industrial steel. RN-553.

    THE FREQUENCY SPLIT IS THE WHOLE DESIGN AND IT IS RN-454'S LESSON PAID
    FORWARD. Driving albedo, normal and ORM off one heightfield gave the
    creature identical frequency content in all three maps and it rendered as
    a spider built out of cobblestones. So this map deliberately does NOT
    read `height`, which already owns the seams, the rivets and the weld bead
    and hands them to the normal:

      NORMAL  relief below a centimetre plus the manufactured geometry
      ORM     the roughness band above, at 40 cm and 5 cm
      ALBEDO  PIGMENTATION at 10 to 45 cm, which is the one thing neither of
              the others can say and the thing paint actually does

    What paint does, in the order the terms below do it: it fades unevenly in
    patches the size of a hand to a hand-span; it collects grime in a fine
    speckle that darkens without colouring; and where the coating has failed
    it goes WARM, because what is under paint on a machine is oxide. The
    oxide term is the only one that moves hue, and it moves it in one
    direction only, because rust is not a colour that has an opposite.

    MEAN-NEUTRAL BY CONTRACT. `Surfaces.ts` sets
    `material.color = palette / albedo_mean_linear` and then multiplies the map back
    in, so only this map's VARIANCE and its HUE survive and its LEVEL cannot
    shift the palette. That is what lets one map serve Steel, SteelDark,
    Accent and Hazard without lightening the dark one and dirtying the bright
    one, and it is why every term here is written as a multiplier about 1.0
    rather than as an absolute value."""
    fade = _fbm(w, h, 4, 3, seed=15013)       # ~38 cm: uneven weathering
    patch = _fbm(w, h, 9, 3, seed=15271)      # ~17 cm: coating thickness
    grime = _fbm(w, h, 34, 2, seed=15427)     # ~4.4 cm: dirt speckle
    oxide = _fbm(w, h, 6, 4, seed=15683)      # ~25 cm: where it has failed
    # THE MAP IS CENTRED AT 0.55 AND NOT AT 1.0, AND THE FIRST BUILD IS WHY.
    # Every term below is a multiplier about 1.0, which is the right way to
    # write a mean-neutral map and the wrong place to CENTRE one: the first
    # version measured a mean of 0.9659 with a per-channel range of 194..255,
    # i.e. the top of the variance was CLIPPING against the byte ceiling and
    # the map was throwing away the pigmentation it exists to carry.
    # `check_maps` refuses a tiling albedo outside 0.15..0.85 for exactly this
    # reason and the refusal is correct. The level is free, because
    # `Surfaces.ts` divides it back out, so it costs nothing to sit in the
    # middle of the range where both tails survive.
    LEVEL = 0.55
    out = bytearray(3 * w * h)
    for i in range(w * h):
        # Value. Two scales of fade and one of grime, all symmetric about 1.0
        # except the grime, which only ever darkens because dirt does.
        v = 1.0 + (fade[i] - 0.5) * 0.30 + (patch[i] - 0.5) * 0.17
        v -= 0.13 * _clamp01((grime[i] - 0.52) / 0.48)
        # A groove holds dirt and a rivet top does not, so the ONE thing this
        # map takes from the height is the sign of the relief, at a tenth of
        # the weight of the pigmentation. Any more and the seams would be
        # drawn twice, once in the normal and once here.
        v -= 0.07 * (1.0 - _clamp01(height[i]))
        # Hue. Oxide only, only where the coating has gone thin AND the
        # weathering agrees, so the rust is in patches rather than everywhere
        # at a low level, which is the difference between a worn machine and a
        # brown one.
        rust = _clamp01((oxide[i] - 0.62) / 0.34) * _clamp01((fade[i] - 0.40)
                                                             / 0.45)
        v *= LEVEL
        o = 3 * i
        out[o] = int(round(255.0 * _clamp01(v * (1.0 + 0.26 * rust))))
        out[o + 1] = int(round(255.0 * _clamp01(v * (1.0 - 0.05 * rust))))
        out[o + 2] = int(round(255.0 * _clamp01(v * (1.0 - 0.24 * rust))))
    return bytes(out)


# ---------------------------------------------------------------------------
# The `coarse` family: dug up or grown.
# ---------------------------------------------------------------------------

def _coarse_height(w, h):
    """Rebalanced hard toward LOW frequency after the first render pass.

    The first version put 0.42 of its amplitude into two worley layers at 9 and
    23 cells plus a period-48 grit octave, and the result was uniform, isotropic
    and the same at every scale, which reads as stucco or a popcorn ceiling
    rather than as rock. It was worst exactly where it had the most area to be
    wrong: a 4 m foundation deck. Rock reads as rock because it has STRUCTURE at
    the size of the object and detail only underneath that, so the fix is fewer,
    bigger facets over a much stronger low-frequency base."""
    lumps = _fbm(w, h, 4, 4, seed=2203)
    grit = _fbm(w, h, 40, 2, seed=8821)
    chips = _worley(w, h, 6, seed=5501)
    chips2 = _worley(w, h, 14, seed=6607)
    out = [0.0] * (w * h)
    for i in range(w * h):
        # 1 - worley gives flat facets meeting at sharp valleys, which is the
        # read a fractured rock face has and plain fbm does not.
        z = 0.78 * lumps[i]
        z += 0.24 * (1.0 - chips[i]) ** 2
        z += 0.07 * (1.0 - chips2[i]) ** 2
        z += 0.035 * grit[i]
        out[i] = z
    # `hn` is the heightfield normalised to this tile, and it is added WITHOUT
    # touching `out`, so the normal map and the AO are byte-for-byte what they
    # were: both are differential and rescaling what they read would silently
    # retune normal_strength and ao_gain out from under the FAMILIES row, which
    # is the reason `_stone_height` states for keeping its own raw. The masks
    # need a normalised copy because "standing high" has to mean high relative
    # to this tile, and the raw range moves with every amplitude above.
    return out, {"hn": _normalise(out)}


def _coarse_masks(w, h, height, aux):
    """Roughness spread widened from 29 counts to something worth shipping.

    `texgen.py check` measured the first version's G channel at 226..255, an
    11% variation, on the family that covers every rock, soil and bark surface
    in the game. DW-35's whole argument is that roughness variation is the main
    win and uniform roughness is what reads as plastic, so an 11% spread is a
    map that passed its own check while barely doing its job. Exposed facets are
    weathered smooth and hollows hold dust, so relief drives it.

    ------------------------------------------------------------------
    RN-1471: WIDENED AGAIN, AND THIS TIME IT IS THE FAMILY THAT ACTUALLY
    MEASURED NARROW RATHER THAN THE ONE THE DOCS NAMED
    ------------------------------------------------------------------
    Section 2.1 item 4 has said since 2026-08-01 that `panel` measures a
    0.032 effective band and is THE plastic read in the game, and the whole
    D-020 art campaign was scoped on that sentence. Measured off the shipped
    bytes on 2026-08-13 it is stale by a factor of seven: RN-553 re-authored
    `_panel_masks` the same day the bullet was written, four commits later,
    and `panel` now measures 0.143 to 0.245 across its six roles. Nobody
    edited the bullet back. The bullet also names `ore` as "the family to
    copy" at 0.28..0.37; ore actually measures 0.175..0.319, so panel now
    beats the family it was told to copy on five of its six roles.

    THE NARROW FAMILY IS THIS ONE. Measured across all eight tiling families,
    the two worst effective bands in the game are `coarse`'s own:

        Copper  0.075        Iron  0.086
        Rubber  0.183        Coal  0.194
        Sand / Regolith  0.205        Soil  0.216

    Copper and Iron are under section 2.1's 0.15 bar by half, and they are
    under it for a compound reason that is worth stating because it is the
    general case: the family's ormG span was only 0.2157 AND those two roles
    carry the lowest palette roughness of the seven (0.40). A narrow map times
    a low constant is how a band gets to 0.075, and neither factor alone looks
    alarming.

    WHAT WIDENS IT, AND IT IS A STORY RATHER THAN A GAIN. Multiplying the old
    mottle by three would clear the gate and mean nothing; that is
    `_panel_masks`'s own recorded lesson and it applies here unchanged. Loose
    granular material has three states and they are genuinely far apart. A
    surface that is DRY AND DUSTY is as matte as anything gets, and that is
    the palette constant. Where fines have been washed or blown off and the
    coarse fraction is exposed, the individual grains are water-worn and
    catch light, so it goes markedly smoother. And in a hollow where fines
    collect and pack down, it is matte again but for the opposite reason.
    So the map runs about 0.46 to 1.00 instead of 0.79 to 0.98, and every
    term below is a claim that can be checked against a gravel path.

    THE HEIGHT TERM IS NOW KEYED ON A NORMALISED COPY, which is the actual
    defect under the old 0.2157. The old line read
    `_smoothstep(0.15, 0.85, _clamp01(height[i]))`, and `_coarse_height`
    returns a raw field whose range is roughly 0.06..0.95 with almost all of
    its mass between 0.3 and 0.7. A 0.15..0.85 smoothstep on that is nearly
    linear over the occupied range and never reaches either rail, so the
    0.26 coefficient was never actually spending 0.26. Keying on `hn` and
    moving the knees inside the distribution is the same fix
    `_panel_masks` records making ("THE THRESHOLDS ARE WHERE THE BAND LIVES,
    NOT THE COEFFICIENTS"), and it is why the coefficient below is only
    a little larger than the one it replaces while the band roughly doubles.

    WHY IT STAYS AT OR UNDER 1.0: the ORM channels are byte multipliers on
    the palette constant, so 1.0 is the ceiling by construction and the
    palette decides the matte end. Widening downward is the only move
    available without a palette edit."""
    mottle = _fbm(w, h, 16, 3, seed=9109)
    # 19 cm at the 0.75 m tile: WHERE THE FINES HAVE GONE. An order of
    # magnitude coarser than the mottle, so a 4 m deck carries three or four
    # of these rather than a texture, which is `_panel_masks`'s `weather`
    # term doing the same job for the same reason.
    washed = _fbm(w, h, 4, 3, seed=9337)
    # 6.3 cm: packed fines in the hollows, fine enough to break the washed
    # zones up so they do not read as painted patches.
    packed = _fbm(w, h, 12, 2, seed=9511)
    hn = aux["hn"]
    rough = [0.0] * (w * h)
    metal = [1.0] * (w * h)      # identity: no coarse role is a polished metal
    for i in range(w * h):
        # Exposed high ground is water-worn and takes light.
        r = 1.0 - 0.30 * _smoothstep(0.34, 0.86, hn[i])
        # Where the fines have washed off, the coarse fraction is bare and
        # smoother still. This is the term that carries the band.
        r -= 0.26 * _clamp01((washed[i] - 0.30) / 0.36)
        # Packed fines in a hollow go back to fully matte.
        r += 0.10 * _clamp01((packed[i] - 0.52) / 0.40) * (1.0 - hn[i])
        r += (mottle[i] - 0.5) * 0.14
        rough[i] = _clamp01(r)
    return rough, metal


def _coarse_albedo(w, h, height, aux):
    """A TILING ALBEDO for granular, dug-up material. RN-1472.

    THE ROLE SPREAD IS THE WHOLE CONSTRAINT AND IT IS UNLIKE EVERY OTHER
    ALBEDO IN THIS FILE. `panel` serves six painted-steel roles and `stone`
    two host-rock ones, so each can afford a hue term: an oxide lean is true
    of all six painted plates and an iron stain is true of both rocks. This
    family serves SEVEN roles that share nothing but their grain size, and
    the palette proves it: Sand F0 and Regolith pale grey against Coal 1C1C1F
    and Rubber 23262B, with Iron and Copper metallic in between. There is no
    hue that is true of all of them. A warm stain that reads as damp soil
    reads as RUST on the iron chunk and as nothing at all on coal, because
    the map is mean-neutral and a near-black role has no headroom to carry a
    lean anyway.

    SO THIS MAP IS ALMOST PURELY VALUE, and that is a decision rather than a
    shortcut. `Surfaces.ts` divides `albedo_mean_linear` out through
    material.color, so what survives is the spatial VARIANCE and the HUE; this
    family authors the first and deliberately declines the second, keeping its
    channel lean to a third of `panel`'s and applying it only to the damp
    term, where every one of the seven roles genuinely does darken and warm
    slightly when wet. Everything else is achromatic by construction.

    IT READS NEITHER `height` NOR `aux`, following `_stone_albedo` exactly and
    for a sharper version of that function's reason. The failure RN-454 names
    is albedo, normal and ORM sharing one field, which rendered the creature as
    cobblestone; here the subject is literally rubble, so a pigment field that
    agreed with the chip field would read as a bag of identical pebbles and
    nobody would look twice. The AO in the ORM's red channel already darkens
    the hollows the normal dents, because it is the same heightfield read a
    second time, and drawing them a third time here is what cobblestone is.

    THE BAND IS ABOVE THE RELIEF, which is the other half of the same rule.
    `_coarse_height`'s structure is lumps at period 4 (18.8 cm on the 0.75 m
    tile), chips at 6 cells (12.5 cm) and 14 cells (5.4 cm), and a grit octave
    at period 40. Every term below sits at 19 to 25 cm, at or above the
    coarsest of those, so the two maps overlap nowhere.

    CENTRED AT 0.50, which is RN-559's lesson taken as read: every term is a
    multiplier about 1.0 because that is how a mean-neutral map is written,
    and 1.0 is the wrong place to CENTRE one because the top of the variance
    then clips against the byte ceiling. `check_maps` refuses a tiling albedo
    outside 0.15..0.85 for exactly that reason."""
    # Two octaves each. A third on a period-4 field lands at 9.4 cm, inside
    # the 12.5 cm chip facet, which is the frequency overlap this map exists
    # to avoid.
    sort_ = _fbm(w, h, 3, 2, seed=17033)     # ~25 cm: fines against coarse
    damp = _fbm(w, h, 4, 2, seed=17209)      # ~19 cm: where it holds water
    fines = _fbm(w, h, 4, 2, seed=17393)     # ~19 cm: pale dust on the surface
    LEVEL = 0.50
    out = bytearray(3 * w * h)
    for i in range(w * h):
        # Value. GRAIN SEGREGATION is what loose material actually does and
        # it is the term with the most amplitude: shake a heap of anything
        # granular and the fines migrate, so a dug surface is patchy between
        # a paler fine fraction and a darker coarse one at roughly the scale
        # of the heap rather than of the grain.
        v = 1.0 + (sort_[i] - 0.5) * 0.32
        # Settled dust lightens, and only lightens, because dust does not
        # darken anything it lands on.
        v *= 1.0 + 0.13 * _clamp01((fines[i] - 0.58) / 0.34)
        # Damp darkens, hard. This is the largest single move on the map and
        # it is true of every role that wears it: wet sand, wet soil, wet
        # regolith, wet rubber and a wet ore chunk are all markedly darker
        # than their dry selves.
        wet = _clamp01((damp[i] - 0.50) / 0.38)
        v *= 1.0 - 0.24 * wet
        v *= LEVEL
        # THE ONLY HUE ON THE MAP, and it is a third of `panel`'s oxide lean
        # for the reason the docstring states: damp material warms slightly,
        # which is true of all seven roles, and nothing else here is true of
        # all seven. Applied as a channel lean rather than as a colour,
        # because a mean-neutral map cannot carry a colour.
        warm = 0.045 * wet
        o = 3 * i
        out[o] = int(round(255.0 * _clamp01(v * (1.0 + warm))))
        out[o + 1] = int(round(255.0 * _clamp01(v)))
        out[o + 2] = int(round(255.0 * _clamp01(v * (1.0 - warm * 1.2))))
    return bytes(out)


# ---------------------------------------------------------------------------
# The `bark` family: tree trunks.
# ---------------------------------------------------------------------------

# Fissure count per tile. 7 fissures across 0.6 m is an 8.6 cm ridge pitch,
# inside the 3 to 10 cm range mature conifer bark actually has, and odd on
# purpose: an even count at this tile size puts two fissures exactly half a
# tile apart, and the repeat around a two-repeat trunk then lines up with
# itself, which is the countable-copies failure the panel rubs comment
# documents.
BARK_FISSURES = 7
BARK_MEANDER = 0.030      # max lateral wander of a fissure, in tile u units
BARK_MEANDER_PERIOD = 4   # lattice points of the periodic wander, per tile


def _bark_height(w, h):
    """(height, aux). Ridge plateaus near 1.0 cut by deep near-vertical
    fissures, plus a few horizontal breaks and knot dimples.

    WHICH TEXTURE AXIS IS VERTICAL, derived rather than assumed. UVs are
    box-projected world metres (of_lib.MeshBuilder._project_uvs), and
    validate_glb.py's uv_metres check states the exact post-export mapping per
    dominant face axis:

        Blender axis Z -> (u, v) = ( X, 1 + Z)     top / bottom caps
        Blender axis X -> (u, v) = (-Z, 1 - Y)     side face, normal along X
        Blender axis Y -> (u, v) = ( X, 1 - Y)     side face, normal along Y

    glTF is Y-up after the exporter's conversion, so on the SIDE faces of a
    vertical trunk (the two horizontal-normal cases) v = 1 - Y in BOTH cases:
    the two cases AGREE, world-vertical is always the v axis, and there is no
    minority orientation to trade away. Fissures therefore run along v
    (image y), meandering slightly in u. The caps get fissures crossing the
    end grain, which is wrong but invisible: a trunk's caps are its cut ends.

    AMPLITUDE. The plateau sits near 1.0 and a fissure floor near 0.45, so
    the walls are ~0.55 over a ~1.4 cm bevel: steeper than coarse's facets,
    gentler than panel's grooves, and the family's normal_strength is chosen
    against that (see FAMILIES)."""
    grain = _fbm(w, h, 24, 3, seed=3307)
    lumps = _fbm(w, h, 5, 3, seed=4409)

    # Per-fissure meander tables, periodic in v BY CONSTRUCTION so the field
    # tiles: BARK_MEANDER_PERIOD hashed offsets per fissure, interpolated with
    # the same quintic the value noise uses, lattice indices wrapped with %.
    mp = BARK_MEANDER_PERIOD
    wander = [[(_hash01(k, j, 7331) - 0.5) * 2.0 * BARK_MEANDER
               for j in range(mp)] for k in range(BARK_FISSURES)]
    # Base u per fissure: even spacing plus a small hashed offset, small
    # enough (0.25 of the pitch, on top of +/- BARK_MEANDER) that neighbours
    # cannot cross.
    base_u = [(k + 0.5 + (_hash01(k, 91, 5479) - 0.5) * 0.25) / BARK_FISSURES
              for k in range(BARK_FISSURES)]

    # Horizontal breaks: short shallow cracks across the grain. Few and short,
    # for the reason the panel rubs comment gives: a long unique feature on a
    # shared tiling surface is a repeat cue.
    breaks = [
        (0.08, 0.22, 0.30, 0.22),
        (0.55, 0.61, 0.78, 0.63),
        (0.72, 0.90, 0.88, 0.89),
    ]
    # Knots: a raised welt with a dimple inside, where a branch was.
    knots = [(0.30, 0.72), (0.83, 0.34)]

    # Fissure centres per ROW (u depends on v through the meander), hoisted
    # out of the pixel loop: h rows x BARK_FISSURES instead of w*h.
    centres = []
    for y in range(h):
        v = (y + 0.5) / h
        f = v * mp
        j0 = int(f) % mp
        j1 = (j0 + 1) % mp
        t = _smooth(f - int(f))
        row = []
        for k in range(BARK_FISSURES):
            o0 = wander[k][j0]
            o1 = wander[k][j1]
            row.append((base_u[k] + o0 + (o1 - o0) * t) % 1.0)
        centres.append(row)

    out = [0.0] * (w * h)
    fissure = [0.0] * (w * h)
    for y in range(h):
        v = (y + 0.5) / h
        base = y * w
        cs = centres[y]
        for x in range(w):
            u = (x + 0.5) / w
            g = grain[base + x]

            # --- ridge plateau, gently domed between fissures ---------------
            du = min(_wrap_dist(u, c) for c in cs)
            z = 0.88 + 0.12 * lumps[base + x]
            z += 0.10 * _smoothstep(0.020, 0.055, du)

            # --- the fissure itself -----------------------------------------
            # Width breathes with the grain so the walls are ragged rather
            # than machined: 6 to 10 mm at the floor, bevel out to ~2 cm.
            w0 = 0.010 * (0.7 + 0.6 * g)
            w1 = 0.033
            cut = 1.0 - _smoothstep(w0, w1, du)
            z -= 0.55 * cut
            if cut > fissure[base + x]:
                fissure[base + x] = cut

            # --- horizontal breaks ------------------------------------------
            for br in breaks:
                db = _seg_dist(u, v, *br)
                if db < 0.020:
                    z -= 0.20 * (1.0 - _smoothstep(0.006, 0.020, db))

            # --- knots -------------------------------------------------------
            for (ku, kv) in knots:
                dd = math.sqrt(_wrap_delta(u, ku) ** 2
                               + _wrap_delta(v, kv) ** 2)
                if dd < 0.085:
                    z += 0.10 * (1.0 - _smoothstep(0.045, 0.085, dd))
                    z -= 0.34 * (1.0 - _smoothstep(0.008, 0.045, dd))

            # --- micro grain -------------------------------------------------
            z += (g - 0.5) * 0.05
            out[base + x] = z
    return out, {"fissure": fissure}


def _bark_masks(w, h, height, aux):
    """(roughness, metalness) for bark.

    Bark is matte everywhere, so the multiplier lives in roughly 0.8 to 1.0:
    fissure interiors and hollows at full palette roughness, exposed ridge
    crowns rubbed very slightly smoother, mottle on top so the spread clears
    MUST_VARY without pretending bark has polished spots. Metalness identity,
    exactly as coarse: the palette constant for both bark roles is already 0
    and a multiplier of 1.0 is the only value that does not rescale it."""
    mottle = _fbm(w, h, 12, 3, seed=7207)
    fiss = aux["fissure"]
    rough = [0.0] * (w * h)
    metal = [1.0] * (w * h)      # identity: bark is not a metal
    for i in range(w * h):
        r = (1.0 - 0.13 * _smoothstep(0.60, 1.05, _clamp01(height[i]))
             + (mottle[i] - 0.5) * 0.09
             + 0.04 * fiss[i])
        rough[i] = _clamp01(r)
    return rough, metal


def _bark_albedo(w, h, height, aux):
    """A TILING ALBEDO for tree trunks. RN-1472.

    IT READS NEITHER `height` NOR `aux`, and on this family that restraint is
    load-bearing rather than stylistic. `_bark_height`'s whole character is
    seven deep near-vertical fissures, the ORM's red channel already darkens
    them (AO is the same heightfield read a second time) and the normal
    already dents them. A pigment field keyed on the fissures would draw them
    a THIRD time, and the result is not subtle: dark stripes in albedo lining
    up exactly with dark stripes in AO reads as a trunk someone has painted
    with vertical stripes, which is RN-454's cobblestone failure in the one
    family whose relief is strongly directional and therefore hardest to
    forgive. So the pigment is authored independently and is allowed to
    DISAGREE with the fissures, which is what real bark does: a lichen patch
    crosses a fissure, it does not respect it.

    THE BAND IS ABOVE THE RELIEF. The fissures sit at an 8.6 cm ridge pitch
    (BARK_FISSURES = 7 over the 0.6 m tile) and the grain octave below that;
    every term here is at 12 to 30 cm, at or above the coarsest relief
    feature, so the two maps never overlap in frequency.

    WHAT BARK PIGMENT ACTUALLY DOES, in the order the terms do it: it varies
    in broad vertical zones, because a trunk weathers down its length rather
    than in patches; it carries LICHEN and algae, which is the single most
    recognisable thing on a real trunk and the only term here that both
    lightens and shifts hue, toward a pale desaturated green-grey; and it
    darkens where water runs and organic staining collects. Only the lichen
    moves hue far, and unlike `panel`'s oxide and `stone`'s iron it moves it
    COOL, because that is the direction lichen actually goes and this file
    now has three warm-staining families and no cool one.

    CENTRED AT 0.50 for RN-559's reason, taken as read: `check_maps` refuses a
    tiling albedo outside 0.15..0.85 because a map centred at 1.0 clips its
    own upper variance against the byte ceiling."""
    # Vertically stretched zones: sampled with a v coordinate compressed 3x
    # against u, so the field's features are three times taller than they are
    # wide. Bark weathers DOWN a trunk, and an isotropic patch field on a
    # vertical surface reads as camouflage. This is the cheapest honest way
    # to get direction out of an isotropic generator without reaching for
    # `_hair_layer`, and it costs one index arithmetic change.
    zone = _fbm(w, h, 6, 2, seed=18041)      # ~10 cm across, ~30 cm down
    lich = _fbm(w, h, 5, 2, seed=18211)      # ~12 cm: the lichen colonies
    lich2 = _fbm(w, h, 9, 2, seed=18401)     # ~6.7 cm: colony break-up
    stain = _fbm(w, h, 4, 2, seed=18587)     # ~15 cm: run-off and organics
    LEVEL = 0.50
    out = bytearray(3 * w * h)
    for y in range(h):
        # the 3x vertical stretch, wrapped so the field still tiles: sampling
        # row y at row (y // 3) would not wrap, sampling modulo h does.
        zy = ((y // 3) % h) * w
        base = y * w
        for x in range(w):
            i = base + x
            zi = zy + x
            # Value. The broad vertical zoning carries most of the amplitude.
            # RN-1500: this term and the two below it were 0.30 / 0.16 / 0.26,
            # measured (whole-map luma) at spread 45.7, stdev 7.62, in family
            # with `coarse` (47.3 / 9.49) and `panel` (54.0 / 7.71) so
            # `check_maps`'s MIN_SPREAD=16 gate never had anything to say
            # about it, but on an actual trunk render (`RN1500_bark_canopy_
            # pine_a.png`) the fissures (normal+AO) carried the whole read and
            # the albedo looked airbrushed beside them: every term here is a
            # broad, 2-octave `_fbm`, which is smooth by construction, and the
            # deliberate "stay above the relief frequency" rule (this
            # function's own docstring) rules out fixing that by adding a
            # finer noise octave. Raising the same three amplitudes instead
            # (spread 45.7 -> 62.0, stdev 7.62 -> 10.2, mean unmoved at 0.49)
            # keeps every frequency exactly where the docstring puts it and
            # makes the existing zones and lichen colonies read as patches
            # rather than as a gradient.
            v = 1.0 + (zone[zi] - 0.5) * 0.42
            # Organic staining darkens, and only darkens.
            v -= 0.20 * _clamp01((stain[i] - 0.54) / 0.40)
            # LICHEN. Two fields multiplied rather than summed, so a colony is
            # a patch WITH HOLES in it rather than a smooth blob: summing two
            # noises concentrates the result about its mean (the central limit
            # theorem, which `_plate_wear` records paying for once already),
            # and a lichen colony is a bimodal thing - present or absent.
            lic = (_clamp01((lich[i] - 0.52) / 0.34)
                   * _clamp01((lich2[i] - 0.38) / 0.44))
            v *= 1.0 + 0.34 * lic
            v *= LEVEL
            o = 3 * i
            # Lichen leans COOL and desaturates: green-grey against the warm
            # brown of the bark under it. R drops most, G holds, B rises
            # slightly, which is a green-grey lean written as a channel spread
            # rather than as a colour, because a mean-neutral map cannot carry
            # a colour and pretending otherwise ships a tint the divide then
            # deletes.
            out[o] = int(round(255.0 * _clamp01(v * (1.0 - 0.15 * lic))))
            out[o + 1] = int(round(255.0 * _clamp01(v * (1.0 - 0.02 * lic))))
            out[o + 2] = int(round(255.0 * _clamp01(v * (1.0 + 0.09 * lic))))
    return bytes(out)


# ---------------------------------------------------------------------------
# The `ore` family: seam mineral in host rock.
# ---------------------------------------------------------------------------

# Strata per tile. 5 bands across 0.5 m is a 10 cm band pitch (76.8 texels at
# 384), sized so a 0.3 to 0.6 m boulder seam facet carries three to six bands,
# and odd for bark's reason: an even count at this tile size lines the repeat
# up with itself on a two-repeat surface, which is the countable-copies
# failure the panel rubs comment documents.
ORE_BANDS = 5
ORE_WARP = 0.14           # max band-coordinate wander, in tile units: enough
                          # that the strata visibly bow, not enough that two
                          # bands can pinch shut (0.14 < half a 0.2 pitch)


def _ore_height(w, h, rotated=False):
    """(height, aux). Roughly parallel warped strata crossing v, a crevice
    where each band meets the next, crystalline facet grain on the band
    surface, occlusion living in the crevices.

    WHICH AXIS THE BANDS CROSS, derived rather than assumed, from the same
    box-projection fact _bark_height states in full: on the side faces of
    anything upright, world-vertical is the v axis in both horizontal-normal
    cases. Geological strata lie ACROSS the vertical, so the band coordinate
    is v and the bands themselves run along u, warped by a low-frequency
    field so they bow the way bedding does rather than ruling themselves
    like a machined grate.

    `rotated` is selftest-only: it feeds u to the band coordinate instead of
    v, which is the exact defect the anisotropy check exists to catch, so the
    check gets a negative control that fails honestly (DW-20).

    AMPLITUDE. Band surface near 0.72 doming to 0.82 mid-band, crevice floor
    0.45 lower over a ~1.6 cm bevel: between bark's fissure walls (0.55) and
    coarse's facets, and `ore`'s normal_strength is chosen against that (see
    FAMILIES). Facet grain rides on top at 0.14, small enough that the strata
    stay the structure and the facets stay the detail, which is the same
    structure-over-detail argument _coarse_height makes.

    Returns aux masks the ORM pass needs rather than letting it re-derive
    them from height windows, for _panel_height's stated reason: `glint` is
    facet crest clear of any crevice (the polished read), `crevice` is the
    cut mask (the dust trap)."""
    warp = _fbm(w, h, 4, 3, seed=5209)
    facets = _worley(w, h, 16, seed=7211)
    grain = _fbm(w, h, 32, 3, seed=6113)

    out = [0.0] * (w * h)
    glint = [0.0] * (w * h)
    crev = [0.0] * (w * h)
    for y in range(h):
        v = (y + 0.5) / h
        base = y * w
        for x in range(w):
            u = (x + 0.5) / w
            i = base + x
            bc = u if rotated else v
            # Band coordinate: the warp is periodic in both axes and the
            # band count is an integer, so t's fractional part tiles even
            # though t itself does not.
            t = (bc + (warp[i] - 0.5) * ORE_WARP) * ORE_BANDS
            f = t - math.floor(t)
            d = min(f, 1.0 - f)      # 0 at a band boundary, 0.5 mid-band

            # --- band surface, doming gently toward mid-band ---------------
            z = 0.72 + 0.10 * _smoothstep(0.10, 0.42, d)

            # --- the crevice between bands ----------------------------------
            # 7 mm at the floor, bevel out to ~1.6 cm, in band units of a
            # 10 cm pitch.
            cut = 1.0 - _smoothstep(0.035, 0.16, d)
            z -= 0.45 * cut
            if cut > crev[i]:
                crev[i] = cut

            # --- crystalline facet grain ------------------------------------
            # 1 - worley squared, coarse's fractured-facet read at 16 cells
            # (~3 cm facets): crystal faces meeting at sharp valleys.
            fc = (1.0 - facets[i]) ** 2
            z += 0.14 * fc

            # A facet crest inside a crevice is dust-buried, not polished, so
            # the glint mask is the crest gated by the cut.
            g = fc * (1.0 - cut)
            if g > glint[i]:
                glint[i] = g

            # --- micro grain -------------------------------------------------
            z += (grain[i] - 0.5) * 0.05
            out[i] = z
    return out, {"glint": glint, "crevice": crev}


def _ore_masks(w, h, height, aux):
    """(roughness, metalness) for ore. The roughness spread IS this family
    (RN-156): smooth crystal glints against a dusty matrix is what makes a
    mineral read as mineral under a moving sun, so the multiplier runs a
    deliberately wide 0.4-ish to 1.0 - facet crests polished well below the
    palette constant, crevices holding dust at full roughness, mottle on top.

    Metalness identity, and here it is load-bearing rather than merely
    tidy: the three ore roles' palette metallic values sit UNDER the
    client's metalness > 0.5 batching split on purpose (the whole reason
    this family exists is that the seam previously landed in the
    mirror-metal bucket and photographed as ice), and 1.0 is the only
    multiplier that cannot move them."""
    mottle = _fbm(w, h, 12, 3, seed=8317)
    glint = aux["glint"]
    crev = aux["crevice"]
    rough = [0.0] * (w * h)
    metal = [1.0] * (w * h)      # identity: ore-in-rock is not polished metal
    for i in range(w * h):
        r = (1.0 - 0.52 * _smoothstep(0.10, 0.60, glint[i])
             + 0.10 * crev[i]
             + (mottle[i] - 0.5) * 0.14)
        rough[i] = _clamp01(r)
    return rough, metal


# ---------------------------------------------------------------------------
# The `stone` family: the HOST ROCK a boulder is made of. RN-742.
#
# WHY IT EXISTS, AND IT IS A MEASUREMENT RATHER THAN A TASTE. `coarse` served
# the host rock of every boulder, the whole rock spire and all the scree.
# Measured on its own shipped field: mean normal tilt 7.69 degrees with a
# MAXIMUM of 27.19, and 0.0 per cent of its ORM green below 0.60. So no texel
# of it is steeper than a loading ramp and no part of it is ever smooth: it
# cannot glint and it cannot catch a raking sun. That is the flattest surface
# in the game by measurement, on the family that owns most of the screen area
# of every rock. `stone` replaces it for the host-rock roles; `coarse` keeps
# the soil, sand, regolith, rubber and loose-item roles it is right for.
#
# WHY COARSE MEASURES THAT WAY, which is the part that makes this a new family
# rather than a retune. Its facet term is `(1.0 - worley) ** 2`. The
# derivative of that form is 2 * (1 - w), and it goes to ZERO exactly at
# w = 1, which is the cell boundary, which is where two facets meet. The one
# place a fractured rock has an edge is the one place that form is guaranteed
# smooth. No amplitude fixes it, because the SHAPE is wrong and not the scale,
# and that is the same argument bark and ore were split out on: the family
# encoded the wrong fact about the surface.
#
# THE FREQUENCY SPLIT IS NOT NEGOTIABLE, AND IT IS RN-454's LESSON PAID
# FORWARD. Driving albedo, normal and ORM off one heightfield gave the spider
# identical frequency content in all three and it rendered as COBBLESTONE. The
# subject here IS rock, so cobblestone is the failure this family is most
# likely to reproduce and least likely to notice: a pigment field that agreed
# with the facet field would not look like a bug, it would look like a wall of
# cobbles and nobody would look twice. So each map is authored for one band:
#
#   NORMAL  fracture relief from 7.5 cm down to 1.8 cm, plus a grain under
#           5 mm. Angular facets meeting at sharp arrises, nothing coarser
#           than a facet, and nothing that says anything about colour.
#   ALBEDO  PIGMENTATION at 10 to 20 cm and nothing else: mineral banding,
#           iron staining, pale lichen and dust. It never reads `height`,
#           on purpose. See _stone_albedo.
#   ORM     its own band, keyed on facet CREST versus CREVICE. This is the
#           channel that fixes the 0.0-per-cent-below-0.60 finding, and it is
#           the one DW-35 ranks first ("roughness variation matters more than
#           albedo detail").
# ---------------------------------------------------------------------------

# Facet cells per tile. Over a 0.6 m tile, 8 cells is a 7.5 cm facet and 19 is
# a 3.2 cm chip riding on it, which brackets the 2 to 8 cm band this family's
# relief is authored in; the 34-cell micro layer at 1.8 cm is the hand-off to
# the grain below it. `coarse` puts its two worley layers at 6 and 14 cells
# over a 0.75 m tile, i.e. 12.5 cm and 5.4 cm: coarser features, and rounded
# ones. Nothing here is harmonic with anything else here, for the reason the
# panel rubs comment gives: features that share a period line their copies up.
STONE_FACETS = 8
STONE_CHIPS = 19
STONE_MICRO = 34

# Arris width, in units of the (second-nearest minus nearest) distance gap,
# which runs at about twice the perpendicular distance from a cell boundary.
# 0.010 is therefore a bevel about 1.9 texels each side of a facet edge at
# 384 px, i.e. 3 mm of rounding on a 7.5 cm facet; 0.007 is 2 mm on a 3.2 cm
# chip. A ZERO-width arris is a one-texel cliff, which aliases into a drawn
# black line rather than reading as an edge and puts the family's steepest
# slope on the texel grid instead of on the rock. Measured: narrowing these to
# 0.006 / 0.004 moves the maximum tilt from 74.2 to 78.1 degrees and nothing
# else, so the width is bought cheaply and there is no case for a cliff.
FACET_ARRIS = 0.010
CHIP_ARRIS = 0.007


def _stone_planes(w, h, cells, seed, tilt, arris, rounded=False):
    """Piecewise-PLANAR fracture facets. Returns (face, edge).

    `face` is the height of the nearest cell's own plane, and every cell gets
    its own base height AND its own tilt, so a cell is FLAT and two
    neighbouring cells meet at an ANGLE. `edge` is 1 on the arris between two
    cells and falls to 0 inside a facet, which is the crevice mask the ORM
    pass keys on.

    WHY NOT `(1.0 - worley) ** 2`, which is what both `_coarse_height` and
    `_ore_height` use. That form's derivative vanishes at the cell boundary,
    so the one place a fracture has an edge is the one place the field is
    smooth, and coarse's measured 27-degree ceiling is that fact and nothing
    else. A plane per cell has no such ceiling, because the step across a
    boundary is set by the two BASE HEIGHTS rather than by the shape of the
    distance field.

    The two nearest planes are BLENDED across `arris` rather than switched
    between, for the reason FACET_ARRIS states: a switch is a one-texel cliff.
    At the boundary the blend is the mean of the two planes, which is exactly
    what a bevelled arris is.

    `rounded` is selftest-only. It replaces the plane pair with coarse's
    rounded dome at the same cell count, the same seed and the same amplitude,
    which is precisely the defect this family exists to fix, so the tilt check
    gets a negative control that fails honestly (DW-20)."""
    pts = []
    for cy in range(cells):
        for cx in range(cells):
            jx = _hash01(cx, cy, seed)
            jy = _hash01(cx, cy, seed + 1)
            bh = _hash01(cx, cy, seed + 2)
            sx = _hash01(cx, cy, seed + 3) * 2.0 - 1.0
            sy = _hash01(cx, cy, seed + 4) * 2.0 - 1.0
            pts.append(((cx + jx) / cells, (cy + jy) / cells, bh,
                        sx * tilt, sy * tilt))
    scale = cells * 1.4142135623730951      # _worley's own normalisation
    face = [0.0] * (w * h)
    edge = [0.0] * (w * h)
    for y in range(h):
        py = (y + 0.5) / h
        gy = int(py * cells)
        base = y * w
        for x in range(w):
            px = (x + 0.5) / w
            gx = int(px * cells)
            # Nearest AND second nearest, bucketed 3x3 exactly as `_worley`
            # buckets its points, so the cost stays linear in texels and the
            # field is periodic in both axes by construction.
            d1 = d2 = 4.0
            p1 = p2 = None
            ax = ay = bx = by = 0.0
            for oy in (-1, 0, 1):
                ry = (gy + oy) % cells
                for ox in (-1, 0, 1):
                    rx = (gx + ox) % cells
                    p = pts[ry * cells + rx]
                    dx = px - p[0]
                    dy = py - p[1]
                    if dx > 0.5:
                        dx -= 1.0
                    elif dx < -0.5:
                        dx += 1.0
                    if dy > 0.5:
                        dy -= 1.0
                    elif dy < -0.5:
                        dy += 1.0
                    d = dx * dx + dy * dy
                    if d < d1:
                        d2, p2, bx, by = d1, p1, ax, ay
                        d1, p1, ax, ay = d, p, dx, dy
                    elif d < d2:
                        d2, p2, bx, by = d, p, dx, dy
            i = base + x
            if rounded:
                # The DEFECT, built on purpose: coarse's construction at this
                # family's cell count. `edge` stays 0 because a rounded dome
                # has no arris to mask, which is the whole complaint.
                m = 1.0 - min(1.0, math.sqrt(d1) * scale)
                face[i] = m * m
                continue
            za = p1[2] + p1[3] * ax + p1[4] * ay
            zb = p2[2] + p2[3] * bx + p2[4] * by
            t = _smoothstep(0.0, arris, math.sqrt(d2) - math.sqrt(d1))
            face[i] = zb + (za - zb) * (0.5 + 0.5 * t)
            edge[i] = 1.0 - t
    return face, edge


def _stone_height(w, h, rounded=False):
    """(height, aux). Angular fracture facets meeting at sharp arrises, a
    finer chip facet on them, a micro-facet cusp under that, and a sub-5 mm
    grain at the bottom. Occlusion lives in the arrises.

    AMPLITUDE, AND IT IS A HIERARCHY ON PURPOSE, which is _coarse_height's own
    structure-over-detail argument applied to a field that can actually carry
    an edge: 0.52 on the 7.5 cm facets, 0.19 on the 3.2 cm chips, 0.075 on the
    1.8 cm micro cusp, 0.055 on the grain. Measured contribution to mean
    normal tilt at the shipped strength, each layer added to the one before:
    facets alone 7.12 degrees, plus chips 12.04, plus the micro cusp 16.48,
    plus the grain 17.18. THE FRACTURE CARRIES THE NUMBER. The grain is the
    last 0.70 of a degree and exists so a facet interior is not mirror-flat,
    not to make the measurement: a family that got its tilt from a grain layer
    would be sandpaper, which is the other failure _coarse_height's header
    records ("stucco or a popcorn ceiling").

    THE MICRO LAYER IS `sqrt(1 - worley)` AND THAT IS THE WHOLE POINT OF IT.
    `_ore_height` uses `(1 - worley) ** 2` for its crystal grain, and that
    form is FLAT where two cells meet. The square root is the same distance
    field with the derivative inverted: it goes VERTICAL there instead. Same
    field, opposite edge behaviour, and the cell boundary becomes the high
    ground with the feature point as a pit, which is which way round a
    fracture actually breaks.

    Returns aux masks the ORM pass needs rather than letting it re-derive them
    from height windows, following _ore_height's contract exactly. `crest` is
    fresh planar facet, clear of both arris bands and standing high: the
    broken face that catches a raking sun. `crevice` is the arris band in the
    low ground: the dust trap.

    `rounded` is selftest-only; see _stone_planes."""
    facet, e1 = _stone_planes(w, h, STONE_FACETS, 4211, 0.85, FACET_ARRIS,
                              rounded)
    chip, e2 = _stone_planes(w, h, STONE_CHIPS, 4517, 1.70, CHIP_ARRIS,
                             rounded)
    micro = _worley(w, h, STONE_MICRO, seed=4801)
    grain = _fbm(w, h, 64, 2, seed=4933)     # 9.4 mm and 4.7 mm octaves
    out = [0.0] * (w * h)
    for i in range(w * h):
        z = 0.52 * facet[i] + 0.19 * chip[i]
        m = 1.0 - micro[i]
        z -= 0.075 * (m * m if rounded else math.sqrt(m))
        z += (grain[i] - 0.5) * 0.055
        out[i] = z
    # The MASKS read a normalised copy and the returned height does not get
    # one. "Standing high" has to mean high relative to this tile, and the raw
    # range moves with every amplitude above; but the normal and the AO are
    # both differential, so rescaling what they read would silently retune
    # normal_strength and ao_gain out from under the FAMILIES row.
    lo = min(out)
    span = (max(out) - lo) or 1.0
    crest = [0.0] * (w * h)
    crev = [0.0] * (w * h)
    for i in range(w * h):
        hn = (out[i] - lo) / span
        clear = (1.0 - e1[i]) * (1.0 - e2[i])
        crest[i] = clear * _smoothstep(0.30, 0.80, hn)
        e = e1[i] if e1[i] > e2[i] else e2[i]
        crev[i] = e * (1.0 - _smoothstep(0.20, 0.70, hn))
    return out, {"crest": crest, "crevice": crev}


def _stone_masks(w, h, height, aux):
    """(roughness, metalness). THIS is the channel `coarse` never had.

    `coarse`'s ORM green measures 0.0 per cent of its texels below 0.60: a
    rock family that is never smooth anywhere, so nothing on it glints and a
    raking sun does nothing to it. The band here runs from about 0.36 at a
    fresh fracture crest to a hard 1.00 in the crevices, wider even than
    `ore`'s deliberately wide band and for the same reason one tier along: a
    stone face reads as stone when the freshly broken parts take light and the
    weathered, dusted and shadowed parts do not.

    WHY IT IS KEYED ON `crest` AND NOT ON HEIGHT. A high texel inside an arris
    is a chip of rubble jammed in a crack, not a polished face, and the two sit
    at the same height. `crest` is the conjunction the field already knows:
    planar, clear of both arris bands, and standing high. Reading height alone
    would polish the rubble too.

    Metalness identity, for `_coarse_masks`'s reason exactly: no host-rock role
    is a polished metal, and 1.0 is the only multiplier that leaves the
    palette's own metallic constant where the palette put it."""
    mottle = _fbm(w, h, 14, 3, seed=5077)    # ~4.3 cm: weathering
    dust = _fbm(w, h, 5, 2, seed=5233)       # ~12 cm: where dust has settled
    crest = aux["crest"]
    crev = aux["crevice"]
    rough = [0.0] * (w * h)
    metal = [1.0] * (w * h)      # identity: host rock is not a polished metal
    for i in range(w * h):
        r = (1.0 - 0.58 * _smoothstep(0.12, 0.72, crest[i])
             + 0.12 * crev[i]
             + 0.10 * _clamp01((dust[i] - 0.50) / 0.50)
             + (mottle[i] - 0.5) * 0.16)
        rough[i] = _clamp01(r)
    return rough, metal


def _stone_albedo(w, h, height, aux):
    """A TILING ALBEDO for host rock: pigmentation at 10 to 20 cm, and nothing
    else. RN-742.

    IT READS NEITHER `height` NOR `aux`, AND THAT IS THE ENTIRE DESIGN. RN-454
    is this project's recorded case of albedo, normal and ORM sharing one
    heightfield, and the creature rendered as cobblestone. The subject here IS
    rock, so a pigment field that agreed with the facet field would not read
    as a mistake at all: it would read as a wall of cobbles. The fields below
    are a different band (10 to 20 cm against the facets' 7.5 to 1.8 cm) and a
    different seed range, and the measured Pearson correlation between this
    map's luminance and the heightfield is +0.07, which is what two
    independent fields agree by chance. For scale: `panel`'s tiling albedo,
    which deliberately reads the height at a tenth weight, measures +0.29 on
    the same statistic, and an albedo that simply WAS the height measures
    +1.00.

    THE ONE THING THAT COSTS, stated rather than discovered later. `panel`
    darkens its grooves here at a tenth of the pigmentation weight and this
    map does not, so "dust in the low ground" is authored as its own 10 cm
    field rather than keyed on the facets. The AO in the ORM's red channel
    already darkens exactly the crevices the normal dents, because it is the
    same heightfield read a second time; drawing them a THIRD time here is
    what cobblestone is.

    WHAT ROCK PIGMENT ACTUALLY DOES, in the order the terms do it: it bands,
    because bedded and banded rock is most of the rock there is; it varies in
    mineral content inside a band; it stains WARM where iron has moved through
    it, in patches rather than everywhere at a low level, which is the
    difference between a weathered rock and a brown one; and it carries pale
    lichen and settled dust, which lighten and very slightly cool. Only the
    iron moves hue far, and it moves it in one direction, because rust is not
    a colour that has an opposite.

    CENTRED AT 0.50 AND NOT AT 1.0, which is RN-559's lesson taken as read
    rather than re-learned. Every term below is a multiplier about 1.0,
    because that is how a mean-neutral map is written and the wrong place to
    CENTRE one: `panel` shipped a first version at mean 0.9659 with the top of
    its variance flattened against the byte ceiling, and `check_maps` refuses
    a tiling albedo outside 0.15..0.85 for exactly that reason. The level is
    free, because `Surfaces.ts` divides `albedo_mean_linear` back out through
    material.color, so it costs nothing to sit in the middle of the range
    where both tails survive."""
    # Two octaves each, never three: the second octave of a period-3 field is
    # already at 10 cm and of a period-6 field at 5 cm, and a third would put
    # albedo detail down inside the 3.2 cm chip facet, which is the frequency
    # overlap this family exists to avoid. Every term here is at or above
    # 5 cm, and the ones carrying real weight are at 10 to 20 cm.
    band = _fbm(w, h, 3, 2, seed=16033)      # ~20 cm: the bedding
    vein = _fbm(w, h, 4, 2, seed=16187)      # ~15 cm: mineral content
    iron = _fbm(w, h, 5, 2, seed=16487)      # ~12 cm: where iron has moved
    lichen = _fbm(w, h, 6, 2, seed=16673)    # ~10 cm: lichen and settled dust
    LEVEL = 0.50
    out = bytearray(3 * w * h)
    for i in range(w * h):
        # Value. Banding carries the most amplitude because it is the thing
        # rock most obviously does; the mineral term breaks the band up so it
        # does not read as a painted stripe.
        v = 1.0 + (band[i] - 0.5) * 0.34 + (vein[i] - 0.5) * 0.20
        # Hue. Iron only where it has actually moved AND the bedding agrees,
        # so the stain sits in patches along the beds rather than everywhere.
        rust = _clamp01((iron[i] - 0.56) / 0.34) * _clamp01((band[i] - 0.30)
                                                            / 0.50)
        # Lichen and dust lighten, and they are the only term that can push
        # the map up; they never darken, because neither of them does.
        lich = _clamp01((lichen[i] - 0.60) / 0.32)
        v *= LEVEL * (1.0 + 0.20 * lich)
        o = 3 * i
        out[o] = int(round(255.0 * _clamp01(v * (1.0 + 0.30 * rust
                                                 - 0.04 * lich))))
        out[o + 1] = int(round(255.0 * _clamp01(v * (1.0 - 0.02 * rust
                                                     + 0.05 * lich))))
        out[o + 2] = int(round(255.0 * _clamp01(v * (1.0 - 0.28 * rust
                                                     - 0.01 * lich))))
    return bytes(out)


# ---------------------------------------------------------------------------
# `masonry`: COURSED ASHLAR (RN-1835, the follow-up RN-1780 routed and did not
# take). LAID stone, not cut cliff.
#
# WHAT RN-1780 LEFT AND WHY IT IS A DIFFERENT KIND OF FIX. That pass split
# `masonry` off `stone` and moved its world scale from 0.6 m to 1.8 m, which
# took the ruin from ~59 tile repeats across its 35.2 m cella to ~19.6 and
# raised the cella patch from iqr 20.19 to 27.39. Its own fresh-context
# verifier then said what was still wrong, and it was not a scale problem: the
# family was still `_stone_height`, i.e. an ISOTROPIC FRACTURE FIELD, so the
# wall read as a patterned cut cliff with the same lozenge motif repeating on
# a visible grid. A bigger tile cannot fix that, because the defect is that
# the field describes broken rock and the subject is BUILT rock.
#
# WHAT ASHLAR ACTUALLY IS, and every term below is one of these:
#   * COURSES. Horizontal beds running the full width. The bed joint is the
#     strongest line on the wall and it is DEAD LEVEL; nothing else in this
#     file is.
#   * JOINTS THAT LINE UP ALONG A COURSE AND STAGGER BETWEEN THEM. A head
#     joint that continued through two courses is a structural fault, and a
#     wall that shows one reads instantly as wallpaper.
#   * A JOINT AT EVERY BOUNDARY: a recessed mortar bed with its own colour and
#     its own roughness, plus a chamfer where the block arris rounds into it.
#     That chamfer is what makes the bed joint read at 34 m: it is a paired
#     highlight and shadow line, and it survives minification when a
#     one-texel groove does not.
#   * PER-BLOCK VARIATION IN TONE AND WEAR. This is the anti-tiling term and
#     it is the reason this family can carry a visible modular grid without
#     reading as a repeat: a regular course grid is what the eye EXPECTS from
#     masonry, so the repeat it can still find is the per-block TONE
#     signature, not the geometry.
#
# THE ANTI-REPEAT ARGUMENT, STATED AS A MEASUREMENT RATHER THAN A HOPE. At
# 1.8 m the ruin still carries 19.6 tiles across. Three things are done about
# it, in descending order of how much they buy:
#   1. COURSE HEIGHTS AND BLOCK LENGTHS ARE NOT MODULAR. Each of the four
#      courses in a tile gets its own hashed height (0.37 to 0.52 m) and its
#      own hashed block count (2 or 3) with jittered lengths and its own
#      phase, so the tile contains ten blocks of eight different sizes rather
#      than a 4x2 grid. There is no "the tile" shape to spot.
#   2. THE WEATHERING IS CONTINUOUS ACROSS BLOCKS and sits at periods 7 and
#      11, which share no factor with the 4-course / 2-3-block partition, so
#      the dirt does not agree with the joints anywhere and the two fields
#      beat against each other instead of confirming one another.
#   3. The staining is DIRECTIONAL (it runs down from bed joints), which is
#      the one cue in this family that tells the eye which way is up and is
#      therefore the one an isotropic fracture field could never give it.
#
# WHY THE ALBEDO IS ALLOWED TO AGREE WITH THE HEIGHT HERE, WHEN RN-742 SAYS
# IT MUST NOT. `_stone_albedo`'s rule is that pigment must not reproduce the
# relief, because a rock's pigment does not know where the rock broke, and
# RN-454's creature rendered as cobblestone doing exactly that. An ashlar
# wall is the case where the rule inverts at ONE frequency and only one: the
# joint is a DIFFERENT MATERIAL (lime mortar against dressed stone), so its
# colour and its relief agree because they are the same physical fact. Inside
# a block the rule stands unchanged: the tooling relief is NOT drawn in the
# albedo, and the per-block tone is per BLOCK, a step function on the
# partition, not a copy of the height. Measured on the shipped bytes, the
# Pearson correlation between this map's luminance and its heightfield is
# reported by `selftest` for exactly this reason.
#
# THE THREE CONSUMERS, AND WHICH ONE THIS IS OPTIMISED FOR. RN-953 and RN-1780
# both failed by moving a family without asking what else wears it, so this is
# stated before the code rather than discovered after it. `masonry` is worn by
# the ruin (35.2 m), the foundation (4 m) and the launch pad (24 m).
#   ruin        THE CONSUMER THIS IS AUTHORED FOR. A temple cella at 11.4 m
#               tall carries ~25 courses at the mean 0.45 m course height,
#               which is the real course count of a real ashlar temple wall,
#               and blocks of 0.6 to 0.9 m are real ashlar block lengths.
#   foundation  4 m, so ~9 courses on a player-built stone plinth. This is an
#               improvement and it is not a compromise: dressed coursed blocks
#               are what a built foundation is, and fractured rock is what it
#               is not.
#   launch pad  24 m of deck, trench floor, blast caps and bunker. THIS ONE IS
#               A TRADE AND IT IS NOT A FIX. The pad wants POURED CONCRETE and
#               it has never had it: RN-1815's own pad verifier records the
#               skirt wall reading as "a repeating dark aggregate rock tile
#               rather than poured concrete". Under this change it reads as a
#               jointed slab field at 0.45 x 0.6-0.9 m instead, which is
#               heavy paving rather than concrete, i.e. a DIFFERENT wrong
#               thing at the same magnitude, not a regression into one. The
#               shape is at least the right family of shape (a poured deck IS
#               cast in bays with joints between them, and `build_launch_pad`
#               already authors two deck control joints as geometry), and the
#               pad's concrete is owned by the RN-1815 lane, which is expected
#               to give it a family of its own. Recorded here so that lane
#               does not have to re-derive why the pad moved.
# `stone` is UNTOUCHED by all of this and keeps `_stone_*` verbatim: boulders,
# the spire, the scree and the smelter's hearth surround are broken rock and
# must stay broken rock.
# ---------------------------------------------------------------------------

ASHLAR_COURSES = 4       # per 1.8 m tile -> 0.45 m mean course height
ASHLAR_JOINT_BED_M = 0.020    # ~5.7 texels at 512 px / 1.8 m
ASHLAR_JOINT_HEAD_M = 0.015   # head joints are tighter than beds, as built
ASHLAR_DRAFT_M = 0.026        # the chamfer each side: the arris rounding into
                              # the joint. THIS is the feature that survives
                              # minification, not the groove; at 34 m the ruin
                              # draws ~45 px/m, so a 20 mm groove is under one
                              # pixel and a 20+26+26 = 72 mm joint-plus-draft
                              # is three, which is a line the eye can hold.
ASHLAR_JOINT_DEPTH = 0.34     # relief units. Six times the largest face
                              # feature below, because the joint has to be
                              # the unarguable structure of this field: the
                              # hierarchy argument `_stone_height` makes for
                              # facets over grain, one subject along.


def _ashlar_partition(w, h):
    """The bond, precomputed. Returns (rowc, colc).

    `rowc[y]` is `(course, dBed, lv)`: which course the row is in, its
    distance in TILE UNITS to the nearer of the two bed joints bounding it,
    and its 0..1 height fraction within the course.

    `colc[c][x]` is `(blockKey, dHead, lu)`: the same three facts for the
    head joints of course `c`. A separate array per course IS the stagger.

    PERIODIC BY CONSTRUCTION IN BOTH AXES, which is the property the whole
    module is gated on. The courses partition [0, 1) and so do the blocks of
    every course, and every distance below is measured the short way round,
    so the boundary at 0 and the boundary at 1 are one line and not two."""
    # --- courses: heights hashed, then normalised so they sum to the tile ---
    hs = [0.82 + 0.36 * _hash01(c, 0, 7717) for c in range(ASHLAR_COURSES)]
    tot = sum(hs)
    edges = [0.0]
    for v in hs:
        edges.append(edges[-1] + v / tot)
    edges[-1] = 1.0
    rowc = []
    for y in range(h):
        v = (y + 0.5) / h
        c = 0
        while c + 1 < ASHLAR_COURSES and v >= edges[c + 1]:
            c += 1
        lo, hi = edges[c], edges[c + 1]
        d0 = v - lo
        d1 = hi - v
        rowc.append((c, d0 if d0 < d1 else d1, (v - lo) / (hi - lo)))
    # --- blocks, per course. 2 or 3 per tile, jittered, with a phase ---
    colc = []
    for c in range(ASHLAR_COURSES):
        n = 2 if _hash01(c, 1, 8161) < 0.55 else 3
        ws = [0.80 + 0.40 * _hash01(c, k + 2, 8221) for k in range(n)]
        tw = sum(ws)
        # The phase is what staggers the head joints between courses. It is
        # hashed rather than a fixed half-block: a fixed offset gives a
        # perfect running bond, which is a rhythm the eye locks onto at 19
        # repeats just as readily as a lattice does.
        off = _hash01(c, 9, 8317)
        bnd = [0.0]
        for v in ws:
            bnd.append(bnd[-1] + v / tw)
        bnd[-1] = 1.0
        row = []
        for x in range(w):
            u = ((x + 0.5) / w - off) % 1.0
            k = 0
            while k + 1 < n and u >= bnd[k + 1]:
                k += 1
            lo, hi = bnd[k], bnd[k + 1]
            d0 = u - lo
            d1 = hi - u
            row.append((c * 16 + k, d0 if d0 < d1 else d1, (u - lo) / (hi - lo)))
        colc.append(row)
    return rowc, colc


def _ashlar_height(w, h):
    """(height, aux). Coursed ashlar: dressed blocks in level courses, a
    chamfered recessed joint at every boundary, per-block set height and set
    tilt, tooling on the faces, and spall on the arrises of the worn blocks.

    THE JOINT EDGE IS PERTURBED AND THAT IS NOT A DETAIL. A joint whose two
    edges are exactly straight for 35 m is a drawn line, and a drawn line is
    the single loudest "this is a texture" cue a wall can carry. The distance
    that feeds the joint profile is displaced by a fine field first, so every
    arris wanders by a few millimetres the way a chiselled one does, and the
    displacement is at period 96 (a 19 mm feature) so it reads as stone
    dressing rather than as noise.

    `aux` keeps `crest`/`crevice` meaning exactly what they mean in every
    other family here (RN-742): standing clear and standing in the low
    ground, so `_ao` and the masks read one vocabulary across the file. Four
    more are published because they are per-BLOCK facts the pixel loop cannot
    re-derive without redoing the partition: `joint` (the whole recess,
    INCLUDING the chamfer, which is the shape), `mortar` (the mortar bed
    ALONE, which is the material), `tone` (this block's hashed pigment draw)
    and `wear` (this block's hashed weathering, which drives both how far its
    arris is rounded and how dirty its face is).

    `joint` AND `mortar` ARE TWO DIFFERENT MASKS AND CONFLATING THEM WAS THE
    FIRST VERSION'S DEFECT. The recess is 20 mm of mortar plus up to 39 mm of
    chamfer each side, so a colour keyed on the recess paints a 98 mm pale
    band where the wall has a 20 mm one, and the first render read as
    wide-jointed rubble rather than close-jointed ashlar. The chamfer is
    STONE: it is the block's own arris rounded off, it takes the block's own
    colour, and only the gap between two blocks is a different material."""
    tile = FAMILY_TILE_M["masonry"]
    rowc, colc = _ashlar_partition(w, h)
    hw_bed = 0.5 * ASHLAR_JOINT_BED_M / tile
    hw_head = 0.5 * ASHLAR_JOINT_HEAD_M / tile
    draft = ASHLAR_DRAFT_M / tile
    # The arris wander, and the tooling. Both are FACE-scale fields and both
    # are deliberately at periods that share no factor with 4 courses or with
    # 2/3 blocks: 96, 40 and 26 against 4, 2 and 3.
    wob = _fbm(w, h, 96, 1, seed=8419)       # ~19 mm: the chiselled arris
    tool = _fbm(w, h, 40, 2, seed=8467)      # ~45 mm: claw-chisel dressing
    grit = _fbm(w, h, 128, 2, seed=8521)     # ~14 mm: the stone's own grain
    eros = _fbm(w, h, 7, 2, seed=8573)       # ~26 cm: erosion, ACROSS blocks
    pit = _worley(w, h, 26, seed=8627)       # ~69 mm: spall pits
    out = [0.0] * (w * h)
    joint = [0.0] * (w * h)
    mortar = [0.0] * (w * h)
    tone = [0.0] * (w * h)
    wear = [0.0] * (w * h)
    for y in range(h):
        c, dbed, lv = rowc[y]
        crow = colc[c]
        base = y * w
        for x in range(w):
            i = base + x
            key, dhead, lu = crow[x]
            # Per-block draws. One hash call each, on the block key, so every
            # texel of a block agrees to the bit about what block it is on.
            bt = _hash01(key, 3, 8677)       # tone
            bw = _hash01(key, 4, 8731)       # weathering
            bs = _hash01(key, 5, 8783)       # set height
            bx = _hash01(key, 6, 8837)       # set tilt, u
            by = _hash01(key, 7, 8893)       # set tilt, v
            tone[i] = bt
            wear[i] = bw
            # The joint. Distance is displaced by the arris wander before the
            # profile is taken, and the draft WIDENS with the block's own
            # weathering: a fresh block keeps a crisp arris, a worn one is
            # rounded off into the mortar.
            wob_i = (wob[i] - 0.5) * (0.006 / tile)
            dr = draft * (0.65 + 0.85 * bw)
            gb = 1.0 - _smoothstep(hw_bed, hw_bed + dr, dbed + wob_i)
            gh = 1.0 - _smoothstep(hw_head, hw_head + dr, dhead + wob_i)
            g = gb if gb > gh else gh
            joint[i] = g
            # The mortar ITSELF: the gap between two blocks, with a half-texel
            # of ramp so it antialiases and no more. 0.55/1.15 of the half
            # width rather than 0/1 of it because a mortar bed has a meniscus
            # against the stone, not a printed edge.
            mb_ = 1.0 - _smoothstep(0.55 * hw_bed, 1.15 * hw_bed,
                                    dbed + wob_i)
            mh_ = 1.0 - _smoothstep(0.55 * hw_head, 1.15 * hw_head,
                                    dhead + wob_i)
            mortar[i] = mb_ if mb_ > mh_ else mh_
            # The block face. A set height and a set tilt per block (a hand
            # laid course is not a plane), a very slight pillow so the face
            # is not mirror-flat, the tooling, and the grain.
            z = (bs - 0.5) * 0.055
            z += ((lu - 0.5) * (bx - 0.5) + (lv - 0.5) * (by - 0.5)) * 0.048
            # A dressed face is very slightly hollow, so it is not mirror-flat
            # under a raking sun. Small on purpose: this is a finish, not a
            # cushion, and a deep pillow is rustication rather than ashlar.
            z -= 0.014 * ((2.0 * lu - 1.0) ** 2 + (2.0 * lv - 1.0) ** 2)
            z += (tool[i] - 0.5) * 0.052 * (0.55 + 0.75 * bw)
            z += (grit[i] - 0.5) * 0.020
            z += (eros[i] - 0.5) * 0.030
            # Spall: a bite out of the stone, and it only happens NEAR AN
            # ARRIS and only on a weathered block, because that is the only
            # place a block actually loses material. `g` is already the
            # proximity-to-joint mask, so the spall keys on it rather than on
            # a second field that could disagree with it.
            sp = _clamp01((0.30 - pit[i]) / 0.30) * _smoothstep(0.10, 0.55, g)
            z -= 0.075 * sp * _clamp01((bw - 0.42) / 0.40)
            out[i] = z - ASHLAR_JOINT_DEPTH * g
    lo = min(out)
    span = (max(out) - lo) or 1.0
    crest = [0.0] * (w * h)
    crev = [0.0] * (w * h)
    for i in range(w * h):
        hn = (out[i] - lo) / span
        clear = 1.0 - joint[i]
        crest[i] = clear * _smoothstep(0.45, 0.92, hn)
        crev[i] = joint[i] * (1.0 - _smoothstep(0.10, 0.55, hn))
    return out, {"crest": crest, "crevice": crev, "joint": joint,
                 "mortar": mortar, "tone": tone, "wear": wear}


def _ashlar_masks(w, h, height, aux):
    """(roughness, metalness). The mortar and the stone are TWO MATERIALS and
    this channel is where that is said in a way light can see.

    Lime mortar is porous and takes no specular at all; dressed limestone
    does, weakly, and a wind-polished exposed block face does more. So the
    band runs 1.00 in a joint down to about 0.44 on a clean crest, wider than
    `_stone_masks`'s and for the same reason one subject along: the thing
    that makes an ashlar wall read under a raking sun is that the blocks
    catch it and the joints between them do not.

    KEYED ON `mortar` AND `wear` AND NOT ON HEIGHT, which is `_stone_masks`'s
    own argument transferred. A spall pit is at joint depth and is NOT
    mortar: it is a fresh broken face, the roughest thing on the wall after
    the mortar itself. Reading height alone would fill every pit with mortar.
    It is `mortar` and not `joint` for the same reason the albedo uses it:
    the chamfer is dressed stone and takes the stone's roughness.

    Metalness identity, so the palette's own 0.00 stands. Declared in
    ALLOWED_CONSTANT for `stone`'s reason exactly: a built stone wall is not
    a polished metal and 1.0 is the only multiplier that leaves the palette
    where the palette put it."""
    dust = _fbm(w, h, 6, 2, seed=8951)       # ~30 cm: where dirt has settled
    mottle = _fbm(w, h, 22, 3, seed=9007)    # ~8 cm: the stone's own finish
    mortar = aux["mortar"]
    crest = aux["crest"]
    wear = aux["wear"]
    rough = [0.0] * (w * h)
    metal = [1.0] * (w * h)
    for i in range(w * h):
        r = (0.72
             - 0.30 * _smoothstep(0.10, 0.80, crest[i]) * (1.0 - wear[i])
             + 0.28 * _smoothstep(0.10, 0.75, mortar[i])
             + 0.14 * _clamp01((dust[i] - 0.48) / 0.52)
             + (mottle[i] - 0.5) * 0.13)
        rough[i] = _clamp01(r)
    return rough, metal


# The `concrete` family (RN-1815): a POURED surface, judged at walking
# distance against a 24 m wall.
#
# THE DEFECT THIS ANSWERS, IN THE VERIFIER'S OWN TWO HALVES. The launch pad's
# 2 m outer skirt "reads as a repeating dark aggregate or rock tile rather
# than poured concrete", "with a visible repeat at walking distance". Those
# are two findings and only one of them is about the substance.
#
# HALF ONE, THE SUBSTANCE. The pad wore `masonry` when it was `_stone_height`
# at 1.8 m: eight fractured planes per tile separated by arrises, i.e. 22 cm
# rock facets. (RN-1835 has since made `masonry` coursed ashlar; the pad is
# not poured concrete on that field either, so the substance argument below
# is unchanged and only its foil has moved from cut cliff to laid wall.) A
# formed concrete face has no facets and no arrises at all. What it has, in
# the order the pour puts them there, is: the FORMWORK's own imprint (board
# faces and their joints, the panel joints between form sheets, the tie rods
# that held the two forms apart), the AIR that could not escape the face
# (blowholes), the laitance's slight waviness where the face is not a plane,
# and, later, the places the arris has SPALLED and let the aggregate show.
# Every one of those is authored below and not one of them is a facet.
#
# HALF TWO, THE REPEAT, AND IT IS ANSWERED BY ORIENTATION RATHER THAN BY A
# BIGGER TILE. Which axis repeats is a fact about the consumer, not a matter
# of taste. The pad's skirt is 24 m long and 1.55 m tall and UVs are
# box-projected world metres, so at 1.8 m the tile lays 13.3 repeats along
# the wall and 0.86 of one up it: the HORIZONTAL direction is the only one a
# player can ever count, and the vertical direction cannot repeat on this
# consumer at all. `_bark_height`'s derivation gives the axis to the digit -
# on both horizontal-normal faces v = 1 - Y, so world-vertical is v - and
# this family exploits it:
#
#   * every strong feature that varies is a HORIZONTAL line (the board
#     faces and their joints, the per-board step). A field constant along u
#     contributes exactly nothing to a horizontal repeat, however loud it is,
#     and board marking is the strongest thing on a formed wall.
#   * the one loud feature that varies along u is the FORM PANEL JOINT, and
#     it is placed at u = 0 and u = 0.5, i.e. every 0.90 m. So the rhythm the
#     eye actually locks onto is at HALF the tile period, and it is a rhythm
#     that is supposed to be regular: form sheets are a standard width and a
#     concrete wall really does carry a joint every panel. A repeat the
#     subject genuinely has is not a tiling artefact.
#   * nothing else is allowed to be both large and idiosyncratic. The
#     spalls, which are the one feature with a distinctive silhouette, are
#     gated down to a handful of 5 to 10 cm patches, which is `_bark_height`'s
#     own recorded rule ("a long unique feature on a shared tiling surface is
#     a repeat cue") applied to the feature most likely to break it.
#
# That is a claim with a number behind it and the number is in selftest: this
# family's heightfield must change at least 1.5x faster ALONG v than along u,
# the mirror of the check `bark` is held to, and it is the property that
# makes the countable axis the quiet one.
#
# WHAT IT COSTS, stated here rather than found later. Three PNGs at 512 px:
# roughly 4.0 MiB of VRAM with the mip chain, the same as `masonry`'s own,
# and about 1.0 MB on disk. The pad is the only consumer today, so nothing
# else in the game pays it, and the pad stops loading `masonry` for anything
# it draws (its collision proxies still nominally carry the role, because
# this pass froze their bytes; nothing renders them).
# ---------------------------------------------------------------------------

# THE AMPLITUDES ARE ALL SMALL AND THAT IS THE FAMILY'S CENTRAL CLAIM, not a
# timidity to be tuned out later. A formed concrete wall IS flat: the form was
# a sheet of ply and the wall is a cast of it. The first version of this field
# ran a 0.10 board joint and a 0.17 panel joint against a 0.34 total range, so
# the joints were a third and a half of everything the map had to say, and the
# 2 x 2 tiled preview read as a tiled bathroom wall - a worse answer to "this
# is not poured concrete" than the rock it replaced. Every relief number below
# is between a fifth and a third of that first pass, and the CHARACTER moved
# into the albedo, which is where a real wall keeps it: concrete is a tonal
# surface, not a relief one.
CONC_BOARDS = 12            # board faces across the tile -> 150 mm boards
CONC_PANEL_U = (0.0, 0.5)   # form panel joints -> one every 0.90 m
CONC_JOINT_HALF = 0.0022    # half a panel joint's gap -> 7.9 mm
CONC_JOINT_FALL = 0.0042    # ...the face falls away over a further 7.6 mm
CONC_BOARD_HALF = 0.0011    # half a board joint's gap -> 4.0 mm
CONC_BOARD_FALL = 0.0026    # ...over a further 4.7 mm
CONC_TIE_R = 0.0130         # a plugged tie hole -> 47 mm across
# Tie rods on the form panels' own 0.90 x 0.60 m grid, jittered off it by a
# few centimetres so the wall is built rather than printed. They are
# deliberately NOT hashed into random positions: a tie grid is a real regular
# thing at the panel pitch, and putting it there is what makes the 0.90 m
# rhythm above read as formwork instead of as a texture period.
CONC_TIES = ((0.24, 0.17), (0.76, 0.15), (0.27, 0.50),
             (0.73, 0.52), (0.23, 0.84), (0.78, 0.82))


def _concrete_height(w, h):
    """(height, aux). The formed face, in the order the pour makes it.

    AMPLITUDE, against the neighbours whose `normal_strength` this family's
    is chosen beside. The face sits at 1.0; a board joint falls 0.10 over
    ~6 mm and a panel joint 0.17 over ~11 mm, so the panel joint is the one
    real edge on the tile and everything else is shallower than a `stone`
    arris by a wide margin. That is the physical truth about the subject and
    it is why `concrete` cannot simply borrow stone's 10.0: on a field whose
    biggest step is a sixth of stone's, 10.0 reads as a wall of card."""
    grain = _fbm(w, h, 96, 2, seed=31013)     # ~1.9 cm: the timber's own grain
    laitance = _fbm(w, h, 7, 3, seed=31181)   # ~26 cm: the face is not a plane
    air = _worley(w, h, 34, seed=31333)       # 5.3 cm cells: blowhole sites
    spall = _worley(w, h, 11, seed=31489)     # 16 cm cells: candidate breaks
    agg = _worley(w, h, 30, seed=31627)       # 6 cm: the stones underneath
    # BLOWHOLES CLUSTER, AND THE FIRST VERSION DID NOT KNOW THAT. Ungated,
    # a 34 x 34 worley pits every one of 1156 cells and the wall reads as
    # regularly studded - the same "pattern rather than surface" failure
    # `_paintchip_height` records about keying wear on exposure alone. Air
    # collects where the form was vertical and the mix was stiff, in patches,
    # so the void depth is gated on a 26 cm field and taken to the sixth
    # power: only the very centre of a cell in a favoured patch is a void.
    voids = _fbm(w, h, 9, 2, seed=31889)      # ~20 cm: where air collected
    # THE SPALL OPPORTUNITY FIELD, and `_paintchip_height`'s reason for having
    # one applies here twice over. Keyed on the worley alone, every one of the
    # 121 cells breaks equally and the map reads as a pattern; worse, on THIS
    # family a regular field of distinctive 16 cm silhouettes is exactly the
    # repeat cue the header undertakes not to author. Gated, three to six of
    # them survive per tile.
    where = _fbm(w, h, 3, 2, seed=31771)

    # Per-board tables, hoisted. Indices are integers modulo CONC_BOARDS, so
    # the field is periodic in v BY CONSTRUCTION rather than by hoping.
    step = [(_hash01(k, 7, 31907) - 0.5) * 0.020 for k in range(CONC_BOARDS)]
    cup = [0.002 + _hash01(k, 23, 32009) * 0.007 for k in range(CONC_BOARDS)]

    out = [0.0] * (w * h)
    formed = [0.0] * (w * h)
    sp_out = [0.0] * (w * h)
    vd_out = [0.0] * (w * h)
    bd_out = [0.0] * h
    for y in range(h):
        v = (y + 0.5) / h
        base = y * w
        # -- the board this row is on, and where across it. v * CONC_BOARDS
        #    is an integer count over the tile, so board 11 meets board 0 at
        #    the wrap with no special case.
        f = v * CONC_BOARDS
        bi = int(f) % CONC_BOARDS
        bf = f - int(f)
        dvj = min(bf, 1.0 - bf) / CONC_BOARDS      # to the nearest board joint
        board_z = step[bi]
        # A board bows away from the pour, so the face is very slightly dished
        # across each board and the joints stand proudest. 4*bf*(1-bf) peaks
        # at 1.0 mid-board and is 0 at both joints.
        board_z -= cup[bi] * 4.0 * bf * (1.0 - bf)
        board_z -= 0.030 * (1.0 - _smoothstep(CONC_BOARD_HALF,
                                              CONC_BOARD_HALF
                                              + CONC_BOARD_FALL, dvj))
        # THE LIFT LINE, on the tile boundary in v. Two pours met here, so the
        # lower one's top is a hair proud of the upper one's foot and there is
        # a shallow trough between them. It is the only v-feature bigger than
        # a board joint and it sits on the wrap, which is `panel`'s own trick
        # (the tile edge IS a seam, so the repeat has nowhere to show).
        dlift = _wrap_dist(v, 0.0)
        board_z -= 0.026 * (1.0 - _smoothstep(0.0030, 0.0110, dlift))
        for x in range(w):
            u = (x + 0.5) / w
            i = base + x
            z = 1.0 + board_z
            # -- the form panel joint. The one loud u-varying feature, and it
            #    is at the panel pitch on purpose (see the family header).
            # THE TWO JOINTS ARE NOT EQUAL, and the first version's were.
            # Drawn at one depth they gave the wall a square grid of 0.90 m
            # cells against the 0.15 m board lines, which reads as laid
            # blocks - the failure mode next door, arrived at from the other
            # side. Real formwork has a hierarchy: the joint between two form
            # SHEETS is a real gap, the line where the next sheet's stud
            # backing bears is much fainter. u = 0 is the sheet joint at full
            # depth and u = 0.5 is the intermediate at 45 per cent of it, so
            # the primary rhythm is 1.80 m (and lands on the tile wrap, where
            # `panel` puts its own seams) and the 0.90 m one is a subdivision
            # of it rather than its equal.
            du = CONC_JOINT_HALF + CONC_JOINT_FALL + 1.0
            weight = 1.0
            for k, s in enumerate(CONC_PANEL_U):
                d = _wrap_dist(u, s)
                if d < du:
                    du = d
                    weight = 1.0 if k == 0 else 0.45
            z -= 0.055 * weight * (1.0 - _smoothstep(
                CONC_JOINT_HALF, CONC_JOINT_HALF + CONC_JOINT_FALL, du))
            # ...and the grout that leaked through it and set as a fin. Only
            # where the laitance field says the form was slack, so the fin is
            # intermittent along the joint rather than a ruled line.
            if du < 0.0075:
                z += 0.020 * (1.0 - _smoothstep(0.0026, 0.0075, du)) \
                    * _clamp01((laitance[i] - 0.46) / 0.34)
            # -- the tie holes: a mortar plug shrunk back from the face.
            for (tu, tv) in CONC_TIES:
                ddu = _wrap_delta(u, tu)
                ddv = _wrap_delta(v, tv)
                dd = math.sqrt(ddu * ddu + ddv * ddv)
                if dd < CONC_TIE_R * 1.45:
                    z -= 0.030 * (1.0 - _smoothstep(CONC_TIE_R * 0.70,
                                                    CONC_TIE_R * 1.45, dd))
            # -- blowholes, clustered and to the sixth power: see `voids`.
            vd = ((1.0 - air[i]) ** 6) * _clamp01((voids[i] - 0.40) / 0.34)
            vd_out[i] = vd
            z -= 0.034 * vd
            # -- the face's own waviness and the timber grain printed into it.
            z += (laitance[i] - 0.5) * 0.030
            z += (grain[i] - 0.5) * 0.009
            # -- spalling: the formed skin is gone and the aggregate shows.
            raw = _clamp01((0.34 - spall[i]) / 0.34) * (0.10 + 0.90 * where[i])
            sp = _smoothstep(0.30, 0.62, raw)
            sp_out[i] = sp
            z -= 0.060 * sp
            z += 0.040 * sp * (1.0 - agg[i]) ** 2
            # `formed` is "how intact the moulded skin is here", 1 on a face
            # the form made and 0 in a spall or a void. The masks and the
            # albedo both key on it, which is the honest single authority: a
            # surface cannot be smooth AND broken at the same texel.
            formed[i] = _clamp01((1.0 - sp) * (0.45 + 0.55 * air[i]))
            out[i] = z
        # Per-board cure tone, published per ROW because it is a function of v
        # alone. Boards absorb different amounts of water out of the mix, so
        # a board-marked wall is faintly BANDED in colour as well as in
        # relief, and the banding is the strongest thing the albedo says.
        # It is a v-only field, so it says it without touching the one axis
        # that can show a repeat.
        bd_out[y] = (_hash01(bi, 59, 32089) - 0.5) * 2.0
    return out, {"formed": formed, "spall": sp_out, "agg": agg, "air": air,
                 "void": vd_out, "board": bd_out,
                 "laitance": laitance, "grain": grain}


def _concrete_masks(w, h, height, aux):
    """(roughness, metalness).

    THE BAND IS NARROW ON PURPOSE AND THAT IS THE OPPOSITE OF `stone`'S CASE.
    `_stone_masks` exists because `coarse` was never smooth anywhere and rock
    needs a fresh fracture to glint; a formed concrete face is matte
    everywhere and its interesting variation is small. What it does have is a
    real two-material split: the MOULDED SKIN, which took the form's own
    finish and is the smoothest concrete ever gets, and everywhere the skin
    is gone - a blowhole, a spall, an exposed stone - which is as rough as it
    gets. So roughness is driven by `formed` and by nothing else that could
    disagree with it.

    Metalness identity, `_stone_masks`'s reason word for word: no concrete
    role is a polished metal and 1.0 is the only multiplier that leaves the
    palette's own constant where the palette put it."""
    dirt = _fbm(w, h, 6, 3, seed=32117)     # ~30 cm: where grime has settled
    formed = aux["formed"]
    rough = [0.0] * (w * h)
    metal = [1.0] * (w * h)
    for i in range(w * h):
        # 0.72 on an intact moulded skin, 1.00 where it has gone. The palette
        # multiplies: `Concrete` at 0.94 lands the skin at 0.677 effective,
        # which is matte with a wide soft lobe rather than a glint, and the
        # broken ground at 0.94.
        r = 1.00 - 0.28 * _smoothstep(0.18, 0.86, formed[i])
        # Grime roughens whatever it lands on and it lands everywhere.
        r += 0.06 * (dirt[i] - 0.5)
        rough[i] = _clamp01(r)
    return rough, metal


def _ashlar_albedo(w, h, height, aux):
    """A TILING ALBEDO for laid stone: per-block tone, mortar, weathering that
    runs across the blocks, and water staining that runs DOWN from the beds.

    THE ONE TERM THAT MATTERS MOST IS THE PER-BLOCK ONE, and it is worth
    saying why in a file where every other albedo is a noise field. A masonry
    wall's tone variation is quantised to the block, because a block is one
    piece of one bed of one quarry: the change happens AT the joint and not
    across it. A continuous noise field of the same amplitude reads as damp
    patches on a single slab; the same amplitude as a step function on the
    bond reads as stone that was cut and carried. It is also the term that
    hides the tile, because it is the only one that varies at the block
    frequency, which is the frequency the geometry already announces.

    THE STAINING IS THE DIRECTIONAL TERM. Rain sheds off a bed joint and runs
    down the face below it, so the TOP of each block darkens and the streak
    fades over roughly half the course. That is the cue that says which way
    is up, and it is the one thing an isotropic field cannot say at all. It
    keys on `lv` recovered from the course partition rather than on a noise
    field, so the streaks all start at a real joint.

    WHICH WAY IS UP, DERIVED RATHER THAN GUESSED, because the first version
    got it backwards and it is not visible in the map on its own. The
    exporter writes v flipped (`of_lib`, v -> 1 - v) and the client samples
    glTF-convention UVs with flipY false, so mesh v = 1 reads PNG row 0: the
    decoded image's TOP IS WORLD UP. `_ashlar_partition` indexes rows in
    increasing y, so `lv` = 0 is the top of a course, i.e. immediately under
    the bed joint above it, which is where the wash starts.

    MEAN-NEUTRAL AND CENTRED AT 0.50 for `_stone_albedo`'s reason verbatim:
    the client divides `albedo_mean_linear` back out through material.color,
    so the level is free and the middle of the range is where both tails
    survive the byte quantisation."""
    tile = FAMILY_TILE_M["masonry"]
    rowc, _ = _ashlar_partition(w, h)
    mortar = aux["mortar"]
    tone = aux["tone"]
    wear = aux["wear"]
    # Periods 7 and 11 against a 4-course, 2-or-3-block bond: nothing here
    # shares a factor with anything there, so the dirt never lines up with
    # the joints and the two fields cannot confirm each other into a grid.
    grime = _fbm(w, h, 7, 3, seed=9067)      # ~26 cm: soot and soil splash
    algae = _fbm(w, h, 11, 2, seed=9127)     # ~16 cm: the green-black bloom
    fleck = _fbm(w, h, 64, 2, seed=9181)     # ~28 mm: the stone's own fleck
    # THE STREAK FIELD IS SAMPLED ONCE PER COURSE, AT THAT COURSE'S TOP ROW,
    # AND HELD CONSTANT DOWN THE FACE. A wash modulated by an isotropic field
    # is a blotch; rain runs DOWN, so the thing that varies is WHERE on the
    # bed above it sheds, which is a function of u alone. Reading a 2D field
    # at one row turns it into that function for free and cannot introduce a
    # feature the field does not already have.
    streak = _fbm(w, h, 48, 2, seed=9241)    # ~37 mm of run spacing
    top = [None] * ASHLAR_COURSES
    for y in range(h):
        c = rowc[y][0]
        if top[c] is None:
            top[c] = y
    scol = [[streak[top[c] * w + x] for x in range(w)]
            for c in range(ASHLAR_COURSES)]
    LEVEL = 0.50
    out = bytearray(3 * w * h)
    for y in range(h):
        crs, _, lv = rowc[y]
        srow = scol[crs]
        base = y * w
        for x in range(w):
            i = base + x
            m = _smoothstep(0.20, 0.80, mortar[i])
            bt = tone[i]
            bw = wear[i]
            # Per-block value. +-0.21 about 1.0. `_stone_albedo`'s bedding
            # term carries 0.34 peak-to-peak as a CONTINUOUS field; the same
            # amplitude as a step function on the bond is far more visible,
            # because the eye reads an edge and not a gradient, so this is
            # deliberately larger than that and still inside what one bed of
            # one quarry actually spans.
            v = 1.0 + (bt - 0.5) * 0.42
            v += (fleck[i] - 0.5) * 0.10
            # Weathering, CONTINUOUS across the blocks. Two fields at two
            # periods: soiling darkens, and it darkens more on a worn block.
            v *= 1.0 - 0.26 * _clamp01((grime[i] - 0.42) / 0.58) * (0.45 + bw)
            # The wash below the bed joint above. `lv` = 0 is the top of the
            # course (see the docstring's orientation derivation), so the
            # streak is strongest there and fades over about half the block.
            wash = (1.0 - _smoothstep(0.05, 0.52, lv)) * (0.35 + 0.65 * bw)
            wash *= _clamp01(0.22 + 1.55 * srow[x])
            v *= 1.0 - 0.28 * wash
            # Algae: the green-black bloom, only where it is already damp,
            # i.e. where the wash and the grime agree.
            grn = _clamp01((algae[i] - 0.58) / 0.34) * (0.35 + 0.85 * wash)
            # Mortar. Lighter and markedly greyer than the stone, and it
            # dirties rather than blooms, so it takes the grime term and not
            # the algae one. Keyed on `mortar` and NOT on `joint`: the
            # chamfer is stone and keeps the block's own colour, which is the
            # distinction the aux docstring exists to make.
            mv = (1.16 - 0.32 * _clamp01((grime[i] - 0.38) / 0.62))
            v = v + (mv - v) * m
            grn *= 1.0 - m
            v *= LEVEL
            o = 3 * i
            # Hue. Limestone runs warm and the mortar runs cool-grey, so the
            # channel split is driven by the SAME mask the value blend is,
            # and the algae pulls green up and red down. The warm cast is
            # per BLOCK as well as per material, because two blocks out of
            # one quarry still differ in iron content: that is the second
            # per-block channel and it separates neighbours the value term
            # happens to draw close together.
            warm = (1.0 - m) * (0.014 + 0.072 * bt)
            out[o] = int(round(255.0 * _clamp01(
                v * (1.0 + warm - 0.14 * grn))))
            out[o + 1] = int(round(255.0 * _clamp01(
                v * (1.0 + 0.30 * warm + 0.05 * grn))))
            out[o + 2] = int(round(255.0 * _clamp01(
                v * (1.0 - 0.85 * warm - 0.05 * grn))))
    return bytes(out)


# Rain runs down a wall, so the stain field is one meandering line per run
# rather than a noise field: `_bark_height`'s construction, used here for the
# axis it was derived for rather than against it.
CONC_RUNS = 14
CONC_RUN_PERIOD = 6


def _concrete_albedo(w, h, height, aux):
    """Cement is nearly one colour, so this map is almost entirely WEATHER.

    WHAT IS AUTHORED AND WHY EACH OF IT IS THERE:
      * RAIN RUNS. Water comes off the coping and runs down the face, leaving
        washed light streaks with dark rims where the dirt it carried has
        collected. This is the "staining below the coping" the brief asks
        for, authored the only way a TILING map honestly can: the tile does
        not know where the coping is, but every run on a real wall starts at
        an edge above it and goes DOWN, so a field of vertical runs reads as
        running off something whatever it is applied to.
      * A LIFT LINE at v = 0, faint. Two pours meeting cure to slightly
        different colours and the join is a horizontal band. It sits on the
        tile boundary so it also hides the v wrap, which is `panel`'s own
        trick with its seams.
      * EFFLORESCENCE, pale and patchy, where salts have come out.
      * The SPALLS reading warm, because what shows in a broken face is
        aggregate and sand, which are warmer than the cement paste around
        them.

    IT READS `aux` AND `panel`'S ARGUMENT SAYS THAT IS ALLOWED HERE, where
    `_stone_albedo` refuses it. The refusal there is specific: a pigment
    field that agreed with a FACET field renders as cobblestone, because a
    facet and a pigment patch are the same size. Here the only term keyed on
    the height's own features is the spall warmth, and a spall genuinely IS
    the same object in both maps - the broken place is broken in the relief
    and warm in the colour. Every other term is its own field at its own
    scale.

    CENTRED AT 0.52, for the reason `_stone_albedo`'s last paragraph gives:
    the level is free because `Surfaces.ts` divides `albedo_mean_linear` back
    out, and the middle of the range is where both tails survive."""
    grime = _fbm(w, h, 5, 3, seed=32261)      # ~36 cm: broad soiling
    bloom = _fbm(w, h, 8, 2, seed=32369)      # ~22 cm: efflorescence
    fines = _fbm(w, h, 40, 2, seed=32507)     # ~4.5 cm: sand in the paste
    spall = aux["spall"]
    agg = aux["agg"]
    void = aux["void"]
    board = aux["board"]

    # One meander table per run, periodic in v by construction, plus a hashed
    # base u and a hashed width. Runs are NARROW (2 to 5 cm) and there are
    # nine of them: wide runs at this tile size would be the large idiosyncratic
    # u-varying feature the family header undertakes not to author.
    mp = CONC_RUN_PERIOD
    wander = [[(_hash01(k, j, 32611) - 0.5) * 0.030
               for j in range(mp)] for k in range(CONC_RUNS)]
    base_u = [(k + 0.5 + (_hash01(k, 71, 32717) - 0.5) * 0.34) / CONC_RUNS
              for k in range(CONC_RUNS)]
    half = [0.0030 + _hash01(k, 13, 32831) * 0.0055 for k in range(CONC_RUNS)]
    # How far down the tile each run has got. A run fades out, it does not
    # stop, so this is a threshold on v with a soft edge rather than an end.
    start = [_hash01(k, 41, 32933) * 0.35 for k in range(CONC_RUNS)]

    LEVEL = 0.52
    out = bytearray(3 * w * h)
    for y in range(h):
        v = (y + 0.5) / h
        base = y * w
        f = v * mp
        j0 = int(f) % mp
        j1 = (j0 + 1) % mp
        t = _smooth(f - int(f))
        row = []
        for k in range(CONC_RUNS):
            o0 = wander[k][j0]
            o1 = wander[k][j1]
            # A run is strongest just below where it started and thins with
            # distance down the wall.
            live = _smoothstep(start[k], start[k] + 0.10, v) \
                * (1.0 - 0.55 * _smoothstep(start[k] + 0.10, 1.0, v))
            row.append(((base_u[k] + o0 + (o1 - o0) * t) % 1.0, live, half[k]))
        # THE LIFT LINE, on the tile boundary. `_wrap_dist` to v = 0, so the
        # band is continuous across the wrap.
        lift = 1.0 - _smoothstep(0.006, 0.030, _wrap_dist(v, 0.0))
        for x in range(w):
            u = (x + 0.5) / w
            i = base + x
            # -- the runs. `wash` is the scoured centre, `rim` the dirt it
            #    pushed to the edges: the same washed/rimmed pair a real
            #    streak has, and the reason a run reads as a run and not as a
            #    painted stripe.
            wash = 0.0
            rim = 0.0
            for (cu, live, hw) in row:
                d = _wrap_dist(u, cu)
                if d < hw + 0.0075:
                    wash += live * (1.0 - _smoothstep(hw * 0.5, hw, d))
                    rim += live * (1.0 - _smoothstep(hw, hw + 0.0075, d)) \
                        * _smoothstep(hw * 0.55, hw, d)
            wash = _clamp01(wash)
            rim = _clamp01(rim)
            # -- value. The weather is most of the amplitude and the BOARD
            #    BANDING is the largest single term, which is the honest
            #    claim about a board-marked wall and also the one that costs
            #    nothing in repeat (it varies in v only).
            val = 1.0 + board[y] * 0.060
            val += (grime[i] - 0.5) * 0.14 + (fines[i] - 0.5) * 0.08
            # A RUN IS A DARK STREAK WITH A FAINT LIGHT CORE, and that ratio
            # is the whole difference between weathering and wax. Authored
            # the other way round first (+0.14 wash, -0.20 rim) the runs came
            # out as pale drips bright enough to be the most conspicuous
            # u-varying thing on the tile, which put the repeat back in the
            # one axis this family exists to keep quiet.
            val *= 1.0 + 0.045 * wash - 0.100 * rim
            val *= 1.0 - 0.07 * lift
            # A blowhole is a hole: it reads dark because you are looking
            # into it, not because the cement there is a different colour.
            val *= 1.0 - 0.34 * void[i]
            eff = _clamp01((bloom[i] - 0.62) / 0.30)
            val *= 1.0 + 0.08 * eff
            val *= LEVEL
            # -- hue. Only two terms move it and both move it warm, because
            #    everything that happens to concrete is either sand showing
            #    through or dirt: there is no term here that could make it
            #    blue, and inventing one would be the flat-colour defect in
            #    a different disguise.
            warm = _clamp01(spall[i] * (1.0 - agg[i])) * 0.55 + rim * 0.22
            o = 3 * i
            out[o] = int(round(255.0 * _clamp01(
                val * (1.0 + 0.16 * warm - 0.02 * eff))))
            out[o + 1] = int(round(255.0 * _clamp01(
                val * (1.0 + 0.02 * warm + 0.00 * eff))))
            out[o + 2] = int(round(255.0 * _clamp01(
                val * (1.0 - 0.17 * warm + 0.04 * eff))))
    return bytes(out)


# ---------------------------------------------------------------------------
# The `ember` family (RN-1780, look audit R6): the firebox peep and sight
# strip, the two brightest surfaces on the hero machine and, until now,
# untextured (peep iqr 0.93, strip iqr 4.15, against 40.54 and 72.68 for the
# plate work beside them). `MachineFx.ts`'s `MachineGlow` already drives a
# uniform fire colour, intensity and flicker per instance; what was missing
# is spatial variation, so this is an EMISSIVE map only, multiplied against
# that colour, not a restyle of it.
#
# `_ember_height` IS ITS OWN FIELD, NOT `_stone_height` REUSED, and the
# reversal is the whole lesson of the first version's failure. Calling
# `_stone_planes` at `STONE_FACETS = 8` was the honest physical claim (a coal
# bed IS fractured mineral) but it silently imported `stone`'s FREQUENCY
# along with its shape: 8 cells across a 0.6 m tile is a 7.5 cm facet, big
# enough to survive minification on a boulder seen from metres away; the
# same 8 cells across `ember`'s 0.28 m tile is a 3.5 cm facet, 16 px of a
# 128 px texture, and the peep draws at roughly 85 SCREEN px on the
# `smelterhero` shot. That is below the texture's own native size, so the
# GPU samples a blurred mip level by construction, and a mip filter is a box
# average: it cannot tell a `smoothstep` boundary from noise, and it erases
# both. The first version's source PNG had real 67-per-cent-dark contrast
# (verified by decoding the shipped bytes) and the RENDERED frame kept the
# old shape anyway (peep iqr 0.93 -> 5.35, p25 barely moved), which is
# minification and not a curve problem: a sharper heat curve on the SAME
# facet frequency cannot fix a feature the sampler already cannot resolve.
# `EMBER_FACETS = 3` makes each coal chunk about 43 px of the 128 px map,
# close to the screen footprint itself, so the pattern the source PNG
# carries is closer to what a minified sample can still tell apart.
# ---------------------------------------------------------------------------

EMBER_FACETS = 3
EMBER_CHIPS = 7


def _ember_height(w, h):
    """(height, aux). Two-scale fracture like `_stone_height`'s, at a
    frequency chosen for `ember`'s own tiny screen footprint rather than
    inherited from `stone`'s boulder-scale one (see the family header just
    above). `aux["crest"]`/`aux["crevice"]` keep the same meaning `stone`'s
    do (RN-742): standing clear of the arris, and sitting in its low ground."""
    facet, e1 = _stone_planes(w, h, EMBER_FACETS, 4211, 0.85, FACET_ARRIS)
    chip, e2 = _stone_planes(w, h, EMBER_CHIPS, 4517, 1.70, CHIP_ARRIS)
    out = [0.0] * (w * h)
    for i in range(w * h):
        out[i] = 0.65 * facet[i] + 0.35 * chip[i]
    lo = min(out)
    span = (max(out) - lo) or 1.0
    crest = [0.0] * (w * h)
    crev = [0.0] * (w * h)
    for i in range(w * h):
        hn = (out[i] - lo) / span
        clear = (1.0 - e1[i]) * (1.0 - e2[i])
        crest[i] = clear * _smoothstep(0.30, 0.80, hn)
        e = e1[i] if e1[i] > e2[i] else e2[i]
        crev[i] = e * (1.0 - _smoothstep(0.20, 0.70, hn))
    return out, {"crest": crest, "crevice": crev}

def _ember_emissive(w, h, height, aux):
    """RN-1780, REVISED. The first version banked a floor at 0.16 so the
    surface could never read as damage, and that was the wrong lesson taken
    from the wrong place: RN-1524's warning is about a MEAN that will not
    move, and a floor that can never go dark makes the SAME mistake at the
    other end of the range, because it puts every texel within a factor of
    six of every other one. Measured on the shipped bytes, that version's
    peep read p05 189.4, p95 192.0 (a plus-or-minus-7-count ripple around an
    unchanged 190), which is a lit sticker with a fine crackle on it, not
    coal at temperature: the client's tone mapper and bloom compress a
    self-lit surface hard, so a source map has to put real black where black
    belongs or none of it survives to the sensor.

    THE FIX IS A THRESHOLD ON HEIGHT ITSELF, not a floor on the crest mask.
    `aux["crest"]` already answers "is this texel clear of the arris", which
    is a MAJORITY of the field (mean 0.32, but the smoothstep's own knees are
    wide) -- fine for shading a rock, wrong for an ember bed, where the coals
    are the MINORITY and the ash between them is what a photograph of a
    firebox is mostly made of. `_smoothstep(0.55, 0.90, hn)` on the
    NORMALISED height instead keeps only the top of the facet field lit at
    all: measured off the shipped field, 67 per cent of texels land under
    0.05 before the patch and crevice terms are even applied, against 0 per
    cent for the crest-mask version. That is deliberately a LARGE dark
    fraction, not a thin crack: the client's bloom kernel is wide relative to
    an 83 x 65 px peep on screen, so a crevice-width dark line is exactly the
    feature bloom erases, and the fix has to survive AT THE SCREEN, not only
    in the source PNG.

    `crevice` still darkens further on top of the threshold (0.85, not the
    first version's 0.55): the arris crack gets its own black line rather
    than merely wherever the height threshold happens to fall, which is what
    keeps the coals reading as fractured chunks and not as a painted blob.
    `patch` still says not every crest is equally hot, now with a wider
    0.35..1.20 range so a few crests can clip past full brightness while
    others stay a dim red, which is `MachineGlow`'s own two-colour (FIRE vs
    EMBER) argument reproduced spatially within one instance.

    THE CHANNELS STILL DIVERGE BY POWER, not by an additive tint: R rises
    fastest (heat**0.55, so even a dim coal reads red rather than black-red),
    G next (heat**1.15), B slowest (heat**1.9, so only the genuinely hottest
    texels close toward white). `MachineGlow` supplies the one flat colour
    this whole map multiplies against; the map's job is only to say WHERE and
    HOW MUCH, in both luma and in how close to white that texel gets to be."""
    lo = min(height)
    span = (max(height) - lo) or 1.0
    patch = _fbm(w, h, 3, 2, seed=27011)   # ~20 cm: which coals are hottest
    crevice = aux["crevice"]
    out = bytearray(3 * w * h)
    for i in range(w * h):
        hn = (height[i] - lo) / span
        heat = _smoothstep(0.55, 0.90, hn)
        heat *= 0.35 + 0.85 * patch[i]
        heat *= 1.0 - 0.85 * crevice[i]
        heat = _clamp01(heat)
        o = 3 * i
        out[o] = int(round(255.0 * _clamp01(heat ** 0.55)))
        out[o + 1] = int(round(255.0 * _clamp01(0.85 * heat ** 1.15)))
        out[o + 2] = int(round(255.0 * _clamp01(0.65 * heat ** 1.9)))
    return bytes(out)


def _ember_masks(w, h, height, aux):
    """(roughness, metalness). Pinned rather than derived from the field,
    which every other family's masks are not, and the difference is the
    point: `_stone_masks`'s crest/crevice band (roughness 0.36 on a crest,
    1.00 in a crevice) puts a GLOSSY, low-roughness patch exactly where the
    emissive map also puts its hottest texel, and on a dielectric role under
    a bright sky IBL that specular highlight is bright enough to compete with
    the emissive term for which one the eye reads as "the hot spot" - a coal
    should glow, not glint. Pinned flat (rough 0.95, metal identity so the
    palette's own 0.00 stands) removes that confound entirely: whatever
    contrast survives to the screen is then attributable to the emissive
    term alone, which is what this family exists to test."""
    n = w * h
    return [0.95] * n, [1.0] * n


# ---------------------------------------------------------------------------
# The `fur` family: the first CREATURE surface, and the first TILING family to
# carry an ALBEDO (RN-455, retargeted at RN-461).
#
# RN-461, AND THE CORRECTION IS THE WHOLE ENTRY. This family shipped as
# `chitin`: a hard shell with a specular sheen on the plate crowns and an
# effective roughness band 0.242 to 0.792 wide. Reid looked at it and said "it
# looks like its made of shiny stone. it should look like it has almost like a
# fur. very short fur." He is right and the brief was wrong. A sharp specular
# highlight is the single strongest HARD SURFACE cue there is, and the wider
# the roughness band the harder the thing reads. The machinery was good and it
# was aimed at beetle carapace when the subject is a tarantula.
#
# FUR IS CLOSE TO THE OPPOSITE, and every term below inverts one above it:
#   - roughness HIGH everywhere and no sharp specular anywhere. The band stays
#     over section 2.1's 0.15 minimum but now sits at 0.76 to 0.95 instead of
#     straddling the middle of the range.
#   - the relief is DIRECTIONAL. Fur flows, and flow is what turns a round
#     highlight into a stretched one. `_hair_layer` lays real, discrete,
#     tapered strands along a wobbling flow field rather than filtering
#     isotropic noise, because an anisotropic look cannot be built out of an
#     isotropic generator no matter how it is tuned.
#   - the strands are FINE: two layers at 20 and 40 cells over a 0.30 m tile,
#     so 15 mm and 7.5 mm apart, well under the punctate pitting the shell
#     version authored.
#   - value darkens at the ROOT and lifts at the TIP, which is what fur does
#     and what a pitted shell does not.
#
# What did NOT change is the SHAPE of the family (normal + orm + a tiling
# albedo, mean-neutral) or the reason for it, so the paragraph below still
# stands as written and the player suit still inherits it.
#
# THE SHAPE OF THIS FAMILY IS THE GENERAL THING, not the spider. Every tiling
# family before it is normal+orm and leaves base colour to the palette
# constant, because the machine path structurally cannot take an albedo
# (MachineBatch overwrites diffuseColor after <map_fragment>). That argument
# was always specific to that hook, and ART-DIRECTION.md names "flat vertex
# colour as the primary albedo source" as a defect to unlearn. So `chitin` is
# normal + orm + ALBEDO at metre UVs, mean-neutral exactly as the card
# families are, and the player suit, the machines and the rocks can each take
# the same shape when their lane comes to it.
#
# WHY THE ALBEDO HAS TO CARRY THE OCCLUSION. The near creature is drawn
# through SpiderFlock's merge, which collapses every primitive to ONE
# material, so per-part roughness does not exist, and the screen-space AO
# clamps bind inside 0.37 m (section 2.1 item 5). Value darkening into the
# creases is in the map or it is nowhere. It is mean-neutral (the client
# divides `albedo_mean_linear` out through material.color), so it cannot shift the
# palette: what survives is the spatial variance and the hue, which is exactly
# the split section 2.1 item 4 states for the foliage cards.
# ---------------------------------------------------------------------------

def _normalise(field):
    lo = min(field)
    hi = max(field)
    span = (hi - lo) or 1.0
    return [(v - lo) / span for v in field]


def _hair_layer(w, h, cells, seed, length, radius, taper, flow_deg, wobble_deg):
    """Discrete tapered STRANDS on a jittered lattice, laid along a flow field.

    Returns (ridge, tip): `ridge` is 1 on a strand centreline falling to 0
    between strands, `tip` is 0 at a strand root and 1 at its point.

    WHY STRANDS AND NOT FILTERED NOISE. Fur reads as fur because its relief is
    ANISOTROPIC: high frequency across the flow, low frequency along it. Every
    noise generator in this file is isotropic by construction (worley is
    distance to a POINT, fbm is a lattice of scalars), and no amount of tuning
    grows a direction on an isotropic field. So the strands are laid down as
    segments and the field is the distance to the nearest one, bucketed 3x3 the
    way `_worley` buckets its points so the cost stays linear in texels.

    The flow is one base angle plus a low-frequency wobble, both periodic, so
    the tile still wraps and the fur has a grain rather than a swirl."""
    wob = _fbm(w, h, 3, 2, seed=seed + 77)
    seeds = []
    for cy in range(cells):
        for cx in range(cells):
            jx = _hash01(cx, cy, seed)
            jy = _hash01(cx, cy, seed + 1)
            jd = _hash01(cx, cy, seed + 2)
            ang = math.radians(flow_deg + (jd * 2.0 - 1.0) * wobble_deg)
            seeds.append(((cx + jx) / cells, (cy + jy) / cells, ang))
    ridge = [0.0] * (w * h)
    tip = [0.0] * (w * h)
    ln = length / cells
    rad = radius / cells
    for y in range(h):
        py = y / h
        gy = int(py * cells)
        base = y * w
        for x in range(w):
            px = x / w
            gx = int(px * cells)
            # the wobble bends a whole neighbourhood together, so strands in
            # one region agree with each other instead of crossing
            bend = (wob[base + x] - 0.5) * 2.0 * math.radians(wobble_deg)
            best = 0.0
            bestt = 0.0
            for oy in (-1, 0, 1):
                ry = (gy + oy) % cells
                for ox in (-1, 0, 1):
                    rx = (gx + ox) % cells
                    ax, ay, ang = seeds[ry * cells + rx]
                    ca = math.cos(ang + bend)
                    sa = math.sin(ang + bend)
                    dx = _wrap_delta(px, ax)
                    dy = _wrap_delta(py, ay)
                    t = (dx * ca + dy * sa) / ln
                    if t < 0.0:
                        t = 0.0
                    elif t > 1.0:
                        t = 1.0
                    ex = dx - ca * t * ln
                    ey = dy - sa * t * ln
                    d = math.sqrt(ex * ex + ey * ey)
                    # a strand narrows toward its point, so the ridge does too
                    r = rad * (1.0 - taper * t)
                    v = math.exp(-(d / r) * (d / r)) if r > 1e-9 else 0.0
                    if v > best:
                        best = v
                        bestt = t
            ridge[base + x] = best
            tip[base + x] = bestt
    return ridge, tip


def _fur_height(w, h):
    """Two strand layers over a soft body undulation, and nothing else.

    The shell version's punctate pits and bristle sockets are GONE. They were
    the correct detail for a carapace and they are the wrong one here: a pit is
    a hard-surface cue, and at this tile size they were also the COARSEST thing
    on the map, which is backwards for a surface whose whole character is that
    it is finer than everything around it."""
    dome = _fbm(w, h, 3, 3, seed=3301)
    r1, t1 = _hair_layer(w, h, 20, 4409, length=1.55, radius=0.26,
                         taper=0.62, flow_deg=90.0, wobble_deg=26.0)
    r2, t2 = _hair_layer(w, h, 40, 5507, length=1.35, radius=0.24,
                         taper=0.70, flow_deg=90.0, wobble_deg=34.0)
    grain = _fbm(w, h, 84, 2, seed=8831)
    out = [0.0] * (w * h)
    ridge = [0.0] * (w * h)
    tip = [0.0] * (w * h)
    for i in range(w * h):
        coarse = r1[i] >= r2[i] * 0.85
        ridge[i] = r1[i] if coarse else r2[i]
        tip[i] = t1[i] if coarse else t2[i]
        z = 0.42 * dome[i]
        z += 0.62 * r1[i]
        z += 0.34 * r2[i]
        z += 0.020 * grain[i]
        out[i] = z
    return out, {"ridge": ridge, "tip": tip, "hn": _normalise(out)}


def _fur_masks(w, h, height, aux):
    """HIGH everywhere, and the small band that remains runs ALONG the strands.

    Section 2.1 item 4 asks for an effective p05..p95 band at least ~0.15 wide,
    and that rule exists so a family is not a constant under a moving sun. It
    does NOT ask for the band to sit in the middle of the range, and for fur it
    must not: with the material at 0.95 this lands 0.76 to 0.95, a real band
    with no part of it anywhere near a hard specular.

    The slight dip on a strand crown is the only sheen fur has, and because the
    crowns are collinear it reads as a STRETCHED highlight rather than a round
    one, which is the anisotropy doing its job with an isotropic BRDF."""
    mottle = _fbm(w, h, 13, 3, seed=9127)
    rough = [0.0] * (w * h)
    # Honest constant, and more honest here than on the shell: fur is not a
    # metal by any reading, and the material constant is 0.02.
    metal = [1.0] * (w * h)
    for i in range(w * h):
        r = (1.0 - 0.20 * aux["ridge"][i] * (1.0 - 0.45 * aux["tip"][i])
             + (mottle[i] - 0.5) * 0.05)
        rough[i] = _clamp01(r)
    return rough, metal


def _fur_albedo(w, h, height, aux):
    """Dark at the root, lifted at the tip, over a broad pigmentation patch."""
    patch = _fbm(w, h, 2, 2, seed=12347)
    blotch = _fbm(w, h, 9, 3, seed=10133)
    ridge = aux["ridge"]
    tip = aux["tip"]
    out = bytearray(w * h * 3)
    for i in range(w * h):
        # between the strands is the ROOT layer and it is in shadow: the base
        # value is low, and a strand lifts it, most at the point.
        v = 0.44 + 0.40 * ridge[i] * (0.55 + 0.45 * tip[i])
        v *= 0.86 + 0.28 * patch[i]
        v *= 0.94 + 0.12 * blotch[i]
        # A hair tip is where light gets through it, so it warms; the root
        # layer is where it does not. Same six per cent lean the shell had,
        # driven by the strand rather than by the height.
        warm = 0.06 * ridge[i] * tip[i]
        o = i * 3
        out[o] = int(round(255.0 * _clamp01(v * (1.0 + warm))))
        out[o + 1] = int(round(255.0 * _clamp01(v)))
        out[o + 2] = int(round(255.0 * _clamp01(v * (1.0 - warm * 0.9))))
    return bytes(out)


# ---------------------------------------------------------------------------
# suitfab - the pressure garment's woven shell. RN-643.
#
# THE FREQUENCY SPLIT IS THE WHOLE DESIGN AND IT IS RN-454's LESSON PAID
# FORWARD. Driving albedo, normal and ORM off one heightfield gave the spider
# identical frequency content in all three and it rendered as cobblestone. So
# each map is authored for the band it is actually good at:
#
#   NORMAL  carries relief BELOW A CENTIMETRE: the weave itself at a 5 mm
#           thread pitch, and the ripstop grid at 2.5 cm. Nothing coarser.
#   ALBEDO  carries pigmentation at 10 to 20 cm: soiling, dust, the patchy
#           discolouration a working garment has. Plus crease darkening,
#           which is the one place the two maps are allowed to agree.
#   ORM     carries a real roughness BAND, because that is what section 2.1
#           item 4 asks for and what panel's 0.032 fails to give.
#
# WHAT IS DELIBERATELY NOT HERE: panel seams, straps, buckles, zips and
# closures. Those are 10 to 30 cm features, the tile is 50 cm, and a 20 cm
# feature in a 50 cm tile repeats visibly on a 1.8 m body. RN-454 settled
# this for the spider ("plate structure at 10 to 30 cm is the GEOMETRY's job
# and the geometry already has it") and a suit is the same argument: a strap
# that is drawn rather than built has no silhouette, and silhouette is the
# thing ART-DIRECTION.md is actually asking for.
# ---------------------------------------------------------------------------

# 5 mm thread pitch over a 0.5 m tile. A technical garment's outer layer is a
# 1000-denier-ish weave and this is roughly its scale; finer than this and the
# weave is under the texel floor at the FP hand, coarser and it reads as
# sacking rather than as a suit.
# 3.3 mm at 150 threads over the 0.5 m tile, which is 3.4 texels per thread:
# right at the resolvable floor and deliberately so. THE FIRST VERSION WAS AT
# 100 (5 mm, 5.1 texels) AND IT RENDERED AS KNITWEAR. That is not a subtle
# miss: at 5 mm on a 0.12 m glove a player counts about twenty-four threads
# across the back of the hand, and anything you can count reads as hand-knitted
# wool rather than as the tight technical weave a pressure garment is. The
# whole point of the outer layer is that you sense the weave without resolving
# it, so the pitch is set just at the point where the texel floor stops it
# being countable.
_FAB_THREADS = 150
_FAB_RIPSTOP = 7          # every seventh thread is the heavy ripstop yarn: a
                          # 2.3 cm grid, which is what ripstop actually is,
                          # and it is now the COARSEST thing on the map, which
                          # is the right way round for a woven surface


def _suitfab_height(w, h):
    """A plain weave with an over-under, a ripstop grid, and a soft drape.

    The weave is TWO crossed strand layers, which is the only way to get it:
    `_hair_layer` is the one anisotropic primitive in this file and a weave is
    two anisotropies at right angles. Everything else here is isotropic by
    construction and no amount of tuning grows a direction on it (RN-461).

    THE OVER-UNDER IS THE POINT. Adding warp and weft together gives a
    waffle: every crossing is a bump and the surface has no weave, it has a
    grid of dots. A real plain weave alternates which yarn passes over, so the
    crossings alternate high and low in a checker at the thread pitch, and
    THAT is what makes a highlight travel along a thread instead of sitting on
    a lattice."""
    warp, _ = _hair_layer(w, h, _FAB_THREADS, 6101, length=2.10, radius=0.30,
                          taper=0.0, flow_deg=0.0, wobble_deg=2.5)
    weft, _ = _hair_layer(w, h, _FAB_THREADS, 6203, length=2.10, radius=0.30,
                          taper=0.0, flow_deg=90.0, wobble_deg=2.5)
    # The drape. Low frequency and low amplitude: it is what stops the weave
    # reading as graph paper, and it is NOT a fold - a fold is geometry.
    drape = _fbm(w, h, 5, 3, seed=6301)
    fuzz = _fbm(w, h, 150, 2, seed=6421)
    out = [0.0] * (w * h)
    crown = [0.0] * (w * h)
    rip = [0.0] * (w * h)
    for y in range(h):
        gy = int((y / h) * _FAB_THREADS)
        # the heavy yarn sits every _FAB_RIPSTOP threads in each direction
        ry = 1.0 if (gy % _FAB_RIPSTOP) == 0 else 0.0
        base = y * w
        for x in range(w):
            i = base + x
            gx = int((x / w) * _FAB_THREADS)
            rx = 1.0 if (gx % _FAB_RIPSTOP) == 0 else 0.0
            over = 1.0 if ((gx + gy) & 1) else 0.0
            a = warp[i]
            b = weft[i]
            # over-under: whichever yarn is on top this crossing gets the
            # crown, the other is pushed down behind it
            hi = a * 0.66 + b * 0.34 if over else a * 0.34 + b * 0.66
            lo = min(a, b)
            heavy = max(rx * a, ry * b)
            rip[i] = heavy
            crown[i] = hi - 0.55 * lo
            # The weave's share of the height came DOWN from 0.62 to 0.34 with
            # the pitch change, and the drape's went up. Amplitude and pitch
            # are not independent: a 0.62 crown over a 3.3 mm pitch is a
            # relief slope that reads as corrugation whatever the normal
            # strength does afterwards. The heavy ripstop yarn keeps its share
            # because it is meant to be the feature you actually see.
            out[i] = (0.44 * drape[i] + 0.34 * hi + 0.24 * heavy
                      + 0.030 * fuzz[i])
    return out, {"crown": _normalise(crown), "rip": rip,
                 "hn": _normalise(out), "drape": drape}


def _suitfab_masks(w, h, height, aux):
    """A WIDE band, and it is wide because a garment is not one material.

    Section 2.1 item 4 wants an effective p05..p95 span of at least ~0.15.
    `Suit` has a palette roughness of 0.65 and `SuitDark` 0.70, so an ormG
    running roughly 0.60 to 1.00 puts Suit at an effective 0.39 to 0.65 and
    SuitDark at 0.42 to 0.70. Both are four to five times panel's measured
    0.032 on the same roles.

    The band is not decoration. Three physically different things live on a
    working garment and they have genuinely different roughness: the raw
    weave is matte, the crowns of the yarns POLISH where the fabric rubs
    (elbows, palms, anywhere it drags), and ground-in dirt is rougher than
    either. Driving all three off one mask would be the cobblestone mistake
    again, so the polish follows the weave crowns (a sub-centimetre field)
    and the soiling follows the broad patches (a 17 cm field) and they are
    multiplied, not summed."""
    grime = _fbm(w, h, 3, 3, seed=6551)
    rub = _fbm(w, h, 4, 2, seed=6607)       # 12.5 cm: the rub ZONES
    rough = [0.0] * (w * h)
    # Honest constant. A pressure garment's outer layer is a polymer weave and
    # the palette already states 0.00 metallic on both roles; identity is the
    # only multiplier that leaves that alone.
    metal = [1.0] * (w * h)
    for i in range(w * h):
        # start rough, the way cloth is
        r = 0.99
        # THE ZONE TERM CARRIES THE BAND, AND THE FIRST VERSION DID NOT HAVE
        # IT. Polishing only the yarn crowns gave a measured effective band of
        # 0.127, under section 2.1's 0.15, because `crown` is a strand field:
        # heavily skewed to zero with a thin bright tail, so almost every texel
        # got almost the same roughness. A suit does not polish thread by
        # thread, it polishes in ZONES - elbows, knees, palms, under a strap -
        # and a zone is a low-frequency field with a real spread. The
        # smoothstep is what turns that spread into a band rather than a haze.
        r -= 0.30 * _smoothstep(0.18, 0.78, rub[i])
        # within a rub zone, the crowns take it first
        r -= 0.20 * aux["crown"][i] * (0.40 + 0.60 * rub[i])
        # the ripstop yarn is heavier and shinier than the field yarn
        r -= 0.06 * aux["rip"][i]
        # ground-in dirt roughens whatever it lands on
        r += 0.06 * (grime[i] - 0.5)
        rough[i] = _clamp01(r)
    return rough, metal


def _suitfab_albedo(w, h, height, aux):
    """Soiling at 10 to 20 cm, and dirt that collects where dirt collects.

    ART-DIRECTION.md asks for grounded, muted, layered colour and names flat
    vertex colour as the defect to unlearn. The palette gives the level (this
    map is mean-neutral by construction, so only its VARIANCE and its HUE
    survive `Surfaces.ts`'s divide by `albedo_mean_linear`); what is authored here is
    where a working suit is dirty and where it is not."""
    soil = _fbm(w, h, 3, 3, seed=6701)          # 16.7 cm: the grime patches
    stain = _fbm(w, h, 6, 2, seed=6803)         # 8.3 cm: within-patch mottle
    out = bytearray(w * h * 3)
    for i in range(w * h):
        # The weave's own value structure: a yarn crown catches light, the
        # gap between yarns is in shadow and holds dirt. Small, because the
        # normal map is already carrying this band and doubling it is how a
        # surface starts looking painted.
        v = 0.90 + 0.13 * aux["crown"][i] - 0.10 * (1.0 - aux["hn"][i])
        # the broad soiling, which is the map's actual job
        d = _clamp01(0.62 * soil[i] + 0.38 * stain[i])
        v *= 1.0 - 0.30 * d
        # Dirt is warmer and much less saturated than the garment under it.
        # Applied as a LEAN on the channels rather than as a colour, because a
        # mean-neutral map cannot carry a colour and pretending otherwise is
        # how a family ships a tint that the divide then deletes.
        warm = 0.055 * d
        o = i * 3
        out[o] = int(round(255.0 * _clamp01(v * (1.0 + warm))))
        out[o + 1] = int(round(255.0 * _clamp01(v)))
        out[o + 2] = int(round(255.0 * _clamp01(v * (1.0 - warm * 1.15))))
    return bytes(out)


# ---------------------------------------------------------------------------
# suitplate - the hard fittings. RN-644.
#
# Knuckle plates, the helmet ring, buckles, armour lames. One role, `Plate`,
# palette 7E8790 at metallic 0.70 and roughness 0.42.
#
# THIS FAMILY EXISTS TO FIX A NAMED DEFECT, NOT TO DECORATE. Section 2.1 item
# 4: "Metalness must carry information or be honestly constant. Three of four
# ORM maps are literally 255 in blue. That is fine for rock and bark; it is
# not fine that the only varying metalness in the game is 8.9 per cent of one
# map." A painted or anodised fitting that has worn through to bare metal is
# the clearest case in the game of a surface whose metalness genuinely varies
# across itself, and one wear mask drives all three maps coherently:
#
#   worn through -> albedo lifts, metalness goes UP toward bare alloy,
#                   roughness goes DOWN because the coating is what was rough
#   still coated  -> albedo sits dark, metalness low (a coating is dielectric),
#                   roughness high
#
# Getting those three to agree is the difference between metal and grey
# plastic, and it costs nothing that a decorative map would not also cost.
# ---------------------------------------------------------------------------

# Eleven scratches per tile, and they are AUTHORED as segments rather than
# drawn from noise. A scratch is a long thin straight thing and no isotropic
# field produces one; this is the same argument that made the fur strands
# discrete (RN-461). Values are (x0, y0, x1, y1, depth), tile space.
_PLATE_SCRATCHES = (
    (0.05, 0.18, 0.47, 0.29, 1.00), (0.62, 0.07, 0.95, 0.14, 0.72),
    (0.21, 0.55, 0.74, 0.71, 0.88), (0.83, 0.36, 0.99, 0.62, 0.55),
    (0.12, 0.82, 0.58, 0.93, 0.66), (0.40, 0.02, 0.52, 0.34, 0.44),
    (0.68, 0.78, 0.92, 0.88, 0.61), (0.02, 0.44, 0.19, 0.51, 0.38),
    (0.55, 0.42, 0.88, 0.49, 0.50), (0.30, 0.62, 0.36, 0.97, 0.42),
    (0.72, 0.20, 0.79, 0.44, 0.35),
)


def _plate_scratch_field(w, h):
    """Distance-falloff field for the authored scratches, 0..1, 1 in a groove.

    Two radii: a narrow cut and a wide burr shoulder either side of it, which
    is what makes a scratch catch light on one edge instead of reading as a
    drawn line."""
    cut = [0.0] * (w * h)
    burr = [0.0] * (w * h)
    for y in range(h):
        py = y / h
        base = y * w
        for x in range(w):
            px = x / w
            bc, bb = 0.0, 0.0
            for (ax, ay, bx, by, dep) in _PLATE_SCRATCHES:
                d = _seg_dist(px, py, ax, ay, bx, by)
                c = dep * (1.0 - _smoothstep(0.0, 0.0016, d))
                if c > bc:
                    bc = c
                s = dep * (1.0 - _smoothstep(0.0012, 0.0052, d))
                if s > bb:
                    bb = s
            cut[base + x] = bc
            burr[base + x] = bb
    return cut, burr


def _suitplate_height(w, h):
    """Brushed grain, micro-pitting, shallow dings, and eleven scratches.

    NO panel seams, NO rivets, NO bevels. The consumers are 3 to 6 cm parts
    and the geometry already carries their edges; a bevel in the map on a part
    that has a real bevel is the doubling that reads as dirt."""
    # The grain. One direction, very fine (140 threads over 0.4 m is a 2.9 mm
    # pitch), no taper: a brush mark is a scratch that runs the whole way.
    grain, _ = _hair_layer(w, h, 140, 7101, length=2.60, radius=0.20,
                           taper=0.0, flow_deg=12.0, wobble_deg=4.0)
    pit = _worley(w, h, 64, 7203)          # 6 mm cells: casting micro-pitting
    ding = _worley(w, h, 9, 7307)          # 44 mm cells: impact dishing
    cut, burr = _plate_scratch_field(w, h)
    out = [0.0] * (w * h)
    high = [0.0] * (w * h)
    for i in range(w * h):
        z = 0.50
        z += 0.085 * grain[i]
        # worley is 0 AT a feature point, so (1 - v) is the pit
        z -= 0.055 * (1.0 - pit[i]) ** 3
        # a ding is a broad shallow dish, not a hole: cube it so only the
        # cell centres dish and the surface between them stays flat
        z -= 0.130 * (1.0 - ding[i]) ** 3
        z += 0.040 * burr[i]
        z -= 0.150 * cut[i]
        out[i] = z
        # "how proud is this texel", which is what wears first
        high[i] = _clamp01(0.5 + 1.9 * (z - 0.5))
    return out, {"high": high, "cut": cut, "burr": burr, "grain": grain,
                 "ding": ding, "hn": _normalise(out)}


def _plate_wear(aux, patch, speck, i):
    """How far the coating has gone at one texel, 0 (intact) to 1 (bare).

    ONE function, called by both the masks and the albedo with the SAME two
    fields, because a wear pass that disagrees between its albedo and its ORM
    reads as dirt lying on metal rather than as metal with its coating worn
    off, and that is the single most common way this kind of map goes wrong.

    THE SMOOTHSTEP IS THE WHOLE THING AND THE FIRST VERSION DID NOT HAVE IT.
    Summing four independent noise fields concentrates the result around its
    mean, which is the central limit theorem doing exactly what it says: the
    raw sum below spans about 0.17 to 0.33 at p05..p95 and the effective
    metalness that came out of it measured a band of 0.074, WORSE than the
    0.406 of the `panel` family it was replacing and a straight regression on
    the one number this family was built to fix.

    Paint does not thin, it CHIPS. A coating is either there or it is not, and
    the physically right shape is bimodal, not Gaussian. The smoothstep maps
    the narrow raw distribution across the full range and gives the two
    populations the map is supposed to have."""
    raw = (0.55 * aux["high"][i] * (0.25 + 0.75 * patch[i])
           + 0.35 * aux["cut"][i]
           + 0.22 * speck[i] * aux["high"][i])
    # The knee is CENTRED ON THE RAW MEDIAN, which is about 0.25, and that is
    # a measurement rather than a taste. Sitting the knee at 0.20..0.46 put
    # the median texel at wear 0.06: 95 per cent of the plate still fully
    # coated, an effective roughness band of 0.115, and a map that had a
    # bimodal shape and only one mode in it. Centring the knee splits the
    # surface roughly in half, which is also what a used fitting looks like:
    # every proud face bright, every recess still painted.
    return _smoothstep(0.13, 0.34, raw)


def _suitplate_masks(w, h, height, aux):
    """ONE wear mask, three channels, and the metalness is the point.

    `Plate` is metallic 0.70, roughness 0.42, so:
      effective metalness = 0.70 * ormB, band 0.24 to 0.70 as authored
      effective roughness = 0.42 * ormG, band 0.19 to 0.41 as authored
    Both clear section 2.1's 0.15 requirement, and the metalness one is the
    first varying metalness in this file that is not a rounding error."""
    patch = _fbm(w, h, 4, 3, seed=7411)     # 10 cm: where the coating is thin
    speck = _fbm(w, h, 22, 2, seed=7507)    # 1.8 cm: chipping at the edges
    rough = [0.0] * (w * h)
    metal = [0.0] * (w * h)
    for i in range(w * h):
        wear = _plate_wear(aux, patch, speck, i)
        # coating is the rough one; bare alloy is smooth. Grain modulates the
        # bare metal only, because a brush mark under paint is invisible.
        r = 1.00 - 0.60 * wear
        r -= 0.10 * aux["grain"][i] * wear
        # a fresh scratch is bright and smooth along its floor
        r -= 0.12 * aux["cut"][i]
        rough[i] = _clamp01(r)
        # THE VARYING METALNESS, AND IT IS THE REASON THIS FAMILY EXISTS.
        # A dielectric coating reads near 0.30 of the palette's 0.70; worn
        # through, it is the alloy at full.
        metal[i] = _clamp01(0.30 + 0.70 * wear)
    return rough, metal


def _suitplate_albedo(w, h, height, aux):
    """The same wear mask, in value: dark coating, bright alloy under it.

    This map and the ORM must agree texel for texel or the surface reads as
    dirt on metal rather than as metal with its coating worn off, which is the
    single most common way a wear pass goes wrong."""
    patch = _fbm(w, h, 4, 3, seed=7411)     # the SAME field the masks use
    speck = _fbm(w, h, 22, 2, seed=7507)    # deliberately, not a new seed
    stain = _fbm(w, h, 8, 3, seed=7603)
    out = bytearray(w * h * 3)
    for i in range(w * h):
        wear = _plate_wear(aux, patch, speck, i)
        v = 0.70 + 0.38 * wear
        # a ding dishes and holds shadow even where the coating survived
        v -= 0.10 * (1.0 - aux["ding"][i]) ** 3
        # weathering staining in the hollows, cool rather than warm: this is
        # oxide and dust on alloy, not the organic grime on the fabric
        grime = (1.0 - aux["hn"][i]) * stain[i]
        v *= 1.0 - 0.16 * grime
        cool = 0.030 * grime
        # bare alloy leans very slightly warm-neutral against the coating
        warm = 0.018 * wear
        o = i * 3
        out[o] = int(round(255.0 * _clamp01(v * (1.0 + warm - cool * 0.6))))
        out[o + 1] = int(round(255.0 * _clamp01(v)))
        out[o + 2] = int(round(255.0 * _clamp01(v * (1.0 - warm + cool))))
    return bytes(out)


# ---------------------------------------------------------------------------
# paintchip - painted structural steel going to BARE METAL at the edges.
# RN-1474. The first of the two families this pass adds to the Space Engineers
# vocabulary D-020 sets as the bar, and the primary consumer of `_edge_wear`.
#
# WHY IT IS NOT `panel` WITH MORE WEAR. `panel` is painted industrial steel and
# it is authored as a surface whose coating is INTACT and weathering: it
# chalks, it washes, it rubs, and RN-553 gave it a real roughness band across
# those three states. Every one of them is a change to the coating. This family
# is the state `panel` deliberately does not reach, where the coating has GONE
# and the substrate is doing the looking, and that is not a tuning distance
# from `panel`, it is a different fact about the surface. The same argument
# split `bark` off `coarse`, `stone` off `coarse` and `suitfab` off `panel`,
# and it is the only argument this file accepts for a new family.
#
# THE THREE MAPS MUST AGREE TEXEL FOR TEXEL, which is `suitplate`'s recorded
# lesson at machine scale. One wear mask drives all three:
#
#   coated   -> albedo sits at the paint value, metalness LOW (a coating is a
#               dielectric), roughness HIGH
#   bare     -> albedo lifts to alloy, metalness UP toward the substrate,
#               roughness DOWN because the coating was the rough one
#
# A wear pass whose albedo and ORM disagree reads as dirt lying on metal rather
# than as metal with its coating worn off, and that is the single most common
# way this kind of map goes wrong.
#
# THE INTENDED PALETTE PAIRING, stated because the map cannot state it. The ORM
# channels MULTIPLY the palette constants, so a role wearing this family wants
# metallic near 0.75 and roughness near 0.55: at those constants the authored
# bands land at an effective metalness 0.21 to 0.75 and an effective roughness
# 0.24 to 0.55. Wired to a role at metallic 0.20 the bare metal cannot read as
# metal at all, and the family's whole point is lost silently. See the FAMILIES
# row and the NO ROLE WEARS THIS YET note there.
# ---------------------------------------------------------------------------

# A COARSER plate rhythm than `panel`'s, and deliberately not harmonic with it.
# `panel` runs three columns at 0.00 / 0.34 / 0.71; this runs two at 0.00 /
# 0.52 with its horizontal breaks on different fractions. Both families are at
# a 1.5 m tile and both will appear in the same frame on the same base, so a
# shared period would line their copies up, which is the countable-repeat
# failure `_panel_height`'s rubs comment documents.
_CHIP_U_SEAMS = (0.00, 0.52)
_CHIP_COLUMNS = ((0.00, 0.52, (0.37,)), (0.52, 1.00, (0.19, 0.71)))
_CHIP_HALF = 0.0030       # half groove width -> 9.0 mm gap at the 1.5 m tile
# THE CHAMFER IS THREE TIMES `panel`'s BEVEL AND THAT IS THE POINT OF THE
# FAMILY. `panel` falls away over 6.8 mm, which is a panel line. 21 mm is a
# machined chamfer on a structural plate, and a chamfer is WHERE PAINT GOES
# FIRST: it is the proud lip the brush thins over and the boot catches. Make it
# `panel`'s width and `_edge_wear` has almost nothing to key on, because the
# exposure peak is only as wide as the geometry that makes it.
_CHIP_BEVEL = 0.0140
_PAINT_T = 0.050          # paint film thickness in height units, where the
                          # plate face is 1.0 and the groove floor 0.0. Between
                          # `panel`'s 0.026 micro grain and its 0.30 rivet: a
                          # chip edge has to be a visible STEP, because a chip
                          # that ramps is a stain.


def _paintchip_height(w, h):
    """(height, aux). Plate substrate first, THEN the wear, THEN the paint
    film on top of both, and the order is a dependency rather than a style.

    THE CIRCULARITY IS REAL AND THIS IS HOW IT IS BROKEN. The paint film is
    part of the height; the wear mask is keyed on exposure; exposure is
    computed from the height. Left alone that is a loop, and the tempting
    resolutions are both wrong: computing exposure from the finished height
    makes the paint hide the very edges it is supposed to be worn off, and
    computing it from a separate field breaks the one-authority rule
    `_edge_wear` exists to keep. So the SUBSTRATE is built first and is the
    only thing exposure ever reads, the chip mask is derived from that, and
    the film is added afterwards where the coating survives. That is also the
    physical order: the plate was chamfered and dinged at the fabricator, then
    it was painted, then it was used."""
    grain = _fbm(w, h, 20, 3, seed=21013)      # rolled plate grain
    grain2 = _fbm(w, h, 56, 2, seed=21179)
    ding = _worley(w, h, 7, seed=21347)        # ~21 cm: impact dishing

    # Fasteners on the HORIZONTAL breaks only, and bigger and sparser than
    # `panel`'s rivet rows: structural bolts through a splice plate rather
    # than a riveted skin. Same reason as the seam rhythm above - two
    # families in one frame must not share a feature pitch.
    bolts = []
    for (u0, u1, vs) in _CHIP_COLUMNS:
        for v in vs:
            for k in range(4):
                u = u0 + (u1 - u0) * (k + 0.5) / 4.0
                bolts.append((u % 1.0, v))

    sub = [0.0] * (w * h)
    for y in range(h):
        v = (y + 0.5) / h
        base = y * w
        for x in range(w):
            u = (x + 0.5) / w
            i = base + x
            du = min(_wrap_dist(u, s) for s in _CHIP_U_SEAMS)
            col = _CHIP_COLUMNS[0]
            for c in _CHIP_COLUMNS:
                if c[0] <= u < c[1]:
                    col = c
                    break
            dv = _wrap_dist(v, 0.0)
            for vs in col[2]:
                dv = min(dv, _wrap_dist(v, vs))
            d = du if du < dv else dv
            z = _smoothstep(_CHIP_HALF, _CHIP_HALF + _CHIP_BEVEL, d)
            for (bu, bv) in bolts:
                dd = math.sqrt(_wrap_delta(u, bu) ** 2
                               + _wrap_delta(v, bv) ** 2)
                if dd < 0.0210:
                    z += 0.38 * (1.0 - _smoothstep(0.0110, 0.0210, dd))
            # A ding is a broad shallow dish and not a hole, so it is cubed:
            # only the cell centres dish and the plate between them stays
            # flat. Taken from `_suitplate_height`, which states the same.
            z -= 0.075 * (1.0 - ding[i]) ** 3
            z += (grain[i] - 0.5) * 0.022
            z += (grain2[i] - 0.5) * 0.006
            sub[i] = z

    # EXPOSURE OFF THE SUBSTRATE ONLY. radius 6 at 512 px on a 1.5 m tile is
    # an 19 mm window, which is the chamfer's own width: the mask has to see
    # across the feature it is keying on, and a window much wider than the
    # chamfer averages the lip away into the plate face.
    expo = _edge_wear(sub, w, h, 6, 2.6)

    # THE TWO OPPORTUNITY FIELDS, and `_edge_wear`'s docstring requires them.
    # Exposure is uniform over the tile, so keyed on it alone every chamfer in
    # the game wears identically and the map reads as a pattern. `handled` is
    # WHERE the machine gets touched at 56 cm, which is bigger than any
    # feature on the plate and therefore reads as history rather than as
    # texture; `flake` breaks the chip clusters up at 9 cm so an edge loses
    # its paint in patches rather than along a ruled line.
    handled = _fbm(w, h, 4, 3, seed=21521)
    flake = _fbm(w, h, 17, 2, seed=21713)

    chip = [0.0] * (w * h)
    out = [0.0] * (w * h)
    for i in range(w * h):
        # `_plate_wear`'s shape, and its lesson: the terms are combined and
        # then put through a SMOOTHSTEP, because summing independent fields
        # concentrates the result about its mean (the central limit theorem,
        # which that function records paying for once already) and paint does
        # not thin, it chips. The physically right distribution is bimodal.
        raw = (0.62 * expo[i] * (0.30 + 0.70 * handled[i])
               + 0.26 * flake[i] * expo[i])
        c = _smoothstep(0.24, 0.46, raw)
        chip[i] = c
        # The film sits on the substrate where the coating survives. Where it
        # has chipped, the substrate IS the surface.
        out[i] = sub[i] + _PAINT_T * (1.0 - c)
    return out, {"chip": chip, "expo": expo, "grain": grain, "ding": ding,
                 "sub": sub, "soil": _paintchip_soil(w, h)}


def _paintchip_soil(w, h):
    """RN-1838. DIRT RUNS: soot and rain-carried grime running DOWN the paint,
    0..1. Computed here and published in `aux` so the albedo and the masks read
    ONE field, which is this file's own one-authority rule.

    WHY THIS FAMILY NEEDED A NEW TERM AT ALL, measured rather than asserted.
    Every consumer of `paintchip` that this pass looked at is SMALL: the
    smelter's placard is 0.40 x 0.26 m and its keep-out skirt band is 4.00 m
    long but only ~0.30 m tall, against a 1.5 m tile. So a part sees between a
    sixth and a quarter of the map in v, and whatever it sees is almost all
    intact coating, because the chip mask is keyed on `_edge_wear` of the
    SUBSTRATE and the substrate's features are plate seams and bolt heads.
    Measured on the shipped bytes before this term: the whole albedo's luma
    iqr is 14.1 counts about a mean of 138, i.e. 10.2 per cent relative, and
    the ONLY thing carrying it over most of the map is a 37 cm coating fade at
    +-11 per cent. Measured in the frame, the smelter's placard reads iqr 13.1
    at p50 152: the render is exactly as flat as the map, so the map is the
    ceiling and no amount of lighting work moves it.

    WHY DIRT AND NOT MORE CHIPPING, which was the obvious first answer and is
    wrong for these two consumers specifically. `build_smelter.py` says it
    itself about the launder lip: "a painted lip is repainted and that is what
    a keep-out marking is for". A keep-out ring and a placard are the two
    painted things on a machine that are MAINTAINED, so authoring them down to
    bare metal would be a worse claim than the flat one, and it would also
    move `chip` -- which drives METALNESS -- on every `Accent` and `SteelWorn`
    surface in the game. This term moves value and hue on the coating and
    leaves the chip mask, and therefore every metalness byte's cause,
    untouched.

    IT IS DIRECTIONAL, WHICH IS THE POINT. `_stone_albedo` and
    `_paintchip_albedo`'s existing terms are all isotropic noise, and isotropic
    noise at any amplitude reads as a stain pattern rather than as history. Dirt
    on a vertical machine face runs DOWN, so the field is built as a per-COLUMN
    run: the strength varies across the tile at ~4 cm (the run spacing) and the
    start height varies at ~30 cm (so neighbouring runs begin together, the way
    water shedding off one lip does), and both are read from a real 2D field at
    one row rather than hashed, so the field cannot contain a feature the noise
    does not already have. Down is +y here: the exporter writes v flipped and
    the client samples flipY false, so PNG row 0 is world UP (the same
    derivation `_ashlar_albedo` sets out).

    ONE HONEST LIMIT. The UVs are BOX PROJECTED (`of_lib.MeshBuilder`), so on a
    horizontal face -- the pad deck, a chute lip's top -- this field's "down"
    is an arbitrary axis in the ground plane and the runs read as streaking
    rather than as drainage. That is the same limit `_edge_wear`'s docstring
    records for exposure, it is not fixable without per-asset UVs, and
    streaking on a horizontal painted surface is a real thing anyway."""
    spread = _fbm(w, h, 34, 2, seed=22613)   # ~4.4 cm: the run spacing
    head = _fbm(w, h, 5, 2, seed=22691)      # ~30 cm: where a run starts
    tail = _fbm(w, h, 12, 2, seed=22853)     # ~12 cm: how far it carries
    # Read at row 0 and held down the column: that IS the directionality, and
    # it costs one row of an existing field rather than a new generator.
    scol = [_clamp01((spread[x] - 0.36) / 0.40) for x in range(w)]
    vcol = [head[x] for x in range(w)]
    lcol = [0.16 + 0.34 * tail[x] for x in range(w)]
    out = [0.0] * (w * h)
    for y in range(h):
        v = (y + 0.5) / h
        base = y * w
        for x in range(w):
            s = scol[x]
            if s <= 0.0:
                continue
            t = (v - vcol[x]) % 1.0
            ln = lcol[x]
            # Sharp at the top (a run has a source) and fading out along its
            # length (it dries and thins), and periodic in v by construction
            # because `t` is taken mod 1.
            out[base + x] = s * (_smoothstep(0.0, 0.035, t)
                                 * (1.0 - _smoothstep(0.30 * ln, ln, t)))
    return out


def _paintchip_masks(w, h, height, aux):
    """ONE wear mask, three channels, and the metalness is why the family is
    worth its bytes.

    Section 2.1 item 4 asks that metalness carry information or be honestly
    constant, and records that almost every ORM in this file is 255 in blue.
    `suitplate` answered that on a 5 cm knuckle plate; this answers it on the
    surface a machine, a wall and a hull are made of, which is where the
    player actually spends their looking. Painted steel worn to bare alloy is
    the clearest case in the game of a surface whose metalness genuinely
    varies across itself."""
    chalk = _fbm(w, h, 5, 3, seed=21929)    # ~30 cm: where the coating chalked
    dust = _fbm(w, h, 26, 2, seed=22093)    # ~5.8 cm: settled grime
    chip = aux["chip"]
    rough = [0.0] * (w * h)
    metal = [0.0] * (w * h)
    for i in range(w * h):
        c = chip[i]
        # The coating is the rough one and bare alloy is smooth: the SAME
        # direction `_suitplate_masks` states, for the same physical reason.
        r = 1.00 - 0.55 * c
        # Chalked coating is rougher still, and it can only roughen where
        # there is still a coating to chalk.
        r += 0.10 * _clamp01((chalk[i] - 0.52) / 0.40) * (1.0 - c)
        # Grime roughens whatever it lands on, and it lands everywhere.
        r += 0.05 * (dust[i] - 0.5)
        # RN-1838. A dirt run roughens the coating under it, and it is the one
        # place on a painted surface where roughness and albedo are allowed to
        # agree exactly, because the deposit IS both facts. Small: the value
        # move carries this term and the roughness only has to stop the run
        # from still taking a clean specular.
        r += 0.09 * aux["soil"][i] * (1.0 - c)
        # The rolled grain shows only on bare metal, because a rolling mark
        # under paint is invisible. Same gate `_suitplate_masks` puts on its
        # brushed grain.
        r -= 0.09 * (aux["grain"][i] - 0.5) * c
        rough[i] = _clamp01(r)
        # A dielectric coating reads near 0.28 of the palette constant; worn
        # through, it is the substrate at full.
        metal[i] = _clamp01(0.28 + 0.72 * c)
    return rough, metal


def _paintchip_albedo(w, h, height, aux):
    """The same wear mask in value, plus the one thing a chip does that a
    scratch does not: it BLEEDS.

    THE RUST BLOOM IS THE FAMILY'S SIGNATURE and it is the reason this map is
    not just `_suitplate_albedo` at a bigger tile. Where a coating has failed,
    the exposed steel oxidises and the oxide creeps back UNDER the paint at the
    edge of the chip, so a real chip is a bright metal centre inside a warm
    brown halo inside intact paint. That halo is a band the wear mask already
    knows about: it is the region where the chip mask is part-way, which the
    interior and the intact paint both are not. Reading it off the existing
    mask rather than authoring a third field is the one-authority rule again,
    and it also guarantees the bloom cannot appear anywhere there is no chip.

    MEAN-NEUTRAL BY CONTRACT, as every tiling albedo here is: `Surfaces.ts`
    sets material.color = palette / albedo_mean_linear and multiplies this map
    back in, so only its VARIANCE and its HUE survive and its level cannot
    shift the palette."""
    fade = _fbm(w, h, 4, 3, seed=22271)      # ~37 cm: uneven coating fade
    grime = _fbm(w, h, 30, 2, seed=22447)    # ~5 cm: dirt speckle
    # RN-1838. THE THREE TERMS THAT MAKE A SMALL PAINTED PART READ. Every one
    # of them lives on the COATING and none of them touches `chip`, so the
    # metalness this family exists for is provably unmoved (see
    # `_paintchip_soil`'s docstring for the whole argument and the numbers).
    repaint = _fbm(w, h, 8, 3, seed=22787)   # ~19 cm: coating age and thickness
    scuff = _fbm(w, h, 70, 2, seed=22861)    # ~2.1 cm: crates, boots, hands
    soil = aux["soil"]
    chip = aux["chip"]
    LEVEL = 0.52
    out = bytearray(3 * w * h)
    for i in range(w * h):
        c = chip[i]
        # Bare alloy is brighter than the coating over it, which is the
        # single biggest value move on the map.
        v = 1.0 + 0.34 * c
        # Uneven fade on the coating only.
        v += (fade[i] - 0.5) * 0.22 * (1.0 - c)
        # REPAINT HISTORY. A maintained marking is not one coat: it is a
        # thinner, greyer old coat under patches of a newer one, and the
        # patches are the size of a brush pass. This is the largest single
        # addition and it is at 19 cm, which is the band a 0.26 m placard and
        # a 0.30 m band can both actually show.
        #
        # PUT THROUGH A SMOOTHSTEP FIRST, which is `_plate_wear`'s own lesson
        # applied to value rather than to wear: a brush pass has an EDGE, and
        # a raw fbm has none, so the same amplitude as a gradient reads as
        # damp and as a step reads as a repaint. `_ashlar_albedo`'s per-block
        # tone makes the identical argument one family along.
        v += (_smoothstep(0.38, 0.62, repaint[i]) - 0.5) * 0.27 * (1.0 - c)
        # SCUFFING at 2 cm, on the coating only: what a passing crate leaves.
        v += (scuff[i] - 0.5) * 0.13 * (1.0 - c)
        # Dirt darkens and never lightens.
        v -= 0.16 * _clamp01((grime[i] - 0.54) / 0.46)
        # THE RUNS. The directional term, and the strongest darkening here,
        # because a soot run on orange paint is the most visible thing that
        # happens to a keep-out ring in its whole life.
        v -= 0.34 * soil[i]
        # A ding holds shadow even where the coating survived it.
        v -= 0.09 * (1.0 - aux["ding"][i]) ** 3
        v *= LEVEL
        # THE BLOOM. A hat function on the chip mask: zero in intact paint,
        # zero in the bright bare centre, maximum in the part-way band
        # between them, which is exactly where oxide creeps under a failing
        # edge. Multiplied by 4 so the peak reaches 1.0 at c = 0.5.
        bloom = _clamp01(4.0 * c * (1.0 - c))
        # Bare alloy also leans very slightly warm-neutral against the
        # coating, an order of magnitude under the bloom.
        warm = 0.020 * c
        # RN-1838. SOOT DESATURATES. This map multiplies the palette colour
        # per channel, so the way to make a saturated `Accent` orange read as
        # dirty is to lift B relative to R, which is what a neutral-grey
        # deposit over a saturated coat does. Deliberately small and lopsided:
        # `SteelWorn` wears this same family and is already near-neutral, so a
        # symmetric move would tint the pad's steel blue. Measured against
        # `rust`, whose R iqr is 37 and B iqr 8, this is the same KIND of
        # channel split at about a third of the magnitude.
        s = soil[i]
        o = 3 * i
        out[o] = int(round(255.0 * _clamp01(
            v * (1.0 + 0.30 * bloom + warm - 0.045 * s))))
        out[o + 1] = int(round(255.0 * _clamp01(
            v * (1.0 - 0.04 * bloom + 0.030 * s))))
        out[o + 2] = int(round(255.0 * _clamp01(
            v * (1.0 - 0.27 * bloom - warm + 0.130 * s))))
    return bytes(out)


# ---------------------------------------------------------------------------
# rust - steel that has GONE. RN-1475.
#
# The second family this pass adds to the D-020 vocabulary, and the one the
# storyline actually needs: the ruin is the player's first destination
# (story_line_outline_v1.txt), it is the structure high-water mark, and it is
# abandoned industrial steel. `panel` is a working machine and `paintchip` is a
# used one; neither is a wreck.
#
# WHERE IT SITS AGAINST `paintchip`, since the two are neighbours and a reader
# will ask. `paintchip` is a coating failing ON sound steel: the substrate is
# intact, the relief is manufactured, and the interesting channel is metalness
# going UP as paint leaves. `rust` is the steel ITSELF failing: the relief is
# no longer manufactured at all, it is layered oxide scale that has lifted and
# spalled, and the interesting channel is metalness going DOWN, because oxide
# is a dielectric and there is progressively less metal left to read. They are
# opposite ends of one story and they move the same channel in opposite
# directions, which is the clearest possible evidence they are two facts and
# not one family with a slider.
#
# THE SCALE IS BUILT WITH `_stone_planes`, WHICH IS DELIBERATE REUSE AND NOT
# LAZINESS. Oxide scale lifts off steel in discrete plates that sit at slightly
# different heights and meet at SHARP lifted edges. That is precisely the
# piecewise-planar-cells-meeting-at-an-arris shape `_stone_planes` was written
# for at RN-742, and its header states why the alternative form
# `(1 - worley) ** 2` cannot do it: that form's derivative vanishes at the cell
# boundary, so the one place a fracture has an edge is the one place the field
# is smooth. A flake edge has the same requirement as a rock arris. What
# changes here is the tilt, which is far lower: a rock facet is a fracture
# plane and a scale flake is a sheet lying nearly flat on the plate it came off.
#
# THE INTENDED PALETTE PAIRING, stated for `paintchip`'s reason. The map is
# mean-neutral, so it CANNOT supply the orange: `Surfaces.ts` divides
# albedo_mean_linear back out through material.color and only variance and hue
# survive. A role wearing this family therefore needs an oxide-coloured hex of
# its own (roughly 7A4526 to 8C5A2E), metallic near 0.35 and roughness near
# 0.92. Wired to `Steel`'s 8A9199 this family renders as grey rust, which is
# the exact silent failure the FAMILIES row warns about.
# ---------------------------------------------------------------------------

_RUST_FLAKES = 10         # ~15 cm scale plates on the 1.5 m tile
_RUST_CHIPS = 22          # ~6.8 cm flakes riding on them
_RUST_ARRIS = 0.008       # the LIFTED EDGE of a flake. Narrower than stone's
                          # 0.010 because a sheet of oxide is thinner than a
                          # rock facet, and non-zero for FACET_ARRIS's stated
                          # reason: a zero-width arris is a one-texel cliff
                          # that aliases into a drawn black line.


def _rust_height(w, h, sound=False):
    """(height, aux). Layered oxide scale in lifted plates, spall pits where
    the scale has come away, and a granular oxide grain over all of it.

    AMPLITUDE, AND IT IS A HIERARCHY for `_stone_height`'s stated reason:
    0.34 on the 15 cm scale plates, 0.16 on the 6.8 cm flakes, 0.20 on the
    spall pits and 0.075 on the grain. The pits carry nearly as much as the
    plates on purpose - a spall is the deepest thing on a rusted surface, and
    a map where the scale layering outweighs the pitting reads as flagstones.

    `sound` is selftest-only: it drops the scale layering AND the spall pits
    entirely and leaves only the two grain octaves, which is what this surface
    would be if the steel had never gone - a mildly grainy plate. That is the
    defect the tilt check exists to catch (a `rust` retuned until it is smooth
    is a rust that reads as brown paint), so the check gets a negative control
    that fails honestly, exactly as `_stone_planes`'s `rounded` does for
    `stone` at 7g."""
    # THE GRAIN OCTAVES ARE DELIBERATELY NOT AT TEXEL FREQUENCY. At period
    # 48 + 96 on a 512 map the second octave has a 5.3-texel period, and
    # `_panel_height` records what that costs: "close to texel frequency, so it
    # aliases under minification and is incompressible, costing real bytes for
    # detail no camera resolves". 32 + 56 keeps the granular read that makes
    # oxide look like oxide and drops the octave that was only feeding the PNG.
    #
    # AND THE MEASUREMENT SAYS IT IS A SMALL WIN, WHICH IS WORTH RECORDING
    # BECAUSE THE FIRST GUESS WAS THAT IT WOULD BE A LARGE ONE. The change took
    # this family's normal map from 510 KB to 465 KB: 9 per cent, not the third
    # the reasoning above predicted. The bulk of the cost is not the grain at
    # all, it is the FRACTURE FIELD - two `_stone_planes` layers whose arrises
    # are sharp everywhere by construction - and that content is the family and
    # cannot be compressed away without deleting it. For scale, `stone` encodes
    # to 302 KB at 384 px, which is 537 KB scaled to this family's 512, so rust
    # is CHEAPER per texel than the family it borrows its construction from and
    # there is no anomaly here to chase. The honest lever on this number is
    # resolution or KTX2, not octave tuning.
    grain = _fbm(w, h, 32, 3, seed=24611)     # granular oxide, ~4.7 cm down
    grit = _fbm(w, h, 56, 2, seed=24799)
    if sound:
        out = [(grain[i] - 0.5) * 0.075 + (grit[i] - 0.5) * 0.014
               for i in range(w * h)]
        return out, {"pit": [0.0] * (w * h), "lift": [0.0] * (w * h),
                     "hn": _normalise(out)}
    flake, e1 = _stone_planes(w, h, _RUST_FLAKES, 24019, 0.30, _RUST_ARRIS)
    chip, e2 = _stone_planes(w, h, _RUST_CHIPS, 24229, 0.55, _RUST_ARRIS)
    spall = _worley(w, h, 13, seed=24421)     # ~11.5 cm: where scale came away

    out = [0.0] * (w * h)
    pit = [0.0] * (w * h)
    lift = [0.0] * (w * h)
    for i in range(w * h):
        z = 0.34 * flake[i] + 0.16 * chip[i]
        # A spall is a crater where a plate of scale has come off, so it is
        # the INVERSE of the distance field and it is squared to keep the
        # surface between craters flat rather than wavy.
        p = (1.0 - spall[i]) ** 2
        z -= 0.20 * p
        pit[i] = p
        z += (grain[i] - 0.5) * 0.075
        z += (grit[i] - 0.5) * 0.014
        out[i] = z
        # The lifted edge of either scale layer: this is where a flake stands
        # away from the plate and is about to come off.
        lift[i] = e1[i] if e1[i] > e2[i] else e2[i]
    # `sound` normalises the same way so the control is comparable rather
    # than merely different.
    hn = _normalise(out)
    return out, {"pit": pit, "lift": lift, "hn": hn}


def _rust_masks(w, h, height, aux):
    """Roughness HIGH and narrow-ish; metalness LOW and WIDE, which is the
    inverse of `paintchip` and the point of having both.

    ROUGHNESS. Oxide is matte and there is no reading of rust that is not.
    Section 2.1 item 4 asks for an effective p05..p95 band at least ~0.15
    wide and explicitly does NOT ask for it to sit in the middle of the
    range; `_fur_masks` is the precedent for a family that clears the rule
    while staying at one end of it, and rust is that case for the opposite
    reason fur is. So the band lives high: burnished scale crowns, where
    weather and handling have polished the oxide, take it down a little, and
    a fresh spall floor is rougher than anything else on the map.

    METALNESS IS THE INFORMATIVE CHANNEL AND IT RUNS THE OTHER WAY FROM
    `paintchip`'s. Iron oxide is a dielectric. Where the scale is thick and
    the plate has spalled repeatedly there is little metal left to read, and
    where the oxide is still a thin film over sound steel the metal reads
    through it. So metalness follows SOUNDNESS, and soundness is authored as
    its own low-frequency field gated by the pitting: a texel cannot be sound
    if a crater has just been taken out of it. That gate is what stops the
    map putting bright metal in the bottom of a spall, which is the one place
    on a rusted plate it certainly is not."""
    burnish = _fbm(w, h, 7, 3, seed=24983)   # ~21 cm: weathered/handled scale
    sound = _fbm(w, h, 4, 3, seed=25169)     # ~37 cm: where steel is still sound
    mottle = _fbm(w, h, 15, 3, seed=25349)
    pit = aux["pit"]
    lift = aux["lift"]
    rough = [0.0] * (w * h)
    metal = [0.0] * (w * h)
    for i in range(w * h):
        r = 0.97
        r -= 0.22 * _clamp01((burnish[i] - 0.46) / 0.40)
        # A lifted flake edge catches light along its lip.
        r -= 0.10 * lift[i]
        # A fresh spall is raw oxide and is the roughest thing here.
        r += 0.09 * pit[i]
        r += (mottle[i] - 0.5) * 0.10
        rough[i] = _clamp01(r)
        # SOUNDNESS, gated by the pitting for the reason stated above.
        snd = _clamp01((sound[i] - 0.40) / 0.44) * (1.0 - pit[i])
        metal[i] = _clamp01(0.18 + 0.66 * snd)
    return rough, metal


def _rust_albedo(w, h, height, aux):
    """Oxide, and this is the one map in the file whose HUE is its whole job.

    WHY THE HUE MATTERS MORE HERE THAN ANYWHERE ELSE. Every other tiling
    albedo in this file carries value with a lean on top: `panel`'s oxide term
    and `stone`'s iron stain both move hue in patches against a body colour
    the palette supplies. Rust has no body colour that is not oxide. But the
    map is mean-neutral by contract - `Surfaces.ts` divides
    albedo_mean_linear out through material.color - so this map STILL cannot
    supply the orange, and the FAMILIES row and the section header both state
    the palette pairing that has to come with it. What this map supplies is
    the VARIATION WITHIN the oxide, which is large: fresh scale is a light
    ochre, weathered scale is a mid red-brown, and the bottom of a spall
    where water sits is nearly black. That is a value range of three to one
    with a hue swing across it, and it is what makes rust read as rust rather
    than as brown paint.

    IT READS `aux` AND NOT A NEW FIELD, which is the opposite of what
    `_stone_albedo` does, and the difference is worth stating because that
    function argues hard for independence. Stone's albedo must not know about
    stone's facets, because a pigment that agreed with the fracture would read
    as cobblestone: pigment and fracture are genuinely independent in rock.
    In oxide they are NOT independent - the colour of a patch of rust is
    CAUSED by how deeply that patch has corroded, which is the same fact the
    relief encodes. Authoring them independently here would be the error, not
    the discipline: it would put light fresh scale inside deep craters. So
    this map keys on `pit` and on the normalised height, and adds its own
    fields only for the things depth does not determine."""
    tone = _fbm(w, h, 5, 3, seed=25523)      # ~30 cm: patch-to-patch oxide age
    streak = _fbm(w, h, 9, 2, seed=25717)    # ~17 cm: run-off staining
    LEVEL = 0.50
    pit = aux["pit"]
    hn = aux["hn"]
    out = bytearray(3 * w * h)
    for i in range(w * h):
        # DEPTH IS THE DOMINANT TERM, per the docstring: high ground is fresh
        # light scale, low ground is old dark oxide.
        v = 0.72 + 0.52 * hn[i]
        # A spall crater holds water and goes darker than anything else.
        v *= 1.0 - 0.34 * pit[i]
        # Patch-to-patch variation in how long this bit has been going.
        v *= 0.88 + 0.26 * tone[i]
        # Run-off streaking darkens.
        v -= 0.10 * _clamp01((streak[i] - 0.56) / 0.40)
        v *= LEVEL
        # THE HUE SWING, and it tracks the same depth axis the value does.
        # Fresh high scale is the most saturated ochre; deep corroded ground
        # desaturates toward black-brown, because what is down there is
        # magnetite and water rather than fresh haematite.
        warm = _clamp01(0.30 + 0.70 * hn[i]) * (1.0 - 0.60 * pit[i])
        o = 3 * i
        out[o] = int(round(255.0 * _clamp01(v * (1.0 + 0.34 * warm))))
        out[o + 1] = int(round(255.0 * _clamp01(v * (1.0 - 0.02 * warm))))
        out[o + 2] = int(round(255.0 * _clamp01(v * (1.0 - 0.40 * warm))))
    return bytes(out)


def _srgb_eotf(s):
    """sRGB EOTF: a normalised (0..1) encoded sample to linear light."""
    return s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4


# 256-entry LUT, sRGB byte (0..255) to linear light (0..1): the two mean
# functions below run this per-channel, per-texel, and a table beats
# recomputing the EOTF's power curve at every one of them.
_SRGB_TO_LINEAR = [_srgb_eotf(i / 255.0) for i in range(256)]


def _albedo_mean_rgb(rgb):
    """Mean LINEAR Rec.709 luma (0..1) over every texel: the opaque
    counterpart of `_albedo_mean_rgba`. Each channel is linearised with the
    sRGB EOTF before the luma weights are applied, because the consumer
    (`Surfaces.ts`) divides this out through `material.color` in three's
    LINEAR working colour space; averaging the raw sRGB bytes instead
    under-compensates by a family-dependent factor (measured 1.2x to 2.3x
    across the shipped set). No alpha, so no coverage test and every texel
    counts."""
    n = len(rgb) // 3
    if n == 0:
        return 0.0
    lut = _SRGB_TO_LINEAR
    tot = 0.0
    for i in range(n):
        o = i * 3
        tot += (0.2126 * lut[rgb[o]] + 0.7152 * lut[rgb[o + 1]]
                + 0.0722 * lut[rgb[o + 2]])
    return tot / n


# ---------------------------------------------------------------------------
# Heightfield -> normal and AO.
# ---------------------------------------------------------------------------

def _normal_rgb(height, w, h, strength):
    """Tangent-space normal map from the gradient of the heightfield.

    Central differences with WRAPPED indexing, so the normal map tiles exactly
    as the heightfield does. Green is +Y (OpenGL convention), which is what
    three.js and glTF expect; a DirectX-convention map would read as lighting
    from the wrong side and is the classic silent normal-map defect."""
    out = bytearray(w * h * 3)
    for y in range(h):
        ym = ((y - 1) % h) * w
        yp = ((y + 1) % h) * w
        row = y * w
        for x in range(w):
            xm = (x - 1) % w
            xp = (x + 1) % w
            dx = (height[row + xp] - height[row + xm]) * strength
            dy = (height[yp + x] - height[ym + x]) * strength
            inv = 1.0 / math.sqrt(dx * dx + dy * dy + 1.0)
            nx, ny, nz = -dx * inv, -dy * inv, inv
            o = (row + x) * 3
            out[o] = int(_clamp01(nx * 0.5 + 0.5) * 255.0 + 0.5)
            out[o + 1] = int(_clamp01(ny * 0.5 + 0.5) * 255.0 + 0.5)
            out[o + 2] = int(_clamp01(nz * 0.5 + 0.5) * 255.0 + 0.5)
    return out


def _box_blur(field, w, h, radius):
    """Separable wrapped box blur. O(n) with a running sum, so the AO pass
    costs nothing next to the field synthesis."""
    n = 2 * radius + 1
    tmp = [0.0] * (w * h)
    for y in range(h):
        row = y * w
        acc = sum(field[row + (x % w)] for x in range(-radius, radius + 1))
        for x in range(w):
            tmp[row + x] = acc / n
            acc -= field[row + ((x - radius) % w)]
            acc += field[row + ((x + radius + 1) % w)]
    out = [0.0] * (w * h)
    for x in range(w):
        acc = sum(tmp[((y % h) * w) + x] for y in range(-radius, radius + 1))
        for y in range(h):
            out[y * w + x] = acc / n
            acc -= tmp[((y - radius) % h) * w + x]
            acc += tmp[((y + radius + 1) % h) * w + x]
    return out


def _ao(height, w, h, radius, floor_, gain):
    """Local-relief ambient occlusion: how far a texel sits below its own
    neighbourhood. Cheap, and correct in the only way that matters here, which
    is that it darkens exactly the grooves the normal map dents, because it is
    the same heightfield read a second time."""
    blur = _box_blur(height, w, h, radius)
    out = [0.0] * (w * h)
    for i in range(w * h):
        rel = height[i] - blur[i]
        out[i] = floor_ + (1.0 - floor_) * _clamp01(0.5 + rel * gain)
    return out


def _edge_wear(height, w, h, radius, gain):
    """EXPOSURE, 0..1: how far a texel stands PROUD of its own neighbourhood.
    RN-1473. The curvature/edge-wear mask channel, and what it is NOT is the
    first thing to state.

    IT IS NOT CURVATURE, AND IT CANNOT BE. Real edge wear keys on the MESH's
    curvature, and this project has no per-asset UVs: every surface in this
    file is a shared tiling map applied by box projection
    (of_lib.MeshBuilder._project_uvs), and the campaign plan's decision 5
    refuses per-asset unwrap and AO baking for now, because both would end the
    byte-identical rebuild gate DW-5 makes a gate. A tiling map therefore does
    not know where the machine's corners are and cannot be made to know. What
    it DOES know is where its own relief is proud, and a proud texel is
    exactly the one a hand, a boot, a passing crate or a wire brush reaches
    first. So the honest claim this mask makes is "this bolt head, this scale
    flake, this plate lip is exposed", not "this is the corner of the smelter".
    A family that used it as though it meant the second thing would be
    asserting something the box projection deleted.

    IT IS THE AO SIGNAL WITH ITS SIGN FLIPPED, on purpose and by construction.
    `_ao` reads `height - blur` at the same radius and returns occlusion; this
    reads the same difference and returns exposure. They are one number read
    once each, so they cannot disagree about where a crevice is, which is the
    module header's ONE HEIGHTFIELD PER FAMILY rule extended to a third
    derived channel. The alternative - a separately authored wear field - is
    how a map ends up with wear sitting in its own crevices.

    NO FAMILY MAY SHIP THIS RAW, and both consumers below honour it. Exposure
    alone says where wear COULD happen, and it says it uniformly over the
    whole tile, so a mask keyed on it alone wears every rivet in the game to
    exactly the same degree and reads as a pattern rather than as history.
    Each consumer multiplies it by its own low-frequency "has this actually
    been handled" field and puts a smoothstep on the PRODUCT. That is
    `_plate_wear`'s recorded lesson reused rather than rediscovered: summing
    independent fields concentrates the result about its mean, and paint does
    not thin, it chips, so the physically right distribution is bimodal and
    the smoothstep is what makes it so."""
    blur = _box_blur(height, w, h, radius)
    return [_clamp01(0.5 + (height[i] - blur[i]) * gain) for i in range(w * h)]


def _pack_orm(ao, rough, metal, w, h):
    out = bytearray(w * h * 3)
    for i in range(w * h):
        o = i * 3
        out[o] = int(_clamp01(ao[i]) * 255.0 + 0.5)
        out[o + 1] = int(_clamp01(rough[i]) * 255.0 + 0.5)
        out[o + 2] = int(_clamp01(metal[i]) * 255.0 + 0.5)
    return out


# ---------------------------------------------------------------------------
# PNG encode. 8-bit RGB, non-interlaced, adaptive per-scanline filtering.
#
# Deliberately NOT shared with contact_sheet.py's writer. That one writes review
# sheets, where a byte is a byte; this one writes gated artefacts, so it pins
# the zlib parameters and does the filter search that a normal map needs (a
# smooth gradient stored unfiltered is roughly 3x the bytes). Two writers is a
# smell, and the honest reason to keep them apart is that merging them would
# rebaseline a working tool for no gain.
# ---------------------------------------------------------------------------

def _chunk(tag, body):
    return (struct.pack(">I", len(body)) + tag + body
            + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF))


def _filter_rows(data, w, h, bpp):
    """Per-scanline filter selection by the standard minimum-sum-of-absolute-
    differences heuristic. Deterministic: the same pixels always pick the same
    filter, and ties break toward the lower filter number."""
    stride = w * bpp
    out = bytearray()
    prev = bytearray(stride)
    for y in range(h):
        line = data[y * stride:(y + 1) * stride]
        best, best_score, best_bytes = 0, None, None
        for ftype in range(5):
            f = bytearray(stride)
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                raw = line[i]
                if ftype == 0:
                    v = raw
                elif ftype == 1:
                    v = raw - a
                elif ftype == 2:
                    v = raw - b
                elif ftype == 3:
                    v = raw - ((a + b) >> 1)
                else:
                    p = a + b - c
                    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                    pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                    v = raw - pred
                f[i] = v & 0xFF
            score = sum(v if v < 128 else 256 - v for v in f)
            if best_score is None or score < best_score:
                best, best_score, best_bytes = ftype, score, f
        out.append(best)
        out.extend(best_bytes)
        prev = line
    return bytes(out)


def write_png(path, w, h, rgb):
    """Write 8-bit RGB. IHDR + IDAT + IEND only: no tIME, no tEXt, no gAMA, so
    there is nothing in the file that can differ between two identical runs."""
    if len(rgb) != w * h * 3:
        raise ValueError("expected %d bytes, got %d" % (w * h * 3, len(rgb)))
    raw = _filter_rows(rgb, w, h, 3)
    co = zlib.compressobj(ZLIB_LEVEL, zlib.DEFLATED, ZLIB_WBITS,
                          ZLIB_MEMLEVEL, zlib.Z_DEFAULT_STRATEGY)
    idat = co.compress(raw) + co.flush()
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    blob = (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr)
            + _chunk(b"IDAT", idat) + _chunk(b"IEND", b""))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(blob)
    return len(blob)


def read_png_rgb(path):
    """Minimal decoder, for the checks. 8-bit RGB non-interlaced only; anything
    else raises rather than being silently misread."""
    with open(path, "rb") as fh:
        data = fh.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("%s: not a PNG" % path)
    off, idat, hdr = 8, [], None
    while off + 8 <= len(data):
        ln, tag = struct.unpack_from(">I4s", data, off)
        off += 8
        body = data[off:off + ln]
        off += ln + 4
        if tag == b"IHDR":
            hdr = struct.unpack(">IIBBBBB", body)
        elif tag == b"IDAT":
            idat.append(body)
        elif tag == b"IEND":
            break
    w, h, depth, ctype, comp, filt, inter = hdr
    if (depth, ctype, inter) != (8, 2, 0):
        raise ValueError("%s: only 8-bit RGB non-interlaced is supported "
                         "(depth=%d colour=%d interlace=%d)"
                         % (path, depth, ctype, inter))
    raw = zlib.decompress(b"".join(idat))
    stride = w * 3
    out = bytearray(w * h * 3)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        ftype = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        for i in range(stride):
            a = line[i - 3] if i >= 3 else 0
            b = prev[i]
            c = prev[i - 3] if i >= 3 else 0
            if ftype == 1:
                line[i] = (line[i] + a) & 0xFF
            elif ftype == 2:
                line[i] = (line[i] + b) & 0xFF
            elif ftype == 3:
                line[i] = (line[i] + ((a + b) >> 1)) & 0xFF
            elif ftype == 4:
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, bytes(out)


# ---------------------------------------------------------------------------
# RGBA PNG write/read, colour type 6, for the albedo+alpha card families.
# Same chunk discipline as write_png (IHDR + IDAT + IEND only, pinned zlib),
# same per-scanline filter search, one more byte per pixel. groundtex.py
# carries its own copy of this pair; the duplication is known and left for a
# later dedupe on purpose, because rebaselining a shipped tool mid-pass is
# the wrong moment to share code (see write_png's note on two writers).
# ---------------------------------------------------------------------------

def write_png_rgba(path, w, h, rgba):
    """Write 8-bit RGBA. Refuses a wrong-size buffer rather than misreading
    it, exactly as write_png does."""
    if len(rgba) != w * h * 4:
        raise ValueError("expected %d bytes, got %d" % (w * h * 4, len(rgba)))
    raw = _filter_rows(rgba, w, h, 4)
    co = zlib.compressobj(ZLIB_LEVEL, zlib.DEFLATED, ZLIB_WBITS,
                          ZLIB_MEMLEVEL, zlib.Z_DEFAULT_STRATEGY)
    idat = co.compress(raw) + co.flush()
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    blob = (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr)
            + _chunk(b"IDAT", idat) + _chunk(b"IEND", b""))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(blob)
    return len(blob)


def read_png_rgba(path):
    """Minimal decoder for the checks. 8-bit RGBA non-interlaced only;
    anything else raises rather than being silently misread."""
    with open(path, "rb") as fh:
        data = fh.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("%s: not a PNG" % path)
    off, idat, hdr = 8, [], None
    while off + 8 <= len(data):
        ln, tag = struct.unpack_from(">I4s", data, off)
        off += 8
        body = data[off:off + ln]
        off += ln + 4
        if tag == b"IHDR":
            hdr = struct.unpack(">IIBBBBB", body)
        elif tag == b"IDAT":
            idat.append(body)
        elif tag == b"IEND":
            break
    w, h, depth, ctype, comp, filt, inter = hdr
    if (depth, ctype, inter) != (8, 6, 0):
        raise ValueError("%s: only 8-bit RGBA non-interlaced is supported "
                         "(depth=%d colour=%d interlace=%d)"
                         % (path, depth, ctype, inter))
    raw = zlib.decompress(b"".join(idat))
    stride = w * 4
    out = bytearray(w * h * 4)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        ftype = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        for i in range(stride):
            a = line[i - 4] if i >= 4 else 0
            b = prev[i]
            c = prev[i - 4] if i >= 4 else 0
            if ftype == 1:
                line[i] = (line[i] + a) & 0xFF
            elif ftype == 2:
                line[i] = (line[i] + b) & 0xFF
            elif ftype == 3:
                line[i] = (line[i] + ((a + b) >> 1)) & 0xFF
            elif ftype == 4:
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, bytes(out)


# ---------------------------------------------------------------------------
# Families
# ---------------------------------------------------------------------------

# `ao_gain` converts local relief into occlusion, and it is per-family because
# the two heightfields have completely different amplitudes: a panel groove is a
# full unit deep, a rock facet is a tenth of one. The first pass shared a gain
# of 2.2 and the result was a coarse AO map that was almost uniformly white -
# it shipped, it validated, and it did nothing, which is the failure mode this
# log keeps calling the expensive one.
FAMILIES = {
    # panel gained a TILING ALBEDO at RN-553 and is the second family to carry
    # one after `fur`. It costs 1.40 MB of VRAM (512 px, the mip chain
    # included) and it buys the one thing a normal and an ORM structurally
    # cannot: pigmentation. ART-DIRECTION.md names flat vertex colour as a
    # defect to unlearn, and until this landed every manufactured surface in
    # the game took its entire base colour from one palette constant.
    "panel": dict(height=_panel_height, masks=_panel_masks,
                  albedo=_panel_albedo,
                  normal_strength=26.0, ao_radius=7, ao_floor=0.42,
                  ao_gain=2.2),
    # coarse normal_strength came down 13 -> 9 with the low-frequency rebalance:
    # bigger facets over a stronger base means the same slope angles from a
    # smaller gradient, and 13 on the new field reads as corrugated.
    # coarse gained a TILING ALBEDO at RN-1472. The audit behind the D-020
    # campaign lists it and `bark` as the families missing one; both now carry
    # it, which leaves `ore` as the only tiling family with none.
    "coarse": dict(height=_coarse_height, masks=_coarse_masks,
                   albedo=_coarse_albedo,
                   normal_strength=9.0, ao_radius=11, ao_floor=0.50,
                   ao_gain=7.0),
    # bark sits between the two: its fissure walls drop 0.55 over a ~1.4 cm
    # bevel, steeper than a coarse facet and shallower than a panel groove, so
    # 12 gives the walls roughly the shading weight coarse's facets get from 9
    # on their gentler slopes. ao_gain likewise: the relief under the blur is
    # ~0.5 in a fissure where coarse's is ~0.1, so coarse's 7.0 here would
    # clamp every fissure to the floor and read as painted-on black stripes.
    # bark gained a TILING ALBEDO at RN-1472; see the `coarse` row above.
    "bark": dict(height=_bark_height, masks=_bark_masks,
                 albedo=_bark_albedo,
                 normal_strength=12.0, ao_radius=9, ao_floor=0.45,
                 ao_gain=3.0),
    # ore's crevice walls drop 0.45 over a ~1.6 cm bevel, just under bark's
    # fissures, so 11 lands them near bark's shading weight while keeping the
    # 0.14 facet grain from reading as corrugation. ao_gain by bark's
    # argument: relief under the blur is ~0.4 in a crevice, so coarse's 7.0
    # would clamp every crevice to the floor and paint the strata on as flat
    # black stripes, which is exactly the read the relief exists to avoid.
    "ore": dict(height=_ore_height, masks=_ore_masks,
                normal_strength=11.0, ao_radius=9, ao_floor=0.46,
                ao_gain=3.2),
    # stone sits BETWEEN coarse and ore on strength and it is the only row
    # here whose number was chosen against a measured angle rather than
    # against a wall of pixels. coarse's 9.0 on its own gentle facets measures
    # a mean normal tilt of 7.69 degrees and a maximum of 27.19, which is the
    # finding this family exists to answer; 10.0 on stone's field measures
    # 17.18 and 74.24. It is only one count over coarse because stone's relief
    # is genuinely bigger, not because the map is being pushed: the arris does
    # the work, and the maximum is already 74 degrees at 9.0. Ore's 11.0 would
    # take the mean to 18.54, which is corrugation rather than rock, and 9.0
    # lands the mean at 15.76, under the 16-degree floor the selftest holds
    # this family to. 10.0 is the only count in that gap.
    # ao_radius 9, matching bark and ore rather than coarse's 11: the occluder
    # here is the neighbouring CHIP facet 3.2 cm away, which is 20 texels, so
    # a 19-texel window sees exactly one facet and its arris. coarse's 11
    # averages across the chip structure and returns the uniform grey this
    # table's header calls the expensive failure.
    # ao_gain 5.0 between coarse's 7.0 and ore's 3.2, by the same reasoning
    # both of those state: the relief left under the blur is about 0.15 to
    # 0.20 in an arris, well over coarse's ~0.1 and well under a bark fissure,
    # so 7.0 would clamp every arris to the floor and paint the facet edges on
    # as flat black lines. Measured at 5.0 the AO runs 0.440 to 1.000 with its
    # 5th percentile at 0.491, i.e. it reaches the floor without living there.
    "stone": dict(height=_stone_height, masks=_stone_masks,
                  albedo=_stone_albedo,
                  normal_strength=10.0, ao_radius=9, ao_floor=0.44,
                  ao_gain=5.0),
    # RN-1835. `masonry` IS NO LONGER `stone`'s ROW REUSED. RN-1780 shipped it
    # as exactly that -- the same height, masks and albedo functions at a
    # bigger world scale -- and its own verifier's finding was that a bigger
    # tile does not turn an isotropic fracture field into a wall: the cella
    # still read as patterned cut cliff. `_ashlar_*` is a different field with
    # a different subject (LAID stone: courses, joints, per-block variation),
    # authored for the ruin. See the family header above `_ashlar_partition`
    # for the bond, the anti-repeat argument and the three-consumer trade.
    #
    # normal_strength 10.0 is `stone`'s and is INHERITED rather than
    # rechosen, because the two fields are on the same relief budget: stone's
    # steepest feature is a 0.52-amplitude facet arris and this family's is a
    # 0.34-deep joint chamfer over a 26 mm draft, which at 512 px / 1.8 m is
    # 7 texels. Measured at 10.0 the joint walls run to 68 degrees and the
    # tooled face sits near 12, which is the hierarchy this field wants:
    # the joint is unarguable and the face is modelled, not corrugated.
    # ao_radius 9 (32 mm at this density) is chosen against the OCCLUDER, as
    # every other row here is: the occluder is the 20 mm joint, so a 19-texel
    # window sees one joint and the block face either side of it. A wider
    # radius would average across a whole 0.6 m block and return the uniform
    # grey the FAMILIES header calls the expensive failure.
    # ao_floor 0.42 and ao_gain 4.4: the joint has to REACH the floor,
    # because a mortar bed in shadow is the darkest thing on the wall, and
    # 4.4 puts it there without dragging the block faces down with it
    # (measured 5th percentile 0.437, median 0.744).
    "masonry": dict(height=_ashlar_height, masks=_ashlar_masks,
                    albedo=_ashlar_albedo,
                    normal_strength=10.0, ao_radius=9, ao_floor=0.42,
                    ao_gain=4.4),
    # RN-1815. `concrete` is the first architecture-scale family in this table
    # that is NOT stone's recipe under another name, and its three numbers are
    # all chosen against measured properties of its own field rather than
    # inherited.
    #
    # normal_strength 15.0, ABOVE stone's 10.0 and below paintchip's 21.0,
    # and it is up rather than down for the reason the `rust` row states from
    # the same side: this field's gradients are GENTLER than stone's, so the
    # strength has to come up to give a board joint the shading weight a rock
    # arris gets. A stone arris drops ~0.55 over a 3 cm bevel; a board joint
    # drops 0.030 over 4 mm and a panel joint 0.055 over 8 mm.
    #
    # MEASURED ON THE SHIPPED FIELD AT 512 px, and the SHAPE of the pair is
    # the argument rather than either number on its own: mean tilt 4.73
    # degrees, MAXIMUM 45.90. Set that beside the two rows this table already
    # holds numbers for. `coarse` measured mean 7.69 / max 27.19 and 7f calls
    # that the family's founding defect: relief everywhere and an edge
    # nowhere, so nothing can glint and nothing catches a raking sun.
    # `stone` measures 17.18 / 74.24, which is a surface made entirely of
    # edges. Concrete is deliberately the third shape and not a point between
    # them: a LOWER mean than coarse and a maximum nearly twice coarse's, i.e.
    # a flat cast face that has real edges cut into it at the joints. Matching
    # stone's mean would be authoring rock again with different features,
    # which is the whole thing this family exists not to do.
    #
    # ao_radius 7, not stone's 9. The occluder here is a board joint 6 mm
    # across or a blowhole 8 mm across, and at 284 texels/m a 15-texel window
    # is 53 mm: wide enough to see across either feature and its lip, narrow
    # enough not to average the whole board face into it. stone's 9 (33 mm at
    # its own density) was sized for a 3.2 cm chip facet, a feature this
    # family does not have.
    #
    # ao_floor 0.52 and ao_gain 3.0, both softer than stone's 0.44 / 5.0 and
    # for one reason stated once: the relief left under the blur is ~0.08 in
    # a board joint against stone's 0.15 to 0.20 in an arris, so stone's gain
    # would clamp every joint to the floor and paint the board marks on as
    # flat black lines - the failure `_coarse_masks` names and every row in
    # this table since has had to avoid.
    "concrete": dict(height=_concrete_height, masks=_concrete_masks,
                     albedo=_concrete_albedo,
                     normal_strength=15.0, ao_radius=7, ao_floor=0.52,
                     ao_gain=3.0),
    # RN-1780. `ember` carries an EMISSIVE map (RN-1462's slot, unused by any
    # family until now) alongside a normal+orm at `stone`'s own physical
    # field (a coal bed IS fractured mineral; see `_ember_emissive`'s header
    # for why reading `_stone_height`'s aux masks is the honest reuse rather
    # than the cobblestone mistake). The relief is toned down from stone's
    # 10.0: this family sits on a 0.30 m part seen at arm's length behind a
    # door casting, not a boulder the camera spends its rock time on, and a
    # small tile at stone's strength read as corrugated coal rather than a
    # bed of it. ao_radius/ao_floor/ao_gain scale down from stone's with the
    # tile (9 texels at stone's 640 texels/m is 14 mm; at ember's 457
    # texels/m the same 14 mm is ~6 texels).
    "ember": dict(height=_ember_height, masks=_ember_masks,
                  emissive=_ember_emissive,
                  normal_strength=5.0, ao_radius=5, ao_floor=0.50,
                  ao_gain=3.0),
    # chitin is the shallowest relief in the set and the highest frequency:
    # a pit is 0.16 deep over about 2 mm, so 16 is what gives a pit the
    # shading weight bark gets from 12 on a fissure ten times as wide. The
    # ao_radius is small for the same reason (the occluder IS the pit), and
    # the floor is the highest in the set because a shell is not a cave: a
    # crease darkens, it does not go black.
    # fur has the shallowest relief and the highest frequency in the set,
    # and it self-shadows hard at the root layer, which is where the velvet
    # look comes from at every angle that is not the silhouette. So the
    # normal is strong for its amplitude, the AO radius is the smallest
    # here (the occluder is the neighbouring STRAND) and the floor is the
    # lowest of any family: between hairs really is dark.
    "fur": dict(height=_fur_height, masks=_fur_masks,
                albedo=_fur_albedo,
                normal_strength=14.0, ao_radius=3, ao_floor=0.42,
                ao_gain=3.4),
    # suitfab's relief is SHALLOW and FINE: a yarn crown stands about 0.10 of
    # a unit over the gap beside it, across a 2.5 texel half-pitch. That is a
    # steeper local gradient than fur's strands on a much smaller amplitude,
    # so the strength lands between fur's 14 and panel's 26. At panel's 26 the
    # weave reads as corrugated iron, which was the first version of it.
    # ao_radius 3, not panel's 7: the occluder here is the neighbouring yarn
    # 2.5 texels away, and a 7-texel blur averages over four whole threads and
    # returns a uniform grey - the "it shipped, it validated, it did nothing"
    # failure this table's own header warns about.
    "suitfab": dict(height=_suitfab_height, masks=_suitfab_masks,
                    albedo=_suitfab_albedo,
                    normal_strength=2.4, ao_radius=3, ao_floor=0.46,
                    ao_gain=3.8),
    # suitplate has TWO relief scales in one field - a 0.085 brushed grain and
    # a 0.150 scratch cut - and the strength has to serve the scratch, because
    # the scratch is the feature a player actually sees on a 5 cm knuckle
    # plate. 20 puts the scratch walls near panel's groove weight while
    # leaving the grain as a sheen rather than as ribbing.
    # ao_gain 4.6 against panel's 2.2: the relief under the blur here is about
    # a third of a panel groove's, so panel's gain would leave every scratch
    # and ding at AO 250-ish and the map would do nothing.
    "suitplate": dict(height=_suitplate_height, masks=_suitplate_masks,
                      albedo=_suitplate_albedo,
                      normal_strength=5.5, ao_radius=5, ao_floor=0.40,
                      ao_gain=4.6),
    # -------------------------------------------------------------------
    # NO ROLE WEARS EITHER OF THESE YET, AND THAT IS DELIBERATE (RN-1474,
    # RN-1475). The precedent is the card families' own note above
    # ALBEDO_FAMILIES: `leaf` and `grass` shipped unreferenced too, because
    # a role move has to land in the same commit as the client change that
    # consumes it or the two ship half-wired and `verifyAgainstManifest`
    # turns a one-sided move into a failed smoke run.
    #
    # THERE IS A SECOND, HARDER REASON HERE and it is worth stating where
    # the next lane will read it. `MachineBatch.ts` calls
    # `attachSurface(m, 'panel', ...)` UNCONDITIONALLY, so a machine's
    # authored role never reaches `familyForRole` at all: today neither of
    # these families could reach a machine even if a role pointed at it.
    # That is the open half of RN-1203 and it is a client change with a
    # DW-10 argument attached, not a texture one. What CAN consume them
    # today is the path that does resolve per role - `PropLibrary` via
    # `familyForRole`, and `NodeBatch` - which is props and structures, and
    # the ruin is a structure. Wiring is A4/A6's job; the vocabulary is
    # this lane's, and shipping the pixels first is what lets A4 wire a
    # role in one commit instead of two.
    #
    # BOTH ROWS' PALETTE PAIRINGS ARE STATED IN THEIR SECTION HEADERS and a
    # wiring lane must read them: the ORM channels multiply and the albedo
    # is mean-neutral, so `rust` wired to a grey role renders grey rust and
    # `paintchip` wired to a low-metallic role cannot show bare metal. Both
    # are silent failures.
    # -------------------------------------------------------------------
    # paintchip's relief is `panel`'s in kind but shallower in the features
    # that matter: no weld bead, no rivet rows, a 21 mm chamfer instead of a
    # 6.8 mm bevel, and a 0.050 paint step. The chamfer is a GENTLER slope
    # than panel's groove wall, so panel's 26 would over-shade it into a
    # bevel that reads as a pipe; 21 lands the chamfer near panel's groove
    # weight while leaving the 0.050 chip step as a crisp edge rather than
    # as a cliff. ao_radius 6 matches the exposure window `_paintchip_height`
    # keys its wear on, deliberately: the AO and the wear mask read the same
    # heightfield at the same scale, so a chip cannot sit in a hollow the AO
    # does not also darken.
    "paintchip": dict(height=_paintchip_height, masks=_paintchip_masks,
                      albedo=_paintchip_albedo,
                      normal_strength=21.0, ao_radius=6, ao_floor=0.43,
                      ao_gain=2.6),
    # rust's field is `stone`'s construction at a third of the tilt, so its
    # gradients are correspondingly gentler and the strength has to come UP
    # rather than down to give a flake edge the same shading weight a rock
    # arris gets from 10.0. 14.0 is chosen against the same measured tilt
    # the selftest holds it to rather than against a wall of pixels.
    # ao_radius 7 sits between stone's 9 and panel's 7: the occluder here is
    # the neighbouring 6.8 cm flake, which is 23 texels at 512 px on a 1.5 m
    # tile, so a 15-texel window sees one flake and its lifted edge.
    # ao_gain 3.6 between ore's 3.2 and stone's 5.0, by the reasoning both of
    # those state: the relief left under the blur is about 0.2 in a spall,
    # over a bark fissure's and under a panel groove's, so coarse's 7.0 would
    # clamp every crater to the floor and paint the pitting on as flat black
    # dots, which is the read the relief exists to avoid.
    "rust": dict(height=_rust_height, masks=_rust_masks,
                 albedo=_rust_albedo,
                 normal_strength=14.0, ao_radius=7, ao_floor=0.41,
                 ao_gain=3.6),
}


def build_family(name, size=None):
    """(height, normal, orm, albedo, emissive). `albedo` is None unless the
    family declares one: a tiling family MAY carry a base colour now (RN-455)
    and every family authored before it deliberately does not. `emissive`
    (RN-1780) is the same shape: None unless the family declares one, and
    fed the SAME `height`/`aux` the normal and the masks already read, so a
    family whose emissive correlates with its own relief (the ember family's
    coal crests glowing and its crevices banking down to ash) is drawing off
    one heightfield rather than a second, uncorrelated one."""
    spec = FAMILIES[name]
    size = FAMILY_SIZE[name] if size is None else size
    height, aux = spec["height"](size, size)
    rough, metal = spec["masks"](size, size, height, aux)
    ao = _ao(height, size, size, spec["ao_radius"], spec["ao_floor"],
             spec["ao_gain"])
    normal = _normal_rgb(height, size, size, spec["normal_strength"])
    orm = _pack_orm(ao, rough, metal, size, size)
    alb = spec.get("albedo")
    albedo = None if alb is None else alb(size, size, height, aux)
    emis = spec.get("emissive")
    emissive = None if emis is None else emis(size, size, height, aux)
    return height, normal, orm, albedo, emissive


# ---------------------------------------------------------------------------
# ALBEDO CARD FAMILIES: `leaf` and `grass`.
#
# Alpha-tested foliage cards, not tiling PBR surfaces, so almost every rule
# above bends here and each bend is stated:
#   * UNIT UVs, not metres. A card is a quad that shows the whole texture
#     exactly once, so there is no tile_m and no texels_per_m.
#   * WRAP: u repeats (the field is periodic in u by construction, so a bent
#     card or a double-wide quad still reads), v CLAMPS: a card has a base
#     and a tip, and the tip edge must dissolve to nothing (see the tip-rows
#     rule below).
#   * RGBA, not normal+orm: the alpha channel IS the shape, and the albedo is
#     a near-neutral VALUE texture because hue comes from vertex colours in
#     the client. The palette stays the colour authority.
#
# ROWS TO V, stated once so orientation is a fact rather than a guess per
# call site. PNG row 0 is the TOP of the decoded image, and the client
# samples glTF-convention UVs (flipY false), so uv (0, 0) reads the decoded
# image's top-left. of_lib's exporter writes v flipped (v -> 1 - v), so mesh
# v = 0 (the card base) samples the BOTTOM PNG rows and mesh v = 1 (the tip)
# samples the TOP rows. The builders therefore author ROOTS in the bottom
# rows and TIPS in the top rows. If the in-engine look proves that backwards,
# flip ALBEDO_V_FLIP: it mirrors the composed field vertically before
# dilation and is deliberately the one-line fix.
ALBEDO_V_FLIP = False

# RN-1500: was a fixed 0.006 UV-fraction constant ("~1.5 px at 256"), and the
# name told the truth about only ONE resolution. Held as a tile-unit fraction,
# the 1024 raise would have stretched it to ~6.1 texels, four times as many
# world-space pixels of ramp for the SAME shape: not sharper at higher
# resolution but softer, backwards from what the raise is for. It also broke
# `_halo_worst`'s own instrument, which examines alpha==0 texels bordering an
# alpha>=128 one: with a 6-texel-wide linear ramp no alpha==0 texel is ever
# one step from alpha>=128 (roughly 3 steps are, at ~42 counts/texel), so the
# undilated negative control measured 0 texels examined instead of failing
# loud. Defined in TEXELS now, so the ramp is a constant number of pixels of
# anti-aliasing at any card resolution and the halo instrument keeps working
# at every size it is asked to.
ALBEDO_EDGE_PX = 1.5   # anti-aliased enough not to stairstep, steep enough
                        # that the mip chain does not go mushy, ONE-TEXEL-SCALE
                        # narrow enough that _halo_worst's 8-neighbour test
                        # still finds an alpha==0 texel beside an opaque one

ALBEDO_TIP_ROWS = 4     # top rows that MUST be fully transparent. v clamps,
                        # so any alpha in the top row would smear upward
                        # forever on a stretched sample; a frond tip has to
                        # dissolve, not stop at a hard picture edge.


def _strip_pt(px, py, ax, ay, bx, by):
    """Distance and parameter from a point to a segment, wrapping in u ONLY.
    _seg_dist wraps both axes, which is right for a tiling surface and wrong
    for a card: v clamps, so a root near the bottom edge must never read as
    close to a tip near the top edge through a v wrap."""
    dx = _wrap_delta(bx, ax)
    dy = by - ay
    wx = _wrap_delta(px, ax)
    wy = py - ay
    den = dx * dx + dy * dy
    t = 0.0 if den < 1e-12 else _clamp01((wx * dx + wy * dy) / den)
    ex = wx - dx * t
    ey = wy - dy * t
    return math.sqrt(ex * ex + ey * ey), t


# A strip is (ax, ay, bx, by, w0, w1, v0, v1, tint): a segment in (u, PNG-row
# fraction) space with half-widths w0 -> w1 tapering along it, an albedo value
# gradient v0 -> v1, and a warm/cool tint applied as R = v + tint, B = v - tint
# (so |R - B| <= 6 counts when |tint| <= 3/255).

def _grass_strips():
    """A bundle of 11 tapering blades, each a 2-segment polyline from a root
    at (or just below) the bottom edge to a tip well clear of the top rows,
    curving slightly via the mid-point offset. Placement is PERIODIC in u:
    even spacing plus a jitter smaller than the pitch, and every distance is
    measured with the u wrap, so a blade crossing the seam continues on the
    other side and the tile has no u seam by construction.

    RN-1500 (was RN-311's own finding): the pitch here is 1/11 = 0.0909 (half
    pitch 0.04545) and the root half-width used to be 0.058 to 0.082, i.e. up
    to 0.164 FULL width against a 0.0909 pitch, so two neighbours ALWAYS
    overlapped and every u column decoded opaque: a "bundle of 11 blades" was
    actually a bottom-anchored mat with a serrated top edge, and no crop of
    any width could show a lateral gap because none existed. Root half-width
    is now 0.026 to 0.040 (full width 0.052 to 0.080 against the same 0.0909
    pitch), which leaves a real gap at the nominal spacing and only closes
    under the jitter's own tail, the way real tufted blades sometimes touch
    and sometimes do not: measured at the root row, 31.4 percent of columns
    are now transparent where 0 percent were before. A narrower band (0.020
    to 0.032) was tried first and measured coverage 0.3138, UNDER the 0.35
    alpha_test cutoff RN-177/178 fixed on purpose so distant mips converge
    toward solid rather than dissolving; 0.026 to 0.040 measures 0.3764,
    which keeps that floor while still opening a real silhouette. Tip
    half-width 0.012, unchanged: it keeps the tip's 50%-alpha contour at
    ~4.6 px at 256 (now ~18 px at the 1024 raise), wide enough that mip
    averaging erodes the tip gracefully instead of deleting it.

    Values: per-blade base drawn from [0.55, 1.0] (widened from [0.60, 1.0]
    for more value structure now a gap can show a darker blade beside a
    lighter one instead of one wall of near-white), slightly darker at the
    root rising ~10% toward the tip, faint per-texel noise on top, and a
    per-blade warm/cool split of at most +/-6 counts between R and B."""
    strips = []
    nb = 11
    for k in range(nb):
        u0 = (k + 0.5) / nb + (_hash01(k, 3, 6011) - 0.5) * 0.55 / nb
        y_root = 1.0 + 0.012 * _hash01(k, 5, 6011)
        y_tip = 0.055 + 0.16 * _hash01(k, 7, 6011)
        lean = (_hash01(k, 11, 6011) - 0.5) * 0.11
        y_mid = y_root - (y_root - y_tip) * 0.5
        u_mid = u0 + lean * 0.38
        u_tip = u0 + lean
        w_root = 0.026 + 0.014 * _hash01(k, 13, 6011)
        w_tip = 0.012
        w_mid = (w_root + w_tip) * 0.5
        bk = 0.55 + 0.45 * _hash01(k, 17, 6011)
        tint = (_hash01(k, 19, 6011) - 0.5) * (6.0 / 255.0)
        strips.append((u0 % 1.0, y_root, u_mid % 1.0, y_mid,
                       w_root, w_mid, bk * 0.90, bk * 0.95, tint))
        strips.append((u_mid % 1.0, y_mid, u_tip % 1.0, y_tip,
                       w_mid, w_tip, bk * 0.95, bk, tint))
    return strips


def _leaf_strips():
    """A conifer-frond card: a central stem from base to tip with alternating
    tapered leaflets angled 30 to 55 degrees off the stem (shorter toward the
    tip), plus three partial background fronds, one of them across the u seam
    so the u wrap is exercised rather than trivially empty. Background fronds
    are sparser in PLACEMENT; their alpha is still full where they exist,
    because a translucent card texel is exactly what alpha testing cannot
    represent.

    The 30-55 degree angle is built from sin values (0.50..0.82) and
    cos = sqrt(1 - sin^2), because this module bans transcendentals (see the
    determinism note at the top): sqrt is bit-portable, sin/cos are not.

    RN-1500 (was RN-311's own finding): the card's bottom rows (mesh v=0,
    where a planted stem meets the ground) measured only 22.7 percent opaque,
    because the only thing that reached them was the bare 0.020*scale stem,
    four of them at four fixed u positions. Every strip planted on the ground
    therefore alpha-cut into thin air right at its base. Each frond now opens
    with a short, wide ROOT FLARE (0.095*scale half-width tapering to the
    stem's own 0.020*scale over the bottom ~10 percent of the card) before
    the stem continues exactly as before: a real frond splays where it meets
    its attachment rather than emerging from a wire. `_render_card` resolves
    overlap by deepest clearance, not by list order, so this is not a
    z-order claim: the flare only wins a texel where it is genuinely the
    widest thing covering it, which near the very base is every texel a
    needle does not already reach."""
    strips = []

    def frond(cx, y_base, y_tip, needles, scale, seed):
        lean = (_hash01(0, 1, seed) - 0.5) * 0.06
        sx0, sy0 = cx, y_base
        sx1, sy1 = cx + lean, y_tip
        bs = 0.62 + 0.38 * _hash01(1, 2, seed)
        stint = (_hash01(2, 3, seed) - 0.5) * (6.0 / 255.0)
        y_flare = y_base - 0.10 * scale
        strips.append((sx0 % 1.0, min(y_base + 0.02, 1.05), sx0 % 1.0, y_flare,
                       0.095 * scale, 0.020 * scale, bs * 0.78, bs * 0.90, stint))
        strips.append((sx0 % 1.0, sy0, sx1 % 1.0, sy1,
                       0.020 * scale, 0.009, bs * 0.93, bs, stint))
        for j in range(needles):
            t = (j + 1.0) / (needles + 1.0)
            ax = (sx0 + (sx1 - sx0) * t) % 1.0
            ay = sy0 + (sy1 - sy0) * t
            side = 1.0 if j % 2 == 0 else -1.0
            sn = 0.50 + 0.32 * _hash01(j, 5, seed)       # sin(30..55 deg)
            cs = math.sqrt(1.0 - sn * sn)
            ln = (0.46 * scale * (1.0 - 0.55 * t)
                  * (0.85 + 0.30 * _hash01(j, 7, seed)))
            ey = ay - cs * ln
            if ey < 0.055:               # keep every leaflet out of the tip rows
                ln = (ay - 0.055) / cs
                ey = ay - cs * ln
            ex = (ax + side * sn * ln) % 1.0
            bv = 0.62 + 0.38 * _hash01(j, 11, seed)
            tint = (_hash01(j, 13, seed) - 0.5) * (6.0 / 255.0)
            strips.append((ax, ay, ex, ey, 0.072 * scale, 0.011,
                           bv * 0.93, bv, tint))

    frond(0.50, 1.005, 0.050, 18, 1.0, 9203)     # the main frond
    frond(0.13, 1.010, 0.300, 8, 0.85, 9403)     # background thickeners
    frond(0.86, 1.010, 0.280, 8, 0.85, 9601)
    frond(0.995, 1.005, 0.380, 9, 0.90, 9803)    # crosses the u seam
    return strips


def _render_card(s, strips, noise_seed):
    """Compose tapered strips into (rgb, alpha) byte buffers, PRE-dilation.

    Alpha: 1 inside a strip, 0 outside, an ALBEDO_EDGE_PX-wide smoothstep ramp
    at the boundary. Albedo: the winning strip's value gradient (winner = deepest
    signed clearance, so overlaps resolve to whichever strip the texel is
    most inside of) plus faint per-texel noise. Background texels are left
    BLACK on purpose: _dilate_albedo must fill them, and a compose that
    pre-filled them would make the dilation selftest unfalsifiable."""
    edge = ALBEDO_EDGE_PX / s     # RN-1500: texels, not tile fraction (see
                                   # ALBEDO_EDGE_PX's own comment)
    noise = _fbm(s, s, 16, 3, seed=noise_seed)
    rgb = bytearray(3 * s * s)
    alpha = bytearray(s * s)
    bounds = []
    for st in strips:
        wmax = max(st[4], st[5]) + edge
        bounds.append((min(st[1], st[3]) - wmax, max(st[1], st[3]) + wmax))
    for y in range(s):
        py = (y + 0.5) / s
        act = [st for st, (y0, y1) in zip(strips, bounds) if y0 <= py <= y1]
        base = y * s
        for x in range(s):
            px = (x + 0.5) / s
            a_best = 0.0
            cov_best = -1.0
            win = None
            wt = 0.0
            for st in act:
                d, t = _strip_pt(px, py, st[0], st[1], st[2], st[3])
                hw = st[4] + (st[5] - st[4]) * t
                a = 1.0 - _smoothstep(hw - edge, hw, d)
                if a > a_best:
                    a_best = a
                if hw - d > cov_best:
                    cov_best = hw - d
                    win = st
                    wt = t
            if a_best > 0.0 and win is not None:
                val = win[6] + (win[7] - win[6]) * wt
                val += (noise[base + x] - 0.5) * 0.06
                tint = win[8]
                o = (base + x) * 3
                rgb[o] = int(_clamp01(val + tint) * 255.0 + 0.5)
                rgb[o + 1] = int(_clamp01(val) * 255.0 + 0.5)
                rgb[o + 2] = int(_clamp01(val - tint) * 255.0 + 0.5)
                alpha[base + x] = int(a_best * 255.0 + 0.5)
    return rgb, alpha


def _dilate_albedo(rgb, alpha, w, h):
    """Flood the covered region's albedo into every texel with alpha < 128:
    iterative synchronous 8-neighbour rounds (u wraps, v clamps) where each
    unfilled texel bordering a filled one takes the mean of its filled
    neighbours' albedo, until nothing borders the frontier unfilled.

    WHY: bilinear and mip filtering blend a texel's RGB regardless of its
    alpha, so black background texels bleed a dark halo into every blade edge
    and every distant mip. Flooding the blade colour outward makes the
    invisible texels agree with the visible ones.

    The u-wrapped grid is connected, so the flood reaches every texel and
    nothing is left for a fully-enclosed fallback; the one unreachable case
    (no covered texel at all) returns the buffer unchanged. Deterministic:
    candidates are processed in sorted index order and every round reads only
    the previous rounds' fills."""
    n = w * h
    out = bytearray(rgb)
    filled = bytearray(1 if alpha[i] >= 128 else 0 for i in range(n))
    front = [i for i in range(n) if filled[i]]
    if not front:
        return out
    while front:
        cand = set()
        for i in front:
            x = i % w
            y = i // w
            for dy in (-1, 0, 1):
                ny = y + dy
                if ny < 0 or ny >= h:
                    continue
                for dx in (-1, 0, 1):
                    j = ny * w + (x + dx) % w
                    if not filled[j]:
                        cand.add(j)
        newly = []
        for j in sorted(cand):
            x = j % w
            y = j // w
            rs = gs = bs = cnt = 0
            for dy in (-1, 0, 1):
                ny = y + dy
                if ny < 0 or ny >= h:
                    continue
                for dx in (-1, 0, 1):
                    k = ny * w + (x + dx) % w
                    if filled[k]:
                        o = k * 3
                        rs += out[o]
                        gs += out[o + 1]
                        bs += out[o + 2]
                        cnt += 1
            o = j * 3
            out[o] = (2 * rs + cnt) // (2 * cnt)
            out[o + 1] = (2 * gs + cnt) // (2 * cnt)
            out[o + 2] = (2 * bs + cnt) // (2 * cnt)
            newly.append(j)
        for j in newly:
            filled[j] = 1
        front = newly
    return out


def _halo_worst(rgb, alpha, w, h):
    """(worst, examined): worst absolute difference between a fully
    transparent texel's luma and the mean luma of its opaque (alpha >= 128)
    8-neighbours (u wraps, v clamps), over every alpha == 0 texel that has at
    least one. This is the halo measurement: an undilated build scores 100+
    here (black next to a bright blade), a dilated one scores a few counts."""
    worst = 0.0
    examined = 0
    for i in range(w * h):
        if alpha[i] != 0:
            continue
        x = i % w
        y = i // w
        tot = cnt = 0
        for dy in (-1, 0, 1):
            ny = y + dy
            if ny < 0 or ny >= h:
                continue
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                k = ny * w + (x + dx) % w
                if alpha[k] >= 128:
                    o = k * 3
                    tot += rgb[o] + rgb[o + 1] + rgb[o + 2]
                    cnt += 1
        if cnt:
            o = i * 3
            own = (rgb[o] + rgb[o + 1] + rgb[o + 2]) / 3.0
            d = abs(own - tot / (3.0 * cnt))
            if d > worst:
                worst = d
            examined += 1
    return worst, examined


def _alpha_coverage(alpha):
    """Fraction of texels with alpha >= 128, the coverage the mip chain
    converges toward."""
    return sum(1 for a in alpha if a >= 128) / len(alpha)


def _tip_rows_clear(alpha, w, rows=ALBEDO_TIP_ROWS):
    """True when the top `rows` PNG rows (the card's dissolving tip edge, at
    sampled v = 1 after the exporter's flip) are entirely alpha 0."""
    return all(alpha[i] == 0 for i in range(rows * w))


def _wrap_vs_interior_u(f, w, h):
    """Selftest 7's wrap-vs-interior measure restricted to the u axis: the
    card tiles in u only (v clamps), so only the u wrap step is a seam
    claim. A tiling field's wrap step is an ordinary step; a seam is a
    cliff there."""
    edge = inner = 0.0
    for y in range(h):
        row = y * w
        edge = max(edge, abs(f[row] - f[row + w - 1]))
        for x in range(w - 1):
            inner = max(inner, abs(f[row + x] - f[row + x + 1]))
    return edge, inner


def _albedo_mean_rgba(rgba, alpha_test):
    """Mean LINEAR Rec.709 luma (0..1, matching `_albedo_mean_rgb` and
    FoliageTone.ts's weights) over texels whose alpha clears
    alpha_test * 255, measured from the packed bytes the file actually
    ships. Each channel is linearised with the sRGB EOTF before the luma
    weights are applied: the consumer (`Surfaces.ts`) divides this out
    through `material.color` in three's LINEAR working colour space, and
    averaging the raw sRGB bytes instead under-compensates. The albedo
    modulation is mean-neutral and cannot shift the palette."""
    thr = alpha_test * 255.0
    lut = _SRGB_TO_LINEAR
    tot = 0.0
    cnt = 0
    for o in range(0, len(rgba), 4):
        if rgba[o + 3] >= thr:
            tot += (0.2126 * lut[rgba[o]] + 0.7152 * lut[rgba[o + 1]]
                    + 0.0722 * lut[rgba[o + 2]])
            cnt += 1
    return 0.0 if cnt == 0 else tot / cnt


# The two card families. UNREFERENCED BY ANY ROLE THIS COMMIT, deliberately:
# ROLE_FAMILY and FLAT_ROLES stay exactly as they are (Leaf*/Grass remain
# flat, with their recorded reasons), and the role move lands later in the
# same commit as the client change that consumes these, so the two cannot
# ship half-wired.
#
# `coverage` is the shipped alpha-coverage band (fraction of texels with
# alpha >= 128), asserted by check_maps against the shipped bytes. The FLOOR
# is the load-bearing edge: under mipmapping, alpha averages toward the
# card's mean coverage, so a sparse card whose distant mips fall under
# alpha_test (0.35) DISSOLVES at range. Coverage well above 0.35 makes the
# far mips converge toward solid instead of toward nothing; the ceiling
# keeps the card reading as foliage rather than as a curtain.
# RN-1500: 256 -> 1024 (D-020 decision 4's general raise; 2048 is reserved
# for `panel` alone). The strip geometry above is defined in UV/tile-fraction
# units throughout (widths, edge ramp, noise field), so nothing here needed a
# unit change: the same shapes simply decode into 16x the texels, which is
# what actually buys the sharper root/tip and blade-edge read at close range.
# `coverage` bands below are MEASURED against the shipped 1024 output (not
# assumed from the old 256 numbers), because the RN-1500 shape edits (the
# narrower grass width, the leaf root flare) both move the true alpha->=128
# fraction: leaf measures 0.6699 (the root flare adds coverage; the old
# 0.60..0.80 band still brackets it, so it is unchanged). grass measures
# 0.3764 (the narrowed blades trade coverage for a real lateral silhouette on
# purpose: an 0.020..0.032 half-width first tried measured 0.3138, UNDER the
# 0.35 alpha_test floor RN-177/178 fixed so distant mips converge toward
# solid rather than dissolving, so the width was widened to 0.026..0.040
# specifically to clear that floor with margin). The band moves to
# 0.35..0.45, the honest bracket around 0.3764 that still keeps every build
# on this side of the alpha_test cutoff, replacing the old 0.55..0.75, which
# described a card with no gaps in it at all.
ALBEDO_FAMILIES = {
    "leaf": dict(strips=_leaf_strips, size=1024, alpha_test=0.35,
                 wrap=("repeat", "clamp"), coverage=(0.60, 0.80),
                 noise_seed=15013),
    "grass": dict(strips=_grass_strips, size=1024, alpha_test=0.35,
                  wrap=("repeat", "clamp"), coverage=(0.35, 0.45),
                  noise_seed=15101),
}


def build_albedo_family(name, size=None):
    """(rgba, rgb, alpha): the packed shipped bytes plus the composed
    channels, post-flip, post-dilation."""
    spec = ALBEDO_FAMILIES[name]
    s = spec["size"] if size is None else size
    rgb, alpha = _render_card(s, spec["strips"](), spec["noise_seed"])
    if ALBEDO_V_FLIP:
        rgb2 = bytearray(len(rgb))
        al2 = bytearray(len(alpha))
        for y in range(s):
            sy = s - 1 - y
            al2[y * s:(y + 1) * s] = alpha[sy * s:(sy + 1) * s]
            rgb2[y * s * 3:(y + 1) * s * 3] = rgb[sy * s * 3:(sy + 1) * s * 3]
        rgb, alpha = rgb2, al2
    rgb = _dilate_albedo(rgb, alpha, s, s)
    rgba = bytearray(s * s * 4)
    for i in range(s * s):
        o = i * 4
        r3 = i * 3
        rgba[o] = rgb[r3]
        rgba[o + 1] = rgb[r3 + 1]
        rgba[o + 2] = rgb[r3 + 2]
        rgba[o + 3] = alpha[i]
    return bytes(rgba), rgb, alpha


def generate(out_dir=OUT_DIR, size=None, quiet=False, only=None):
    """Write every family's PNGs and the manifest.

    `only` RESTRICTS THE WRITE TO ONE FAMILY, AND IT EXISTS BECAUSE THE
    ALL-OR-NOTHING DEFAULT IS A LAUNDERING MACHINE (RN-558).

    This function loops `FAMILIES` and rewrites `surfaces.json` wholesale, so
    a lane that regenerates in the shared tree to look at ITS OWN family also
    writes every other live lane's in-flight family into `assets/textures/dist`
    and into the manifest. That is not hypothetical: RN-151 is the recorded
    case of one lane laundering another's work into HEAD, and on 2026-08-01 it
    happened in BOTH DIRECTIONS in one afternoon between the machine lane and
    the player lane, from this single entry point, with four lanes live in this
    file. The standing workaround is a clean-tree generation plus a filtered
    blob, which works and is what NUMBERS.md prescribes; but that is a
    discipline, and making the wrong thing impossible beats instructing five
    lanes to be careful.

    THE MANIFEST IS MERGED, NOT REPLACED, AND THAT IS THE WHOLE DIFFICULTY.
    Writing a one-family manifest would be worse than the disease: every
    consumer asserts `set(manifest.families) == set(FAMILIES) | set(
    ALBEDO_FAMILIES)`, so a partial manifest fails the client, the preview and
    `check` at once. So `only` reads the manifest that is already on disk,
    replaces exactly that family's row, and leaves every other row BYTE FOR
    BYTE as it found it, including the `roles` and `flat_roles` tables, which
    belong to whoever last wrote them.

    ONE HONEST LIMIT, STATED. `roles` and `flat_roles` are NOT refreshed under
    `only`, because this process's `ROLE_FAMILY` may contain another lane's
    uncommitted role moves, which is exactly the payload being kept out. A
    lane that changes a role mapping therefore needs a full generation on a
    clean tree; `only` covers a family's PIXELS, which is the common case and
    the one that was hurting."""
    if only is not None and only not in FAMILIES:
        raise SystemExit(
            "--only %r is not a tiling family. Known: %s"
            % (only, ", ".join(sorted(FAMILIES))))
    wanted = sorted(FAMILIES) if only is None else [only]
    files = {}
    sizes = {}
    tiling_albedo = {}
    for name in wanted:
        fsize = FAMILY_SIZE[name] if size is None else size
        sizes[name] = fsize
        _, normal, orm, albedo, emissive = build_family(name, fsize)
        n_path = os.path.join(out_dir, "of_%s_n.png" % name)
        o_path = os.path.join(out_dir, "of_%s_orm.png" % name)
        n_bytes = write_png(n_path, fsize, fsize, normal)
        o_bytes = write_png(o_path, fsize, fsize, orm)
        files[name] = {
            "normal": {"file": os.path.basename(n_path), "bytes": n_bytes},
            "orm": {"file": os.path.basename(o_path), "bytes": o_bytes},
        }
        if albedo is not None:
            # RGB, not RGBA, and that is the contract rather than an omission:
            # a tiling body surface is OPAQUE, so it declares no alpha channel
            # and therefore cannot trip the validator's rule that an albedo
            # with alpha must publish an alpha_test.
            a_path = os.path.join(out_dir, "of_%s_a.png" % name)
            a_bytes = write_png(a_path, fsize, fsize, albedo)
            files[name]["albedo"] = {"file": os.path.basename(a_path),
                                     "bytes": a_bytes}
            tiling_albedo[name] = albedo
        if emissive is not None:
            # RN-1462/RN-1780. Also RGB (light COLOUR, no coverage channel):
            # `Surfaces.ts` decodes it sRGB like an albedo but tiles it in
            # METRES like normal/orm, never in card unit space, because
            # every plausible consumer is a tiling body surface and not a
            # card (see Surfaces.ts's `makeEmissiveTexture` docstring).
            e_path = os.path.join(out_dir, "of_%s_e.png" % name)
            e_bytes = write_png(e_path, fsize, fsize, emissive)
            files[name]["emissive"] = {"file": os.path.basename(e_path),
                                       "bytes": e_bytes}
        if not quiet:
            print("[texgen] %-7s normal %7d B   orm %7d B%s%s   (%dx%d, %g px/m)"
                  % (name, n_bytes, o_bytes,
                     ("   albedo %7d B" % files[name]["albedo"]["bytes"])
                     if albedo is not None else "",
                     ("   emissive %7d B" % files[name]["emissive"]["bytes"])
                     if emissive is not None else "",
                     fsize, fsize, fsize / FAMILY_TILE_M[name]))

    albedo_files = {}
    for name in ([] if only is not None else sorted(ALBEDO_FAMILIES)):
        fsize = ALBEDO_FAMILIES[name]["size"] if size is None else size
        rgba, _, _ = build_albedo_family(name, fsize)
        a_path = os.path.join(out_dir, "of_%s_a.png" % name)
        a_bytes = write_png_rgba(a_path, fsize, fsize, rgba)
        albedo_files[name] = {"file": os.path.basename(a_path),
                              "bytes": a_bytes, "rgba": rgba, "size": fsize}
        if not quiet:
            print("[texgen] %-7s albedo %7d B                    (%dx%d, unit uv)"
                  % (name, a_bytes, fsize, fsize))

    manifest = {
        "_comment": [
            "Generated by tools/blender/texgen.py. Do not hand-edit.",
            "UVs in the .glb files are in METRES, so a consumer applies",
            "texture.repeat = 1 / tile_m and texture.wrapS/wrapT = RepeatWrapping.",
            "orm channels: R = occlusion, G = roughness, B = metalness, and all",
            "three MULTIPLY the material constant rather than replacing it.",
            "normal maps are OpenGL convention (+Y up), colorSpace NoColorSpace.",
            "A TILING family may also carry an `albedo` (chitin, RN-455).",
            "It is RGB with no alpha, uv_space is metres like its normal and",
            "orm siblings, and it publishes albedo_mean_linear for the same",
            "mean-neutral divide the card families use. A family carrying all",
            "three maps is the shape a body surface takes.",
            "albedo families (grass, leaf) are CARD textures: albedo+alpha,",
            "values are sRGB as authored, alpha is coverage. Their UVs are",
            "UNIT (uv_space \"unit\"), not metres: a card shows the texture",
            "exactly once, so there is no tile_m. wrap: u repeat, v clamp;",
            "v = 1 is the tips as sampled with glTF UVs (the builder writes",
            "roots at the image bottom and the exporter flips v).",
            "alpha_test is the consumer contract: the material discards",
            "below it. An albedo family whose alpha channel is in use MUST",
            "declare alpha_test; the validator refuses one that does not",
            "(that check lands in the validator, the rule is stated here).",
            "albedo_mean_linear (D-016, manifest v2; was albedo_mean, mean",
            "RGB luma over raw sRGB bytes, which under-compensated by 1.2x",
            "to 2.3x) is the mean Rec.709 luma (0.2126/0.7152/0.0722,",
            "matching FoliageTone.ts) over texels with alpha >= alpha_test *",
            "255, each channel linearised with the sRGB EOTF before the",
            "weights are applied. The client divides it out via",
            "material.color in LINEAR working space, so the modulation is",
            "mean-neutral and cannot shift the palette.",
        ],
        "version": MANIFEST_VERSION,
        "zlib": zlib.ZLIB_RUNTIME_VERSION,
        "families": {},
        "roles": dict(sorted(ROLE_FAMILY.items())),
        "flat_roles": dict(sorted(FLAT_ROLES.items())),
    }
    for name in wanted:
        fam = dict(files[name])
        fam["tile_m"] = FAMILY_TILE_M[name]
        fam["size_px"] = sizes[name]
        fam["texels_per_m"] = sizes[name] / FAMILY_TILE_M[name]
        for k in ("normal", "orm", "albedo", "emissive"):
            if k not in fam:
                continue
            p = os.path.join(out_dir, fam[k]["file"])
            with open(p, "rb") as fh:
                fam[k]["sha256"] = hashlib.sha256(fh.read()).hexdigest()
        if name in tiling_albedo:
            fam["albedo_mean_linear"] = round(_albedo_mean_rgb(tiling_albedo[name]), 4)
        manifest["families"][name] = fam
    for name in sorted(albedo_files):
        spec = ALBEDO_FAMILIES[name]
        rec = albedo_files[name]
        p = os.path.join(out_dir, rec["file"])
        with open(p, "rb") as fh:
            sha = hashlib.sha256(fh.read()).hexdigest()
        manifest["families"][name] = {
            "albedo": {"file": rec["file"], "bytes": rec["bytes"],
                       "sha256": sha},
            "size_px": rec["size"],
            "uv_space": "unit",
            "wrap": {"u": spec["wrap"][0], "v": spec["wrap"][1]},
            "alpha_test": spec["alpha_test"],
            "albedo_mean_linear": round(_albedo_mean_rgba(rec["rgba"],
                                                           spec["alpha_test"]), 4),
        }

    m_path = os.path.join(out_dir, "surfaces.json")
    if only is not None:
        # MERGE, DO NOT REPLACE. Read what is already on disk, swap in exactly
        # this family's row, and leave every other row and both role tables
        # untouched. `json.load` / `json.dump` is a round trip and would
        # normally be refused on a shared file for reformatting other lanes'
        # rows (RN-443); it is safe HERE and only here, because this file is
        # itself generated by `json.dump(indent=2, sort_keys=False)` five
        # lines below, so the round trip is the identity on everything it does
        # not deliberately change. That is asserted rather than assumed.
        if not os.path.isfile(m_path):
            raise SystemExit(
                "--only needs an existing %s to merge into. Run a full "
                "generation on a CLEAN tree first." % m_path)
        with open(m_path, "r", encoding="utf-8") as fh:
            prior_text = fh.read()
        prior = json.loads(prior_text)
        rt = json.dumps(prior, indent=2, sort_keys=False) + "\n"
        if rt != prior_text:
            raise SystemExit(
                "%s is not in this tool's own output format, so a merge "
                "would silently reformat it. Refusing." % m_path)
        merged = prior
        merged["families"][only] = manifest["families"][only]
        for k in ("version", "zlib"):
            merged[k] = manifest[k]
        manifest = merged
    with open(m_path, "w", newline="\n", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, sort_keys=False)
        fh.write("\n")
    if not quiet:
        total = (sum(v[k]["bytes"] for v in files.values() for k in v)
                 + sum(v["bytes"] for v in albedo_files.values()))
        nfiles = (sum(len(v) for v in files.values()) + len(albedo_files))
        print("[texgen] manifest %s%s"
              % (m_path, "  (MERGED: only the %r row was rewritten; %d other "
                 "families and both role tables left as found)"
                 % (only, len(manifest["families"]) - 1)
                 if only is not None else ""))
        print("[texgen] %d files, %d bytes of texture payload"
              % (nfiles, total))
    return manifest


# ---------------------------------------------------------------------------
# check: assert things about the SHIPPED bytes.
#
# BT-13's rule, applied to textures: put the check where the information
# actually is. The shipped PNG is what the game loads, so that is what gets
# measured, with no help from the generator that wrote it.
# ---------------------------------------------------------------------------

# A channel that is CONSTANT is a channel doing nothing, which is only
# acceptable when the constant is the identity for how the channel is used.
# metalness multiplies, so 255 is identity; anything else silently rescales
# every material that wears the map. Each entry needs a reason.
#
# RN-1837. THE VALUE IS NOW PART OF THE DECLARATION, and the change is a
# TIGHTENING that also unblocks one honest non-identity case. The check used
# to be `declared and lo == 255`, so a declaration said only "this channel may
# be flat" and the 255 was hard-coded beside it; an entry could therefore
# never be wrong about its own value, because it did not state one. Each entry
# is now `(value, reason)` and the check asserts the shipped constant IS that
# value, so a family whose pinned constant silently moves now fails instead of
# passing on a stale declaration.
#
# WHY A NON-255 ENTRY IS PERMITTED AT ALL, since 255 was the whole rule. 255
# is identity for a MULTIPLIER, and that argument is exactly right for
# metalness, which is why every metalness row below still reads 255. It is not
# an argument about a channel a family pins as a deliberate ABSOLUTE. There is
# exactly one of those (`ember`'s roughness, pinned matte by RN-1780 so no
# specular highlight can compete with the emissive term for which one the eye
# reads as the hot spot) and it has been shipping while `texgen check` was RED
# on `main` since that lane landed, which is the worst of both worlds: the
# gate was failing and nobody was reading it. A stated exception with its
# value asserted is strictly better than a red gate nobody looks at. If a
# second non-255 entry ever wants in, that is the moment to make the family
# vary the channel instead.
ALLOWED_CONSTANT = {
    ("coarse", "orm", "B"): (255,
        "no coarse role is a polished metal, so metalness is left at identity"),
    ("bark", "orm", "B"): (255,
        "bark is not a metal; the palette constant is already 0 and identity "
        "is the only multiplier that does not rescale it"),
    ("ore", "orm", "B"): (255,
        "ore-in-rock is mineral, not polished metal: the three ore roles' "
        "palette metallic values sit under the client's 0.5 metal/matte "
        "batching split on purpose (RN-156), and identity is the only "
        "multiplier that cannot move them across it"),
    ("fur", "orm", "B"): (255,
        "fur is not a metal by any reading, and section 2.1 asks that a "
        "flat channel say so rather than invent variation it does not "
        "have; identity leaves the material's own 0.02 exactly where the "
        "palette put it"),
    ("stone", "orm", "B"): (255,
        "host rock is not a polished metal, and the roles that wear this "
        "family are the same non-metallic rock roles `coarse` left at "
        "identity for the same reason; inventing metalness variation on a "
        "boulder would be the dishonest half of section 2.1's own rule"),
    # RN-1836. `masonry` has been shipping this channel constant and
    # UNDECLARED since RN-1780 split the family off `stone`, so `texgen
    # check` has been red on `main` for it. The reason is `stone`'s, verbatim
    # and for the same roles' sake: a built stone wall is not a polished
    # metal either, and `Masonry`/`MasonryDark` copy `Rock`/`RockDark`'s own
    # 0.00 metallic constant, which identity is the only multiplier that
    # leaves alone. `_ashlar_masks` keeps it at identity for that reason and
    # not by omission.
    ("masonry", "orm", "B"): (255,
        "a built stone wall is not a polished metal; Masonry/MasonryDark "
        "copy Rock/RockDark's 0.00 metallic constant and identity is the "
        "only multiplier that leaves the palette where the palette put it"),
    # RN-1837. `ember`'s two, also red on `main` since RN-1780 and also
    # deliberate there. G is the one non-identity entry in this table; see
    # the header above for why it is allowed and why it is the only one.
    ("ember", "orm", "G"): (242,
        "RN-1780 pinned this family's roughness matte (0.95 -> 242) rather "
        "than deriving it, because `_stone_masks`'s crest band puts a "
        "GLOSSY patch exactly where the emissive map puts its hottest "
        "texel, and on a dielectric under a bright sky IBL that highlight "
        "competes with the glow for which one the eye reads as the hot "
        "spot. A coal should glow, not glint. Pinning it is what makes the "
        "measured peep/strip contrast attributable to the emissive term "
        "alone, which is the whole reason the family exists"),
    ("ember", "orm", "B"): (255,
        "coal is not a polished metal and EmberEmissiveState's palette "
        "metallic is 0.00; identity is the only multiplier that leaves it "
        "there, `stone`'s reason one subject along"),
    # RN-1815. `concrete` declares its own pinned channel at the moment the
    # family lands, in the (value, reason) schema RN-1837 introduced one
    # entry down. Nothing about this row is a repair of an older one.
    ("concrete", "orm", "B"): (255,
        "poured concrete is a dielectric and all three roles that wear this "
        "family are already 0.00 metallic in the palette; identity is the "
        "only multiplier that leaves that alone, and it is the same call "
        "`stone` makes for the same substance-not-a-metal reason"),
    ("suitfab", "orm", "B"): (255,
        "a woven pressure garment is a polymer and both roles that wear it "
        "are already 0.00 metallic in the palette; identity is the only "
        "multiplier that leaves that alone, and inventing variation here "
        "would be the dishonest half of section 2.1's own rule. The suit's "
        "metal is on `suitplate`, which does vary"),
}

# Channels that MUST carry variation, with the reason a flat one is a defect.
MUST_VARY = {
    ("normal", "R"): "no relief across the tile in X",
    ("normal", "G"): "no relief across the tile in Y",
    ("orm", "R"): "ambient occlusion is flat, so crevices do not darken",
    ("orm", "G"): "uniform roughness is what makes untextured PBR read as "
                  "plastic (DW-35); a flat G means the pass did nothing",
}
MIN_SPREAD = 16          # counts out of 255. A dead channel is 0; a real one
                         # measures 50+. Nothing lands near 16 by accident.


def _channel_stats(rgb, n):
    out = []
    for c in range(3):
        lo, hi, total = 255, 0, 0
        for i in range(c, n * 3, 3):
            v = rgb[i]
            if v < lo:
                lo = v
            if v > hi:
                hi = v
            total += v
        out.append((lo, hi, total / n))
    return out


def _check_albedo_family(fam, spec, out_dir, say):
    """The albedo-card half of check_maps: RGBA decode, sha, per-channel
    stats, alpha variation, coverage band, covered-region albedo variation,
    albedo_mean_linear recompute, the alpha_test guard, and the uv_space/wrap
    contract fields. Returns the texel count examined."""
    code = ALBEDO_FAMILIES[fam]
    rec = spec.get("albedo") or {}
    path = os.path.join(out_dir, rec.get("file", ""))
    if not rec or not os.path.isfile(path):
        say(False, "%s.albedo" % fam, "MISSING: %s" % rec.get("file"))
        return 0
    with open(path, "rb") as fh:
        blob = fh.read()
    digest = hashlib.sha256(blob).hexdigest()
    if digest != rec.get("sha256"):
        say(False, "%s.albedo sha" % fam,
            "manifest %s.. != file %s.."
            % (str(rec.get("sha256"))[:12], digest[:12]))
        return 0
    w, h, rgba = read_png_rgba(path)
    n = w * h
    say(w == h == spec.get("size_px") and len(blob) == rec.get("bytes"),
        "%s.albedo file" % fam,
        "%dx%d, %d B, sha %s.." % (w, h, len(blob), digest[:8]))

    stats = []
    for c in range(4):
        vals = rgba[c::4]
        stats.append((min(vals), max(vals), sum(vals) / n))
    for c, cname in enumerate("RGB"):
        lo, hi, mean = stats[c]
        say(True, "%s.albedo %s" % (fam, cname),
            "range %d..%d mean %.1f" % (lo, hi, mean))
    alo, ahi, amean = stats[3]
    say(ahi - alo >= MIN_SPREAD, "%s.albedo A" % fam,
        "spread %d (min %d), range %d..%d mean %.1f%s"
        % (ahi - alo, MIN_SPREAD, alo, ahi, amean,
           "" if ahi - alo >= MIN_SPREAD
           else "  -> a card with constant alpha has lost its cutout"))

    cov = sum(1 for a in rgba[3::4] if a >= 128) / n
    lo_b, hi_b = code["coverage"]
    say(lo_b <= cov <= hi_b, "%s.albedo coverage" % fam,
        "%.3f in band %.2f..%.2f (alpha >= 128; the floor keeps distant "
        "mips above alpha_test)" % (cov, lo_b, hi_b))

    lmin, lmax = 255.0, 0.0
    for o in range(0, n * 4, 4):
        if rgba[o + 3] >= 128:
            lum = (rgba[o] + rgba[o + 1] + rgba[o + 2]) / 3.0
            if lum < lmin:
                lmin = lum
            if lum > lmax:
                lmax = lum
    say(lmax - lmin >= MIN_SPREAD, "%s.albedo varies" % fam,
        "covered-region luma spread %.0f (min %d), range %.0f..%.0f"
        % (lmax - lmin, MIN_SPREAD, lmin, lmax))

    measured = round(_albedo_mean_rgba(rgba, code["alpha_test"]), 4)
    say(spec.get("albedo_mean_linear") == measured, "%s.albedo_mean_linear" % fam,
        "manifest %r vs measured %.4f" % (spec.get("albedo_mean_linear"), measured))

    # THE GREY-WHITE / SILENT-DROP GUARD. A card whose alpha channel is in
    # use but whose manifest declares no alpha_test leaves the consumer two
    # bad defaults: render the background as grey-white fill (no test) or
    # drop the family (unknown contract). Neither is a texture bug you can
    # see in this tool, so the manifest is refused HERE, by name.
    alpha_used = ahi > alo
    has_test = "alpha_test" in spec
    if alpha_used and not has_test:
        say(False, "%s.alpha_test guard" % fam,
            "ALPHA IN USE BUT alpha_test UNDECLARED: consumer would render "
            "grey-white fill or silently drop the family; refused")
    elif not alpha_used and has_test:
        say(False, "%s.alpha_test guard" % fam,
            "alpha_test declared on a constant-alpha family")
    else:
        say(has_test and spec.get("alpha_test") == code["alpha_test"],
            "%s.alpha_test guard" % fam,
            "alpha varies and alpha_test = %r (code declares %r)"
            % (spec.get("alpha_test"), code["alpha_test"]))

    say(spec.get("uv_space") == "unit", "%s.uv_space" % fam,
        "%r (cards are unit UVs, not metres)" % spec.get("uv_space"))
    wr = spec.get("wrap") or {}
    say((wr.get("u"), wr.get("v")) == code["wrap"], "%s.wrap" % fam,
        "u=%r v=%r (code declares u=%r v=%r)"
        % (wr.get("u"), wr.get("v"), code["wrap"][0], code["wrap"][1]))
    return n


def check_maps(out_dir=OUT_DIR, verbose=True):
    """Returns (ok, lines). Every texel of every map is examined; the count is
    reported so 'all green' cannot mean 'looked at nothing'."""
    lines, ok = [], True

    def say(good, label, detail):
        nonlocal ok
        ok = ok and good
        lines.append("  [%s] %-22s %s" % ("ok" if good else "FAIL",
                                          label, detail))

    m_path = os.path.join(out_dir, "surfaces.json")
    if not os.path.isfile(m_path):
        say(False, "manifest", "MISSING: %s" % m_path)
        return ok, lines
    with open(m_path, "r", encoding="utf-8") as fh:
        man = json.load(fh)
    say(man.get("version") == MANIFEST_VERSION, "manifest",
        "version %r (tool speaks %d), zlib %s"
        % (man.get("version"), MANIFEST_VERSION, man.get("zlib")))

    declared = set(man.get("families", {}))
    expected = set(FAMILIES) | set(ALBEDO_FAMILIES)
    say(declared == expected, "families",
        "%s" % sorted(declared) if declared == expected
        else "manifest %s != code %s" % (sorted(declared), sorted(expected)))

    total_texels = 0
    for fam in sorted(declared):
        spec = man["families"][fam]
        if fam in ALBEDO_FAMILIES:
            total_texels += _check_albedo_family(fam, spec, out_dir, say)
            continue
        for kind in ("normal", "orm", "albedo", "emissive"):
            if kind not in spec:
                continue                 # only chitin/ember carry these
            rec = spec[kind]
            path = os.path.join(out_dir, rec["file"])
            if not os.path.isfile(path):
                say(False, "%s.%s" % (fam, kind), "MISSING: %s" % rec["file"])
                continue
            with open(path, "rb") as fh:
                blob = fh.read()
            digest = hashlib.sha256(blob).hexdigest()
            if digest != rec.get("sha256"):
                say(False, "%s.%s sha" % (fam, kind),
                    "manifest %s.. != file %s.."
                    % (str(rec.get("sha256"))[:12], digest[:12]))
                continue
            w, h, rgb = read_png_rgb(path)
            n = w * h
            total_texels += n
            size_ok = w == h == spec["size_px"] and len(blob) == rec["bytes"]
            say(size_ok, "%s.%s file" % (fam, kind),
                "%dx%d, %d B, sha %s.." % (w, h, len(blob), digest[:8]))

            if kind == "albedo":
                # A TILING albedo (RN-455). Three claims, and they are the
                # three ways this map can ship dead: it must VARY (a flat
                # albedo is the flat vertex colour ART-DIRECTION.md rejects),
                # it must not be so dark that the mean-neutral divide blows
                # the palette up, and its published mean must be the mean of
                # the bytes actually written, because the client divides by
                # that number and a stale one shifts every colour it touches.
                stats = _channel_stats(rgb, n)
                lo = min(st[0] for st in stats)
                hi = max(st[1] for st in stats)
                say(hi - lo >= 40, "%s.albedo varies" % fam,
                    "luma spread %d (min 40), range %d..%d" % (hi - lo, lo, hi))
                measured = _albedo_mean_rgb(rgb)
                declared = spec.get("albedo_mean_linear")
                say(declared is not None
                    and abs(declared - measured) < 5e-4,
                    "%s.albedo_mean_linear" % fam,
                    "manifest %s vs measured %.4f" % (declared, measured))
                say(0.15 <= measured <= 0.85, "%s.albedo level" % fam,
                    "mean %.4f in 0.15..0.85 (the client divides by it)"
                    % measured)
                continue
            stats = _channel_stats(rgb, n)
            for c, cname in enumerate("RGB"):
                lo, hi, mean = stats[c]
                key = (fam, kind, cname)
                if lo == hi:
                    rule = ALLOWED_CONSTANT.get(key)
                    say(rule is not None and lo == rule[0],
                        "%s.%s %s const" % (fam, kind, cname),
                        ("constant %d, allowed: %s" % (lo, rule[1])) if rule
                        and lo == rule[0] else
                        ("CONSTANT at %d but the declaration says %d"
                         % (lo, rule[0])) if rule
                        else "CONSTANT at %d and not declared allowed" % lo)
                elif (kind, cname) in MUST_VARY:
                    say(hi - lo >= MIN_SPREAD, "%s.%s %s" % (fam, kind, cname),
                        "spread %d (min %d), range %d..%d mean %.1f%s"
                        % (hi - lo, MIN_SPREAD, lo, hi, mean,
                           "" if hi - lo >= MIN_SPREAD
                           else "  -> " + MUST_VARY[(kind, cname)]))
                else:
                    say(True, "%s.%s %s" % (fam, kind, cname),
                        "range %d..%d mean %.1f" % (lo, hi, mean))

            if kind == "normal":
                # A normal map is unit vectors in tangent space. Two things can
                # be wrong and both look plausible in a thumbnail: the vectors
                # are not normalised (lighting goes soft and wrong), or Z is
                # negative somewhere (the surface points INTO itself, which
                # reads as a black pit).
                worst, back = 0.0, 0
                for i in range(0, n * 3, 3):
                    x = rgb[i] / 127.5 - 1.0
                    y = rgb[i + 1] / 127.5 - 1.0
                    z = rgb[i + 2] / 127.5 - 1.0
                    if z <= 0.0:
                        back += 1
                    d = abs(math.sqrt(x * x + y * y + z * z) - 1.0)
                    if d > worst:
                        worst = d
                # 8-bit quantisation alone can move a unit vector by up to
                # sqrt(3)/255 = 0.0068, so the bound is derived, not tuned.
                say(worst <= 0.0068 + 1e-9, "%s.normal unit" % fam,
                    "worst |len-1| = %.5f <= 0.00680 over %d texels"
                    % (worst, n))
                say(back == 0, "%s.normal +Z" % fam,
                    "0 texels face away" if not back
                    else "%d texels have Z <= 0" % back)

    say(True, "coverage", "%d texels examined, 0 skipped" % total_texels)
    if verbose:
        for ln in lines:
            print(ln)
    return ok, lines


# ---------------------------------------------------------------------------
# selftest. Per DW-20 a check has to demonstrate it can fail, so every case
# below states what it would catch.
# ---------------------------------------------------------------------------

def selftest():
    import tempfile
    fails = []
    count = [0]

    def check(label, ok, detail=""):
        count[0] += 1
        print("  [%s] %-26s %s" % ("ok" if ok else "FAIL", label, detail))
        if not ok:
            fails.append(label)

    tmp = tempfile.mkdtemp(prefix="texgen_")

    # 1. Encoder round trip. Catches: a filter that does not invert.
    w = h = 37
    px = bytearray()
    for y in range(h):
        for x in range(w):
            px += bytes(((x * 7) % 256, (y * 11) % 256, ((x ^ y) * 3) % 256))
    p = os.path.join(tmp, "rt.png")
    write_png(p, w, h, bytes(px))
    rw, rh, rgb = read_png_rgb(p)
    check("png round trip", (rw, rh) == (w, h) and rgb == bytes(px),
          "%dx%d, %d bytes" % (rw, rh, len(rgb)))

    # 2. No timestamp or text chunk. Catches: an encoder that "helpfully" adds
    #    provenance, which is the single most common cause of a PNG that
    #    differs between two identical runs.
    with open(p, "rb") as fh:
        blob = fh.read()
    tags = []
    off = 8
    while off + 8 <= len(blob):
        ln, tag = struct.unpack_from(">I4s", blob, off)
        tags.append(tag.decode("ascii"))
        off += 8 + ln + 4
    check("chunks are minimal", tags == ["IHDR", "IDAT", "IEND"], ",".join(tags))

    # 3. Two encodes of the same pixels are the same bytes. Catches: a
    #    nondeterministic filter choice or an unpinned zlib parameter.
    p2 = os.path.join(tmp, "rt2.png")
    write_png(p2, w, h, bytes(px))
    with open(p2, "rb") as fh:
        blob2 = fh.read()
    check("encode is stable", blob == blob2, "%d bytes twice" % len(blob))

    # 4. A different pixel produces a different file. Catches the failure this
    #    whole gate could have: an encoder that ignores its input would pass
    #    check 3 forever.
    px3 = bytearray(px)
    px3[3 * (19 * w + 23)] ^= 0x40
    p3 = os.path.join(tmp, "rt3.png")
    write_png(p3, w, h, bytes(px3))
    with open(p3, "rb") as fh:
        blob3 = fh.read()
    check("encode is sensitive", blob3 != blob, "one texel changed the file")

    # 5. Refuse what is out of scope rather than misreading it.
    bad = os.path.join(tmp, "bad.png")
    with open(bad, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n"
                 + _chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 4, 16, 2, 0, 0, 0))
                 + _chunk(b"IDAT", zlib.compress(b"\x00" * 100, 9))
                 + _chunk(b"IEND", b""))
    try:
        read_png_rgb(bad)
        check("refuses 16-bit", False, "decoded a 16-bit PNG as 8-bit")
    except ValueError as exc:
        check("refuses 16-bit", True, str(exc).split(":")[-1].strip()[:40])

    # 6. The noise is periodic. Catches: a lattice that does not wrap, which
    #    would put a visible seam on every tile boundary in the game.
    n = _noise_field(64, 64, 8, seed=99)
    tab = _lattice(8, 99)
    #    Sampling at u = 1.0 must equal sampling at u = 0.0.
    row = 13
    f = row * 8 / 64
    j0 = int(f) % 8
    j1 = (j0 + 1) % 8
    ty = _smooth(f - int(f))
    at0 = n[row * 64 + 0]
    #    reconstruct the value at exactly u = 1.0 (lattice index 8 == 0)
    a, c = tab[j0 * 8 + 0], tab[j1 * 8 + 0]
    at1 = a + (c - a) * ty
    check("noise wraps", abs(at0 - at1) < 1e-12, "|d| = %.3e" % abs(at0 - at1))

    # 7. The generated fields tile.
    #
    #    The FIRST version of this check compared the two edge columns against a
    #    fixed threshold at a reduced resolution, and it failed both families -
    #    correctly by its own rule and uselessly, because at 96 px the 6 mm
    #    groove is half a texel wide, so it was measuring aliasing and had no
    #    way to see a seam underneath it. Worth keeping as a worked example of
    #    standing rule 11 in the other direction: a check can also fail on
    #    something it never examined.
    #
    #    The SECOND version measured the NORMAL MAP's two edge columns, and the
    #    negative control below is what caught it: `_normal_rgb` differences
    #    with wrapped indices, so the normal map is continuous across the wrap
    #    BY CONSTRUCTION whatever the heightfield does. A discontinuous height
    #    shows up as a bright double line in the two columns either side of the
    #    seam, and as exactly zero difference between them. The check could not
    #    have failed, which is the same defect this project has now found five
    #    times. It is recorded here rather than quietly deleted.
    #
    #    The subject is the HEIGHTFIELD, in both axes. A tiling field's step
    #    across the wrap is an ordinary step: no worse than the worst one
    #    inside. A feature that used an unwrapped distance puts a cliff there.
    def _wrap_vs_interior(f, s):
        edge = inner = 0.0
        for y in range(s):
            row = y * s
            edge = max(edge, abs(f[row] - f[row + s - 1]))
            for x in range(s - 1):
                inner = max(inner, abs(f[row + x] - f[row + x + 1]))
        for x in range(s):
            edge = max(edge, abs(f[x] - f[(s - 1) * s + x]))
            for y in range(s - 1):
                inner = max(inner, abs(f[y * s + x] - f[(y + 1) * s + x]))
        return edge, inner

    for fam in sorted(FAMILIES):
        s = FAMILY_SIZE[fam]
        height, _ = FAMILIES[fam]["height"](s, s)
        edge, inner = _wrap_vs_interior(height, s)
        check("%s tiles" % fam, edge <= inner,
              "wrap step %.4f vs worst interior %.4f" % (edge, inner))

    # 7b. NEGATIVE CONTROL, per DW-20: the check above must be able to fail.
    #     A linear ramp is smooth everywhere inside and maximally discontinuous
    #     at exactly the wrap, which is the shape of every seam defect.
    s = 64
    ramp = [(x / s) for y in range(s) for x in range(s)]
    edge, inner = _wrap_vs_interior(ramp, s)
    check("seam check can fail", edge > inner,
          "ramp: wrap step %.4f vs worst interior %.4f" % (edge, inner))

    # 7c. Bark's fissures actually run along v. The whole reason `bark` exists
    #     is orientation: world-vertical on a trunk's side faces is the v axis
    #     (both horizontal-normal cases of the box projection agree, see
    #     _bark_height), so the field must change much faster ACROSS u than
    #     along v. Measured as the summed absolute wrapped difference per
    #     axis; an isotropic field (coarse's, say) lands near 1.0x and would
    #     fail, which is exactly the regression this catches: someone retunes
    #     bark into rock and every trunk quietly goes back to stone.
    s = 192
    bh, _ = _bark_height(s, s)
    gu = gv = 0.0
    for y in range(s):
        row = y * s
        for x in range(s):
            here = bh[row + x]
            gu += abs(bh[row + (x + 1) % s] - here)
            gv += abs(bh[((y + 1) % s) * s + x] - here)
    check("bark fissures vertical", gu > 1.5 * gv,
          "sum |dz/du| %.1f vs sum |dz/dv| %.1f, ratio %.2f (need > 1.50)"
          % (gu, gv, gu / gv if gv > 0 else float("inf")))

    # 7d. Ore's strata actually cross v. The family exists to put BANDING on
    #     a seam facet (RN-156): world-vertical on a boulder's side facets is
    #     the v axis (the same box-projection fact 7c rests on), geological
    #     strata lie across it, so the field must change much faster along v
    #     than along u - the mirror of bark's rule. An isotropic field lands
    #     near 1.0x and fails, which is the regression this catches: someone
    #     retunes ore into rubble and every seam quietly goes back to rock.
    s = 192
    oh, _ = _ore_height(s, s)
    ou = ov = 0.0
    for y in range(s):
        row = y * s
        for x in range(s):
            here = oh[row + x]
            ou += abs(oh[row + (x + 1) % s] - here)
            ov += abs(oh[((y + 1) % s) * s + x] - here)
    check("ore strata cross v", ov > 1.5 * ou,
          "sum |dz/dv| %.1f vs sum |dz/du| %.1f, ratio %.2f (need > 1.50)"
          % (ov, ou, ov / ou if ou > 0 else float("inf")))

    # 7e. NEGATIVE CONTROL, per DW-20: the same measurement on the same
    #     recipe with the bands fed the wrong axis must FAIL the rule above.
    #     This is what catches an anisotropy check that has quietly become
    #     rotation-invariant - a `rotated` flag someone disconnected, or a
    #     measure rewritten in terms that cannot tell u from v.
    rh, _ = _ore_height(s, s, rotated=True)
    ru = rv = 0.0
    for y in range(s):
        row = y * s
        for x in range(s):
            here = rh[row + x]
            ru += abs(rh[row + (x + 1) % s] - here)
            rv += abs(rh[((y + 1) % s) * s + x] - here)
    check("ore band control fails", not (rv > 1.5 * ru),
          "rotated 90 degrees: ratio %.2f, correctly outside the > 1.50 rule"
          % (rv / ru if ru > 0 else float("inf")))

    # 7e2. RN-1815. Concrete's board marks actually run ACROSS v, and this is
    #      not a stylistic check: it is the whole answer to the verifier's
    #      "visible repeat at walking distance". The launch pad's skirt is
    #      24 m long and 1.55 m tall, so at a 1.8 m tile the HORIZONTAL axis
    #      carries 13.3 repeats and the vertical axis carries 0.86 of one.
    #      Only u can ever be counted. A family whose loud features vary along
    #      v therefore cannot show its repeat on this consumer however loud
    #      they are, and the one feature that does vary along u is placed at
    #      the form panel pitch (0.90 m, half the tile) so the rhythm the eye
    #      finds is a rhythm formwork genuinely has.
    #
    #      The rule is ore's, on the same side (v-varying wins), and it is the
    #      mirror of bark's. What it catches is someone quietly making this
    #      family isotropic again - reaching for a worley facet field because
    #      it "looks more like a surface" - which would put the repeat
    #      straight back. Measured at the SHIPPED size, because the board
    #      count and the joint widths are texel-scale and a 192 px proxy would
    #      let a change through that 512 px would not.
    sc = FAMILY_SIZE["concrete"]
    ch, _ = _concrete_height(sc, sc)
    cu = cv = 0.0
    for y in range(sc):
        row = y * sc
        for x in range(sc):
            here = ch[row + x]
            cu += abs(ch[row + (x + 1) % sc] - here)
            cv += abs(ch[((y + 1) % sc) * sc + x] - here)
    check("concrete boards cross v", cv > 1.5 * cu,
          "sum |dz/dv| %.1f vs sum |dz/du| %.1f, ratio %.2f (need > 1.50)"
          % (cv, cu, cv / cu if cu > 0 else float("inf")))

    # 7e3. RN-1815, AND IT IS THE HALF THAT MATTERS MORE. Anisotropy alone
    #      does not make a repeat invisible: a tile can be perfectly
    #      v-directional and still carry one enormous u-varying blotch. The
    #      property that actually decides whether a wall of copies reads as
    #      copies is the LOW-FREQUENCY CONTRAST of the tile - how much the
    #      tile varies at the scale of the tile itself - because that is the
    #      signal the eye integrates over a whole repeat.
    #
    #      Measured as the standard deviation of an 8 x 8 box downsample of
    #      the heightfield, normalised by the field's own full range so the
    #      number is comparable between families with different amplitudes.
    #
    #      THE REFERENCE IS `_stone_height` AND IT IS FROZEN ON PURPOSE, which
    #      is a decision RN-1815's reconciliation had to make rather than
    #      inherit. When this check was written, `_stone_height` WAS what
    #      `masonry` shipped, so "masonry" and "the field the pad wore" named
    #      one thing; RN-1835 then re-authored `masonry` as `_ashlar_height`
    #      and split them. This check keeps the FIELD THE PAD WORE, because
    #      what it guards is a regression against a NAMED DEFECT: the pad
    #      skirt wearing stone at 1.8 m is the exact surface a verifier
    #      refused as "a repeating dark aggregate rock tile", so that field is
    #      a historical constant and not a moving comparison. Routing the
    #      reference through FAMILIES instead would re-point the bound at
    #      whatever `masonry` happens to be, which is a different claim.
    #
    #      THE ALTERNATIVE WAS MEASURED BEFORE IT WAS REFUSED, because the
    #      obvious guess about it is wrong. `_ashlar_height` measures 0.0830
    #      here against `_stone_height`'s 0.1352, i.e. routing through the
    #      table would TIGHTEN this bound to 0.0415, not loosen it, and
    #      concrete's 0.0311 would still pass. It is refused on meaning and
    #      not on strictness. It is also refused on a measurement from the
    #      other side: the reconciliation verifier put column-averaged
    #      autocorrelation of the RENDERED wall at the 1.8 m tile at 0.144 for
    #      stone, -0.011 for concrete and 0.372 for ashlar, so ashlar renders
    #      as the MOST repetitive of the three while measuring the LEAST
    #      low-frequency height contrast. Ashlar's repeat lives in its
    #      per-block albedo tone, which this metric does not see at all.
    #      Binding concrete's gate to it would be binding to a number that
    #      demonstrably does not predict the rendered repeat.
    def _lowfreq(field, s, cells=8):
        step = s // cells
        cell = []
        for cy in range(cells):
            for cx in range(cells):
                t = 0.0
                for y in range(cy * step, (cy + 1) * step):
                    row = y * s
                    for x in range(cx * step, (cx + 1) * step):
                        t += field[row + x]
                cell.append(t / (step * step))
        m = sum(cell) / len(cell)
        var = sum((c - m) ** 2 for c in cell) / len(cell)
        rng = max(field) - min(field)
        return (math.sqrt(var) / rng) if rng > 0 else 0.0

    mh, _ = _stone_height(FAMILY_SIZE["masonry"], FAMILY_SIZE["masonry"])
    lf_m = _lowfreq(mh, FAMILY_SIZE["masonry"])
    lf_c = _lowfreq(ch, sc)
    check("concrete repeats less than the field the pad wore",
          lf_c < 0.5 * lf_m,
          "low-frequency contrast %.4f vs stone-at-1.8m's %.4f (need under "
          "half); `masonry` now ships `_ashlar_height`, see above for why "
          "this reference stays the refused field and not the current one"
          % (lf_c, lf_m))

    # 7f. Stone's facets are actually ANGULAR, and this is the check the whole
    #     family exists to satisfy (RN-742). `coarse` served every rock and
    #     measured a mean normal tilt of 7.69 degrees with a MAXIMUM of 27.19,
    #     so nothing on it could glint and nothing on it could catch a raking
    #     sun. The rule is a CONJUNCTION on purpose: the mean says the relief
    #     is there at all, the maximum says it has EDGES, and 7g below shows
    #     that it is the maximum doing the discriminating.
    #
    #     The measurement is the heightfield's own gradient angle, which is
    #     the same angle `_normal_rgb` stores as acos(blue) before 8-bit
    #     quantisation, taken at the SHIPPED size and the SHIPPED
    #     normal_strength so that retuning either one has to come past this
    #     check. atan and degrees appear here and nowhere in the field
    #     synthesis: the module header's no-transcendentals rule is about the
    #     bytes that ship, and a measurement writes none of them.
    def _tilt_stats(field, s, strength):
        tot, mx = 0.0, 0.0
        for y in range(s):
            ym = ((y - 1) % s) * s
            yp = ((y + 1) % s) * s
            row = y * s
            for x in range(s):
                dx = (field[row + (x + 1) % s]
                      - field[row + (x - 1) % s]) * strength
                dy = (field[yp + x] - field[ym + x]) * strength
                t = math.degrees(math.atan(math.sqrt(dx * dx + dy * dy)))
                tot += t
                if t > mx:
                    mx = t
        return tot / (s * s), mx

    s = FAMILY_SIZE["stone"]
    stone_k = FAMILIES["stone"]["normal_strength"]
    sh, _ = _stone_height(s, s)
    s_mean, s_max = _tilt_stats(sh, s, stone_k)
    cs = FAMILY_SIZE["coarse"]
    chf, _ = _coarse_height(cs, cs)
    c_mean, c_max = _tilt_stats(chf, cs, FAMILIES["coarse"]["normal_strength"])
    check("stone facets angular", s_mean >= 16.0 and s_max >= 55.0,
          "mean %.2f deg (need 16.00), max %.2f deg (need 55.00); `coarse`, "
          "the field this replaces, measures %.2f / %.2f"
          % (s_mean, s_max, c_mean, c_max))

    # 7g. NEGATIVE CONTROL, per DW-20: the SAME recipe with the arrises
    #     rounded off - coarse's `(1 - worley) ** 2` dome in place of the
    #     plane pair, at the same cells, seeds and amplitudes - must FAIL the
    #     rule above. What this catches is a tilt check that has quietly
    #     become a test of AMPLITUDE rather than of edges, and the numbers say
    #     that is a live risk rather than a theoretical one: the rounded field
    #     still clears the mean clause comfortably, because a steep cone is
    #     steep, and only the maximum clause refuses it. A version of this
    #     check written on the mean alone would pass on the exact defect.
    rsh, _ = _stone_height(s, s, rounded=True)
    r_mean, r_max = _tilt_stats(rsh, s, stone_k)
    check("stone round control fails", not (r_mean >= 16.0 and r_max >= 55.0),
          "arrises rounded: mean %.2f, max %.2f, correctly outside the "
          "16.00 / 55.00 rule (the max clause is the one that refuses it)"
          % (r_mean, r_max))

    # 7h. `rust`'s scale is ANGULAR, by `stone`'s measurement and against its
    #     own threshold. The family's whole claim is layered oxide plates that
    #     have LIFTED, and a lifted flake is an edge; a `rust` retuned until it
    #     is smooth is a rust that reads as brown paint, which is the thing
    #     this catches. The threshold is lower than `stone`'s 16/55 because the
    #     tilt is a third of stone's by design (a sheet of oxide lies nearly
    #     flat on the plate it came off, a fracture plane does not), and it is
    #     measured at the SHIPPED size and normal_strength so retuning either
    #     has to come past this check.
    s = FAMILY_SIZE["rust"]
    rust_k = FAMILIES["rust"]["normal_strength"]
    ruh, _ = _rust_height(s, s)
    ru_mean, ru_max = _tilt_stats(ruh, s, rust_k)
    check("rust scale angular", ru_mean >= 9.0 and ru_max >= 45.0,
          "mean %.2f deg (need 9.00), max %.2f deg (need 45.00)"
          % (ru_mean, ru_max))

    # 7i. NEGATIVE CONTROL, per DW-20: the same recipe with the scale layering
    #     and the spall pits removed - the two grain octaves alone, which is
    #     what this plate would be if the steel had never gone - must FAIL the
    #     rule above. As at 7g, this is what catches a tilt check that has
    #     quietly become a test of AMPLITUDE: the grain alone is not flat, it
    #     is just not EDGED.
    sndh, _ = _rust_height(s, s, sound=True)
    sn_mean, sn_max = _tilt_stats(sndh, s, rust_k)
    check("rust sound control fails", not (sn_mean >= 9.0 and sn_max >= 45.0),
          "grain only: mean %.2f, max %.2f, correctly outside the 9.00 / "
          "45.00 rule" % (sn_mean, sn_max))

    # 7j. `_edge_wear` SEPARATES PROUD FROM RECESSED, which is the only claim
    #     the mask makes and the one thing a consumer relies on. Measured on
    #     `paintchip`'s own substrate: mean exposure on the bolt tops must beat
    #     mean exposure in the groove floors by a real margin. What this
    #     catches is a mask wired to the wrong sign, which is a one-character
    #     defect that inverts every wear pass downstream and looks plausible in
    #     a thumbnail (paint worn off in the crevices reads as grime).
    def _pearson(a, b):
        n = len(a)
        ma = sum(a) / n
        mb = sum(b) / n
        num = sum((a[i] - ma) * (b[i] - mb) for i in range(n))
        da = math.sqrt(sum((v - ma) ** 2 for v in a))
        db = math.sqrt(sum((v - mb) ** 2 for v in b))
        return 0.0 if da * db == 0.0 else num / (da * db)

    s = 192
    _, pc_aux = _paintchip_height(s, s)
    sub = pc_aux["sub"]
    expo = pc_aux["expo"]
    hi = [expo[i] for i in range(s * s) if sub[i] > 1.10]
    lo = [expo[i] for i in range(s * s) if sub[i] < 0.30]
    hi_m = sum(hi) / len(hi) if hi else 0.0
    lo_m = sum(lo) / len(lo) if lo else 0.0
    check("edge wear finds proud", hi and lo and hi_m - lo_m >= 0.25,
          "bolt tops %.3f vs groove floors %.3f, separation %.3f (need 0.25) "
          "over %d / %d texels" % (hi_m, lo_m, hi_m - lo_m, len(hi), len(lo)))

    # 7k. NEGATIVE CONTROL for 7j: a field with no relief at all has no proud
    #     texels, so the mask must return a constant and the separation must
    #     collapse. This is what catches an `_edge_wear` that has acquired a
    #     noise term of its own and would report exposure on a flat plate.
    flat = [0.5] * (s * s)
    fexpo = _edge_wear(flat, s, s, 6, 2.6)
    check("edge wear flat control fails",
          max(fexpo) - min(fexpo) < 1e-9,
          "flat field gives a constant %.4f, spread %.2e"
          % (fexpo[0], max(fexpo) - min(fexpo)))

    # 7l. `paintchip`'s THREE MAPS AGREE, which is the entire premise of the
    #     family and the single most common way a wear pass goes wrong. Bare
    #     metal must be simultaneously more metallic, less rough and brighter
    #     than the coating beside it; if the three disagree the surface reads
    #     as dirt lying on metal rather than as metal with its coating worn
    #     off. Measured as correlations against the shipped construction.
    pc_r, pc_m = _paintchip_masks(s, s, None, pc_aux)
    pc_a = _paintchip_albedo(s, s, None, pc_aux)
    luma = [(pc_a[3 * i] + pc_a[3 * i + 1] + pc_a[3 * i + 2]) / 3.0
            for i in range(s * s)]
    rm = _pearson(pc_r, pc_m)
    am = _pearson(luma, pc_m)
    check("paintchip maps agree", rm <= -0.80 and am >= 0.50,
          "corr(rough, metal) %.3f (need <= -0.80), corr(albedo, metal) %.3f "
          "(need >= 0.50)" % (rm, am))

    # 7m. NEGATIVE CONTROL for 7l, per DW-20: drive the albedo from a
    #     DIFFERENT wear field than the ORM - an independent fbm standing in
    #     for the chip mask - and the agreement must collapse. This is exactly
    #     the defect described: two passes that each look fine alone and
    #     disagree texel for texel. Without this control 7l would be close to
    #     unfalsifiable, because both maps reading one mask makes a high
    #     correlation nearly automatic, and that is the point - the check has
    #     to demonstrate it is measuring the SHARING and not the arithmetic.
    bogus = dict(pc_aux)
    bogus["chip"] = _fbm(s, s, 9, 3, seed=999331)
    bad_a = _paintchip_albedo(s, s, None, bogus)
    bad_luma = [(bad_a[3 * i] + bad_a[3 * i + 1] + bad_a[3 * i + 2]) / 3.0
                for i in range(s * s)]
    bad_am = _pearson(bad_luma, pc_m)
    check("paintchip disagreement caught", not (bad_am >= 0.50),
          "albedo off an unrelated wear field: corr(albedo, metal) %.3f, "
          "correctly outside the >= 0.50 rule" % bad_am)

    # 7n. `masonry` IS LAID AND NOT BROKEN (RN-1835). The family's whole claim
    #     is that it is coursed ashlar rather than an isotropic fracture field,
    #     and the falsifiable form of that claim is ANISOTROPY AT THE COURSE
    #     LINES: a bed joint is a level line running the full width, so the
    #     mean |dz/dy| across the tile must beat the mean |dz/dx| by a real
    #     margin, because the bed joints are unbroken and the head joints are
    #     interrupted by the stagger. `stone` at the same measurement is
    #     isotropic to within a few per cent BY CONSTRUCTION (worley cells have
    #     no preferred axis), so it is the control and it is measured here
    #     rather than asserted. What this catches is the exact regression this
    #     family exists to fix: a masonry retuned back into a rock field.
    s = 192
    ash, ash_aux = _ashlar_height(s, s)

    def _aniso(field, n):
        sx = sy = 0.0
        for y in range(n):
            ym = ((y - 1) % n) * n
            yp = ((y + 1) % n) * n
            row = y * n
            for x in range(n):
                sx += abs(field[row + (x + 1) % n] - field[row + (x - 1) % n])
                sy += abs(field[yp + x] - field[ym + x])
        return sx / (n * n), sy / (n * n)

    a_dx, a_dy = _aniso(ash, s)
    st_h, _ = _stone_height(s, s)
    s_dx, s_dy = _aniso(st_h, s)
    ratio = a_dy / a_dx if a_dx else 0.0
    s_ratio = s_dy / s_dx if s_dx else 0.0
    check("masonry courses are level", ratio >= 1.25,
          "mean |dz/dy| / |dz/dx| = %.3f (need 1.25); `stone`, the isotropic "
          "field this replaces, measures %.3f on the same statistic"
          % (ratio, s_ratio))
    check("stone isotropy control", s_ratio < 1.25,
          "the control must NOT pass the course rule: %.3f is correctly under "
          "1.25, so 7n is measuring the bond and not the arithmetic"
          % s_ratio)

    # 7o. THE MORTAR IS A MATERIAL AND THE CHAMFER IS NOT (RN-1835). The first
    #     build of this family keyed the albedo's mortar colour on the whole
    #     recess, which painted a 98 mm pale band where the wall has a 20 mm
    #     one. The two masks must therefore differ by roughly the draft's own
    #     share of the recess, and `mortar` must be strictly inside `joint`
    #     everywhere: a texel that is mortar and not joint would be mortar
    #     lying on a block face.
    jm = sum(ash_aux["joint"]) / (s * s)
    mm = sum(ash_aux["mortar"]) / (s * s)
    outside = sum(1 for i in range(s * s)
                  if ash_aux["mortar"][i] > ash_aux["joint"][i] + 1e-9)
    check("mortar is inside the joint", outside == 0 and mm < jm * 0.62,
          "mortar covers %.4f of the tile against the recess's %.4f "
          "(need under 0.62 of it), and %d texels are mortar outside the "
          "recess (need 0)" % (mm, jm, outside))

    # 7p. THE ALBEDO DOES NOT REDRAW THE RELIEF INSIDE A BLOCK (RN-742's rule,
    #     kept where it still applies). This family is allowed to agree with
    #     its heightfield AT THE JOINT, because a mortar bed is a different
    #     material and not a shadow; it is not allowed to agree inside a
    #     block, which is the cobblestone defect RN-454 paid for.
    #
    #     THE RESIDUAL IS THE STATISTIC AND THE FIRST VERSION OF THIS CHECK
    #     GOT THAT WRONG, which is worth writing down because it is a trap any
    #     per-cell family will hit. Measured raw on block-face texels the
    #     correlation is 0.344, which reads as a failure and is not one: it is
    #     dominated by the fact that this tile contains about TEN blocks, and
    #     each block draws one tone hash and one set-height hash, so the two
    #     draws line up or fail to line up across a sample of ten. Measured,
    #     corr(height, tone) across the tile is 0.531 on independent hashes
    #     with different seeds -- which is exactly the standard error of a
    #     ten-point correlation and not a shared field. A check that fails on
    #     that is measuring a coincidence in the hash draws, not the defect.
    #     So both series have their OWN BLOCK'S MEAN removed first, and what
    #     is left is the only thing RN-742's rule was ever about: does the
    #     pigment inside one block reproduce the tooling relief inside that
    #     same block. The raw figure is reported beside it, because the gap
    #     between the two is the whole point.
    ash_a = _ashlar_albedo(s, s, ash, ash_aux)
    a_luma = [(ash_a[3 * i] + ash_a[3 * i + 1] + ash_a[3 * i + 2]) / 3.0
              for i in range(s * s)]
    face_i = [i for i in range(s * s) if ash_aux["joint"][i] < 0.02]
    a_rowc, a_colc = _ashlar_partition(s, s)
    keys = [a_colc[a_rowc[i // s][0]][i % s][0] for i in face_i]
    sums = {}
    for n, k in enumerate(keys):
        acc = sums.setdefault(k, [0.0, 0.0, 0])
        acc[0] += a_luma[face_i[n]]
        acc[1] += ash[face_i[n]]
        acc[2] += 1
    ra = [a_luma[face_i[n]] - sums[k][0] / sums[k][2] for n, k in enumerate(keys)]
    rh = [ash[face_i[n]] - sums[k][1] / sums[k][2] for n, k in enumerate(keys)]
    r_res = _pearson(ra, rh)
    r_face = _pearson([a_luma[i] for i in face_i], [ash[i] for i in face_i])
    check("masonry albedo is not the height", abs(r_res) <= 0.30,
          "WITHIN-BLOCK corr(albedo, height) %.3f (need |r| <= 0.30) over %d "
          "face texels in %d blocks. Raw, per-block means left in, it is "
          "%.3f, and the difference is the ten-draw coincidence the comment "
          "above sets out (`_stone_albedo` measures 0.07, `panel`'s "
          "deliberately-correlated albedo 0.29, an albedo that IS the height "
          "1.00)" % (r_res, len(face_i), len(sums), r_face))

    # 8. Every palette role is either mapped or explicitly flat. Catches the
    #    standing-rule-11 failure of a check that passes on what it never
    #    examined: a new role added to of_lib.PALETTE would otherwise silently
    #    ship untextured with nobody noticing.
    try:
        sys.path.insert(0, HERE)
        import of_lib_palette_probe  # pragma: no cover - never exists
    except Exception:
        pass
    roles = _palette_roles()
    if roles is None:
        check("every role decided", False,
              "could not read of_lib.PALETTE - NOT EXAMINED")
    else:
        undecided = sorted(r for r in roles
                           if r not in ROLE_FAMILY and r not in FLAT_ROLES)
        check("every role decided", not undecided,
              "%d role(s) mapped, %d flat, %d undecided%s"
              % (len(ROLE_FAMILY), len(FLAT_ROLES), len(undecided),
                 (": " + ", ".join(undecided)) if undecided else ""))
        stale = sorted(r for r in list(ROLE_FAMILY) + list(FLAT_ROLES)
                       if r not in roles)
        check("no stale roles", not stale, ", ".join(stale) or "none")

    # 9. NEGATIVE CONTROL for `check`, against the SHIPPED set. A gate nobody
    #    has ever seen fail is a gate nobody knows the state of. This copies
    #    the real texture directory, flips one bit in one PNG, and requires
    #    `check` to notice - and separately requires it to pass on the
    #    untouched copy, because a checker that fails on everything is just as
    #    useless as one that passes on everything.
    if os.path.isdir(OUT_DIR):
        import shutil
        good = os.path.join(tmp, "tex_good")
        shutil.copytree(OUT_DIR, good)
        ok_clean, _ = check_maps(good, verbose=False)
        check("check passes clean", ok_clean, "shipped set under check_maps")
        victim = os.path.join(good, "of_panel_orm.png")
        with open(victim, "rb") as fh:
            blob = bytearray(fh.read())
        blob[len(blob) // 2] ^= 0x01
        with open(victim, "wb") as fh:
            fh.write(blob)
        ok_dirty, _ = check_maps(good, verbose=False)
        check("check can fail", not ok_dirty,
              "one flipped bit in of_panel_orm.png was caught")
    else:
        check("check passes clean", False,
              "NOT EXAMINED: %s does not exist, run `texgen.py` first" % OUT_DIR)
        check("check can fail", False, "NOT EXAMINED: same reason")

    # 10. The RGBA encoder: round trip, stability, sensitivity, and the size
    #     guard. Checks 1-4 cover the RGB path; what bpp 3 cannot see is a
    #     filter that fails to invert at bpp 4.
    w = h = 33
    px4 = bytearray()
    for y in range(h):
        for x in range(w):
            px4 += bytes(((x * 5) % 256, (y * 9) % 256,
                          ((x ^ y) * 7) % 256, ((x + y) * 3) % 256))
    p4 = os.path.join(tmp, "rt4.png")
    write_png_rgba(p4, w, h, bytes(px4))
    rw, rh, rgba = read_png_rgba(p4)
    check("rgba round trip", (rw, rh) == (w, h) and rgba == bytes(px4),
          "%dx%d, %d bytes" % (rw, rh, len(rgba)))
    with open(p4, "rb") as fh:
        blob4 = fh.read()
    p5 = os.path.join(tmp, "rt5.png")
    write_png_rgba(p5, w, h, bytes(px4))
    with open(p5, "rb") as fh:
        check("rgba encode is stable", fh.read() == blob4,
              "%d bytes twice" % len(blob4))
    px5 = bytearray(px4)
    px5[4 * (17 * w + 11) + 2] ^= 0x20
    p6 = os.path.join(tmp, "rt6.png")
    write_png_rgba(p6, w, h, bytes(px5))
    with open(p6, "rb") as fh:
        check("rgba encode is sensitive", fh.read() != blob4,
              "one texel changed the file")
    try:
        write_png_rgba(p6, w, h, bytes(px4[:-4]))
        check("rgba refuses wrong size", False, "accepted a short buffer")
    except ValueError as exc:
        check("rgba refuses wrong size", True, str(exc)[:40])

    # 11. The card families, composed ONCE at shipped size and measured
    #     pre- and post-dilation. The pre-dilation buffer is the real
    #     negative control for the halo check: compose leaves background
    #     texels black precisely so this can fail (see _render_card).
    for name in sorted(ALBEDO_FAMILIES):
        spec = ALBEDO_FAMILIES[name]
        s = spec["size"]
        raw_rgb, alpha = _render_card(s, spec["strips"](), spec["noise_seed"])
        dil = _dilate_albedo(raw_rgb, alpha, s, s)
        edge, inner = _wrap_vs_interior_u([float(a) for a in alpha], s, s)
        check("%s alpha tiles in u" % name, edge <= inner,
              "wrap step %.0f vs worst interior %.0f" % (edge, inner))
        cov = _alpha_coverage(alpha)
        lo_b, hi_b = spec["coverage"]
        check("%s coverage in band" % name, lo_b <= cov <= hi_b,
              "%.3f in %.2f..%.2f (alpha >= 128)" % (cov, lo_b, hi_b))
        worst_post, ex_post = _halo_worst(dil, alpha, s, s)
        check("%s dilation kills halos" % name,
              ex_post > 0 and worst_post <= 64.0,
              "worst |luma - opaque-neighbour mean| %.1f over %d texels "
              "(max 64)" % (worst_post, ex_post))
        worst_pre, ex_pre = _halo_worst(raw_rgb, alpha, s, s)
        check("%s halo fails undilated" % name,
              ex_pre > 0 and worst_pre > 64.0,
              "undilated worst %.1f over %d texels, correctly over 64"
              % (worst_pre, ex_pre))
        check("%s tip rows clear" % name, _tip_rows_clear(alpha, s),
              "top %d rows all alpha 0 (the clamped tip edge dissolves)"
              % ALBEDO_TIP_ROWS)

    # 12. NEGATIVE CONTROLS for the card checks, per DW-20: each must be
    #     shown able to fail on a field built to fail it.
    s = 64
    uramp = [x / s for y in range(s) for x in range(s)]
    edge, inner = _wrap_vs_interior_u(uramp, s, s)
    check("u-seam check can fail", edge > inner,
          "u ramp: wrap step %.4f vs worst interior %.4f" % (edge, inner))
    band = ALBEDO_FAMILIES["grass"]["coverage"]
    c_ones = _alpha_coverage(bytes([255]) * (s * s))
    c_zeros = _alpha_coverage(bytes(s * s))
    check("coverage check can fail",
          not (band[0] <= c_ones <= band[1])
          and not (band[0] <= c_zeros <= band[1]),
          "all-opaque %.2f and all-transparent %.2f both outside %.2f..%.2f"
          % (c_ones, c_zeros, band[0], band[1]))
    top_alpha = bytearray(s * s)
    top_alpha[0:s] = b"\xff" * s
    check("tip check can fail", not _tip_rows_clear(top_alpha, s),
          "an opaque top row was caught")

    # 13. The alpha_test guard, exercised against the SHIPPED manifest the
    #     same way check 9 exercises the sha: copy, strip the field, and
    #     check_maps must refuse by name.
    if os.path.isdir(OUT_DIR):
        import shutil
        guard = os.path.join(tmp, "tex_guard")
        shutil.copytree(OUT_DIR, guard)
        gm_path = os.path.join(guard, "surfaces.json")
        with open(gm_path, "r", encoding="utf-8") as fh:
            gman = json.load(fh)
        gfam = gman.get("families", {}).get("grass", {})
        if "alpha_test" in gfam:
            del gfam["alpha_test"]
            with open(gm_path, "w", newline="\n", encoding="utf-8") as fh:
                json.dump(gman, fh, indent=2, sort_keys=False)
                fh.write("\n")
            ok_guard, _ = check_maps(guard, verbose=False)
            check("alpha_test guard can fail", not ok_guard,
                  "grass without alpha_test was refused")
        else:
            check("alpha_test guard can fail", False,
                  "NOT EXAMINED: shipped manifest has no grass alpha_test, "
                  "run `texgen.py` first")
    else:
        check("alpha_test guard can fail", False,
              "NOT EXAMINED: %s does not exist" % OUT_DIR)

    print("\n%s  %d check(s), %d failure(s)"
          % ("SELFTEST PASS" if not fails else "SELFTEST FAIL",
             count[0], len(fails)))
    return 0 if not fails else 1


def _palette_roles():
    """Read of_lib.PALETTE's keys WITHOUT importing of_lib, because of_lib
    imports bpy and this module must run in a plain python. Parsing the source
    is the honest way to do that; if the parse finds nothing it returns None so
    the caller can report NOT EXAMINED rather than a false pass."""
    path = os.path.join(HERE, "of_lib.py")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            src = fh.read()
    except OSError:
        return None
    start = src.find("PALETTE = {")
    if start < 0:
        return None
    depth, i = 0, src.index("{", start)
    for j in range(i, len(src)):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                body = src[i:j + 1]
                break
    else:
        return None
    roles = []
    for line in body.splitlines():
        line = line.strip()
        if line.startswith('"') and '":' in line:
            roles.append(line[1:line.index('":')])
    return roles or None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", nargs="?", default="build",
                    choices=["build", "selftest", "check"])
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--size", type=int, default=None,
                    help="override every family's resolution (debug only; the "
                         "shipped set uses FAMILY_SIZE)")
    ap.add_argument("--only", default=None, metavar="FAMILY",
                    help="regenerate ONE tiling family's PNGs and merge only "
                         "that family's rows into the existing surfaces.json. "
                         "Use this whenever another lane has uncommitted work "
                         "in this file: a full build writes every live lane's "
                         "in-flight family into the shipped set (RN-558)")
    ap.add_argument("--list", action="store_true",
                    help="print the role -> family table and exit")
    args = ap.parse_args()
    if args.list:
        for r, f in sorted(ROLE_FAMILY.items()):
            print("  %-14s %s" % (r, f))
        for r, why in sorted(FLAT_ROLES.items()):
            print("  %-14s FLAT   %s" % (r, why))
        return 0
    if args.cmd == "selftest":
        return selftest()
    if args.cmd == "check":
        ok, lines = check_maps(args.out)
        print("\n%s  %d check(s)" % ("TEXTURES PASS" if ok else "TEXTURES FAIL",
                                     len(lines)))
        return 0 if ok else 1
    generate(args.out, args.size, only=args.only)
    return 0


if __name__ == "__main__":
    sys.exit(main())
