import * as THREE from 'three';

function makePRNG(seed = 1337) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class ProceduralTextureFactory {
  constructor(renderer) {
    this.anisotropy = renderer?.capabilities?.getMaxAnisotropy?.() || 8;
  }

  _makeCanvas(w = 512, h = 512) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return { canvas, ctx: canvas.getContext('2d') };
  }

  _wrapTexture(canvas, isSRGB = false) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = this.anisotropy;
    if (isSRGB) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  cloneWithRepeat(tex, rx = 1, ry = 1) {
    if (!tex) return null;
    if (rx === 1 && ry === 1) return tex;
    const c = tex.clone();
    c.wrapS = THREE.RepeatWrapping;
    c.wrapT = THREE.RepeatWrapping;
    c.anisotropy = this.anisotropy;
    c.colorSpace = tex.colorSpace;
    c.repeat.set(rx, ry);
    c.needsUpdate = true;
    return c;
  }

  createHullPlatingPBR() {
    const W = 512, H = 512;
    const rand = makePRNG(101);
    const { canvas: cAlb, ctx: a } = this._makeCanvas(W, H);
    const { canvas: cRgh, ctx: r } = this._makeCanvas(W, H);
    const { canvas: cBmp, ctx: b } = this._makeCanvas(W, H);

    a.fillStyle = '#2b323b'; a.fillRect(0, 0, W, H);
    r.fillStyle = '#787878'; r.fillRect(0, 0, W, H);
    b.fillStyle = '#808080'; b.fillRect(0, 0, W, H);

    for (let i = 0; i < 2400; i++) {
      const x = rand() * W, y = rand() * H, len = 18 + rand() * 95;
      const light = rand() > 0.5;
      a.fillStyle = light ? '#3e4756' : '#181c22';
      a.globalAlpha = 0.03 + rand() * 0.05;
      a.fillRect(x, y, len, 1);
      if (i % 3 === 0) {
        r.fillStyle = light ? '#646464' : '#8a8a8a';
        r.globalAlpha = 0.08;
        r.fillRect(x, y, len, 1);
        b.fillStyle = '#606060';
        b.globalAlpha = 0.06;
        b.fillRect(x, y, len, 1);
      }
    }
    a.globalAlpha = 1; r.globalAlpha = 1; b.globalAlpha = 1;

    const step = 128;
    for (let gx = 0; gx < 4; gx++) {
      for (let gy = 0; gy < 4; gy++) {
        const px = gx * step, py = gy * step;
        a.strokeStyle = '#0e1116'; a.lineWidth = 3;
        a.strokeRect(px + 1.5, py + 1.5, step - 3, step - 3);
        a.strokeStyle = '#525e6e'; a.lineWidth = 1;
        a.strokeRect(px + 3.5, py + 3.5, step - 7, step - 7);

        r.strokeStyle = '#d0d0d0'; r.lineWidth = 3;
        r.strokeRect(px + 1.5, py + 1.5, step - 3, step - 3);
        b.strokeStyle = '#151515'; b.lineWidth = 3;
        b.strokeRect(px + 1.5, py + 1.5, step - 3, step - 3);
        b.strokeStyle = '#9a9a9a'; b.lineWidth = 1;
        b.strokeRect(px + 3.5, py + 3.5, step - 7, step - 7);

        for (let d = 16; d < step; d += 32) {
          const pts = [[px + d, py + 8], [px + d, py + step - 8], [px + 8, py + d], [px + step - 8, py + d]];
          for (const [rx, ry] of pts) {
            a.fillStyle = '#14181f';
            a.beginPath(); a.arc(rx + 0.8, ry + 0.8, 2.2, 0, Math.PI * 2); a.fill();
            a.fillStyle = '#586577';
            a.beginPath(); a.arc(rx - 0.4, ry - 0.4, 1.8, 0, Math.PI * 2); a.fill();

            r.fillStyle = '#555555';
            r.beginPath(); r.arc(rx, ry, 2.2, 0, Math.PI * 2); r.fill();
            b.fillStyle = '#e5e5e5';
            b.beginPath(); b.arc(rx, ry, 2.2, 0, Math.PI * 2); b.fill();
          }
        }
      }
    }

    for (let i = 0; i < 18; i++) {
      const ox = rand() * W;
      const oy = (Math.floor(rand() * 4) + 1) * step - 10 + (rand() - 0.5) * 24;
      const rad = 18 + rand() * 36;
      const gA = a.createRadialGradient(ox, oy, 2, ox, oy, rad);
      gA.addColorStop(0, 'rgba(20, 14, 10, 0.26)');
      gA.addColorStop(1, 'rgba(20, 14, 10, 0)');
      a.fillStyle = gA;
      a.beginPath(); a.arc(ox, oy, rad, 0, Math.PI * 2); a.fill();

      const gR = r.createRadialGradient(ox, oy, 2, ox, oy, rad);
      gR.addColorStop(0, 'rgba(64, 64, 64, 0.48)');
      gR.addColorStop(1, 'rgba(64, 64, 64, 0)');
      r.fillStyle = gR;
      r.beginPath(); r.arc(ox, oy, rad, 0, Math.PI * 2); r.fill();
    }

    return {
      map: this._wrapTexture(cAlb, true),
      roughnessMap: this._wrapTexture(cRgh, false),
      bumpMap: this._wrapTexture(cBmp, false)
    };
  }

  createGratedCatwalkPBR() {
    const W = 512, H = 512;
    const { canvas: cAlb, ctx: a } = this._makeCanvas(W, H);
    const { canvas: cAlp, ctx: al } = this._makeCanvas(W, H);
    const { canvas: cRgh, ctx: r } = this._makeCanvas(W, H);
    const { canvas: cBmp, ctx: b } = this._makeCanvas(W, H);

    a.fillStyle = '#050709'; a.fillRect(0, 0, W, H);
    al.fillStyle = '#000000'; al.fillRect(0, 0, W, H);
    r.fillStyle = '#888888'; r.fillRect(0, 0, W, H);
    b.fillStyle = '#202020'; b.fillRect(0, 0, W, H);

    const drawLattice = (ctx, stroke, width) => {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let i = -H; i < W + H; i += 16) {
        ctx.moveTo(i, 0); ctx.lineTo(i + H, H);
        ctx.moveTo(i, H); ctx.lineTo(i + H, 0);
      }
      ctx.stroke();
    };

    drawLattice(a, '#4b5563', 4.5);
    drawLattice(a, '#717d8c', 1.5);
    drawLattice(al, '#ffffff', 4.5);
    drawLattice(r, '#585858', 4.5);
    drawLattice(b, '#a8a8a8', 4.5);

    for (let y = 16; y < H; y += 16) {
      for (let x = 16; x < W; x += 16) {
        a.fillStyle = '#8795a6'; a.fillRect(x - 1.5, y - 1.5, 3, 3);
        r.fillStyle = '#353535'; r.fillRect(x - 1.5, y - 1.5, 3, 3);
        b.fillStyle = '#ffffff'; b.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }

    const bw = 24;
    const drawFrame = (ctx, fill) => {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, W, bw);
      ctx.fillRect(0, H - bw, W, bw);
      ctx.fillRect(0, 0, bw, H);
      ctx.fillRect(W - bw, 0, bw, H);
      ctx.fillRect(W / 2 - 10, 0, 20, H);
      ctx.fillRect(0, H / 2 - 10, W, 20);
    };
    drawFrame(a, '#38404a');
    drawFrame(al, '#ffffff');
    drawFrame(r, '#626262');
    drawFrame(b, '#c8c8c8');

    a.strokeStyle = '#5c6877'; a.lineWidth = 2;
    a.strokeRect(bw, bw, W - bw * 2, H - bw * 2);

    return {
      map: this._wrapTexture(cAlb, true),
      alphaMap: this._wrapTexture(cAlp, false),
      roughnessMap: this._wrapTexture(cRgh, false),
      bumpMap: this._wrapTexture(cBmp, false)
    };
  }

  createHazardStripePBR() {
    const W = 512, H = 512;
    const rand = makePRNG(303);
    const { canvas: cAlb, ctx: a } = this._makeCanvas(W, H);
    const { canvas: cRgh, ctx: r } = this._makeCanvas(W, H);
    const { canvas: cBmp, ctx: b } = this._makeCanvas(W, H);

    a.fillStyle = '#16181d'; a.fillRect(0, 0, W, H);
    r.fillStyle = '#656565'; r.fillRect(0, 0, W, H);
    b.fillStyle = '#909090'; b.fillRect(0, 0, W, H);

    const period = 64;
    a.fillStyle = '#d99b16';
    for (let i = -H; i < W + H; i += period) {
      a.beginPath();
      a.moveTo(i, 0);
      a.lineTo(i + 32, 0);
      a.lineTo(i + 32 - H, H);
      a.lineTo(i - H, H);
      a.closePath();
      a.fill();
    }

    for (let i = 0; i < 650; i++) {
      const cx = rand() * W, cy = rand() * H;
      const rad = 1.5 + rand() * 5.2;
      a.fillStyle = rand() > 0.45 ? '#4a3525' : '#7a828e';
      a.beginPath();
      a.arc(cx, cy, rad, 0, Math.PI * 2);
      a.fill();

      r.fillStyle = '#b5b5b5';
      r.beginPath(); r.arc(cx, cy, rad, 0, Math.PI * 2); r.fill();

      b.fillStyle = '#505050';
      b.beginPath(); b.arc(cx, cy, rad, 0, Math.PI * 2); b.fill();
    }

    return {
      map: this._wrapTexture(cAlb, true),
      roughnessMap: this._wrapTexture(cRgh, false),
      bumpMap: this._wrapTexture(cBmp, false)
    };
  }

  createBulkheadGlassPBR() {
    const W = 512, H = 512;
    const rand = makePRNG(404);
    const { canvas: cAlb, ctx: a } = this._makeCanvas(W, H);
    const { canvas: cRgh, ctx: r } = this._makeCanvas(W, H);
    const { canvas: cBmp, ctx: b } = this._makeCanvas(W, H);

    a.fillStyle = '#92b8cc'; a.fillRect(0, 0, W, H);
    const gR = r.createRadialGradient(W / 2, H / 2, 70, W / 2, H / 2, 340);
    gR.addColorStop(0, '#222222');
    gR.addColorStop(0.7, '#454545');
    gR.addColorStop(1, '#a0a0a0');
    r.fillStyle = gR; r.fillRect(0, 0, W, H);
    b.fillStyle = '#808080'; b.fillRect(0, 0, W, H);

    for (let i = 0; i < 32; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = 175 + rand() * 90;
      const sx = W / 2 + Math.cos(angle) * dist;
      const sy = H / 2 + Math.sin(angle) * dist;
      const srad = 22 + rand() * 38;
      const sg = r.createRadialGradient(sx, sy, 2, sx, sy, srad);
      sg.addColorStop(0, 'rgba(180,180,180,0.4)');
      sg.addColorStop(1, 'rgba(180,180,180,0)');
      r.fillStyle = sg;
      r.beginPath(); r.arc(sx, sy, srad, 0, Math.PI * 2); r.fill();
    }

    for (let i = 0; i < 140; i++) {
      const x1 = rand() * W, y1 = rand() * H;
      const ang = rand() * Math.PI * 2;
      const len = 10 + rand() * 35;
      const x2 = x1 + Math.cos(ang) * len, y2 = y1 + Math.sin(ang) * len;
      r.strokeStyle = 'rgba(192,192,192,0.45)'; r.lineWidth = 0.6;
      r.beginPath(); r.moveTo(x1, y1); r.lineTo(x2, y2); r.stroke();
      b.strokeStyle = 'rgba(195,195,195,0.45)'; b.lineWidth = 0.6;
      b.beginPath(); b.moveTo(x1, y1); b.lineTo(x2, y2); b.stroke();
    }

    return {
      map: this._wrapTexture(cAlb, true),
      roughnessMap: this._wrapTexture(cRgh, false),
      bumpMap: this._wrapTexture(cBmp, false)
    };
  }

  createDynamicTerminalScreen() {
    const { canvas, ctx } = this._makeCanvas(512, 512);
    const texture = this._wrapTexture(canvas, true);
    this.updateTerminalScreen(ctx, null, null);
    texture.needsUpdate = true;
    return { canvas, ctx, texture, map: texture };
  }

  updateTerminalScreen(ctx, stationState, playerState) {
    const W = 512, H = 512;
    const alarm = !!stationState?.alarmActive;
    const lockdown = !!stationState?.lockdownActive;
    const hold = Math.max(0, Math.min(1, stationState?.lockdownHoldProgress || 0));
    const o2 = Math.round(playerState?.oxygen ?? 100);
    const pwr = Math.round((stationState?.powerLevel ?? 1.0) * 100);
    const airlock = stationState?.airlockState || 'PRESSURIZED_INNER';

    ctx.fillStyle = lockdown ? '#061c14' : (alarm ? '#200404' : '#041218');
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);

    const fg = lockdown ? '#34d399' : (alarm ? '#ff3b30' : '#38bdf8');
    const accent = alarm ? '#f59e0b' : '#22d3ee';

    ctx.strokeStyle = fg; ctx.lineWidth = 3;
    ctx.strokeRect(14, 14, W - 28, H - 28);
    ctx.fillStyle = fg;
    ctx.fillRect(14, 14, W - 28, 42);

    ctx.fillStyle = '#02080c';
    ctx.font = 'bold 20px monospace';
    ctx.fillText(
      alarm ? '!! CRITICAL HULL BREACH ALERT !!' : (lockdown ? 'ORBITAL-9 // LOCKDOWN ACTIVE' : 'ORBITAL-9 // MASTER TELEMETRY'),
      26, 42
    );

    ctx.fillStyle = fg;
    ctx.font = 'bold 17px monospace';
    ctx.fillText(`O2 PRESSURE    : ${o2}% [${o2 > 35 ? 'NOMINAL' : 'LOW-HYPOXIA'}]`, 30, 92);
    ctx.fillText(`AIRLOCK SEAL   : ${airlock}`, 30, 124);
    ctx.fillText(`HULL INTEGRITY : ${alarm ? '42% [VENT BREACH]' : (lockdown ? '94% [PURGING]' : '98% [SEALED]')}`, 30, 156);
    ctx.fillText(`STATION POWER  : ${pwr}%`, 30, 188);

    ctx.strokeStyle = accent; ctx.lineWidth = 1.5;
    ctx.strokeRect(30, 208, W - 60, 140);
    ctx.font = '14px monospace';
    ctx.fillStyle = accent;
    ctx.fillText('DECK SCHEMATIC: [BRIDGE] === [CORRIDOR] === [AIRLOCK]', 44, 236);

    const drawBox = (x, y, w, h, label, alertBox) => {
      ctx.strokeStyle = alertBox ? '#ff2a2a' : fg;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = alertBox ? 'rgba(255,30,30,0.28)' : 'rgba(56,189,248,0.12)';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#e2f1ff';
      ctx.font = 'bold 13px monospace';
      ctx.fillText(label, x + 8, y + h / 2 + 4);
    };
    drawBox(46, 255, 115, 70, 'BRIDGE', false);
    drawBox(182, 263, 145, 54, 'CORRIDOR', alarm);
    drawBox(348, 258, 115, 64, 'AIRLOCK', airlock.includes('CYCLING') || airlock.includes('OUTER'));

    ctx.strokeStyle = fg; ctx.lineWidth = 2.5;
    ctx.strokeRect(30, 368, W - 60, 108);
    ctx.fillStyle = alarm ? '#ff4d4d' : fg;
    ctx.font = 'bold 17px monospace';
    ctx.fillText(
      lockdown ? 'THERMAL VENT PURGE IN PROGRESS...' : 'BRIDGE EMERGENCY LOCKDOWN OVERRIDE [HOLD E]',
      44, 398
    );

    ctx.strokeStyle = fg; ctx.lineWidth = 2;
    ctx.strokeRect(44, 414, W - 88, 36);
    const fillPct = lockdown ? 1.0 : hold;
    ctx.fillStyle = alarm ? '#ef4444' : '#38bdf8';
    ctx.fillRect(48, 418, Math.max(0, (W - 96) * fillPct), 28);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(lockdown ? 'BLAST SHUTTERS SEALED (100%)' : `HOLD KEY [E] : ${Math.round(fillPct * 100)}%`, 165, 438);
  }

  createSteamSpriteTexture() {
    const { canvas, ctx } = this._makeCanvas(128, 128);
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
    g.addColorStop(0, 'rgba(235, 245, 255, 0.78)');
    g.addColorStop(0.45, 'rgba(200, 220, 240, 0.36)');
    g.addColorStop(1, 'rgba(180, 200, 220, 0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }
}

export class StationManager {
  constructor(gameContext) {
    this.ctx = gameContext;
    this.root = new THREE.Group();
    this.root.name = 'Orbital9_StationInterior';

    this.workLights = [];
    this.redBeacons = [];
    this.airlockLEDs = [];
    this.blastShutters = [];
    this.corridorBlastGate = null;
    this.innerDoorLeft = null;
    this.innerDoorRight = null;
    this.outerHatchDoor = null;
    this.outerHatchWheel = null;
    this.bridgeBeaconDome = null;
    this.messFluorescent = null;
    this.messFluorescentTubeMat = null;

    this.airlockCycleTimer = 0;
    this.airlockTargetMode = 'EVA';
    this.lockdownTimer = 0;
    this.lockerCooldown = 0;
    this.shutterAlpha = 0;
    this.terminalAccum = 0;

    this.airlockSteam = null;
    this.airlockSteamMeta = [];
    this.purgeSteam = null;
    this.purgeSteamMeta = [];
  }

  init() {
    const { scene, renderer, station, colliders, interactables, radarTargets, events } = this.ctx;
    this.texFactory = new ProceduralTextureFactory(renderer);

    const hull = this.texFactory.createHullPlatingPBR();
    const catwalk = this.texFactory.createGratedCatwalkPBR();
    const hazard = this.texFactory.createHazardStripePBR();
    const glass = this.texFactory.createBulkheadGlassPBR();
    const terminal = this.texFactory.createDynamicTerminalScreen();
    terminal.update = () => {
      this.texFactory.updateTerminalScreen(terminal.ctx, this.ctx.station, this.ctx.player);
      terminal.texture.needsUpdate = true;
    };

    this.ctx.textures = { hull, catwalk, hazard, glass, terminal };

    station.innerDoorOpen = 1.0;
    station.outerDoorOpen = 0.0;
    station.airlockState = 'PRESSURIZED_INNER';
    station.airlockProgress = 0.0;
    station.alarmActive = false;
    station.lockdownActive = false;
    station.lockdownHoldProgress = 0.0;
    if (typeof station.breachTimer !== 'number') station.breachTimer = 85.0;
    station.powerLevel = 1.0;

    this._initMaterials();
    this._buildCommandBridge();
    this._buildMessHall();
    this._buildMaintenanceCorridor();
    this._buildAirlockChamber();
    this._buildLightingAndBeacons();
    this._buildSteamSystems();
    this._registerCollidersAndInteractables();

    scene.add(this.root);

    if (events && typeof events.on === 'function') {
      events.on('BREACH_ALARM_TRIGGERED', () => this.triggerRedAlert(true));
      events.on('LOCKDOWN_HOLD_TICK', (p) => {
        station.lockdownHoldProgress = Math.max(0, Math.min(1, p?.progress ?? 0));
        this.ctx.textures.terminal.update();
      });
    }

    this.ctx.stationManager = this;
  }

  _makeHullMat(rx = 2, ry = 2, tint = 0xd8e0ea, metalness = 0.82, roughness = 0.52) {
    const h = this.ctx.textures.hull;
    return new THREE.MeshStandardMaterial({
      color: tint,
      map: this.texFactory.cloneWithRepeat(h.map, rx, ry),
      roughnessMap: this.texFactory.cloneWithRepeat(h.roughnessMap, rx, ry),
      bumpMap: this.texFactory.cloneWithRepeat(h.bumpMap, rx, ry),
      bumpScale: 0.015,
      metalness,
      roughness
    });
  }

  _makeHazardMat(rx = 2, ry = 1) {
    const hz = this.ctx.textures.hazard;
    return new THREE.MeshStandardMaterial({
      map: this.texFactory.cloneWithRepeat(hz.map, rx, ry),
      roughnessMap: this.texFactory.cloneWithRepeat(hz.roughnessMap, rx, ry),
      bumpMap: this.texFactory.cloneWithRepeat(hz.bumpMap, rx, ry),
      bumpScale: 0.012,
      metalness: 0.65,
      roughness: 0.55
    });
  }

  _initMaterials() {
    const { catwalk, glass, terminal } = this.ctx.textures;
    this.mats = {
      wall: this._makeHullMat(3, 1.5, 0xcfd8e3, 0.82, 0.5),
      floor: this._makeHullMat(4, 4, 0x9aa6b5, 0.78, 0.55),
      ceiling: this._makeHullMat(3, 3, 0x8893a2, 0.84, 0.48),
      darkTrim: this._makeHullMat(2, 2, 0x626c7a, 0.88, 0.42),
      shutter: this._makeHullMat(2, 2, 0x7b8696, 0.9, 0.4),
      hazard: this._makeHazardMat(2, 1),
      hazardTall: this._makeHazardMat(1, 3),
      catwalk: new THREE.MeshStandardMaterial({
        map: this.texFactory.cloneWithRepeat(catwalk.map, 2, 6),
        alphaMap: this.texFactory.cloneWithRepeat(catwalk.alphaMap, 2, 6),
        roughnessMap: this.texFactory.cloneWithRepeat(catwalk.roughnessMap, 2, 6),
        bumpMap: this.texFactory.cloneWithRepeat(catwalk.bumpMap, 2, 6),
        bumpScale: 0.02,
        alphaTest: 0.5,
        metalness: 0.82,
        roughness: 0.48,
        side: THREE.DoubleSide
      }),
      glass: new THREE.MeshPhysicalMaterial({
        map: glass.map,
        roughnessMap: glass.roughnessMap,
        bumpMap: glass.bumpMap,
        bumpScale: 0.005,
        transparent: true,
        opacity: 0.34,
        metalness: 0.1,
        roughness: 0.25,
        envMapIntensity: 2.2,
        depthWrite: false
      }),
      crt: new THREE.MeshStandardMaterial({
        map: terminal.map,
        emissiveMap: terminal.map,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 1.45,
        roughness: 0.22,
        metalness: 0.15
      }),
      pipeCyan: new THREE.MeshStandardMaterial({
        color: 0x164e63,
        emissive: 0x06b6d4,
        emissiveIntensity: 0.85,
        roughness: 0.3,
        metalness: 0.7
      }),
      pipeAmber: new THREE.MeshStandardMaterial({
        color: 0x78350f,
        emissive: 0xf59e0b,
        emissiveIntensity: 0.75,
        roughness: 0.35,
        metalness: 0.7
      })
    };
  }

  _box(w, h, d, mat, x, y, z, parent = this.root) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  _buildCommandBridge() {
    const g = new THREE.Group();
    g.name = 'CommandBridge';

    this._box(12.2, 0.2, 10.2, this.mats.floor, 0, -0.1, -11.0, g);
    this._box(12.2, 0.2, 10.2, this.mats.ceiling, 0, 4.3, -11.0, g);
    this._box(0.25, 4.2, 10.2, this.mats.wall, -6.1, 2.1, -11.0, g);
    this._box(0.25, 4.2, 10.2, this.mats.wall, 6.1, 2.1, -11.0, g);

    this._box(8.8, 0.14, 0.4, this.mats.hazard, 0, 0.04, -15.4, g);

    // Forward panoramic viewport wall at Z = -16.0m with large glass window opening
    this._box(12.2, 0.7, 0.28, this.mats.darkTrim, 0, 0.35, -16.0, g);
    this._box(12.2, 0.65, 0.28, this.mats.darkTrim, 0, 3.92, -16.0, g);
    this._box(0.8, 2.9, 0.28, this.mats.wall, -5.6, 2.15, -16.0, g);
    this._box(0.8, 2.9, 0.28, this.mats.wall, 5.6, 2.15, -16.0, g);
    // 2 slim mullions dividing the 3 trapezoidal viewport panes
    this._box(0.22, 2.95, 0.32, this.mats.darkTrim, -1.8, 2.15, -16.0, g);
    this._box(0.22, 2.95, 0.32, this.mats.darkTrim, 1.8, 2.15, -16.0, g);

    // 3 Scratched Bulkhead Glass viewport panes
    this._box(3.35, 2.9, 0.06, this.mats.glass, -3.55, 2.15, -16.0, g);
    this._box(3.38, 2.9, 0.06, this.mats.glass, 0, 2.15, -16.0, g);
    this._box(3.35, 2.9, 0.06, this.mats.glass, 3.55, 2.15, -16.0, g);

    // Recessed Armored Blast Shutters anchored at upper lintel (Y=3.65m) so nothing pokes above roof when open
    for (const sx of [-3.55, 0, 3.55]) {
      const shutterPivot = new THREE.Group();
      shutterPivot.position.set(sx, 3.65, -15.84);
      const blade = this._box(3.45, 3.0, 0.14, this.mats.shutter, 0, -1.5, 0, shutterPivot);
      this._box(3.46, 0.28, 0.16, this.mats.hazard, 0, -1.36, 0, blade);
      shutterPivot.scale.y = 0.06;
      g.add(shutterPivot);
      this.blastShutters.push({ mesh: shutterPivot, openScaleY: 0.06, closedScaleY: 1.0 });
    }

    // Bridge South Bulkhead Wall (Z = -6.0m) with doorway X ∈ [-2.8, 2.8], Y ∈ [0, 3.2]
    this._box(3.2, 4.2, 0.3, this.mats.wall, -4.4, 2.1, -6.0, g);
    this._box(3.2, 4.2, 0.3, this.mats.wall, 4.4, 2.1, -6.0, g);
    this._box(6.0, 1.0, 0.3, this.mats.wall, 0, 3.7, -6.0, g);
    this._box(0.22, 3.2, 0.36, this.mats.hazardTall, -2.75, 1.6, -6.0, g);
    this._box(0.22, 3.2, 0.36, this.mats.hazardTall, 2.75, 1.6, -6.0, g);

    // Master Emergency Lockdown Console at (0.0, 1.05, -13.2)
    const consoleGrp = new THREE.Group();
    consoleGrp.position.set(0, 0, -13.2);
    this._box(2.5, 0.96, 1.05, this.mats.darkTrim, 0, 0.48, 0, consoleGrp);
    this._box(2.54, 0.12, 1.12, this.mats.hazard, 0, 0.98, 0, consoleGrp);

    // 3 Angled dynamic CRT displays
    const crtPositions = [[-0.78, 0.18], [0, 0], [0.78, -0.18]];
    for (const [cx, rotY] of crtPositions) {
      const mon = this._box(0.68, 0.5, 0.08, this.mats.darkTrim, cx, 1.32, -0.18, consoleGrp);
      mon.rotation.x = -0.22;
      mon.rotation.y = rotY;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.42), this.mats.crt);
      scr.position.set(0, 0, 0.045);
      mon.add(scr);
    }

    // Glowing keyboard matrix + red polycarbonate status beacon dome
    const kbMat = new THREE.MeshStandardMaterial({
      color: 0x0b2530, emissive: 0x38bdf8, emissiveIntensity: 0.9, roughness: 0.3
    });
    const kb = this._box(1.6, 0.04, 0.34, kbMat, 0, 1.06, 0.24, consoleGrp);
    kb.rotation.x = 0.15;

    const domeMat = new THREE.MeshStandardMaterial({
      color: 0xff1e1e, emissive: 0xff1100, emissiveIntensity: 1.5, roughness: 0.18
    });
    this.bridgeBeaconDome = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.22, 16), domeMat);
    this.bridgeBeaconDome.position.set(1.08, 1.15, 0.25);
    consoleGrp.add(this.bridgeBeaconDome);
    g.add(consoleGrp);

    // Side Aux Consoles & Support Pillars
    this._box(1.1, 1.05, 3.2, this.mats.darkTrim, -4.9, 0.52, -11.0, g);
    this._box(1.1, 1.05, 3.2, this.mats.darkTrim, 4.9, 0.52, -11.0, g);
    this._box(0.45, 4.2, 0.45, this.mats.darkTrim, -5.6, 2.1, -11.0, g);
    this._box(0.45, 4.2, 0.45, this.mats.darkTrim, 5.6, 2.1, -11.0, g);

    this.root.add(g);
  }

  _buildMessHall() {
    const g = new THREE.Group();
    g.name = 'MessHallStorageBay';

    // X: [-11.5, -3.0] (W=8.5, center X=-7.25), Y: [0.0, 3.6], Z: [-4.5, +3.5] (L=8.0, center Z=-0.5)
    this._box(8.6, 0.2, 8.2, this.mats.floor, -7.25, -0.1, -0.5, g);
    this._box(8.6, 0.2, 8.2, this.mats.ceiling, -7.25, 3.7, -0.5, g);
    this._box(0.25, 3.6, 8.2, this.mats.wall, -11.5, 1.8, -0.5, g);
    this._box(8.6, 3.6, 0.25, this.mats.wall, -7.25, 1.8, -4.5, g);
    this._box(8.6, 3.6, 0.25, this.mats.wall, -7.25, 1.8, 3.5, g);

    // Life-Support & Ration Synthesis Locker at (-10.6, 1.3, -0.5)
    const lockerGrp = new THREE.Group();
    lockerGrp.position.set(-10.6, 0, -0.5);
    this._box(0.95, 2.4, 2.1, this.mats.darkTrim, 0, 1.2, 0, lockerGrp);
    this._box(0.98, 0.18, 2.14, this.mats.hazard, 0, 2.35, 0, lockerGrp);
    const lkrGlow = new THREE.MeshStandardMaterial({
      color: 0x10b981, emissive: 0x10b981, emissiveIntensity: 1.5, roughness: 0.2
    });
    this._box(0.06, 1.3, 0.72, lkrGlow, 0.48, 1.35, -0.45, lockerGrp);
    const lkrAmber = new THREE.MeshStandardMaterial({
      color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 1.35, roughness: 0.2
    });
    this._box(0.06, 1.3, 0.72, lkrAmber, 0.48, 1.35, 0.45, lockerGrp);
    g.add(lockerGrp);

    // Cryo-galley table at (-7.0, 0.8, -1.5) with metallic trays
    this._box(2.3, 0.1, 1.25, this.mats.shutter, -7.0, 0.82, -1.5, g);
    this._box(0.18, 0.8, 0.18, this.mats.darkTrim, -7.9, 0.4, -1.5, g);
    this._box(0.18, 0.8, 0.18, this.mats.darkTrim, -6.1, 0.4, -1.5, g);
    this._box(0.45, 0.04, 0.32, this.mats.wall, -7.35, 0.89, -1.35, g);
    this._box(0.42, 0.04, 0.3, this.mats.wall, -6.65, 0.89, -1.6, g);

    // Storage crates along north/south corners
    this._box(1.3, 1.1, 1.3, this.mats.darkTrim, -9.8, 0.55, -3.3, g);
    this._box(1.32, 0.15, 1.32, this.mats.hazard, -9.8, 1.05, -3.3, g);
    this._box(1.2, 0.95, 1.4, this.mats.darkTrim, -9.6, 0.48, 2.3, g);

    // Flickering overhead fluorescent tube fixture
    const tubeMat = new THREE.MeshStandardMaterial({
      color: 0xe0f2fe, emissive: 0xbae6fd, emissiveIntensity: 1.6
    });
    this.messFluorescentTubeMat = tubeMat;
    this._box(1.8, 0.08, 0.22, tubeMat, -7.0, 3.54, -1.5, g);

    this.root.add(g);
  }

  _buildMaintenanceCorridor() {
    const g = new THREE.Group();
    g.name = 'MaintenanceCorridor';

    // X: [-3.0, +3.0], Y: [-1.2, +3.6], Z: [-6.0, +11.0] (Length = 17m, center Z = 2.5m)
    // Grated Catwalk Floor at Y = 0.0m
    const catwalkFloor = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 17.0), this.mats.catwalk);
    catwalkFloor.rotation.x = -Math.PI / 2;
    catwalkFloor.position.set(0, 0.0, 2.5);
    g.add(catwalkFloor);

    // Sub-floor coolant trench at Y = -1.2m
    this._box(6.1, 0.18, 17.2, this.mats.darkTrim, 0, -1.25, 2.5, g);
    this._box(0.2, 1.25, 17.2, this.mats.darkTrim, -2.95, -0.62, 2.5, g);
    this._box(0.2, 1.25, 17.2, this.mats.darkTrim, 2.95, -0.62, 2.5, g);

    // Glowing sub-floor coolant pipes (cyan and amber)
    const pipeGeo = new THREE.CylinderGeometry(0.14, 0.14, 16.8, 12);
    pipeGeo.rotateX(Math.PI / 2);
    const p1 = new THREE.Mesh(pipeGeo, this.mats.pipeCyan);
    p1.position.set(-1.15, -0.88, 2.5);
    const p2 = new THREE.Mesh(pipeGeo, this.mats.pipeAmber);
    p2.position.set(1.15, -0.88, 2.5);
    g.add(p1, p2);

    // Ceiling & East/West Corridor Walls (West wall has doorway gap Z ∈ [-2.0, +1.5] to Mess Hall)
    this._box(6.2, 0.2, 17.2, this.mats.ceiling, 0, 3.7, 2.5, g);
    this._box(0.25, 3.6, 17.0, this.mats.wall, 3.0, 1.8, 2.5, g);

    // West wall split around Mess Hall portal (Z: -2.0 to +1.5)
    this._box(0.25, 3.6, 4.0, this.mats.wall, -3.0, 1.8, -4.0, g);
    this._box(0.25, 3.6, 9.5, this.mats.wall, -3.0, 1.8, 6.25, g);
    this._box(0.28, 0.6, 3.6, this.mats.wall, -3.0, 3.3, -0.25, g);
    this._box(0.32, 3.0, 0.2, this.mats.hazardTall, -3.0, 1.5, -2.0, g);
    this._box(0.32, 3.0, 0.2, this.mats.hazardTall, -3.0, 1.5, 1.5, g);

    // Overhead Ribbed Support Arches every 2.5m along Z
    for (let z = -5.0; z <= 10.0; z += 2.5) {
      this._box(0.26, 3.5, 0.28, this.mats.darkTrim, -2.76, 1.75, z, g);
      this._box(0.26, 3.5, 0.28, this.mats.darkTrim, 2.76, 1.75, z, g);
      this._box(5.8, 0.26, 0.3, this.mats.darkTrim, 0, 3.46, z, g);
    }

    // Two Damaged Alien Breach Ventilation Grates at (-2.8, 2.4, -1.0) and (+2.8, 2.4, +5.5)
    const buildBreachVent = (vx, vy, vz, side) => {
      const vg = new THREE.Group();
      vg.position.set(vx, vy, vz);
      this._box(0.22, 1.05, 1.5, this.mats.hazard, 0, 0, 0, vg);
      const cavMat = new THREE.MeshBasicMaterial({ color: 0x350804 });
      this._box(0.14, 0.85, 1.3, cavMat, -side * 0.06, 0, 0, vg);
      for (let i = -2; i <= 2; i++) {
        const louver = this._box(0.06, 0.08, 1.24, this.mats.darkTrim, side * 0.1, i * 0.17, 0, vg);
        louver.rotation.z = side * (0.35 + i * 0.18);
        louver.rotation.y = (i % 2 === 0 ? 1 : -1) * 0.16;
      }
      const vLight = new THREE.PointLight(0xff3b00, 1.4, 4.5, 2.0);
      vLight.position.set(side * 0.25, 0, 0);
      vg.add(vLight);
      g.add(vg);
    };
    buildBreachVent(-2.82, 2.4, -1.0, 1);
    buildBreachVent(2.82, 2.4, 5.5, -1);

    // Internal Corridor Blast Gate at Z = -5.9m anchored at ceiling lintel (Y=3.28m) so nothing pokes above roof
    const gateGrp = new THREE.Group();
    gateGrp.position.set(0, 3.28, -5.88);
    const gateBlade = this._box(5.55, 3.3, 0.22, this.mats.shutter, 0, -1.65, 0, gateGrp);
    this._box(5.58, 0.42, 0.24, this.mats.hazard, 0, -1.44, 0, gateBlade);
    gateGrp.scale.y = 0.06;
    g.add(gateGrp);
    this.corridorBlastGate = { mesh: gateGrp, openScaleY: 0.06, closedScaleY: 1.0 };

    this.root.add(g);
  }

  _buildAirlockChamber() {
    const g = new THREE.Group();
    g.name = 'AirlockChamber';

    // X: [-2.5, +2.5], Y: [0.0, +3.2], Z: [+11.0, +16.5] (Length = 5.5m, center Z = 13.75m)
    this._box(5.2, 0.2, 5.6, this.mats.floor, 0, -0.1, 13.75, g);
    this._box(5.2, 0.2, 5.6, this.mats.ceiling, 0, 3.3, 13.75, g);
    this._box(0.25, 3.2, 5.6, this.mats.wall, -2.5, 1.6, 13.75, g);
    this._box(0.25, 3.2, 5.6, this.mats.wall, 2.5, 1.6, 13.75, g);

    // Inner Bulkhead Wall & Frame at Z = +11.0m (opening X ∈ [-1.75, +1.75], Y ∈ [0, 2.8])
    this._box(1.3, 3.6, 0.3, this.mats.wall, -2.38, 1.8, 11.0, g);
    this._box(1.3, 3.6, 0.3, this.mats.wall, 2.38, 1.8, 11.0, g);
    this._box(6.0, 0.8, 0.3, this.mats.wall, 0, 3.2, 11.0, g);
    this._box(0.2, 2.8, 0.34, this.mats.hazardTall, -1.78, 1.4, 11.0, g);
    this._box(0.2, 2.8, 0.34, this.mats.hazardTall, 1.78, 1.4, 11.0, g);

    // Dual Horizontal Sliding Inner Doors at Z = +11.0m (tucked cleanly inside Corridor walls when open)
    this.innerDoorLeft = this._box(1.66, 2.8, 0.16, this.mats.shutter, -2.14, 1.4, 11.0, g);
    this._box(0.3, 2.8, 0.18, this.mats.hazardTall, 0.68, 0, 0, this.innerDoorLeft);

    this.innerDoorRight = this._box(1.66, 2.8, 0.16, this.mats.shutter, 2.14, 1.4, 11.0, g);
    this._box(0.3, 2.8, 0.18, this.mats.hazardTall, -0.68, 0, 0, this.innerDoorRight);

    // Outer EVA Hatch Frame at Z = +16.5m (opening X ∈ [-1.65, +1.65], Y ∈ [0, 2.75]) + armored slide rail collars
    this._box(0.95, 3.2, 0.35, this.mats.wall, -2.12, 1.6, 16.5, g);
    this._box(0.95, 3.2, 0.35, this.mats.wall, 2.12, 1.6, 16.5, g);
    this._box(5.2, 0.55, 0.35, this.mats.wall, 0, 2.95, 16.5, g);
    this._box(3.6, 0.18, 0.4, this.mats.hazard, 0, 0.08, 16.5, g);
    this._box(3.5, 0.22, 0.38, this.mats.darkTrim, -3.7, 2.9, 16.5, g);
    this._box(3.5, 0.22, 0.38, this.mats.darkTrim, -3.7, 0.06, 16.5, g);

    // Heavy Reinforced Outer EVA Hatch with Pressure Wheel & Viewport Window
    const outerGrp = new THREE.Group();
    outerGrp.position.set(0, 1.4, 16.48);
    this._box(1.25, 2.76, 0.2, this.mats.shutter, -1.08, 0, 0, outerGrp);
    this._box(1.25, 2.76, 0.2, this.mats.shutter, 1.08, 0, 0, outerGrp);
    this._box(0.92, 0.92, 0.2, this.mats.shutter, 0, 0.92, 0, outerGrp);
    this._box(0.92, 0.92, 0.2, this.mats.shutter, 0, -0.92, 0, outerGrp);
    this._box(3.4, 0.24, 0.22, this.mats.hazard, 0, -1.24, 0, outerGrp);
    this._box(0.92, 0.92, 0.06, this.mats.glass, 0, 0, 0, outerGrp);

    const wheelGrp = new THREE.Group();
    wheelGrp.position.set(0, -0.68, -0.14);
    const torus = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.038, 10, 24), this.mats.hazard);
    this._box(0.5, 0.04, 0.04, this.mats.darkTrim, 0, 0, 0, wheelGrp);
    this._box(0.04, 0.5, 0.04, this.mats.darkTrim, 0, 0, 0, wheelGrp);
    wheelGrp.add(torus);
    outerGrp.add(wheelGrp);
    this.outerHatchWheel = wheelGrp;
    this.outerHatchDoor = outerGrp;
    g.add(outerGrp);

    // Airlock Control Terminal at (+2.1, 1.35, +13.8) + Auxiliary Call Panels at Z=10.4 & Z=17.0
    const buildAirlockPanel = (px, py, pz, rotY) => {
      const pg = new THREE.Group();
      pg.position.set(px, py, pz);
      pg.rotation.y = rotY;
      this._box(0.45, 0.62, 0.12, this.mats.darkTrim, 0, 0, 0, pg);
      this._box(0.36, 0.28, 0.03, this.mats.crt, 0, 0.12, 0.06, pg);
      const ledMat = new THREE.MeshStandardMaterial({
        color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 1.6
      });
      const led = this._box(0.28, 0.09, 0.03, ledMat, 0, -0.15, 0.06, pg);
      this.airlockLEDs.push(led);
      g.add(pg);
    };
    buildAirlockPanel(2.32, 1.35, 13.8, -Math.PI / 2);
    buildAirlockPanel(2.2, 1.35, 10.75, 0);
    buildAirlockPanel(2.15, 1.35, 16.75, Math.PI);

    // Ceiling Depressurization Steam Nozzles at Z = +12.5m and +15.0m
    for (const nz of [12.5, 15.0]) {
      this._box(0.35, 0.14, 0.35, this.mats.hazard, -1.2, 3.12, nz, g);
      this._box(0.35, 0.14, 0.35, this.mats.hazard, 1.2, 3.12, nz, g);
    }

    this.root.add(g);
  }

  _buildLightingAndBeacons() {
    const g = new THREE.Group();
    g.name = 'StationLighting';

    const addWorkLight = (x, y, z, color, intensity, dist, tag = 'work') => {
      const l = new THREE.PointLight(color, intensity, dist, 1.35);
      l.position.set(x, y, z);
      l.castShadow = false;
      g.add(l);
      this.workLights.push({ light: l, baseIntensity: intensity, tag });
      return l;
    };

    // Bridge work lights (calibrated for Three.js r164 physical light units)
    addWorkLight(0, 3.85, -13.2, 0xbae6fd, 10.5, 18);
    addWorkLight(-4.2, 3.7, -9.5, 0xe0f2fe, 7.5, 16);
    addWorkLight(4.2, 3.7, -9.5, 0xe0f2fe, 7.5, 16);

    // Mess Hall & Storage Bay lights
    this.messFluorescent = addWorkLight(-7.0, 3.35, -1.5, 0xdbeafe, 9.0, 15, 'mess');
    addWorkLight(-10.1, 2.4, -0.5, 0x6ee7b7, 5.2, 8, 'locker');

    // Maintenance Corridor overhead + sub-floor trench glow
    addWorkLight(0, 3.3, -3.5, 0xcbd5e1, 6.8, 13);
    addWorkLight(0, 3.3, 2.5, 0xcbd5e1, 6.8, 13);
    addWorkLight(0, 3.3, 8.5, 0xcbd5e1, 6.8, 13);
    addWorkLight(0, -0.7, 0.0, 0x06b6d4, 5.2, 9, 'trench');
    addWorkLight(0, -0.7, 6.0, 0xf59e0b, 4.8, 9, 'trench');

    // Airlock Chamber light
    addWorkLight(0, 2.95, 13.75, 0xfef3c7, 8.2, 12, 'airlock');

    // 5 Rotating Red Emergency Beacon SpotLights (Bridge, Mess Hall, 3 in Corridor: Z = -4.0, +2.0, +8.0)
    const beaconCoords = [
      [0, 3.95, -10.5],
      [-7.2, 3.38, -0.5],
      [0, 3.38, -4.0],
      [0, 3.38, 2.0],
      [0, 3.38, 8.0]
    ];

    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0x330404,
      emissive: 0xff1111,
      emissiveIntensity: 0.0,
      roughness: 0.2,
      metalness: 0.1
    });
    const coneGeo = new THREE.ConeGeometry(1.45, 4.8, 16, 1, true);
    coneGeo.translate(0, -2.4, 0);
    coneGeo.rotateX(-Math.PI / 2); // Open cone extends along +Z so lookAt(target) aims beam accurately
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xff1a12,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    beaconCoords.forEach(([bx, by, bz], idx) => {
      const mount = new THREE.Group();
      mount.position.set(bx, by, bz);
      this._box(0.34, 0.12, 0.34, this.mats.hazard, 0, 0.08, 0, mount);

      const rotor = new THREE.Group();
      rotor.rotation.y = idx * 0.95;
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.18, 12), bulbMat.clone());
      rotor.add(lens);

      const spot = new THREE.SpotLight(0xff1410, 0.0, 22.0, 0.68, 0.55, 1.25);
      spot.position.set(0, -0.05, 0);
      spot.castShadow = false;
      spot.visible = false;
      const target = new THREE.Object3D();
      target.position.set(0, -2.4, 4.5);
      rotor.add(spot, target);
      spot.target = target;

      const volCone = new THREE.Mesh(coneGeo, coneMat.clone());
      volCone.position.set(0, -0.05, 0);
      volCone.lookAt(0, -2.4, 4.5);
      rotor.add(volCone);

      mount.add(rotor);
      g.add(mount);

      this.redBeacons.push({ rotor, spot, lensMat: lens.material, coneMat: volCone.material });
    });

    this.root.add(g);
  }

  _buildSteamSystems() {
    const sprite = this.texFactory.createSteamSpriteTexture();

    // 1. Airlock Depressurization Steam Particle System (180 particles from Z=12.5m & Z=15.0m)
    const airCount = 180;
    const airPos = new Float32Array(airCount * 3);
    for (let i = 0; i < airCount; i++) {
      const nozzleZ = i % 2 === 0 ? 12.5 : 15.0;
      const nozzleX = i % 4 < 2 ? -1.2 : 1.2;
      airPos[i * 3] = nozzleX + (Math.random() - 0.5) * 0.4;
      airPos[i * 3 + 1] = 0.2 + Math.random() * 2.9;
      airPos[i * 3 + 2] = nozzleZ + (Math.random() - 0.5) * 0.5;
      this.airlockSteamMeta.push({
        ox: nozzleX,
        oz: nozzleZ,
        vx: (Math.random() - 0.5) * 1.4,
        vy: -(2.6 + Math.random() * 2.4),
        vz: (Math.random() - 0.5) * 1.4,
        phase: Math.random() * Math.PI * 2
      });
    }
    const airGeo = new THREE.BufferGeometry();
    airGeo.setAttribute('position', new THREE.BufferAttribute(airPos, 3));
    const airMat = new THREE.PointsMaterial({
      map: sprite,
      color: 0xdbeafe,
      size: 0.72,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.airlockSteam = new THREE.Points(airGeo, airMat);
    this.root.add(this.airlockSteam);

    // 2. Corridor Thermal Vent Purge Steam Particle System (300 particles during Lockdown)
    const purgeCount = 300;
    const purgePos = new Float32Array(purgeCount * 3);
    for (let i = 0; i < purgeCount; i++) {
      const oz = -5.0 + Math.random() * 15.5;
      const ox = (Math.random() - 0.5) * 4.4;
      purgePos[i * 3] = ox;
      purgePos[i * 3 + 1] = Math.random() * 3.4;
      purgePos[i * 3 + 2] = oz;
      this.purgeSteamMeta.push({
        ox,
        oz,
        vx: (Math.random() - 0.5) * 2.2,
        vy: -(3.0 + Math.random() * 3.2),
        vz: (Math.random() - 0.5) * 2.2
      });
    }
    const purgeGeo = new THREE.BufferGeometry();
    purgeGeo.setAttribute('position', new THREE.BufferAttribute(purgePos, 3));
    const purgeMat = new THREE.PointsMaterial({
      map: sprite,
      color: 0xfed7aa,
      size: 0.95,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.purgeSteam = new THREE.Points(purgeGeo, purgeMat);
    this.root.add(this.purgeSteam);
  }

  _registerCollidersAndInteractables() {
    const { colliders, interactables, radarTargets, station, player, events } = this.ctx;

    // 1. Exact Walkable Interior AABB Volumes (PLAN.md 4.2) + Mess Doorway connector
    this.bridgeWalkBox = new THREE.Box3(new THREE.Vector3(-5.6, 0.0, -15.4), new THREE.Vector3(5.6, 3.8, -5.8));
    this.corridorWalkBox = new THREE.Box3(new THREE.Vector3(-2.6, 0.0, -6.2), new THREE.Vector3(2.6, 3.4, 11.1));
    this.messWalkBox = new THREE.Box3(new THREE.Vector3(-11.1, 0.0, -4.1), new THREE.Vector3(-3.0, 3.4, 3.1));
    this.messDoorWalkBox = new THREE.Box3(new THREE.Vector3(-3.4, 0.0, -1.8), new THREE.Vector3(-2.2, 3.2, 1.3));
    this.airlockWalkBox = new THREE.Box3(new THREE.Vector3(-2.1, 0.0, 10.9), new THREE.Vector3(2.1, 3.0, 16.2));

    colliders.interiorWalkableAABBs.length = 0;
    colliders.interiorWalkableAABBs.push(
      this.bridgeWalkBox,
      this.corridorWalkBox,
      this.messWalkBox,
      this.messDoorWalkBox,
      this.airlockWalkBox
    );

    // 2. Interior Solid Obstacle AABBs (Consoles, Galley Table, Locker, Crates)
    colliders.interiorObstacleAABBs.length = 0;
    colliders.interiorObstacleAABBs.push(
      new THREE.Box3(new THREE.Vector3(-1.3, 0.0, -13.75), new THREE.Vector3(1.3, 2.2, -12.65)),
      new THREE.Box3(new THREE.Vector3(-5.5, 0.0, -12.65), new THREE.Vector3(-4.3, 2.0, -9.35)),
      new THREE.Box3(new THREE.Vector3(4.3, 0.0, -12.65), new THREE.Vector3(5.5, 2.0, -9.35)),
      new THREE.Box3(new THREE.Vector3(-8.2, 0.0, -2.15), new THREE.Vector3(-5.8, 1.5, -0.85)),
      new THREE.Box3(new THREE.Vector3(-11.15, 0.0, -1.6), new THREE.Vector3(-10.05, 2.5, 0.6)),
      new THREE.Box3(new THREE.Vector3(-10.5, 0.0, -4.0), new THREE.Vector3(-9.1, 1.5, -2.6)),
      new THREE.Box3(new THREE.Vector3(-10.3, 0.0, 1.55), new THREE.Vector3(-8.9, 1.5, 3.05))
    );

    // 3. Airlock Trigger Volume AABB
    colliders.airlockVolumeAABB = new THREE.Box3(
      new THREE.Vector3(-2.4, -0.2, 11.0),
      new THREE.Vector3(2.4, 3.2, 16.5)
    );

    // 4. Interactive Props Registry
    const removeByIds = new Set([
      'BRIDGE_LOCKDOWN_CONSOLE',
      'SUPPLY_LOCKER',
      'AIRLOCK_PANEL_INSIDE',
      'AIRLOCK_PANEL_CORRIDOR',
      'AIRLOCK_PANEL_OUTSIDE'
    ]);
    for (let i = interactables.length - 1; i >= 0; i--) {
      if (removeByIds.has(interactables[i].id)) interactables.splice(i, 1);
    }

    interactables.push(
      {
        id: 'BRIDGE_LOCKDOWN_CONSOLE',
        type: 'TERMINAL',
        label: '[HOLD E] ENGAGE EMERGENCY LOCKDOWN & VENT PURGE',
        position: new THREE.Vector3(0.0, 1.05, -13.2),
        radius: 3.0,
        holdDuration: 2.5,
        canInteract: () => !station.lockdownActive,
        onHoldTick: (p) => {
          station.lockdownHoldProgress = Math.max(0, Math.min(1, p || 0));
          this.ctx.textures.terminal.update();
        },
        onInteract: () => this.triggerEmergencyLockdown()
      },
      {
        id: 'SUPPLY_LOCKER',
        type: 'LOCKER',
        label: '[HOLD E] SYNTHESIZE O2 & RATION RESERVES',
        position: new THREE.Vector3(-10.6, 1.3, -0.5),
        radius: 2.8,
        holdDuration: 0.8,
        canInteract: () => this.lockerCooldown <= 0,
        onInteract: () => {
          this.lockerCooldown = 1.5;
          events?.emit('SUPPLY_LOCKER_USED', { o2Restored: 45, foodRestored: 50 });
          this.ctx.textures.terminal.update();
        }
      },
      {
        id: 'AIRLOCK_PANEL_INSIDE',
        type: 'AIRLOCK',
        label: '[PRESS E] CYCLE EVA AIRLOCK',
        position: new THREE.Vector3(2.1, 1.35, 13.8),
        radius: 2.8,
        holdDuration: 0.0,
        canInteract: () => !station.airlockState.startsWith('CYCLING'),
        onInteract: () => this.cycleAirlock()
      },
      {
        id: 'AIRLOCK_PANEL_CORRIDOR',
        type: 'AIRLOCK',
        label: '[PRESS E] CYCLE / CALL AIRLOCK',
        position: new THREE.Vector3(2.1, 1.35, 10.4),
        radius: 2.8,
        holdDuration: 0.0,
        canInteract: () => !station.airlockState.startsWith('CYCLING'),
        onInteract: () => this.cycleAirlock()
      },
      {
        id: 'AIRLOCK_PANEL_OUTSIDE',
        type: 'AIRLOCK',
        label: '[PRESS E] RE-PRESSURIZE & ENTER STATION',
        position: new THREE.Vector3(2.1, 1.35, 17.0),
        radius: 3.8,
        holdDuration: 0.0,
        canInteract: () => !station.airlockState.startsWith('CYCLING'),
        onInteract: () => this.cycleAirlock()
      }
    );

    // 5. Radar Targets Registry
    for (let i = radarTargets.length - 1; i >= 0; i--) {
      if (radarTargets[i].id === 'AIRLOCK' || radarTargets[i].id === 'BRIDGE') {
        radarTargets.splice(i, 1);
      }
    }
    radarTargets.push(
      { id: 'AIRLOCK', type: 'AIRLOCK', position: new THREE.Vector3(0, 1.3, 13.8), active: true },
      { id: 'BRIDGE', type: 'BRIDGE', position: new THREE.Vector3(0, 1.2, -13.2), active: true }
    );
  }

  isInteriorPositionAllowed(x, z, radius = 0.42) {
    const { station, colliders } = this.ctx;
    const innerOpen = Number(station.innerDoorOpen) > 0.65;
    const outerOpen = Number(station.outerDoorOpen) > 0.65;

    // Closed door barrier checks
    if (!innerOpen && Math.abs(z - 11.0) < radius + 0.14) return false;
    if (!outerOpen && z > 16.2 - radius) return false;
    if (station.lockdownActive && this.shutterAlpha > 0.35 && Math.abs(z - -5.88) < radius + 0.14) return false;

    // Obstacle AABB check in XZ plane
    for (const obs of colliders.interiorObstacleAABBs) {
      if (
        x + radius > obs.min.x &&
        x - radius < obs.max.x &&
        z + radius > obs.min.z &&
        z - radius < obs.max.z
      ) {
        return false;
      }
    }

    const pointInWalkableUnion = (px, pz) => {
      // 1. Bridge
      if (px >= -5.6 && px <= 5.6 && pz >= -15.4 && pz <= -5.8) return true;
      // 2. Maintenance Corridor Spine (including Bridge doorway at Z=-6.0)
      if (px >= -2.6 && px <= 2.6 && pz >= -6.2 && pz <= 11.1) return true;
      // 3. Mess Hall & Doorway Connector (X=-3.0, Z ∈ [-1.7, +1.2])
      if (px >= -11.1 && px <= -3.0 && pz >= -4.1 && pz <= 3.1) return true;
      if (px >= -3.4 && px <= -2.2 && pz >= -1.75 && pz <= 1.25) return true;
      // 4. Inner Airlock Doorway & Chamber
      if (innerOpen && px >= -1.65 && px <= 1.65 && pz >= 10.7 && pz <= 11.4) return true;
      if (px >= -2.1 && px <= 2.1 && pz >= 11.0 && pz <= 16.2) return true;
      // 5. Outer EVA Hatch threshold when open
      if (outerOpen && px >= -1.6 && px <= 1.6 && pz >= 15.8) return true;
      return false;
    };

    const d = radius * 0.7071;
    const samples = [
      [x, z],
      [x + radius, z],
      [x - radius, z],
      [x, z + radius],
      [x, z - radius],
      [x + d, z + d],
      [x - d, z + d],
      [x + d, z - d],
      [x - d, z - d]
    ];
    for (const [sx, sz] of samples) {
      if (!pointInWalkableUnion(sx, sz)) return false;
    }
    return true;
  }

  getPointInteriorStatus(worldPos) {
    if (!worldPos) return false;
    const { x, y, z } = worldPos;
    if (y < -1.3 || y > 4.3) return false;
    const outerOpen = Number(this.ctx.station.outerDoorOpen) > 0.5;
    if (z > 16.5) return false;
    if (z >= 11.0 && z <= 16.5 && Math.abs(x) <= 2.5) {
      return !outerOpen && this.ctx.station.airlockState === 'PRESSURIZED_INNER';
    }
    return (
      (x >= -6.0 && x <= 6.0 && z >= -16.0 && z <= -5.8) ||
      (x >= -3.0 && x <= 3.0 && z >= -6.2 && z <= 11.1) ||
      (x >= -11.5 && x <= -2.5 && z >= -4.5 && z <= 3.5)
    );
  }

  cycleAirlock() {
    const { station, events } = this.ctx;
    if (station.airlockState.startsWith('CYCLING')) return;

    if (station.airlockState === 'PRESSURIZED_INNER') {
      station.airlockState = 'CYCLING_TO_EVA';
      this.airlockTargetMode = 'EVA';
    } else {
      station.airlockState = 'CYCLING_TO_INTERIOR';
      this.airlockTargetMode = 'INTERIOR';
    }
    this.airlockCycleTimer = 0.0;
    station.airlockProgress = 0.0;

    events?.emit('AIRLOCK_CYCLE_START', { targetMode: this.airlockTargetMode });
    this.ctx.textures.terminal.update();
  }

  triggerRedAlert(active) {
    const { station, bloomPass } = this.ctx;
    station.alarmActive = !!active;
    station.powerLevel = active ? 0.18 : 1.0;
    if (bloomPass) bloomPass.strength = active ? 0.95 : 0.65;
    // Apply lighting shift immediately so deterministic debug snapshots capture red alert on frame 1
    for (const wl of this.workLights) {
      wl.light.intensity = active ? wl.baseIntensity * 0.1 : wl.baseIntensity;
    }
    for (const b of this.redBeacons) {
      b.spot.visible = !!active;
      b.spot.intensity = active ? 32.0 : 0.0;
      b.lensMat.color.setHex(active ? 0xff2218 : 0x330404);
      b.lensMat.emissiveIntensity = active ? 4.0 : 0.0;
      b.coneMat.opacity = active ? 0.2 : 0.0;
    }
    this.ctx.textures.terminal.update();
  }

  triggerEmergencyLockdown() {
    const { station, events } = this.ctx;
    if (station.lockdownActive) return;

    station.lockdownActive = true;
    station.lockdownHoldProgress = 1.0;
    this.lockdownTimer = 9.0;

    events?.emit('LOCKDOWN_EXECUTED', { timestamp: this.ctx.elapsed || performance.now() * 0.001 });
    this.ctx.textures.terminal.update();
  }

  update(dt, elapsed) {
    const { station, player, events } = this.ctx;
    if (this.lockerCooldown > 0) this.lockerCooldown = Math.max(0, this.lockerCooldown - dt);

    // 1. Airlock 3.5s Depressurization / Re-pressurization State Machine
    if (station.airlockState === 'CYCLING_TO_EVA' || station.airlockState === 'CYCLING_TO_INTERIOR') {
      this.airlockCycleTimer += dt;
      const p = Math.min(1.0, this.airlockCycleTimer / 3.5);
      station.airlockProgress = p;

      if (station.airlockState === 'CYCLING_TO_EVA') {
        station.innerDoorOpen = Math.max(0.0, 1.0 - p / 0.25);
        station.outerDoorOpen = p > 0.72 ? Math.min(1.0, (p - 0.72) / 0.28) : 0.0;
      } else {
        station.outerDoorOpen = Math.max(0.0, 1.0 - p / 0.25);
        station.innerDoorOpen = p > 0.72 ? Math.min(1.0, (p - 0.72) / 0.28) : 0.0;
      }

      if (p >= 1.0) {
        if (station.airlockState === 'CYCLING_TO_EVA') {
          station.airlockState = 'DEPRESSURIZED_OUTER';
          station.innerDoorOpen = 0.0;
          station.outerDoorOpen = 1.0;
          events?.emit('AIRLOCK_CYCLE_COMPLETE', { mode: 'EVA' });
        } else {
          station.airlockState = 'PRESSURIZED_INNER';
          station.innerDoorOpen = 1.0;
          station.outerDoorOpen = 0.0;
          events?.emit('AIRLOCK_CYCLE_COMPLETE', { mode: 'INTERIOR' });
        }
        station.airlockProgress = 0.0;
        this.ctx.textures.terminal.update();
      }
    }

    // Extend walkable AABB dynamically when airlock doors open
    const inAlpha = Number(station.innerDoorOpen);
    const outAlpha = Number(station.outerDoorOpen);
    this.corridorWalkBox.max.z = inAlpha > 0.65 ? 16.0 : 11.1;
    this.airlockWalkBox.max.z = outAlpha > 0.65 ? 24.0 : 16.2;

    // Animate physical inner sliding doors & outer EVA hatch + wheel
    if (this.innerDoorLeft && this.innerDoorRight) {
      this.innerDoorLeft.position.x = THREE.MathUtils.lerp(-0.83, -2.14, inAlpha);
      this.innerDoorRight.position.x = THREE.MathUtils.lerp(0.83, 2.14, inAlpha);
    }
    if (this.outerHatchDoor) {
      this.outerHatchDoor.position.x = THREE.MathUtils.lerp(0.0, -3.55, outAlpha);
      if (this.outerHatchWheel) this.outerHatchWheel.rotation.z = outAlpha * Math.PI * 1.5;
    }

    // Update Airlock Panel LEDs
    const isCycling = station.airlockState.startsWith('CYCLING');
    const isEvaSide = station.airlockState === 'DEPRESSURIZED_OUTER';
    for (const led of this.airlockLEDs) {
      if (isCycling) {
        const blink = Math.sin(elapsed * 14.0) > 0 ? 1.8 : 0.3;
        led.material.color.setHex(0xf59e0b);
        led.material.emissive.setHex(0xf59e0b);
        led.material.emissiveIntensity = blink;
      } else if (isEvaSide) {
        led.material.color.setHex(0xef4444);
        led.material.emissive.setHex(0xef4444);
        led.material.emissiveIntensity = 1.5;
      } else {
        led.material.color.setHex(0x22c55e);
        led.material.emissive.setHex(0x22c55e);
        led.material.emissiveIntensity = 1.5;
      }
    }

    // 2. Lockdown Blast Shutters & 9.0s Thermal Vent Purge Timer
    const targetShutter = station.lockdownActive ? 1.0 : 0.0;
    const shutterRate = station.lockdownActive ? 5.2 : 1.8;
    this.shutterAlpha = THREE.MathUtils.lerp(this.shutterAlpha, targetShutter, Math.min(1, dt * shutterRate));

    for (const s of this.blastShutters) {
      s.mesh.scale.y = THREE.MathUtils.lerp(s.openScaleY, s.closedScaleY, this.shutterAlpha);
    }
    if (this.corridorBlastGate) {
      this.corridorBlastGate.mesh.scale.y = THREE.MathUtils.lerp(
        this.corridorBlastGate.openScaleY,
        this.corridorBlastGate.closedScaleY,
        this.shutterAlpha
      );
    }

    if (station.lockdownActive) {
      this.lockdownTimer -= dt;
      player.oxygen = Math.min(100, (player.oxygen ?? 100) + dt * 10.0);
      if (this.lockdownTimer <= 0) {
        station.lockdownActive = false;
        station.lockdownHoldProgress = 0.0;
        station.breachTimer = 85.0;
        player.oxygen = 100.0;
        this.triggerRedAlert(false);
        events?.emit('LOCKDOWN_CLEAR', { timestamp: elapsed });
        this.ctx.textures.terminal.update();
      }
    }

    // 3. Work Lights Flicker & Rotating Red Emergency Beacons (omega = 4.2 rad/s)
    const alarm = station.alarmActive;
    for (const wl of this.workLights) {
      if (alarm) {
        const flk = 0.08 + 0.06 * Math.max(0, Math.sin(elapsed * 23.0 + wl.light.position.z * 2.1));
        wl.light.intensity = wl.baseIntensity * flk;
        if (wl.tag === 'mess' && this.messFluorescentTubeMat) {
          this.messFluorescentTubeMat.emissiveIntensity = 0.18 * flk * 10.0;
        }
      } else if (wl.tag === 'mess') {
        const tubeFlicker = Math.sin(elapsed * 37.0) > -0.92 ? 1.0 : 0.35;
        wl.light.intensity = wl.baseIntensity * tubeFlicker;
        if (this.messFluorescentTubeMat) {
          this.messFluorescentTubeMat.emissiveIntensity = 1.6 * tubeFlicker;
        }
      } else {
        wl.light.intensity = wl.baseIntensity;
      }
    }

    for (const b of this.redBeacons) {
      if (alarm) {
        b.spot.visible = true;
        b.rotor.rotation.y += 4.2 * dt;
        b.spot.intensity = 32.0;
        b.lensMat.color.setHex(0xff2218);
        b.lensMat.emissiveIntensity = 4.0;
        b.coneMat.opacity = 0.2;
      } else {
        b.spot.visible = false;
        b.spot.intensity = 0.0;
        b.lensMat.color.setHex(0x330404);
        b.lensMat.emissiveIntensity = 0.0;
        b.coneMat.opacity = 0.0;
      }
    }

    if (this.bridgeBeaconDome) {
      this.bridgeBeaconDome.material.emissiveIntensity = alarm
        ? 1.5 + 1.2 * Math.sin(elapsed * 10.0)
        : 0.45;
    }

    // 4. Airlock & Corridor Purge Steam Particle VFX
    if (this.airlockSteam) {
      const activeSteam = isCycling && station.airlockProgress > 0.12 && station.airlockProgress < 0.88;
      this.airlockSteam.material.opacity = THREE.MathUtils.lerp(
        this.airlockSteam.material.opacity,
        activeSteam ? 0.52 : 0.0,
        Math.min(1, dt * 6.0)
      );
      if (this.airlockSteam.material.opacity > 0.01) {
        const pos = this.airlockSteam.geometry.attributes.position.array;
        for (let i = 0; i < this.airlockSteamMeta.length; i++) {
          const m = this.airlockSteamMeta[i];
          const idx = i * 3;
          pos[idx] += (m.vx + Math.sin(elapsed * 6.0 + m.phase) * 0.6) * dt;
          pos[idx + 1] += m.vy * dt;
          pos[idx + 2] += m.vz * dt;
          if (pos[idx + 1] < 0.1) {
            pos[idx] = m.ox + (Math.random() - 0.5) * 0.3;
            pos[idx + 1] = 3.05;
            pos[idx + 2] = m.oz + (Math.random() - 0.5) * 0.3;
          }
        }
        this.airlockSteam.geometry.attributes.position.needsUpdate = true;
      }
    }

    if (this.purgeSteam) {
      this.purgeSteam.material.opacity = THREE.MathUtils.lerp(
        this.purgeSteam.material.opacity,
        station.lockdownActive ? 0.62 : 0.0,
        Math.min(1, dt * 5.0)
      );
      if (this.purgeSteam.material.opacity > 0.01) {
        const pos = this.purgeSteam.geometry.attributes.position.array;
        for (let i = 0; i < this.purgeSteamMeta.length; i++) {
          const m = this.purgeSteamMeta[i];
          const idx = i * 3;
          pos[idx] += m.vx * dt;
          pos[idx + 1] += m.vy * dt;
          pos[idx + 2] += m.vz * dt;
          if (pos[idx + 1] < -0.5 || Math.abs(pos[idx]) > 2.75) {
            pos[idx] = m.ox;
            pos[idx + 1] = 3.4;
            pos[idx + 2] = m.oz;
          }
        }
        this.purgeSteam.geometry.attributes.position.needsUpdate = true;
      }
    }

    // 5. Dynamic CRT Terminal Screen Update at 10 Hz
    this.terminalAccum += dt;
    if (this.terminalAccum >= 0.1) {
      this.terminalAccum = 0;
      this.ctx.textures.terminal.update();
    }
  }
}
