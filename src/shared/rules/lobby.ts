// Lobby en start.

import { pick, randInt, shuffle } from '../rng';
import { BLOCK_RANGE, HELP_RANGE, MAX_TEAMS, MIN_TEAMS, RIDERS_PER_TEAM, START_COINS } from '../types';
import type { GameState, Rider, Team } from '../types';
import { RuleError, WEATHER_DECK } from './base';
import { perksOfTeam, riderOf, teamOf } from './calc';
import { deliverSupplies } from './recruit';
import { buildDeck, makePremies, makeTrack, newCard, refillMarket, stageFit } from './setup';

// ---- Lobby en start ----------------------------------------------------------

export function join(s: GameState, name: string, isBot: boolean): GameState {
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

export function bestKopman(s: GameState, team: Team): string {
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

export function setKopman(s: GameState, teamId: string, riderId: string): GameState {
  if (s.phase !== 'team') throw new RuleError('Je kiest je kopman tijdens de voorbereiding');
  const team = teamOf(s, teamId);
  if (!team.riderIds.includes(riderId)) throw new RuleError('Dat is jouw renner niet');
  s.kopman[teamId] = riderId;
  return s;
}

export function start(s: GameState): GameState {
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

export function beginStage(s: GameState): void {
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
