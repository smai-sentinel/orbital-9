import * as THREE from 'three';

export class EVASpaceManager {
  constructor(gameContext) {
    this.ctx = gameContext;
    this.scene = gameContext.scene;
    this.root = new THREE.Group();
    this.root.name = 'EVA_SPACE_ROOT';
    this.pods = [];
    this.debris = [];
    this.navStrobes = [];
    this.burstSystems = [];
    this.shaderUniforms = [];
    this.planetGroup = null;
    this.planetMesh = null;
    this.ringMesh = null;
    this.commsDish = null;
    this.textures = {};
    this.materials = {};
  }

  init() {
    if (!this.ctx.colliders) this.ctx.colliders = {};
    if (!Array.isArray(this.ctx.colliders.exteriorHullAABBs)) {
      this.ctx.colliders.exteriorHullAABBs = [];
    }
    if (!Array.isArray(this.ctx.interactables)) this.ctx.interactables = [];
    if (!Array.isArray(this.ctx.radarTargets)) this.ctx.radarTargets = [];

    this.scene.add(this.root);
    this._initTexturesAndMaterials();
    this._buildDeepSpaceLighting();
    this._buildStarfield();
    this._buildNebulaDome();
    this._buildPlanetAcheronIV();
    this._buildExteriorStationHull();
    this.spawnCargoPods(10);
  }

  _cloneTexSet(src, repX, repY, aniso) {
    const out = {};
    for (const k of ['map', 'roughnessMap', 'bumpMap']) {
      if (!src || !src[k] || !src[k].isTexture) continue;
      const t = src[k].clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repX, repY);
      t.anisotropy = aniso;
      t.needsUpdate = true;
      out[k] = t;
    }
    return out;
  }

  _initTexturesAndMaterials() {
    const aniso = this.ctx.renderer ? this.ctx.renderer.capabilities.getMaxAnisotropy() : 8;
    const shared = this.ctx.textures || {};

    const baseHull = shared.hull && shared.hull.map ? shared.hull : this._createFallbackHullPBR();
    const baseHazard = shared.hazard && shared.hazard.map ? shared.hazard : this._createFallbackHazardPBR();
    const baseSolar = this._createSolarPanelPBR();
    const baseRadiator = this._createRadiatorPBR();
    this.textures.glowSprite = this._createRadialGlowTexture();

    const hullLg = this._cloneTexSet(baseHull, 3, 2, aniso);
    const hullSm = this._cloneTexSet(baseHull, 1.5, 1.5, aniso);
    const hullTruss = this._cloneTexSet(baseHull, 1, 4, aniso);
    const hazard = this._cloneTexSet(baseHazard, 2, 1, aniso);
    const solar = this._cloneTexSet(baseSolar, 4, 2, aniso);
    const radiator = this._cloneTexSet(baseRadiator, 3, 2, aniso);

    this.materials.hullLarge = new THREE.MeshStandardMaterial({
      color: 0x9aa6b8, map: hullLg.map, roughnessMap: hullLg.roughnessMap, bumpMap: hullLg.bumpMap,
      bumpScale: 0.022, metalness: 0.84, roughness: 0.44
    });
    this.materials.hullDark = new THREE.MeshStandardMaterial({
      color: 0x566173, map: hullSm.map, roughnessMap: hullSm.roughnessMap, bumpMap: hullSm.bumpMap,
      bumpScale: 0.02, metalness: 0.88, roughness: 0.38
    });
    this.materials.trussSteel = new THREE.MeshStandardMaterial({
      color: 0x778396, map: hullTruss.map, roughnessMap: hullTruss.roughnessMap, bumpMap: hullTruss.bumpMap,
      bumpScale: 0.018, metalness: 0.85, roughness: 0.42
    });
    this.materials.hazard = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: hazard.map, roughnessMap: hazard.roughnessMap, bumpMap: hazard.bumpMap,
      bumpScale: 0.016, metalness: 0.62, roughness: 0.52
    });
    this.materials.solar = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: solar.map, roughnessMap: solar.roughnessMap, bumpMap: solar.bumpMap,
      bumpScale: 0.012, metalness: 0.78, roughness: 0.25, emissive: new THREE.Color(0x071830), emissiveIntensity: 0.45
    });
    this.materials.radiator = new THREE.MeshStandardMaterial({
      color: 0xd0d8e4, map: radiator.map, roughnessMap: radiator.roughnessMap, bumpMap: radiator.bumpMap,
      bumpScale: 0.02, metalness: 0.82, roughness: 0.36
    });
    this.materials.cyanEmissive = new THREE.MeshStandardMaterial({
      color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 2.4, roughness: 0.2, metalness: 0.3
    });
    this.materials.amberEmissive = new THREE.MeshStandardMaterial({
      color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 2.1, roughness: 0.2, metalness: 0.3
    });
    this.materials.strobeRed = new THREE.MeshBasicMaterial({ color: 0xff1e1e });
  }

  _makeCanvasPair(size = 512) {
    const mk = () => { const c = document.createElement('canvas'); c.width = c.height = size; return [c, c.getContext('2d')]; };
    const [aC, a] = mk(), [rC, r] = mk(), [bC, b] = mk();
    return { aC, a, rC, r, bC, b, toTex: () => {
      const map = new THREE.CanvasTexture(aC);
      const roughnessMap = new THREE.CanvasTexture(rC);
      const bumpMap = new THREE.CanvasTexture(bC);
      map.colorSpace = THREE.SRGBColorSpace;
      return { map, roughnessMap, bumpMap };
    }};
  }

  _createFallbackHullPBR() {
    const { a, r, b, toTex } = this._makeCanvasPair(512);
    a.fillStyle = '#2d3540'; a.fillRect(0, 0, 512, 512);
    r.fillStyle = '#787878'; r.fillRect(0, 0, 512, 512);
    b.fillStyle = '#808080'; b.fillRect(0, 0, 512, 512);

    for (let i = 0; i < 1800; i++) {
      const y = (i * 73) % 512;
      const x = (i * 197) % 450;
      const w = 30 + (i % 70);
      a.fillStyle = i % 2 === 0 ? 'rgba(68,78,94,0.06)' : 'rgba(18,22,28,0.06)';
      a.fillRect(x, y, w, 1);
      r.fillStyle = i % 3 === 0 ? 'rgba(55,55,55,0.08)' : 'rgba(150,150,150,0.06)';
      r.fillRect(x, y, w, 1);
    }

    const step = 128;
    for (let gx = 0; gx < 512; gx += step) {
      for (let gy = 0; gy < 512; gy += step) {
        a.strokeStyle = '#11151b'; a.lineWidth = 3; a.strokeRect(gx + 1.5, gy + 1.5, step - 3, step - 3);
        a.strokeStyle = '#566476'; a.lineWidth = 1; a.strokeRect(gx + 3.5, gy + 3.5, step - 7, step - 7);
        r.strokeStyle = '#d0d0d0'; r.lineWidth = 3; r.strokeRect(gx + 1.5, gy + 1.5, step - 3, step - 3);
        b.strokeStyle = '#181818'; b.lineWidth = 3; b.strokeRect(gx + 1.5, gy + 1.5, step - 3, step - 3);

        for (let d = 16; d < step; d += 32) {
          for (const [rx, ry] of [[gx + d, gy + 8], [gx + d, gy + step - 8], [gx + 8, gy + d], [gx + step - 8, gy + d]]) {
            a.fillStyle = '#485362'; a.beginPath(); a.arc(rx, ry, 2.2, 0, Math.PI * 2); a.fill();
            b.fillStyle = '#e5e5e5'; b.beginPath(); b.arc(rx, ry, 2.2, 0, Math.PI * 2); b.fill();
          }
        }
      }
    }
    return toTex();
  }

  _createFallbackHazardPBR() {
    const { a, r, b, toTex } = this._makeCanvasPair(512);
    a.fillStyle = '#d99b16'; a.fillRect(0, 0, 512, 512);
    r.fillStyle = '#686868'; r.fillRect(0, 0, 512, 512);
    b.fillStyle = '#888888'; b.fillRect(0, 0, 512, 512);

    a.fillStyle = '#181b20';
    for (let i = -512; i < 1024; i += 72) {
      a.beginPath();
      a.moveTo(i, 0); a.lineTo(i + 36, 0); a.lineTo(i - 512 + 36, 512); a.lineTo(i - 512, 512);
      a.closePath(); a.fill();
    }
    for (let i = 0; i < 550; i++) {
      const x = (i * 173) % 512, y = (i * 311) % 512, rad = 1.5 + (i % 4);
      a.fillStyle = i % 2 ? '#5a4634' : '#737b86';
      a.fillRect(x, y, rad, rad);
      r.fillStyle = '#c2c2c2'; r.fillRect(x, y, rad, rad);
      b.fillStyle = '#454545'; b.fillRect(x, y, rad, rad);
    }
    return toTex();
  }

  _createSolarPanelPBR() {
    const { a, r, b, toTex } = this._makeCanvasPair(512);
    a.fillStyle = '#091b38'; a.fillRect(0, 0, 512, 512);
    r.fillStyle = '#242424'; r.fillRect(0, 0, 512, 512);
    b.fillStyle = '#808080'; b.fillRect(0, 0, 512, 512);

    for (let y = 0; y < 512; y += 64) {
      for (let x = 0; x < 512; x += 64) {
        const g = a.createLinearGradient(x, y, x + 64, y + 64);
        g.addColorStop(0, '#0c2752'); g.addColorStop(0.5, '#133b75'); g.addColorStop(1, '#091e40');
        a.fillStyle = g; a.fillRect(x + 2, y + 2, 60, 60);
        a.strokeStyle = '#6487b0'; a.lineWidth = 1;
        for (let sy = y + 10; sy < y + 60; sy += 8) {
          a.beginPath(); a.moveTo(x + 3, sy); a.lineTo(x + 61, sy); a.stroke();
        }
        a.strokeStyle = '#a8c5e6'; a.lineWidth = 2.5;
        a.strokeRect(x + 1.5, y + 1.5, 61, 61);
        r.strokeStyle = '#888888'; r.lineWidth = 3;
        r.strokeRect(x + 1.5, y + 1.5, 61, 61);
        b.strokeStyle = '#d8d8d8'; b.lineWidth = 2.5;
        b.strokeRect(x + 1.5, y + 1.5, 61, 61);
      }
    }
    return toTex();
  }

  _createRadiatorPBR() {
    const { a, r, b, toTex } = this._makeCanvasPair(512);
    a.fillStyle = '#4e5866'; a.fillRect(0, 0, 512, 512);
    r.fillStyle = '#606060'; r.fillRect(0, 0, 512, 512);
    b.fillStyle = '#808080'; b.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 16) {
      a.fillStyle = '#738091'; a.fillRect(0, y, 512, 7);
      a.fillStyle = '#1f242b'; a.fillRect(0, y + 11, 512, 5);
      r.fillStyle = '#404040'; r.fillRect(0, y, 512, 7);
      b.fillStyle = '#d0d0d0'; b.fillRect(0, y, 512, 7);
      b.fillStyle = '#252525'; b.fillRect(0, y + 11, 512, 5);
    }
    for (let x = 0; x < 512; x += 128) {
      a.fillStyle = '#313842'; a.fillRect(x, 0, 12, 512);
      b.fillStyle = '#f0f0f0'; b.fillRect(x, 0, 12, 512);
    }
    return toTex();
  }

  _createRadialGlowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.28, 'rgba(125,211,252,0.85)');
    g.addColorStop(0.65, 'rgba(56,189,248,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  _buildDeepSpaceLighting() {
    const sunLight = new THREE.DirectionalLight(0x7dd3fc, 2.8);
    sunLight.position.set(79, 47, -39);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(1024, 1024);
    sunLight.shadow.camera.left = -42;
    sunLight.shadow.camera.right = 42;
    sunLight.shadow.camera.top = 42;
    sunLight.shadow.camera.bottom = -42;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 220;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.04;
    this.root.add(sunLight);

    const rimFill = new THREE.DirectionalLight(0x4ea8de, 0.72);
    rimFill.position.set(-45, -18, 65);
    this.root.add(rimFill);

    const bayLight = new THREE.PointLight(0xdbeafe, 24, 30, 2);
    bayLight.position.set(0, 4.5, 18.2);
    this.root.add(bayLight);
  }

  _buildStarfield() {
    const count = 2600;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);

    const palette = [
      new THREE.Color(0x9bb0ff),
      new THREE.Color(0xfff4ea),
      new THREE.Color(0xffcc6f),
      new THREE.Color(0xffffff),
      new THREE.Color(0xcad8ff)
    ];

    for (let i = 0; i < count; i++) {
      const r = 1600 + Math.random() * 1000;
      const theta = Math.random() * Math.PI * 2;
      const band = i < 1600 ? (Math.random() - 0.5) * 0.35 : Math.acos(2 * Math.random() - 1) - Math.PI * 0.5;
      let x = r * Math.cos(band) * Math.cos(theta);
      let y = r * Math.sin(band);
      let z = r * Math.cos(band) * Math.sin(theta);
      if (i < 1600) {
        const tilt = 0.48;
        const ny = y * Math.cos(tilt) - x * Math.sin(tilt);
        const nx = y * Math.sin(tilt) + x * Math.cos(tilt);
        x = nx; y = ny;
      }
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      const c = palette[i % palette.length];
      const bright = 0.65 + Math.random() * 0.35;
      colors[i * 3] = c.r * bright;
      colors[i * 3 + 1] = c.g * bright;
      colors[i * 3 + 2] = c.b * bright;
      sizes[i] = 1.4 + Math.pow(Math.random(), 2.6) * 3.8;
      phases[i] = Math.random() * 6.283;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    const uniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) }
    };
    this.shaderUniforms.push(uniforms);

    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        attribute float aSize;
        attribute float aPhase;
        attribute vec3 aColor;
        uniform float uTime;
        uniform float uPixelRatio;
        varying vec3 vColor;
        varying float vTwinkle;
        void main() {
          vColor = aColor;
          vTwinkle = 0.78 + 0.22 * sin(uTime * 2.1 + aPhase);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * uPixelRatio * vTwinkle, 1.2, 10.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vTwinkle;
        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float d = length(uv);
          if (d > 0.5) discard;
          float core = smoothstep(0.5, 0.05, d);
          float spike = pow(max(0.0, 1.0 - d * 2.0), 2.5);
          gl_FragColor = vec4(vColor * (core + spike * 0.65) * vTwinkle, core);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false
    });

    const stars = new THREE.Points(geo, mat);
    stars.frustumCulled = false;
    this.root.add(stars);
  }

  _buildNebulaDome() {
    // Pre-rendered procedural equirectangular nebula CanvasTexture (50x faster than per-pixel 3D FBM)
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#02040a';
    ctx.fillRect(0, 0, 512, 256);

    const blobs = [
      [110, 125, 175, 'rgba(18, 72, 128, 0.24)'],
      [255, 118, 210, 'rgba(22, 92, 145, 0.22)'],
      [380, 138, 185, 'rgba(56, 26, 98, 0.22)'],
      [190, 142, 140, 'rgba(42, 118, 178, 0.16)'],
      [325, 105, 135, 'rgba(72, 32, 124, 0.18)'],
      [60, 110, 130, 'rgba(30, 82, 132, 0.16)'],
      [455, 130, 145, 'rgba(20, 74, 126, 0.18)']
    ];
    for (const [x, y, r, col] of blobs) {
      const g = ctx.createRadialGradient(x, y, 4, x, y, r);
      g.addColorStop(0, col);
      g.addColorStop(0.55, col.replace(/0\.\d+\)$/, '0.07)'));
      g.addColorStop(1, 'rgba(2, 4, 10, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 512, 256);
    }

    const nebTex = new THREE.CanvasTexture(c);
    nebTex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.SphereGeometry(3200, 24, 16);
    const mat = new THREE.MeshBasicMaterial({
      map: nebTex,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    });
    this.root.add(new THREE.Mesh(geo, mat));
  }

  _buildPlanetAcheronIV() {
    this.planetGroup = new THREE.Group();
    this.planetGroup.position.set(-420, -140, -1100);
    this.root.add(this.planetGroup);

    const sunDir = new THREE.Vector3(0.79, 0.47, -0.39).normalize();
    const pUniforms = {
      uTime: { value: 0 },
      uSunDir: { value: sunDir }
    };
    this.shaderUniforms.push(pUniforms);

    const planetMat = new THREE.ShaderMaterial({
      uniforms: pUniforms,
      fog: false,
      vertexShader: `
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        varying vec3 vLocalPos;
        void main() {
          vLocalPos = normalize(position);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uSunDir;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        varying vec3 vLocalPos;

        // Fast analytic gas-giant storm turbulence (15x faster than 10-octave 3D hash FBM)
        float stormWave(vec3 p) {
          float w = sin(p.x * 3.1 + sin(p.z * 2.7 + p.y * 4.2)) * 0.5;
          w += cos(p.z * 5.3 - sin(p.x * 4.6 - p.y * 6.1)) * 0.3;
          w += sin((p.x + p.z) * 8.4 + p.y * 9.5) * 0.2;
          return 0.5 + 0.5 * w;
        }

        void main() {
          vec3 N = normalize(vWorldNormal);
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 L = normalize(uSunDir);

          vec3 p = vLocalPos;
          float turb = stormWave(p * 1.6 + vec3(uTime * 0.012, 0.0, 0.0));
          float vortex = stormWave(p * 3.2 + vec3(turb * 1.1));
          float lat = p.y * 15.0 + turb * 3.4 + vortex * 1.2;
          float bandA = 0.5 + 0.5 * sin(lat);
          float bandB = 0.5 + 0.5 * cos(lat * 1.85 - turb * 3.6);

          vec3 colAbyss = vec3(0.03, 0.08, 0.16);
          vec3 colSlate = vec3(0.14, 0.30, 0.45);
          vec3 colCyan  = vec3(0.38, 0.68, 0.86);
          vec3 colOchre = vec3(0.68, 0.52, 0.38);

          vec3 albedo = mix(colAbyss, colSlate, bandA);
          albedo = mix(albedo, colCyan, smoothstep(0.35, 0.85, bandB) * 0.72);
          albedo = mix(albedo, colOchre, smoothstep(0.58, 0.9, vortex) * 0.45);

          float ndotl = dot(N, L);
          float diff = smoothstep(-0.14, 0.85, ndotl);
          vec3 twilight = vec3(0.05, 0.24, 0.48) * smoothstep(-0.28, 0.15, ndotl) * (1.0 - smoothstep(0.0, 0.42, ndotl));

          float I_rim = pow(1.0 - max(0.0, dot(N, V)), 3.8) * max(0.15, dot(N, L) + 0.45);
          vec3 rimGlow = vec3(0.26, 0.78, 1.0) * I_rim * 2.35;

          vec3 color = albedo * (diff * 1.18 + 0.015) + twilight + rimGlow;
          gl_FragColor = vec4(color, 1.0);
        }
      `
    });

    this.planetMesh = new THREE.Mesh(new THREE.SphereGeometry(460, 48, 32), planetMat);
    this.planetGroup.add(this.planetMesh);

    const haloMat = new THREE.ShaderMaterial({
      uniforms: pUniforms,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDir;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
          vec3 N = normalize(vNormal);
          vec3 V = normalize(cameraPosition - vWorldPos);
          // BackSide sphere (R=498 around R=460): dot(-N, V) is 0 at outer edge and ~0.38 at planet limb
          float edgeFade = pow(clamp(dot(-N, V) / 0.42, 0.0, 1.0), 3.4);
          float sunLit = 0.08 + 0.92 * smoothstep(-0.35, 0.65, dot(N, normalize(uSunDir)));
          vec3 col = vec3(0.22, 0.76, 1.0) * edgeFade * sunLit * 1.45;
          gl_FragColor = vec4(col, edgeFade * sunLit * 0.85);
        }
      `
    });
    this.planetGroup.add(new THREE.Mesh(new THREE.SphereGeometry(498, 56, 40), haloMat));

    const ringGeo = new THREE.RingGeometry(565, 880, 128);
    const ringMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: sunDir },
        uPlanetCenter: { value: this.planetGroup.position }
      },
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying vec3 vLocalPos;
        varying vec3 vWorldPos;
        void main() {
          vLocalPos = position;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDir;
        uniform vec3 uPlanetCenter;
        varying vec3 vLocalPos;
        varying vec3 vWorldPos;
        void main() {
          float r = length(vLocalPos.xy);
          float t = clamp((r - 565.0) / (880.0 - 565.0), 0.0, 1.0);
          float bands = 0.5 + 0.5 * sin(t * 78.0) * cos(t * 29.0);
          float cassini = smoothstep(0.03, 0.09, abs(t - 0.58));
          float edgeFade = smoothstep(0.0, 0.1, t) * smoothstep(1.0, 0.86, t);

          vec3 rel = vWorldPos - uPlanetCenter;
          vec3 L = normalize(uSunDir);
          float proj = dot(rel, L);
          float perpDist = length(rel - L * proj);
          float shadow = proj < 0.0 ? smoothstep(435.0, 475.0, perpDist) : 1.0;

          vec3 col = mix(vec3(0.25, 0.42, 0.58), vec3(0.62, 0.78, 0.92), bands) * (0.2 + 0.8 * shadow);
          float alpha = (0.14 + 0.34 * bands) * cassini * edgeFade;
          gl_FragColor = vec4(col, alpha);
        }
      `
    });
    this.ringMesh = new THREE.Mesh(ringGeo, ringMat);
    this.ringMesh.rotation.set(1.22, 0.28, -0.35);
    this.planetGroup.add(this.ringMesh);
  }

  _addHullPart(parent, sx, sy, sz, x, y, z, mat, rx = 0, ry = 0, rz = 0, addCollider = false) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    mesh.position.set(x, y, z);
    if (rx || ry || rz) mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    if (addCollider) {
      this.ctx.colliders.exteriorHullAABBs.push(
        new THREE.Box3(
          new THREE.Vector3(x - sx * 0.5, y - sy * 0.5, z - sz * 0.5),
          new THREE.Vector3(x + sx * 0.5, y + sy * 0.5, z + sz * 0.5)
        )
      );
    }
    return mesh;
  }

  _addStrobe(parent, x, y, z, phase = 0) {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), this.materials.strobeRed.clone());
    bulb.position.set(x, y, z);
    parent.add(bulb);

    const spriteMat = new THREE.SpriteMaterial({
      map: this.textures.glowSprite,
      color: 0xff2222,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(1.6, 1.6, 1);
    bulb.add(sprite);
    this.navStrobes.push({ bulb, sprite, phase });
  }

  _buildExteriorStationHull() {
    const hull = new THREE.Group();
    hull.name = 'STATION_EXTERIOR_HULL';
    this.root.add(hull);
    const M = this.materials;
    const aabbs = this.ctx.colliders.exteriorHullAABBs;

    // 1. Command Bridge Exterior Armor (Z: -16.9..-5.5, keeping viewport Z=-16 X[-5.2,5.2] Y[0.6,3.8] unobstructed)
    this._addHullPart(hull, 13.6, 0.7, 11.4, 0, 4.7, -11.2, M.hullLarge);
    this._addHullPart(hull, 13.6, 0.8, 11.4, 0, -0.58, -11.2, M.hullDark);
    this._addHullPart(hull, 0.75, 5.5, 11.4, -6.58, 2.05, -11.2, M.hullLarge);
    this._addHullPart(hull, 0.75, 5.5, 11.4, 6.58, 2.05, -11.2, M.hullLarge);
    // Viewport upper brow, lower chin, and side mullions strictly outside Z=-16.0 (back face at Z=-16.20)
    this._addHullPart(hull, 13.2, 0.58, 0.7, 0, 4.22, -16.55, M.hazard);
    this._addHullPart(hull, 13.2, 0.68, 0.7, 0, 0.14, -16.55, M.hazard);
    this._addHullPart(hull, 1.15, 4.6, 0.7, -6.02, 2.18, -16.55, M.hullDark);
    this._addHullPart(hull, 1.15, 4.6, 0.7, 6.02, 2.18, -16.55, M.hullDark);
    // Glowing exterior attitude vernier strips along Bridge flanks
    this._addHullPart(hull, 0.14, 0.22, 6.5, -7.0, 3.6, -11.0, M.cyanEmissive);
    this._addHullPart(hull, 0.14, 0.22, 6.5, 7.0, 3.6, -11.0, M.cyanEmissive);
    // Bridge aft collar transitions to corridor (strictly aft of Z=-6.0)
    this._addHullPart(hull, 3.4, 5.2, 0.55, -4.95, 2.05, -5.6, M.hullDark);
    this._addHullPart(hull, 3.4, 5.2, 0.55, 4.95, 2.05, -5.6, M.hullDark);

    aabbs.push(
      new THREE.Box3(new THREE.Vector3(-7.0, -1.0, -16.9), new THREE.Vector3(7.0, 5.1, -5.5))
    );

    // 2. Mess Hall & Storage Pod Exterior (X: -12.4..-3.15, Y: -0.78..4.4, Z: -5.25..4.25)
    this._addHullPart(hull, 9.25, 0.65, 9.5, -7.75, 4.08, -0.5, M.hullLarge);
    this._addHullPart(hull, 9.25, 0.65, 9.5, -7.75, -0.48, -0.5, M.hullDark);
    this._addHullPart(hull, 0.7, 4.9, 9.5, -12.08, 1.8, -0.5, M.hullLarge);
    this._addHullPart(hull, 9.25, 4.9, 0.6, -7.75, 1.8, -4.95, M.hullLarge);
    this._addHullPart(hull, 9.25, 4.9, 0.6, -7.75, 1.8, 3.95, M.hullLarge);
    this._addHullPart(hull, 0.3, 1.1, 6.4, -12.48, 1.8, -0.5, M.hazard);
    aabbs.push(
      new THREE.Box3(new THREE.Vector3(-12.6, -0.85, -5.25), new THREE.Vector3(-3.15, 4.45, 4.25))
    );

    // 3. Maintenance Corridor Spine (X: -3.75..3.75, Y: -1.95..4.35, Z: -5.8..11.0)
    this._addHullPart(hull, 7.4, 0.6, 17.0, 0, 4.08, 2.6, M.hullLarge);
    this._addHullPart(hull, 7.4, 0.6, 17.0, 0, -1.68, 2.6, M.hullDark);
    this._addHullPart(hull, 0.6, 5.9, 17.0, 3.48, 1.2, 2.6, M.hullLarge);
    this._addHullPart(hull, 0.6, 5.9, 7.1, -3.48, 1.2, 7.45, M.hullLarge);
    this._addHullPart(hull, 0.6, 5.9, 1.2, -3.48, 1.2, -5.3, M.hullLarge);

    // Exterior Structural Ribs & Pressurized Coolant Tanks along Corridor
    for (let z = -4.5; z <= 10.5; z += 3.0) {
      this._addHullPart(hull, 7.9, 0.45, 0.45, 0, 4.35, z, M.trussSteel);
      this._addHullPart(hull, 0.45, 6.2, 0.45, 3.85, 1.2, z, M.trussSteel);
      if (z > 4.0) this._addHullPart(hull, 0.45, 6.2, 0.45, -3.85, 1.2, z, M.trussSteel);
    }
    const tankGeo = new THREE.CylinderGeometry(0.62, 0.62, 7.5, 16);
    tankGeo.rotateX(Math.PI * 0.5);
    for (const ty of [0.6, 2.3]) {
      const tank = new THREE.Mesh(tankGeo, M.hullDark);
      tank.position.set(4.35, ty, 3.0);
      tank.castShadow = true;
      hull.add(tank);
    }
    aabbs.push(
      new THREE.Box3(new THREE.Vector3(-4.1, -2.0, -5.8), new THREE.Vector3(4.9, 4.6, 10.9))
    );

    // 4. Airlock Exterior Module & Docking Collar (Z: 11.0..16.7)
    // CRITICAL: Keep Airlock opening X[-2.4,2.4], Y[-0.05,3.15], Z[11.0,17.8] unobstructed!
    this._addHullPart(hull, 6.2, 0.6, 5.8, 0, 3.55, 13.8, M.hullLarge, 0, 0, 0, true);
    this._addHullPart(hull, 6.2, 0.6, 5.8, 0, -0.45, 13.8, M.hullDark, 0, 0, 0, true);
    this._addHullPart(hull, 0.6, 4.2, 5.8, -2.85, 1.55, 13.8, M.hullLarge, 0, 0, 0, true);
    this._addHullPart(hull, 0.6, 4.2, 5.8, 2.85, 1.55, 13.8, M.hullLarge, 0, 0, 0, true);

    // Hazard-Striped EVA Docking Frame around Z = +16.55 opening
    this._addHullPart(hull, 6.6, 0.55, 0.5, 0, 3.52, 16.55, M.hazard);
    this._addHullPart(hull, 6.6, 0.55, 0.5, 0, -0.38, 16.55, M.hazard);
    this._addHullPart(hull, 0.55, 4.3, 0.5, -2.82, 1.55, 16.55, M.hazard);
    this._addHullPart(hull, 0.55, 4.3, 0.5, 2.82, 1.55, 16.55, M.hazard);

    // LowerEVA Landing Apron & Floodlight Bars outside Airlock
    this._addHullPart(hull, 5.8, 0.25, 2.0, 0, -0.35, 17.5, M.trussSteel);
    this._addHullPart(hull, 3.6, 0.14, 0.18, 0, 3.55, 16.82, M.cyanEmissive);
    this._addHullPart(hull, 0.14, 2.8, 0.18, -2.75, 1.55, 16.82, M.amberEmissive);
    this._addHullPart(hull, 0.14, 2.8, 0.18, 2.75, 1.55, 16.82, M.amberEmissive);

    // 5. Communications Dish Tower on Dorsal Bridge/Corridor Spine (pos: 2.8, 5.0, -8.5)
    this._addHullPart(hull, 1.2, 4.8, 1.2, 2.8, 7.2, -8.5, M.trussSteel, 0, 0, 0, true);
    this._addHullPart(hull, 2.6, 0.3, 0.3, 2.8, 8.6, -8.5, M.trussSteel);
    this.commsDish = new THREE.Group();
    this.commsDish.position.set(2.8, 9.7, -8.5);
    const dishMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(2.3, 0.45, 0.85, 24, 1, true),
      M.radiator
    );
    dishMesh.rotation.x = Math.PI * 0.32;
    this.commsDish.add(dishMesh);
    const feedHorn = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.7, 8), M.trussSteel);
    feedHorn.rotation.x = Math.PI * 0.32;
    feedHorn.position.set(0, 0.45, 0.7);
    this.commsDish.add(feedHorn);
    hull.add(this.commsDish);
    this._addStrobe(hull, 2.8, 11.3, -8.5, 0.0);

    // 6. Twin Photovoltaic Solar Wing Arrays extending to X = ±32m (at Z = 2.0, Y = 2.2)
    // Port Wing (attaches outside Mess Hall at X = -12.3 to -32.5)
    this._addHullPart(hull, 20.5, 0.38, 0.45, -22.4, 2.2, 2.0, M.trussSteel, 0, 0, 0, true);
    for (const pz of [-0.45, 4.45]) {
      this._addHullPart(hull, 18.6, 0.1, 3.8, -22.6, 2.2, pz, M.solar, 0.18, 0, 0);
    }
    aabbs.push(new THREE.Box3(new THREE.Vector3(-32.4, 1.5, -2.4), new THREE.Vector3(-12.6, 2.9, 6.4)));
    this._addStrobe(hull, -32.6, 2.5, 2.0, 0.25);

    // Starboard Wing (attaches outside Corridor at X = +4.2 to +32.5)
    this._addHullPart(hull, 28.3, 0.38, 0.45, 18.3, 2.2, 2.0, M.trussSteel, 0, 0, 0, true);
    for (const pz of [-0.45, 4.45]) {
      this._addHullPart(hull, 26.2, 0.1, 3.8, 18.5, 2.2, pz, M.solar, 0.18, 0, 0);
    }
    aabbs.push(new THREE.Box3(new THREE.Vector3(4.9, 1.5, -2.4), new THREE.Vector3(32.4, 2.9, 6.4)));
    this._addStrobe(hull, 32.5, 2.5, 2.0, 0.62);

    // 7. Dorsal & Ventral Thermal Radiator Fin Arrays
    for (const z of [-2.0, 4.5, 9.0]) {
      this._addHullPart(hull, 0.16, 3.4, 3.8, -1.8, 6.0, z, M.radiator);
      this._addHullPart(hull, 0.16, 3.4, 3.8, 1.8, 6.0, z, M.radiator);
      this._addHullPart(hull, 0.16, 2.6, 3.2, 0.0, -3.1, z, M.radiator);
    }

    // 8. Damaged Docking Truss Superstructure extending into EVA Zone (Z: +16.5m to +75m)
    // Main port-lower truss spine (X = -5.8, Y = -1.6, Z = 16.5..48.5)
    this._addHullPart(hull, 1.1, 1.1, 32.0, -5.8, -1.6, 32.5, M.trussSteel, 0, 0, 0, true);
    for (const [ox, oy] of [[-1.05, -1.05], [1.05, -1.05], [-1.05, 1.05], [1.05, 1.05]]) {
      this._addHullPart(hull, 0.18, 0.18, 32.0, -5.8 + ox, -1.6 + oy, 32.5, M.hullDark);
    }
    for (let z = 19.0; z <= 47.0; z += 4.0) {
      this._addHullPart(hull, 2.45, 2.45, 0.32, -5.8, -1.6, z, M.hazard);
      this._addHullPart(hull, 0.16, 0.16, 2.2, -4.68, -0.55, z, M.cyanEmissive);
    }
    this._addStrobe(hull, -4.6, -0.35, 32.0, 0.12);
    this._addStrobe(hull, -4.6, -0.35, 48.0, 0.48);

    // Fractured outer docking boom (Z = 50.5..75.0, tilted off-axis from orbital impact)
    const brokenTruss = new THREE.Group();
    brokenTruss.position.set(-7.4, -3.2, 62.5);
    brokenTruss.rotation.set(0.11, -0.14, 0.22);
    hull.add(brokenTruss);
    this._addHullPart(brokenTruss, 1.1, 1.1, 24.0, 0, 0, 0, M.trussSteel);
    for (const [ox, oy] of [[-0.95, -0.95], [0.95, -0.95], [-0.95, 0.95], [0.95, 0.95]]) {
      this._addHullPart(brokenTruss, 0.16, 0.16, 24.0, ox, oy, 0, M.hullDark);
    }
    for (let lz = -9.0; lz <= 9.0; lz += 4.5) {
      this._addHullPart(brokenTruss, 2.3, 2.3, 0.35, 0, 0, lz, M.hazard);
    }
    this._addStrobe(brokenTruss, 0, 1.35, 11.5, 0.78);
    aabbs.push(new THREE.Box3(new THREE.Vector3(-10.2, -5.5, 50.0), new THREE.Vector3(-4.6, -0.8, 75.0)));

    // Secondary Starboard Upper Docking Arm Stub (X = +5.6, Y = +3.4, Z = 16.5..29.5)
    this._addHullPart(hull, 1.1, 1.1, 13.0, 5.6, 3.4, 23.0, M.trussSteel, 0, 0, 0, true);
    this._addHullPart(hull, 2.0, 2.0, 0.4, 5.6, 3.4, 29.2, M.hazard);
    this._addStrobe(hull, 5.6, 4.6, 29.3, 0.9);

    // 9. Floating Hull Debris Field around broken truss (excluding Airlock exit & EVA preset camera)
    const debrisGeo = new THREE.DodecahedronGeometry(0.45, 0);
    const evaPresetCam = new THREE.Vector3(8.5, 4.2, 34.0);
    for (let i = 0; i < 24; i++) {
      let dx = -18 + ((i * 19) % 36);
      let dy = -9 + ((i * 11) % 22);
      let dz = 20 + ((i * 23) % 62);
      if (Math.abs(dx) < 3.6 && dy > -1.0 && dy < 4.0 && dz < 22.0) dx -= 6.5;
      const candidate = new THREE.Vector3(dx, dy, dz);
      if (candidate.distanceTo(evaPresetCam) < 5.0) candidate.x -= 6.0;

      const m = new THREE.Mesh(debrisGeo, i % 3 === 0 ? M.hazard : M.hullDark);
      m.scale.set(0.5 + (i % 4) * 0.45, 0.25 + (i % 3) * 0.2, 0.7 + (i % 5) * 0.35);
      m.position.copy(candidate);
      m.rotation.set(i * 0.7, i * 1.3, i * 0.4);
      hull.add(m);
      this.debris.push({
        mesh: m,
        rotVel: new THREE.Vector3((i % 3 - 1) * 0.35, ((i + 1) % 3 - 1) * 0.28, 0.18)
      });
    }
  }

  spawnCargoPods(count = 10) {
    for (const p of this.pods) {
      if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
    }
    this.pods = [];
    if (!Array.isArray(this.ctx.interactables)) this.ctx.interactables = [];
    if (!Array.isArray(this.ctx.radarTargets)) this.ctx.radarTargets = [];
    for (let i = this.ctx.interactables.length - 1; i >= 0; i--) {
      if (this.ctx.interactables[i].type === 'POD') this.ctx.interactables.splice(i, 1);
    }
    for (let i = this.ctx.radarTargets.length - 1; i >= 0; i--) {
      if (this.ctx.radarTargets[i].type === 'POD') this.ctx.radarTargets.splice(i, 1);
    }

    const layout = [
      new THREE.Vector3(3.5, 2.4, 23.0),
      new THREE.Vector3(-2.5, 5.2, 22.5),
      new THREE.Vector3(6.8, 1.2, 25.8),
      new THREE.Vector3(11.2, 6.0, 24.2),
      new THREE.Vector3(-11.5, -2.5, 36.0),
      new THREE.Vector3(14.5, 8.5, 44.0),
      new THREE.Vector3(-19.0, 10.5, 52.0),
      new THREE.Vector3(4.0, -7.5, 58.0),
      new THREE.Vector3(-28.0, 3.5, 70.0),
      new THREE.Vector3(22.0, -11.0, 82.0)
    ];

    const bodyGeo = new THREE.CylinderGeometry(0.58, 0.58, 1.55, 8);
    const capGeo = new THREE.CylinderGeometry(0.63, 0.63, 0.24, 8);
    const railGeo = new THREE.BoxGeometry(0.08, 1.65, 0.08);
    const stripGeo = new THREE.BoxGeometry(0.12, 0.95, 0.04);
    const bulbGeo = new THREE.SphereGeometry(0.13, 12, 10);

    for (let i = 0; i < count; i++) {
      const id = `POD_${i}`;
      const basePos = (layout[i] || new THREE.Vector3((i - 5) * 6, (i % 3 - 1) * 5, 28 + i * 6)).clone();
      const group = new THREE.Group();
      group.name = id;
      group.position.copy(basePos);
      group.rotation.set(i * 0.55, i * 1.1, i * 0.35);

      const body = new THREE.Mesh(bodyGeo, this.materials.hullLarge);
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      const topCap = new THREE.Mesh(capGeo, this.materials.hazard);
      topCap.position.y = 0.82;
      group.add(topCap);

      const botCap = new THREE.Mesh(capGeo, this.materials.hazard);
      botCap.position.y = -0.82;
      group.add(botCap);

      const stripMat = this.materials.cyanEmissive.clone();
      for (let a = 0; a < 4; a++) {
        const ang = a * Math.PI * 0.5;
        const rail = new THREE.Mesh(railGeo, this.materials.trussSteel);
        rail.position.set(Math.cos(ang) * 0.65, 0, Math.sin(ang) * 0.65);
        group.add(rail);

        const strip = new THREE.Mesh(stripGeo, stripMat);
        strip.position.set(Math.cos(ang + 0.39) * 0.58, 0, Math.sin(ang + 0.39) * 0.58);
        strip.rotation.y = -(ang + 0.39) + Math.PI * 0.5;
        group.add(strip);
      }

      const beaconMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
      const beaconBulb = new THREE.Mesh(bulbGeo, beaconMat);
      beaconBulb.position.y = 1.04;
      group.add(beaconBulb);

      const flareMat = new THREE.SpriteMaterial({
        map: this.textures.glowSprite,
        color: 0x38bdf8,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const flare = new THREE.Sprite(flareMat);
      flare.scale.set(2.8, 2.8, 1);
      beaconBulb.add(flare);

      const pointLight = null; // Emissive strips + additive flare sprite avoid extra forward-lit PointLights

      this.root.add(group);

      const podRecord = {
        id,
        mesh: group,
        basePos,
        phase: i * 1.37,
        rotVel: new THREE.Vector3(0.24 * (i % 2 ? 1 : -1), 0.36, 0.17 * (i % 3 - 1)),
        harvested: false,
        stripMat,
        beaconMat,
        flare,
        pointLight,
        interactable: null,
        radarTarget: null
      };

      const interactable = {
        id,
        type: 'POD',
        label: 'HARVEST SUPPLY POD',
        position: group.position,
        radius: 3.6,
        holdDuration: 1.5,
        canInteract: () => !podRecord.harvested,
        onInteract: () => this.harvestPod(id)
      };
      const radarTarget = {
        id,
        type: 'POD',
        position: group.position,
        active: true
      };

      podRecord.interactable = interactable;
      podRecord.radarTarget = radarTarget;
      this.pods.push(podRecord);
      this.ctx.interactables.push(interactable);
      this.ctx.radarTargets.push(radarTarget);
    }
  }

  harvestPod(podId) {
    const pod = this.pods.find(p => p.id === podId);
    if (!pod || pod.harvested) return;

    pod.harvested = true;
    pod.radarTarget.active = false;
    pod.stripMat.emissive.setHex(0x101820);
    pod.stripMat.emissiveIntensity = 0.1;
    pod.stripMat.color.setHex(0x283240);
    pod.beaconMat.color.setHex(0x1f2937);
    pod.flare.visible = false;
    if (pod.pointLight) pod.pointLight.intensity = 0;

    this._spawnHarvestParticles(pod.mesh.position.clone());

    if (this.ctx.events) {
      this.ctx.events.emit('POD_HARVESTED', {
        podId: pod.id,
        o2Gain: 35,
        foodGain: 40,
        relayGain: 1,
        position: pod.mesh.position.clone()
      });
    }
  }

  _spawnHarvestParticles(origin) {
    const count = 72;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = [];
    const sparkPalette = [
      new THREE.Color(0x38bdf8),
      new THREE.Color(0xe0f2fe),
      new THREE.Color(0xf59e0b)
    ];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = origin.x;
      positions[i * 3 + 1] = origin.y;
      positions[i * 3 + 2] = origin.z;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 2.0 + Math.random() * 5.2;
      velocities.push(new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.cos(phi) * speed,
        Math.sin(phi) * Math.sin(theta) * speed
      ));
      const c = sparkPalette[i % sparkPalette.length];
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      map: this.textures.glowSprite,
      vertexColors: true,
      size: 0.58,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false
    });
    const points = new THREE.Points(geo, mat);
    this.root.add(points);
    this.burstSystems.push({ points, velocities, age: 0, maxAge: 1.3 });
  }

  update(dt, elapsed) {
    const safeDt = Math.min(Math.max(dt || 0, 0), 0.1);
    for (const u of this.shaderUniforms) {
      if (u.uTime) u.uTime.value = elapsed;
    }

    if (this.planetMesh) this.planetMesh.rotation.y = elapsed * 0.008;
    if (this.ringMesh) this.ringMesh.rotation.z = -0.35 + elapsed * 0.003;
    if (this.commsDish) this.commsDish.rotation.y = Math.sin(elapsed * 0.35) * 0.45;

    for (const d of this.debris) {
      d.mesh.rotation.x += d.rotVel.x * safeDt;
      d.mesh.rotation.y += d.rotVel.y * safeDt;
      d.mesh.rotation.z += d.rotVel.z * safeDt;
    }

    for (const s of this.navStrobes) {
      const cyc = (elapsed * 0.85 + s.phase) % 1.0;
      const pulse = (cyc < 0.08 || (cyc > 0.16 && cyc < 0.24)) ? 1.0 : 0.08;
      s.sprite.material.opacity = pulse;
      s.bulb.scale.setScalar(0.85 + 0.35 * pulse);
    }

    for (const pod of this.pods) {
      const rotScale = pod.harvested ? 0.35 : 1.0;
      pod.mesh.rotation.x += pod.rotVel.x * safeDt * rotScale;
      pod.mesh.rotation.y += pod.rotVel.y * safeDt * rotScale;
      pod.mesh.rotation.z += pod.rotVel.z * safeDt * rotScale;

      if (!pod.harvested) {
        pod.mesh.position.x = pod.basePos.x + Math.sin(elapsed * 0.48 + pod.phase) * 0.42;
        pod.mesh.position.y = pod.basePos.y + Math.cos(elapsed * 0.56 + pod.phase) * 0.38;
        pod.mesh.position.z = pod.basePos.z + Math.sin(elapsed * 0.37 + pod.phase * 1.3) * 0.32;

        const blink = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(elapsed * 5.2 + pod.phase), 3.0);
        pod.flare.material.opacity = blink;
        const s = 1.9 + blink * 1.4;
        pod.flare.scale.set(s, s, 1);
        if (pod.pointLight) pod.pointLight.intensity = 2.0 + blink * 4.5;
      }
    }

    for (let i = this.burstSystems.length - 1; i >= 0; i--) {
      const b = this.burstSystems[i];
      b.age += safeDt;
      if (b.age >= b.maxAge) {
        this.root.remove(b.points);
        b.points.geometry.dispose();
        b.points.material.dispose();
        this.burstSystems.splice(i, 1);
        continue;
      }
      const drag = Math.exp(-1.8 * safeDt);
      const posAttr = b.points.geometry.attributes.position;
      for (let j = 0; j < b.velocities.length; j++) {
        const v = b.velocities[j];
        v.multiplyScalar(drag);
        posAttr.array[j * 3] += v.x * safeDt;
        posAttr.array[j * 3 + 1] += v.y * safeDt;
        posAttr.array[j * 3 + 2] += v.z * safeDt;
      }
      posAttr.needsUpdate = true;
      b.points.material.opacity = 1.0 - b.age / b.maxAge;
    }
  }
}
