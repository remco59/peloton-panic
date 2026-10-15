// Draft en winkel.

import { CARD_DEFS } from '../content';
import { randInt } from '../rng';
import { BLIND_COST, FATIGUE_CAP, FORM_CAP, SLOT_LIMITS, TRAININGS_PER_RIDER } from '../types';
import type { Card, GameState, PickSource, SlotKind } from '../types';
import { RuleError, STAT_KEYS } from './base';
import { currentDraftTeam, riderOf, takeFromHand, teamOf } from './calc';
import { drawCard, refillMarket } from './setup';

// ---- Draft en winkel ---------------------------------------------------------

export function takeFromSource(s: GameState, source: PickSource): { card: Card; fromMarket: boolean; index: number } {
  if (source.kind === 'market') {
    const card = s.market[source.index];
    if (!card) throw new RuleError('Die kaart ligt er niet meer');
    return { card, fromMarket: true, index: source.index };
  }
  const card = drawCard(s);
  if (!card) throw new RuleError('De stapel is leeg');
  return { card, fromMarket: false, index: -1 };
}

export function draftPick(s: GameState, teamId: string, source: PickSource): GameState {
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

export function advanceDraft(s: GameState): void {
  if (!s.draft) return;
  s.draft.idx += 1;
  if (s.draft.idx >= s.draft.order.length) {
    s.phase = 'team';
    s.ready = {};
    s.offers = [];
  }
}

export function autoPick(s: GameState, teamId: string): void {
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

export function buy(s: GameState, teamId: string, source: PickSource): GameState {
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

export function train(s: GameState, teamId: string, cardId: string, riderId: string): GameState {
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

export function install(s: GameState, teamId: string, cardId: string, replaceDef?: string): GameState {
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

export function sabotage(s: GameState, teamId: string, cardId: string, targetTeamId: string): GameState {
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
