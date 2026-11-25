import { useEffect, useRef, useState } from "react";
import { Banknote, Flame, Gauge, Navigation, Pause, RotateCcw, Volume2, VolumeX, Zap } from "lucide-react";
import type { GameApi, HudSnapshot } from "@/game/mount";
import type { InputState } from "@/game/sim";

const emptyHud: HudSnapshot = {
  phase: "menu",
  cash: 0,
  heat: 0,
  bags: 0,
  need: 3,
  best: 0,
  speed: 0,
  pop: "",
  level: 1,
  bestLevel: 0,
  nitro: 0,
  boosting: false,
  time: 0,
  near: 0,
  wrecks: 0,
  bonus: 0,
  cops: 0,
};

function clock(sec: number) {
  const m = Math.floor(sec / 60);
  const r = Math.floor(sec % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function grana(n: number) {
  return n.toLocaleString("pt-BR");
}

function Hold({
  label,
  tone,
  onPressed,
}: {
  label: string;
  tone: "gold" | "ash" | "siren";
  onPressed: (down: boolean) => void;
}) {
  const toneClass =
    tone === "gold"
      ? "bg-gold text-bg"
      : tone === "siren"
        ? "bg-siren text-fg"
        : "bg-surface text-fg border border-line";
  return (
    <button
      type="button"
      aria-label={label}
      className={`flex h-16 w-16 items-center justify-center rounded-2xl text-sm font-medium select-none ${toneClass}`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onPressed(true);
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        onPressed(false);
      }}
      onPointerCancel={() => onPressed(false)}
      onLostPointerCapture={() => onPressed(false)}
    >
      {label}
    </button>
  );
}

export function FugaGame() {
  const worldRef = useRef<HTMLDivElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const radarRef = useRef<HTMLCanvasElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<GameApi | null>(null);
  const pendingStart = useRef(false);
  const inputRef = useRef<InputState>({
    keys: new Set(),
    left: false,
    right: false,
    gas: false,
    brake: false,
    hand: false,
    boost: false,
  });
  const [hud, setHud] = useState<HudSnapshot>(emptyHud);
  const [muted, setMuted] = useState(false);
  const [booted, setBooted] = useState(false);
  const [fail, setFail] = useState("");

  useEffect(() => {
    const world = worldRef.current;
    const vignette = vignetteRef.current;
    const flash = flashRef.current;
    const radar = radarRef.current;
    const pop = popRef.current;
    const arrow = arrowRef.current;
    if (!world || !vignette || !flash || !radar || !pop || !arrow) return;
    let dead = false;
    let cleanup = () => {};
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void import("@/game/mount")
      .then((mod) => {
        if (dead) return;
        try {
          cleanup = mod.mount(world, {
            input: inputRef.current,
            api: apiRef,
            pendingStart,
            onHud: setHud,
            vignette,
            flash,
            radar,
            pop,
            arrow,
            reduced,
          });
          setBooted(true);
        } catch (err) {
          setFail(err instanceof Error ? err.message : "Falha ao abrir a noite.");
        }
      })
      .catch((err: unknown) => {
        setFail(err instanceof Error ? err.message : "Falha ao abrir a noite.");
      });
    return () => {
      dead = true;
      cleanup();
    };
  }, []);

  function start() {
    if (apiRef.current) {
      apiRef.current.unlock();
      apiRef.current.start();
    } else {
      pendingStart.current = true;
    }
  }

  function toggleMute() {
    if (!apiRef.current) {
      setMuted((v) => !v);
      return;
    }
    setMuted(apiRef.current.toggleMute());
  }

  const playing = hud.phase === "play" || hud.phase === "paused";
  const kmh = Math.round(Math.abs(hud.speed) * 7);

  return (
    <main className="game-shell fixed inset-0 overflow-hidden bg-bg text-fg select-none">
      <div ref={worldRef} className="absolute inset-0" />
      <div ref={vignetteRef} className="heat-vignette pointer-events-none absolute inset-0 opacity-0" />
      <div ref={flashRef} className="flash-wash pointer-events-none absolute inset-0 opacity-0" />
      <canvas
        ref={radarRef}
        width={180}
        height={180}
        aria-hidden
        className={
          playing
            ? "absolute top-3 left-3 z-20 size-24 rounded-2xl border border-line safe-top"
            : "pointer-events-none absolute size-0 opacity-0"
        }
      />

      <p
        ref={popRef}
        className="pointer-events-none absolute top-24 left-1/2 z-20 -translate-x-1/2 font-display text-2xl tracking-wide text-gold opacity-0"
      />

      <div className="pointer-events-none absolute top-36 left-1/2 z-20 -translate-x-1/2" aria-hidden>
        <div ref={arrowRef} className="text-gold opacity-0 transition-opacity">
          <Navigation className="size-7 fill-current" />
        </div>
      </div>

      {playing && (
        <header className="safe-top absolute inset-x-0 top-0 z-20 flex items-start justify-end gap-3 px-3 pb-3">
          <div className="flex min-w-0 flex-1 flex-col items-end gap-1.5">
            <p className="flex items-center gap-1.5 font-display text-xl tracking-wide text-gold">
              <Banknote className="size-4" aria-hidden />
              {grana(hud.cash)}
            </p>
            <p className="flex items-center gap-2 text-xs text-muted">
              <Flame className="size-3.5 text-siren" aria-hidden />
              <span className="sr-only">Calor</span>
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-line">
                <span className="block h-full bg-siren" style={{ width: `${Math.round(hud.heat)}%` }} />
              </span>
            </p>
            <p className="flex items-center gap-2 text-xs text-muted">
              <Zap className={`size-3.5 ${hud.boosting ? "text-fg" : "text-gold"}`} aria-hidden />
              <span className="sr-only">Nitro</span>
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-line">
                <span
                  className={`block h-full ${hud.boosting ? "bg-fg" : hud.nitro >= 0.3 ? "bg-gold" : "bg-muted"}`}
                  style={{ width: `${hud.boosting ? 100 : Math.round(hud.nitro * 100)}%` }}
                />
              </span>
            </p>
            <p className="text-xs tracking-wide text-fg">
              Noite {hud.level} · Malas {hud.bags}/{hud.need} · {clock(hud.time)}
            </p>
            <p className="flex items-center gap-1 text-xs text-muted">
              <Gauge className="size-3.5" aria-hidden />
              {kmh} km/h · {hud.cops} viaturas
            </p>
          </div>
          <button
            type="button"
            aria-label="Pausar"
            className="flex size-12 items-center justify-center rounded-2xl border border-line bg-surface text-fg"
            onClick={() => apiRef.current?.pause()}
          >
            <Pause className="size-5" />
          </button>
        </header>
      )}

      {hud.phase === "menu" && (
        <section className="absolute inset-0 z-30 flex flex-col justify-end p-4 sm:p-8">
          <div className="mx-auto w-full max-w-md rounded-2xl border border-line bg-surface/95 p-5">
            <div className="mb-4 h-px w-10 bg-gold" />
            <p className="text-xs tracking-widest text-gold">DISTRITO 13</p>
            <h1 className="font-display text-6xl leading-none tracking-wide text-fg">FUGA</h1>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
              Três malas de ouro. Um cais no fim do mapa. Se o calor encher, a noite fica com você.
            </p>
            <button
              type="button"
              className="mt-5 h-12 w-full rounded-2xl bg-gold font-display text-lg tracking-wide text-bg"
              onClick={start}
            >
              Ligar o motor
            </button>
            <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted">
              <p>
                Recorde {grana(hud.best)}
                {hud.bestLevel > 0 ? ` · Noite ${hud.bestLevel}` : ""}
              </p>
              <button type="button" className="flex size-11 items-center justify-center rounded-xl border border-line text-fg" aria-label={muted ? "Ligar som" : "Mutar"} onClick={toggleMute}>
                {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              </button>
            </div>
            <p className="mt-3 hidden text-xs leading-relaxed text-muted fine:block">
              W acelera, S freia, A e D viram, Espaço é o freio de mão. Derrape com o freio de mão para
              carregar o nitro e solte (ou aperte Shift) para disparar. Nitro em cima de viatura derruba ela.
            </p>
            <p className="mt-3 text-xs leading-relaxed text-muted coarse:block hidden">
              Segure os pedais. Derrape com Mão para carregar o nitro e solte para disparar, ou use Nitro. Nitro em cima de viatura derruba ela.
            </p>
            {!booted && !fail && <p className="mt-2 text-xs text-muted">Abrindo o distrito…</p>}
            {fail && <p className="mt-2 text-xs text-siren">{fail}</p>}
          </div>
        </section>
      )}

      {hud.phase === "paused" && (
        <section className="absolute inset-0 z-30 flex items-end justify-center p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface/95 p-5 text-center">
            <h2 className="font-display text-4xl tracking-wide">PAUSA</h2>
            <p className="mt-2 text-sm text-muted">O motor ficou ligado. A sirene, não.</p>
            <button
              type="button"
              className="mt-5 h-12 w-full rounded-2xl bg-gold font-display text-lg tracking-wide text-bg"
              onClick={() => apiRef.current?.pause()}
            >
              Voltar pra rua
            </button>
          </div>
        </section>
      )}

      {(hud.phase === "busted" || hud.phase === "escaped") && (
        <section className="absolute inset-0 z-30 flex items-end justify-center p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface/95 p-5">
            <p className="text-xs tracking-widest text-gold">
              {hud.phase === "escaped" ? `NOITE ${hud.level} · CAIS` : `NOITE ${hud.level} · DISTRITO`}
            </p>
            <h2 className="font-display text-5xl leading-none tracking-wide">
              {hud.phase === "escaped" ? "SUMIU" : "PRESO"}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              {hud.phase === "escaped"
                ? "O cais engoliu o carro. A placa não existe mais."
                : "A grana da noite ficou na rua. O calor chegou antes de você."}
            </p>
            <p className="mt-4 font-display text-3xl text-gold">{grana(hud.cash)}</p>
            <p className="text-xs text-muted">
              Recorde {grana(hud.best)} · {clock(hud.time)} · {hud.near} raspões · {hud.wrecks} viaturas derrubadas
              {hud.phase === "escaped" ? ` · bônus ${grana(hud.bonus)}` : ""}
            </p>
            {hud.phase === "escaped" ? (
              <>
                <button
                  type="button"
                  className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gold font-display text-lg tracking-wide text-bg"
                  onClick={() => apiRef.current?.next()}
                >
                  Noite {hud.level + 1}
                </button>
                <button
                  type="button"
                  className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-line text-sm text-fg"
                  onClick={() => apiRef.current?.restart()}
                >
                  <RotateCcw className="size-4" />
                  Recomeçar do zero
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gold font-display text-lg tracking-wide text-bg"
                  onClick={() => apiRef.current?.retry()}
                >
                  <RotateCcw className="size-4" />
                  De novo, noite {hud.level}
                </button>
                {hud.level > 1 && (
                  <button
                    type="button"
                    className="mt-2 flex h-11 w-full items-center justify-center rounded-2xl border border-line text-sm text-fg"
                    onClick={() => apiRef.current?.restart()}
                  >
                    Recomeçar do zero
                  </button>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {hud.phase === "play" && (
        <div className="absolute inset-x-0 bottom-0 z-20 hidden items-end justify-between p-3 pb-4 coarse:flex">
          <div className="flex gap-2">
            <Hold label="Esq" tone="ash" onPressed={(v) => (inputRef.current.left = v)} />
            <Hold label="Dir" tone="ash" onPressed={(v) => (inputRef.current.right = v)} />
          </div>
          <div className="flex gap-2">
            <Hold label="Nitro" tone="gold" onPressed={(v) => (inputRef.current.boost = v)} />
            <Hold label="Mão" tone="siren" onPressed={(v) => (inputRef.current.hand = v)} />
            <Hold label="Freio" tone="ash" onPressed={(v) => (inputRef.current.brake = v)} />
            <Hold label="Gás" tone="gold" onPressed={(v) => (inputRef.current.gas = v)} />
          </div>
        </div>
      )}
    </main>
  );
}
