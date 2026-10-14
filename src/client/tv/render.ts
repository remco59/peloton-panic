// Flat vector track renderer. The scene is laid out on a 480x270 logical grid and drawn at
// SCALE times that resolution, so shapes stay crisp on a TV. Solid fills only: no outlines,
// gradients or shadows. All sprites are drawn procedurally and recoloured per team.

import { TEAM_COLORS } from '../../shared/content';
import { terrainAt } from '../../shared/engine';
import type { PublicState, Rider, Terrain } from '../../shared/types';

export const W = 480;
export const H = 270;
const SCALE = 4;
const TW = 30; // logical px per tile
const LANES = 6;
const LANE_H = 11;
const BAND = LANES * LANE_H;
const BASE_Y = 160; // road centre line at the camera tile
const SLOPE = 7; // px of elevation per climbing / descending tile
const ANIM_MS = 3600;
const COL = 2; // road column width in logical px
const FONT = '700 7px Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

const C = {
  sky: '#b9dcf5',
  sun: '#ffe08a',
  far: '#9dbbdc',
  near: '#7db592',
  grass: '#62b06d',
  grassEdge: '#74c07d',
  road: '#4a4e5d',
  cobbles: '#6e6358',
  cobbleDot: '#58504a',
  ink: '#1b1d29',
  frame: '#eceef6',
  skin: '#f2c9a0',
  signPost: '#3b3e4d',
  chip: 'rgba(13, 15, 23, 0.82)',
};
const CROWD = ['#ff6b6b', '#ffd23f', '#5eea8d', '#c792ea', '#ffffff', '#ff9f43'];

function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

const edgeColor = (t: Terrain) =>
  t === 'climb' ? '#ff9f43' : t === 'descent' ? '#54a0ff' : t === 'cobbles' ? '#b79a70' : '#e9ebf3';

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
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
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
      if (s.event?.id === 'chicken' && s.phase === 'race') this.chicken = { active: true, start: performance.now() };
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
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
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
    const wx = (t: number) => W / 2 + (t - camX) * TW;
    const roadY = (t: number) => BASE_Y - (this.elevAt(t) - camElev);

    // Sky, sun and parallax ridges: flat shapes.
    ctx.fillStyle = C.sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.sun;
    ctx.beginPath();
    ctx.arc(402, 30, 13, 0, Math.PI * 2);
    ctx.fill();
    this.drawRidge(camX * 0.15, 66, 40, C.far, 0.06, camElev * 0.15);
    this.drawRidge(camX * 0.35, 96, 26, C.near, 0.1, camElev * 0.35);

    // Ground and road, built column by column so elevation and terrain can vary.
    const cols: { x: number; y: number; ter: Terrain }[] = [];
    for (let sx = -COL; sx <= W + COL; sx += COL) {
      const t = camX + (sx + COL / 2 - W / 2) / TW;
      cols.push({
        x: sx,
        y: roadY(t),
        ter: terrainAt(s, Math.max(0, Math.min(s.trackLength - 0.001, t))),
      });
    }
    const quad = (x: number, ya: number, yb: number, h: number, fill: string, ext = 0.35) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(x, ya);
      ctx.lineTo(x + COL + ext, yb);
      ctx.lineTo(x + COL + ext, yb + h);
      ctx.lineTo(x, ya + h);
      ctx.closePath();
      ctx.fill();
    };
    for (let i = 0; i < cols.length - 1; i++) {
      const a = cols[i];
      const b = cols[i + 1];
      const gTop = BAND / 2 + 8;
      quad(a.x, a.y - gTop, b.y - gTop, H * 2, C.grass);
      quad(a.x, a.y - gTop, b.y - gTop, 3, C.grassEdge);
      quad(a.x, a.y - BAND / 2, b.y - BAND / 2, BAND, a.ter === 'cobbles' ? C.cobbles : C.road);
      quad(a.x, a.y - BAND / 2 - 2.2, b.y - BAND / 2 - 2.2, 2.2, edgeColor(a.ter));
      quad(a.x, a.y + BAND / 2, b.y + BAND / 2, 2.2, edgeColor(a.ter));
    }

    // Cobble studs, lane lines and tile boundaries.
    ctx.fillStyle = C.cobbleDot;
    for (let i = 0; i < cols.length; i += 2) {
      const c = cols[i];
      if (c.ter !== 'cobbles') continue;
      for (let ly = 2; ly < BAND; ly += 5) {
        const off = (i / 2) % 2 ? 2.5 : 0;
        ctx.beginPath();
        ctx.arc(c.x + 1, c.y - BAND / 2 + ly + off, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([3, 5]);
    for (let l = 1; l < LANES; l++) {
      ctx.beginPath();
      cols.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y - BAND / 2 + l * LANE_H) : ctx.moveTo(c.x, c.y - BAND / 2 + l * LANE_H)));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = 0.6;
    const t0 = Math.floor(camX - W / 2 / TW) - 1;
    const t1 = Math.ceil(camX + W / 2 / TW) + 1;
    for (let t = t0; t <= t1; t++) {
      if (t < 0 || t > s.trackLength) continue;
      const x = wx(t);
      const y = roadY(t);
      ctx.beginPath();
      ctx.moveTo(x, y - BAND / 2);
      ctx.lineTo(x, y + BAND / 2);
      ctx.stroke();
    }

    // Spectators and terrain signs.
    for (let t = t0; t <= t1; t++) {
      if (t < 0 || t >= s.trackLength) continue;
      const x0 = wx(t);
      const y = roadY(t + 0.5);
      const ter = s.terrain[t];
      for (let k = 0; k < 4; k++) {
        const hx = x0 + 4 + k * 7 + hash(t * 7 + k) * 3;
        const bob = Math.sin(now / 220 + hash(t * 13 + k) * 6.28) > 0.2 ? 1 : 0;
        const col = CROWD[Math.floor(hash(t * 31 + k) * CROWD.length)];
        this.person(hx, y - BAND / 2 - 7 - bob, col);
        if (hash(t * 17 + k) > 0.35) this.person(hx + 2, y + BAND / 2 + 10 - bob, col);
      }
      if (ter !== 'flat' && t % 2 === 0) this.sign(x0 + 14, y - BAND / 2 - 17, edgeColor(ter));
    }

    // Start and finish banners.
    this.banner(wx(0), roadY(0), 'START', false);
    this.banner(wx(s.trackLength), roadY(s.trackLength), 'FINISH', true);

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
      const sy = roadY(pos) + laneY + 3;
      const moving = resolving && progress < 1;
      const phase = now / (moving ? 70 : 240) + i * 1.7;
      if (sx < -14) {
        this.offscreenMarker(sy, col.hex, true);
        continue;
      }
      if (sx > W + 14) {
        this.offscreenMarker(sy, col.hex, false);
        continue;
      }
      this.cyclist(sx, sy, col.hex, col.dark, phase, i === leaderIdx);
      if (resolving && s.report) {
        const m = s.report.moves.find((x) => x.riderId === r.id);
        if (m && progress > 0.55) {
          const d = m.to - m.from;
          const rise = (progress - 0.55) * 12;
          this.chipText(`+${d}`, sx + 3, sy - 26 - rise, m.effort === 'rustig' ? '#98a2cc' : '#ffffff');
          if (m.windPaid) this.chipText('z', sx + 14, sy - 30 - rise, '#ffc83d');
        }
      }
    }

    this.weather(now, s);
    this.chickenRun(now);
  }

  private drawRidge(offset: number, baseY: number, amp: number, color: string, freq: number, lift: number) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-2, H);
    for (let sx = -2; sx <= W + 2; sx += 2) {
      const x = sx + offset * TW;
      const h =
        Math.sin(x * freq) * amp * 0.5 +
        Math.sin(x * freq * 2.3 + 1.7) * amp * 0.3 +
        Math.sin(x * freq * 0.5 + 0.4) * amp * 0.4;
      ctx.lineTo(sx, baseY - amp / 2 - h + lift);
    }
    ctx.lineTo(W + 2, H);
    ctx.closePath();
    ctx.fill();
  }

  private person(x: number, y: number, color: string) {
    const c = this.ctx;
    c.fillStyle = color;
    c.beginPath();
    c.roundRect(x - 1.3, y - 3, 2.6, 4, 1.2);
    c.fill();
    c.fillStyle = C.skin;
    c.beginPath();
    c.arc(x, y - 4.2, 1.3, 0, Math.PI * 2);
    c.fill();
  }

  private sign(x: number, y: number, color: string) {
    const c = this.ctx;
    c.fillStyle = C.signPost;
    c.fillRect(x + 1.8, y + 2, 0.9, 9);
    c.fillStyle = color;
    c.beginPath();
    c.roundRect(x, y - 2, 5, 5, 1.2);
    c.fill();
  }

  private banner(x: number, y: number, label: string, checkered: boolean) {
    if (x < -50 || x > W + 50) return;
    const c = this.ctx;
    const top = y - BAND / 2 - 20;
    const bottom = y + BAND / 2;
    c.fillStyle = C.signPost;
    c.fillRect(x - 1, top, 2, bottom - top + 4);
    if (checkered) {
      const bw = 52;
      const bh = 11;
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.roundRect(x - bw / 2, top - 4, bw, bh, 2);
      c.fill();
      c.save();
      c.clip();
      c.fillStyle = C.ink;
      for (let i = 0; i < 13; i++) {
        for (let j = 0; j < 3; j++) if ((i + j) % 2 === 0) c.fillRect(x - bw / 2 + i * 4, top - 4 + j * 3.7, 4, 3.7);
      }
      c.restore();
      for (let ly = 0; ly < BAND; ly += 4) {
        c.fillStyle = (ly / 4) % 2 ? C.ink : '#ffffff';
        c.fillRect(x - 1.5, y - BAND / 2 + ly, 3, 4);
      }
    } else {
      c.fillStyle = '#f3f4f8';
      c.beginPath();
      c.roundRect(x - 17, top - 4, 34, 11, 3);
      c.fill();
      c.fillStyle = C.ink;
      c.font = FONT;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(label, x, top + 1.7);
      c.textAlign = 'start';
      c.textBaseline = 'alphabetic';
    }
  }

  private offscreenMarker(y: number, color: string, left: boolean) {
    const c = this.ctx;
    c.fillStyle = color;
    c.beginPath();
    if (left) {
      c.moveTo(2, y);
      c.lineTo(8, y - 4);
      c.lineTo(8, y + 4);
    } else {
      c.moveTo(W - 2, y);
      c.lineTo(W - 8, y - 4);
      c.lineTo(W - 8, y + 4);
    }
    c.closePath();
    c.fill();
  }

  private chipText(s: string, x: number, y: number, color: string) {
    const c = this.ctx;
    c.font = FONT;
    const w = c.measureText(s).width + 5;
    c.fillStyle = C.chip;
    c.beginPath();
    c.roundRect(x - w / 2, y - 6, w, 9.5, 4.5);
    c.fill();
    c.fillStyle = color;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(s, x, y - 1);
    c.textAlign = 'start';
    c.textBaseline = 'alphabetic';
  }

  private cyclist(x: number, y: number, jersey: string, dark: string, phase: number, leader: boolean) {
    const c = this.ctx;
    const seg = (x0: number, y0: number, x1: number, y1: number, col: string, w: number) => {
      c.strokeStyle = col;
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
    };
    const wheel = (cx: number, cy: number) => {
      c.strokeStyle = C.ink;
      c.lineWidth = 1.1;
      c.beginPath();
      c.arc(cx, cy, 3.3, 0, Math.PI * 2);
      c.stroke();
    };
    // Ground shadow, wheels and frame.
    c.fillStyle = 'rgba(0,0,0,0.18)';
    c.beginPath();
    c.ellipse(x, y, 10, 1.3, 0, 0, Math.PI * 2);
    c.fill();
    const wy = y - 3.6;
    wheel(x - 6, wy);
    wheel(x + 6, wy);
    const bb = { x, y: y - 4.6 };
    const seat = { x: x - 3, y: y - 9.6 };
    const head = { x: x + 4, y: y - 9.6 };
    seg(x - 6, wy, bb.x, bb.y, C.frame, 0.9);
    seg(bb.x, bb.y, head.x, head.y, C.frame, 0.9);
    seg(seat.x, seat.y, head.x, head.y, C.frame, 0.9);
    seg(seat.x, seat.y, bb.x, bb.y, C.frame, 0.9);
    seg(head.x, head.y, x + 6, wy, C.frame, 0.9);
    // Legs.
    const hip = { x: x - 3, y: y - 11.4 };
    const crank = 2.5;
    for (const k of [0, Math.PI]) {
      const fx = bb.x + Math.cos(phase + k) * crank;
      const fy = bb.y + Math.sin(phase + k) * crank;
      const kx = (hip.x + fx) / 2 + 2.2;
      const ky = (hip.y + fy) / 2 - 1;
      const col = k === 0 ? dark : C.ink;
      seg(hip.x, hip.y, kx, ky, col, 2.2);
      seg(kx, ky, fx, fy, C.skin, 1.5);
    }
    // Torso, arm, head and helmet.
    const sh = { x: x + 3.6, y: y - 15.2 };
    seg(hip.x, hip.y, sh.x, sh.y, jersey, 3.6);
    seg(sh.x, sh.y, x + 5.6, y - 10.4, C.skin, 1.3);
    c.fillStyle = C.skin;
    c.beginPath();
    c.arc(x + 5.6, y - 18.2, 2.3, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(x + 5.2, y - 18.9, 2.6, Math.PI, Math.PI * 2);
    c.fill();
    if (leader) {
      c.fillStyle = '#ffc83d';
      c.beginPath();
      c.moveTo(x + 2.4, y - 22.5);
      c.lineTo(x + 2.4, y - 26.2);
      c.lineTo(x + 4.2, y - 24.2);
      c.lineTo(x + 5.6, y - 27);
      c.lineTo(x + 7, y - 24.2);
      c.lineTo(x + 8.8, y - 26.2);
      c.lineTo(x + 8.8, y - 22.5);
      c.closePath();
      c.fill();
    }
  }

  private weather(now: number, s: PublicState) {
    const id = s.event?.id;
    const c = this.ctx;
    c.lineWidth = 0.7;
    if (id === 'rain') {
      c.fillStyle = 'rgba(30, 50, 90, 0.16)';
      c.fillRect(0, 0, W, H);
      c.strokeStyle = 'rgba(214, 235, 255, 0.85)';
      c.beginPath();
      for (let i = 0; i < 90; i++) {
        const x = W - ((i * 53 + now * 0.25) % (W + 20));
        const y = (i * 37 + now * 0.5) % H;
        c.moveTo(x, y);
        c.lineTo(x - 1.2, y + 4.5);
      }
      c.stroke();
    } else if (id === 'crosswind') {
      c.strokeStyle = 'rgba(255,255,255,0.65)';
      c.lineWidth = 0.9;
      c.beginPath();
      for (let i = 0; i < 14; i++) {
        const y = 30 + ((i * 41) % 170);
        const x = ((now * 0.35 + i * 90) % (W + 80)) - 40;
        c.moveTo(x, y);
        c.lineTo(x + 22, y);
        c.moveTo(x + 6, y + 2.5);
        c.lineTo(x + 20, y + 2.5);
      }
      c.stroke();
    } else if (id === 'headwind' || id === 'tailwind') {
      c.strokeStyle = 'rgba(255,255,255,0.5)';
      c.lineWidth = 0.9;
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const y = 40 + ((i * 53) % 150);
        const dir = id === 'tailwind' ? 1 : -1;
        const x = dir > 0 ? ((now * 0.3 + i * 70) % (W + 60)) - 30 : W - ((now * 0.3 + i * 70) % (W + 60)) + 30;
        c.moveTo(x, y);
        c.lineTo(x + 16, y);
      }
      c.stroke();
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
    const x = W + 10 - t * (W + 40);
    const y = 150 + Math.sin(t * 40) * 1.5;
    const step = Math.floor(now / 60) % 2;
    c.strokeStyle = '#ffb703';
    c.lineWidth = 0.9;
    c.beginPath();
    c.moveTo(x + 2.5, y + 5);
    c.lineTo(x + 2.5, y + 9 + step);
    c.moveTo(x + 5.5, y + 5);
    c.lineTo(x + 5.5, y + 9 + (1 - step));
    c.stroke();
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.ellipse(x + 4.5, y + 2.5, 5, 3.6, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc(x - 2, y - 2, 2.6, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ff4d4d';
    c.beginPath();
    c.arc(x - 2, y - 4.5, 1.2, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ffb703';
    c.beginPath();
    c.moveTo(x - 4.2, y - 2.4);
    c.lineTo(x - 6.4, y - 1.6);
    c.lineTo(x - 4.2, y - 0.8);
    c.closePath();
    c.fill();
    c.fillStyle = C.ink;
    c.beginPath();
    c.arc(x - 2.6, y - 2.6, 0.5, 0, Math.PI * 2);
    c.fill();
  }
}

export function terrainColor(t: Terrain): string {
  return t === 'climb' ? '#ff9f43' : t === 'descent' ? '#54a0ff' : t === 'cobbles' ? '#a68a64' : '#4a4e5d';
}
