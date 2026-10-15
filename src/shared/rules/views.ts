// Weergaven: publieke toestand en spelerweergave.

import { RECRUIT_PICKS, SLOT_LIMITS } from '../types';
import type { Card, Effort, GameState, Offer, OfferView, PlayerView, PublicState } from '../types';
import { currentDraftTeam } from './calc';

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

export function withCards(s: GameState, o: Offer): OfferView {
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
