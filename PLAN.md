# `PLAN.md` — ORBITAL-9: Photorealistic 3D Sci-Fi Survival Horror Engineering Specification

---

## 1. Executive Overview & Core Gameplay Loop

**ORBITAL-9** is a zero-asset, self-contained, photorealistic first-person 3D Sci-Fi Survival Horror web application engineered in vanilla JavaScript (ES Modules), **Three.js r164+**, custom GLSL post-processing shaders, procedural PBR `CanvasTexture` generators, and a pure **Web Audio API** procedural synthesis engine.

The player assumes the role of the sole surviving engineer aboard *Orbital Research Outpost 9*, stranded in low orbit above a shadowed gas giant (*Acheron-IV*). Life support is failing, internal rations are depleted, and photosensitive/acoustically-driven xenomorphic organisms (**"Void Stalkers"**) have infested both the outer hull and internal ventilation shafts.

### 1.1 The 7-Stage Core Survival Loop

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. METABOLIC & O2 DECAY (Interior Safe/Low-Power State)                     │
│    • Oxygen decays at 0.55%/sec (interior low-O2) or 1.35%/sec (EVA/Breach) │
│    • Hunger/Caloric Reserve decays at 0.35%/sec                             │
│    • Mess Hall Storage Bay locker provides initial baseline check           │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. AIRLOCK DEPRESSURIZATION CYCLE                                           │
│    • Enter Airlock Chamber (Z: +11.0m to +16.5m)                            │
│    • Interact (KeyE) with Airlock Bulkhead Panel                            │
│    • Inner door seals → 3.5s vacuum pump & steam particle purge →           │
│      Gravity/Mag-boots disengage → Outer EVA Hatch slides open              │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. ZERO-G EVA SCAVENGING (6-DOF Quaternion Flight)                          │
│    • Fly into open orbital space using RCS Jetpack (WASD + Space/Ctrl + QE) │
│    • Use 2D Helmet Radar to locate drifting Cargo Supply Pods (Cyan blips)  │
│    • Tether/Harvest pods (Hold KeyE for 1.5s within 3.2m) to collect        │
│      O2 Cells (+35% O2), Nutrient Rations (+40% Hunger), & Power Relays     │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. ALIEN SENSORY THREAT ESCALATION                                          │
│    • Void Stalkers crawl along the exterior hull trusses and solar arrays   │
│    • Player's RCS thruster firing emits an acoustic sphere (R = 28m)        │
│    • Helmet Flashlight emits a photonic detection cone (25° half-angle, 35m)│
│    • High exposure fills the Alien Aggro Accumulator → triggers Hunt/Breach │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 5. STATION BREACH ALARM (RED ALERT)                                         │
│    • Every 75s–110s (or upon exterior aggro threshold / 2nd pod harvest),   │
│      a Hull Breach Event triggers!                                          │
│    • Station white lighting cuts out; rotating red Emergency Beacons ignite │
│    • Procedural dual-tone Klaxon sounds; Aliens breach the Maintenance Vent │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 6. DESPERATE RACE BACK VIA AIRLOCK                                          │
│    • Player must thrust back into the Airlock, cycle re-pressurization      │
│      (or emergency fast-cycle), re-engage mag-boots, and sprint through     │
│      the red-strobing Maintenance Corridor while evading interior Stalkers  │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 7. BRIDGE EMERGENCY LOCKDOWN (HOLD-E 2.5s) & VENT PURGE                     │
│    • Reach Central Command Bridge (Z: -16.0m to -6.0m)                      │
│    • Hold KeyE for 2.5s at the Master Lockdown Terminal                     │
│    • Heavy Armored Blast Doors slam shut over viewports and corridor gates  │
│    • High-pressure thermal vent purge blasts steam, forcing Aliens to       │
│      retreat (`RETREAT_PURGE`), restoring nominal station lighting & O2     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Exact Modular ES File Architecture & Interface Contracts

To guarantee conflict-free parallel execution across multiple engineering agents, the codebase is strictly partitioned into **6 physical files** inside the root directory, utilizing **zero build tools** and a native browser ES Module `importmap`.

```
/
├── index.html       # Entry point, ImportMap, Canvas, HUD DOM, EffectComposer, Main Loop
├── station.js       # Procedural PBR CanvasTextures, Interior Geometry, Doors, Lights, AABBs
├── eva_space.js     # Deep Space Skybox, Fresnel Planet, Exterior Hull, Drifting Cargo Pods
├── player.js        # Mag-Boot Kinematics, 6-DOF Quaternion EVA Physics, Raycast Interaction
├── aliens.js        # Procedural 6-Limbed Xenomorph Rig, Sensory FSM, Breach & Lockdown Director
└── audio_ui.js      # Web Audio API Procedural Synthesizer, Helmet HUD, Radar, Debug Hooks
```

### 2.1 `index.html` ImportMap & Bootstrap Contract

`index.html` must define the following exact `<script type="importmap">` loading Three.js **r164** and its post-processing addons from CDN:

```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.164.1/examples/jsm/"
  }
}
</script>
```

### 2.2 Shared `GameState` & `EventBus` Schema

`index.html` instantiates and passes a single authoritative `gameContext` object into every subsystem's `init(gameContext)` and `update(dt, elapsed, gameContext)` methods.

```javascript
/**
 * Authoritative Shared GameState & EventBus Contract
 */
export const GameStateSchema = {
  // Core Three.js Singletons
  scene: null,            // THREE.Scene
  camera: null,           // THREE.PerspectiveCamera (FOV 72, near 0.08, far 4500)
  renderer: null,         // THREE.WebGLRenderer
  composer: null,         // EffectComposer
  visorPass: null,        // ShaderPass (Custom Visor GLSL)
  bloomPass: null,        // UnrealBloomPass

  // Simulation Clock & Mode
  isPaused: true,         // False once PointerLock is engaged or debug bypass active
  isGameOver: false,
  elapsed: 0.0,
  dt: 0.016,

  // Player Vitals & Kinematics
  player: {
    mode: 'INTERIOR',     // 'INTERIOR' | 'AIRLOCK_TRANSITION' | 'EVA'
    position: null,       // THREE.Vector3 (World meters)
    velocity: null,       // THREE.Vector3 (m/s)
    quaternion: null,     // THREE.Quaternion
    health: 100.0,        // 0..100
    oxygen: 100.0,        // 0..100
    hunger: 100.0,        // 0..100
    panic: 0.0,           // 0..1 (drives breathing tempo, heartbeat, visor aberration)
    damageFlash: 0.0,     // 0..1 (decays at 1.8/sec, drives red visor vignette)
    flashlightOn: true,
    stabilizersOn: true,  // Inertial dampeners in EVA
    isThrusting: false,
    acousticRadius: 1.5,  // Dynamic noise emission radius in meters (1.5m idle -> 28m thrust/sprint)
    carriedRations: 0,
    carriedO2Cells: 0,
    repairedRelays: 0,
  },

  // Station & Airlock State
  station: {
    airlockState: 'PRESSURIZED_INNER', // 'PRESSURIZED_INNER' | 'CYCLING_TO_EVA' | 'DEPRESSURIZED_OUTER' | 'CYCLING_TO_INTERIOR'
    airlockProgress: 0.0,              // 0..1
    innerDoorOpen: true,               // 0..1 animation alpha
    outerDoorOpen: false,              // 0..1 animation alpha
    alarmActive: false,                // True during Breach Red Alert
    lockdownActive: false,             // True when blast shutters slam shut
    lockdownHoldProgress: 0.0,         // 0..1 (2.5s Hold-E on Bridge Console)
    breachTimer: 85.0,                 // Countdown to next scheduled hull breach event
    powerLevel: 1.0,                   // 1.0 normal, 0.18 emergency red-alert
  },

  // Spatial Collision & Interactive Registries
  colliders: {
    interiorWalkableAABBs: [], // Array<THREE.Box3> - Room/Corridor interior volumes player must stay inside
    interiorObstacleAABBs: [], // Array<THREE.Box3> - Consoles, tables, pillars player collides against
    exteriorHullAABBs: [],     // Array<THREE.Box3> - Solid outer station hull blocks in EVA
    airlockVolumeAABB: null,   // THREE.Box3 - Trigger volume for gravity/EVA switch
  },

  interactables: [],           // Array<{ id, type, label, position, radius, holdDuration, onInteract, canInteract }>
  radarTargets: [],            // Array<{ id, type: 'POD'|'ALIEN'|'AIRLOCK'|'BRIDGE', position: THREE.Vector3, active: boolean }>

  // Lightweight Synchronous Pub/Sub EventBus
  events: {
    listeners: new Map(),
    on(event, fn) { /* registers callback */ },
    emit(event, payload) { /* invokes all callbacks for event */ }
  }
};
```

#### Standardized EventBus Topics

| Event Name | Payload Schema | Emitted By | Consumed By |
| :--- | :--- | :--- | :--- |
| `'AIRLOCK_CYCLE_START'` | `{ targetMode: 'EVA' \| 'INTERIOR' }` | `station.js` | `audio_ui.js`, `player.js` |
| `'AIRLOCK_CYCLE_COMPLETE'` | `{ mode: 'EVA' \| 'INTERIOR' }` | `station.js` | `player.js`, `audio_ui.js` |
| `'POD_HARVESTED'` | `{ podId, o2Gain, foodGain, relayGain, position }` | `eva_space.js` | `player.js`, `audio_ui.js`, `aliens.js` |
| `'SUPPLY_LOCKER_USED'` | `{ o2Restored, foodRestored }` | `station.js` | `player.js`, `audio_ui.js` |
| `'BREACH_ALARM_TRIGGERED'` | `{ breachZone: 'CORRIDOR_VENT' \| 'HULL' }` | `aliens.js` | `station.js`, `audio_ui.js` |
| `'LOCKDOWN_HOLD_TICK'` | `{ progress: number }` | `player.js` | `station.js`, `audio_ui.js` |
| `'LOCKDOWN_EXECUTED'` | `{ timestamp: number }` | `station.js` | `aliens.js`, `audio_ui.js` |
| `'LOCKDOWN_CLEAR'` | `{ timestamp: number }` | `station.js` | `aliens.js`, `audio_ui.js` |
| `'PLAYER_DAMAGED'` | `{ amount: number, sourcePos: THREE.Vector3 }` | `aliens.js` | `player.js`, `audio_ui.js` |
| `'FOOTSTEP'` | `{ surface: 'GRATE' \| 'STEEL', intensity: number }` | `player.js` | `audio_ui.js`, `aliens.js` |
| `'THRUSTER_PULSE'` | `{ intensity: number }` | `player.js` | `audio_ui.js`, `aliens.js` |
| `'ALIEN_SCREECH'` | `{ alienId, position: THREE.Vector3, state: string }` | `aliens.js` | `audio_ui.js` |

---

### 2.3 Module Export Signatures

#### 1. `station.js`
```javascript
export class StationManager {
  constructor(gameContext) {}
  init() {} // Builds textures, rooms, lights, doors, AABBs, registers interactables
  update(dt, elapsed) {} // Updates door lerps, rotating red beacons, steam particles, CRT canvas redraws
  triggerRedAlert(active) {} // Switches station lighting & alarm beacons
  triggerEmergencyLockdown() {} // Slams blast doors, triggers vent steam purge, emits LOCKDOWN_EXECUTED
  cycleAirlock() {} // State machine for inner/outer doors and pressurization
  getPointInteriorStatus(worldPos) {} // Returns true if point is inside pressurized volume
}
```

#### 2. `eva_space.js`
```javascript
export class EVASpaceManager {
  constructor(gameContext) {}
  init() {} // Builds starfield, nebula dome, Fresnel planet, exterior hull superstructure, cargo pods
  update(dt, elapsed) {} // Rotates planet/rings, drifts cargo pods, updates tether/beacon lights
  spawnCargoPods(count = 10) {} // Populates floating scavengeable pods around the station
  harvestPod(podId) {} // Handles pod collection, particle burst, and radar removal
}
```

#### 3. `player.js`
```javascript
export class PlayerController {
  constructor(gameContext) {}
  init() {} // Sets up camera rig, flashlight SpotLight, input listeners, initial spawn in Bridge
  update(dt, elapsed) {} // Runs Interior Mag-Boot or 6-DOF EVA kinematics, vitals decay, raycast interaction
  setMode(newMode) {} // Transitions cleanly between 'INTERIOR' and 'EVA'
  applyDamage(amount, sourceWorldPos) {} // Reduces health, spikes damageFlash and camera angular impulse
  teleportToPreset(presetName) {} // Deterministic camera/player placement for debug & verification ('BRIDGE', 'AIRLOCK', 'EVA_EXTERIOR', 'CORRIDOR')
}
```

#### 4. `aliens.js`
```javascript
export class AlienDirector {
  constructor(gameContext) {}
  init() {} // Builds procedural multi-limbed alien meshes (2 exterior hull stalkers, 2 interior vent stalkers)
  update(dt, elapsed) {} // Updates procedural leg IK/sinusoids, sensory raycasts, FSM, and breach timer
  forceBreachEvent() {} // Immediately triggers Red Alert Breach Alarm and sets interior aliens to HUNT_PURSUE
  onLockdownPurge() {} // Forces all interior aliens into RETREAT_PURGE state toward vent shafts
}
```

#### 5. `audio_ui.js`
```javascript
export class AudioUIManager {
  constructor(gameContext) {}
  init() {} // Builds DOM HUD, initializes 2D radar canvas, binds Web Audio API context unlock on click
  resumeAudio() {} // Unlocks AudioContext and starts continuous ambient drones + helmet breathing loop
  update(dt, elapsed) {} // Updates HUD bars, radar blips, prompt rings, and modulates breathing/thruster synths
  playOneShot(type, params) {} // 'FOOTSTEP', 'AIRLOCK_CLUNK', 'AIRLOCK_HISSSS', 'ALIEN_SCREECH', 'LOCKDOWN_SLAM', 'PICKUP'
}
```

---

## 3. Photorealistic Lighting, Deep-Space Scene & Custom GLSL Visor Post-Processing

### 3.1 `WebGLRenderer` & Scene Atmosphere Configuration

To achieve a high-contrast, physically grounded survival horror aesthetic (inspired by *Alien: Isolation* and *Dead Space*):

* **Renderer Parameters**:
  * `antialias: false` (handled via post-processing pipeline & full `Math.min(window.devicePixelRatio, 2.0)` resolution scaling)
  * `powerPreference: "high-performance"`
  * `toneMapping = THREE.ACESFilmicToneMapping`
  * `toneMappingExposure = 1.05`
  * `outputColorSpace = THREE.SRGBColorSpace`
  * `shadowMap.enabled = true`
  * `shadowMap.type = THREE.PCFSoftShadowMap`
* **Environment & Fog**:
  * `scene.background = new THREE.Color(0x010204)`
  * `scene.fog = new THREE.FogExp2(0x030508, 0.0012)` (subtle deep-space depth falloff; interior lights overpower fog locally)
  * **Procedural PMREM Environment Map**: At startup, generate an offscreen `THREE.Scene` containing two high-intensity emissive area panels (cool cyan rim `0x38bdf8` and warm amber bounce `0xf59e0b`) and compile via `THREE.PMREMGenerator.fromScene()` to assign `scene.environment`. This ensures all metallic PBR surfaces (`metalness: 0.75–0.92`) exhibit realistic specular reflections even in dark corridors.

### 3.2 Post-Processing Pipeline (`EffectComposer`)

The frame render pipeline in `index.html` executes three passes in sequence:

1. **`RenderPass(scene, camera)`**: Renders the base 3D scene with shadows and PBR materials.
2. **`UnrealBloomPass(resolution, strength, radius, threshold)`**:
   * `threshold = 0.78` (only HDR emissive elements bloom: CRT monitors, thruster plumes, bioluminescent alien eyes, red emergency strobes, and planetary rim glow)
   * `strength = 0.65` (ramps to `0.95` during Red Alert)
   * `radius = 0.45`
3. **`ShaderPass(VisorShader)`**: Custom full-screen GLSL post-processing shader simulating the curved polycarbonate space-helmet visor, oxygen starvation frost, radial chromatic aberration, and damage trauma.

### 3.3 Custom GLSL `VisorShaderPass` Specification

#### Uniform Interface Contract
```javascript
uniforms: {
  tDiffuse:    { value: null },
  uTime:       { value: 0.0 },
  uOxygen:     { value: 1.0 },       // Normalized 0.0 .. 1.0 (gameContext.player.oxygen / 100)
  uPanic:      { value: 0.0 },       // Normalized 0.0 .. 1.0
  uDamage:     { value: 0.0 },       // Normalized 0.0 .. 1.0
  uVelocity:   { value: 0.0 },       // Normalized speed 0.0 .. 1.0
  uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
}
```

#### Exact GLSL Fragment Shader Mathematical Formulation
```glsl
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uOxygen;
uniform float uPanic;
uniform float uDamage;
uniform float uVelocity;
uniform vec2 uResolution;
varying vec2 vUv;

// 2D Hash & Value Noise for FBM Visor Frost / Condensation
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for (int i = 0; i < 4; ++i) {
    v += a * noise(p);
    p = rot * p * 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  // 1. Centered Aspect-Corrected Coordinates
  vec2 centered = vUv - 0.5;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = vec2(centered.x * aspect, centered.y);
  float r2 = dot(p, p);
  float r = sqrt(r2);

  // 2. Subtle Barrel Glass Curvature Distortion
  // k1 = 0.065 baseline + 0.025 under high velocity/panic
  float k1 = 0.065 + 0.025 * (uVelocity * 0.5 + uPanic * 0.5);
  vec2 distortedUv = 0.5 + centered * (1.0 + k1 * r2);

  // Clamp out-of-bounds bezel edges
  if (distortedUv.x < 0.0 || distortedUv.x > 1.0 || distortedUv.y < 0.0 || distortedUv.y > 1.0) {
    gl_FragColor = vec4(0.01, 0.015, 0.02, 1.0);
    return;
  }

  // 3. Radial Chromatic Aberration (amplified by Panic, Damage, and Low O2)
  float caStrength = (0.0025 + 0.009 * uPanic + 0.014 * uDamage + 0.008 * (1.0 - uOxygen)) * r2;
  vec2 caOffset = normalize(centered + 1e-5) * caStrength;

  float colR = texture2D(tDiffuse, distortedUv + caOffset).r;
  float colG = texture2D(tDiffuse, distortedUv).g;
  float colB = texture2D(tDiffuse, distortedUv - caOffset).b;
  vec3 color = vec3(colR, colG, colB);

  // 4. Subtle Dielectric Visor Scanlines & Micro-Grid Reflection
  float scanline = sin(distortedUv.y * uResolution.y * 0.85) * 0.018;
  color += vec3(0.04, 0.09, 0.12) * scanline * smoothstep(0.35, 0.85, r);

  // 5. Procedural Frost & Breath Condensation FBM Mask along Edges as O2 Drops
  float hypoxiaFactor = clamp(1.0 - uOxygen, 0.0, 1.0);
  // Subtle rhythmic breath fogging at bottom center of visor
  float breathCycle = 0.5 + 0.5 * sin(uTime * (2.2 + uPanic * 3.5));
  float bottomBreath = smoothstep(0.45, 0.0, length(p - vec2(0.0, -0.42))) * 0.18 * breathCycle;

  float frostNoise = fbm(p * 5.5 + vec2(0.0, uTime * 0.02));
  float frostEdgeRadius = mix(0.88, 0.24, pow(hypoxiaFactor, 1.25));
  float frostMask = smoothstep(frostEdgeRadius - 0.18, frostEdgeRadius + 0.15, r + frostNoise * 0.22 - bottomBreath);
  frostMask = clamp(frostMask * (0.25 + 0.85 * hypoxiaFactor), 0.0, 0.92);

  vec3 frostColor = vec3(0.72, 0.86, 0.96) * (0.65 + 0.35 * frostNoise);
  color = mix(color, frostColor, frostMask);

  // 6. Red Trauma / Damage Vignette + Hypoxia Desaturation
  float damagePulse = uDamage * (0.75 + 0.25 * sin(uTime * 14.0));
  float damageMask = smoothstep(0.25, 0.82, r) * damagePulse;
  color = mix(color, vec3(0.75, 0.03, 0.02), damageMask);

  // Hypoxia grey-blue blackout below 20% O2
  float blackout = smoothstep(0.22, 0.0, uOxygen);
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(color, vec3(luma * 0.4, luma * 0.45, luma * 0.55), blackout * 0.75);

  // 7. Physical Helmet Rim Vignette
  float visorVignette = smoothstep(0.92, 0.52, r);
  color *= mix(0.18, 1.0, visorVignette);

  gl_FragColor = vec4(color, 1.0);
}
```

---

## 4. Procedural PBR `CanvasTexture` Generators & Station Spatial Blueprint (`station.js`)

Zero flat solid-color materials are permitted on structural geometry. `station.js` must contain a dedicated `ProceduralTextureFactory` that generates paired **Albedo (`map`)**, **Roughness (`roughnessMap`)**, and **Bump (`bumpMap`)** (plus `alphaMap` or `emissiveMap` where specified) using offscreen HTML5 2D canvases (`512x512` or `1024x1024`) with `THREE.RepeatWrapping` and anisotropic filtering (`renderer.capabilities.getMaxAnisotropy()`).

### 4.1 The 5 Procedural PBR Texture Recipes

#### a) Brushed Steel Hull Plating (`createHullPlatingPBR()`)
* **Resolution**: `512x512`
* **Albedo (`map`)**:
  * Base fill: `#2b323b` (dark industrial gunmetal).
  * Anisotropic brushed grain: 2,400 horizontal 1px strokes with random alpha `0.03–0.08` alternating `#3e4756` and `#181c22`.
  * Panel seams: 4x4 modular sub-panels bordered by a `3px` recessed dark groove (`#0e1116`) and a `1px` specular bevel highlight (`#525e6e`).
  * Rivets: Along panel perimeters every `32px`, draw `3px` circular rivet heads with top-left highlight and bottom-right drop shadow.
  * Oil grime & weld scorch: 18 radial gradients (`rgba(20, 14, 10, 0.22)`) pooled near bottom panel seams.
* **Roughness (`roughnessMap`)**:
  * Base `#787878` (`roughness ≈ 0.47`). Panel seams `#d0d0d0` (matte crevices), oil patches `#404040` (glossy grease), scratch streaks `#505050`.
* **Bump (`bumpMap`, `bumpScale: 0.015`)**:
  * Base `#808080`. Panel grooves `#151515` (deep recess), rivet domes `#e5e5e5`, micro-scratches `#606060`.

#### b) Industrial Grated Catwalks (`createGratedCatwalkPBR()`)
* **Resolution**: `512x512`
* **Albedo (`map`)**:
  * Solid steel frame border (`24px` wide, `#38404a`) with diamond truss lattice inside (`16px` grid pitch, `4px` bar width, `#4b5563` with `#717d8c` worn boot-scuffed center highlights).
* **Alpha Cutout (`alphaMap`, `alphaTest: 0.5`)**:
  * Pure white (`#ffffff`) on the frame and diamond lattice bars; pure black (`#000000`) inside the diamond voids so lights and steam shine directly through the floor grates into the sub-floor cable trenches below.
* **Roughness & Bump**:
  * Raised diamond studs at lattice intersections (`#ffffff` in bumpMap, `#353535` polished metal in roughnessMap).

#### c) Hazard Warning Stripes (`createHazardStripePBR()`)
* **Resolution**: `512x512`
* **Albedo (`map`)**:
  * 45-degree diagonal bands (`36px` stripe width) alternating safety amber-yellow (`#d99b16`) and carbon black (`#16181d`).
  * Chipped paint & rust pass: 650 procedural sponge-stamps along stripe edges exposing raw oxidized steel (`#4a3525` and `#7a828e`).
* **Roughness & Bump**:
  * Flaked paint zones have higher roughness (`#b5b5b5`) and recessed bump (`#505050`) compared to intact glossier enamel paint (`#656565`).

#### d) Scratched/Smudged Bulkhead Glass (`createBulkheadGlassPBR()`)
* **Resolution**: `512x512`
* **Material Properties**: `THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.34, metalness: 0.1, roughness: 0.25, envMapIntensity: 2.2 })`
* **Roughness & Bump**:
  * Radial smudge blotches around edges (`#a0a0a0`) leaving a clearer central viewing zone (`#222222`), overlaid with 140 fine directional micro-scratch lines (`0.5px` width, `#c0c0c0`).

#### e) Diegetic Terminal & Diagnostic Displays (`createDynamicTerminalScreen()`)
* **Resolution**: `512x512` (Dynamic canvas updated at 10 Hz or on state change with `texture.needsUpdate = true`)
* **Visual Content**:
  * Phosphor CRT background (`#041218` normal, `#1f0404` during Breach Alarm).
  * Renders live station telemetry schematic: **O2 PRESSURE**, **AIRLOCK SEAL STATUS**, **HULL INTEGRITY**, and the bold **BRIDGE EMERGENCY LOCKDOWN OVERRIDE [HOLD E]** progress bar.
  * Used both as `map` and `emissiveMap` (`emissive: 0xffffff`, `emissiveIntensity: 1.4` to trigger `UnrealBloomPass`).

---

### 4.2 Modular Station Spatial Blueprint (Exact World-Space Meter Coordinates)

The station is aligned along the **Z-axis** (North/South spine) at `Y = 0.0m` floor height, with the planet *Acheron-IV* visible through the Bridge forward viewport (`-Z`) and the EVA Airlock opening toward the orbital debris field (`+Z`).

```
                      [ -Z : FORWARD PLANET VIEWPORT ]
                                     │
                     ┌───────────────┴───────────────┐
                     │    1. CENTRAL COMMAND BRIDGE  │
                     │     X: [-6.0, +6.0] (12m W)   │
                     │     Y: [ 0.0, +4.2] (4.2m H)  │
                     │     Z: [-16.0, -6.0] (10m L)  │
                     │  • Lockdown Console (0,1,-13) │
                     │  • Panoramic Viewport (Z=-16) │
                     └───────────────┬───────────────┘
                                     │ Bulkhead Arch (Z = -6.0)
     ┌──────────────────────┐ ┌──────┴───────┐
     │ 2. MESS & STORAGE BAY│ │              │
     │  X: [-11.5, -3.0]    ├─┤ 3. DARK      │
     │  Y: [  0.0, +3.6]    │ │  MAINTENANCE │
     │  Z: [ -4.5, +3.5]    │ │  CORRIDOR    │
     │ • O2/Ration Locker   │ │ X:[-3.0,+3.0]│
     │   at (-10.5, 1.2, 0) │ │ Y:[-1.2,+3.6]│ (Catwalk at Y=0, trench to -1.2m)
     └──────────────────────┘ │ Z:[-6.0,+11] │
                              │ • Ceiling &  │
                              │   Wall Vents │
                              └──────┬───────┘
                                     │ Inner Airlock Door (Z = +11.0)
                              ┌──────┴───────┐
                              │ 4. AIRLOCK   │
                              │   CHAMBER    │
                              │ X:[-2.5,+2.5]│
                              │ Y:[ 0.0,+3.2]│
                              │ Z:[+11,+16.5]│
                              │ • Panel at   │
                              │  (+2.1,1.3,13.8)
                              └──────┬───────┘
                                     │ Outer EVA Hatch (Z = +16.5)
                                     ▼
                       [ +Z : EXTERIOR ZERO-G SPACE ]
                        Cargo Pods & Hull Trusses
                        Z: [+18.0m to +140.0m]
```

#### Exact Walkable Interior AABB Volumes (`colliders.interiorWalkableAABBs`)
1. **Command Bridge Volume**: `min: (-5.6, 0.0, -15.4)`, `max: (+5.6, 3.8, -5.8)`
2. **Maintenance Corridor Spine**: `min: (-2.6, 0.0, -6.2)`, `max: (+2.6, 3.4, +11.1)` (When `innerDoorOpen === true`, extends to `Z = +16.0`)
3. **Mess Hall / Storage Bay Side Alcove**: `min: (-11.1, 0.0, -4.1)`, `max: (-2.4, 3.4, +3.1)`
4. **Airlock Chamber Volume**: `min: (-2.1, 0.0, +10.9)`, `max: (+2.1, 3.0, +16.2)` (When `outerDoorOpen === true`, extends into open space `Z > +16.2`)

#### Key Architectural & Interactive Props inside `station.js`
1. **Central Command Bridge (`Z: -16.0m to -6.0m`)**:
   * **Forward Panoramic Viewport (`Z = -16.0m`)**: 3 angled trapezoid panes of Scratched Bulkhead Glass overlooking the illuminated crescent of *Acheron-IV*, with heavy motorized **Armored Blast Shutters** recessed above at `Y = +4.1m` that slam down to `Y = +0.5m` during Emergency Lockdown.
   * **Master Emergency Lockdown Console (`pos: (0.0, 1.05, -13.2)`)**: Angled command desk with 3 dynamic CRT displays, glowing keyboard matrix, and a physical red polycarbonate status beacon. Registered in `gameContext.interactables` with `id: 'BRIDGE_LOCKDOWN_CONSOLE'`, `holdDuration: 2.5`.
2. **Mess Hall & Storage Bay (`X: -11.5m to -3.0m, Z: -4.5m to +3.5m`)**:
   * Connected to the Maintenance Corridor via an open bulkhead frame at `X = -3.0m, Z ∈ [-2.0, +1.5]`.
   * **Life-Support & Ration Synthesis Locker (`pos: (-10.6, 1.3, -0.5)`)**: Illuminated green/amber cabinet where the player can press `KeyE` (`holdDuration: 0.8s`) to consume harvested EVA pods or draw emergency station reserves (+45% O2, +50% Hunger).
   * Cryo-galley table (`pos: (-7.0, 0.8, -1.5)`) with scattered metallic trays and flickering overhead fluorescent tube light.
3. **Dark Maintenance Corridor (`X: -3.0m to +3.0m, Z: -6.0m to +11.0m`)**:
   * **Grated Catwalk Floor (`Y = 0.0m`)** suspended over a `1.2m` deep sub-floor coolant trench (`Y = -1.2m`) housing glowing orange/cyan fluid pipes and rising steam wisps.
   * **Overhead Ribbed Support Arches** every `2.5m` along Z, lined with industrial cable bundles and **3 Rotating Red Emergency Beacon SpotLights** (`Z = -4.0, +2.0, +8.0`).
   * **Alien Breach Ventilation Grates**: Two damaged ceiling/wall vent shafts at `(-2.8, 2.4, -1.0)` and `(+2.8, 2.4, +5.5)` with bent louvers and volumetric red/amber back-lighting—serving as spawn/retreat nodes for interior Void Stalkers.
   * **Internal Corridor Blast Gate (`Z = -5.9m`)**: Heavy vertical steel bulkhead door that slams down during Lockdown to seal the Bridge from the Corridor (`Y` drops from `+3.8m` to `+0.0m`, while still leaving a manual override sensor if the player is inside the Bridge).
4. **Functional Airlock Chamber (`X: -2.5m to +2.5m, Z: +11.0m to +16.5m`)**:
   * **Inner Bulkhead Door (`Z = +11.0m`)**: Dual horizontal sliding steel doors marked with Hazard Warning Stripes.
   * **Outer EVA Hatch (`Z = +16.5m`)**: Heavy reinforced airlock hatch with a central circular pressure wheel and viewport window looking directly out into space.
   * **Airlock Control Terminal (`pos: (+2.1, 1.35, +13.8)`)**: Interactive panel (`KeyE`, instant press) that initiates the 3.5-second pressurization/depressurization sequence.
   * **Depressurization Steam Particle System**: `THREE.Points` (180 particles with soft radial alpha sprite texture) ejected from ceiling nozzles at `Z = +12.5m` and `+15.0m` with high downward velocity and turbulence during `CYCLING_TO_EVA` and `CYCLING_TO_INTERIOR`.

---

## 5. Seamless Interior-to-Zero-G EVA Physics Math (`eva_space.js` & `player.js`)

### 5.1 Exterior Deep-Space Environment (`eva_space.js`)

Once the Outer EVA Hatch opens at `Z = +16.5m`, the player looks out into a vast, high-contrast orbital vista:

1. **Multi-Layer High-Density Starfield**:
   * `4,500` background stars (`THREE.Points`, radius `1,800m–2,600m`) with vertex colors sampled across realistic blackbody temperatures (O-type blue-white `#9bb0ff`, G-type warm `#fff4ea`, M-type ember `#ffcc6f`) and varied point sizes (`1.0px–3.2px`).
2. **Massive Shadowed Gas Giant (*Acheron-IV*) with Custom GLSL Fresnel Rim Shader**:
   * Positioned at `(-420, -140, -1100)` with radius `R = 460m` (visible both from the Bridge panoramic viewport and exterior EVA space).
   * Uses a custom `THREE.ShaderMaterial` combining procedural Latitudinal Storm Band FBM noise on the sunlit crescent with an intense cyan-cobalt atmospheric Rayleigh/Fresnel rim glow:
     $$I_{\text{rim}} = \left(1.0 - \max(0.0, \mathbf{N} \cdot \mathbf{V})\right)^{3.8} \cdot \max\left(0.15, \mathbf{N} \cdot \mathbf{L}_{\text{sun}} + 0.45\right)$$
   * Casts a dramatic, high-intensity `THREE.DirectionalLight` (`color: 0x7dd3fc`, `intensity: 2.8`, shadow camera covering `[-35, 35]`) across the station's exterior hull and through the Bridge glass.
3. **Exterior Station Hull Superstructure & Solar Truss Arrays**:
   * Wraps the interior rooms in an outer armored shell (`Z: -18m to +16.5m`) with communication dish towers, radiator fins extending out to `X = ±32m`, and a broken docking truss extending into the EVA zone (`Z: +16.5m to +75m`) with red blinking FAA-style navigation strobes.
   * All solid exterior hull modules populate `gameContext.colliders.exteriorHullAABBs`.
4. **Drifting Scavengeable Cargo Supply Pods**:
   * `10` floating cargo canisters distributed across `X ∈ [-38, +38]`, `Y ∈ [-18, +22]`, `Z ∈ [+24, +95]`.
   * Each pod features a brushed octagonal body, hazard stripe end-caps, a blinking cyan transponder beacon (`THREE.PointLight` + emissive flare), slow tumbling angular velocity $\boldsymbol{\omega}_{\text{pod}}$, and registers in both `gameContext.interactables` (`holdDuration: 1.5s`, `radius: 3.4m`) and `gameContext.radarTargets` (`type: 'POD'`).

---

### 5.2 Interior Mag-Boot Kinematics (`player.js`)

When `player.mode === 'INTERIOR'`, the player moves on the horizontal $XZ$ plane with magnetic boot traction:

1. **Planar Input & Acceleration**:
   Let local input vector $\mathbf{u} = (u_x, 0, u_z)$ be normalized in camera yaw space ($\psi$).
   Target speed $v_{\max} = 4.2\text{ m/s}$ (walk) or $6.6\text{ m/s}$ (sprint with `ShiftLeft`, which increases oxygen drain by $1.8\times$ and sets `acousticRadius = 22.0m`).
   $$\mathbf{v}_{xz}(t + \Delta t) = \mathbf{v}_{xz}(t) + \left(\mathbf{a}_{\text{wish}} - \mu_{\text{mag}} \mathbf{v}_{xz}(t)\right) \Delta t$$
   where traction acceleration $a = 34.0\text{ m/s}^2$ and magnetic boot friction $\mu_{\text{mag}} = 10.5\text{ s}^{-1}$.

2. **Sinusoidal Head-Bob & Footstep Phase Trigger**:
   Let horizontal speed $s = \|\mathbf{v}_{xz}\|$. When $s > 0.25\text{ m/s}$, advance phase accumulator:
   $$\phi(t + \Delta t) = \phi(t) + s \cdot 2.35 \cdot \Delta t$$
   Camera local offset:
   $$y_{\text{eye}} = 1.68 + 0.042 \sin(2\phi) \cdot \min(1, s / 4.2), \quad x_{\text{eye}} = 0.024 \cos(\phi) \cdot \min(1, s / 4.2)$$
   Whenever $\sin(2\phi)$ crosses $-0.95$ on a downward slope, emit `events.emit('FOOTSTEP', { surface: 'GRATE', intensity: s / 6.6 })`.

3. **Interior Walkable Union AABB & Obstacle Sliding Collision**:
   The player is modeled as a vertical cylinder of radius $R_p = 0.42\text{ m}$.
   For each axis $i \in \{x, z\}$ independently:
   * Advance candidate position $p'_i = p_i + v_i \Delta t$.
   * Verify that the sphere/circle $(p'_x, p'_z, R_p)$ remains contained within at least one active box in `interiorWalkableAABBs` and does not intersect any box in `interiorObstacleAABBs`.
   * If blocked on axis $i$, clamp $p'_i$ to the boundary surface and zero velocity component $v_i = 0$, allowing smooth wall-sliding along the orthogonal axis.

---

### 5.3 6-DOF Zero-G Quaternion EVA Physics (`player.js`)

When `player.mode === 'EVA'`, gimbal-locked Euler angles are bypassed in favor of full **6-DOF Quaternion Kinematics**:

1. **Angular Velocity & Quaternion Orientation Integration**:
   Maintain local angular velocity vector $\boldsymbol{\omega} = (\omega_{\text{pitch}}, \omega_{\text{yaw}}, \omega_{\text{roll}}) \in \mathbb{R}^3$:
   * Mouse look deltas $(\Delta m_x, \Delta m_y)$ apply direct angular impulses:
     $$\omega_{\text{yaw}} \leftarrow \omega_{\text{yaw}} - k_{\text{mouse}} \Delta m_x, \quad \omega_{\text{pitch}} \leftarrow \omega_{\text{pitch}} - k_{\text{mouse}} \Delta m_y$$
   * Roll keys (`KeyQ` / `KeyE`) apply roll torque $\alpha_{\text{roll}} = \pm 2.8\text{ rad/s}^2$:
     $$\omega_{\text{roll}}(t + \Delta t) = \omega_{\text{roll}}(t) + u_{\text{roll}} \alpha_{\text{roll}} \Delta t$$
     *(Input conflict safeguard: when an interactable target—such as a Cargo Pod, Airlock Panel, or Bridge Console—is highlighted in reticle range, `KeyE` prioritizes contextual Interact/Hold-E and temporarily suppresses roll torque. Additionally, `KeyC` is bound as an alias for `ControlLeft` downward thrust so `Ctrl+W` never collides with browser tab-close shortcuts.)*
   * Exponential RCS angular damping ($\lambda_{\omega} = 7.5\text{ s}^{-1}$):
     $$\boldsymbol{\omega}(t + \Delta t) = \boldsymbol{\omega}(t) \cdot e^{-\lambda_{\omega} \Delta t}$$
   * Construct incremental local rotation quaternion $\delta \mathbf{q}$ from small-angle axis-angle $\boldsymbol{\theta} = \boldsymbol{\omega} \Delta t$:
     $$\delta \mathbf{q} = \left( \frac{\boldsymbol{\theta}}{\|\boldsymbol{\theta}\|} \sin\frac{\|\boldsymbol{\theta}\|}{2}, \; \cos\frac{\|\boldsymbol{\theta}\|}{2} \right)$$
   * Post-multiply and re-normalize the player orientation quaternion:
     $$\mathbf{q}(t + \Delta t) = \text{normalize}\left(\mathbf{q}(t) \otimes \delta \mathbf{q}\right)$$

2. **World-Space RCS Thrust Vector Projection**:
   Extract the orthonormal basis vectors from $\mathbf{q}$:
   $$\mathbf{f} = \mathbf{q}(0, 0, -1)\mathbf{q}^{-1}, \quad \mathbf{r} = \mathbf{q}(1, 0, 0)\mathbf{q}^{-1}, \quad \mathbf{u} = \mathbf{q}(0, 1, 0)\mathbf{q}^{-1}$$
   Given 3D thruster input $\mathbf{I} = (I_x, I_y, I_z) \in [-1, 1]^3$ (`A/D` = $I_x$, `Space/Ctrl` = $I_y$, `W/S` = $I_z$):
   $$\mathbf{F}_{\text{thrust}} = a_{\text{RCS}} \cdot \text{normalize}\left(I_x \mathbf{r} + I_y \mathbf{u} + I_z \mathbf{f}\right)$$
   where $a_{\text{RCS}} = 7.8\text{ m/s}^2$ ($12.5\text{ m/s}^2$ with `ShiftLeft` boost).

3. **Linear Velocity Integration & Inertial Stabilizers**:
   $$\mathbf{v}(t + \Delta t) = \left(\mathbf{v}(t) + \mathbf{F}_{\text{thrust}} \Delta t\right) \cdot e^{-\gamma \Delta t}$$
   where damping coefficient $\gamma = 1.45\text{ s}^{-1}$ when RCS Inertial Stabilizers are ON (`stabilizersOn === true`, toggled via `KeyR`), or $\gamma = 0.08\text{ s}^{-1}$ (near-frictionless Newtonian drift) when OFF. Speed is clamped to $\|\mathbf{v}\| \le 14.0\text{ m/s}$.

4. **Sphere-vs-AABB Exterior Hull Collision & Rebound**:
   In EVA, the player is a sphere of radius $R_{\text{eva}} = 0.55\text{ m}$. For each `box` in `exteriorHullAABBs`:
   * Compute closest point on AABB: $\mathbf{c} = \text{clamp}(\mathbf{p}, \mathbf{b}_{\min}, \mathbf{b}_{\max})$.
   * Penetration vector: $\mathbf{d} = \mathbf{p} - \mathbf{c}$. If $\|\mathbf{d}\| < R_{\text{eva}}$:
     $$\mathbf{n} = \frac{\mathbf{d}}{\|\mathbf{d}\| + 10^{-6}}, \quad \mathbf{p} \leftarrow \mathbf{c} + \mathbf{n} R_{\text{eva}}$$
     $$\mathbf{v} \leftarrow \mathbf{v} - (1 + e_{\text{hull}}) \min(0, \mathbf{v} \cdot \mathbf{n}) \mathbf{n}$$
     with restitution coefficient $e_{\text{hull}} = 0.25$ (metallic suit bump with slight rebound).

5. **Seamless Airlock Gravity Transition State Machine**:
   When the player is inside the Airlock Chamber (`Z ∈ [11.0, 16.5]`) and the Airlock cycles from `DEPRESSURIZED_OUTER` to `PRESSURIZED_INNER`:
   * Over a `1.2s` transition window (`mode = 'AIRLOCK_TRANSITION'`), spherically interpolate (`SLERP`) the player's current 6-DOF quaternion $\mathbf{q}_{\text{eva}}$ to a horizon-level upright quaternion $\mathbf{q}_{\text{upright}}$ preserving the current look yaw $\psi$:
     $$\mathbf{q}(s) = \text{slerp}\left(\mathbf{q}_{\text{eva}}, \, \mathbf{q}_{\text{upright}}(\psi), \, 3s^2 - 2s^3\right)$$
   * Smoothly lerp $p_y \to 1.68\text{ m}$ as the magnetic boots lock onto the airlock deck with a metallic clunk.

---

## 6. Alien AI, Procedural Rig & Emergency Lockdown Event (`aliens.js`)

### 6.1 Procedural Articulated 6-Limbed Xenomorph Mesh ("Void Stalker")

Each Void Stalker is constructed procedurally in `aliens.js` as a hierarchical `THREE.Group` with zero external models:

* **Material Palette**:
  * **Biomech Exoskeleton**: `THREE.MeshStandardMaterial({ color: 0x0d1017, roughness: 0.22, metalness: 0.78, bumpMap: hullBumpTexture, bumpScale: 0.02 })` (wet, chitinous obsidian sheen that catches flashlight specular highlights).
  * **Bioluminescent Sensory Organs**: `THREE.MeshBasicMaterial({ color: 0xff1e00 })` (shifts from cold amber `0xff8800` in patrol to blinding crimson `0xff0800` in `HUNT_PURSUE`, blooming via `UnrealBloomPass`).
* **Anatomical Hierarchy**:
  1. **Elongated Domed Cranium & Mandibles**: Swept ellipsoid skull (`scale: (0.28, 0.24, 0.75)`) with curved dorsal crest, 4 clustered glowing ocular nodes, and articulated inner/outer jaws that flare open during `LUNGE_ATTACK`.
  2. **Segmented Thoracic Ribcage & Spine**: 7 overlapping curved dorsal carapace plates tapering posteriorly, with protruding dorsal heat-vent spines.
  3. **6 Articulated 3-Joint Crawling Limbs (3 Left, 3 Right)**:
     * Each leg $k \in \{0..5\}$ consists of a **Coxa/Femur Pivot** (`L1 = 0.65m`), **Tibia Knee Joint** (`L2 = 0.75m`), and **Tarsal Claw Tip** (`L3 = 0.35m`).
     * **Procedural Tripod Gait Kinematics**: Alternating tripod sets $A = \{0, 3, 4\}$ and $B = \{1, 2, 5\}$ are driven by phase $\theta_k = \omega_{\text{gait}} t + \pi (k \bmod 2)$:
       $$\theta_{\text{hip}, k} = 0.45 \sin(\theta_k), \quad \theta_{\text{knee}, k} = -0.85 + 0.38 \max(0, \cos(\theta_k))$$
  4. **Segmented Prehensile Whip Tail**: 9 linked tapered cylinders with a barbed stinger tip, undulating via a traveling sine wave:
     $$\psi_{\text{tail}, j}(t) = 0.22 \sin(3.8 t - 0.55 j)$$

### 6.2 Sensory AI & 6-State Finite State Machine (FSM)

The Alien Director manages **4 Void Stalkers**:
* **2 Exterior Hull Stalkers** patrolling the outer station hull, solar trusses, and EVA cargo field (`Z ∈ [+14, +75]`).
* **2 Interior Vent Stalkers** lurking inside the Maintenance Corridor ceiling vents and sub-floor trenches (`Z ∈ [-5.5, +10.5]`).

#### Sensory Detection Model
Every frame, each alien evaluates two physical stimuli from the player:
1. **Photonic Flashlight Cone Detection**:
   If `player.flashlightOn === true`, let $\mathbf{d}_{\text{PA}} = \mathbf{p}_{\text{alien}} - \mathbf{p}_{\text{player}}$. If $\|\mathbf{d}_{\text{PA}}\| < 35.0\text{ m}$ and the angle between camera forward $\mathbf{f}_{\text{cam}}$ and $\hat{\mathbf{d}}_{\text{PA}}$ satisfies:
   $$\mathbf{f}_{\text{cam}} \cdot \hat{\mathbf{d}}_{\text{PA}} > \cos(24^\circ) \approx 0.9135$$
   and a bounding-box raycast shows unobstructed line-of-sight, the alien's `aggroAccumulator` increases at $+48.0/\text{sec}$.
2. **Acoustic Noise Sphere Detection**:
   Whenever $\|\mathbf{d}_{\text{PA}}\| < R_{\text{acoustic}}$ (where $R_{\text{acoustic}}$ is `1.5m` idle, `10m` walking, `22m` sprinting, or `28m` firing EVA thrusters), `aggroAccumulator` increases by $+35.0 \cdot \left(1 - \|\mathbf{d}_{\text{PA}}\| / R_{\text{acoustic}}\right) / \text{sec}$.

#### FSM State Transitions & Behaviors

| State | Entry Condition | Movement & Behavior |
| :--- | :--- | :--- |
| `STALK_HULL` | Default for Exterior Aliens | Crawls along outer hull AABB surfaces and truss beams at `2.6 m/s`, circling cargo pods. |
| `PATROL_VENTS` | Default for Interior Aliens (when no Breach is active) | Crawls through overhead vent shafts and beneath floor grates (`Y = +3.1m` or `Y = -0.9m`), visible through grate cutouts with glowing eyes. |
| `INVESTIGATE_SIGNAL` | `aggroAccumulator > 35` | Emits low warning hiss, turns toward last heard acoustic/flashlight coordinate $\mathbf{p}_{\text{stimulus}}$, and moves at `3.8 m/s` to inspect. |
| `HUNT_PURSUE` | `aggroAccumulator >= 100` OR `station.alarmActive === true` | Emits piercing FM screech (`ALIEN_SCREECH`), eyes flare bright crimson, pursues player directly at `5.6 m/s` (interior) or `7.2 m/s` (EVA). Increases `player.panic`. |
| `LUNGE_ATTACK` | Distance to player $< 2.3\text{ m}$ in `HUNT_PURSUE` | Executes rapid forward pounce (`9.5 m/s` burst), deals `28.0` damage (`PLAYER_DAMAGED`), knocks player back, then enters `1.6s` recovery cooldown. |
| `RETREAT_PURGE` | `LOCKDOWN_EXECUTED` event received | Screeches in pain from thermal steam purge, breaks off pursuit immediately, and sprints at `9.0 m/s` back into the ceiling vent nodes (`Z = -1.0m` or `+5.5m`), hiding until next cycle. |

---

### 6.3 Breach Alarm & Bridge Emergency Lockdown Sequence

1. **Triggering the Station Breach Alarm**:
   * Automatically triggers when `station.breachTimer <= 0` (counts down from `85s`, accelerated by `15s` each time a cargo pod is harvested) OR when an exterior alien reaches `aggroAccumulator >= 100`, OR deterministically when `alienDirector.forceBreachEvent()` is called.
   * Emits `'BREACH_ALARM_TRIGGERED'`.
2. **Red Alert Transformation (`station.triggerRedAlert(true)`)**:
   * All white interior work lights dim to `10%` flicker.
   * **5 Rotating Red Emergency Beacon SpotLights** (Bridge, Mess Hall, 3 in Corridor) activate, spinning at $\omega = 4.2\text{ rad/s}$ and sweeping volumetric crimson cones across the brushed steel walls and floor grates.
   * `audio_ui.js` begins pulsing the dual-tone industrial Klaxon siren every `1.4s`.
   * Interior Void Stalkers drop from the Maintenance Corridor ceiling vents onto the deck in `HUNT_PURSUE` state.
   * Helmet HUD Objective Banner flashes crimson: **`CRITICAL: HULL BREACH DETECTED — RETURN TO BRIDGE & ENGAGE LOCKDOWN [HOLD E]`**.
3. **Bridge Console Hold-E Interaction (`2.5s`)**:
   * When the player reaches the Bridge Lockdown Console (`pos: (0, 1.05, -13.2)`), aims within `2.6m`, and holds `KeyE`:
   * `station.lockdownHoldProgress` increments from `0.0` to `1.0` over `2.5s` (`dt / 2.5`).
   * The diegetic terminal canvas and the Helmet HUD radial progress ring animate in sync while emitting rising pitch confirmation beeps.
4. **Lockdown Execution (`station.triggerEmergencyLockdown()`)**:
   * Heavy Armored Blast Shutters slam down over the Bridge panoramic viewport and the Bridge-to-Corridor bulkhead gate (`Z = -5.9m`) with a massive low-frequency sub-bass impact (`LOCKDOWN_SLAM`).
   * Corridor ceiling nozzles erupt with high-velocity thermal purge steam particles (`300` illuminated white/orange steam particles filling the corridor).
   * Emits `'LOCKDOWN_EXECUTED'`, forcing all interior aliens into `RETREAT_PURGE`.
   * After `9.0s` of purge lockdown, power stabilizes, blast doors unseal, white lights restore, oxygen regenerates to `100%`, and the survival loop resets for the next scavenging expedition.

---

## 7. Procedural Web Audio API Synthesis & Diegetic Helmet HUD (`audio_ui.js`)

### 7.1 Procedural Web Audio API Node Graphs (Zero External Audio Files)

All sound effects and continuous ambiences are synthesized in real time using a single `AudioContext` unlocked on the first user click/keypress, routed through a master `DynamicsCompressorNode`.

#### 1. Muffled Helmet Breathing & Heartbeat Loop
* **Signal Graph**:
  `WhiteNoiseBuffer (4s loop)` $\rightarrow$ `BiquadFilterNode (lowpass, 480 Hz, pink-noise slope)` $\rightarrow$ `BiquadFilterNode (bandpass, Q = 4.5, f = 650 Hz)` $\rightarrow$ `GainNode (breathEnvelope)`.
* **Dynamic Modulation**:
  Breathing rate $f_{\text{breath}} = 0.28 + 0.65 \cdot \text{panic} + 0.45 \cdot (1 - \text{O2}/100)\text{ Hz}$.
  Inhale phase sweeps bandpass center frequency $580\text{ Hz} \to 920\text{ Hz}$; exhale sweeps $780\text{ Hz} \to 420\text{ Hz}$.
  When `panic > 0.35` or `O2 < 35%`, a dual-pulse sub-bass heartbeat (`SineOscillator` at `58 Hz` with `0.09s` pitch drop to `32 Hz`) pulses in sync.

#### 2. Metallic Grate & Steel Footsteps
* **Signal Graph**:
  * **Impact Transient**: `NoiseBurst (0.045s)` $\rightarrow$ `BiquadFilter (bandpass, 1100 Hz, Q = 3.0)` $\rightarrow$ `GainNode (exponential decay)`.
  * **Metallic Ring**: Two detuned `TriangleOscillators` (`380 Hz` & `542 Hz` for `'GRATE'`; `210 Hz` & `315 Hz` for `'STEEL'`) $\rightarrow$ `GainNode (0.08s decay)`.

#### 3. Airlock Depressurization Sweep & Bulkhead Clunk
* **Mechanical Seal Clunk**: `SineOscillator (140 Hz -> 38 Hz over 0.18s)` + `SquareOscillator (95 Hz, 0.06s)` through `WaveShaperNode` distortion.
* **3.5s Vacuum Pressure Sweep**: `WhiteNoise` $\rightarrow$ `BiquadFilter (bandpass, Q = 2.2)` whose center frequency sweeps exponentially from `2,400 Hz` down to `120 Hz` as air evacuates into vacuum, accompanied by receding gain.

#### 4. RCS Jetpack Thruster Rumble
* **Signal Graph**:
  `WhiteNoise` $\rightarrow$ `BiquadFilter (lowpass, 240 Hz)` + `SawtoothOscillator (68 Hz)` $\rightarrow$ `GainNode (thrusterGain)`.
* **Modulation**: `thrusterGain` smoothly ramps to `0.32` with `50ms` time constant (`setTargetAtTime`) whenever `player.isThrusting === true`, and `0.0` when idle.

#### 5. Emergency Breach Alarm Klaxon
* **Signal Graph**:
  Dual-oscillator industrial horn (`SawtoothOscillator 440 Hz` + `SquareOscillator 587 Hz`) $\rightarrow$ `BiquadFilter (lowpass, 1600 Hz)` $\rightarrow$ `WaveShaperNode (soft saturation)`.
* **Modulation**: During `station.alarmActive === true`, every `1.4s`, pitch glides upward from `420 Hz` to `680 Hz` over `0.55s`, holds for `0.25s`, and drops to `310 Hz` over `0.3s`.

#### 6. Alien FM Screech & 3D Spatial Panner
* **Signal Graph**:
  `Modulator SineOsc (f_m = 68 Hz)` $\rightarrow$ `ModGain (index = 420)` $\rightarrow$ `Carrier SawtoothOsc.frequency (f_c = 1450 Hz -> 620 Hz glide over 0.7s)` $\rightarrow$ `BiquadFilter (peaking, 2200 Hz, +8 dB)` $\rightarrow$ `StereoPannerNode`.
* **Spatial Panning**: Pan value $p \in [-1, 1]$ is computed from the dot product of the player camera's right vector $\mathbf{r}_{\text{cam}}$ and the normalized direction to the alien $\hat{\mathbf{d}}_{\text{PA}}$, with distance attenuation $g = \text{clamp}(1 - \|\mathbf{d}_{\text{PA}}\|/45, 0.05, 1.0)^2$.

---

### 7.2 Diegetic Helmet HUD Layout (`index.html` & `audio_ui.js`)

The HUD is rendered as a sharp, high-contrast sci-fi SVG/CSS/Canvas overlay curved inside the helmet visor bezel:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [SYS: ORBITAL-9 // SUIT TELEMETRY]       [MODE: ZERO-G EVA / STABILIZER ON] │
│ ┌──────────────────────┐                           ┌──────────────────────┐ │
│ │ O2 RESERVE     84%   │    ╔═════════════════╗    │ [2D TACTICAL RADAR]  │ │
│ │ ████████████████░░░░ │    ║ OBJECTIVE:      ║    │       .  ▲  .        │ │
│ │ CALORIC RATION 72%   │    ║ SCAVENGE EVA    ║    │    ● (POD)   ● (ALN) │ │
│ │ ██████████████░░░░░░ │    ║ SUPPLY PODS     ║    │         (P)          │ │
│ │ SUIT INTEGRITY 100%  │    ╚═════════════════╝    │        [AIR]         │ │
│ │ ████████████████████ │                           └──────────────────────┘ │
│ └──────────────────────┘                                                    │
│                                                                             │
│                                    ( + )                                    │
│                             [HOLD E] HARVEST POD                            │
│                                  ( 65% ○ )                                  │
│                                                                             │
│ [FLASHLIGHT: F (ON)]   [RCS DAMPENERS: R (ON)]   [ACOUSTIC SIG: LOW 1.5m]   │
└─────────────────────────────────────────────────────────────────────────────┘
```

* **2D Tactical Radar Canvas (`160x160px`, top-right)**:
  * Draws concentric range rings (`15m`, `30m`, `50m`), a rotating phosphor sweep line, and projects all active `gameContext.radarTargets` into the player's local camera $XZ$ plane:
    * **Cyan Blips (`#38bdf8`)**: Drifting EVA Cargo Supply Pods (`POD`).
    * **Pulsing Red Triangles (`#ef4444`)**: Detected or moving Void Stalkers (`ALIEN`).
    * **Amber Squares (`#f59e0b`)**: Airlock Hatch (`AIRLOCK`) and Bridge Lockdown Console (`BRIDGE`).
* **Center Reticle & Radial Hold-E Progress Ring**:
  * Dynamic SVG circle (`stroke-dasharray: 163.36`) around the crosshair that fills smoothly from `0%` to `100%` during any hold interaction (Pod Harvest `1.5s`, Locker `0.8s`, Bridge Emergency Lockdown `2.5s`).

### 7.3 Deterministic Verification & Debug Hooks (`window.__ORBITAL9_DEBUG__`)

To support automated browser inspection and instant deterministic verification of all game states, `audio_ui.js` and `index.html` expose `window.__ORBITAL9_DEBUG__`:

```javascript
window.__ORBITAL9_DEBUG__ = {
  getState: () => gameContext,
  // 1. Instant transition to Exterior Zero-G EVA view looking at station hull, planet & drifting pods
  enterEVAView: () => {
    gameContext.isPaused = false;
    document.getElementById('start-overlay')?.classList.add('hidden');
    stationManager.triggerRedAlert(false);
    playerController.teleportToPreset('EVA_EXTERIOR'); // Pos: (8.5, 4.2, 34.0), looking toward station & planet (-Z)
  },
  // 2. Instant transition to Interior Red-Alert Emergency Breach & Bridge/Corridor view
  triggerRedAlertView: () => {
    gameContext.isPaused = false;
    document.getElementById('start-overlay')?.classList.add('hidden');
    playerController.teleportToPreset('CORRIDOR_BREACH'); // Pos: (0.0, 1.68, -4.5), looking down red-lit corridor/bridge
    alienDirector.forceBreachEvent();
  },
  // 3. Execute Bridge Emergency Lockdown blast door slam & steam purge
  executeLockdown: () => {
    stationManager.triggerEmergencyLockdown();
  }
};
```
Additionally, keyboard shortcuts **`Digit1`** (Interior Bridge), **`Digit2`** (Exterior Zero-G EVA View), and **`Digit3`** (Trigger Red-Alert Breach Alarm) are bound for instant interactive inspection.

---

## 8. `/swarm` Parallel Execution Plan & Browser Self-Verification Strategy

### 8.1 `/swarm` Roster & Non-Overlapping File Ownership

Every worker owns a strictly disjoint file to eliminate merge collisions, orchestrated under the native `/swarm` coordinator board (all workers building against the frozen Section 2 `GameState` & `EventBus` contracts):

| Roster Name | Role | Owned File(s) | Dependencies & Handoff |
| :--- | :--- | :--- | :--- |
| `integrator` | Core Bootstrap, `EffectComposer`, `VisorShaderPass`, HUD DOM & Main Loop | `index.html` | Freezes `GameState` contract first; wires all 5 modules in Phase 3 |
| `station` | Procedural PBR `CanvasTexture` Factory, Modular Interior, Airlock, Blast Doors & Lighting | `station.js` | Parallel in Phase 2 against frozen contract |
| `eva` | Deep-Space Starfield, Nebula, Fresnel Planet *Acheron-IV*, Exterior Hull & Cargo Pods | `eva_space.js` | Parallel in Phase 2 against frozen contract |
| `player` | Mag-Boot Interior Kinematics, 6-DOF Quaternion EVA Physics, Flashlight & Interactions | `player.js` | Parallel in Phase 2 against frozen contract |
| `aliens` | Procedural 6-Limbed Void Stalker Rig, Sensory AI FSM & Breach/Lockdown Director | `aliens.js` | Parallel in Phase 2 against frozen contract |
| `audio` | Pure Web Audio API Procedural Synthesizer, 2D Tactical Radar & Diegetic Helmet HUD | `audio_ui.js` | Parallel in Phase 2 against frozen contract |
| `verifier` | Static Contract Audit, Local HTTP Server Smoke Test & Visual QA Report | *(Read-only)* | Reviews all 6 files for export/event mismatches; hands off to built-in browser QA |

### 8.2 Phased Execution Dependency Order

* **Phase 1 — Contract Freeze (`coordinator`)**: Lock the shared `gameContext` schema, EventBus topics, coordinate bounds, and module export signatures defined in Section 2 & 4.2.
* **Phase 2 — Parallel Module Implementation (`/swarm`)**:
  * Spawn `station`, `eva`, `player`, `aliens`, and `audio` in parallel so all five ES modules are authored simultaneously without touching one another's files.
* **Phase 3 — Master Orchestration (`integrator`)**:
  * Build `index.html` with the Three.js r164 `importmap`, curved visor HUD markup, `WebGLRenderer`, `EffectComposer` (`RenderPass` -> `UnrealBloomPass` -> `VisorShaderPass`), instantiate all 5 managers, bind debug hooks (`window.__ORBITAL9_DEBUG__` and `Digit1`/`2`/`3`), and drive the master `requestAnimationFrame` loop.
* **Phase 4 — Contract Verification & Built-in Browser Visual QA (`verifier` + Built-in Browser)**:
  * `verifier` audits imports, symbol names, AABB alignment, and shader uniform bindings across all 6 files.
  * Start a local HTTP server (`python3 -m http.server 8080`) in `/Users/harel/.gemini/antigravity/scratch/orbital-9` and launch the **built-in browser** to inspect live gameplay, console logs, and screenshots.

### 8.3 Built-in Browser Self-Verification Checklist

1. **Zero Runtime / Shader Errors**:
   * Serve `/Users/harel/.gemini/antigravity/scratch/orbital-9` over local HTTP (`http://localhost:8080/index.html`).
   * Verify zero console errors, zero uncaught exceptions, and clean WebGL compilation of `VisorShaderPass` and the Planet Fresnel rim-lighting shader.
2. **Visual Inspection 1 — Exterior Zero-G EVA View**:
   * Trigger `window.__ORBITAL9_DEBUG__.enterEVAView()` (or press `2`).
   * Capture and visually inspect a screenshot confirming: dense starfield, distant nebula, Fresnel rim-lit planet *Acheron-IV*, brushed-steel exterior station hull & solar trusses, blinking cyan cargo supply pods, 2D radar blips, and curved helmet visor post-processing.
3. **Visual Inspection 2 — Interior Red-Alert Emergency Lockdown View**:
   * Trigger `window.__ORBITAL9_DEBUG__.triggerRedAlertView()` (or press `3`).
   * Capture and visually inspect a screenshot confirming: cut white lights, rotating red emergency spotlights, brushed steel + hazard stripe PBR textures, grated catwalk floor, glowing CRT Bridge Lockdown console, and procedural multi-limbed Void Stalker with blooming bioluminescent eyes.
   * Execute `window.__ORBITAL9_DEBUG__.executeLockdown()` and verify armored blast doors slamming shut, vent steam purge particles, and alien retreat.