export type AudioBus = {
  unlock: () => void;
  setMuted: (muted: boolean) => void;
  isMuted: () => boolean;
  engine: (speed: number, phase: string) => void;
  siren: (amount: number) => void;
  blip: (kind: "cash" | "hit" | "near" | "open" | "win" | "bust" | "boost" | "reinforce") => void;
  music: (heat: number, phase: string) => void;
  suspend: () => void;
};

export function createAudio(): AudioBus {
  let ctx: AudioContext | null = null;
  let muted = false;
  let engineOsc: OscillatorNode | null = null;
  let engineGain: GainNode | null = null;
  let sirenA: OscillatorNode | null = null;
  let sirenB: OscillatorNode | null = null;
  let sirenGain: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let musicGain: GainNode | null = null;
  let nextNote = 0;
  let step = 0;

  function context() {
    if (ctx) return ctx;
    ctx = new AudioContext();
    engineOsc = ctx.createOscillator();
    engineOsc.type = "sawtooth";
    engineOsc.frequency.value = 46;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 220;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(ctx.destination);
    engineOsc.start();

    sirenA = ctx.createOscillator();
    sirenB = ctx.createOscillator();
    sirenA.type = "square";
    sirenB.type = "square";
    sirenA.frequency.value = 620;
    sirenB.frequency.value = 760;
    sirenGain = ctx.createGain();
    sirenGain.gain.value = 0;
    const sirenFilter = ctx.createBiquadFilter();
    sirenFilter.type = "bandpass";
    sirenFilter.frequency.value = 900;
    sirenFilter.Q.value = 0.7;
    sirenA.connect(sirenFilter);
    sirenB.connect(sirenFilter);
    sirenFilter.connect(sirenGain);
    sirenGain.connect(ctx.destination);
    sirenA.start();
    sirenB.start();

    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(ctx.destination);

    const len = Math.floor(ctx.sampleRate * 0.28);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    return ctx;
  }

  function tone(freq: number, dur: number, type: OscillatorType, gain: number) {
    if (!ctx || muted) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }

  function crash() {
    if (!ctx || !noise || muted) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 420;
    g.gain.setValueAtTime(0.35, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.26);
    src.connect(f);
    f.connect(g);
    g.connect(ctx.destination);
    src.start();
  }

  // Baixo sintético em 16 passos (lá menor); acelera e ganha agudo conforme o calor sobe.
  const BASS = [55, 0, 55, 0, 65.4, 0, 55, 0, 49, 0, 49, 0, 58.3, 0, 65.4, 73.4];
  function note(freq: number, when: number, dur: number, type: OscillatorType, gain: number) {
    if (!ctx || !musicGain) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g);
    g.connect(musicGain);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  return {
    unlock() {
      const audio = context();
      if (audio.state === "suspended") void audio.resume();
    },
    setMuted(next) {
      muted = next;
      if (muted && engineGain && ctx) engineGain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      if (muted && sirenGain && ctx) sirenGain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      if (muted && musicGain && ctx) musicGain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    },
    isMuted: () => muted,
    engine(speed, phase) {
      if (!ctx || !engineGain || !engineOsc || muted) return;
      const on = phase === "play" || phase === "paused";
      const vol = on && phase === "play" ? 0.012 + Math.min(0.045, Math.abs(speed) / 700) : 0;
      engineGain.gain.setTargetAtTime(vol, ctx.currentTime, 0.06);
      engineOsc.frequency.setTargetAtTime(40 + Math.abs(speed) * 3.4, ctx.currentTime, 0.05);
    },
    siren(amount) {
      if (!ctx || !sirenGain || !sirenA || !sirenB || muted) return;
      const t = ctx.currentTime;
      sirenGain.gain.setTargetAtTime(amount > 0.05 ? 0.018 * amount : 0, t, 0.08);
      const wob = 0.5 + 0.5 * Math.sin(t * 8.5);
      sirenA.frequency.setTargetAtTime(540 + wob * 280, t, 0.05);
      sirenB.frequency.setTargetAtTime(700 + (1 - wob) * 220, t, 0.05);
    },
    music(heat, phase) {
      if (!ctx || !musicGain || muted) return;
      const on = phase === "play";
      musicGain.gain.setTargetAtTime(on ? 0.5 : 0, ctx.currentTime, 0.2);
      if (!on) {
        nextNote = 0;
        return;
      }
      const bpm = 104 + heat * 0.5;
      const sixteenth = 60 / bpm / 4;
      if (nextNote < ctx.currentTime) nextNote = ctx.currentTime + 0.05;
      while (nextNote < ctx.currentTime + 0.15) {
        const f = BASS[step % 16]!;
        if (f > 0) note(f, nextNote, sixteenth * 1.6, "sawtooth", 0.05);
        if (step % 4 === 0) note(48, nextNote, 0.12, "sine", 0.09);
        if (heat > 45 && step % 2 === 1) note(f > 0 ? f * 4 : 220, nextNote, sixteenth, "square", 0.012);
        nextNote += sixteenth;
        step++;
      }
    },
    blip(kind) {
      if (muted) return;
      context();
      if (kind === "cash") {
        tone(880, 0.09, "square", 0.05);
        tone(1320, 0.12, "square", 0.04);
      } else if (kind === "near") {
        tone(520, 0.08, "triangle", 0.05);
        tone(780, 0.1, "triangle", 0.04);
      } else if (kind === "hit") {
        crash();
        tone(90, 0.12, "sine", 0.08);
      } else if (kind === "open") {
        tone(440, 0.1, "square", 0.05);
        tone(660, 0.14, "square", 0.04);
      } else if (kind === "win") {
        tone(523, 0.12, "triangle", 0.06);
        tone(659, 0.14, "triangle", 0.05);
        tone(784, 0.2, "triangle", 0.05);
      } else if (kind === "boost") {
        crash();
        tone(220, 0.35, "sawtooth", 0.05);
        tone(440, 0.3, "triangle", 0.04);
      } else if (kind === "reinforce") {
        tone(740, 0.14, "square", 0.045);
        tone(520, 0.2, "square", 0.045);
      } else if (kind === "bust") {
        crash();
        tone(70, 0.4, "sawtooth", 0.06);
      }
    },
    suspend() {
      if (ctx && ctx.state === "running") void ctx.suspend();
    },
  };
}
