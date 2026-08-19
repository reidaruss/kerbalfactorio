// The driven surface for A-10: put armour on the avatar and prove it moved.
//
// Separate from Debug.ts, which is at the 400-line cap, and separate from the
// progression lane's panel and bridge work, which owns `web/src/ui` and the
// `of_pg_*` exports. This is the RENDER half and only the render half: it takes
// a slot and a file and binds a mesh to the body's skeleton. Whatever decides
// that the player IS wearing iron greaves calls this; it decides nothing.

import { EQUIP_SLOTS, type EquipSlotName } from '../player/Avatar.js';
import { ASSETS } from '../assets/Registry.js';
import type { Services } from './Services.js';

export interface ArmourApi {
  /** Equip or remove one slot. `slot` is a name from `EQUIP_SLOTS`. */
  armour(slot: EquipSlotName, on: boolean, url?: string): Promise<string[]>;
  /** Equip or remove all four. Returns the slots worn afterwards. */
  armourSet(on: boolean, url?: string): Promise<string[]>;
  /**
   * Where a named bone is in world space, and where the armour piece bound to
   * that slot puts its own matching bone. The two must agree to floating-point
   * noise, because that is the whole claim `equip` makes: the piece is driven by
   * the BODY's skeleton, not by the copy that came in its own file. A piece
   * bound to the wrong skeleton renders a T-posed shell at the origin, which a
   * screenshot of a standing character cannot distinguish from a correct one.
   */
  /**
   * Every clip on both rigs with its duration and first-key time, plus the
   * states each rig cannot play. DW-34 asserts `firstKeyT === 0` exactly on
   * every clip; A-6 asserts `unmapped` is empty on both rigs.
   */
  avatarClips(): {
    body: { name: string; duration: number; firstKeyT: number; tracks: number }[];
    fp: { name: string; duration: number; firstKeyT: number; tracks: number }[];
    bodyUnmapped: string[]; fpUnmapped: string[];
  };
  armourDrift(): {
    slot: string; nodes: string[]; primitives: number; sameSkeleton: boolean;
    bones: number; bodyBones: number; triangles: number;
  }[];
  /**
   * GP-1055. The BODY rig's own triangle count (`PlayerRig.triangleCount`):
   * loaded scene + held tool + any equipped armour, and NOTHING else in the
   * world. Armour binds to the body's skeleton only (A-11: the FP arms are a
   * different rig with a different bind pose and no armour file), so this is
   * the body group and not a union of both rigs.
   *
   * Exists so a probe can measure the avatar's own geometry directly instead
   * of differencing `of.stats().draw.triangles`, a GLOBAL scene counter that
   * also moves with terrain streaming, foliage and every other spawned
   * entity. See PlayerRig.triangleCount for the full account.
   */
  avatarTriangles(): number;
}

export function armourApi(s: Services): ArmourApi {
  const avatar = () => s.avatar;
  return {
    async armour(slot, on, url: string = ASSETS.armourSet) {
      const a = avatar();
      if (a === null) return [];
      if (on) await a.equip(slot, url); else a.unequip(slot);
      return a.wornSlots;
    },
    async armourSet(on, url: string = ASSETS.armourSet) {
      const a = avatar();
      if (a === null) return [];
      for (const slot of EQUIP_SLOTS) {
        if (on) await a.equip(slot, url); else a.unequip(slot);
      }
      return a.wornSlots;
    },
    avatarClips() {
      const a = avatar();
      return {
        body: a?.body?.clipTimings() ?? [], fp: a?.arms?.clipTimings() ?? [],
        bodyUnmapped: a?.body?.unmappedStates() ?? [],
        fpUnmapped: a?.arms?.unmappedStates() ?? [],
      };
    },
    armourDrift() {
      const a = avatar();
      const body = a?.body ?? null;
      if (body === null) return [];
      return body.armourDrift();
    },
    avatarTriangles() {
      return avatar()?.body?.triangleCount() ?? 0;
    },
  };
}
