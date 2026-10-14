// Regelmotor van Peloton Panic: een pure reducer over GameState.
// reduce(state, action) wijzigt de invoer nooit en gooit een RuleError bij een illegale zet.
//
// Een seizoen = 3 etappes. Elke etappe: draft (kaarten kiezen) -> team (voorbereiden,
// winkelen, trainen, ruilen) -> race (per ronde: Rustig / Normaal / Alles geven) -> uitslag.

import {
  CARD_DEFS,
  CARD_DEF_LIST,
  EFFORTS,
  EVENTS,
  EVENT_IDS,
  RIDER_NAME_POOL,
  RIDER_TYPES,
  STAGE_INFO,
  TEAM_COLORS,
} from './content';
import type { Perk } from './content';
import { pick, randInt, shuffle } from './rng';
import {
  BLIND_COST,
  CHASE_GAP,
  FATIGUE_CAP,
  FORM_CAP,
  MARKET_SIZE,
  MAX_TEAMS,
  MIN_TEAMS,
  OVERTRAIN_FREE,
  POINTS_BY_RANK,
  RIDERS_PER_TEAM,
  SLOT_LIMITS,
  STAGES,
  STAT_FACTOR,
  START_COINS,
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
  PlayerView,
  PublicState,
  QuirkId,
  ResolveReport,
  Rider,
  RiderMove,
  RiderType,
  SlotKind,
  Stat,
  Stats,
  Team,
  Terrain,
} from './types';

export class RuleError extends Error {}

const QUIRK_IDS: QuirkId[] = ['croissant', 'waver', 'cobbleKing', 'descentFear', 'windHardened', 'socks', 'finisher'];
const RIDER_TYPE_ORDER: RiderType[] = ['sprinter', 'climber', 'rouleur'];
const STAT_KEYS: Stat[] = ['kracht', 'klim', 'sprint', 'uithouding'];
const ZERO: Stats = { kracht: 0, klim: 0, sprint: 0, uithouding: 0 };

// ---- Opbouw ------------------------------------------------------------------

export function createGame(seed: number): GameState {
  return {
    phase: 'lobby',
    tutorial: false,
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
    ready: {},
    efforts: {},
    locked: {},
    offers: [],
    sabotageLog: [],
    report: null,
    stageResult: null,
    season: null,
    rng: seed | 0,
    nextCardId: 1,
    nextOfferId: 1,
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

export function effectiveStats(r: Rider, tolerance: number): Stats {
  const pen = overtrainPenalty(r, tolerance);
  const out = { ...ZERO };
  for (const k of STAT_KEYS) out[k] = Math.max(0, r.base[k] + r.form[k] - pen);
  return out;
}

export function maxEnergyFor(r: Rider, perks: Required<Perk>, bidon: boolean): number {
  const stats = effectiveStats(r, perks.overtrainTolerance);
  return Math.max(4, 3 + stats.uithouding + perks.startEnergy - (bidon ? 2 : 0));
}

/** Renners starten niet vol: zo loont het om onderweg te sparen (Rustig rijden). Voeding/teambus tellen wel volledig mee. */
export const START_ENERGY_FRACTION = 0.6;

export function startEnergyFor(maxEnergy: number, perks: Required<Perk>): number {
  const base = Math.max(0, maxEnergy - perks.startEnergy);
  return Math.min(maxEnergy, Math.ceil(base * START_ENERGY_FRACTION) + perks.startEnergy);
}

type RaceView = Pick<PublicState, 'terrain' | 'trackLength' | 'event'>;

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
  }

  let event = 0;
  const ev = race.event;
  if (ev) {
    const def = EVENTS[ev.id];
    const g = def.global ?? 0;
    event += g < 0 && rider.quirk === 'windHardened' ? 0 : g;
    event += def.terrain?.[terrain] ?? 0;
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
  let effort = chosen;
  if (effort === 'alles' && energy < allesCost(perks)) effort = 'normaal';
  if (effort === 'normaal' && energy < 1) effort = 'rustig';
  return { effort, exhausted: energy <= 0 && chosen !== 'rustig' };
}

export function sumParts(p: MoveParts): number {
  return Math.max(0, p.effort + p.stat + p.terrain + p.quirk + p.event + p.luck + p.tired + p.draft + p.chase);
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
    case 'nameRiders':
      return nameRiders(s, action.teamId, action.names);
    case 'setTutorial':
      if (s.phase !== 'lobby') throw new RuleError('De tutorial kies je voor de start');
      s.tutorial = action.on;
      return s;
    case 'start':
      return start(s);
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
      if (s.phase !== 'team') throw new RuleError('Nu kun je niet klaarzetten');
      teamOf(s, action.teamId);
      s.ready[action.teamId] = true;
      if (s.teams.every((t) => s.ready[t.id])) startRace(s);
      return s;
    case 'unready':
      if (s.phase === 'team') s.ready[action.teamId] = false;
      return s;
    case 'effort':
      return setEfforts(s, action.teamId, action.efforts);
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
  const usedNames = new Set(s.riders.map((r) => r.name));
  const pool = shuffle(
    s,
    RIDER_NAME_POOL.filter((n) => !usedNames.has(n)),
  );
  const riderIds: string[] = [];
  RIDER_TYPE_ORDER.forEach((type, i) => {
    const id = `${teamId}r${i + 1}`;
    riderIds.push(id);
    s.riders.push({
      id,
      teamId,
      name: pool[i] ?? `Renner ${i + 1}`,
      type,
      quirk: pick(s, QUIRK_IDS),
      pos: 0,
      base: { ...RIDER_TYPES[type].base },
      form: { ...ZERO },
      fatigue: 0,
      trained: 0,
      energy: 0,
      maxEnergy: 0,
    });
  });
  s.teams.push({
    id: teamId,
    name: clean,
    color,
    riderIds,
    coins: START_COINS,
    points: 0,
    hand: [],
    slots: { sponsor: [], staff: [], material: [], car: [] },
    sabotage: [],
    raceShield: 0,
    raceService: 0,
    stats: { roundsLed: 0, trades: 0, trainings: 0, alles: 0, exhausted: 0, sabotages: 0 },
    isBot,
  });
  return s;
}

function nameRiders(s: GameState, teamId: string, names: string[]): GameState {
  if (s.phase !== 'lobby') throw new RuleError('Namen liggen vast zodra de race begint');
  const team = teamOf(s, teamId);
  team.riderIds.forEach((id, i) => {
    const n = (names[i] ?? '').trim().slice(0, 20);
    if (n) riderOf(s, id).name = n;
  });
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
  s.teams.forEach((t) => {
    t.coins = START_COINS;
    t.points = 0;
    t.hand = [];
    t.slots = { sponsor: [], staff: [], material: [], car: [] };
    t.stats = { roundsLed: 0, trades: 0, trainings: 0, alles: 0, exhausted: 0, sabotages: 0 };
  });
  beginStage(s);
  return s;
}

function beginStage(s: GameState): void {
  s.stage += 1;
  s.terrain = makeTrack(s, s.trackLength, s.stage);
  s.riders.forEach((r) => {
    r.pos = 0;
    r.trained = 0;
    r.energy = 0;
  });
  s.teams.forEach((t) => {
    t.sabotage = [];
  });
  s.round = 0;
  s.event = null;
  s.eventDeck = [];
  s.report = null;
  s.stageResult = null;
  s.sabotageLog = [];
  s.offers = [];
  s.ready = {};
  s.efforts = {};
  s.locked = {};
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
  if (kind === 'training' || kind === 'sabotage') throw new RuleError('Die kaart plaats je niet op je bord');
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
    team.raceService = perks.service;
    for (const id of team.riderIds) {
      const r = riderOf(s, id);
      r.maxEnergy = maxEnergyFor(r, perks, bidon);
      r.energy = startEnergyFor(r.maxEnergy, perks);
    }
  }
  startRound(s);
}

function drawEvent(s: GameState): void {
  if (s.eventDeck.length === 0) {
    const ids: EventId[] = [...EVENT_IDS, 'calm', 'tailwind'];
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
  s.locked = {};
  s.phase = 'race';
}

function setEfforts(s: GameState, teamId: string, efforts: Record<string, Effort>): GameState {
  if (s.phase !== 'race') throw new RuleError('Nu kies je geen tempo');
  const team = teamOf(s, teamId);
  for (const id of team.riderIds) {
    const e = efforts[id] ?? 'normaal';
    if (!(e in EFFORTS)) throw new RuleError('Onbekend tempo');
    s.efforts[id] = e;
  }
  s.locked[teamId] = true;
  if (s.teams.every((t) => s.locked[t.id])) resolveRound(s);
  return s;
}

function resolveRound(s: GameState): void {
  const prevLeader = leaderRider(s.riders);
  const sortedPos = s.riders.map((r) => r.pos).sort((a, b) => a - b);
  const median = sortedPos[Math.floor(sortedPos.length / 2)];
  const noDraft = s.event ? !!EVENTS[s.event.id].noDraft : false;

  interface Work {
    rider: Rider;
    index: number;
    effort: Effort;
    parts: MoveParts;
    roll: number;
    pech: boolean;
    shielded: boolean;
    boost: boolean;
    exhausted: boolean;
    target: number;
    cluster: number;
    front: boolean;
  }

  const work: Work[] = s.riders.map((rider, index) => {
    const team = teamOf(s, rider.teamId);
    const perks = perksOfTeam(team);
    const { effort, exhausted } = resolveEffort(rider.energy, perks, s.efforts[rider.id] ?? 'normaal');
    const parts = baseParts(s, rider, perks, effort, exhausted);
    if (rider.pos <= median - CHASE_GAP) parts.chase = 2;

    const roll = randInt(s, 10) + 1;
    const threshold = team.sabotage.includes('spijkers') ? 2 : 1;
    let pech = false;
    let shielded = false;
    let boost = false;
    if (roll <= threshold) {
      if (team.raceShield > 0) {
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
  const ev = s.event ? EVENTS[s.event.id] : null;
  for (const w of work) {
    let windPaid = false;
    if (!noDraft) {
      if (!w.front) w.parts.draft = 1;
      else if (w.effort !== 'rustig' && ((size.get(w.cluster) ?? 1) >= 2 || w.cluster === 0)) windPaid = true;
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
    if (ev?.energyAll) delta += ev.energyAll;
    if (s.event?.targetRiderId === rider.id && ev?.targetEnergy) delta += ev.targetEnergy;
    rider.energy = Math.max(0, Math.min(rider.maxEnergy, rider.energy + delta));
    if (w.exhausted) team.stats.exhausted += 1;
    let service = false;
    if (team.raceService > 0 && rider.energy <= 1) {
      team.raceService -= 1;
      rider.energy = Math.min(rider.maxEnergy, rider.energy + 3);
      service = true;
    }

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
      shielded: w.shielded,
      boost: w.boost,
      service,
      energyAfter: rider.energy,
      clusterIndex: w.cluster,
    });
  }
  for (const m of moves) riderOf(s, m.riderId).pos = m.to;

  const leader = leaderRider(s.riders);
  teamOf(s, leader.teamId).stats.roundsLed += 1;
  s.report = {
    round: s.round,
    moves,
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
  const ranking = ordered.map((x, i) => ({ riderId: x.r.id, rank: i + 1, points: (POINTS_BY_RANK[i] ?? 0) * factor }));

  const results = s.teams.map((t) => {
    const mine = ranking.filter((x) => t.riderIds.includes(x.riderId));
    const stagePoints = mine.reduce((sum, x) => sum + x.points, 0);
    const best = Math.min(...mine.map((x) => x.rank));
    const perks = perksOfTeam(t);
    const prizeCoins = best === 1 ? 3 : best <= 3 ? 2 : 1;
    const sponsorCoins = perks.income + (best <= 3 ? perks.podiumBonus : 0);
    return { teamId: t.id, stagePoints, prizeCoins, sponsorCoins, bonusCards: [] as string[], totalPoints: 0, best };
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
  }
  s.teams.forEach((t) => {
    t.sabotage = [];
  });

  s.stageResult = {
    stage: s.stage,
    ranking,
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
  s.locked = {};
  s.offers = [];
  s.report = null;
  s.stageResult = null;
  s.season = null;
  s.sabotageLog = [];
  s.riders.forEach((r) => {
    r.pos = 0;
    r.form = { ...ZERO };
    r.base = { ...RIDER_TYPES[r.type].base };
    r.fatigue = 0;
    r.trained = 0;
    r.energy = 0;
  });
  s.teams.forEach((t) => {
    t.hand = [];
    t.slots = { sponsor: [], staff: [], material: [], car: [] };
    t.coins = START_COINS;
    t.points = 0;
    t.sabotage = [];
  });
  return s;
}

// ---- Weergaven ---------------------------------------------------------------

export function toPublic(s: GameState): PublicState {
  const current = currentDraftTeam(s);
  return {
    phase: s.phase,
    tutorial: s.tutorial,
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
    offersIn: s.offers.filter((o) => o.to === teamId).map((o) => withCards(s, o)),
    offerOut: out ? withCards(s, out) : null,
    sabotageOn: t.sabotage,
    pickPending: s.phase === 'draft' && currentDraftTeam(s) === teamId,
    stats: t.stats,
  };
}

// ---- Bots --------------------------------------------------------------------

const BOT_PRIORITY: Record<string, number> = {
  sponsor: 5,
  staff: 4,
  car: 4,
  material: 3,
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
    if (d.kind === 'training' || d.kind === 'sabotage') continue;
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
  for (const id of team.riderIds) {
    const r = riderOf(s, id);
    const toGo = remaining - r.pos;
    let e: Effort = 'normaal';
    if (r.energy <= 2) e = 'rustig';
    else if (toGo <= 6 && r.energy >= 4) e = 'alles';
    else if (r.energy >= r.maxEnergy - 1 && rand() < 0.35) e = 'alles';
    else if (r.energy <= 4 && rand() < 0.4) e = 'rustig';
    out[id] = e;
  }
  return out;
}

export { TEAM_COLORS };
