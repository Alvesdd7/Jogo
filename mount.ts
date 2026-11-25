import * as THREE from "three";
import { createAudio } from "@/game/audio";
import {
  BLOCKS,
  STREET,
  type InputState,
  type Sim,
  activeCops,
  begin,
  createSim,
  streetPos,
  tick,
} from "@/game/sim";

export type HudSnapshot = {
  phase: Sim["phase"];
  cash: number;
  heat: number;
  bags: number;
  need: number;
  best: number;
  speed: number;
  pop: string;
  level: number;
  bestLevel: number;
  nitro: number;
  boosting: boolean;
  time: number;
  near: number;
  wrecks: number;
  bonus: number;
  cops: number;
};

export type GameApi = {
  unlock: () => void;
  start: () => void;
  pause: () => void;
  retry: () => void;
  next: () => void;
  restart: () => void;
  toggleMute: () => boolean;
};

const GAME_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "ShiftLeft",
  "ShiftRight",
  "KeyE",
  "Escape",
]);

type Hooks = {
  input: InputState;
  api: { current: GameApi | null };
  pendingStart: { current: boolean };
  onHud: (hud: HudSnapshot) => void;
  vignette: HTMLDivElement;
  flash: HTMLDivElement;
  radar: HTMLCanvasElement;
  pop: HTMLDivElement;
  arrow: HTMLDivElement;
  reduced: boolean;
};

export function mount(root: HTMLDivElement, hooks: Hooks): () => void {
  const sim = createSim();
  const input = hooks.input;
  const audio = createAudio();
  const reduced = hooks.reduced;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setSize(root.clientWidth || 1, root.clientHeight || 1);
  renderer.setClearColor(0x10131a);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10131a);
  scene.fog = new THREE.FogExp2(0x10131a, 0.02);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 180);
  camera.position.set(0, 18, 22);

  scene.add(new THREE.HemisphereLight(0x8ea0b8, 0x2a2118, 0.72));
  const moon = new THREE.DirectionalLight(0xd5deea, 1.15);
  moon.position.set(-18, 32, 12);
  scene.add(moon);

  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(resource: T) => {
    disposables.push(resource);
    return resource;
  };

  const dummy = new THREE.Object3D();
  const asphalt = track(
    new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.92, metalness: 0.04 }),
  );
  const sidewalkMat = track(
    new THREE.MeshStandardMaterial({ color: 0x171a21, roughness: 0.96, metalness: 0 }),
  );
  const buildingMat = track(
    new THREE.MeshStandardMaterial({ color: 0x161922, roughness: 0.86, metalness: 0.08 }),
  );
  const dashMat = track(new THREE.MeshBasicMaterial({ color: 0x6a5830 }));
  const warmMat = track(
    new THREE.MeshBasicMaterial({ color: 0xe4c36a }),
  );
  const coolWin = track(new THREE.MeshBasicMaterial({ color: 0xf2efe6 }));
  const neonMat = track(new THREE.MeshBasicMaterial({ color: 0xe23b3b }));

  const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(150, 150)), asphalt);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const box = track(new THREE.BoxGeometry(1, 1, 1));

  const roadCount = (BLOCKS + 1) * 2;
  const roads = new THREE.InstancedMesh(box, asphalt, roadCount);
  const span = streetPos(BLOCKS) - streetPos(0) + 18;
  let roadIndex = 0;
  for (let i = 0; i <= BLOCKS; i++) {
    const p = streetPos(i);
    dummy.position.set(0, 0.025, p);
    dummy.scale.set(span, 0.05, STREET);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    roads.setMatrixAt(roadIndex++, dummy.matrix);
    dummy.position.set(p, 0.025, 0);
    dummy.scale.set(STREET, 0.05, span);
    dummy.updateMatrix();
    roads.setMatrixAt(roadIndex++, dummy.matrix);
  }
  roads.instanceMatrix.needsUpdate = true;
  scene.add(roads);

  const pads = new THREE.InstancedMesh(box, sidewalkMat, sim.buildings.length);
  sim.buildings.forEach((b, i) => {
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    dummy.position.set((b.minX + b.maxX) / 2, 0.05, (b.minZ + b.maxZ) / 2);
    dummy.scale.set(w + 2.2, 0.08, d + 2.2);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    pads.setMatrixAt(i, dummy.matrix);
  });
  pads.instanceMatrix.needsUpdate = true;
  scene.add(pads);

  const blocks = new THREE.InstancedMesh(box, buildingMat, sim.buildings.length);
  sim.buildings.forEach((b, i) => {
    dummy.position.set((b.minX + b.maxX) / 2, b.h / 2 + 0.08, (b.minZ + b.maxZ) / 2);
    dummy.scale.set(b.maxX - b.minX, b.h, b.maxZ - b.minZ);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    blocks.setMatrixAt(i, dummy.matrix);
  });
  blocks.instanceMatrix.needsUpdate = true;
  scene.add(blocks);

  type Win = { x: number; y: number; z: number; sx: number; sy: number; sz: number; warm: boolean };
  const wins: Win[] = [];
  const neons: Array<{ x: number; y: number; z: number; h: number }> = [];
  for (const b of sim.buildings) {
    const base = 0.08;
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const floors = Math.min(4, Math.max(1, Math.floor((b.h - 1.4) / 2.5)));
    const colsX = Math.min(4, Math.max(2, Math.floor(w / 3.2)));
    const colsZ = Math.min(4, Math.max(2, Math.floor(d / 3.2)));
    for (let f = 0; f < floors; f++) {
      const y = base + 1.5 + f * 2.45;
      if (y > b.h - 0.4) break;
      for (let c = 0; c < colsX; c++) {
        const x = b.minX + (w * (c + 1)) / (colsX + 1);
        const warm = (f + c) % 4 !== 0;
        wins.push({ x, y, z: b.minZ - 0.05, sx: 0.72, sy: 1.05, sz: 0.08, warm });
        wins.push({ x, y, z: b.maxZ + 0.05, sx: 0.72, sy: 1.05, sz: 0.08, warm });
      }
      for (let c = 0; c < colsZ; c++) {
        const z = b.minZ + (d * (c + 1)) / (colsZ + 1);
        const warm = (f + c) % 5 !== 0;
        wins.push({ x: b.minX - 0.05, y, z, sx: 0.08, sy: 1.05, sz: 0.72, warm });
        wins.push({ x: b.maxX + 0.05, y, z, sx: 0.08, sy: 1.05, sz: 0.72, warm });
      }
    }
    if (b.neon) {
      neons.push({
        x: b.minX + 0.4,
        y: base + b.h * 0.45,
        z: b.minZ + 0.4,
        h: b.h * 0.7,
      });
    }
  }

  const warmWins = wins.filter((w) => w.warm);
  const coolWins = wins.filter((w) => !w.warm);
  const paintWins = (list: Win[], mat: THREE.Material) => {
    if (list.length === 0) return;
    const mesh = new THREE.InstancedMesh(box, mat, list.length);
    list.forEach((w, i) => {
      dummy.position.set(w.x, w.y, w.z);
      dummy.scale.set(w.sx, w.sy, w.sz);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  };
  paintWins(warmWins, warmMat);
  paintWins(coolWins, coolWin);

  if (neons.length) {
    const neonMesh = new THREE.InstancedMesh(box, neonMat, neons.length);
    neons.forEach((n, i) => {
      dummy.position.set(n.x, n.y, n.z);
      dummy.scale.set(0.18, n.h, 0.18);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      neonMesh.setMatrixAt(i, dummy.matrix);
    });
    neonMesh.instanceMatrix.needsUpdate = true;
    scene.add(neonMesh);
  }

  const dashes: Array<[number, number, number]> = [];
  for (let i = 0; i <= BLOCKS; i++) {
    const fixed = streetPos(i);
    for (let t = streetPos(0) + 6; t < streetPos(BLOCKS) - 4; t += 4.2) {
      let near = false;
      for (let k = 0; k <= BLOCKS; k++) {
        if (Math.abs(t - streetPos(k)) < 5) near = true;
      }
      if (near) continue;
      dashes.push([t, fixed, 0]);
      dashes.push([fixed, t, 1]);
    }
  }
  const dashMesh = new THREE.InstancedMesh(box, dashMat, Math.max(1, dashes.length));
  dashes.forEach(([x, z, dir], i) => {
    dummy.position.set(x, 0.06, z);
    dummy.scale.set(dir === 0 ? 1.5 : 0.14, 0.03, dir === 0 ? 0.14 : 1.5);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    dashMesh.setMatrixAt(i, dummy.matrix);
  });
  dashMesh.count = dashes.length;
  dashMesh.instanceMatrix.needsUpdate = true;
  scene.add(dashMesh);

  const lampMat = track(new THREE.MeshStandardMaterial({ color: 0x2a2c32, roughness: 0.6, metalness: 0.4 }));
  const lampGlow = track(new THREE.MeshBasicMaterial({ color: 0xe4c36a }));
  const lampCount = (BLOCKS + 1) * (BLOCKS + 1);
  const poles = new THREE.InstancedMesh(box, lampMat, lampCount);
  const heads = new THREE.InstancedMesh(box, lampGlow, lampCount);
  let lamp = 0;
  for (let j = 0; j <= BLOCKS; j++) {
    for (let i = 0; i <= BLOCKS; i++) {
      const x = streetPos(i) + (i === BLOCKS ? -3.2 : 3.2);
      const z = streetPos(j) + (j === BLOCKS ? -3.2 : 3.2);
      dummy.position.set(x, 2.1, z);
      dummy.scale.set(0.12, 4.2, 0.12);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      poles.setMatrixAt(lamp, dummy.matrix);
      dummy.position.set(x, 4.25, z);
      dummy.scale.set(0.45, 0.12, 0.45);
      dummy.updateMatrix();
      heads.setMatrixAt(lamp, dummy.matrix);
      lamp++;
    }
  }
  poles.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  scene.add(poles);
  scene.add(heads);

  const cyl = track(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12));
  cyl.rotateZ(Math.PI / 2);

  function buildCar(bodyColor: number, accent: number, cop: boolean) {
    const group = new THREE.Group();
    const bodyMat = track(
      new THREE.MeshStandardMaterial({
        color: bodyColor,
        roughness: 0.32,
        metalness: 0.72,
      }),
    );
    const glass = track(
      new THREE.MeshStandardMaterial({
        color: 0x10151c,
        roughness: 0.08,
        metalness: 0.85,
        emissive: 0x0c1824,
        emissiveIntensity: 0.4,
      }),
    );
    const trim = track(
      new THREE.MeshStandardMaterial({
        color: accent,
        roughness: 0.4,
        metalness: 0.45,
        emissive: accent,
        emissiveIntensity: cop ? 0.55 : 0.2,
      }),
    );
    const rubber = track(new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.9 }));
    const lampM = track(
      new THREE.MeshBasicMaterial({ color: 0xfff4d4 }),
    );
    const tailM = track(new THREE.MeshBasicMaterial({ color: 0xe23b3b }));
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      group.add(m);
      return m;
    };
    mesh(box, bodyMat, 0, 0.42, 0.05, 1.58, 0.4, 3.35);
    mesh(box, bodyMat, 0, 0.78, -0.18, 1.38, 0.36, 1.65);
    mesh(box, glass, 0, 0.8, 0.42, 1.22, 0.28, 0.62);
    mesh(box, glass, 0, 0.78, -0.85, 1.18, 0.24, 0.4);
    mesh(box, trim, 0, 0.64, 1.52, cop ? 0.95 : 1.15, 0.08, 0.1);
    mesh(box, lampM, -0.5, 0.46, 1.66, 0.32, 0.12, 0.08);
    mesh(box, lampM, 0.5, 0.46, 1.66, 0.32, 0.12, 0.08);
    mesh(box, tailM, -0.52, 0.46, -1.64, 0.3, 0.12, 0.08);
    mesh(box, tailM, 0.52, 0.46, -1.64, 0.3, 0.12, 0.08);
    const wheels: THREE.Mesh[] = [];
    for (const [x, z] of [
      [-0.78, 1.05],
      [0.78, 1.05],
      [-0.78, -1.08],
      [0.78, -1.08],
    ] as const) {
      wheels.push(mesh(cyl, rubber, x, 0.34, z, 1, 1, 1));
    }
    if (cop) mesh(box, trim, 0, 1.08, -0.15, 0.85, 0.12, 0.42);
    return { group, wheels, trim, tailM };
  }

  const player = buildCar(0x14171e, 0xe4c36a, false);
  scene.add(player.group);
  const headA = new THREE.SpotLight(0xfff3d2, 46, 32, Math.PI / 7, 0.45, 1.1);
  const headB = new THREE.SpotLight(0xfff3d2, 46, 32, Math.PI / 7, 0.45, 1.1);
  const targetA = new THREE.Object3D();
  const targetB = new THREE.Object3D();
  headA.position.set(-0.45, 0.55, 1.4);
  headB.position.set(0.45, 0.55, 1.4);
  targetA.position.set(-0.45, 0.15, 14);
  targetB.position.set(0.45, 0.15, 14);
  headA.target = targetA;
  headB.target = targetB;
  player.group.add(headA, headB, targetA, targetB);

  const flameMat = track(new THREE.MeshBasicMaterial({ color: 0x6fd0ff, transparent: true, opacity: 0.9 }));
  const flames = [-0.5, 0.5].map((x) => {
    const f = new THREE.Mesh(box, flameMat);
    f.position.set(x, 0.5, -2.2);
    f.scale.set(0.26, 0.26, 1.2);
    f.visible = false;
    player.group.add(f);
    return f;
  });

  const SKIDS = 160;
  const skidMesh = new THREE.InstancedMesh(
    box,
    track(new THREE.MeshBasicMaterial({ color: 0x07080b, transparent: true, opacity: 0.55 })),
    SKIDS,
  );
  skidMesh.frustumCulled = false;
  dummy.position.set(0, -5, 0);
  dummy.scale.set(0.001, 0.001, 0.001);
  dummy.rotation.set(0, 0, 0);
  dummy.updateMatrix();
  for (let i = 0; i < SKIDS; i++) skidMesh.setMatrixAt(i, dummy.matrix);
  skidMesh.instanceMatrix.needsUpdate = true;
  scene.add(skidMesh);
  let skidIdx = 0;
  let skidCd = 0;
  function laySkid(x: number, z: number, yaw: number) {
    dummy.position.set(x, 0.07, z);
    dummy.scale.set(0.34, 0.02, 1.1);
    dummy.rotation.set(0, yaw, 0);
    dummy.updateMatrix();
    skidMesh.setMatrixAt(skidIdx, dummy.matrix);
    skidIdx = (skidIdx + 1) % SKIDS;
    skidMesh.instanceMatrix.needsUpdate = true;
  }
  function clearSkids() {
    dummy.position.set(0, -5, 0);
    dummy.scale.set(0.001, 0.001, 0.001);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    for (let i = 0; i < SKIDS; i++) skidMesh.setMatrixAt(i, dummy.matrix);
    skidMesh.instanceMatrix.needsUpdate = true;
  }

  const copVisuals = sim.cops.map(() => {
    const built = buildCar(0xe7e2d8, 0xe23b3b, true);
    const glow = new THREE.PointLight(0xe23b3b, 0, 14, 2);
    glow.position.set(0, 1.3, -0.1);
    built.group.add(glow);
    scene.add(built.group);
    return { ...built, glow };
  });

  const caseMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xe4c36a,
      metalness: 0.75,
      roughness: 0.22,
      emissive: 0xe4c36a,
      emissiveIntensity: 0.45,
    }),
  );
  const caseGeo = track(new THREE.BoxGeometry(0.72, 0.42, 0.28));
  const handleGeo = track(new THREE.BoxGeometry(0.28, 0.08, 0.06));
  const cases = sim.pickups.map(() => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(caseGeo, caseMat);
    body.position.y = 0.62;
    const handle = new THREE.Mesh(handleGeo, caseMat);
    handle.position.y = 0.9;
    g.add(body, handle);
    scene.add(g);
    return g;
  });

  const beacon = new THREE.Group();
  const ring = new THREE.Mesh(
    track(new THREE.RingGeometry(1.8, 2.35, 28)),
    track(new THREE.MeshBasicMaterial({ color: 0xe4c36a, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })),
  );
  ring.rotation.x = -Math.PI / 2;
  const pillar = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.07, 0.07, 9, 8)),
    track(new THREE.MeshBasicMaterial({ color: 0xe4c36a, transparent: true, opacity: 0.45 })),
  );
  pillar.position.y = 4.5;
  const dock = new THREE.Mesh(
    box,
    track(new THREE.MeshStandardMaterial({ color: 0x101218, roughness: 0.8, metalness: 0.2 })),
  );
  dock.position.set(0, 0.08, 0);
  dock.scale.set(6.5, 0.12, 6.5);
  beacon.add(ring, pillar, dock);
  for (const [x, z] of [
    [3.4, 2.2],
    [3.6, -1.6],
    [-3.2, 2.4],
  ] as const) {
    const crate = new THREE.Mesh(
      box,
      track(new THREE.MeshStandardMaterial({ color: 0x242017, roughness: 0.7, metalness: 0.15 })),
    );
    crate.position.set(x, 0.55, z);
    crate.scale.set(1.1, 1.1, 1.1);
    beacon.add(crate);
  }
  beacon.position.set(sim.exitX, 0, sim.exitZ);
  beacon.visible = false;
  scene.add(beacon);

  const sparkCount = 40;
  const sparkPos = new Float32Array(sparkCount * 3);
  const sparkCol = new Float32Array(sparkCount * 3);
  const sparkLife = new Float32Array(sparkCount);
  const sparkVel = new Float32Array(sparkCount * 3);
  for (let i = 0; i < sparkCount; i++) sparkPos[i * 3 + 1] = -20;
  const sparkGeo = track(new THREE.BufferGeometry());
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute("color", new THREE.BufferAttribute(sparkCol, 3));
  const sparks = new THREE.Points(
    sparkGeo,
    track(
      new THREE.PointsMaterial({
        size: 12,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      }),
    ),
  );
  scene.add(sparks);

  const rainCount = 180;
  const rainPos = new Float32Array(rainCount * 3);
  for (let i = 0; i < rainCount; i++) {
    rainPos[i * 3] = (Math.random() - 0.5) * 40;
    rainPos[i * 3 + 1] = Math.random() * 16;
    rainPos[i * 3 + 2] = (Math.random() - 0.5) * 40;
  }
  const rainGeo = track(new THREE.BufferGeometry());
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.Points(
    rainGeo,
    track(
      new THREE.PointsMaterial({
        color: 0xc8d0dc,
        size: 2.2,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    ),
  );
  scene.add(rain);

  const desired = new THREE.Vector3();
  const look = new THREE.Vector3();
  let menuYaw = 0.4;
  let wheelSpin = 0;
  let lastHud = 0;
  let lastPhase = sim.phase;
  let popT = 0;

  function burst(x: number, y: number, z: number, gold: boolean) {
    let left = 12;
    for (let i = 0; i < sparkCount && left > 0; i++) {
      if (sparkLife[i]! > 0) continue;
      sparkLife[i] = 0.45 + (i % 5) * 0.04;
      sparkPos[i * 3] = x;
      sparkPos[i * 3 + 1] = y;
      sparkPos[i * 3 + 2] = z;
      sparkVel[i * 3] = (Math.random() - 0.5) * 6;
      sparkVel[i * 3 + 1] = 2 + Math.random() * 4;
      sparkVel[i * 3 + 2] = (Math.random() - 0.5) * 6;
      sparkCol[i * 3] = gold ? 0.89 : 0.89;
      sparkCol[i * 3 + 1] = gold ? 0.76 : 0.23;
      sparkCol[i * 3 + 2] = gold ? 0.42 : 0.23;
      left--;
    }
  }

  function emitHud() {
    hooks.onHud({
      phase: sim.phase,
      cash: sim.cash,
      heat: sim.heat,
      bags: sim.bags,
      need: sim.need,
      best: sim.best,
      speed: sim.speed,
      pop: sim.pop,
      level: sim.level,
      bestLevel: sim.bestLevel,
      nitro: sim.nitro,
      boosting: sim.boost > 0,
      time: sim.clock,
      near: sim.near,
      wrecks: sim.wrecks,
      bonus: sim.bonus,
      cops: activeCops(sim),
    });
  }

  function showPop(text: string) {
    hooks.pop.textContent = text;
    popT = 1.1;
    hooks.pop.style.opacity = "1";
  }

  const api: GameApi = {
    unlock: () => audio.unlock(),
    start: () => {
      audio.unlock();
      begin(sim, "new");
      clearSkids();
      emitHud();
    },
    pause: () => {
      if (sim.phase === "play") sim.phase = "paused";
      else if (sim.phase === "paused") sim.phase = "play";
      emitHud();
    },
    retry: () => {
      audio.unlock();
      begin(sim, "retry");
      clearSkids();
      emitHud();
    },
    next: () => {
      audio.unlock();
      begin(sim, "next");
      clearSkids();
      emitHud();
    },
    restart: () => {
      audio.unlock();
      begin(sim, "new");
      clearSkids();
      emitHud();
    },
    toggleMute: () => {
      const next = !audio.isMuted();
      audio.setMuted(next);
      return next;
    },
  };
  hooks.api.current = api;
  if (hooks.pendingStart.current) {
    hooks.pendingStart.current = false;
    api.start();
  }

  window.__controlsTest = {
    getYaw: () => sim.yaw,
    getSpeed: () => sim.speed,
    setKeys: (codes) => {
      sim.forced = new Set(codes);
      sim.steerOverride = null;
      if (sim.phase !== "play") begin(sim);
    },
    setSteer: (v) => {
      sim.steerOverride = Math.max(-1, Math.min(1, v));
      if (sim.phase !== "play") begin(sim);
    },
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!GAME_KEYS.has(e.code)) return;
    e.preventDefault();
    input.keys.add(e.code);
    if (e.code === "Escape" && (sim.phase === "play" || sim.phase === "paused")) api.pause();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    input.keys.delete(e.code);
  };
  const clearKeys = () => input.keys.clear();
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", clearKeys);
  const onVisibility = () => {
    if (document.hidden) {
      clearKeys();
      audio.suspend();
    } else {
      audio.unlock();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  const timer = new THREE.Timer();
  timer.connect(document);
  let acc = 0;
  const stepDt = 1 / 60;
  const radarCtx = hooks.radar.getContext("2d");

  function drawRadar() {
    if (!radarCtx) return;
    const c = hooks.radar;
    const w = c.width;
    const h = c.height;
    radarCtx.clearRect(0, 0, w, h);
    radarCtx.fillStyle = "#07080b";
    radarCtx.fillRect(0, 0, w, h);
    const scale = w / 130;
    const px = (x: number) => w / 2 + x * scale;
    const pz = (z: number) => h / 2 + z * scale;
    radarCtx.fillStyle = "#1c2028";
    for (const b of sim.buildings) {
      radarCtx.fillRect(px(b.minX), pz(b.minZ), (b.maxX - b.minX) * scale, (b.maxZ - b.minZ) * scale);
    }
    radarCtx.fillStyle = "#e4c36a";
    for (const p of sim.pickups) {
      if (!p.on || p.taken) continue;
      radarCtx.fillRect(px(p.x) - 2, pz(p.z) - 2, 4, 4);
    }
    if (sim.exitOpen || sim.phase === "menu") {
      radarCtx.strokeStyle = "#e4c36a";
      radarCtx.strokeRect(px(sim.exitX) - 4, pz(sim.exitZ) - 4, 8, 8);
    }
    radarCtx.fillStyle = "#e23b3b";
    if (sim.phase !== "menu") {
      for (const cop of sim.cops) {
        if (!cop.active) continue;
        radarCtx.beginPath();
        radarCtx.arc(px(cop.x), pz(cop.z), 2.4, 0, Math.PI * 2);
        radarCtx.fill();
      }
    }
    radarCtx.save();
    radarCtx.translate(px(sim.phase === "menu" ? 0 : sim.x), pz(sim.phase === "menu" ? 0 : sim.z));
    radarCtx.rotate(sim.phase === "menu" ? menuYaw : sim.yaw);
    radarCtx.fillStyle = "#ece7df";
    radarCtx.beginPath();
    radarCtx.moveTo(0, -4);
    radarCtx.lineTo(3, 4);
    radarCtx.lineTo(-3, 4);
    radarCtx.closePath();
    radarCtx.fill();
    radarCtx.restore();
  }

  function frame(stamp: number) {
    timer.update(stamp);
    let delta = timer.getDelta();
    if (delta > 0.1) delta = 0.1;
    acc += delta;
    let steps = 0;
    while (acc >= stepDt && steps < 5) {
      tick(sim, input, stepDt);
      acc -= stepDt;
      steps++;
    }

    for (const ev of sim.events) {
      if (ev === "pickup") {
        audio.blip("cash");
        burst(sim.x, 0.9, sim.z, true);
        showPop(sim.pop);
      } else if (ev === "hit") {
        audio.blip("hit");
        burst(sim.x, 0.6, sim.z, false);
      } else if (ev === "near") {
        audio.blip("near");
        showPop(sim.pop);
      } else if (ev === "open") {
        audio.blip("open");
        showPop(sim.pop);
      } else if (ev === "win") {
        audio.blip("win");
        showPop(sim.pop);
        emitHud();
      } else if (ev === "bust") {
        audio.blip("bust");
        emitHud();
      } else if (ev === "boost") {
        audio.blip("boost");
        showPop(sim.pop);
      } else if (ev === "wreck") {
        audio.blip("hit");
        burst(sim.x, 0.9, sim.z, true);
        showPop(sim.pop);
      } else if (ev === "reinforce") {
        audio.blip("reinforce");
        showPop(sim.pop);
      }
    }
    sim.events.length = 0;

    const now = performance.now();
    if (sim.phase !== lastPhase || now - lastHud > 100) {
      lastPhase = sim.phase;
      lastHud = now;
      emitHud();
    }

    if (popT > 0) {
      popT -= delta;
      hooks.pop.style.opacity = String(Math.max(0, popT));
    }

    const playing = sim.phase === "play" || sim.phase === "paused" || sim.phase === "busted" || sim.phase === "escaped";
    let camX = 0;
    let camZ = 0;
    let yaw = menuYaw;
    if (sim.phase === "menu") {
      menuYaw += delta * 0.28;
      yaw = menuYaw;
      player.group.position.set(0, 0, 0);
      player.group.rotation.y = yaw + Math.PI;
      desired.set(Math.sin(menuYaw) * 16, 7.2, Math.cos(menuYaw) * 16);
      look.set(0, 1.1, 0);
      camX = 0;
      camZ = 0;
    } else {
      yaw = sim.yaw;
      const slip = sim.hand ? sim.steer * 0.42 : sim.steer * 0.06;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      player.group.position.set(sim.x, 0, sim.z);
      player.group.rotation.y = yaw + Math.PI + slip;
      const stretch = 1 + Math.min(0.08, Math.abs(sim.speed) / 340);
      player.group.scale.set(1 / stretch, 1, stretch);
      const dist = 8.6;
      const height = 3.7 + Math.abs(sim.speed) * 0.03;
      desired.set(sim.x - fx * dist, height, sim.z - fz * dist);
      look.set(sim.x + fx * 6.5, 1.05, sim.z + fz * 6.5);
      camX = sim.x;
      camZ = sim.z;
    }

    wheelSpin += sim.speed * delta * 2.4;
    for (const w of player.wheels) w.rotation.x = wheelSpin;
    headA.intensity = playing && sim.phase !== "menu" ? 50 : 8;
    headB.intensity = headA.intensity;

    sim.pickups.forEach((p, i) => {
      const g = cases[i]!;
      g.visible = p.on && !p.taken;
      if (p.on && !p.taken) {
        g.position.set(p.x, Math.sin(sim.time * 2.4 + i) * 0.12, p.z);
        g.rotation.y = sim.time * 0.8 + i;
      }
    });

    beacon.visible = sim.exitOpen || sim.phase === "escaped";
    beacon.position.set(sim.exitX, 0, sim.exitZ);
    ring.scale.setScalar(1 + Math.sin(sim.time * 3) * 0.06);

    sim.cops.forEach((cop, i) => {
      const visual = copVisuals[i]!;
      visual.group.visible = sim.phase !== "menu" && cop.active;
      visual.group.position.set(cop.x, 0, cop.z);
      visual.group.rotation.y = cop.yaw + Math.PI;
      for (const w of visual.wheels) w.rotation.x = wheelSpin * 0.8;
      const pulse = 0.5 + 0.5 * Math.sin(sim.time * 14 + i);
      visual.glow.intensity = cop.stun > 0 ? 0.4 : cop.mode === "chase" ? 6 + pulse * 8 : 1.2;
      if (cop.stun > 0) visual.group.rotation.y += Math.sin(sim.time * 30) * 0.25;
      visual.glow.color.setHex(pulse > 0.5 ? 0xe23b3b : 0xf4f0e6);
      visual.trim.emissive.setHex(pulse > 0.5 ? 0xe23b3b : 0xf4f0e6);
      visual.trim.emissiveIntensity = cop.mode === "chase" ? 1.4 : 0.35;
    });

    const braking = sim.phase === "play" && (input.keys.has("KeyS") || input.keys.has("ArrowDown") || input.brake || sim.hand);
    player.tailM.color.setHex(braking ? 0xff8a78 : 0xe23b3b);
    const flameOn = sim.phase === "play" && sim.boost > 0;
    for (const f of flames) {
      f.visible = flameOn;
      if (flameOn) f.scale.z = 1.1 + Math.sin(sim.time * 90) * 0.4;
    }
    skidCd -= delta;
    if (sim.phase === "play" && sim.drifting && skidCd <= 0) {
      skidCd = 0.035;
      const bx = Math.sin(sim.yaw);
      const bz = Math.cos(sim.yaw);
      const sx = Math.cos(sim.yaw) * 0.78;
      const sz = -Math.sin(sim.yaw) * 0.78;
      laySkid(sim.x + bx * 1.05 + sx, sim.z + bz * 1.05 + sz, sim.yaw);
      laySkid(sim.x + bx * 1.05 - sx, sim.z + bz * 1.05 - sz, sim.yaw);
    }

    // Seta: aponta para a próxima mala (ou para o cais, quando aberto).
    let targetX = 0;
    let targetZ = 0;
    let hasTarget = false;
    let bestD = Infinity;
    if (sim.phase === "play") {
      if (sim.exitOpen) {
        targetX = sim.exitX;
        targetZ = sim.exitZ;
        hasTarget = true;
        bestD = Math.hypot(targetX - sim.x, targetZ - sim.z);
      } else {
        for (const p of sim.pickups) {
          if (!p.on || p.taken) continue;
          const d = Math.hypot(p.x - sim.x, p.z - sim.z);
          if (d < bestD) {
            bestD = d;
            targetX = p.x;
            targetZ = p.z;
            hasTarget = true;
          }
        }
      }
    }
    if (hasTarget && bestD > 12) {
      const want = Math.atan2(-(targetX - sim.x), -(targetZ - sim.z));
      const rel = Math.atan2(Math.sin(want - sim.yaw), Math.cos(want - sim.yaw));
      hooks.arrow.style.opacity = "0.9";
      hooks.arrow.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
    } else {
      hooks.arrow.style.opacity = "0";
    }

    for (let i = 0; i < sparkCount; i++) {
      if (sparkLife[i]! <= 0) {
        sparkPos[i * 3 + 1] = -30;
        continue;
      }
      sparkLife[i]! -= delta;
      sparkPos[i * 3]! += sparkVel[i * 3]! * delta;
      sparkPos[i * 3 + 1]! += sparkVel[i * 3 + 1]! * delta;
      sparkPos[i * 3 + 2]! += sparkVel[i * 3 + 2]! * delta;
      sparkVel[i * 3 + 1]! -= 8 * delta;
    }
    (sparkGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (sparkGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;

    for (let i = 0; i < rainCount; i++) {
      rainPos[i * 3]! += delta * 1.5;
      rainPos[i * 3 + 1]! -= delta * (16 + (i % 5) * 2);
      rainPos[i * 3 + 2]! += delta * 0.4;
      if (rainPos[i * 3 + 1]! < 0) {
        rainPos[i * 3] = camX + (Math.random() - 0.5) * 36;
        rainPos[i * 3 + 1] = 10 + Math.random() * 8;
        rainPos[i * 3 + 2] = camZ + (Math.random() - 0.5) * 36;
      }
    }
    (rainGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    const k = 1 - Math.exp(-4.2 * Math.max(delta, 0.001));
    if (sim.snapCam) {
      camera.position.copy(desired);
      sim.snapCam = false;
    } else {
      camera.position.lerp(desired, k);
    }
    if (!reduced && sim.trauma > 0) {
      const shake = sim.trauma * sim.trauma;
      const t = sim.time * 40;
      camera.position.x += Math.sin(t * 1.7) * 0.28 * shake;
      camera.position.y += Math.sin(t * 2.3) * 0.18 * shake;
      camera.position.z += Math.cos(t * 1.9) * 0.28 * shake;
    }
    camera.lookAt(look);
    const fov =
      sim.phase === "menu"
        ? 52
        : 58 + Math.min(10, Math.abs(sim.speed) * 0.28) + (sim.boost > 0 ? 7 : 0);
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * Math.min(1, delta * 6);
      camera.updateProjectionMatrix();
    }

    hooks.vignette.style.opacity = sim.phase === "play" ? String(Math.min(0.72, sim.heat / 130)) : "0";
    hooks.flash.style.opacity = String(sim.flash * 0.28);

    let siren = 0;
    if (sim.phase === "play") {
      for (const cop of sim.cops) {
        if (cop.mode !== "chase") continue;
        const d = Math.hypot(cop.x - sim.x, cop.z - sim.z);
        siren = Math.max(siren, 1 - d / 28);
      }
      siren = Math.max(siren, sim.heat / 140);
    }
    audio.engine(sim.speed, sim.phase);
    audio.music(sim.heat, sim.phase);
    audio.siren(siren);
    drawRadar();
    renderer.render(scene, camera);
  }

  const resize = () => {
    const w = root.clientWidth || 1;
    const h = root.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.setSize(w, h, false);
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(root);
  renderer.setAnimationLoop(frame);
  emitHud();

  return () => {
    renderer.setAnimationLoop(null);
    observer.disconnect();
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", clearKeys);
    document.removeEventListener("visibilitychange", onVisibility);
    delete window.__controlsTest;
    renderer.dispose();
    for (const d of disposables) d.dispose();
    root.removeChild(renderer.domElement);
    hooks.api.current = null;
  };
}
