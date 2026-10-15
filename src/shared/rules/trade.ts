// Ruilen tussen teams.

import type { Action, Card, GameState } from '../types';
import { RuleError } from './base';
import { teamOf } from './calc';

// ---- Ruilen ------------------------------------------------------------------

export function offer(s: GameState, a: Extract<Action, { type: 'offer' }>): GameState {
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

export function respond(s: GameState, teamId: string, offerId: string, accept: boolean): GameState {
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
