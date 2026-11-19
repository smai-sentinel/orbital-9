import * as THREE from 'three';

const PEER_PREFIX = 'orbital9-coop-v1-';
const CREW_COLORS = [0x34d399, 0x38bdf8, 0xfbbf24, 0xc084fc, 0xfb7185, 0x2dd4bf];
const RADIO_PINGS = [
  'COORDINATES PINGED — FOLLOW MY RADAR BLIP',
  'NEED O2 / RATIONS ASSIST!',
  'BREACH ALERT — MOVE TO BRIDGE LOCKDOWN!',
  'SUPPLY POD LOCATED IN EVA SECTOR'
];

export class MultiplayerManager {
  constructor(gameContext) {
    this.ctx = gameContext;
    this.peer = null;
    this.role = 'SOLO'; // 'SOLO' | 'HOST' | 'CLIENT'
    this.roomCode = '';
    this.callsign = 'ENG-' + String(Math.floor(100 + Math.random() * 900));
    this.myColor = CREW_COLORS[Math.floor(Math.random() * CREW_COLORS.length)];
    this.connections = new Map(); // peerId -> DataConnection (HOST)
    this.hostConn = null;         // DataConnection (CLIENT)
    this.remotePlayers = new Map(); // peerId -> { group, targetPos, targetQuat, ... }
    this.root = new THREE.Group();
    this.root.name = 'MultiplayerCrewRoot';

    this._sendAccum = 0;
    this._worldSyncAccum = 0;
    this._pingIndex = 0;
    this._suppressOutboundAction = false;
    this._alienTargets = new Map(); // id -> { pos, rotY, state, visible }
    this._statusCb = null;
  }

  init() {
    this.ctx.scene.add(this.root);
    this.ctx.multiplayer = {
      role: 'SOLO',
      roomCode: '',
      callsign: this.callsign,
      crewCount: 1,
      connected: false
    };

    // Listen to local game events to synchronize crew actions across Host/Clients
    const ev = this.ctx.events;
    if (ev) {
      ev.on('POD_HARVESTED', (payload) => {
        if (this._suppressOutboundAction || !payload?.podId) return;
        this._sendAction({ action: 'POD_HARVEST', podId: payload.podId, by: this.callsign });
      });
      ev.on('AIRLOCK_CYCLE_START', () => {
        if (this._suppressOutboundAction) return;
        this._sendAction({ action: 'AIRLOCK_CYCLE', by: this.callsign });
      });
      ev.on('LOCKDOWN_EXECUTED', () => {
        if (this._suppressOutboundAction) return;
        this._sendAction({ action: 'LOCKDOWN', by: this.callsign });
      });
      ev.on('BREACH_ALARM_TRIGGERED', () => {
        if (this._suppressOutboundAction || this.role !== 'HOST') return;
        this._broadcast({ type: 'EVENT_BREACH', by: this.callsign });
      });
    }

    // Bind [T] for quick Crew Radio Ping when in multiplayer
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT' && !this.ctx.isPaused && this.role !== 'SOLO') {
        const activeTag = document.activeElement?.tagName;
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
        this.sendRadioPing();
      }
    });
  }

  onStatusChange(cb) {
    this._statusCb = cb;
  }

  _emitStatus(msg, isError = false) {
    this.ctx.multiplayer.role = this.role;
    this.ctx.multiplayer.roomCode = this.roomCode;
    this.ctx.multiplayer.callsign = this.callsign;
    this.ctx.multiplayer.crewCount = 1 + this.remotePlayers.size;
    this.ctx.multiplayer.connected = this.role !== 'SOLO';
    if (this._statusCb) {
      this._statusCb({
        role: this.role,
        roomCode: this.roomCode,
        crewCount: this.ctx.multiplayer.crewCount,
        message: msg,
        isError
      });
    }
  }

  _generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 4; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  _checkPeerJS() {
    if (typeof window.Peer !== 'function') {
      this._emitStatus('PeerJS library not loaded (offline?)', true);
      return false;
    }
    return true;
  }

  hostRoom(callsignInput) {
    if (!this._checkPeerJS()) return;
    this.disconnect();

    if (callsignInput && callsignInput.trim()) {
      this.callsign = callsignInput.trim().toUpperCase().slice(0, 12);
    }

    this.roomCode = this._generateRoomCode();
    this.role = 'HOST';
    this._emitStatus(`INITIALIZING ROOM ${this.roomCode}...`);

    const peerId = PEER_PREFIX + this.roomCode;
    this.peer = new window.Peer(peerId, {
      debug: 0,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    });

    this.peer.on('open', () => {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('room', this.roomCode);
        window.history.replaceState({}, '', url.toString());
      } catch (_) {}
      this._emitStatus(`HOSTING ROOM ${this.roomCode} — SHARE LINK FOR CO-OP`);
      this.ctx.managers?.audio?.showToast?.(`CO-OP ROOM ${this.roomCode} ONLINE`, 3.2);
    });

    this.peer.on('connection', (conn) => {
      this._setupHostConnection(conn);
    });

    this.peer.on('error', (err) => {
      console.warn('[Multiplayer] Host Peer error:', err?.type || err);
      if (err?.type === 'unavailable-id') {
        this.roomCode = this._generateRoomCode();
        this._emitStatus('ROOM ID BUSY — CLICK HOST AGAIN', true);
      } else {
        this._emitStatus(`NET ERROR: ${err?.type || 'CONNECTION FAILED'}`, true);
      }
    });
  }

  joinRoom(codeInput, callsignInput) {
    if (!this._checkPeerJS()) return;
    const cleanCode = (codeInput || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (!cleanCode) {
      this._emitStatus('ENTER A 4-CHAR ROOM CODE FIRST', true);
      return;
    }

    this.disconnect();
    if (callsignInput && callsignInput.trim()) {
      this.callsign = callsignInput.trim().toUpperCase().slice(0, 12);
    }

    this.roomCode = cleanCode;
    this.role = 'CLIENT';
    this._emitStatus(`CONNECTING TO ROOM ${this.roomCode}...`);

    this.peer = new window.Peer(undefined, {
      debug: 0,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    });

    this.peer.on('open', () => {
      const conn = this.peer.connect(PEER_PREFIX + this.roomCode, { reliable: false });
      this.hostConn = conn;

      conn.on('open', () => {
        try {
          const url = new URL(window.location.href);
          url.searchParams.set('room', this.roomCode);
          window.history.replaceState({}, '', url.toString());
        } catch (_) {}
        conn.send({
          type: 'HELLO',
          callsign: this.callsign,
          color: this.myColor
        });
        this._emitStatus(`CONNECTED TO ROOM ${this.roomCode}`);
        this.ctx.managers?.audio?.showToast?.(`JOINED CREW ROOM ${this.roomCode}`, 3.0);
        this.ctx.managers?.audio?.playOneShot?.('PICKUP');
      });

      conn.on('data', (msg) => this._handleMessage(conn.peer, msg));

      conn.on('close', () => {
        this._emitStatus('HOST DISCONNECTED — SWITCHED TO SOLO', true);
        this.disconnect();
      });

      conn.on('error', (err) => {
        console.warn('[Multiplayer] Client conn error:', err);
        this._emitStatus('FAILED TO REACH ROOM HOST', true);
      });
    });

    this.peer.on('error', (err) => {
      console.warn('[Multiplayer] Client Peer error:', err?.type || err);
      this._emitStatus(`COULD NOT JOIN ${this.roomCode} (${err?.type || 'OFFLINE'})`, true);
      this.role = 'SOLO';
      this.ctx.multiplayer.role = 'SOLO';
      this.ctx.multiplayer.connected = false;
    });
  }

  disconnect() {
    for (const conn of this.connections.values()) {
      try { conn.close(); } catch (_) {}
    }
    this.connections.clear();
    if (this.hostConn) {
      try { this.hostConn.close(); } catch (_) {}
      this.hostConn = null;
    }
    if (this.peer) {
      try { this.peer.destroy(); } catch (_) {}
      this.peer = null;
    }
    for (const id of [...this.remotePlayers.keys()]) {
      this._removeRemotePlayer(id);
    }
    this.role = 'SOLO';
    this.roomCode = '';
    this._emitStatus('SOLO MODE');
  }

  getInviteUrl() {
    const url = new URL(window.location.href);
    if (this.roomCode) url.searchParams.set('room', this.roomCode);
    return url.toString();
  }

  sendRadioPing(customText) {
    const text = customText || RADIO_PINGS[this._pingIndex++ % RADIO_PINGS.length];
    const msg = `[${this.callsign}]: ${text}`;
    this.ctx.managers?.audio?.showToast?.(msg, 3.5);
    this.ctx.managers?.audio?.playOneShot?.('BEEP', { progress: 0.75 });
    const pkt = { type: 'RADIO_PING', from: this.callsign, text };
    if (this.role === 'HOST') {
      this._broadcast(pkt);
    } else if (this.role === 'CLIENT' && this.hostConn?.open) {
      this.hostConn.send(pkt);
    }
  }

  _setupHostConnection(conn) {
    if (this.connections.size >= 5) {
      conn.close();
      return;
    }
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      // Send Host's identity + immediate world snapshot
      conn.send({
        type: 'HELLO',
        peerId: 'HOST',
        callsign: this.callsign,
        color: this.myColor
      });
      this._sendWorldSnapshot(conn);
      this._emitStatus(`ROOM ${this.roomCode} // ${1 + this.connections.size} CREW ONLINE`);
    });

    conn.on('data', (msg) => this._handleMessage(conn.peer, msg));

    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this._removeRemotePlayer(conn.peer);
      this._broadcast({ type: 'PEER_LEFT', peerId: conn.peer });
      this._emitStatus(`ROOM ${this.roomCode} // ${1 + this.connections.size} CREW ONLINE`);
    });
  }

  _broadcast(pkt, excludePeerId = null) {
    for (const [id, conn] of this.connections.entries()) {
      if (id !== excludePeerId && conn.open) {
        try { conn.send(pkt); } catch (_) {}
      }
    }
  }

  _sendAction(payload) {
    if (this.role === 'HOST') {
      this._broadcast({ type: 'ACTION', ...payload });
    } else if (this.role === 'CLIENT' && this.hostConn?.open) {
      this.hostConn.send({ type: 'ACTION', ...payload });
    }
  }

  _handleMessage(senderId, msg) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'HELLO') {
      const id = msg.peerId || senderId;
      this._ensureRemotePlayer(id, msg.callsign || 'CREW', msg.color || 0x34d399);
      this.ctx.managers?.audio?.showToast?.(`CREWMATE ${msg.callsign || 'ENG'} CONNECTED`, 2.8);
      this.ctx.managers?.audio?.playOneShot?.('PICKUP');
      if (this.role === 'HOST') {
        // Relay new crewmate to other clients & existing crewmates to new client
        this._broadcast({ type: 'HELLO', peerId: senderId, callsign: msg.callsign, color: msg.color }, senderId);
        const conn = this.connections.get(senderId);
        if (conn?.open) {
          for (const [otherId, rp] of this.remotePlayers.entries()) {
            if (otherId !== senderId) {
              conn.send({ type: 'HELLO', peerId: otherId, callsign: rp.callsign, color: rp.color });
            }
          }
        }
      }
      this._emitStatus(`ROOM ${this.roomCode} // ${1 + this.remotePlayers.size} CREW ONLINE`);
      return;
    }

    if (msg.type === 'PEER_LEFT') {
      this._removeRemotePlayer(msg.peerId);
      this._emitStatus(`ROOM ${this.roomCode} // ${1 + this.remotePlayers.size} CREW ONLINE`);
      return;
    }

    if (msg.type === 'PLAYER_STATE') {
      const id = msg.peerId || senderId;
      const rp = this._ensureRemotePlayer(id, msg.callsign || 'CREW', msg.color || 0x34d399);
      rp.targetPos.set(msg.p[0], msg.p[1], msg.p[2]);
      rp.targetQuat.set(msg.q[0], msg.q[1], msg.q[2], msg.q[3]);
      rp.flashlightOn = !!msg.fl;
      rp.isThrusting = !!msg.th;
      rp.mode = msg.m || 'INTERIOR';

      if (this.role === 'HOST') {
        // Relay to all other clients
        this._broadcast({ ...msg, peerId: senderId }, senderId);
      }
      return;
    }

    if (msg.type === 'WORLD_SNAPSHOT' && this.role === 'CLIENT') {
      this._applyWorldSnapshot(msg);
      return;
    }

    if (msg.type === 'ACTION') {
      this._applySyncedAction(msg);
      if (this.role === 'HOST') {
        this._broadcast(msg, senderId);
      }
      return;
    }

    if (msg.type === 'EVENT_BREACH' && this.role === 'CLIENT') {
      this._suppressOutboundAction = true;
      this.ctx.managers?.station?.triggerRedAlert?.(true);
      this.ctx.managers?.audio?.showToast?.('CRITICAL: SECTOR BREACH DETECTED', 3.5);
      this._suppressOutboundAction = false;
      return;
    }

    if (msg.type === 'RADIO_PING') {
      this.ctx.managers?.audio?.showToast?.(`[${msg.from}]: ${msg.text}`, 3.5);
      this.ctx.managers?.audio?.playOneShot?.('BEEP', { progress: 0.85 });
      if (this.role === 'HOST') {
        this._broadcast(msg, senderId);
      }
    }
  }

  _applySyncedAction(msg) {
    this._suppressOutboundAction = true;
    try {
      if (msg.action === 'POD_HARVEST' && msg.podId) {
        const eva = this.ctx.managers?.eva;
        const pod = eva?.pods?.find?.((p) => p.id === msg.podId);
        if (pod && !pod.harvested) {
          eva.harvestPod(msg.podId);
          this.ctx.managers?.audio?.showToast?.(`${msg.by} HARVESTED ${msg.podId} (+O2 / RATIONS)`, 2.6);
        }
      } else if (msg.action === 'AIRLOCK_CYCLE') {
        this.ctx.managers?.station?.cycleAirlock?.();
        this.ctx.managers?.audio?.showToast?.(`${msg.by} CYCLED AIRLOCK`, 2.2);
      } else if (msg.action === 'LOCKDOWN') {
        this.ctx.managers?.station?.triggerEmergencyLockdown?.();
        this.ctx.managers?.audio?.showToast?.(`${msg.by} ENGAGED BRIDGE LOCKDOWN!`, 3.2);
      }
    } finally {
      this._suppressOutboundAction = false;
    }
  }

  _sendWorldSnapshot(singleConn = null) {
    const st = this.ctx.station;
    const eva = this.ctx.managers?.eva;
    const alienDir = this.ctx.managers?.aliens;

    const harvestedPods = [];
    if (eva?.pods) {
      for (const p of eva.pods) {
        if (p.harvested) harvestedPods.push(p.id);
      }
    }

    const aliensData = [];
    if (alienDir?.aliens) {
      for (const a of alienDir.aliens) {
        aliensData.push({
          id: a.id,
          p: [
            +a.group.position.x.toFixed(2),
            +a.group.position.y.toFixed(2),
            +a.group.position.z.toFixed(2)
          ],
          ry: +a.group.rotation.y.toFixed(2),
          st: a.state,
          v: a.group.visible ? 1 : 0
        });
      }
    }

    const pkt = {
      type: 'WORLD_SNAPSHOT',
      station: {
        airlockState: st.airlockState,
        innerDoorOpen: st.innerDoorOpen,
        outerDoorOpen: st.outerDoorOpen,
        alarmActive: st.alarmActive,
        lockdownActive: st.lockdownActive,
        breachTimer: +st.breachTimer.toFixed(1)
      },
      harvestedPods,
      aliens: aliensData
    };

    if (singleConn?.open) {
      try { singleConn.send(pkt); } catch (_) {}
    } else {
      this._broadcast(pkt);
    }
  }

  _applyWorldSnapshot(snap) {
    const st = this.ctx.station;
    if (snap.station) {
      if (snap.station.alarmActive !== st.alarmActive) {
        this.ctx.managers?.station?.triggerRedAlert?.(snap.station.alarmActive);
      }
      if (snap.station.lockdownActive && !st.lockdownActive) {
        this._suppressOutboundAction = true;
        this.ctx.managers?.station?.triggerEmergencyLockdown?.();
        this._suppressOutboundAction = false;
      }
      st.airlockState = snap.station.airlockState;
      st.innerDoorOpen = snap.station.innerDoorOpen;
      st.outerDoorOpen = snap.station.outerDoorOpen;
      st.breachTimer = snap.station.breachTimer;
    }

    if (Array.isArray(snap.harvestedPods) && this.ctx.managers?.eva?.pods) {
      this._suppressOutboundAction = true;
      for (const podId of snap.harvestedPods) {
        const pod = this.ctx.managers.eva.pods.find((p) => p.id === podId);
        if (pod && !pod.harvested) {
          this.ctx.managers.eva.harvestPod(podId);
        }
      }
      this._suppressOutboundAction = false;
    }

    if (Array.isArray(snap.aliens)) {
      for (const a of snap.aliens) {
        this._alienTargets.set(a.id, a);
      }
    }
  }

  _createNameplateSprite(text, colorHex) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(4, 14, 24, 0.78)';
    ctx.strokeStyle = '#' + colorHex.toString(16).padStart(6, '0');
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(8, 10, 240, 44, 8);
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 24px monospace';
    ctx.fillStyle = '#e2f1ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 33);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.2, 0.3, 1);
    return sprite;
  }

  _ensureRemotePlayer(peerId, callsign, colorHex) {
    if (this.remotePlayers.has(peerId)) {
      return this.remotePlayers.get(peerId);
    }

    const group = new THREE.Group();
    const suitMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.42,
      metalness: 0.35
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: 0.55,
      roughness: 0.35,
      metalness: 0.4
    });
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.6,
      roughness: 0.12,
      metalness: 0.9
    });

    // Armored Torso (player eye is at Y=0 local, body hangs below)
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.68, 0.32), suitMat);
    torso.position.set(0, -0.52, 0);
    group.add(torso);

    // Chest life-support beacon strip
    const chestBadge = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.34), accentMat);
    chestBadge.position.set(0, -0.40, 0);
    group.add(chestBadge);

    // EVA Backpack + Thruster Cones
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.56, 0.24), suitMat);
    pack.position.set(0, -0.48, 0.25);
    group.add(pack);

    const flameMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const thrusterGroup = new THREE.Group();
    const nozzleGeo = new THREE.ConeGeometry(0.08, 0.48, 8);
    nozzleGeo.rotateX(Math.PI * 0.5);
    const flameL = new THREE.Mesh(nozzleGeo, flameMat);
    flameL.position.set(-0.14, -0.62, 0.52);
    const flameR = new THREE.Mesh(nozzleGeo, flameMat);
    flameR.position.set(0.14, -0.62, 0.52);
    thrusterGroup.add(flameL, flameR);
    thrusterGroup.visible = false;
    group.add(thrusterGroup);

    // Helmet & Reflective Visor
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 12), suitMat);
    helmet.position.set(0, -0.02, 0);
    group.add(helmet);

    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), visorMat);
    visor.scale.set(1.0, 0.85, 0.8);
    visor.position.set(0, -0.01, -0.08);
    group.add(visor);

    // Legs
    const legGeo = new THREE.CylinderGeometry(0.10, 0.09, 0.78, 8);
    const legL = new THREE.Mesh(legGeo, suitMat);
    legL.position.set(-0.15, -1.24, 0);
    const legR = new THREE.Mesh(legGeo, suitMat);
    legR.position.set(0.15, -1.24, 0);
    group.add(legL, legR);

    // Lightweight additive volumetric flashlight beam (zero extra WebGL SpotLight cost!)
    const beamGeo = new THREE.ConeGeometry(1.15, 7.5, 12, 1, true);
    beamGeo.translate(0, -3.75, 0);
    beamGeo.rotateX(Math.PI * 0.5);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xdff4ff,
      transparent: true,
      opacity: 0.09,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const beamMesh = new THREE.Mesh(beamGeo, beamMat);
    beamMesh.position.set(0.14, -0.02, -0.2);
    group.add(beamMesh);

    // Floating Nameplate
    const nameSprite = this._createNameplateSprite(callsign, colorHex);
    nameSprite.position.set(0, 0.42, 0);
    group.add(nameSprite);

    group.position.set(0, 1.68, -9.5);
    this.root.add(group);

    const radarTarget = {
      id: 'CREW_' + peerId,
      type: 'CREW',
      label: callsign,
      position: group.position,
      active: true
    };
    this.ctx.radarTargets.push(radarTarget);

    const record = {
      peerId,
      callsign,
      color: colorHex,
      group,
      thrusterGroup,
      beamMesh,
      radarTarget,
      targetPos: group.position.clone(),
      targetQuat: new THREE.Quaternion(),
      flashlightOn: true,
      isThrusting: false,
      mode: 'INTERIOR'
    };
    this.remotePlayers.set(peerId, record);
    return record;
  }

  _removeRemotePlayer(peerId) {
    const rp = this.remotePlayers.get(peerId);
    if (!rp) return;
    this.root.remove(rp.group);
    rp.radarTarget.active = false;
    const idx = this.ctx.radarTargets.indexOf(rp.radarTarget);
    if (idx !== -1) this.ctx.radarTargets.splice(idx, 1);
    this.remotePlayers.delete(peerId);
  }

  update(dt, elapsed) {
    if (this.role === 'SOLO') return;

    const p = this.ctx.player;
    const cam = this.ctx.camera;
    const alpha = Math.min(1.0, dt * 14.0);

    // 1. Interpolate remote crewmates
    for (const rp of this.remotePlayers.values()) {
      rp.group.position.lerp(rp.targetPos, alpha);
      rp.group.quaternion.slerp(rp.targetQuat, alpha);
      rp.beamMesh.visible = rp.flashlightOn;
      rp.thrusterGroup.visible = rp.isThrusting;
      if (rp.isThrusting) {
        const pulse = 0.85 + 0.3 * Math.sin(elapsed * 42.0);
        rp.thrusterGroup.scale.set(1, 1, pulse);
      }
    }

    // 2. If CLIENT, smoothly interpolate authoritative aliens from Host
    if (this.role === 'CLIENT' && this.ctx.managers?.aliens?.aliens) {
      for (const alien of this.ctx.managers.aliens.aliens) {
        const t = this._alienTargets.get(alien.id);
        if (!t) continue;
        alien.group.visible = !!t.v;
        if (alien.radarTarget) alien.radarTarget.active = !!t.v;
        alien.group.position.x = THREE.MathUtils.lerp(alien.group.position.x, t.p[0], alpha);
        alien.group.position.y = THREE.MathUtils.lerp(alien.group.position.y, t.p[1], alpha);
        alien.group.position.z = THREE.MathUtils.lerp(alien.group.position.z, t.p[2], alpha);
        alien.group.rotation.y = t.ry;
        alien.state = t.st;
      }
    }

    // 3. Transmit local player transform at 20 Hz
    this._sendAccum += dt;
    if (this._sendAccum >= 0.05) {
      this._sendAccum = 0;
      const pkt = {
        type: 'PLAYER_STATE',
        peerId: this.role === 'HOST' ? 'HOST' : undefined,
        callsign: this.callsign,
        color: this.myColor,
        p: [+p.position.x.toFixed(2), +p.position.y.toFixed(2), +p.position.z.toFixed(2)],
        q: [
          +cam.quaternion.x.toFixed(3),
          +cam.quaternion.y.toFixed(3),
          +cam.quaternion.z.toFixed(3),
          +cam.quaternion.w.toFixed(3)
        ],
        fl: p.flashlightOn ? 1 : 0,
        th: p.isThrusting ? 1 : 0,
        m: p.mode
      };
      if (this.role === 'HOST') {
        this._broadcast(pkt);
      } else if (this.role === 'CLIENT' && this.hostConn?.open) {
        try { this.hostConn.send(pkt); } catch (_) {}
      }
    }

    // 4. If HOST, broadcast authoritative world snapshot at 12 Hz
    if (this.role === 'HOST' && this.connections.size > 0) {
      this._worldSyncAccum += dt;
      if (this._worldSyncAccum >= 0.083) {
        this._worldSyncAccum = 0;
        this._sendWorldSnapshot();
      }
    }
  }
}
