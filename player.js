import * as THREE from "three";

export class PlayerController {
  constructor(gameContext) {
    this.ctx = gameContext;

    // Input state
    this.keys = {
      KeyW: false,
      KeyA: false,
      KeyS: false,
      KeyD: false,
      ShiftLeft: false,
      ShiftRight: false,
      Space: false,
      ControlLeft: false,
      ControlRight: false,
      KeyC: false,
      KeyQ: false,
      KeyE: false
    };

    // Edge-triggered key flags
    this.justPressedE = false;
    this.interactLockE = false;

    // Pointer lock & mouse delta accumulators
    this.pointerLocked = false;
    this.isDraggingLook = false;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.mouseSensitivityInterior = 0.0021;
    this.mouseSensitivityEVA = 0.016;

    // Interior look Euler state (YXZ order)
    this.yaw = 0.0;
    this.pitch = 0.0;

    // Head-bob & footstep state
    this.bobPhase = 0.0;
    this.lastFootstepSin = 0.0;
    this.footstepArmed = true;
    this.headBobOffset = new THREE.Vector3();

    // 6-DOF EVA Angular velocity in local space: (pitch, yaw, roll)
    this.evaAngularVel = new THREE.Vector3(0, 0, 0);
    this.thrusterPulseTimer = 0.0;

    // Airlock Gravity Transition state (1.2s SLERP)
    this.transitionTimer = 0.0;
    this.transitionDuration = 1.2;
    this.transitionStartQuat = new THREE.Quaternion();
    this.transitionTargetQuat = new THREE.Quaternion();
    this.transitionStartY = 1.68;
    this.transitionTargetYaw = 0.0;

    // Damage camera angular kick
    this.recoilPitch = 0.0;
    this.recoilRoll = 0.0;

    // Hold-E Interaction tracking
    this.activeInteractable = null;
    this.holdProgress = 0.0;

    // Lights & Camera Rig attachments
    this.flashlight = null;
    this.flashlightTarget = null;
    this.visorGlowLight = null;

    // EVA Peripheral Jetpack Thruster VFX
    this.thrusterVFXGroup = null;
    this.thrusterFlames = [];
    this.thrusterParticles = null;
    this.thrusterParticleData = [];

    // Pre-allocated scratch math objects (zero GC pressure in update loop)
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._v4 = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._euler = new THREE.Euler(0, 0, 0, "YXZ");
    this._q1 = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._mat4 = new THREE.Matrix4();
  }

  init() {
    const p = this.ctx.player;

    if (!p.position) p.position = new THREE.Vector3(0, 1.68, -9.5);
    if (!p.velocity) p.velocity = new THREE.Vector3(0, 0, 0);
    if (!p.quaternion) p.quaternion = new THREE.Quaternion();

    p.mode = p.mode || "INTERIOR";
    p.health = typeof p.health === "number" ? p.health : 100.0;
    p.oxygen = typeof p.oxygen === "number" ? p.oxygen : 100.0;
    p.hunger = typeof p.hunger === "number" ? p.hunger : 100.0;
    p.panic = typeof p.panic === "number" ? p.panic : 0.0;
    p.damageFlash = typeof p.damageFlash === "number" ? p.damageFlash : 0.0;
    p.flashlightOn = p.flashlightOn !== undefined ? p.flashlightOn : true;
    p.stabilizersOn = p.stabilizersOn !== undefined ? p.stabilizersOn : true;
    p.isThrusting = false;
    p.acousticRadius = 1.5;
    p.carriedRations = p.carriedRations || 0;
    p.carriedO2Cells = p.carriedO2Cells || 0;
    p.repairedRelays = p.repairedRelays || 0;
    p.activePrompt = null;

    // Ensure camera is in scene so child lights & peripheral thruster VFX render
    if (this.ctx.camera && this.ctx.scene && !this.ctx.camera.parent) {
      this.ctx.scene.add(this.ctx.camera);
    }

    this._setupHelmetLights();
    this._setupEVAThrusterVFX();
    this._bindInputs();
    this._bindEvents();

    // Default initial placement in Central Command Bridge
    this.teleportToPreset("BRIDGE");
  }

  _setupHelmetLights() {
    const cam = this.ctx.camera;
    if (!cam) return;

    // Primary high-intensity helmet SpotLight (25 deg half-angle cone, 35-42m reach)
    this.flashlight = new THREE.SpotLight(0xdff4ff, 4.2, 42.0, Math.PI / 6.5, 0.45, 1.3);
    this.flashlight.position.set(0.14, -0.06, -0.05);
    this.flashlight.castShadow = false; // Perf: avoid full second scene shadow pass every frame

    this.flashlightTarget = new THREE.Object3D();
    this.flashlightTarget.position.set(0.0, -0.05, -10.0);

    cam.add(this.flashlight);
    cam.add(this.flashlightTarget);
    this.flashlight.target = this.flashlightTarget;

    this.visorGlowLight = null; // Perf: removed extra PointLight; PMREM + flashlight handle close fill

    this.ctx.player.flashlightLight = this.flashlight;
  }

  _setupEVAThrusterVFX() {
    const cam = this.ctx.camera;
    if (!cam) return;

    this.thrusterVFXGroup = new THREE.Group();
    cam.add(this.thrusterVFXGroup);

    // Procedural radial soft glow texture for RCS gas puffs
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const g = canvas.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0.0, "rgba(220, 248, 255, 1.0)");
    grad.addColorStop(0.35, "rgba(56, 189, 248, 0.65)");
    grad.addColorStop(1.0, "rgba(12, 74, 110, 0.0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);

    const puffTexture = new THREE.CanvasTexture(canvas);

    // Peripheral lower-left and lower-right thruster nozzle glow cones
    const coneGeo = new THREE.ConeGeometry(0.045, 0.26, 10, 1, true);
    coneGeo.rotateX(Math.PI * 0.5);
    const leftMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const rightMat = leftMat.clone();

    const leftCone = new THREE.Mesh(coneGeo, leftMat);
    leftCone.position.set(-0.42, -0.34, -0.52);
    leftCone.rotation.set(0.15, 0.22, 0.0);

    const rightCone = new THREE.Mesh(coneGeo, rightMat);
    rightCone.position.set(0.42, -0.34, -0.52);
    rightCone.rotation.set(0.15, -0.22, 0.0);

    this.thrusterVFXGroup.add(leftCone, rightCone);
    this.thrusterFlames = [leftCone, rightCone];

    // Camera-local RCS particle puff system (48 particles)
    const count = 48;
    const positions = new Float32Array(count * 3);
    this.thrusterParticleData = [];

    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const px = side * (0.38 + Math.random() * 0.12);
      const py = -0.32 - Math.random() * 0.08;
      const pz = -0.45 - Math.random() * 0.9;
      positions[i * 3] = px;
      positions[i * 3 + 1] = py;
      positions[i * 3 + 2] = pz;

      this.thrusterParticleData.push({
        side,
        life: Math.random(),
        speed: 1.4 + Math.random() * 1.6,
        spreadX: (Math.random() - 0.5) * 0.35,
        spreadY: (Math.random() - 0.5) * 0.25
      });
    }

    const puffGeo = new THREE.BufferGeometry();
    puffGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const puffMat = new THREE.PointsMaterial({
      map: puffTexture,
      color: 0x7dd3fc,
      size: 0.09,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.thrusterParticles = new THREE.Points(puffGeo, puffMat);
    this.thrusterVFXGroup.add(this.thrusterParticles);
    this.thrusterVFXGroup.visible = false;
  }

  _bindInputs() {
    const domElement = this.ctx.renderer ? this.ctx.renderer.domElement : document.body;

    // Request PointerLock on canvas click when game is active
    domElement.addEventListener("click", () => {
      if (!this.ctx.isPaused && !this.ctx.isGameOver && document.pointerLockElement !== domElement) {
        try {
          const promise = domElement.requestPointerLock();
          if (promise && typeof promise.catch === "function") {
            promise.catch(() => {});
          }
        } catch (e) {
          // Fallback to drag-look if pointer lock is disallowed in headless/embedded view
        }
      }
    });

    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === domElement;
      if (!this.pointerLocked) {
        this._clearMovementKeys();
      }
    });

    // Mouse fallback for headless / unlocked testing
    domElement.addEventListener("mousedown", (e) => {
      if (e.button === 0 && !this.ctx.isPaused && !this.ctx.isGameOver) {
        this.isDraggingLook = true;
      }
    });

    window.addEventListener("mouseup", () => {
      this.isDraggingLook = false;
    });

    document.addEventListener("mousemove", (e) => {
      if (this.ctx.isPaused || this.ctx.isGameOver) return;
      if (!this.pointerLocked && !this.isDraggingLook) return;

      const dx = Math.max(-150, Math.min(150, e.movementX || 0));
      const dy = Math.max(-150, Math.min(150, e.movementY || 0));
      this.mouseDeltaX += dx;
      this.mouseDeltaY += dy;
    });

    window.addEventListener("keydown", (e) => {
      if (e.code in this.keys) {
        if (e.code === "KeyE" && !this.keys.KeyE) {
          this.justPressedE = true;
        }
        this.keys[e.code] = true;
      }

      if (this.ctx.isPaused || this.ctx.isGameOver) return;

      if (e.code === "Space") {
        e.preventDefault();
      }

      // Toggle Flashlight (KeyF)
      if (e.code === "KeyF" && !e.repeat) {
        this.ctx.player.flashlightOn = !this.ctx.player.flashlightOn;
        if (this.flashlight) {
          this.flashlight.visible = this.ctx.player.flashlightOn;
          this.flashlight.intensity = this.ctx.player.flashlightOn ? 4.2 : 0.0;
        }
      }

      // Toggle EVA Inertial Stabilizers / RCS Dampeners (KeyR)
      if (e.code === "KeyR" && !e.repeat) {
        this.ctx.player.stabilizersOn = !this.ctx.player.stabilizersOn;
      }

      // Quick-consume carried Nutrient Ration (KeyH)
      if (e.code === "KeyH" && !e.repeat) {
        if (this.ctx.player.carriedRations > 0 && this.ctx.player.hunger < 99.5) {
          this.ctx.player.carriedRations--;
          this.ctx.events.emit("SUPPLY_LOCKER_USED", {
            o2Restored: 0,
            foodRestored: 40,
            quickConsume: true
          });
        }
      }

      // Quick-consume carried O2 Cell (KeyV)
      if (e.code === "KeyV" && !e.repeat) {
        if (this.ctx.player.carriedO2Cells > 0 && this.ctx.player.oxygen < 99.5) {
          this.ctx.player.carriedO2Cells--;
          this.ctx.events.emit("SUPPLY_LOCKER_USED", {
            o2Restored: 35,
            foodRestored: 0,
            quickConsume: true
          });
        }
      }
    });

    window.addEventListener("keyup", (e) => {
      if (e.code in this.keys) {
        this.keys[e.code] = false;
      }
      if (e.code === "KeyE") {
        this.interactLockE = false;
      }
    });

    window.addEventListener("blur", () => {
      this._clearMovementKeys();
    });
  }

  _clearMovementKeys() {
    for (const k of Object.keys(this.keys)) {
      this.keys[k] = false;
    }
    this.justPressedE = false;
    this.interactLockE = false;
    this.isDraggingLook = false;
  }

  _bindEvents() {
    const events = this.ctx.events;
    if (!events || typeof events.on !== "function") return;

    // Airlock cycle completion -> switch between Interior Mag-Boots and 6-DOF EVA
    events.on("AIRLOCK_CYCLE_COMPLETE", (payload) => {
      const targetMode = payload && payload.mode;
      const pos = this.ctx.player.position;
      const airlockBox = this.ctx.colliders && this.ctx.colliders.airlockVolumeAABB;
      const inAirlock = airlockBox
        ? pos.x >= airlockBox.min.x - 0.25 &&
          pos.x <= airlockBox.max.x + 0.25 &&
          pos.y >= airlockBox.min.y - 0.5 &&
          pos.y <= airlockBox.max.y + 0.5 &&
          pos.z >= airlockBox.min.z - 0.35 &&
          pos.z <= airlockBox.max.z + 0.2
        : Math.abs(pos.x) <= 2.5 && pos.y >= -0.5 && pos.y <= 3.5 && pos.z >= 10.65 && pos.z <= 16.7;

      if (targetMode === "EVA" && inAirlock) {
        this.setMode("EVA");
      } else if (targetMode === "INTERIOR" && inAirlock && this.ctx.player.mode === "EVA") {
        this.setMode("AIRLOCK_TRANSITION");
      }
    });

    // EVA Cargo Supply Pod harvested -> add inventory reserves & immediately top up suit
    events.on("POD_HARVESTED", (payload) => {
      const p = this.ctx.player;
      p.carriedO2Cells = (p.carriedO2Cells || 0) + 1;
      p.carriedRations = (p.carriedRations || 0) + 1;
      p.repairedRelays = (p.repairedRelays || 0) + ((payload && payload.relayGain) || 1);

      // Direct immediate partial suit infusion + carried reserve
      p.oxygen = Math.min(100.0, p.oxygen + 25.0);
      p.hunger = Math.min(100.0, p.hunger + 20.0);
    });

    // Mess Hall Life-Support & Ration Synthesis Locker used (or KeyH/KeyV quick-consume)
    events.on("SUPPLY_LOCKER_USED", (payload) => {
      const p = this.ctx.player;
      const o2Gain = payload && typeof payload.o2Restored === "number" ? payload.o2Restored : 45;
      const foodGain = payload && typeof payload.foodRestored === "number" ? payload.foodRestored : 50;

      if (payload && payload.quickConsume) {
        p.oxygen = Math.min(100.0, p.oxygen + o2Gain);
        p.hunger = Math.min(100.0, p.hunger + foodGain);
      } else {
        // Consume any carried pods at the Mess Hall locker for full replenishment
        const bonusO2 = (p.carriedO2Cells || 0) * 35;
        const bonusFood = (p.carriedRations || 0) * 40;
        p.carriedO2Cells = 0;
        p.carriedRations = 0;

        p.oxygen = Math.min(100.0, p.oxygen + o2Gain + bonusO2);
        p.hunger = Math.min(100.0, p.hunger + foodGain + bonusFood);
        p.health = Math.min(100.0, p.health + 15.0);
      }
    });

    // Alien lunge or environmental hazard damage
    events.on("PLAYER_DAMAGED", (payload) => {
      const amount = payload && typeof payload.amount === "number" ? payload.amount : 20.0;
      const sourcePos = payload && payload.sourcePos ? payload.sourcePos : null;
      this.applyDamage(amount, sourcePos);
    });

    // Lockdown purge clear -> station restores nominal O2 atmosphere
    events.on("LOCKDOWN_CLEAR", () => {
      this.ctx.player.oxygen = 100.0;
    });
  }

  update(dt, elapsed) {
    // Clamp dt for numerical stability across tab switches
    const safeDt = Math.min(Math.max(dt || 0.016, 0.0), 0.05);
    const p = this.ctx.player;

    // Always decay damage trauma flash & recoil smoothly
    if (p.damageFlash > 0.0) {
      p.damageFlash = Math.max(0.0, p.damageFlash - 1.8 * safeDt);
    }
    this.recoilPitch *= Math.exp(-9.0 * safeDt);
    this.recoilRoll *= Math.exp(-9.0 * safeDt);

    this._updateFlashlightState(elapsed);

    if (this.ctx.isPaused || this.ctx.isGameOver) {
      this.mouseDeltaX = 0;
      this.mouseDeltaY = 0;
      this.justPressedE = false;
      p.isThrusting = false;
      p.activePrompt = null;
      this._updateEVAThrusterVFX(safeDt, elapsed, false, false);
      this._syncCameraTransform();
      return;
    }

    // 1. Update Metabolic & O2 Vitals Decay
    this._updateVitals(safeDt);

    // 2. Execute Active Kinematic Mode
    if (p.mode === "INTERIOR") {
      this._updateInteriorKinematics(safeDt, elapsed);
    } else if (p.mode === "AIRLOCK_TRANSITION") {
      this._updateAirlockTransition(safeDt);
    } else if (p.mode === "EVA") {
      this._updateEVAKinematics(safeDt, elapsed);
    }

    // 3. Evaluate Contextual Raycast / Proximity Interactions (Hold-E & Instant-E)
    this._updateInteractions(safeDt);

    // 4. Update EVA Peripheral Thruster Plume VFX
    const isBoosting = this.keys.ShiftLeft || this.keys.ShiftRight;
    this._updateEVAThrusterVFX(safeDt, elapsed, p.mode === "EVA" && p.isThrusting, isBoosting);

    // 5. Commit Final Camera Position & Orientation
    this._syncCameraTransform();

    // Clear per-frame edge state
    this.justPressedE = false;
  }

  _updateFlashlightState(elapsed) {
    if (!this.flashlight) return;
    const p = this.ctx.player;
    this.flashlight.visible = !!p.flashlightOn;
    if (p.flashlightOn) {
      // Subtle dying-battery / red-alert flicker
      let baseIntensity = 4.2;
      if (this.ctx.station && this.ctx.station.alarmActive) {
        const flicker = Math.sin(elapsed * 37.0) * Math.sin(elapsed * 19.0);
        if (flicker > 0.86) baseIntensity *= 0.65;
      }
      if (p.damageFlash > 0.25) {
        baseIntensity *= 0.5 + 0.5 * Math.sin(elapsed * 55.0);
      }
      this.flashlight.intensity = baseIntensity;
    } else {
      this.flashlight.intensity = 0.0;
    }

    if (this.visorGlowLight) {
      if (this.ctx.station && this.ctx.station.alarmActive) {
        this.visorGlowLight.color.setHex(0xf87171);
        this.visorGlowLight.intensity = 0.28;
      } else {
        this.visorGlowLight.color.setHex(0x38bdf8);
        this.visorGlowLight.intensity = 0.22;
      }
    }
  }

  _updateVitals(dt) {
    const p = this.ctx.player;
    const st = this.ctx.station;

    const isEVAOrBreach = p.mode === "EVA" || (st && st.alarmActive);
    const isSprinting =
      p.mode === "INTERIOR" &&
      (this.keys.ShiftLeft || this.keys.ShiftRight) &&
      (this.keys.KeyW || this.keys.KeyA || this.keys.KeyS || this.keys.KeyD);

    let o2DrainRate = isEVAOrBreach ? 1.35 : 0.55;
    if (isSprinting) {
      o2DrainRate *= 1.8;
    }

    p.oxygen = Math.max(0.0, p.oxygen - o2DrainRate * dt);
    p.hunger = Math.max(0.0, p.hunger - 0.35 * dt);

    // Health attrition on depleted reserves
    if (p.oxygen <= 0.0) {
      p.health = Math.max(0.0, p.health - 6.5 * dt);
    }
    if (p.hunger <= 0.0) {
      p.health = Math.max(0.0, p.health - 3.0 * dt);
    }

    // Compute baseline physiological panic (hypoxia, alarm, proximity to hunting stalkers, trauma)
    let targetPanic = 0.0;
    if (st && st.alarmActive) targetPanic += 0.42;
    if (p.oxygen < 35.0) targetPanic += ((35.0 - p.oxygen) / 35.0) * 0.55;
    if (p.damageFlash > 0.01) targetPanic = Math.max(targetPanic, p.damageFlash * 0.9);

    // Check closest alien radar target for proximity dread
    if (Array.isArray(this.ctx.radarTargets)) {
      let minAlienDist = Infinity;
      for (let i = 0; i < this.ctx.radarTargets.length; i++) {
        const rt = this.ctx.radarTargets[i];
        if (rt && rt.active && rt.type === "ALIEN" && rt.position) {
          const d = p.position.distanceTo(rt.position);
          if (d < minAlienDist) minAlienDist = d;
        }
      }
      if (minAlienDist < 18.0) {
        targetPanic += (1.0 - minAlienDist / 18.0) * 0.65;
      }
    }

    targetPanic = Math.min(1.0, Math.max(0.0, targetPanic));
    if (targetPanic > p.panic) {
      p.panic = Math.min(1.0, p.panic + (targetPanic - p.panic) * Math.min(1.0, dt * 4.5));
    } else {
      p.panic = Math.max(targetPanic, p.panic - 0.85 * dt);
    }

    // Check fatal condition
    if (p.health <= 0.0 && !this.ctx.isGameOver) {
      p.health = 0.0;
      this.ctx.isGameOver = true;
      if (p.oxygen <= 0.0) {
        this.ctx.gameOverReason = "ASPHYXIATION — SUIT OXYGEN RESERVES DEPLETED";
      } else if (p.hunger <= 0.0) {
        this.ctx.gameOverReason = "METABOLIC COLLAPSE — CALORIC RESERVES EXHAUSTED";
      } else {
        this.ctx.gameOverReason = "FATAL SUIT BREACH — KILLED BY VOID STALKER";
      }
      if (document.pointerLockElement) {
        try {
          document.exitPointerLock();
        } catch (e) {}
      }
    }
  }

  _updateInteriorKinematics(dt) {
    const p = this.ctx.player;
    p.isThrusting = false;

    // 1. Mouse Look Yaw / Pitch (clamped to +-82 deg)
    this.yaw -= this.mouseDeltaX * this.mouseSensitivityInterior;
    this.pitch -= this.mouseDeltaY * this.mouseSensitivityInterior;
    const maxPitch = THREE.MathUtils.degToRad(82.0);
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;

    this._euler.set(this.pitch, this.yaw, 0, "YXZ");
    p.quaternion.setFromEuler(this._euler);

    // 2. Planar Input Vector in Camera Yaw Space
    const moveForward = (this.keys.KeyW ? 1 : 0) - (this.keys.KeyS ? 1 : 0);
    const moveRight = (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0);

    const isSprinting = (this.keys.ShiftLeft || this.keys.ShiftRight) && (moveForward !== 0 || moveRight !== 0);
    const maxSpeed = isSprinting ? 6.6 : 4.2;
    const accel = 34.0;
    const friction = 10.5;

    // Forward (-Z) and Right (+X) rotated by yaw
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const fwdX = -sinY;
    const fwdZ = -cosY;
    const rightX = cosY;
    const rightZ = -sinY;

    let wishX = fwdX * moveForward + rightX * moveRight;
    let wishZ = fwdZ * moveForward + rightZ * moveRight;
    const wishLen = Math.hypot(wishX, wishZ);

    if (wishLen > 1e-5) {
      wishX /= wishLen;
      wishZ /= wishLen;

      // Drive velocity toward target maxSpeed against magnetic boot damping
      const driveAccel = Math.max(accel, maxSpeed * friction);
      p.velocity.x += (wishX * driveAccel - friction * p.velocity.x) * dt;
      p.velocity.z += (wishZ * driveAccel - friction * p.velocity.z) * dt;
    } else {
      const damp = Math.exp(-friction * dt);
      p.velocity.x *= damp;
      p.velocity.z *= damp;
    }
    p.velocity.y = 0.0;

    // Clamp horizontal speed
    const horizSpeed = Math.hypot(p.velocity.x, p.velocity.z);
    if (horizSpeed > maxSpeed) {
      const scale = maxSpeed / horizSpeed;
      p.velocity.x *= scale;
      p.velocity.z *= scale;
    }

    // Dynamic Acoustic Signature Radius
    if (horizSpeed < 0.25) {
      p.acousticRadius = 1.5;
    } else if (isSprinting || horizSpeed > 4.6) {
      p.acousticRadius = 22.0;
    } else {
      p.acousticRadius = 10.0;
    }

    // 3. Axis-Separated Sliding Collision against Walkable Union AABBs & Obstacles
    const radius = 0.42;
    const curX = p.position.x;
    const curZ = p.position.z;

    const candX = curX + p.velocity.x * dt;
    if (this._isValidInteriorCylinder(candX, curZ, radius)) {
      p.position.x = candX;
    } else {
      p.velocity.x = 0.0;
    }

    const candZ = curZ + p.velocity.z * dt;
    if (this._isValidInteriorCylinder(p.position.x, candZ, radius)) {
      p.position.z = candZ;
    } else {
      p.velocity.z = 0.0;
    }

    p.position.y = 1.68;

    // Check if player walked out the open outer EVA hatch into zero-G space
    const st = this.ctx.station;
    const outerOpen = st && (typeof st.outerDoorOpen === "number" ? st.outerDoorOpen > 0.7 : !!st.outerDoorOpen);
    if (outerOpen && p.position.z > 16.0) {
      this.setMode("EVA");
      return;
    }

    // 4. Sinusoidal Mag-Boot Head-Bob & Footstep Emission
    const speed = Math.hypot(p.velocity.x, p.velocity.z);
    if (speed > 0.25) {
      this.bobPhase += speed * 2.35 * dt;
      const amp = Math.min(1.0, speed / 4.2);
      const sin2 = Math.sin(2.0 * this.bobPhase);
      const cos1 = Math.cos(this.bobPhase);

      const yOffset = 0.042 * sin2 * amp;
      const xOffset = 0.024 * cos1 * amp;

      this.headBobOffset.set(rightX * xOffset, yOffset, rightZ * xOffset);

      // Trigger metallic footstep on downward trough crossing
      if (sin2 > 0.15) {
        this.footstepArmed = true;
      }
      if (this.footstepArmed && sin2 < -0.92 && this.lastFootstepSin >= -0.92) {
        this.footstepArmed = false;
        const inCorridor = p.position.z >= -6.0 && p.position.z <= 11.0 && Math.abs(p.position.x) <= 3.2;
        const surface = inCorridor ? "GRATE" : "STEEL";
        const intensity = Math.min(1.0, Math.max(0.25, speed / 6.6));
        this.ctx.events.emit("FOOTSTEP", { surface, intensity });
      }
      this.lastFootstepSin = sin2;
    } else {
      this.headBobOffset.multiplyScalar(Math.exp(-10.0 * dt));
      this.lastFootstepSin = 0.0;
    }
  }

  _isValidInteriorCylinder(x, z, r) {
    // 1. Check containment within walkable room/corridor volumes
    const stationMgr = this.ctx.managers && this.ctx.managers.station;
    const stOuter = this.ctx.station && (typeof this.ctx.station.outerDoorOpen === "number" ? this.ctx.station.outerDoorOpen > 0.7 : !!this.ctx.station.outerDoorOpen);
    let insideWalkable = false;

    if (stOuter && z >= 15.4 && z <= 17.6 && Math.abs(x) <= 1.75) {
      // Open outer EVA hatch threshold allows smooth walking egress into Zero-G EVA
      insideWalkable = true;
    } else if (stationMgr && typeof stationMgr.isInteriorPositionAllowed === "function") {
      insideWalkable = stationMgr.isInteriorPositionAllowed(x, z, r);
    } else {
      const walkables = (this.ctx.colliders && this.ctx.colliders.interiorWalkableAABBs) || [];
      if (walkables.length === 0) {
        insideWalkable = true;
      } else {
        // Verify the 2D circle (center + 8 perimeter sample points) lies inside the union of active walkable AABBs
        const st = this.ctx.station || {};
        const innerOpen =
          st.innerDoorOpen === undefined
            ? true
            : typeof st.innerDoorOpen === "number"
              ? st.innerDoorOpen > 0.65
              : !!st.innerDoorOpen;
        const outerOpen =
          typeof st.outerDoorOpen === "number" ? st.outerDoorOpen > 0.65 : !!st.outerDoorOpen;
        const lockdown = !!st.lockdownActive;

        // Enforce closed bulkhead / blast gate barriers
        if (lockdown && z > -6.35 && z < -5.45) {
          return false;
        }
        if (!innerOpen && z > 10.55 && z < 11.45) {
          return false;
        }
        if (!outerOpen && z > 16.05) {
          return false;
        }

        const diag = r * 0.7071;
        const pts = [
          [x, z],
          [x + r, z],
          [x - r, z],
          [x, z + r],
          [x, z - r],
          [x + diag, z + diag],
          [x - diag, z + diag],
          [x + diag, z - diag],
          [x - diag, z - diag]
        ];

        insideWalkable = true;
        for (let pIdx = 0; pIdx < pts.length; pIdx++) {
          const px = pts[pIdx][0];
          const pz = pts[pIdx][1];
          let ptValid = false;

          // If outer door is open, allow stepping past Z = 15.8 into the EVA hatch threshold
          if (outerOpen && pz >= 15.5 && pz <= 18.0 && Math.abs(px) <= 1.8) {
            ptValid = true;
          } else {
            for (let i = 0; i < walkables.length; i++) {
              const b = walkables[i];
              if (px >= b.min.x && px <= b.max.x && pz >= b.min.z && pz <= b.max.z) {
                ptValid = true;
                break;
              }
            }
          }

          if (!ptValid) {
            insideWalkable = false;
            break;
          }
        }
      }
    }

    if (!insideWalkable) return false;

    // 2. Check intersection against solid interior obstacles (consoles, tables, pillars, lockers)
    const obstacles = (this.ctx.colliders && this.ctx.colliders.interiorObstacleAABBs) || [];
    for (let i = 0; i < obstacles.length; i++) {
      const box = obstacles[i];
      if (!box) continue;
      // Ignore ceiling/sub-floor props outside the player's vertical body span [0.05, 1.85]
      if (box.max.y < 0.08 || box.min.y > 1.85) continue;

      const closestX = Math.max(box.min.x, Math.min(x, box.max.x));
      const closestZ = Math.max(box.min.z, Math.min(z, box.max.z));
      const dx = x - closestX;
      const dz = z - closestZ;
      if (dx * dx + dz * dz < r * r) {
        return false;
      }
    }

    return true;
  }

  _updateAirlockTransition(dt) {
    const p = this.ctx.player;
    p.isThrusting = false;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;

    this.transitionTimer += dt;
    const u = Math.min(1.0, this.transitionTimer / this.transitionDuration);
    // Smoothstep S-curve: 3u^2 - 2u^3
    const s = u * u * (3.0 - 2.0 * u);

    p.quaternion.slerpQuaternions(this.transitionStartQuat, this.transitionTargetQuat, s);
    p.position.y = THREE.MathUtils.lerp(this.transitionStartY, 1.68, s);

    // Gently damp any leftover EVA drift inside the airlock
    const damp = Math.exp(-6.0 * dt);
    p.velocity.multiplyScalar(damp);
    p.position.x += p.velocity.x * dt;
    p.position.z += p.velocity.z * dt;

    // Keep player safely inside airlock bounds during re-pressurization
    p.position.x = Math.max(-1.65, Math.min(1.65, p.position.x));
    p.position.z = Math.max(11.55, Math.min(15.75, p.position.z));

    this.headBobOffset.set(0, 0, 0);

    if (u >= 1.0) {
      p.mode = "INTERIOR";
      p.position.y = 1.68;
      p.velocity.set(0, 0, 0);
      this.yaw = this.transitionTargetYaw;
      this.pitch = 0.0;
      this._euler.set(0, this.yaw, 0, "YXZ");
      p.quaternion.setFromEuler(this._euler);

      // Mag-boot metallic deck lock clunk
      this.ctx.events.emit("FOOTSTEP", { surface: "STEEL", intensity: 0.9 });
    }
  }

  _updateEVAKinematics(dt) {
    const p = this.ctx.player;
    this.headBobOffset.set(0, 0, 0);

    // 1. 6-DOF Angular Velocity & Quaternion Orientation Integration
    // Mouse deltas apply framerate-independent angular velocity impulses to local yaw & pitch
    this.evaAngularVel.y -= this.mouseDeltaX * this.mouseSensitivityEVA;
    this.evaAngularVel.x -= this.mouseDeltaY * this.mouseSensitivityEVA;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;

    // Roll keys (KeyQ = roll left +1, KeyE = roll right -1)
    // Safeguard: suppress KeyE roll torque whenever an interactable target is in range or E is locked to interaction
    const suppressERoll = this.activeInteractable !== null || p.activePrompt !== null || this.interactLockE;
    const rollLeft = this.keys.KeyQ ? 1.0 : 0.0;
    const rollRight = this.keys.KeyE && !suppressERoll ? 1.0 : 0.0;
    const rollInput = rollLeft - rollRight;
    const rollTorque = 2.8; // rad/s^2
    this.evaAngularVel.z += rollInput * rollTorque * dt;

    // Clamp peak angular rates for stability on extreme mouse flicks
    this.evaAngularVel.x = Math.max(-5.0, Math.min(5.0, this.evaAngularVel.x));
    this.evaAngularVel.y = Math.max(-5.0, Math.min(5.0, this.evaAngularVel.y));
    this.evaAngularVel.z = Math.max(-4.0, Math.min(4.0, this.evaAngularVel.z));

    // Exponential RCS angular damping (lambda_omega = 7.5 s^-1)
    const angDamp = Math.exp(-7.5 * dt);
    this.evaAngularVel.multiplyScalar(angDamp);

    // Construct incremental local rotation quaternion from small-angle axis-angle vector theta = omega * dt
    const omegaMag = this.evaAngularVel.length();
    if (omegaMag > 1e-6) {
      const halfTheta = 0.5 * omegaMag * dt;
      const sinHalf = Math.sin(halfTheta) / omegaMag;
      this._q1.set(
        this.evaAngularVel.x * sinHalf,
        this.evaAngularVel.y * sinHalf,
        this.evaAngularVel.z * sinHalf,
        Math.cos(halfTheta)
      );
      p.quaternion.multiply(this._q1).normalize();
    }

    // 2. World-Space RCS Thrust Vector Projection
    // Extract orthonormal basis vectors from player quaternion
    this._forward.set(0, 0, -1).applyQuaternion(p.quaternion);
    this._right.set(1, 0, 0).applyQuaternion(p.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(p.quaternion);

    const ix = (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0);
    const iy =
      (this.keys.Space ? 1 : 0) -
      (this.keys.ControlLeft || this.keys.ControlRight || this.keys.KeyC ? 1 : 0);
    const iz = (this.keys.KeyW ? 1 : 0) - (this.keys.KeyS ? 1 : 0);

    const isBoosting = this.keys.ShiftLeft || this.keys.ShiftRight;
    const rcsAccel = isBoosting ? 12.5 : 7.8;

    this._v1.set(0, 0, 0);
    if (ix !== 0 || iy !== 0 || iz !== 0) {
      this._v1
        .addScaledVector(this._right, ix)
        .addScaledVector(this._up, iy)
        .addScaledVector(this._forward, iz)
        .normalize()
        .multiplyScalar(rcsAccel);

      p.isThrusting = true;
      p.acousticRadius = 28.0;

      this.thrusterPulseTimer -= dt;
      if (this.thrusterPulseTimer <= 0.0) {
        this.thrusterPulseTimer = 0.22;
        this.ctx.events.emit("THRUSTER_PULSE", { intensity: isBoosting ? 1.0 : 0.65 });
      }
    } else {
      p.isThrusting = false;
      p.acousticRadius = 1.5;
      this.thrusterPulseTimer = 0.0;
    }

    // 3. Linear Velocity Integration & Inertial Stabilizers
    const gamma = p.stabilizersOn ? 1.45 : 0.08;
    const linDamp = Math.exp(-gamma * dt);

    p.velocity.addScaledVector(this._v1, dt);
    p.velocity.multiplyScalar(linDamp);

    // Clamp max EVA speed to 14.0 m/s
    const speedSq = p.velocity.lengthSq();
    if (speedSq > 14.0 * 14.0) {
      p.velocity.multiplyScalar(14.0 / Math.sqrt(speedSq));
    }

    // Advance world position
    p.position.addScaledVector(p.velocity, dt);

    // Soft outer operational boundary leash (prevents getting permanently lost past 145m)
    const distFromOrigin = p.position.length();
    if (distFromOrigin > 125.0) {
      this._v2.copy(p.position).normalize();
      p.velocity.addScaledVector(this._v2, -9.0 * dt);
      if (distFromOrigin > 145.0) {
        p.position.copy(this._v2).multiplyScalar(145.0);
      }
    }

    // 4. Sphere-vs-AABB Exterior Hull Collision & Rebound
    this._resolveEVACollisions();
  }

  _resolveEVACollisions() {
    const p = this.ctx.player;
    const pos = p.position;
    const vel = p.velocity;
    const rEva = 0.55;
    const restitution = 0.25;

    const hullBoxes = (this.ctx.colliders && this.ctx.colliders.exteriorHullAABBs) || [];

    // Run 2 relaxation passes so corner contacts resolve cleanly
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < hullBoxes.length; i++) {
        const box = hullBoxes[i];
        if (!box) continue;

        const cx = Math.max(box.min.x, Math.min(pos.x, box.max.x));
        const cy = Math.max(box.min.y, Math.min(pos.y, box.max.y));
        const cz = Math.max(box.min.z, Math.min(pos.z, box.max.z));

        let dx = pos.x - cx;
        let dy = pos.y - cy;
        let dz = pos.z - cz;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq < rEva * rEva) {
          let dist = Math.sqrt(distSq);
          let nx = 0;
          let ny = 0;
          let nz = 0;

          if (dist > 1e-5) {
            nx = dx / dist;
            ny = dy / dist;
            nz = dz / dist;
            pos.x = cx + nx * rEva;
            pos.y = cy + ny * rEva;
            pos.z = cz + nz * rEva;
          } else {
            // Sphere center penetrated inside AABB: push out along minimum penetration face
            const dMinX = Math.abs(pos.x - box.min.x);
            const dMaxX = Math.abs(box.max.x - pos.x);
            const dMinY = Math.abs(pos.y - box.min.y);
            const dMaxY = Math.abs(box.max.y - pos.y);
            const dMinZ = Math.abs(pos.z - box.min.z);
            const dMaxZ = Math.abs(box.max.z - pos.z);
            const minPen = Math.min(dMinX, dMaxX, dMinY, dMaxY, dMinZ, dMaxZ);

            if (minPen === dMinX) {
              nx = -1;
              pos.x = box.min.x - rEva;
            } else if (minPen === dMaxX) {
              nx = 1;
              pos.x = box.max.x + rEva;
            } else if (minPen === dMinY) {
              ny = -1;
              pos.y = box.min.y - rEva;
            } else if (minPen === dMaxY) {
              ny = 1;
              pos.y = box.max.y + rEva;
            } else if (minPen === dMinZ) {
              nz = -1;
              pos.z = box.min.z - rEva;
            } else {
              nz = 1;
              pos.z = box.max.z + rEva;
            }
          }

          const vn = vel.x * nx + vel.y * ny + vel.z * nz;
          if (vn < 0.0) {
            const impulse = -(1.0 + restitution) * vn;
            vel.x += impulse * nx;
            vel.y += impulse * ny;
            vel.z += impulse * nz;
          }
        }
      }
    }

    // Airlock chamber wall & door constraints while floating inside or entering the Airlock in EVA mode
    const st = this.ctx.station || {};
    const outerOpen =
      st.outerDoorOpen === undefined
        ? true
        : typeof st.outerDoorOpen === "number"
          ? st.outerDoorOpen > 0.65
          : !!st.outerDoorOpen;

    if (pos.z > 10.6 && pos.z < 16.65 && Math.abs(pos.x) < 2.6 && pos.y > -0.4 && pos.y < 3.4) {
      // Inside Airlock tunnel (X in [-2.1, +2.1], Y in [0.55, 2.75], Z in [11.4, 16.5])
      if (pos.x < -1.85) {
        pos.x = -1.85;
        if (vel.x < 0) vel.x = -vel.x * restitution;
      } else if (pos.x > 1.85) {
        pos.x = 1.85;
        if (vel.x > 0) vel.x = -vel.x * restitution;
      }

      if (pos.y < 0.55) {
        pos.y = 0.55;
        if (vel.y < 0) vel.y = -vel.y * restitution;
      } else if (pos.y > 2.75) {
        pos.y = 2.75;
        if (vel.y > 0) vel.y = -vel.y * restitution;
      }

      // Inner airlock door at Z = 11.0 is sealed during EVA
      if (pos.z < 11.45) {
        pos.z = 11.45;
        if (vel.z < 0) vel.z = -vel.z * restitution;
      }

      // If outer hatch closes while player is inside the airlock, keep player inside Z <= 15.95
      if (!outerOpen && pos.z > 15.95) {
        pos.z = 15.95;
        if (vel.z > 0) vel.z = -vel.z * restitution;
      }
    } else if (!outerOpen && pos.z < 17.05 && pos.z > 15.8 && Math.abs(pos.x) < 2.6 && pos.y > -0.5 && pos.y < 3.6) {
      // Prevent flying through closed outer hatch from outside
      pos.z = 17.05;
      if (vel.z < 0) vel.z = -vel.z * restitution;
    }
  }

  _updateInteractions(dt) {
    const p = this.ctx.player;
    const interactables = this.ctx.interactables;
    if (!Array.isArray(interactables) || interactables.length === 0) {
      p.activePrompt = null;
      this.activeInteractable = null;
      this.holdProgress = 0.0;
      return;
    }

    // Camera world position & forward vector
    this._v1.copy(p.position).add(this.headBobOffset);
    this._forward.set(0, 0, -1).applyQuaternion(p.quaternion).normalize();

    let bestCandidate = null;
    let bestScore = -Infinity;

    for (let i = 0; i < interactables.length; i++) {
      const item = interactables[i];
      if (!item || !item.position) continue;
      if (typeof item.canInteract === "function" && !item.canInteract()) continue;

      const maxRadius = typeof item.radius === "number" ? item.radius : 2.6;
      this._v2.subVectors(item.position, this._v1);
      const dist = this._v2.length();
      if (dist > maxRadius) continue;

      // Require target to be within forward view cone (wider cone when very close)
      const dirDot = dist > 0.05 ? this._v2.divideScalar(dist).dot(this._forward) : 1.0;
      const minDot = dist < 1.35 ? 0.15 : 0.42;
      if (dirDot < minDot) continue;

      // Score favors direct reticle alignment and proximity
      const score = dirDot * 2.5 - (dist / maxRadius) * 0.85;
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = item;
      }
    }

    // Handle target switches
    if (bestCandidate !== this.activeInteractable) {
      if (
        this.activeInteractable &&
        this.activeInteractable.id === "BRIDGE_LOCKDOWN_CONSOLE" &&
        this.ctx.station &&
        !this.ctx.station.lockdownActive &&
        this.ctx.station.lockdownHoldProgress > 0.0
      ) {
        this.ctx.station.lockdownHoldProgress = 0.0;
        this.ctx.events.emit("LOCKDOWN_HOLD_TICK", { progress: 0.0 });
      }
      this.activeInteractable = bestCandidate;
      this.holdProgress = 0.0;
    }

    if (!bestCandidate) {
      p.activePrompt = null;
      return;
    }

    const holdDuration = typeof bestCandidate.holdDuration === "number" ? bestCandidate.holdDuration : 0.0;
    const isBridgeLockdown = bestCandidate.id === "BRIDGE_LOCKDOWN_CONSOLE";

    if (holdDuration <= 0.0) {
      // Instant press interaction (e.g., Airlock Control Panel)
      this.holdProgress = 0.0;
      if (this.justPressedE) {
        this.interactLockE = true;
        if (typeof bestCandidate.onInteract === "function") {
          bestCandidate.onInteract();
        }
      }
    } else {
      // Hold-E interaction (e.g., Cargo Pod 1.5s, Supply Locker 0.8s, Bridge Lockdown 2.5s)
      if (this.keys.KeyE) {
        this.interactLockE = true;
        this.holdProgress = Math.min(1.0, this.holdProgress + dt / holdDuration);

        if (typeof bestCandidate.onHoldTick === "function") {
          bestCandidate.onHoldTick(this.holdProgress);
        }
        if (isBridgeLockdown) {
          if (this.ctx.station) this.ctx.station.lockdownHoldProgress = this.holdProgress;
          this.ctx.events.emit("LOCKDOWN_HOLD_TICK", { progress: this.holdProgress });
        }

        if (this.holdProgress >= 1.0) {
          this.holdProgress = 0.0;
          this.keys.KeyE = false; // prevent re-trigger loop on same hold
          if (isBridgeLockdown && this.ctx.station) {
            this.ctx.station.lockdownHoldProgress = 1.0;
          }
          if (typeof bestCandidate.onInteract === "function") {
            bestCandidate.onInteract();
          }
        }
      } else {
        if (this.holdProgress > 0.0) {
          this.holdProgress = Math.max(0.0, this.holdProgress - dt * 2.2);
          if (typeof bestCandidate.onHoldTick === "function") {
            bestCandidate.onHoldTick(this.holdProgress);
          }
          if (isBridgeLockdown) {
            if (this.ctx.station) this.ctx.station.lockdownHoldProgress = this.holdProgress;
            this.ctx.events.emit("LOCKDOWN_HOLD_TICK", { progress: this.holdProgress });
          }
        }
      }
    }

    const labelText =
      typeof bestCandidate.label === "function"
        ? bestCandidate.label()
        : bestCandidate.label || "INTERACT";

    p.activePrompt = {
      id: bestCandidate.id,
      type: bestCandidate.type || "GENERIC",
      label: labelText,
      holdDuration,
      holdProgress: this.holdProgress
    };
  }

  _updateEVAThrusterVFX(dt, elapsed, active, isBoosting) {
    if (!this.thrusterVFXGroup) return;

    if (!active && this.thrusterParticles.material.opacity <= 0.01) {
      this.thrusterVFXGroup.visible = false;
      return;
    }

    this.thrusterVFXGroup.visible = true;
    const targetOpacity = active ? (isBoosting ? 0.82 : 0.48) : 0.0;

    // Update peripheral thruster flame cones
    for (let i = 0; i < this.thrusterFlames.length; i++) {
      const cone = this.thrusterFlames[i];
      cone.material.opacity += (targetOpacity - cone.material.opacity) * Math.min(1.0, dt * 14.0);
      const pulse = 0.88 + 0.24 * Math.sin(elapsed * 48.0 + i * 2.1);
      const boostScale = isBoosting ? 1.35 : 1.0;
      cone.scale.set(pulse, pulse, pulse * boostScale);
    }

    // Update drifting RCS gas puffs
    const puffMat = this.thrusterParticles.material;
    puffMat.opacity += (targetOpacity * 0.75 - puffMat.opacity) * Math.min(1.0, dt * 12.0);

    const posAttr = this.thrusterParticles.geometry.getAttribute("position");
    const arr = posAttr.array;

    for (let i = 0; i < this.thrusterParticleData.length; i++) {
      const d = this.thrusterParticleData[i];
      d.life += dt * d.speed * (isBoosting ? 1.5 : 1.0);
      if (d.life >= 1.0) {
        d.life -= 1.0;
      }

      const t = d.life;
      arr[i * 3] = d.side * (0.4 + t * 0.14) + d.spreadX * t;
      arr[i * 3 + 1] = -0.34 - t * 0.08 + d.spreadY * t;
      arr[i * 3 + 2] = -0.45 - t * 0.85;
    }
    posAttr.needsUpdate = true;
  }

  _syncCameraTransform() {
    const cam = this.ctx.camera;
    const p = this.ctx.player;
    if (!cam) return;

    // Position = player physical eye/suit center + head-bob offset
    cam.position.copy(p.position).add(this.headBobOffset);

    // Orientation = player quaternion * damage recoil angular kick
    if (Math.abs(this.recoilPitch) > 1e-4 || Math.abs(this.recoilRoll) > 1e-4) {
      this._euler.set(this.recoilPitch, 0, this.recoilRoll, "YXZ");
      this._q1.setFromEuler(this._euler);
      cam.quaternion.copy(p.quaternion).multiply(this._q1);
    } else {
      cam.quaternion.copy(p.quaternion);
    }
  }

  setMode(newMode) {
    const p = this.ctx.player;
    if (!p) return;

    if (newMode === "EVA") {
      p.mode = "EVA";
      this.headBobOffset.set(0, 0, 0);
      this.evaAngularVel.set(0, 0, 0);
      // Give a slight outward drift if stationary inside the airlock hatch
      if (p.velocity.lengthSq() < 0.05 && p.position.z >= 11.0 && p.position.z <= 17.0) {
        p.velocity.set(0, 0.1, 1.4);
      }
    } else if (newMode === "AIRLOCK_TRANSITION") {
      p.mode = "AIRLOCK_TRANSITION";
      p.isThrusting = false;
      this.evaAngularVel.set(0, 0, 0);
      this.transitionTimer = 0.0;
      this.transitionStartQuat.copy(p.quaternion);
      this.transitionStartY = p.position.y;

      // Preserve current horizontal look yaw for horizon-level upright quaternion
      this._forward.set(0, 0, -1).applyQuaternion(p.quaternion);
      if (Math.hypot(this._forward.x, this._forward.z) > 0.05) {
        this.transitionTargetYaw = Math.atan2(-this._forward.x, -this._forward.z);
      } else {
        this._up.set(0, 1, 0).applyQuaternion(p.quaternion);
        this.transitionTargetYaw = Math.atan2(-this._up.x, -this._up.z);
      }
      this._euler.set(0, this.transitionTargetYaw, 0, "YXZ");
      this.transitionTargetQuat.setFromEuler(this._euler);
    } else if (newMode === "INTERIOR") {
      p.mode = "INTERIOR";
      p.isThrusting = false;
      this.evaAngularVel.set(0, 0, 0);
      this.headBobOffset.set(0, 0, 0);

      // Extract yaw & pitch from current quaternion
      this._euler.setFromQuaternion(p.quaternion, "YXZ");
      this.yaw = this._euler.y;
      const maxPitch = THREE.MathUtils.degToRad(82.0);
      this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this._euler.x));
      this._euler.set(this.pitch, this.yaw, 0, "YXZ");
      p.quaternion.setFromEuler(this._euler);
      p.position.y = 1.68;
      p.velocity.y = 0.0;
    }

    this._syncCameraTransform();
  }

  applyDamage(amount, sourceWorldPos) {
    const p = this.ctx.player;
    if (this.ctx.isGameOver) return;

    const dmg = typeof amount === "number" ? amount : 25.0;
    p.health = Math.max(0.0, p.health - dmg);
    p.damageFlash = 1.0;
    p.panic = 1.0;

    // Camera angular recoil impulse
    this.recoilPitch = 0.16 + (Math.random() - 0.5) * 0.08;
    this.recoilRoll = (Math.random() < 0.5 ? -1 : 1) * (0.14 + Math.random() * 0.06);

    // Physical knockback away from damage source
    if (sourceWorldPos) {
      this._v1.subVectors(p.position, sourceWorldPos);
      if (p.mode === "INTERIOR") {
        this._v1.y = 0;
      }
      if (this._v1.lengthSq() > 1e-4) {
        this._v1.normalize();
        const knockbackSpeed = p.mode === "EVA" ? 4.8 : 5.5;
        p.velocity.addScaledVector(this._v1, knockbackSpeed);
      }
    }

    if (p.health <= 0.0) {
      p.health = 0.0;
      this.ctx.isGameOver = true;
      this.ctx.gameOverReason = "FATAL SUIT BREACH — KILLED BY VOID STALKER";
      if (document.pointerLockElement) {
        try {
          document.exitPointerLock();
        } catch (e) {}
      }
    }
  }

  teleportToPreset(presetName) {
    const p = this.ctx.player;
    if (!p) return;

    p.velocity.set(0, 0, 0);
    this.evaAngularVel.set(0, 0, 0);
    this.headBobOffset.set(0, 0, 0);
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.recoilPitch = 0;
    this.recoilRoll = 0;
    this.activeInteractable = null;
    this.holdProgress = 0.0;
    p.activePrompt = null;
    p.isThrusting = false;

    const key = (presetName || "BRIDGE").toUpperCase();

    if (key === "BRIDGE") {
      // Command Bridge facing forward toward the Master Lockdown Console and Acheron-IV viewport (-Z)
      p.mode = "INTERIOR";
      p.position.set(0.0, 1.68, -9.5);
      this._lookAtTarget(0.0, 1.35, -14.5);
    } else if (key === "CORRIDOR_BREACH" || key === "CORRIDOR") {
      // Dark Maintenance Corridor facing South (+Z) down the catwalk toward the vents & airlock
      p.mode = "INTERIOR";
      p.position.set(0.0, 1.68, -4.8);
      this._lookAtTarget(0.0, 1.3, 4.5);
    } else if (key === "AIRLOCK") {
      // Inside Airlock Chamber looking toward the Airlock Control Terminal
      p.mode = "INTERIOR";
      p.position.set(0.0, 1.68, 13.5);
      this._lookAtTarget(1.5, 1.35, 15.0);
    } else if (key === "EVA_EXTERIOR" || key === "EVA") {
      // Exterior Zero-G EVA vantage looking back at the station superstructure, drifting pods, and planet Acheron-IV
      p.mode = "EVA";
      p.position.set(9.5, 4.8, 36.0);
      this._lookAtTarget(0.0, 1.5, 4.0);
    } else {
      p.mode = "INTERIOR";
      p.position.set(0.0, 1.68, -9.5);
      this._lookAtTarget(0.0, 1.35, -14.5);
    }

    this._syncCameraTransform();
    if (this.ctx.camera) {
      this.ctx.camera.updateMatrixWorld(true);
    }
  }

  _lookAtTarget(tx, ty, tz) {
    const p = this.ctx.player;
    this._v1.set(tx, ty, tz);
    this._mat4.lookAt(p.position, this._v1, this._up.set(0, 1, 0));
    p.quaternion.setFromRotationMatrix(this._mat4);

    this._euler.setFromQuaternion(p.quaternion, "YXZ");
    this.yaw = this._euler.y;
    this.pitch = this._euler.x;
  }
}
