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
  OPENING_TYPES, resolveFrameType, footprintPolygon, footprintEdges, hasCustomFootprint, polygonArea, decomposeFootprint, subtractRect,
  subtractRectFromFootprint, pointInFootprint, edgeForOpening, gradeElevationAt, basementInfo, BASEMENT_LEVEL, PARTITION_TYPES, CLADDING_TYPES
} from '../backend/bim-core.mjs';
import {
  DEFAULT_OUTDOOR_GRID_SIZE_FT, clamp, padExtension, sitePadRect, objectBounds, titleCase, roofProfile, storeyInfo,
  upperPlateRect, resolveOverhangs, FOUNDATION_RUN_TYPES, DEFAULT_MODEL_LAYERS, siteOf, utilitiesOf, getSpecialBimObjects, wallAssemblyProfile,
  WALL_SIDES, resolveWallSide
} from './engine.js';

// The section-cut clip plane: keeps everything north of the cut line
// (z ≤ cutZ). Slider 1 = whole model, sliding down slices from the south.
function cutPlanes(spec, cut) {
  if (cut == null || cut >= 0.999) return [];
  const depth = Number(spec?.shell?.depthFt) || 28;
  const cutZ = -8 + (depth + 16) * Math.max(0, cut);
  return [new THREE.Plane(new THREE.Vector3(0, 0, -1), cutZ)];
}

export function ThreeScene({ spec, selectedRoom, layers = DEFAULT_MODEL_LAYERS, viewRequest = null, sectionCut = 1, onSelectRoom, onMoveStart, onMoveEnd, onResizeEnd, onDimensionPreview }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraStateRef = useRef(null);
  const selectedRoomRef = useRef(selectedRoom);
  const callbacksRef = useRef({ onSelectRoom, onMoveStart, onMoveEnd, onResizeEnd, onDimensionPreview });
  // Camera flights (view buttons, orbit-around-selection) and the section cut
  // ride REFS, not effect deps — the scene must never rebuild for a camera move.
  const tweenRef = useRef(null);
  const focusIdRef = useRef(null);
  const sectionCutRef = useRef(1);

  useEffect(() => {
    selectedRoomRef.current = selectedRoom;
  }, [selectedRoom]);

  useEffect(() => {
    callbacksRef.current = { onSelectRoom, onMoveStart, onMoveEnd, onResizeEnd, onDimensionPreview };
  }, [onSelectRoom, onMoveStart, onMoveEnd, onResizeEnd, onDimensionPreview]);

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
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe9e1cf);
    // Faint atmospheric falloff so the site melts into the paper backdrop.
    scene.fog = new THREE.Fog(0xe9e1cf, 220, 520);

    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.1, 2000);
    if (cameraStateRef.current?.position) {
      camera.position.copy(cameraStateRef.current.position);
    } else {
      camera.position.set(36, 42, 42);
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true });
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
    outlinePass.visibleEdgeColor.set(0xc88a5b);
    outlinePass.hiddenEdgeColor.set(0x6b543c);
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
      const { extraFt: storeyLift, baseWallFt: baseStoreyFt, storeys } = storeyInfo(spec.shell);
      const basementH = basementInfo(spec.shell).heightFt;
      const wallHeight = roofSpec.highWallHeightFt + storeyLift;
      const southWallHeight = (roofSpec.roofType === 'shed' ? roofSpec.southWallHeightFt : roofSpec.highWallHeightFt) + storeyLift;
      const northWallHeight = (roofSpec.roofType === 'shed' ? roofSpec.northWallHeightFt : roofSpec.highWallHeightFt) + storeyLift;
      const wallProfile = wallAssemblyProfile(spec.systems.envelope);
      const wallT = wallProfile.thicknessFt;

      const slabMat = new THREE.MeshStandardMaterial({ color: 0xc0b49b, roughness: 0.92, map: grainTexture('earth'), bumpMap: bumpTexture('earth'), bumpScale: 0.2 });
      const wallMat = new THREE.MeshStandardMaterial({ color: wallProfile.color, roughness: 0.88, map: grainTexture('plaster'), bumpMap: bumpTexture('plaster'), bumpScale: 0.12 });
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a938f, roughness: 0.5, metalness: 0.22, map: grainTexture('metal'), bumpMap: bumpTexture('metal'), bumpScale: 0.16, envMap: envTex, envMapIntensity: 0.35, side: THREE.DoubleSide });
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
        return new THREE.MeshStandardMaterial({ color: resolved.assembly.color, roughness: 0.88, map: grainTexture('plaster'), bumpMap: bumpTexture(lumpy ? 'lumpy' : 'plaster'), bumpScale: lumpy ? 0.45 : 0.12, transparent: layers.xray || layers.explode, opacity: layers.xray ? 0.34 : layers.explode ? 0.55 : 1 });
      };
      const wallMatFor = (side) => wallMatOf(wallResolved[side]);
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
      const customFp = hasCustomFootprint(spec);
      const fpPoly = customFp ? footprintPolygon(spec) : null;
      const fpEdges = customFp ? footprintEdges(spec) : null;
      // Openings cut REAL holes: each wall run is built as pieces around its
      // openings (full-height stretches between them, a band under each sill,
      // a header above). Gap positions are collected per wall side — or per
      // polygon edge on a custom footprint — before any wall mesh is built.
      // When the Openings layer is hidden the walls render solid (no bare holes).
      const openingGapsByWall = new Map();
      const gapByOpening = []; // index-aligned with spec.openings; .cut set when the hole is real
      if (layers.openings) (spec.openings || []).forEach((opening, openingIdx) => {
        if (opening.wall === 'roof') return;
        const profile = OPENING_TYPES[opening.type] || OPENING_TYPES.window;
        let key;
        let along;
        if (customFp) {
          const e = edgeForOpening(spec, opening);
          if (!e) return;
          key = e.key;
          along = e.horizontal ? Number(opening.x) || 0 : Number(opening.y) || 0;
        } else {
          key = opening.wall;
          along = (opening.wall === 'north' || opening.wall === 'south') ? Number(opening.x) || 0 : Number(opening.y) || 0;
        }
        const w = Number(opening.widthFt) || 3;
        const gap = { from: along, to: along + w, sill: profile.sill, top: profile.sill + profile.h };
        gapByOpening[openingIdx] = gap;
        const list = openingGapsByWall.get(key) || [];
        list.push(gap);
        openingGapsByWall.set(key, list);
      });
      const gapsFor = (key) => openingGapsByWall.get(key) || [];
      const pushSideBoxes = (side, totalH, thickness, place) => {
        const groundH = Math.max(1, totalH - storeyLift);
        wallMeshSpecs.push({ side, storey: 'ground', meshes: place(thickness, groundH, 0) });
        if (storeyLift > 0) {
          const u = wallUpper[side];
          const tU = u.thicknessFt;
          const p = plate2;
          const upperMesh = side === 'north' ? box(p.w, storeyLift, tU, p.x + p.w / 2, groundH + storeyLift / 2, p.y + tU / 2, wallMatOf(u))
            : side === 'south' ? box(p.w, storeyLift, tU, p.x + p.w / 2, groundH + storeyLift / 2, p.y + p.d - tU / 2, wallMatOf(u))
            : side === 'west' ? box(tU, storeyLift, p.d, p.x + tU / 2, groundH + storeyLift / 2, p.y + p.d / 2, wallMatOf(u))
            : box(tU, storeyLift, p.d, p.x + p.w - tU / 2, groundH + storeyLift / 2, p.y + p.d / 2, wallMatOf(u));
          wallMeshSpecs.push({ side, storey: 'upper', meshes: [upperMesh] });
        }
      };
      if (customFp) {
        // Custom footprint: one wall per polygon edge, thickness inward.
        // Construction resolves by facing, so every north-facing segment wears
        // the 'north' wall system. Under a shed roof the eave line runs
        // north→south: horizontal segments seat at their own y, vertical
        // segments rake between their two end heights.
        const shed = roofSpec.roofType === 'shed';
        const eaveAt = (yy) => northWallHeight + (southWallHeight - northWallHeight) * clamp(depth > 0 ? yy / depth : 0, 0, 1);
        const hasPlate = Boolean(upperPlateRect(spec, 2));
        fpEdges.forEach((edge) => {
          const rG = wallResolved[edge.facing];
          if (rG.omitted || omittedWalls.has(edge.facing)) return;
          const t = rG.thicknessFt;
          const midX = (edge.x0 + edge.x1) / 2;
          const midY = (edge.y0 + edge.y1) / 2;
          const cx = midX - edge.nx * (t / 2);
          const cy = midY - edge.ny * (t / 2);
          const len = edge.lengthFt;
          const totalH = shed
            ? (edge.horizontal ? eaveAt(edge.y0) : Math.max(eaveAt(edge.y0), eaveAt(edge.y1)))
            : rG.heightFt + storeyLift;
          const groundH = Math.max(1, totalH - storeyLift);
          const matG = wallMatOf(rG);
          let meshes;
          if (shed && !edge.horizontal) {
            const z0 = Math.min(edge.y0, edge.y1);
            const z1 = Math.max(edge.y0, edge.y1);
            meshes = wallRunMeshes({
              horizontal: false, thickCenter: cx, t, a0: z0, a1: z1,
              hAt: (zz) => Math.max(1, eaveAt(zz) - (hasPlate ? storeyLift : 0)),
              mat: matG, gaps: gapsFor(edge.key)
            });
          } else if (edge.horizontal) {
            const a0 = Math.min(edge.x0, edge.x1);
            meshes = wallRunMeshes({ horizontal: true, thickCenter: cy, t, a0, a1: a0 + len, hAt: () => groundH, mat: matG, gaps: gapsFor(edge.key) });
          } else {
            const a0 = Math.min(edge.y0, edge.y1);
            meshes = wallRunMeshes({ horizontal: false, thickCenter: cx, t, a0, a1: a0 + len, hAt: () => groundH, mat: matG, gaps: gapsFor(edge.key) });
          }
          wallMeshSpecs.push({ side: edge.facing, storey: 'ground', edgeKey: edge.key, meshes });
          // No extent plate: the upper band rides this same edge.
          if (storeyLift > 0 && !hasPlate) {
            const u = wallUpper[edge.facing];
            const tU = u.thicknessFt;
            const ux = midX - edge.nx * (tU / 2);
            const uy = midY - edge.ny * (tU / 2);
            const upperMesh = edge.horizontal
              ? box(len, storeyLift, tU, ux, groundH + storeyLift / 2, uy, wallMatOf(u))
              : box(tU, storeyLift, len, ux, groundH + storeyLift / 2, uy, wallMatOf(u));
            wallMeshSpecs.push({ side: edge.facing, storey: 'upper', edgeKey: edge.key, meshes: [upperMesh] });
          }
        });
        // With a plate, upper bands ring IT — same cardinal ids as a rectangle.
        if (storeyLift > 0 && hasPlate) {
          const p = plate2;
          WALL_SIDES.forEach((side) => {
            if (omittedWalls.has(side) || wallResolved[side].omitted) return;
            const u = wallUpper[side];
            const tU = u.thicknessFt;
            const groundH = Math.max(1, (shed ? Math.max(northWallHeight, southWallHeight) : wallResolved[side].heightFt + storeyLift) - storeyLift);
            const upperMesh = side === 'north' ? box(p.w, storeyLift, tU, p.x + p.w / 2, groundH + storeyLift / 2, p.y + tU / 2, wallMatOf(u))
              : side === 'south' ? box(p.w, storeyLift, tU, p.x + p.w / 2, groundH + storeyLift / 2, p.y + p.d - tU / 2, wallMatOf(u))
              : side === 'west' ? box(tU, storeyLift, p.d, p.x + tU / 2, groundH + storeyLift / 2, p.y + p.d / 2, wallMatOf(u))
              : box(tU, storeyLift, p.d, p.x + p.w - tU / 2, groundH + storeyLift / 2, p.y + p.d / 2, wallMatOf(u));
            wallMeshSpecs.push({ side, storey: 'upper', meshes: [upperMesh] });
          });
        }
      } else if (roofSpec.roofType === 'shed') {
        const eaveAtZ = (zz) => northWallHeight + (southWallHeight - northWallHeight) * clamp(depth > 0 ? zz / depth : 0, 0, 1);
        pushSideBoxes('north', hN, tN, (t, h) => wallRunMeshes({ horizontal: true, thickCenter: t / 2, t, a0: 0, a1: width, hAt: () => h, mat: wallMatFor('north'), gaps: gapsFor('north') }));
        pushSideBoxes('south', hS, tS, (t, h) => wallRunMeshes({ horizontal: true, thickCenter: depth - t / 2, t, a0: 0, a1: width, hAt: () => h, mat: wallMatFor('south'), gaps: gapsFor('south') }));
        wallMeshSpecs.push({ side: 'west', storey: 'ground', meshes: wallRunMeshes({ horizontal: false, thickCenter: tW / 2, t: tW, a0: 0, a1: depth, hAt: eaveAtZ, mat: wallMatFor('west'), gaps: gapsFor('west') }) });
        wallMeshSpecs.push({ side: 'east', storey: 'ground', meshes: wallRunMeshes({ horizontal: false, thickCenter: width - tE / 2, t: tE, a0: 0, a1: depth, hAt: eaveAtZ, mat: wallMatFor('east'), gaps: gapsFor('east') }) });
      } else {
        pushSideBoxes('north', hN, tN, (t, h) => wallRunMeshes({ horizontal: true, thickCenter: t / 2, t, a0: 0, a1: width, hAt: () => h, mat: wallMatFor('north'), gaps: gapsFor('north') }));
        pushSideBoxes('south', hS, tS, (t, h) => wallRunMeshes({ horizontal: true, thickCenter: depth - t / 2, t, a0: 0, a1: width, hAt: () => h, mat: wallMatFor('south'), gaps: gapsFor('south') }));
        pushSideBoxes('west', hW, tW, (t, h) => wallRunMeshes({ horizontal: false, thickCenter: t / 2, t, a0: 0, a1: depth, hAt: () => h, mat: wallMatFor('west'), gaps: gapsFor('west') }));
        pushSideBoxes('east', hE, tE, (t, h) => wallRunMeshes({ horizontal: false, thickCenter: width - t / 2, t, a0: 0, a1: depth, hAt: () => h, mat: wallMatFor('east'), gaps: gapsFor('east') }));
      }
      wallMeshSpecs.forEach(({ side, storey, meshes, edgeKey }) => {
        if (omittedWalls.has(side) || wallResolved[side].omitted) return;
        if (!layers[`wall${titleCase(side)}`]) return;
        const resolved = storey === 'upper' ? wallUpper[side] : wallResolved[side];
        (meshes || []).forEach((mesh) => {
          mesh.name = `${titleCase(side)} Wall${storey === 'upper' ? ' (upper)' : ''} - ${resolved.assembly.label}`;
          mesh.userData.roomId = edgeKey
            ? (storey === 'upper' ? `wall-${edgeKey}-u` : `wall-${edgeKey}`)
            : (storey === 'upper' ? `wall-${side}-u` : `wall-${side}`);
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
      if (!customFp) {
        WALL_SIDES.forEach((side) => {
          const rSg = wallResolved[side];
          if (!rSg.sunGlazing || rSg.omitted || omittedWalls.has(side)) return;
          if (!layers[`wall${titleCase(side)}`]) return;
          const kneeH = rSg.heightFt;
          const eaveH = roofSpec.roofType === 'shed'
            ? (side === 'south' ? southWallHeight : side === 'north' ? northWallHeight : Math.max(northWallHeight, southWallHeight))
            : wallHeight;
          const gapH = eaveH - kneeH;
          if (gapH < 1.5) return;
          const tiltRad = clamp(Number(rSg.sunGlazingTiltDeg ?? 30), 0, 45) * Math.PI / 180;
          const slantLen = gapH / Math.cos(tiltRad);
          const inset = gapH * Math.tan(tiltRad);
          const runLen = (side === 'north' || side === 'south' ? width : depth) - 1;
          const bandGlassMat = new THREE.MeshStandardMaterial({ color: 0xcfe5ea, roughness: 0.1, metalness: 0.05, transparent: true, opacity: 0.36, side: THREE.DoubleSide, envMap: envTex, envMapIntensity: 0.85 });
          const bandPart = (m) => { m.userData.roomId = `wall-${side}`; m.userData.wallSide = side; m.userData.generated = true; group.add(m); return m; };
          const midY = kneeH + gapH / 2;
          const place = (thick, isBatten, along = 0) => {
            let m;
            if (side === 'south') { m = box(isBatten ? 0.3 : runLen, slantLen, thick, width / 2 + along, midY, depth - inset / 2, isBatten ? frameMat : bandGlassMat); m.rotation.x = -tiltRad; }
            else if (side === 'north') { m = box(isBatten ? 0.3 : runLen, slantLen, thick, width / 2 + along, midY, inset / 2, isBatten ? frameMat : bandGlassMat); m.rotation.x = tiltRad; }
            else if (side === 'east') { m = box(thick, slantLen, isBatten ? 0.3 : runLen, width - inset / 2, midY, depth / 2 + along, isBatten ? frameMat : bandGlassMat); m.rotation.z = tiltRad; }
            else { m = box(thick, slantLen, isBatten ? 0.3 : runLen, inset / 2, midY, depth / 2 + along, isBatten ? frameMat : bandGlassMat); m.rotation.z = -tiltRad; }
            return bandPart(m);
          };
          const pane = place(0.14, false);
          roomMeshes.push(pane);
          const bays = Math.max(2, Math.round(runLen / 4));
          for (let b = 0; b <= bays; b += 1) {
            place(0.24, true, runLen * (b / bays) - runLen / 2);
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
      if (!customFp && frameKey3d !== 'load-bearing') {
        const fm = FRAME_MEMBERS[frameKey3d] || FRAME_MEMBERS['post-beam'];
        const framePart = (m) => {
          m.userData.roomId = 'frame-main';
          m.userData.generated = true;
          roomMeshes.push(m);
          group.add(addEdges(m));
          return m;
        };
        // A member along a slope in the span plane: a box rotated to follow
        // the run from (a0,y0) to (a1,y1), where `a` is the span coordinate.
        // spanIsZ: shed bents span north-south (z); gable bents span east-west (x).
        const spanIsZ = roofSpec.roofType === 'shed' || roofSpec.roofType === 'flat';
        const slopeMember = (a0, y0, a1, y1, at, thickAcross, thickDeep) => {
          const len = Math.hypot(a1 - a0, y1 - y0);
          const ang = Math.atan2(y1 - y0, a1 - a0);
          const m = spanIsZ
            ? box(thickAcross, thickDeep, len, at, (y0 + y1) / 2, (a0 + a1) / 2, frameMat)
            : box(len, thickDeep, thickAcross, (a0 + a1) / 2, (y0 + y1) / 2, at, frameMat);
          if (spanIsZ) m.rotation.x = -ang; else m.rotation.z = ang;
          return framePart(m);
        };
        const straight = (a0, a1, y, at, w, h) => framePart(spanIsZ
          ? box(w, h, a1 - a0, at, y, (a0 + a1) / 2, frameMat)
          : box(a1 - a0, h, w, (a0 + a1) / 2, y, at, frameMat));
        const postAt = (a, at, h, pw) => framePart(spanIsZ
          ? box(pw, h, pw, at, h / 2, a, frameMat)
          : box(pw, h, pw, a, h / 2, at, frameMat));

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
        // Eave heights at the two span ends (storey lift already included).
        const hLead = spanIsZ ? northWallHeight : wallHeight;
        const hTail = spanIsZ ? southWallHeight : wallHeight;
        const gRise = roofSpec.roofType === 'gable' ? depth * Number(spec.shell.roofPitch || 0.32) : 0;
        const baseWallFt = Number(spec.shell.wallHeightFt || 10);
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

        // Tie / crossbeam per bent + knee braces + loft joists — timber types.
        const tieH = storeyLift > 0 ? baseWallFt : (roofSpec.roofType !== 'shed' && hasBents ? Math.min(hLead, hTail) - fm.plateH : 0);
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
          if (storeyLift > 0) {
            // loft joists ride the ties, running the bay direction
            const jCount = Math.max(2, Math.floor((aTail - aLead) / 4));
            for (let j = 1; j < jCount; j += 1) {
              const at = aLead + ((aTail - aLead) * j) / jCount;
              straight(fm.postW / 2, bayRun - fm.postW / 2, tieH + 0.28, at, 0.34, 0.55);
            }
          }
        }

        // Rafters at o.c. following the roof plane, plumb ends past the walls.
        const rOC = Math.max(1, fm.rafterOCFt || 2);
        const rCount = Math.max(1, Math.round(bayRun / rOC));
        for (let i = 0; i <= rCount; i += 1) {
          const at = clamp((bayRun * i) / rCount, fm.rafterW, bayRun - fm.rafterW);
          if (roofSpec.roofType === 'gable') {
            const peakY = wallHeight + Math.max(0.3, gRise - 0.25) - fm.rafterH / 2;
            const eaveY = wallHeight + 0.25 - fm.rafterH / 2;
            slopeMember(-oLead, eaveY, span / 2, peakY, at, fm.rafterW, fm.rafterH);
            slopeMember(span / 2, peakY, span + oTail, eaveY, at, fm.rafterW, fm.rafterH);
          } else {
            const y0 = hLead + 0.12 - fm.rafterH / 2;
            const y1 = hTail + 0.12 - fm.rafterH / 2;
            const slope = (y1 - y0) / Math.max(0.01, span);
            slopeMember(-oLead, y0 - slope * oLead, span + oTail, y1 + slope * oTail, at, fm.rafterW, fm.rafterH);
          }
        }
      }

      // (The old floating assembly-summary chip is gone — that information
      // lives in the selection chip and the Walls page; it was pure clutter.)

      // Stem wall foundation: a visible concrete plinth ring under the walls.
      if (utilitiesOf(spec).foundationType === 'stemwall') {
        const stemH = Math.min(6, Math.max(0.5, Number(utilitiesOf(spec).stemwallHeightFt) || 1.5));
        const stemMat = new THREE.MeshStandardMaterial({ color: 0xaaa79b, roughness: 0.95, map: grainTexture('concrete'), bumpMap: bumpTexture('concrete'), bumpScale: 0.15 });
        const lip = 0.25;
        const ring = customFp
          // Custom footprint: the plinth follows every polygon edge.
          ? fpEdges.map((edge) => {
            const t = wallResolved[edge.facing].thicknessFt;
            const cx = (edge.x0 + edge.x1) / 2 - edge.nx * (t / 2);
            const cy = (edge.y0 + edge.y1) / 2 - edge.ny * (t / 2);
            return edge.horizontal
              ? box(edge.lengthFt + lip * 2, stemH, t + lip, cx, stemH / 2, cy, stemMat)
              : box(t + lip, stemH, edge.lengthFt + lip * 2, cx, stemH / 2, cy, stemMat);
          })
          : [
            box(width + lip * 2, stemH, tN + lip, width / 2, stemH / 2, tN / 2, stemMat),
            box(width + lip * 2, stemH, tS + lip, width / 2, stemH / 2, depth - tS / 2, stemMat),
            box(tW + lip, stemH, depth + lip * 2, tW / 2, stemH / 2, depth / 2, stemMat),
            box(tE + lip, stemH, depth + lip * 2, width - tE / 2, stemH / 2, depth / 2, stemMat)
          ];
        ring.forEach((segment) => { segment.name = 'Stem wall foundation'; group.add(addEdges(segment)); });
      }

      // Topography: when the site slopes, the foundation steps DOWN to meet
      // grade around the perimeter — taller (a walkout basement) on the
      // downhill side, the exact condition the elevations/sections show. Each
      // footprint edge gets a concrete face from the sill (y≈0) to the grade
      // line at its two ends, so the bottom follows the falling ground.
      const slopeNow = Math.max(0, Number(siteOf(spec).slopeFt) || 0);
      if (slopeNow > 0) {
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
      if (basementH > 0) {
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
          : (Math.max(1, roomLevel) - 1) * baseStoreyFt + (roomLevel > 1 ? 0.42 : 0);
        const material = new THREE.MeshStandardMaterial({
          color: zonePalette[room.type] || 0x86a0a8,
          transparent: true,
          opacity: room.id === selectedRoom ? 0.88 : 0.58,
          roughness: 0.7
        });
        const mesh = box(room.w, 0.22, room.d, room.x + room.w / 2, 0.05 + roomLift, room.y + room.d / 2, material);
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

      (spec.elements || []).forEach((element) => {
        if (!layers.elements || (layers.hiddenCats || []).includes(element.category || 'custom')) return;
        let elementHeight = element.h || 1.2;
        let elevation = Number(element.z || 0);
        let mesh;
        if (element.category === 'foundation') {
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
          const hWall = Math.max(2, Number(element.h) || 8);
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
          if (!cuts.length) {
            mesh = box(element.w, elementHeight, element.d, element.x + element.w / 2, elevation + elementHeight / 2, element.y + element.d / 2, plateMat2);
          } else {
            let rects = [{ x: element.x, y: element.y, w: element.w, d: element.d }];
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
        if (element.roofType && element.category !== 'foundation' && element.category !== 'floor') {
          const deckTop = elevation + elementHeight;
          const eave = deckTop + 6.8;
          const canopyPart = (m) => { m.userData.roomId = element.id; m.userData.generated = true; group.add(m); };
          [[element.x + 0.4, element.y + 0.4], [element.x + element.w - 0.4, element.y + 0.4],
            [element.x + 0.4, element.y + element.d - 0.4], [element.x + element.w - 0.4, element.y + element.d - 0.4]]
            .forEach(([pxp, pzp]) => canopyPart(box(0.42, eave - deckTop, 0.42, pxp, deckTop + (eave - deckTop) / 2, pzp, frameMat)));
          const cxm = element.x + element.w / 2;
          const czm = element.y + element.d / 2;
          const ow = 0.9;
          if (element.roofType === 'gable') {
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
          else if (roofSpec.roofType === 'shed') flueTop = northWallHeight + (southWallHeight - northWallHeight) * Math.min(1, Math.max(0, czm / depth)) + 2.5;
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
        const openH = profile.h;
        const centerY = profile.sill + openH / 2;
        const mat = profile.glazed ? glassMat : doorMat;
        let mesh;
        if (opening.wall === 'roof') {
          // Skylight: a glass panel lying on the roof plane, tilted to the slope.
          const cx = (Number(opening.x) || 0) + size / 2;
          const cz = (Number(opening.y) || 0) + size / 2;
          mesh = box(size, 0.16, size, cx, 0, cz, glassMat);
          if (roofSpec.roofType === 'shed') {
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
            part(size + fw * 2, fw, 0.3, mid, profile.sill + openH + fw / 2, 0.14, frameMat);
            part(size + fw * 2, fw, 0.3, mid, Math.max(fw / 2, profile.sill - fw / 2), 0.14, frameMat);
            part(fw, openH, 0.3, mid - size / 2 - fw / 2, centerY, 0.14, frameMat);
            part(fw, openH, 0.3, mid + size / 2 + fw / 2, centerY, 0.14, frameMat);
            if (recessed) {
              // reveal liners — the window buck lining the hole through the wall
              const revealD = Math.max(0.6, tHere - 0.06);
              part(size, 0.12, revealD, mid, profile.sill + openH - 0.06, rIn, frameMat);
              part(size, 0.12, revealD, mid, profile.sill + 0.06, rIn, frameMat);
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
            if (profile.entry && !profile.glazed) {
              // door hardware — a small knob at the latch side
              part(0.14, 0.14, 0.14, mid + size * 0.34, profile.sill + Math.min(3.1, openH * 0.45), rIn + 0.16, frameMat);
            }
            if (profile.sill > 0.6) {
              // projecting exterior sill ledge under windows
              part(size + 0.5, 0.13, 0.5, mid, profile.sill - fw - 0.04, 0.22, frameMat);
            }
          }
        }
        if (mesh) {
          mesh.name = opening.label || `${opening.wall} ${opening.type}`;
          mesh.userData.roomId = `opening-${index}`;
          roomMeshes.push(mesh);
          group.add(mesh);
        }
      });

      if (layers.roof) {
        if (layers.xray || layers.explode) {
          roofMat.transparent = true;
          roofMat.opacity = layers.xray ? 0.4 : 0.55;
        }
        const oAll = resolveOverhangs(spec.shell);
        const plateReal = upperPlateRect(spec, 2);
        const fpAreaNow = customFp ? polygonArea(fpPoly) : width * depth;
        // The roof STEPS when an upper storey covers only part of the plan:
        // an upper roof over the extent plate, low wings over the remainder.
        const steps = storeyLift > 0 && plateReal && plateReal.w * plateReal.d < fpAreaNow - 1;
        if (!customFp && !steps) {
          // Legacy path, byte-for-byte: one roof over the whole rectangle.
          const roof = makeRoof(width, depth, wallHeight, spec.shell.roofPitch, roofMat, roofSpec, oAll);
          roof.userData.roomId = 'roof-main';
          roomMeshes.push(roof);
          group.add(addEdges(roof));
        } else {
          // Roof as SEGMENTS — per rectangle of an L/T/U footprint and/or the
          // stepped upper-block + wings. Valleys are not modeled; segments meet.
          const pitchNow = Number(spec.shell.roofPitch || 0.32);
          const insideFp = (px, py) => (customFp
            ? pointInFootprint(fpPoly, px, py)
            : px > 0.01 && px < width - 0.01 && py > 0.01 && py < depth - 0.01);
          const inPlate = (px, py) => Boolean(steps && plateReal
            && px > plateReal.x + 0.01 && px < plateReal.x + plateReal.w - 0.01
            && py > plateReal.y + 0.01 && py < plateReal.y + plateReal.d - 0.01);
          // A segment side is a true eave only when nothing lies beyond it:
          // probe just outside — upper wall → tuck under it; neighbor segment
          // → hairline lap; open air → the shell overhang for that facing.
          const segOverhangs = (rect, isUpper) => {
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
              if (!isUpper && inPlate(px, py)) out[side] = 0.35;
              else if (insideFp(px, py)) out[side] = 0.05;
              else out[side] = oAll[side];
            }
            return out;
          };
          const segments = [];
          if (steps) {
            segments.push({ rect: { x: plateReal.x, y: plateReal.y, w: plateReal.w, d: plateReal.d }, eave: wallHeight, kind: 'full', upper: true });
            const lowers = customFp
              ? subtractRectFromFootprint(fpPoly, plateReal)
              : subtractRect({ x: 0, y: 0, w: width, d: depth }, plateReal);
            const groundEave = roofSpec.highWallHeightFt;
            lowers.forEach((rect) => {
              const overlapX = rect.x < plateReal.x + plateReal.w && rect.x + rect.w > plateReal.x;
              const overlapY = rect.y < plateReal.y + plateReal.d && rect.y + rect.d > plateReal.y;
              const touch = Math.abs(rect.y + rect.d - plateReal.y) < 0.05 && overlapX ? 'south'
                : Math.abs(rect.y - (plateReal.y + plateReal.d)) < 0.05 && overlapX ? 'north'
                : Math.abs(rect.x + rect.w - plateReal.x) < 0.05 && overlapY ? 'east'
                : Math.abs(rect.x - (plateReal.x + plateReal.w)) < 0.05 && overlapY ? 'west'
                : (Math.abs((rect.x + rect.w / 2) - (plateReal.x + plateReal.w / 2)) > Math.abs((rect.y + rect.d / 2) - (plateReal.y + plateReal.d / 2))
                  ? ((rect.x + rect.w / 2) < (plateReal.x + plateReal.w / 2) ? 'east' : 'west')
                  : ((rect.y + rect.d / 2) < (plateReal.y + plateReal.d / 2) ? 'south' : 'north'));
              segments.push({ rect, eave: groundEave, kind: 'wing', highSide: touch });
            });
          } else {
            decomposeFootprint(fpPoly).forEach((rect) => segments.push({ rect, eave: wallHeight, kind: 'full', upper: true }));
          }
          // The global shed plane (eave line north→south across the whole
          // house) — 'full' shed segments are coplanar pieces of it.
          const shedYAt = (zz) => {
            const z0 = -oAll.north, z1 = depth + oAll.south;
            const nH = roofSpec.northWallHeightFt + storeyLift + 0.28;
            const sH = roofSpec.southWallHeightFt + storeyLift + 0.28;
            return nH + (sH - nH) * clamp((zz - z0) / Math.max(0.01, z1 - z0), 0, 1);
          };
          segments.forEach((seg) => {
            const o = segOverhangs(seg.rect, Boolean(seg.upper));
            let mesh = null;
            if (seg.kind === 'wing') {
              mesh = makeStepRoofPlane(seg.rect, seg.highSide, seg.eave + 0.25, pitchNow, o, roofMat);
            } else if (roofSpec.roofType === 'shed') {
              mesh = makeShedPiece(seg.rect, o, shedYAt, roofMat);
            } else if (roofSpec.roofType === 'flat') {
              mesh = makeShedPiece(seg.rect, o, () => seg.eave + 0.25, roofMat);
            } else if (roofSpec.roofType === 'hip') {
              mesh = makeRoof(seg.rect.w, seg.rect.d, seg.eave, pitchNow, roofMat, roofSpec, o);
              mesh.position.x += seg.rect.x;
              mesh.position.z += seg.rect.y;
            } else {
              mesh = makeGableSegment(seg.rect, seg.eave, pitchNow, o, roofMat);
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
            if (id.endsWith('-u')) node.position.y += 3;
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

    // A raked wall piece for shed side walls: runs along z between a0..a1,
    // base at yBot, top raking h0→h1. (Only vertical runs rake in this model —
    // horizontal walls always sit under a level eave line.)
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
    function wallRunMeshes({ horizontal, thickCenter, t, a0, a1, hAt, mat, gaps }) {
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
        if (horizontal || Math.abs(yTopA - yTopB) < 0.02) {
          flatPiece(pa, pb, yBot, Math.min(yTopA, yTopB));
          return;
        }
        if (Math.min(yTopA, yTopB) - yBot < 0.05) return;
        meshes.push(rakedPieceZ(thickCenter, t, pa, pb, yBot, yTopA, yTopB, mat));
      };
      const clean = (gaps || [])
        .map((g) => ({ ref: g, sill: g.sill, top: g.top, from: Math.max(a0 + 0.2, g.from), to: Math.min(a1 - 0.2, g.to) }))
        .filter((g) => g.to - g.from > 0.4 && g.sill < Math.min(lerpH(g.from), lerpH(g.to)) - 0.8)
        .sort((ga, gb) => ga.from - gb.from);
      let at = a0;
      for (const g of clean) {
        if (g.from < at + 0.05) continue; // overlapping opening: wall stays solid there
        g.ref.cut = true; // the opening assembly recesses into this real hole
        piece(at, g.from, 0, lerpH(at), lerpH(g.from));
        const gapTop = Math.min(g.top, Math.min(lerpH(g.from), lerpH(g.to)) - 0.25);
        if (g.sill > 0.2) flatPiece(g.from, g.to, 0, g.sill);
        piece(g.from, g.to, gapTop, lerpH(g.from), lerpH(g.to));
        at = g.to;
      }
      piece(at, a1, 0, lerpH(at), lerpH(a1));
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

    // A flat-or-sloped quad over a rect where height is any function of z —
    // flat roofs (constant) and coplanar pieces of the global shed plane.
    function makeShedPiece(rect, o, yAt, material) {
      const x0 = rect.x - o.west, x1 = rect.x + rect.w + o.east;
      const z0 = rect.y - o.north, z1 = rect.y + rect.d + o.south;
      return meshFromTris(slabTris([
        [x0, yAt(z0), z0],
        [x1, yAt(z0), z0],
        [x1, yAt(z1), z1],
        [x0, yAt(z1), z1]
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
        const southHeight = roofSpec.southWallHeightFt + 0.28;
        const northHeight = roofSpec.northWallHeightFt + 0.28;
        const mesh = meshFromTris(slabTris([
          [-o.west, northHeight, -o.north],
          [width + o.east, northHeight, -o.north],
          [width + o.east, southHeight, depth + o.south],
          [-o.west, southHeight, depth + o.south]
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
      mesh.rotation.x = -Math.PI / 2;
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
      ctx.font = '600 44px "Source Sans 3", Aptos, Arial';
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

    function onPointerDown(event) {
      updatePointer(event);
      const handleHit = raycaster.intersectObjects(resizeHandles, false)[0];
      if (handleHit?.object?.userData?.resizeHandle) {
        const { id, corner } = handleHit.object.userData.resizeHandle;
        const object = [...spec.rooms, ...(spec.elements || []), ...getSpecialBimObjects(spec)].find((item) => item.id === id);
        if (!object) return;
        callbacksRef.current.onSelectRoom(id);
        renderer.domElement.setPointerCapture(event.pointerId);
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
      const hit = raycaster.intersectObjects(roomMeshes, false)[0];
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
      if (objectId.startsWith('wall-') && !objectId.endsWith('-u')) {
        const side = hit.object.userData.wallSide;
        if (!side) {
          callbacksRef.current.onSelectRoom(objectId);
          return;
        }
        renderer.domElement.setPointerCapture(event.pointerId);
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
        controls.enabled = false;
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
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      const finished = dragState;
      dragState = null;
      controls.enabled = true;
      renderer.domElement.style.cursor = '';
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
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
      requestAnimationFrame(animate);
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
    window.addEventListener('resize', resize);
    // The container itself changes size without a window resize — hiding or
    // showing the chat column, for one. Track the mount, not just the window.
    const mountObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    mountObserver?.observe(mount);

    return () => {
      cameraStateRef.current = {
        position: camera.position.clone(),
        target: controls.target.clone()
      };
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('resize', resize);
      mountObserver?.disconnect();
      mount.removeChild(renderer.domElement);
      pmrem.dispose();
      composer.dispose();
      renderer.dispose();
    };
  }, [spec, selectedRoom, layers]);

  return <div className="scene" ref={mountRef} aria-label="Interactive 3D BIM model" />;
}

