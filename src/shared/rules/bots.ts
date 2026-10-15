// Bots.

import { CARD_DEFS } from '../content';
import { BLIND_COST, GEL_ENERGY, PREMIE_POINTS, SLOT_LIMITS, TRAININGS_PER_RIDER } from '../types';
import type { Action, Effort, GameState, PickSource, RaceItem, RacePlay, Rider, SlotKind, Stat } from '../types';
import { perksOfTeam, riderOf, teamDefIds, teamOf } from './calc';
import { bestKopman, canBlock, canHelp } from './lobby';
import { stageFit } from './setup';

// ---- Bots --------------------------------------------------------------------

export const BOT_PRIORITY: Record<string, number> = {
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

export { TEAM_COLORS } from '../content';
