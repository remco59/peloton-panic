// Pixel-art track renderer. Draws at a low internal resolution; CSS scales it up
// with image-rendering: pixelated. All sprites are drawn procedurally and recoloured per team.

import { TEAM_COLORS } from '../../shared/content';
import { terrainAt } from '../../shared/engine';
import type { PublicState, Rider, Terrain } from '../../shared/types';

export const W = 480;
export const H = 270;
const TW = 30; // pixels per tile
const LANES = 6;
const LANE_H = 11;
const BAND = LANES * LANE_H;
const BASE_Y = 160; // road centre line at the camera tile
const SLOPE = 7; // px of elevation per climbing / descending tile
const ANIM_MS = 3600;

const SKY = ['#5bb6ec', '#6cc0f0', '#7ec8f2', '#92d2f5', '#a8dcf7', '#bfe6f9'];

function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

export class TrackRenderer {
  private ctx: CanvasRenderingContext2D;
  private state: PublicState | null = null;
  private elev: number[] = [0];
  private disp = new Map<string, number>();
  private animStart = 0;
  private animRound = -1;
  private camX = 0;
  private raf = 0;
  private chicken = { active: false, start: 0 };
  private lastEventKey = '';

  constructor(private canvas: HTMLCanvasElement) {
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }

  setState(s: PublicState) {
    const prev = this.state;
    this.state = s;
    if (!prev || prev.terrain.length !== s.terrain.length || prev.terrain.some((t, i) => t !== s.terrain[i])) {
      this.elev = [0];
      for (const t of s.terrain) {
        const last = this.elev[this.elev.length - 1];
        this.elev.push(last + (t === 'climb' ? SLOPE : t === 'descent' ? -SLOPE : 0));
      }
    }
    if (s.phase === 'resolve' && s.report && s.report.round !== this.animRound) {
      this.animRound = s.report.round;
      this.animStart = performance.now();
    }
    if (s.phase === 'lobby') {
      this.animRound = -1;
      this.disp.clear();
    }
    const key = `${s.round}:${s.event?.id ?? ''}`;
    if (key !== this.lastEventKey) {
      this.lastEventKey = key;
      if (s.event?.id === 'chicken' && s.phase === 'play') this.chicken = { active: true, start: performance.now() };
    }
  }

  private elevAt(t: number): number {
    const n = this.elev.length - 1;
    if (t <= 0) return 0;
    if (t >= n) return this.elev[n];
    const i = Math.floor(t);
    return this.elev[i] + (this.elev[i + 1] - this.elev[i]) * (t - i);
  }

  private displayPos(r: Rider, now: number, idx: number): number {
    const s = this.state!;
    if (s.phase === 'resolve' && s.report) {
      const m = s.report.moves.find((x) => x.riderId === r.id);
      if (m) {
        const t = (now - this.animStart - idx * 45) / ANIM_MS;
        return m.from + (m.to - m.from) * ease(t);
      }
    }
    return r.pos;
  }

  private loop(now: number) {
    this.raf = requestAnimationFrame(this.loop);
    if (this.state) this.draw(now);
  }

  private draw(now: number) {
    const s = this.state!;
    const ctx = this.ctx;
    const colors = s.teams.map((t) => TEAM_COLORS[t.color % TEAM_COLORS.length]);
    const laneOffset = Math.floor((LANES - Math.max(1, s.teams.length)) / 2);

    // Positions and camera.
    const positions = s.riders.map((r, i) => this.displayPos(r, now, i));
    const lead = positions.length ? Math.max(...positions) : 0;
    const last = positions.length ? Math.min(...positions) : 0;
    const mid = (lead + last) / 2;
    const target = Math.min(lead - 2, Math.max(lead - 6, mid));
    this.camX += (target - this.camX) * 0.06;
    const camX = this.camX;
    const camElev = this.elevAt(camX);
    const wx = (t: number) => Math.round(W / 2 + (t - camX) * TW);
    const roadY = (t: number) => Math.round(BASE_Y - (this.elevAt(t) - camElev));

    // Sky.
    SKY.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(0, i * 24, W, 24);
    });
    ctx.fillStyle = '#fff3a8';
    ctx.fillRect(392, 20, 20, 20);
    ctx.fillStyle = '#ffe36b';
    ctx.fillRect(396, 24, 12, 12);

    // Parallax mountains and hills.
    this.drawRidge(camX * 0.15, 60, 38, '#8aa6cf', 0.06, camElev * 0.15);
    this.drawRidge(camX * 0.35, 90, 24, '#6f9d77', 0.1, camElev * 0.35);

    // Ground, road, edges.
    for (let sx = 0; sx < W; sx += 2) {
      const t = camX + (sx + 1 - W / 2) / TW;
      const y = roadY(t);
      const ter = terrainAt(s, Math.max(0, Math.min(s.trackLength - 0.001, t)));
      ctx.fillStyle = '#4f9a4f';
      ctx.fillRect(sx, y - BAND / 2 - 8, 2, H);
      ctx.fillStyle = '#5db25a';
      ctx.fillRect(sx, y - BAND / 2 - 8, 2, 3);
      ctx.fillStyle = ter === 'cobbles' ? '#7d6a58' : '#5d5f69';
      ctx.fillRect(sx, y - BAND / 2, 2, BAND);
      if (ter === 'cobbles') {
        ctx.fillStyle = '#5c4c3d';
        const k = Math.floor(sx / 2);
        for (let ly = 0; ly < BAND; ly += 4) if ((k + ly / 4) % 2 === 0) ctx.fillRect(sx, y - BAND / 2 + ly, 2, 2);
      }
      const edge =
        ter === 'climb' ? '#ff9f43' : ter === 'descent' ? '#54a0ff' : ter === 'cobbles' ? '#a68a64' : '#f1f1f1';
      ctx.fillStyle = edge;
      ctx.fillRect(sx, y - BAND / 2 - 2, 2, 2);
      ctx.fillRect(sx, y + BAND / 2, 2, 2);
      // Tile boundary ticks.
      const frac = t - Math.floor(t);
      if (frac < 2 / TW) {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(sx, y - BAND / 2, 1, BAND);
      }
    }

    // Spectators and tile signs.
    const firstTile = Math.floor(camX - W / 2 / TW) - 1;
    const lastTile = Math.ceil(camX + W / 2 / TW) + 1;
    for (let t = firstTile; t <= lastTile; t++) {
      if (t < 0 || t >= s.trackLength) continue;
      const x0 = wx(t);
      const y = roadY(t + 0.5);
      const ter = s.terrain[t];
      for (let k = 0; k < 4; k++) {
        const hx = x0 + 3 + k * 7 + Math.floor(hash(t * 7 + k) * 3);
        const bob = Math.sin(now / 220 + hash(t * 13 + k) * 6.28) > 0.2 ? 1 : 0;
        const col = ['#ff6b6b', '#ffd23f', '#5eea8d', '#c792ea', '#ffffff', '#ff9f43'][Math.floor(hash(t * 31 + k) * 6)];
        this.person(hx, y - BAND / 2 - 6 - bob, col);
        if (hash(t * 17 + k) > 0.35) this.person(hx + 2, y + BAND / 2 + 9 - bob, col);
      }
      if (ter === 'climb' && t % 2 === 0) this.sign(x0 + 14, y - BAND / 2 - 16, '#ff9f43');
      if (ter === 'descent' && t % 2 === 0) this.sign(x0 + 14, y - BAND / 2 - 16, '#54a0ff');
      if (ter === 'cobbles' && t % 2 === 0) this.sign(x0 + 14, y - BAND / 2 - 16, '#a68a64');
    }

    // Start and finish banners.
    this.banner(wx(0), roadY(0), 'START', '#f6f1e4', false);
    this.banner(wx(s.trackLength), roadY(s.trackLength), 'FINISH', '#ffffff', true);

    // Riders, back lanes first so nearer lanes draw on top.
    const order = s.riders
      .map((r, i) => ({ r, i, pos: positions[i] }))
      .sort((a, b) => {
        const la = s.teams.findIndex((t) => t.id === a.r.teamId);
        const lb = s.teams.findIndex((t) => t.id === b.r.teamId);
        return la - lb || a.i - b.i;
      });
    const leaderIdx = positions.indexOf(lead);
    const resolving = s.phase === 'resolve' && !!s.report;
    const progress = resolving ? Math.min(1, (now - this.animStart) / ANIM_MS) : 0;
    for (const { r, i, pos } of order) {
      const ti = s.teams.findIndex((t) => t.id === r.teamId);
      const col = colors[ti] ?? TEAM_COLORS[0];
      const sx = wx(pos) + ((i % 3) - 1) * 2;
      const laneY = (ti + laneOffset) * LANE_H + LANE_H / 2 - BAND / 2;
      const sy = roadY(pos) + Math.round(laneY);
      const moving = resolving && progress < 1;
      const phase = now / (moving ? 70 : 240) + i * 1.7;
      if (sx < -14) {
        this.offscreenMarker(0, sy, col.hex, true);
        continue;
      }
      if (sx > W + 14) {
        this.offscreenMarker(W, sy, col.hex, false);
        continue;
      }
      this.cyclist(sx, sy, col.hex, col.dark, phase, i === leaderIdx);
      if (resolving && s.report) {
        const m = s.report.moves.find((x) => x.riderId === r.id);
        if (m && progress > 0.55) {
          const d = m.to - m.from;
          this.text(`+${d}`, sx - 4, sy - 22 - Math.round((progress - 0.55) * 12), m.coasted ? '#98a2cc' : '#fff');
          if (m.windPaid) this.text('z', sx + 8, sy - 26, '#ffd23f');
        }
      }
    }

    this.weather(now, s);
    this.chickenRun(now);
  }

  private drawRidge(offset: number, baseY: number, amp: number, color: string, freq: number, lift: number) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    for (let sx = 0; sx < W; sx += 2) {
      const x = sx + offset * TW;
      const h =
        Math.sin(x * freq) * amp * 0.5 +
        Math.sin(x * freq * 2.3 + 1.7) * amp * 0.3 +
        Math.sin(x * freq * 0.5 + 0.4) * amp * 0.4;
      const top = Math.round(baseY - amp / 2 - h + lift);
      ctx.fillRect(sx, top, 2, H);
    }
  }

  private person(x: number, y: number, color: string) {
    const c = this.ctx;
    c.fillStyle = '#f2c9a0';
    c.fillRect(x, y - 4, 2, 2);
    c.fillStyle = color;
    c.fillRect(x, y - 2, 2, 3);
  }

  private sign(x: number, y: number, color: string) {
    const c = this.ctx;
    c.fillStyle = '#3b3b45';
    c.fillRect(x + 2, y + 2, 1, 8);
    c.fillStyle = color;
    c.fillRect(x, y - 2, 5, 5);
  }

  private banner(x: number, y: number, label: string, color: string, checkered: boolean) {
    if (x < -40 || x > W + 40) return;
    const c = this.ctx;
    const top = y - BAND / 2 - 18;
    const bottom = y + BAND / 2;
    c.fillStyle = '#2b2d3a';
    c.fillRect(x - 1, top, 3, bottom - top + 4);
    c.fillRect(x - 1 + 0, top, 3, 4);
    c.fillStyle = color;
    c.fillRect(x - 24, top - 4, 50, 11);
    if (checkered) {
      for (let i = 0; i < 25; i++) {
        c.fillStyle = i % 2 ? '#111' : '#fff';
        c.fillRect(x - 24 + i * 2, top - 4, 2, 5);
        c.fillStyle = i % 2 ? '#fff' : '#111';
        c.fillRect(x - 24 + i * 2, top + 1, 2, 5);
      }
      for (let ly = 0; ly < BAND; ly += 4) {
        c.fillStyle = (ly / 4) % 2 ? '#111' : '#fff';
        c.fillRect(x, y - BAND / 2 + ly, 3, 4);
      }
    } else {
      c.fillStyle = '#2b2d3a';
      c.font = '6px "Press Start 2P", monospace';
      c.fillText(label, x - 20, top + 4);
    }
  }

  private offscreenMarker(x: number, y: number, color: string, left: boolean) {
    const c = this.ctx;
    c.fillStyle = color;
    const x0 = left ? 2 : W - 6;
    c.fillRect(x0, y - 2, 4, 4);
    c.fillStyle = '#000';
    c.fillRect(left ? 0 : W - 2, y - 1, 2, 2);
    void x;
  }

  private text(s: string, x: number, y: number, color: string) {
    const c = this.ctx;
    c.font = '8px "Press Start 2P", monospace';
    c.fillStyle = '#000';
    c.fillText(s, x + 1, y + 1);
    c.fillStyle = color;
    c.fillText(s, x, y);
  }

  private cyclist(x: number, y: number, jersey: string, dark: string, phase: number, leader: boolean) {
    const c = this.ctx;
    const px = (a: number, b: number, col: string, w = 1, h = 1) => {
      c.fillStyle = col;
      c.fillRect(Math.round(a), Math.round(b), w, h);
    };
    const line = (x0: number, y0: number, x1: number, y1: number, col: string) => {
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 1;
      for (let i = 0; i <= steps; i++) {
        const t = steps === 0 ? 0 : i / steps;
        px(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, col);
      }
    };
    const ring = (cx: number, cy: number, r: number, col: string) => {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const d = Math.hypot(dx, dy);
          if (d >= r - 0.6 && d <= r + 0.4) px(cx + dx, cy + dy, col);
        }
    };
    // Shadow, wheels, frame.
    px(x - 9, y, 'rgba(0,0,0,0.25)', 19, 1);
    ring(x - 6, y - 3, 3, '#1b1b22');
    ring(x + 6, y - 3, 3, '#1b1b22');
    px(x - 6, y - 3, '#c8c8d0');
    px(x + 6, y - 3, '#c8c8d0');
    const frame = '#e9e9ef';
    line(x - 6, y - 3, x, y - 4, frame);
    line(x, y - 4, x + 4, y - 9, frame);
    line(x - 3, y - 9, x + 4, y - 9, frame);
    line(x - 3, y - 9, x, y - 4, frame);
    line(x + 4, y - 9, x + 6, y - 3, frame);
    // Legs (drawn first so the torso sits on top).
    const crank = 2.4;
    const a = phase;
    const hip = { x: x - 3, y: y - 11 };
    for (const sign of [1, -1]) {
      const fx = x + Math.cos(a + (sign > 0 ? 0 : Math.PI)) * crank;
      const fy = y - 4 + Math.sin(a + (sign > 0 ? 0 : Math.PI)) * crank;
      const kx = (hip.x + fx) / 2 + 2;
      const ky = (hip.y + fy) / 2 - 1;
      line(hip.x, hip.y, kx, ky, sign > 0 ? '#14141a' : '#2a2a33');
      line(kx, ky, fx, fy, '#f2c9a0');
      px(fx, fy, '#ffffff');
    }
    // Torso, arm, head, helmet.
    line(hip.x, hip.y, x + 3, y - 14, jersey);
    line(hip.x, hip.y - 1, x + 3, y - 15, jersey);
    px(x - 1, y - 13, dark);
    line(x + 3, y - 14, x + 5, y - 10, '#f2c9a0');
    px(x + 4, y - 17, '#f2c9a0', 2, 2);
    px(x + 3, y - 19, '#ffffff', 4, 2);
    px(x + 4, y - 20, '#ffffff', 2, 1);
    if (leader) {
      px(x + 2, y - 24, '#ffd23f', 5, 2);
      px(x + 2, y - 26, '#ffd23f', 1, 2);
      px(x + 4, y - 27, '#ffd23f', 1, 3);
      px(x + 6, y - 26, '#ffd23f', 1, 2);
    }
  }

  private weather(now: number, s: PublicState) {
    const id = s.event?.id;
    const c = this.ctx;
    if (id === 'rain') {
      c.fillStyle = 'rgba(30, 50, 90, 0.18)';
      c.fillRect(0, 0, W, H);
      c.fillStyle = '#cfe8ff';
      for (let i = 0; i < 90; i++) {
        const x = (i * 53 + now * 0.25) % (W + 20);
        const y = (i * 37 + now * 0.5) % H;
        c.fillRect(Math.round(W - x), Math.round(y), 1, 4);
      }
    } else if (id === 'crosswind') {
      c.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i < 14; i++) {
        const y = 30 + ((i * 41) % 170);
        const x = ((now * 0.35 + i * 90) % (W + 80)) - 40;
        c.fillRect(Math.round(x), y, 22, 1);
        c.fillRect(Math.round(x) + 6, y + 2, 14, 1);
      }
    } else if (id === 'headwind' || id === 'tailwind') {
      c.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 8; i++) {
        const y = 40 + ((i * 53) % 150);
        const dir = id === 'tailwind' ? 1 : -1;
        const x = dir > 0 ? (now * 0.3 + i * 70) % (W + 60) - 30 : W - ((now * 0.3 + i * 70) % (W + 60)) + 30;
        c.fillRect(Math.round(x), y, 16, 1);
      }
    }
  }

  private chickenRun(now: number) {
    if (!this.chicken.active) return;
    const t = (now - this.chicken.start) / 5000;
    if (t > 1) {
      this.chicken.active = false;
      return;
    }
    const c = this.ctx;
    const x = Math.round(W + 10 - t * (W + 40));
    const y = 150 + Math.round(Math.sin(t * 40) * 1.5);
    c.fillStyle = '#ffffff';
    c.fillRect(x, y, 9, 6);
    c.fillRect(x - 3, y - 4, 4, 5);
    c.fillStyle = '#ff4d4d';
    c.fillRect(x - 3, y - 6, 3, 2);
    c.fillStyle = '#ffb703';
    c.fillRect(x - 5, y - 3, 2, 1);
    c.fillRect(x + 2, y + 6, 1, 3 + (Math.floor(now / 60) % 2));
    c.fillRect(x + 5, y + 6, 1, 3 + (Math.floor(now / 60 + 1) % 2));
    c.fillStyle = '#111';
    c.fillRect(x - 2, y - 3, 1, 1);
  }
}

export function terrainColor(t: Terrain): string {
  return t === 'climb' ? '#ff9f43' : t === 'descent' ? '#54a0ff' : t === 'cobbles' ? '#a68a64' : '#5d5f69';
}
