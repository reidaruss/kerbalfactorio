# Orbital Foundry: Vision v2

**Status: north star. Written by Admin on 2026-08-10 from Reid's direction that day.
Where this and older docs disagree on intent, this wins; MASTER_PLAN wins on
mechanism. Kept deliberately short. Edit freely.**

## The game in one paragraph

You crash-land, sole survivor, on a wild planet in an unfamiliar solar system.
From loose stones and firewood you bootstrap Factorio-depth automation, research
your way to a launch pad, hand-fly your first rocket to a derelict station, and
unlock the tools to industrialise a solar system that once belonged to someone
else. Orbital flight is honest: real orbits, real burns. The world is real
terrain you can mine, dig, and reshape. And it looks and feels like a modern
native title, not a prototype.

## The three bars

1. **Mechanics: Factorio and KSP.** Largely met in skeleton form. The remaining
   work is connection, not invention: making the pieces one game.
2. **Look: Satisfactory.** That is the envisioned target. Skyrim and Elden Ring
   remain the aim-high references (see [web/ART-DIRECTION.md](web/ART-DIRECTION.md)),
   deliberately set above the goal because the current art is so far below the
   playable bar that aiming high is the corrective. Realistic materials,
   weathering and asymmetry, detail at every distance, grounded muted colour.
   KSP and Factorio are explicitly not art references. Unlike Satisfactory, the
   terrain itself is manipulable: minable, diggable, deformable.
3. **Feel: a game, not a tech demo.** Movement, player model, animations,
   collisions, camera, sound cues, UI legibility. A first-class workstream with
   its own passes and measurements, not polish deferred to the end.

## Platform (D-018)

Ships native on Steam at endgame. Development stays web/Three.js through
pre-alpha, because its iteration speed is what produced the mechanics progress.
Continuous de-risk: `/core` stays engine-agnostic C++ behind the flat C ABI, and
all art is authored as portable glTF + PBR texture sets, so both survive any
future engine. The engine decision is made at the pre-alpha gate; UE is not the
default answer when it comes.

## The pre-alpha line

[story_line_outline_v1.txt](../story_line_outline_v1.txt), end to end: wood,
loose stones, pickaxe, coal and iron, smelting, belts, research station,
scanning antenna, the ruins (and the enemies met there), electricity, launch
pad, ship, the hand-flown and deliberately difficult first docking with the
station, then autopilot and the moon scan unlocked by it.

## Beyond pre-alpha (unchanged from the storyline)

Teleporters, a moon colony, other planets, the major reskinning, alpha. Endgame
is the dyson sphere and the interstellar voyage; launching it is the credits.

## Priorities now, in order

1. **A flyable first mission.** The rider boards the carrier, the station-stamp
   branch merges, docking gets a button.
2. **Green means something.** Full probe sweep, then gate the harness so a
   failing probe fails the build.
3. **Look and feel.** The albedo fix (D-016) first, then look-dev, then asset,
   movement and animation passes judged against the corrected light.
4. **The scanning spine.** The reason a player goes anywhere.
