// Vector track renderer. The scene is laid out on a 480x270 logical grid and drawn at SCALE
// times that resolution, so shapes stay crisp on a TV. The look is naturalistic but calm: soft
// gradients for sky, hills and grass, textured asphalt and cobbles, contact shadows under the
// riders. All sprites are drawn procedurally and recoloured per team.

import { PREMIE_INFO, TEAM_COLORS } from '../../shared/content';
import { terrainAt } from '../../shared/engine';
import { standing } from '../../shared/standing';
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
const FONT = '700 8px "Barlow Condensed", "Arial Narrow", Inter, system-ui, sans-serif';

const C = {
  skyTop: '#5ea6e6',
  skyHorizon: '#d6e9f6',
  sun: '#fff1c2',
  roadTop: '#757880',
  roadBottom: '#50535c',
  cobbleTop: '#9a8e7e',
  cobbleBottom: '#756a5c',
  grassFar: '#6fa862',
  grassNear: '#5a9a52',
  grassDeep: '#477f41',
  ink: '#1b1d29',
  frame: '#eceef6',
  skin: '#e9b98f',
  skinShade: '#c99068',
  signPost: '#3b3e4d',
  barrier: '#c9cdd8',
  chip: 'rgba(13, 15, 23, 0.82)',
};
const CROWD = ['#d9534f', '#e8b83a', '#4fae6e', '#8f6fc4', '#f1f1f1', '#e07b39'];


function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

const edgeColor = (t: Terrain) =>
  t === 'climb' ? '#ff9f43' : t === 'descent' ? '#54a0ff' : t === 'cobbles' ? '#b79a70' : '#e9ebf3';

/** Path of a team's shape mark, centred on (x, y). Teams are told apart by shape as well as hue. */
function shapePath(c: CanvasRenderingContext2D, shape: string, x: number, y: number, r: number) {
  c.beginPath();
  if (shape === 'square') {
    c.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
  } else if (shape === 'triangle') {
    c.moveTo(x, y - r);
    c.lineTo(x + r, y + r * 0.8);
    c.lineTo(x - r, y + r * 0.8);
    c.closePath();
  } else if (shape === 'diamond') {
    c.moveTo(x, y - r * 1.15);
    c.lineTo(x + r * 1.15, y);
    c.lineTo(x, y + r * 1.15);
    c.lineTo(x - r * 1.15, y);
    c.closePath();
  } else if (shape === 'hexagon') {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i) c.lineTo(px, py);
      else c.moveTo(px, py);
    }
    c.closePath();
  } else if (shape === 'plus') {
    const t = r * 0.38;
    c.moveTo(x - t, y - r);
    c.lineTo(x + t, y - r);
    c.lineTo(x + t, y - t);
    c.lineTo(x + r, y - t);
    c.lineTo(x + r, y + t);
    c.lineTo(x + t, y + t);
    c.lineTo(x + t, y + r);
    c.lineTo(x - t, y + r);
    c.lineTo(x - t, y + t);
    c.lineTo(x - r, y + t);
    c.lineTo(x - r, y - t);
    c.lineTo(x - t, y - t);
    c.closePath();
  } else {
    c.arc(x, y, r, 0, Math.PI * 2);
  }
}

interface Tag {
  shape: string;
  x: number;
  y: number;
  rank: number;
  name: string;
  gap: number;
  hex: string;
  kop: boolean;
  head: number;
}

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
  private sky!: CanvasGradient;
  private sunGlow!: CanvasGradient;
  private grassNear!: CanvasGradient;
  private vignette!: CanvasGradient;

  constructor(private canvas: HTMLCanvasElement) {
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    const g = this.ctx;
    this.sky = g.createLinearGradient(0, 0, 0, 150);
    this.sky.addColorStop(0, C.skyTop);
    this.sky.addColorStop(1, C.skyHorizon);
    this.sunGlow = g.createRadialGradient(402, 30, 4, 402, 30, 120);
    this.sunGlow.addColorStop(0, 'rgba(255,244,205,0.75)');
    this.sunGlow.addColorStop(1, 'rgba(255,244,205,0)');
    this.grassNear = g.createLinearGradient(0, 150, 0, H);
    this.grassNear.addColorStop(0, C.grassNear);
    this.grassNear.addColorStop(1, C.grassDeep);
    this.vignette = g.createRadialGradient(W / 2, H / 2, H * 0.5, W / 2, H / 2, W * 0.62);
    this.vignette.addColorStop(0, 'rgba(8,12,24,0)');
    this.vignette.addColorStop(1, 'rgba(8,12,24,0.28)');
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

    // Sky, sun glow, clouds and parallax ridges.
    ctx.fillStyle = this.sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = this.sunGlow;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.sun;
    ctx.beginPath();
    ctx.arc(402, 30, 8, 0, Math.PI * 2);
    ctx.fill();
    this.clouds(now);
    this.drawRidge(camX * 0.1, 70, 36, '#b4cadf', '#cfe0ee', 0.05, camElev * 0.1);
    this.drawRidge(camX * 0.2, 88, 30, '#8fb3b4', '#b5cfc6', 0.075, camElev * 0.2);
    this.drawRidge(camX * 0.38, 108, 22, '#6f9f6c', '#8fb98a', 0.11, camElev * 0.38);

    // Ground and road, built column by column so elevation and terrain can vary.
    const cols: { x: number; y: number; t: number; ter: Terrain }[] = [];
    for (let sx = -COL; sx <= W + COL; sx += COL) {
      const t = camX + (sx + COL / 2 - W / 2) / TW;
      cols.push({
        x: sx,
        y: roadY(t),
        t,
        ter: terrainAt(s, Math.max(0, Math.min(s.trackLength - 0.001, t))),
      });
    }
    const quad = (x: number, ya: number, yb: number, h: number, fill: string | CanvasGradient, ext = 0.35) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(x, ya);
      ctx.lineTo(x + COL + ext, yb);
      ctx.lineTo(x + COL + ext, yb + h);
      ctx.lineTo(x, ya + h);
      ctx.closePath();
      ctx.fill();
    };
    const gTop = BAND / 2 + 8;
    for (let i = 0; i < cols.length - 1; i++) {
      const a = cols[i];
      const b = cols[i + 1];
      // Grass: a lighter verge behind the road, then a screen-space gradient that deepens towards the viewer.
      quad(a.x, a.y - gTop, b.y - gTop, gTop, C.grassFar);
      quad(a.x, a.y + BAND / 2, b.y + BAND / 2, H * 2, this.grassNear);
      if (Math.floor(a.t) % 2 === 0) {
        quad(a.x, a.y + BAND / 2, b.y + BAND / 2, H * 2, 'rgba(255,255,255,0.045)');
        quad(a.x, a.y - gTop, b.y - gTop, gTop, 'rgba(255,255,255,0.03)');
      }
      // Road surface: a smooth gradient, darker towards the camera.
      const gy = (a.y + b.y) / 2 - BAND / 2;
      const rg = ctx.createLinearGradient(0, gy, 0, gy + BAND);
      rg.addColorStop(0, a.ter === 'cobbles' ? C.cobbleTop : C.roadTop);
      rg.addColorStop(1, a.ter === 'cobbles' ? C.cobbleBottom : C.roadBottom);
      quad(a.x, a.y - BAND / 2, b.y - BAND / 2, BAND, rg);
      // Kerb in the terrain colour, with a soft shadow line under it.
      quad(a.x, a.y - BAND / 2 - 2.2, b.y - BAND / 2 - 2.2, 2.2, edgeColor(a.ter));
      quad(a.x, a.y + BAND / 2, b.y + BAND / 2, 2.2, edgeColor(a.ter));
      quad(a.x, a.y + BAND / 2 + 2.2, b.y + BAND / 2 + 2.2, 2.6, 'rgba(0,0,0,0.16)');
      quad(a.x, a.y - BAND / 2 - 0.8, b.y - BAND / 2 - 0.8, 0.8, 'rgba(0,0,0,0.22)');
    }

    // Surface detail in world space: asphalt grain and individual cobblestones.
    const t0 = Math.floor(camX - W / 2 / TW) - 1;
    const t1 = Math.ceil(camX + W / 2 / TW) + 1;
    const grainLight = new Path2D();
    const grainDark = new Path2D();
    const stoneTones = [new Path2D(), new Path2D(), new Path2D()];
    const STONE_W = 4.3;
    const STONE_H = 4.4;
    const stoneRows = Math.floor(BAND / STONE_H);
    const stoneCols = Math.floor(TW / STONE_W);
    for (let t = Math.max(0, t0); t <= Math.min(t1, s.trackLength - 1); t++) {
      const ter = s.terrain[t];
      if (ter === 'cobbles') {
        for (let r = 0; r < stoneRows; r++) {
          const off = r % 2 ? STONE_W / 2 : 0;
          for (let k = 0; k < stoneCols; k++) {
            const u = hash(t * 977 + r * 31 + k);
            const px = wx(t) + k * STONE_W + off;
            const py = roadY(t + (k * STONE_W + off) / TW) - BAND / 2 + r * STONE_H;
            stoneTones[Math.floor(u * 3)].rect(px + 0.35, py + 0.35, STONE_W - 0.7, STONE_H - 0.7);
          }
        }
      } else {
        for (let k = 0; k < 34; k++) {
          const u = hash(t * 131 + k);
          const v = hash(t * 53 + k * 7);
          const fx = t + u;
          const x = wx(fx);
          const y = roadY(fx) - BAND / 2 + v * BAND;
          (k % 2 ? grainLight : grainDark).rect(x, y, 0.55, 0.55);
        }
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fill(grainLight);
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fill(grainDark);
    ctx.fillStyle = 'rgba(255,240,220,0.14)';
    ctx.fill(stoneTones[0]);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill(stoneTones[1]);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fill(stoneTones[2]);

    // Lane guides and tile boundaries, kept faint so the road reads as one surface.
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([3, 5]);
    for (let l = 1; l < LANES; l++) {
      ctx.beginPath();
      cols.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y - BAND / 2 + l * LANE_H) : ctx.moveTo(c.x, c.y - BAND / 2 + l * LANE_H)));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 0.5;
    for (let t = t0; t <= t1; t++) {
      if (t < 0 || t > s.trackLength) continue;
      const x = wx(t);
      const y = roadY(t);
      ctx.beginPath();
      ctx.moveTo(x, y - BAND / 2);
      ctx.lineTo(x, y + BAND / 2);
      ctx.stroke();
    }

    // Crowd barriers, spectators and terrain signs.
    ctx.strokeStyle = C.barrier;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    cols.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y - BAND / 2 - 5) : ctx.moveTo(c.x, c.y - BAND / 2 - 5)));
    ctx.stroke();
    ctx.beginPath();
    cols.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y + BAND / 2 + 6) : ctx.moveTo(c.x, c.y + BAND / 2 + 6)));
    ctx.stroke();
    for (let t = t0; t <= t1; t++) {
      if (t < 0 || t >= s.trackLength) continue;
      const x0 = wx(t);
      const y = roadY(t + 0.5);
      const ter = s.terrain[t];
      for (let k = 0; k < 3; k++) {
        const hx = x0 + 5 + k * 9 + hash(t * 7 + k) * 4;
        const bob = Math.sin(now / 260 + hash(t * 13 + k) * 6.28) > 0.3 ? 0.8 : 0;
        const col = CROWD[Math.floor(hash(t * 31 + k) * CROWD.length)];
        if (hash(t * 19 + k) > 0.25) this.person(hx, y - BAND / 2 - 8 - bob, col);
        if (hash(t * 17 + k) > 0.7) this.person(hx + 2, y + BAND / 2 + 12 - bob, col);
      }
      if (ter !== 'flat' && t % 2 === 0) this.sign(x0 + 14, y - BAND / 2 - 19, edgeColor(ter));
    }

    // Start and finish banners.
    this.banner(wx(0), roadY(0), 'START', false);
    this.banner(wx(s.trackLength), roadY(s.trackLength), 'FINISH', true);
    for (const p of s.premies) this.banner(wx(p.pos), roadY(p.pos), PREMIE_INFO[p.id].short, false, p.hits.length >= 3 ? 'spent' : 'premie');
    const kopmen = new Set(Object.values(s.kopman));

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
    // Plek en afstand per renner, op de hele tegel die de standenlijst ook toont.
    const rows = new Map(standing({ riders: s.riders.map((r, i) => ({ ...r, pos: positions[i] })) }).map((x) => [x.rider.id, x]));
    const tags: Tag[] = [];
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
      this.cyclist(sx, sy, col.hex, col.dark, col.shape, phase, i === leaderIdx);
      const row = rows.get(r.id);
      if (row) {
        tags.push({
          shape: col.shape,
          x: sx,
          y: sy - 23,
          rank: row.rank,
          name: r.name.split(' ')[0],
          gap: row.gapLeader,
          hex: col.hex,
          kop: kopmen.has(r.id),
          head: sy - 21,
        });
      }
      if (resolving && s.report) {
        const m = s.report.moves.find((x) => x.riderId === r.id);
        if (m && progress > 0.55) {
          const d = m.to - m.from;
          const rise = (progress - 0.55) * 12;
          this.chipText(`+${d}`, sx + 3, sy - 38 - rise, m.effort === 'rustig' && !m.helping ? '#98a2cc' : '#ffffff');
          if (m.windPaid) this.chipText('z', sx + 14, sy - 42 - rise, '#ffc83d');
          if (m.helping) this.chipText('helpt', sx + 3, sy - 50 - rise, '#5eea8d');
          // Gel, cola, blokkade en volgauto: wat de ploegen deze ronde uit de kast haalden.
          const tags: [string, string][] = [];
          if (m.blockedBy) tags.push(['GEBLOKKEERD', '#ff6b6b']);
          if (m.item === 'blok') tags.push(['BLOK', '#ff9f43']);
          if (m.item === 'gel') tags.push(['GEL +3', '#5eea8d']);
          if (m.item === 'cola') tags.push(['COLA +3', '#ff9f43']);
          if (m.car) tags.push(['AUTO', '#6ea8ff']);
          tags.forEach(([text, color], k) => this.chipText(text, sx + 3, Math.max(9, sy - 62 - rise - k * 10), color));
        }
        const hit = s.report.premies.find((h) => h.riderId === r.id);
        if (hit && progress > 0.7) {
          const rise = (progress - 0.7) * 20;
          this.chipText(`${PREMIE_INFO[hit.premieId].short} +${hit.points}`, sx + 3, sy - 58 - rise, '#5eea8d');
        }
      }
    }

    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, W, H);
    this.nameTags(tags);
    this.gapRuler(s, Math.floor(lead), t0, t1, wx, roadY);
    this.weather(now, s);
    this.chickenRun(now);
  }

  /** Plaatjes met plek, naam en achterstand; ze schuiven omhoog als ze elkaar zouden raken. */
  private nameTags(tags: Tag[]) {
    const c = this.ctx;
    c.font = FONT;
    const H_TAG = 9.5;
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    // Kop eerst: die houdt zijn plek, de rest wijkt uit.
    const order = [...tags].sort((a, b) => a.rank - b.rank || b.x - a.x);
    for (const t of order) {
      const label = `${t.kop ? '★ ' : ''}${t.name.slice(0, 8)}`;
      const gap = t.gap > 0 ? `−${t.gap}` : '';
      const wRank = 8.5;
      const wMark = 8;
      const wName = c.measureText(label).width + 4;
      const wGap = gap ? c.measureText(gap).width + 5 : 0;
      const w = wRank + wMark + wName + wGap;
      let y = t.y;
      const x0 = t.x - w / 2;
      for (let bump = 0; bump < 4; bump++) {
        const hit = placed.some((p) => x0 < p.x1 + 1 && x0 + w > p.x0 - 1 && y - 6 < p.y1 && y - 6 + H_TAG > p.y0);
        if (!hit) break;
        y -= H_TAG + 1;
      }
      placed.push({ x0, x1: x0 + w, y0: y - 6, y1: y - 6 + H_TAG });
      if (y !== t.y) {
        c.strokeStyle = t.hex;
        c.lineWidth = 0.7;
        c.beginPath();
        c.moveTo(t.x + 5, t.head);
        c.lineTo(t.x + 5, y + H_TAG - 6);
        c.stroke();
      }
      const top = y - 6;
      // Chip, kleurblok met plek, naam en afstand.
      c.fillStyle = C.chip;
      c.beginPath();
      c.roundRect(x0, top, w, H_TAG, 4.5);
      c.fill();
      c.fillStyle = t.hex;
      c.beginPath();
      c.roundRect(x0, top, wRank, H_TAG, [4.5, 0, 0, 4.5]);
      c.fill();
      c.textBaseline = 'middle';
      c.textAlign = 'center';
      c.fillStyle = C.ink;
      c.fillText(String(t.rank), x0 + wRank / 2, top + H_TAG / 2 + 0.3);
      shapePath(c, t.shape, x0 + wRank + wMark / 2, top + H_TAG / 2, 2.4);
      c.fillStyle = t.hex;
      c.fill();
      c.fillStyle = t.rank === 1 ? '#ffc83d' : '#ffffff';
      c.fillText(label, x0 + wRank + wMark + wName / 2, top + H_TAG / 2 + 0.3);
      if (gap) {
        c.fillStyle = '#ff9f9f';
        c.fillText(gap, x0 + wRank + wMark + wName + wGap / 2, top + H_TAG / 2 + 0.3);
      }
      c.textAlign = 'start';
      c.textBaseline = 'alphabetic';
    }
  }

  /** Een liniaal onder de weg: hoeveel tegels achter de koploper elke tegelgrens ligt. */
  private gapRuler(
    s: PublicState,
    leadTile: number,
    t0: number,
    t1: number,
    wx: (t: number) => number,
    roadY: (t: number) => number,
  ) {
    if (s.phase === 'lobby' || s.phase === 'briefing' || s.phase === 'recruit' || s.phase === 'naming' || s.phase === 'draft' || s.phase === 'team') return;
    const c = this.ctx;
    c.font = FONT;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let t = Math.max(0, t0); t <= Math.min(t1, leadTile); t++) {
      const x = wx(t);
      if (x < 6 || x > W - 6) continue;
      const behind = leadTile - t;
      const y = roadY(t) + BAND / 2 + 10;
      const text = behind === 0 ? 'KOP' : `−${behind}`;
      const w = c.measureText(text).width + 5;
      c.fillStyle = behind === 0 ? '#ffc83d' : 'rgba(13, 15, 23, 0.62)';
      c.beginPath();
      c.roundRect(x - w / 2, y - 4.5, w, 8.5, 4);
      c.fill();
      c.fillStyle = behind === 0 ? C.ink : '#d6dbef';
      c.fillText(text, x, y);
    }
    c.textAlign = 'start';
    c.textBaseline = 'alphabetic';
  }

  private drawRidge(offset: number, baseY: number, amp: number, top: string, bottom: string, freq: number, lift: number) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, baseY - amp, 0, baseY + amp * 0.9);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
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

  /** A few soft clouds drifting slowly; they barely move so the scene stays calm. */
  private clouds(now: number) {
    const c = this.ctx;
    c.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 4; i++) {
      const x = ((i * 170 + now * 0.004 * (1 + i * 0.3)) % (W + 120)) - 60;
      const y = 22 + ((i * 29) % 52);
      const w = 26 + (i % 3) * 10;
      c.beginPath();
      c.ellipse(x, y, w, 4.5, 0, 0, Math.PI * 2);
      c.ellipse(x - w * 0.35, y - 3, w * 0.5, 4, 0, 0, Math.PI * 2);
      c.ellipse(x + w * 0.3, y - 2.4, w * 0.45, 3.4, 0, 0, Math.PI * 2);
      c.fill();
    }
  }

  private person(x: number, y: number, color: string) {
    const c = this.ctx;
    c.fillStyle = 'rgba(0,0,0,0.14)';
    c.beginPath();
    c.ellipse(x, y + 1.2, 2.2, 0.7, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = color;
    c.beginPath();
    c.roundRect(x - 1.4, y - 3.4, 2.8, 4.6, 1.3);
    c.fill();
    c.fillStyle = 'rgba(0,0,0,0.16)';
    c.beginPath();
    c.roundRect(x + 0.2, y - 3.4, 1.2, 4.6, [0, 1.3, 1.3, 0]);
    c.fill();
    c.fillStyle = C.skin;
    c.beginPath();
    c.arc(x, y - 4.6, 1.35, 0, Math.PI * 2);
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

  private banner(x: number, y: number, label: string, checkered: boolean, tone: 'plain' | 'premie' | 'spent' = 'plain') {
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
      c.fillStyle = tone === 'spent' ? '#8b91ab' : tone === 'premie' ? '#ffc83d' : '#f3f4f8';
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

  private cyclist(x: number, y: number, jersey: string, dark: string, shape: string, phase: number, leader: boolean) {
    const c = this.ctx;
    const seg = (x0: number, y0: number, x1: number, y1: number, col: string | CanvasGradient, w: number) => {
      c.strokeStyle = col;
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
    };
    const wheel = (cx: number, cy: number) => {
      c.strokeStyle = '#15171f';
      c.lineWidth = 1.15;
      c.beginPath();
      c.arc(cx, cy, 3.2, 0, Math.PI * 2);
      c.stroke();
      c.strokeStyle = 'rgba(205,210,225,0.75)';
      c.lineWidth = 0.35;
      c.beginPath();
      c.arc(cx, cy, 2.55, 0, Math.PI * 2);
      c.stroke();
      // Three spokes turning with the pedals: subtle motion without extra clutter.
      c.strokeStyle = 'rgba(215,220,235,0.5)';
      c.lineWidth = 0.22;
      c.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = phase * 1.6 + (k * Math.PI) / 3;
        c.moveTo(cx - Math.cos(a) * 2.5, cy - Math.sin(a) * 2.5);
        c.lineTo(cx + Math.cos(a) * 2.5, cy + Math.sin(a) * 2.5);
      }
      c.stroke();
    };
    // Contact shadow under the bike.
    c.fillStyle = 'rgba(0,0,0,0.13)';
    c.beginPath();
    c.ellipse(x, y + 0.5, 11.5, 2, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(0,0,0,0.2)';
    c.beginPath();
    c.ellipse(x, y + 0.4, 8, 1.1, 0, 0, Math.PI * 2);
    c.fill();

    const wy = y - 3.4;
    wheel(x - 6, wy);
    wheel(x + 6, wy);
    const bb = { x, y: y - 4.6 };
    const seat = { x: x - 3, y: y - 9.6 };
    const head = { x: x + 4, y: y - 9.6 };
    // Frame: a darker underside first, then the light tubes on top.
    for (const [col, dy, w] of [['#8c92ab', 0.35, 1], [C.frame, 0, 0.8]] as const) {
      seg(x - 6, wy + dy, bb.x, bb.y + dy, col, w);
      seg(bb.x, bb.y + dy, head.x, head.y + dy, col, w);
      seg(seat.x, seat.y + dy, head.x, head.y + dy, col, w);
      seg(seat.x, seat.y + dy, bb.x, bb.y + dy, col, w);
      seg(head.x, head.y + dy, x + 6, wy + dy, col, w);
      seg(seat.x, seat.y + dy, x - 6, wy + dy, col, w * 0.8);
    }
    seg(seat.x - 1.6, seat.y - 0.6, seat.x + 1.2, seat.y - 0.6, C.ink, 0.9);
    seg(head.x, head.y, head.x + 1.7, head.y - 0.7, C.ink, 0.6);
    // Legs: bib shorts, shaded calves and shoes. The far leg is a shade darker.
    const hip = { x: x - 3, y: y - 11.4 };
    const crank = 2.5;
    for (const k of [Math.PI, 0]) {
      const fx = bb.x + Math.cos(phase + k) * crank;
      const fy = bb.y + Math.sin(phase + k) * crank;
      const kx = (hip.x + fx) / 2 + 2.2;
      const ky = (hip.y + fy) / 2 - 1;
      const far = k !== 0;
      seg(bb.x, bb.y, fx, fy, '#2a2d3b', 0.5);
      seg(hip.x, hip.y, kx, ky, far ? '#14161f' : '#1d2030', 2.3);
      seg(kx, ky, fx, fy, far ? C.skinShade : C.skin, 1.45);
      seg(fx - 0.6, fy, fx + 0.9, fy + 0.1, far ? '#20232f' : C.ink, 1.1);
    }
    // Torso with a lit top edge, arm, head, sunglasses and helmet.
    const sh = { x: x + 3.6, y: y - 15.2 };
    seg(hip.x, hip.y, sh.x, sh.y, dark, 3.7);
    seg(hip.x, hip.y, sh.x, sh.y, jersey, 3.1);
    seg(hip.x + 0.2, hip.y - 0.9, sh.x + 0.2, sh.y - 0.9, 'rgba(255,255,255,0.28)', 1);
    shapePath(c, shape, (hip.x + sh.x) / 2, (hip.y + sh.y) / 2, 1.15);
    c.fillStyle = shape === 'hexagon' ? C.ink : '#ffffff';
    c.fill();
    seg(sh.x, sh.y, x + 5.6, y - 10.4, C.skinShade, 1.3);
    seg(sh.x - 0.2, sh.y, x + 5.5, y - 10.5, C.skin, 0.9);
    c.fillStyle = C.skin;
    c.beginPath();
    c.arc(x + 5.8, y - 18.2, 2.3, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#1c1f2b';
    c.beginPath();
    c.ellipse(x + 7.1, y - 18.2, 1.1, 0.7, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#f4f5fa';
    c.beginPath();
    c.arc(x + 5.4, y - 18.9, 2.7, Math.PI, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(0,0,0,0.12)';
    c.beginPath();
    c.arc(x + 5.4, y - 18.9, 2.7, 0.15 * Math.PI, 0.9 * Math.PI, true);
    c.arc(x + 5.4, y - 18.9, 2.7, Math.PI, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.beginPath();
    c.ellipse(x + 4.6, y - 20.6, 1.1, 0.45, -0.3, 0, Math.PI * 2);
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
