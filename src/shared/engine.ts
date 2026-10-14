// Regelmotor van Peloton Panic: een pure reducer over GameState.
// reduce(state, action) wijzigt de invoer nooit en gooit een RuleError bij een illegale zet.
//
// Een seizoen = 3 etappes. Elke etappe: draft (kaarten kiezen) -> team (voorbereiden,
// winkelen, trainen, ruilen) -> race (per ronde: Rustig / Normaal / Alles geven) -> uitslag.

import {
  BRIEFING,
  CARD_DEFS,
  CARD_DEF_LIST,
  CONTRACT_LIST,
  EFFORTS,
  EVENTS,
  EVENT_IDS,
  RIDER_NAME_POOL,
  RIDER_TYPES,
  RIDER_TYPE_LIST,
  STAGE_INFO,
  TALENT_TIERS,
  TEAM_COLORS,
} from './content';
import type { CardDef, Perk } from './content';
import { pick, randInt, shuffle } from './rng';
import {
  ALONE_COST,
  ALONE_MOVE,
  DRAFT_BIG,
  BLIND_COST,
  BLOCK_PENALTY,
  BLOCK_RANGE,
  CAR_ENERGY,
  CAR_ENERGY_UPGRADED,
  CHASE_FAR,
  CHASE_GAP,
  CHASE_NEAR,
  COLA_BONUS,
  CRASH_ALL_OUT,
  CRASH_BASE,
  CRASH_COBBLES,
  CRASH_CROWD,
  CRASH_DESCENT,
  CRASH_ENERGY,
  CRASH_LOSS,
  CRASH_WET,
  DOMINO_CHANCE,
  DOMINO_LOSS,
  DOMINO_RANGE,
  ENERGY_BASE,
  ENERGY_MIN,
  ENERGY_PER_UITHOUDING,
  FATIGUE_CAP,
  FORM_CAP,
  GEL_ENERGY,
  GROUP_GAP,
  HELP_BONUS,
  HELP_RANGE,
  KOPMAN_FACTOR,
  MARKET_SIZE,
  MAX_TEAMS,
  MIN_TEAMS,
  OVERTRAIN_FREE,
  PECH_CHANCE,
  PELOTON_MIN,
  PELOTON_REST,
  POINT_BONUS_STEP,
  POINTS_BY_RANK,
  PREMIE_POINTS,
  RECRUIT_PICKS,
  RIDERS_PER_TEAM,
  SHOP_CONTRACTS,
  SLOT_LIMITS,
  STAGES,
  STAT_FACTOR,
  START_COINS,
  TEAM_BONUS,
  TEAM_BONUS_MAX,
  TRACK_LENGTH,
  TRAININGS_PER_RIDER,
} from './types';
import type {
  Action,
  ActiveEvent,
  Award,
  Card,
  Effort,
  EventId,
  GameState,
  MoveParts,
  Offer,
  OfferView,
  PickSource,
  PlayHit,
  PlayerView,
  Premie,
  PremieHit,
  PublicState,
  QuirkId,
  RaceItem,
  RacePlay,
  ResolveReport,
  Rider,
  RiderMove,
  RiderType,
  ShopItem,
  SlotKind,
  Stat,
  Stats,
  Team,
  Terrain,
  Weather,
} from './types';

export class RuleError extends Error {}

const QUIRK_IDS: QuirkId[] = [
  'croissant',
  'waver',
  'cobbleKing',
  'descentFear',
  'windHardened',
  'socks',
  'finisher',
  'napper',
  'rainKing',
  'sugarCube',
  'clumsy',
  'daredevil',
  'lucky',
];
const WEATHER_DECK: Weather[] = ['dry', 'dry', 'mixed', 'mixed', 'rain'];
const STAT_KEYS: Stat[] = ['kracht', 'klim', 'sprint', 'uithouding'];
const ZERO: Stats = { kracht: 0, klim: 0, sprint: 0, uithouding: 0 };

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

export function makeTrack(s: { rng: number }, length: number, stage: number): Terrain[] {
  const out: Terrain[] = [];
  const push = (t: Terrain, n: number) => {
    for (let i = 0; i < n && out.length < length; i++) out.push(t);
  };
  const body = STAGE_INFO[Math.min(STAGES, Math.max(1, stage)) - 1].body;
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

function newCard(s: GameState, def: string): Card {
  return { id: `c${s.nextCardId++}`, def };
}

function buildDeck(s: GameState): Card[] {
  const cards: Card[] = [];
  for (const d of CARD_DEF_LIST) for (let i = 0; i < d.count; i++) cards.push(newCard(s, d.id));
  return shuffle(s, cards);
}

function drawCard(s: GameState): Card | null {
  if (s.deck.length === 0) {
    if (s.discard.length === 0) return null;
    s.deck = shuffle(s, s.discard);
    s.discard = [];
  }
  return s.deck.pop() ?? null;
}

function refillMarket(s: GameState): void {
  while (s.market.length < MARKET_SIZE) {
    const c = drawCard(s);
    if (!c) break;
    s.market.push(c);
  }
}

// ---- Berekeningen (ook door de telefoon gebruikt) ----------------------------

/** Telt de eigenschappen van alle spullen van een team bij elkaar op. */
export function perksOf(defIds: string[]): Required<Perk> {
  const total: Required<Perk> = {
    income: 0,
    podiumBonus: 0,
    winBonus: 0,
    pointBonus: 0,
    gels: 0,
    colas: 0,
    startEnergy: 0,
    restBonus: 0,
    allesDiscount: 0,
    pechReduction: 0,
    shield: 0,
    flat: 0,
    climb: 0,
    descent: 0,
    service: 0,
    fatigueRecover: 0,
    overtrainTolerance: 0,
    wetGrip: 0,
  };
  for (const id of defIds) {
    const p = CARD_DEFS[id]?.perk;
    if (!p) continue;
    for (const k of Object.keys(total) as (keyof Perk)[]) total[k] += p[k] ?? 0;
  }
  return total;
}

export function teamDefIds(slots: Record<SlotKind, ({ def: string } | string)[]>): string[] {
  const out: string[] = [];
  for (const list of Object.values(slots)) for (const c of list) out.push(typeof c === 'string' ? c : c.def);
  return out;
}

export function overtrainPenalty(r: Pick<Rider, 'fatigue'>, tolerance: number): number {
  return Math.max(0, r.fatigue - OVERTRAIN_FREE - tolerance);
}

/** Een zware val werkt door in de volgende etappe: daar is de renner -1 op alles. */
export function injuryPenalty(r: Pick<Rider, 'injury'>): number {
  return r.injury > 0 ? 1 : 0;
}

export function effectiveStats(r: Rider, tolerance: number): Stats {
  const pen = overtrainPenalty(r, tolerance) + injuryPenalty(r);
  const out = { ...ZERO };
  for (const k of STAT_KEYS) out[k] = Math.max(0, r.base[k] + r.form[k] - pen);
  return out;
}

export function maxEnergyFor(r: Rider, perks: Required<Perk>, bidon: boolean): number {
  const stats = effectiveStats(r, perks.overtrainTolerance);
  return Math.max(ENERGY_MIN, ENERGY_BASE + ENERGY_PER_UITHOUDING * stats.uithouding + perks.startEnergy - (bidon ? 3 : 0));
}

/** Renners starten niet vol: zo loont het om onderweg te sparen (Rustig rijden). Voeding/teambus tellen wel volledig mee. */
export const START_ENERGY_FRACTION = 0.6;

export function startEnergyFor(maxEnergy: number, perks: Required<Perk>, napper = false): number {
  if (napper) return maxEnergy;
  const base = Math.max(0, maxEnergy - perks.startEnergy);
  return Math.min(maxEnergy, Math.ceil(base * START_ENERGY_FRACTION) + perks.startEnergy);
}

type RaceView = Pick<PublicState, 'terrain' | 'trackLength' | 'event'> & { weather?: Weather };

export const WET_TERRAIN: Partial<Record<Terrain, number>> = { descent: -1, cobbles: -1 };

/** Nat wegdek door het weer van de etappe of door een bui. */
export function isWet(race: Pick<RaceView, 'weather' | 'event'>): boolean {
  return race.weather === 'rain' || race.event?.id === 'rain' || race.event?.id === 'storm';
}

export interface GroupInfo {
  size: number; // renners in deze groep
  mates: number; // teamgenoten van deze renner in dezelfde groep
  bottom: number; // positie van de laatste renner in de groep
  top: number; // positie van de eerste renner in de groep
}

/** Groepen aan het begin van een ronde: renners met hooguit GROUP_GAP tegels ertussen rijden samen. */
export function groupsOf(riders: Pick<Rider, 'id' | 'teamId' | 'pos'>[]): Map<string, GroupInfo> {
  const sorted = [...riders].sort((a, b) => a.pos - b.pos);
  const groups: (typeof sorted)[] = [];
  for (const r of sorted) {
    const cur = groups[groups.length - 1];
    if (cur && r.pos - cur[cur.length - 1].pos <= GROUP_GAP) cur.push(r);
    else groups.push([r]);
  }
  const out = new Map<string, GroupInfo>();
  for (const g of groups) {
    const bottom = g[0].pos;
    const top = g[g.length - 1].pos;
    for (const r of g) {
      out.set(r.id, { size: g.length, mates: g.filter((x) => x.teamId === r.teamId && x.id !== r.id).length, bottom, top });
    }
  }
  return out;
}

/** Kans (in procenten) dat deze renner deze ronde valt. */
export function crashChance(
  race: RaceView,
  rider: Rider,
  effort: Effort,
  perks: Pick<Required<Perk>, 'wetGrip'>,
  neighbours: number,
): number {
  const terrain = terrainAt(race, rider.pos);
  const ev = race.event ? EVENTS[race.event.id] : null;
  // Het natte deel van de kans: regenbanden of een regenkoning halveren dat.
  let wet = race.weather === 'rain' ? CRASH_WET : race.weather === 'mixed' ? 2 : 0;
  wet += ev?.crashBonus ?? 0;
  if (perks.wetGrip > 0 && isWet(race)) wet = Math.floor(wet / 2);
  if (rider.quirk === 'rainKing' && isWet(race)) wet = Math.floor(wet / 2);
  let c = CRASH_BASE + wet;
  if (terrain === 'descent') c += CRASH_DESCENT;
  if (terrain === 'cobbles') c += CRASH_COBBLES;
  if (effort === 'alles') c += CRASH_ALL_OUT;
  c += Math.min(4, Math.max(0, neighbours - 2) * CRASH_CROWD);
  if (rider.quirk === 'clumsy') c += 4;
  if (rider.quirk === 'daredevil') c += 3;
  return Math.min(40, c);
}

export function terrainAt(r: { terrain: Terrain[]; trackLength: number }, pos: number): Terrain {
  const i = Math.max(0, Math.min(r.trackLength - 1, Math.floor(pos)));
  return r.terrain[i] ?? 'flat';
}

export function statFor(race: { trackLength: number }, rider: Rider, terrain: Terrain): Stat {
  if (race.trackLength - rider.pos <= 3) return 'sprint';
  return terrain === 'climb' ? 'klim' : 'kracht';
}

/** Alles behalve geluk, drafting en inhaaldrang. */
export function baseParts(
  race: RaceView,
  rider: Rider,
  perks: Required<Perk>,
  effort: Effort,
  exhausted: boolean,
): MoveParts {
  const terrain = terrainAt(race, rider.pos);
  const stats = effectiveStats(rider, perks.overtrainTolerance);
  const stat = Math.round(stats[statFor(race, rider, terrain)] * STAT_FACTOR);

  let terr = 0;
  // Regen over de hele etappe: dezelfde straf als de bui, tenzij je renner regenbanden heeft.
  if (race.weather === 'rain' && perks.wetGrip === 0) terr += WET_TERRAIN[terrain] ?? 0;
  if (terrain === 'descent') terr += 1 + perks.descent;
  if (terrain === 'flat' && effort !== 'rustig') terr += perks.flat;
  if (terrain === 'climb' && effort !== 'rustig') terr += perks.climb;

  let quirk = 0;
  switch (rider.quirk) {
    case 'waver':
      quirk = terrain === 'flat' ? -1 : terrain === 'climb' ? 1 : 0;
      break;
    case 'cobbleKing':
      quirk = terrain === 'cobbles' ? 1 : 0;
      break;
    case 'descentFear':
      quirk = terrain === 'descent' ? -1 : 0;
      break;
    case 'finisher':
      quirk = race.trackLength - rider.pos <= 3 ? 1 : 0;
      break;
    case 'daredevil':
      quirk = terrain === 'descent' ? 1 : 0;
      break;
    case 'rainKing':
      quirk = isWet(race) ? 1 : 0;
      break;
    case 'sugarCube':
      quirk = isWet(race) ? -1 : 0;
      break;
  }

  let event = 0;
  const ev = race.event;
  if (ev) {
    const def = EVENTS[ev.id];
    const g = def.global ?? 0;
    event += g < 0 && rider.quirk === 'windHardened' ? 0 : g;
    const t = def.terrain?.[terrain] ?? 0;
    event += t < 0 && perks.wetGrip > 0 && ev.id === 'rain' ? 0 : t;
    if (ev.targetRiderId === rider.id) event += def.targetRider ?? 0;
    if (ev.targetTeamId === rider.teamId) event += def.targetTeam ?? 0;
  }

  return {
    effort: exhausted ? 0 : EFFORTS[effort].base,
    stat,
    terrain: terr,
    quirk,
    event,
    luck: 0,
    tired: exhausted ? -1 : 0,
    draft: 0,
    chase: 0,
    help: 0,
    item: 0,
    team: 0,
    crash: 0,
  };
}

/** Wat een renner met zoveel energie werkelijk kan: Alles geven kost 3 (minus korting), Normaal 1. */
export function allesCost(perks: Pick<Required<Perk>, 'allesDiscount'>): number {
  return Math.max(1, -EFFORTS.alles.energy - perks.allesDiscount);
}

export function resolveEffort(
  energy: number,
  perks: Pick<Required<Perk>, 'allesDiscount'>,
  chosen: Effort,
): { effort: Effort; exhausted: boolean } {
  // Een helpende knecht rijdt qua energie als Normaal; zijn eigen beweging laat hij liggen.
  let effort: Effort = chosen === 'helpen' ? 'normaal' : chosen;
  if (effort === 'alles' && energy < allesCost(perks)) effort = 'normaal';
  if (effort === 'normaal' && energy < 1) effort = 'rustig';
  return { effort, exhausted: energy <= 0 && chosen !== 'rustig' };
}

export function sumParts(p: MoveParts): number {
  return Math.max(
    0,
    p.effort + p.stat + p.terrain + p.quirk + p.event + p.luck + p.tired + p.draft + p.chase + p.help + p.item + p.team + p.crash,
  );
}

// ---- Hulpfuncties ------------------------------------------------------------

function teamOf(s: GameState, teamId: string): Team {
  const t = s.teams.find((x) => x.id === teamId);
  if (!t) throw new RuleError('Onbekend team');
  return t;
}

function riderOf(s: GameState, riderId: string): Rider {
  const r = s.riders.find((x) => x.id === riderId);
  if (!r) throw new RuleError('Onbekende renner');
  return r;
}

function perksOfTeam(team: Team): Required<Perk> {
  return perksOf(teamDefIds(team.slots));
}

function leaderRider(riders: Rider[]): Rider {
  return riders.reduce((best, r) => (r.pos > best.pos ? r : best), riders[0]);
}

function takeFromHand(team: Team, cardId: string): Card {
  const i = team.hand.findIndex((c) => c.id === cardId);
  if (i < 0) throw new RuleError('Je hebt die kaart niet');
  return team.hand.splice(i, 1)[0];
}

function currentDraftTeam(s: GameState): string | null {
  return s.draft && s.draft.idx < s.draft.order.length ? s.draft.order[s.draft.idx] : null;
}

// ---- Reducer -----------------------------------------------------------------

export function reduce(prev: GameState, action: Action): GameState {
  const s = structuredClone(prev) as GameState;
  switch (action.type) {
    case 'join':
      return join(s, action.name, !!action.isBot);
    case 'recruit':
      return recruitBuy(s, action.teamId, action.itemId);
    case 'nameRiders':
      return nameRiders(s, action.teamId, action.names);
    case 'setTutorial':
      if (s.phase !== 'lobby') throw new RuleError('De tutorial kies je voor de start');
      s.tutorial = action.on;
      return s;
    case 'setCommentary':
      if (s.phase !== 'lobby') throw new RuleError('Het commentaar kies je voor de start');
      s.commentary = action.on;
      return s;
    case 'start':
      return start(s);
    case 'briefPage': {
      if (s.phase !== 'briefing' || !s.briefing) throw new RuleError('Er is nu geen uitleg');
      s.briefing.page = Math.max(0, Math.min(BRIEFING.length - 1, Math.round(action.page)));
      return s;
    }
    case 'briefOk': {
      if (s.phase !== 'briefing' || !s.briefing) throw new RuleError('Er is nu geen uitleg');
      teamOf(s, action.teamId);
      s.briefing.ok[action.teamId] = action.on;
      return s;
    }
    case 'briefDone': {
      if (s.phase !== 'briefing') throw new RuleError('Er is nu geen uitleg');
      s.briefing = null;
      startRecruit(s);
      return s;
    }
    case 'kopman':
      return setKopman(s, action.teamId, action.riderId);
    case 'draftPick':
      return draftPick(s, action.teamId, action.source);
    case 'draftSkip':
      if (s.phase !== 'draft' || currentDraftTeam(s) !== action.teamId) throw new RuleError('Je bent niet aan de beurt');
      advanceDraft(s);
      return s;
    case 'buy':
      return buy(s, action.teamId, action.source);
    case 'train':
      return train(s, action.teamId, action.cardId, action.riderId);
    case 'install':
      return install(s, action.teamId, action.cardId, action.replaceDef);
    case 'sabotage':
      return sabotage(s, action.teamId, action.cardId, action.targetTeamId);
    case 'offer':
      return offer(s, action);
    case 'withdraw':
      s.offers = s.offers.filter((o) => o.from !== action.teamId);
      return s;
    case 'respond':
      return respond(s, action.teamId, action.offerId, action.accept);
    case 'ready':
      if (s.phase !== 'team' && s.phase !== 'naming' && s.phase !== 'recruit') throw new RuleError('Nu kun je niet klaarzetten');
      if (s.phase === 'recruit' && teamOf(s, action.teamId).riderIds.length < RECRUIT_PICKS)
        throw new RuleError(`Kies eerst ${RECRUIT_PICKS} renners`);
      teamOf(s, action.teamId);
      s.ready[action.teamId] = true;
      if (s.teams.every((t) => s.ready[t.id])) {
        if (s.phase === 'recruit') endRecruit(s);
        else if (s.phase === 'naming') endNaming(s);
        else startRace(s);
      }
      return s;
    case 'unready':
      if (s.phase === 'team' || s.phase === 'naming' || s.phase === 'recruit') s.ready[action.teamId] = false;
      return s;
    case 'effort':
      return setEfforts(s, action.teamId, action.efforts, action.car, action.plays);
    case 'unlock':
      if (s.phase === 'race') s.locked[action.teamId] = false;
      return s;
    case 'next':
      if (s.phase === 'resolve') afterResolve(s);
      return s;
    case 'nextStage':
      if (s.phase === 'results') afterResults(s);
      return s;
    case 'timeout':
      return timeout(s);
    case 'rematch':
      return rematch(s);
    case 'removeBot': {
      if (s.phase !== 'lobby') throw new RuleError('Bots verwijder je alleen in de lobby');
      const last = s.teams[s.teams.length - 1];
      if (!last?.isBot) throw new RuleError('Geen bot om te verwijderen');
      s.teams.pop();
      s.riders = s.riders.filter((r) => r.teamId !== last.id);
      return s;
    }
  }
}

function timeout(s: GameState): GameState {
  switch (s.phase) {
    case 'recruit': {
      // Wie nog niet klaar is, krijgt een winkelbezoek op de automatische piloot.
      for (const t of s.teams) {
        for (let guard = 0; guard < 12 && !s.ready[t.id]; guard++) {
          const a = botShopStep(s, t.id, () => 0.5);
          if (!a) break;
          if (a.type === 'recruit') recruitBuy(s, t.id, a.itemId);
          else s.ready[t.id] = true;
        }
      }
      endRecruit(s);
      break;
    }
    case 'draft': {
      const teamId = currentDraftTeam(s);
      if (teamId) autoPick(s, teamId);
      break;
    }
    case 'team':
      startRace(s);
      break;
    case 'race':
      resolveRound(s);
      break;
    case 'resolve':
      afterResolve(s);
      break;
    case 'results':
      afterResults(s);
      break;
  }
  return s;
}

// ---- Lobby en start ----------------------------------------------------------

function join(s: GameState, name: string, isBot: boolean): GameState {
  if (s.phase !== 'lobby') throw new RuleError('De race is al begonnen');
  if (s.teams.length >= MAX_TEAMS) throw new RuleError('Het peloton zit vol');
  const clean = name.trim().slice(0, 16) || (isBot ? 'Bot' : 'Speler');
  const used = new Set(s.teams.map((t) => t.color));
  let color = 0;
  while (used.has(color)) color++;
  const teamId = `t${s.teams.length + 1}`;
  s.teams.push({
    id: teamId,
    name: clean,
    color,
    riderIds: [],
    coins: START_COINS,
    points: 0,
    hand: [],
    slots: { sponsor: [], staff: [], material: [], car: [] },
    sabotage: [],
    raceShield: 0,
    stats: { roundsLed: 0, trades: 0, trainings: 0, alles: 0, exhausted: 0, sabotages: 0, helps: 0, premies: 0, items: 0, blocks: 0, crashes: 0 },
    isBot,
  });
  return s;
}

function bestKopman(s: GameState, team: Team): string {
  const tol = perksOfTeam(team).overtrainTolerance;
  return [...team.riderIds]
    .map((id) => riderOf(s, id))
    .sort((a, b) => stageFit(b, s.terrain, tol) - stageFit(a, s.terrain, tol))[0]?.id ?? '';
}

/** Een knecht kan alleen helpen als hij in de buurt van zijn kopman rijdt. */
export function canHelp(s: Pick<GameState, 'kopman' | 'riders'>, r: Pick<Rider, 'id' | 'teamId' | 'pos'>): boolean {
  const kopmanId = s.kopman[r.teamId];
  if (!kopmanId || kopmanId === r.id) return false;
  const kop = s.riders.find((x) => x.id === kopmanId);
  return !!kop && Math.abs(kop.pos - r.pos) <= HELP_RANGE;
}

/** Een knecht kan een tegenstander alleen blokkeren als die binnen bereik rijdt. */
export function canBlock(blocker: Pick<Rider, 'teamId' | 'pos'>, target: Pick<Rider, 'teamId' | 'pos'>): boolean {
  return blocker.teamId !== target.teamId && Math.abs(blocker.pos - target.pos) <= BLOCK_RANGE;
}

function setKopman(s: GameState, teamId: string, riderId: string): GameState {
  if (s.phase !== 'team') throw new RuleError('Je kiest je kopman tijdens de voorbereiding');
  const team = teamOf(s, teamId);
  if (!team.riderIds.includes(riderId)) throw new RuleError('Dat is jouw renner niet');
  s.kopman[teamId] = riderId;
  return s;
}

function start(s: GameState): GameState {
  if (s.phase !== 'lobby') throw new RuleError('Al begonnen');
  if (s.teams.length < MIN_TEAMS) throw new RuleError(`Je hebt minstens ${MIN_TEAMS} teams nodig`);
  s.deck = buildDeck(s);
  s.discard = [];
  s.market = [];
  refillMarket(s);
  s.stage = 0;
  s.season = null;
  s.stageResult = null;
  s.sabotageLog = [];
  s.riders = [];
  s.recruit = null;
  s.teams.forEach((t) => {
    t.riderIds = [];
    t.coins = START_COINS;
    t.points = 0;
    t.hand = [];
    t.slots = { sponsor: [], staff: [], material: [], car: [] };
    t.stats = { roundsLed: 0, trades: 0, trainings: 0, alles: 0, exhausted: 0, sabotages: 0, helps: 0, premies: 0, items: 0, blocks: 0, crashes: 0 };
  });
  beginStage(s);
  // Eerst de uitleg, zonder timer. Daarna pas de draft.
  s.phase = 'briefing';
  s.briefing = { page: 0, ok: {} };
  return s;
}

function beginStage(s: GameState): void {
  s.stage += 1;
  s.terrain = makeTrack(s, s.trackLength, s.stage);
  s.premies = makePremies(s.terrain, s.trackLength);
  s.riders.forEach((r) => {
    r.pos = 0;
    r.trained = 0;
    r.energy = 0;
  });
  // Standaard kopman: de renner die het best bij het parcours past. Je kunt dit nog wijzigen.
  s.kopman = {};
  for (const t of s.teams) if (t.riderIds.length > 0) s.kopman[t.id] = bestKopman(s, t);
  s.teams.forEach((t) => {
    t.sabotage = [];
  });
  s.weather = pick(s, WEATHER_DECK);
  s.round = 0;
  s.event = null;
  s.eventDeck = [];
  s.report = null;
  s.stageResult = null;
  s.sabotageLog = [];
  s.offers = [];
  s.ready = {};
  s.efforts = {};
  s.cars = {};
  s.plays = {};
  s.locked = {};
  // Elke renner begint een etappe met een gratis gel: er valt altijd iets te kiezen in de race.
  for (const t of s.teams) for (let i = 0; i < RIDERS_PER_TEAM; i++) t.hand.push(newCard(s, 'gel'));
  // Etappe 1: de sponsors worden pas getekend na het rekruteren, zie endRecruit.
  if (s.stage > 1) for (const t of s.teams) deliverSupplies(s, t);
  // Etappe 1: willekeurig. Daarna begint de laagste in het klassement (inhaalrace).
  const ids = s.teams.map((t) => t.id);
  const order =
    s.stage === 1
      ? shuffle(s, ids)
      : [...s.teams]
          .map((t) => ({ t, tie: randInt(s, 1000) }))
          .sort((a, b) => a.t.points - b.t.points || a.tie - b.tie)
          .map((x) => x.t.id);
  s.draft = { order: [...order, ...[...order].reverse()], idx: 0 };
  s.phase = 'draft';
}

// ---- Rekruteren --------------------------------------------------------------

const TYPE_MAIN: Record<RiderType, Stat> = {
  sprinter: 'sprint',
  climber: 'klim',
  rouleur: 'kracht',
  puncheur: 'kracht',
  domestique: 'uithouding',
};
const TYPE_EXTRA: Record<RiderType, Stat> = {
  sprinter: 'kracht',
  climber: 'uithouding',
  rouleur: 'uithouding',
  puncheur: 'klim',
  domestique: 'kracht',
};

/** Wat de leveranciers van dit team aan het begin van een etappe afleveren: extra gels en cola's. */
function deliverSupplies(s: GameState, team: Team): void {
  const perks = perksOfTeam(team);
  for (let i = 0; i < perks.gels; i++) team.hand.push(newCard(s, 'gel'));
  for (let i = 0; i < perks.colas; i++) team.hand.push(newCard(s, 'cola'));
}

/** Een nieuwe renner voor een winkel, met de eigenschappen van zijn type en talentniveau. */
function makeShopRider(s: GameState, type: RiderType, tier: (typeof TALENT_TIERS)[number], taken: Set<string>): ShopItem {
  const base: Stats = { ...RIDER_TYPES[type].base };
  base[TYPE_MAIN[type]] = Math.max(1, base[TYPE_MAIN[type]] + tier.main);
  base[TYPE_EXTRA[type]] += tier.extra;
  const names = RIDER_NAME_POOL.filter((n) => !taken.has(n));
  const n = s.nextRiderId++;
  const name = names.length > 0 ? pick(s, names) : `Renner ${n}`;
  taken.add(name);
  const rider: Rider = {
    id: `cand${n}`,
    teamId: '',
    name,
    type,
    quirk: pick(s, QUIRK_IDS),
    pos: 0,
    base,
    form: { ...ZERO },
    fatigue: 0,
    trained: 0,
    energy: 0,
    maxEnergy: 0,
    injury: 0,
    hurt: false,
  };
  return { id: rider.id, kind: 'rider', price: tier.price, rider };
}

/**
 * De winkel van één team: negen renners (alle vijf de types, drie gratis neo-profs, één ster) en zes
 * sponsorcontracten (van elke soort minstens één). Elk team krijgt zijn eigen aanbod.
 */
function makeShop(s: GameState, taken: Set<string>): ShopItem[] {
  const tiers = TALENT_TIERS.flatMap((t) => Array.from({ length: t.count }, () => t));
  const extra = shuffle(s, RIDER_TYPE_LIST).slice(0, Math.max(0, tiers.length - RIDER_TYPE_LIST.length));
  const types = shuffle(s, [...RIDER_TYPE_LIST, ...extra]);
  const riders = tiers.map((tier, i) => makeShopRider(s, types[i], tier, taken));

  const families: ('cash' | 'bonus' | 'supply')[] = ['cash', 'bonus', 'supply'];
  const chosen: CardDef[] = [];
  for (const f of families) {
    const d = pick(s, CONTRACT_LIST.filter((c) => c.contract === f));
    chosen.push(d);
  }
  const rest = shuffle(s, CONTRACT_LIST.filter((c) => !chosen.includes(c)));
  while (chosen.length < SHOP_CONTRACTS && rest.length > 0) chosen.push(rest.pop()!);
  const contracts: ShopItem[] = chosen.map((d) => ({ id: `contract-${d.id}`, kind: 'contract', def: d.id }));
  return [...riders, ...contracts];
}

function startRecruit(s: GameState): void {
  const taken = new Set(s.riders.map((r) => r.name));
  const shops: Record<string, ShopItem[]> = {};
  for (const t of s.teams) shops[t.id] = makeShop(s, taken);
  s.recruit = { shops };
  s.ready = {};
  s.phase = 'recruit';
}

function recruitBuy(s: GameState, teamId: string, itemId: string): GameState {
  if (s.phase !== 'recruit' || !s.recruit) throw new RuleError('Er wordt nu niet gerekruteerd');
  const team = teamOf(s, teamId);
  if (s.ready[teamId]) throw new RuleError('Je staat op klaar: haal dat weg om nog te winkelen');
  const shop = s.recruit.shops[teamId] ?? [];
  const i = shop.findIndex((x) => x.id === itemId);
  if (i < 0) throw new RuleError('Dat ligt niet in jouw winkel');
  const item = shop[i];
  if (item.kind === 'rider') {
    if (team.riderIds.length >= RECRUIT_PICKS) throw new RuleError(`Je hebt al ${RECRUIT_PICKS} renners`);
    if (item.price > team.coins) throw new RuleError(`${item.rider.name} kost ${item.price} munten en dat heb je niet`);
    team.coins -= item.price;
    const rider: Rider = { ...item.rider, id: `${teamId}r${team.riderIds.length + 1}`, teamId };
    s.riders.push(rider);
    team.riderIds.push(rider.id);
  } else {
    if (team.slots.sponsor.length >= SLOT_LIMITS.sponsor)
      throw new RuleError(`Je hebt al ${SLOT_LIMITS.sponsor} sponsors: meer passen er niet op je shirt`);
    team.coins += CARD_DEFS[item.def].signing ?? 0;
    team.slots.sponsor.push(newCard(s, item.def));
  }
  shop.splice(i, 1);
  return s;
}

function endRecruit(s: GameState): void {
  s.recruit = null;
  for (const t of s.teams) {
    s.kopman[t.id] = bestKopman(s, t);
    // Etappe 1: de leveranciers leveren nu hun eerste lading af.
    if (s.stage === 1) deliverSupplies(s, t);
  }
  // Eerst de renners een naam geven: geen timer, iedereen drukt op klaar. Bots zijn meteen klaar.
  s.phase = 'naming';
  s.ready = Object.fromEntries(s.teams.filter((t) => t.isBot).map((t) => [t.id, true]));
  if (s.teams.every((t) => s.ready[t.id])) endNaming(s);
}

function endNaming(s: GameState): void {
  s.ready = {};
  s.phase = 'draft';
}

function nameRiders(s: GameState, teamId: string, names: string[]): GameState {
  if (s.phase !== 'naming') throw new RuleError('Je geeft je renners een naam na het rekruteren');
  const team = teamOf(s, teamId);
  team.riderIds.forEach((id, i) => {
    const n = (names[i] ?? '').trim().slice(0, 20);
    if (n) riderOf(s, id).name = n;
  });
  return s;
}

/** Grof geschat: wat is dit contract de speler in munten waard over een seizoen? */
export function contractValue(d: CardDef): number {
  const p = d.perk ?? {};
  return (
    (d.signing ?? 0) +
    (p.income ?? 0) * 2.5 +
    (p.podiumBonus ?? 0) * 1.5 +
    (p.winBonus ?? 0) * 1 +
    (p.pointBonus ?? 0) * 5.5 +
    (p.gels ?? 0) * 3 +
    (p.colas ?? 0) * 3.5 +
    (p.service ?? 0) * 3 +
    (p.startEnergy ?? 0) * 1.5 +
    (p.shield ?? 0) * 2.5 +
    (p.pechReduction ?? 0) * 2 +
    (p.fatigueRecover ?? 0) * 1.5 +
    (p.overtrainTolerance ?? 0) * 1 +
    (p.restBonus ?? 0) * 2
  );
}

/**
 * De volgende stap van een bot (of de automatische piloot bij een time-out) in de winkel:
 * eerst de beste contracten tekenen, dan de renners kiezen, dan klaar. Null als er niets meer te doen is.
 */
export function botShopStep(s: GameState, teamId: string, rand: () => number): Action | null {
  const team = teamOf(s, teamId);
  const shop = s.recruit?.shops[teamId] ?? [];
  if (s.phase !== 'recruit' || s.ready[teamId]) return null;

  // 1. Contracten: de waardevolste eerst. Direct geld vergroot meteen je budget voor renners.
  if (team.slots.sponsor.length < SLOT_LIMITS.sponsor) {
    const best = shop
      .filter((x): x is Extract<ShopItem, { kind: 'contract' }> => x.kind === 'contract')
      .map((x) => ({ x, v: contractValue(CARD_DEFS[x.def]) + rand() * 2 }))
      .sort((a, b) => b.v - a.v)[0];
    if (best) return { type: 'recruit', teamId, itemId: best.x.id };
  }

  // 2. Renners: wat past bij het parcours, met een mix van types in de ploeg.
  if (team.riderIds.length < RECRUIT_PICKS) {
    const owned = team.riderIds.map((id) => riderOf(s, id));
    const picksLeft = RECRUIT_PICKS - owned.length;
    let bestId: string | null = null;
    let bestScore = -Infinity;
    for (const x of shop) {
      if (x.kind !== 'rider' || x.price > team.coins) continue;
      const sameType = owned.some((r) => r.type === x.rider.type);
      // Hou iets over voor kaarten en voor de renners die nog moeten komen.
      const left = team.coins - x.price;
      const reserve = 1 + Math.max(0, picksLeft - 1);
      const score =
        stageFit(x.rider, s.terrain, 0) +
        x.rider.base.uithouding * 0.2 -
        x.price * 0.35 +
        (sameType ? -1.2 : 0.4) -
        (left < reserve ? 0.6 : 0) +
        rand() * 0.8;
      if (score > bestScore) {
        bestScore = score;
        bestId = x.id;
      }
    }
    if (bestId) return { type: 'recruit', teamId, itemId: bestId };
  }
  if (team.riderIds.length >= RECRUIT_PICKS) return { type: 'ready', teamId };
  return null;
}

// ---- Draft en winkel ---------------------------------------------------------

function takeFromSource(s: GameState, source: PickSource): { card: Card; fromMarket: boolean; index: number } {
  if (source.kind === 'market') {
    const card = s.market[source.index];
    if (!card) throw new RuleError('Die kaart ligt er niet meer');
    return { card, fromMarket: true, index: source.index };
  }
  const card = drawCard(s);
  if (!card) throw new RuleError('De stapel is leeg');
  return { card, fromMarket: false, index: -1 };
}

function draftPick(s: GameState, teamId: string, source: PickSource): GameState {
  if (s.phase !== 'draft') throw new RuleError('Er wordt nu niet gekozen');
  if (currentDraftTeam(s) !== teamId) throw new RuleError('Je bent niet aan de beurt');
  const team = teamOf(s, teamId);
  const { card, fromMarket, index } = takeFromSource(s, source);
  team.hand.push(card);
  if (fromMarket) s.market.splice(index, 1);
  refillMarket(s);
  advanceDraft(s);
  return s;
}

function advanceDraft(s: GameState): void {
  if (!s.draft) return;
  s.draft.idx += 1;
  if (s.draft.idx >= s.draft.order.length) {
    s.phase = 'team';
    s.ready = {};
    s.offers = [];
  }
}

function autoPick(s: GameState, teamId: string): void {
  const team = teamOf(s, teamId);
  if (s.market.length === 0) return advanceDraft(s);
  // Eerst iets dat past: bij voorkeur spullen die je nog niet hebt.
  const have = new Set(team.hand.map((c) => c.def));
  const scored = s.market.map((c, i) => ({ i, score: (have.has(c.def) ? 0 : 2) + randInt(s, 3) }));
  scored.sort((a, b) => b.score - a.score);
  const { card } = { card: s.market[scored[0].i] };
  team.hand.push(card);
  s.market.splice(scored[0].i, 1);
  refillMarket(s);
  advanceDraft(s);
}

function buy(s: GameState, teamId: string, source: PickSource): GameState {
  if (s.phase !== 'team') throw new RuleError('Winkelen kan alleen tijdens de voorbereiding');
  const team = teamOf(s, teamId);
  if (source.kind === 'deck') {
    if (team.coins < BLIND_COST) throw new RuleError('Te weinig munten');
    const card = drawCard(s);
    if (!card) throw new RuleError('De stapel is leeg');
    team.coins -= BLIND_COST;
    team.hand.push(card);
    return s;
  }
  const card = s.market[source.index];
  if (!card) throw new RuleError('Die kaart ligt er niet meer');
  const price = CARD_DEFS[card.def].price;
  if (team.coins < price) throw new RuleError('Te weinig munten');
  team.coins -= price;
  team.hand.push(card);
  s.market.splice(source.index, 1);
  refillMarket(s);
  return s;
}

function train(s: GameState, teamId: string, cardId: string, riderId: string): GameState {
  if (s.phase !== 'team') throw new RuleError('Trainen kan alleen tijdens de voorbereiding');
  const team = teamOf(s, teamId);
  const rider = riderOf(s, riderId);
  if (rider.teamId !== teamId) throw new RuleError('Dat is jouw renner niet');
  const card = team.hand.find((c) => c.id === cardId);
  if (!card) throw new RuleError('Je hebt die kaart niet');
  const def = CARD_DEFS[card.def];
  if (def.kind !== 'training') throw new RuleError('Dat is geen trainingskaart');
  const isRest = (def.fatigue ?? 0) < 0;
  if (!isRest && rider.trained >= TRAININGS_PER_RIDER)
    throw new RuleError(`${rider.name} kan deze etappe niet meer trainen (max ${TRAININGS_PER_RIDER})`);
  takeFromHand(team, cardId);
  for (const k of STAT_KEYS) rider.form[k] = Math.min(FORM_CAP, rider.form[k] + (def.stats?.[k] ?? 0));
  rider.fatigue = Math.max(0, Math.min(FATIGUE_CAP, rider.fatigue + (def.fatigue ?? 0)));
  if (!isRest) {
    rider.trained += 1;
    team.stats.trainings += 1;
  }
  s.discard.push(card);
  return s;
}

function install(s: GameState, teamId: string, cardId: string, replaceDef?: string): GameState {
  if (s.phase !== 'team') throw new RuleError('Spullen installeer je tijdens de voorbereiding');
  const team = teamOf(s, teamId);
  const card = team.hand.find((c) => c.id === cardId);
  if (!card) throw new RuleError('Je hebt die kaart niet');
  const kind = CARD_DEFS[card.def].kind;
  if (kind === 'training' || kind === 'sabotage' || kind === 'race')
    throw new RuleError('Die kaart plaats je niet op je bord');
  const slot = team.slots[kind as SlotKind];
  if (slot.length >= SLOT_LIMITS[kind as SlotKind]) {
    if (!replaceDef) throw new RuleError('Dat vak zit vol: kies een kaart om te vervangen');
    const i = slot.findIndex((c) => c.def === replaceDef);
    if (i < 0) throw new RuleError('Die kaart ligt niet op je bord');
    s.discard.push(slot.splice(i, 1)[0]);
  }
  slot.push(takeFromHand(team, cardId));
  return s;
}

function sabotage(s: GameState, teamId: string, cardId: string, targetTeamId: string): GameState {
  if (s.phase !== 'team') throw new RuleError('Sabotage regel je tijdens de voorbereiding');
  const team = teamOf(s, teamId);
  const target = teamOf(s, targetTeamId);
  if (targetTeamId === teamId) throw new RuleError('Je kunt jezelf niet saboteren');
  const card = team.hand.find((c) => c.id === cardId);
  if (!card || CARD_DEFS[card.def].kind !== 'sabotage') throw new RuleError('Dat is geen sabotagekaart');
  if (target.sabotage.length >= 1) throw new RuleError(`${target.name} wordt al gesaboteerd deze etappe`);
  takeFromHand(team, cardId);
  target.sabotage.push(card.def);
  s.sabotageLog.push({ fromTeamId: teamId, toTeamId: targetTeamId, def: card.def });
  team.stats.sabotages += 1;
  s.discard.push(card);
  return s;
}

// ---- Ruilen ------------------------------------------------------------------

function offer(s: GameState, a: Extract<Action, { type: 'offer' }>): GameState {
  if (s.phase !== 'team') throw new RuleError('Ruilen kan tijdens de voorbereiding');
  const from = teamOf(s, a.teamId);
  teamOf(s, a.to);
  if (a.to === a.teamId) throw new RuleError('Je kunt niet met jezelf ruilen');
  if (a.give.length + a.want.length + a.giveCoins + a.wantCoins === 0) throw new RuleError('Bied of vraag iets');
  if (a.give.length > 3 || a.want.length > 3) throw new RuleError('Maximaal 3 kaarten per voorstel');
  if (a.giveCoins < 0 || a.wantCoins < 0 || a.giveCoins > from.coins) throw new RuleError('Zoveel munten heb je niet');
  const ids = new Set(a.give);
  if (ids.size !== a.give.length || !a.give.every((id) => from.hand.some((c) => c.id === id)))
    throw new RuleError('Je hebt die kaarten niet');
  s.offers = s.offers.filter((o) => o.from !== a.teamId);
  s.offers.push({
    id: `o${s.nextOfferId++}`,
    from: a.teamId,
    to: a.to,
    give: a.give,
    giveCoins: a.giveCoins,
    want: a.want,
    wantCoins: a.wantCoins,
  });
  return s;
}

/** Kaarten uit `hand` die precies aan de gevraagde defs voldoen, of null. */
export function matchDefs(hand: Card[], want: string[]): Card[] | null {
  const used = new Set<string>();
  const out: Card[] = [];
  for (const def of want) {
    const c = hand.find((h) => !used.has(h.id) && h.def === def);
    if (!c) return null;
    used.add(c.id);
    out.push(c);
  }
  return out;
}

function respond(s: GameState, teamId: string, offerId: string, accept: boolean): GameState {
  if (s.phase !== 'team') throw new RuleError('Ruilen kan tijdens de voorbereiding');
  const o = s.offers.find((x) => x.id === offerId);
  if (!o || o.to !== teamId) throw new RuleError('Dat voorstel bestaat niet meer');
  s.offers = s.offers.filter((x) => x.id !== offerId);
  if (!accept) return s;
  const from = teamOf(s, o.from);
  const to = teamOf(s, o.to);
  const giving = o.give.map((id) => from.hand.find((c) => c.id === id));
  if (giving.some((c) => !c) || from.coins < o.giveCoins) throw new RuleError('Het voorstel klopt niet meer');
  const getting = matchDefs(to.hand, o.want);
  if (!getting) throw new RuleError('Je hebt de gevraagde kaarten niet');
  if (to.coins < o.wantCoins) throw new RuleError('Je hebt te weinig munten');
  const givingIds = new Set(o.give);
  const gettingIds = new Set(getting.map((c) => c.id));
  from.hand = from.hand.filter((c) => !givingIds.has(c.id)).concat(getting);
  to.hand = to.hand.filter((c) => !gettingIds.has(c.id)).concat(giving as Card[]);
  from.coins += o.wantCoins - o.giveCoins;
  to.coins += o.giveCoins - o.wantCoins;
  from.stats.trades += 1;
  to.stats.trades += 1;
  const moved = new Set([...givingIds, ...gettingIds]);
  s.offers = s.offers.filter((x) => !x.give.some((id) => moved.has(id)));
  return s;
}

// ---- Race --------------------------------------------------------------------

function startRace(s: GameState): void {
  s.offers = [];
  s.round = 0;
  for (const team of s.teams) {
    const perks = perksOfTeam(team);
    const bidon = team.sabotage.includes('bidon');
    team.raceShield = perks.shield;
    for (const id of team.riderIds) {
      const r = riderOf(s, id);
      r.maxEnergy = maxEnergyFor(r, perks, bidon);
      r.energy = startEnergyFor(r.maxEnergy, perks, r.quirk === 'napper');
    }
  }
  startRound(s);
}

function drawEvent(s: GameState): void {
  if (s.eventDeck.length === 0) {
    // Het weer van de etappe bepaalt welke omstandigheden kunnen voorkomen.
    const ids: EventId[] = EVENT_IDS.filter((id) => {
      const only = EVENTS[id].weather;
      return !only || only.includes(s.weather);
    });
    s.eventDeck = shuffle(s, ids);
  }
  const id = s.eventDeck.pop()!;
  const def = EVENTS[id];
  const ev: ActiveEvent = { id };
  if (def.target === 'leader') ev.targetRiderId = leaderRider(s.riders).id;
  if (def.target === 'randomRider') ev.targetRiderId = pick(s, s.riders).id;
  if (def.target === 'randomTeam') ev.targetTeamId = pick(s, s.teams).id;
  s.event = ev;
}

function startRound(s: GameState): void {
  s.round += 1;
  drawEvent(s);
  s.efforts = {};
  s.cars = {};
  s.plays = {};
  s.locked = {};
  s.phase = 'race';
}

function setEfforts(
  s: GameState,
  teamId: string,
  efforts: Record<string, Effort>,
  car?: string | null,
  plays?: RacePlay[],
): GameState {
  if (s.phase !== 'race') throw new RuleError('Nu kies je geen tempo');
  const team = teamOf(s, teamId);
  for (const id of team.riderIds) {
    const e = efforts[id] ?? 'normaal';
    if (!(e in EFFORTS)) throw new RuleError('Onbekend tempo');
    if (e === 'helpen') {
      if (s.kopman[teamId] === id) throw new RuleError('Je kopman kan zichzelf niet helpen');
      if (!canHelp(s, riderOf(s, id))) throw new RuleError('Die knecht rijdt te ver van je kopman om te helpen');
    }
    s.efforts[id] = e;
  }

  // Volgauto: bij welke renner rijdt hij deze ronde?
  if (car) {
    if (!team.riderIds.includes(car)) throw new RuleError('De volgauto rijdt bij een renner van je eigen team');
    s.cars[teamId] = car;
  } else delete s.cars[teamId];

  // Racekaarten: één per renner, elke kaart één keer. Ze blijven in je hand tot de ronde wordt gereden.
  const usedCards = new Set<string>();
  const usedRiders = new Set<string>();
  const planned: RacePlay[] = [];
  for (const p of plays ?? []) {
    const card = team.hand.find((c) => c.id === p.cardId);
    const item = card ? CARD_DEFS[card.def].race : undefined;
    if (!card || !item) throw new RuleError('Dat is geen racekaart');
    if (usedCards.has(card.id)) throw new RuleError('Elke kaart speel je één keer');
    const rider = riderOf(s, p.riderId);
    if (rider.teamId !== teamId) throw new RuleError('Dat is jouw renner niet');
    if (usedRiders.has(rider.id)) throw new RuleError('Eén racekaart per renner per ronde');
    if (item === 'gel' && rider.energy >= rider.maxEnergy) throw new RuleError(`${rider.name} heeft al volle energie`);
    let targetId: string | undefined;
    if (item === 'blok') {
      const target = p.targetId ? riderOf(s, p.targetId) : null;
      if (!target || !canBlock(rider, target))
        throw new RuleError(`Je kunt alleen een tegenstander binnen ${BLOCK_RANGE} tegels blokkeren`);
      targetId = target.id;
    }
    usedCards.add(card.id);
    usedRiders.add(rider.id);
    planned.push({ cardId: card.id, riderId: rider.id, ...(targetId ? { targetId } : {}) });
  }
  s.plays[teamId] = planned;
  s.locked[teamId] = true;
  if (s.teams.every((t) => s.locked[t.id])) resolveRound(s);
  return s;
}

function resolveRound(s: GameState): void {
  const prevLeader = leaderRider(s.riders);
  const sortedPos = s.riders.map((r) => r.pos).sort((a, b) => a - b);
  const median = sortedPos[Math.floor(sortedPos.length / 2)];
  const noDraft = s.event ? !!EVENTS[s.event.id].noDraft : false;
  const ev = s.event ? EVENTS[s.event.id] : null;

  // Knechten die helpen: ze rijden rustig en trekken de kopman van hun team mee. Een echte knecht trekt harder.
  const helping = new Set<string>();
  const helpers = new Map<string, number>();
  const domestiqueHelp = new Map<string, number>();
  for (const r of s.riders) {
    if (s.efforts[r.id] !== 'helpen' || !canHelp(s, r)) continue;
    helping.add(r.id);
    helpers.set(r.teamId, (helpers.get(r.teamId) ?? 0) + 1);
    if (r.type === 'domestique') domestiqueHelp.set(r.teamId, (domestiqueHelp.get(r.teamId) ?? 0) + 1);
  }

  // Racekaarten en volgauto's: wat komt er van de plannen terecht? Kaarten worden hier verbruikt.
  const itemOf = new Map<string, RaceItem>(); // riderId -> kaart die hij gebruikt
  const blockedBy = new Map<string, string>(); // geblokkeerde renner -> blokkerende knecht
  const playHits: PlayHit[] = [];
  for (const team of s.teams) {
    for (const p of s.plays[team.id] ?? []) {
      const idx = team.hand.findIndex((c) => c.id === p.cardId);
      const item = idx >= 0 ? CARD_DEFS[team.hand[idx].def].race : undefined;
      const user = s.riders.find((r) => r.id === p.riderId && r.teamId === team.id);
      if (!item || !user || itemOf.has(user.id)) continue;
      let target: Rider | undefined;
      if (item === 'blok') {
        target = s.riders.find((r) => r.id === p.targetId);
        // Een renner die al geblokkeerd wordt, kan niet nog eens worden dichtgeknepen: kaart blijft in je hand.
        if (!target || !canBlock(user, target) || blockedBy.has(target.id)) continue;
        blockedBy.set(target.id, user.id);
        team.stats.blocks += 1;
      }
      if (item === 'gel') user.energy = Math.min(user.maxEnergy, user.energy + GEL_ENERGY);
      itemOf.set(user.id, item);
      s.discard.push(team.hand.splice(idx, 1)[0]);
      team.stats.items += 1;
      playHits.push({ teamId: team.id, riderId: user.id, item, ...(target ? { targetRiderId: target.id } : {}) });
    }
  }
  const carOf = new Set<string>();
  for (const team of s.teams) {
    const id = s.cars[team.id];
    if (id && team.riderIds.includes(id)) carOf.add(id);
  }

  interface Work {
    rider: Rider;
    index: number;
    effort: Effort;
    parts: MoveParts;
    roll: number;
    pech: boolean;
    shielded: boolean;
    boost: boolean;
    crash: 'none' | 'fall' | 'domino';
    injured: boolean;
    exhausted: boolean;
    target: number;
    cluster: number;
    front: boolean;
  }

  // Wie rijdt met wie: groepen aan het begin van de ronde, voor teamwerk, jacht, valkans en energie.
  const groups = groupsOf(s.riders);
  const smallAhead = (g: GroupInfo): GroupInfo | null => {
    let near: GroupInfo | null = null;
    for (const o of groups.values()) {
      if (o.size >= PELOTON_MIN || o.bottom <= g.top) continue;
      if (!near || o.bottom < near.bottom) near = o;
    }
    return near;
  };
  const pelotonGap = (g: GroupInfo): number => {
    if (g.size < PELOTON_MIN) return 0;
    const ahead = smallAhead(g);
    return ahead ? ahead.bottom - g.top : 0;
  };
  const wet = isWet(s);
  const noPech = !!ev?.noPech;

  // Eerste ronde van lot: pech, val en meevaller. Een val is meestal een kwestie van pech met een kop.
  interface Pre {
    rider: Rider;
    index: number;
    team: Team;
    perks: Required<Perk>;
    effort: Effort;
    exhausted: boolean;
    parts: MoveParts;
    roll: number;
    fell: boolean;
  }
  const pre: Pre[] = s.riders.map((rider, index) => {
    const team = teamOf(s, rider.teamId);
    const perks = perksOfTeam(team);
    const asked: Effort = s.efforts[rider.id] === 'helpen' ? 'normaal' : (s.efforts[rider.id] ?? 'normaal');
    const { effort, exhausted } = resolveEffort(rider.energy, perks, asked);
    const parts = baseParts(s, rider, perks, effort, exhausted);
    const g = groups.get(rider.id)!;
    if (helping.has(rider.id) && !exhausted) parts.effort = 0;
    if (rider.pos <= median - CHASE_GAP) parts.chase = 2;
    const gap = pelotonGap(g);
    if (gap > 0) parts.chase = Math.max(parts.chase, gap >= CHASE_FAR ? 3 : gap >= CHASE_NEAR ? 2 : 0);
    if (g.mates > 0 && !helping.has(rider.id)) parts.team = Math.min(TEAM_BONUS_MAX, g.mates * TEAM_BONUS);
    if (s.kopman[rider.teamId] === rider.id) parts.help = HELP_BONUS * (helpers.get(rider.teamId) ?? 0) + (domestiqueHelp.get(rider.teamId) ?? 0);
    if (itemOf.get(rider.id) === 'cola') parts.item += COLA_BONUS;
    if (blockedBy.has(rider.id)) parts.item -= BLOCK_PENALTY;
    const roll = randInt(s, 10) + 1;
    const neighbours = s.riders.filter((o) => o.id !== rider.id && Math.abs(o.pos - rider.pos) <= 1).length;
    const fell = randInt(s, 100) < crashChance(s, rider, effort, perks, neighbours);
    return { rider, index, team, perks, effort, exhausted, parts, roll, fell };
  });
  // Domino: wie vlak naast of achter een gevallen renner rijdt, kan meevallen.
  const domino = new Set<string>();
  for (const c of pre.filter((p) => p.fell)) {
    for (const p of pre) {
      if (p.fell || domino.has(p.rider.id) || Math.abs(p.rider.pos - c.rider.pos) > DOMINO_RANGE) continue;
      if (randInt(s, 100) < DOMINO_CHANCE + (wet ? 20 : 0)) domino.add(p.rider.id);
    }
  }

  const work: Work[] = pre.map((p) => {
    const { rider, index, team, perks, effort, exhausted, parts, roll } = p;
    const threshold = Math.min(
      6,
      PECH_CHANCE + (team.sabotage.includes('spijkers') ? 1 : 0) + (ev?.pechBonus ?? 0),
    );
    const pechAt = rider.quirk === 'lucky' ? Math.max(1, Math.ceil(threshold / 2)) : threshold;
    let pech = false;
    let shielded = false;
    let boost = false;
    let crash: Work['crash'] = 'none';
    let injured = false;
    if (p.fell || domino.has(rider.id)) {
      if (team.raceShield > 0) {
        // De reservefiets en een snelle monteur maken van een val een kleine hindernis.
        team.raceShield -= 1;
        shielded = true;
      } else {
        crash = p.fell ? 'fall' : 'domino';
        const serviced = carOf.has(rider.id) && perks.service > 0 ? 2 : 0;
        const loss = p.fell ? CRASH_LOSS : DOMINO_LOSS;
        parts.crash = -Math.max(1, loss - perks.pechReduction - serviced);
        team.stats.crashes += 1;
        if (p.fell) {
          rider.fatigue = Math.min(FATIGUE_CAP, rider.fatigue + 1);
          const severe = 35 + (wet ? 20 : 0) + (terrainAt(s, rider.pos) === 'descent' ? 15 : 0);
          if (randInt(s, 100) < severe) {
            rider.hurt = true;
            injured = true;
          }
        }
      }
    } else if (!noPech && roll <= pechAt) {
      if (carOf.has(rider.id)) {
        // De volgauto rijdt precies bij deze renner en is er meteen bij.
        shielded = true;
      } else if (team.raceShield > 0) {
        team.raceShield -= 1;
        shielded = true;
      } else {
        pech = true;
        parts.luck = -Math.max(1, 3 - perks.pechReduction);
      }
    } else if (roll === 10) {
      boost = true;
      parts.luck = 1;
    }
    const raw = sumParts(parts);
    return {
      rider,
      index,
      effort,
      parts,
      roll,
      pech,
      crash,
      injured,
      shielded,
      boost,
      exhausted,
      target: rider.pos + raw,
      cluster: 0,
      front: false,
    };
  });

  // Groepen: kettingen met gaten van hooguit 1 tegel. Volgers draften, de kop betaalt de wind.
  const order = [...work].sort((a, b) => b.target - a.target || a.index - b.index);
  let cluster = -1;
  let prevTarget = Infinity;
  for (const w of order) {
    if (prevTarget - w.target > 1) {
      cluster++;
      w.front = true;
    }
    w.cluster = cluster;
    prevTarget = w.target;
  }
  const size = new Map<number, number>();
  for (const w of work) size.set(w.cluster, (size.get(w.cluster) ?? 0) + 1);

  const moves: RiderMove[] = [];
  for (const w of work) {
    let windPaid = false;
    if (!noDraft) {
      if (!w.front && !blockedBy.has(w.rider.id)) w.parts.draft = (size.get(w.cluster) ?? 1) >= PELOTON_MIN ? DRAFT_BIG : 1;
      else if (w.effort !== 'rustig' && ((size.get(w.cluster) ?? 1) >= 2 || w.cluster === 0)) windPaid = true;
      // Echt alleen rijden is zwaar: geen wiel, en de wind komt van voren (niet in een afdaling).
      if (w.front && (size.get(w.cluster) ?? 1) === 1 && !helping.has(w.rider.id) && terrainAt(s, w.rider.pos) !== 'descent')
        w.parts.draft = -ALONE_MOVE;
    }
    const rider = w.rider;
    const team = teamOf(s, rider.teamId);
    const perks = perksOfTeam(team);
    const from = rider.pos;
    const to = from + sumParts(w.parts);

    // Energie bijwerken.
    let delta = EFFORTS[w.effort].energy;
    if (w.effort === 'rustig') delta += perks.restBonus + (rider.quirk === 'croissant' ? 1 : 0);
    if (w.effort === 'alles') {
      delta = -allesCost(perks);
      team.stats.alles += 1;
    }
    if (windPaid) delta -= 1;
    const g = groups.get(rider.id)!;
    if (!w.exhausted) {
      // Lichter in het peloton, zwaarder alleen. Teamgenoten in je groep geven een extra duwtje.
      // Vol gas blijft vol gas: de voordelen gelden voor rustig en normaal rijden.
      if (g.size >= PELOTON_MIN) {
        if (w.effort !== 'alles') delta += PELOTON_REST;
      } else if (w.effort !== 'rustig') delta -= ALONE_COST;
    }
    if (w.crash === 'fall') delta -= CRASH_ENERGY;
    if (w.crash === 'domino') delta -= 1;
    if (carOf.has(rider.id)) delta += perks.service > 0 ? CAR_ENERGY_UPGRADED : CAR_ENERGY;
    if (ev?.energyAll) delta += ev.energyAll;
    if (s.event?.targetRiderId === rider.id && ev?.targetEnergy) delta += ev.targetEnergy;
    rider.energy = Math.max(0, Math.min(rider.maxEnergy, rider.energy + delta));
    if (w.exhausted) team.stats.exhausted += 1;
    if (helping.has(rider.id)) team.stats.helps += 1;

    moves.push({
      riderId: rider.id,
      from,
      to,
      terrain: terrainAt(s, from),
      effort: w.effort,
      parts: w.parts,
      roll: w.roll,
      windPaid,
      exhausted: w.exhausted,
      pech: w.pech,
      crash: w.crash,
      injured: w.injured,
      groupSize: g.size,
      teammates: g.mates,
      shielded: w.shielded,
      boost: w.boost,
      car: carOf.has(rider.id),
      item: itemOf.get(rider.id) ?? null,
      blockedBy: blockedBy.get(rider.id) ?? null,
      helping: helping.has(rider.id),
      energyAfter: rider.energy,
      clusterIndex: w.cluster,
    });
  }
  for (const m of moves) riderOf(s, m.riderId).pos = m.to;

  // Premies: wie de lijn deze ronde passeert, scoort. Verder voorbij de lijn gaat voor.
  const premieHits: PremieHit[] = [];
  for (const p of s.premies) {
    const crossers = moves
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.from < p.pos && m.to >= p.pos)
      .sort((a, b) => b.m.to - a.m.to || a.i - b.i);
    for (const { m } of crossers) {
      if (p.hits.length >= PREMIE_POINTS.length) break;
      const hit = { riderId: m.riderId, points: PREMIE_POINTS[p.hits.length] };
      p.hits.push(hit);
      premieHits.push({ premieId: p.id, ...hit });
      teamOf(s, riderOf(s, m.riderId).teamId).stats.premies += hit.points;
    }
  }

  const leader = leaderRider(s.riders);
  teamOf(s, leader.teamId).stats.roundsLed += 1;
  s.report = {
    round: s.round,
    moves,
    premies: premieHits,
    plays: playHits,
    carRiderIds: [...carOf],
    leaderRiderId: leader.id,
    prevLeaderRiderId: prevLeader.id,
    finished: s.riders.some((r) => r.pos >= s.trackLength),
  } satisfies ResolveReport;
  s.phase = 'resolve';
}

function afterResolve(s: GameState): void {
  if (s.report?.finished) finishStage(s);
  else startRound(s);
}

// ---- Uitslag en beloning -----------------------------------------------------

function finishStage(s: GameState): void {
  const ordered = s.riders.map((r, i) => ({ r, i })).sort((a, b) => b.r.pos - a.r.pos || a.i - b.i);
  const rankOf = new Map<string, number>();
  ordered.forEach((x, i) => rankOf.set(x.r.id, i + 1));
  // De slotetappe telt dubbel, zodat het seizoen tot het einde spannend blijft.
  const factor = s.stage >= STAGES ? 2 : 1;
  const isKopman = (riderId: string) => Object.values(s.kopman).includes(riderId);
  const ranking = ordered.map((x, i) => {
    const kopman = isKopman(x.r.id);
    return {
      riderId: x.r.id,
      rank: i + 1,
      points: (POINTS_BY_RANK[i] ?? 0) * factor * (kopman ? KOPMAN_FACTOR : 1),
      kopman,
    };
  });

  const results = s.teams.map((t) => {
    const mine = ranking.filter((x) => t.riderIds.includes(x.riderId));
    const riderPoints = mine.reduce((sum, x) => sum + x.points, 0);
    const premiePoints = s.premies
      .flatMap((p) => p.hits)
      .filter((h) => t.riderIds.includes(h.riderId))
      .reduce((sum, h) => sum + h.points * factor, 0);
    const stagePoints = riderPoints + premiePoints;
    const best = Math.min(...mine.map((x) => x.rank));
    const perks = perksOfTeam(t);
    const prizeCoins = best === 1 ? 3 : best <= 3 ? 2 : 1;
    const sponsorCoins =
      perks.income + (best <= 3 ? perks.podiumBonus : 0) + Math.floor(stagePoints / POINT_BONUS_STEP) * perks.pointBonus;
    return {
      teamId: t.id,
      kopmanId: s.kopman[t.id],
      riderPoints,
      premiePoints,
      stagePoints,
      prizeCoins,
      sponsorCoins,
      bonusCards: [] as string[],
      totalPoints: 0,
      best,
    };
  });

  // Bonuskaarten en inhaalhulp: de etappewinnaar krijgt 1 kaart, de laagste in het klassement
  // 2 kaarten en 2 munten, de een-na-laagste 1 kaart. Zo blijft achterliggen te winnen.
  const give = (teamId: string, n: number) => {
    const x = results.find((r) => r.teamId === teamId)!;
    for (let k = 0; k < n; k++) {
      const c = drawCard(s);
      if (c) {
        teamOf(s, teamId).hand.push(c);
        x.bonusCards.push(c.def);
      }
    }
  };
  const byPoints = [...results].sort((a, b) => b.stagePoints - a.stagePoints || a.best - b.best);
  const lastRiderTeam = ordered[ordered.length - 1].r.teamId;
  give(byPoints[0].teamId, 1);
  // Sponsors die betalen voor winst: de etappewinnaar (de meeste punten) krijgt zijn bonus.
  const winner = results.find((r) => r.teamId === byPoints[0].teamId)!;
  winner.sponsorCoins += perksOfTeam(teamOf(s, winner.teamId)).winBonus;
  const standing = [...s.teams]
    .map((t) => ({ t, total: t.points + (results.find((r) => r.teamId === t.id)?.stagePoints ?? 0) }))
    .sort((a, b) => a.total - b.total || a.t.coins - b.t.coins);
  give(standing[0].t.id, 2);
  results.find((r) => r.teamId === standing[0].t.id)!.prizeCoins += 2;
  if (standing.length >= 4) give(standing[1].t.id, 1);

  for (const x of results) {
    const t = teamOf(s, x.teamId);
    t.coins += x.prizeCoins + x.sponsorCoins;
    t.points += x.stagePoints;
    x.totalPoints = t.points;
  }

  // Fade en herstel.
  for (const r of s.riders) {
    const perks = perksOfTeam(teamOf(s, r.teamId));
    for (const k of STAT_KEYS) r.form[k] = Math.max(0, r.form[k] - 1);
    r.fatigue = Math.max(0, r.fatigue - 1 - perks.fatigueRecover);
    r.trained = 0;
    // Een zware val werkt door in de volgende etappe, tenzij een fysio hem er meteen bovenop zet.
    r.injury = r.hurt && perks.fatigueRecover === 0 ? 1 : 0;
    r.hurt = false;
  }
  s.teams.forEach((t) => {
    t.sabotage = [];
  });

  s.stageResult = {
    stage: s.stage,
    ranking,
    premies: s.premies,
    teams: results.map(({ best: _best, ...rest }) => rest),
    lanterneRougeTeamId: lastRiderTeam,
    sabotages: s.sabotageLog,
  };
  s.phase = 'results';
}

function afterResults(s: GameState): void {
  if (s.stage >= STAGES) finishSeason(s);
  else beginStage(s);
}

function finishSeason(s: GameState): void {
  const sorted = [...s.teams].sort((a, b) => b.points - a.points || b.coins - a.coins);
  const winner = sorted[0];
  const lantern = sorted[sorted.length - 1];
  const awards: Award[] = [];
  const top = (f: (t: Team) => number) => [...s.teams].sort((a, b) => f(b) - f(a))[0];
  const led = top((t) => t.stats.roundsLed);
  if (led.stats.roundsLed > 0)
    awards.push({ title: 'Meest aanvallend', teamId: led.id, blurb: `${led.stats.roundsLed} rondes aan kop van de race.` });
  const alles = top((t) => t.stats.alles);
  if (alles.stats.alles > 0)
    awards.push({ title: 'Vol gas', teamId: alles.id, blurb: `${alles.stats.alles} keer Alles geven.` });
  const trainer = top((t) => t.stats.trainings);
  if (trainer.stats.trainings > 0)
    awards.push({ title: 'Beste voorbereiding', teamId: trainer.id, blurb: `${trainer.stats.trainings} trainingen gedaan.` });
  const trader = top((t) => t.stats.trades);
  if (trader.stats.trades > 0)
    awards.push({ title: 'Handelaar', teamId: trader.id, blurb: `${trader.stats.trades} ruilen afgerond.` });
  const hamer = top((t) => t.stats.exhausted);
  if (hamer.stats.exhausted > 0)
    awards.push({ title: 'Man met de hamer', teamId: hamer.id, blurb: `${hamer.stats.exhausted} keer op de fles.` });
  const helper = top((t) => t.stats.helps);
  if (helper.stats.helps > 0)
    awards.push({ title: 'Beste knechten', teamId: helper.id, blurb: `${helper.stats.helps} keer de kopman meegetrokken.` });
  const blocker = top((t) => t.stats.blocks);
  if (blocker.stats.blocks > 0)
    awards.push({ title: 'Dwarsligger', teamId: blocker.id, blurb: `${blocker.stats.blocks} keer een tegenstander dichtgeknepen.` });
  const premie = top((t) => t.stats.premies);
  if (premie.stats.premies > 0)
    awards.push({ title: 'Premiejager', teamId: premie.id, blurb: `${premie.stats.premies} punten bij sprints en bergen.` });
  const faller = top((t) => t.stats.crashes);
  if (faller.stats.crashes > 0)
    awards.push({ title: 'Pechvogel', teamId: faller.id, blurb: `${faller.stats.crashes} keer onderuit gegaan. Je bent altijd welkom op de grond.` });
  const rich = top((t) => t.coins);
  awards.push({ title: 'Spaarvarken', teamId: rich.id, blurb: `${rich.coins} munten over.` });
  awards.push({ title: 'Lanterne Rouge', teamId: lantern.id, blurb: 'Laatste in het klassement. Draag de rode lantaarn met trots.' });
  s.season = {
    teams: sorted.map((t) => ({ teamId: t.id, points: t.points, coins: t.coins })),
    winnerTeamId: winner.id,
    lanterneRougeTeamId: lantern.id,
    awards,
  };
  s.phase = 'finished';
}

function rematch(s: GameState): GameState {
  if (s.phase !== 'finished') throw new RuleError('Het seizoen is nog niet voorbij');
  s.phase = 'lobby';
  s.briefing = null;
  s.kopman = {};
  s.premies = [];
  s.round = 0;
  s.stage = 0;
  s.terrain = [];
  s.event = null;
  s.eventDeck = [];
  s.deck = [];
  s.discard = [];
  s.market = [];
  s.draft = null;
  s.ready = {};
  s.efforts = {};
  s.cars = {};
  s.plays = {};
  s.locked = {};
  s.offers = [];
  s.report = null;
  s.stageResult = null;
  s.season = null;
  s.sabotageLog = [];
  s.riders = [];
  s.recruit = null;
  s.weather = 'dry';
  s.teams.forEach((t) => {
    t.riderIds = [];
    t.hand = [];
    t.slots = { sponsor: [], staff: [], material: [], car: [] };
    t.coins = START_COINS;
    t.points = 0;
    t.sabotage = [];
    t.stats = { roundsLed: 0, trades: 0, trainings: 0, alles: 0, exhausted: 0, sabotages: 0, helps: 0, premies: 0, items: 0, blocks: 0, crashes: 0 };
  });
  return s;
}

// ---- Weergaven ---------------------------------------------------------------

export function toPublic(s: GameState): PublicState {
  const current = currentDraftTeam(s);
  return {
    phase: s.phase,
    tutorial: s.tutorial,
    commentary: s.commentary,
    briefing: s.briefing
      ? {
          page: s.briefing.page,
          ok: Object.fromEntries(s.teams.map((t) => [t.id, t.isBot || !!s.briefing!.ok[t.id]])),
        }
      : null,
    // De kopmannen blijven geheim tot de race begint.
    kopman: s.phase === 'race' || s.phase === 'resolve' || s.phase === 'results' ? s.kopman : {},
    premies: s.premies,
    round: s.round,
    stage: s.stage,
    trackLength: s.trackLength,
    terrain: s.terrain,
    teams: s.teams.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      riderIds: t.riderIds,
      coins: t.coins,
      points: t.points,
      handCount: t.hand.length,
      slots: {
        sponsor: t.slots.sponsor.map((c) => c.def),
        staff: t.slots.staff.map((c) => c.def),
        material: t.slots.material.map((c) => c.def),
        car: t.slots.car.map((c) => c.def),
      },
      locked: !!s.locked[t.id],
      ready: !!s.ready[t.id],
      isBot: t.isBot,
      trainings: t.stats.trainings,
    })),
    riders: s.riders,
    event: s.event,
    market: s.market.map((c) => c.def),
    marketCards: s.market,
    deckCount: s.deck.length,
    draft: s.draft
      ? { order: s.draft.order, idx: s.draft.idx, currentTeamId: current, total: s.draft.order.length }
      : null,
    recruit: s.recruit ? { picks: RECRUIT_PICKS, contracts: SLOT_LIMITS.sponsor } : null,
    weather: s.weather,
    report: s.report,
    stageResult: s.stageResult,
    season: s.season,
  };
}

function withCards(s: GameState, o: Offer): OfferView {
  const from = s.teams.find((t) => t.id === o.from);
  return { ...o, giveCards: o.give.map((id) => from?.hand.find((c) => c.id === id)).filter((c): c is Card => !!c) };
}

export function toPlayerView(s: GameState, teamId: string): PlayerView | null {
  const t = s.teams.find((x) => x.id === teamId);
  if (!t) return null;
  const efforts: Record<string, Effort> = {};
  for (const id of t.riderIds) if (s.efforts[id]) efforts[id] = s.efforts[id];
  const out = s.offers.find((x) => x.from === teamId);
  return {
    teamId,
    hand: t.hand,
    efforts,
    car: s.cars[teamId] ?? null,
    plays: s.plays[teamId] ?? [],
    offersIn: s.offers.filter((o) => o.to === teamId).map((o) => withCards(s, o)),
    offerOut: out ? withCards(s, out) : null,
    sabotageOn: t.sabotage,
    pickPending: s.phase === 'draft' && currentDraftTeam(s) === teamId,
    shop: s.phase === 'recruit' ? (s.recruit?.shops[teamId] ?? []) : [],
    kopmanId: s.kopman[teamId] ?? t.riderIds[0],
    stats: t.stats,
  };
}

// ---- Bots --------------------------------------------------------------------

const BOT_PRIORITY: Record<string, number> = {
  sponsor: 5,
  staff: 4,
  car: 4,
  material: 3,
  race: 3,
  training: 2,
  sabotage: 1,
};

export function botDraft(s: GameState, teamId: string, rand: () => number): PickSource {
  const team = teamOf(s, teamId);
  const have = new Set([...team.hand.map((c) => c.def), ...teamDefIds(team.slots)]);
  let best = -1;
  let bestScore = -1;
  s.market.forEach((c, i) => {
    const d = CARD_DEFS[c.def];
    const score = (BOT_PRIORITY[d.kind] ?? 1) + (have.has(c.def) ? -2 : 1) + rand() * 2;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best >= 0 ? { kind: 'market', index: best } : { kind: 'deck' };
}

/** Eén volgende stap voor een bot in de teamfase, of null als ze klaar zijn. */
export function botStep(s: GameState, teamId: string, rand: () => number): Action | null {
  const team = teamOf(s, teamId);
  const riders = team.riderIds.map((id) => riderOf(s, id));

  // 0. De kopman die het best bij het parcours past, na de training.
  const best = bestKopman(s, team);
  const tol = perksOfTeam(team).overtrainTolerance;
  const cur = s.kopman[teamId] ? riderOf(s, s.kopman[teamId]) : null;
  if (best !== cur?.id && (!cur || stageFit(riderOf(s, best), s.terrain, tol) - stageFit(cur, s.terrain, tol) > 0.15))
    return { type: 'kopman', teamId, riderId: best };

  // 1. Rust nemen als een renner te moe is.
  const rest = team.hand.find((c) => CARD_DEFS[c.def].id === 'rustdag');
  const tired = [...riders].sort((a, b) => b.fatigue - a.fatigue)[0];
  if (rest && tired.fatigue >= 3) return { type: 'train', teamId, cardId: rest.id, riderId: tired.id };

  // 2. Training op de renner voor wie het het meest oplevert.
  for (const c of team.hand) {
    const d = CARD_DEFS[c.def];
    if (d.kind !== 'training' || (d.fatigue ?? 0) < 0) continue;
    const candidates = riders.filter((r) => r.trained < TRAININGS_PER_RIDER && r.fatigue + (d.fatigue ?? 0) <= 3);
    if (candidates.length === 0) continue;
    const want: Stat = (Object.keys(d.stats ?? {})[0] as Stat) ?? 'kracht';
    const pickRider = [...candidates].sort((a, b) => b.base[want] - a.base[want])[0];
    return { type: 'train', teamId, cardId: c.id, riderId: pickRider.id };
  }

  // 3. Spullen installeren als er plek is.
  for (const c of team.hand) {
    const d = CARD_DEFS[c.def];
    if (d.kind === 'training' || d.kind === 'sabotage' || d.kind === 'race') continue;
    const slot = team.slots[d.kind as SlotKind];
    if (slot.length < SLOT_LIMITS[d.kind as SlotKind]) return { type: 'install', teamId, cardId: c.id };
  }

  // 4. Af en toe saboteren, nooit het eigen team.
  const spite = team.hand.find((c) => CARD_DEFS[c.def].kind === 'sabotage');
  if (spite && rand() < 0.6) {
    const targets = s.teams.filter((t) => t.id !== teamId && t.sabotage.length === 0);
    if (targets.length > 0) {
      const t = [...targets].sort((a, b) => b.points - a.points)[0];
      return { type: 'sabotage', teamId, cardId: spite.id, targetTeamId: t.id };
    }
  }

  // 5. Munten uitgeven: liefst een slimme kaart uit de markt, anders blind.
  if (team.coins >= 2 && rand() < 0.8) {
    const options = s.market
      .map((c, i) => ({ c, i, d: CARD_DEFS[c.def] }))
      .filter((x) => x.d.price <= team.coins)
      .sort((a, b) => (BOT_PRIORITY[b.d.kind] ?? 0) - (BOT_PRIORITY[a.d.kind] ?? 0));
    if (options.length > 0) return { type: 'buy', teamId, source: { kind: 'market', index: options[0].i } };
    if (team.coins >= BLIND_COST) return { type: 'buy', teamId, source: { kind: 'deck' } };
  }
  return null;
}

export function botEfforts(s: GameState, teamId: string, rand: () => number): Record<string, Effort> {
  const team = teamOf(s, teamId);
  const out: Record<string, Effort> = {};
  const remaining = s.trackLength;
  const kopmanId = s.kopman[teamId];
  const rank = (r: Rider) => 1 + s.riders.filter((x) => x.pos > r.pos).length;
  const kopman = kopmanId ? riderOf(s, kopmanId) : null;
  // Een premie waar nog punten te halen zijn en die dichtbij ligt.
  const nearPremie = (r: Rider) =>
    s.premies.some((p) => p.hits.length < PREMIE_POINTS.length && p.pos > r.pos && p.pos - r.pos <= 8);
  for (const id of team.riderIds) {
    const r = riderOf(s, id);
    const toGo = remaining - r.pos;
    let e: Effort = 'normaal';
    if (r.energy <= Math.round(r.maxEnergy * 0.25)) e = 'rustig';
    else if (toGo <= 8 && r.energy >= 4) e = 'alles';
    else if (nearPremie(r) && r.energy >= 4 && (id === kopmanId || rand() < 0.6)) e = 'alles';
    else if (r.energy >= Math.round(r.maxEnergy * 0.7) && rand() < 0.55) e = 'alles';
    else if (r.energy <= Math.round(r.maxEnergy * 0.4) && rand() < 0.3) e = 'rustig';
    // Een knecht in de buurt die zelf geen punten haalt, helpt de kopman zolang die meedoet.
    if (kopman && canHelp(s, r) && rank(kopman) <= 7 && rank(r) > 3 && r.energy >= 2 && toGo > 3 && rand() < 0.85)
      e = 'helpen';
    out[id] = e;
  }
  return out;
}

export interface RacePlan {
  efforts: Record<string, Effort>;
  car: string | null;
  plays: RacePlay[];
}

/** Tempo, volgauto en racekaarten voor één ronde, zoals een bot ze kiest. */
export function botRacePlan(s: GameState, teamId: string, rand: () => number): RacePlan {
  const team = teamOf(s, teamId);
  const riders = team.riderIds.map((id) => riderOf(s, id));
  const kopmanId = s.kopman[teamId];
  const toGo = (r: Rider) => s.trackLength - r.pos;
  const rank = (r: Rider) => 1 + s.riders.filter((x) => x.pos > r.pos).length;
  const nearPremie = (r: Rider) =>
    s.premies.some((p) => p.hits.length < PREMIE_POINTS.length && p.pos > r.pos && p.pos - r.pos <= 6);
  const used = new Set<string>(); // kaarten
  const busy = new Set<string>(); // renners met een kaart
  const plays: RacePlay[] = [];
  const boost = new Map<string, number>();
  const cardFor = (item: RaceItem) => team.hand.find((c) => CARD_DEFS[c.def].race === item && !used.has(c.id));
  const play = (item: RaceItem, rider: Rider, targetId?: string) => {
    const c = cardFor(item);
    if (!c) return false;
    used.add(c.id);
    busy.add(rider.id);
    plays.push({ cardId: c.id, riderId: rider.id, ...(targetId ? { targetId } : {}) });
    return true;
  };
  const kopFirst = (a: Rider, b: Rider) => Number(b.id === kopmanId) - Number(a.id === kopmanId);

  // Gel: voor wie bijna leeg is, of voor de kopman vlak voor de finish.
  for (const r of [...riders].sort((a, b) => a.energy - b.energy || kopFirst(a, b))) {
    if (r.maxEnergy - r.energy < GEL_ENERGY || busy.has(r.id)) continue;
    const critical =
      r.energy <= Math.round(r.maxEnergy * 0.35) || (r.id === kopmanId && r.energy <= Math.round(r.maxEnergy * 0.5) && toGo(r) <= 10);
    if (critical && play('gel', r)) boost.set(r.id, GEL_ENERGY);
  }

  // Cola: de kopman op de laatste tegels of vlak voor een premie.
  const colaFor = [...riders]
    .filter((r) => !busy.has(r.id) && toGo(r) > 0 && (toGo(r) <= 8 || nearPremie(r)))
    .sort(kopFirst)[0];
  if (colaFor && rand() < 0.85) play('cola', colaFor);

  // Blokkade: een sterke tegenstander binnen bereik van een knecht, als hij een bedreiging is.
  if (cardFor('blok')) {
    const kop = kopmanId ? riderOf(s, kopmanId) : null;
    let best: { by: Rider; target: Rider } | null = null;
    for (const by of riders) {
      if (busy.has(by.id)) continue;
      for (const target of s.riders) {
        if (!canBlock(by, target) || rank(target) > 4) continue;
        if (kop && target.pos < kop.pos - 1) continue;
        if (!best || target.pos > best.target.pos) best = { by, target };
      }
    }
    if (best && rand() < 0.7) play('blok', best.by, best.target.id);
  }

  // Volgauto: bij wie het meeste energie te winnen valt, bij gelijkspel de kopman.
  const car =
    [...riders].sort(
      (a, b) =>
        b.maxEnergy - (b.energy + (boost.get(b.id) ?? 0)) - (a.maxEnergy - (a.energy + (boost.get(a.id) ?? 0))) ||
        kopFirst(a, b),
    )[0]?.id ?? null;

  // Het tempo kiest met de energie die er na de gel is.
  const view = {
    ...s,
    riders: s.riders.map((r) =>
      boost.has(r.id) ? { ...r, energy: Math.min(r.maxEnergy, r.energy + boost.get(r.id)!) } : r,
    ),
  };
  return { efforts: botEfforts(view, teamId, rand), car, plays };
}

export { TEAM_COLORS };
