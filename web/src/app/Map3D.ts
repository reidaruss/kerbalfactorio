// =============================================================================
// Map3D.ts - the 3D orbital map scene (GP-205..GP-210, DW-37).
//
// M opens a CAMERA, not a drawing: the planet as a lit globe, every registry
// vessel's orbit as a 3D curve, markers for the player, the pads and the fleet,
// and a camera the player orbits with the mouse. DW-37 asked for exactly this
// ("it should be a 3d map that i can rotate, especially when i zoom all the way
// out to see orbital stuff") and the flat plan view could not grow into it.
//
// A DEDICATED SCENE, NOT A CAMERA OVER THE FAR SCENE (GP-205). The far scene's
// contents are curated for the walker (chunks streamed around one position, a
// terrain material parameterised by the world's own cameras), so pointing a
// second camera at it measures a scene maintained for somebody else - the
// "value published for rendering is not fit to measure with" family from
// INSTRUMENTS.md. This scene holds only what the map means, and Frame renders
// it INSTEAD of the four world passes while the map is up (the VAB precedent),
// so the closed-state cost is structurally zero: no object here is ever
// submitted while the map is shut.
//
// THE GLOBE IS THE WORLD'S OWN PLANET. It shares PlanetProxy's geometry (same
// vertices, zero extra VRAM) and, in reveal-all mode, the proxy's biome-tinted
// material. In survival it swaps to a neutral untinted Lambert: the map may not
// reveal ground the player has never seen (DW-36), and until discovery masks
// the globe per-region (named follow-on), no tint is the honest tint.
//
// THE TERMINATOR IS FREE. The scene's one directional light is aimed each
// frame from SkyPass.sunDirection (the live vector; NOT `__ofPost.state().sun`,
// which freezes below the horizon - INSTRUMENTS.md), so day and night fall on
// the globe exactly where the sky says they are, and the day cycle reads
// directly off the map.
//
// Units are FAR_SCALE metres (the far scene's own convention: Forge is a
// 6-unit sphere). Every material here is stock: zero DW-10 ledger slots.
// =============================================================================
import * as THREE from 'three';
import { FAR_SCALE } from '../render/Scenes.js';
import { registry } from '../sim/VesselRegistry.js';
import { markerRegistry } from '../game/MarkerRegistry.js';
import { stateOfDocked } from '../game/SpaceStation.js';
import { OrbitLines } from './MapOrbits.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { MapReadout, V3 } from '../ui/MapTypes.js';
import { markerPosM } from '../ui/MapPaint.js';
import type { MapBodyPort } from './MapBoot.js';
import { proxyRadiusUnits } from '../world/PlanetProxy.js';
import { bodyIdOf } from '../world/VesselBody.js';

export interface Map3DDeps {
  core: OfCoreModule;
  /** CameraRig's mapCam: the rig owns every camera (ARCHITECTURE 2.2 rule 2). */
  cam: THREE.PerspectiveCamera;
  /** The world's scaled planet. The map borrows its geometry and material. */
  globe: THREE.Mesh;
  /** SkyPass.sunDirection, held BY REFERENCE and read every frame. */
  sunDirection: THREE.Vector3;
  revealAll(): boolean;
  pads(): readonly { pos: { x: number; y: number; z: number } }[];
  /** The world tick rails positions are asked at (FlightVessels' clock). */
  tick(): number;
  /**
   * GP-650. THE BODY THIS PICTURE IS OF, LIVE.
   *
   * Was `bodyRadiusM: number`, captured once in `bootMap`. It supplied GP-520's
   * marker radius (real body-frame metres, so a marker's unit `dirBody` lands
   * ON the sphere before FAR_SCALE touches it) and nothing else knew which body
   * the scene was about at all. A thunk, and the whole body rather than one
   * number, because the globe's SIZE, the marker radius and the "is this record
   * even at this body" test are three readings of one fact.
   */
  body(): MapBodyPort;
}

const MIN_DIST = 0.004;
const MAX_DIST = 400;
const MARKER_COLOURS = {
  player: 0x6de37b, pad: 0x8fb7ff, vessel: 0xffb166, flying: 0x59d3e8,
  // GP-520. The generic registry's three kinds, colour-matched to MapLayers'
  // MARKER_TINT so the two maps read as one instrument.
  ruin: 0xd9a441, signal: 0x59d3e8, deposit: 0xb98cff,
} as const;
type MarkerKind = keyof typeof MARKER_COLOURS;

function markerTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  if (g !== null) {
    g.beginPath(); g.arc(32, 32, 18, 0, Math.PI * 2);
    g.fillStyle = '#ffffff'; g.fill();
    g.lineWidth = 5; g.strokeStyle = '#ffffff';
    g.beginPath(); g.arc(32, 32, 27, 0, Math.PI * 2); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Map3D {
  readonly scene = new THREE.Scene();
  /** Camera state: an orbit around the focus centre. Distance is DERIVED from
   *  MapScene.spanM, so the wheel, the buttons and the flat fallback share ONE
   *  zoom parameter (DW-36: one map, one camera, one zoom). */
  yawRad = 0.7;
  pitchRad = 0.45;
  selectedId = 0;
  frames = 0;
  private readonly globeMesh: THREE.Mesh;
  private readonly neutralMat = new THREE.MeshLambertMaterial({ color: 0x848b90 });
  private readonly sun = new THREE.DirectionalLight(0xfff2df, 2.6);
  private readonly lines: OrbitLines;
  private readonly markerGroup = new THREE.Group();
  private readonly markers = new Map<string, THREE.Sprite>();
  private readonly markerMats: Record<MarkerKind, THREE.SpriteMaterial>;
  private readonly markerTex = markerTexture();
  private readonly centre = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly ndc = new THREE.Vector2();
  private readonly ray = new THREE.Raycaster();
  /** The radius, in far-scene units, the globe is CURRENTLY drawn at. Not a
   *  constant since GP-650: the body changes under a running client. */
  private globeR: number;
  /** The proxy geometry's own baked radius, so `syncGlobe` can tell "the proxy
   *  is the body I am of" from "the proxy is a world I have left". */
  private readonly proxyR: number;
  /** Geometry this class built for a body the proxy is not, or null while the
   *  proxy's own geometry is being borrowed (the shipped path, zero VRAM). */
  private ownGeo: THREE.BufferGeometry | null = null;
  /** 'proxy' while the world's planet is borrowed, 'own' while it is not. */
  private globeSource: 'proxy' | 'own' = 'proxy';
  private reveal: boolean | null = null;
  private distUnits = 10;
  /** What the last marker sync put up, BY KIND, so a probe asserts the exact
   *  census against published state instead of a >= over a mixed count. */
  private kinds: Record<MarkerKind, number> = {
    player: 0, pad: 0, vessel: 0, flying: 0, ruin: 0, signal: 0, deposit: 0,
  };
  /** GP-650. Registry records the last sync left OUT because they are at another
   *  body. Published so "nothing was drawn" and "nothing belongs here" are
   *  different readings rather than the same zero. */
  private elsewhere = 0;

  constructor(private readonly d: Map3DDeps) {
    this.scene.name = 'mapScene';
    const geo = d.globe.geometry;
    if (geo.boundingSphere === null) geo.computeBoundingSphere();
    this.proxyR = geo.boundingSphere?.radius ?? 6;
    this.globeR = this.proxyR;
    this.globeMesh = new THREE.Mesh(geo, this.neutralMat);
    this.globeMesh.name = 'mapGlobe';
    this.scene.add(this.globeMesh);
    this.sun.position.set(1, 0.3, 0).multiplyScalar(60);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    // Dim ambient so the night side reads as a planet, not a hole in the stars.
    this.scene.add(new THREE.AmbientLight(0x8093a8, 0.5));
    this.lines = new OrbitLines(d.core);
    this.scene.add(this.lines.group);
    this.markerGroup.name = 'mapMarkers';
    this.scene.add(this.markerGroup);
    this.markerMats = Object.fromEntries(
      (Object.keys(MARKER_COLOURS) as MarkerKind[]).map((k) => [k,
        new THREE.SpriteMaterial({ map: this.markerTex,
          color: MARKER_COLOURS[k] })]),
    ) as Record<MarkerKind, THREE.SpriteMaterial>;
  }

  /** Mouse-drag orbit. Pixels in, radians out; the pitch clamp keeps the
   *  camera off the poles where lookAt's up degenerates. */
  look(dxPx: number, dyPx: number): void {
    this.yawRad += dxPx * 0.005;
    this.pitchRad = Math.min(1.45, Math.max(-1.45, this.pitchRad + dyPx * 0.005));
  }

  /** A click, in NDC. Returns the vessel id under it, or 0. */
  pick(xNdc: number, yNdc: number): number {
    this.ray.setFromCamera(this.ndc.set(xNdc, yNdc), this.d.cam);
    for (const hit of this.ray.intersectObjects(this.markerGroup.children)) {
      const id = (hit.object.userData as { vesselId?: number }).vesselId;
      if (typeof id === 'number' && id > 0) return id;
    }
    return 0;
  }

  /** Every frame the map is open, AFTER the readout is built: the same numbers
   *  the panel prints are the numbers this scene draws. */
  frame(r: MapReadout): void {
    this.frames += 1;
    this.sun.position.copy(this.d.sunDirection).multiplyScalar(60);
    const here = this.d.body();
    this.syncGlobe(here);
    const flying = r.scene.current !== null;
    this.lines.syncFlight(r.scene.current, r.scene.planned);
    // GP-650. ONLY THIS BODY'S ORBITS. There is one globe in this scene, so a
    // conic drawn here is a claim about the body under it, and a record at
    // another body drawn in this frame is Reid's screenshot: a 1000 km Forge
    // orbit wrapped around a 200 km moon. `syncRails` disposes the lines of
    // records it no longer sees, so a body switch clears them by construction.
    this.lines.syncRails(registry.list(), this.d.tick(),
                         flying ? registry.promotedId : 0, this.selectedId,
                         this.d.core, here.bodyId);
    this.syncMarkers(r, flying, here);
    this.updateCamera(r.scene.centreM, r.scene.spanM);
  }

  /**
   * GP-650. THE GLOBE IS THE BODY YOU ARE ON, BOTH DIRECTIONS.
   *
   * The globe was `PlanetProxy`'s mesh geometry, taken once in the constructor,
   * and the proxy is one of the holders `WorldSession.staleHolders` already
   * names as surviving a body switch. So after `of.reboot(1)` the map drew
   * Forge's 5.937-unit sphere on a 200 km moon, and drew it again on the way
   * back: measured at HEAD, `globeRadiusUnits` 5.937 before, 5.937 after.
   *
   * BORROWING IS KEPT WHEREVER IT IS TRUE, which is every shipped frame today:
   * a page-reloaded boot has a proxy built for the body it booted on, the radii
   * agree, and this class holds the proxy's own geometry exactly as it did (no
   * extra VRAM, and reveal-all still wears the proxy's biome tint, which is the
   * world's own colours and is only honest while it IS the world). When they
   * disagree the map builds its own neutral sphere at the live radius and says
   * so in the report, rather than either lying about the size or wearing another
   * planet's biome colours.
   */
  private syncGlobe(here: MapBodyPort): void {
    const wantR = proxyRadiusUnits(here);
    const borrow = Math.abs(wantR - this.proxyR) <= 1e-6 * Math.max(wantR, this.proxyR);
    const reveal = this.d.revealAll();
    const source: 'proxy' | 'own' = borrow ? 'proxy' : 'own';
    if (source !== this.globeSource || Math.abs(wantR - this.globeR) > 1e-9) {
      if (borrow) {
        this.globeMesh.geometry = this.d.globe.geometry;
        this.ownGeo?.dispose();
        this.ownGeo = null;
      } else {
        this.ownGeo?.dispose();
        // The proxy's own shape, at the live body's size. Detail 3 rather than
        // the proxy's 16: this sphere carries no per-vertex biome colour and is
        // a reference body under a line chart, not the ground.
        this.ownGeo = new THREE.IcosahedronGeometry(wantR, 3);
        this.globeMesh.geometry = this.ownGeo;
      }
      this.globeSource = source;
      this.globeR = wantR;
      // Force the material branch below to re-decide: an owned globe may never
      // wear the proxy's tint, whatever `reveal` says.
      this.reveal = null;
    }
    if (reveal !== this.reveal) {
      this.reveal = reveal;
      this.globeMesh.material = reveal && borrow
        ? this.d.globe.material : this.neutralMat;
    }
  }

  private putMarker(key: string, kind: MarkerKind, posM: readonly number[],
                    liftRadial: boolean, vesselId = 0): void {
    let s = this.markers.get(key);
    if (s === undefined) {
      s = new THREE.Sprite(this.markerMats[kind]);
      s.name = `marker:${key}`;
      this.markers.set(key, s);
      this.markerGroup.add(s);
    }
    s.material = this.markerMats[kind];
    s.userData.vesselId = vesselId;
    s.userData.live = true;
    this.kinds[kind] += 1;
    s.position.set(posM[0] * FAR_SCALE, posM[1] * FAR_SCALE, posM[2] * FAR_SCALE);
    const scale = this.distUnits * (vesselId === this.selectedId && vesselId > 0
      ? 0.05 : 0.032);
    s.scale.set(scale, scale, 1);
    // A surface marker sits ON the sphere; half a disc buried in it reads as a
    // defect. Lift it along its own radial by ITS OWN size, never by a planet
    // fraction: a 1.2% radius lift is 7 km, which at a 600 m span parks the
    // marker far above the camera and out of every close frame.
    if (liftRadial) {
      s.position.addScaledVector(
        this.scratch.copy(s.position).normalize(), scale * 0.6);
    }
  }

  private syncMarkers(r: MapReadout, flying: boolean, here: MapBodyPort): void {
    for (const s of this.markers.values()) s.userData.live = false;
    this.kinds = {
      player: 0, pad: 0, vessel: 0, flying: 0, ruin: 0, signal: 0, deposit: 0,
    };
    const p = r.scene.playerPos;
    if (p !== null) this.putMarker('you', 'player', p, true);
    const pads = this.d.pads();
    for (let i = 0; i < pads.length; ++i) {
      const q = pads[i].pos;
      this.putMarker(`pad${i}`, 'pad', [q.x, q.y, q.z], true);
    }
    // GP-520. THE GENERIC SOURCE: whatever the registry holds, gated on ITS
    // OWN `known` flag and nothing else — no discovery test here, same as the
    // 2D map's `drawMarkers` (MapLayers.ts), and for the same reason: a scan
    // that reveals a marker on unwalked ground is the point of a scan.
    for (const mk of markerRegistry.list()) {
      if (!mk.known) continue;
      this.putMarker(mk.key, mk.kind, markerPosM(mk.dirBody, here.radiusM), true);
    }
    const tick = this.d.tick();
    this.elsewhere = 0;
    for (const rec of registry.list()) {
      // GP-650. A MARKER IS A PLACE IN THIS BODY'S FRAME, so a record at another
      // body has no place here. Counted rather than silently skipped: "the
      // station is not on my map" has to be answerable, and the panel's row for
      // it says which body it orbits (MapPanels' `orbits` line).
      if (bodyIdOf(this.d.core, rec, here.bodyId) !== here.bodyId) {
        this.elsewhere += 1;
        continue;
      }
      const isFlying = flying && rec.id === registry.promotedId;
      // PH-381, GP-866. `stateOfDocked`: a docked, non-flying record (a guest
      // parked at the station) is drawn at its HOST's pose, not its own stale
      // conic. A no-op for every other record. See its header, SpaceStation.ts.
      const pos: V3 | null = isFlying ? r.scene.shipPos
        : rec.where.kind === 'fixed' ? rec.where.pos
          : (stateOfDocked(this.d.core, registry, rec, tick).pos as V3);
      if (pos === null) continue;
      this.putMarker(`v${rec.id}`, isFlying ? 'flying' : 'vessel', pos,
                     rec.where.kind === 'fixed', rec.id);
    }
    for (const [key, s] of this.markers) {
      if (s.userData.live === true) continue;
      this.markerGroup.remove(s);
      this.markers.delete(key);
    }
  }

  private updateCamera(centreM: V3, spanM: number): void {
    this.centre.set(centreM[0], centreM[1], centreM[2]).multiplyScalar(FAR_SCALE);
    const dist = Math.min(MAX_DIST,
      Math.max(MIN_DIST, spanM * FAR_SCALE * 1.1));
    this.distUnits = dist;
    const cp = Math.cos(this.pitchRad), sp = Math.sin(this.pitchRad);
    const dir = this.scratch.set(cp * Math.cos(this.yawRad), sp,
                                 cp * Math.sin(this.yawRad));
    const cam = this.d.cam;
    cam.position.copy(this.centre).addScaledVector(dir, dist);
    // Never inside the planet: a camera under the globe's skin draws the far
    // side through the near side and reads as a black void.
    const minR = this.globeR * 1.01;
    if (cam.position.length() < minR) cam.position.setLength(minR);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.centre);
    cam.updateMatrixWorld(true);
  }

  report(): unknown {
    const here = this.d.body();
    return {
      frames: this.frames,
      globeTint: this.globeMesh.material === this.neutralMat ? 'neutral' : 'biome',
      globeRadiusUnits: this.globeR,
      // GP-650. Which body the picture is of, and whether the world's own planet
      // is what is being drawn. `globeBodyId` is what a probe asserts a body
      // switch against; `globeSource` tells a borrowed globe from a built one,
      // so "the proxy went stale" and "the map coped" are separable readings.
      globeBodyId: here.bodyId,
      globeBodyName: here.name,
      globeSource: this.globeSource,
      vesselsElsewhere: this.elsewhere,
      camera: { yawRad: this.yawRad, pitchRad: this.pitchRad,
        distM: Math.round(this.distUnits / FAR_SCALE),
        centreUnits: this.centre.toArray() },
      lines: { ...this.lines.drawn },
      markers: this.markers.size,
      markerKinds: { ...this.kinds },
      selectedId: this.selectedId,
    };
  }
}
