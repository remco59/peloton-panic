import { describe, expect, it } from 'vitest';
import {
  baseParts,
  botDraft,
  botEfforts,
  botShopStep,
  crashChance,
  groupsOf,
  isWet,
  botRacePlan,
  botStep,
  createGame,
  effectiveStats,
  makePremies,
  matchDefs,
  overtrainPenalty,
  perksOf,
  reduce,
  RuleError,
  toPlayerView,
  toPublic,
} from './engine';
import {
  BLIND_COST,
  BLOCK_PENALTY,
  CAR_ENERGY,
  CAR_ENERGY_UPGRADED,
  COLA_BONUS,
  CRASH_LOSS,
  RECRUIT_PICKS,
  SHOP_CONTRACTS,
  TEAM_BONUS,
  ENERGY_MIN,
  GEL_ENERGY,
  HELP_BONUS,
  HELP_RANGE,
  MARKET_SIZE,
  PELOTON_REST,
  PREMIE_POINTS,
  RIDERS_PER_TEAM,
  START_COINS,
  POINTS_BY_RANK,
  STAGES,
  STAGE_FACTOR,
  TRACK_LENGTH,
} from './types';
import { CARD_DEFS, EVENTS, EVENT_IDS } from './content';
import type { Action, Card, Effort, GameState, RacePlay, ShopItem } from './types';

function lobby(n: number, seed = 42): GameState {
  let s = createGame(seed);
  for (let i = 0; i < n; i++) s = reduce(s, { type: 'join', name: `P${i + 1}` });
  return s;
}

/** Start het seizoen en slaat de uitleg over: het rekruteren is open. */
const briefed = (n = 3, seed = 42) => reduce(reduce(lobby(n, seed), { type: 'start' }), { type: 'briefDone' });

/** Koopt per team de drie goedkoopste (gratis) renners en zet op klaar: zo houdt elk team zijn startmunten. */
function finishRecruit(s: GameState): GameState {
  if (s.phase === 'recruit') {
    for (const t of s.teams) {
      const riders = s.recruit!.shops[t.id]
        .filter((x): x is Extract<ShopItem, { kind: 'rider' }> => x.kind === 'rider')
        .sort((x, y) => x.price - y.price)
        .slice(0, RECRUIT_PICKS);
      for (const r of riders) s = reduce(s, { type: 'recruit', teamId: t.id, itemId: r.id });
      s = reduce(s, { type: 'ready', teamId: t.id });
    }
  }
  return finishNaming(s);
}

/** Houdt de namen zoals ze zijn en laat elk team op klaar drukken. */
function finishNaming(s: GameState): GameState {
  for (const t of s.teams) if (s.phase === 'naming') s = reduce(s, { type: 'ready', teamId: t.id });
  return s;
}

/** Start het seizoen en slaat uitleg en rekruteren over: de draft is open. */
const started = (n = 3, seed = 42) => finishRecruit(briefed(n, seed));

function makeRand(seed = 99) {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}

/** Speelt de draft af door steeds het eerste markt-item te kiezen. */
function finishDraft(s: GameState): GameState {
  while (s.phase === 'draft') {
    const teamId = s.draft!.order[s.draft!.idx];
    s = reduce(s, { type: 'draftPick', teamId, source: { kind: 'market', index: 0 } });
  }
  return s;
}

function give(s: GameState, teamId: string, def: string): { s: GameState; card: Card } {
  const next = structuredClone(s);
  const card: Card = { id: `x${next.nextCardId++}`, def };
  next.teams.find((t) => t.id === teamId)!.hand.push(card);
  return { s: next, card };
}

function toRace(n = 3, seed = 42): GameState {
  let s = finishDraft(started(n, seed));
  for (const t of s.teams) s = reduce(s, { type: 'ready', teamId: t.id });
  return s;
}

function lockAll(s: GameState, effort: Effort): GameState {
  for (const t of s.teams) {
    const efforts: Record<string, Effort> = {};
    t.riderIds.forEach((id) => (efforts[id] = effort));
    s = reduce(s, { type: 'effort', teamId: t.id, efforts });
  }
  return s;
}

describe('lobby en start', () => {
  it('maakt teams zonder renners, met unieke kleuren en startmunten', () => {
    const s = lobby(4);
    expect(s.teams).toHaveLength(4);
    expect(s.riders).toHaveLength(0);
    expect(new Set(s.teams.map((t) => t.color)).size).toBe(4);
    expect(s.teams.every((t) => t.coins === START_COINS)).toBe(true);
  });

  it('weigert starten met 1 team en een 7e team', () => {
    expect(() => reduce(lobby(1), { type: 'start' })).toThrow(RuleError);
    expect(() => reduce(lobby(6), { type: 'join', name: 'laat' })).toThrow(RuleError);
  });

  it('zet het commentaar standaard uit en laat de president het in de lobby aanzetten', () => {
    let s = lobby(2);
    expect(s.commentary).toBe(false);
    s = reduce(s, { type: 'setCommentary', on: true });
    expect(s.commentary).toBe(true);
  });

  it('opent met een markt van 5 kaarten en een draft met 2 rondes', () => {
    const s = started(3);
    expect(s.phase).toBe('draft');
    expect(s.stage).toBe(1);
    expect(s.market).toHaveLength(MARKET_SIZE);
    expect(s.draft!.order).toHaveLength(6);
    expect(s.terrain).toHaveLength(TRACK_LENGTH);
    expect(s.terrain[TRACK_LENGTH - 1]).toBe('flat');
  });

  it('is deterministisch voor dezelfde seed', () => {
    expect(started(3, 7)).toEqual(started(3, 7));
    expect(started(3, 7).terrain).not.toEqual(started(3, 8).terrain);
  });

  it('schakelt de tutorial alleen in de lobby', () => {
    let s = reduce(lobby(2), { type: 'setTutorial', on: true });
    expect(s.tutorial).toBe(true);
    s = reduce(s, { type: 'start' });
    expect(() => reduce(s, { type: 'setTutorial', on: false })).toThrow(RuleError);
  });
});

describe('uitleg vooraf', () => {
  it('start met de uitleg, zonder draft en zonder timer-actie', () => {
    const s = reduce(lobby(3), { type: 'start' });
    expect(s.phase).toBe('briefing');
    expect(s.briefing).toEqual({ page: 0, ok: {} });
    expect(() => reduce(s, { type: 'draftPick', teamId: s.draft!.order[0], source: { kind: 'deck' } })).toThrow(RuleError);
    // Een time-out doet niets: de uitleg wacht tot iedereen het snapt.
    expect(reduce(s, { type: 'timeout' }).phase).toBe('briefing');
  });

  it('bladert, houdt bij wie het snapt en gaat daarna naar de draft', () => {
    let s = reduce(lobby(3), { type: 'start' });
    s = reduce(s, { type: 'briefPage', page: 2 });
    expect(s.briefing!.page).toBe(2);
    s = reduce(s, { type: 'briefPage', page: 999 });
    expect(s.briefing!.page).toBeGreaterThan(2);
    s = reduce(s, { type: 'briefOk', teamId: s.teams[0].id, on: true });
    expect(toPublic(s).briefing!.ok[s.teams[0].id]).toBe(true);
    expect(toPublic(s).briefing!.ok[s.teams[1].id]).toBe(false);
    s = reduce(s, { type: 'briefDone' });
    expect(s.phase).toBe('recruit');
    expect(s.briefing).toBeNull();
  });

  it('bots snappen het meteen', () => {
    let s = createGame(5);
    s = reduce(s, { type: 'join', name: 'Mens' });
    s = reduce(s, { type: 'join', name: 'Bot', isBot: true });
    s = reduce(s, { type: 'start' });
    expect(toPublic(s).briefing!.ok[s.teams[1].id]).toBe(true);
    expect(toPublic(s).briefing!.ok[s.teams[0].id]).toBe(false);
  });
});

describe('draft', () => {
  it('laat alleen het team aan de beurt kiezen en vult de markt aan', () => {
    let s = started(3);
    const first = s.draft!.order[0];
    const other = s.teams.find((t) => t.id !== first)!.id;
    expect(() => reduce(s, { type: 'draftPick', teamId: other, source: { kind: 'market', index: 0 } })).toThrow(RuleError);
    const picked = s.market[0].def;
    s = reduce(s, { type: 'draftPick', teamId: first, source: { kind: 'market', index: 0 } });
    expect(s.teams.find((t) => t.id === first)!.hand.map((c) => c.def)).toContain(picked);
    expect(s.market).toHaveLength(MARKET_SIZE);
    expect(s.draft!.idx).toBe(1);
  });

  it('gaat na alle keuzes door naar de teamfase', () => {
    const s = finishDraft(started(3));
    expect(s.phase).toBe('team');
    // Twee gedraftte kaarten plus een gratis gel per renner.
    for (const t of s.teams) expect(t.hand).toHaveLength(2 + RIDERS_PER_TEAM);
  });

  it('time-out kiest automatisch voor het team aan de beurt', () => {
    let s = started(2);
    s = reduce(s, { type: 'timeout' });
    expect(s.draft!.idx).toBe(1);
    expect(s.teams.reduce((n, t) => n + t.hand.length, 0)).toBe(2 * RIDERS_PER_TEAM + 1); // gratis gels + de automatische keuze
  });
});

describe('winkel, training en spullen', () => {
  it('koopt blind voor 2 en uit de markt voor de prijs', () => {
    let s = finishDraft(started(2));
    const t = s.teams[0];
    const coins = t.coins;
    s = reduce(s, { type: 'buy', teamId: t.id, source: { kind: 'deck' } });
    expect(s.teams[0].coins).toBe(coins - BLIND_COST);
    // Gels, twee gedraftte kaarten en de blinde koop.
    expect(s.teams[0].hand).toHaveLength(RIDERS_PER_TEAM + 2 + 1);
    let broke = structuredClone(s);
    broke.teams[0].coins = 0;
    expect(() => reduce(broke, { type: 'buy', teamId: t.id, source: { kind: 'deck' } })).toThrow(RuleError);
  });

  it('training verhoogt vorm en vermoeidheid, max 2 per renner per etappe', () => {
    let s = finishDraft(started(2));
    const team = s.teams[0];
    const rider = team.riderIds[0];
    let card: Card;
    ({ s, card } = give(s, team.id, 'duurloop'));
    const before = s.riders.find((r) => r.id === rider)!.base.uithouding;
    s = reduce(s, { type: 'train', teamId: team.id, cardId: card.id, riderId: rider });
    let r = s.riders.find((x) => x.id === rider)!;
    expect(r.form.uithouding).toBe(2);
    expect(r.fatigue).toBe(1);
    expect(r.base.uithouding).toBe(before);
    ({ s, card } = give(s, team.id, 'duurloop'));
    s = reduce(s, { type: 'train', teamId: team.id, cardId: card.id, riderId: rider });
    ({ s, card } = give(s, team.id, 'duurloop'));
    expect(() => reduce(s, { type: 'train', teamId: team.id, cardId: card.id, riderId: rider })).toThrow(RuleError);
    r = s.riders.find((x) => x.id === rider)!;
    expect(r.form.uithouding).toBe(4);
  });

  it('overtraining kost basiswaarden; rust en fysio helpen', () => {
    const r = { fatigue: 4 };
    expect(overtrainPenalty(r, 0)).toBe(2);
    expect(overtrainPenalty(r, 1)).toBe(1);
    let s = finishDraft(started(2));
    const rider = s.riders[0];
    rider.fatigue = 4;
    expect(effectiveStats(rider, 0).kracht).toBe(Math.max(0, rider.base.kracht - 2));
    expect(effectiveStats({ ...rider, fatigue: 0 }, 0).kracht).toBe(rider.base.kracht);
    const t = s.teams[0];
    s.riders.find((x) => x.id === t.riderIds[0])!.fatigue = 4;
    let card: Card;
    ({ s, card } = give(s, t.id, 'rustdag'));
    s = reduce(s, { type: 'train', teamId: t.id, cardId: card.id, riderId: t.riderIds[0] });
    expect(s.riders.find((x) => x.id === t.riderIds[0])!.fatigue).toBe(2);
  });

  it('installeert spullen in een vak met limiet en vervangt op verzoek', () => {
    let s = finishDraft(started(2));
    const t = s.teams[0];
    const ids: string[] = [];
    for (const def of ['mecanicien', 'soigneur', 'fysio']) {
      let c: Card;
      ({ s, card: c } = give(s, t.id, def) as { s: GameState; card: Card });
      ids.push(c.id);
    }
    s = reduce(s, { type: 'install', teamId: t.id, cardId: ids[0] });
    s = reduce(s, { type: 'install', teamId: t.id, cardId: ids[1] });
    expect(() => reduce(s, { type: 'install', teamId: t.id, cardId: ids[2] })).toThrow(RuleError);
    s = reduce(s, { type: 'install', teamId: t.id, cardId: ids[2], replaceDef: 'mecanicien' });
    expect(s.teams[0].slots.staff.map((c) => c.def)).toEqual(['soigneur', 'fysio']);
  });

  it('optelling van eigenschappen klopt', () => {
    const p = perksOf(['bakker', 'bank', 'voeding', 'teambus', 'fysio']);
    expect(p.income).toBe(2);
    expect(p.podiumBonus).toBe(3);
    expect(p.startEnergy).toBe(5);
    expect(p.shield).toBe(0);
    expect(p.overtrainTolerance).toBe(1);
  });

  it('sabotage treft één ander team, maximaal één keer per etappe', () => {
    let s = finishDraft(started(3));
    const [a, b] = s.teams;
    let c1: Card;
    let c2: Card;
    ({ s, card: c1 } = give(s, a.id, 'spijkers') as { s: GameState; card: Card });
    ({ s, card: c2 } = give(s, a.id, 'bidon') as { s: GameState; card: Card });
    expect(() => reduce(s, { type: 'sabotage', teamId: a.id, cardId: c1.id, targetTeamId: a.id })).toThrow(RuleError);
    s = reduce(s, { type: 'sabotage', teamId: a.id, cardId: c1.id, targetTeamId: b.id });
    expect(s.teams[1].sabotage).toEqual(['spijkers']);
    expect(() => reduce(s, { type: 'sabotage', teamId: a.id, cardId: c2.id, targetTeamId: b.id })).toThrow(RuleError);
  });
});

describe('ruilen', () => {
  it('ruilt kaarten en munten in één keer', () => {
    let s = finishDraft(started(2));
    const [a, b] = s.teams;
    let ca: Card;
    let cb: Card;
    ({ s, card: ca } = give(s, a.id, 'bakker') as { s: GameState; card: Card });
    ({ s, card: cb } = give(s, b.id, 'rustdag') as { s: GameState; card: Card });
    s = reduce(s, { type: 'offer', teamId: a.id, to: b.id, give: [ca.id], giveCoins: 1, want: ['rustdag'], wantCoins: 0 });
    expect(toPlayerView(s, b.id)!.offersIn[0].giveCards[0].def).toBe('bakker');
    s = reduce(s, { type: 'respond', teamId: b.id, offerId: s.offers[0].id, accept: true });
    const na = s.teams[0];
    const nb = s.teams[1];
    expect(na.hand.some((c) => c.id === cb.id)).toBe(true);
    expect(nb.hand.some((c) => c.id === ca.id)).toBe(true);
    expect(na.coins).toBe(START_COINS - 1);
    expect(nb.coins).toBe(START_COINS + 1);
    expect(na.stats.trades).toBe(1);
  });

  it('weigert voorstellen met kaarten die je niet hebt', () => {
    const s = finishDraft(started(2));
    const [a, b] = s.teams;
    expect(() =>
      reduce(s, { type: 'offer', teamId: a.id, to: b.id, give: [b.hand[0].id], giveCoins: 0, want: [], wantCoins: 0 }),
    ).toThrow(RuleError);
  });

  it('matchDefs vraagt voor elke def een aparte kaart', () => {
    const hand: Card[] = [{ id: 'x', def: 'bakker' }];
    expect(matchDefs(hand, ['bakker'])).toHaveLength(1);
    expect(matchDefs(hand, ['bakker', 'bakker'])).toBeNull();
  });
});

describe('race', () => {
  it('start als iedereen klaar is, niet op volle energie', () => {
    const s = toRace(3);
    expect(s.phase).toBe('race');
    expect(s.round).toBe(1);
    for (const r of s.riders) {
      expect(r.maxEnergy).toBeGreaterThanOrEqual(ENERGY_MIN);
      expect(r.energy).toBeGreaterThan(0);
      // Alleen een renner met een dutje voor de start begint vol.
      if (r.quirk === 'napper') expect(r.energy).toBe(r.maxEnergy);
      else expect(r.energy).toBeLessThan(r.maxEnergy);
    }
  });

  it('Alles geven kost 4 energie, Rustig geeft er 1 terug', () => {
    let s = toRace(2);
    const start = s.riders.map((r) => r.maxEnergy);
    s = lockAll(s, 'alles');
    expect(s.phase).toBe('resolve');
    s.riders.forEach((r, i) => {
      const m = s.report!.moves.find((x) => x.riderId === r.id)!;
      expect(m.effort).toBe('alles');
      const spent = start[i] - r.energy;
      expect(spent).toBeGreaterThanOrEqual(1); // minstens 3 min mogelijke bonussen
    });
    let rest = toRace(2);
    rest.riders.forEach((r) => (r.energy = 3));
    rest = lockAll(rest, 'rustig');
    for (const r of rest.riders) expect(r.energy).toBeGreaterThanOrEqual(3);
  });

  it('rijdt sneller bij Alles geven dan bij Rustig (zelfde renner)', () => {
    const base = toRace(2);
    const fast = lockAll(structuredClone(base), 'alles');
    const slow = lockAll(structuredClone(base), 'rustig');
    const avg = (s: GameState) => s.report!.moves.reduce((n, m) => n + m.to - m.from, 0) / s.report!.moves.length;
    expect(avg(fast)).toBeGreaterThan(avg(slow));
  });

  it('een lege renner moet rustig rijden en is op de fles', () => {
    let s = toRace(2);
    s.riders.forEach((r) => (r.energy = 0));
    s = lockAll(s, 'alles');
    expect(s.report!.moves.every((m) => m.exhausted && m.effort === 'rustig')).toBe(true);
  });

  it('time-out zet niet-ingestuurde teams op Normaal', () => {
    let s = toRace(3);
    s = reduce(s, { type: 'timeout' });
    expect(s.phase).toBe('resolve');
    expect(s.report!.moves.every((m) => m.effort === 'normaal' || m.exhausted)).toBe(true);
  });

  it('een reservefiets vangt precies één pech of val per etappe op', () => {
    let s = finishDraft(started(2));
    let c: Card;
    ({ s, card: c } = give(s, s.teams[0].id, 'reservefiets') as { s: GameState; card: Card });
    s = reduce(s, { type: 'install', teamId: s.teams[0].id, cardId: c.id });
    for (const t of s.teams) s = reduce(s, { type: 'ready', teamId: t.id });
    expect(s.teams[0].raceShield).toBe(1);
  });

  it('aero-wielen en klimfiets geven +1 op hun terrein, behalve als je Rustig rijdt', () => {
    const s = toRace(2);
    const r = s.riders[0];
    const terrainPart = (defs: string[], terrain: 'flat' | 'climb', effort: Effort) =>
      baseParts({ ...s, terrain: s.terrain.map(() => terrain), event: null }, { ...r, quirk: 'socks', pos: 10 }, perksOf(defs), effort, false).terrain;
    for (const effort of ['normaal', 'alles'] as const) {
      expect(terrainPart(['aerowielen'], 'flat', effort) - terrainPart([], 'flat', effort)).toBe(1);
      expect(terrainPart(['klimfiets'], 'climb', effort) - terrainPart([], 'climb', effort)).toBe(1);
    }
    expect(terrainPart(['aerowielen'], 'flat', 'rustig')).toBe(terrainPart([], 'flat', 'rustig'));
    // Een klimfiets helpt niet op vlak terrein.
    expect(terrainPart(['klimfiets'], 'flat', 'alles')).toBe(terrainPart([], 'flat', 'alles'));
  });
});

describe('kopman, knechten en premies', () => {
  it('geeft elk team een kopman en houdt die geheim tot de race', () => {
    const s = finishDraft(started(3));
    for (const t of s.teams) expect(t.riderIds).toContain(s.kopman[t.id]);
    expect(toPublic(s).kopman).toEqual({});
    expect(toPlayerView(s, s.teams[0].id)!.kopmanId).toBe(s.kopman[s.teams[0].id]);
    const raced = toRace(3);
    expect(Object.keys(toPublic(raced).kopman)).toHaveLength(3);
  });

  it('laat je de kopman wijzigen in de voorbereiding, alleen een eigen renner', () => {
    let s = finishDraft(started(3));
    const [a, b] = s.teams;
    const other = a.riderIds.find((id) => id !== s.kopman[a.id])!;
    s = reduce(s, { type: 'kopman', teamId: a.id, riderId: other });
    expect(s.kopman[a.id]).toBe(other);
    expect(() => reduce(s, { type: 'kopman', teamId: a.id, riderId: b.riderIds[0] })).toThrow(RuleError);
  });

  it('een knecht in de buurt helpt: zelf geen tempo, de kopman wel extra beweging', () => {
    const base = toRace(2);
    const team = base.teams[0];
    const kop = base.kopman[team.id];
    const knechten = team.riderIds.filter((id) => id !== kop);
    const efforts: Record<string, Effort> = { [kop]: 'normaal' };
    for (const id of knechten) efforts[id] = 'helpen';
    let s = reduce(base, { type: 'effort', teamId: team.id, efforts });
    const other = s.teams[1];
    s = reduce(s, { type: 'effort', teamId: other.id, efforts: Object.fromEntries(other.riderIds.map((id) => [id, 'normaal'])) });
    const moves = s.report!.moves;
    const domestiques = knechten.filter((id) => base.riders.find((r) => r.id === id)!.type === 'domestique').length;
    expect(moves.find((m) => m.riderId === kop)!.parts.help).toBe(HELP_BONUS * knechten.length + domestiques);
    for (const id of knechten) {
      const m = moves.find((x) => x.riderId === id)!;
      expect(m.helping).toBe(true);
      expect(m.parts.effort).toBe(0);
    }
  });

  it('een knecht die te ver weg rijdt kan niet helpen', () => {
    const s = toRace(2);
    const team = s.teams[0];
    const kop = s.kopman[team.id];
    const knecht = team.riderIds.find((id) => id !== kop)!;
    s.riders.find((r) => r.id === knecht)!.pos = s.riders.find((r) => r.id === kop)!.pos + HELP_RANGE + 1;
    const efforts: Record<string, Effort> = {};
    team.riderIds.forEach((id) => (efforts[id] = id === knecht ? 'helpen' : 'normaal'));
    expect(() => reduce(s, { type: 'effort', teamId: team.id, efforts })).toThrow(RuleError);
  });

  it('de kopman kan zichzelf niet helpen', () => {
    const s = toRace(2);
    const team = s.teams[0];
    const efforts: Record<string, Effort> = {};
    team.riderIds.forEach((id) => (efforts[id] = 'helpen'));
    expect(() => reduce(s, { type: 'effort', teamId: team.id, efforts })).toThrow(RuleError);
  });

  it('plaatst premies op het parcours, ver genoeg van start, finish en elkaar', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = started(2, seed);
      expect(s.premies.length).toBeGreaterThanOrEqual(1);
      for (const p of s.premies) {
        expect(p.pos).toBeGreaterThanOrEqual(8);
        expect(p.pos).toBeLessThanOrEqual(TRACK_LENGTH - 8);
      }
      if (s.premies.length === 2) expect(Math.abs(s.premies[0].pos - s.premies[1].pos)).toBeGreaterThanOrEqual(6);
    }
    expect(makePremies(Array.from({ length: 48 }, () => 'flat' as const), 48)).toHaveLength(1);
  });

  it('deelt premiepunten uit aan de eerste drie renners over de lijn', () => {
    let s = toRace(3);
    const p = s.premies[0];
    // Zet de renners vlak voor de lijn, in een bekende volgorde.
    s.riders.forEach((r, i) => (r.pos = p.pos - 2 - (i % 6)));
    s = lockAll(s, 'alles');
    const hits = s.report!.premies.filter((h) => h.premieId === p.id);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(PREMIE_POINTS.length);
    expect(hits.map((h) => h.points)).toEqual(PREMIE_POINTS.slice(0, hits.length));
    // Nog een ronde: dezelfde premie wordt niet nog eens uitgedeeld.
    const total = s.premies.find((x) => x.id === p.id)!.hits.length;
    expect(total).toBeLessThanOrEqual(3);
  });

  it('kopman en premies tellen mee in de etappeuitslag', () => {
    let s = toRace(2);
    const kop = s.teams.map((t) => s.kopman[t.id]);
    s.riders.forEach((r) => (r.pos = r.id === kop[0] ? TRACK_LENGTH - 1 : 5));
    s.premies = [];
    s = lockAll(s, 'alles');
    s = reduce(s, { type: 'next' });
    expect(s.phase).toBe('results');
    const res = s.stageResult!;
    const first = res.ranking[0];
    expect(first.riderId).toBe(kop[0]);
    expect(first.kopman).toBe(true);
    expect(first.points).toBe(10 * 2);
    const team = res.teams.find((t) => t.kopmanId === kop[0])!;
    expect(team.riderPoints).toBeGreaterThanOrEqual(20);
    expect(team.stagePoints).toBe(team.riderPoints + team.premiePoints);
  });
});

describe('uitslag en seizoen', () => {
  function playStage(s: GameState, rand: () => number): GameState {
    let guard = 0;
    while (s.phase !== 'results' && s.phase !== 'finished' && guard++ < 400) {
      if (s.phase === 'draft') {
        const teamId = s.draft!.order[s.draft!.idx];
        s = reduce(s, { type: 'draftPick', teamId, source: botDraft(s, teamId, rand) });
      } else if (s.phase === 'team') {
        for (const t of s.teams) {
          let step = botStep(s, t.id, rand);
          let n = 0;
          while (step && n++ < 20) {
            s = reduce(s, step);
            step = botStep(s, t.id, rand);
          }
          s = reduce(s, { type: 'ready', teamId: t.id });
        }
      } else if (s.phase === 'race') {
        for (const t of s.teams) s = reduce(s, { type: 'effort', teamId: t.id, efforts: botEfforts(s, t.id, rand) });
      } else if (s.phase === 'resolve') s = reduce(s, { type: 'next' });
    }
    return s;
  }

  it('beloont na een etappe met punten, munten en kaarten, en laat training vervagen', () => {
    const rand = makeRand(5);
    let s = started(4, 11);
    // Geef elke renner wat vorm zodat we het vervagen kunnen zien.
    s.riders.forEach((r) => (r.form.kracht = 3));
    s = playStage(s, rand);
    expect(s.phase).toBe('results');
    const res = s.stageResult!;
    expect(res.ranking).toHaveLength(12);
    expect(res.ranking.filter((x) => x.points > 0)).toHaveLength(6);
    const premiePts = res.premies.flatMap((p) => p.hits).reduce((n, h) => n + h.points, 0);
    const kopmanExtra = res.ranking.filter((x) => x.kopman).reduce((n, x) => n + x.points / 2, 0);
    expect(res.teams.reduce((n, t) => n + t.stagePoints, 0)).toBe(10 + 7 + 5 + 3 + 2 + 1 + kopmanExtra + premiePts);
    expect(res.teams.every((t) => t.prizeCoins >= 1)).toBe(true);
    expect(res.teams.some((t) => t.bonusCards.length > 0)).toBe(true);
    // Vorm is begrensd op 4 en vervaagt na de etappe met 1, dus nooit meer dan 3.
    for (const r of s.riders) expect(r.form.kracht).toBeLessThanOrEqual(3);
    expect(s.teams.reduce((n, t) => n + t.points, 0)).toBe(res.teams.reduce((n, t) => n + t.stagePoints, 0));
    expect(res.stage).toBe(1);
  });

  it('speelt een heel seizoen van 3 etappes uit', () => {
    const rand = makeRand(8);
    let s = started(4, 77);
    for (let stage = 1; stage <= STAGES; stage++) {
      s = playStage(s, rand);
      expect(s.phase).toBe('results');
      expect(s.stage).toBe(stage);
      s = reduce(s, { type: 'nextStage' });
      if (stage < STAGES) expect(s.phase).toBe('draft');
    }
    expect(s.phase).toBe('finished');
    const season = s.season!;
    expect(season.teams).toHaveLength(4);
    expect(season.winnerTeamId).toBe(season.teams[0].teamId);
    expect(season.awards.some((a) => a.title === 'Lanterne Rouge')).toBe(true);
    // Terug naar de lobby met dezelfde teams.
    const again = reduce(s, { type: 'rematch' });
    expect(again.phase).toBe('lobby');
    expect(again.teams).toHaveLength(4);
    expect(again.teams.every((t) => t.points === 0 && t.hand.length === 0)).toBe(true);
  });

  it('de slotetappe telt dubbel (etappe 1 en 2 enkel)', () => {
    expect(STAGE_FACTOR).toEqual([1, 1, 2]);
    const rand = makeRand(8);
    let s = started(4, 77);
    for (let stage = 1; stage <= STAGES; stage++) {
      s = playStage(s, rand);
      const res = s.stageResult!;
      for (const x of res.ranking) {
        const base = POINTS_BY_RANK[x.rank - 1] ?? 0;
        expect(x.points).toBe(base * STAGE_FACTOR[stage - 1] * (x.kopman ? 2 : 1));
      }
      s = reduce(s, { type: 'nextStage' });
    }
  });

  it('in de volgende etappe kiest het laagste team als eerste', () => {
    const rand = makeRand(3);
    let s = started(3, 21);
    s = playStage(s, rand);
    const lowest = [...s.teams].sort((a, b) => a.points - b.points)[0];
    s = reduce(s, { type: 'nextStage' });
    expect(s.stage).toBe(2);
    expect(s.draft!.order[0]).toBeDefined();
    expect(s.teams.find((t) => t.id === s.draft!.order[0])!.points).toBe(lowest.points);
  });
});

describe('informatie verbergen', () => {
  it('de openbare weergave lekt geen handkaarten', () => {
    const s = finishDraft(started(3));
    const pub = JSON.stringify(toPublic(s));
    for (const t of s.teams) for (const c of t.hand) expect(pub).not.toContain(`"${c.id}"`);
    const mine = toPlayerView(s, s.teams[0].id)!;
    expect(mine.hand).toEqual(s.teams[0].hand);
  });
});

describe('acties zijn onveranderlijk', () => {
  it('reduce wijzigt de invoer niet', () => {
    const s = started(3);
    const snap = structuredClone(s);
    const a: Action = { type: 'draftPick', teamId: s.draft!.order[0], source: { kind: 'deck' } };
    reduce(s, a);
    expect(s).toEqual(snap);
  });
});

describe('koerskaarten en volgauto', () => {
  const normal = (ids: string[], e: Effort = 'normaal') => Object.fromEntries(ids.map((id) => [id, e])) as Record<string, Effort>;

  /** Een race in ronde 1 met rustig weer, zodat evenementen de uitkomst niet beïnvloeden. */
  function raceWith(n = 2) {
    const s = toRace(n);
    s.event = { id: 'calm' };
    return s;
  }
  const handCard = (s: GameState, teamId: string, def: string) => s.teams.find((t) => t.id === teamId)!.hand.find((c) => c.def === def)!;
  const riderOf = (s: GameState, id: string) => s.riders.find((r) => r.id === id)!;

  /** Alle teams leggen hun tempo vast; alleen `teamId` doet iets extra. */
  function lockWith(s: GameState, teamId: string, extra: { car?: string | null; plays?: RacePlay[]; effort?: Effort }) {
    let out = s;
    for (const t of s.teams) {
      const e = t.id === teamId ? (extra.effort ?? 'normaal') : 'normaal';
      out = reduce(out, {
        type: 'effort',
        teamId: t.id,
        efforts: normal(t.riderIds, e),
        ...(t.id === teamId ? { car: extra.car, plays: extra.plays } : {}),
      });
    }
    return out;
  }

  it('geeft elke renner aan het begin van een etappe een gratis gel', () => {
    const s = started(3);
    for (const t of s.teams) expect(t.hand.filter((c) => c.def === 'gel')).toHaveLength(RIDERS_PER_TEAM);
  });

  it('een gel geeft direct energie en wordt verbruikt', () => {
    let s = raceWith(2);
    const team = s.teams[0];
    const rider = riderOf(s, team.riderIds[0]);
    rider.energy = 1;
    const gel = handCard(s, team.id, 'gel');
    const handBefore = team.hand.length;
    s = lockWith(s, team.id, { plays: [{ cardId: gel.id, riderId: rider.id }], effort: 'rustig' });
    const after = s.teams[0];
    expect(after.hand).toHaveLength(handBefore - 1);
    expect(after.hand.some((c) => c.id === gel.id)).toBe(false);
    expect(after.stats.items).toBe(1);
    expect(s.report!.plays).toEqual([{ teamId: team.id, riderId: rider.id, item: 'gel' }]);
    const m = s.report!.moves.find((x) => x.riderId === rider.id)!;
    expect(m.item).toBe('gel');
    // 1 + gel, daarna Rustig (+1) en het peloton (+1): niet hoger dan het maximum.
    expect(m.energyAfter).toBe(Math.min(rider.maxEnergy, 1 + GEL_ENERGY + 1 + PELOTON_REST));
  });

  it('een gel kan een lege renner weer vol gas laten geven', () => {
    let s = raceWith(2);
    const team = s.teams[0];
    const rider = riderOf(s, team.riderIds[0]);
    rider.energy = 0;
    const gel = handCard(s, team.id, 'gel');
    s = lockWith(s, team.id, { plays: [{ cardId: gel.id, riderId: rider.id }], effort: 'alles' });
    const m = s.report!.moves.find((x) => x.riderId === rider.id)!;
    expect(m.exhausted).toBe(false);
    expect(m.effort).toBe('alles');
  });

  it('weigert een gel bij volle energie en kaarten die niet van jou zijn', () => {
    const s = raceWith(2);
    const [a, b] = s.teams;
    const full = riderOf(s, a.riderIds[0]);
    full.energy = full.maxEnergy;
    const gel = handCard(s, a.id, 'gel');
    const efforts = normal(a.riderIds);
    expect(() => reduce(s, { type: 'effort', teamId: a.id, efforts, plays: [{ cardId: gel.id, riderId: full.id }] })).toThrow(RuleError);
    expect(() => reduce(s, { type: 'effort', teamId: b.id, efforts: normal(b.riderIds), plays: [{ cardId: gel.id, riderId: b.riderIds[0] }] })).toThrow(RuleError);
  });

  it('een renner gebruikt maximaal één kaart per ronde', () => {
    let s = raceWith(2);
    const team = s.teams[0];
    let c: Card;
    ({ s, card: c } = give(s, team.id, 'cola'));
    const rider = team.riderIds[0];
    const gel = handCard(s, team.id, 'gel');
    riderOf(s, rider).energy = 1;
    expect(() =>
      reduce(s, {
        type: 'effort',
        teamId: team.id,
        efforts: normal(team.riderIds),
        plays: [
          { cardId: gel.id, riderId: rider },
          { cardId: c.id, riderId: rider },
        ],
      }),
    ).toThrow(RuleError);
  });

  it('een cola geeft extra tegels, alleen die ronde', () => {
    let s = raceWith(2);
    const team = s.teams[0];
    let c: Card;
    ({ s, card: c } = give(s, team.id, 'cola'));
    const rider = team.riderIds[0];
    s = lockWith(s, team.id, { plays: [{ cardId: c.id, riderId: rider }] });
    const m = s.report!.moves.find((x) => x.riderId === rider)!;
    expect(m.parts.item).toBe(COLA_BONUS);
    expect(m.item).toBe('cola');
    expect(s.teams[0].hand.some((x) => x.id === c.id)).toBe(false);
    // De volgende ronde is het weg.
    s = reduce(s, { type: 'next' });
    s.event = { id: 'calm' };
    s = lockWith(s, team.id, {});
    expect(s.report!.moves.find((x) => x.riderId === rider)!.parts.item).toBe(0);
  });

  it('een blokkade kost de tegenstander tegels en drafting, binnen bereik', () => {
    let s = raceWith(2);
    const [a, b] = s.teams;
    let c: Card;
    ({ s, card: c } = give(s, a.id, 'blok'));
    const target = b.riderIds[0];
    const by = a.riderIds[0];
    s = lockWith(s, a.id, { plays: [{ cardId: c.id, riderId: by, targetId: target }] });
    const m = s.report!.moves.find((x) => x.riderId === target)!;
    expect(m.parts.item).toBe(-BLOCK_PENALTY);
    expect(m.parts.draft).toBe(0);
    expect(m.blockedBy).toBe(by);
    expect(s.report!.plays[0]).toMatchObject({ item: 'blok', riderId: by, targetRiderId: target });
    expect(s.teams[0].stats.blocks).toBe(1);
  });

  it('blokkeren kan niet buiten bereik of op een eigen renner', () => {
    let s = raceWith(2);
    const [a, b] = s.teams;
    let c: Card;
    ({ s, card: c } = give(s, a.id, 'blok'));
    const by = a.riderIds[0];
    const efforts = normal(a.riderIds);
    expect(() =>
      reduce(s, { type: 'effort', teamId: a.id, efforts, plays: [{ cardId: c.id, riderId: by, targetId: a.riderIds[1] }] }),
    ).toThrow(RuleError);
    riderOf(s, b.riderIds[0]).pos = riderOf(s, by).pos + 4;
    expect(() =>
      reduce(s, { type: 'effort', teamId: a.id, efforts, plays: [{ cardId: c.id, riderId: by, targetId: b.riderIds[0] }] }),
    ).toThrow(RuleError);
    expect(() => reduce(s, { type: 'effort', teamId: a.id, efforts, plays: [{ cardId: c.id, riderId: by }] })).toThrow(RuleError);
  });

  it('twee blokkades op dezelfde renner: de tweede kaart blijft in je hand', () => {
    let s = raceWith(3);
    const [a, b, c3] = s.teams;
    let ca: Card;
    let cb: Card;
    ({ s, card: ca } = give(s, a.id, 'blok'));
    ({ s, card: cb } = give(s, b.id, 'blok'));
    const target = c3.riderIds[0];
    s = reduce(s, { type: 'effort', teamId: a.id, efforts: normal(a.riderIds), plays: [{ cardId: ca.id, riderId: a.riderIds[0], targetId: target }] });
    s = reduce(s, { type: 'effort', teamId: b.id, efforts: normal(b.riderIds), plays: [{ cardId: cb.id, riderId: b.riderIds[0], targetId: target }] });
    s = reduce(s, { type: 'effort', teamId: c3.id, efforts: normal(c3.riderIds) });
    expect(s.report!.plays).toHaveLength(1);
    expect(s.report!.moves.find((x) => x.riderId === target)!.parts.item).toBe(-BLOCK_PENALTY);
    expect(s.teams[1].hand.some((x) => x.id === cb.id)).toBe(true);
  });

  it('de volgauto geeft de gekozen renner energie, meer met een Volgauto-kaart', () => {
    for (const upgraded of [false, true]) {
      let s = toRace(2);
      s.event = { id: 'calm' };
      const team = s.teams[0];
      const car = team.riderIds[0];
      if (upgraded) s.teams[0].slots.car.push({ id: 'v1', def: 'volgauto' });
      riderOf(s, car).maxEnergy = 8;
      riderOf(s, car).energy = 4;
      const without = lockWith(structuredClone(s), team.id, { car: null, effort: 'rustig' });
      const withCar = lockWith(s, team.id, { car, effort: 'rustig' });
      const bonus = upgraded ? CAR_ENERGY_UPGRADED : CAR_ENERGY;
      const e0 = without.report!.moves.find((x) => x.riderId === car)!.energyAfter;
      const e1 = withCar.report!.moves.find((x) => x.riderId === car)!;
      expect(e1.energyAfter).toBe(e0 + bonus);
      expect(e1.car).toBe(true);
      expect(withCar.report!.carRiderIds).toContain(car);
    }
  });

  it('de volgauto moet bij een eigen renner rijden', () => {
    const s = raceWith(2);
    const [a, b] = s.teams;
    expect(() => reduce(s, { type: 'effort', teamId: a.id, efforts: normal(a.riderIds), car: b.riderIds[0] })).toThrow(RuleError);
  });

  it('toont je eigen keuzes terug in je view en wist ze elke ronde', () => {
    let s = raceWith(2);
    const team = s.teams[0];
    const gel = handCard(s, team.id, 'gel');
    riderOf(s, team.riderIds[0]).energy = 1;
    s = reduce(s, {
      type: 'effort',
      teamId: team.id,
      efforts: normal(team.riderIds),
      car: team.riderIds[1],
      plays: [{ cardId: gel.id, riderId: team.riderIds[0] }],
    });
    const v = toPlayerView(s, team.id)!;
    expect(v.car).toBe(team.riderIds[1]);
    expect(v.plays).toHaveLength(1);
    s = lockAll(s, 'normaal');
    s = reduce(s, { type: 'next' });
    expect(s.cars).toEqual({});
    expect(toPlayerView(s, team.id)!.plays).toEqual([]);
  });

  it('bots spelen geldige plannen over een hele etappe', () => {
    const rand = makeRand(7);
    let s = toRace(4, 11);
    let guard = 0;
    let used = 0;
    while ((s.phase === 'race' || s.phase === 'resolve') && guard++ < 200) {
      if (s.phase === 'race') {
        for (const t of s.teams) s = reduce(s, { type: 'effort', teamId: t.id, ...botRacePlan(s, t.id, rand) });
      } else {
        used += s.report!.plays.length;
        s = reduce(s, { type: 'next' });
      }
    }
    expect(s.phase).toBe('results');
    expect(used).toBeGreaterThan(0);
  });
});

describe('rekruteren', () => {
  const ridersOf = (s: GameState, id: string) =>
    s.recruit!.shops[id].filter((x): x is Extract<ShopItem, { kind: 'rider' }> => x.kind === 'rider');
  const contractsOf = (s: GameState, id: string) =>
    s.recruit!.shops[id].filter((x): x is Extract<ShopItem, { kind: 'contract' }> => x.kind === 'contract');

  it('geeft elk team een eigen winkel met negen renners en zes contracten', () => {
    const s = briefed(3);
    expect(s.phase).toBe('recruit');
    expect(s.riders).toHaveLength(0);
    for (const t of s.teams) {
      expect(t.coins).toBe(START_COINS);
      const riders = ridersOf(s, t.id);
      expect(riders).toHaveLength(9);
      expect(new Set(riders.map((r) => r.rider.type)).size).toBe(5);
      expect(riders.filter((r) => r.price === 0).length).toBeGreaterThanOrEqual(3);
      expect(riders.some((r) => r.price === 5)).toBe(true);
      const contracts = contractsOf(s, t.id);
      expect(contracts).toHaveLength(SHOP_CONTRACTS);
      for (const f of ['cash', 'bonus', 'supply'])
        expect(contracts.some((c) => CARD_DEFS[c.def].contract === f)).toBe(true);
    }
    // De winkels delen geen renner en geen naam.
    const ids = s.teams.flatMap((t) => ridersOf(s, t.id).map((x) => x.id));
    expect(new Set(ids).size).toBe(ids.length);
    const names = s.teams.flatMap((t) => ridersOf(s, t.id).map((r) => r.rider.name));
    expect(new Set(names).size).toBe(names.length);
  });

  it('laat teams tegelijk kopen, trekt de prijs af en laat andere winkels ongemoeid', () => {
    let s = briefed(2);
    const [a, b] = s.teams;
    const itemA = ridersOf(s, a.id).find((r) => r.price > 0)!;
    const itemB = ridersOf(s, b.id).find((r) => r.price > 0)!;
    s = reduce(s, { type: 'recruit', teamId: b.id, itemId: itemB.id });
    s = reduce(s, { type: 'recruit', teamId: a.id, itemId: itemA.id });
    expect(s.teams[0].coins).toBe(START_COINS - itemA.price);
    expect(s.teams[1].coins).toBe(START_COINS - itemB.price);
    expect(s.riders.find((r) => r.id === s.teams[0].riderIds[0])!.teamId).toBe(a.id);
    expect(s.recruit!.shops[a.id]).toHaveLength(14);
    expect(s.recruit!.shops[b.id]).toHaveLength(14);
  });

  it('weigert items uit andermans winkel, een vierde renner en onbetaalbare renners', () => {
    let s = briefed(2);
    const [a, b] = s.teams;
    const foreign = ridersOf(s, b.id)[0];
    expect(() => reduce(s, { type: 'recruit', teamId: a.id, itemId: foreign.id })).toThrow(RuleError);
    const poor = structuredClone(s);
    poor.teams[0].coins = 0;
    const dear = ridersOf(poor, a.id).find((r) => r.price > 0)!;
    expect(() => reduce(poor, { type: 'recruit', teamId: a.id, itemId: dear.id })).toThrow(RuleError);
    for (const r of ridersOf(s, a.id).filter((x) => x.price === 0).slice(0, 3))
      s = reduce(s, { type: 'recruit', teamId: a.id, itemId: r.id });
    const fourth = ridersOf(s, a.id)[0];
    expect(() => reduce(s, { type: 'recruit', teamId: a.id, itemId: fourth.id })).toThrow(RuleError);
  });

  it('een contract is gratis, betaalt bij het tekenen uit en past maximaal twee keer', () => {
    let s = briefed(2);
    const t = s.teams[0];
    s = reduce(s, { type: 'recruit', teamId: t.id, itemId: contractsOf(s, t.id)[0].id });
    s = reduce(s, { type: 'recruit', teamId: t.id, itemId: contractsOf(s, t.id)[0].id });
    const team = s.teams[0];
    expect(team.slots.sponsor).toHaveLength(2);
    const signed = team.slots.sponsor.reduce((n, c) => n + (CARD_DEFS[c.def].signing ?? 0), 0);
    expect(team.coins).toBe(START_COINS + signed);
    expect(() => reduce(s, { type: 'recruit', teamId: t.id, itemId: contractsOf(s, t.id)[0].id })).toThrow(RuleError);
  });

  it('klaar vraagt drie renners en blokkeert verder winkelen', () => {
    let s = briefed(2);
    const t = s.teams[0];
    expect(() => reduce(s, { type: 'ready', teamId: t.id })).toThrow(RuleError);
    for (const r of ridersOf(s, t.id).filter((x) => x.price === 0).slice(0, 3))
      s = reduce(s, { type: 'recruit', teamId: t.id, itemId: r.id });
    s = reduce(s, { type: 'ready', teamId: t.id });
    expect(s.phase).toBe('recruit');
    expect(() => reduce(s, { type: 'recruit', teamId: t.id, itemId: contractsOf(s, t.id)[0].id })).toThrow(RuleError);
    s = reduce(s, { type: 'unready', teamId: t.id });
    s = reduce(s, { type: 'recruit', teamId: t.id, itemId: contractsOf(s, t.id)[0].id });
    expect(s.teams[0].slots.sponsor).toHaveLength(1);
  });

  it('gaat naar de namen zodra iedereen klaar is, met drie renners per team', () => {
    const s = finishRecruit(briefed(4));
    expect(s.phase).toBe('draft');
    expect(s.recruit).toBeNull();
    for (const t of s.teams) {
      expect(t.riderIds).toHaveLength(RECRUIT_PICKS);
      expect(s.kopman[t.id]).toBeTruthy();
    }
    expect(s.riders).toHaveLength(4 * RECRUIT_PICKS);
    expect(new Set(s.riders.map((r) => r.name)).size).toBe(s.riders.length);
  });

  it('time-out winkelt automatisch en eindigt de fase', () => {
    let s = briefed(3);
    s = reduce(s, { type: 'timeout' });
    expect(s.phase).toBe('naming');
    for (const t of s.teams) {
      expect(t.riderIds).toHaveLength(RECRUIT_PICKS);
      expect(t.coins).toBeGreaterThanOrEqual(0);
      expect(t.slots.sponsor.length).toBeLessThanOrEqual(2);
    }
  });

  it('een botstap is altijd legaal en eindigt bij klaar', () => {
    const rand = makeRand(5);
    let s = reduce(lobby(2, 3), { type: 'join', name: 'Bot', isBot: true });
    s = reduce(reduce(s, { type: 'start' }), { type: 'briefDone' });
    const bot = s.teams.find((t) => t.isBot)!;
    for (let i = 0; i < 20 && !s.ready[bot.id]; i++) s = reduce(s, botShopStep(s, bot.id, rand)!);
    const team = s.teams.find((t) => t.id === bot.id)!;
    expect(s.ready[bot.id]).toBe(true);
    expect(team.riderIds).toHaveLength(RECRUIT_PICKS);
    expect(team.coins).toBeGreaterThanOrEqual(0);
    expect(botShopStep(s, bot.id, rand)).toBeNull();
  });

  it('een nieuw seizoen begint weer met rekruteren', () => {
    let s = started(2);
    s.phase = 'finished';
    s = reduce(s, { type: 'rematch' });
    expect(s.riders).toHaveLength(0);
    expect(s.teams.every((t) => t.riderIds.length === 0)).toBe(true);
    s = reduce(reduce(s, { type: 'start' }), { type: 'briefDone' });
    expect(s.phase).toBe('recruit');
    expect(s.teams.every((t) => t.coins === START_COINS)).toBe(true);
  });
});

describe('sponsorcontracten', () => {
  /** Team 0 tekent dit contract in de winkel; daarna wordt er verder gerekruteerd tot de draft. */
  const withContract = (def: string): GameState => {
    let s = briefed(3, 8);
    s.recruit!.shops[s.teams[0].id].push({ id: 'c-test', kind: 'contract', def });
    s = reduce(s, { type: 'recruit', teamId: s.teams[0].id, itemId: 'c-test' });
    return finishRecruit(s);
  };
  const count = (s: GameState, i: number, def: string) => s.teams[i].hand.filter((c) => c.def === def).length;

  it('levert in etappe 1 extra gels en cola af', () => {
    const s = withContract('colafabriek');
    expect(count(s, 0, 'cola') - count(s, 1, 'cola')).toBe(1);
    expect(count(s, 0, 'gel') - count(s, 1, 'gel')).toBe(1);
  });

  it('levert bij elke volgende etappe opnieuw', () => {
    let s = withContract('gelfabriek');
    s.phase = 'results';
    s.stageResult = { stage: 1 } as GameState['stageResult'];
    const before = [count(s, 0, 'gel'), count(s, 1, 'gel')];
    s = reduce(s, { type: 'nextStage' });
    expect(s.stage).toBe(2);
    expect(count(s, 0, 'gel') - before[0]).toBe(count(s, 1, 'gel') - before[1] + 2);
  });

  /** Speelt etappe 1 met een kopman van team 0 die wint, en geeft de uitslag. */
  const winStage = (def: string, winner: 0 | 1) => {
    let s = withContract(def);
    s = finishDraft(s);
    for (const t of s.teams) s = reduce(s, { type: 'ready', teamId: t.id });
    const kop = s.teams.map((t) => s.kopman[t.id]);
    s.riders.forEach((r) => (r.pos = r.id === kop[winner] ? TRACK_LENGTH - 1 : 5));
    s.premies = [];
    s = lockAll(s, 'alles');
    s = reduce(s, { type: 'next' });
    return s.stageResult!;
  };

  it('betaalt de bank bij een podium en de energiedrank bij winst', () => {
    expect(winStage('bank', 0).teams[0].sponsorCoins).toBe(1 + 3);
    const d = winStage('drankje', 0).teams[0];
    expect(d.sponsorCoins).toBe(4 + 2);
    const lost = winStage('drankje', 1).teams[0];
    expect(lost.sponsorCoins).toBeLessThanOrEqual(2);
  });

  it('betaalt de omroep per drie etappepunten', () => {
    const r = winStage('omroep', 0).teams[0];
    expect(r.sponsorCoins).toBe(Math.floor(r.stagePoints / 3));
    expect(r.sponsorCoins).toBeGreaterThan(0);
  });
});

describe('weer en valpartijen', () => {
  it('geeft elke etappe een weertype en filtert gebeurtenissen daarop', () => {
    const weathers = new Set<string>();
    for (let seed = 1; seed < 40; seed++) {
      const s = started(2, seed);
      weathers.add(s.weather);
    }
    expect(weathers.size).toBe(3);
    // Onweer alleen bij regen, regen alleen bij wisselvallig weer.
    expect(EVENTS.storm.weather).toEqual(['rain']);
    expect(EVENTS.rain.weather).toEqual(['mixed']);
    expect(EVENT_IDS.length).toBeGreaterThanOrEqual(24);
  });

  it('valkans is hoger bij regen, in afdalingen en bij alles geven', () => {
    const s = toRace(2);
    const r = s.riders[0];
    const perks = perksOf([]);
    const at = (weather: 'dry' | 'mixed' | 'rain', effort: Effort, terrain = 'flat' as const) => {
      const race = { ...s, weather, terrain: s.terrain.map(() => terrain), event: null };
      return crashChance(race, { ...r, quirk: 'socks', pos: 10 }, effort, perks, 0);
    };
    expect(at('rain', 'normaal')).toBeGreaterThan(at('dry', 'normaal'));
    expect(at('dry', 'alles')).toBeGreaterThan(at('dry', 'normaal'));
    expect(at('dry', 'normaal', 'descent' as never)).toBeGreaterThan(at('dry', 'normaal'));
    expect(isWet({ weather: 'rain', event: null })).toBe(true);
    expect(isWet({ weather: 'dry', event: null })).toBe(false);
    // Regenbanden halveren het natte deel.
    const grip = perksOf(['regenbanden']);
    const race = { ...s, weather: 'rain' as const, event: null };
    const slick = crashChance(race, { ...r, quirk: 'socks', pos: 10 }, 'normaal', perks, 0);
    const tyres = crashChance(race, { ...r, quirk: 'socks', pos: 10 }, 'normaal', grip, 0);
    expect(tyres).toBeLessThan(slick);
  });

  it('een val kost tegels en energie, telt mee in de statistieken en kan blessures geven', () => {
    let found = false;
    for (let seed = 1; seed < 400 && !found; seed++) {
      let s = toRace(3, seed);
      s.weather = 'rain';
      s = lockAll(s, 'normaal');
      const fall = s.report!.moves.find((m) => m.crash === 'fall');
      if (!fall) continue;
      found = true;
      const mv = fall;
      expect(mv.parts.crash).toBeLessThan(0);
      expect(mv.parts.crash).toBeGreaterThanOrEqual(-CRASH_LOSS);
      const team = s.teams.find((t) => t.riderIds.includes(mv.riderId))!;
      expect(team.stats.crashes).toBeGreaterThan(0);
      const rider = s.riders.find((r) => r.id === mv.riderId)!;
      expect(rider.fatigue).toBeGreaterThanOrEqual(1);
      expect(mv.shielded).toBe(false);
      // Gevallen en tegelijk pech tellen niet dubbel.
      expect(mv.pech).toBe(false);
    }
    expect(found).toBe(true);
  });

  it('een zware val geeft een blessure voor de volgende etappe, een fysio voorkomt dat', () => {
    let s = toRace(2, 3);
    const hurt = s.riders.find((r) => r.teamId === s.teams[0].id)!;
    const treated = s.riders.find((r) => r.teamId === s.teams[1].id)!;
    hurt.hurt = true;
    treated.hurt = true;
    s.teams[1].slots.staff.push({ id: 'f1', def: 'fysio' });
    // Zet de race op de finish zodat de etappe afloopt.
    s.riders.forEach((r) => (r.pos = s.trackLength - 1));
    s = lockAll(s, 'normaal');
    expect(s.phase).toBe('resolve');
    s = reduce(s, { type: 'next' });
    expect(s.phase).toBe('results');
    const after = (id: string) => s.riders.find((r) => r.id === id)!;
    expect(after(hurt.id).injury).toBe(1);
    expect(after(treated.id).injury).toBe(0);
    expect(s.riders.every((r) => !r.hurt)).toBe(true);
    // Een blessure kost -1 op alles.
    const clean = { ...after(hurt.id), injury: 0 };
    expect(effectiveStats(after(hurt.id), 0).kracht).toBe(Math.max(0, effectiveStats(clean, 0).kracht - 1));
  });
});

describe('peloton, teamwerk en wegrijden', () => {
  it('bepaalt groepen en teamgenoten bij het begin van de ronde', () => {
    const riders = [
      { id: 'a1', teamId: 'a', pos: 0 },
      { id: 'a2', teamId: 'a', pos: 1 },
      { id: 'b1', teamId: 'b', pos: 2 },
      { id: 'c1', teamId: 'c', pos: 9 },
    ];
    const g = groupsOf(riders);
    expect(g.get('a1')).toMatchObject({ size: 3, mates: 1, bottom: 0, top: 2 });
    expect(g.get('b1')).toMatchObject({ size: 3, mates: 0 });
    expect(g.get('c1')).toMatchObject({ size: 1, mates: 0 });
  });

  it('in het peloton rijd je lichter, alleen kost het extra energie', () => {
    const base = toRace(2, 12);
    // Zet één renner ver voor het peloton, de rest blijft samen.
    const s = structuredClone(base);
    s.riders.forEach((r) => (r.pos = 5));
    const lone = s.riders[0];
    lone.pos = 20;
    for (const r of s.riders) r.energy = r.maxEnergy - 2;
    s.event = { id: 'calm' };
    s.eventDeck = [];
    const after = lockAll(s, 'normaal');
    const loneMove = after.report!.moves.find((m) => m.riderId === lone.id)!;
    const packMove = after.report!.moves.find((m) => m.riderId !== lone.id && m.groupSize >= 3)!;
    expect(loneMove.groupSize).toBe(1);
    expect(packMove.groupSize).toBeGreaterThanOrEqual(3);
    // Energie na de ronde, zonder de rustpunten die uit de bevoorrading kunnen komen.
    const loneDelta = loneMove.energyAfter - (lone.maxEnergy - 2);
    const packRider = s.riders.find((r) => r.id === packMove.riderId)!;
    const packDelta = packMove.energyAfter - (packRider.maxEnergy - 2);
    expect(loneDelta).toBeLessThan(packDelta);
  });

  it('teamgenoten in dezelfde groep leveren extra beweging op', () => {
    let s = toRace(2, 5);
    s.riders.forEach((r) => (r.pos = 4));
    s = lockAll(s, 'normaal');
    for (const m of s.report!.moves) {
      const mates = s.riders.filter((r) => r.teamId === s.riders.find((x) => x.id === m.riderId)!.teamId).length - 1;
      expect(m.teammates).toBe(mates);
      expect(m.parts.team).toBe(Math.min(2, mates * TEAM_BONUS));
    }
  });

  it('een groep van het peloton jaagt op ontsnappers', () => {
    let s = toRace(3, 9);
    s.riders.forEach((r, i) => (r.pos = i === 0 ? 30 : 2 + (i % 3)));
    s = lockAll(s, 'rustig');
    const chasing = s.report!.moves.filter((m) => m.groupSize >= 3);
    expect(chasing.length).toBeGreaterThan(0);
    expect(chasing.every((m) => m.parts.chase >= 1)).toBe(true);
  });

  it('een knecht trekt de kopman extra hard mee', () => {
    const base = toRace(2, 8);
    const s = structuredClone(base);
    const team = s.teams[0];
    const kop = s.kopman[team.id];
    const knecht = s.riders.find((r) => r.teamId === team.id && r.id !== kop)!;
    knecht.type = 'domestique';
    const efforts: Record<string, Effort> = { [kop]: 'normaal' };
    for (const id of team.riderIds) if (id !== kop) efforts[id] = id === knecht.id ? 'helpen' : 'normaal';
    let r = reduce(s, { type: 'effort', teamId: team.id, efforts });
    const other = r.teams[1];
    r = reduce(r, { type: 'effort', teamId: other.id, efforts: Object.fromEntries(other.riderIds.map((id) => [id, 'normaal'])) });
    expect(r.report!.moves.find((m) => m.riderId === kop)!.parts.help).toBe(HELP_BONUS * 1 + 1);
  });
});

describe('pech en volgauto', () => {
  it('pech komt vaker voor dan vroeger: ongeveer één op vijf', () => {
    let pech = 0;
    let n = 0;
    for (let seed = 1; seed <= 60; seed++) {
      let s = toRace(3, seed);
      s.weather = 'dry';
      s.event = { id: 'calm' };
      s = lockAll(s, 'normaal');
      for (const m of s.report!.moves) {
        n += 1;
        if (m.pech || m.shielded) pech += 1;
      }
    }
    const rate = pech / n;
    expect(rate).toBeGreaterThan(0.12);
    expect(rate).toBeLessThan(0.32);
  });

  it('de gewone volgauto vangt pech bij die renner op', () => {
    let hit = false;
    for (let seed = 1; seed < 300 && !hit; seed++) {
      let s = toRace(2, seed);
      s.event = { id: 'calm' };
      const team = s.teams[0];
      const car = team.riderIds[0];
      const efforts: Record<string, Effort> = Object.fromEntries(team.riderIds.map((id) => [id, 'normaal'] as const));
      let r = reduce(s, { type: 'effort', teamId: team.id, efforts, car });
      const other = r.teams[1];
      r = reduce(r, { type: 'effort', teamId: other.id, efforts: Object.fromEntries(other.riderIds.map((id) => [id, 'normaal'])) });
      const m = r.report!.moves.find((x) => x.riderId === car)!;
      if (m.shielded && m.car) {
        hit = true;
        expect(m.pech).toBe(false);
      }
    }
    expect(hit).toBe(true);
  });
});

describe('namen geven', () => {
  const named = () => {
    let s = briefed(3, 21);
    for (const t of s.teams) {
      let a = botShopStep(s, t.id, () => 0.5);
      while (a) {
        s = reduce(s, a);
        a = botShopStep(s, t.id, () => 0.5);
      }
    }
    return s;
  };

  it('opent na het rekruteren; draften kan pas daarna, en een time-out houdt de willekeurige namen', () => {
    const s = named();
    expect(s.phase).toBe('naming');
    expect(() => reduce(s, { type: 'draftPick', teamId: s.teams[0].id, source: { kind: 'deck' } })).toThrow(RuleError);
    const after = reduce(s, { type: 'timeout' });
    expect(after.phase).toBe('draft');
    expect(after.riders.map((r) => r.name)).toEqual(s.riders.map((r) => r.name));
  });

  it('past namen van de eigen renners aan en negeert lege namen', () => {
    let s = named();
    const t = s.teams[0];
    const before = s.riders.find((r) => r.id === t.riderIds[1])!.name;
    s = reduce(s, { type: 'nameRiders', teamId: t.id, names: ['  Piet Peddel ', '   ', 'Wout van Weg'] });
    const names = t.riderIds.map((id) => s.riders.find((r) => r.id === id)!.name);
    expect(names).toEqual(['Piet Peddel', before, 'Wout van Weg']);
    // Alleen in deze fase.
    expect(() => reduce(finishNaming(s), { type: 'nameRiders', teamId: t.id, names: ['x'] })).toThrow(RuleError);
  });

  it('gaat naar de draft zodra alle spelers klaar zijn, wijzigen kan tot dan', () => {
    let s = named();
    const [a, b, c] = s.teams;
    s = reduce(s, { type: 'ready', teamId: a.id });
    s = reduce(s, { type: 'ready', teamId: b.id });
    expect(s.phase).toBe('naming');
    s = reduce(s, { type: 'unready', teamId: a.id });
    s = reduce(s, { type: 'ready', teamId: c.id });
    expect(s.phase).toBe('naming');
    s = reduce(s, { type: 'ready', teamId: a.id });
    expect(s.phase).toBe('draft');
    expect(s.ready).toEqual({});
  });

  it('bots zijn meteen klaar', () => {
    let s = reduce(lobby(1, 4), { type: 'join', name: 'Bot', isBot: true });
    s = reduce(reduce(s, { type: 'start' }), { type: 'briefDone' });
    let a = botShopStep(s, s.teams[1].id, () => 0.5);
    while (a) {
      s = reduce(s, a);
      a = botShopStep(s, s.teams[1].id, () => 0.5);
    }
    const human = s.teams[0].id;
    for (const r of s.recruit!.shops[human].filter((x) => x.kind === 'rider' && x.price === 0).slice(0, 3))
      s = reduce(s, { type: 'recruit', teamId: human, itemId: r.id });
    s = reduce(s, { type: 'ready', teamId: human });
    expect(s.phase).toBe('naming');
    expect(toPublic(s).teams.find((t) => t.isBot)!.ready).toBe(true);
    s = reduce(s, { type: 'ready', teamId: s.teams[0].id });
    expect(s.phase).toBe('draft');
  });
});
