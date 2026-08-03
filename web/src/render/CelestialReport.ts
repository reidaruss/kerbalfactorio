// RN-845. The two records the disc feature PUBLISHES, split out of
// CelestialBodies.ts on the 400-line cap.
//
// They are here together because they are the same kind of thing: the driven
// read-back surface, i.e. what a probe is allowed to assert against. Keeping
// them apart from the implementation makes one property easy to check by eye,
// and it is the property that matters: every field below is either read
// straight off /core or read straight off a live uniform. Nothing in a report
// is recomputed from the same inputs the renderer used, because a number
// derived here and asserted here proves only that this file agrees with
// itself.

export interface CelestialReport {
  readonly present: boolean;
  /** Why nothing is drawn, when nothing is drawn. Never silent. */
  readonly reason: string | null;
  readonly drawn: string[];
  /** The id the discovery loop REFUSED, proving the terminator is real. */
  readonly refusedId: number;
  readonly texW: number;
  readonly texH: number;
  readonly bakeMs: number;
  readonly oracleSamples: number;
  /** Max |dirForUv(uv) - normalize(position)| over the sphere's vertices. */
  readonly uvResidual: number;
  /** The EYE in body-frame metres at the instant of the report. Published so a
   *  probe can reconstruct `aim().distanceM` from `bodies[].posM` EXACTLY and
   *  check the two paths against each other, rather than against a tolerance
   *  somebody guessed. The first version of that check asserted the two agree
   *  to "well under a per-cent"; they differ by 4.45 per cent at the spawn,
   *  because one measures from the body CENTRE and the other from the eye, and
   *  Forge's 600 km radius is 5 per cent of 1.2e7 m. The instrument was wrong,
   *  not the code, and a tighter tolerance would have "found" a bug that is a
   *  planet's radius. */
  readonly eyeM: [number, number, number];
  readonly bodies: {
    name: string; distanceM: number; angularDiamDeg: number;
    posM: [number, number, number]; visible: boolean;
    reliefMinM: number; reliefMaxM: number; texelM: number;
  }[];
  readonly simSecs: number;
}

/** Where a body is FROM THE PLAYER: an azimuth, an elevation, and the aim the
 *  debug `of.look` takes. Angles in degrees. */
export interface BodyAim {
  readonly name: string;
  readonly yawDeg: number;
  readonly pitchDeg: number;
  readonly elevationDeg: number;
  readonly angularDiamDeg: number;
  readonly distanceM: number;
  /** False when the body is below the local horizon; aiming still works. */
  readonly aboveHorizon: boolean;
}
