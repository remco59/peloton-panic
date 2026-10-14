import { describe, expect, it } from 'vitest';
import { botPlays, createGame, matchSpecs, reduce, toPlayerView, toPublic } from './engine';
import { TRACK_LENGTH } from './types';
import type { Action, GameState } from './types';

function lobby(n: number, seed = 42): GameState {
  let s = createGame(seed);
  for (let i = 0; i < n; i++) s = reduce(s, { type: 'join', name: `P${i + 1}` });
  return s;
}

function started(n = 3, seed = 42): GameState {
  return reduce(lobby(n, seed), { type: 'start' });
}

function lockAllCoasting(s: GameState): GameState {
  for (const t of s.teams) {
    const plays: Record<string, string | null> = {};
    t.riderIds.forEach((id) => (plays[id] = null));
    s = reduce(s, { type: 'play', teamId: t.id, plays });
  }
  return s;
}

describe('lobby and start', () => {
  it('creates teams with 3 riders each and unique colours', () => {
    const s = lobby(4);
    expect(s.teams).toHaveLength(4);
    expect(s.riders).toHaveLength(12);
    expect(new Set(s.teams.map((t) => t.color)).size).toBe(4);
    expect(new Set(s.riders.map((r) => r.name)).size).toBe(12);
  });

  it('refuses to start with one team and to join past 6', () => {
    expect(() => reduce(lobby(1), { type: 'start' })).toThrow();
    expect(() => reduce(lobby(6), { type: 'join', name: 'late' })).toThrow();
  });

  it('deals 6 cards and opens the play phase', () => {
    const s = started(3);
    expect(s.phase).toBe('play');
    expect(s.round).toBe(1);
    expect(s.terrain).toHaveLength(TRACK_LENGTH);
    expect(s.terrain[TRACK_LENGTH - 1]).toBe('flat');
    for (const t of s.teams) expect(t.hand.length).toBeGreaterThanOrEqual(6);
  });

  it('is deterministic for the same seed', () => {
    expect(started(3, 7)).toEqual(started(3, 7));
    expect(started(3, 7).terrain).not.toEqual(started(3, 8).terrain);
  });
});

describe('playing a round', () => {
  it('rejects cards you do not hold and duplicate cards', () => {
    const s = started(2);
    const t = s.teams[0];
    const [r1, r2] = t.riderIds;
    expect(() => reduce(s, { type: 'play', teamId: t.id, plays: { [r1]: 'nope' } })).toThrow();
    const c = t.hand[0].id;
    expect(() => reduce(s, { type: 'play', teamId: t.id, plays: { [r1]: c, [r2]: c } })).toThrow();
  });

  it('resolves when everyone has locked in and never mutates the input', () => {
    const s = started(3);
    const snapshot = structuredClone(s);
    const after = lockAllCoasting(s);
    expect(s).toEqual(snapshot);
    expect(after.phase).toBe('resolve');
    expect(after.report?.moves).toHaveLength(9);
  });

  it('applies the chosen card, discards it and moves the rider', () => {
    let s = started(2);
    const [a, b] = s.teams;
    const rider = a.riderIds[0];
    const best = a.hand.filter((c) => c.kind === 'energy').sort((x, y) => y.value - x.value)[0];
    s = reduce(s, { type: 'play', teamId: a.id, plays: { [rider]: best.id } });
    const coast: Record<string, string | null> = {};
    b.riderIds.forEach((id) => (coast[id] = null));
    s = reduce(s, { type: 'play', teamId: b.id, plays: coast });
    const move = s.report!.moves.find((m) => m.riderId === rider)!;
    expect(move.cardValue).toBe(best.value);
    expect(move.coasted).toBe(false);
    const team = s.teams.find((t) => t.id === a.id)!;
    expect(team.hand.some((c) => c.id === best.id)).toBe(false);
    expect(team.discard.some((c) => c.id === best.id)).toBe(true);
    expect(s.riders.find((r) => r.id === rider)!.pos).toBe(move.to);
  });

  it('the front of a drafting group pays a tired card; followers get +1', () => {
    let s = started(2);
    // Force a clean situation: crosswind off, calm event.
    s.event = { id: 'calm' };
    const [a, b] = s.teams;
    const strong = (t: typeof a) => t.hand.filter((c) => c.kind === 'energy').sort((x, y) => y.value - x.value);
    const pa = { [a.riderIds[0]]: strong(a)[0].id };
    const pb = { [b.riderIds[0]]: strong(b)[0].id };
    s = reduce(s, { type: 'play', teamId: a.id, plays: pa });
    s = reduce(s, { type: 'play', teamId: b.id, plays: pb });
    const moves = s.report!.moves;
    const wind = moves.filter((m) => m.windPaid);
    expect(wind.length).toBeGreaterThan(0);
    const drafted = moves.filter((m) => m.parts.draft === 1);
    expect(drafted.length).toBeGreaterThan(0);
    const totalTired = s.teams.reduce((n, t) => n + t.stats.tired, 0);
    expect(totalTired).toBeGreaterThanOrEqual(wind.length);
  });

  it('timeout auto-coasts teams that did not lock in', () => {
    let s = started(3);
    s = reduce(s, { type: 'timeout' });
    expect(s.phase).toBe('resolve');
    expect(s.report!.moves.every((m) => m.coasted)).toBe(true);
  });
});

describe('phases and finishing', () => {
  it('goes play -> resolve -> trade -> play with a refreshed hand', () => {
    let s = started(2);
    s = lockAllCoasting(s);
    s = reduce(s, { type: 'next' });
    expect(s.phase).toBe('trade');
    s = reduce(s, { type: 'tradeReady', teamId: s.teams[0].id });
    expect(s.phase).toBe('trade');
    s = reduce(s, { type: 'tradeReady', teamId: s.teams[1].id });
    expect(s.phase).toBe('play');
    expect(s.round).toBe(2);
    for (const t of s.teams) expect(t.hand.length).toBeGreaterThanOrEqual(6);
  });

  it('plays a whole stage with bots to a finished result', () => {
    let s = started(4, 1234);
    let guard = 0;
    let seed = 99;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    while (s.phase !== 'finished' && guard++ < 200) {
      if (s.phase === 'play') {
        for (const t of s.teams)
          s = reduce(s, { type: 'play', teamId: t.id, plays: botPlays(s, t.id, rand) });
      } else if (s.phase === 'resolve') s = reduce(s, { type: 'next' });
      else if (s.phase === 'trade') s = reduce(s, { type: 'timeout' });
    }
    expect(s.phase).toBe('finished');
    expect(guard).toBeLessThan(60); // a stage should be roughly 8-20 rounds
    const r = s.results!;
    expect(r.ranking).toHaveLength(12);
    expect(r.ranking[0].rank).toBe(1);
    expect(r.teams).toHaveLength(4);
    expect(r.awards.some((a) => a.title === 'Lanterne Rouge')).toBe(true);
    // Points: only the top six riders score.
    expect(r.ranking.filter((x) => x.points > 0)).toHaveLength(6);
    // Rematch returns to the lobby with the same teams.
    const again = reduce(s, { type: 'rematch' });
    expect(again.phase).toBe('lobby');
    expect(again.teams).toHaveLength(4);
    expect(again.riders.every((x) => x.pos === 0)).toBe(true);
  });
});

describe('trading', () => {
  function tradeState(): GameState {
    let s = started(2, 5);
    s = lockAllCoasting(s);
    return reduce(s, { type: 'next' });
  }

  it('swaps cards atomically when the target can match the request', () => {
    let s = tradeState();
    const [a, b] = s.teams;
    const give = a.hand[0];
    const wantCard = b.hand.find((c) => c.kind === 'energy')!;
    s = reduce(s, {
      type: 'offer',
      teamId: a.id,
      to: b.id,
      give: [give.id],
      want: [{ kind: wantCard.kind, value: wantCard.value }],
    });
    expect(s.offers).toHaveLength(1);
    expect(toPlayerView(s, b.id)!.offersIn).toHaveLength(1);
    s = reduce(s, { type: 'respond', teamId: b.id, offerId: s.offers[0].id, accept: true });
    const na = s.teams.find((t) => t.id === a.id)!;
    const nb = s.teams.find((t) => t.id === b.id)!;
    expect(na.hand.some((c) => c.id === give.id)).toBe(false);
    expect(nb.hand.some((c) => c.id === give.id)).toBe(true);
    expect(na.hand.some((c) => c.id === wantCard.id)).toBe(true);
    expect(na.stats.trades).toBe(1);
    expect(nb.stats.trades).toBe(1);
    expect(s.offers).toHaveLength(0);
  });

  it('rejects offers for cards you do not hold and out-of-phase trades', () => {
    const s = tradeState();
    const [a, b] = s.teams;
    const bad: Action = { type: 'offer', teamId: a.id, to: b.id, give: [b.hand[0].id], want: [] };
    expect(() => reduce(s, bad)).toThrow();
    const playing = started(2);
    expect(() =>
      reduce(playing, { type: 'offer', teamId: a.id, to: b.id, give: [], want: [{ kind: 'energy', value: 1 }] }),
    ).toThrow();
  });

  it('matchSpecs needs distinct cards for each spec', () => {
    const hand = [{ id: 'x', kind: 'energy' as const, value: 3 }];
    expect(matchSpecs(hand, [{ kind: 'energy', value: 3 }])).toHaveLength(1);
    expect(
      matchSpecs(hand, [
        { kind: 'energy', value: 3 },
        { kind: 'energy', value: 3 },
      ]),
    ).toBeNull();
  });
});

describe('information hiding', () => {
  it('the public view never leaks hands, decks or contracts before the end', () => {
    const s = started(3);
    const pub = JSON.stringify(toPublic(s));
    for (const t of s.teams) for (const c of t.hand) expect(pub).not.toContain(`"${c.id}"`);
    expect(pub).not.toContain('loneWolf');
    expect(toPublic(s).contractsRevealed).toBeNull();
    expect(toPlayerView(s, s.teams[0].id)!.hand).toEqual(s.teams[0].hand);
  });
});
