// Arcade getaway. Chase-cam basis (controls skill):
// forward = (-sin yaw, 0, -cos yaw). A → steer +1 → +yaw (nose left).
// yaw 0 faces world −Z.

export const BLOCKS = 4;
export const BLOCK = 14;
export const STREET = 10;
export const CELL = BLOCK + STREET;
export const NEED_BAGS = 3;
export const MAX_COPS = 6;
export const MAX_PICKUPS = 7;

export type Phase = "menu" | "play" | "paused" | "busted" | "escaped";

export type Building = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  h: number;
  neon: boolean;
};

export type Pickup = { x: number; z: number; taken: boolean; on: boolean };
export type Cop = {
  x: number;
  z: number;
  yaw: number;
  speed: number;
  spawnX: number;
  spawnZ: number;
  spawnYaw: number;
  tx: number;
  tz: number;
  mode: "patrol" | "chase";
  alert: number;
  hitCd: number;
  nearCd: number;
  wobble: number;
  active: boolean;
  stun: number;
  lead: number;
};

export type SimEvent =
  | "pickup"
  | "hit"
  | "near"
  | "win"
  | "bust"
  | "open"
  | "boost"
  | "wreck"
  | "reinforce";

export type LevelConfig = {
  need: number;
  copsStart: number;
  copsMax: number;
  reinforceEvery: number;
  copBoost: number;
};

// Noite 1 = as regras de sempre. Cada noite seguinte pede mais malas,
// traz mais viaturas e mais reforço.
export function levelConfig(level: number): LevelConfig {
  const l = Math.max(1, Math.floor(level));
  const copsStart = Math.min(4, 2 + l);
  return {
    need: Math.min(5, 3 + Math.floor((l - 1) / 2)),
    copsStart,
    copsMax: Math.min(MAX_COPS, copsStart + 2),
    reinforceEvery: Math.max(16, 34 - l * 3),
    copBoost: Math.min(1.8, (l - 1) * 0.3),
  };
}

export type InputState = {
  keys: Set<string>;
  left: boolean;
  right: boolean;
  gas: boolean;
  brake: boolean;
  hand: boolean;
  boost: boolean;
};

export type Sim = {
  phase: Phase;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  heat: number;
  cash: number;
  bags: number;
  need: number;
  best: number;
  time: number;
  clock: number;
  level: number;
  bank: number;
  bestLevel: number;
  cfg: LevelConfig;
  nitro: number;
  boost: number;
  cap: number;
  drifting: boolean;
  handPrev: boolean;
  boostPrev: boolean;
  reinforceT: number;
  near: number;
  wrecks: number;
  bonus: number;
  trauma: number;
  hitstop: number;
  combo: number;
  comboT: number;
  exitX: number;
  exitZ: number;
  exitOpen: boolean;
  buildings: Building[];
  pickups: Pickup[];
  cops: Cop[];
  events: SimEvent[];
  forced: Set<string> | null;
  steerOverride: number | null;
  pop: string;
  hand: boolean;
  steer: number;
  flash: number;
  scrapeCd: number;
  snapCam: boolean;
  rand: () => number;
  runRand: () => number;
};

export type BeginMode = "new" | "next" | "retry";

// A chave continua "v1" para não perder recordes antigos; o formato interno
// é versionado (v1 = só best, v2 = best + bestLevel).
export const SAVE_KEY = "fuga-save-v1";

const MAX_SPEED = 26;
const TURN = 2.55;
const CAR_R = 1.32;
const COP_R = 1.28;

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      setSteer?: (v: number) => void;
      setKeys?: (codes: string[]) => void;
    };
  }
}

export function streetPos(i: number): number {
  return (i - BLOCKS / 2) * CELL;
}

type Save = { best: number; bestLevel: number };

export function loadSave(): Save {
  const empty: Save = { best: 0, bestLevel: 0 };
  if (typeof localStorage === "undefined") return empty;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as { version?: number; best?: number; bestLevel?: number };
    if (typeof parsed.best !== "number") return empty;
    if (parsed.version === 1) return { best: parsed.best, bestLevel: 0 };
    if (parsed.version === 2) {
      return {
        best: parsed.best,
        bestLevel: typeof parsed.bestLevel === "number" ? parsed.bestLevel : 0,
      };
    }
    return empty;
  } catch {
    return empty;
  }
}

export function loadBest(): number {
  return loadSave().best;
}

function saveProgress(best: number, bestLevel: number) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 2, best, bestLevel }));
  } catch {
    /* private mode */
  }
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}

function buildingAt(i: number, j: number, h: number, neon: boolean): Building {
  const x0 = streetPos(i) + STREET / 2;
  const z0 = streetPos(j) + STREET / 2;
  return { minX: x0, maxX: x0 + BLOCK, minZ: z0, maxZ: z0 + BLOCK, h, neon };
}

// Cruzamentos de onde as viaturas entram (índices da grade). Nunca perto da largada.
const COP_SPAWNS: Array<[number, number]> = [
  [4, 0],
  [4, 2],
  [2, 4],
  [0, 4],
  [2, 0],
  [4, 3],
];
// Cada viatura persegue de um jeito: quanto maior, mais ela mira à frente do carro.
const COP_LEAD = [0.22, 0.55, 0.12, 0.4, 0.22, 0.7];

function shuffle<T>(list: T[], rand: () => number) {
  for (let n = list.length - 1; n > 0; n--) {
    const k = Math.floor(rand() * (n + 1));
    const tmp = list[n]!;
    list[n] = list[k]!;
    list[k] = tmp;
  }
  return list;
}

function pickSpots(
  rand: () => number,
  count: number,
  sx: number,
  sz: number,
  ex: number,
  ez: number,
): Array<[number, number]> {
  const cands: Array<[number, number]> = [];
  for (let j = 0; j <= BLOCKS; j++) {
    for (let i = 0; i <= BLOCKS; i++) {
      const x = streetPos(i);
      const z = streetPos(j);
      if (Math.hypot(x - sx, z - sz) < 20) continue;
      if (Math.hypot(x - ex, z - ez) < 20) continue;
      cands.push([x, z]);
    }
  }
  shuffle(cands, rand);
  const out: Array<[number, number]> = [];
  for (const c of cands) {
    if (out.every((o) => Math.hypot(o[0] - c[0], o[1] - c[1]) >= 22)) out.push(c);
    if (out.length >= count) break;
  }
  for (const c of cands) {
    if (out.length >= count) break;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

function spawnYaw(x: number, z: number) {
  return Math.atan2(x, z);
}

export function createSim(): Sim {
  const rand = mulberry32(0x0f09a);
  const buildings: Building[] = [];
  for (let j = 0; j < BLOCKS; j++) {
    for (let i = 0; i < BLOCKS; i++) {
      const tower = rand() > 0.82;
      const h = tower ? 14 + rand() * 10 : 4 + rand() * 8;
      buildings.push(buildingAt(i, j, h, (i + j) % 3 === 0));
    }
  }

  const pickups: Pickup[] = Array.from({ length: MAX_PICKUPS }, () => ({
    x: 0,
    z: 0,
    taken: false,
    on: false,
  }));

  const cops: Cop[] = Array.from({ length: MAX_COPS }, (_, idx) => {
    const [ci, cj] = COP_SPAWNS[idx % COP_SPAWNS.length]!;
    const x = streetPos(ci);
    const z = streetPos(cj);
    return {
      x,
      z,
      yaw: spawnYaw(x, z),
      speed: 0,
      spawnX: x,
      spawnZ: z,
      spawnYaw: spawnYaw(x, z),
      tx: streetPos((idx * 2) % 5),
      tz: streetPos((idx + 3) % 5),
      mode: "patrol",
      alert: 0,
      hitCd: 0,
      nearCd: 0,
      wobble: idx % 2 === 0 ? 1 : -1,
      active: false,
      stun: 0,
      lead: COP_LEAD[idx] ?? 0.22,
    };
  });

  const save = loadSave();
  return {
    phase: "menu",
    x: streetPos(0),
    z: streetPos(2),
    yaw: -Math.PI / 2,
    speed: 0,
    heat: 0,
    cash: 0,
    bags: 0,
    need: NEED_BAGS,
    best: save.best,
    bestLevel: save.bestLevel,
    time: 0,
    clock: 0,
    level: 1,
    bank: 0,
    cfg: levelConfig(1),
    nitro: 0,
    boost: 0,
    cap: MAX_SPEED,
    drifting: false,
    handPrev: false,
    boostPrev: false,
    reinforceT: 0,
    near: 0,
    wrecks: 0,
    bonus: 0,
    trauma: 0,
    hitstop: 0,
    combo: 0,
    comboT: 0,
    exitX: streetPos(BLOCKS),
    exitZ: streetPos(BLOCKS),
    exitOpen: false,
    buildings,
    pickups,
    cops,
    events: [],
    forced: null,
    steerOverride: null,
    pop: "",
    hand: false,
    steer: 0,
    flash: 0,
    scrapeCd: 0,
    snapCam: false,
    rand,
    runRand: mulberry32(0x5eed),
  };
}

export function activeCops(sim: Sim) {
  let n = 0;
  for (const c of sim.cops) if (c.active) n++;
  return n;
}

function placeCop(cop: Cop, x: number, z: number) {
  cop.x = x;
  cop.z = z;
  cop.spawnX = x;
  cop.spawnZ = z;
  cop.yaw = spawnYaw(x, z);
  cop.spawnYaw = cop.yaw;
  cop.speed = 0;
  cop.mode = "patrol";
  cop.alert = 0;
  cop.hitCd = 0;
  cop.nearCd = 1.2;
  cop.stun = 0;
  cop.active = true;
}

export function begin(sim: Sim, mode: BeginMode = "new") {
  if (mode === "new") {
    sim.level = 1;
    sim.bank = 0;
  } else if (mode === "next") {
    sim.level += 1;
    sim.bank = sim.cash;
  }
  const cfg = levelConfig(sim.level);
  sim.cfg = cfg;
  sim.need = cfg.need;
  sim.runRand = mulberry32((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);

  sim.phase = "play";
  sim.x = streetPos(0);
  sim.z = streetPos(2);
  sim.yaw = -Math.PI / 2;
  sim.speed = 0;
  sim.heat = 0;
  sim.cash = sim.bank;
  sim.bags = 0;
  sim.time = 0;
  sim.clock = 0;
  sim.nitro = 0;
  sim.boost = 0;
  sim.cap = MAX_SPEED;
  sim.drifting = false;
  sim.handPrev = false;
  sim.boostPrev = false;
  sim.near = 0;
  sim.wrecks = 0;
  sim.bonus = 0;
  sim.trauma = 0;
  sim.hitstop = 0;
  sim.combo = 0;
  sim.comboT = 0;
  sim.exitOpen = false;
  sim.pop = "";
  sim.flash = 0;
  sim.scrapeCd = 0;
  sim.hand = false;
  sim.steer = 0;
  sim.snapCam = true;
  sim.events.length = 0;

  const spots = pickSpots(sim.runRand, cfg.need + 2, sim.x, sim.z, sim.exitX, sim.exitZ);
  sim.pickups.forEach((p, i) => {
    const spot = spots[i];
    p.taken = false;
    p.on = !!spot;
    if (spot) {
      p.x = spot[0];
      p.z = spot[1];
    }
  });

  const spawns = shuffle([...COP_SPAWNS], sim.runRand);
  sim.cops.forEach((c, i) => {
    c.active = false;
    if (i < cfg.copsStart) {
      const [ci, cj] = spawns[i % spawns.length]!;
      placeCop(c, streetPos(ci), streetPos(cj));
    }
  });
  sim.reinforceT = cfg.reinforceEvery;
}

function spawnReinforcement(sim: Sim): boolean {
  const idle = sim.cops.find((c) => !c.active);
  if (!idle) return false;
  let best: [number, number] | null = null;
  let bestD = 0;
  for (const [ci, cj] of COP_SPAWNS) {
    const x = streetPos(ci);
    const z = streetPos(cj);
    const d = Math.hypot(x - sim.x, z - sim.z);
    if (d < 34) continue;
    if (sim.cops.some((c) => c.active && Math.hypot(c.x - x, c.z - z) < 8)) continue;
    if (d > bestD) {
      bestD = d;
      best = [x, z];
    }
  }
  if (!best) return false;
  placeCop(idle, best[0], best[1]);
  return true;
}

function los(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  buildings: Building[],
): boolean {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / 2.5));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = x1 + dx * t;
    const z = z1 + dz * t;
    for (const b of buildings) {
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return false;
    }
  }
  return true;
}

function pushCircle(
  x: number,
  z: number,
  buildings: Building[],
  radius: number,
): { x: number; z: number; hit: boolean; nx: number; nz: number } {
  let hit = false;
  let nx = 0;
  let nz = 0;
  for (let n = 0; n < 2; n++) {
    for (const b of buildings) {
      const minX = b.minX - radius;
      const maxX = b.maxX + radius;
      const minZ = b.minZ - radius;
      const maxZ = b.maxZ + radius;
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      const dl = x - minX;
      const dr = maxX - x;
      const dt = z - minZ;
      const db = maxZ - z;
      const m = Math.min(dl, dr, dt, db);
      hit = true;
      if (m === dl) {
        x = minX;
        nx = -1;
        nz = 0;
      } else if (m === dr) {
        x = maxX;
        nx = 1;
        nz = 0;
      } else if (m === dt) {
        z = minZ;
        nx = 0;
        nz = -1;
      } else {
        z = maxZ;
        nx = 0;
        nz = 1;
      }
    }
  }
  return { x, z, hit, nx, nz };
}

const HALF = streetPos(BLOCKS) + 8;

function clampBounds(x: number, z: number) {
  return { x: clamp(x, -HALF, HALF), z: clamp(z, -HALF, HALF) };
}

function radialDeadzone(x: number, y: number, dz = 0.18) {
  const m = Math.hypot(x, y);
  if (m < dz || m === 0) return { x: 0, y: 0 };
  const scale = (m - dz) / (1 - dz) / m;
  return { x: x * scale, y: y * scale };
}

function readDrive(sim: Sim, input: InputState) {
  const forced = sim.forced;
  const down = (code: string) => (forced ? forced.has(code) : input.keys.has(code));
  let steer = 0;
  let throttle = 0;
  let hand = false;
  let boost = false;
  if (down("KeyA") || down("ArrowLeft")) steer += 1;
  if (down("KeyD") || down("ArrowRight")) steer -= 1;
  if (down("KeyW") || down("ArrowUp")) throttle += 1;
  if (down("KeyS") || down("ArrowDown")) throttle -= 1;
  if (down("Space")) hand = true;
  if (down("ShiftLeft") || down("ShiftRight") || down("KeyE")) boost = true;
  if (!forced) {
    if (input.left) steer += 1;
    if (input.right) steer -= 1;
    if (input.gas) throttle += 1;
    if (input.brake) throttle -= 1;
    if (input.hand) hand = true;
    if (input.boost) boost = true;
    const pads = typeof navigator !== "undefined" ? navigator.getGamepads?.() : null;
    if (pads) {
      for (const gp of pads) {
        if (!gp || gp.mapping !== "standard") continue;
        const stick = radialDeadzone(gp.axes[0] ?? 0, gp.axes[1] ?? 0);
        steer += -stick.x;
        throttle += -stick.y;
        const rt = gp.buttons[7]?.value ?? 0;
        const lt = gp.buttons[6]?.value ?? 0;
        if (rt > 0.1) throttle += rt;
        if (lt > 0.1) throttle -= lt;
        if (gp.buttons[0]?.pressed) hand = true;
        if (gp.buttons[2]?.pressed) boost = true;
      }
    }
  }
  if (sim.steerOverride != null) steer = sim.steerOverride;
  return {
    steer: clamp(steer, -1, 1),
    throttle: clamp(throttle, -1, 1),
    hand,
    boost,
  };
}

function bust(sim: Sim) {
  if (sim.phase !== "play") return;
  sim.phase = "busted";
  sim.speed *= 0.25;
  sim.boost = 0;
  sim.pop = "PRESO";
  sim.events.push("bust");
}

function win(sim: Sim) {
  if (sim.phase !== "play") return;
  const night = 1200 + sim.level * 400;
  const heatBonus = Math.round((100 - sim.heat) * 12);
  const timeBonus = Math.max(0, Math.round((120 - sim.clock) * 10));
  const bonus = night + heatBonus + timeBonus;
  sim.bonus = bonus;
  sim.cash += bonus;
  sim.pop = `+${bonus}`;
  if (sim.cash > sim.best) sim.best = sim.cash;
  if (sim.level > sim.bestLevel) sim.bestLevel = sim.level;
  saveProgress(sim.best, sim.bestLevel);
  sim.phase = "escaped";
  sim.events.push("win");
}

function fireBoost(sim: Sim) {
  if (sim.boost > 0 || sim.nitro < 0.3) return;
  sim.boost = 0.55 + sim.nitro * 1.25;
  sim.nitro = 0;
  sim.pop = "NITRO";
  sim.events.push("boost");
}

function stepCop(sim: Sim, cop: Cop, dt: number) {
  const dx = sim.x - cop.x;
  const dz = sim.z - cop.z;
  const dist = Math.hypot(dx, dz) || 0.0001;
  const detect = 15 + sim.bags * 2.4;
  const seen = dist < detect && los(sim.x, sim.z, cop.x, cop.z, sim.buildings);
  if (seen) cop.alert = 3.2;
  else cop.alert = Math.max(0, cop.alert - dt);
  cop.mode = cop.alert > 0 || dist < 8 ? "chase" : "patrol";

  const stunned = cop.stun > 0;
  if (stunned) {
    cop.stun = Math.max(0, cop.stun - dt);
    cop.yaw += cop.wobble * 6 * dt;
  } else {
    let tx = cop.tx;
    let tz = cop.tz;
    if (cop.mode === "chase") {
      const fx = -Math.sin(sim.yaw);
      const fz = -Math.cos(sim.yaw);
      const lead = clamp(Math.abs(sim.speed) * cop.lead, 0, 10);
      tx = sim.x + fx * lead + cop.wobble * Math.sin(sim.time * 0.8) * 2.5;
      tz = sim.z + fz * lead;
    } else if (Math.hypot(cop.tx - cop.x, cop.tz - cop.z) < 3.2) {
      cop.tx = streetPos(Math.floor(sim.rand() * (BLOCKS + 1)));
      cop.tz = streetPos(Math.floor(sim.rand() * (BLOCKS + 1)));
      tx = cop.tx;
      tz = cop.tz;
    }
    const desired = Math.atan2(-(tx - cop.x), -(tz - cop.z));
    let diff = Math.atan2(Math.sin(desired - cop.yaw), Math.cos(desired - cop.yaw));
    const maxTurn = 2.35 * dt;
    diff = clamp(diff, -maxTurn, maxTurn);
    cop.yaw += diff;
  }

  const maxSpd = stunned
    ? 0
    : cop.mode === "chase"
      ? 20.2 + sim.bags * 0.35 + sim.cfg.copBoost
      : 10.5;
  if (cop.speed < maxSpd) cop.speed = Math.min(maxSpd, cop.speed + 16 * dt);
  else cop.speed = Math.max(maxSpd, cop.speed - (stunned ? 30 : 12) * dt);

  const fx = -Math.sin(cop.yaw);
  const fz = -Math.cos(cop.yaw);
  const moved = pushCircle(
    cop.x + fx * cop.speed * dt,
    cop.z + fz * cop.speed * dt,
    sim.buildings,
    COP_R,
  );
  if (moved.hit) {
    cop.speed *= 0.62;
    cop.yaw += cop.wobble * 3.4 * dt;
  }
  const b = clampBounds(moved.x, moved.z);
  if (b.x !== moved.x || b.z !== moved.z) cop.speed *= 0.5;
  cop.x = b.x;
  cop.z = b.z;
  cop.hitCd = Math.max(0, cop.hitCd - dt);
  cop.nearCd = Math.max(0, cop.nearCd - dt);
}

// Viaturas não se empilham: empurra as que ficam coladas umas nas outras.
function separateCops(sim: Sim) {
  const list = sim.cops;
  for (let a = 0; a < list.length; a++) {
    const ca = list[a]!;
    if (!ca.active) continue;
    for (let b = a + 1; b < list.length; b++) {
      const cb = list[b]!;
      if (!cb.active) continue;
      const dx = cb.x - ca.x;
      const dz = cb.z - ca.z;
      const d = Math.hypot(dx, dz);
      const min = 2.7;
      if (d >= min || d < 0.0001) continue;
      const push = (min - d) / 2;
      const nx = dx / d;
      const nz = dz / d;
      ca.x -= nx * push;
      ca.z -= nz * push;
      cb.x += nx * push;
      cb.z += nz * push;
    }
  }
}

function step(sim: Sim, input: InputState, dt: number) {
  const drive = readDrive(sim, input);
  sim.steer = drive.steer;
  sim.hand = drive.hand;
  sim.clock += dt;

  // Nitro: carrega derrapando com o freio de mão; solta o freio (ou aperta o botão) pra queimar.
  sim.drifting = drive.hand && Math.abs(sim.speed) > 6 && Math.abs(drive.steer) > 0.25;
  if (sim.drifting) sim.nitro = Math.min(1, sim.nitro + dt * 0.6);
  if (!drive.hand && sim.handPrev) fireBoost(sim);
  if (drive.boost && !sim.boostPrev) fireBoost(sim);
  sim.handPrev = drive.hand;
  sim.boostPrev = drive.boost;
  const boosting = sim.boost > 0;
  if (boosting) sim.boost = Math.max(0, sim.boost - dt);

  const drag = 0.82 + (drive.hand ? 2.4 : 0);
  let driveForce = 0;
  if (drive.throttle > 0) driveForce = 21 * drive.throttle;
  else if (drive.throttle < 0) driveForce = (sim.speed > 0.6 ? 36 : 14) * drive.throttle;
  if (boosting) driveForce += 30;
  sim.speed += (driveForce - sim.speed * drag) * dt;
  const targetCap = boosting ? MAX_SPEED + 9 : MAX_SPEED;
  sim.cap =
    sim.cap < targetCap
      ? Math.min(targetCap, sim.cap + 60 * dt)
      : Math.max(targetCap, sim.cap - 20 * dt);
  sim.speed = clamp(sim.speed, -11, sim.cap);

  const speedFactor = clamp(Math.abs(sim.speed) / MAX_SPEED, 0.42, 1);
  const reverse = sim.speed >= 0 ? 1 : -1;
  const turnMul = (drive.hand ? 1.72 : 1) * (boosting ? 0.85 : 1);
  sim.yaw += drive.steer * TURN * speedFactor * reverse * turnMul * dt;

  const fx = -Math.sin(sim.yaw);
  const fz = -Math.cos(sim.yaw);
  const nextX = sim.x + fx * sim.speed * dt;
  const nextZ = sim.z + fz * sim.speed * dt;
  const moved = pushCircle(nextX, nextZ, sim.buildings, CAR_R);
  if (moved.hit) {
    const into = -(fx * moved.nx + fz * moved.nz);
    if (into > 0.45 && Math.abs(sim.speed) > 8 && sim.scrapeCd <= 0) {
      sim.speed *= 0.5;
      sim.boost = Math.min(sim.boost, 0.1);
      sim.trauma = Math.min(1, sim.trauma + 0.34);
      sim.flash = 1;
      sim.scrapeCd = 0.4;
      sim.events.push("hit");
    } else if (into > 0) {
      sim.speed *= 1 - into * 0.4;
    }
  }
  const bounded = clampBounds(moved.x, moved.z);
  if (bounded.x !== moved.x || bounded.z !== moved.z) {
    if (Math.abs(sim.speed) > 8 && sim.scrapeCd <= 0) {
      sim.trauma = Math.min(1, sim.trauma + 0.2);
      sim.scrapeCd = 0.35;
      sim.events.push("hit");
    }
    sim.speed *= 0.45;
  }
  sim.x = bounded.x;
  sim.z = bounded.z;
  sim.scrapeCd = Math.max(0, sim.scrapeCd - dt);

  // Reforço: enquanto houver viatura de reserva, chega uma nova de tempos em tempos.
  if (activeCops(sim) < sim.cfg.copsMax) {
    sim.reinforceT -= dt;
    if (sim.reinforceT <= 0) {
      if (spawnReinforcement(sim)) {
        sim.reinforceT = sim.cfg.reinforceEvery;
        sim.pop = "REFORÇO";
        sim.events.push("reinforce");
      } else {
        sim.reinforceT = 2;
      }
    }
  }

  for (const cop of sim.cops) if (cop.active) stepCop(sim, cop, dt);
  separateCops(sim);

  for (const cop of sim.cops) {
    if (!cop.active) continue;
    const dx = cop.x - sim.x;
    const dz = cop.z - sim.z;
    const d = Math.hypot(dx, dz);
    if (d < 2.35 && d > 0.0001 && cop.hitCd <= 0) {
      const nx = dx / d;
      const nz = dz / d;
      const overlap = 2.35 - d;
      cop.x += nx * overlap * 0.55;
      cop.z += nz * overlap * 0.55;
      sim.x -= nx * overlap * 0.45;
      sim.z -= nz * overlap * 0.45;
      if (sim.boost > 0 && sim.speed > 18) {
        // Pancada com nitro ligado: a viatura roda e fica fora por um tempo.
        cop.stun = 1.8;
        cop.speed *= 0.2;
        cop.hitCd = 1.2;
        sim.speed *= 0.88;
        sim.heat = Math.min(100, sim.heat + 6);
        sim.cash += 250;
        sim.pop = "DERRUBOU +250";
        sim.wrecks += 1;
        sim.trauma = Math.min(1, sim.trauma + 0.5);
        sim.hitstop = 0.05;
        sim.events.push("wreck");
      } else {
        sim.speed *= 0.4;
        cop.speed *= 0.3;
        sim.heat = Math.min(100, sim.heat + 26);
        sim.trauma = Math.min(1, sim.trauma + 0.7);
        sim.hitstop = 0.07;
        sim.flash = 1;
        cop.hitCd = 0.85;
        sim.events.push("hit");
      }
    } else if (
      d > 2.35 &&
      d < 4.4 &&
      sim.speed > 13 &&
      cop.nearCd <= 0 &&
      cop.mode === "chase" &&
      cop.stun <= 0
    ) {
      cop.nearCd = 2.4;
      sim.cash += 120;
      sim.near += 1;
      sim.nitro = Math.min(1, sim.nitro + 0.2);
      sim.pop = "+120";
      sim.events.push("near");
    }
  }

  if (sim.comboT > 0) {
    sim.comboT -= dt;
    if (sim.comboT <= 0) sim.combo = 0;
  }

  for (const p of sim.pickups) {
    if (!p.on || p.taken) continue;
    if (Math.hypot(p.x - sim.x, p.z - sim.z) < 2.15) {
      p.taken = true;
      sim.bags += 1;
      sim.combo += 1;
      sim.comboT = 4.5;
      sim.nitro = Math.min(1, sim.nitro + 0.15);
      const gain = 500 + sim.combo * 150;
      sim.cash += gain;
      sim.pop = sim.combo > 1 ? `+${gain}  x${sim.combo}` : `+${gain}`;
      sim.trauma = Math.min(1, sim.trauma + 0.16);
      sim.events.push("pickup");
      if (sim.bags >= sim.need && !sim.exitOpen) {
        sim.exitOpen = true;
        sim.pop = "CAIS ABERTO";
        sim.events.push("open");
      }
    }
  }

  if (sim.exitOpen && Math.hypot(sim.exitX - sim.x, sim.exitZ - sim.z) < 4.3) {
    win(sim);
    return;
  }

  let press = 0;
  for (const cop of sim.cops) {
    if (!cop.active) continue;
    const d = Math.hypot(cop.x - sim.x, cop.z - sim.z);
    if (d < 18 && cop.stun <= 0 && los(sim.x, sim.z, cop.x, cop.z, sim.buildings)) {
      press = Math.max(press, 1 - d / 18);
    }
  }
  if (press > 0) sim.heat = Math.min(100, sim.heat + (8 + press * 18) * dt);
  else sim.heat = Math.max(0, sim.heat - 9 * dt);
  if (sim.heat >= 100) bust(sim);
}

export function tick(sim: Sim, input: InputState, dt: number) {
  sim.time += dt;
  sim.trauma = Math.max(0, sim.trauma - dt * 1.35);
  sim.flash = Math.max(0, sim.flash - dt * 3.2);
  if (sim.hitstop > 0) {
    sim.hitstop = Math.max(0, sim.hitstop - dt);
    return;
  }
  if (sim.phase === "play") step(sim, input, dt);
}
