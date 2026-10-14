// Audio engine shared by the TV and the phones (WebAudio).
//
//   beds  - looped ambience. Each bed has its own level; changing a level is always a smooth
//           fade, and a loop crosses over into itself, so scenes melt into each other.
//   shots - one-shot samples (thunder, cheers, a bike whooshing past) with optional pan sweep.
//   ui    - small sounds synthesized here, so they cost no downloads.
//
// Everything is a no-op until unlock() is called from a user gesture. The sample files are
// built by scripts/build-audio.py.

export type BedId = 'sea' | 'forest' | 'morning' | 'farm' | 'pedal' | 'rain' | 'storm' | 'wheel' | 'crowd' | 'wind';
export type ShotId = 'thunder' | 'cheer' | 'pass-gravel' | 'pass-fast' | 'car' | 'click' | 'shout';
export type UiId =
  | 'tap' | 'tick' | 'ok' | 'back' | 'error' | 'coin' | 'card' | 'whoosh' | 'turn' | 'ding'
  | 'count' | 'go' | 'join' | 'fanfare' | 'pop' | 'thunk' | 'slip' | 'sigh' | 'boom' | 'horn';

const FILE_BASE = '/audio/';
const XFADE = 2.5; // seconds a loop overlaps itself
const MUTE_KEY = 'pp-muted';
const DUCK = 0.4; // bed + sample level while the commentators talk

const curve = (fn: (x: number) => number) => Float32Array.from({ length: 64 }, (_, i) => fn(i / 63));
const FADE_IN = curve((x) => Math.sin((x * Math.PI) / 2));
const FADE_OUT = curve((x) => Math.cos((x * Math.PI) / 2));

interface ShotOpts {
  gain?: number;
  rate?: number;
  pan?: number | [number, number]; // a pair sweeps from -> to over the clip
  offset?: number;
  dur?: number; // play only this much of the file
  delay?: number;
}

interface ToneOpts {
  at?: number; // seconds from now
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  slideTo?: number;
  attack?: number;
  vibrato?: number;
}

class Bed {
  target = 0;
  private level: GainNode | null = null;
  private entry: AudioNode | null = null; // where the loop sources plug in
  private running = false;
  private lfo: OscillatorNode | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;
  private sources = new Set<AudioBufferSourceNode>();

  constructor(
    private eng: Engine,
    private id: BedId,
  ) {}

  /** Move towards `target` over about `fade` seconds. */
  apply(fade: number): void {
    const ctx = this.eng.ctx;
    if (!ctx) return;
    clearTimeout(this.stopTimer);
    if (this.target > 0.001 && !this.running) void this.start();
    if (this.level) {
      const now = ctx.currentTime;
      this.level.gain.cancelScheduledValues(now);
      this.level.gain.setValueAtTime(this.level.gain.value, now);
      this.level.gain.setTargetAtTime(this.target, now, Math.max(0.05, fade / 3));
    }
    if (this.target <= 0.001 && this.running) {
      this.stopTimer = setTimeout(() => this.stop(), (fade + 1.5) * 1000);
    }
  }

  private build(ctx: AudioContext): void {
    this.level = ctx.createGain();
    this.level.gain.value = 0;
    this.level.connect(this.eng.bedBus);
    if (this.id !== 'wind') {
      this.entry = this.level;
      return;
    }
    // Wind is noise through a band-pass whose level drifts slowly up and down.
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 420;
    band.Q.value = 0.6;
    const am = ctx.createGain();
    am.gain.value = 0.65;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.16;
    const depth = ctx.createGain();
    depth.gain.value = 0.35;
    lfo.connect(depth).connect(am.gain);
    lfo.start();
    this.lfo = lfo;
    band.connect(am).connect(this.level);
    this.entry = band;
  }

  private async start(): Promise<void> {
    const ctx = this.eng.ctx;
    if (!ctx) return;
    this.running = true;
    if (!this.level) this.build(ctx);
    const buf = await this.eng.bedBuffer(this.id);
    if (!buf || !this.running) return;
    const x = Math.min(XFADE, buf.duration / 4);
    const offset = Math.random() * (buf.duration - 3 * x);
    this.spawn(buf, ctx.currentTime + 0.05, offset, false, x);
  }

  private spawn(buf: AudioBuffer, when: number, offset: number, fadeIn: boolean, x: number): void {
    const ctx = this.eng.ctx;
    if (!ctx || !this.running || !this.entry) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    src.connect(g).connect(this.entry);
    if (fadeIn) g.gain.setValueCurveAtTime(FADE_IN, when, x);
    const end = when + (buf.duration - offset);
    const crossAt = end - x;
    g.gain.setValueCurveAtTime(FADE_OUT, crossAt, x);
    src.start(when, offset);
    src.stop(end + 0.05);
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
    // The next pass starts while this one fades out.
    const lead = Math.max(0, (crossAt - ctx.currentTime - 1) * 1000);
    this.timer = setTimeout(() => this.spawn(buf, crossAt, 0, true, x), lead);
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
    clearTimeout(this.stopTimer);
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    this.sources.clear();
    try {
      this.lfo?.stop();
    } catch {
      // already stopped
    }
    this.lfo = null;
    this.level?.disconnect();
    this.level = null;
    this.entry = null;
  }
}

class Engine {
  ctx: AudioContext | null = null;
  bedBus!: GainNode;
  private master!: GainNode;
  private duckBus!: GainNode;
  private fxBus!: GainNode;
  private uiBus!: GainNode;
  private noise: AudioBuffer | null = null;
  private files = new Map<string, Promise<AudioBuffer | null>>();
  private beds = new Map<BedId, Bed>();
  private listeners = new Set<() => void>();
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      // private mode: just not remembered
    }
  }

  get unlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Call from a click or keypress. Safe to call repeatedly. */
  unlock(): boolean {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        this.wire(this.ctx);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      return false;
    }
    for (const bed of this.beds.values()) if (bed.target > 0) bed.apply(1.5);
    this.listeners.forEach((f) => f());
    return true;
  }

  /** Called when audio becomes available, so a scene can re-apply itself. */
  onUnlock(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private wire(ctx: AudioContext): void {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.005;
    limiter.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(limiter).connect(ctx.destination);
    this.duckBus = ctx.createGain();
    this.duckBus.connect(this.master);
    this.bedBus = ctx.createGain();
    this.bedBus.connect(this.duckBus);
    this.fxBus = ctx.createGain();
    this.fxBus.connect(this.duckBus);
    this.uiBus = ctx.createGain();
    this.uiBus.gain.value = 0.55;
    this.uiBus.connect(this.master);
    // A second of looped white noise, softened a bit; reused for wind, whooshes and pops.
    const len = ctx.sampleRate;
    const nb = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = nb.getChannelData(c);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = last * 0.55 + (Math.random() * 2 - 1) * 0.45;
        d[i] = last;
      }
    }
    this.noise = nb;
  }

  setMuted(on: boolean): void {
    this.muted = on;
    try {
      localStorage.setItem(MUTE_KEY, on ? '1' : '0');
    } catch {
      // ignore
    }
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0 : 1, this.ctx.currentTime, 0.1);
    this.listeners.forEach((f) => f());
  }

  // ---- loading ----------------------------------------------------------------

  private load(name: string): Promise<AudioBuffer | null> {
    let p = this.files.get(name);
    if (!p) {
      p = (async () => {
        try {
          const res = await fetch(`${FILE_BASE}${name}.mp3`);
          if (!res.ok) return null;
          return await this.ctx!.decodeAudioData(await res.arrayBuffer());
        } catch {
          return null;
        }
      })();
      this.files.set(name, p);
    }
    return p;
  }

  /** Start fetching samples early so a scene change never waits on the network. */
  async preload(names: string[]): Promise<void> {
    if (!this.ctx) return;
    for (const n of names) await this.load(n);
  }

  async bedBuffer(id: BedId): Promise<AudioBuffer | null> {
    if (id === 'wind') {
      // Several seconds of the noise, so the loop point is inaudible once it is band-passed.
      const ctx = this.ctx!;
      const out = ctx.createBuffer(2, ctx.sampleRate * 8, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = out.getChannelData(c);
        let last = 0;
        for (let i = 0; i < d.length; i++) {
          last = last * 0.9 + (Math.random() * 2 - 1) * 0.1;
          d[i] = last * 3;
        }
      }
      return out;
    }
    return this.load(id);
  }

  // ---- beds -------------------------------------------------------------------

  /** Fade a bed to `gain` (0 = off) over about `fade` seconds. */
  bed(id: BedId, gain: number, fade = 4): void {
    let b = this.beds.get(id);
    if (!b) this.beds.set(id, (b = new Bed(this, id)));
    if (Math.abs(b.target - gain) < 0.002) return;
    b.target = gain;
    b.apply(fade);
  }

  /** Fade every bed that isn't in `levels`, set the ones that are. */
  scene(levels: Partial<Record<BedId, number>>, fade = 4): void {
    const ids = new Set<BedId>([...this.beds.keys(), ...(Object.keys(levels) as BedId[])]);
    for (const id of ids) this.bed(id, levels[id] ?? 0, fade);
  }

  /** Lower beds and samples while someone is talking. */
  duck(on: boolean): void {
    if (!this.ctx) return;
    this.duckBus.gain.setTargetAtTime(on ? DUCK : 1, this.ctx.currentTime, 0.3);
  }

  // ---- shots ------------------------------------------------------------------

  async shot(id: ShotId, o: ShotOpts = {}): Promise<void> {
    if (!this.ctx) return;
    const buf = await this.load(id);
    const ctx = this.ctx;
    if (!buf || !ctx) return;
    const when = ctx.currentTime + (o.delay ?? 0.02);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = o.rate ?? 1;
    const g = ctx.createGain();
    const offset = Math.min(o.offset ?? 0, Math.max(0, buf.duration - 0.2));
    const len = Math.min(o.dur ?? buf.duration - offset, buf.duration - offset) / (o.rate ?? 1);
    const peak = o.gain ?? 1;
    const edge = Math.min(0.6, len / 3);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + (o.dur ? edge : 0.03));
    g.gain.setValueAtTime(peak, Math.max(when + 0.04, when + len - edge));
    g.gain.linearRampToValueAtTime(0, when + len);
    src.connect(g);
    if (o.pan !== undefined) {
      const p = ctx.createStereoPanner();
      const [a, b] = Array.isArray(o.pan) ? o.pan : [o.pan, o.pan];
      p.pan.setValueAtTime(a, when);
      p.pan.linearRampToValueAtTime(b, when + len);
      g.connect(p).connect(this.fxBus);
    } else {
      g.connect(this.fxBus);
    }
    src.start(when, offset, len * (o.rate ?? 1));
  }

  /** A random stretch of a long file (thunder claps, farm noises). */
  async excerpt(id: ShotId, seconds: number, o: ShotOpts = {}): Promise<void> {
    if (!this.ctx) return;
    const buf = await this.load(id);
    if (!buf) return;
    const offset = Math.random() * Math.max(0, buf.duration - seconds);
    return this.shot(id, { ...o, offset, dur: seconds });
  }

  // ---- synthesized sounds -----------------------------------------------------

  private tone(freq: number, o: ToneOpts = {}, bus: AudioNode = this.uiBus): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.01 + (o.at ?? 0);
    const dur = o.dur ?? 0.15;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + dur);
    const g = ctx.createGain();
    const peak = o.gain ?? 0.3;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack ?? 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(bus);
    if (o.vibrato) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 6;
      const d = ctx.createGain();
      d.gain.value = o.vibrato;
      lfo.connect(d).connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.05);
    }
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private burst(
    o: { at?: number; dur?: number; type?: BiquadFilterType; from: number; to?: number; q?: number; gain?: number },
    bus: AudioNode = this.uiBus,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const t0 = ctx.currentTime + 0.01 + (o.at ?? 0);
    const dur = o.dur ?? 0.15;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.Q.value = o.q ?? 1.2;
    f.frequency.setValueAtTime(o.from, t0);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    const g = ctx.createGain();
    const peak = o.gain ?? 0.4;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.02, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t0, Math.random() * 0.8);
    src.stop(t0 + dur + 0.05);
  }

  private bell(freq: number, at = 0, gain = 0.3, dur = 0.9): void {
    this.tone(freq, { at, dur, gain, attack: 0.004 });
    this.tone(freq * 2.01, { at, dur: dur * 0.6, gain: gain * 0.35, attack: 0.004 });
    this.tone(freq * 3.02, { at, dur: dur * 0.35, gain: gain * 0.15, attack: 0.004 });
  }

  /** An air horn: a chord of buzzy saws with a quick pitch bend, played as toot-toot-tooot. */
  private horn(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const shape = ctx.createWaveShaper();
    shape.curve = Float32Array.from({ length: 256 }, (_, i) => Math.tanh(((i / 255) * 2 - 1) * 3));
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3200;
    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 1100;
    body.gain.value = 6;
    shape.connect(tone).connect(body).connect(this.fxBus);
    const notes: [number, number][] = [
      [0, 0.26],
      [0.36, 0.26],
      [0.72, 0.95],
    ];
    const t = ctx.currentTime + 0.03;
    for (const [at, dur] of notes) {
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t + at);
      env.gain.exponentialRampToValueAtTime(0.28, t + at + 0.03);
      env.gain.setValueAtTime(0.28, t + at + dur - 0.06);
      env.gain.exponentialRampToValueAtTime(0.0001, t + at + dur + 0.05);
      env.connect(shape);
      for (const [f, det] of [[349, 0], [440, 5], [523, -4], [175, 3]] as const) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.detune.value = det;
        o.frequency.setValueAtTime(f * 0.93, t + at);
        o.frequency.exponentialRampToValueAtTime(f, t + at + 0.07);
        o.connect(env);
        o.start(t + at);
        o.stop(t + at + dur + 0.1);
      }
    }
  }

  ui(id: UiId): void {
    if (!this.ctx) return;
    switch (id) {
      case 'tap':
        this.tone(720, { dur: 0.05, gain: 0.22, type: 'triangle' });
        break;
      case 'tick':
        this.tone(1250, { dur: 0.03, gain: 0.16, type: 'triangle' });
        break;
      case 'ok':
        this.tone(523, { dur: 0.09, gain: 0.22, type: 'triangle' });
        this.tone(784, { at: 0.07, dur: 0.16, gain: 0.24, type: 'triangle' });
        break;
      case 'back':
        this.tone(520, { dur: 0.08, gain: 0.2, type: 'triangle' });
        this.tone(370, { at: 0.06, dur: 0.12, gain: 0.2, type: 'triangle' });
        break;
      case 'error':
        this.tone(170, { dur: 0.12, gain: 0.22, type: 'square' });
        this.tone(150, { at: 0.14, dur: 0.18, gain: 0.22, type: 'square' });
        break;
      case 'coin':
        this.tone(988, { dur: 0.07, gain: 0.16, type: 'square' });
        this.tone(1319, { at: 0.06, dur: 0.28, gain: 0.16, type: 'square' });
        break;
      case 'card':
        this.burst({ dur: 0.09, from: 1600, to: 5200, q: 0.9, gain: 0.28 });
        this.tone(300, { at: 0.07, dur: 0.05, gain: 0.12, type: 'triangle' });
        break;
      case 'whoosh':
        this.burst({ dur: 0.5, from: 250, to: 2600, q: 0.7, gain: 0.35 });
        break;
      case 'turn':
        this.bell(880, 0, 0.3, 0.8);
        this.bell(1319, 0.16, 0.28, 1.0);
        break;
      case 'ding':
        this.bell(1175, 0, 0.3, 0.9);
        break;
      case 'count':
        this.tone(1000, { dur: 0.07, gain: 0.25 });
        break;
      case 'go':
        this.tone(1500, { dur: 0.35, gain: 0.25, type: 'triangle' });
        this.tone(750, { dur: 0.35, gain: 0.15, type: 'triangle' });
        break;
      case 'join':
        for (const [i, f] of [440, 554, 659].entries()) this.tone(f, { at: i * 0.07, dur: 0.14, gain: 0.2, type: 'triangle' });
        break;
      case 'fanfare':
        for (const [i, f] of [523, 659, 784, 1047].entries()) {
          this.tone(f, { at: i * 0.13, dur: 0.22, gain: 0.2, type: 'sawtooth' });
        }
        for (const f of [523, 659, 784, 1047]) this.tone(f, { at: 0.55, dur: 0.9, gain: 0.12, type: 'sawtooth' });
        break;
      case 'pop':
        this.burst({ dur: 0.08, from: 2500, type: 'highpass', gain: 0.3 });
        this.tone(420, { dur: 0.1, gain: 0.25, slideTo: 140 });
        break;
      case 'thunk':
        this.tone(150, { dur: 0.22, gain: 0.45, slideTo: 48 });
        this.burst({ dur: 0.12, from: 500, type: 'lowpass', gain: 0.3 });
        break;
      case 'slip':
        this.burst({ dur: 0.55, from: 5200, to: 900, type: 'highpass', q: 0.5, gain: 0.3 }, this.fxBus);
        this.tone(620, { dur: 0.5, gain: 0.12, slideTo: 130, type: 'triangle' });
        break;
      case 'sigh':
        this.tone(440, { dur: 0.7, gain: 0.18, slideTo: 170, type: 'triangle', vibrato: 12 });
        break;
      case 'boom':
        this.tone(95, { dur: 0.5, gain: 0.5, slideTo: 38 });
        this.burst({ dur: 0.25, from: 700, type: 'lowpass', gain: 0.35 });
        break;
      case 'horn':
        this.horn();
        break;
    }
  }
}

export const sound = new Engine();

/** Cue names for the beds that need loading first, in the order a game uses them. */
export const PRELOAD = ['morning', 'farm', 'forest', 'wheel', 'sea', 'pedal', 'crowd', 'rain', 'storm', 'cheer', 'thunder', 'pass-fast', 'pass-gravel', 'car', 'click', 'shout'];
