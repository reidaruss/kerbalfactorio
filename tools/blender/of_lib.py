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
import struct
import sys

import bpy


# ---------------------------------------------------------------------------
# Palette. sRGB hex + PBR constants. Roles, not object names: an asset picks
# roles so the whole game stays inside one coherent set of surfaces.
# ---------------------------------------------------------------------------
# role -> (hex sRGB, metallic, roughness, alpha, emission hex or None)
PALETTE = {
    # --- industrial ---
    #
    # RN-1300 to RN-1310. THE THREE STEEL ROLES WERE AUTHORED AS BARE POLISHED
    # METAL AND WHAT THEY DEPICT IS A COATED MACHINE HOUSING. Unblocked by
    # RN-1250 to RN-1254, which measured every lighting lever this project owns
    # on one close-up machine frame and found the light adequate: the RN-64
    # ground bounce is already 29.1 per cent of the light on the camera-facing
    # face, the stock ambient floor buys 2.1 per cent and the screen-space
    # occlusion 24.9. So re-authoring here is not the boulder-albedo mistake
    # ART-DIRECTION.md exists to prevent; the light it would be compensating
    # for has been measured.
    #
    # WHICH LEVER ACTUALLY DOMINATES, MEASURED RATHER THAN ASSUMED. My brief
    # named two candidates - the albedo values are dark, or metalness 0.85
    # leaves almost no diffuse - and told me to find out which before moving
    # either. NEITHER, as stated. Composing three's own terms, a surface lit
    # entirely by a low-frequency environment returns
    #
    #     total  ~=  F0 + diffuse
    #            =  [0.04 + (c - 0.04) * m]  +  [c * (1 - m)]
    #            =  c + 0.04 * (1 - m)
    #
    # where `c` is the COMPOSITED diffuse colour. The metalness terms cancel to
    # first order: the specular a metal gains is the diffuse it loses, and what
    # is left is a dielectric floor worth at most 0.04 of absolute reflectance.
    # The frame agrees. On the RN-1250 machine box, metalness 0.85/0.85/0.80 ->
    # 0.20/0.20/0.18, which is a 4.35x rise in effective DIFFUSE albedo, moved
    # the median 12.44 -> 14.44 counts (+16 per cent); a 1.6x rise in the
    # authored COLOUR alone, with metalness untouched, moved the same median to
    # 20.22 (+63 per cent). A 1.6x on the colour beats a 4.35x on the diffuse
    # by four to one, so the albedo term is the lever and metalness is second
    # order. Both arms are one-lever, isolated and published.
    #
    # AND YET THE COLOURS ARE MOSTLY NOT MOVED, BECAUSE THE BIGGEST FACTOR IN
    # `c` IS NOT IN THIS TABLE. `c = palette * 0.4692` on the panel family:
    # `surfaces.json` publishes `albedo_mean` as the sRGB-DOMAIN mean of the
    # map (panel 0.5386) and `Surfaces.ts` divides it out through
    # `material.color`, which three stores and multiplies in LINEAR working
    # space against a map whose LINEAR mean is 0.2526. The "mean-neutral"
    # compensation therefore under-compensates by 2.132x, on all seven albedo
    # families (worst on `stone` at 0.4244 and `panel` at 0.4692, i.e. on rock
    # and machine). `?leaftex=0` removes both halves and lifts this box's
    # median 12.44 -> 28.21, +127 per cent against +113 predicted. That is the
    # single largest term on the whole question and it is a colour-space
    # mismatch, not an authoring choice. BRIGHTENING THIS TABLE TO CANCEL IT
    # WOULD BE THE BOULDER-ALBEDO MISTAKE EXACTLY - it would leave the next
    # lane a palette tuned to cancel a bug, and every machine 2.1x too bright
    # the day the bug is fixed. It is reported up, not compensated here.
    #
    # SO ONLY TWO THINGS MOVE, AND BOTH SURVIVE THAT FIX UNCHANGED.
    #
    # (1) METALNESS, ON THE GROUND THAT IT IS WRONG RATHER THAN THAT IT IS
    #     DARK. 0.85 is bare mill-finish steel. A machine housing is painted,
    #     powder-coated or galvanised, and paint is a dielectric; RN-1200
    #     already caught the same defect one layer up ("roughness 0.12 at
    #     metalness 0.43 IS polished metal", the chrome-rivet read) and fixed
    #     it for the two PAINT roles by making the channel reach a pixel at
    #     all, leaving these three still authored as mirrors. NOT 0.00: the
    #     panel ORM's blue channel runs 0.4196 to 1.0, so at 0.20 the effective
    #     metalness is 0.084 to 0.20 and the map's authored wear stays alive as
    #     bare metal showing through a coating, which is ART-DIRECTION.md's
    #     "surfaces that respond to light like materials" rather than a flat
    #     dielectric. Worth +0.032 of absolute reflectance, which is small in
    #     the highlights and large in the shade, and that is the point.
    #
    # (2) SteelDark's VALUE, and it is DERIVED, not tuned. The family is a
    #     three-step value ladder and it was lopsided: SteelLight sat 1.909 /
    #     1.862 / 1.793 above Steel per linear channel while Steel sat 3.711 /
    #     3.530 / 3.342 above SteelDark. 666D75 is the value that makes the
    #     lower step equal the upper one - Steel^2 / SteelLight per channel,
    #     giving 1.912 / 1.852 / 1.791 - so the ladder is geometric and the
    #     number comes from the other two rows rather than from a render.
    #     NUMBERS.md's "derive one from the other" in its cheapest form. This
    #     matters more than one row looks: SteelDark is 219 primitives across
    #     24 shipped binaries and 41.6 per cent of the machine pool's vertices,
    #     i.e. it IS the machine body. Steel and SteelLight are NOT moved, on
    #     purpose: Steel's linear 0.2542 is already at parity with the biome
    #     albedo near 0.25 in the same frame, so there is nothing wrong with it
    #     and "the palette is dark" is false of it.
    #
    # WHAT THE PAIR DOES TO THE FRAME, and the shape is the assertion rather
    # than the size (RN-1202). Machine box, game-lit, sun pinned at dot 0.45:
    # p05 1.30 -> 5.89 (+353%), p25 3.19 -> 11.07 (+247%), p50 12.44 -> 15.11
    # (+21%), p90 31.24 -> 32.22 (+3.1%), p99 81.49 -> 82.98 (+1.8%), max
    # 173.48 -> 173.48 UNCHANGED TO THE DIGIT. A gain multiplies every
    # percentile by one ratio; this multiplies the dark quarter by 3.5 and the
    # bright tail by 1.02, which is a fill's signature and is what "the
    # shadowed faces are too dark" asks for and what "do not blow the
    # highlights" requires. A single constant cannot do it.
    #
    # ROUGHNESS IS DELIBERATELY NOT TOUCHED, and it is owed. 0.35 x the panel
    # ORM's green (0.2235 at its glossiest) is an effective 0.078, which is a
    # mirror; on a dielectric that is a small bright spec rather than chrome,
    # so it is survivable, but it has not been argued and one lever at a time
    # is what makes the two above readable.
    "Steel":        ("8A9199", 0.20, 0.45, 1.0, None),
    "SteelDark":    ("666D75", 0.20, 0.55, 1.0, None),
    "SteelLight":   ("B9C0C7", 0.18, 0.35, 1.0, None),
    "Accent":       ("FF8A1E", 0.00, 0.50, 1.0, None),
    "Hazard":       ("F2C531", 0.00, 0.60, 1.0, None),
    "Rubber":       ("23262B", 0.00, 0.85, 1.0, None),
    # RN-1493/1494, RN-1550. THE ROLES THAT WEAR `paintchip` AND `rust`, which
    # shipped as pixels since RN-1474/RN-1475 and were worn by NOTHING until
    # these two passes wired them (A2b's own FAMILIES row said "NO ROLE WEARS
    # THIS YET" and RN-1478 is what makes the wiring possible at all: until
    # machines wore their authored family, a role pointed at either of these
    # would have drawn `panel` anyway).
    #
    # BOTH ROWS' CONSTANTS ARE DICTATED BY THE FAMILY, NOT CHOSEN HERE, and
    # that is the whole reason they are separate roles rather than a texture
    # swap on Steel. texgen.py states the required pairing in each family's
    # section header because the map cannot state it: the ORM channels
    # MULTIPLY the palette constants and the albedo is mean-neutral, so a
    # wrong constant is a SILENT failure rather than a visible one.
    #
    #   SteelWorn  paintchip wants metallic ~0.75, roughness ~0.55, at which
    #             the authored bands land at an effective metalness 0.21..0.75
    #             and roughness 0.24..0.55: coated where the paint holds, bare
    #             alloy where it has gone. Wired at Steel's 0.20 the bare metal
    #             cannot read as metal and the family's whole point is lost.
    #   SteelRust  rust wants an oxide-coloured hex of its OWN (7A4526..8C5A2E),
    #             metallic ~0.35, roughness ~0.92. Wired to Steel's 8A9199 it
    #             renders as GREY rust, which is texgen's named silent failure.
    #
    # THE COLOURS ARE DERIVED RATHER THAN PICKED. `SteelWorn` IS Steel - the
    # same coated plate, further along in its service life - so it takes
    # Steel's 8A9199 unchanged and differs from it only in the two constants
    # its family demands and in the family itself. That is the smallest honest
    # difference and it keeps a value decision out of a form pass. `SteelRust`
    # cannot borrow a colour, because oxide is the one thing in this palette
    # whose hue IS the material; 834F2A is the per-channel midpoint of the
    # range texgen names (7A4526, 8C5A2E), so the number comes from the
    # family's own header rather than from a render.
    #
    # INTEGRATION NOTE (art-forms merge, 2026-08-13): `SteelRust` was minted
    # twice, once per lane. The RN-1493/1494 smelter merge shipped it as
    # 5C4238 on the smelter's hot path and its own report recorded that
    # constant as a numeric hole ("luma 4.12 ... lift the hex 30 to 40 percent
    # before A4 copies the role"). The RN-1550 pass independently minted the
    # same role name at 834F2A, 0.35, 0.92 for the miner's wet-ore path, which
    # is roughly that lift. Rather than carry two roles with one name, this
    # merge keeps ONE `SteelRust` role at the art-forms constants below,
    # applied everywhere (smelter hot path and miner wet-ore path alike),
    # because it satisfies the smelter lane's own recorded recommendation
    # instead of contradicting it. `SteelWorn` (paintchip) and `Accent`
    # (also paintchip, above) do not conflict: two rows, two surfaces.
    "SteelWorn":    ("8A9199", 0.75, 0.55, 1.0, None),
    "SteelRust":    ("834F2A", 0.35, 0.92, 1.0, None),
    # RN-907. WAS 9FD8E8: LUMA 205 AND 73 COUNTS OF CHROMA, THE HIGHEST-VALUE
    # AND MOST SATURATED SURFACE ON THE PLAYER. Taken in a serialised window
    # (Admin, 2026-08-03) because this row is written into the bytes of SEVEN
    # shipped binaries and a .glb collision survives no commit discipline.
    #
    # I EXPECTED TO HAVE TO SPLIT THIS ROLE AND I DID NOT. Eight uses across
    # the seven files, and the two I expected to fight the change are the two
    # that wanted it most:
    #
    #   the visor, a machine's viewing pane, the pod's forward window, its
    #     side port, its instrument lens, and the station's viewports  - all
    #     want a window
    #   the oil flask, whose stated read is "the dark fill sitting two thirds
    #     up a transparent body", and the canister's sight strip - both want
    #     to be SEEN THROUGH
    #   the cave crystal, five 4-sided prisms whose own docstring says "four
    #     flat faces catch a helmet lamp as four distinct highlights"
    #
    # The crystal was the one I thought would break. It is RN-491's fang
    # exactly: a base at luma 205 in a dark cave has NOTHING LEFT TO BE
    # BRIGHTER THAN, so four facets cannot read as four highlights. Every one
    # of the eight wants a dark base with a sharp specular, so the role is not
    # doing two jobs and no new role (and therefore no client wiring) is
    # needed.
    #
    # WHY THE VALUE IS THE DEFECT, ARITHMETICALLY. In a BLEND material the pane
    # lays `alpha * baseColor` over whatever is behind it. At 0.35 x 205 that
    # is a **72-count pale wash** over the face RN-901 put inside the helmet
    # and over the oil inside the flask. At 0.35 x 57 it is **20 counts**, a
    # tint rather than a wash. What it does NOT do is flatten anything: the
    # separation between two things seen through the pane is 0.65 x their own
    # difference either way, i.e. 41.7 counts between that face and the
    # interior behind it, before and after, unchanged. The pane stops adding
    # 50 counts of brightness to everything behind it and hands that headroom
    # to the specular, which is the whole point of glass.
    #
    # 2A3C44 is luma 57 and 26 counts of chroma: a quarter of the saturation,
    # not zero, because a real laminate pane does carry a faint cool tint and
    # ART-DIRECTION.md asks for muted rather than neutral.
    #
    # ROUGHNESS 0.05 AND METALNESS 0.00 ARE DELIBERATELY UNTOUCHED. Glass is
    # the one row in this table that should have a mirror-sharp highlight and
    # it already did; the highlight was invisible because the base was as
    # bright as it was. ALPHA STAYS 0.35 TOO, and that is a decision rather
    # than an omission: three.js multiplies the whole shaded output including
    # the specular by alpha, so lowering it to buy transparency would take the
    # reflection with it. The transparency now comes from the dark base.
    "Glass":        ("2A3C44", 0.00, 0.05, 0.35, None),
    # --- materials / ores ---
    "Iron":         ("B4BAC0", 1.00, 0.40, 1.0, None),
    "Copper":       ("C06B3E", 1.00, 0.35, 1.0, None),
    "Coal":         ("1C1C1F", 0.00, 0.90, 1.0, None),
    # Ore IN ROCK, split from the refined-item rows above (RN-156). The item
    # roles are polished metal (metallic 1.0), and the client batches node
    # materials by metalness > 0.5, so a boulder seam wearing Iron landed in
    # the mirror-metal bucket and photographed as ice. A seam is a MINERAL:
    # every row here keeps metallic under the 0.5 batching split, on purpose,
    # and that bound is load-bearing, not aesthetic.
    #   IronOre   magnetite blue-grey, the iron ground patch's hue family
    #             (0x53687d), a full step cooler than Rock's warm 7A756C so
    #             the two never read as one grey at 30 m.
    #   CopperOre oxidised copper brown, the copper patch's 0xa04c19 family,
    #             darker than the bright item metal C06B3E.
    #   CoalSeam  near-black at LOW roughness: the vitreous glint is the
    #             entire coal-not-dark-rock signal, where the Coal item row
    #             above is matte 0.90 dust.
    #
    # RN-732: THE THREE ROWS BELOW NOW REACH A PIXEL, AND UNTIL THIS PASS THEY
    # DID NOT. `NodeBatch.makeBatch` built ONE material per family bucket with
    # `metalness: ore ? 0.25 : ...` and `roughness: ore ? 0.72 : ...` as
    # literals, and the merge baked only COLOUR into a vertex attribute, so all
    # three of these rows drew at exactly 0.72 / 0.25. Four minerals had TWO
    # material responses between them and both were constants in a ternary.
    # RN-731's per-vertex channel (RockShader.ts, inheriting PartMaterial.ts)
    # carries `authored x familyOrmChannel` through that merge, so these numbers
    # are now the level and the `ore` ORM supplies the variation. Re-authoring
    # them before the channel existed would have been writing into a void, which
    # is why RN-156 left them at look-dev's defaults and said so.
    #
    # WHAT EACH ONE NOW CLAIMS, in material terms rather than hue, measured
    # against the shipped `ore` ORM green (p05 0.486, p50 0.984, p95 1.000, and
    # 12.8 per cent of texels under 0.60, which are the facet crests):
    #
    #   IronOre    DENSE, with a metallic glint on FRESH FRACTURE. Metalness up
    #              0.25 -> 0.42 and roughness down 0.55 -> 0.44, so effective
    #              roughness is 0.21 to 0.44: a tight bright highlight on the
    #              crests against a matrix that stays dull. 0.42 is still UNDER
    #              the client's metalness > 0.5 batching split, which is
    #              load-bearing and not aesthetic (see the note above).
    #   CopperOre  OXIDE BLOOM AND WEATHERING, and the metalness goes DOWN
    #              rather than up, which is the whole point: an oxide crust is a
    #              DIELECTRIC over the metal, not exposed metal. 0.30 -> 0.16
    #              and roughness 0.50 -> 0.62, effective 0.30 to 0.62: the
    #              broadest and dullest sheen of the three, which is what a
    #              weathered nodular surface has and what a cleaved one does not.
    #   CoalSeam   Reid's brief says coal is matte and light-drinking, and RN-156
    #              says the vitreous glint is the entire coal signal. BOTH ARE
    #              TRUE OF REAL COAL and they are not in conflict: the LIGHT
    #              DRINKING is the albedo (1A1B1E is luma 27, the darkest row in
    #              the palette), and the seam roles are painted on FRESH FRACTURE
    #              faces, which in coal are conchoidal and vitreous. A uniformly
    #              matte near-black reads as a hole in the world, not as coal.
    #              So the glint stays and gets tighter, 0.30 -> 0.34 only to lift
    #              the p05 off section 2.1's 0.15 roughness floor (0.30 x 0.486
    #              was 0.146, i.e. under it), and metalness 0.10 -> 0.04 because
    #              carbon is a dielectric and 0.10 was borrowing a metallic tint
    #              the material has no claim to. The MATTE half of Reid's note is
    #              real and belongs to the CRUMBS, which is a separate change.
    #
    # BLAST RADIUS, CHECKED BEFORE EDITING AND THE REASON ONLY THESE THREE MOVED:
    # of_lib writes metallic and roughness into the exported glTF material, so a
    # palette edit rewrites the bytes of every asset using that role. These three
    # roles appear in exactly ONE asset each (boulder_iron, boulder_copper,
    # boulder_coal). `Rock` is in 23 assets and `RockDark` in 15, including a
    # sibling lane's in-flight smelter, so the host-rock rows are NOT touched
    # here and are escalated instead. That is RN-151's laundering hazard in .glb
    # form and it is avoided by arithmetic, not by care.
    "IronOre":      ("6E7B8A", 0.42, 0.44, 1.0, None),
    "CopperOre":    ("9A5228", 0.16, 0.62, 1.0, None),
    "CoalSeam":     ("1A1B1E", 0.04, 0.34, 1.0, None),
    # RN-742. THE HOST ROCK, and these two rows are a PAIR that tells one story
    # the geometry has been telling since RN-242 and the surface never has.
    #
    # `rock_form` paints a mass's shear and fracture planes with the DARK role
    # and its weathered outer skin with the light one, on every boulder, the
    # spire and the scree. So `Rock` is a face that has been rained on for a
    # long time and `RockDark` is a face that was made when the rock broke.
    # Until now both drew at 0.88 flat (NodeBatch's literal) and, once RN-723
    # made the authored value reach a pixel, both were still within 0.02 of each
    # other, which is not a difference any sun can find.
    #
    #   Rock      0.90 -> 0.94. Weathered, dusty, DRIER than before. The level
    #             can go UP because the `stone` family now supplies the
    #             variation: effective roughness is 0.42 to 0.94 across the map
    #             instead of a near-constant.
    #   RockDark  0.92 -> 0.80. A fresh fracture face is the one part of a rock
    #             that has not been dulled by weather, so it is the part that
    #             can still catch a raking sun. Effective 0.36 to 0.80.
    #
    # That is a 0.14 authored separation where there was 0.02, and it costs no
    # geometry: the faces are already painted, they were simply drawing the same
    # material. The stone boulder's whole "it shattered" story now reads off the
    # surface as well as the silhouette.
    #
    # METALNESS STAYS 0.00 ON BOTH. Stone is a dielectric and the `stone` ORM
    # holds metalness at identity, so there is nothing here for a metalness to
    # say. It is honestly constant rather than decoratively varied, which is
    # what section 2.1 item 4 asks for.
    #
    # THE HEX IS DELIBERATELY UNTOUCHED. Colour is look-dev's and Admin approved
    # a RESPONSE move, not a restyle; `stone` carries a mean-neutral tiling
    # albedo so the palette still owns the level, and moving both at once would
    # make the pair unattributable.
    #
    # BLAST RADIUS: `Rock` is in 23 shipped assets and `RockDark` in 15, so this
    # rewrites bytes far outside this lane. It is deliberately serialised with
    # Admin holding the other lanes rather than filtered, because the collision
    # would be in the .glb BYTES rather than in text and no commit discipline we
    # have survives that.
    "Rock":         ("7A756C", 0.00, 0.94, 1.0, None),
    "RockDark":     ("57534C", 0.00, 0.80, 1.0, None),
    "Sand":         ("C9B283", 0.00, 0.95, 1.0, None),
    "Soil":         ("5B4A38", 0.00, 1.00, 1.0, None),
    "Regolith":     ("6E6A66", 0.00, 0.95, 1.0, None),
    "Oil":          ("14100D", 0.00, 0.25, 1.0, None),
    "Water":        ("2F6E8C", 0.00, 0.10, 0.65, None),
    # --- nature ---
    "Bark":         ("4E3B2A", 0.00, 0.95, 1.0, None),
    "BarkLight":    ("6B5238", 0.00, 0.92, 1.0, None),
    # RN-1880 (look audit R4). THE TOOL HAFT IN THE FIRST-PERSON HAND.
    #
    # Split off `Bark` rather than re-tiled into it, for the reason texgen's
    # ROLE_FAMILY row states: bark's field is sized for a trunk at 3 to 10 m
    # and this is the one wood surface the player holds at 0.62 m. `Haft`
    # wears the `timber` family (1097 texels/m against bark's 640).
    #
    # THE COLOUR IS BARK'S, UNCHANGED TO THE DIGIT, AND THAT IS A RECORDED
    # NEGATIVE RESULT RATHER THAN AN OMISSION.
    #
    # The obvious move was RN-858's: the haft's lit face measures 78.2 counts
    # of chroma at luma 133.7 in `forestfloor`, and RN-858 struck 93 counts at
    # luma 147 off `Skin` as "a colour no person is", so 463E36 (chroma 36 ->
    # 16, value held inside a count) was built, rendered and measured. It
    # WORKED on the instrument -- the whole view model's `warm` fell 29.02 to
    # 14.62 against a frame at 11.45 -- and it made the frame worse: the shaft
    # came back a cool grey-white and read as bone or moulded plastic instead
    # of wood, because taking the hue out of an object that is still four and
    # a half times too bright leaves a pale neutral cylinder.
    #
    # WHY, AND IT IS THE WHOLE R4 FINDING IN ONE RATIO. The haft's rendered
    # chroma-to-luma is `Bark`'s OWN to three decimals (0.585 against 0.585),
    # so the peach the look audit saw is this palette row lit correctly by a
    # light that is wrong, not a wrong palette row. Render pass 4 has no
    # shadow map (`Boot.addLighting(scenes.viewModel, ..., hemi=false)`), so
    # the view model never loses the sun when the world does: measured
    # model-to-frame luma 2.76 in `forestfloor` and 3.36 in `machine`, both
    # shaded sites, against 1.23 in `ruin`, which is open. Repainting a
    # palette row to compensate for that is tuning away a measurement, and
    # the open frame is the control that proves it would be wrong there.
    #
    # So `Haft` differs from `Bark` in exactly the two things that are this
    # lane's to change: the FAMILY it wears (`timber`, 1097 texels/m against
    # bark's 640) and its roughness. 0.90 rather than 0.95 because a haft is
    # polished by a hand where a trunk is not.
    "Haft":         ("4E3B2A", 0.00, 0.90, 1.0, None),
    # The lashing and the grip wrap: ONE role for both, because they are one
    # material (rawhide cord) doing two jobs on the same stick, and because
    # the tools' contract allows three materials and this keeps them at three.
    #
    # IT REPLACES `Accent` ON THESE TWO ASSETS, WHICH IS THE POINT. `Accent`
    # is FF8A1E, the most saturated row in this table, and RN-645 already
    # removed exactly that colour from exactly this frame once ("under the
    # corrected FOV it is the largest single block of colour in the
    # first-person frame ... ART-DIRECTION.md names pastel and saturated
    # primaries as the thing to unlearn"). It came back on the object the
    # hand is holding. Rawhide is what actually lashes a stone head to a
    # branch, so this is the honest object as well as the quieter one.
    #
    # 33291F is 32 counts of chroma at luma 42.1, a clear value step DOWN
    # from the haft's 63.3 so the wrap reads as a band in silhouette rather
    # than as a paint stripe, which is the same argument `ChitinBand` records
    # for going darker than the shell instead of lighter.
    "Rawhide":      ("33291F", 0.00, 0.86, 1.0, None),
    "Leaf":         ("4C7A38", 0.00, 0.80, 1.0, None),
    "LeafDeep":     ("2F4F26", 0.00, 0.84, 1.0, None),
    "LeafLight":    ("7FA84E", 0.00, 0.76, 1.0, None),
    "LeafDry":      ("8A7A3E", 0.00, 0.85, 1.0, None),
    # RN-2245: the far-tier crown impostor. THE HEX AND THE ROUGHNESS ARE
    # `Leaf`'S TO THE DIGIT, AND THAT IS A MEASUREMENT DECISION, NOT LAZINESS.
    # The card stands for the same substance a `Leaf` card does, this lane
    # changes the TEXTURE and not the palette, and the surface pipeline divides
    # each family's own `albedo_mean_linear` back out through `material.color`
    # -- so an identical hex makes the frame's mean green provably unmoved and
    # leaves the whole before/after difference attributable to crown structure.
    # It also closes the seam at `CANOPY_NEAR_M`: a harvest tree's own `_LOD3`
    # card just inside 550 m is `OF_Leaf`, and a canopy card just outside it is
    # this, and they must not differ in tone across that line.
    "Canopy":       ("4C7A38", 0.00, 0.80, 1.0, None),
    "Grass":        ("6F8F42", 0.00, 0.88, 1.0, None),
    "Ice":          ("CFE6F0", 0.00, 0.25, 1.0, None),
    # RN-2700. SNOW IS NOT ICE, AND THE WHOLE R6 RANK-1 FINDING IS THAT ONE
    # ROW WAS DOING BOTH JOBS. `Ice` above is a near-specular blue dielectric
    # and that is CORRECT for what wears it: a polar pressure ridge, a glacial
    # erratic's glaze, the frost on a boulder's apex fan. It is wrong for a
    # 22 cm drift lying in a hollow, and at `mtnslope` the audit measured what
    # wrong looks like: a shaded facet reading **-11.40** warm (r minus b)
    # against the substrate beside it on the same row at **+34.81**, a 46.21
    # count inversion between two surfaces sharing one hemisphere.
    #
    # A NEW ROLE AND NOT A REPOINT OF `Ice`, for the reason RN-1780 minted
    # `Masonry` off `Rock` rather than moving it: `Ice` is worn by
    # `Polar_IceShard`, `Polar_IceBoulder`'s glaze and `Polar_SnowDrift`, this
    # table is baked into the .glb by Blender, and repointing it would rewrite
    # `props_polar.glb`'s bytes from a lane whose subject is one prop in
    # `props_mountains.glb`. Two of those three are genuinely ice and should
    # not move at all. The third IS snow and is recorded as owed in
    # rendering.md 2.47 rather than swept in here.
    #
    # THE HEX. Snow's spectral reflectance is FLAT across the visible to within
    # a few per cent; the blue everyone has seen in snow needs metres of path
    # length through solid ice to accumulate, which a 22 cm drift does not
    # have. So the cold cast was never a fact about the substance. What IS a
    # fact about THIS snow is that it is wind-packed and lying on a scree slope
    # under blowing mineral debris, and light-absorbing impurities are the
    # reason an aged snowpack falls from 0.85 to 0.65 albedo: dust and soot
    # absorb hardest at short wavelengths and least in the red, so dusty snow
    # is warm-shifted rather than neutral. E6E2DA is 12 counts of chroma, which
    # is quieter than `SuitGrime`'s 15, the row this table already calls one of
    # its least saturated.
    #
    # THE VALUE IS `Ice`'s OWN AND THAT IS THE SAFETY ARGUMENT, not an
    # accident. In linear Rec.709 luma E6E2DA reads 0.76278 against CFE6F0's
    # 0.76150, a difference of 0.17 per cent, so the entire measurable change
    # in this row is CHROMA and ROUGHNESS. Every luma-based pin in the guard is
    # therefore protected by arithmetic before any frame is taken, on exactly
    # the argument FoliageTone.ts records for RN-2495's saturation move. 0.763
    # broadband is also the right number on its own: aged, packed, slightly
    # dusty snow sits at 0.65 to 0.80 and fresh snowfall, which this is not,
    # sits at 0.85 to 0.90.
    #
    # THE ROUGHNESS DOES THE OTHER HALF. At 0.25 the shipped material carries a
    # tight specular lobe, and a tight lobe on an upward-facing surface returns
    # the SKY, which is the second cold term and the one that made the shaded
    # facets read blue while the lit ones read warm. Snow is a dense random
    # medium of ice grains with no coherent facet to reflect anything in, so it
    # is near-Lambertian at this scale. 0.90 and not 0.95 because a wind crust
    # does develop a skin that catches a low sun as a sheen, which is why a
    # snowfield glares at sunset; that read is worth keeping and `vistadawn` is
    # the pose that would lose it. It sits where it should among the natural
    # rows: rougher than `RockDark` 0.80, smoother than `Rock` 0.94 and `Sand`
    # 0.95, and nowhere near the ice it stopped being.
    #
    # The forward scatter snow actually has is NOT modelled here and the
    # omission is deliberate rather than forgotten: the honest mechanism is
    # transmission through the drift, `emission` is the only slot in this tuple
    # that could fake it, and an emissive drift would glow at `meadownight`.
    # The two terms above are what a metallic-roughness dielectric can say
    # truthfully. See rendering.md 2.47 for what a real snow BSDF would owe.
    "Snow":         ("E6E2DA", 0.00, 0.90, 1.0, None),
    # --- character ---
    "Suit":         ("D8D3C6", 0.00, 0.65, 1.0, None),
    "SuitDark":     ("6E6A60", 0.00, 0.70, 1.0, None),
    # RN-859. GROUND-IN DIRT, and it is a ROLE rather than a darker tint
    # because ART-DIRECTION.md's "clean is a defect" is a claim about MATERIAL
    # and not about value. Grime is matte: roughness 0.92 against SuitDark's
    # 0.70, so the two answer a light differently and the dirty part of a
    # glove stops catching the sheen the clean part does. That difference
    # survives a lighting change, which a darker paint does not.
    #
    # 15 counts of chroma at luma 69, i.e. deliberately one of the LEAST
    # saturated rows in this table. Dirt on a light suit is not brown, it is
    # the absence of the suit's own value, and a saturated brown would be the
    # exact mistake RN-858 just took out of `Skin`.
    #
    # It wears `suitfab`, the family the suit already wears, so no new texture
    # is generated and no family PNG changes: the weave still reads through
    # the dirt, which is what makes it look like dirt ON fabric rather than a
    # patch of different fabric.
    "SuitGrime":    ("4A443B", 0.00, 0.92, 1.0, None),
    "SuitAccent":   ("2E7DBE", 0.00, 0.55, 1.0, None),
    "Plate":        ("7E8790", 0.70, 0.42, 1.0, None),
    # RN-858. WAS C08A63, WHICH MEASURED 93 COUNTS OF CHROMA (max channel
    # minus min, on 0..255) AND WAS THE SEVENTH MOST SATURATED ROW IN THIS
    # WHOLE TABLE, above Water and every leaf. On a first-person frame it
    # rendered at 87 counts at p50, which is the number that matters: the
    # authored chroma predicts the rendered chroma almost exactly, so this row
    # WAS the orange, not the lighting.
    #
    # ART-DIRECTION.md asks for "grounded, muted, layered colour. Not pastel,
    # not saturated primaries. Value and material contrast do the work rather
    # than hue." A wrist is the one part of this game that is a person, and
    # 93 counts of orange is a colour no person is.
    #
    # A58C73 is 50 counts of chroma at luma 143.5, against the old 93 at
    # 146.7: the SATURATION halves and the VALUE is held inside 4 counts, on
    # purpose. The skin still reads as skin because of what it sits against,
    # which is `Suit` at luma 211 and 18 counts of chroma. That contrast is a
    # value contrast, which is what the direction asks the work to be done by.
    #
    # BLAST RADIUS, MEASURED BEFORE EDITING rather than reasoned about: this
    # role appears in exactly TWO shipped binaries, `player_body.glb` and
    # `player_fp_arms.glb`, and no others. Checked by reading the material
    # names out of all 52 shipped `.glb` files, not by grepping build scripts,
    # because of_lib writes the colour into the exported glTF material and it
    # is the BINARY that carries it.
    "Skin":         ("A58C73", 0.00, 0.70, 1.0, None),
    # --- creature (RN-455) ---
    # These four lived in build_spider.py as a runtime PALETTE.update() on the
    # argument that they belong to exactly one asset. That was right while the
    # spider was untextured and is wrong now: texgen's ROLE_FAMILY table, the
    # surfaces.json manifest, surface_preview and the client's role table all
    # read the palette, and texgen's own "no stale roles" gate refuses a family
    # row for a role of_lib has never heard of. A role that wears a surface is
    # a first-class palette role.
    #
    # VALUES ARE OWNED HERE ONLY FOR THE CREATURE ROLES (Admin lifted the
    # look-dev freeze for the spider, 2026-08-01). Everything above is still
    # look-dev's.
    #
    # RN-461: the three shell roles went 0.80/0.84 roughness to 0.95/0.96
    # and 0.04 metalness to 0.02. Reid on the shipped shell: "it looks like
    # its made of shiny stone". A sharp specular is the strongest hard
    # surface cue there is, so the creature loses it everywhere except the
    # FANG, which is bare cuticle and keeps 0.30 on purpose: it is the one
    # part that should still catch a light.
    #
    # Chitin came UP from v1's 2B2126, which is the single biggest value
    # decision in the pass. Section 2.1's reference groundNear luma is 35 to 55
    # at the vegetated sites; a creature at luma 36 is the same value as the
    # ground it stands on and has no separation from it at any sun angle, and
    # the shipped grade (contrast 1.45, lift 0) crushes the difference further.
    # 4A3B36 reads luma 62: darker than anything else that moves, lighter than
    # the ground, and with enough room under it for the albedo's crease
    # darkening to land somewhere.
    "Chitin":       ("4A3B36", 0.02, 0.95, 1.0, None),
    # The tergite seams. DARKER than the shell rather than lighter, which is
    # the second version: a light band wide enough to see reads as a tan patch
    # glued to the abdomen, and a dark one reads as the shadow under a plate
    # that overlaps the plate behind it, which is what it physically is. This
    # is also the only per-part signal that survives SpiderFlock's merge,
    # because colour is the one channel that merge bakes.
    "ChitinBand":   ("2C2422", 0.02, 0.96, 1.0, None),
    "ChitinUnder":  ("6B5A4C", 0.02, 0.96, 1.0, None),
    # RN-491. Reid, on the pelt build: "the fangs appear to have the texture
    # as well. the fangs can be solid white with a sheen". Both halves of that
    # are now reachable, because the merge carries per-part roughness and a
    # bare flag (see BARE_ROLES below and PartMaterial.ts). C9BCA2 was a bone
    # tan that the fur albedo then painted over.
    #
    # THE VALUE IS TAKEN FROM THE MATERIAL AND NOT FROM THE RENDER, and the
    # first version of this row was the other way round and was measurably
    # wrong. EDE8DC (linear 0.826) measured a fang whose MEDIAN pixel was 255:
    # over half the part was clipped, the form was gone, and the specular had
    # nothing left to be brighter than, which is the opposite of a sheen. But
    # tuning that number down against the STUDIO would have repeated RN-456
    # exactly, because the studio renders on Standard + High Contrast, which
    # clips, while the game is on ACES, which rolls off: at exposure 1.2 a
    # scene-linear 1.0 lands near display 233 and it takes about 8.0 to reach
    # 251. So the number comes from neither render. Keratin and ivory sit at
    # 0.60 to 0.70 diffuse reflectance, and D5D1C6 is linear 0.646/0.622/0.556.
    # It reads luma ~209 against the shell's 62 and section 2.1's groundNear
    # 35 to 55, which is the largest value step anywhere on the creature and
    # is the whole point of a fang, and it leaves the specular somewhere to
    # go. Not FFFFFF: ART-DIRECTION.md names clean as a defect, and the hair
    # of warmth is what keeps it keratin rather than paper.
    # 0.30 to 0.18 is the sheen. It is the only value on the creature under
    # section 2.1's 0.15 floor plus a margin, and it is deliberately far from
    # the shell's 0.745..0.95 band: hard wet keratin against soft velvet is
    # what makes both read.
    "Fang":         ("D5D1C6", 0.02, 0.18, 1.0, None),
    # The anterior median pair keeps the amber eyeshine: it is the tell that
    # the thing has seen you, and it reads at a distance where nothing else on
    # the creature does. The other six are near-black, which is what a wet
    # convex bead actually looks like, and the pair reads as wet by VALUE
    # against the shell rather than by a specular the merge cannot give it.
    "EyeGlow":      ("E8913A", 0.00, 0.10, 1.0, None),
    "EyeDark":      ("1A1418", 0.00, 0.10, 1.0, None),
    # --- state light: ONE material per machine, driven at runtime ---
    # base is near-black so an unlit chip reads as "off"; emission is white and
    # three.js recolours material.emissive per FFactoryEntityState.VisualState.
    "EmissiveState": ("101216", 0.00, 0.30, 1.0, "FFFFFF"),
    # RN-1780. THE MASONRY FAMILY SPLIT (look audit R3). `stone`'s consumers
    # measure 0.14 m to 35.2 m across the shipped bytes (an item-atlas chunk to
    # the ruin), and RN-953 already refused retiling `stone` itself: a tile
    # that reads on the ruin puts a 1.4 m boulder at 0.78 repeats. `Masonry`
    # and `MasonryDark` are the SAME two constants as `Rock`/`RockDark` byte
    # for byte (colour, metalness, roughness are unchanged; only the tiling
    # surface family they point at differs, via ROLE_FAMILY), so this row
    # changes nothing about how the ruin, the foundation or the launch pad
    # look up close per-facet - it only lets them wear a texture whose world
    # scale is authored for architecture instead of for a boulder.
    "Masonry":      ("7A756C", 0.00, 0.94, 1.0, None),
    "MasonryDark":  ("57534C", 0.00, 0.80, 1.0, None),
    # RN-1815. POURED CONCRETE, ITS OWN FAMILY, AND THE ARGUMENT IS THE ONE
    # THAT SPLIT `Masonry` OUT OF `Rock` ONE STEP FURTHER ALONG.
    #
    # RN-1780 moved the ruin, the foundation and the launch pad off `stone`
    # because stone's 0.6 m tile was the wrong WORLD SCALE for architecture,
    # and it fixed exactly that: `masonry` is stone's own recipe at 1.8 m and
    # 512 px. What it could not fix, because it deliberately reused stone's
    # generator functions, is that the recipe is FRACTURED ROCK - a field of
    # 7.5 cm facets separated by arrises. That is the right substance for the
    # ruin, which is quarried and laid stone, and it is the wrong substance
    # for a launch pad, which is poured. The pad's own fresh-context verifier
    # named it: the 2 m outer skirt is the largest surface in the walk and
    # close frames and it reads as a dark aggregate rock tile.
    #
    # THE THREE ROLES, AND WHY THREE. `Concrete` is the poured cap - the deck
    # a crew walks on and the bunker. `ConcreteDark` is the same material as
    # MASS: the plinth, the trench floor at the mouths, the stair, the deck's
    # control joints. Two values because `ground()`'s 0.20 m ledge is a
    # HORIZON LINE on a 9 x 24 m block and a horizon line needs two values
    # either side of it; that argument is unchanged from the roles these
    # replace. `ConcreteSoot` is the third and it belongs to this pass's
    # second owed item: soot deposited ON concrete, which is a different
    # surface from soot on steel and must show the concrete through it
    # (RN-859's rule, where `SuitGrime` reused `suitfab` so the weave reads
    # through the dirt rather than becoming a patch of different fabric).
    #
    # THE HEXES ARE DERIVED, NOT PICKED. `Masonry` 7A756C and `MasonryDark`
    # 57534C are WARM GREYS at 11 and 11 counts of chroma, which is right for
    # weathered rock and wrong for cement: portland concrete is a cool
    # near-neutral. Each new hex holds its predecessor's LUMA band and takes
    # the chroma down and the neutral point cool, which is the smallest
    # honest difference and keeps a value decision out of a material pass:
    #   Concrete     878680  luma 133.8, chroma  7  (Masonry     117.4, 14)
    #   ConcreteDark 63615B  luma  97.0, chroma  8  (MasonryDark  83.4, 11)
    # Both move UP in value on purpose and that is the one deliberate look
    # change here: outdoor concrete is a light grey, and the skirt reading
    # DARK is half of why it reads as rock. `ConcreteSoot` is not a concrete
    # colour at all - it is what is lying on the concrete - so it takes the
    # soot value below rather than a lift of either row.
    "Concrete":     ("878680", 0.00, 0.94, 1.0, None),
    "ConcreteDark": ("63615B", 0.00, 0.88, 1.0, None),
    "ConcreteSoot": ("35322E", 0.00, 0.97, 1.0, None),
    #
    # RN-1820. TWO MORE VALUES OF THE SAME MATERIAL, AND THEY EXIST FOR A
    # DEFECT NO TILING MAP CAN REACH.
    #
    # The RN-1815 verifier's third finding against the skirt: "the tone is
    # uniform across all 24 m, with no pour-to-pour variation. A wall that
    # size is poured in lifts and each lift cures slightly differently. Add
    # that variation at the lift scale, not as noise." That is a statement
    # about a length THIRTEEN TIMES the texture's period. `concrete` tiles at
    # 1.8 m, so every macro term the map could carry repeats 13.3 times along
    # this wall and is by construction the opposite of pour-to-pour variation:
    # authoring it in the map would add exactly the countable repeat the same
    # verifier's other finding is about. The variation has to live above the
    # tile, and the only thing above the tile is the material assignment.
    #
    # SO THE PLINTH IS SPLIT INTO POUR BAYS (see `ground()` in
    # build_launch_pad.py) and the bays wear three values of one material.
    # THE NAMES ARE THE PHYSICAL CAUSE, not a lightness ranking: cement paste
    # cures darker than the sand in the mix, so a RICH bay (more cement) comes
    # out a shade deeper and a LEAN one a shade paler, which is the ordinary
    # reason two pours off two trucks do not match. Nine counts of luma either
    # side of `ConcreteDark`, i.e. a little under a tenth:
    #   ConcreteLean 6C6A64  luma 106.0, chroma 8
    #   ConcreteDark 63615B  luma  97.0, chroma 8   (unchanged, the middle bay)
    #   ConcreteRich 5A5853  luma  88.0, chroma 7
    # THE CHROMA DOES NOT MOVE and that is the guardrail on this pair: the
    # whole argument for the `concrete` hexes above is that portland concrete
    # is a cool near-neutral, and a "variation" that reached for hue would
    # undo it three bays at a time. Only value varies, and by a step small
    # enough that no single bay reads as a different material.
    "ConcreteLean": ("6C6A64", 0.00, 0.88, 1.0, None),
    "ConcreteRich": ("5A5853", 0.00, 0.88, 1.0, None),
    # RN-1815. SOOT ON STEEL, and it is a role rather than a retune of
    # `SteelRust` because they are two different deposits that happen in two
    # different places on the same trench.
    #
    # The verifier's finding: the trench reads as RUST PAINT. It is one
    # 834F2A band running the full 24 m of both trench walls at a measured
    # saturation of 0.634 on the sunlit wall and 0.829 on the shaded one, and
    # a supersonic exhaust plume does not leave orange, it leaves carbon.
    # Soot is dark, near-neutral and matte; 2B2724 is 7 counts of chroma at
    # luma 39.6, against `SteelRust`'s 89 counts of chroma at luma 87.4: 45
    # per cent of its value and under a TWELFTH of its chroma.
    #
    # ROUGHNESS 0.98 AND METALNESS 0.02, both against `SteelRust`'s 0.92 and
    # 0.35, and both physical rather than stylistic: soot is a dielectric
    # carbon powder lying ON the steel, so the metal is buried, and it is the
    # matte-est thing in this palette because a deposit of loose particles has
    # no specular lobe to speak of. That is also what makes the two read as
    # two materials rather than as one recolour, which is the same test the
    # `SteelRust`/`SteelWorn` pair above is held to.
    #
    # IT WEARS THE `rust` FAMILY, ON PURPOSE, and this is RN-859's rule again:
    # the steel under the soot is oxidised, so the flake relief has to read
    # THROUGH the deposit. A new family would be three more PNGs to say the
    # same thing about the same substrate. RN-1494 recorded the converse of
    # this as a silent failure - "`rust` wired to a grey role renders grey
    # rust" - and grey rust is precisely what soot on corroded steel is.
    #
    # RN-1820. THE VALUE IS LIFTED 2B2724 -> 48413C, AND THE REASON IS A
    # MEASURED DEFECT AND NOT A CHANGE OF MIND ABOUT WHAT SOOT IS.
    #
    # RN-1815 disclosed its own cost and routed it here: on real D3D11 from
    # the south mouth the liner rectangle went luma 51.33 -> 22.96 and loFrac
    # 0.142 -> 0.609, i.e. 61 per cent of the near liner became near-black and
    # the surface lost its form. The pass's own verifier read it as "the near
    # liner is crushed" and "soot should read as deposit ON a surface, not as
    # absence of surface", which is exactly RN-859's rule failing in the
    # direction the role was built to satisfy: `Soot` wears `rust` so the
    # oxidised steel reads THROUGH the carbon, and at 2B2724 in a trench
    # interior there is not enough light coming back off it for anything to
    # read through anything.
    #
    # THE FIRST ATTEMPT AT THIS LIFT WAS BUILT, MEASURED AND REFUSED, AND IT
    # IS THE REASON THE HEX BELOW IS BLUE. Scaling all three channels by one
    # number (2B2724 -> 48413C, chosen so the render lands near luma 40) does
    # exactly what it says to the BASE colour - (max - min) / max is 0.163
    # before and 0.167 after - and it put the rendered liner at luma 32.05 at
    # **sat 0.363 and warm 15.04**, against the 0.245 / 5.46 that RN-1815's
    # verifier named as the win to keep. The photograph agreed with the
    # number: the near liner came back as an orange oxide panel, which is the
    # "rust paint" finding returning the moment the value did.
    #
    # WHY, AND IT IS AN ARCHITECTURE FACT NOT A TUNING ONE. `Surfaces.ts`
    # divides `albedo_mean_linear` out of the map, and that quantity is a
    # SCALAR: three then composes `material.color x map`, so a family's own
    # HUE passes straight through to every role that wears it. Measured off
    # the shipped bytes, `of_rust_a.png` has mean linear RGB
    # 0.28924 / 0.18160 / 0.09950, i.e. a **2.907 : 1 linear R/B skew**. That
    # is correct and wanted for `SteelRust`, which is oxide. It is inherited,
    # unasked, by every other role on the family - and `Soot` is on the family
    # deliberately (RN-859's rule, the flake relief must read through the
    # deposit), so `Soot` was buying an orange multiplier with it.
    #
    # RN-1815's 0.245 was therefore not a property of 2B2724. It was a
    # property of 2B2724 BEING TOO DARK TO SEE: at that value the additive
    # blue of the sky ambient (fitted at 0.0037 / 0.0051 / 0.0056 linear from
    # two builds of this exact frame) was most of the pixel and it cancelled
    # the map's orange. Restoring the value necessarily restores the orange.
    # The two halves of the verifier's ask - "bring the form back" and "keep
    # sat 0.245 and warm 5.46" - cannot both be met by any grey hex on this
    # family, which is why one dial is not enough.
    #
    # SO THE HEX CANCELS THE MAP AND THIS IS NOT A SWATCH OF SOOT. It is a
    # MULTIPLIER, and it is derived: normalise the map's mean to green
    # (1.5927 / 1.0 / 0.5479) and ask for a base whose product with it is
    # neutral, i.e. a base in the reciprocal ratio 0.628 / 1.0 / 1.825; then
    # set the level so the product renders near luma 38 (linear 0.06507 /
    # 0.09191 / 0.12464). That is 485663. The check that the derivation is
    # about the MAP and not about this trench's light: folding the map into
    # the fit above leaves the per-channel light gain at 0.169 / 0.156 / 0.164
    # - equal to within 8 per cent - so the warm cast was the texture, end to
    # end, and cancelling it leaves the surface as neutral as the light is.
    #
    # WHY NOT MOVE `Soot` OFF `rust`. `panel` measures 1.021 linear R/B and
    # would need no cancellation, and it is the wrong surface: the liner is
    # burnt, eroded plate and `panel` is clean plate with rivets, so the
    # flake relief that RN-859's rule exists to preserve would go. A `soot`
    # family of its own is three more PNGs, about 4 MiB of VRAM, to say the
    # same thing about the same substrate that `rust` already says - the exact
    # spend RN-1815 refused, and refusing it is still right.
    #
    # ROUGHNESS AND METALNESS ARE UNCHANGED at 0.98 / 0.02: they are what make
    # this read as loose powder rather than as paint, the finding is about
    # value and hue, and moving four dials at once would leave no way to say
    # which one worked.
    "Soot":         ("485663", 0.02, 0.98, 1.0, None),
    # RN-1780. THE FIREBOX PEEP AND SIGHT STRIP (look audit R6). A role of its
    # own, not a re-point of `EmissiveState`: the name still ENDS WITH
    # "EmissiveState" on purpose, because `MachineFx.ts` (`mat.name.endsWith(
    # 'EmissiveState')`) and `MachineGeometry.roleOf` both match on that
    # suffix, and re-pointing the bare `EmissiveState` role itself would put a
    # coal-glow texture on every status chip in the game (23 other build
    # scripts use it). This role is worn by NOTHING except `build_smelter.py`'s
    # peep and sight strip, so `MachineGlow`'s per-instance fire colour,
    # intensity and flicker keep driving it exactly as before, and only the
    # SPATIAL variation is new (the `ember` family's emissive map). Base and
    # emit are copied from `EmissiveState` for the same reason: the runtime
    # clones the material and overwrites `emissive`/`emissiveIntensity`
    # itself, so nothing here is a visible default, only a well-formed one.
    "EmberEmissiveState": ("101216", 0.00, 0.55, 1.0, "FFFFFF"),
}

# Roles that must render double-sided. Everything else is backface-culled,
# which is roughly half the fragment work on a scene made of boxes.
DOUBLE_SIDED = {"Glass", "Leaf", "LeafDeep", "LeafLight", "LeafDry", "Grass",
                "Canopy", "Water"}

# Roles that are NOT members of their asset's dominant surface family, and so
# must not wear its tiling maps: no family albedo, no family strand normal, no
# family ORM. They render as their own authored colour and their own authored
# roughness and metalness. RN-491.
#
# THIS IS THE GENERAL MECHANISM AND NOT A FANG SPECIAL CASE. Every merged
# single-material asset after the spider has the same shape of problem: the
# player suit is fabric plus a glass visor plus metal fittings, and a machine
# is painted steel plus glass plus rubber. One family cannot describe all of
# them, and the part that is not the family is exactly the part a viewer looks
# at. `bare` is the escape hatch for that part. It composes with the per-part
# roughness and metalness channel, so a bare part is not merely unmapped, it
# has its own material response.
#
# HOW IT REACHES THE CLIENT: as a glTF material `extras` entry (`of_bare`),
# written from a Blender material custom property, which of_lib exports
# because GLTF_SETTINGS has export_extras=True. three's GLTFLoader assigns
# material extras to `material.userData`, so no name parsing and no duplicated
# role table on the client side. Set on the MATERIAL rather than the mesh
# because a role is the thing that is or is not a family member.
#
# The property is written ONLY for roles in this set, so every material of
# every other asset exports exactly the bytes it exported before, which is
# what makes the rebuild gate meaningful here.
BARE_ROLES = {"Fang"}

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
    # Frame 0, not 1. Authored frame 1 is the FIRST frame of every clip and has
    # to leave here at t = 0 s, so it is keyed on Blender frame 0. See
    # clip_frame() for the whole argument (DW-34).
    scn.frame_start = int(clip_frame(1))
    scn.frame_end = int(clip_frame(1))
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
    # RN-491. A custom property on the material becomes glTF material extras
    # (export_extras=True), which three's GLTFLoader assigns to
    # material.userData. Written only for BARE_ROLES so no other asset's
    # material bytes move.
    if role in BARE_ROLES:
        mat["of_bare"] = 1.0
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

def _box_data(size, loc, rot_z=0.0):
    """rot_z (degrees) yaws the box about its own centre. Hand-piled stone
    reads as piled precisely because no two blocks share an edge angle, and a
    few degrees of yaw is the cheapest way to buy that. Note the yawed box has
    a LARGER world AABB than its size: half-extent becomes
    h*(|cos| + |sin|), so a block near the cell edge must be checked."""
    sx, sy, sz = (s * 0.5 for s in size)
    cx, cy, cz = loc
    corners = [(-sx, -sy), (sx, -sy), (sx, sy), (-sx, sy)]
    if rot_z:
        a = math.radians(rot_z)
        ca, sa = math.cos(a), math.sin(a)
        corners = [(x * ca - y * sa, x * sa + y * ca) for x, y in corners]
    v = ([(cx + x, cy + y, cz - sz) for x, y in corners]
         + [(cx + x, cy + y, cz + sz) for x, y in corners])
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
              radius_top=None, phase_deg=0.0):
    n = segments
    h = depth * 0.5
    r_b = radius
    r_t = radius if radius_top is None else radius_top
    ph = math.radians(phase_deg)
    ring_b, ring_t = [], []
    for i in range(n):
        a = 2.0 * math.pi * i / n + ph
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


def _arc_band_data(r_in, r_out, depth, loc, a0_deg, a1_deg, segments):
    """A prism swept along an arc: the quarter-annulus a belt curve is made of.

    Angles are degrees in the XY plane, 0 along +X, increasing CCW. a0/a1 are
    normalised so winding (and therefore backface culling) is direction
    independent. r_in must be > 0; a zero inner radius collapses the inner wall
    into degenerate faces that mesh.validate() silently deletes, which would
    make the reported triangle count a lie."""
    if r_in <= 0.0:
        raise ValueError("arc_band needs r_in > 0 (got %r)" % r_in)
    a0, a1 = (a0_deg, a1_deg) if a0_deg <= a1_deg else (a1_deg, a0_deg)
    n = max(1, segments)
    h = depth * 0.5
    cx, cy, cz = loc
    ib, ob, it, ot = [], [], [], []
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        ca, sa = math.cos(a), math.sin(a)
        ib.append((cx + r_in * ca, cy + r_in * sa, cz - h))
        ob.append((cx + r_out * ca, cy + r_out * sa, cz - h))
        it.append((cx + r_in * ca, cy + r_in * sa, cz + h))
        ot.append((cx + r_out * ca, cy + r_out * sa, cz + h))
    verts = ib + ob + it + ot
    N = n + 1
    IB, OB, IT, OT = 0, N, 2 * N, 3 * N
    faces, smooth = [], []
    for i in range(n):
        faces.append((IT + i, OT + i, OT + i + 1, IT + i + 1))       # top
        smooth.append(False)
        faces.append((IB + i, IB + i + 1, OB + i + 1, OB + i))       # bottom
        smooth.append(False)
        faces.append((OB + i, OB + i + 1, OT + i + 1, OT + i))       # outer
        smooth.append(True)
        faces.append((IB + i, IT + i, IT + i + 1, IB + i + 1))       # inner
        smooth.append(True)
    faces.append((IB, OB, OT, IT))                                   # start cap
    smooth.append(False)
    faces.append((IB + n, IT + n, OT + n, OB + n))                   # end cap
    smooth.append(False)
    return verts, faces, smooth


def box_data(size, loc=(0, 0, 0), rot_z=0.0):
    """Raw (verts, faces, smooth) for a box: the Parts-pile form of
    MeshBuilder.box. An asset that needs PER-FACE roles (an ore facet, a log's
    end grain) accumulates raw tuples in a harvest_common.Parts pile instead of
    calling MeshBuilder directly, and until now that pile could not express a
    box without re-implementing one."""
    return _box_data(size, loc, rot_z)


def cyl_data(radius, depth, loc=(0, 0, 0), axis="Z", segments=12,
             smooth_sides=True, radius_top=None, phase_deg=0.0):
    """Raw (verts, faces, smooth) for a cylinder or frustum. Same reason as
    box_data: the Parts pile needs the primitives too."""
    return _cyl_data(radius, depth, loc, axis, segments, smooth_sides,
                     radius_top, phase_deg)


def arc_band_data(r_in, r_out, depth, loc=(0, 0, 0), a0_deg=0.0, a1_deg=90.0,
                  segments=6):
    """Raw (verts, faces, smooth) for a quarter-annulus prism: belt curve decks,
    and the helmet's wrap-around visor band."""
    return _arc_band_data(r_in, r_out, depth, loc, a0_deg, a1_deg, segments)


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
        # Per-vertex bone whitelist for skinned assets, filled from bind().
        # None for every static asset, so nothing about the 25 unrigged files
        # changes.
        self.vert_bones = []
        self._bind = None
        # Per-vertex UVs, None unless a caller supplies them. Exactly one asset
        # supplies them (the Tier-2 engine plume, whose whole point is a length
        # gradient a shader reads). EVERY OTHER MESH NOW GETS BOX-PROJECTED UVs
        # AUTOMATICALLY in build(); see _project_uvs for the whole argument.
        self.uvs = []

    def bind(self, bones):
        """Set the bone whitelist applied to every vertex added AFTER this call.

        Skinning a character built out of separate boxes is where automatic
        weights fall over: bone heat needs a closed manifold, and a pile of
        overlapping primitives is the opposite of one. A whitelist turns the
        problem into a solved one - a glove considers only the hand bone, an
        arm tube considers only that arm's chain - so distance weighting inside
        the whitelist gives a smooth joint blend with structurally zero chance
        of the left thigh picking up weight from the right one.

        Pass None to clear (the vertex then considers every deform bone)."""
        self._bind = None if bones is None else list(bones)
        return self

    def _role_index(self, role):
        if role not in self.roles:
            self.roles.append(role)
        return self.roles.index(role)

    def _add(self, v, f, sm, role, uvs=None):
        base = len(self.verts)
        ri = self._role_index(role)
        self.verts.extend(v)
        self.vert_bones.extend([self._bind] * len(v))
        self.uvs.extend(list(uvs) if uvs else [None] * len(v))
        for face, s in zip(f, sm):
            self.faces.append(tuple(i + base for i in face))
            self.smooth.append(s)
            self.face_role.append(ri)
        return self

    def add_raw(self, verts, faces, smooth=None, role="Steel", uvs=None):
        """Append an arbitrary vertex/face list under one role.

        The escape hatch for shapes the named primitives cannot express: rock
        lobes, canopy blobs, irregular pool rims. Faces index into `verts`
        locally; the builder rebases them. Every vertex in `verts` must be
        referenced by some face, because mesh.validate() deletes loose
        vertices and that would silently desync the reported triangle count
        from the exported one.

        `uvs` is one (u, v) per vertex. Omit it and the mesh exports with no
        TEXCOORD_0 at all, which is what every Tier-0 and Tier-1 asset does."""
        if smooth is None:
            smooth = [False] * len(faces)
        return self._add(verts, faces, smooth, role, uvs)

    def bounds(self):
        """(lo, hi) of the accumulated vertices. The build scripts print this
        so the number written into contracts.json is a MEASURED one, and a part
        whose declared dimensions drifted is caught before the exporter runs
        rather than by the validator afterwards."""
        lo = [1e30] * 3
        hi = [-1e30] * 3
        for p in self.verts:
            for k in range(3):
                lo[k] = min(lo[k], p[k])
                hi[k] = max(hi[k], p[k])
        return lo, hi

    def box(self, size, loc=(0, 0, 0), role="Steel", rot_z=0.0):
        return self._add(*_box_data(size, loc, rot_z), role)

    def cylinder(self, radius, depth, loc=(0, 0, 0), axis="Z", segments=12,
                 role="Steel", smooth_sides=True, phase_deg=0.0):
        v, f, sm = _cyl_data(radius, depth, loc, axis, segments, smooth_sides,
                             phase_deg=phase_deg)
        return self._add(v, f, sm, role)

    def frustum(self, radius, radius_top, depth, loc=(0, 0, 0), axis="Z",
                segments=8, role="Steel", smooth_sides=True, phase_deg=0.0):
        """Tapered cylinder. radius_top 0 gives a cone (the drill bit, the
        insulator caps); a non-zero top gives a taper (chimney collars, hoppers).

        phase_deg rotates the ring about its own axis. Stacked conifer tiers
        use it so the canopy is not radially symmetric, which is what stops a
        procedural tree from reading as procedural."""
        v, f, sm = _cyl_data(radius, depth, loc, axis, segments, smooth_sides,
                             radius_top=radius_top, phase_deg=phase_deg)
        return self._add(v, f, sm, role)

    def arc_band(self, r_in, r_out, depth, loc=(0, 0, 0), a0_deg=0.0,
                 a1_deg=90.0, segments=6, role="Steel"):
        """Quarter-annulus prism. Belt curve decks, rails and slat fans."""
        v, f, sm = _arc_band_data(r_in, r_out, depth, loc, a0_deg, a1_deg,
                                  segments)
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

    # -- UV projection ------------------------------------------------------
    #
    # WHY EVERY MESH GETS UVs AND NOT JUST THE TEXTURED ONES (DW-35). The
    # client merges a multi-material asset's primitives with
    # `mergeGeometries(list, false)`, and three's implementation returns NULL
    # when the attribute sets differ. Both call sites swallow that null with
    # `?? list[0]`, so an asset whose primitives disagree about having UVs
    # draws its FIRST primitive and silently discards the rest, with one
    # console line as the only evidence. A partial rollout is therefore far
    # more dangerous than no rollout, and "textured assets only" is not a
    # coherent option. Uniform UVs, selective MAPS: the role -> family table in
    # texgen.py decides which surfaces actually wear something.
    #
    # WHY BOX PROJECTION. Everything in this game is a box, a cylinder or an
    # arc band, authored from world-axis primitives. Projecting each face along
    # its own dominant axis is exact for the flat case, which is most faces,
    # and degrades gracefully on the round ones into the same slight azimuthal
    # stretch a cylindrical unwrap would give. It needs no per-asset authoring,
    # which is the only reason 48 assets could be done at once.
    #
    # WHY UVs ARE IN METRES. A UV of 2.5 means 2.5 metres, not 2.5 repeats. The
    # consumer divides by the family's tile size (texture.repeat = 1 / tile_m,
    # published in assets/textures/dist/surfaces.json). Retuning texel density
    # is then a one-line change in a JSON file instead of a rebuild and
    # rebaseline of all 48 binaries, and the shipped geometry carries a
    # physical fact rather than a tuning constant.

    _UV_AXES = {0: (1, 2), 1: (0, 2), 2: (0, 1)}

    def _face_normal(self, face):
        """Newell's method, computed here rather than read off Blender, so the
        UVs depend on nothing but this file's arithmetic."""
        nx = ny = nz = 0.0
        n = len(face)
        for i in range(n):
            a = self.verts[face[i]]
            b = self.verts[face[(i + 1) % n]]
            nx += (a[1] - b[1]) * (a[2] + b[2])
            ny += (a[2] - b[2]) * (a[0] + b[0])
            nz += (a[0] - b[0]) * (a[1] + b[1])
        return nx, ny, nz

    def _project_uvs(self):
        """[(u, v) per corner] for every face, in metres, box-projected."""
        out = []
        for face in self.faces:
            nx, ny, nz = self._face_normal(face)
            ax, ay, az = abs(nx), abs(ny), abs(nz)
            # Ties break X, then Y, then Z. A tie is a 45 degree face, where
            # either choice is equally good; what matters is that the SAME face
            # always picks the SAME one, on every machine and every run.
            axis = 0 if (ax >= ay and ax >= az) else (1 if ay >= az else 2)
            i, j = self._UV_AXES[axis]
            out.append(tuple((self.verts[k][i], self.verts[k][j])
                             for k in face))
        return out

    def build(self, name, parent=None, project_uv=None):
        """Realise the accumulated primitives as a Blender object.

        project_uv  None  auto: box-project unless the caller supplied explicit
                          per-vertex UVs, and never on a `col_` proxy
                    True  force projection even over supplied UVs
                    False no UV layer at all
        """
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.verts, [], self.faces)
        mesh.validate(verbose=False)
        for role in self.roles:
            mesh.materials.append(get_material(role))
        # This zip has always assumed mesh.polygons is 1:1 and in order with
        # self.faces. It is, but mesh.validate() is allowed to delete a
        # degenerate face, and if it ever did, every material index and smooth
        # flag past that point would shift by one and nothing would say so.
        # Now it says so.
        if len(mesh.polygons) != len(self.faces):
            raise RuntimeError(
                "%s: mesh.validate() changed the face count %d -> %d, so "
                "per-face roles, smoothing and UVs no longer line up"
                % (name, len(self.faces), len(mesh.polygons)))
        for poly, ri, sm in zip(mesh.polygons, self.face_role, self.smooth):
            poly.material_index = ri
            poly.use_smooth = sm

        explicit = any(uv is not None for uv in self.uvs)
        if project_uv is None:
            # A collision proxy is never rendered and never enters a batch
            # (the client filters `col_*` in Loaders.renderMeshes), so UVs on
            # one are bytes with no reader.
            project_uv = not explicit and not name.startswith("col_")
        if explicit and not project_uv:
            # MIXED coverage is legal and means: a vertex WITH a supplied UV
            # keeps it (authored unit card space, see props_common's foliage
            # UV helpers), and a vertex WITHOUT one falls back to the same
            # box projection every untextured face already gets. That is what
            # lets one prop mesh carry an alpha-card grass blade and a
            # metre-projected pebble side by side without the blade's UVs
            # leaking onto the stone or vice versa.
            layer = mesh.uv_layers.new(name="UVMap")
            if all(uv is not None for uv in self.uvs):
                for loop in mesh.loops:
                    layer.data[loop.index].uv = self.uvs[loop.vertex_index]
            else:
                face_uv = self._project_uvs()
                for poly, fuv in zip(mesh.polygons, face_uv):
                    for k, li in enumerate(poly.loop_indices):
                        uv = self.uvs[mesh.loops[li].vertex_index]
                        layer.data[li].uv = uv if uv is not None else fuv[k]
        elif project_uv:
            layer = mesh.uv_layers.new(name="UVMap")
            face_uv = self._project_uvs()
            for poly, fuv in zip(mesh.polygons, face_uv):
                for k, li in enumerate(poly.loop_indices):
                    layer.data[li].uv = fuv[k]
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
# Armatures, skinning and bone-parented sockets.
#
# WHY THIS EXISTS AT ALL (decision DW-7): the player is the one Tier-0 asset a
# script cannot fully author, because skin weights normally need either a GUI
# pass or Blender's bone-heat "automatic weights" operator. Automatic weights
# solve a Laplacian over a CLOSED MANIFOLD surface; every asset in this game is
# a pile of intersecting boxes and tubes, which is exactly the input bone heat
# refuses ("failed to find solution for one or more bones").
#
# So the pipeline stays scripted and the weights are solved here, from bone
# SEGMENT DISTANCE inside a per-part bone whitelist (MeshBuilder.bind). That is
# deterministic, diffable and re-runnable like the rest of the pipeline, and it
# is better than envelope weights because the whitelist removes cross-limb
# bleed rather than trying to tune it away with falloff radii.
# ---------------------------------------------------------------------------

def add_armature(name, bones, parent=None):
    """Create an armature object.

    bones is a list of (bone_name, head_xyz, tail_xyz, parent_name_or_None),
    parents first. Bone names are the runtime contract: the engine binds tools
    to `socket_hand_R`, but a retarget map or an IK solver binds to the bone
    names themselves, so they are as load-bearing as a socket name.

    Bones are left DISCONNECTED (use_connect False) even where head meets tail.
    A connected bone cannot be translated independently, and the hips
    translation is what carries every walk and jump clip."""
    data = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    made = {}
    for bname, head, tail, pname in bones:
        eb = data.edit_bones.new(bname)
        eb.head = head
        eb.tail = tail
        eb.roll = 0.0
        eb.use_connect = False
        if pname is not None:
            if pname not in made:
                raise KeyError("bone %r declared before its parent %r"
                               % (bname, pname))
            eb.parent = made[pname]
        made[bname] = eb
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)
    return obj


def bone_segments(bones):
    """{name: (head, tail)} from the same list add_armature() takes."""
    return {b[0]: (tuple(b[1]), tuple(b[2])) for b in bones}


def _point_segment_dist(p, a, b):
    ab = [b[k] - a[k] for k in range(3)]
    ap = [p[k] - a[k] for k in range(3)]
    denom = sum(c * c for c in ab)
    t = 0.0 if denom < 1e-12 else max(0.0, min(1.0, sum(
        ap[k] * ab[k] for k in range(3)) / denom))
    d = [ap[k] - ab[k] * t for k in range(3)]
    return math.sqrt(sum(c * c for c in d))


def solve_weights(verts, vert_bones, segments, power=4.0, max_influences=4,
                  eps=0.02):
    """Distance-to-bone-segment skin weights. Returns {bone: [(vert, w), ...]}.

    `power` is the whole character of the deformation. Too low and a shin picks
    up thigh weight and the knee turns to rubber; too high and the blend
    collapses to rigid parts with a visible crack at every joint. 4 puts the
    50/50 blend band roughly one bone-radius either side of a joint, which is
    what a hard-surface suit wants: panels stay panels, joints bend.

    max_influences is 4 because that is what glTF's JOINTS_0/WEIGHTS_0 carries
    and what ASSET-SPECS 4.1 declares."""
    groups = {}
    names_all = list(segments)
    for i, p in enumerate(verts):
        allow = vert_bones[i] if i < len(vert_bones) and vert_bones[i] else names_all
        ws = []
        for name in allow:
            a, b = segments[name]
            ws.append((name, 1.0 / (_point_segment_dist(p, a, b) + eps) ** power))
        ws.sort(key=lambda t: (-t[1], t[0]))
        ws = ws[:max_influences]
        total = sum(w for _, w in ws) or 1.0
        for name, w in ws:
            groups.setdefault(name, []).append((i, w / total))
    return groups


def bind_skin(obj, arm, groups=None):
    """Parent `obj` to armature `arm` and add its vertex groups.

    groups=None attaches the modifier only, for an LOD copy that already
    inherited its vertex groups from the object it was decimated from."""
    if groups is not None:
        n = len(obj.data.vertices)
        for bone, pairs in groups.items():
            vg = obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
            for idx, w in pairs:
                if idx >= n:
                    raise IndexError(
                        "weight for vertex %d but the mesh has %d - "
                        "mesh.validate() deleted a loose vertex" % (idx, n))
                vg.add([idx], w, "REPLACE")
    obj.parent = arm
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    mod.use_vertex_groups = True
    return obj


def skin_mesh(obj, mb, arm, segments, **kw):
    """Solve and apply weights for a MeshBuilder-built object in one call.

    The MeshBuilder is needed as well as the object because the whitelist rides
    on the builder (MeshBuilder.bind) and because the builder's vertex ORDER is
    the mesh's vertex order - which holds only as long as no vertex is loose,
    since mesh.validate() deletes those."""
    groups = solve_weights(mb.verts, mb.vert_bones, segments, **kw)
    return bind_skin(obj, arm, groups)


def skin_auto(obj, arm):
    """Blender's own bone-heat automatic weights.

    Returns (ok, note). `ok` is False if the operator refused OR if it returned
    but left vertices with no weight at all, because a silent partial solve is
    the failure mode that matters: it exports, it validates, and it renders as
    a limb that stays behind when the character walks.

    Kept because DW-7 says to try it first and because it is the honest
    baseline to measure the scripted solver against."""
    for o in list(bpy.context.selected_objects):
        o.select_set(False)
    obj.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    note = ""
    try:
        res = bpy.ops.object.parent_set(type="ARMATURE_AUTO")
        ok = "FINISHED" in res
        if not ok:
            note = "operator returned %s" % sorted(res)
    except Exception as exc:
        ok, note = False, str(exc).strip().splitlines()[-1]
    if ok:
        bone_names = {b.name for b in arm.data.bones}
        idx = {g.index for g in obj.vertex_groups if g.name in bone_names}
        unweighted = sum(
            1 for v in obj.data.vertices
            if not any(g.group in idx and g.weight > 1e-6 for g in v.groups))
        if unweighted:
            ok = False
            note = "%d of %d vertices came back unweighted" % (
                unweighted, len(obj.data.vertices))
    obj.select_set(False)
    arm.select_set(False)
    return ok, note


def add_bone_socket(name, arm, bone, loc, rot=(0.0, 0.0, 0.0), extras=None):
    """A socket Empty parented to a BONE, so it rides the animation.

    `loc` is in ARMATURE space (the same coordinates the bones were declared
    in), not bone space, because that is the space an author can reason about:
    'the right palm is at x = -0.75, z = 1.45'. Blender bone-parents to the
    bone TAIL with the bone's own axes, so the basis is solved back out here
    rather than being a number the author has to guess."""
    e = add_socket(name, (0.0, 0.0, 0.0), rot, parent=None, extras=extras)
    e.parent = arm
    e.parent_type = "BONE"
    e.parent_bone = bone
    bpy.context.view_layer.update()
    from mathutils import Euler, Matrix
    e.matrix_world = (Matrix.Translation(loc)
                      @ Euler(rot, "XYZ").to_matrix().to_4x4())
    bpy.context.view_layer.update()
    return e


def _rot_matrix(rot):
    """(rx, ry, rz) degrees in XYZ order, or [(axis, degrees), ...] applied
    innermost first. See pose_clip for why both forms exist."""
    from mathutils import Euler, Matrix
    if (len(rot) == 3
            and all(isinstance(v, (int, float)) for v in rot)):
        return Euler((math.radians(rot[0]), math.radians(rot[1]),
                      math.radians(rot[2])), "XYZ").to_matrix()
    m = Matrix.Identity(3)
    for axis, deg in rot:
        m = Matrix.Rotation(math.radians(deg), 3, axis) @ m
    return m


# ---------------------------------------------------------------------------
# Clip frame numbering. The ONE place that decides where a clip starts.
# ---------------------------------------------------------------------------

# Clips are AUTHORED 1-based: a clip runs from frame 1 to frame n, n frames
# long, and rig_common.keys() samples a pose function across exactly that
# range. That is the convention every build script and every table in
# ASSET-SPECS is written in, and it stays.
#
# What CANNOT stay is keying authored frame 1 on Blender frame 1. The glTF
# exporter turns a Blender frame straight into a time:
#
#     seconds = frame / (fps * fps_base)        io_scene_gltf2 .../animation/
#                                               keyframes.py:13
#
# so a first key on frame 1 exports at t = 1/60 s, three.js reads the clip's
# duration off the last track time and gets n/60, and every clip opens with a
# 16.7 ms hold in which nothing moves. On Run that is 0.4167 s of loop against
# 0.400 s of authored motion: a 7.5 cm positional snap once per cycle at
# 4.5 m/s, forever, in the clip a player watches more than any other (DW-34).
#
# The fix is here and not in a build script, and not in the exporter's
# export_anim_slide_to_zero flag. That flag only reaches the SAMPLED animation
# path; the fcurve path (every asset that exports with
# export_force_sampling=False, which is 19 of the 21 animated assets) ignores
# it, so it would have fixed the two rigged characters and silently left every
# machine, tree and belt at 1/60. Measured, not assumed: two probe exports of
# the same 3-key clip with the flag on came out 0.0 s and 0.0167 s.
CLIP_FRAME_BASE = 1                       # the authored frame that is t = 0


def clip_frame(f):
    """Authored (1-based) clip frame -> the Blender frame it is keyed on.

    Authored frame 1 lands on Blender frame 0 and therefore on t = 0 s, and an
    n-frame clip spans Blender 0..n-1, so its exported duration is the
    (n - 1)/60 s the motion was actually authored across.

    Tick indices into an exported clip are therefore `authored - 1`: the
    pickaxe impact authored on frame 17 is tick 16 at runtime.
    """
    return float(f) - CLIP_FRAME_BASE


def pose_clip(arm, clip_name, tracks, interpolation="BEZIER"):
    """One Action on an armature: the rig's answer to add_clip_multi.

    tracks = {bone_name: {"rot": [(frame, rotation), ...],
                          "loc": [(frame, (x, y, z)), ...]}}

    Frames are 1-based and authored frame 1 exports at t = 0 (see clip_frame).

    A rotation is either an (rx, ry, rz) triple of DEGREES applied in XYZ order,
    or an ordered list of (axis, degrees) pairs applied innermost first:

        ("LeftArm", [("Y", 76), ("X", -20)])   down to the side, then swung

    The ordered form exists because composition order is the whole difference
    between an arm swinging and an arm twisting. Bringing a T-posed arm down is
    a rotation about Y; swinging the arm that now hangs is a rotation about X
    applied AFTER it. An XYZ euler applies X first, so (-20, 76, 0) is a
    different, wrong pose, and the difference is invisible until the clip plays.

    Angles are degrees about the ARMATURE-space axes (+X right, -Y forward,
    +Z up) and translations are metres in armature space, both converted into
    the bone's own basis here. Authoring in bone-local space is unusable: for an
    arm bone pointing along +X, 'raise the arm' is a rotation about local Z or
    local X depending on the bone roll.

    Because a bone's parent is already posed when its own basis is applied, a
    rotation reads as 'relative to my parent', which is what an animator means:
    yawing the hips carries the legs, and an elbow delta on a forearm whose
    parent is already posed bends the elbow.
    """
    from mathutils import Euler, Vector

    act = bpy.data.actions.new(clip_name)
    act.use_fake_user = True                  # survives to ACTIONS export
    fcurves = _fcurves_for(act, arm)
    last = CLIP_FRAME_BASE
    for bone_name, chans in tracks.items():
        pb = arm.pose.bones[bone_name]
        pb.rotation_mode = "QUATERNION"
        basis = arm.data.bones[bone_name].matrix_local.to_3x3()
        inv = basis.inverted()
        if chans.get("rot"):
            path = 'pose.bones["%s"].rotation_quaternion' % bone_name
            fcs = [fcurves.new(data_path=path, index=i) for i in range(4)]
            prev = None
            for frame, rot in chans["rot"]:
                q = (inv @ _rot_matrix(rot) @ basis).to_quaternion()
                # Quaternion double cover: q and -q are the same rotation, but
                # component-wise interpolation between them takes the long way
                # round. Keep the sign continuous along the curve.
                if prev is not None and q.dot(prev) < 0.0:
                    q.negate()
                prev = q
                for i in range(4):
                    kp = fcs[i].keyframe_points.insert(clip_frame(frame), q[i])
                    kp.interpolation = interpolation
                last = max(last, int(frame))
        if chans.get("loc"):
            path = 'pose.bones["%s"].location' % bone_name
            fcs = [fcurves.new(data_path=path, index=i) for i in range(3)]
            for frame, vec in chans["loc"]:
                local = inv @ Vector(vec)
                for i in range(3):
                    kp = fcs[i].keyframe_points.insert(clip_frame(frame),
                                                       local[i])
                    kp.interpolation = interpolation
                last = max(last, int(frame))
    scn = bpy.context.scene
    scn.frame_end = max(scn.frame_end, int(clip_frame(last)))
    return act


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
    keys           [(frame, (x, y, z)), ...], frames 1-based (see clip_frame)

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
    last = CLIP_FRAME_BASE
    for channel, keys in channels.items():
        for axis in range(3):
            fc = fcurves.new(data_path=channel, index=axis)
            for frame, vec in keys:
                kp = fc.keyframe_points.insert(clip_frame(frame),
                                               float(vec[axis]))
                kp.interpolation = interpolation
        last = max(last, max(int(f) for f, _ in keys))
    scn = bpy.context.scene
    scn.frame_end = max(scn.frame_end, int(clip_frame(last)))
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
    # Bones export in their REST pose, so the exported static node transforms
    # are the bind pose and every clip is relative to it. This is the rigged
    # form of the frame-1 identity rule (ASSET-SPECS 2.7): without it the
    # armature's evaluated pose at export time is baked into the joint nodes,
    # and a character exported mid-stride is permanently mid-stride when no
    # clip is playing. validate_glb.py's rest_pose check asserts the result.
    export_rest_position_armature=True,
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


def _dedupe_socket_names(filepath):
    """Strip Blender's '.001' uniquifying suffix from exported SOCKET nodes.

    WHY THIS HAS TO EXIST (Tier 2). Socket names are a runtime contract:
    every rocket part exposes `socket_stack_top`, and the engine finds it with
    part.getObjectByName('socket_stack_top') on the CLONED PART, not on the
    file. But bpy.data.objects names are unique across the whole blend file,
    so the second part to ask for that name gets `socket_stack_top.001` and
    the thirteenth gets `.012`, and the contract quietly evaporates. glTF node
    names are non-normative and duplicates are legal, so the fix belongs at
    export time and nowhere else.

    Deliberately narrow: only nodes whose stem starts with 'socket_' are
    renamed, so a mesh or a proxy that ever picks up a suffix still shows it
    (that would be a genuine bug, not a scoping artefact). Off by default, so
    the 37 Tier-0 and Tier-1 files export byte-identically.
    """
    import re
    with open(filepath, "rb") as fh:
        data = fh.read()
    _, _, total = struct.unpack_from("<4sII", data, 0)
    off, chunks = 12, []
    while off + 8 <= len(data):
        clen, ctype = struct.unpack_from("<I4s", data, off)
        off += 8
        chunks.append((ctype, data[off:off + clen]))
        off += clen + ((4 - clen % 4) % 4 if clen % 4 else 0)
    pat = re.compile(r"^(socket_.*)\.\d{3}$")
    out, n = [], 0
    for ctype, payload in chunks:
        if ctype != b"JSON":
            out.append((ctype, payload))
            continue
        gltf = json.loads(payload.decode("utf-8"))
        for node in gltf.get("nodes", []):
            m = pat.match(node.get("name", ""))
            if m:
                node["name"] = m.group(1)
                n += 1
        out.append((ctype, json.dumps(gltf, separators=(",", ":"),
                                      ensure_ascii=False).encode("utf-8")))
    body = b""
    for ctype, payload in out:
        pad = (4 - len(payload) % 4) % 4
        payload = payload + (b" " if ctype == b"JSON" else b"\x00") * pad
        body += struct.pack("<I4s", len(payload), ctype) + payload
    with open(filepath, "wb") as fh:
        fh.write(struct.pack("<4sII", b"glTF", 2, 12 + len(body)) + body)
    print("[of_lib] de-suffixed %d socket node name(s)" % n)


def export_glb(filepath, dedupe_socket_names=False, **overrides):
    """Write the whole scene to a .glb under the pinned export contract."""
    filepath = os.path.abspath(filepath)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    settings = dict(GLTF_SETTINGS)
    settings.update(overrides)
    settings, dropped = _supported(settings)
    if dropped:
        print("[of_lib] note: this Blender ignores %s" % ", ".join(dropped))
    bpy.ops.export_scene.gltf(filepath=filepath, **settings)
    if dedupe_socket_names:
        _dedupe_socket_names(filepath)
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
