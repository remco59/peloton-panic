import type { ComponentChildren } from 'preact';
import { QUIRKS, RIDER_TYPES, STAT_LABELS, TEAM_COLORS } from '../../shared/content';
import type { EventId, QuirkId, Rider, RiderType, Stat, Terrain } from '../../shared/types';

// Alles wat in plaats van tekst getekend wordt: renner-avatars, podium, statistieken, energie,
// parcoursprofiel. Gedeeld door tv en telefoon, geen losse plaatjes: alles is SVG en CSS.

export const teamHex = (color: number) => TEAM_COLORS[color % TEAM_COLORS.length];

// ---- Iconen ----------------------------------------------------------------------

export const TYPE_ICON: Record<RiderType, string> = {
  sprinter: '⚡',
  climber: '⛰️',
  rouleur: '🛞',
  puncheur: '👊',
  domestique: '🧴',
};

export const QUIRK_ICON: Record<QuirkId, string> = {
  croissant: '🥐',
  waver: '👋',
  cobbleKing: '🪨',
  descentFear: '😨',
  windHardened: '🌬️',
  socks: '🧦',
  finisher: '🏁',
  napper: '😴',
  rainKing: '☔',
  sugarCube: '🍬',
  clumsy: '🦶',
  daredevil: '🤘',
  lucky: '🐖',
};

export const EVENT_ICON: Record<EventId, string> = {
  calm: '😌',
  tailwind: '💨',
  headwind: '🌬️',
  crosswind: '🌪️',
  rain: '🌧️',
  feedzone: '🥪',
  chicken: '🐔',
  wrongTurn: '🪧',
  sandwich: '🥖',
  cow: '🐄',
  tractor: '🚜',
  goat: '🐐',
  selfie: '🤳',
  bbq: '🍖',
  crowd: '📣',
  oil: '🛢️',
  storm: '⛈️',
  mist: '🌫️',
  nails: '📌',
  blessing: '🙏',
  wasps: '🐝',
  drone: '🛸',
  fanBottle: '🍼',
  dogRun: '🐕',
  detour: '↪️',
  mascot: '🧸',
  grandma: '👵',
};

export const TERRAIN_FILL: Record<Terrain, string> = {
  climb: '#ff9f43',
  descent: '#54a0ff',
  cobbles: '#a68a64',
  flat: '#4a4e5d',
};

const STAT_PATH: Record<Stat, string> = {
  // vuist
  kracht: 'M5 9h6l2-4 2 4h4v3l-2 5H8l-3-4z',
  // berg
  klim: 'M2 18 9 6l4 6 3-4 6 10z',
  // bliksem
  sprint: 'M13 2 4 14h6l-1 8 9-12h-6z',
  // hart
  uithouding: 'M12 21s-8-5.2-8-11a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 5.8-8 11-8 11z',
};

export function StatIcon({ stat, size = 14 }: { stat: Stat; size?: number }) {
  return (
    <svg class="sicon" viewBox="0 0 24 24" width={size} height={size} aria-label={STAT_LABELS[stat]} role="img">
      <path d={STAT_PATH[stat]} fill="currentColor" />
    </svg>
  );
}

// ---- Renner-avatar --------------------------------------------------------------

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const SKINS = ['#f6d3b3', '#ecbb92', '#d79f72', '#b97a4e', '#9a6540', '#7d4e32'];
const HAIRS = ['#2b2019', '#4a3022', '#8a5a2b', '#c9822b', '#dcb45c', '#9a9aa3'];

export interface Look {
  skin: string;
  hair: string;
  style: 0 | 1 | 2 | 3; // kort, krullend, staartje, kaal
  beard: 0 | 1 | 2; // geen, snor, baard
  shades: boolean;
}

export function lookOf(r: Pick<Rider, 'id' | 'type'>): Look {
  const h = hash(r.id);
  const pick = <T,>(a: readonly T[], shift: number) => a[(((h >>> shift) ^ (h >>> (shift + 7))) >>> 0) % a.length];
  return {
    skin: pick(SKINS, 0),
    hair: pick(HAIRS, 3),
    style: (((h >>> 9) % 4) as 0 | 1 | 2 | 3),
    beard: (((h >>> 13) % 5 === 0 ? 2 : (h >>> 13) % 3 === 0 ? 1 : 0) as 0 | 1 | 2),
    shades: r.type === 'sprinter' || (h >>> 17) % 4 === 0,
  };
}

type Who = Pick<Rider, 'id' | 'type'>;

const shade = (hex: string, amt: number) => `color-mix(in srgb, ${hex} ${100 - Math.abs(amt)}%, ${amt < 0 ? '#000' : '#fff'})`;

/** Het hoofd (64 breed, gezicht rond 32,31) met helm, haar en bril: gedeeld door buste en hele figuur. */
function Head({ who, color }: { who: Who; color: { hex: string; dark: string } }) {
  const l = lookOf(who);
  const t = who.type;
  const helm = t === 'climber' ? '#f4f1e8' : color.hex;
  const helmDark = t === 'climber' ? color.hex : color.dark;
  return (
    <g>
      <rect x="27" y="40" width="10" height="11" fill={shade(l.skin, -14)} />
      {/* haar achter de helm */}
      {l.style === 1 && (
        <g fill={l.hair}>
          {[17, 21, 43, 47].map((x, i) => (
            <circle key={i} cx={x} cy={i % 2 ? 31 : 28} r="5" />
          ))}
        </g>
      )}
      {l.style === 2 && <circle cx="47" cy="34" r="5" fill={l.hair} />}
      <circle cx="19.2" cy="32" r="2.8" fill={shade(l.skin, -8)} />
      <circle cx="44.8" cy="32" r="2.8" fill={shade(l.skin, -8)} />
      <ellipse cx="32" cy="31" rx="12.4" ry="13.4" fill={l.skin} />
      {l.style !== 3 && <path d="M19.8 29.5c-.4 3.5.4 6 1.2 7v-7zM44.2 29.5c.4 3.5-.4 6-1.2 7v-7z" fill={l.hair} />}
      {/* baard */}
      {l.beard === 2 && <path d="M20.5 33c1 9 5 12.5 11.5 12.5S42.5 42 43.5 33c-3 4-6 4.5-11.5 4.5S23.5 37 20.5 33z" fill={`color-mix(in srgb, ${l.hair} 60%, ${l.skin})`} />}
      {l.beard === 1 && <path d="M25.5 38.5c3-2 10-2 13 0-1.5 2-3 1.6-6.5 1.6s-5-.2-6.5-1.6z" fill={l.hair} />}
      {/* ogen en mond */}
      {!l.shades && (
        <g fill="#23242e">
          <circle cx="26.5" cy="31.5" r="1.7" />
          <circle cx="37.5" cy="31.5" r="1.7" />
        </g>
      )}
      {!l.shades && <path d="M23.5 28.2q3-1.8 6 0M34.5 28.2q3-1.8 6 0" stroke={l.hair} stroke-width="1.3" fill="none" stroke-linecap="round" />}
      <path d={l.beard === 2 ? 'M29 40.5q3 1.6 6 0' : 'M28.5 39q3.5 2.6 7 0'} stroke="#8a3d3a" stroke-width="1.4" fill="none" stroke-linecap="round" />
      {l.shades && (
        <g>
          {t === 'sprinter' ? (
            <path d="M18 27.5h28v5.5c0 2.5-3 4-7 4s-5-1.5-7-1.5-3 1.5-7 1.5-7-1.5-7-4z" fill="#2a3452" />
          ) : (
            <g fill="#1c2033">
              <rect x="20" y="28" width="10.5" height="7.2" rx="3.2" />
              <rect x="33.5" y="28" width="10.5" height="7.2" rx="3.2" />
              <rect x="29" y="30" width="6" height="1.6" />
            </g>
          )}
          <path d="M22 30h5M35.5 30h5" stroke="#7ec8f2" stroke-width="1.3" stroke-linecap="round" opacity="0.8" />
        </g>
      )}
      {t === 'domestique' && !l.shades && (
        <g fill="none" stroke="#c4c9e2" stroke-width="1.2">
          <circle cx="26.5" cy="31.5" r="4" />
          <circle cx="37.5" cy="31.5" r="4" />
          <path d="M30.5 31.5h3" />
        </g>
      )}
      {/* helm */}
      {t === 'climber' ? (
        <g>
          <path d="M18.5 27.5c0-9 6-14.5 13.5-14.5s13.5 5.5 13.5 14.5c-4-2.8-8.5-3.8-13.5-3.8s-9.5 1-13.5 3.8z" fill={helm} />
          <path d="M18.5 27.5c4-2.8 8.5-3.8 13.5-3.8s9.5 1 13.5 3.8l-.6 2.2c-4-2.3-8.2-3.2-12.9-3.2s-8.9.9-12.9 3.2z" fill={helmDark} />
          <path d="M20 26.5c3.5-4.2 8-5.8 12-5.8l.2-5.8" stroke={helmDark} stroke-width="1.2" fill="none" opacity="0.5" />
          <path d="M22 23.7c4-2.7 12-2.7 20 0" stroke="#fff" stroke-width="0.8" fill="none" opacity="0.6" />
        </g>
      ) : (
        <g>
          <path d="M17.2 30.5c-.4-10.5 6.2-18 14.8-18s15.2 7.5 14.8 18c-1.2-3.5-3.5-6-6-6.8-2.6-.8-5.6-1.2-8.8-1.2s-6.2.4-8.8 1.2c-2.5.8-4.8 3.3-6 6.8z" fill={helm} />
          <path d="M32 12.5c-1.2 3-1.2 7.5 0 9.8M25 14.5c-1.6 2.3-2 5.3-1.6 8M39 14.5c1.6 2.3 2 5.3 1.6 8" stroke={helmDark} stroke-width="1.7" fill="none" stroke-linecap="round" opacity="0.75" />
          {t === 'puncheur' && <path d="M30 12.8h4v10.4h-4z" fill="#fff" opacity="0.85" />}
          <path d="M20 22.5q2-6 8-8" stroke="#fff" stroke-width="1.3" fill="none" stroke-linecap="round" opacity="0.5" />
          <path d="M18.5 31v3.2M45.5 31v3.2" stroke={helmDark} stroke-width="1.1" opacity="0.8" />
        </g>
      )}
      {t === 'domestique' && <path d="M17.8 28.5q14.2-5 28.4 0v2.6q-14.2-5-28.4 0z" fill="#fff" opacity="0.9" />}
    </g>
  );
}

function Jersey({ color }: { color: { hex: string; dark: string } }) {
  return (
    <g>
      <path d="M4 72c0-17 12-24 28-24s28 7 28 24z" fill={color.hex} />
      <path d="M4 72c0-4 .6-7.5 1.8-10.5 3 1.5 6 2.2 10 2.6L12 72zM60 72c0-4-.6-7.5-1.8-10.5-3 1.5-6 2.2-10 2.6L52 72z" fill={color.dark} />
      <path d="M17 55c4.5 2.8 9.5 4 15 4s10.5-1.2 15-4" stroke="#fff" stroke-width="2.6" fill="none" opacity="0.88" />
      <path d="M26 49l6 9 6-9z" fill={shade(color.dark, -35)} />
      <path d="M32 58v14" stroke={shade(color.dark, -35)} stroke-width="1.1" />
      <rect x="35.5" y="62" width="9" height="4.5" rx="1" fill="#fff" opacity="0.85" />
    </g>
  );
}

interface AvatarProps {
  rider: Who;
  /** Index in TEAM_COLORS; zonder ploeg is de trui grijs. */
  color?: number;
  size?: number | string;
  /** Rondje achter de buste. */
  bg?: boolean;
  class?: string;
}

/** Een gezicht met helm in de kleuren van de ploeg: elke renner ziet er anders uit. */
export function RiderAvatar({ rider, color, size = 40, bg = true, class: cls = '' }: AvatarProps) {
  const col = color === undefined ? { hex: '#7d86a8', dark: '#4e567a' } : teamHex(color);
  const clip = `ra-${rider.id}`;
  return (
    <svg class={`ravatar ${cls}`} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <circle cx="32" cy="32" r="32" />
        </clipPath>
      </defs>
      <g clip-path={`url(#${clip})`}>
        {bg && <rect width="64" height="64" fill={shade(col.hex, -62)} />}
        {bg && <circle cx="32" cy="28" r="26" fill={shade(col.hex, -48)} opacity="0.7" />}
        <Jersey color={col} />
        <Head who={rider} color={col} />
      </g>
    </svg>
  );
}

type Pose = 'cheer' | 'wave' | 'stand';

/** Een hele renner voor op het podium. */
export function RiderFigure({
  rider,
  color,
  pose = 'stand',
  medal,
  class: cls = '',
}: {
  rider: Who;
  color: number;
  pose?: Pose;
  medal?: 1 | 2 | 3;
  class?: string;
}) {
  const col = teamHex(color);
  const l = lookOf(rider);
  const skin = l.skin;
  const sleeve = col.hex;
  // Armen: schouder (27,56) / (53,56). Handen eindigen in skin.
  const left =
    pose === 'cheer'
      ? { d: 'M27 56 16 36', hx: 14.5, hy: 32 }
      : pose === 'wave'
        ? { d: 'M27 56 20 70', hx: 19.5, hy: 73 }
        : { d: 'M27 56 22 72', hx: 21.5, hy: 75 };
  const right =
    pose === 'cheer'
      ? { d: 'M53 56 64 36', hx: 65.5, hy: 32 }
      : pose === 'wave'
        ? { d: 'M53 56 62 38', hx: 63, hy: 34.5 }
        : { d: 'M53 56 58 72', hx: 58.5, hy: 75 };
  const medalCol = medal === 1 ? '#ffd23f' : medal === 2 ? '#d4d9e6' : '#d98a4a';
  return (
    <svg class={`rfigure ${cls}`} viewBox="0 0 80 124" aria-hidden="true">
      {/* benen */}
      <path d="M31 84v22M49 84v22" stroke={skin} stroke-width="8" stroke-linecap="round" />
      <path d="M31 84v14M49 84v14" stroke="#1c2033" stroke-width="10" stroke-linecap="round" />
      <path d="M31 104v10M49 104v10" stroke="#f3f4f8" stroke-width="8" stroke-linecap="butt" />
      <path d="M26 118h11M43 118h11" stroke="#23242e" stroke-width="6" stroke-linecap="round" />
      {/* romp */}
      <path d="M24 54c0-5 6-8 16-8s16 3 16 8v34c0 3-6 5-16 5s-16-2-16-5z" fill={sleeve} />
      <path d="M24 54c0-5 6-8 16-8s16 3 16 8v6c-5 3-11 4.5-16 4.5S29 63 24 60z" fill={col.dark} opacity="0.35" />
      <path d="M26 62c4 2.6 9 3.8 14 3.8s10-1.2 14-3.8" stroke="#fff" stroke-width="3" fill="none" opacity="0.88" />
      <path d="M34 47l6 9 6-9z" fill={shade(col.dark, -35)} />
      {/* armen */}
      <path d={left.d} stroke={sleeve} stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none" />
      <path d={right.d} stroke={sleeve} stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none" />
      <circle cx={left.hx} cy={left.hy} r="4.4" fill={skin} />
      <circle cx={right.hx} cy={right.hy} r="4.4" fill={skin} />
      {/* hoofd (64 breed, rond 40,40 geplaatst) */}
      <g transform="translate(8 -8)">
        <Head who={rider} color={col} />
      </g>
      {medal && (
        <g>
          <path d="M34 54l-2 8M46 54l2 8" stroke={medal === 1 ? '#d33' : '#3e63dd'} stroke-width="2" />
          <circle cx="40" cy="70" r="5.4" fill={medalCol} stroke="rgba(0,0,0,.28)" stroke-width="1" />
          <text x="40" y="73.5" text-anchor="middle" font-size="8.5" font-weight="800" fill="rgba(0,0,0,.55)">
            {medal}
          </text>
        </g>
      )}
    </svg>
  );
}

/** Het ploegshirt: voor de lobby, waar nog geen renners zijn. */
export function TeamJersey({ color, size = 40 }: { color: number; size?: number }) {
  const c = teamHex(color);
  return (
    <svg class="tjersey" viewBox="0 0 48 44" width={size} height={size * (44 / 48)} aria-hidden="true">
      <path d="M16 3 4 9 1 20l8 3 2-4v23h26V19l2 4 8-3-3-11-12-6c-1 4-5 6-8 6s-7-2-8-6z" fill={c.hex} stroke="rgba(0,0,0,.35)" stroke-width="1.2" stroke-linejoin="round" />
      <path d="M11 19v6h26v-6z" fill="#fff" opacity="0.9" />
      <path d="M1 20l8 3-.6-6.5L3 11zM47 20l-8 3 .6-6.5L45 11z" fill={c.dark} />
      <path d="M24 3v14" stroke={shade(c.dark, -30)} stroke-width="1.2" />
    </svg>
  );
}

/** Drie hoofden over elkaar: de hele ploeg in één kleine afbeelding. */
export function TeamStack({ riders, color, size = 30 }: { riders: Who[]; color: number; size?: number }) {
  return (
    <span class="tstack" style={{ '--s': `${size}px` } as Record<string, string>}>
      {riders.map((r, i) => (
        <RiderAvatar key={r.id} rider={r} color={color} size={size} class={`ts-${i}`} />
      ))}
    </span>
  );
}

// ---- Medaille, munten, kaarten, kroon -----------------------------------------

export function Medal({ place, size = 26 }: { place: number; size?: number }) {
  const gold = ['#ffe27a', '#e6a800', '#7a5600'];
  const silver = ['#f4f6fb', '#aeb6cc', '#4d556e'];
  const bronze = ['#f2b27e', '#c27530', '#6a3a12'];
  const [a, b, c] = place === 1 ? gold : place === 2 ? silver : place === 3 ? bronze : ['#3b4260', '#2a2f45', '#8b91ab'];
  const id = `md-${place}`;
  return (
    <svg class="medal" viewBox="0 0 32 32" width={size} height={size} role="img" aria-label={`${place}e plek`}>
      <defs>
        <radialGradient id={id} cx="35%" cy="30%" r="80%">
          <stop offset="0" stop-color={a} />
          <stop offset="0.7" stop-color={b} />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="14.5" fill={`url(#${id})`} stroke="rgba(0,0,0,.35)" stroke-width="1.5" />
      <circle cx="16" cy="16" r="10.5" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1" />
      <text x="16" y="21.2" text-anchor="middle" font-size="14" font-weight="800" fill={c}>
        {place}
      </text>
    </svg>
  );
}

export function Crown({ size = 16 }: { size?: number }) {
  return (
    <svg class="crown" viewBox="0 0 24 16" width={size} height={size * (16 / 24)} aria-label="aan de kop">
      <path d="M2 14 1 4l6 5 5-8 5 8 6-5-1 10z" fill="#ffc83d" stroke="#8a6200" stroke-width="1" stroke-linejoin="round" />
    </svg>
  );
}

/** Munten als stapeltje muntjes. */
export function Coins({ n, max = 8 }: { n: number; max?: number }) {
  const shown = Math.min(max, Math.max(0, n));
  return (
    <span class="coins-vis" title={`${n} munten`}>
      <span class={`stackc ${shown === 0 ? 'zero' : ''}`} style={{ width: `${14 + 3 * Math.max(0, shown - 1) + 4}px` }}>
        {Array.from({ length: Math.max(1, shown) }, (_, i) => (
          <i key={i} style={{ '--i': String(i) } as Record<string, string>} />
        ))}
      </span>
      <b class="ty">{n}</b>
    </span>
  );
}

/** Kaarten in de hand als waaiertje mini-kaarten. */
export function HandFan({ n, max = 6 }: { n: number; max?: number }) {
  const shown = Math.min(max, n);
  return (
    <span class="handfan" title={`${n} kaarten`}>
      <span class="fan">
        {Array.from({ length: shown }, (_, i) => (
          <i key={i} style={{ '--a': `${(i - (shown - 1) / 2) * 9}deg`, '--x': `${i * 5}px` } as Record<string, string>} />
        ))}
      </span>
      <b class="ty">{n}</b>
    </span>
  );
}

// ---- Eigenschappen ------------------------------------------------------------------

const STAT_ORDER: Stat[] = ['kracht', 'klim', 'sprint', 'uithouding'];

/** Vier assen als vlieger: hoe groter, hoe sterker. Groen is training, rood is verlies door overtraining. */
export function StatRadar({
  base,
  eff,
  color = '#7d86a8',
  size = 96,
  max = 6,
  labels = true,
}: {
  base: Record<Stat, number>;
  eff?: Record<Stat, number>;
  color?: string;
  size?: number;
  max?: number;
  labels?: boolean;
}) {
  const e = eff ?? base;
  const R = 34;
  const c = 50;
  // klim boven, sprint rechts, uithouding onder, kracht links
  const axes: { stat: Stat; dx: number; dy: number }[] = [
    { stat: 'klim', dx: 0, dy: -1 },
    { stat: 'sprint', dx: 1, dy: 0 },
    { stat: 'uithouding', dx: 0, dy: 1 },
    { stat: 'kracht', dx: -1, dy: 0 },
  ];
  const pt = (v: number, a: { dx: number; dy: number }) => `${c + a.dx * R * Math.min(1, v / max)},${c + a.dy * R * Math.min(1, v / max)}`;
  const poly = (vals: Record<Stat, number>) => axes.map((a) => pt(vals[a.stat], a)).join(' ');
  const full = Object.fromEntries(STAT_ORDER.map((s) => [s, max])) as Record<Stat, number>;
  const half = Object.fromEntries(STAT_ORDER.map((s) => [s, max / 2])) as Record<Stat, number>;
  const hasForm = STAT_ORDER.some((s) => e[s] > base[s]);
  const hasLoss = STAT_ORDER.some((s) => e[s] < base[s]);
  return (
    <svg class="radar" viewBox="0 0 100 100" width={size} height={size} role="img" aria-label="Eigenschappen">
      <polygon points={poly(full)} fill="rgba(255,255,255,.05)" stroke="rgba(255,255,255,.18)" stroke-width="1" />
      <polygon points={poly(half)} fill="none" stroke="rgba(255,255,255,.12)" stroke-width="1" stroke-dasharray="2 2" />
      {axes.map((a) => (
        <line key={a.stat} x1={c} y1={c} x2={c + a.dx * R} y2={c + a.dy * R} stroke="rgba(255,255,255,.12)" />
      ))}
      {hasForm && <polygon points={poly(e)} fill="rgba(61,220,132,.25)" stroke="#3ddc84" stroke-width="1.6" stroke-linejoin="round" />}
      <polygon
        points={poly(hasLoss ? e : base)}
        fill={color}
        fill-opacity="0.55"
        stroke={color}
        stroke-width="2"
        stroke-linejoin="round"
      />
      {hasLoss && <polygon points={poly(base)} fill="none" stroke="#ff5c5c" stroke-width="1.4" stroke-dasharray="3 2" />}
      {labels &&
        axes.map((a) => (
          <g key={a.stat} style={{ color: '#c4c9e2' }} transform={`translate(${c + a.dx * 44 - 6} ${c + a.dy * 44 - 6})`}>
            <svg viewBox="0 0 24 24" width="12" height="12">
              <path d={STAT_PATH[a.stat]} fill="currentColor" />
            </svg>
          </g>
        ))}
    </svg>
  );
}

/** Energie als batterij: groen vol, rood leeg. */
export function Battery({ value, max, label }: { value: number; max: number; label?: boolean }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  const tone = pct <= 25 ? 'low' : pct <= 55 ? 'mid' : 'high';
  return (
    <span class={`batt ${tone}`} title={`${value}/${max} energie`}>
      <span class="cell">
        <span class="lvl" style={{ width: `${pct}%` }} />
        <svg viewBox="0 0 24 24" class="bolt" aria-hidden="true">
          <path d="M13 2 4 14h6l-1 8 9-12h-6z" fill="currentColor" />
        </svg>
      </span>
      {label && (
        <b class="ty">
          {value}/{max}
        </b>
      )}
    </span>
  );
}

export function TypeBadge({ type, label }: { type: RiderType; label?: boolean }) {
  return (
    <span class={`tbadge t-${type}`} title={RIDER_TYPES[type].label}>
      <i>{TYPE_ICON[type]}</i>
      {label && RIDER_TYPES[type].label}
    </span>
  );
}

export function QuirkTag({ quirk }: { quirk: QuirkId }) {
  return (
    <span class="qtag" title={QUIRKS[quirk].blurb}>
      <i>{QUIRK_ICON[quirk]}</i>
      {QUIRKS[quirk].label}
    </span>
  );
}

// ---- Parcoursprofiel -----------------------------------------------------------------

/** Hoogte per tegelgrens (0..1): klimmen stijgt, afdalen daalt, kasseien trillen. */
export function elevation(terrain: Terrain[]): number[] {
  const raw = [0];
  let y = 0;
  terrain.forEach((t, i) => {
    y += t === 'climb' ? 1 : t === 'descent' ? -1.2 : t === 'cobbles' ? (i % 2 ? 0.25 : -0.25) : 0;
    raw.push(y);
  });
  const lo = Math.min(...raw);
  const hi = Math.max(...raw);
  const span = hi - lo;
  return raw.map((v) => (span < 0.5 ? 0.35 : 0.22 + ((v - lo) / span) * 0.58));
}

export function elevationAt(el: number[], pos: number): number {
  const p = Math.min(el.length - 1, Math.max(0, pos));
  const i = Math.min(el.length - 2, Math.floor(p));
  return el[i] + (el[i + 1] - el[i]) * (p - i);
}

export interface ProfileRider {
  id: string;
  pos: number;
  color: number;
  type: RiderType;
  mine?: boolean;
  kop?: boolean;
  first?: boolean;
}

/** Het parcours als berglandschap, met de renners er zelf op. */
export function ElevationProfile({
  terrain,
  premies = [],
  riders = [],
  class: cls = '',
  children,
}: {
  terrain: Terrain[];
  premies?: { id: string; pos: number }[];
  riders?: ProfileRider[];
  class?: string;
  children?: ComponentChildren;
}) {
  const n = Math.max(1, terrain.length);
  const el = elevation(terrain);
  const X = (i: number) => i;
  const Y = (v: number) => 100 - v * 100;
  const line = el.map((v, i) => `${X(i)},${Y(v)}`).join(' ');
  return (
    <div class={`elev ${cls}`}>
      <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden="true">
        {terrain.map((t, i) => (
          <polygon
            key={i}
            points={`${i},100 ${i},${Y(el[i])} ${i + 1.04},${Y(el[i + 1])} ${i + 1.04},100`}
            fill={TERRAIN_FILL[t]}
            opacity={t === 'flat' ? 0.9 : 0.95}
          />
        ))}
        {terrain.map(
          (t, i) =>
            t === 'cobbles' && (
              <polygon
                key={`c${i}`}
                points={`${i},100 ${i},${Y(el[i])} ${i + 1},${Y(el[i + 1])} ${i + 1},100`}
                fill="url(#cobbles)"
              />
            ),
        )}
        <defs>
          <pattern id="cobbles" width="0.5" height="14" patternUnits="userSpaceOnUse">
            <rect width="0.22" height="9" rx="0.05" fill="rgba(0,0,0,.28)" />
          </pattern>
        </defs>
        <polyline points={line} fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
      </svg>
      {premies.map((p) => (
        <span key={p.id} class="eflag" style={{ left: `${(Math.min(n, p.pos) / n) * 100}%`, bottom: `${elevationAt(el, p.pos) * 100}%` }}>
          <i />
        </span>
      ))}
      <span class="efinish" />
      {riders.map((r) => (
        <span
          key={r.id}
          class={`erider ${r.mine ? 'mine' : ''} ${r.kop ? 'kop' : ''} ${r.first ? 'first' : ''}`}
          style={{ left: `${(Math.min(n, Math.max(0, r.pos)) / n) * 100}%`, bottom: `calc(${elevationAt(el, r.pos) * 100}% - 2px)`, '--c': teamHex(r.color).hex } as Record<string, string>}
        >
          <RiderAvatar rider={{ id: r.id, type: r.type }} color={r.color} size="100%" bg={false} />
        </span>
      ))}
      {children}
    </div>
  );
}

// ---- Podium ---------------------------------------------------------------------------

export interface PodiumEntry {
  teamId: string;
  name: string;
  color: number;
  rider?: Rider;
  riderLabel?: string; // "Remco · 1e in de etappe"
  points: number;
  pointsLabel: string; // "+10"
  sub?: string; // "(10 totaal)"
}

const POSES: Pose[] = ['cheer', 'wave', 'stand'];

/**
 * Een echt podium: de nummer 1 in het midden en hoger, 2 links, 3 rechts. De renner staat erop,
 * de rest van de ploegen staat eronder.
 */
export function Podium({ entries, confetti = true, compact = false }: { entries: PodiumEntry[]; confetti?: boolean; compact?: boolean }) {
  const top = entries.slice(0, 3);
  const rest = entries.slice(3);
  // Weergave-volgorde: 2e, 1e, 3e (zonder gaten bij minder ploegen).
  const order = top.length >= 3 ? [1, 0, 2] : top.length === 2 ? [1, 0] : [0];
  const max = Math.max(1, ...entries.map((e) => e.points));
  return (
    <div class={`podium3 ${compact ? 'compact' : ''}`}>
      {confetti && top.length > 0 && <Confetti colors={top[0] ? [teamHex(top[0].color).hex, '#ffc83d', '#fff', '#7ec8f2'] : undefined} />}
      <div class="stage3">
        {order.map((idx) => {
          const e = top[idx];
          const place = idx + 1;
          const col = teamHex(e.color);
          const win = place === 1;
          return (
            <div class={`step3 s${place}`} key={e.teamId} style={{ '--c': col.hex, '--cd': col.dark } as Record<string, string>}>
              <div class="onstep">
                {win && <span class="trophy" aria-hidden="true">🏆</span>}
                {e.rider ? (
                  <RiderFigure rider={e.rider} color={e.color} pose={POSES[idx] ?? 'stand'} medal={place as 1 | 2 | 3} class={win ? 'win' : ''} />
                ) : (
                  <span class="nofig">{place}</span>
                )}
                {e.riderLabel && <span class="figname">{e.riderLabel}</span>}
              </div>
              <div class="block">
                <span class="num ty">{place}</span>
                <span class="tn">{e.name}</span>
                <span class="tp ty">{e.pointsLabel}</span>
                {e.sub && <span class="tsub">{e.sub}</span>}
              </div>
            </div>
          );
        })}
      </div>
      {rest.length > 0 && (
        <div class="podrest">
          {rest.map((e, i) => (
            <div class="prow" key={e.teamId} style={{ '--c': teamHex(e.color).hex } as Record<string, string>}>
              <span class="rk ty">{i + 4}</span>
              {e.rider && <RiderAvatar rider={e.rider} color={e.color} size={30} />}
              <b>{e.name}</b>
              <span class="pbar">
                <i style={{ width: `${(e.points / max) * 100}%` }} />
              </span>
              <span class="ty">{e.pointsLabel}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Confetti({ colors = ['#ffc83d', '#e5484d', '#3e63dd', '#30a46c', '#fff'] }: { colors?: string[] }) {
  return (
    <span class="confetti" aria-hidden="true">
      {Array.from({ length: 36 }, (_, i) => {
        const r = (k: number) => ((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
        return (
          <i
            key={i}
            style={
              {
                left: `${r(1) * 100}%`,
                background: colors[i % colors.length],
                '--d': `${3 + r(2) * 3}s`,
                '--w': `${r(3) * 4}s`,
                '--x': `${(r(4) - 0.5) * 120}px`,
                '--rot': `${r(5) * 720}deg`,
              } as Record<string, string>
            }
          />
        );
      })}
    </span>
  );
}
