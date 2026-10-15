// Opbouw: spel, parcours, premies en renners aanmaken.

import { CARD_DEF_LIST, COURSES, stageInfo } from '../content';
import { pick, randInt, shuffle } from '../rng';
import { DECK_BASE_TEAMS, MARKET_SIZE, STAGES, TRACK_LENGTH } from '../types';
import type { Card, GameState, Premie, Rider, Terrain } from '../types';
import { effectiveStats } from './calc';

// ---- Opbouw ------------------------------------------------------------------

export function createGame(seed: number): GameState {
  return {
    phase: 'lobby',
    tutorial: false,
    commentary: false,
    briefing: null,
    kopman: {},
    premies: [],
    round: 0,
    stage: 0,
    course: [],
    trackLength: TRACK_LENGTH,
    terrain: [],
    teams: [],
    riders: [],
    event: null,
    eventDeck: [],
    deck: [],
    discard: [],
    market: [],
    draft: null,
    recruit: null,
    weather: 'dry',
    ready: {},
    efforts: {},
    cars: {},
    plays: {},
    locked: {},
    offers: [],
    sabotageLog: [],
    report: null,
    stageResult: null,
    season: null,
    rng: seed | 0,
    nextCardId: 1,
    nextOfferId: 1,
    nextRiderId: 1,
  };
}

/** Trekt de parcoursen van een seizoen: twee verschillende gewone etappes en een finale. */
export function pickCourse(s: { rng: number }): string[] {
  const regular = shuffle(s, COURSES.filter((c) => !c.finale));
  const finale = pick(s, COURSES.filter((c) => c.finale));
  return [...regular.slice(0, STAGES - 1).map((c) => c.id), finale.id];
}

export function makeTrack(s: { rng: number }, length: number, stage: number, course?: readonly string[]): Terrain[] {
  const out: Terrain[] = [];
  const push = (t: Terrain, n: number) => {
    for (let i = 0; i < n && out.length < length; i++) out.push(t);
  };
  const body = stageInfo(course, Math.min(STAGES, Math.max(1, stage))).body;
  push('flat', 4);
  let guard = 0;
  while (out.length < length - 5 && guard++ < 60) {
    const t = pick(s, body);
    if (t === 'descent' && out[out.length - 1] !== 'climb') {
      push('climb', 3 + randInt(s, 2));
      push('descent', 2 + randInt(s, 2));
    } else push(t, 3 + randInt(s, 3));
  }
  push('flat', length); // sprintaankomst
  return out.slice(0, length);
}

/** Een tussensprint halverwege en, als er een klim is, een bergpremie bovenop de laatste klim. */
export function makePremies(terrain: Terrain[], length: number): Premie[] {
  const out: Premie[] = [];
  // Bergpremie: het einde van de laatste klim die ver genoeg voor de finish eindigt.
  let top = -1;
  for (let i = 0; i < length - 1; i++) {
    if (terrain[i] === 'climb' && terrain[i + 1] !== 'climb' && i + 1 <= length - 10) top = i + 1;
  }
  if (top >= 10) out.push({ id: 'berg', pos: top, hits: [] });
  // Tussensprint: ongeveer halverwege op vlak of kasseien, ver genoeg van de bergpremie.
  const want = Math.round(length * (top >= 0 && top < length * 0.5 ? 0.7 : 0.4));
  let best = -1;
  for (let i = 8; i <= length - 10; i++) {
    if (terrain[i] === 'climb' || terrain[i] === 'descent') continue;
    if (top >= 0 && Math.abs(i - top) < 6) continue;
    if (best < 0 || Math.abs(i - want) < Math.abs(best - want)) best = i;
  }
  if (best >= 0) out.push({ id: 'sprint', pos: best, hits: [] });
  return out.sort((a, b) => a.pos - b.pos);
}

/** Hoe goed past deze renner bij het parcours? Gemiddelde eigenschap per tegel, plus een duit voor uithouding. */
export function stageFit(r: Rider, terrain: Terrain[], tolerance: number): number {
  if (terrain.length === 0) return 0;
  const st = effectiveStats(r, tolerance);
  let sum = 0;
  terrain.forEach((t, i) => {
    sum += terrain.length - i <= 3 ? st.sprint : t === 'climb' ? st.klim : st.kracht;
  });
  return sum / terrain.length + st.uithouding * 0.25;
}

export function newCard(s: GameState, def: string): Card {
  return { id: `c${s.nextCardId++}`, def };
}

export function buildDeck(s: GameState): Card[] {
  const cards: Card[] = [];
  // Het basisspel is afgestemd op zes teams; met meer teams groeit de stapel mee, anders raakt hij leeg.
  const scale = Math.max(1, s.teams.length / DECK_BASE_TEAMS);
  for (const d of CARD_DEF_LIST) for (let i = 0; i < Math.ceil(d.count * scale); i++) cards.push(newCard(s, d.id));
  return shuffle(s, cards);
}

export function drawCard(s: GameState): Card | null {
  if (s.deck.length === 0) {
    if (s.discard.length === 0) return null;
    s.deck = shuffle(s, s.discard);
    s.discard = [];
  }
  return s.deck.pop() ?? null;
}

export function refillMarket(s: GameState): void {
  while (s.market.length < MARKET_SIZE) {
    const c = drawCard(s);
    if (!c) break;
    s.market.push(c);
  }
}
