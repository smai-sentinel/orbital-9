import * as THREE from 'three';

export class AlienDirector {
  constructor(gameContext) {
    this.gameContext = gameContext;
    this.aliens = [];

    this.STATES = {
      STALK_HULL: 'STALK_HULL',
      PATROL_VENTS: 'PATROL_VENTS',
      INVESTIGATE_SIGNAL: 'INVESTIGATE_SIGNAL',
      HUNT_PURSUE: 'HUNT_PURSUE',
      LUNGE_ATTACK: 'LUNGE_ATTACK',
      RETREAT_PURGE: 'RETREAT_PURGE'
    };

    // Pre-allocated scratch math objects to prevent GC pauses during frame loop
    this._vecA = new THREE.Vector3();
    this._vecB = new THREE.Vector3();
    this._vecC = new THREE.Vector3();
    this._vecD = new THREE.Vector3();
    this._camForward = new THREE.Vector3();
    this._dirToAlien = new THREE.Vector3();
    this._ray = new THREE.Ray();
    this._hitPoint = new THREE.Vector3();
    this._quatA = new THREE.Quaternion();
    this._quatB = new THREE.Quaternion();
    this._mat4 = new THREE.Matrix4();
    this._upVec = new THREE.Vector3(0, 1, 0);

    // Acoustic stimulus tracker from FOOTSTEP / THRUSTER_PULSE events
    this.lastAcousticEvent = {
      position: new THREE.Vector3(),
      intensity: 0.0,
      timestamp: -999.0,
      domain: 'INTERIOR'
    };

    this.sharedMaterials = null;
  }

  init() {
    const hullBump = this.gameContext?.textures?.hull?.bumpMap || null;

    this.sharedMaterials = {
      exoskeleton: new THREE.MeshStandardMaterial({
        color: 0x0d1017,
        roughness: 0.22,
        metalness: 0.78,
        bumpMap: hullBump,
        bumpScale: 0.02,
        envMapIntensity: 1.45
      }),
      chitin: new THREE.MeshStandardMaterial({
        color: 0x161b24,
        roughness: 0.32,
        metalness: 0.68,
        bumpMap: hullBump,
        bumpScale: 0.015,
        envMapIntensity: 1.25
      }),
      clawMetal: new THREE.MeshStandardMaterial({
        color: 0x202733,
        roughness: 0.18,
        metalness: 0.88,
        envMapIntensity: 1.6
      })
    };

    this.spawnStalkers();
    this.bindEvents();
  }

  buildVoidStalkerRig(id, role) {
    const root = new THREE.Group();
    root.name = `VoidStalker_${id}`;

    const exoMat = this.sharedMaterials.exoskeleton;
    const chitinMat = this.sharedMaterials.chitin;
    const clawMat = this.sharedMaterials.clawMetal;

    // Dedicated emissive eye material per alien for independent patrol/hunt color shifts & HDR bloom
    const eyeMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xff8800),
      toneMapped: false
    });

    // 1. Body / Thorax Group (local +Z is forward toward head, -Z is toward tail)
    const bodyGroup = new THREE.Group();
    root.add(bodyGroup);

    // Central biomechanical spine column
    const spineGeo = new THREE.CylinderGeometry(0.16, 0.12, 1.45, 10);
    spineGeo.rotateX(Math.PI * 0.5);
    const spineMesh = new THREE.Mesh(spineGeo, chitinMat);
    spineMesh.position.set(0, 0.02, -0.1);
    spineMesh.castShadow = false;
    spineMesh.receiveShadow = true;
    bodyGroup.add(spineMesh);

    // 7 Overlapping curved dorsal carapace plates tapering posteriorly along Z
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const zPos = 0.52 - i * 0.20;
      const width = 0.34 * (1.0 - t * 0.42) + Math.sin(t * Math.PI) * 0.08;
      const height = 0.22 * (1.0 - t * 0.35);
      const length = 0.25;

      const plateGeo = new THREE.SphereGeometry(1.0, 12, 10);
      plateGeo.scale(width, height, length);
      const plate = new THREE.Mesh(plateGeo, exoMat);
      plate.position.set(0, 0.08 + Math.sin(t * Math.PI) * 0.06, zPos);
      plate.rotation.x = -0.18 - t * 0.12;
      plate.castShadow = false;
      plate.receiveShadow = true;
      bodyGroup.add(plate);

      // Paired dorsal heat-vent spines along the thoracic ridge
      if (i >= 1 && i <= 5) {
        const spineLen = 0.28 + Math.sin(t * Math.PI) * 0.14;
        const dorsalSpineGeo = new THREE.ConeGeometry(0.032, spineLen, 7);
        dorsalSpineGeo.translate(0, spineLen * 0.5, 0);

        for (let side of [-1, 1]) {
          const dSpine = new THREE.Mesh(dorsalSpineGeo, clawMat);
          dSpine.position.set(side * (0.07 + (1 - t) * 0.03), 0.16, zPos - 0.02);
          dSpine.rotation.x = -0.82 - t * 0.15;
          dSpine.rotation.z = -side * 0.26;
          dSpine.castShadow = false;
          bodyGroup.add(dSpine);
        }
      }

      // Ventral ribcage arches curving beneath the thorax
      if (i < 5) {
        const ribGeo = new THREE.TorusGeometry(width * 0.88, 0.026, 7, 12, Math.PI * 1.15);
        const rib = new THREE.Mesh(ribGeo, chitinMat);
        rib.position.set(0, -0.02, zPos);
        rib.rotation.z = Math.PI * 0.925;
        rib.rotation.x = 0.25;
        rib.castShadow = false;
        bodyGroup.add(rib);
      }
    }

    // 2. Elongated Domed Cranium, Clustered Ocular Nodes & Articulated Mandibles
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.16, 0.62);
    bodyGroup.add(headGroup);

    // Swept ellipsoid skull dome (PLAN.md scale: 0.28, 0.24, 0.75)
    const skullGeo = new THREE.SphereGeometry(1.0, 16, 14);
    skullGeo.scale(0.28, 0.24, 0.75);
    const skullMesh = new THREE.Mesh(skullGeo, exoMat);
    skullMesh.position.set(0, 0.05, -0.14);
    skullMesh.rotation.x = 0.12;
    skullMesh.castShadow = false;
    skullMesh.receiveShadow = true;
    headGroup.add(skullMesh);

    // Curved dorsal occipital crest ridge
    const crestGeo = new THREE.ConeGeometry(0.11, 0.82, 8);
    crestGeo.rotateX(-Math.PI * 0.52);
    const crestMesh = new THREE.Mesh(crestGeo, exoMat);
    crestMesh.position.set(0, 0.17, -0.32);
    crestMesh.scale.set(0.65, 0.85, 1.0);
    crestMesh.castShadow = false;
    headGroup.add(crestMesh);

    // Armored brow ridge positioned cleanly above ocular nodes
    const browGeo = new THREE.BoxGeometry(0.34, 0.055, 0.22);
    const browMesh = new THREE.Mesh(browGeo, clawMat);
    browMesh.position.set(0, 0.115, 0.36);
    browMesh.rotation.x = 0.22;
    headGroup.add(browMesh);

    // 4 Clustered Bioluminescent Ocular Nodes protruding cleanly outside the anterior cranium
    const eyeNodes = [];
    const primaryEyeGeo = new THREE.SphereGeometry(0.042, 10, 8);
    primaryEyeGeo.scale(1.3, 0.75, 1.0);
    const secondaryEyeGeo = new THREE.SphereGeometry(0.028, 8, 6);

    const eyeOffsets = [
      { pos: [-0.11, 0.025, 0.56], rotY: -0.22, rotZ: -0.18, geo: primaryEyeGeo },
      { pos: [0.11, 0.025, 0.56], rotY: 0.22, rotZ: 0.18, geo: primaryEyeGeo },
      { pos: [-0.195, 0.05, 0.42], rotY: -0.52, rotZ: -0.25, geo: secondaryEyeGeo },
      { pos: [0.195, 0.05, 0.42], rotY: 0.52, rotZ: 0.25, geo: secondaryEyeGeo }
    ];

    for (const cfg of eyeOffsets) {
      const eyeMesh = new THREE.Mesh(cfg.geo, eyeMat);
      eyeMesh.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
      eyeMesh.rotation.set(0, cfg.rotY, cfg.rotZ);
      headGroup.add(eyeMesh);
      eyeNodes.push(eyeMesh);
    }

    // Perf: lightweight stub instead of 4 real-time PointLights; HDR emissive eyes bloom via UnrealBloomPass
    const eyeLight = { color: new THREE.Color(0xff8800), intensity: 0.9 };

    // Articulated Mandibles (Left Outer, Right Outer, Lower Jaw, Inner Pharyngeal Jaw)
    const mandibles = {};

    const outerMandibleGeo = new THREE.ConeGeometry(0.042, 0.32, 7);
    outerMandibleGeo.rotateX(Math.PI * 0.5);
    outerMandibleGeo.translate(0, 0, 0.15);

    const leftMandiblePivot = new THREE.Group();
    leftMandiblePivot.position.set(-0.12, -0.05, 0.28);
    const leftMandibleMesh = new THREE.Mesh(outerMandibleGeo, clawMat);
    leftMandibleMesh.rotation.y = 0.22;
    leftMandiblePivot.add(leftMandibleMesh);
    headGroup.add(leftMandiblePivot);
    mandibles.left = leftMandiblePivot;

    const rightMandiblePivot = new THREE.Group();
    rightMandiblePivot.position.set(0.12, -0.05, 0.28);
    const rightMandibleMesh = new THREE.Mesh(outerMandibleGeo, clawMat);
    rightMandibleMesh.rotation.y = -0.22;
    rightMandiblePivot.add(rightMandibleMesh);
    headGroup.add(rightMandiblePivot);
    mandibles.right = rightMandiblePivot;

    const lowerJawPivot = new THREE.Group();
    lowerJawPivot.position.set(0, -0.09, 0.24);
    const lowerJawGeo = new THREE.BoxGeometry(0.16, 0.045, 0.28);
    lowerJawGeo.translate(0, 0, 0.13);
    const lowerJawMesh = new THREE.Mesh(lowerJawGeo, chitinMat);
    lowerJawPivot.add(lowerJawMesh);
    headGroup.add(lowerJawPivot);
    mandibles.lower = lowerJawPivot;

    const innerJawPivot = new THREE.Group();
    innerJawPivot.position.set(0, -0.04, 0.20);
    const innerPistonGeo = new THREE.CylinderGeometry(0.025, 0.028, 0.36, 7);
    innerPistonGeo.rotateX(Math.PI * 0.5);
    innerPistonGeo.translate(0, 0, 0.16);
    const innerJawMesh = new THREE.Mesh(innerPistonGeo, clawMat);
    innerJawPivot.add(innerJawMesh);
    headGroup.add(innerJawPivot);
    mandibles.inner = innerJawPivot;

    // 3. Six Articulated 3-Joint Crawling Limbs (3 Left, 3 Right)
    // k = 0..5: 0 = L-front, 1 = R-front, 2 = L-mid, 3 = R-mid, 4 = L-rear, 5 = R-rear
    // Tripod Set A = {0, 3, 4} (phase 0), Tripod Set B = {1, 2, 5} (phase PI)
    const legs = [];
    const L1 = 0.65; // Coxa / Femur
    const L2 = 0.75; // Tibia
    const L3 = 0.35; // Tarsal Claw

    const femurGeo = new THREE.CylinderGeometry(0.055, 0.042, L1, 8);
    femurGeo.translate(0, L1 * 0.5, 0);

    const kneeJointGeo = new THREE.SphereGeometry(0.052, 8, 8);

    const tibiaGeo = new THREE.CylinderGeometry(0.042, 0.026, L2, 8);
    tibiaGeo.translate(0, L2 * 0.5, 0);

    const clawGeo = new THREE.ConeGeometry(0.028, L3, 7);
    clawGeo.translate(0, L3 * 0.5, 0);

    const legConfigs = [
      { k: 0, side: -1, zOffset: 0.42, baseYaw: 0.42, tripodSet: 'A' },
      { k: 1, side: 1, zOffset: 0.42, baseYaw: 0.42, tripodSet: 'B' },
      { k: 2, side: -1, zOffset: 0.02, baseYaw: 0.02, tripodSet: 'B' },
      { k: 3, side: 1, zOffset: 0.02, baseYaw: 0.02, tripodSet: 'A' },
      { k: 4, side: -1, zOffset: -0.38, baseYaw: -0.44, tripodSet: 'A' },
      { k: 5, side: 1, zOffset: -0.38, baseYaw: -0.44, tripodSet: 'B' }
    ];

    for (const cfg of legConfigs) {
      // Mount socket on thorax flank
      const legMount = new THREE.Group();
      legMount.position.set(cfg.side * 0.24, -0.02, cfg.zOffset);
      // Orient local +X outward along side (-1 for left, +1 for right)
      legMount.rotation.y = cfg.side === 1 ? -cfg.baseYaw : Math.PI + cfg.baseYaw;
      bodyGroup.add(legMount);

      // Hip / Coxa-Femur Pivot
      const hipPivot = new THREE.Group();
      legMount.add(hipPivot);

      // Femur extends outward along local +X and slightly upward (+Y)
      const femurMesh = new THREE.Mesh(femurGeo, exoMat);
      femurMesh.rotation.z = -Math.PI * 0.5 + 0.34;
      femurMesh.castShadow = false;
      femurMesh.receiveShadow = true;
      hipPivot.add(femurMesh);

      const femurEndX = Math.cos(0.34) * L1;
      const femurEndY = Math.sin(0.34) * L1;

      const kneeBall = new THREE.Mesh(kneeJointGeo, chitinMat);
      kneeBall.position.set(femurEndX, femurEndY, 0);
      hipPivot.add(kneeBall);

      // Tibia Knee Pivot located at femur tip
      const kneePivot = new THREE.Group();
      kneePivot.position.set(femurEndX, femurEndY, 0);
      hipPivot.add(kneePivot);

      // Tibia extends along local +X of kneePivot (which pitches downward via rotation.z)
      const tibiaMesh = new THREE.Mesh(tibiaGeo, chitinMat);
      tibiaMesh.rotation.z = -Math.PI * 0.5;
      tibiaMesh.castShadow = false;
      kneePivot.add(tibiaMesh);

      // Tarsal Claw Pivot at tibia tip
      const clawPivot = new THREE.Group();
      clawPivot.position.set(L2, 0, 0);
      kneePivot.add(clawPivot);

      const clawMesh = new THREE.Mesh(clawGeo, clawMat);
      clawMesh.rotation.z = -Math.PI * 0.5;
      clawMesh.castShadow = false;
      clawPivot.add(clawMesh);

      const tripodOffset = (cfg.k === 0 || cfg.k === 3 || cfg.k === 4) ? 0.0 : Math.PI;

      legs.push({
        k: cfg.k,
        side: cfg.side,
        baseYaw: cfg.baseYaw,
        tripodOffset,
        legMount,
        hipPivot,
        kneePivot,
        clawPivot
      });
    }

    // 4. Nine-Segment Prehensile Whip Tail with Barbed Stinger Tip
    const tailSegments = [];
    let parentTailNode = bodyGroup;
    let attachPos = new THREE.Vector3(0, 0.04, -0.76);

    for (let j = 0; j < 9; j++) {
      const segPivot = new THREE.Group();
      segPivot.position.copy(attachPos);
      parentTailNode.add(segPivot);

      const t = j / 8;
      const segLen = 0.24 * (1.0 - t * 0.25);
      const rTop = 0.072 * (1.0 - t * 0.65);
      const rBot = 0.056 * (1.0 - t * 0.70);

      const segGeo = new THREE.CylinderGeometry(rTop, rBot, segLen, 8);
      segGeo.rotateX(Math.PI * 0.5);
      segGeo.translate(0, 0, -segLen * 0.5);

      const segMesh = new THREE.Mesh(segGeo, j % 2 === 0 ? exoMat : chitinMat);
      segMesh.castShadow = false;
      segPivot.add(segMesh);

      // Vertebral dorsal barb on each tail segment
      const barbGeo = new THREE.ConeGeometry(rTop * 0.6, 0.075, 5);
      const barbMesh = new THREE.Mesh(barbGeo, clawMat);
      barbMesh.position.set(0, rTop * 0.85, -segLen * 0.5);
      barbMesh.rotation.x = -0.65;
      segPivot.add(barbMesh);

      if (j === 8) {
        // Wicked curved scythe stinger at tail tip
        const stingerGeo = new THREE.ConeGeometry(0.036, 0.28, 7);
        stingerGeo.rotateX(-Math.PI * 0.42);
        stingerGeo.translate(0, 0.03, -0.13);
        const stingerMesh = new THREE.Mesh(stingerGeo, clawMat);
        stingerMesh.position.set(0, 0, -segLen);
        stingerMesh.castShadow = false;
        segPivot.add(stingerMesh);
      }

      tailSegments.push(segPivot);
      parentTailNode = segPivot;
      attachPos = new THREE.Vector3(0, 0, -segLen);
    }

    return {
      root,
      bodyGroup,
      headGroup,
      eyeMat,
      eyeLight,
      eyeNodes,
      mandibles,
      legs,
      tailSegments
    };
  }

  spawnStalkers() {
    const scene = this.gameContext?.scene;
    if (!scene) return;

    if (!Array.isArray(this.gameContext.radarTargets)) {
      this.gameContext.radarTargets = [];
    }

    const stalkerDefinitions = [
      {
        id: 'EXT_STALKER_1',
        role: 'EXTERIOR',
        initialState: this.STATES.STALK_HULL,
        spawnPos: new THREE.Vector3(-8.0, 6.0, 22.0),
        patrolSubMode: 'HULL_TRUSS',
        waypoints: [
          new THREE.Vector3(-8.0, 6.0, 22.0),
          new THREE.Vector3(-12.5, 4.5, 29.0),
          new THREE.Vector3(-6.5, 7.5, 36.0),
          new THREE.Vector3(5.0, 6.2, 28.0),
          new THREE.Vector3(-3.5, 5.5, 19.5)
        ]
      },
      {
        id: 'EXT_STALKER_2',
        role: 'EXTERIOR',
        initialState: this.STATES.STALK_HULL,
        spawnPos: new THREE.Vector3(11.0, -3.5, 42.0),
        patrolSubMode: 'CARGO_FIELD',
        waypoints: [
          new THREE.Vector3(11.0, -3.5, 42.0),
          new THREE.Vector3(16.0, 2.0, 54.0),
          new THREE.Vector3(4.0, -5.0, 61.0),
          new THREE.Vector3(-9.0, -2.0, 48.0),
          new THREE.Vector3(3.5, -4.0, 33.0)
        ]
      },
      {
        id: 'INT_STALKER_1',
        role: 'INTERIOR',
        initialState: this.STATES.PATROL_VENTS,
        spawnPos: new THREE.Vector3(-1.4, 2.78, -0.5),
        homeVent: new THREE.Vector3(-2.8, 2.4, -1.0),
        patrolSubMode: 'CEILING_VENT',
        waypoints: [
          new THREE.Vector3(-1.6, 2.78, -4.2),
          new THREE.Vector3(-1.2, 2.78, -1.0),
          new THREE.Vector3(1.4, 2.78, 3.2),
          new THREE.Vector3(-0.8, 2.78, 7.8),
          new THREE.Vector3(1.1, 2.78, 1.5)
        ]
      },
      {
        id: 'INT_STALKER_2',
        role: 'INTERIOR',
        initialState: this.STATES.PATROL_VENTS,
        spawnPos: new THREE.Vector3(1.1, -0.58, 5.2),
        homeVent: new THREE.Vector3(2.8, 2.4, 5.5),
        patrolSubMode: 'SUBFLOOR_TRENCH',
        waypoints: [
          new THREE.Vector3(1.1, -0.58, 5.2),
          new THREE.Vector3(-1.1, -0.58, 8.6),
          new THREE.Vector3(-0.9, -0.58, 1.0),
          new THREE.Vector3(1.0, -0.58, -3.8),
          new THREE.Vector3(0.4, -0.58, 2.5)
        ]
      }
    ];

    for (let i = 0; i < stalkerDefinitions.length; i++) {
      const def = stalkerDefinitions[i];
      const rig = this.buildVoidStalkerRig(def.id, def.role);
      rig.root.position.copy(def.spawnPos);

      if (def.patrolSubMode === 'CEILING_VENT') {
        rig.bodyGroup.rotation.z = Math.PI;
      }

      scene.add(rig.root);

      const radarTarget = {
        id: def.id,
        type: 'ALIEN',
        position: rig.root.position,
        active: true
      };
      this.gameContext.radarTargets.push(radarTarget);

      const alien = {
        id: def.id,
        index: i,
        role: def.role,
        group: rig.root,
        rig,
        state: def.initialState,
        patrolSubMode: def.patrolSubMode,
        waypoints: def.waypoints,
        waypointIndex: 1 % def.waypoints.length,
        homeVent: def.homeVent ? def.homeVent.clone() : new THREE.Vector3(0, 2.4, 0),
        aggroAccumulator: 0.0,
        lastStimulus: def.spawnPos.clone(),
        gaitPhase: i * 1.7,
        currentSpeed: 0.0,
        mandibleFlare: 0.0,
        targetMandibleFlare: 0.0,
        eyeColorCurrent: new THREE.Color(0xff8800),
        eyeColorTarget: new THREE.Color(0xff8800),
        eyeIntensityScale: 1.15,
        attackCooldown: 0.0,
        lungeTimer: 0.0,
        lungeDirection: new THREE.Vector3(0, 0, 1),
        hasDealtLungeDamage: false,
        screechCooldown: 0.0,
        hiddenInVent: false,
        radarTarget
      };

      this.updateAlienRig(alien, 0.016, 0.0);
      this.aliens.push(alien);
    }
  }

  bindEvents() {
    const events = this.gameContext?.events;
    if (!events || typeof events.on !== 'function') return;

    // 1. EVA Cargo Pod Harvested -> accelerate breach countdown by 15s and agitate exterior stalkers
    events.on('POD_HARVESTED', (payload) => {
      if (this.gameContext.station) {
        const cur = typeof this.gameContext.station.breachTimer === 'number'
          ? this.gameContext.station.breachTimer
          : 85.0;
        this.gameContext.station.breachTimer = Math.max(0.0, cur - 15.0);
      }

      for (const alien of this.aliens) {
        if (alien.role === 'EXTERIOR') {
          alien.aggroAccumulator = Math.min(100.0, alien.aggroAccumulator + 35.0);
          if (payload?.position) {
            alien.lastStimulus.copy(payload.position);
          } else if (this.gameContext.player?.position) {
            alien.lastStimulus.copy(this.gameContext.player.position);
          }
        }
      }
    });

    // 2. Interior Footsteps -> acoustic signature for interior stalkers
    events.on('FOOTSTEP', (payload) => {
      const playerPos = this.gameContext.player?.position;
      if (!playerPos) return;
      const intensity = payload?.intensity ?? 0.6;
      this.lastAcousticEvent.position.copy(playerPos);
      this.lastAcousticEvent.intensity = intensity;
      this.lastAcousticEvent.timestamp = this.gameContext.elapsed || 0.0;
      this.lastAcousticEvent.domain = 'INTERIOR';

      const effectiveRadius = Math.max(this.gameContext.player?.acousticRadius || 10.0, 10.0 + intensity * 12.0);
      for (const alien of this.aliens) {
        if (alien.role === 'INTERIOR' && !alien.hiddenInVent) {
          const dist = alien.group.position.distanceTo(playerPos);
          if (dist < effectiveRadius) {
            alien.lastStimulus.copy(playerPos);
            alien.aggroAccumulator = Math.min(100.0, alien.aggroAccumulator + 4.5 * intensity * (1.0 - dist / effectiveRadius));
          }
        }
      }
    });

    // 3. EVA Thruster Pulse -> 28m acoustic sphere for exterior stalkers
    events.on('THRUSTER_PULSE', (payload) => {
      const playerPos = this.gameContext.player?.position;
      if (!playerPos) return;
      const intensity = payload?.intensity ?? 1.0;
      this.lastAcousticEvent.position.copy(playerPos);
      this.lastAcousticEvent.intensity = intensity;
      this.lastAcousticEvent.timestamp = this.gameContext.elapsed || 0.0;
      this.lastAcousticEvent.domain = 'EVA';

      const rcsRadius = 28.0;
      for (const alien of this.aliens) {
        if (alien.role === 'EXTERIOR') {
          const dist = alien.group.position.distanceTo(playerPos);
          if (dist < rcsRadius) {
            alien.lastStimulus.copy(playerPos);
            alien.aggroAccumulator = Math.min(100.0, alien.aggroAccumulator + 6.0 * intensity * (1.0 - dist / rcsRadius));
          }
        }
      }
    });

    // 4. Bridge Emergency Lockdown Executed -> thermal vent steam purge forces interior aliens to retreat
    events.on('LOCKDOWN_EXECUTED', () => {
      this.onLockdownPurge();
    });

    // 5. Lockdown Clear -> reset interior stalkers to ceiling/sub-floor vent patrol & reset breach timer
    events.on('LOCKDOWN_CLEAR', () => {
      if (this.gameContext.station) {
        this.gameContext.station.breachTimer = 85.0;
      }

      for (const alien of this.aliens) {
        if (alien.role === 'INTERIOR') {
          alien.state = this.STATES.PATROL_VENTS;
          alien.aggroAccumulator = 0.0;
          alien.hiddenInVent = false;
          alien.group.visible = true;
          if (alien.radarTarget) alien.radarTarget.active = true;
          alien.waypointIndex = 0;
          alien.group.position.copy(alien.waypoints[0]);
          alien.group.rotation.set(0, 0, 0);
          alien.rig.bodyGroup.rotation.z = alien.patrolSubMode === 'CEILING_VENT' ? Math.PI : 0.0;
          alien.eyeColorTarget.setHex(0xff8800);
          alien.eyeIntensityScale = 1.15;
          alien.rig.eyeLight.intensity = 0.85;
          alien.targetMandibleFlare = 0.0;
        } else if (alien.role === 'EXTERIOR') {
          alien.aggroAccumulator = Math.min(alien.aggroAccumulator, 25.0);
          if (this.gameContext.player?.mode !== 'EVA') {
            alien.state = this.STATES.STALK_HULL;
          }
        }
      }
    });
  }

  forceBreachEvent() {
    const station = this.gameContext.station;
    if (station) {
      station.alarmActive = true;
      station.breachTimer = 85.0;
    }

    this.gameContext.events?.emit('BREACH_ALARM_TRIGGERED', {
      breachZone: 'CORRIDOR_VENT'
    });

    let primaryScreamer = null;

    for (const alien of this.aliens) {
      if (alien.role === 'INTERIOR') {
        alien.hiddenInVent = false;
        alien.group.visible = true;
        if (alien.radarTarget) alien.radarTarget.active = true;

        alien.state = this.STATES.HUNT_PURSUE;
        alien.aggroAccumulator = 100.0;
        alien.rig.bodyGroup.rotation.set(0, 0, 0);

        if (alien.id === 'INT_STALKER_1') {
          // Drop onto the Maintenance Corridor catwalk deck in dramatic mid-corridor view
          alien.group.position.set(0.25, 0.95, 5.4);
          alien.group.rotation.set(0, Math.PI, 0); // Face -Z toward Bridge/Corridor camera
          alien.attackCooldown = 2.4;
          primaryScreamer = alien;
        } else {
          // Drop second interior stalker deeper down the Maintenance Corridor
          alien.group.position.set(-1.1, 0.95, 9.2);
          alien.group.rotation.set(0, Math.PI, 0);
          alien.attackCooldown = 2.8;
        }

        // Immediately ignite crimson bioluminescent eyes for HDR UnrealBloomPass
        alien.eyeColorCurrent.setRGB(1.0 * 2.4, 0.06 * 2.4, 0.02 * 2.4);
        alien.eyeColorTarget.setRGB(1.0 * 2.4, 0.06 * 2.4, 0.02 * 2.4);
        alien.rig.eyeMat.color.copy(alien.eyeColorCurrent);
        alien.rig.eyeLight.color.setHex(0xff1200);
        alien.rig.eyeLight.intensity = 2.8;

        alien.mandibleFlare = 0.65;
        alien.targetMandibleFlare = 0.65;
        alien.currentSpeed = 4.2;

        if (this.gameContext.player?.position) {
          alien.lastStimulus.copy(this.gameContext.player.position);
        }

        this.updateAlienRig(alien, 0.016, this.gameContext.elapsed || 0.0);
        alien.group.updateMatrixWorld(true);
      }
    }

    if (primaryScreamer) {
      this.gameContext.events?.emit('ALIEN_SCREECH', {
        alienId: primaryScreamer.id,
        position: primaryScreamer.group.position.clone(),
        state: this.STATES.HUNT_PURSUE
      });
      primaryScreamer.screechCooldown = 4.5;
    }
  }

  onLockdownPurge() {
    let screecher = null;
    let closestDist = Infinity;
    const playerPos = this.gameContext.player?.position;

    for (const alien of this.aliens) {
      if (alien.role === 'INTERIOR') {
        alien.state = this.STATES.RETREAT_PURGE;
        alien.lungeTimer = 0.0;
        alien.hasDealtLungeDamage = false;
        alien.rig.bodyGroup.rotation.z = 0.0;
        alien.targetMandibleFlare = 0.9;
        alien.eyeColorTarget.setRGB(2.4, 0.35, 0.05);

        if (!alien.hiddenInVent) {
          alien.group.visible = true;
          if (playerPos) {
            const d = alien.group.position.distanceTo(playerPos);
            if (d < closestDist) {
              closestDist = d;
              screecher = alien;
            }
          } else if (!screecher) {
            screecher = alien;
          }
        }
      }
    }

    if (screecher) {
      this.gameContext.events?.emit('ALIEN_SCREECH', {
        alienId: screecher.id,
        position: screecher.group.position.clone(),
        state: this.STATES.RETREAT_PURGE
      });
    }
  }

  update(dt, elapsed) {
    const rawDt = (typeof dt === 'number' && Number.isFinite(dt)) ? dt : 0.016;
    const safeDt = Math.min(Math.max(rawDt, 0.0), 0.05);
    const now = typeof elapsed === 'number' ? elapsed : (this.gameContext.elapsed || 0.0);
    const isPaused = Boolean(this.gameContext.isPaused || this.gameContext.isGameOver);

    // If paused, game over, or multiplayer CLIENT (Host is authoritative for alien AI), animate rigs only
    if (isPaused || this.gameContext.multiplayer?.role === 'CLIENT') {
      for (const alien of this.aliens) {
        if (alien.group.visible) {
          this.updateAlienRig(alien, safeDt, now);
        }
      }
      return;
    }

    const station = this.gameContext.station;
    const player = this.gameContext.player;

    // 1. Scheduled Station Breach Countdown (75s-110s loop, default 85s)
    if (station && !station.alarmActive && !station.lockdownActive) {
      if (typeof station.breachTimer !== 'number') {
        station.breachTimer = 85.0;
      }
      station.breachTimer -= safeDt;

      let exteriorMaxAggro = 0.0;
      for (const alien of this.aliens) {
        if (alien.role === 'EXTERIOR' && alien.aggroAccumulator > exteriorMaxAggro) {
          exteriorMaxAggro = alien.aggroAccumulator;
        }
      }

      if (station.breachTimer <= 0.0 || exteriorMaxAggro >= 100.0) {
        this.forceBreachEvent();
      }
    }

    // 2. Per-Alien Sensory Detection, FSM State Execution & Procedural Rig Kinematics
    let maxProximityFear = 0.0;

    for (const alien of this.aliens) {
      if (alien.attackCooldown > 0.0) alien.attackCooldown = Math.max(0.0, alien.attackCooldown - safeDt);
      if (alien.screechCooldown > 0.0) alien.screechCooldown = Math.max(0.0, alien.screechCooldown - safeDt);

      if (alien.hiddenInVent) {
        continue;
      }

      this.evaluateSensoryStimuli(alien, safeDt, now);
      this.updateAlienFSM(alien, safeDt, now);
      this.updateAlienRig(alien, safeDt, now);

      // Compute proximity panic contribution for player visor & heartbeat
      if (player?.position && alien.group.visible) {
        const sameDomain = (alien.role === 'EXTERIOR' && player.mode === 'EVA') ||
                           (alien.role === 'INTERIOR' && player.mode !== 'EVA');
        if (sameDomain) {
          const dist = alien.group.position.distanceTo(player.position);
          const maxRange = alien.role === 'EXTERIOR' ? 28.0 : 16.0;
          if (dist < maxRange) {
            const prox = 1.0 - (dist / maxRange);
            const stateMult = (alien.state === this.STATES.HUNT_PURSUE || alien.state === this.STATES.LUNGE_ATTACK)
              ? 0.95
              : (alien.state === this.STATES.INVESTIGATE_SIGNAL ? 0.55 : 0.25);
            const fear = Math.min(1.0, prox * stateMult);
            if (fear > maxProximityFear) {
              maxProximityFear = fear;
            }
          }
        }
      }
    }

    // 3. Smoothly elevate player.panic when stalkers are hunting nearby
    if (player && typeof player.panic === 'number') {
      if (maxProximityFear > player.panic) {
        player.panic = Math.min(1.0, player.panic + (maxProximityFear - player.panic) * Math.min(1.0, safeDt * 4.5));
      }
    }
  }

  evaluateSensoryStimuli(alien, dt, elapsed) {
    if (alien.state === this.STATES.RETREAT_PURGE) return;

    const player = this.gameContext.player;
    const camera = this.gameContext.camera;
    const station = this.gameContext.station;
    if (!player?.position) return;

    const playerPos = player.position;
    const alienPos = alien.group.position;
    const dist = alienPos.distanceTo(playerPos);

    const playerInEVA = player.mode === 'EVA' || playerPos.z > 16.2;
    const domainMatch = (alien.role === 'EXTERIOR' && playerInEVA) ||
                        (alien.role === 'INTERIOR' && !playerInEVA);

    let stimulusDetected = false;

    if (domainMatch) {
      // 1. Photonic Flashlight Cone Detection (24 deg half-angle, 35m range, unobstructed ray)
      if (player.flashlightOn && camera && dist < 35.0 && dist > 0.05) {
        camera.getWorldDirection(this._camForward);
        this._dirToAlien.subVectors(alienPos, playerPos).normalize();
        const dot = this._camForward.dot(this._dirToAlien);

        // cos(24 degrees) ≈ 0.913545
        if (dot > 0.9135 && this.hasLineOfSight(playerPos, alienPos, alien.role)) {
          alien.aggroAccumulator = Math.min(100.0, alien.aggroAccumulator + 48.0 * dt);
          alien.lastStimulus.copy(playerPos);
          stimulusDetected = true;
        }
      }

      // 2. Acoustic Noise Sphere Detection (1.5m idle -> 10m walk -> 22m sprint -> 28m EVA thrusters)
      let acousticRadius = typeof player.acousticRadius === 'number' ? player.acousticRadius : 1.5;
      if (player.isThrusting && playerInEVA) {
        acousticRadius = Math.max(acousticRadius, 28.0);
      }

      if (dist < acousticRadius && acousticRadius > 0.1) {
        const falloff = 1.0 - (dist / acousticRadius);
        alien.aggroAccumulator = Math.min(100.0, alien.aggroAccumulator + 35.0 * falloff * dt);
        alien.lastStimulus.copy(playerPos);
        stimulusDetected = true;
      }
    }

    // Decay aggro gently when no stimulus and no active station breach alarm
    if (!stimulusDetected && !station?.alarmActive) {
      if (alien.state !== this.STATES.HUNT_PURSUE && alien.state !== this.STATES.LUNGE_ATTACK) {
        alien.aggroAccumulator = Math.max(0.0, alien.aggroAccumulator - 8.5 * dt);
      } else if (!domainMatch) {
        alien.aggroAccumulator = Math.max(40.0, alien.aggroAccumulator - 12.0 * dt);
      }
    }
  }

  hasLineOfSight(fromPos, toPos, role) {
    const station = this.gameContext.station;

    // Closed Bridge-to-Corridor blast gate blocks sight across Z = -5.9
    if (station?.lockdownActive) {
      if ((fromPos.z < -5.9 && toPos.z > -5.9) || (fromPos.z > -5.9 && toPos.z < -5.9)) {
        return false;
      }
    }

    // Closed outer EVA hatch blocks sight across Z = 16.5
    const outerOpen = typeof station?.outerDoorOpen === 'number'
      ? station.outerDoorOpen > 0.5
      : Boolean(station?.outerDoorOpen);
    if (!outerOpen) {
      if ((fromPos.z < 16.5 && toPos.z > 16.5) || (fromPos.z > 16.5 && toPos.z < 16.5)) {
        return false;
      }
    }

    const dist = fromPos.distanceTo(toPos);
    if (dist <= 0.1) return true;

    this._vecA.subVectors(toPos, fromPos).divideScalar(dist);
    this._ray.set(fromPos, this._vecA);

    const obstacles = role === 'EXTERIOR'
      ? (this.gameContext.colliders?.exteriorHullAABBs || [])
      : (this.gameContext.colliders?.interiorObstacleAABBs || []);

    for (let i = 0; i < obstacles.length; i++) {
      const box = obstacles[i];
      if (!box) continue;
      const hit = this._ray.intersectBox(box, this._hitPoint);
      if (hit) {
        const hitDist = fromPos.distanceTo(hit);
        if (hitDist < dist - 0.35) {
          return false;
        }
      }
    }

    return true;
  }

  updateAlienFSM(alien, dt, elapsed) {
    const S = this.STATES;
    const station = this.gameContext.station;
    const player = this.gameContext.player;
    const playerPos = player?.position;
    const alienPos = alien.group.position;

    // Force interior aliens into RETREAT_PURGE if lockdown is active
    if (alien.role === 'INTERIOR' && station?.lockdownActive && alien.state !== S.RETREAT_PURGE) {
      alien.state = S.RETREAT_PURGE;
    }

    switch (alien.state) {
      case S.STALK_HULL: {
        alien.eyeColorTarget.setRGB(1.15, 0.55, 0.05);
        alien.rig.eyeLight.color.setHex(0xff8800);
        alien.rig.eyeLight.intensity = 0.85;
        alien.targetMandibleFlare = 0.08;

        const targetWP = alien.waypoints[alien.waypointIndex];
        const distWP = alienPos.distanceTo(targetWP);
        if (distWP < 1.2) {
          alien.waypointIndex = (alien.waypointIndex + 1) % alien.waypoints.length;
        }

        this.steerAlien3D(alien, targetWP, 2.6, dt, true);

        if (alien.aggroAccumulator >= 100.0) {
          this.enterHuntState(alien);
        } else if (alien.aggroAccumulator > 35.0) {
          alien.state = S.INVESTIGATE_SIGNAL;
        }
        break;
      }

      case S.PATROL_VENTS: {
        alien.eyeColorTarget.setRGB(1.15, 0.55, 0.05);
        alien.rig.eyeLight.color.setHex(0xff8800);
        alien.rig.eyeLight.intensity = 0.75;
        alien.targetMandibleFlare = 0.05;

        if (alien.patrolSubMode === 'CEILING_VENT') {
          alien.rig.bodyGroup.rotation.z = Math.PI;
        } else {
          alien.rig.bodyGroup.rotation.z = 0.0;
        }

        const targetWP = alien.waypoints[alien.waypointIndex];
        const distWP = alienPos.distanceTo(targetWP);
        if (distWP < 0.75) {
          alien.waypointIndex = (alien.waypointIndex + 1) % alien.waypoints.length;
        }

        this.steerAlien3D(alien, targetWP, 2.2, dt, false);

        if (station?.alarmActive || alien.aggroAccumulator >= 100.0) {
          alien.group.position.y = 0.95;
          alien.group.rotation.x = 0.0;
          alien.group.rotation.z = 0.0;
          alien.rig.bodyGroup.rotation.z = 0.0;
          this.enterHuntState(alien);
        } else if (alien.aggroAccumulator > 35.0) {
          alien.group.position.y = 0.95;
          alien.group.rotation.x = 0.0;
          alien.group.rotation.z = 0.0;
          alien.rig.bodyGroup.rotation.z = 0.0;
          alien.state = S.INVESTIGATE_SIGNAL;
        }
        break;
      }

      case S.INVESTIGATE_SIGNAL: {
        alien.eyeColorTarget.setRGB(1.65, 0.42, 0.04);
        alien.rig.eyeLight.color.setHex(0xff5500);
        alien.rig.eyeLight.intensity = 1.35;
        alien.targetMandibleFlare = 0.28;

        if (alien.role === 'INTERIOR') {
          alien.rig.bodyGroup.rotation.z = 0.0;
          this._vecB.set(alien.lastStimulus.x, 0.95, alien.lastStimulus.z);
          this.steerInteriorAlien(alien, this._vecB, 3.8, dt);
        } else {
          this.steerAlien3D(alien, alien.lastStimulus, 3.8, dt, true);
        }

        const distToStim = alienPos.distanceTo(alien.role === 'INTERIOR' ? this._vecB : alien.lastStimulus);

        if (alien.aggroAccumulator >= 100.0 || (alien.role === 'INTERIOR' && station?.alarmActive)) {
          this.enterHuntState(alien);
        } else if (distToStim < 1.1 && alien.aggroAccumulator < 35.0) {
          alien.state = alien.role === 'EXTERIOR' ? S.STALK_HULL : S.PATROL_VENTS;
        } else if (alien.aggroAccumulator <= 5.0) {
          alien.state = alien.role === 'EXTERIOR' ? S.STALK_HULL : S.PATROL_VENTS;
        }
        break;
      }

      case S.HUNT_PURSUE: {
        // Intense HDR crimson bioluminescence for UnrealBloomPass
        alien.eyeColorTarget.setRGB(2.4, 0.14, 0.04);
        alien.rig.eyeLight.color.setHex(0xff1200);
        alien.rig.eyeLight.intensity = 2.6;
        alien.targetMandibleFlare = 0.55 + 0.25 * Math.sin(elapsed * 16.0 + alien.index);

        const playerInEVA = player?.mode === 'EVA' || (playerPos && playerPos.z > 16.2);

        if (alien.role === 'INTERIOR') {
          alien.rig.bodyGroup.rotation.z = 0.0;

          if (!playerInEVA && playerPos) {
            this._vecB.set(playerPos.x, 0.95, playerPos.z);
            this.steerInteriorAlien(alien, this._vecB, 5.6, dt);

            const distToPlayer = alienPos.distanceTo(playerPos);
            if (distToPlayer < 2.3 && alien.attackCooldown <= 0.0) {
              this.startLungeAttack(alien, playerPos);
            }
          } else {
            // Player is outside in EVA while station alarm is active -> stalk the Maintenance Corridor deck
            const wp = alien.waypoints[alien.waypointIndex];
            this._vecB.set(wp.x * 0.85, 0.95, THREE.MathUtils.clamp(wp.z, -4.5, 9.2));
            if (alienPos.distanceTo(this._vecB) < 1.0) {
              alien.waypointIndex = (alien.waypointIndex + 1) % alien.waypoints.length;
            }
            this.steerInteriorAlien(alien, this._vecB, 4.6, dt);
          }
        } else {
          // Exterior stalker in HUNT_PURSUE
          if (playerInEVA && playerPos) {
            this.steerAlien3D(alien, playerPos, 7.2, dt, true);
            const distToPlayer = alienPos.distanceTo(playerPos);
            if (distToPlayer < 2.3 && alien.attackCooldown <= 0.0) {
              this.startLungeAttack(alien, playerPos);
            }
          } else {
            // Player retreated inside airlock -> return to stalking hull around airlock hatch
            alien.aggroAccumulator = Math.max(0.0, alien.aggroAccumulator - 20.0 * dt);
            if (alien.aggroAccumulator < 50.0) {
              alien.state = S.STALK_HULL;
            } else {
              const targetWP = alien.waypoints[alien.waypointIndex];
              this.steerAlien3D(alien, targetWP, 4.5, dt, true);
            }
          }
        }
        break;
      }

      case S.LUNGE_ATTACK: {
        alien.eyeColorTarget.setRGB(2.8, 0.08, 0.02);
        alien.rig.eyeLight.color.setHex(0xff0800);
        alien.rig.eyeLight.intensity = 3.2;
        alien.targetMandibleFlare = 1.0;

        alien.lungeTimer -= dt;
        const lungeSpeed = 9.5;
        alien.currentSpeed = lungeSpeed;

        const prevZ = alienPos.z;
        alienPos.addScaledVector(alien.lungeDirection, lungeSpeed * dt);

        if (alien.role === 'INTERIOR') {
          alienPos.y = 0.95 + Math.sin(Math.max(0.0, alien.lungeTimer / 0.42) * Math.PI) * 0.35;
          this.clampInteriorAlienPosition(alienPos, prevZ);
        } else {
          this.resolveExteriorHullCollisions(alienPos, 1.0);
        }

        if (!alien.hasDealtLungeDamage && playerPos) {
          const distToPlayer = alienPos.distanceTo(playerPos);
          if (distToPlayer < 2.3) {
            alien.hasDealtLungeDamage = true;
            alien.attackCooldown = 1.6;
            this.gameContext.events?.emit('PLAYER_DAMAGED', {
              amount: 28.0,
              sourcePos: alienPos.clone()
            });
          }
        }

        if (alien.lungeTimer <= 0.0) {
          if (alien.role === 'INTERIOR') alienPos.y = 0.95;
          alien.attackCooldown = 1.6;
          alien.state = S.HUNT_PURSUE;
        }
        break;
      }

      case S.RETREAT_PURGE: {
        // Sprints at 9.0 m/s back into the Maintenance Corridor ceiling vent nodes (-2.8, 2.4, -1.0) or (+2.8, 2.4, +5.5)
        alien.eyeColorTarget.setRGB(2.0, 0.45, 0.05);
        alien.rig.eyeLight.intensity = 1.8;
        alien.targetMandibleFlare = 0.85;

        const ventPos = alien.homeVent;
        this._vecA.subVectors(ventPos, alienPos);
        const distToVent = this._vecA.length();

        if (distToVent < 0.65) {
          alien.group.visible = false;
          alien.hiddenInVent = true;
          alien.rig.eyeLight.intensity = 0.0;
          if (alien.radarTarget) alien.radarTarget.active = false;
          alien.currentSpeed = 0.0;
        } else {
          this._vecA.divideScalar(distToVent);
          const retreatSpeed = 9.0;
          alien.currentSpeed = retreatSpeed;
          alienPos.addScaledVector(this._vecA, Math.min(distToVent, retreatSpeed * dt));

          // Face vent shaft and pitch upward as it climbs into the ceiling duct
          const targetYaw = Math.atan2(this._vecA.x, this._vecA.z);
          alien.group.rotation.y = this.lerpAngle(alien.group.rotation.y, targetYaw, Math.min(1.0, dt * 14.0));
          const climbPitch = -Math.asin(THREE.MathUtils.clamp(this._vecA.y, -0.85, 0.85));
          alien.rig.bodyGroup.rotation.x = THREE.MathUtils.lerp(alien.rig.bodyGroup.rotation.x, climbPitch, Math.min(1.0, dt * 10.0));
        }
        break;
      }
    }
  }

  enterHuntState(alien) {
    const wasHunting = alien.state === this.STATES.HUNT_PURSUE || alien.state === this.STATES.LUNGE_ATTACK;
    alien.state = this.STATES.HUNT_PURSUE;
    alien.aggroAccumulator = 100.0;

    if (!wasHunting && alien.screechCooldown <= 0.0) {
      alien.screechCooldown = 5.0;
      this.gameContext.events?.emit('ALIEN_SCREECH', {
        alienId: alien.id,
        position: alien.group.position.clone(),
        state: this.STATES.HUNT_PURSUE
      });
    }
  }

  startLungeAttack(alien, targetPos) {
    alien.state = this.STATES.LUNGE_ATTACK;
    alien.lungeTimer = 0.42;
    alien.hasDealtLungeDamage = false;

    alien.lungeDirection.subVectors(targetPos, alien.group.position);
    if (alien.role === 'INTERIOR') {
      alien.lungeDirection.y = 0.0;
    }
    if (alien.lungeDirection.lengthSq() < 0.0001) {
      alien.lungeDirection.set(0, 0, -1);
    } else {
      alien.lungeDirection.normalize();
    }

    alien.group.rotation.y = Math.atan2(alien.lungeDirection.x, alien.lungeDirection.z);

    if (alien.screechCooldown <= 0.0) {
      alien.screechCooldown = 2.8;
      this.gameContext.events?.emit('ALIEN_SCREECH', {
        alienId: alien.id,
        position: alien.group.position.clone(),
        state: this.STATES.LUNGE_ATTACK
      });
    }
  }

  steerInteriorAlien(alien, targetPos, speed, dt) {
    const pos = alien.group.position;
    const prevZ = pos.z;

    this._vecA.subVectors(targetPos, pos);
    this._vecA.y = 0.0;
    const dist = this._vecA.length();

    if (dist > 0.05) {
      this._vecA.divideScalar(dist);
      const step = Math.min(dist, speed * dt);
      pos.x += this._vecA.x * step;
      pos.z += this._vecA.z * step;
      pos.y = THREE.MathUtils.lerp(pos.y, 0.95, Math.min(1.0, dt * 10.0));
      alien.currentSpeed = speed;

      const desiredYaw = Math.atan2(this._vecA.x, this._vecA.z);
      alien.group.rotation.y = this.lerpAngle(alien.group.rotation.y, desiredYaw, Math.min(1.0, dt * 11.0));
      alien.group.rotation.x = THREE.MathUtils.lerp(alien.group.rotation.x, 0.0, Math.min(1.0, dt * 10.0));
      alien.group.rotation.z = THREE.MathUtils.lerp(alien.group.rotation.z, 0.0, Math.min(1.0, dt * 10.0));
    } else {
      alien.currentSpeed = 0.0;
      alien.group.rotation.x = THREE.MathUtils.lerp(alien.group.rotation.x, 0.0, Math.min(1.0, dt * 10.0));
    }

    this.clampInteriorAlienPosition(pos, prevZ);
  }

  steerAlien3D(alien, targetPos, speed, dt, resolveHull) {
    const pos = alien.group.position;
    this._vecA.subVectors(targetPos, pos);
    const dist = this._vecA.length();

    if (dist > 0.05) {
      this._vecA.divideScalar(dist);
      const step = Math.min(dist, speed * dt);
      pos.addScaledVector(this._vecA, step);
      alien.currentSpeed = speed;

      const desiredYaw = Math.atan2(this._vecA.x, this._vecA.z);
      alien.group.rotation.y = this.lerpAngle(alien.group.rotation.y, desiredYaw, Math.min(1.0, dt * 8.5));

      const desiredPitch = -Math.asin(THREE.MathUtils.clamp(this._vecA.y, -0.75, 0.75));
      alien.group.rotation.x = THREE.MathUtils.lerp(alien.group.rotation.x, desiredPitch, Math.min(1.0, dt * 6.5));
    } else {
      alien.currentSpeed = 0.0;
    }

    if (resolveHull) {
      this.resolveExteriorHullCollisions(pos, 1.0);
    }
  }

  clampInteriorAlienPosition(pos, prevZ) {
    const station = this.gameContext.station;

    // 1. Respect Bridge-to-Corridor Armored Blast Gate at Z = -5.9 during Lockdown
    if (station?.lockdownActive) {
      if (prevZ >= -5.9 && pos.z < -5.25) {
        pos.z = -5.25;
      } else if (prevZ < -5.9 && pos.z > -6.55) {
        pos.z = -6.55;
      }
    }

    // 2. Push smoothly around interior obstacle AABBs (console, mess table, pillars)
    const interiorObstacles = this.gameContext.colliders?.interiorObstacleAABBs;
    if (Array.isArray(interiorObstacles)) {
      const rAlien = 0.55;
      for (let i = 0; i < interiorObstacles.length; i++) {
        const box = interiorObstacles[i];
        if (!box || box.max.y < 0.2 || box.min.y > 2.2) continue;
        const cx = THREE.MathUtils.clamp(pos.x, box.min.x, box.max.x);
        const cz = THREE.MathUtils.clamp(pos.z, box.min.z, box.max.z);
        const dx = pos.x - cx;
        const dz = pos.z - cz;
        const distSq = dx * dx + dz * dz;
        if (distSq < rAlien * rAlien) {
          const dist = Math.sqrt(distSq);
          if (dist > 1e-4) {
            pos.x = cx + (dx / dist) * rAlien;
            pos.z = cz + (dz / dist) * rAlien;
          } else {
            pos.z = box.max.z + rAlien;
          }
        }
      }
    }

    // 3. Clamp global Z spine (Bridge front Z = -13.0 to Inner Airlock Door Z = +10.5)
    pos.z = THREE.MathUtils.clamp(pos.z, -13.0, 10.5);

    // Re-enforce Corridor Blast Gate after obstacle push-out
    if (station?.lockdownActive) {
      if (prevZ >= -5.9 && pos.z < -5.25) {
        pos.z = -5.25;
      } else if (prevZ < -5.9 && pos.z > -6.55) {
        pos.z = -6.55;
      }
    }

    // 4. Room-specific X and obstacle boundaries
    if (pos.z < -5.8) {
      // Inside Central Command Bridge: X in [-5.0, +5.0]
      pos.x = THREE.MathUtils.clamp(pos.x, -5.0, 5.0);

      // Push smoothly around Master Emergency Lockdown Console at (0, -13.2)
      const dx = pos.x - 0.0;
      const dz = pos.z - (-13.2);
      const distConsole = Math.hypot(dx, dz);
      if (distConsole < 1.55 && distConsole > 0.0001) {
        pos.x = (dx / distConsole) * 1.55;
        pos.z = -13.2 + (dz / distConsole) * 1.55;
      }
    } else if (pos.x < -2.4 && pos.z >= -3.8 && pos.z <= 2.8) {
      // Inside Mess Hall & Storage Bay Alcove: X in [-10.2, -2.4], Z in [-3.8, +2.8]
      pos.x = THREE.MathUtils.clamp(pos.x, -10.2, -2.4);
      pos.z = THREE.MathUtils.clamp(pos.z, -3.8, 2.8);
    } else {
      // Inside Dark Maintenance Corridor: X in [-2.4, +2.4]
      // Allow entry into Mess Hall only through bulkhead doorway Z in [-1.8, +1.3]
      const inMessDoorwayZ = pos.z >= -1.8 && pos.z <= 1.3;
      const minX = inMessDoorwayZ ? -10.2 : -2.4;
      pos.x = THREE.MathUtils.clamp(pos.x, minX, 2.4);
    }
  }

  resolveExteriorHullCollisions(pos, radius) {
    // Keep exterior stalkers outside the pressurized interior envelope (Z >= 16.2 unless high above/below hull)
    if (pos.z < 16.5 && Math.abs(pos.x) < 7.5 && Math.abs(pos.y) < 5.5) {
      pos.z = 16.5;
    }

    const hullBoxes = this.gameContext.colliders?.exteriorHullAABBs;
    if (!Array.isArray(hullBoxes)) return;

    for (let i = 0; i < hullBoxes.length; i++) {
      const box = hullBoxes[i];
      if (!box) continue;

      this._vecC.copy(pos).clamp(box.min, box.max);
      this._vecD.subVectors(pos, this._vecC);
      const distSq = this._vecD.lengthSq();

      if (distSq < radius * radius) {
        const dist = Math.sqrt(distSq);
        if (dist > 1e-5) {
          this._vecD.divideScalar(dist);
          pos.copy(this._vecC).addScaledVector(this._vecD, radius);
        } else {
          pos.y += radius;
        }
      }
    }
  }

  updateAlienRig(alien, dt, elapsed) {
    const rig = alien.rig;
    const speed = alien.currentSpeed;

    // 1. Advance Tripod Gait Phase
    const gaitFreq = speed > 0.15 ? (2.2 + speed * 1.55) : 1.1;
    alien.gaitPhase += gaitFreq * dt;
    const gaitAmp = speed > 0.15 ? Math.min(1.35, 0.55 + speed * 0.14) : 0.12;

    // 2. Six-Limbed Tripod Gait Kinematics (Set A = {0, 3, 4}, Set B = {1, 2, 5})
    for (let i = 0; i < rig.legs.length; i++) {
      const leg = rig.legs[i];
      const theta = alien.gaitPhase + leg.tripodOffset;

      // PLAN.md Section 6.1 equations:
      // theta_hip_k = 0.45 * sin(theta_k)
      // theta_knee_k = -0.85 + 0.38 * max(0, cos(theta_k))
      const sinTheta = Math.sin(theta);
      const liftPhase = Math.max(0.0, Math.cos(theta));

      const hipSweep = 0.45 * sinTheta * gaitAmp;
      const kneeFlex = -0.85 + 0.38 * liftPhase * gaitAmp;

      // Apply forward/backward stride yaw on hipPivot and stance/swing elevation so claws plant cleanly at Y = 0.0m when root is at Y = 0.95m
      leg.hipPivot.rotation.y = -leg.side * hipSweep;
      leg.hipPivot.rotation.z = -0.22 + 0.28 * liftPhase * gaitAmp;

      // Apply knee flexion (exact PLAN.md 6.1 formula) and downward tarsal claw articulation
      leg.kneePivot.rotation.z = kneeFlex;
      leg.clawPivot.rotation.z = -0.45 - 0.25 * liftPhase * gaitAmp;
    }

    // 3. Nine-Segment Prehensile Whip Tail Traveling Sine Wave
    // PLAN.md Section 6.1: psi_tail_j(t) = 0.22 * sin(3.8 * t - 0.55 * j)
    const tailTimeScale = (alien.state === this.STATES.HUNT_PURSUE || alien.state === this.STATES.LUNGE_ATTACK) ? 1.65 : 1.0;
    for (let j = 0; j < rig.tailSegments.length; j++) {
      const seg = rig.tailSegments[j];
      const psiYaw = 0.22 * Math.sin(3.8 * elapsed * tailTimeScale - 0.55 * j);
      const psiPitch = 0.065 + 0.08 * Math.cos(2.6 * elapsed * tailTimeScale - 0.45 * j);
      seg.rotation.y = psiYaw;
      seg.rotation.x = psiPitch;
    }

    // 4. Thoracic Breathing Heave & Predatory Crouch
    if (alien.state !== this.STATES.RETREAT_PURGE) {
      const breath = Math.sin(elapsed * 3.4 + alien.index) * 0.025;
      rig.bodyGroup.position.y = breath;
      const crouchPitch = (alien.state === this.STATES.HUNT_PURSUE || alien.state === this.STATES.LUNGE_ATTACK)
        ? 0.12 + Math.sin(alien.gaitPhase * 2.0) * 0.04
        : 0.04;
      rig.bodyGroup.rotation.x = THREE.MathUtils.lerp(rig.bodyGroup.rotation.x, crouchPitch, Math.min(1.0, dt * 8.0));
    }

    // 5. Cranium Target Tracking & Articulated Mandible Flare (outward flare for left/right jaws)
    alien.mandibleFlare = THREE.MathUtils.lerp(alien.mandibleFlare, alien.targetMandibleFlare, Math.min(1.0, dt * 12.0));
    const flare = alien.mandibleFlare;

    rig.mandibles.left.rotation.y = -0.05 - flare * 0.62;
    rig.mandibles.right.rotation.y = 0.05 + flare * 0.62;
    rig.mandibles.lower.rotation.x = 0.08 + flare * 0.52;
    rig.mandibles.inner.position.z = 0.20 + flare * 0.24;

    // Subtle head look tracking toward player when nearby (suppressed when inverted on ceiling)
    const playerPos = this.gameContext.player?.position;
    const isInvertedOnCeiling = alien.state === this.STATES.PATROL_VENTS && alien.patrolSubMode === 'CEILING_VENT';
    if (playerPos && !isInvertedOnCeiling) {
      this._vecA.subVectors(playerPos, alien.group.position);
      const dist = this._vecA.length();
      if (dist < 18.0 && dist > 0.2) {
        const worldAngleToPlayer = Math.atan2(this._vecA.x, this._vecA.z);
        const relYaw = this.normalizeAngle(worldAngleToPlayer - alien.group.rotation.y);
        const clampedYaw = THREE.MathUtils.clamp(relYaw, -0.55, 0.55);
        const relPitch = THREE.MathUtils.clamp(-Math.asin(THREE.MathUtils.clamp(this._vecA.y / dist, -0.6, 0.6)), -0.45, 0.45);
        rig.headGroup.rotation.y = THREE.MathUtils.lerp(rig.headGroup.rotation.y, clampedYaw, Math.min(1.0, dt * 7.0));
        rig.headGroup.rotation.x = THREE.MathUtils.lerp(rig.headGroup.rotation.x, relPitch, Math.min(1.0, dt * 7.0));
      } else {
        rig.headGroup.rotation.y = THREE.MathUtils.lerp(rig.headGroup.rotation.y, Math.sin(elapsed * 1.7 + alien.index) * 0.18, Math.min(1.0, dt * 4.0));
        rig.headGroup.rotation.x = THREE.MathUtils.lerp(rig.headGroup.rotation.x, 0.0, Math.min(1.0, dt * 4.0));
      }
    } else {
      rig.headGroup.rotation.y = THREE.MathUtils.lerp(rig.headGroup.rotation.y, Math.sin(elapsed * 1.7 + alien.index) * 0.15, Math.min(1.0, dt * 4.0));
      rig.headGroup.rotation.x = THREE.MathUtils.lerp(rig.headGroup.rotation.x, 0.0, Math.min(1.0, dt * 4.0));
    }

    // 6. Bioluminescent Eye Color Interpolation
    alien.eyeColorCurrent.lerp(alien.eyeColorTarget, Math.min(1.0, dt * 8.0));
    rig.eyeMat.color.copy(alien.eyeColorCurrent);
  }

  lerpAngle(current, target, alpha) {
    const diff = this.normalizeAngle(target - current);
    return current + diff * alpha;
  }

  normalizeAngle(angle) {
    let a = angle;
    while (a > Math.PI) a -= Math.PI * 2.0;
    while (a < -Math.PI) a += Math.PI * 2.0;
    return a;
  }
}
