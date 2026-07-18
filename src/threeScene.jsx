// 3D viewport: ThreeScene (moved verbatim from main.jsx, JOB 0 split).
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FRAME_MEMBERS } from './frameDrawings.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  OPENING_TYPES, resolveFrameType, footprintPolygon, footprintEdges, hasCustomFootprint, hasSegmentedFootprint, polygonArea, decomposeFootprint, subtractRect,
  subtractRectFromFootprint, pointInFootprint, edgeForOpening, gradeElevationAt, basementInfo, BASEMENT_LEVEL, PARTITION_TYPES, CLADDING_TYPES, storeyElevationFt, storeyHeightFt,
  isRoundFootprint, clipRectToRoundShell
} from '../backend/bim-core.mjs';
import {
  DEFAULT_OUTDOOR_GRID_SIZE_FT, clamp, padExtension, sitePadRect, objectBounds, titleCase, roofProfile, storeyInfo,
  upperPlateRect, resolveOverhangs, FOUNDATION_RUN_TYPES, DEFAULT_MODEL_LAYERS, siteOf, utilitiesOf, getSpecialBimObjects, wallAssemblyProfile,
  WALL_SIDES, resolveWallSide, resolveDeck, resolveDeckStairs
} from './engine.js';

// Some browsers run with graphics acceleration (WebGL) turned off — locked-
// down review VMs, remote desktops, old drivers. Without this probe the
// renderer constructor THROWS inside the effect and React unmounts the whole
// app into a blank page. Probe once, cache, and let the UI degrade to Plan.
// `?no3d` in the URL forces the fallback so it can be tested anywhere.
let webglProbe = null;
export function webglAvailable() {
  if (webglProbe !== null) return webglProbe;
  try {
    if (typeof window !== 'undefined' && /[?&]no3d\b/.test(window.location.search)) {
      webglProbe = false;
      return webglProbe;
    }
    const probe = document.createElement('canvas');
    webglProbe = Boolean(window.WebGLRenderingContext
      && (probe.getContext('webgl2') || probe.getContext('webgl') || probe.getContext('experimental-webgl')));
  } catch {
    webglProbe = false;
  }
  return webglProbe;
}

// The section-cut clip plane: keeps everything north of the cut line
// (z ≤ cutZ). Slider 1 = whole model, sliding down slices from the south.
function cutPlanes(spec, cut) {
  if (cut == null || cut >= 0.999) return [];
  const depth = Number(spec?.shell?.depthFt) || 28;
  const cutZ = -8 + (depth + 16) * Math.max(0, cut);
  return [new THREE.Plane(new THREE.Vector3(0, 0, -1), cutZ)];
}

// ── THE JOINTS TABLE ─────────────────────────────────────────────────────────
// Every seam offset in the model, named once. Builders read these instead of
// scattering magic numbers — a seam fix is a one-line change here, and the
// in-scene seam audit (window.__nbView.seamAudit) checks the build against it.
export const JOINTS = {
  ROOF_BEARING: 0.28,  // a shed roof plane rides this far above the wall-top line
  EAVE_BEARING: 0.25,  // a gable/flat/hip plane rides this far above its eave
  TUCK: 0.45,          // a wall band drops this far into the roof plane it rises out of
  LAP: 0.05,           // hairline overlap between neighboring pieces
  BAND_INSET: 0.03,    // a storey band's face sits this far inside the ground wall face
  ROOF_SLACK: 0.08,    // the standing law's clamp allowance above the roof line
  DECK_LIFT: 0.18,     // deck boards ride this far above their floor line
  RAFTER_DROP: 0.34,   // rafter tops sit this far below the roof deck surface
};

export function ThreeScene({ spec, selectedRoom, layers = DEFAULT_MODEL_LAYERS, viewRequest = null, sectionCut = 1, onSelectRoom, onMoveStart, onMoveEnd, onResizeEnd, onDimensionPreview, onFallbackNav, showCompass = false, context = null, onContext = null }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraStateRef = useRef(null);
  const selectedRoomRef = useRef(selectedRoom);
  const callbacksRef = useRef({ onSelectRoom, onMoveStart, onMoveEnd, onResizeEnd, onDimensionPreview, onContext });
  // Camera flights (view buttons, orbit-around-selection) and the section cut
  // ride REFS, not effect deps — the scene must never rebuild for a camera move.
  const tweenRef = useRef(null);
  const focusIdRef = useRef(null);
  const sectionCutRef = useRef(1);

  useEffect(() => {
    selectedRoomRef.current = selectedRoom;
  }, [selectedRoom]);

  useEffect(() => {
    callbacksRef.current = { onSelectRoom, onMoveStart, onMoveEnd, onResizeEnd, onDimensionPreview, onContext };
  }, [onSelectRoom, onMoveStart, onMoveEnd, onResizeEnd, onDimensionPreview, onContext]);

  // View preset buttons: fly the camera to top / front (south) / side (east) /
  // iso at the CURRENT orbit distance, keeping the current target.
  useEffect(() => {
    const live = sceneRef.current;
    if (!viewRequest || !live?.camera || !live?.controls) return;
    const { camera, controls } = live;
    const target = controls.target.clone();
    const dist = Math.max(12, camera.position.distanceTo(target));
    const pos = viewRequest.mode === 'top' ? new THREE.Vector3(target.x, target.y + dist, target.z + 0.02)
      : viewRequest.mode === 'front' ? new THREE.Vector3(target.x, target.y + dist * 0.12, target.z + dist)
      : viewRequest.mode === 'side' ? new THREE.Vector3(target.x + dist, target.y + dist * 0.12, target.z)
      : new THREE.Vector3(target.x + dist * 0.62, target.y + dist * 0.6, target.z + dist * 0.62);
    tweenRef.current = { fromPos: camera.position.clone(), fromTarget: controls.target.clone(), pos, target, t: 0 };
  }, [viewRequest]);

  // Section cut: one global vertical clip plane sliding north→south. Applied
  // live to the renderer here AND re-applied on every scene rebuild (below).
  useEffect(() => {
    sectionCutRef.current = sectionCut;
    const r = sceneRef.current?.renderer;
    if (!r) return;
    r.clippingPlanes = cutPlanes(spec, sectionCut);
  }, [sectionCut, spec]);

  useEffect(() => {
    if (!webglAvailable()) return undefined; // fallback pane rendered below
    const mount = mountRef.current;
    if (!mount) return undefined;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xecefdf);
    // Faint atmospheric falloff so the site melts into the paper backdrop.
    scene.fog = new THREE.Fog(0xecefdf, 220, 520);

    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.1, 2000);
    if (cameraStateRef.current?.position) {
      camera.position.copy(cameraStateRef.current.position);
    } else {
      camera.position.set(36, 42, 42);
    }

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      // probe passed but the context still failed (exhausted GPU contexts,
      // driver hiccup) — degrade to the same message instead of crashing React
      mount.textContent = 'The 3D view could not start in this browser — graphics acceleration (WebGL) is unavailable. The Plan and Detail views work fully.';
      mount.classList.add('sceneFallback');
      return () => { mount.classList.remove('sceneFallback'); mount.textContent = ''; };
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    mount.appendChild(renderer.domElement);

    renderer.clippingPlanes = cutPlanes(spec, sectionCutRef.current);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    // Grabbing the view cancels any camera flight in progress.
    controls.addEventListener('start', () => { tweenRef.current = null; });
    if (cameraStateRef.current?.target) {
      controls.target.copy(cameraStateRef.current.target);
    } else {
      controls.target.set(18, 5, 14);
    }
    controls.update();

    // Warm late-morning light: sky slightly cool, bounce warm like dry grass,
    // sun a touch golden with soft-edged shadows sized to the site.
    const hemi = new THREE.HemisphereLight(0xf3f6f9, 0xc4b596, 1.2);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.9);
    sun.position.set(26, 48, 30);
    // Cool low fill from the opposite quarter so shaded faces keep their form
    // instead of going flat — the single biggest "clip-art" tell.
    const fill = new THREE.DirectionalLight(0xdfe8f2, 0.4);
    fill.position.set(-34, 22, -26);
    scene.add(fill);
    sun.castShadow = true;
    // Shadow camera fitted to the working site (not a 180ft void) at 4k —
    // the house gets ~6x the shadow texels, so shadows land as crisp
    // penumbras instead of blur blobs.
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.left = -55;
    sun.shadow.camera.right = 55;
    sun.shadow.camera.top = 55;
    sun.shadow.camera.bottom = -55;
    sun.shadow.bias = -0.0004;
    sun.shadow.radius = 4;
    scene.add(sun);

    // A neutral indoor environment map, applied ONLY to glass and metal
    // materials (per-material envMap, not scene.environment) — reflections
    // where they belong without brightening the whole model and washing the
    // zone colors (the ACES-exposure lesson).
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // Post pipeline — the "Blender look": ambient occlusion darkens the
    // corners, eaves, and reveals (the single biggest depth cue a plain
    // rasterizer lacks), and selection gets a crisp warm outline. OutputPass
    // applies the ACES tone mapping, so exposure behavior is unchanged.
    // Multisampled target — without it the post pipeline drops the canvas's
    // antialiasing and every eave reads as a staircase. HalfFloat keeps the
    // ACES mapping in OutputPass working on linear HDR values.
    const composerTarget = new THREE.WebGLRenderTarget(mount.clientWidth, mount.clientHeight, { samples: 4, type: THREE.HalfFloatType });
    const composer = new EffectComposer(renderer, composerTarget);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    composer.addPass(new RenderPass(scene, camera));
    const ssao = new SSAOPass(scene, camera, mount.clientWidth, mount.clientHeight);
    ssao.kernelRadius = 2.2;      // feet-scale scene: corners/eaves/reveals shade a couple of feet in
    ssao.minDistance = 0.001;
    ssao.maxDistance = 0.25;
    composer.addPass(ssao);
    const outlinePass = new OutlinePass(new THREE.Vector2(mount.clientWidth, mount.clientHeight), scene, camera);
    outlinePass.edgeStrength = 2.6;
    outlinePass.edgeGlow = 0;
    outlinePass.edgeThickness = 1;
    outlinePass.visibleEdgeColor.set(0x26424c);
    outlinePass.hiddenEdgeColor.set(0x405a63);
    composer.addPass(outlinePass);
    composer.addPass(new OutputPass());
    composer.setSize(mount.clientWidth, mount.clientHeight);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const roomMeshes = [];
    const resizeHandles = [];
    const draggableParts = new Map();
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const dragPoint = new THREE.Vector3();
    let dragState = null;

    // Procedural material grain — the difference between clip-art and a
    // building. Each kind is drawn ONCE as a near-white canvas (cached), so
    // material.color tints it: one plaster texture serves straw bale, cob,
    // and hemp-lime alike, each in its own color.
    const grainCache = new Map();
    function grainTexture(kind) {
      if (grainCache.has(kind)) return grainCache.get(kind);
      const c = document.createElement('canvas');
      c.width = 256; c.height = 256;
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 256, 256);
      const speckle = (count, alphaMax, sizeMax, dark = true) => {
        for (let i = 0; i < count; i += 1) {
          const a = Math.random() * alphaMax;
          g.fillStyle = dark && Math.random() < 0.72 ? `rgba(70,60,48,${a})` : `rgba(255,255,255,${a * 1.4})`;
          const s = 0.5 + Math.random() * sizeMax;
          g.fillRect(Math.random() * 256, Math.random() * 256, s, s);
        }
      };
      if (kind === 'plaster') {
        speckle(2600, 0.05, 2.2);
        // faint horizontal trowel drift
        for (let y = 0; y < 256; y += 7 + Math.random() * 9) {
          g.fillStyle = `rgba(90,78,60,${0.015 + Math.random() * 0.025})`;
          g.fillRect(0, y, 256, 1.4);
        }
      } else if (kind === 'metal') {
        // standing-seam roofing: crisp vertical seams over a soft sheen
        speckle(600, 0.03, 1.5);
        for (let x = 0; x < 256; x += 21) {
          g.fillStyle = 'rgba(45,50,52,0.30)';
          g.fillRect(x, 0, 1.6, 256);
          g.fillStyle = 'rgba(255,255,255,0.20)';
          g.fillRect(x + 2, 0, 1, 256);
        }
      } else if (kind === 'concrete') {
        speckle(4200, 0.075, 1.6);
      } else if (kind === 'earth') {
        speckle(3000, 0.10, 2.8);
      } else if (kind === 'grass') {
        speckle(5200, 0.09, 1.8);
        for (let i = 0; i < 700; i += 1) {
          g.fillStyle = `rgba(96,116,60,${Math.random() * 0.12})`;
          g.fillRect(Math.random() * 256, Math.random() * 256, 1, 2 + Math.random() * 3);
        }
      } else if (kind === 'wood') {
        for (let y = 0; y < 256; y += 3) {
          g.fillStyle = `rgba(96,66,38,${0.05 + Math.random() * 0.10})`;
          g.fillRect(0, y, 256, 1 + Math.random() * 2);
        }
        // board joints + the odd knot, so lumber reads board by board
        for (let y = 0; y < 256; y += 32) {
          g.fillStyle = 'rgba(60,40,22,0.28)';
          g.fillRect(0, y, 256, 1.6);
        }
        for (let i = 0; i < 7; i += 1) {
          const kx = Math.random() * 256, ky = Math.random() * 256;
          g.strokeStyle = 'rgba(70,45,24,0.35)';
          g.lineWidth = 1.2;
          g.beginPath();
          g.ellipse(kx, ky, 2.5 + Math.random() * 3, 1.5 + Math.random() * 2, 0, 0, Math.PI * 2);
          g.stroke();
        }
        speckle(500, 0.05, 1.4);
      }
      const texture = new THREE.CanvasTexture(c);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(3, 3);
      grainCache.set(kind, texture);
      return texture;
    }

    // Grayscale HEIGHT maps (bumpMap) — the relief under the grain: trowel
    // sweeps in plaster, bale bulges under render, standing-seam ridges,
    // board steps. Mid-gray base so bumps go both ways; repeat matches the
    // color maps (metal seams share the same 21px rhythm).
    const bumpCache = new Map();
    function bumpTexture(kind) {
      if (bumpCache.has(kind)) return bumpCache.get(kind);
      const c = document.createElement('canvas');
      c.width = 256; c.height = 256;
      const g = c.getContext('2d');
      g.fillStyle = '#808080';
      g.fillRect(0, 0, 256, 256);
      const blob = (count, rMin, rMax, aMax) => {
        for (let i = 0; i < count; i += 1) {
          const r = rMin + Math.random() * (rMax - rMin);
          const x = Math.random() * 256, y = Math.random() * 256;
          const grad = g.createRadialGradient(x, y, 0, x, y, r);
          const lift = Math.random() < 0.5;
          grad.addColorStop(0, `rgba(${lift ? 255 : 0},${lift ? 255 : 0},${lift ? 255 : 0},${Math.random() * aMax})`);
          grad.addColorStop(1, 'rgba(128,128,128,0)');
          g.fillStyle = grad;
          g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        }
      };
      if (kind === 'plaster') {
        blob(140, 6, 22, 0.16);
        // trowel arcs — shallow curved sweeps a hand leaves in lime plaster
        for (let i = 0; i < 26; i += 1) {
          g.strokeStyle = Math.random() < 0.5 ? `rgba(255,255,255,${0.04 + Math.random() * 0.05})` : `rgba(0,0,0,${0.04 + Math.random() * 0.05})`;
          g.lineWidth = 3 + Math.random() * 6;
          g.beginPath();
          const cx = Math.random() * 256, cy = Math.random() * 256, r = 26 + Math.random() * 60;
          const a0 = Math.random() * Math.PI * 2;
          g.arc(cx, cy, r, a0, a0 + 0.7 + Math.random() * 0.9);
          g.stroke();
        }
      } else if (kind === 'lumpy') {
        // bale bulges under render: big soft mounds + plaster micro-relief
        blob(26, 26, 52, 0.5);
        blob(120, 6, 18, 0.14);
      } else if (kind === 'metal') {
        for (let x = 0; x < 256; x += 21) {
          g.fillStyle = 'rgba(255,255,255,0.9)';
          g.fillRect(x, 0, 2.4, 256);
          g.fillStyle = 'rgba(0,0,0,0.35)';
          g.fillRect(x + 2.4, 0, 1.2, 256);
        }
      } else if (kind === 'wood') {
        for (let y = 0; y < 256; y += 3) {
          g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
          g.fillRect(0, y, 256, 1 + Math.random() * 2);
        }
        for (let y = 0; y < 256; y += 32) {
          g.fillStyle = 'rgba(0,0,0,0.55)';
          g.fillRect(0, y, 256, 2);
        }
      } else if (kind === 'concrete' || kind === 'earth') {
        blob(kind === 'earth' ? 220 : 320, 2, kind === 'earth' ? 12 : 7, 0.2);
      }
      const texture = new THREE.CanvasTexture(c);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(3, 3);
      bumpCache.set(kind, texture);
      return texture;
    }

    function renderModel() {
      scene.children.filter((child) => child.userData.generated).forEach((child) => scene.remove(child));
      roomMeshes.length = 0;
      resizeHandles.length = 0;
      draggableParts.clear();

      const group = new THREE.Group();
      group.userData.generated = true;
      const width = spec.shell.widthFt;
      const depth = spec.shell.depthFt;
      const pad = padExtension(spec.shell);
      const padRect = sitePadRect(spec);
      const roofSpec = roofProfile(spec.shell);
      const { extraFt: storeyLift, baseWallFt: baseStoreyFt, storeys, upperFt } = storeyInfo(spec.shell);
      // Per-storey heights: each upper floor can be a different height, so the
      // wall/roof stacking uses CUMULATIVE sums, not level×upperFt. `heightAt`
      // = one storey's height; `upAbove(lv)` = the lift to level lv's FLOOR
      // (sum of upper heights below it); `upThru(lv)` = lift to the TOP of lv.
      const elev2 = storeyElevationFt(spec.shell, 2);
      const heightAt = (level) => storeyHeightFt(spec.shell, level);
      const upAbove = (level) => Math.max(0, storeyElevationFt(spec.shell, level) - elev2);
      const upThru = (lv) => Math.max(0, storeyElevationFt(spec.shell, lv + 1) - elev2);
      // A design with a genuinely SET-BACK storey (a tower, a loft band) uses
      // the ENGINE's global floor elevations for every wall, roof tier, and
      // plate, so walls agree with floors. A design whose storeys all cover
      // the whole footprint keeps the classic stacked model (walls ride the
      // roof profile of the side below — a sloped-ceiling top floor).
      const anySetback = (() => {
        for (let lv = 2; lv <= Math.ceil(Number(spec.shell.storeys || 1)); lv += 1) {
          const p = upperPlateRect(spec, lv);
          if (p && p.w * p.d < spec.shell.widthFt * spec.shell.depthFt - 1) return true;
        }
        return false;
      })();
      // A storey's floor plate can carry its OWN roof pitch (a tower wearing
      // a flatter cap than the main roof). Null = ride the whole-roof pitch.
      const tierPitchOf = (lv) => {
        if (lv <= 1) return null;
        const elP = (spec.elements || []).find((el) => el.category === 'floor' && Number(el.level || 1) === lv);
        const v = Number(elP?.roofPitch);
        return Number.isFinite(v) && v > 0 ? v : null;
      };
      const basementH = basementInfo(spec.shell).heightFt;
      const wallHeight = roofSpec.highWallHeightFt + storeyLift;
      // The shed's fall AXIS (from the engine's one roofProfile): 'ns' slopes
      // along z (south/north walls flat, east/west raked); 'ew' slopes along
      // x (east/west walls flat, north/south raked). shedFracAt maps a plan
      // point to 0..1 along the slope run; shedEaveAt is THE eave line every
      // wall, roof plane, and frame member rides.
      const shedEW = roofSpec.roofType === 'shed' && roofSpec.axis === 'ew';
      const southWallHeight = (roofSpec.roofType === 'shed' && !shedEW ? roofSpec.southWallHeightFt : roofSpec.highWallHeightFt) + storeyLift;
      const northWallHeight = (roofSpec.roofType === 'shed' && !shedEW ? roofSpec.northWallHeightFt : roofSpec.highWallHeightFt) + storeyLift;
      const eastWallHeight = (shedEW ? roofSpec.eastWallHeightFt : roofSpec.highWallHeightFt) + storeyLift;
      const westWallHeight = (shedEW ? roofSpec.westWallHeightFt : roofSpec.highWallHeightFt) + storeyLift;
      // 0..1 along the slope run (z for ns, x for ew), and the raw ground-
      // storey eave height at a plan point (no lift), start side → far side.
      const shedFracAt = (px, pz) => (shedEW
        ? clamp(width > 0 ? px / width : 0, 0, 1)
        : clamp(depth > 0 ? pz / depth : 0, 0, 1));
      const shedH0 = shedEW ? roofSpec.westWallHeightFt : roofSpec.northWallHeightFt;   // at x=0 / z=0
      const shedH1 = shedEW ? roofSpec.eastWallHeightFt : roofSpec.southWallHeightFt;   // at x=width / z=depth
      const shedEaveAt = (px, pz) => shedH0 + (shedH1 - shedH0) * shedFracAt(px, pz);
      const shedSlopePerFt = shedEW
        ? (width > 0 ? (roofSpec.eastWallHeightFt - roofSpec.westWallHeightFt) / width : 0)
        : (depth > 0 ? (roofSpec.southWallHeightFt - roofSpec.northWallHeightFt) / depth : 0);
      const wallProfile = wallAssemblyProfile(spec.systems.envelope);
      const wallT = wallProfile.thicknessFt;

      // Underside of the roof at a plan point — interior walls and similar
      // full-height elements stop here instead of stabbing through the roof.
      // Exact for shed/flat (incl. the stepped plate), long-axis-ridge
      // approximation for gable/hip.
      // ══════════════ THE ROOF PLAN — the ONE authority ══════════════
      // Every roof surface is computed HERE, ONCE, as an exact plane function
      // per piece — and then everything downstream consumes it: the roof
      // MESHES are built from these same functions, the WALLS are vertex-
      // capped against it (every roof type now, not just shed/flat), the
      // FRAME samples it so members ride their roof by construction, and the
      // seam audit judges against it. Three hand-synced copies of "where is
      // the roof" (mesh math / roofUnderAt approximations / frame plane math)
      // were the root cause of every pierced-roof bug — this kills the class.
      const roundFp = isRoundFootprint(spec);
      const customFp = hasCustomFootprint(spec) && !roundFp;
      const segFp = hasSegmentedFootprint(spec);
      const fpPoly = customFp ? footprintPolygon(spec) : null;
      const fpEdges = segFp ? footprintEdges(spec) : null;
      const ringIsPorch = (lv) => {
        const elP = (spec.elements || []).find((el) => el.category === 'floor' && Number(el.level || 1) === lv);
        return elP?.topTreatment === 'porch';
      };
      const oAll = resolveOverhangs(spec.shell);
      const pitchNow = Number(spec.shell.roofPitch || 0.32);
      const fullRect = { x: 0, y: 0, w: width, d: depth };
      const roofPlan = (() => {
        const pieces = [];
        const porchRings = []; // open decks — NO roof over them
        // ── COVERED DECKS join the plan first (the one-roof law: a roofed
        // deck's canopy is a PLAN PIECE like any other roof — its mesh is
        // built FROM these functions and its posts rise to meet them, never
        // freehand geometry). They don't depend on the footprint, so round
        // houses get them too.
        (spec.elements || []).forEach((el) => {
          if (el.category !== 'deck') return;
          const dk = resolveDeck(spec, el);
          if (!dk.roofKey) return;
          const rect = { x: Number(el.x) || 0, y: Number(el.y) || 0, w: Math.max(1, Number(el.w) || 10), d: Math.max(1, Number(el.d) || 8) };
          const o = { north: 0.75, south: 0.75, west: 0.75, east: 0.75 };
          const X0 = rect.x - o.west; const X1 = rect.x + rect.w + o.east;
          const Z0 = rect.y - o.north; const Z1 = rect.y + rect.d + o.south;
          const eaveY = dk.topFt + 6.8; // headroom over the boards, like the porch canopies
          const seg = { rect, o, kind: dk.roofKey === 'gable' ? 'deckGable' : 'deckShed', level: dk.level, deckId: el.id, eave: eaveY };
          seg.covers = (px, pz) => px >= X0 - 0.01 && px <= X1 + 0.01 && pz >= Z0 - 0.01 && pz <= Z1 + 0.01;
          if (seg.kind === 'deckGable') {
            // same law as makeGableSegment: ridge along the LONGER axis
            seg.deckPitch = 0.3;
            const base = eaveY + JOINTS.EAVE_BEARING;
            const spanX = X1 - X0; const spanZ = Z1 - Z0;
            const ridgeY = base + (Math.min(spanX, spanZ) / 2) * seg.deckPitch;
            if (spanX >= spanZ) {
              const cz = (Z0 + Z1) / 2;
              seg.topAt = (px, pz) => base + (ridgeY - base) * Math.max(0, 1 - Math.abs(pz - cz) / Math.max(0.01, spanZ / 2));
            } else {
              const cxs = (X0 + X1) / 2;
              seg.topAt = (px) => base + (ridgeY - base) * Math.max(0, 1 - Math.abs(px - cxs) / Math.max(0.01, spanX / 2));
            }
          } else {
            // shed: high edge toward the house, falling away from it
            const dxH = (width / 2) - (rect.x + rect.w / 2);
            const dzH = (depth / 2) - (rect.y + rect.d / 2);
            const highSide = Math.abs(dxH) > Math.abs(dzH) ? (dxH > 0 ? 'east' : 'west') : (dzH > 0 ? 'south' : 'north');
            const run = (highSide === 'north' || highSide === 'south') ? (Z1 - Z0) : (X1 - X0);
            const rise = Math.max(0.8, run * 0.14);
            const low = eaveY + JOINTS.EAVE_BEARING;
            seg.highSide = highSide;
            seg.topAt = (px, pz) => (
              highSide === 'south' ? low + ((pz - Z0) / (Z1 - Z0)) * rise
              : highSide === 'north' ? low + ((Z1 - pz) / (Z1 - Z0)) * rise
              : highSide === 'east' ? low + ((px - X0) / (X1 - X0)) * rise
              : low + ((X1 - px) / (X1 - X0)) * rise);
          }
          seg.stopBearing = JOINTS.EAVE_BEARING;
          pieces.push(seg);
        });
        if (roundFp) return { pieces, porchRings, legacy: false }; // cone keeps its own law (round v1)
        // Storey extents bottom→top — identical numbers to the walls/plates.
        const storeyTiers = [];
        for (let lv = 1; lv <= Math.max(1, Math.ceil(storeys)); lv += 1) {
          const plate = lv === 1 ? fullRect : (upperPlateRect(spec, lv) || fullRect);
          const topY = lv === 1 ? roofSpec.highWallHeightFt : elev2 + upThru(lv);
          if (lv === 1 || heightAt(lv) > 0) storeyTiers.push({ rect: plate, topEave: topY, level: lv });
        }
        const rectHas = (r, px, py) => px > r.x + 0.01 && px < r.x + r.w - 0.01 && py > r.y + 0.01 && py < r.y + r.d - 0.01;
        const coveredAbove = (px, py, lv) => storeyTiers.some((t) => t.level > lv && rectHas(t.rect, px, py));
        const steps = storeyLift > 0 && storeyTiers.some((t, i) => i > 0 && t.rect.w * t.rect.d < storeyTiers[i - 1].rect.w * storeyTiers[i - 1].rect.d - 1);
        const insideFp = (px, py) => (customFp
          ? pointInFootprint(fpPoly, px, py)
          : px > 0.01 && px < width - 0.01 && py > 0.01 && py < depth - 0.01);
        const segOverhangs = (rect, isUpper, segLevel) => {
          const probe = 0.4;
          const probes = {
            north: [rect.x + rect.w / 2, rect.y - probe],
            south: [rect.x + rect.w / 2, rect.y + rect.d + probe],
            west: [rect.x - probe, rect.y + rect.d / 2],
            east: [rect.x + rect.w + probe, rect.y + rect.d / 2]
          };
          const out = {};
          for (const side of WALL_SIDES) {
            const [px, py] = probes[side];
            if (!isUpper && coveredAbove(px, py, segLevel)) out[side] = 0.35;
            else if (insideFp(px, py)) out[side] = 0.05;
            else out[side] = oAll[side];
          }
          return out;
        };
        const touchSide = (rect, above) => {
          const overlapX = rect.x < above.x + above.w && rect.x + rect.w > above.x;
          const overlapY = rect.y < above.y + above.d && rect.y + rect.d > above.y;
          return Math.abs(rect.y + rect.d - above.y) < 0.05 && overlapX ? 'south'
            : Math.abs(rect.y - (above.y + above.d)) < 0.05 && overlapX ? 'north'
            : Math.abs(rect.x + rect.w - above.x) < 0.05 && overlapY ? 'east'
            : Math.abs(rect.x - (above.x + above.w)) < 0.05 && overlapY ? 'west'
            : (Math.abs((rect.x + rect.w / 2) - (above.x + above.w / 2)) > Math.abs((rect.y + rect.d / 2) - (above.y + above.d / 2))
              ? ((rect.x + rect.w / 2) < (above.x + above.w / 2) ? 'east' : 'west')
              : ((rect.y + rect.d / 2) < (above.y + above.d / 2) ? 'south' : 'north'));
        };
        // Raw segments, exactly as the mesh builder has always assembled them.
        const segments = [];
        const legacy = !customFp && !steps;
        if (legacy) {
          segments.push({ rect: fullRect, eave: wallHeight, kind: 'full', upper: true, level: storeyTiers.length, tierY0: 0, tierX0: 0, legacy: true });
        } else if (steps) {
          const top = storeyTiers[storeyTiers.length - 1];
          segments.push({ rect: top.rect, eave: top.topEave, kind: 'full', upper: true, level: top.level, tierY0: top.rect.y, tierX0: top.rect.x });
          for (let i = storeyTiers.length - 2; i >= 0; i -= 1) {
            const below = storeyTiers[i];
            const above = storeyTiers[i + 1];
            if (below.rect.w * below.rect.d <= above.rect.w * above.rect.d + 1) continue;
            const ring = (customFp && below.level === 1)
              ? subtractRectFromFootprint(fpPoly, above.rect)
              : subtractRect(below.rect, above.rect);
            if (below.level >= 2 && ringIsPorch(below.level)) {
              ring.forEach((rect) => porchRings.push({ rect, level: below.level, topEave: below.topEave, hostRect: below.rect }));
              continue;
            }
            ring.forEach((rect) => segments.push({ rect, eave: below.topEave, aboveTop: above.topEave, kind: 'wing', highSide: touchSide(rect, above.rect), level: below.level, tierDrop: storeyLift - upThru(below.level), tierY0: below.rect.y, tierX0: below.rect.x }));
          }
        } else {
          decomposeFootprint(fpPoly).forEach((rect) => segments.push({ rect, eave: wallHeight, kind: 'full', upper: true, level: storeyTiers.length }));
        }
        // The global shed plane + per-tier variants (same law the walls use).
        const shedYAt = (xx, zz) => shedEaveAt(xx, zz) + storeyLift + JOINTS.ROOF_BEARING;
        const shedPlaneFor = (seg) => {
          const lvl = seg.level || 1;
          if (!anySetback || lvl <= 1) return (xx, zz) => shedYAt(xx, zz) - (seg.tierDrop ?? storeyLift);
          const topPlane = elev2 + upThru(lvl) + JOINTS.ROOF_BEARING;
          const slopeT = tierPitchOf(lvl) ?? shedSlopePerFt;
          const a0 = shedEW ? (seg.tierX0 ?? seg.rect.x) : (seg.tierY0 ?? seg.rect.y);
          return (xx, zz) => topPlane + slopeT * Math.max(0, (shedEW ? xx : zz) - a0);
        };
        // Per-segment EXACT top-surface function + the wall-stop bearing —
        // matching the mesh each kind builds, coordinate for coordinate.
        segments.forEach((seg) => {
          const o = segOverhangs(seg.rect, Boolean(seg.upper), seg.level || 1);
          seg.o = o;
          const X0 = seg.rect.x - o.west, X1 = seg.rect.x + seg.rect.w + o.east;
          const Z0 = seg.rect.y - o.north, Z1 = seg.rect.y + seg.rect.d + o.south;
          seg.covers = (px, pz) => px >= X0 - 0.01 && px <= X1 + 0.01 && pz >= Z0 - 0.01 && pz <= Z1 + 0.01;
          const segPitch = (seg.level || 1) > 1 ? (tierPitchOf(seg.level) ?? pitchNow) : pitchNow;
          if (seg.kind === 'wing' && roofSpec.roofType === 'shed') {
            seg.topAt = shedPlaneFor(seg);
            seg.stopBearing = JOINTS.ROOF_BEARING;
          } else if (seg.kind === 'wing') {
            // A pitched roof's WING is a lean-to: its OUTER eave sits ON the
            // tier's wall top and it RISES toward the storey above, tucking
            // under that storey's top. (The old law hung the HIGH edge at the
            // wall top and let the outer edge plunge run×pitch BELOW the
            // walls — the walls and frame then "pierced" a roof that had
            // dived under them. That was the recurring stepped-roof bug.)
            const low = seg.eave + JOINTS.EAVE_BEARING;
            const run = (seg.highSide === 'north' || seg.highSide === 'south') ? (Z1 - Z0) : (X1 - X0);
            const rise = Math.max(0.1, Math.min(run * segPitch,
              Number.isFinite(seg.aboveTop) ? Math.max(0.5, seg.aboveTop - seg.eave - 0.5) : run * segPitch));
            seg.topAt = (px, pz) => (
              seg.highSide === 'north' ? low + ((Z1 - pz) / (Z1 - Z0)) * rise
              : seg.highSide === 'south' ? low + ((pz - Z0) / (Z1 - Z0)) * rise
              : seg.highSide === 'west' ? low + ((X1 - px) / (X1 - X0)) * rise
              : low + ((px - X0) / (X1 - X0)) * rise);
            seg.stopBearing = JOINTS.EAVE_BEARING;
          } else if (roofSpec.roofType === 'shed') {
            seg.topAt = (anySetback && (seg.level || 1) > 1) ? shedPlaneFor(seg) : shedYAt;
            seg.stopBearing = JOINTS.ROOF_BEARING;
          } else if (roofSpec.roofType === 'flat') {
            const y = seg.legacy ? wallHeight + JOINTS.EAVE_BEARING : seg.eave + JOINTS.EAVE_BEARING;
            seg.topAt = () => y;
            seg.stopBearing = JOINTS.EAVE_BEARING;
          } else if (roofSpec.roofType === 'hip') {
            // makeRoof hip on the overhang-extended rect: four 45° faces at
            // the pitch, ridge along the longer axis, capped at the ridge.
            const eave = seg.eave;
            const ridgeY = eave + Math.min(X1 - X0, Z1 - Z0) / 2 * segPitch;
            seg.topAt = (px, pz) => Math.min(ridgeY, eave + segPitch * Math.max(0, Math.min(px - X0, X1 - px, pz - Z0, Z1 - pz)));
            seg.stopBearing = 0; // hip corners sit AT the eave height
            seg.ridge = { y: ridgeY, eave };
          } else if (seg.legacy) {
            // THE LEGACY GABLE (single rectangle): makeRoof extrudes the
            // profile along z — ridge runs north–south at x = width/2, apex
            // at eave + depth·pitch, the two slopes falling east and west to
            // eave + EAVE_BEARING at the overhang tips. Modeled EXACTLY.
            const base = wallHeight + JOINTS.EAVE_BEARING;
            const apex = wallHeight + depth * segPitch; // = makeRoof's extrusion profile, exactly
            const cx = width / 2;
            seg.topAt = (px) => (px <= cx
              ? base + (apex - base) * Math.max(0, (px - X0) / Math.max(0.01, cx - X0))
              : base + (apex - base) * Math.max(0, (X1 - px) / Math.max(0.01, X1 - cx)));
            seg.stopBearing = JOINTS.EAVE_BEARING;
            seg.ridge = { axis: 'z', at: cx, y: apex, base };
          } else {
            // makeGableSegment: ridge along the segment's LONGER axis (incl.
            // overhangs), base at eave+EAVE_BEARING, gable ends vertical.
            const base = seg.eave + JOINTS.EAVE_BEARING;
            const spanX = X1 - X0, spanZ = Z1 - Z0;
            const alongX = spanX >= spanZ;
            const ridgeY = base + (Math.min(spanX, spanZ) / 2) * segPitch;
            if (alongX) {
              const cz = (Z0 + Z1) / 2;
              seg.topAt = (px, pz) => base + (ridgeY - base) * Math.max(0, 1 - Math.abs(pz - cz) / Math.max(0.01, spanZ / 2));
              seg.ridge = { axis: 'x', at: cz, y: ridgeY, base };
            } else {
              const cxs = (X0 + X1) / 2;
              seg.topAt = (px) => base + (ridgeY - base) * Math.max(0, 1 - Math.abs(px - cxs) / Math.max(0.01, spanX / 2));
              seg.ridge = { axis: 'z', at: cxs, y: ridgeY, base };
            }
            seg.stopBearing = JOINTS.EAVE_BEARING;
          }
          pieces.push(seg);
        });
        return { pieces, porchRings, legacy };
      })();
      // The roof underside law at a plan point: the TOPMOST covering piece's
      // surface minus its bearing. +Infinity under open sky (a porch ring has
      // no roof to hit); walls/frames/partitions are all judged against THIS.
      const roofStopAt = (px, pz) => {
        let best = -Infinity;
        for (const p of roofPlan.pieces) {
          if (p.covers(px, pz)) best = Math.max(best, p.topAt(px, pz) - p.stopBearing);
        }
        return best === -Infinity ? Infinity : best;
      };
      const roofTopAtPt = (px, pz) => {
        let best = -Infinity;
        for (const p of roofPlan.pieces) {
          if (p.covers(px, pz)) best = Math.max(best, p.topAt(px, pz));
        }
        return best; // -Infinity under open sky
      };
      // Debug/test window: probe the plan the way the audit does.
      window.__nbRoofPlan = {
        topAt: (px, pz) => roofTopAtPt(px, pz),
        stopAt: (px, pz) => roofStopAt(px, pz),
        pieces: () => roofPlan.pieces.map((p) => ({ kind: p.kind, legacy: !!p.legacy, level: p.level, rect: p.rect, o: p.o }))
      };
      const roofUnderAt = (px, pz) => {
        const v = roofStopAt(px, pz);
        if (Number.isFinite(v)) return v;
        // open sky / round house: generous fallback so nothing clamps wrongly
        return roofSpec.highWallHeightFt + storeyLift + 40;
      };

      const slabMat = new THREE.MeshStandardMaterial({ color: 0xc0b49b, roughness: 0.92, map: grainTexture('earth'), bumpMap: bumpTexture('earth'), bumpScale: 0.2 });
      const wallMat = new THREE.MeshStandardMaterial({ color: wallProfile.color, roughness: 0.88, map: grainTexture('plaster'), bumpMap: bumpTexture('plaster'), bumpScale: 0.12 });
      // Chosen finish colors (Finishes chapter) — '' or bad hex = the default
      const finishHex = (v) => (/^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? new THREE.Color(v) : null);
      const roofTint = finishHex(spec.shell.roofColorHex);
      const wallTint = finishHex(spec.shell.wallColorHex);
      const floorTint = finishHex(spec.shell.floorColorHex);
      const roofMat = new THREE.MeshStandardMaterial({ color: roofTint || 0x8a938f, roughness: 0.5, metalness: 0.22, map: grainTexture('metal'), bumpMap: bumpTexture('metal'), bumpScale: 0.16, envMap: envTex, envMapIntensity: 0.35, side: THREE.DoubleSide });
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x9cc3d8, transparent: true, opacity: 0.5, roughness: 0.06, metalness: 0.25, envMap: envTex, envMapIntensity: 0.85 });
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x7a5c3e, roughness: 0.7, map: grainTexture('wood'), bumpMap: bumpTexture('wood'), bumpScale: 0.08 });
      const doorMatWood = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.72, map: grainTexture('wood'), bumpMap: bumpTexture('wood'), bumpScale: 0.08 });
      const zonePalette = {
        living: 0x79a7a8,
        service: 0xbe9b6f,
        sleeping: 0x8f9cc2,
        wet: 0x78a9c8,
        work: 0x9ca66a,
        plant: 0x7fbf78,
        storage: 0x9a8575,
        outdoor: 0x9a8f70,
        site: 0x9a8f70,
        garden: 0x5f8d49,
        animal: 0xb0895b,
        paddock: 0xb0895b,
        run: 0xb0895b,
        landscape: 0x6d8c55,
        homestead: 0x8e7049
      };
      const elementPalette = {
        wall: 0x9f7d54,
        earthwork: 0x7d684f,
        structure: 0x74553d,
        roof: 0x55766f,
        passive: 0xb08b4f,
        thermal: 0x9a5944,
        water: 0x4c88a0,
        plant: 0x6f9b61,
        homestead: 0x8e7049,
        landscape: 0x6d8c55,
        storage: 0x8a7768,
        site: 0x9a8f70,
        garden: 0x5f8d49,
        animal: 0xb0895b,
        floor: 0x8d8473,
        loft: 0x6f7f6a,
        tower: 0x7a5f49,
        outbuilding: 0xa08a5f,
        foundation: 0x8f8b80,
        partition: 0x6b6257,
        chimney: 0x9a5944,
        deck: 0x8e7049,
        custom: 0x8b786d
      };

      const slab = box(padRect.w, padRect.h, padRect.d, padRect.x + padRect.w / 2, -padRect.h / 2, padRect.y + padRect.d / 2, slabMat);
      slab.name = `Site pad (${padRect.w}' x ${padRect.d}')`;
      slab.userData.roomId = 'site-pad';
      slab.userData.footprint = { w: padRect.w, d: padRect.d };
      // On a sloped site the huge DEFAULT pad would hover over the falling
      // ground — the terrain is the ground there. A pad the user placed/sized
      // (shell.sitePad) still renders: that's a deliberate leveled terrace.
      const flatPadOk = !(Math.max(0, Number(siteOf(spec).slopeFt) || 0) > 0 && !spec.shell.sitePad);
      slab.visible = layers.pad && flatPadOk;
      if (layers.pad && flatPadOk) roomMeshes.push(slab);
      if (layers.pad && flatPadOk && selectedRoom === 'site-pad') {
        const padObject = {
          id: 'site-pad',
          name: 'Site Pad',
          x: padRect.x,
          y: padRect.y,
          w: padRect.w,
          d: padRect.d,
          type: 'site',
          category: 'site-pad'
        };
        const parts = { mesh: slab, label: null, halo: null, handles: [], baseW: padObject.w, baseD: padObject.d, h: padRect.h, w: padObject.w, d: padObject.d };
        draggableParts.set('site-pad', parts);
        const halo = selectionHalo(padObject.w, padObject.d, padObject.x + padObject.w / 2, 0.12, padObject.y + padObject.d / 2);
        parts.halo = halo;
        group.add(halo);
        addResizeHandles(group, parts, 'site-pad', padObject.x, padObject.y, padObject.w, padObject.d, 0.7);
      }
      group.add(addEdges(slab));

      const omittedWalls = new Set(spec.shell.omittedWalls || []);
      // Per-wall assembly + height: each side reads its own resolved profile so
      // color (material), thickness, and height can differ N/S/E/W.
      const wallResolved = {
        north: resolveWallSide(spec, 'north'),
        south: resolveWallSide(spec, 'south'),
        east: resolveWallSide(spec, 'east'),
        west: resolveWallSide(spec, 'west')
      };
      // Wall construction varies by storey: each side renders as a ground band
      // plus (when storeys > 1) an upper band with the UPPER storey's assembly
      // color/thickness and its own id (wall-side-u) so tapping it edits the
      // upper wall. Shed east/west walls are raked — they stay one mesh in the
      // ground assembly (their band split is geometric, noted honestly).
      const wallUpper = {
        north: resolveWallSide(spec, 'north', 2),
        south: resolveWallSide(spec, 'south', 2),
        east: resolveWallSide(spec, 'east', 2),
        west: resolveWallSide(spec, 'west', 2)
      };
      // X-ray AND exploded views both need see-through walls — exploded pulls
      // the shell apart, translucency lets the interior read through it.
      // A glazed assembly renders as glass; a chosen CLADDING wears its own
      // material (wood lap, shingle, metal, stone…); 'render' shows the
      // assembly's plaster face.
      const wallMatOf = (resolved) => {
        if (resolved.assemblyKey === 'glazed') return new THREE.MeshStandardMaterial({ color: 0xcfe5ea, roughness: 0.12, metalness: 0.05, transparent: true, opacity: layers.xray ? 0.22 : 0.38, envMap: envTex, envMapIntensity: 0.85 });
        const clad = CLADDING_TYPES[resolved.cladding];
        if (clad && resolved.cladding !== 'render') {
          const metalClad = clad.texture === 'metal';
          return new THREE.MeshStandardMaterial({ color: clad.color, roughness: metalClad ? 0.45 : 0.85, metalness: metalClad ? 0.25 : 0, map: grainTexture(clad.texture), bumpMap: bumpTexture(['metal', 'wood', 'plaster', 'concrete', 'earth'].includes(clad.texture) ? clad.texture : 'plaster'), bumpScale: metalClad ? 0.16 : 0.1, envMap: metalClad ? envTex : null, envMapIntensity: 0.35, transparent: layers.xray || layers.explode, opacity: layers.xray ? 0.34 : layers.explode ? 0.55 : 1 });
        }
        // Hand-formed assemblies read LUMPY under their render — bale bulges,
        // cob curves; crisp systems keep the flat troweled plaster.
        const lumpy = ['straw-bale', 'cob', 'light-straw-clay'].includes(resolved.assemblyKey);
        return new THREE.MeshStandardMaterial({ color: wallTint || resolved.assembly.color, roughness: 0.88, map: grainTexture('plaster'), bumpMap: bumpTexture(lumpy ? 'lumpy' : 'plaster'), bumpScale: lumpy ? 0.45 : 0.12, transparent: layers.xray || layers.explode, opacity: layers.xray ? 0.34 : layers.explode ? 0.55 : 1 });
      };
      const wallMatFor = (side) => wallMatOf(wallResolved[side]);
      // Stem wall foundation: the walls BEAR ON the stem's top — their bottoms
      // start at the reveal height, never running down through the concrete.
      // A stem wall foundation lifts the walls onto its top — and so does a
      // RUBBLE TRENCH: in real natural building the trench always carries a
      // stem/plinth above grade, because bale walls can never start at the
      // dirt. Both lift by stemwallHeightFt (default 1.5′), all the way around.
      const wholeHouseStem = ['stemwall', 'rubble'].includes(utilitiesOf(spec).foundationType);
      const stemReveal = wholeHouseStem
        ? Math.min(6, Math.max(0.5, Number(utilitiesOf(spec).stemwallHeightFt) || 1.5)) : 0;
      // …and the same rule for stem walls built as PLACED FOUNDATION RUNS
      // (the Foundation chapter's draggable pieces): a wall whose line has a
      // stem run under it sits on THAT stem's top — per side, so a house can
      // mix a stem-walled north side with an at-grade south.
      const sideReveal = (() => {
        const out = {};
        WALL_SIDES.forEach((side) => {
          let r = stemReveal;
          const tSide = (wallResolved[side].thicknessFt || 1) + 0.6;
          for (const el of (spec.elements || [])) {
            if (el.category !== 'foundation') continue;
            if (el.construction !== 'stemwall' && el.construction !== 'rubble-stem') continue;
            const ex = Number(el.x) || 0; const ey = Number(el.y) || 0;
            const ew = Number(el.w) || 0; const ed = Number(el.d) || 0;
            // must lie against the wall line AND actually run along it — a
            // run's corner clipping a neighboring wall doesn't lift that wall
            const nearLine = side === 'north' ? (ey <= tSide && ey + ed >= -0.6)
              : side === 'south' ? (ey + ed >= depth - tSide && ey <= depth + 0.6)
              : side === 'west' ? (ex <= tSide && ex + ew >= -0.6)
              : (ex + ew >= width - tSide && ex <= width + 0.6);
            const runLenAlong = (side === 'north' || side === 'south')
              ? Math.min(ex + ew, width) - Math.max(ex, 0)
              : Math.min(ey + ed, depth) - Math.max(ey, 0);
            if (nearLine && runLenAlong >= 3) r = Math.max(r, Math.max(0.25, Number(el.h) || 0.3) + 0.05);
          }
          out[side] = r;
        });
        return out;
      })();
      const maxReveal = Math.max(sideReveal.north, sideReveal.south, sideReveal.east, sideReveal.west);
      const tN = wallResolved.north.thicknessFt;
      const tS = wallResolved.south.thicknessFt;
      const tE = wallResolved.east.thicknessFt;
      const tW = wallResolved.west.thicknessFt;
      const hN = roofSpec.roofType === 'shed' ? northWallHeight : wallResolved.north.heightFt + storeyLift;
      const hS = roofSpec.roofType === 'shed' ? southWallHeight : wallResolved.south.heightFt + storeyLift;
      const hE = wallResolved.east.heightFt + storeyLift;
      const hW = wallResolved.west.heightFt + storeyLift;
      // Upper bands ring the storey's EXTENT plate — a second storey can sit
      // over only one side of the building. No plate = the full footprint.
      const plate2 = upperPlateRect(spec, 2) || { x: 0, y: 0, w: width, d: depth };
      const wallMeshSpecs = [];
      // (roundFp / customFp / segFp / fpPoly / fpEdges now live with the roof
      // plan above — the walls branch on the same flags the roof law uses.)
      // Openings cut REAL holes: each wall run is built as pieces around its
      // openings (full-height stretches between them, a band under each sill,
      // a header above). Gap positions are collected per wall side — or per
      // polygon edge on a custom footprint — before any wall mesh is built.
      // When the Openings layer is hidden the walls render solid (no bare holes).
      const openingGapsByWall = new Map();
      const gapByOpening = []; // index-aligned with spec.openings; .cut set when the hole is real
      if (layers.openings) (spec.openings || []).forEach((opening, openingIdx) => {
        if (opening.wall === 'roof') return;
        // Only ground-floor openings cut the ground walls. Upper-floor openings
        // sit on their own storey (rendered at elevation, dormered through the
        // roof) and must NOT punch a hole in the wall below them.
        if (Number(opening.level || 1) !== 1) return;
        const profile = OPENING_TYPES[opening.type] || OPENING_TYPES.window;
        let key;
        let along;
        if (segFp) {
          const e = edgeForOpening(spec, opening);
          if (!e) return;
          key = e.key;
          along = e.horizontal ? Number(opening.x) || 0 : Number(opening.y) || 0;
        } else {
          key = opening.wall;
          along = (opening.wall === 'north' || opening.wall === 'south') ? Number(opening.x) || 0 : Number(opening.y) || 0;
        }
        const w = Number(opening.widthFt) || 3;
        // Corrupt or legacy data can put an opening OFF its wall (negative or
        // past the end) — old traces did exactly that. Clamp it onto the wall
        // so the assembly never floats in the yard.
        if (!segFp) {
          const wallLen = (opening.wall === 'north' || opening.wall === 'south') ? width : depth;
          along = clamp(along, 0.2, Math.max(0.2, wallLen - w - 0.2));
        }
        // on a stem wall the whole wall (and its holes) sits on the stem top
        const revealHere = sideReveal[opening.wall] || 0;
        // per-opening sill override (dragged up/down on the wall view) beats
        // the type's default sill
        const sillHere = Number.isFinite(Number(opening.sillFt)) ? Number(opening.sillFt) : profile.sill;
        const gap = { from: along, to: along + w, sill: sillHere + revealHere, top: sillHere + profile.h + revealHere };
        gapByOpening[openingIdx] = gap;
        const list = openingGapsByWall.get(key) || [];
        list.push(gap);
        openingGapsByWall.set(key, list);
      });
      const gapsFor = (key) => openingGapsByWall.get(key) || [];
      // Every storey's wall lives at the ENGINE's floor elevations — the same
      // numbers the floor plates, rooms, and openings use — never stacked on
      // this side's own ground wall. Side-stacking desynced walls from floors
      // whenever the sides differ: a 17′ south shed wall put the 2nd floor's
      // south wall at 17′ while its floor sat at 10′ (the tower ran 7′ tall).
      const elevAt = (level) => elev2 + upAbove(level);
      // Where a storey's own wall has no storey directly under it (a tower
      // side overhanging the main roof), it drops to the roof plane it rises
      // out of; where a storey stands below, it sits at its floor.
      const bandSeatY = (level, edgeX, edgeZ) => {
        for (let below = level - 1; below >= 2; below -= 1) {
          const bp = upperPlateRect(spec, below) || { x: 0, y: 0, w: width, d: depth };
          if (edgeX > bp.x - 0.05 && edgeX < bp.x + bp.w + 0.05 && edgeZ > bp.y - 0.05 && edgeZ < bp.y + bp.d + 0.05) return elevAt(level);
        }
        if (roofSpec.roofType === 'shed') {
          const wingTop = shedEaveAt(edgeX, edgeZ);
          return Math.min(elevAt(level), wingTop - JOINTS.TUCK);
        }
        return Math.min(elevAt(level), (roofSpec.highWallHeightFt || 10) - JOINTS.TUCK);
      };
      // A storey's wall rises TO ITS OWN ROOF wherever nothing stands above
      // it — the tower's walls go to the roof plane and rake to match it
      // (shed tiers; a flat wall top under a sloped roof left a wedge of open
      // air). Where a storey above stands on the stretch, the wall stops at
      // that storey's floor as before. A PORCH ring has no roof to meet.
      const tierWallTop = (lv, xPos, zPos) => {
        const base = elevAt(lv) + heightAt(lv);
        if (roofSpec.roofType !== 'shed') return base;
        const p = upperPlateRect(spec, lv) || { x: 0, y: 0, w: width, d: depth };
        const slopeT = tierPitchOf(lv) ?? shedSlopePerFt;
        const along = shedEW
          ? clamp(xPos - p.x, 0, Math.max(0, p.w))
          : clamp(zPos - p.y, 0, Math.max(0, p.d));
        return base + slopeT * along;
      };
      const coveredJustAbove = (lv, px, pz) => {
        for (let up = lv + 1; up <= Math.ceil(storeys); up += 1) {
          if (heightAt(up) <= 0) continue;
          const r = upperPlateRect(spec, up) || { x: 0, y: 0, w: width, d: depth };
          if (px > r.x + 0.05 && px < r.x + r.w - 0.05 && pz > r.y + 0.05 && pz < r.y + r.d - 0.05) return true;
        }
        return false;
      };
      // (ringIsPorch is defined with the roof plan above.)
      const pushSideBoxes = (side, totalH, thickness, place) => {
        const groundH = Math.max(1, totalH - storeyLift);
        // Where an upper storey stands ON this side (its extent touches the
        // side's edge), the ground wall stops at that storey's floor and the
        // storey's own wall carries on — "built up only where the second
        // storey is". Stretches under open roof keep the full ground height.
        const horizSide = side === 'north' || side === 'south';
        const alongMax = horizSide ? width : depth;
        const touching = [];
        for (let lv = 2; lv <= Math.ceil(storeys); lv += 1) {
          if (heightAt(lv) <= 0) continue;
          const r = upperPlateRect(spec, lv) || { x: 0, y: 0, w: width, d: depth };
          const touches = side === 'north' ? r.y <= 0.05
            : side === 'south' ? r.y + r.d >= depth - 0.05
            : side === 'west' ? r.x <= 0.05
            : r.x + r.w >= width - 0.05;
          if (!touches) continue;
          const s0 = clamp(horizSide ? r.x : r.y, 0, alongMax);
          const s1 = clamp(horizSide ? r.x + r.w : r.y + r.d, 0, alongMax);
          if (s1 - s0 > 0.1) touching.push({ s0, s1, floorY: elevAt(lv) });
        }
        const bounds = [...new Set([0, alongMax, ...touching.flatMap((c) => [c.s0, c.s1])])].sort((x, y) => x - y);
        const groundMeshes = [];
        for (let bi = 0; bi < bounds.length - 1; bi += 1) {
          const s0 = bounds[bi]; const s1 = bounds[bi + 1];
          if (s1 - s0 < 0.1) continue;
          const mid = (s0 + s1) / 2;
          const covers = anySetback ? touching.filter((c) => mid > c.s0 && mid < c.s1) : [];
          const capY = covers.length ? Math.min(...covers.map((c) => c.floorY)) : Infinity;
          groundMeshes.push(...place(thickness, Math.max(1, Math.min(groundH, capY)), 0, s0, s1));
        }
        wallMeshSpecs.push({ side, storey: 'ground', meshes: groundMeshes });
        for (let level = 2; level <= Math.ceil(storeys); level++) {
          const uH = heightAt(level);
          if (uH > 0) {
            const u = resolveWallSide(spec, side, level);
            if (u.omitted) continue;
            const tU = u.thicknessFt;
            const p = upperPlateRect(spec, level) || { x: 0, y: 0, w: width, d: depth };
            // whole-footprint storeys keep the classic stacked seat; set-back
            // designs put every storey at its ENGINE floor elevation
            const edgeZ = side === 'north' ? p.y : side === 'south' ? p.y + p.d : p.y + p.d / 2;
            const edgeX = side === 'west' ? p.x : side === 'east' ? p.x + p.w : p.x + p.w / 2;
            const probeZ = side === 'north' ? p.y + 0.3 : side === 'south' ? p.y + p.d - 0.3 : edgeZ;
            const exposedNS = anySetback && (side === 'north' || side === 'south')
              && !coveredJustAbove(level, edgeX, probeZ) && !ringIsPorch(level);
            const yTop = anySetback
              ? (exposedNS ? tierWallTop(level, edgeX, edgeZ) : elevAt(level) + uH)
              : groundH + upAbove(level) + uH;
            const yBot = anySetback ? bandSeatY(level, edgeX, edgeZ) : groundH + upAbove(level);
            const bH = yTop - yBot;
            if (bH < 0.05) continue;
            const upperMesh = side === 'north' ? box(p.w, bH, tU, p.x + p.w / 2, yBot + bH / 2, p.y + tU / 2, wallMatOf(u))
              : side === 'south' ? box(p.w, bH, tU, p.x + p.w / 2, yBot + bH / 2, p.y + p.d - tU / 2, wallMatOf(u))
              : side === 'west' ? box(tU, bH, p.d, p.x + tU / 2, yBot + bH / 2, p.y + p.d / 2, wallMatOf(u))
              : box(tU, bH, p.d, p.x + p.w - tU / 2, yBot + bH / 2, p.y + p.d / 2, wallMatOf(u));
            wallMeshSpecs.push({ side, storey: 'upper', level, meshes: [upperMesh] });
          }
        }
      };
      if (roundFp) {
        // ROUND house: the wall is a curved elliptical ring. It renders as four
        // quarter-arc runs (N/S/E/W) so each keeps its own construction + is
        // selectable, each built from short tangent boxes hugging the ellipse.
        // Uniform height (a cone roof sits on top); openings render as panes on
        // the arc below (they don't cut holes on a curved wall — v1).
        const rx = width / 2;
        const ry = depth / 2;
        const cxE = rx; const czE = ry;
        const QUARTERS = { east: [-45, 45], south: [45, 135], west: [135, 225], north: [225, 315] };
        const SEGS = 20; // per quarter — smooth enough at building scale
        WALL_SIDES.forEach((side) => {
          const rG = resolveWallSide(spec, side, 1);
          if (rG.omitted || omittedWalls.has(side)) return;
          const t = rG.thicknessFt;
          const totalH = rG.heightFt + storeyLift;
          const groundH = Math.max(1, totalH);
          const mat = wallMatOf(rG);
          const [a0, a1] = QUARTERS[side];
          const meshes = [];
          for (let s = 0; s < SEGS; s += 1) {
            const t0 = a0 + (a1 - a0) * (s / SEGS);
            const t1 = a0 + (a1 - a0) * ((s + 1) / SEGS);
            const th0 = t0 * Math.PI / 180; const th1 = t1 * Math.PI / 180;
            const p0 = [cxE + rx * Math.cos(th0), czE + ry * Math.sin(th0)];
            const p1 = [cxE + rx * Math.cos(th1), czE + ry * Math.sin(th1)];
            const midX = (p0[0] + p1[0]) / 2; const midZ = (p0[1] + p1[1]) / 2;
            const dxs = p1[0] - p0[0]; const dzs = p1[1] - p0[1];
            const segLen = Math.hypot(dxs, dzs) + 0.15; // slight overlap, no gaps
            const segH = Math.max(1, groundH - sideReveal[side]);
            const seg = box(segLen, segH, t, midX, sideReveal[side] + segH / 2, midZ, mat);
            seg.rotation.y = Math.atan2(-dzs, dxs);
            meshes.push(seg);
          }
          wallMeshSpecs.push({ side, storey: 'ground', meshes });
        });
      } else if (segFp) {
        // Stored footprint: one wall per polygon edge, thickness inward.
        // Construction resolves by facing with per-segment overrides, so a
        // split wall can mix systems. Under a shed roof the eave line runs
        // along the FALL AXIS: edges parallel to the level eaves seat at one
        // height, edges along the slope rake between their two end heights
        // (north/south fall rakes the vertical edges; east/west fall rakes
        // the horizontal ones).
        const shed = roofSpec.roofType === 'shed';
        const eaveAtPt = (xx, yy) => shedEaveAt(xx, yy) + storeyLift;
        const hasPlate = Boolean(upperPlateRect(spec, 2));
        fpEdges.forEach((edge) => {
          // Resolve per SEGMENT — a split wall can mix constructions
          // (frame sections beside infill sections on the same facing).
          const rG = resolveWallSide(spec, edge.facing, 1, edge.key);
          if (rG.omitted || omittedWalls.has(edge.facing)) return;
          const t = rG.thicknessFt;
          const midX = (edge.x0 + edge.x1) / 2;
          const midY = (edge.y0 + edge.y1) / 2;
          const cx = midX - edge.nx * (t / 2);
          const cy = midY - edge.ny * (t / 2);
          const len = edge.lengthFt;
          const rakes = shed && (shedEW ? edge.horizontal : !edge.horizontal);
          const totalH = shed
            ? (rakes ? Math.max(eaveAtPt(edge.x0, edge.y0), eaveAtPt(edge.x1, edge.y1)) : eaveAtPt(midX, midY))
            : rG.heightFt + storeyLift;
          const groundH = Math.max(1, totalH - storeyLift);
          const matG = wallMatOf(rG);
          let meshes;
          if (rakes && !edge.horizontal) {
            const z0 = Math.min(edge.y0, edge.y1);
            const z1 = Math.max(edge.y0, edge.y1);
            meshes = wallRunMeshes({
              horizontal: false, thickCenter: cx, t, a0: z0, a1: z1,
              hAt: (zz) => Math.max(1, eaveAtPt(midX, zz) - (hasPlate ? storeyLift : 0)),
              mat: matG, gaps: gapsFor(edge.key), yBase: sideReveal[edge.facing]
            });
          } else if (rakes && edge.horizontal) {
            const x0 = Math.min(edge.x0, edge.x1);
            const x1 = Math.max(edge.x0, edge.x1);
            meshes = wallRunMeshes({
              horizontal: true, thickCenter: cy, t, a0: x0, a1: x1,
              hAt: (xx) => Math.max(1, eaveAtPt(xx, midY) - (hasPlate ? storeyLift : 0)),
              mat: matG, gaps: gapsFor(edge.key), yBase: sideReveal[edge.facing]
            });
          } else if (edge.horizontal) {
            const a0 = Math.min(edge.x0, edge.x1);
            meshes = wallRunMeshes({ horizontal: true, thickCenter: cy, t, a0, a1: a0 + len, hAt: () => groundH, mat: matG, gaps: gapsFor(edge.key), yBase: sideReveal[edge.facing] });
          } else {
            const a0 = Math.min(edge.y0, edge.y1);
            meshes = wallRunMeshes({ horizontal: false, thickCenter: cx, t, a0, a1: a0 + len, hAt: () => groundH, mat: matG, gaps: gapsFor(edge.key), yBase: sideReveal[edge.facing] });
          }
          wallMeshSpecs.push({ side: edge.facing, storey: 'ground', edgeKey: edge.key, meshes });
          // No extent plate: the upper band rides this same edge.
          for (let level = 2; level <= Math.ceil(storeys); level++) {
            const uH = heightAt(level);
            if (uH > 0) {
              const u = resolveWallSide(spec, edge.facing, level, edge.key);
              const tU = u.thicknessFt;
              const ux = midX - edge.nx * (tU / 2);
              const uy = midY - edge.ny * (tU / 2);
              const liftOffset = groundH + upAbove(level);
              const upperMesh = edge.horizontal
                ? box(len, uH, tU, ux, liftOffset + uH / 2, uy, wallMatOf(u))
                : box(tU, uH, len, ux, liftOffset + uH / 2, uy, wallMatOf(u));
              wallMeshSpecs.push({ side: edge.facing, storey: 'upper', level, edgeKey: edge.key, meshes: [upperMesh] });
            }
          }
        });
        // With a plate, upper bands ring IT — same cardinal ids as a rectangle.
        // On a SHED the tower's walls follow the roof planes: bottom sits on
        // the low wing plane UNDER the tower at that wall, top meets the
        // lifted upper plane. A flat band at max wall height used to float
        // above the roof on the south (the gap) and stab through the upper
        // roof on the north.
        if (storeyLift > 0) {
          // Same law as the rectangle path: every storey's walls at the
          // ENGINE's floor elevations; exposed walls rise to their own roof
          // and rake with it; seated on the storey below or dropped to the
          // roof plane they rise out of. (The old block stacked bands on the
          // shed wing planes — on a jogged outline the tower's side walls
          // stood up to 19′ THROUGH the roof.) A hair of inward inset keeps
          // band faces off the ground-wall faces (no coplanar shimmer).
          const INSET = JOINTS.BAND_INSET;
          for (let level = 2; level <= Math.ceil(storeys); level++) {
            const uH = heightAt(level);
            if (uH > 0) {
              const p = upperPlateRect(spec, level);
              if (p) {
                WALL_SIDES.forEach((side) => {
                  if (omittedWalls.has(side) || wallResolved[side].omitted) return;
                  const u = resolveWallSide(spec, side, level);
                  const tU = u.thicknessFt;
                  let upperMesh = null;
                  if (side === 'north' || side === 'south') {
                    const edgeZ = side === 'north' ? p.y : p.y + p.d;
                    const probeZ = side === 'north' ? p.y + 0.3 : p.y + p.d - 0.3;
                    const exposed2 = !coveredJustAbove(level, p.x + p.w / 2, probeZ) && !ringIsPorch(level);
                    const zAt = side === 'north' ? p.y + tU / 2 + INSET : p.y + p.d - tU / 2 - INSET;
                    if (shed && exposed2 && shedEW) {
                      // east/west fall: the north/south bands rake with the roof
                      const x0 = clamp(p.x, 0, width); const x1 = clamp(p.x + p.w, 0, width);
                      if (x1 - x0 > 0.1) {
                        const yBot = Math.min(bandSeatY(level, x0, edgeZ), bandSeatY(level, x1, edgeZ));
                        upperMesh = rakedPieceX(zAt, tU, x0, x1, yBot, tierWallTop(level, x0, edgeZ), tierWallTop(level, x1, edgeZ), wallMatOf(u));
                      }
                    } else {
                      const yTop = shed && exposed2 ? tierWallTop(level, p.x + p.w / 2, edgeZ) : elevAt(level) + uH;
                      const yBot = bandSeatY(level, p.x + p.w / 2, edgeZ);
                      if (yTop - yBot > 0.05) {
                        upperMesh = box(p.w, yTop - yBot, tU, p.x + p.w / 2, yBot + (yTop - yBot) / 2, zAt, wallMatOf(u));
                      }
                    }
                  } else {
                    const xAt = (side === 'west' ? p.x + tU / 2 + INSET : p.x + p.w - tU / 2 - INSET);
                    const z0 = clamp(p.y, 0, depth); const z1 = clamp(p.y + p.d, 0, depth);
                    if (z1 - z0 > 0.1) {
                      const yBot = Math.min(bandSeatY(level, xAt, z0), bandSeatY(level, xAt, z1));
                      const exposed2 = shed && !coveredJustAbove(level, xAt + (side === 'west' ? 0.3 : -0.3), (z0 + z1) / 2) && !ringIsPorch(level);
                      if (exposed2 && !shedEW) {
                        upperMesh = rakedPieceZ(xAt, tU, z0, z1, yBot, tierWallTop(level, xAt, z0), tierWallTop(level, xAt, z1), wallMatOf(u));
                      } else if (exposed2 && shedEW) {
                        // east/west fall: the east/west bands sit level at their own eave
                        const yTop = tierWallTop(level, xAt, (z0 + z1) / 2);
                        if (yTop - yBot > 0.05) upperMesh = box(tU, yTop - yBot, z1 - z0, xAt, yBot + (yTop - yBot) / 2, (z0 + z1) / 2, wallMatOf(u));
                      } else if (elevAt(level) + uH - yBot > 0.05) {
                        const bH = elevAt(level) + uH - yBot;
                        upperMesh = box(tU, bH, z1 - z0, xAt, yBot + bH / 2, (z0 + z1) / 2, wallMatOf(u));
                      }
                    }
                  }
                  if (upperMesh) wallMeshSpecs.push({ side, storey: 'upper', level, meshes: [upperMesh] });
                });
              }
            }
          }
        }
      } else if (roofSpec.roofType === 'shed') {
        // LIFTED eave at a plan point — the ground+storeys wall-top line for
        // whichever axis the shed falls along.
        const eaveLifted = (xx, zz) => shedEaveAt(xx, zz) + storeyLift;
        // The two walls at the level eaves build flat; the two along the slope
        // rake. Which is which depends on the fall axis.
        if (shedEW) {
          pushSideBoxes('west', westWallHeight, tW, (t, h, lift, s0 = 0, s1 = depth) => wallRunMeshes({ horizontal: false, thickCenter: t / 2, t, a0: s0, a1: s1, hAt: () => h, mat: wallMatFor('west'), gaps: gapsFor('west'), yBase: sideReveal.west }));
          pushSideBoxes('east', eastWallHeight, tE, (t, h, lift, s0 = 0, s1 = depth) => wallRunMeshes({ horizontal: false, thickCenter: width - t / 2, t, a0: s0, a1: s1, hAt: () => h, mat: wallMatFor('east'), gaps: gapsFor('east'), yBase: sideReveal.east }));
        } else {
          pushSideBoxes('north', hN, tN, (t, h, lift, s0 = 0, s1 = width) => wallRunMeshes({ horizontal: true, thickCenter: t / 2, t, a0: s0, a1: s1, hAt: () => h, mat: wallMatFor('north'), gaps: gapsFor('north'), yBase: sideReveal.north }));
          pushSideBoxes('south', hS, tS, (t, h, lift, s0 = 0, s1 = width) => wallRunMeshes({ horizontal: true, thickCenter: depth - t / 2, t, a0: s0, a1: s1, hAt: () => h, mat: wallMatFor('south'), gaps: gapsFor('south'), yBase: sideReveal.south }));
        }
        // The raked side walls step TIER BY TIER: along each stretch of the
        // side they rise exactly as high as the storeys that actually stand
        // at that edge (every level's extent consulted — three set-back floors
        // make three steps). The old builder only knew floor 2, so floor 3's
        // east/west walls simply didn't exist, and a floor-2-at-the-edge wall
        // could poke through the tier above.
        const edgePlateInfo = (side) => {
          // horizontal sides (north/south) bound their stretches along x;
          // vertical sides (east/west) along z — matching the raked run below.
          const horizSide = side === 'north' || side === 'south';
          const runMax = horizSide ? width : depth;
          const plates = [];
          for (let lv = 2; lv <= Math.ceil(storeys); lv += 1) {
            if (heightAt(lv) <= 0) continue;
            const p = upperPlateRect(spec, lv);
            if (!p) { plates.push({ lv, y0: 0, y1: runMax, touches: true }); continue; }
            const touches = side === 'west' ? p.x <= 0.05
              : side === 'east' ? p.x + p.w >= width - 0.05
              : side === 'north' ? p.y <= 0.05
              : p.y + p.d >= depth - 0.05;
            plates.push({
              lv,
              y0: clamp(horizSide ? p.x : p.y, 0, runMax),
              y1: clamp(horizSide ? p.x + p.w : p.y + p.d, 0, runMax),
              touches
            });
          }
          return plates;
        };
        const buildRakedSide = (side, thickCenter, tSide) => {
          const horizSide = side === 'north' || side === 'south';
          const runMax = horizSide ? width : depth;
          const plates = edgePlateInfo(side);
          const bounds = [...new Set([0, runMax, ...plates.filter((p) => p.touches).flatMap((p) => [p.y0, p.y1])])].sort((a, b) => a - b);
          const meshes = [];
          for (let bi = 0; bi < bounds.length - 1; bi += 1) {
            const a0 = bounds[bi]; const a1 = bounds[bi + 1];
            if (a1 - a0 < 0.1) continue;
            const mid = (a0 + a1) / 2;
            // A stretch with a storey standing on it stops at that storey's
            // FLOOR (global elevation — the storey band continues from there);
            // an open stretch rakes with the ground roof plane.
            const covers = anySetback ? plates.filter((p) => p.touches && mid > p.y0 && mid < p.y1) : [];
            const capY = covers.length ? Math.min(...covers.map((p) => elevAt(p.lv))) : Infinity;
            const eaveAlong = (aa) => (horizSide ? eaveLifted(aa, side === 'north' ? 0 : depth) : eaveLifted(side === 'west' ? 0 : width, aa));
            meshes.push(...wallRunMeshes({
              horizontal: horizSide, thickCenter, t: tSide, a0, a1,
              hAt: (aa) => Math.max(1, anySetback ? Math.min(eaveAlong(aa) - storeyLift, capY) : eaveAlong(aa)),
              mat: wallMatFor(side), gaps: gapsFor(side), yBase: sideReveal[side]
            }));
          }
          wallMeshSpecs.push({ side, storey: 'ground', meshes });
        };
        if (shedEW) {
          buildRakedSide('north', tN / 2, tN);
          buildRakedSide('south', depth - tS / 2, tS);
        } else {
          buildRakedSide('west', tW / 2, tW);
          buildRakedSide('east', width - tE / 2, tE);
        }
        // Every upper storey needs its own east/west wall band: on the
        // perimeter where its extent touches the edge, or standing at its own
        // extent line where it is set back — seated on the storey below when
        // there is one, dropped to the roof plane where it overhangs open roof.
        // (Whole-footprint designs need none: the raked side wall above rises
        // through every storey, the classic stacked model.)
        if (storeyLift > 0 && anySetback) {
          for (let level = 2; level <= Math.ceil(storeys); level += 1) {
            const uH = heightAt(level);
            if (uH <= 0) continue;
            const p = upperPlateRect(spec, level) || { x: 0, y: 0, w: width, d: depth };
            // The two sides ALONG the slope rake with the storey's own roof
            // (east/west on a north/south fall; north/south on an east/west
            // fall). The two at the level eaves get their flat bands from
            // pushSideBoxes above.
            (shedEW ? ['north', 'south'] : ['west', 'east']).forEach((side) => {
              if (omittedWalls.has(side) || wallResolved[side].omitted) return;
              const u = resolveWallSide(spec, side, level);
              if (u.omitted) return;
              const tU = u.thicknessFt;
              let band = null;
              if (!shedEW) {
                const touches = side === 'west' ? p.x <= 0.05 : p.x + p.w >= width - 0.05;
                const xAt = touches
                  ? (side === 'west' ? tU / 2 : width - tU / 2)
                  : (side === 'west' ? p.x + tU / 2 : p.x + p.w - tU / 2);
                const z0 = clamp(p.y, 0, depth); const z1 = clamp(p.y + p.d, 0, depth);
                if (z1 - z0 < 0.1) return;
                const yBot = Math.min(bandSeatY(level, xAt, z0), bandSeatY(level, xAt, z1));
                const exposedEW = roofSpec.roofType === 'shed'
                  && !coveredJustAbove(level, xAt + (side === 'west' ? 0.3 : -0.3), (z0 + z1) / 2)
                  && !ringIsPorch(level);
                // exposed side walls rake with the storey's own roof; covered
                // ones stop flat at the floor of the storey above
                band = exposedEW
                  ? rakedPieceZ(xAt, tU, z0, z1, yBot, tierWallTop(level, xAt, z0), tierWallTop(level, xAt, z1), wallMatOf(u))
                  : (() => {
                    const yTop = elevAt(level) + uH;
                    if (yTop - yBot < 0.05) return null;
                    return box(tU, yTop - yBot, z1 - z0, xAt, (yBot + yTop) / 2, (z0 + z1) / 2, wallMatOf(u));
                  })();
              } else {
                const touches = side === 'north' ? p.y <= 0.05 : p.y + p.d >= depth - 0.05;
                const zAt = touches
                  ? (side === 'north' ? tU / 2 : depth - tU / 2)
                  : (side === 'north' ? p.y + tU / 2 : p.y + p.d - tU / 2);
                const x0 = clamp(p.x, 0, width); const x1 = clamp(p.x + p.w, 0, width);
                if (x1 - x0 < 0.1) return;
                const yBot = Math.min(bandSeatY(level, x0, zAt), bandSeatY(level, x1, zAt));
                const exposedNS = !coveredJustAbove(level, (x0 + x1) / 2, zAt + (side === 'north' ? 0.3 : -0.3))
                  && !ringIsPorch(level);
                band = exposedNS
                  ? rakedPieceX(zAt, tU, x0, x1, yBot, tierWallTop(level, x0, zAt), tierWallTop(level, x1, zAt), wallMatOf(u))
                  : (() => {
                    const yTop = elevAt(level) + uH;
                    if (yTop - yBot < 0.05) return null;
                    return box(x1 - x0, yTop - yBot, tU, (x0 + x1) / 2, (yBot + yTop) / 2, zAt, wallMatOf(u));
                  })();
              }
              if (band) wallMeshSpecs.push({ side, storey: 'upper', level, meshes: [band] });
            });
          }
        }
      } else {
        // Cap each wall at the roof underside so a wall taller than the eave
        // can't stab up through the roof. This happens when a per-wall height
        // (east/west never feed the roof profile; a legacy design can hold a
        // south/north override its stored roof height predates) exceeds the
        // eave. The cap is the LOWEST roof height along the wall's run — sampled
        // at both ends and the middle — so no part of the wall pokes, and it
        // only bites when the wall exceeds the roof (a normal wall sits AT the
        // eave, so min(h, cap) leaves it unchanged). Shed rakes its own walls.
        const roofCapForSide = (side) => {
          const pts = side === 'north' ? [[0, 0], [width / 2, 0], [width, 0]]
            : side === 'south' ? [[0, depth], [width / 2, depth], [width, depth]]
            : side === 'west' ? [[0, 0], [0, depth / 2], [0, depth]]
            : [[width, 0], [width, depth / 2], [width, depth]];
          return Math.min(...pts.map(([px, pz]) => roofUnderAt(px, pz)));
        };
        // The cap only applies to a SINGLE-storey design — its whole job is to
        // stop a per-wall height raised above the eave from poking through the
        // roof. With upper storeys, `h` is the full lifted total that
        // pushSideBoxes decomposes into ground + per-storey pieces, and the
        // perimeter roof of a stepped storey reads LOW (outside the plate), so
        // capping there would clamp the total and collapse the ground wall.
        const capped = (side, h) => storeyLift > 0 ? Math.max(1, h) : Math.max(1, Math.min(h, roofCapForSide(side)));
        pushSideBoxes('north', capped('north', hN), tN, (t, h, lift, s0 = 0, s1 = width) => wallRunMeshes({ horizontal: true, thickCenter: t / 2, t, a0: s0, a1: s1, hAt: () => h, mat: wallMatFor('north'), gaps: gapsFor('north'), yBase: sideReveal.north }));
        pushSideBoxes('south', capped('south', hS), tS, (t, h, lift, s0 = 0, s1 = width) => wallRunMeshes({ horizontal: true, thickCenter: depth - t / 2, t, a0: s0, a1: s1, hAt: () => h, mat: wallMatFor('south'), gaps: gapsFor('south'), yBase: sideReveal.south }));
        pushSideBoxes('west', capped('west', hW), tW, (t, h, lift, s0 = 0, s1 = depth) => wallRunMeshes({ horizontal: false, thickCenter: t / 2, t, a0: s0, a1: s1, hAt: () => h, mat: wallMatFor('west'), gaps: gapsFor('west'), yBase: sideReveal.west }));
        pushSideBoxes('east', capped('east', hE), tE, (t, h, lift, s0 = 0, s1 = depth) => wallRunMeshes({ horizontal: false, thickCenter: width - t / 2, t, a0: s0, a1: s1, hAt: () => h, mat: wallMatFor('east'), gaps: gapsFor('east'), yBase: sideReveal.east }));

        // GABLE-END INFILL — a gable roof leaves an open triangle above the
        // eave on its two gable ends (the walls under the slopes stay flat at
        // the eave). Left open, the top half of each end is bare sky — and any
        // structural frame shows its timber poking up through it ("half a
        // building with frames poking out"). Fill each gable end from its wall
        // top up to the roof rake so the shell reads as one enclosed form, the
        // frame carried INSIDE the wall the way it really is.
        //
        // makeRoof always extrudes the gable profile along Z: the ridge runs
        // north↔south at x = width/2 and stands at eave + depth*pitch, so the
        // two vertical triangular ends are ALWAYS the north and south walls
        // (verified against the roof mesh — NOT the longer axis). East/west sit
        // under the slopes at the eave and need no infill. Single-storey rect
        // footprints; a lowered kneewall gets a trapezoid (base at the wall
        // top, sloped top peaking at the ridge over x = width/2).
        if (roofSpec.roofType === 'gable' && storeyLift === 0) {
          const pitchG = Number(spec.shell.roofPitch) || 0.32;
          const eaveG = roofSpec.highWallHeightFt;
          const ridgeH = eaveG + depth * pitchG; // matches makeRoof rise = depth*pitch
          const midX = width / 2; // the ridge crosses each end wall here
          // a solid prism running along X at fixed Z=thickCenter, sloped top
          // h0→h1; double-sided so it reads from inside and out.
          const gablePrism = (thickCenter, tG, x0, x1, yBot, h0, h1, mat) => {
            const geometry = new THREE.BufferGeometry();
            const z0 = thickCenter - tG / 2, z1 = thickCenter + tG / 2;
            geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
              x0, yBot, z0, x0, yBot, z1, x0, h0, z1, x0, h0, z0,
              x1, yBot, z0, x1, yBot, z1, x1, h1, z1, x1, h1, z0
            ]), 3));
            geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2]);
            geometry.computeVertexNormals();
            const m = new THREE.Mesh(geometry, mat);
            m.castShadow = true; m.receiveShadow = true; m.userData.generated = true;
            return m;
          };
          if (ridgeH > eaveG + 0.1) {
            ['north', 'south'].forEach((side) => {
              const rG = wallResolved[side];
              if (rG.omitted || omittedWalls.has(side) || rG.sunGlazing) return;
              const yBot = Math.max(1, Math.min(rG.heightFt, eaveG));
              const tG = rG.thicknessFt;
              const thickCenter = side === 'north' ? tG / 2 : depth - tG / 2;
              const mat = wallMatFor(side).clone();
              mat.side = THREE.DoubleSide;
              wallMeshSpecs.push({ side, storey: 'ground', meshes: [
                gablePrism(thickCenter, tG, 0, midX, yBot, eaveG, ridgeH, mat),
                gablePrism(thickCenter, tG, midX, width, yBot, ridgeH, eaveG, mat)
              ] });
            });
          }
        }
      }
      // ── THE STANDING LAW ────────────────────────────────────────────────
      // No wall may rise past the roof surface above it — whatever
      // combination of wall heights, roof pitch, storeys, splits, or outline
      // produced it. Enforced mesh-by-mesh, VERTEX-by-vertex against the
      // exact roof plane, so every build path obeys (the plain rectangle,
      // a jogged/custom outline's segments, storey bands, everything).
      // Shed and flat roofs have exact planes; a gable's peaked interior is
      // approximate, so gables keep their own eave caps + gable-end infill.
      if (!roundFp) {
        // THE STANDING LAW, now under EVERY roof type (it was shed/flat only
        // — gable and hip walls relied on approximations and could pierce):
        // no wall vertex rises above the roof plan's stop line, ever. The
        // gable-end walls stay at their eave as built; the cap only bites
        // when something exceeds the exact surface.
        const ROOF_SLACK = JOINTS.ROOF_SLACK;
        wallMeshSpecs.forEach(({ meshes }) => (meshes || []).forEach((m) => {
          if (!m?.isMesh || !m.geometry?.getAttribute) return;
          if (m.rotation.x !== 0 || m.rotation.y !== 0 || m.rotation.z !== 0) return; // sloped members already follow their planes
          const posA = m.geometry.getAttribute('position');
          let changed = false;
          for (let i = 0; i < posA.count; i += 1) {
            const wy = posA.getY(i) + m.position.y;
            const cap = roofUnderAt(posA.getX(i) + m.position.x, posA.getZ(i) + m.position.z) + ROOF_SLACK;
            if (wy > cap) { posA.setY(i, cap - m.position.y); changed = true; }
          }
          if (changed) {
            posA.needsUpdate = true;
            m.geometry.computeVertexNormals();
            m.geometry.computeBoundingBox();
            m.geometry.computeBoundingSphere();
          }
        }));
      }
      // Standing SEAM AUDIT — callable any time (console or automated test):
      // window.__nbSeamAudit() returns every seam that violates the JOINTS
      // law: a wall vertex past the roof line, a floor plate off its storey
      // elevation, a non-finite coordinate. Empty list = the build is tight.
      window.__nbSeamAudit = () => {
        const problems = [];
        const judge = !roundFp; // every roof type is judged against the plan now
        group.traverse((m) => {
          if (!m.isMesh || !m.geometry?.getAttribute) return;
          const id = String(m.userData?.roomId || '');
          m.geometry.computeBoundingBox();
          const bb = m.geometry.boundingBox.clone();
          m.updateWorldMatrix(true, false);
          bb.applyMatrix4(m.matrixWorld);
          if (![bb.min.x, bb.max.y, bb.min.z].every(Number.isFinite)) { problems.push({ check: 'finite', id }); return; }
          if (judge && id.startsWith('wall-') && m.rotation.x === 0 && m.rotation.y === 0 && m.rotation.z === 0) {
            const pos = m.geometry.getAttribute('position');
            for (let i = 0; i < pos.count; i += 1) {
              const wy = pos.getY(i) + m.position.y;
              const cap = roofUnderAt(pos.getX(i) + m.position.x, pos.getZ(i) + m.position.z) + JOINTS.ROOF_SLACK + 0.1;
              if (wy > cap) { problems.push({ check: 'wall-over-roof', id, over: Math.round((wy - cap) * 100) / 100 }); break; }
            }
          }
          if (judge && m.userData?.sunGlazingBand && id.startsWith('wall-')) {
            // The greenhouse glass itself — rotated, so the wall vertex law
            // skips it. Same world-corner test as the frame: glazing may
            // never rise through any roof. This check is why an invisible or
            // fin-floating greenhouse can't pass the battery silently again.
            const gg = m.geometry.boundingBox;
            const gCorners = [];
            [gg.min.x, gg.max.x].forEach((cx2) => [gg.min.y, gg.max.y].forEach((cy2) => [gg.min.z, gg.max.z].forEach((cz2) => gCorners.push(new THREE.Vector3(cx2, cy2, cz2)))));
            const gCtr = new THREE.Vector3((gg.min.x + gg.max.x) / 2, (gg.min.y + gg.max.y) / 2, (gg.min.z + gg.max.z) / 2).applyMatrix4(m.matrixWorld);
            for (const c of gCorners) {
              c.applyMatrix4(m.matrixWorld);
              const jx = c.x + Math.sign(gCtr.x - c.x) * Math.min(0.35, Math.abs(gCtr.x - c.x));
              const jz = c.z + Math.sign(gCtr.z - c.z) * Math.min(0.35, Math.abs(gCtr.z - c.z));
              const top = roofTopAtPt(jx, jz);
              if (!Number.isFinite(top)) continue;
              if (c.y > top + JOINTS.ROOF_SLACK + 0.12) {
                problems.push({ check: 'glazing-over-roof', id, over: Math.round((c.y - top) * 100) / 100, at: { x: Math.round(c.x * 100) / 100, y: Math.round(c.y * 100) / 100, z: Math.round(c.z * 100) / 100, roofTop: Math.round(top * 100) / 100 } });
                break;
              }
            }
          }
          if (judge && id === 'frame-main') {
            // FRAME members too (posts, plates, rafters — rotated or not):
            // every corner of the member's true box, in world space, must sit
            // under the roof plan's TOP surface. This is the check that used
            // to not exist — frames pierced roofs and nothing said so.
            const gb = m.geometry.boundingBox;
            const corners = [];
            [gb.min.x, gb.max.x].forEach((cx2) => [gb.min.y, gb.max.y].forEach((cy2) => [gb.min.z, gb.max.z].forEach((cz2) => corners.push(new THREE.Vector3(cx2, cy2, cz2)))));
            const ctr = new THREE.Vector3((gb.min.x + gb.max.x) / 2, (gb.min.y + gb.max.y) / 2, (gb.min.z + gb.max.z) / 2).applyMatrix4(m.matrixWorld);
            for (const c of corners) {
              c.applyMatrix4(m.matrixWorld);
              // judge a hair INSIDE the member — a corner exactly on a roof-
              // piece boundary must not be judged against the lower neighbor.
              // Nudge each plan axis on its own: a diagonal step (the old way)
              // barely moves the SHORT axis of a long member (a 20-ft plate
              // beam moved 0.01 ft sideways), leaving the judge point over the
              // neighbor roof and flagging a beam flush with its own roof edge.
              const dx = ctr.x - c.x; const dz = ctr.z - c.z;
              const jx = c.x + Math.sign(dx) * Math.min(0.35, Math.abs(dx));
              const jz = c.z + Math.sign(dz) * Math.min(0.35, Math.abs(dz));
              const top = roofTopAtPt(jx, jz);
              if (!Number.isFinite(top)) continue; // open sky — nothing to pierce
              if (c.y > top + JOINTS.ROOF_SLACK + 0.12) {
                problems.push({
                  check: 'frame-over-roof', id, name: m.name || 'member', over: Math.round((c.y - top) * 100) / 100,
                  at: { x: Math.round(c.x * 100) / 100, y: Math.round(c.y * 100) / 100, z: Math.round(c.z * 100) / 100, roofTop: Math.round(top * 100) / 100 }
                });
                break;
              }
            }
          }
        });
        (spec.elements || []).forEach((el) => {
          if (el.category === 'floor' && Number(el.level || 1) >= 2) {
            const want = storeyElevationFt(spec.shell, Number(el.level));
            if (Math.abs(Number(el.z || 0) - want) > 0.6) problems.push({ check: 'plate-elevation', id: el.id, at: el.z, want });
          }
        });
        return problems;
      };
      wallMeshSpecs.forEach(({ side, storey, level, meshes, edgeKey }) => {
        if (omittedWalls.has(side) || wallResolved[side].omitted) return;
        if (!layers[`wall${titleCase(side)}`]) return;
        const resolved = storey === 'upper' ? resolveWallSide(spec, side, level || 2) : wallResolved[side];
        (meshes || []).forEach((mesh) => {
          mesh.name = `${titleCase(side)} Wall${storey === 'upper' ? ` (level ${level || 2})` : ''} - ${resolved.assembly.label}`;
          const lvlSuffix = (level === 2 || !level) ? '' : level;
          mesh.userData.roomId = edgeKey
            ? (storey === 'upper' ? `wall-${edgeKey}-u${lvlSuffix}` : `wall-${edgeKey}`)
            : (storey === 'upper' ? `wall-${side}-u${lvlSuffix}` : `wall-${side}`);
          mesh.userData.wallSide = side;
          roomMeshes.push(mesh);
          group.add(addEdges(mesh));
        });
      });

      // Sun glazing: a wall lower than the eave with sunGlazing on gets an
      // ANGLED glass plane from its top up to the eave, with timber battens
      // riding the same angle — the attached-greenhouse face: bale kneewall
      // below, tilted glazing above, all carried by the frame. The tilt leans
      // the top INTO the house so the footprint stays honest. Rect footprints
      // v1 (custom outlines: set the side low and ask — noted in TESTING.md).
      if (!customFp && !roundFp) {
        WALL_SIDES.forEach((side) => {
          const rSg = wallResolved[side];
          if (!rSg.sunGlazing || rSg.omitted || omittedWalls.has(side)) return;
          if (!layers[`wall${titleCase(side)}`]) return;
          const kneeH = rSg.heightFt;
          // STEPPED RULE (same as walls/frame/roof): with a PARTIAL upper
          // storey the perimeter eave is GROUND height — the lift happens
          // only over the plate. The band used the fully-lifted eave and
          // rose 10 ft past the main roof, reading as a tower wall floating
          // above the roof with a gap below.
          const plateSg = upperPlateRect(spec, 2);
          const steppedSg = storeyLift > 0 && plateSg && plateSg.w * plateSg.d < width * depth - 1;
          const liftSg = steppedSg ? 0 : storeyLift;
          const eaveH = roofSpec.roofType === 'shed'
            ? (shedEW
              ? (side === 'east' ? roofSpec.eastWallHeightFt + liftSg : side === 'west' ? roofSpec.westWallHeightFt + liftSg : roofSpec.highWallHeightFt + liftSg)
              : (side === 'south' ? roofSpec.southWallHeightFt + liftSg : side === 'north' ? roofSpec.northWallHeightFt + liftSg : Math.max(roofSpec.northWallHeightFt, roofSpec.southWallHeightFt) + liftSg))
            : roofSpec.highWallHeightFt + liftSg;
          const tiltRad = clamp(Number(rSg.sunGlazingTiltDeg ?? 30), 0, 45) * Math.PI / 180;
          const runLen = (side === 'north' || side === 'south' ? width : depth) - 1;
          const horizNS = side === 'north' || side === 'south';
          // THE ROOF PLAN RULES THE BAND (the same law walls and frame obey):
          // the band is built in BAYS, and each bay climbs only as high as the
          // roof actually stands over ITS stretch of wall. Under a low wing it
          // stops at the wing; where the true eave runs it reaches the eave.
          // Only bays with under 1.5 ft of climb are skipped — the old code
          // culled the WHOLE wall on one number (and rose full-length to one
          // eave height, floating fins through every lower tier roof).
          const alongAt = (t) => runLen * t - runLen / 2;
          // The glass LEANS INTO the house — its top edge sits gap·tan(tilt)
          // inside the wall face, where a falling roof is LOWER than at the
          // eave. Probe the roof at the top edge's true position and shrink
          // the climb until the glass tucks under (converges in a few steps;
          // the old one-eave band poked 1.75 ft through Daniel's shed).
          const roofAtAlong = (along, ins) => {
            const c = (horizNS ? width : depth) / 2 + along;
            const p = side === 'south' ? depth - 0.4 - ins : side === 'north' ? 0.4 + ins : side === 'east' ? width - 0.4 - ins : 0.4 + ins;
            return horizNS ? roofUnderAt(c, p) : roofUnderAt(p, c);
          };
          const bays = Math.max(2, Math.round(runLen / 4));
          const bayLen = runLen / bays;
          const bayTops = [];
          for (let b = 0; b < bays; b += 1) {
            const a0 = alongAt(b / bays);
            const a1 = alongAt((b + 1) / bays);
            let top = Math.min(eaveH, Math.min(roofAtAlong(a0, 0), roofAtAlong(a1, 0)) + JOINTS.ROOF_SLACK);
            for (let it = 0; it < 4; it += 1) {
              const ins = Math.max(0, top - kneeH) * Math.tan(tiltRad);
              top = Math.min(top, Math.min(roofAtAlong(a0, ins), roofAtAlong(a1, ins)) + JOINTS.ROOF_SLACK);
            }
            bayTops.push(top);
          }
          const visible = bayTops.map((t) => t - kneeH >= 1.5);
          if (!visible.some(Boolean)) return; // no headroom anywhere on this wall
          const gapOf = (b) => Math.max(0, bayTops[b] - kneeH);
          const bandGlassMat = new THREE.MeshStandardMaterial({ color: 0xcfe5ea, roughness: 0.1, metalness: 0.05, transparent: true, opacity: 0.36, side: THREE.DoubleSide, envMap: envTex, envMapIntensity: 0.85 });
          const bandPart = (m) => { m.userData.roomId = `wall-${side}`; m.userData.wallSide = side; m.userData.generated = true; m.userData.sunGlazingBand = true; group.add(m); return m; };
          // one slanted box, sized by its own bay's climb (gap)
          const slantedBox = (alongCenter, alongLen, gap, thick, mat) => {
            const slant = gap / Math.cos(tiltRad);
            const ins = gap * Math.tan(tiltRad);
            const yC = kneeH + gap / 2;
            let m;
            if (side === 'south') { m = box(alongLen, slant, thick, width / 2 + alongCenter, yC, depth - ins / 2, mat); m.rotation.x = -tiltRad; }
            else if (side === 'north') { m = box(alongLen, slant, thick, width / 2 + alongCenter, yC, ins / 2, mat); m.rotation.x = tiltRad; }
            else if (side === 'east') { m = box(thick, slant, alongLen, width - ins / 2, yC, depth / 2 + alongCenter, mat); m.rotation.z = tiltRad; }
            else { m = box(thick, slant, alongLen, ins / 2, yC, depth / 2 + alongCenter, mat); m.rotation.z = -tiltRad; }
            return m;
          };
          for (let b = 0; b < bays; b += 1) {
            if (!visible[b]) continue;
            const pane = bandPart(slantedBox(alongAt((b + 0.5) / bays), bayLen - 0.06, gapOf(b), 0.14, bandGlassMat));
            roomMeshes.push(pane);
          }
          // thin glazing stops at the bay lines, riding the shorter neighbour
          for (let i = 0; i <= bays; i += 1) {
            const near = [i - 1, i].filter((bb) => bb >= 0 && bb < bays && visible[bb]);
            if (!near.length) continue;
            bandPart(slantedBox(alongAt(i / bays), 0.3, Math.min(...near.map(gapOf)), 0.24, frameMat));
          }
          // HEAVY greenhouse framing — with a structural frame chosen, the
          // slanted glazing is CARRIED, not floating: principal slanted posts
          // at each bay line (riding the same tilt as the glass), a sill beam
          // on top of the kneewall, and a header beam where each bay's slant
          // meets ITS roof. These members join the frame-main skeleton
          // (Frame layer, selectable) and obey the roof plan like the glass.
          // The glazing ALWAYS needs its timber — even on a load-bearing
          // bale/cob house, the sun face is a framed opening (the classic
          // combo). Only the Frame layer toggle hides it.
          if (layers.frame !== false) {
            const sgFrame = (m) => { m.userData.roomId = 'frame-main'; m.userData.generated = true; m.userData.sunGlazingBand = true; roomMeshes.push(m); group.add(addEdges(m)); return m; };
            const beamRun = (yC, outPos, alongCenter, alongLen) => sgFrame(horizNS
              ? box(alongLen, 0.45, 0.5, width / 2 + alongCenter, yC, outPos, frameMat)
              : box(0.5, 0.45, alongLen, outPos, yC, depth / 2 + alongCenter, frameMat));
            const faceOut = side === 'south' ? depth - 0.3 : side === 'north' ? 0.3 : side === 'east' ? width - 0.3 : 0.3;
            // sill beam per contiguous visible run of bays
            let runStart = null;
            for (let b = 0; b <= bays; b += 1) {
              const vis = b < bays && visible[b];
              if (vis && runStart === null) runStart = b;
              if (!vis && runStart !== null) {
                beamRun(kneeH + 0.1, faceOut, alongAt(((runStart + b) / 2) / bays), (b - runStart) * bayLen + 0.5);
                runStart = null;
              }
            }
            // header beam per bay — each meets its own roof line
            for (let b = 0; b < bays; b += 1) {
              if (!visible[b]) continue;
              const ins = gapOf(b) * Math.tan(tiltRad);
              const headOut = side === 'south' ? depth - ins + 0.15 : side === 'north' ? ins - 0.15 : side === 'east' ? width - ins + 0.15 : ins - 0.15;
              beamRun(kneeH + gapOf(b) - 0.2, headOut, alongAt((b + 0.5) / bays), bayLen + 0.1);
            }
            // slanted principal posts at the bay lines
            for (let i = 0; i <= bays; i += 1) {
              const near = [i - 1, i].filter((bb) => bb >= 0 && bb < bays && visible[bb]);
              if (!near.length) continue;
              sgFrame(slantedBox(alongAt(i / bays), 0.5, Math.min(...near.map(gapOf)), 0.45, frameMat));
            }
          }
        });
      }

      // The structural FRAME is a REAL skeleton now — the same members the
      // frame drawings (F-sheets) document, so what you raise is what prints:
      // BENTS across the span (posts + tie beam + knee braces), plate beams
      // running the two bearing walls, rafters at o.c. following the roof,
      // and loft joists on the ties when there's an upper storey. Stud frames
      // draw their studs at o.c. instead of bents. Every member carries
      // roomId 'frame-main' (one selectable object; the Frame layer preset is
      // the raising view). Load-bearing walls have no separate frame; custom
      // outlines come later (v1 rect).
      const frameKey3d = resolveFrameType(spec, 1);
      if (layers.frame !== false && !customFp && !roundFp && frameKey3d !== 'load-bearing') {
        const fm = FRAME_MEMBERS[frameKey3d] || FRAME_MEMBERS['post-beam'];
        const framePart = (m) => {
          m.userData.roomId = 'frame-main';
          m.userData.generated = true;
          roomMeshes.push(m);
          group.add(addEdges(m));
          return m;
        };
        // A member along a slope: axisIsZ says which plan axis it follows —
        // the run goes from (a0,y0) to (a1,y1) in that axis at cross-position
        // `at`. spanIsZ: bents span the SLOPE. A north/south-falling shed (and
        // flat) spans north-south (z); an east/west-falling shed spans
        // east-west (x); gable east-west (x).
        const spanIsZ = (roofSpec.roofType === 'shed' && !shedEW) || roofSpec.roofType === 'flat';
        const slopeMemberAxis = (axisIsZ, a0, y0, a1, y1, at, thickAcross, thickDeep) => {
          const len = Math.hypot(a1 - a0, y1 - y0);
          const ang = Math.atan2(y1 - y0, a1 - a0);
          const m = axisIsZ
            ? box(thickAcross, thickDeep, len, at, (y0 + y1) / 2, (a0 + a1) / 2, frameMat)
            : box(len, thickDeep, thickAcross, (a0 + a1) / 2, (y0 + y1) / 2, at, frameMat);
          if (axisIsZ) m.rotation.x = -ang; else m.rotation.z = ang;
          return framePart(m);
        };
        const slopeMember = (a0, y0, a1, y1, at, w, h) => slopeMemberAxis(spanIsZ, a0, y0, a1, y1, at, w, h);
        // A level member along the BAY direction (b0..b1) at span-position
        // `at` — plate beams and joists. This once had its axes swapped, so on
        // a non-square plan the plates and loft joists rendered OUTSIDE the
        // house (a beam floating 11 ft east of a 24×36 shed).
        const straight = (b0, b1, y, at, w, h) => framePart(spanIsZ
          ? box(b1 - b0, h, w, (b0 + b1) / 2, y, at, frameMat)
          : box(w, h, b1 - b0, at, y, (b0 + b1) / 2, frameMat));
        const postAt = (a, at, h, pw, yBase = 0) => framePart(spanIsZ
          ? box(pw, h, pw, at, yBase + h / 2, a, frameMat)
          : box(pw, h, pw, a, yBase + h / 2, at, frameMat));

        const span = spanIsZ ? depth : width;
        const bayRun = spanIsZ ? width : depth;
        // Span-end wall thicknesses (posts stand just inside them).
        const tLead = spanIsZ ? tN : tW;
        const tTail = spanIsZ ? tS : tE;
        const aLead = tLead + fm.postW / 2 + 0.08;
        const aTail = span - tTail - fm.postW / 2 - 0.08;
        const oAllF = resolveOverhangs(spec.shell);
        const oLead = spanIsZ ? oAllF.north : oAllF.west;
        const oTail = spanIsZ ? oAllF.south : oAllF.east;
        const baseWallFt = Number(spec.shell.wallHeightFt || 10);
        const pitchF = Number(spec.shell.roofPitch || 0.32);
        // THE FRAME STANDS WHERE THE BUILDING STANDS. When the upper storey
        // covers only its extent plate, the perimeter walls are GROUND height
        // and the lift happens over the plate alone — posts, joists, and
        // rafters up there, low wing rafters over the remainder. (Mirrors the
        // stepped-roof logic below; a full-footprint storey lifts everything.)
        const plateF = upperPlateRect(spec, 2);
        // Stepped when ANY storey stands on a smaller extent — a full floor 2
        // with a set-back floor 3 steps just the same (the old check only saw
        // floor 2, so floor 3's frame towered over the whole footprint).
        const stepsF = storeyLift > 0 && (() => {
          for (let lv = 2; lv <= Math.ceil(storeys); lv += 1) {
            const pp = upperPlateRect(spec, lv);
            if (pp && pp.w * pp.d < width * depth - 1) return true;
          }
          return false;
        })();
        const liftPerim = stepsF ? 0 : storeyLift;
        // Posts stand INSIDE the wall line — on a shed the roof plane there is
        // already below the wall-line top (slope × the inset), so a post/plate
        // raised to the WALL height rode over the roof plan (the frame-over-
        // roof audit hit on every saved shed). The bearing height is the EAVE
        // LINE at the post's own span position — same law the roof plane and
        // walls follow.
        const eaveAtSpanPos = (spanPos) => (roofSpec.roofType === 'shed'
          ? (shedEW ? shedEaveAt(spanPos, 0) : shedEaveAt(0, spanPos))
          : roofSpec.highWallHeightFt);
        const hLead = eaveAtSpanPos(aLead) + liftPerim;
        const hTail = eaveAtSpanPos(aTail) + liftPerim;
        const gRise = roofSpec.roofType === 'gable' ? depth * pitchF : 0;
        const hasBents = !fm.studs && fm.postW > 0;
        const bay = hasBents
          ? clamp(Number(spec.frame?.baySpacingFt) || fm.spacingFt || 8, 4, 16)
          : Math.max(1, fm.spacingFt || 16 / 12);
        const bays = Math.max(1, hasBents ? Math.ceil(bayRun / bay) : Math.round(bayRun / bay));
        const stations = [];
        for (let i = 0; i <= bays; i += 1) stations.push(clamp((bayRun * i) / bays, fm.postW, bayRun - fm.postW));

        // Posts (bents) or studs at each station along BOTH bearing walls.
        const postH = (h) => Math.max(1, h - fm.plateH);
        stations.forEach((at) => {
          postAt(aLead, at, postH(hLead), fm.postW);
          postAt(aTail, at, postH(hTail), fm.postW);
        });
        // Plate beams along the two bearing walls (full bay run).
        straight(fm.postW / 2, bayRun - fm.postW / 2, postH(hLead) + fm.plateH / 2, aLead, fm.postW + 0.1, fm.plateH);
        straight(fm.postW / 2, bayRun - fm.postW / 2, postH(hTail) + fm.plateH / 2, aTail, fm.postW + 0.1, fm.plateH);

        // Tie / crossbeam per bent + knee braces — timber types. With a
        // PARTIAL upper storey there is no full-span tie at loft height (it
        // would slice through the low wing roofs); the loft structure lives
        // over the plate instead (below).
        const tieH = storeyLift > 0 && !stepsF ? baseWallFt : (roofSpec.roofType !== 'shed' && hasBents ? Math.min(hLead, hTail) - fm.plateH : 0);
        if (hasBents && tieH > 2) {
          stations.forEach((at) => {
            framePart(spanIsZ
              ? box(fm.postW, fm.crossH, aTail - aLead - fm.postW, at, tieH - fm.crossH / 2, (aLead + aTail) / 2, frameMat)
              : box(aTail - aLead - fm.postW, fm.crossH, fm.postW, (aLead + aTail) / 2, tieH - fm.crossH / 2, at, frameMat));
            if (fm.braceW > 0) {
              const rise = Math.min(3, tieH - 1.5);
              slopeMember(aLead + fm.postW / 2, tieH - fm.crossH - rise, aLead + rise + fm.postW / 2, tieH - fm.crossH, at, fm.braceW, fm.braceW);
              slopeMember(aTail - rise - fm.postW / 2, tieH - fm.crossH, aTail - fm.postW / 2, tieH - fm.crossH - rise, at, fm.braceW, fm.braceW);
            }
          });
          if (storeyLift > 0 && !stepsF) {
            // loft joists ride the ties, running the bay direction
            const jCount = Math.max(2, Math.floor((aTail - aLead) / 4));
            for (let j = 1; j < jCount; j += 1) {
              const at = aLead + ((aTail - aLead) * j) / jCount;
              straight(fm.postW / 2, bayRun - fm.postW / 2, tieH + 0.28, at, 0.34, 0.55);
            }
          }
        }

        // Rafters ride the same planes the roof draws. rafterRun lays members
        // along axisIsZ from s0..s1 following planeAt(spanPos), at stations
        // across b0..b1.
        const rOC = Math.max(1, fm.rafterOCFt || 2);
        // Rafters carry the deck from BELOW it: top of rafter at the roof
        // plane minus the slab thickness. Riding the plane itself left half
        // of every member poking through the roof surface.
        const DECK = JOINTS.RAFTER_DROP;
        // ═══ THE FRAME IS BUILT FROM THE ROOF PLAN ═══ Every rafter SAMPLES
        // the plan's exact top surface along its own line and follows it,
        // splitting at creases (a gable ridge, a hip's jack region) with the
        // crease position solved exactly. A member that is generated ON the
        // surface cannot pierce it — the old parallel frame math (its own
        // gable rise, its own shed plane) is gone, and with it the whole
        // "frame pokes through the roof" family.
        const sampledRafter = (axisIsZ, at, s0, s1) => {
          const yAt = (s) => (axisIsZ ? roofTopAtPt(at, s) : roofTopAtPt(s, at)) - DECK - fm.rafterH / 2;
          // A member's CHORD must lie on/under the surface along its whole
          // run — where two roof pieces meet in a valley, subdividing turns
          // one floating bridge into true jack pieces that follow the roof.
          const emit = (a, b, depthLeft = 6) => {
            if (b - a < 0.2) return;
            const ya = yAt(a); const yb = yAt(b);
            if (!Number.isFinite(ya) || !Number.isFinite(yb)) return; // open sky (porch)
            let bulges = false;
            for (const f of [0.2, 0.4, 0.5, 0.6, 0.8]) {
              const sMid = a + (b - a) * f;
              const chordY = ya + (yb - ya) * f;
              const surfY = yAt(sMid);
              if (Number.isFinite(surfY) && chordY > surfY + 0.12) { bulges = true; break; }
            }
            if (bulges) {
              if (depthLeft > 0 && b - a > 0.45) {
                const mid = a + (b - a) / 2;
                emit(a, mid, depthLeft - 1);
                emit(mid, b, depthLeft - 1);
              }
              return; // NEVER emit a member that rides over its roof
            }
            slopeMemberAxis(axisIsZ, a, ya, b, yb, at, fm.rafterW, fm.rafterH);
          };
          const STEP = 0.5; // fine enough that a tier step can't masquerade as a slope
          // A surface JUMP (roof steps to another tier, or drops to open sky)
          // is NOT a crease — a rafter must END at the step, never climb it.
          const findJump = (lo0, hi0, yLo) => {
            let lo = lo0; let hi = hi0;
            for (let k = 0; k < 14 && hi - lo > 0.05; k += 1) {
              const mid = (lo + hi) / 2;
              const ym = yAt(mid);
              if (Number.isFinite(ym) && Math.abs(ym - yLo) < 2) lo = mid; else hi = mid;
            }
            return lo;
          };
          let runStart = s0;
          let prevS = s0; let prevY = yAt(s0); let slope = null;
          for (let s = s0 + STEP; s <= s1 + 1e-6; s += STEP) {
            const ss = Math.min(s, s1);
            const y = yAt(ss);
            const m = (y - prevY) / Math.max(0.001, ss - prevS);
            // steeper than any legal pitch (1.5 rise/run) = a tier step, not a slope
            const jump = !Number.isFinite(y) || !Number.isFinite(prevY) || Math.abs(y - prevY) > (ss - prevS) * 1.8 + 0.25;
            if (jump) {
              const edge = Number.isFinite(prevY) ? findJump(prevS, ss, prevY) : prevS;
              emit(runStart, edge);
              runStart = ss; slope = null;
            } else if (slope === null) slope = m;
            else if (Math.abs(m - slope) > 0.02 && Number.isFinite(m) && Number.isFinite(slope)) {
              // crease between prevS and ss — intersect the two runs so the
              // ridge/hip line lands crisp, not chamfered between samples
              const t = Math.abs(slope - m) > 1e-6
                ? clamp((y - m * ss - prevY + slope * prevS) / (slope - m), prevS, ss)
                : prevS;
              emit(runStart, t);
              runStart = t;
              slope = (y - yAt(t)) / Math.max(0.001, ss - t);
            }
            prevS = ss; prevY = y;
          }
          emit(runStart, s1);
        };
        const rafterRun = (b0, b1, _planeAt, axisIsZ, s0, s1) => {
          const count = Math.max(1, Math.round((b1 - b0) / rOC));
          for (let i = 0; i <= count; i += 1) {
            const at = clamp(b0 + ((b1 - b0) * i) / count, b0 + fm.rafterW, b1 - fm.rafterW);
            sampledRafter(axisIsZ, at, s0, s1);
          }
        };
        // Gable rafter pairs are just sampled rafters across the ridge now.
        const gableRafters = (x0, x1, z0, z1) => {
          const alongX = (x1 - x0) >= (z1 - z0);
          if (alongX) rafterRun(x0, x1, null, true, z0, z1);
          else rafterRun(z0, z1, null, false, x0, x1);
        };

        if (!stepsF) {
          // one call covers gable pairs, hip ends, shed slopes — all sampled
          rafterRun(0, bayRun, null, spanIsZ, -oLead, span + oTail);
        } else {
          // STEPPED, TIER BY TIER: every set-back storey gets its own deck
          // (rim + joists at its floor), posts and plate beams rising to ITS
          // tier top, and roof rafters over each tier's EXPOSED ring — three
          // set-back floors make three frame steps, mirroring the stepped
          // roof and the tier-aware walls. (The old code knew only floor 2:
          // its posts ran to the FULL lifted eave over the whole plate, a
          // phantom roof plane over the 2nd storey.)
          const frameTiers = [{ lv: 1, p: { x: 0, y: 0, w: width, d: depth } }];
          for (let lv = 2; lv <= Math.ceil(storeys); lv += 1) {
            if (heightAt(lv) <= 0) continue;
            frameTiers.push({ lv, p: upperPlateRect(spec, lv) || { x: 0, y: 0, w: width, d: depth } });
          }
          const eaveLiftAt = (spanPos, lift) => {
            if (roofSpec.roofType === 'shed') {
              // through the wall tops at the wall lines — same law as the
              // roof planes, so posts meet the plate exactly at every span.
              // spanPos runs along the fall axis (z for a north/south fall,
              // x for an east/west one).
              return (shedEW ? shedEaveAt(spanPos, 0) : shedEaveAt(0, spanPos)) + lift;
            }
            return roofSpec.highWallHeightFt + lift;
          };
          // Set-back designs: each tier's frame tops out at the ENGINE's
          // global elevations (matching the walls and roof tiers), the shed
          // slope restarting at the tier's own north edge. Whole-footprint
          // designs keep the classic stacked plane.
          const tierTopPlane = (spanPos, lv, p) => {
            const lift = lv === 1 ? 0 : upThru(lv);
            if (!anySetback || lv === 1) return eaveLiftAt(spanPos, lift);
            if (roofSpec.roofType === 'shed') {
              const slope = tierPitchOf(lv) ?? shedSlopePerFt;
              return elev2 + lift + slope * Math.max(0, spanPos - (shedEW ? p.x : p.y));
            }
            return elev2 + lift;
          };
          frameTiers.forEach((tier, ti) => {
            const { lv, p } = tier;
            const above = frameTiers[ti + 1] ? frameTiers[ti + 1].p : null;
            const tierLift = lv === 1 ? 0 : upThru(lv);
            if (lv >= 2) {
              const plateElT = (spec.elements || []).find((el) => el.category === 'floor' && Number(el.level || 1) === lv);
              const porchTier = plateElT?.topTreatment === 'porch';
              const floorY = (anySetback ? elev2 : baseWallFt) + upAbove(lv);
              const pS0 = (spanIsZ ? p.y : p.x) + fm.postW / 2;
              const pS1 = (spanIsZ ? p.y + p.d : p.x + p.w) - fm.postW / 2;
              const pB0 = (spanIsZ ? p.x : p.y) + fm.postW / 2;
              const pB1 = (spanIsZ ? p.x + p.w : p.y + p.d) - fm.postW / 2;
              // deck rim + joists at this storey's floor, over its plate only
              straight(pB0, pB1, floorY + 0.28, pS0, 0.34, 0.55);
              straight(pB0, pB1, floorY + 0.28, pS1, 0.34, 0.55);
              const jCount = Math.max(2, Math.floor((pS1 - pS0) / 4));
              for (let j = 1; j < jCount; j += 1) {
                straight(pB0, pB1, floorY + 0.28, pS0 + ((pS1 - pS0) * j) / jCount, 0.34, 0.55);
              }
              // posts + plate beams to THIS tier's own top — around the part
              // of the plate that carries STRUCTURE. On a PORCH tier the ring
              // is an open deck (the roof plan says open sky there): posts at
              // the plate edge rose to a tier top no roof ever reaches — the
              // audit's "frame 4 ft over the roof" fliers on saved designs.
              // The bearing ring for a porch tier is the ENCLOSED CORE, the
              // rectangle the storey above actually stands on.
              const core = porchTier && above ? (() => {
                const cx0 = Math.max(p.x, above.x); const cx1 = Math.min(p.x + p.w, above.x + above.w);
                const cy0 = Math.max(p.y, above.y); const cy1 = Math.min(p.y + p.d, above.y + above.d);
                return (cx1 - cx0 > fm.postW * 2 && cy1 - cy0 > fm.postW * 2) ? { x: cx0, y: cy0, w: cx1 - cx0, d: cy1 - cy0 } : null;
              })() : (porchTier ? null : p);
              if (core) {
                const rS0 = (spanIsZ ? core.y : core.x) + fm.postW / 2;
                const rS1 = (spanIsZ ? core.y + core.d : core.x + core.w) - fm.postW / 2;
                const rB0 = (spanIsZ ? core.x : core.y) + fm.postW / 2;
                const rB1 = (spanIsZ ? core.x + core.w : core.y + core.d) - fm.postW / 2;
                // A porch tier bears a FLAT deck — the plan's porch ring rides
                // topEave (elev2 + upThru) + DECK_LIFT, so the posts rise to
                // that line and the plate beam kisses the deck slab. The
                // sloped tierTopPlane is the ROOFED-tier law; following it
                // here left the posts 1.6-4 ft short of the deck they carry.
                const bearAt = porchTier ? () => elev2 + upThru(lv) : (sp) => tierTopPlane(sp, lv, p);
                const upBays = Math.max(1, Math.ceil((rB1 - rB0) / bay));
                for (let i = 0; i <= upBays; i += 1) {
                  const at = rB0 + ((rB1 - rB0) * i) / upBays;
                  postAt(rS0, at, Math.max(1, bearAt(rS0) - fm.plateH - floorY), fm.postW, floorY);
                  postAt(rS1, at, Math.max(1, bearAt(rS1) - fm.plateH - floorY), fm.postW, floorY);
                }
                straight(rB0, rB1, bearAt(rS0) - fm.plateH / 2, rS0, fm.postW + 0.1, fm.plateH);
                straight(rB0, rB1, bearAt(rS1) - fm.plateH / 2, rS1, fm.postW + 0.1, fm.plateH);
              }
            }
            if (!above) {
              // top tier: the full roof rides over its plate
              if (roofSpec.roofType === 'shed' || roofSpec.roofType === 'flat') {
                const b0 = spanIsZ ? p.x : p.y; const b1 = spanIsZ ? p.x + p.w : p.y + p.d;
                const s0 = (spanIsZ ? p.y : p.x) - 0.35; const s1 = (spanIsZ ? p.y + p.d : p.x + p.w) + 0.35;
                rafterRun(b0, b1, (zz) => tierTopPlane(zz, lv, p) + 0.12, spanIsZ, s0, s1);
              } else {
                gableRafters(p.x, p.x + p.w, p.y, p.y + p.d, (anySetback && lv > 1 ? elev2 : roofSpec.highWallHeightFt) + tierLift);
              }
              return;
            }
            // lower tier: rafter the ring its storey exposes, at ITS tier top
            // — unless that storey's setback is an OPEN PORCH (deck, no roof)
            if (lv >= 2) {
              const plateElF = (spec.elements || []).find((el) => el.category === 'floor' && Number(el.level || 1) === lv);
              if (plateElF && plateElF.topTreatment === 'porch') return;
            }
            const inAbove = (px, py) => px > above.x + 0.01 && px < above.x + above.w - 0.01 && py > above.y + 0.01 && py < above.y + above.d - 0.01;
            const insideBelow = (px, py) => px > p.x + 0.01 && px < p.x + p.w - 0.01 && py > p.y + 0.01 && py < p.y + p.d - 0.01;
            subtractRect(p, above).forEach((rect) => {
              const overlapX = rect.x < above.x + above.w && rect.x + rect.w > above.x;
              const overlapY = rect.y < above.y + above.d && rect.y + rect.d > above.y;
              const touch = Math.abs(rect.y + rect.d - above.y) < 0.05 && overlapX ? 'south'
                : Math.abs(rect.y - (above.y + above.d)) < 0.05 && overlapX ? 'north'
                : Math.abs(rect.x + rect.w - above.x) < 0.05 && overlapY ? 'east'
                : Math.abs(rect.x - (above.x + above.w)) < 0.05 && overlapY ? 'west'
                : (Math.abs((rect.x + rect.w / 2) - (above.x + above.w / 2)) > Math.abs((rect.y + rect.d / 2) - (above.y + above.d / 2))
                  ? ((rect.x + rect.w / 2) < (above.x + above.w / 2) ? 'east' : 'west')
                  : ((rect.y + rect.d / 2) < (above.y + above.d / 2) ? 'south' : 'north'));
              const probe = 0.4;
              const oSide = {};
              for (const side of ['north', 'south', 'east', 'west']) {
                const [px, py] = side === 'north' ? [rect.x + rect.w / 2, rect.y - probe]
                  : side === 'south' ? [rect.x + rect.w / 2, rect.y + rect.d + probe]
                  : side === 'west' ? [rect.x - probe, rect.y + rect.d / 2]
                  : [rect.x + rect.w + probe, rect.y + rect.d / 2];
                if (inAbove(px, py)) oSide[side] = 0.35;
                else if (insideBelow(px, py)) oSide[side] = 0.05;
                else oSide[side] = oAllF[side];
              }
              const x0 = rect.x - oSide.west; const x1 = rect.x + rect.w + oSide.east;
              const z0 = rect.y - oSide.north; const z1 = rect.y + rect.d + oSide.south;
              if (roofSpec.roofType === 'shed' || roofSpec.roofType === 'flat') {
                // wings ride this tier's shed plane — same as the roof tiers;
                // members run along the fall axis
                const tierPlane = (ss) => tierTopPlane(ss, lv, p) + 0.12;
                if (spanIsZ) rafterRun(rect.x, rect.x + rect.w, tierPlane, true, z0, z1);
                else rafterRun(rect.y, rect.y + rect.d, tierPlane, false, x0, x1);
                return;
              }
              const topY = (anySetback && lv > 1 ? elev2 : roofSpec.highWallHeightFt) + tierLift + 0.25;
              if (touch === 'north' || touch === 'south') {
                const drop = Math.max(0.1, (z1 - z0) * pitchF);
                const planeAt = (zz) => (touch === 'north'
                  ? topY - ((zz - z0) / Math.max(0.01, z1 - z0)) * drop
                  : topY - ((z1 - zz) / Math.max(0.01, z1 - z0)) * drop);
                rafterRun(rect.x, rect.x + rect.w, planeAt, true, z0, z1);
              } else {
                const drop = Math.max(0.1, (x1 - x0) * pitchF);
                const planeAt = (xx) => (touch === 'west'
                  ? topY - ((xx - x0) / Math.max(0.01, x1 - x0)) * drop
                  : topY - ((x1 - xx) / Math.max(0.01, x1 - x0)) * drop);
                rafterRun(rect.y, rect.y + rect.d, planeAt, false, x0, x1);
              }
            });
          });
        }
      }

      // ── THE STANDING LAW, FOR THE FRAME TOO ──────────────────────────────
      // Upright members (posts, plates, ties, joists, studs, deck rims) obey
      // the same vertex-cap the walls do: no vertex rises past the roof plan.
      // Rafters and braces are BUILT from the plan (sampled/sloped) and keep
      // their rotation; everything axis-aligned gets clamped here, so a spec
      // whose stored fields disagree with today's storey semantics (old saved
      // designs carrying pre-update-101 heights) still renders tight.
      if (!roundFp) {
        roomMeshes.forEach((m) => {
          if (String(m.userData?.roomId || '') !== 'frame-main') return;
          if (!m?.isMesh || !m.geometry?.getAttribute) return;
          if (m.rotation.x !== 0 || m.rotation.y !== 0 || m.rotation.z !== 0) return;
          const posF = m.geometry.getAttribute('position');
          let changedF = false;
          for (let i = 0; i < posF.count; i += 1) {
            const wy = posF.getY(i) + m.position.y;
            const capF = roofUnderAt(posF.getX(i) + m.position.x, posF.getZ(i) + m.position.z) + JOINTS.ROOF_SLACK;
            if (wy > capF) { posF.setY(i, capF - m.position.y); changedF = true; }
          }
          if (changedF) {
            posF.needsUpdate = true;
            m.geometry.computeVertexNormals();
            m.geometry.computeBoundingBox();
            m.geometry.computeBoundingSphere();
          }
        });
      }

      // (The old floating assembly-summary chip is gone — that information
      // lives in the selection chip and the Walls page; it was pure clutter.)

      // Stem wall foundation: a visible plinth ring under the walls — also
      // drawn for a rubble trench, whose stem lifts the walls the same way.
      // (layers.foundation gates all three foundation renders — the Time
      // Machine reveals them at the foundation phase; default is visible.)
      if (layers.foundation !== false && wholeHouseStem) {
        const stemH = Math.min(6, Math.max(0.5, Number(utilitiesOf(spec).stemwallHeightFt) || 1.5));
        const stemMat = new THREE.MeshStandardMaterial({ color: 0xaaa79b, roughness: 0.95, map: grainTexture('concrete'), bumpMap: bumpTexture('concrete'), bumpScale: 0.15 });
        // The stem sits DIRECTLY under the wall above — same footprint, dead
        // flush (the old 3″ proud lip read as the stem standing outside the
        // bales; real bale walls bear on a stem of their own width).
        const ring = customFp
          // Custom footprint: the plinth follows every polygon edge.
          ? fpEdges.map((edge) => {
            const t = wallResolved[edge.facing].thicknessFt;
            const cx = (edge.x0 + edge.x1) / 2 - edge.nx * (t / 2);
            const cy = (edge.y0 + edge.y1) / 2 - edge.ny * (t / 2);
            return edge.horizontal
              ? box(edge.lengthFt, stemH, t, cx, stemH / 2, cy, stemMat)
              : box(t, stemH, edge.lengthFt, cx, stemH / 2, cy, stemMat);
          })
          : [
            box(width, stemH, tN, width / 2, stemH / 2, tN / 2, stemMat),
            box(width, stemH, tS, width / 2, stemH / 2, depth - tS / 2, stemMat),
            box(tW, stemH, depth, tW / 2, stemH / 2, depth / 2, stemMat),
            box(tE, stemH, depth, width - tE / 2, stemH / 2, depth / 2, stemMat)
          ];
        ring.forEach((segment) => { segment.name = 'Stem wall foundation'; group.add(addEdges(segment)); });
      }

      // Topography: when the site slopes, the foundation steps DOWN to meet
      // grade around the perimeter — taller (a walkout basement) on the
      // downhill side, the exact condition the elevations/sections show. Each
      // footprint edge gets a concrete face from the sill (y≈0) to the grade
      // line at its two ends, so the bottom follows the falling ground.
      const slopeNow = Math.max(0, Number(siteOf(spec).slopeFt) || 0);
      if (layers.foundation !== false && slopeNow > 0) {
        const foundMat = new THREE.MeshStandardMaterial({ color: 0x9c988c, roughness: 0.96, map: grainTexture('concrete'), side: THREE.DoubleSide });
        footprintEdges(spec).forEach((edge) => {
          const gA = gradeElevationAt(spec, edge.x0, edge.y0);
          const gB = gradeElevationAt(spec, edge.x1, edge.y1);
          if (gA > -0.12 && gB > -0.12) return; // flush with the floor — nothing to show
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
            edge.x0, 0.05, edge.y0, edge.x1, 0.05, edge.y1, edge.x1, gB, edge.y1,
            edge.x0, 0.05, edge.y0, edge.x1, gB, edge.y1, edge.x0, gA, edge.y0
          ]), 3));
          geo.computeVertexNormals();
          const face = new THREE.Mesh(geo, foundMat);
          face.name = 'Foundation to grade';
          face.userData.generated = true;
          face.castShadow = true;
          face.receiveShadow = true;
          group.add(face);
        });
      }

      // Basement: a real below-grade storey. Concrete perimeter walls with a
      // small stem reveal above grade, and a slab at the bottom. On a sloped
      // site the terrain falls below 0 downhill, exposing the wall — that IS
      // the walkout. Bounding-rect walls (same honest simplification as the
      // Blender/permit exports on custom footprints).
      if (layers.foundation !== false && basementH > 0) {
        const bMat = new THREE.MeshStandardMaterial({ color: 0xa8a49a, roughness: 0.95, map: grainTexture('concrete') });
        const bT = 0.8;
        const reveal = 0.55;
        const bWallH = basementH + reveal;
        [
          [width + bT * 2, bT, width / 2, -bT / 2],
          [width + bT * 2, bT, width / 2, depth + bT / 2],
          [bT, depth, -bT / 2, depth / 2],
          [bT, depth, width + bT / 2, depth / 2]
        ].forEach(([w, d, cx, cz], i) => {
          const wallB = box(w, bWallH, d, cx, -basementH + bWallH / 2, cz, bMat);
          wallB.name = `Basement wall ${['north', 'south', 'west', 'east'][i]}`;
          wallB.userData.generated = true;
          group.add(wallB);
        });
        const slabB = box(width, 0.4, depth, width / 2, -basementH - 0.2 + 0.2, depth / 2, bMat);
        slabB.name = 'Basement slab';
        slabB.userData.generated = true;
        group.add(slabB);
      }

      // Upper floor plate: only auto-drawn when the storey has no extent-plate
      // element (which renders — and drags — through the elements pass).
      if (storeys > 1 && layers.upperFloors && !upperPlateRect(spec, 2)) {
        const plateMat = new THREE.MeshStandardMaterial({ color: 0xb3a284, roughness: 0.85, transparent: true, opacity: 0.92 });
        // A stair below the plate punches a real stairwell void through it.
        const stairCuts = (spec.elements || []).filter((el) => /stair/i.test(el.name || '') && !/ladder/i.test(el.name || '') && Number(el.level || 1) === 1);
        let plateRects = [{ x: tW, y: tN, w: Math.max(1, width - tE - tW), d: Math.max(1, depth - tN - tS) }];
        stairCuts.forEach((cut) => {
          const cutRect = { x: cut.x - 0.2, y: cut.y - 0.2, w: cut.w + 0.4, d: cut.d + 0.4 };
          plateRects = plateRects.flatMap((r) => subtractRect(r, cutRect));
        });
        plateRects.forEach((r) => {
          const plate = box(r.w, 0.4, r.d, r.x + r.w / 2, baseStoreyFt + 0.2, r.y + r.d / 2, plateMat);
          plate.name = `Upper floor plate (level 2, ${storeys === 1.5 ? 'loft' : 'full storey'})`;
          group.add(plate);
        });
      }

      if (layers.rooms) spec.rooms.forEach((room) => {
        const roomLevel = Number(room.level || 1);
        const roomLift = roomLevel === BASEMENT_LEVEL
          ? -basementH + 0.12
          : (Math.max(1, roomLevel) - 1) * baseStoreyFt + (roomLevel > 1 ? 0.42 : maxReveal);
        const material = new THREE.MeshStandardMaterial({
          color: floorTint || zonePalette[room.type] || 0x86a0a8,
          transparent: true,
          opacity: room.id === selectedRoom ? 0.88 : 0.58,
          roughness: 0.7
        });
        // Upper-storey zone slabs inset so their colored edge doesn't peek
        // through the seam where the wall bands seat (ground slabs sit well
        // inside the thicker ground walls already).
        const slabInset = roomLevel > 1 ? Math.min(0.4, room.w / 4, room.d / 4) : 0;
        // Round house: the curved wall CLIPS the room — a room slid into the
        // "corner" renders as the rect-∩-ellipse shape, meeting the ring wall
        // instead of poking through it. Falls back to the plain box whenever
        // the clip isn't needed (not round, outdoor space, no overlap).
        let mesh = null;
        const roundClip = isRoundFootprint(spec)
          && !['outdoor', 'site', 'garden', 'animal', 'paddock', 'run', 'landscape', 'homestead', 'plant', 'water', 'earthwork'].includes(room.type)
          && roomLevel !== BASEMENT_LEVEL
          ? clipRectToRoundShell(spec, room) : null;
        if (roundClip && roundClip.length >= 3) {
          const fullyInside = Math.abs(polygonArea(roundClip) - room.w * room.d) < 0.05;
          if (!fullyInside) {
            const shape = new THREE.Shape(roundClip.map(([px, py]) => new THREE.Vector2(px, py)));
            const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: false });
            mesh = new THREE.Mesh(geo, material);
            // Shape XY → world XZ (plan y becomes world z); extrusion points
            // down after the rotation, so lift by the slab thickness.
            mesh.rotation.x = Math.PI / 2;
            mesh.position.y = 0.16 + roomLift;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData.generated = true;
          }
        }
        if (!mesh) mesh = box(room.w - slabInset * 2, 0.22, room.d - slabInset * 2, room.x + room.w / 2, 0.05 + roomLift, room.y + room.d / 2, material);
        mesh.name = room.name;
        mesh.userData.roomId = room.id;
        mesh.userData.footprint = { w: room.w, d: room.d };
        mesh.userData.generated = true;
        roomMeshes.push(mesh);
        const parts = { mesh, label: null, halo: null, handles: [], baseW: room.w, baseD: room.d, h: 0.22, w: room.w, d: room.d };
        draggableParts.set(room.id, parts);
        group.add(mesh);
        if (room.id === selectedRoom) {
          const halo = selectionHalo(room.w, room.d, room.x + room.w / 2, 0.26 + roomLift, room.y + room.d / 2);
          parts.halo = halo;
          group.add(halo);
          addResizeHandles(group, parts, room.id, room.x, room.y, room.w, room.d, 0.72 + roomLift);
        }

        if (layers.labels) {
          const label = makeLabel(room.name, room.w);
          label.position.set(room.x + room.w / 2, 0.42 + roomLift, room.y + room.d / 2);
          parts.label = label;
          group.add(label);
        }
      });

      // A greenhouse ROOM that reaches past the conditioned walls IS the
      // glazed annex — its framing and glazing materialize automatically over
      // the outside portion (kneewall, timber posts and rafters, sloped glass
      // roof off the house wall), no separate element needed. Tapping the
      // glass selects the room. Skipped when a dedicated greenhouse element
      // already covers it, or the room is fully interior (a conservatory zone).
      const plantAnnexes = [];
      (spec.rooms || []).forEach((room) => {
        if (room.type !== 'plant' || Number(room.level || 1) !== 1) return;
        const rx = Number(room.x) || 0; const ry = Number(room.y) || 0;
        const rw = Number(room.w) || 0; const rd = Number(room.d) || 0;
        const outs = [
          { out: ry + rd - depth, rect: { x: Math.max(0, rx), y: Math.max(ry, depth), w: Math.min(rx + rw, width) - Math.max(0, rx), d: ry + rd - Math.max(ry, depth) } },
          { out: -ry, rect: { x: Math.max(0, rx), y: ry, w: Math.min(rx + rw, width) - Math.max(0, rx), d: Math.min(ry + rd, 0) - ry } },
          { out: rx + rw - width, rect: { x: Math.max(rx, width), y: Math.max(0, ry), w: rx + rw - Math.max(rx, width), d: Math.min(ry + rd, depth) - Math.max(0, ry) } },
          { out: -rx, rect: { x: rx, y: Math.max(0, ry), w: Math.min(rx + rw, 0) - rx, d: Math.min(ry + rd, depth) - Math.max(0, ry) } }
        ].filter((c) => c.out > 1.5 && c.rect.w > 2.5 && c.rect.d > 1.5);
        if (!outs.length) return;
        const best = outs.reduce((a, b) => (a.out >= b.out ? a : b));
        const covered = (spec.elements || []).some((e) => e.category === 'greenhouse'
          && e.x < rx + rw && e.x + e.w > rx && e.y < ry + rd && e.y + e.d > ry);
        if (covered) return;
        plantAnnexes.push({
          id: room.id, name: room.name, category: 'greenhouse', level: 1, z: 0,
          x: best.rect.x, y: best.rect.y, w: best.rect.w, d: best.rect.d, h: 0
        });
      });
      [...(spec.elements || []), ...plantAnnexes].forEach((element) => {
        if (!layers.elements || (layers.hiddenCats || []).includes(element.category || 'custom')) return;
        let elementHeight = element.h || 1.2;
        let elevation = Number(element.z || 0);
        // A storey extent plate ALWAYS sits at the engine's floor elevation —
        // a stale stored z (from an older stacking model) must not float the
        // 2nd floor at 17′ while its rooms and walls sit at 10′.
        if (element.category === 'floor' && Number(element.level || 1) >= 2) {
          elevation = storeyElevationFt(spec.shell, Number(element.level));
        }
        let mesh;
        if ((element.category === 'tower' || element.category === 'loft') && upperPlateRect(spec, Math.max(2, Number(element.level || 2)))) {
          // A tower/loft whose level HAS an extent plate is already fully
          // represented by the plate + upper wall bands + stepped roof — the
          // generic volume box double-rendered on top and stuck through the
          // roof planes. Keep an invisible full-volume handle so the element
          // stays selectable and draggable.
          const hVol = Math.max(2, Number(element.h) || 8);
          const ghostMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.04, depthWrite: false });
          mesh = box(element.w, hVol, element.d, element.x + element.w / 2, elevation + hVol / 2, element.y + element.d / 2, ghostMat);
          elementHeight = hVol;
        } else if (element.category === 'foundation') {
          // A foundation RUN under a specific wall line: gravel trench below
          // grade, and (per its construction) a concrete stem standing proud —
          // the greenhouse-divider detail. The stem (or the ground-level cap)
          // is the drag/select handle; the trench rides along on commit.
          const construction = FOUNDATION_RUN_TYPES[element.construction] ? element.construction : 'rubble';
          const stemH = Math.max(0.25, Number(element.h) || 0.3);
          const cx = element.x + element.w / 2;
          const cz = element.y + element.d / 2;
          const gravelMat = new THREE.MeshStandardMaterial({ color: 0x77725f, roughness: 1, map: grainTexture('concrete'), transparent: true, opacity: element.id === selectedRoom ? 0.95 : 0.75 });
          const stemMatRun = new THREE.MeshStandardMaterial({ color: 0xaaa79b, roughness: 0.95, map: grainTexture('concrete'), transparent: true, opacity: element.id === selectedRoom ? 0.98 : 0.9 });
          if (construction === 'rubble' || construction === 'rubble-stem') {
            const trench = box(element.w, 1.2, element.d, cx, -0.75, cz, gravelMat);
            trench.name = `${element.name} (rubble trench)`;
            trench.userData.roomId = element.id;
            roomMeshes.push(trench);
            group.add(trench);
          }
          if (construction === 'rubble-stem' || construction === 'stemwall') {
            mesh = box(element.w, stemH + 0.1, element.d, cx, (stemH + 0.1) / 2 - 0.05, cz, stemMatRun);
            elementHeight = stemH;
          } else if (construction === 'slabpad') {
            // A slab drawn as one SHAPE (area, not a strip): a flat concrete
            // pad mostly buried, its surface just proud of grade so it reads —
            // and walks — like a real slab.
            mesh = box(element.w, 0.5, element.d, cx, -0.17, cz, stemMatRun);
            elementHeight = 0.16;
          } else if (construction === 'thickened') {
            mesh = box(element.w, 1.1, element.d, cx, -0.45, cz, stemMatRun);
            elementHeight = 0.2;
          } else {
            // rubble-only: a thin gravel cap at grade so it stays visible/clickable
            mesh = box(element.w, 0.22, element.d, cx, 0.02, cz, gravelMat);
            elementHeight = 0.22;
          }
          elevation = 0;
        } else if (element.category === 'partition') {
          // An interior partition wall: a real thin wall between rooms, with an
          // optional doorway (doorWFt/doorAtFt along the run). Segments and the
          // header all carry the element's roomId so selection and explode move
          // the wall as one; the raycast/drag handle is the full-run box.
          const pType = PARTITION_TYPES[element.construction] ? element.construction : 'framed';
          const pMat = new THREE.MeshStandardMaterial({ color: PARTITION_TYPES[pType].color, roughness: 0.9, map: grainTexture('plaster') });
          const alongX = element.w >= element.d;
          const runLen = alongX ? element.w : element.d;
          const thick = alongX ? element.d : element.w;
          // A partition never pokes through the roof: cap its height at the
          // roof underside over its own run (sampled at both ends — a wall
          // crossing the shed slope takes the lower value).
          const capA = roofUnderAt(element.x, element.y);
          const capB = roofUnderAt(element.x + element.w, element.y + element.d);
          const roofCap = Math.max(2.2, Math.min(capA, capB) - elevation - 0.15);
          const hWall = Math.min(Math.max(2, Number(element.h) || 8), roofCap);
          elementHeight = hWall;
          const segBox = (s0, s1, y0, y1) => {
            const len = s1 - s0;
            const m = alongX
              ? box(len, y1 - y0, thick, element.x + s0 + len / 2, elevation + (y0 + y1) / 2, element.y + thick / 2, pMat)
              : box(thick, y1 - y0, len, element.x + thick / 2, elevation + (y0 + y1) / 2, element.y + s0 + len / 2, pMat);
            m.userData.roomId = element.id;
            m.userData.generated = true;
            group.add(m);
            return m;
          };
          const doorW = Math.min(Number(element.doorWFt) || 0, Math.max(0, runLen - 1));
          if (doorW > 0.5) {
            const doorH = Math.min(6.8, hWall - 0.3);
            const at = Math.min(Math.max(Number(element.doorAtFt) || (runLen - doorW) / 2, 0.2), runLen - doorW - 0.2);
            if (at > 0.15) segBox(0, at, 0, hWall);
            if (runLen - (at + doorW) > 0.15) segBox(at + doorW, runLen, 0, hWall);
            segBox(at, at + doorW, doorH, hWall);
            const handleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.05, depthWrite: false });
            mesh = alongX
              ? box(element.w, hWall, thick, element.x + element.w / 2, elevation + hWall / 2, element.y + thick / 2, handleMat)
              : box(thick, hWall, element.d, element.x + thick / 2, elevation + hWall / 2, element.y + element.d / 2, handleMat);
          } else {
            mesh = segBox(0, runLen, 0, hWall);
          }
        } else if (element.category === 'floor') {
          // Storey extent plate — with a real stairwell VOID where a stair on
          // the floor below comes up through it (subtractRect remainders).
          // The full-extent invisible handle keeps drag/resize working.
          const plateLevel = Number(element.level || 1);
          const cuts = (spec.elements || []).filter((el) => el.id !== element.id
            && /stair/i.test(el.name || '') && !/ladder/i.test(el.name || '')
            && Number(el.level || 1) === plateLevel - 1
            && el.x < element.x + element.w && el.x + el.w > element.x
            && el.y < element.y + element.d && el.y + el.d > element.y);
          const plateMat2 = new THREE.MeshStandardMaterial({
            color: elementPalette.floor,
            transparent: true,
            opacity: element.id === selectedRoom ? 0.9 : 0.72,
            roughness: 0.85
          });
          // The visible plate is inset so the storey's wall bands cover its
          // edge (a green sliver used to peek through the seat seam); the
          // full-extent invisible handle keeps drag/resize working.
          const plateInset = Math.min(0.35, element.w / 4, element.d / 4);
          if (!cuts.length) {
            const visiblePlate = box(element.w - plateInset * 2, elementHeight, element.d - plateInset * 2,
              element.x + element.w / 2, elevation + elementHeight / 2, element.y + element.d / 2, plateMat2);
            visiblePlate.userData.roomId = element.id;
            visiblePlate.userData.generated = true;
            group.add(visiblePlate);
            const plateHandle0 = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.04, depthWrite: false });
            mesh = box(element.w, elementHeight, element.d, element.x + element.w / 2, elevation + elementHeight / 2, element.y + element.d / 2, plateHandle0);
          } else {
            let rects = [{ x: element.x + plateInset, y: element.y + plateInset, w: element.w - plateInset * 2, d: element.d - plateInset * 2 }];
            cuts.forEach((cut) => {
              const cutRect = { x: cut.x - 0.2, y: cut.y - 0.2, w: cut.w + 0.4, d: cut.d + 0.4 };
              rects = rects.flatMap((r) => subtractRect(r, cutRect));
            });
            rects.forEach((r) => {
              const m = box(r.w, elementHeight, r.d, r.x + r.w / 2, elevation + elementHeight / 2, r.y + r.d / 2, plateMat2);
              m.userData.roomId = element.id;
              m.userData.generated = true;
              group.add(m);
            });
            const plateHandle = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.04, depthWrite: false });
            mesh = box(element.w, elementHeight, element.d, element.x + element.w / 2, elevation + elementHeight / 2, element.y + element.d / 2, plateHandle);
          }
        } else if (element.category === 'greenhouse') {
          // An attached greenhouse is PART of the timber frame, not a pad:
          // kneewall, posts and rafters in the frame's timber, glazing walls
          // and a glazed lean-to roof falling away from the house.
          const ghPart = (m) => { m.userData.roomId = element.id; m.userData.generated = true; group.add(m); return m; };
          const kneeMat = new THREE.MeshStandardMaterial({ color: wallProfile.color, roughness: 0.88, map: grainTexture('plaster'), bumpMap: bumpTexture('plaster'), bumpScale: 0.12 });
          const gaps = {
            south: Math.abs(element.y - depth),
            north: Math.abs(element.y + element.d),
            east: Math.abs(element.x - width),
            west: Math.abs(element.x + element.w)
          };
          const attach = Object.keys(gaps).reduce((a, b) => (gaps[a] <= gaps[b] ? a : b));
          const alongX = attach === 'south' || attach === 'north';
          const run0 = alongX ? element.x : element.y;
          const run1 = alongX ? element.x + element.w : element.y + element.d;
          const crossH = attach === 'south' ? element.y : attach === 'north' ? element.y + element.d : attach === 'east' ? element.x : element.x + element.w;
          const crossO = attach === 'south' ? element.y + element.d : attach === 'north' ? element.y : attach === 'east' ? element.x + element.w : element.x;
          const runLen = run1 - run0;
          const crossLen = Math.abs(crossO - crossH);
          const kneeH = 1.8;
          const hOut = 6.5;
          const hIn = gaps[attach] < 4
            ? Math.max(hOut + 1, Math.min(roofUnderAt(alongX ? (run0 + run1) / 2 : crossH, alongX ? crossH : (run0 + run1) / 2) - 0.4, hOut + crossLen * 0.55))
            : hOut + crossLen * 0.35;
          // plan-space point from (run, cross) coordinates
          const P = (r, c) => (alongX ? [r, c] : [c, r]);
          const T = 0.35; // timber
          const postN = Math.max(2, Math.ceil(runLen / 5) + 1);
          for (let i = 0; i < postN; i += 1) {
            const r = run0 + ((runLen) * i) / (postN - 1);
            const [pxo, pzo] = P(clamp(r, run0 + T / 2, run1 - T / 2), crossO + (crossO > crossH ? -T / 2 : T / 2));
            ghPart(box(T, hOut, T, pxo, elevation + hOut / 2, pzo, frameMat));
          }
          // plate along the outer edge + ledger against the house
          const [pcx, pcz] = P((run0 + run1) / 2, crossO + (crossO > crossH ? -T / 2 : T / 2));
          ghPart(box(alongX ? runLen : T, 0.4, alongX ? T : runLen, pcx, elevation + hOut - 0.2, pcz, frameMat));
          const [lcx, lcz] = P((run0 + run1) / 2, crossH + (crossO > crossH ? T / 2 : -T / 2));
          ghPart(box(alongX ? runLen : T, 0.4, alongX ? T : runLen, lcx, elevation + hIn - 0.2, lcz, frameMat));
          // rafters house→outer, then the glazed roof plane on the same slope
          const slopeLen = Math.hypot(crossLen, hIn - hOut);
          const rot = Math.atan2(hIn - hOut, crossLen) * (crossO > crossH ? 1 : -1);
          for (let i = 0; i < postN; i += 1) {
            const r = clamp(run0 + (runLen * i) / (postN - 1), run0 + T / 2, run1 - T / 2);
            const [rcx, rcz] = P(r, (crossH + crossO) / 2);
            const raf = box(alongX ? 0.3 : slopeLen, 0.4, alongX ? slopeLen : 0.3, rcx, elevation + (hIn + hOut) / 2 - 0.25, rcz, frameMat);
            if (alongX) raf.rotation.x = rot; else raf.rotation.z = rot;
            ghPart(raf);
          }
          const roofGlass = box(alongX ? runLen - 0.1 : slopeLen, 0.1, alongX ? slopeLen : runLen - 0.1, ...(() => { const [gx, gz] = P((run0 + run1) / 2, (crossH + crossO) / 2); return [gx, elevation + (hIn + hOut) / 2, gz]; })(), glassMat);
          if (alongX) roofGlass.rotation.x = rot; else roofGlass.rotation.z = rot;
          ghPart(roofGlass);
          // kneewall + glazing on the OUTER face and both ENDS (house face open)
          const face = (r0, r1, cross, isEnd) => {
            const fLen = isEnd ? crossLen - T : r1 - r0;
            const [fx, fz] = isEnd ? P(cross, (crossH + crossO) / 2) : P((r0 + r1) / 2, cross + (crossO > crossH ? -T / 2 : T / 2));
            const along = isEnd ? !alongX : alongX;
            ghPart(box(along ? fLen : 0.3, kneeH, along ? 0.3 : fLen, fx, elevation + kneeH / 2, fz, kneeMat));
            const glassH = (isEnd ? (hIn + hOut) / 2 : hOut) - kneeH - 0.35;
            if (glassH > 0.5) ghPart(box(along ? fLen - 0.15 : 0.16, glassH, along ? 0.16 : fLen - 0.15, fx, elevation + kneeH + glassH / 2, fz, glassMat));
          };
          face(run0, run1, crossO, false);
          face(null, null, run0 + T / 2, true);
          face(null, null, run1 - T / 2, true);
          // full-volume invisible handle = the select/drag target
          const ghHandle = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.04, depthWrite: false });
          mesh = box(element.w, hIn, element.d, element.x + element.w / 2, elevation + hIn / 2, element.y + element.d / 2, ghHandle);
          elementHeight = hIn;
        } else if (element.category === 'deck') {
          // A deck or patio, drawn from the SAME resolveDeck() answer the
          // receipts price: surface material, raised vs at-grade, railing
          // style along the open edges only (the house and neighboring decks
          // close an edge — that's the wraparound), auto steps when the floor
          // sits high, a skirt hiding the underframe, and posts up to the
          // canopy when a roof piece covers it.
          const dk = resolveDeck(spec, element);
          const lvlD = dk.level;
          const deckTopY = dk.topFt;
          const ex0 = Number(element.x) || 0; const ey0 = Number(element.y) || 0;
          const ew0 = Math.max(1, Number(element.w) || 10); const ed0 = Math.max(1, Number(element.d) || 8);
          const surfLook = {
            wood: { color: 0x8a6a48, grain: 'wood', rough: 0.8 },
            composite: { color: 0x8d8377, grain: 'wood', rough: 0.55 },
            stone: { color: 0x9b948a, grain: 'earth', rough: 0.95 }
          }[dk.surfaceKey] || { color: 0x8a6a48, grain: 'wood', rough: 0.8 };
          const deckMatD = new THREE.MeshStandardMaterial({ color: surfLook.color, roughness: surfLook.rough, map: grainTexture(surfLook.grain), bumpMap: bumpTexture(surfLook.grain), bumpScale: 0.08 });
          const railMatD = dk.railKey === 'cable'
            ? new THREE.MeshStandardMaterial({ color: 0x9aa2a6, roughness: 0.35, metalness: 0.7 })
            : new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.8, map: grainTexture('wood'), bumpMap: bumpTexture('wood'), bumpScale: 0.08 });
          const dp = (m, mat) => { m.userData.roomId = element.id; m.userData.generated = true; group.add(m); return m; };
          // the walking surface: a slab-thin patio at grade, a framed platform raised
          dp(box(ew0, dk.placement === 'grade' ? 0.25 : 0.35, ed0, ex0 + ew0 / 2, deckTopY, ey0 + ed0 / 2, deckMatD));
          const railTop = deckTopY + 3;
          // stairs: resolveDeckStairs is the one answer (renderer + receipts +
          // card). 'auto' = the old longest-open-edge rule down to the ground;
          // a chosen edge runs to whatever is outside it — a lower (or higher)
          // deck on another level, or the ground. The railing leaves a gap.
          let stepGap = null;
          {
            const st = resolveDeckStairs(spec, element, dk);
            if (st && !st.blocked) {
              stepGap = { side: st.side, a0: st.gapA0, a1: st.gapA1 };
              const hiTop = Math.max(deckTopY, st.targetTop);
              const stepsN = st.treads;
              const stepH = st.rise / stepsN;
              const horiz = st.side === 'north' || st.side === 'south';
              const edgeAt = st.side === 'north' ? ey0 : st.side === 'south' ? ey0 + ed0 : st.side === 'west' ? ex0 : ex0 + ew0;
              const outDir = (st.side === 'north' || st.side === 'west') ? -1 : 1;
              // descending AWAY from whichever surface is higher: outward when
              // this deck is higher, inward onto this deck when the target is
              const marchDir = st.up ? -outDir : outDir;
              for (let s = 1; s <= stepsN; s += 1) {
                const topY = hiTop - s * stepH + stepH / 2;
                const off = edgeAt + marchDir * (s * 0.9 - 0.45);
                dp(horiz
                  ? box(st.gapW - 0.3, stepH, 0.9, st.mid, topY, off, deckMatD)
                  : box(0.9, stepH, st.gapW - 0.3, off, topY, st.mid, deckMatD));
              }
              // a tall run gets sloped handrails down both sides
              if (st.rise >= 3.5) {
                const runLenH = stepsN * 0.9;
                const railLen = Math.hypot(runLenH, st.rise);
                const angle = Math.atan2(st.rise, runLenH);
                // sign: the rail must descend toward the march direction
                const railCtrY = hiTop - st.rise / 2 + 3;
                const railCtrOff = edgeAt + marchDir * (runLenH / 2);
                [st.gapA0 + 0.12, st.gapA1 - 0.12].forEach((railAt) => {
                  let rm;
                  if (horiz) {
                    rm = box(0.15, 0.15, railLen, railAt, railCtrY, railCtrOff, railMatD);
                    rm.rotation.x = (marchDir > 0 ? 1 : -1) * angle;
                  } else {
                    rm = box(railLen, 0.15, 0.15, railCtrOff, railCtrY, railAt, railMatD);
                    rm.rotation.z = (marchDir > 0 ? -1 : 1) * angle;
                  }
                  dp(rm);
                });
              }
            }
          }
          // railing along each OPEN segment, in the chosen style
          const railOnSeg = (side, a0, a1) => {
            if (dk.railKey === 'none' || a1 - a0 < 0.6) return;
            const horiz = side === 'north' || side === 'south';
            const at = side === 'north' ? ey0 + 0.1 : side === 'south' ? ey0 + ed0 - 0.1 : side === 'west' ? ex0 + 0.1 : ex0 + ew0 - 0.1;
            dp(horiz
              ? box(a1 - a0, 0.18, 0.18, (a0 + a1) / 2, railTop, at, railMatD)
              : box(0.18, 0.18, a1 - a0, at, railTop, (a0 + a1) / 2, railMatD));
            if (dk.railKey === 'cable') {
              // steel posts every ~5 ft with three thin cables strung between
              const n = Math.max(1, Math.round((a1 - a0) / 5));
              for (let i = 0; i <= n; i += 1) {
                const p = a0 + ((a1 - a0) * i) / n;
                dp(horiz
                  ? box(0.12, railTop - deckTopY, 0.12, p, (deckTopY + railTop) / 2, at, railMatD)
                  : box(0.12, railTop - deckTopY, 0.12, at, (deckTopY + railTop) / 2, p, railMatD));
              }
              [0.8, 1.6, 2.4].forEach((h) => {
                dp(horiz
                  ? box(a1 - a0, 0.04, 0.04, (a0 + a1) / 2, deckTopY + h, at, railMatD)
                  : box(0.04, 0.04, a1 - a0, at, deckTopY + h, (a0 + a1) / 2, railMatD));
              });
            } else {
              // wood balusters
              const n = Math.max(1, Math.round((a1 - a0) / 4));
              for (let i = 0; i <= n; i += 1) {
                const p = a0 + ((a1 - a0) * i) / n;
                dp(horiz
                  ? box(0.15, railTop - deckTopY, 0.15, p, (deckTopY + railTop) / 2, at, railMatD)
                  : box(0.15, railTop - deckTopY, 0.15, at, (deckTopY + railTop) / 2, p, railMatD));
              }
            }
          };
          for (const [side, segs] of Object.entries(dk.openSides)) {
            for (const s of segs) {
              if (stepGap && stepGap.side === side && stepGap.a1 > s.a0 && stepGap.a0 < s.a1) {
                // split the railing around the stair gap
                railOnSeg(side, s.a0, Math.max(s.a0, stepGap.a0));
                railOnSeg(side, Math.min(s.a1, stepGap.a1), s.a1);
              } else railOnSeg(side, s.a0, s.a1);
            }
          }
          if (dk.placement === 'raised' && lvlD === 1) {
            // corner posts to grade…
            [[ex0 + 0.3, ey0 + 0.3], [ex0 + ew0 - 0.3, ey0 + 0.3], [ex0 + 0.3, ey0 + ed0 - 0.3], [ex0 + ew0 - 0.3, ey0 + ed0 - 0.3]].forEach(([px, pz]) => {
              dp(box(0.35, deckTopY, 0.35, px, deckTopY / 2, pz, deckMatD));
            });
            // …and a skirt over the open sides when the frame sits high
            if (deckTopY > 1.5) {
              for (const [side, segs] of Object.entries(dk.openSides)) {
                const at = side === 'north' ? ey0 + 0.12 : side === 'south' ? ey0 + ed0 - 0.12 : side === 'west' ? ex0 + 0.12 : ex0 + ew0 - 0.12;
                const horiz = side === 'north' || side === 'south';
                for (const s of segs) {
                  if (s.a1 - s.a0 < 0.8) continue;
                  const skirtH = Math.max(0.3, deckTopY - 0.35);
                  dp(horiz
                    ? box(s.a1 - s.a0, skirtH, 0.12, (s.a0 + s.a1) / 2, skirtH / 2, at, deckMatD)
                    : box(0.12, skirtH, s.a1 - s.a0, at, skirtH / 2, (s.a0 + s.a1) / 2, deckMatD));
                }
              }
            }
          }
          // a covered deck's posts rise to MEET THE PLAN PIECE — never a
          // guessed height (the one-roof law reaches the deck posts too)
          if (dk.roofKey) {
            const piece = roofPlan.pieces.find((p) => p.deckId === element.id);
            if (piece) {
              const postMatD = new THREE.MeshStandardMaterial({ color: 0x7a5c3e, roughness: 0.7, map: grainTexture('wood'), bumpMap: bumpTexture('wood'), bumpScale: 0.08 });
              const postsAt = [[ex0 + 0.4, ey0 + 0.4], [ex0 + ew0 - 0.4, ey0 + 0.4], [ex0 + 0.4, ey0 + ed0 - 0.4], [ex0 + ew0 - 0.4, ey0 + ed0 - 0.4]];
              if (ew0 > 12) postsAt.push([ex0 + ew0 / 2, ey0 + 0.4], [ex0 + ew0 / 2, ey0 + ed0 - 0.4]);
              if (ed0 > 12) postsAt.push([ex0 + 0.4, ey0 + ed0 / 2], [ex0 + ew0 - 0.4, ey0 + ed0 / 2]);
              postsAt.forEach(([px, pz]) => {
                const topY = piece.topAt(px, pz) - 0.12;
                if (topY > deckTopY + 1) dp(box(0.42, topY - deckTopY, 0.42, px, deckTopY + (topY - deckTopY) / 2, pz, postMatD));
              });
            }
          }
          // full-volume invisible handle = the select/drag target
          const deckHandle = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.04, depthWrite: false });
          mesh = box(ew0, Math.max(1, railTop - deckTopY), ed0, ex0 + ew0 / 2, (deckTopY + railTop) / 2, ey0 + ed0 / 2, deckHandle);
          elementHeight = railTop - deckTopY;
        } else if (/stair/i.test(element.name || '') && !/ladder/i.test(element.name || '')) {
          // A real stair run: treads and risers climbing the storey (or out of
          // the basement), not a floating box. The invisible full-volume box
          // stays as the drag/select handle.
          const alongX = element.w >= element.d;
          const runLen = Math.max(3, alongX ? element.w : element.d);
          const stairWide = Math.max(2, alongX ? element.d : element.w);
          const lvlS = Number(element.level || 1);
          const rise = lvlS === BASEMENT_LEVEL
            ? Math.max(4, basementH)
            : (storeys > 1 ? baseStoreyFt + 0.45 : Math.max(4, Number(element.h) || 8));
          elementHeight = rise;
          const treadMat = new THREE.MeshStandardMaterial({ color: 0x8a6f4e, roughness: 0.8, map: grainTexture('wood') });
          const steps = Math.max(3, Math.round(rise / 0.646));
          const treadD = runLen / steps;
          const stepH = rise / steps;
          for (let s = 0; s < steps; s += 1) {
            const topY = elevation + (s + 1) * stepH;
            // Stairs stop at the roof's underside like partitions do — a run
            // whose top lands under a low stepped wing used to poke its last
            // treads out through the metal.
            const treadCx = alongX ? element.x + s * treadD + treadD / 2 : element.x + stairWide / 2;
            const treadCz = alongX ? element.y + stairWide / 2 : element.y + s * treadD + treadD / 2;
            if (lvlS !== BASEMENT_LEVEL && topY > roofUnderAt(treadCx, treadCz) - 0.12) continue;
            const tread = alongX
              ? box(treadD, 0.22, stairWide, element.x + s * treadD + treadD / 2, topY - 0.11, element.y + stairWide / 2, treadMat)
              : box(stairWide, 0.22, treadD, element.x + stairWide / 2, topY - 0.11, element.y + s * treadD + treadD / 2, treadMat);
            tread.userData.roomId = element.id;
            tread.userData.generated = true;
            group.add(tread);
            const riser = alongX
              ? box(0.16, stepH, stairWide, element.x + s * treadD + 0.1, topY - stepH / 2, element.y + stairWide / 2, treadMat)
              : box(stairWide, stepH, 0.16, element.x + stairWide / 2, topY - stepH / 2, element.y + s * treadD + 0.1, treadMat);
            riser.userData.roomId = element.id;
            riser.userData.generated = true;
            group.add(riser);
          }
          const stairHandle = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.05, depthWrite: false });
          mesh = box(element.w, rise, element.d, element.x + element.w / 2, elevation + rise / 2, element.y + element.d / 2, stairHandle);
        } else if (element.roofType || element.category === 'carport' || element.category === 'porch') {
          // An open-air structure (carport, porch, covered deck) is a canopy
          // on posts over a low deck — NOT a building-sized translucent ghost
          // box. The full-volume handle stays for select/drag.
          const deckMat = new THREE.MeshStandardMaterial({ color: 0x9c8265, roughness: 0.9, map: grainTexture('wood') });
          const deck = box(element.w, 0.28, element.d, element.x + element.w / 2, elevation + 0.14, element.y + element.d / 2, deckMat);
          deck.userData.roomId = element.id;
          deck.userData.generated = true;
          group.add(deck);
          const openHandle = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.04, depthWrite: false });
          mesh = box(element.w, Math.max(7.4, elementHeight), element.d, element.x + element.w / 2, elevation + Math.max(7.4, elementHeight) / 2, element.y + element.d / 2, openHandle);
        } else {
        const material = new THREE.MeshStandardMaterial({
          color: elementPalette[element.category] || 0x8a7768,
          transparent: true,
          opacity: element.id === selectedRoom ? 0.9 : 0.66,
          roughness: 0.85
        });
        mesh = box(element.w, elementHeight, element.d, element.x + element.w / 2, elevation + elementHeight / 2, element.y + element.d / 2, material);
        }
        mesh.name = element.name;
        mesh.userData.roomId = element.id;
        mesh.userData.footprint = { w: element.w, d: element.d };
        mesh.userData.generated = true;
        roomMeshes.push(mesh);
        const parts = { mesh, label: null, halo: null, handles: [], baseW: element.w, baseD: element.d, h: elementHeight, z: elevation, w: element.w, d: element.d };
        draggableParts.set(element.id, parts);
        group.add(mesh);
        if (element.id === selectedRoom) {
          const halo = selectionHalo(element.w, element.d, element.x + element.w / 2, elevation + elementHeight + 0.15, element.y + element.d / 2);
          parts.halo = halo;
          group.add(halo);
          addResizeHandles(group, parts, element.id, element.x, element.y, element.w, element.d, elevation + elementHeight + 0.65);
        }

        // A covered porch / deck / carport: the element carries roofType but
        // nothing ever rendered it. A canopy now draws on four corner posts —
        // gable gets a small ridge, anything else a shed panel tilted down
        // away from the house. All parts carry the element's roomId so
        // selection glow and explode move the assembly as one.
        const canopyKind = element.roofType || (element.category === 'carport' || element.category === 'porch' ? 'shed' : '');
        if (canopyKind && element.category !== 'foundation' && element.category !== 'floor') {
          // Posts stand on the deck (or a low volume) — never on top of a
          // tall handle volume, which floated the canopy 10ft up.
          const deckTop = elevation + Math.min(elementHeight, 1);
          const eave = deckTop + 6.8;
          const canopyPart = (m) => { m.userData.roomId = element.id; m.userData.generated = true; group.add(m); };
          [[element.x + 0.4, element.y + 0.4], [element.x + element.w - 0.4, element.y + 0.4],
            [element.x + 0.4, element.y + element.d - 0.4], [element.x + element.w - 0.4, element.y + element.d - 0.4]]
            .forEach(([pxp, pzp]) => canopyPart(box(0.42, eave - deckTop, 0.42, pxp, deckTop + (eave - deckTop) / 2, pzp, frameMat)));
          const cxm = element.x + element.w / 2;
          const czm = element.y + element.d / 2;
          const ow = 0.9;
          if (canopyKind === 'gable') {
            const alongX = element.w >= element.d;
            const span = (alongX ? element.d : element.w) / 2 + ow;
            const rise = Math.max(0.9, span * 0.3);
            const panelLen = Math.hypot(span, rise);
            for (const dir of [-1, 1]) {
              const panel = alongX
                ? box(element.w + ow * 2, 0.16, panelLen, cxm, eave + rise / 2, czm + dir * span / 2, roofMat)
                : box(panelLen, 0.16, element.d + ow * 2, cxm + dir * span / 2, eave + rise / 2, czm, roofMat);
              if (alongX) panel.rotation.x = dir * Math.atan2(rise, span);
              else panel.rotation.z = -dir * Math.atan2(rise, span);
              canopyPart(panel);
            }
          } else {
            const spanW = element.w + ow * 2;
            const spanD = element.d + ow * 2;
            const towardX = Math.abs(cxm - width / 2) > Math.abs(czm - depth / 2);
            const rise = Math.max(0.8, (towardX ? spanW : spanD) * 0.12);
            const panel = box(spanW, 0.16, spanD, cxm, eave + rise / 2, czm, roofMat);
            if (towardX) panel.rotation.z = (cxm >= width / 2 ? -1 : 1) * Math.atan2(rise, spanW);
            else panel.rotation.x = (czm >= depth / 2 ? 1 : -1) * Math.atan2(rise, spanD);
            canopyPart(panel);
          }
        }

        // A chimney rises past the roof plane instead of dying inside its box:
        // masonry heaters / wood stoves inside the footprint get a flue that
        // clears the roof by ~2.5' (roof height approximated at the stack's
        // plan position — stepped/L roofs use the main-roof math, honest-ish).
        // Category is planner-chosen and varies ('thermal', 'chimney', ...) —
        // match by name too so a traced "Masonry Chimney" gets its flue.
        if ((element.category === 'thermal' && /chimney|masonry|stove|heater|rocket/i.test(element.name || ''))
          || element.category === 'chimney' || /\b(chimney|flue)\b/i.test(element.name || '')) {
          const cxm = element.x + element.w / 2;
          const czm = element.y + element.d / 2;
          const inside = cxm >= 0 && cxm <= width && czm >= 0 && czm <= depth;
          const gRise = depth * Number(spec.shell.roofPitch || 0.32);
          let flueTop;
          if (!inside) flueTop = elevation + elementHeight + 6;
          else if (roofSpec.roofType === 'shed') flueTop = shedEaveAt(cxm, czm) + storeyLift + 2.5;
          else if (roofSpec.roofType === 'flat') flueTop = wallHeight + 3;
          else flueTop = wallHeight + Math.max(0, gRise - 0.25) * (1 - Math.min(1, Math.abs(cxm - width / 2) / (width / 2 || 1))) + 2.5;
          const flueBase = elevation + Math.max(0.5, elementHeight - 0.5);
          if (flueTop > flueBase + 0.5) {
            const flueMat = new THREE.MeshStandardMaterial({ color: 0x8d6b5a, roughness: 0.9, map: grainTexture('concrete') });
            const flue = box(1.4, flueTop - flueBase, 1.4, cxm, flueBase + (flueTop - flueBase) / 2, czm, flueMat);
            flue.name = `${element.name} flue`;
            flue.userData.roomId = element.id;
            flue.userData.generated = true;
            roomMeshes.push(flue);
            group.add(flue);
            const cap = box(2, 0.25, 2, cxm, flueTop + 0.12, czm, flueMat);
            cap.userData.roomId = element.id;
            cap.userData.generated = true;
            group.add(cap);
          }
        }

        // Element labels only when SELECTED — a chip over every fixture,
        // partition, and plate buried the model in text. Names live in the
        // selector and the plan.
        if (layers.labels && element.id === selectedRoom) {
          const label = makeLabel(element.name, Math.max(element.w, 8));
          label.position.set(element.x + element.w / 2, elevation + elementHeight + 0.8, element.y + element.d / 2);
          parts.label = label;
          group.add(label);
        }
      });

      const doorMat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.75 });
      const bayFrameMat = new THREE.MeshStandardMaterial({ color: 0xa08258, roughness: 0.8 });
      const overhangsNow = resolveOverhangs(spec.shell);
      const gableRise = depth * Number(spec.shell.roofPitch || 0.32);
      if (layers.openings) spec.openings.forEach((opening, index) => {
        const size = opening.widthFt;
        const profile = OPENING_TYPES[opening.type] || OPENING_TYPES.window;
        // Which storey the opening lives on lifts the whole assembly: a
        // 2nd-floor window sits at that storey's floor elevation, not the ground.
        const oLevel = opening.wall === 'roof' ? 1 : Number(opening.level || 1);
        const baseY = storeyElevationFt(spec.shell, oLevel) + (oLevel === 1 && opening.wall !== 'roof' ? (sideReveal[opening.wall] || 0) : 0);
        // per-opening sill override (set by dragging on the wall view)
        const oSill = Number.isFinite(Number(opening.sillFt)) ? Number(opening.sillFt) : profile.sill;
        const sill = baseY + oSill;
        // Plan position of the opening centre — used by raked height, the shade
        // eyebrow, and the dormer.
        const oHoriz = opening.wall === 'north' || opening.wall === 'south';
        const oPx = oHoriz ? (Number(opening.x) || 0) + size / 2 : (opening.wall === 'east' ? width : 0);
        const oPz = oHoriz ? (opening.wall === 'south' ? depth : 0) : (Number(opening.y) || 0) + size / 2;
        // A raked gable window climbs to just under the roof, so it fills the
        // gable peak instead of stopping square. Sample the roof at both ends of
        // the window and take the LOWER, so the square top never pokes through
        // the slope (the sloped cap frame follows the rake above it).
        let openH = profile.h;
        if (profile.raked && opening.wall !== 'roof') {
          const r0 = oHoriz ? roofUnderAt((Number(opening.x) || 0), oPz) : roofUnderAt(oPx, (Number(opening.y) || 0));
          const r1 = oHoriz ? roofUnderAt((Number(opening.x) || 0) + size, oPz) : roofUnderAt(oPx, (Number(opening.y) || 0) + size);
          openH = clamp(Math.min(r0, r1) - sill - 0.4, profile.h, 16);
        }
        const centerY = sill + openH / 2;
        const mat = profile.glazed ? glassMat : doorMat;
        let mesh;
        if (roundFp && opening.wall !== 'roof') {
          // Round house: place a simple framed pane ON the ellipse arc, tangent
          // to the curve (a curved wall can't take the flat rectilinear buck).
          const rxE = width / 2; const ryE = depth / 2;
          const sideLen = oHoriz ? width : depth;
          const f = clamp(sideLen > 0 ? ((Number(oHoriz ? opening.x : opening.y) || 0) + size / 2) / sideLen : 0.5, 0, 1);
          const deg = opening.wall === 'south' ? 135 - 90 * f
            : opening.wall === 'north' ? 225 + 90 * f
            : opening.wall === 'east' ? -45 + 90 * f
            : 225 - 90 * f;
          const th = deg * Math.PI / 180;
          const cxP = rxE + rxE * Math.cos(th);
          const czP = ryE + ryE * Math.sin(th);
          const yaw = Math.atan2(-(ryE * Math.cos(th)), -(rxE * Math.sin(th)));
          const tHere = resolveWallSide(spec, opening.wall, oLevel).thicknessFt;
          const paneMat = profile.glazed ? glassMat : doorMatWood;
          const fw = 0.22;
          const frame = new THREE.Group();
          const add = (m) => { m.userData.roomId = `opening-${index}`; frame.add(m); return m; };
          // casing ring + pane, all built flat in local X (along wall) × Y, thin Z
          add(box(size + fw * 2, fw, tHere + 0.3, 0, sill + openH + fw / 2, 0, frameMat));
          add(box(size + fw * 2, fw, tHere + 0.3, 0, Math.max(baseY + fw / 2, sill - fw / 2), 0, frameMat));
          add(box(fw, openH, tHere + 0.3, -size / 2 - fw / 2, centerY, 0, frameMat));
          add(box(fw, openH, tHere + 0.3, size / 2 + fw / 2, centerY, 0, frameMat));
          mesh = add(box(Math.max(0.6, size - 0.08), openH, 0.16, 0, centerY, 0, paneMat));
          if (profile.glazed && size >= 2) {
            add(box(0.09, openH, 0.2, 0, centerY, 0.1, frameMat));
            add(box(size, 0.09, 0.2, 0, centerY, 0.1, frameMat));
          }
          frame.position.set(cxP, 0, czP);
          frame.rotation.y = yaw;
          frame.userData.generated = true;
          group.add(frame);
          roomMeshes.push(mesh);
          return;
        }
        if (opening.wall === 'roof') {
          // Skylight: a glass panel lying on the roof plane, tilted to the slope.
          const cx = (Number(opening.x) || 0) + size / 2;
          const cz = (Number(opening.y) || 0) + size / 2;
          mesh = box(size, 0.16, size, cx, 0, cz, glassMat);
          if (roofSpec.roofType === 'shed' && shedEW) {
            const totalW = width + overhangsNow.west + overhangsNow.east;
            const t = (cx + overhangsNow.west) / totalW;
            const wH = westWallHeight; const eH = eastWallHeight;
            mesh.position.y = wH + 0.28 + (eH - wH) * t + 0.22;
            // rising toward +x tilts the same way as the gable's west slope
            mesh.rotation.z = Math.atan2(eH - wH, totalW);
          } else if (roofSpec.roofType === 'shed') {
            const totalD = depth + overhangsNow.north + overhangsNow.south;
            const t = (cz + overhangsNow.north) / totalD;
            mesh.position.y = northWallHeight + 0.28 + (southWallHeight - northWallHeight) * t + 0.22;
            mesh.rotation.x = Math.atan2(southWallHeight - northWallHeight, totalD);
          } else {
            const halfRun = width / 2 + overhangsNow.west;
            const onWest = cx < width / 2;
            const t = onWest ? (cx + overhangsNow.west) / halfRun : (width + overhangsNow.east - cx) / (width / 2 + overhangsNow.east);
            mesh.position.y = wallHeight + 0.25 + Math.max(0, gableRise - 0.25) * Math.min(1, Math.max(0, t)) + 0.22;
            const slopeAngle = Math.atan2(Math.max(0, gableRise - 0.25), width / 2);
            mesh.rotation.z = onWest ? slopeAngle : -slopeAngle;
          }
        } else {
          // The wall line the opening sits on: on a custom footprint it is the
          // containing polygon edge; on a rectangle these are the classic
          // 0 / depth / width / 0 lines (edgeForOpening returns exactly those).
          const oEdge = customFp ? edgeForOpening(spec, opening) : null;
          const lineNS = oEdge && oEdge.horizontal ? oEdge.y0 : (opening.wall === 'north' ? 0 : depth);
          const lineEW = oEdge && !oEdge.horizontal ? oEdge.x0 : (opening.wall === 'east' ? width : 0);
          if (profile.bay) {
            // Bay window: a wood-framed box pushed out from the wall, glass on its face.
            const bayD = 1.4;
            let glassFace = null;
            if (opening.wall === 'south') {
              mesh = box(size, openH, bayD, opening.x + size / 2, centerY, lineNS + bayD / 2, bayFrameMat);
              glassFace = box(Math.max(1, size - 0.5), Math.max(1, openH - 0.5), 0.14, opening.x + size / 2, centerY, lineNS + bayD + 0.06, glassMat);
            } else if (opening.wall === 'north') {
              mesh = box(size, openH, bayD, opening.x + size / 2, centerY, lineNS - bayD / 2, bayFrameMat);
              glassFace = box(Math.max(1, size - 0.5), Math.max(1, openH - 0.5), 0.14, opening.x + size / 2, centerY, lineNS - bayD - 0.06, glassMat);
            } else if (opening.wall === 'east') {
              mesh = box(bayD, openH, size, lineEW + bayD / 2, centerY, opening.y + size / 2, bayFrameMat);
              glassFace = box(0.14, Math.max(1, openH - 0.5), Math.max(1, size - 0.5), lineEW + bayD + 0.06, centerY, opening.y + size / 2, glassMat);
            } else {
              mesh = box(bayD, openH, size, lineEW - bayD / 2, centerY, opening.y + size / 2, bayFrameMat);
              glassFace = box(0.14, Math.max(1, openH - 0.5), Math.max(1, size - 0.5), lineEW - bayD - 0.06, centerY, opening.y + size / 2, glassMat);
            }
            if (glassFace) group.add(glassFace);
          } else {
            // A real opening assembly instead of a pasted-on box: wood frame
            // (head, sill member, jambs) standing proud of the wall, an inset
            // glass pane or door slab, divided lites on windows, a projecting
            // sill ledge, and a knob on doors. Every part carries the opening
            // id so selection glow and the exploded view treat it as one thing.
            const horizontalWall = opening.wall === 'north' || opening.wall === 'south';
            const line = horizontalWall ? lineNS : lineEW;
            const dirOut = opening.wall === 'south' || opening.wall === 'east' ? 1 : -1;
            const along0 = horizontalWall ? Number(opening.x) || 0 : Number(opening.y) || 0;
            const mid = along0 + size / 2;
            const part = (alongLen, h, deep, alongC, yC, out, material) => {
              const m = horizontalWall
                ? box(alongLen, h, deep, alongC, yC, line + dirOut * out, material)
                : box(deep, h, alongLen, line + dirOut * out, yC, alongC, material);
              m.userData.roomId = `opening-${index}`;
              group.add(m);
              return m;
            };
            const fw = 0.22;
            // When the wall cut this opening's REAL hole, the assembly recesses
            // into it: jamb/head/sill liners span the wall thickness (the
            // visible reveal) and the pane sits mid-wall. When the hole wasn't
            // cut (clerestory above a low wall, degenerate positions) the
            // assembly keeps its old proud-of-the-wall placement.
            const facing = oEdge?.facing || opening.wall;
            const tHere = wallResolved[facing]?.thicknessFt || 1;
            const recessed = Boolean(gapByOpening[index]?.cut);
            const rIn = recessed ? -(tHere / 2) : 0.05;
            // exterior casing (head, sill trim, jamb trim)
            part(size + fw * 2, fw, 0.3, mid, sill + openH + fw / 2, 0.14, frameMat);
            part(size + fw * 2, fw, 0.3, mid, Math.max(baseY + fw / 2, sill - fw / 2), 0.14, frameMat);
            part(fw, openH, 0.3, mid - size / 2 - fw / 2, centerY, 0.14, frameMat);
            part(fw, openH, 0.3, mid + size / 2 + fw / 2, centerY, 0.14, frameMat);
            if (recessed) {
              // reveal liners — the window buck lining the hole through the wall
              const revealD = Math.max(0.6, tHere - 0.06);
              part(size, 0.12, revealD, mid, sill + openH - 0.06, rIn, frameMat);
              part(size, 0.12, revealD, mid, sill + 0.06, rIn, frameMat);
              part(0.12, openH, revealD, mid - size / 2 + 0.06, centerY, rIn, frameMat);
              part(0.12, openH, revealD, mid + size / 2 - 0.06, centerY, rIn, frameMat);
            }
            const paneMat = profile.glazed ? glassMat : doorMatWood;
            mesh = part(Math.max(0.6, size - (recessed ? 0.26 : 0.08)), openH - (recessed ? 0.22 : 0), 0.14, mid, centerY, rIn, paneMat);
            if (profile.glazed && !profile.entry && size >= 2) {
              // divided lites — one vertical + one horizontal muntin
              part(0.09, openH, 0.2, mid, centerY, rIn + 0.09, frameMat);
              part(size, 0.09, 0.2, mid, centerY, rIn + 0.09, frameMat);
            }
            if (opening.type === 'french' || opening.type === 'slider') {
              part(0.12, openH, 0.24, mid, centerY, rIn + 0.09, frameMat);
            }
            if (profile.liteFrac) {
              // half-lite: the lower part of the door is a solid wood panel;
              // only the upper lite is glass
              part(size - 0.2, openH * (1 - profile.liteFrac), 0.2, mid, sill + (openH * (1 - profile.liteFrac)) / 2, rIn + 0.08, doorMat);
            }
            if (profile.entry && (!profile.glazed || profile.liteFrac)) {
              // door hardware — a small knob at the latch side
              part(0.14, 0.14, 0.14, mid + size * 0.34, sill + Math.min(3.1, openH * 0.45), rIn + 0.16, frameMat);
            }
            if (oSill > 0.6) {
              // projecting exterior sill ledge under windows
              part(size + 0.5, 0.13, 0.5, mid, sill - fw - 0.04, 0.22, frameMat);
            }
            // Tilted glazing pane — lean the glass on its angle (top toward the
            // house, the greenhouse face), around the wall's own axis.
            if (Number(opening.tiltDeg) > 0 && mesh) {
              const tr = clamp(Number(opening.tiltDeg), 5, 60) * Math.PI / 180;
              if (horizontalWall) mesh.rotation.x = dirOut * tr; else mesh.rotation.z = -dirOut * tr;
            }
            // Raked gable window — a sloped head frame (an inverted V) following
            // the roof pitch over the tall glass.
            if (profile.raked) {
              const headY = sill + openH;
              const pitch = Number(spec.shell.roofPitch) || 0.32;
              const halfW = size / 2 + fw;
              const rise = Math.min(halfW * pitch + 0.4, 2.4);
              for (const sgn of [-1, 1]) {
                const len = Math.hypot(halfW, rise) + 0.12;
                const ang = Math.atan2(rise, halfW);
                const m = part(len, 0.16, 0.34, mid + sgn * halfW / 2, headY + rise / 2 - 0.08, 0.14, frameMat);
                if (horizontalWall) m.rotation.z = -sgn * ang; else m.rotation.x = sgn * ang;
              }
            }
            // Shade eyebrow (window overhang) — a hood over the window that
            // blocks high summer sun while low winter sun still reaches in.
            if (Number(opening.shadeFt) > 0) {
              const proj = clamp(Number(opening.shadeFt), 0.3, 6);
              const hoodY = sill + openH + 0.28;
              part(size + 0.9, 0.16, proj, mid, hoodY, proj / 2 + 0.12, frameMat);
              for (const sgn of [-1, 1]) {
                const m = part(0.5, 0.12, 0.12, mid + sgn * (size / 2 + 0.05), hoodY - 0.32, 0.14, frameMat);
                if (horizontalWall) m.rotation.x = -0.7; else m.rotation.z = 0.7;
              }
            }
          }
        }
        if (mesh) {
          mesh.name = opening.label || `${opening.wall} ${opening.type}`;
          mesh.userData.roomId = `opening-${index}`;
          roomMeshes.push(mesh);
          group.add(mesh);
        }

        // DORMER — projects from the roof so an upstairs window meets daylight
        // instead of roof deck. Built when the window would otherwise be buried
        // (auto) OR when the opening explicitly asks for one, and shaped to the
        // chosen style: SHED (one low slope) or GABLE (a peaked doghouse).
        if (layers.roof && oLevel > 1 && opening.wall !== 'roof' && profile.glazed) {
          const horiz = opening.wall === 'north' || opening.wall === 'south';
          const px = horiz ? (Number(opening.x) || 0) + size / 2 : (opening.wall === 'east' ? width : 0);
          const pz = horiz ? (opening.wall === 'south' ? depth : 0) : (Number(opening.y) || 0) + size / 2;
          const windowTop = sill + openH;
          const roofHere = roofUnderAt(px, pz);
          const explicit = opening.dormerStyle === 'gable' || opening.dormerStyle === 'shed';
          if (explicit || windowTop > roofHere + 0.3) {
            const style = opening.dormerStyle || 'gable';
            const inw = (opening.wall === 'south' || opening.wall === 'east') ? -1 : 1; // inward (toward ridge)
            const dW = size + 1.3;                 // dormer width along the wall
            const dTop = windowTop + 0.55;         // dormer ridge / high point
            const wallLine = horiz ? pz : px;      // the eave line coord the front sits on
            // Walk inward until the main roof rises to the dormer top (capped).
            let back = 1;
            for (let s = 1; s <= 16; s += 0.5) {
              const qx = horiz ? px : px + inw * s;
              const qz = horiz ? pz + inw * s : pz;
              back = s;
              if (roofUnderAt(qx, qz) >= dTop - 0.05) break;
            }
            const dMat = new THREE.MeshStandardMaterial({ color: roofMat.color, roughness: 0.5, metalness: 0.22, side: THREE.DoubleSide });
            const cheekMat = wallMatFor(opening.wall);
            const dpart = (m) => { m.userData.roomId = `opening-${index}`; m.userData.generated = true; group.add(m); return m; };
            // A box laid along the inward axis at (alongCenter on the wall, y, inwardCenter).
            const at = (alongC, y, inC, wAlong, h, deep, mat) => dpart(horiz
              ? box(wAlong, h, deep, alongC, y, inC, mat)
              : box(deep, h, wAlong, inC, y, alongC, mat));
            const inMid = wallLine + inw * (back / 2);
            const frontBase = Math.min(sill - 0.2, roofHere);
            // Cheeks: a side wall each side running inward (both styles).
            for (const sgn of [-1, 1]) {
              const cAlong = px + sgn * dW / 2;
              const midH = (dTop + roofHere) / 2;
              at(cAlong, (frontBase + midH) / 2, inMid, 0.18, Math.max(0.5, midH - frontBase), back, cheekMat);
            }
            // Front wall from the window head up to the dormer top (both styles).
            at(px, (windowTop + dTop) / 2, wallLine + inw * 0.05, dW, Math.max(0.3, dTop - windowTop), 0.4, cheekMat);
            const backAng = Math.atan2(dTop - roofHere, Math.max(0.5, back));
            const planeLen = Math.hypot(back, dTop - roofHere) + 0.3;
            if (style === 'shed') {
              // one flat plane sloping from the high front back down to the roof
              const rp = at(px, (dTop + roofHere) / 2 + 0.15, inMid, dW + 0.3, 0.14, planeLen, dMat);
              if (horiz) rp.rotation.x = inw * backAng; else rp.rotation.z = -inw * backAng;
            } else {
              // GABLE: a peak over the window — two planes sloping to each side
              // from a centre ridge, each also raking back to the main roof.
              const sideAng = Math.atan2(Math.max(0.6, dTop - roofHere), dW / 2);
              for (const sgn of [-1, 1]) {
                const rp = at(px + sgn * dW / 4, (dTop + roofHere) / 2 + 0.2, inMid, dW / 2 + 0.25, 0.13, planeLen, dMat);
                if (horiz) { rp.rotation.x = inw * backAng; rp.rotation.z = sgn * sideAng; }
                else { rp.rotation.z = -inw * backAng; rp.rotation.x = -sgn * sideAng; }
              }
            }
          }
        }
      });

      if (layers.roof) {
        if (layers.xray || layers.explode) {
          roofMat.transparent = true;
          roofMat.opacity = layers.xray ? 0.4 : 0.55;
        }
        const fpAreaNow = customFp ? polygonArea(fpPoly) : width * depth;
        const groundEave = roofSpec.highWallHeightFt;
        // ROUND house wears an elliptical CONE (a flat roof = a low disc). No
        // gables, ridges, or valleys — one clean sweep matching the ring wall.
        if (roundFp) {
          const eave = groundEave + storeyLift;
          const ov = (oAll.north + oAll.south + oAll.east + oAll.west) / 4;
          const rx = width / 2 + ov;
          const rz = depth / 2 + ov;
          let roofMesh;
          if (roofSpec.roofType === 'flat') {
            const geo = new THREE.CylinderGeometry(1, 1, 0.4, 64);
            roofMesh = new THREE.Mesh(geo, roofMat);
            roofMesh.scale.set(rx, 1, rz);
            roofMesh.position.set(width / 2, eave + 0.2, depth / 2);
          } else {
            const rise = Math.max(1.5, (Number(spec.shell.roofPitch) || 0.32) * Math.min(width, depth) / 2);
            const geo = new THREE.ConeGeometry(1, rise, 64);
            roofMesh = new THREE.Mesh(geo, roofMat);
            roofMesh.scale.set(rx, 1, rz);
            roofMesh.position.set(width / 2, eave + rise / 2, depth / 2);
          }
          roofMesh.castShadow = true; roofMesh.receiveShadow = true;
          roofMesh.userData.roomId = 'roof-main';
          roofMesh.userData.generated = true;
          roomMeshes.push(roofMesh);
          group.add(roofMesh);
          group.add(addEdges(roofMesh));
        } else {
        // ═══ MESHES FROM THE PLAN — the roof plan above is the ONLY source
        // of roof geometry; this block just gives its pieces material form.
        // A porch ring builds a walkable deck (open sky — no roof piece).
        if (roofPlan.porchRings.length) {
          const deckMat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.8, map: grainTexture('wood'), bumpMap: bumpTexture('wood'), bumpScale: 0.08 });
          roofPlan.porchRings.forEach(({ rect, topEave, hostRect }) => {
            const deckY = topEave + JOINTS.DECK_LIFT;
            const deck = box(rect.w, 0.35, rect.d, rect.x + rect.w / 2, deckY, rect.y + rect.d / 2, deckMat);
            deck.name = 'Porch deck';
            deck.userData.roomId = 'roof-main';
            deck.userData.generated = true;
            roomMeshes.push(deck);
            group.add(addEdges(deck));
            // railing along the porch's OUTER edges (seams between ring
            // pieces and the face against the storey above stay open)
            const railTop = deckY + 3.1;
            const railEdges = [];
            if (Math.abs(rect.y - hostRect.y) < 0.05) railEdges.push(['h', rect.x, rect.x + rect.w, rect.y]);
            if (Math.abs(rect.y + rect.d - (hostRect.y + hostRect.d)) < 0.05) railEdges.push(['h', rect.x, rect.x + rect.w, rect.y + rect.d]);
            if (Math.abs(rect.x - hostRect.x) < 0.05) railEdges.push(['v', rect.y, rect.y + rect.d, rect.x]);
            if (Math.abs(rect.x + rect.w - (hostRect.x + hostRect.w)) < 0.05) railEdges.push(['v', rect.y, rect.y + rect.d, rect.x + rect.w]);
            railEdges.forEach(([dir, a0, a1, at]) => {
              const len = a1 - a0;
              if (len < 0.5) return;
              const rail = dir === 'h'
                ? box(len, 0.18, 0.18, (a0 + a1) / 2, railTop, at, deckMat)
                : box(0.18, 0.18, len, at, railTop, (a0 + a1) / 2, deckMat);
              rail.userData.roomId = 'roof-main'; rail.userData.generated = true;
              group.add(rail);
              const posts = Math.max(1, Math.round(len / 4));
              for (let pi = 0; pi <= posts; pi += 1) {
                const pa = a0 + (len * pi) / posts;
                const post = dir === 'h'
                  ? box(0.15, railTop - deckY, 0.15, pa, deckY + (railTop - deckY) / 2, at, deckMat)
                  : box(0.15, railTop - deckY, 0.15, at, deckY + (railTop - deckY) / 2, pa, deckMat);
                post.userData.roomId = 'roof-main'; post.userData.generated = true;
                group.add(post);
              }
            });
          });
        }
        roofPlan.pieces.forEach((seg) => {
          if (seg.kind === 'deckShed' || seg.kind === 'deckGable') return; // rendered below, round houses included
          const segPitch = (seg.level || 1) > 1 ? (tierPitchOf(seg.level) ?? pitchNow) : pitchNow;
          let mesh = null;
          if (seg.legacy && !['shed', 'flat'].includes(roofSpec.roofType)) {
            // the classic one-rectangle gable/hip keeps its long-proven mesh;
            // the plan models this exact shape, so caps and frame agree
            mesh = makeRoof(width, depth, wallHeight, spec.shell.roofPitch, roofMat, roofSpec, seg.o);
          } else if (roofSpec.roofType === 'shed' || roofSpec.roofType === 'flat' || seg.kind === 'wing') {
            // every planar piece (shed both axes, flat, stepped wings) is a
            // quad evaluated ON the plan surface — one law, one mesh
            mesh = makeShedPiece(seg.rect, seg.o, seg.topAt, roofMat);
          } else if (roofSpec.roofType === 'hip') {
            mesh = makeRoof(seg.rect.w, seg.rect.d, seg.eave, segPitch, roofMat, roofSpec, seg.o);
            mesh.position.x += seg.rect.x;
            mesh.position.z += seg.rect.y;
          } else {
            mesh = makeGableSegment(seg.rect, seg.eave, segPitch, seg.o, roofMat);
          }
          if (mesh) {
            mesh.name = seg.kind === 'wing' ? 'Roof (lower wing)' : 'Roof';
            mesh.userData.roomId = 'roof-main';
            mesh.userData.generated = true;
            roomMeshes.push(mesh);
            group.add(addEdges(mesh));
          }
        });
        }
        // COVERED-DECK canopies — plan pieces given material form with the
        // same mesh builders as the house roof (one roof law). Outside the
        // round/rect split above so a round house's covered deck renders too.
        roofPlan.pieces.forEach((seg) => {
          if (seg.kind !== 'deckShed' && seg.kind !== 'deckGable') return;
          const mesh = seg.kind === 'deckGable'
            ? makeGableSegment(seg.rect, seg.eave, seg.deckPitch, seg.o, roofMat)
            : makeShedPiece(seg.rect, seg.o, seg.topAt, roofMat);
          mesh.name = 'Deck roof';
          mesh.userData.roomId = seg.deckId; // tapping the canopy selects its deck
          mesh.userData.generated = true;
          roomMeshes.push(mesh);
          group.add(addEdges(mesh));
        });
      }

      const fixedGridSize = Number(spec.shell.outdoorGridSizeFt || DEFAULT_OUTDOOR_GRID_SIZE_FT);
      // The land itself: a soft green ground plane under everything, so the
      // model reads as a house on a site rather than a box in a void.
      if (layers.ground) {
      // The land fades out at its edges instead of ending in a hard square —
      // a radial meadow-green wash painted onto a canvas texture.
      const groundCanvas = document.createElement('canvas');
      groundCanvas.width = 256;
      groundCanvas.height = 256;
      const groundCtx = groundCanvas.getContext('2d');
      const fade = groundCtx.createRadialGradient(128, 128, 30, 128, 128, 128);
      fade.addColorStop(0, 'rgba(168, 177, 141, 1)');
      fade.addColorStop(0.62, 'rgba(168, 177, 141, 0.95)');
      fade.addColorStop(0.85, 'rgba(180, 184, 155, 0.45)');
      fade.addColorStop(1, 'rgba(190, 190, 168, 0)');
      groundCtx.fillStyle = fade;
      groundCtx.fillRect(0, 0, 256, 256);
      const groundSlope = Math.max(0, Number(siteOf(spec).slopeFt) || 0);
      const groundMat = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(groundCanvas), transparent: true, roughness: 1, side: THREE.DoubleSide });
      const gSize = fixedGridSize * 2.5;
      if (groundSlope <= 0) {
        // Flat site (legacy): one horizontal plane just below the floor datum.
        const groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(gSize, gSize), groundMat);
        groundPlane.rotation.x = -Math.PI / 2;
        groundPlane.position.set(width / 2, -0.52, depth / 2);
        groundPlane.receiveShadow = true;
        groundPlane.userData.generated = true;
        group.add(groundPlane);
      } else {
        // Sloped site: a real terrain surface warped to the grade plane, so the
        // land falls away and the house sits on it true to the drawings.
        const segs = 60;
        const gx0 = width / 2 - gSize / 2;
        const gz0 = depth / 2 - gSize / 2;
        const positions = [];
        const uvs = [];
        for (let i = 0; i <= segs; i += 1) {
          for (let j = 0; j <= segs; j += 1) {
            const wx = gx0 + (gSize * i) / segs;
            const wz = gz0 + (gSize * j) / segs;
            positions.push(wx, gradeElevationAt(spec, wx, wz) - 0.05, wz);
            uvs.push(i / segs, j / segs);
          }
        }
        const idx = (i, j) => i * (segs + 1) + j;
        const indices = [];
        for (let i = 0; i < segs; i += 1) {
          for (let j = 0; j < segs; j += 1) {
            indices.push(idx(i, j), idx(i, j + 1), idx(i + 1, j));
            indices.push(idx(i + 1, j), idx(i, j + 1), idx(i + 1, j + 1));
          }
        }
        const terrainGeo = new THREE.BufferGeometry();
        terrainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        terrainGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
        terrainGeo.setIndex(indices);
        terrainGeo.computeVertexNormals();
        const terrain = new THREE.Mesh(terrainGeo, groundMat);
        terrain.receiveShadow = true;
        terrain.userData.generated = true;
        terrain.name = `Sloped terrain (${groundSlope}′ fall to the ${siteOf(spec).slopeDir})`;
        group.add(terrain);

        // Contour lines: iso-elevation lines across the terrain (the topo look).
        // Grade is a tilted plane, so each contour is a straight line of constant
        // elevation — solve the grade equation for the axis coordinate.
        const site = siteOf(spec);
        const interval = Math.min(10, Math.max(1, Number(site.contourInterval) || 2));
        const dir = ['north', 'south', 'east', 'west'].includes(site.slopeDir) ? site.slopeDir : 'south';
        const axisIsY = dir === 'north' || dir === 'south';
        const span = axisIsY ? depth : width;
        const contourMat = new THREE.LineBasicMaterial({ color: 0x8a8468, transparent: true, opacity: 0.55 });
        const eLo = gradeElevationAt(spec, axisIsY ? width / 2 : gx0, axisIsY ? gz0 + gSize : depth / 2);
        const eHi = gradeElevationAt(spec, axisIsY ? width / 2 : gx0 + gSize, axisIsY ? gz0 : depth / 2);
        const [lo, hi] = [Math.min(eLo, eHi), Math.max(eLo, eHi)];
        for (let e = Math.ceil(lo / interval) * interval; e <= hi; e += interval) {
          // coordinate along the slope axis where grade == e
          const frac = (-e - (Number(site.gradeFt ?? 1.5))) / groundSlope; // t in the grade eqn
          if (frac < -6 || frac > 6) continue;
          const coord = dir === 'south' ? frac * depth
            : dir === 'north' ? depth - frac * depth
              : dir === 'east' ? frac * width
                : width - frac * width;
          const pts = axisIsY
            ? [new THREE.Vector3(gx0, e - 0.02, coord), new THREE.Vector3(gx0 + gSize, e - 0.02, coord)]
            : [new THREE.Vector3(coord, e - 0.02, gz0), new THREE.Vector3(coord, e - 0.02, gz0 + gSize)];
          const cl = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), contourMat);
          cl.userData.generated = true;
          group.add(cl);
        }
      }

      // The flat reference grid only makes sense on flat ground — on a sloped
      // site it floats downhill and buries uphill; the contour lines take over
      // as the scale/elevation reference there.
      if (groundSlope <= 0) {
        const grid = new THREE.GridHelper(fixedGridSize, Math.max(48, Math.round(fixedGridSize / 4)), 0x6e6a58, 0x8b8672);
        grid.material.transparent = true;
        grid.material.opacity = 0.8;
        // Just above the pad's top surface (y=0) so the scale grid peeks through
        // the site pad instead of being buried under it.
        grid.position.set(width / 2, 0.03, depth / 2);
        grid.name = `Fixed outdoor reference grid (${fixedGridSize}' x ${fixedGridSize}')`;
        grid.userData.generated = true;
        group.add(grid);
      }
      }

      // Direction markers ON the model — the least ambiguous compass there is.
      // Placed by the SAME axes as everything else: north is −z, south +z (the
      // solar face, where the sun and the deeper south overhang are), east +x,
      // west −x. A big south overhang sits right next to the 'S' disc.
      if (showCompass) {
        const oh = resolveOverhangs(spec.shell);
        const dirMark = (letter, wx, wz, rgb) => {
          const canvas = document.createElement('canvas');
          canvas.width = 128; canvas.height = 128;
          const ctx = canvas.getContext('2d');
          ctx.beginPath(); ctx.arc(64, 64, 60, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(251,250,246,0.92)'; ctx.fill();
          ctx.lineWidth = 7; ctx.strokeStyle = rgb; ctx.stroke();
          ctx.fillStyle = rgb; ctx.font = 'bold 78px system-ui, sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(letter, 64, 70);
          const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }));
          sprite.scale.set(3.2, 3.2, 1);
          sprite.position.set(wx, 2.2, wz);
          sprite.renderOrder = 999;
          sprite.userData.generated = true;
          group.add(sprite);
        };
        const cx = width / 2, cz = depth / 2;
        dirMark('N', cx, -(oh.north + 4), '#ae452f');            // north: −z
        dirMark('S', cx, depth + oh.south + 4, '#3c6472');       // south: +z (solar)
        dirMark('E', width + oh.east + 4, cz, '#565a4f');        // east: +x
        dirMark('W', -(oh.west + 4), cz, '#565a4f');             // west: −x
      }

      // The 3D view reflects the selection like Plan and Detail do: whatever
      // is selected gets a crisp warm OUTLINE (post pass) plus a faint warm
      // glow — wall pieces, opening assemblies, frame members all rim as one.
      const outlined = [];
      group.traverse((node) => {
        if (!node.isMesh || !node.material || !node.material.emissive) return;
        if (String(node.userData.roomId || '') === String(selectedRoom || '')) {
          node.material.emissive = new THREE.Color(0xc88a5b);
          node.material.emissiveIntensity = 0.16;
          outlined.push(node);
        }
      });
      outlinePass.selectedObjects = outlined;

      // Exploded view: pull the systems apart so their joints and layers read —
      // roof lifts, walls slide outward by side, upper bands rise a little more,
      // floor plates hover, the foundation drops. Everything stays clickable, so
      // you can still select and edit any part while it's exploded.
      if (layers.explode) {
        const sideOut = { north: [0, 0, -6], south: [0, 0, 6], east: [6, 0, 0], west: [-6, 0, 0] };
        group.traverse((node) => {
          if (!node.isMesh) return;
          const id = String(node.userData.roomId || '');
          const name = String(node.name || '');
          if (id === 'roof-main' || /roof/i.test(name)) { node.position.y += 9; return; }
          if (id.startsWith('wall-')) {
            // Edge walls (wall-e3) carry their facing in userData.wallSide.
            const side = node.userData.wallSide || id.split('-')[1];
            const off = sideOut[side];
            if (off) { node.position.x += off[0]; node.position.z += off[2]; }
            const uMatch = id.match(/-u(\d*)$/);
            if (uMatch) {
              const level = uMatch[1] ? Number(uMatch[1]) : 2;
              node.position.y += (level - 1) * 3;
            }
            return;
          }
          if (id.startsWith('opening-')) {
            const opening = (spec.openings || [])[Number(id.replace('opening-', ''))];
            if (opening?.wall === 'roof') { node.position.y += 9; return; }
            const off = sideOut[opening?.wall];
            if (off) { node.position.x += off[0]; node.position.z += off[2]; }
            return;
          }
          if (/floor plate/i.test(name) || node.userData.category === 'floor') { node.position.y += 5; return; }
          if (id === 'site-pad' || /stem wall/i.test(name)) { node.position.y -= 2.5; }
        });
      }

      scene.add(group);
    }

    function box(sx, sy, sz, x, y, z, material) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.generated = true;
      return mesh;
    }

    // Blender-style edge definition: a fine dark crease line along every
    // corner sharper than 30° — added as a CHILD of the mesh so it rides
    // drags, explode, and selection for free (LineSegments isn't raycast or
    // emissive-tinted). EdgesGeometry position-hashes, so it works on both
    // indexed boxes and the roof-slab triangle soup.
    const edgeInk = new THREE.LineBasicMaterial({ color: 0x3a332a, transparent: true, opacity: 0.35 });
    function addEdges(mesh) {
      try {
        const lines = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30), edgeInk);
        lines.userData.generated = true;
        mesh.add(lines);
      } catch { /* exotic geometry — skip the crease lines */ }
      return mesh;
    }

    // Raked wall pieces for shed side walls: rakedPieceZ runs along z between
    // a0..a1 (a north/south fall rakes the east/west walls); rakedPieceX runs
    // along x (an east/west fall rakes the north/south walls). Base at yBot,
    // top raking h0→h1.
    function rakedPieceX(thickCenter, t, a0, a1, yBot, h0, h1, material) {
      const z0 = thickCenter - t / 2;
      const z1 = thickCenter + t / 2;
      const geometry = new THREE.BufferGeometry();
      const vertices = new Float32Array([
        a0, yBot, z0, a0, yBot, z1, a0, h0, z1, a0, h0, z0,
        a1, yBot, z0, a1, yBot, z1, a1, h1, z1, a1, h1, z0
      ]);
      const indices = [
        0, 2, 1, 0, 3, 2,
        4, 5, 6, 4, 6, 7,
        0, 1, 5, 0, 5, 4,
        3, 6, 2, 3, 7, 6,
        0, 4, 7, 0, 7, 3,
        1, 2, 6, 1, 6, 5
      ];
      geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.generated = true;
      return mesh;
    }
    function rakedPieceZ(thickCenter, t, a0, a1, yBot, h0, h1, material) {
      const x0 = thickCenter - t / 2;
      const x1 = thickCenter + t / 2;
      const geometry = new THREE.BufferGeometry();
      const vertices = new Float32Array([
        x0, yBot, a0, x1, yBot, a0, x1, h0, a0, x0, h0, a0,
        x0, yBot, a1, x1, yBot, a1, x1, h1, a1, x0, h1, a1
      ]);
      const indices = [
        0, 1, 2, 0, 2, 3,
        4, 6, 5, 4, 7, 6,
        0, 4, 5, 0, 5, 1,
        3, 2, 6, 3, 6, 7,
        0, 3, 7, 0, 7, 4,
        1, 5, 6, 1, 6, 2
      ];
      geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.generated = true;
      return mesh;
    }

    // A wall run built as PIECES so its openings are true holes: full-height
    // stretches between openings, a band below each sill, a header above each
    // opening. The cut faces are the reveal — the wall's own thickness shows.
    // hAt(along) gives the top height, so raked shed walls cut the same way.
    // yBase: where the wall's BOTTOM sits — 0 on a slab, the stem's top on a
    // stem wall foundation (straw bale bears ON the stem, never through it).
    function wallRunMeshes({ horizontal, thickCenter, t, a0, a1, hAt, mat, gaps, yBase = 0 }) {
      const meshes = [];
      const hA = hAt(a0);
      const hB = hAt(a1);
      const lerpH = (a) => hA + (hB - hA) * ((a - a0) / Math.max(0.01, a1 - a0));
      const flatPiece = (pa, pb, yBot, yTop) => {
        const len = pb - pa;
        const h = yTop - yBot;
        if (len < 0.05 || h < 0.05) return;
        meshes.push(horizontal
          ? box(len, h, t, (pa + pb) / 2, yBot + h / 2, thickCenter, mat)
          : box(t, h, len, thickCenter, yBot + h / 2, (pa + pb) / 2, mat));
      };
      const piece = (pa, pb, yBot, yTopA, yTopB) => {
        if (pb - pa < 0.05) return;
        if (Math.abs(yTopA - yTopB) < 0.02) {
          flatPiece(pa, pb, yBot, Math.min(yTopA, yTopB));
          return;
        }
        if (Math.min(yTopA, yTopB) - yBot < 0.05) return;
        // Runs along either axis rake when their two end heights differ —
        // a north/south fall rakes vertical runs, an east/west fall rakes
        // horizontal ones.
        meshes.push(horizontal
          ? rakedPieceX(thickCenter, t, pa, pb, yBot, yTopA, yTopB, mat)
          : rakedPieceZ(thickCenter, t, pa, pb, yBot, yTopA, yTopB, mat));
      };
      const clean = (gaps || [])
        .map((g) => ({ ref: g, sill: g.sill, top: g.top, from: Math.max(a0 + 0.2, g.from), to: Math.min(a1 - 0.2, g.to) }))
        .filter((g) => g.to - g.from > 0.4 && g.sill < Math.min(lerpH(g.from), lerpH(g.to)) - 0.8)
        .sort((ga, gb) => ga.from - gb.from);
      let at = a0;
      for (const g of clean) {
        if (g.from < at + 0.05) continue; // overlapping opening: wall stays solid there
        g.ref.cut = true; // the opening assembly recesses into this real hole
        piece(at, g.from, yBase, lerpH(at), lerpH(g.from));
        const gapTop = Math.min(g.top, Math.min(lerpH(g.from), lerpH(g.to)) - 0.25);
        if (g.sill > yBase + 0.2) flatPiece(g.from, g.to, yBase, g.sill);
        piece(g.from, g.to, gapTop, lerpH(g.from), lerpH(g.to));
        at = g.to;
      }
      piece(at, a1, yBase, lerpH(at), lerpH(a1));
      return meshes;
    }

    // Roof planes are SLABS now, not paper: a face (3 or 4 points, wound CCW
    // seen from above) grows a parallel underside `thk` below plus edge strips
    // all around — the strip along an eave IS the fascia, the underside over
    // an overhang IS the soffit. Returns raw triangle positions so multi-face
    // roofs (hip, gable segments) can merge into one selectable mesh.
    function slabTris(points, thk) {
      const tris = [];
      const bot = points.map(([px, py, pz]) => [px, py - thk, pz]);
      for (let i = 1; i < points.length - 1; i += 1) tris.push(...points[0], ...points[i], ...points[i + 1]);
      for (let i = 1; i < bot.length - 1; i += 1) tris.push(...bot[0], ...bot[i + 1], ...bot[i]);
      for (let i = 0; i < points.length; i += 1) {
        const j = (i + 1) % points.length;
        tris.push(...points[i], ...bot[i], ...bot[j], ...points[i], ...bot[j], ...points[j]);
      }
      return tris;
    }
    function meshFromTris(positions, material) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
      geometry.computeVertexNormals();
      // Box-projected UVs in feet — without them the standing-seam (or any)
      // texture never rendered on stepped/L roof pieces: they read as flat
      // untextured gray next to the seamed legacy gable.
      const pos = geometry.getAttribute('position');
      const nor = geometry.getAttribute('normal');
      const uvs = new Float32Array(pos.count * 2);
      // The metal tile draws 12 seams and the material repeats it 3× per UV
      // unit — 36 seams per unit. One unit = 48 ft puts a standing seam every
      // 16 inches, which is what a real roof does.
      const UV_SCALE = 1 / 48;
      for (let i = 0; i < pos.count; i += 1) {
        const nx = Math.abs(nor.getX(i)); const ny = Math.abs(nor.getY(i)); const nz = Math.abs(nor.getZ(i));
        if (ny >= nx && ny >= nz) { uvs[i * 2] = pos.getX(i) * UV_SCALE; uvs[i * 2 + 1] = pos.getZ(i) * UV_SCALE; }
        else if (nx >= nz) { uvs[i * 2] = pos.getZ(i) * UV_SCALE; uvs[i * 2 + 1] = pos.getY(i) * UV_SCALE; }
        else { uvs[i * 2] = pos.getX(i) * UV_SCALE; uvs[i * 2 + 1] = pos.getY(i) * UV_SCALE; }
      }
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.generated = true;
      return mesh;
    }
    const ROOF_THK = 0.3;

    // One sloped plane over a rect: high along highSide (tucked against the
    // upper block), falling away at the given pitch — the stepped roof's wing.
    function makeStepRoofPlane(rect, highSide, topY, pitch, o, material) {
      const x0 = rect.x - o.west, x1 = rect.x + rect.w + o.east;
      const z0 = rect.y - o.north, z1 = rect.y + rect.d + o.south;
      const run = (highSide === 'north' || highSide === 'south') ? (z1 - z0) : (x1 - x0);
      const drop = Math.max(0.1, run * pitch);
      const yAt = (px, pz) => {
        if (highSide === 'north') return topY - ((pz - z0) / (z1 - z0)) * drop;
        if (highSide === 'south') return topY - ((z1 - pz) / (z1 - z0)) * drop;
        if (highSide === 'west') return topY - ((px - x0) / (x1 - x0)) * drop;
        return topY - ((x1 - px) / (x1 - x0)) * drop;
      };
      return meshFromTris(slabTris([
        [x0, yAt(x0, z0), z0],
        [x1, yAt(x1, z0), z0],
        [x1, yAt(x1, z1), z1],
        [x0, yAt(x0, z1), z1]
      ], ROOF_THK), material);
    }

    // A flat-or-sloped quad over a rect where height is any function of the
    // plan point (x, z) — flat roofs (constant) and coplanar pieces of the
    // global shed plane, whichever axis it falls along.
    function makeShedPiece(rect, o, yAt, material) {
      const x0 = rect.x - o.west, x1 = rect.x + rect.w + o.east;
      const z0 = rect.y - o.north, z1 = rect.y + rect.d + o.south;
      return meshFromTris(slabTris([
        [x0, yAt(x0, z0), z0],
        [x1, yAt(x1, z0), z0],
        [x1, yAt(x1, z1), z1],
        [x0, yAt(x0, z1), z1]
      ], ROOF_THK), material);
    }

    // A gable over one rect segment with the ridge along its LONGER axis
    // (an L's wing gets a wing-wise ridge). Two slopes + two end triangles.
    function makeGableSegment(rect, eave, pitch, o, material) {
      const x0 = rect.x - o.west, x1 = rect.x + rect.w + o.east;
      const z0 = rect.y - o.north, z1 = rect.y + rect.d + o.south;
      const spanX = x1 - x0, spanZ = z1 - z0;
      const alongX = spanX >= spanZ;         // ridge runs east-west when wider
      const ridgeY = eave + 0.25 + (Math.min(spanX, spanZ) / 2) * pitch;
      const base = eave + 0.25;
      const verts = [];
      const quad = (p0, p1, p2, p3) => { verts.push(...slabTris([p0, p1, p2, p3], ROOF_THK)); }; // slope = slab (fascia edge)
      const tri = (p0, p1, p2) => { verts.push(...p0, ...p1, ...p2); };                          // gable end stays a face
      if (alongX) {
        const cz = (z0 + z1) / 2;
        const rA = [x0, ridgeY, cz], rB = [x1, ridgeY, cz];
        quad([x0, base, z0], [x1, base, z0], rB, rA);               // north slope
        quad([x1, base, z1], [x0, base, z1], rA, rB);               // south slope
        tri([x0, base, z1], [x0, base, z0], rA);                    // west gable end
        tri([x1, base, z0], [x1, base, z1], rB);                    // east gable end
      } else {
        const cx = (x0 + x1) / 2;
        const rA = [cx, ridgeY, z0], rB = [cx, ridgeY, z1];
        quad([x0, base, z1], [x0, base, z0], rA, rB);               // west slope
        quad([x1, base, z0], [x1, base, z1], rB, rA);               // east slope
        tri([x0, base, z0], [x1, base, z0], rA);                    // north gable end
        tri([x1, base, z1], [x0, base, z1], rB);                    // south gable end
      }
      return meshFromTris(verts, material);
    }

    function addResizeHandles(group, parts, id, x, y, width, depth, height) {
      const handleMaterial = new THREE.MeshStandardMaterial({ color: 0x174f45, roughness: 0.45 });
      const points = [
        { corner: 'nw', x, z: y },
        { corner: 'ne', x: x + width, z: y },
        { corner: 'se', x: x + width, z: y + depth },
        { corner: 'sw', x, z: y + depth }
      ];
      points.forEach((point) => {
        const handle = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.35, 1.35), handleMaterial);
        handle.position.set(point.x, height, point.z);
        handle.userData.generated = true;
        handle.userData.resizeHandle = { id, corner: point.corner };
        handle.castShadow = true;
        handle.receiveShadow = true;
        resizeHandles.push(handle);
        parts.handles.push(handle);
        group.add(handle);
      });
    }

    function makeRoof(width, depth, wallHeight, pitch, material, roofSpec, overhangs) {
      const rise = depth * pitch;
      const o = overhangs || { north: 1.6, south: 1.6, east: 1.6, west: 1.6 };
      if (roofSpec.roofType === 'shed') {
        // The walls' shed eave line includes the storey lift (the upper bands
        // ride up to it) — the roof must ride the SAME line. wallHeight comes
        // in lifted; the raw roofSpec heights are ground-storey only. Without
        // this, a two-storey shed drew its roof at the ground plane, 10+ feet
        // below its own walls and rafters.
        const lift = Math.max(0, wallHeight - roofSpec.highWallHeightFt);
        // The plane passes THROUGH the wall tops AT THE WALL LINES and keeps
        // the same slope over the overhangs. Reaching the wall heights only
        // at the overhang tips diluted the slope, so a tall south wall stood
        // ~a foot proud of its own roof ("why does the S wall pierce?").
        const ewFall = roofSpec.axis === 'ew';
        if (ewFall) {
          const eastHeight = roofSpec.eastWallHeightFt + lift + JOINTS.ROOF_BEARING;
          const westHeight = roofSpec.westWallHeightFt + lift + JOINTS.ROOF_BEARING;
          const slopeShed = width > 0 ? (eastHeight - westHeight) / width : 0;
          const mesh = meshFromTris(slabTris([
            [-o.west, westHeight - slopeShed * o.west, -o.north],
            [width + o.east, eastHeight + slopeShed * o.east, -o.north],
            [width + o.east, eastHeight + slopeShed * o.east, depth + o.south],
            [-o.west, westHeight - slopeShed * o.west, depth + o.south]
          ], ROOF_THK), material);
          mesh.name = 'Shed / lean-to roof plane';
          return mesh;
        }
        const southHeight = roofSpec.southWallHeightFt + lift + JOINTS.ROOF_BEARING;
        const northHeight = roofSpec.northWallHeightFt + lift + JOINTS.ROOF_BEARING;
        const slopeShed = depth > 0 ? (southHeight - northHeight) / depth : 0;
        const mesh = meshFromTris(slabTris([
          [-o.west, northHeight - slopeShed * o.north, -o.north],
          [width + o.east, northHeight - slopeShed * o.north, -o.north],
          [width + o.east, southHeight + slopeShed * o.south, depth + o.south],
          [-o.west, southHeight + slopeShed * o.south, depth + o.south]
        ], ROOF_THK), material);
        mesh.name = 'Shed / lean-to roof plane';
        return mesh;
      }
      if (roofSpec.roofType === 'flat') {
        // A near-flat roof: one slab just above the walls, extended to the
        // overhangs. (Low-slope drainage is left implicit at this scale.)
        const y = wallHeight + 0.25;
        const mesh = meshFromTris(slabTris([
          [-o.west, y, -o.north],
          [width + o.east, y, -o.north],
          [width + o.east, y, depth + o.south],
          [-o.west, y, depth + o.south]
        ], ROOF_THK), material);
        mesh.name = 'Flat roof plane';
        return mesh;
      }
      if (roofSpec.roofType === 'hip') {
        // A hip roof: all four sides slope up to a ridge. The ridge runs along
        // the longer axis and is inset from the short ends by half the short
        // span (a standard 45° hip), collapsing to a point when the plan is
        // square. Two trapezoids on the long sides, two triangles on the ends.
        const x0 = -o.west, x1 = width + o.east, z0 = -o.north, z1 = depth + o.south;
        const spanX = x1 - x0, spanZ = z1 - z0;
        const ridgeY = wallHeight + Math.min(spanX, spanZ) / 2 * pitch;
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        let rA, rB;
        if (spanX >= spanZ) {
          const inset = spanZ / 2;
          rA = [x0 + inset, ridgeY, cz];
          rB = [x1 - inset, ridgeY, cz];
        } else {
          const inset = spanX / 2;
          rA = [cx, ridgeY, z0 + inset];
          rB = [cx, ridgeY, z1 - inset];
        }
        const c00 = [x0, wallHeight, z0], c10 = [x1, wallHeight, z0], c11 = [x1, wallHeight, z1], c01 = [x0, wallHeight, z1];
        // Wind each face counter-clockwise seen from outside so normals point up/out.
        const faces = spanX >= spanZ
          ? [[c00, c10, rB, rA], [c11, c01, rA, rB], [c10, c11, rB], [c01, c00, rA]]
          : [[c10, c11, rB, rA], [c01, c00, rA, rB], [c00, c10, rA], [c11, c01, rB]];
        const verts = [];
        for (const face of faces) verts.push(...slabTris(face, ROOF_THK)); // each hip face is a slab
        const mesh = meshFromTris(verts, material);
        mesh.name = 'Hip roof';
        return mesh;
      }
      const shape = new THREE.Shape();
      shape.moveTo(-o.west, wallHeight);
      shape.lineTo(width + o.east, wallHeight);
      shape.lineTo(width + o.east, wallHeight + 0.25);
      shape.lineTo(width / 2, wallHeight + rise);
      shape.lineTo(-o.west, wallHeight + 0.25);
      shape.lineTo(-o.west, wallHeight);
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: depth + o.north + o.south, bevelEnabled: false });
      const mesh = new THREE.Mesh(geometry, material);
      // The profile is drawn in world coords already (x = plan x, y = height)
      // and the extrusion IS the plan depth — no rotation. A leftover
      // rotation.x = -PI/2 from an older profile stood the whole gable roof
      // on its edge beside the house.
      mesh.position.set(0, 0, -o.north);
      mesh.userData.generated = true;
      return mesh;
    }

    function makeLabel(text, roomWidth) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgba(251, 250, 246, 0.94)';
      ctx.fillRect(0, 0, 512, 128);
      ctx.strokeStyle = 'rgba(60, 100, 114, 0.55)';
      ctx.lineWidth = 3;
      ctx.strokeRect(2, 2, 508, 124);
      ctx.fillStyle = '#26424C';
      ctx.font = '48px "Architects Daughter", "Segoe Print", "Comic Sans MS", cursive';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 256, 64, 470);
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(Math.min(Math.max(roomWidth, 7), 11), 2.6, 1);
      sprite.userData.generated = true;
      return sprite;
    }

    function selectionHalo(width, depth, x, y, z) {
      const shape = new THREE.Shape();
      const pad = 0.35;
      shape.moveTo(-width / 2 - pad, -depth / 2 - pad);
      shape.lineTo(width / 2 + pad, -depth / 2 - pad);
      shape.lineTo(width / 2 + pad, depth / 2 + pad);
      shape.lineTo(-width / 2 - pad, depth / 2 + pad);
      shape.lineTo(-width / 2 - pad, -depth / 2 - pad);
      const points = shape.getPoints();
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(point.x, 0, point.y)));
      const material = new THREE.LineBasicMaterial({ color: 0x3c6472, linewidth: 3 });
      const line = new THREE.Line(geometry, material);
      line.position.set(x, y, z);
      line.userData.generated = true;
      return line;
    }

    function updatePointer(event) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
    }

    // Right-click: remember where the button went down so the context menu
    // only opens on a CLICK — a right-DRAG is OrbitControls' pan, and the
    // contextmenu event it fires on release must not pop a menu mid-pan.
    let rightDownAt = null;

    function onPointerDown(event) {
      if (event.button === 2) { rightDownAt = { x: event.clientX, y: event.clientY }; return; }
      if (event.button !== 0) return; // middle/right never start an object drag
      updatePointer(event);
      const handleHit = raycaster.intersectObjects(resizeHandles, false)[0];
      if (handleHit?.object?.userData?.resizeHandle) {
        const { id, corner } = handleHit.object.userData.resizeHandle;
        const object = [...spec.rooms, ...(spec.elements || []), ...getSpecialBimObjects(spec)].find((item) => item.id === id);
        if (!object) return;
        callbacksRef.current.onSelectRoom(id);
        renderer.domElement.setPointerCapture(event.pointerId);
        controls.enabled = false; // grabbing an object must not also orbit the camera
        if (!raycaster.ray.intersectPlane(floorPlane, dragPoint)) return;
        const anchor = {
          nw: { x: object.x + object.w, z: object.y + object.d },
          ne: { x: object.x, z: object.y + object.d },
          se: { x: object.x, z: object.y },
          sw: { x: object.x + object.w, z: object.y }
        }[corner];
        dragState = {
          mode: 'resize',
          id,
          pointerId: event.pointerId,
          corner,
          anchorX: anchor.x,
          anchorZ: anchor.z,
          startX: dragPoint.x,
          startZ: dragPoint.z,
          original: { x: object.x, y: object.y, w: object.w, d: object.d },
          bounds: objectBounds(spec, object),
          began: false,
          moved: false
        };
        return;
      }
      const buildingContext = ['foundation', 'shell', 'frame', 'floor', 'walls', 'roof', 'windows'].includes(context);
      const targets = buildingContext
        ? roomMeshes.filter(m => !m.userData.roomId || !spec.rooms.some(r => r.id === m.userData.roomId))
        : roomMeshes;
      const hit = raycaster.intersectObjects(targets, false)[0];
      if (!hit?.object?.userData?.roomId) return;
      const objectId = hit.object.userData.roomId;
      // Openings slide ALONG their wall — grab a window in 3D and move it.
      if (objectId.startsWith('opening-')) {
        const openingIndex = Number(objectId.replace('opening-', ''));
        const opening = spec.openings?.[openingIndex];
        if (!opening || opening.wall === 'roof') {
          callbacksRef.current.onSelectRoom(objectId);
          return;
        }
        renderer.domElement.setPointerCapture(event.pointerId);
        controls.enabled = false;
        if (!raycaster.ray.intersectPlane(floorPlane, dragPoint)) return;
        const horiz = opening.wall === 'north' || opening.wall === 'south';
        const run = horiz ? Number(spec.shell.widthFt) : Number(spec.shell.depthFt);
        const startAlong = Number(horiz ? opening.x : opening.y) || 0;
        const meshes = [];
        scene.traverse((node) => { if (node.isMesh && node.userData?.roomId === objectId) meshes.push(node); });
        dragState = { mode: 'openingSlide', id: objectId, pointerId: event.pointerId, horiz, run, width: Number(opening.widthFt) || 3, startAlong, currentAlong: startAlong, startX: dragPoint.x, startZ: dragPoint.z, meshes, began: false, moved: false };
        return;
      }
      // Ground walls (and edge segments) drag IN and OUT — grab the wall and
      // push it; the footprint follows on release. Upper bands move via the
      // storey controls; the roof/pad follow the shell.
      if (objectId.startsWith('wall-') && !/-u\d*$/.test(objectId)) {
        const side = hit.object.userData.wallSide;
        if (!side) {
          callbacksRef.current.onSelectRoom(objectId);
          return;
        }
        renderer.domElement.setPointerCapture(event.pointerId);
        controls.enabled = false;
        if (!raycaster.ray.intersectPlane(floorPlane, dragPoint)) return;
        const horiz = side === 'north' || side === 'south';
        const outSign = side === 'south' || side === 'east' ? 1 : -1;
        const meshes = [];
        scene.traverse((node) => { if (node.isMesh && node.userData?.roomId === objectId) meshes.push(node); });
        dragState = { mode: 'wallSlide', id: objectId, pointerId: event.pointerId, horiz, outSign, currentOffset: 0, startX: dragPoint.x, startZ: dragPoint.z, meshes, began: false, moved: false };
        return;
      }
      const object = [...spec.rooms, ...(spec.elements || []), ...getSpecialBimObjects(spec)].find((item) => item.id === objectId);
      if (!object) {
        callbacksRef.current.onSelectRoom(objectId);
        return;
      }
      if (objectId === 'site-pad' || objectId === 'roof-main') {
        callbacksRef.current.onSelectRoom(objectId);
        return;
      }
      renderer.domElement.setPointerCapture(event.pointerId);
      controls.enabled = false;
      if (!raycaster.ray.intersectPlane(floorPlane, dragPoint)) return;
      const footprint = hit.object.userData.footprint || { w: 1, d: 1 };
      dragState = {
        id: objectId,
        pointerId: event.pointerId,
        startX: dragPoint.x,
        startZ: dragPoint.z,
        offsetX: dragPoint.x - hit.object.position.x,
        offsetZ: dragPoint.z - hit.object.position.z,
        w: footprint.w,
        d: footprint.d,
        bounds: objectBounds(spec, object),
        moved: false,
        began: false
      };
    }

    function onPointerMove(event) {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      updatePointer(event);
      if (!raycaster.ray.intersectPlane(floorPlane, dragPoint)) return;
      const delta = Math.hypot(dragPoint.x - dragState.startX, dragPoint.z - dragState.startZ);
      if (!dragState.began && delta < 0.25) return;
      if (!dragState.began) {
        dragState.began = true;
        callbacksRef.current.onMoveStart();
        renderer.domElement.style.cursor = dragState.mode === 'resize' ? 'nwse-resize' : 'grabbing';
      }
      dragState.moved = true;
      if (dragState.mode === 'openingSlide') {
        const rawAlong = dragState.startAlong + (dragState.horiz ? dragPoint.x - dragState.startX : dragPoint.z - dragState.startZ);
        const along = clamp(Math.round(rawAlong * 2) / 2, 0, Math.max(0, dragState.run - dragState.width));
        const deltaAlong = along - dragState.currentAlong;
        if (deltaAlong) dragState.meshes.forEach((m) => { if (dragState.horiz) m.position.x += deltaAlong; else m.position.z += deltaAlong; });
        dragState.currentAlong = along;
        dragState.finalAlong = along;
        return;
      }
      if (dragState.mode === 'wallSlide') {
        const raw = dragState.horiz ? dragPoint.z - dragState.startZ : dragPoint.x - dragState.startX;
        const offset = clamp(Math.round(raw * 2) / 2, -24, 24);
        const delta = offset - dragState.currentOffset;
        if (delta) dragState.meshes.forEach((m) => { if (dragState.horiz) m.position.z += delta; else m.position.x += delta; });
        dragState.currentOffset = offset;
        dragState.finalOffset = offset * dragState.outSign;
        return;
      }
      const bounds = dragState.bounds || { minX: 0, minY: 0, maxX: spec.shell.widthFt, maxY: spec.shell.depthFt };
      if (dragState.mode === 'resize') {
        const minSize = 4;
        const px = clamp(Math.round(dragPoint.x * 2) / 2, bounds.minX, bounds.maxX);
        const pz = clamp(Math.round(dragPoint.z * 2) / 2, bounds.minY, bounds.maxY);
        const rawX = Math.min(px, dragState.anchorX);
        const rawY = Math.min(pz, dragState.anchorZ);
        let nextW = Math.max(minSize, Math.abs(px - dragState.anchorX));
        let nextD = Math.max(minSize, Math.abs(pz - dragState.anchorZ));
        let nextX = rawX;
        let nextY = rawY;
        if (nextX + nextW > bounds.maxX) nextW = bounds.maxX - nextX;
        if (nextY + nextD > bounds.maxY) nextD = bounds.maxY - nextY;
        nextX = clamp(Math.round(nextX * 10) / 10, bounds.minX, Math.max(bounds.minX, bounds.maxX - nextW));
        nextY = clamp(Math.round(nextY * 10) / 10, bounds.minY, Math.max(bounds.minY, bounds.maxY - nextD));
        nextW = clamp(Math.round(nextW * 10) / 10, minSize, bounds.maxX - nextX);
        nextD = clamp(Math.round(nextD * 10) / 10, minSize, bounds.maxY - nextY);
        dragState.finalX = nextX;
        dragState.finalY = nextY;
        dragState.finalW = nextW;
        dragState.finalD = nextD;
        updateObjectParts(dragState.id, nextX, nextY, nextW, nextD);
        callbacksRef.current.onDimensionPreview({ id: dragState.id, w: nextW, d: nextD, x: nextX, y: nextY, mode: 'resize' });
        return;
      }
      const centerX = clamp(Math.round((dragPoint.x - dragState.offsetX) * 2) / 2, bounds.minX + dragState.w / 2, bounds.maxX - dragState.w / 2);
      const centerZ = clamp(Math.round((dragPoint.z - dragState.offsetZ) * 2) / 2, bounds.minY + dragState.d / 2, bounds.maxY - dragState.d / 2);
      dragState.finalX = Math.round((centerX - dragState.w / 2) * 10) / 10;
      dragState.finalY = Math.round((centerZ - dragState.d / 2) * 10) / 10;
      updateObjectParts(dragState.id, dragState.finalX, dragState.finalY, dragState.w, dragState.d);
      callbacksRef.current.onDimensionPreview({ id: dragState.id, w: dragState.w, d: dragState.d, x: dragState.finalX, y: dragState.finalY, mode: 'move' });
    }

    function updateObjectParts(id, x, y, width, depth) {
      const parts = draggableParts.get(id);
      if (!parts) return;
      const centerX = x + width / 2;
      const centerZ = y + depth / 2;
      if (parts.mesh) {
        parts.mesh.position.x = centerX;
        parts.mesh.position.z = centerZ;
        parts.mesh.scale.x = width / parts.baseW;
        parts.mesh.scale.z = depth / parts.baseD;
        parts.mesh.userData.footprint = { w: width, d: depth };
      }
      if (parts.label) {
        parts.label.position.x = centerX;
        parts.label.position.z = centerZ;
        parts.label.scale.x = Math.min(width, 9);
      }
      if (parts.halo) {
        parts.halo.position.x = centerX;
        parts.halo.position.z = centerZ;
        parts.halo.scale.x = width / parts.w;
        parts.halo.scale.z = depth / parts.d;
      }
      const handlePoints = [
        { x, z: y },
        { x: x + width, z: y },
        { x: x + width, z: y + depth },
        { x, z: y + depth }
      ];
      parts.handles.forEach((handle, index) => {
        const point = handlePoints[index];
        if (point) handle.position.set(point.x, handle.position.y, point.z);
      });
    }

    function onPointerUp(event) {
      // Recover BEFORE the dragState guard: pointerdown may have captured the
      // pointer and disabled orbit, then bailed without ever creating a drag
      // (floor-plane miss) — the camera must never stay locked.
      controls.enabled = true;
      renderer.domElement.style.cursor = '';
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      const finished = dragState;
      dragState = null;
      callbacksRef.current.onDimensionPreview(null);
      if (finished.mode === 'openingSlide') {
        if (finished.moved && Number.isFinite(finished.finalAlong)) callbacksRef.current.onMoveEnd(finished.id, finished.finalAlong, 0);
        else callbacksRef.current.onSelectRoom(finished.id);
      } else if (finished.mode === 'wallSlide') {
        if (finished.moved && finished.finalOffset) callbacksRef.current.onMoveEnd(finished.id, finished.finalOffset, 0);
        else callbacksRef.current.onSelectRoom(finished.id);
      } else if (finished.mode === 'resize' && finished.moved && Number.isFinite(finished.finalW) && Number.isFinite(finished.finalD)) {
        callbacksRef.current.onResizeEnd(finished.id, finished.finalW, finished.finalD, finished.finalX, finished.finalY);
      } else if (finished.moved && Number.isFinite(finished.finalX) && Number.isFinite(finished.finalY)) {
        callbacksRef.current.onMoveEnd(finished.id, finished.finalX, finished.finalY);
      } else {
        callbacksRef.current.onSelectRoom(finished.id);
      }
    }

    // Right-click on anything pickable → tell the app WHAT was clicked and
    // WHERE on screen, so it can open its own quick-actions menu. The browser
    // menu never shows over the model. Uses the same raycast targets as a
    // left-click pick, so "selectable" and "right-clickable" stay one truth.
    function onContextMenu(event) {
      event.preventDefault();
      if (!callbacksRef.current.onContext) return;
      if (rightDownAt && Math.hypot(event.clientX - rightDownAt.x, event.clientY - rightDownAt.y) > 6) return; // that was a pan
      updatePointer(event);
      const buildingContext = ['foundation', 'shell', 'frame', 'floor', 'walls', 'roof', 'windows'].includes(context);
      const targets = buildingContext
        ? roomMeshes.filter(m => !m.userData.roomId || !spec.rooms.some(r => r.id === m.userData.roomId))
        : roomMeshes;
      const hit = raycaster.intersectObjects(targets, false)[0];
      const id = hit?.object?.userData?.roomId;
      if (!id) return;
      callbacksRef.current.onContext(String(id), event.clientX, event.clientY);
    }

    let rafId = 0;
    function animate() {
      const tween = tweenRef.current;
      if (tween) {
        tween.t = Math.min(1, tween.t + 0.06);
        const eased = 1 - Math.pow(1 - tween.t, 3);
        camera.position.lerpVectors(tween.fromPos, tween.pos, eased);
        controls.target.lerpVectors(tween.fromTarget, tween.target, eased);
        if (tween.t >= 1) tweenRef.current = null;
      }
      controls.update();
      composer.render();
      sceneRef.current = { renderer, scene, camera, controls };
      // Dev/test handle: lets automated checks measure real member geometry
      // and capture framed renders (e.g. "no frame member outside the
      // building") without relying on flaky window screenshots.
      if (typeof window !== 'undefined') {
        window.__nbScene = scene;
        window.__nbView = { renderer, scene, camera, controls, composer };
      }
      rafId = requestAnimationFrame(animate);
    }

    function resize() {
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      composer.setSize(mount.clientWidth, mount.clientHeight);
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
    }

    renderModel();
    // Orbit around what you picked: on a NEW selection, glide the orbit pivot
    // to the object's center (camera stays put, so it reads as a gentle pan).
    // Same-selection rebuilds (spec edits) leave the camera alone.
    if (selectedRoom && focusIdRef.current !== selectedRoom) {
      focusIdRef.current = selectedRoom;
      const bounds = new THREE.Box3();
      let found = false;
      scene.traverse((node) => {
        if (node.isMesh && String(node.userData.roomId || '') === String(selectedRoom)) {
          bounds.expandByObject(node);
          found = true;
        }
      });
      if (found && !bounds.isEmpty()) {
        const center = bounds.getCenter(new THREE.Vector3());
        if (center.distanceTo(controls.target) > 2) {
          tweenRef.current = { fromPos: camera.position.clone(), fromTarget: controls.target.clone(), pos: camera.position.clone(), target: center, t: 0 };
        }
      }
    }
    if (!selectedRoom) focusIdRef.current = null;
    animate();
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerUp);
    renderer.domElement.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('resize', resize);
    // The container itself changes size without a window resize — hiding or
    // showing the chat column, for one. Track the mount, not just the window.
    const mountObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    mountObserver?.observe(mount);

    return () => {
      // Stop THIS loop before the next scene build starts its own — otherwise
      // every spec edit leaks another render loop, and the stale loops fight
      // over the shared camera/tween (dead view buttons, a model that won't
      // orient). One loop at a time.
      if (rafId) cancelAnimationFrame(rafId);
      cameraStateRef.current = {
        position: camera.position.clone(),
        target: controls.target.clone()
      };
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('resize', resize);
      mountObserver?.disconnect();
      mount.removeChild(renderer.domElement);
      pmrem.dispose();
      composer.dispose();
      renderer.dispose();
    };
  }, [spec, selectedRoom, layers, context]);

  if (!webglAvailable()) {
    // Say WHY, and fix what's one click fixable. ?no3d is a testing switch —
    // it lingers in browser history and autocompletes back into the address
    // bar, which reads as "my 3D broke" (it did, for Daniel, 2026-07-11).
    const forcedOff = typeof window !== 'undefined' && /[?&]no3d\b/.test(window.location.search);
    return (
      <div className="scene sceneFallback" aria-label="3D view unavailable">
        <div>
          {forcedOff ? (
            <>
              <b>3D is switched off by this page’s web address (it ends in “no3d”, a testing switch).</b>
              <p>Your browser is fine — the address just told the app to skip the 3D view. One click brings it back.</p>
            </>
          ) : (
            <>
              <b>The 3D view needs graphics acceleration (WebGL), and this browser has it turned off.</b>
              <p>Everything else works — design in the Plan view and tap parts there; the Detail view still draws construction sections. This is often temporary: fully close and reopen the browser, then press Try 3D again. If it persists, turn on hardware acceleration in the browser settings (Chrome: Settings → System) or open the app in another browser.</p>
            </>
          )}
          <div className="fallbackNav">
            {forcedOff ? (
              <button type="button" onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.delete('no3d');
                window.location.href = url.toString();
              }}>Turn 3D back on</button>
            ) : (
              <button type="button" onClick={() => window.location.reload()}>Try 3D again</button>
            )}
            {onFallbackNav && <button type="button" className="secondary" onClick={() => onFallbackNav('plan')}>Return to Plan</button>}
            {onFallbackNav && <button type="button" className="secondary" onClick={() => onFallbackNav('detail')}>Open Detail</button>}
          </div>
        </div>
      </div>
    );
  }
  return <div className="scene" ref={mountRef} aria-label="Interactive 3D BIM model" />;
}

