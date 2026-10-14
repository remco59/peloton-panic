import { describe, expect, it } from 'vitest';
import {
  botDraft,
  botEfforts,
  botStep,
  createGame,
  effectiveStats,
  matchDefs,
  overtrainPenalty,
  perksOf,
  reduce,
  RuleError,
  toPlayerView,
  toPublic,
} from './engine';
import { BLIND_COST, MARKET_SIZE, START_COINS, STAGES, TRACK_LENGTH } from './types';
import type { Action, Card, Effort, GameState } from './types';

function lobby(n: number, seed = 42): GameState {
  let s = createGame(seed);
  for (let i = 0; i < n; i++) s = reduce(s, { type: 'join', name: `P${i + 1}` });
  return s;
}

const started = (n = 3, seed = 42) => reduce(lobby(n, seed), { type: 'start' });

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
  it('maakt teams met 3 renners, unieke kleuren en startmunten', () => {
    const s = lobby(4);
    expect(s.teams).toHaveLength(4);
    expect(s.riders).toHaveLength(12);
    expect(new Set(s.teams.map((t) => t.color)).size).toBe(4);
    expect(s.teams.every((t) => t.coins === START_COINS)).toBe(true);
  });

  it('weigert starten met 1 team en een 7e team', () => {
    expect(() => reduce(lobby(1), { type: 'start' })).toThrow(RuleError);
    expect(() => reduce(lobby(6), { type: 'join', name: 'laat' })).toThrow(RuleError);
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

describe('draft', () => {
  it('laat alleen het team aan de beurt kiezen en vult de markt aan', () => {
    let s = started(3);
    const first = s.draft!.order[0];
    const other = s.teams.find((t) => t.id !== first)!.id;
    expect(() => reduce(s, { type: 'draftPick', teamId: other, source: { kind: 'market', index: 0 } })).toThrow(RuleError);
    const picked = s.market[0].def;
    s = reduce(s, { type: 'draftPick', teamId: first, source: { kind: 'market', index: 0 } });
    expect(s.teams.find((t) => t.id === first)!.hand[0].def).toBe(picked);
    expect(s.market).toHaveLength(MARKET_SIZE);
    expect(s.draft!.idx).toBe(1);
  });

  it('gaat na alle keuzes door naar de teamfase', () => {
    const s = finishDraft(started(3));
    expect(s.phase).toBe('team');
    for (const t of s.teams) expect(t.hand).toHaveLength(2);
  });

  it('time-out kiest automatisch voor het team aan de beurt', () => {
    let s = started(2);
    s = reduce(s, { type: 'timeout' });
    expect(s.draft!.idx).toBe(1);
    expect(s.teams.reduce((n, t) => n + t.hand.length, 0)).toBe(1);
  });
});

describe('winkel, training en spullen', () => {
  it('koopt blind voor 2 en uit de markt voor de prijs', () => {
    let s = finishDraft(started(2));
    const t = s.teams[0];
    const coins = t.coins;
    s = reduce(s, { type: 'buy', teamId: t.id, source: { kind: 'deck' } });
    expect(s.teams[0].coins).toBe(coins - BLIND_COST);
    expect(s.teams[0].hand).toHaveLength(3);
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
    expect(p.income).toBe(5);
    expect(p.startEnergy).toBe(4);
    expect(p.descent).toBe(1);
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
  it('start als iedereen klaar is, met volle energie', () => {
    const s = toRace(3);
    expect(s.phase).toBe('race');
    expect(s.round).toBe(1);
    for (const r of s.riders) {
      expect(r.energy).toBe(r.maxEnergy);
      expect(r.maxEnergy).toBeGreaterThanOrEqual(4);
    }
  });

  it('Alles geven kost 3 energie, Rustig geeft er 1 terug', () => {
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

  it('een reservefiets vangt pech op', () => {
    let s = finishDraft(started(2));
    let c: Card;
    ({ s, card: c } = give(s, s.teams[0].id, 'reservefiets') as { s: GameState; card: Card });
    s = reduce(s, { type: 'install', teamId: s.teams[0].id, cardId: c.id });
    for (const t of s.teams) s = reduce(s, { type: 'ready', teamId: t.id });
    expect(s.teams[0].raceShield).toBe(1);
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
    expect(res.teams.reduce((n, t) => n + t.stagePoints, 0)).toBe(10 + 7 + 5 + 3 + 2 + 1);
    expect(res.teams.every((t) => t.prizeCoins >= 1)).toBe(true);
    expect(res.teams.some((t) => t.bonusCards.length > 0)).toBe(true);
    // Vorm is begrensd op 4 en vervaagt na de etappe met 1, dus nooit meer dan 3.
    for (const r of s.riders) expect(r.form.kracht).toBeLessThanOrEqual(3);
    expect(s.teams.reduce((n, t) => n + t.points, 0)).toBe(28);
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
