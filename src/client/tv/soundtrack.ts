// The TV's sound director: reads the game state and decides which ambience is playing and
// which cues fire. The engine (common/sound.ts) does the actual fading and mixing.
//
//   lobby, briefing   morning birds + a farm yard, before the start
//   draft             birds, drifting towards the forest
//   team              workshop: forest, a spinning wheel, now and then a wrench
//   race              a bed per stage (coast, mountains, countryside) + peloton + soft crowd
//   resolve           pedalling swells, rain turns into a downpour, crowd reacts to what happens
//   results, finished crowd, horn, fanfare
//
// The crowd stays low in the background and jumps up on silly or exciting moments.

import { terrainAt } from '../../shared/engine';
import type { PublicState } from '../../shared/types';
import { PRELOAD, sound } from '../common/sound';
import type { BedId, ShotId } from '../common/sound';

type Levels = Partial<Record<BedId, number>>;

const STAGE_BED: Record<number, Levels> = {
  1: { sea: 0.5 }, // flat opener along the coast
  2: { forest: 0.55 }, // the mountain stage
  3: { farm: 0.26, morning: 0.3 }, // final stage through the countryside
};
const HORN_CHANCE = 0.12;
const HORN_MIN_GAP = 5; // rounds
const BOOST_DECAY = 0.03; // per 250 ms

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Soundtrack {
  private prev: PublicState | null = null;
  private boost = 0;
  private lastReport = -1;
  private roundsSinceHorn = 99;
  private nextRandom = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private tick: ReturnType<typeof setInterval>;
  private off: () => void;
  private preloaded = false;

  constructor() {
    this.tick = setInterval(() => this.onTick(), 250);
    this.off = sound.onUnlock(() => {
      if (!this.preloaded && sound.unlocked) {
        this.preloaded = true;
        void sound.preload(PRELOAD);
      }
      this.apply(1.5);
    });
  }

  destroy(): void {
    clearInterval(this.tick);
    this.off();
    this.timers.forEach(clearTimeout);
  }

  update(s: PublicState): void {
    const p = this.prev;
    this.prev = s;
    if (p) this.react(p, s);
    this.apply(4);
  }

  // ---- the mix ------------------------------------------------------------------

  private levels(s: PublicState): Levels {
    const ev = s.event?.id;
    switch (s.phase) {
      case 'lobby':
      case 'briefing':
        return { morning: 0.55, farm: 0.22 };
      case 'recruit':
      case 'naming':
      case 'draft':
        return { morning: 0.38, forest: 0.22, farm: 0.1 };
      case 'team':
        return { forest: 0.45, wheel: 0.14, morning: 0.12 };
      case 'finished':
        return { crowd: Math.min(1, 0.5 + this.boost * 0.4), morning: 0.28 };
      case 'results':
        return { crowd: Math.min(1, 0.38 + this.boost * 0.5), morning: 0.22, forest: 0.12 };
    }
    const resolving = s.phase === 'resolve';
    const wet = ev === 'rain' || ev === 'storm' || s.weather === 'rain';
    const out: Levels = {};
    for (const [id, v] of Object.entries(STAGE_BED[s.stage] ?? STAGE_BED[1])) out[id as BedId] = v * (wet ? 0.5 : 1);
    out.pedal = resolving ? 0.5 : 0.14;
    out.crowd = Math.min(1, 0.2 + (ev === 'crowd' ? 0.25 : 0) + (resolving ? 0.08 : 0) + this.boost * 0.75);
    if (wet) {
      out.rain = resolving ? 0 : 0.55;
      out.storm = resolving ? 0.7 : 0;
    }
    if (ev === 'tailwind') out.wind = 0.3;
    if (ev === 'headwind') out.wind = 0.45;
    if (ev === 'crosswind') out.wind = 0.55;
    return out;
  }

  private apply(fade: number): void {
    if (this.prev) sound.scene(this.levels(this.prev), fade);
  }

  private bump(v: number): void {
    this.boost = Math.max(this.boost, v);
    this.apply(0.7);
  }

  private later(ms: number, f: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      f();
    }, ms);
    this.timers.add(t);
  }

  private onTick(): void {
    const s = this.prev;
    if (!s) return;
    if (this.boost > 0) {
      this.boost = Math.max(0, this.boost - BOOST_DECAY);
      this.apply(1.6);
    }
    const now = Date.now();
    if (now < this.nextRandom || !sound.unlocked) return;
    // Sparse, random details that make the bed feel alive.
    if (s.phase === 'team') {
      void sound.shot('click', { gain: 0.5, offset: rand(0, 2.5), dur: 1.4, pan: rand(-0.6, 0.6) });
      this.nextRandom = now + rand(9000, 18000);
    } else if (
      (s.event?.id === 'rain' || s.event?.id === 'storm' || s.weather === 'rain') &&
      (s.phase === 'race' || s.phase === 'resolve')
    ) {
      void sound.excerpt('thunder', rand(5, 8), { gain: 0.55 });
      this.nextRandom = now + rand(14000, 28000);
    } else {
      this.nextRandom = now + 4000;
    }
  }

  // ---- cues ---------------------------------------------------------------------

  private react(p: PublicState, s: PublicState): void {
    if (!sound.unlocked) return;
    if (p.phase !== s.phase) this.enter(s);

    const newRound = s.phase === 'race' && (p.phase !== 'race' || p.round !== s.round);
    if (newRound) this.startRound(s);

    if (s.phase === 'resolve' && s.report && s.report.round !== this.lastReport) {
      this.lastReport = s.report.round;
      this.resolve(s);
    }

    // Small table sounds.
    if (s.phase === 'lobby' && p.teams.length !== s.teams.length) sound.ui(s.teams.length > p.teams.length ? 'join' : 'back');
    if (s.phase === 'draft') {
      const a = p.marketCards.map((c) => c.id).join();
      const b = s.marketCards.map((c) => c.id).join();
      if (a !== b) sound.ui('card');
      else if (p.draft?.currentTeamId !== s.draft?.currentTeamId) sound.ui('tick');
    }
    if (s.phase === 'team' || s.phase === 'race') {
      const was = p.teams.filter((t) => (s.phase === 'team' ? t.ready : t.locked)).length;
      const now = s.teams.filter((t) => (s.phase === 'team' ? t.ready : t.locked)).length;
      if (p.phase === s.phase && now > was) sound.ui('tick');
    }
  }

  private enter(s: PublicState): void {
    switch (s.phase) {
      case 'results':
        sound.ui('fanfare');
        void sound.shot('cheer', { gain: 0.7 });
        this.bump(0.8);
        break;
      case 'finished':
        sound.ui('fanfare');
        void sound.shot('cheer', { gain: 0.9 });
        this.later(500, () => sound.ui('horn'));
        this.later(2500, () => void sound.shot('cheer', { gain: 0.6, offset: 3, dur: 9 }));
        this.bump(1);
        break;
      case 'resolve':
      case 'race':
        break;
      default:
        sound.ui('whoosh');
    }
  }

  private startRound(s: PublicState): void {
    // A round begins: horn at the start of a stage, and only rarely later on.
    this.roundsSinceHorn++;
    const first = s.round <= 1;
    if (first || (this.roundsSinceHorn >= HORN_MIN_GAP && Math.random() < HORN_CHANCE)) {
      this.roundsSinceHorn = 0;
      this.later(first ? 200 : 900, () => sound.ui('horn'));
    } else {
      sound.ui('go');
    }
    const ev = s.event?.id;
    if (!ev) return;
    switch (ev) {
      case 'rain':
        this.later(900, () => void sound.excerpt('thunder', rand(6, 9), { gain: 0.6 }));
        break;
      case 'crowd':
        this.later(600, () => void sound.shot('cheer', { gain: 0.8 }));
        this.bump(0.9);
        break;
      case 'chicken':
        this.later(800, () => void sound.shot('shout', { gain: 0.9, pan: [-0.7, 0.7] }));
        this.bump(0.7);
        break;
      case 'wrongTurn':
        this.later(700, () => void sound.shot('car', { gain: 0.9, pan: [0.9, -0.9] }));
        this.bump(0.5);
        break;
      case 'sandwich':
        this.later(700, () => sound.ui('pop'));
        this.bump(0.6);
        break;
      case 'feedzone':
        this.later(600, () => sound.ui('coin'));
        break;
      case 'tailwind':
        this.later(500, () => void sound.shot('pass-fast', { gain: 0.5, rate: 0.85 }));
        break;
      default:
        break;
    }
  }

  private resolve(s: PublicState): void {
    const r = s.report!;
    const lead = r.moves.find((m) => m.riderId === r.leaderRiderId);
    const cobbles = lead ? terrainAt(s, lead.to) === 'cobbles' : false;
    const pass: ShotId = cobbles ? 'pass-gravel' : 'pass-fast';
    void sound.shot(pass, { gain: 0.85, pan: [-0.8, 0.8] });
    if (r.moves.some((m) => m.effort === 'alles')) this.later(150, () => sound.ui('boom'));
    if (r.carRiderIds.length > 0) this.later(900, () => void sound.shot('car', { gain: 0.6, pan: [0.8, -0.8] }));
    for (const pl of r.plays) {
      this.later(1000, () => sound.ui(pl.item === 'blok' ? 'thunk' : 'pop'));
    }
    if (r.moves.some((m) => m.pech && !m.shielded)) {
      this.later(1500, () => sound.ui('slip'));
      this.later(2300, () => void sound.shot('click', { gain: 0.7, offset: rand(0, 2), dur: 1.6 }));
      this.bump(0.35);
    }
    if (r.moves.some((m) => m.exhausted)) this.later(2300, () => sound.ui('sigh'));
    if (r.premies.length > 0) {
      this.later(1900, () => {
        sound.ui('coin');
        void sound.shot('cheer', { gain: 0.6, offset: rand(0, 4), dur: 6 });
        this.bump(0.9);
      });
    }
    if (r.leaderRiderId !== r.prevLeaderRiderId) this.later(2600, () => this.bump(0.6));
    if (r.finished) {
      this.later(3000, () => {
        this.bump(1);
        void sound.shot('cheer', { gain: 0.9 });
      });
    }
  }
}
