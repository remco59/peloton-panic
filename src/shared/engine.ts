// Peloton Panic rules engine: a pure reducer over GameState.
// reduce(state, action) never mutates its input and throws RuleError on illegal moves.

import { EVENTS, EVENT_IDS, RIDER_NAME_POOL } from './content';
import { nextRand, pick, randInt, shuffle } from './rng';
import {
  CHASE_GAP,
  CONTRACT_BONUS,
  HAND_SIZE,
  MAX_TEAMS,
  MIN_TEAMS,
  POINTS_BY_RANK,
  RIDERS_PER_TEAM,
  TRACK_LENGTH,
} from './types';
import type {
  Action,
  Award,
  Card,
  CardKind,
  CardSpec,
  ContractId,
  ContractResult,
  EventId,
  GameState,
  MoveParts,
  Offer,
  OfferView,
  PlayerView,
  PublicState,
  QuirkId,
  ResolveReport,
  Results,
  Rider,
  RiderMove,
  RiderType,
  Team,
  Terrain,
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
];
const CONTRACT_IDS: ContractId[] = [
  'loneWolf',
  'domestiques',
  'sprintKing',
  'wheelMerchant',
  'freshLegs',
];
const RIDER_TYPES: RiderType[] = ['sprinter', 'climber', 'rouleur'];

// ---- Construction ------------------------------------------------------------

export function createGame(seed: number): GameState {
  return {
    phase: 'lobby',
    round: 0,
    stage: 1,
    trackLength: TRACK_LENGTH,
    terrain: [],
    teams: [],
    riders: [],
    event: null,
    eventDeck: [],
    plays: {},
    locked: {},
    tradeReady: {},
    offers: [],
    report: null,
    results: null,
    rng: seed | 0,
    nextCardId: 1,
    nextOfferId: 1,
  };
}

export function makeTrack(s: { rng: number }, length: number): Terrain[] {
  const out: Terrain[] = [];
  const push = (t: Terrain, n: number) => {
    for (let i = 0; i < n && out.length < length; i++) out.push(t);
  };
  push('flat', 4);
  const body: Terrain[] = ['flat', 'cobbles', 'climb', 'flat', 'descent', 'cobbles', 'flat'];
  let guard = 0;
  while (out.length < length - 5 && guard++ < 50) {
    const t = pick(s, body);
    if (t === 'descent' && out[out.length - 1] !== 'climb') {
      push('climb', 3 + randInt(s, 2));
      push('descent', 2 + randInt(s, 2));
    } else {
      push(t, 3 + randInt(s, 3));
    }
  }
  push('flat', length); // sprint finish
  return out.slice(0, length);
}

function newCard(s: GameState, kind: CardKind, value: number): Card {
  return { id: `c${s.nextCardId++}`, kind, value };
}

function buildDeck(s: GameState): Card[] {
  const cards: Card[] = [];
  const counts: [number, number][] = [
    [1, 3],
    [2, 3],
    [3, 3],
    [4, 2],
    [5, 2],
  ];
  for (const [value, n] of counts) for (let i = 0; i < n; i++) cards.push(newCard(s, 'energy', value));
  cards.push(newCard(s, 'gel', 4));
  cards.push(newCard(s, 'attack', 6));
  return shuffle(s, cards);
}

// ---- Movement maths (shared with the phone for previews) ---------------------

type RaceView = Pick<PublicState, 'terrain' | 'trackLength' | 'event' | 'riders'>;

export function terrainAt(r: { terrain: Terrain[]; trackLength: number }, pos: number): Terrain {
  const i = Math.max(0, Math.min(r.trackLength - 1, Math.floor(pos)));
  return r.terrain[i] ?? 'flat';
}

function typeBonus(type: RiderType, terrain: Terrain): number {
  switch (terrain) {
    case 'flat':
      return type === 'sprinter' ? 1 : 0;
    case 'climb':
      return type === 'climber' ? 2 : type === 'sprinter' ? -1 : 0;
    case 'descent':
      return 1;
    case 'cobbles':
      return type === 'rouleur' ? 1 : type === 'climber' ? -1 : 0;
  }
}

function quirkBonus(rider: Rider, terrain: Terrain, cardValue: number | null, race: RaceView): number {
  switch (rider.quirk) {
    case 'croissant':
      return cardValue !== null && cardValue >= 1 && cardValue <= 2 ? 1 : 0;
    case 'waver':
      return terrain === 'flat' ? -1 : terrain === 'climb' ? 1 : 0;
    case 'cobbleKing':
      return terrain === 'cobbles' ? 1 : 0;
    case 'descentFear':
      return terrain === 'descent' ? -1 : 0;
    case 'finisher':
      return race.trackLength - rider.pos <= 3 ? 1 : 0;
    default:
      return 0;
  }
}

function eventBonus(race: RaceView, rider: Rider, terrain: Terrain): number {
  const ev = race.event;
  if (!ev) return 0;
  const def = EVENTS[ev.id];
  let m = 0;
  const g = def.global ?? 0;
  m += g < 0 && rider.quirk === 'windHardened' ? 0 : g;
  m += def.terrain?.[terrain] ?? 0;
  if (ev.targetRiderId === rider.id) m += def.targetRider ?? 0;
  if (ev.targetTeamId === rider.teamId) m += def.targetTeam ?? 0;
  return m;
}

/** Everything about a move except drafting and chase (which depend on other riders). */
export function baseParts(race: RaceView, rider: Rider, card: { kind: CardKind; value: number } | null): MoveParts {
  const terrain = terrainAt(race, rider.pos);
  const coasting = card === null;
  return {
    base: coasting ? 1 : card.value,
    type: typeBonus(rider.type, terrain),
    quirk: quirkBonus(rider, terrain, coasting ? null : card.value, race),
    event: eventBonus(race, rider, terrain),
    draft: 0,
    chase: 0,
  };
}

export function previewMove(race: RaceView, rider: Rider, card: Card | null): number {
  const p = baseParts(race, rider, card);
  return Math.max(0, p.base + p.type + p.quirk + p.event);
}

// ---- Helpers -------------------------------------------------------------------

function teamOf(s: GameState, teamId: string): Team {
  const t = s.teams.find((x) => x.id === teamId);
  if (!t) throw new RuleError('Unknown team');
  return t;
}

function draw(s: GameState, team: Team, upTo: number) {
  while (team.hand.length < upTo) {
    if (team.draw.length === 0) {
      if (team.discard.length === 0) return;
      team.draw = shuffle(s, team.discard);
      team.discard = [];
    }
    team.hand.push(team.draw.pop()!);
  }
}

function leaderRider(riders: Rider[]): Rider {
  return riders.reduce((best, r) => (r.pos > best.pos ? r : best), riders[0]);
}

function removeOneTired(team: Team): boolean {
  for (const pile of [team.discard, team.hand, team.draw]) {
    const i = pile.findIndex((c) => c.kind === 'tired');
    if (i >= 0) {
      pile.splice(i, 1);
      return true;
    }
  }
  return false;
}

function countTired(team: Team): number {
  return [...team.draw, ...team.hand, ...team.discard].filter((c) => c.kind === 'tired').length;
}

function matches(card: Card, spec: CardSpec): boolean {
  return card.kind === spec.kind && card.value === spec.value;
}

// ---- Reducer -------------------------------------------------------------------

export function reduce(prev: GameState, action: Action): GameState {
  const s = structuredClone(prev) as GameState;
  switch (action.type) {
    case 'join':
      return join(s, action.name, !!action.isBot);
    case 'nameRiders':
      return nameRiders(s, action.teamId, action.names);
    case 'start':
      return start(s);
    case 'play':
      return play(s, action.teamId, action.plays);
    case 'unlock':
      if (s.phase === 'play') s.locked[action.teamId] = false;
      return s;
    case 'offer':
      return offer(s, action);
    case 'withdraw':
      s.offers = s.offers.filter((o) => o.from !== action.teamId);
      return s;
    case 'respond':
      return respond(s, action.teamId, action.offerId, action.accept);
    case 'tradeReady':
      if (s.phase !== 'trade') throw new RuleError('Not in the trade phase');
      teamOf(s, action.teamId);
      s.tradeReady[action.teamId] = true;
      if (s.teams.every((t) => s.tradeReady[t.id])) startRound(s);
      return s;
    case 'next':
      if (s.phase === 'resolve') afterResolve(s);
      return s;
    case 'timeout':
      if (s.phase === 'play') resolveRound(s);
      else if (s.phase === 'resolve') afterResolve(s);
      else if (s.phase === 'trade') startRound(s);
      return s;
    case 'rematch':
      return rematch(s);
    case 'removeBot': {
      if (s.phase !== 'lobby') throw new RuleError('Bots can only be removed in the lobby');
      const last = s.teams[s.teams.length - 1];
      if (!last?.isBot) throw new RuleError('No bot to remove');
      s.teams.pop();
      s.riders = s.riders.filter((r) => r.teamId !== last.id);
      return s;
    }
  }
}

function join(s: GameState, name: string, isBot: boolean): GameState {
  if (s.phase !== 'lobby') throw new RuleError('The race has already started');
  if (s.teams.length >= MAX_TEAMS) throw new RuleError('The peloton is full');
  const clean = name.trim().slice(0, 16) || (isBot ? 'Bot' : 'Player');
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
  RIDER_TYPES.forEach((type, i) => {
    const id = `${teamId}r${i + 1}`;
    riderIds.push(id);
    s.riders.push({
      id,
      teamId,
      name: pool[i] ?? `Rider ${i + 1}`,
      type,
      quirk: pick(s, QUIRK_IDS),
      pos: 0,
    });
  });
  s.teams.push({
    id: teamId,
    name: clean,
    color,
    riderIds,
    draw: [],
    hand: [],
    discard: [],
    contract: 'loneWolf',
    stats: { roundsLed: 0, trades: 0, tired: 0 },
    isBot,
  });
  return s;
}

function nameRiders(s: GameState, teamId: string, names: string[]): GameState {
  if (s.phase !== 'lobby') throw new RuleError('Names are locked once the race starts');
  const team = teamOf(s, teamId);
  team.riderIds.forEach((id, i) => {
    const n = (names[i] ?? '').trim().slice(0, 20);
    if (n) s.riders.find((r) => r.id === id)!.name = n;
  });
  return s;
}

function start(s: GameState): GameState {
  if (s.phase !== 'lobby') throw new RuleError('Already started');
  if (s.teams.length < MIN_TEAMS) throw new RuleError(`Need at least ${MIN_TEAMS} teams`);
  s.terrain = makeTrack(s, s.trackLength);
  const contracts = shuffle(s, CONTRACT_IDS);
  s.teams.forEach((t, i) => {
    t.draw = buildDeck(s);
    t.hand = [];
    t.discard = [];
    t.contract = contracts[i % contracts.length];
    t.stats = { roundsLed: 0, trades: 0, tired: 0 };
  });
  s.riders.forEach((r) => (r.pos = 0));
  s.round = 0;
  s.eventDeck = [];
  s.report = null;
  s.results = null;
  startRound(s);
  return s;
}

function drawEvent(s: GameState): void {
  if (s.eventDeck.length === 0) {
    // Two copies of the quiet ones, one of everything else.
    const ids: EventId[] = [...EVENT_IDS, 'calm', 'tailwind'];
    s.eventDeck = shuffle(s, ids);
  }
  const id = s.eventDeck.pop()!;
  const def = EVENTS[id];
  const ev: GameState['event'] = { id };
  if (def.target === 'leader') ev.targetRiderId = leaderRider(s.riders).id;
  if (def.target === 'randomRider') ev.targetRiderId = pick(s, s.riders).id;
  if (def.target === 'randomTeam') ev.targetTeamId = pick(s, s.teams).id;
  s.event = ev;
}

function startRound(s: GameState): void {
  s.round += 1;
  drawEvent(s);
  const extra = s.event ? EVENTS[s.event.id].extraDraw ?? 0 : 0;
  for (const t of s.teams) draw(s, t, HAND_SIZE + extra);
  s.phase = 'play';
  s.plays = {};
  s.locked = {};
  s.tradeReady = {};
  s.offers = [];
}

function play(s: GameState, teamId: string, plays: Record<string, string | null>): GameState {
  if (s.phase !== 'play') throw new RuleError('Not in the play phase');
  const team = teamOf(s, teamId);
  const seen = new Set<string>();
  const clean: Record<string, string | null> = {};
  for (const riderId of team.riderIds) {
    const cardId = plays[riderId] ?? null;
    if (cardId !== null) {
      if (seen.has(cardId)) throw new RuleError('A card can only be played once');
      if (!team.hand.some((c) => c.id === cardId)) throw new RuleError('You do not hold that card');
      seen.add(cardId);
    }
    clean[riderId] = cardId;
  }
  s.plays[teamId] = clean;
  s.locked[teamId] = true;
  if (s.teams.every((t) => s.locked[t.id])) resolveRound(s);
  return s;
}

// ---- Resolution ----------------------------------------------------------------

function resolveRound(s: GameState): void {
  const prevLeader = leaderRider(s.riders);
  const median = [...s.riders].map((r) => r.pos).sort((a, b) => a - b)[Math.floor(s.riders.length / 2)];
  const noDraft = s.event ? !!EVENTS[s.event.id].noDraft : false;

  interface Work {
    rider: Rider;
    index: number;
    card: Card | null;
    parts: MoveParts;
    target: number;
    cluster: number;
    front: boolean;
  }

  const work: Work[] = s.riders.map((rider, index) => {
    const team = teamOf(s, rider.teamId);
    const cardId = s.plays[rider.teamId]?.[rider.id] ?? null;
    const card = cardId ? team.hand.find((c) => c.id === cardId) ?? null : null;
    const parts = baseParts(s, rider, card);
    if (rider.pos <= median - CHASE_GAP) parts.chase = 2;
    const raw = Math.max(0, parts.base + parts.type + parts.quirk + parts.event + parts.chase);
    return { rider, index, card, parts, target: rider.pos + raw, cluster: 0, front: false };
  });

  // Group riders into clusters (chains with gaps of at most 1 tile), then draft + wind.
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
  const clusterSize = new Map<number, number>();
  for (const w of work) clusterSize.set(w.cluster, (clusterSize.get(w.cluster) ?? 0) + 1);

  const tiredTo: Record<string, number> = {};
  const moves: RiderMove[] = [];
  for (const w of work) {
    let windPaid = false;
    if (!noDraft) {
      if (!w.front) w.parts.draft = 1;
      else if (w.card && ((clusterSize.get(w.cluster) ?? 1) >= 2 || w.cluster === 0)) {
        windPaid = true;
        tiredTo[w.rider.teamId] = (tiredTo[w.rider.teamId] ?? 0) + 1;
      }
    }
    const from = w.rider.pos;
    const to = w.target + w.parts.draft;
    moves.push({
      riderId: w.rider.id,
      from,
      to,
      terrain: terrainAt(s, from),
      cardKind: w.card?.kind ?? null,
      cardValue: w.card?.value ?? null,
      coasted: w.card === null,
      parts: w.parts,
      windPaid,
      clusterIndex: w.cluster,
    });
  }

  // Apply: positions, discard played cards, tired cards, recovery for coasters.
  for (const m of moves) s.riders.find((r) => r.id === m.riderId)!.pos = m.to;
  for (const team of s.teams) {
    const plays = s.plays[team.id] ?? {};
    for (const riderId of team.riderIds) {
      const cardId = plays[riderId];
      if (cardId) {
        const i = team.hand.findIndex((c) => c.id === cardId);
        if (i >= 0) {
          const [card] = team.hand.splice(i, 1);
          if (card.kind === 'gel') continue; // exhausted for the rest of the stage
          team.discard.push(card);
          if (card.kind === 'attack') tiredTo[team.id] = (tiredTo[team.id] ?? 0) + 2;
        }
      } else if (removeOneTired(team)) {
        // A coasting rider recovers one tired card.
      }
    }
  }
  if (s.event) {
    const def = EVENTS[s.event.id];
    if (def.targetTired && s.event.targetRiderId) {
      const r = s.riders.find((x) => x.id === s.event!.targetRiderId)!;
      tiredTo[r.teamId] = (tiredTo[r.teamId] ?? 0) + 1;
    }
  }
  for (const [teamId, n] of Object.entries(tiredTo)) {
    const team = teamOf(s, teamId);
    for (let i = 0; i < n; i++) team.discard.push(newCard(s, 'tired', 0));
    team.stats.tired += n;
  }

  const leader = leaderRider(s.riders);
  teamOf(s, leader.teamId).stats.roundsLed += 1;

  const report: ResolveReport = {
    round: s.round,
    moves,
    leaderRiderId: leader.id,
    prevLeaderRiderId: prevLeader.id,
    finished: s.riders.some((r) => r.pos >= s.trackLength),
  };
  s.report = report;
  s.phase = 'resolve';
  s.offers = [];
}

function afterResolve(s: GameState): void {
  if (s.report?.finished) finish(s);
  else {
    s.phase = 'trade';
    s.tradeReady = {};
  }
}

// ---- Trading -------------------------------------------------------------------

function offer(s: GameState, a: Extract<Action, { type: 'offer' }>): GameState {
  if (s.phase !== 'trade') throw new RuleError('Trading is only open between rounds');
  const from = teamOf(s, a.teamId);
  teamOf(s, a.to);
  if (a.to === a.teamId) throw new RuleError('You cannot trade with yourself');
  if (a.give.length === 0 && a.want.length === 0) throw new RuleError('Offer something or ask for something');
  if (a.give.length > 3 || a.want.length > 3) throw new RuleError('At most 3 cards per offer');
  const ids = new Set(a.give);
  if (ids.size !== a.give.length || !a.give.every((id) => from.hand.some((c) => c.id === id)))
    throw new RuleError('You do not hold those cards');
  s.offers = s.offers.filter((o) => o.from !== a.teamId);
  s.offers.push({ id: `o${s.nextOfferId++}`, from: a.teamId, to: a.to, give: a.give, want: a.want });
  return s;
}

/** Cards in `hand` that satisfy every spec, or null when they cannot all be met. */
export function matchSpecs(hand: Card[], want: CardSpec[]): Card[] | null {
  const used = new Set<string>();
  const out: Card[] = [];
  for (const spec of want) {
    const c = hand.find((h) => !used.has(h.id) && matches(h, spec));
    if (!c) return null;
    used.add(c.id);
    out.push(c);
  }
  return out;
}

function respond(s: GameState, teamId: string, offerId: string, accept: boolean): GameState {
  if (s.phase !== 'trade') throw new RuleError('Trading is only open between rounds');
  const o = s.offers.find((x) => x.id === offerId);
  if (!o || o.to !== teamId) throw new RuleError('That offer is gone');
  s.offers = s.offers.filter((x) => x.id !== offerId);
  if (!accept) return s;
  const from = teamOf(s, o.from);
  const to = teamOf(s, o.to);
  const giving = o.give.map((id) => from.hand.find((c) => c.id === id));
  if (giving.some((c) => !c)) throw new RuleError('The offer is no longer valid');
  const getting = matchSpecs(to.hand, o.want);
  if (!getting) throw new RuleError('You do not have the cards they asked for');
  const givingIds = new Set(o.give);
  const gettingIds = new Set(getting.map((c) => c.id));
  from.hand = from.hand.filter((c) => !givingIds.has(c.id)).concat(getting);
  to.hand = to.hand.filter((c) => !gettingIds.has(c.id)).concat(giving as Card[]);
  from.stats.trades += 1;
  to.stats.trades += 1;
  // Any other offer that mentioned a moved card is stale now.
  const moved = new Set([...givingIds, ...gettingIds]);
  s.offers = s.offers.filter((x) => !x.give.some((id) => moved.has(id)));
  return s;
}

// ---- Finishing -----------------------------------------------------------------

function contractMet(s: GameState, team: Team, rank: Map<string, number>): boolean {
  switch (team.contract) {
    case 'loneWolf':
      return team.stats.roundsLed >= 4;
    case 'domestiques': {
      const half = Math.ceil(s.riders.length / 2);
      return team.riderIds.every((id) => (rank.get(id) ?? 99) <= half);
    }
    case 'sprintKing': {
      const sprinter = s.riders.find((r) => r.teamId === team.id && r.type === 'sprinter');
      return !!sprinter && rank.get(sprinter.id) === 1;
    }
    case 'wheelMerchant':
      return team.stats.trades >= 3;
    case 'freshLegs':
      return countTired(team) <= 1;
  }
}

function finish(s: GameState): void {
  const ordered = s.riders
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.pos - a.r.pos || a.i - b.i);
  const rank = new Map<string, number>();
  ordered.forEach((x, i) => rank.set(x.r.id, i + 1));
  const ranking = ordered.map((x, i) => ({
    riderId: x.r.id,
    rank: i + 1,
    points: POINTS_BY_RANK[i] ?? 0,
  }));
  const teams = s.teams.map((t) => {
    const stagePoints = ranking
      .filter((x) => t.riderIds.includes(x.riderId))
      .reduce((sum, x) => sum + x.points, 0);
    const met = contractMet(s, t, rank);
    return {
      teamId: t.id,
      stagePoints,
      contract: t.contract,
      contractMet: met,
      total: stagePoints + (met ? CONTRACT_BONUS : 0),
    };
  });
  const sorted = [...teams].sort((a, b) => b.total - a.total);
  const winner = sorted[0].teamId;
  // The lanterne rouge is the team holding the last-placed rider.
  const lanterneRougeTeamId = ordered[ordered.length - 1].r.teamId;

  const awards: Award[] = [];
  const maxBy = (f: (t: Team) => number) => [...s.teams].sort((a, b) => f(b) - f(a));
  const led = maxBy((t) => t.stats.roundsLed)[0];
  if (led.stats.roundsLed > 0)
    awards.push({
      title: 'Most Aggressive',
      teamId: led.id,
      blurb: `Had the front of the race in ${led.stats.roundsLed} rounds.`,
    });
  const trader = maxBy((t) => t.stats.trades)[0];
  if (trader.stats.trades > 0)
    awards.push({
      title: 'Wheel Merchant',
      teamId: trader.id,
      blurb: `Completed ${trader.stats.trades} trades.`,
    });
  const tough = maxBy((t) => -t.stats.tired)[0];
  awards.push({
    title: 'Iron Legs',
    teamId: tough.id,
    blurb: `Only collected ${tough.stats.tired} tired cards.`,
  });
  awards.push({
    title: 'Lanterne Rouge',
    teamId: lanterneRougeTeamId,
    blurb: 'Last across the line. Wear the red light with pride.',
  });

  const results: Results = { ranking, teams, winnerTeamId: winner, lanterneRougeTeamId, awards };
  s.results = results;
  s.phase = 'finished';
}

function rematch(s: GameState): GameState {
  if (s.phase !== 'finished') throw new RuleError('The race is not over yet');
  s.phase = 'lobby';
  s.round = 0;
  s.terrain = [];
  s.event = null;
  s.eventDeck = [];
  s.plays = {};
  s.locked = {};
  s.tradeReady = {};
  s.offers = [];
  s.report = null;
  s.results = null;
  s.riders.forEach((r) => (r.pos = 0));
  s.teams.forEach((t) => {
    t.draw = [];
    t.hand = [];
    t.discard = [];
    t.stats = { roundsLed: 0, trades: 0, tired: 0 };
  });
  return s;
}

// ---- Views ---------------------------------------------------------------------

export function toPublic(s: GameState): PublicState {
  let contractsRevealed: ContractResult[] | null = null;
  if (s.results) {
    contractsRevealed = s.results.teams.map((t) => ({
      teamId: t.teamId,
      contract: t.contract,
      met: t.contractMet,
    }));
  }
  return {
    phase: s.phase,
    round: s.round,
    stage: s.stage,
    trackLength: s.trackLength,
    terrain: s.terrain,
    teams: s.teams.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      riderIds: t.riderIds,
      handCount: t.hand.length,
      drawCount: t.draw.length,
      discardCount: t.discard.length,
      locked: !!s.locked[t.id],
      ready: !!s.tradeReady[t.id],
      isBot: t.isBot,
    })),
    riders: s.riders,
    event: s.event,
    report: s.report,
    results: s.results,
    contractsRevealed,
  };
}

function withCards(s: GameState, o: Offer): OfferView {
  const from = s.teams.find((t) => t.id === o.from);
  return { ...o, giveCards: o.give.map((id) => from?.hand.find((c) => c.id === id)).filter((c): c is Card => !!c) };
}

export function toPlayerView(s: GameState, teamId: string): PlayerView | null {
  const t = s.teams.find((x) => x.id === teamId);
  if (!t) return null;
  return {
    teamId,
    hand: t.hand,
    contract: t.contract,
    plays: s.plays[teamId] ?? {},
    offersIn: s.offers.filter((o) => o.to === teamId).map((o) => withCards(s, o)),
    offerOut: (() => {
      const o = s.offers.find((x) => x.from === teamId);
      return o ? withCards(s, o) : null;
    })(),
    stats: t.stats,
  };
}

// ---- Bots ----------------------------------------------------------------------

/** A simple, slightly random bot: spends strong cards when it is behind, coasts sometimes. */
export function botPlays(s: GameState, teamId: string, rand: () => number): Record<string, string | null> {
  const team = teamOf(s, teamId);
  const hand = [...team.hand].filter((c) => c.kind !== 'tired').sort((a, b) => b.value - a.value);
  const tiredCount = team.hand.length - hand.length;
  const out: Record<string, string | null> = {};
  const taken = new Set<string>();
  for (const riderId of team.riderIds) {
    const coast = rand() < 0.15 + tiredCount * 0.05;
    const candidates = hand.filter((c) => !taken.has(c.id) && c.kind !== 'attack');
    if (coast || candidates.length === 0) {
      out[riderId] = null;
      continue;
    }
    // Weighted towards mid-high cards, saving the very best some of the time.
    const idx = Math.min(candidates.length - 1, Math.floor(rand() * rand() * candidates.length * 1.4));
    const card = candidates[idx];
    taken.add(card.id);
    out[riderId] = card.id;
  }
  return out;
}

export { nextRand };
