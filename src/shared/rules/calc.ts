// Berekeningen (ook door de telefoon gebruikt) en hulpfuncties.

import { CARD_DEFS, EFFORTS, EVENTS } from '../content';
import type { Perk } from '../content';
import { CRASH_ALL_OUT, CRASH_BASE, CRASH_COBBLES, CRASH_CROWD, CRASH_DESCENT, CRASH_WET, ENERGY_BASE, ENERGY_MIN, ENERGY_PER_UITHOUDING, GROUP_GAP, OVERTRAIN_FREE, STAT_FACTOR } from '../types';
import type { Card, Effort, GameState, MoveParts, PublicState, Rider, SlotKind, Stat, Stats, Team, Terrain, Weather } from '../types';
import { RuleError, STAT_KEYS, ZERO } from './base';

// ---- Berekeningen (ook door de telefoon gebruikt) ----------------------------

/** Telt de eigenschappen van alle spullen van een team bij elkaar op. */
export function perksOf(defIds: string[]): Required<Perk> {
  const total: Required<Perk> = {
    income: 0,
    podiumBonus: 0,
    winBonus: 0,
    pointBonus: 0,
    gels: 0,
    colas: 0,
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
    wetGrip: 0,
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

/** Een zware val werkt door in de volgende etappe: daar is de renner -1 op alles. */
export function injuryPenalty(r: Pick<Rider, 'injury'>): number {
  return r.injury > 0 ? 1 : 0;
}

export function effectiveStats(r: Rider, tolerance: number): Stats {
  const pen = overtrainPenalty(r, tolerance) + injuryPenalty(r);
  const out = { ...ZERO };
  for (const k of STAT_KEYS) out[k] = Math.max(0, r.base[k] + r.form[k] - pen);
  return out;
}

export function maxEnergyFor(r: Rider, perks: Required<Perk>, bidon: boolean): number {
  const stats = effectiveStats(r, perks.overtrainTolerance);
  return Math.max(ENERGY_MIN, ENERGY_BASE + ENERGY_PER_UITHOUDING * stats.uithouding + perks.startEnergy - (bidon ? 3 : 0));
}

/** Renners starten niet vol: zo loont het om onderweg te sparen (Rustig rijden). Voeding/teambus tellen wel volledig mee. */
export const START_ENERGY_FRACTION = 0.6;

export function startEnergyFor(maxEnergy: number, perks: Required<Perk>, napper = false): number {
  if (napper) return maxEnergy;
  const base = Math.max(0, maxEnergy - perks.startEnergy);
  return Math.min(maxEnergy, Math.ceil(base * START_ENERGY_FRACTION) + perks.startEnergy);
}

export type RaceView = Pick<PublicState, 'terrain' | 'trackLength' | 'event'> & { weather?: Weather };

export const WET_TERRAIN: Partial<Record<Terrain, number>> = { descent: -1, cobbles: -1 };

/** Nat wegdek door het weer van de etappe of door een bui. */
export function isWet(race: Pick<RaceView, 'weather' | 'event'>): boolean {
  return race.weather === 'rain' || race.event?.id === 'rain' || race.event?.id === 'storm';
}

export interface GroupInfo {
  size: number; // renners in deze groep
  mates: number; // teamgenoten van deze renner in dezelfde groep
  bottom: number; // positie van de laatste renner in de groep
  top: number; // positie van de eerste renner in de groep
}

/** Groepen aan het begin van een ronde: renners met hooguit GROUP_GAP tegels ertussen rijden samen. */
export function groupsOf(riders: Pick<Rider, 'id' | 'teamId' | 'pos'>[]): Map<string, GroupInfo> {
  const sorted = [...riders].sort((a, b) => a.pos - b.pos);
  const groups: (typeof sorted)[] = [];
  for (const r of sorted) {
    const cur = groups[groups.length - 1];
    if (cur && r.pos - cur[cur.length - 1].pos <= GROUP_GAP) cur.push(r);
    else groups.push([r]);
  }
  const out = new Map<string, GroupInfo>();
  for (const g of groups) {
    const bottom = g[0].pos;
    const top = g[g.length - 1].pos;
    for (const r of g) {
      out.set(r.id, { size: g.length, mates: g.filter((x) => x.teamId === r.teamId && x.id !== r.id).length, bottom, top });
    }
  }
  return out;
}

/** Kans (in procenten) dat deze renner deze ronde valt. */
export function crashChance(
  race: RaceView,
  rider: Rider,
  effort: Effort,
  perks: Pick<Required<Perk>, 'wetGrip'>,
  neighbours: number,
): number {
  const terrain = terrainAt(race, rider.pos);
  const ev = race.event ? EVENTS[race.event.id] : null;
  // Het natte deel van de kans: regenbanden of een regenkoning halveren dat.
  let wet = race.weather === 'rain' ? CRASH_WET : race.weather === 'mixed' ? 2 : 0;
  wet += ev?.crashBonus ?? 0;
  if (perks.wetGrip > 0 && isWet(race)) wet = Math.floor(wet / 2);
  if (rider.quirk === 'rainKing' && isWet(race)) wet = Math.floor(wet / 2);
  let c = CRASH_BASE + wet;
  if (terrain === 'descent') c += CRASH_DESCENT;
  if (terrain === 'cobbles') c += CRASH_COBBLES;
  if (effort === 'alles') c += CRASH_ALL_OUT;
  c += Math.min(4, Math.max(0, neighbours - 2) * CRASH_CROWD);
  if (rider.quirk === 'clumsy') c += 4;
  if (rider.quirk === 'daredevil') c += 3;
  return Math.min(40, c);
}

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
  // Regen over de hele etappe: dezelfde straf als de bui, tenzij je renner regenbanden heeft.
  if (race.weather === 'rain' && perks.wetGrip === 0) terr += WET_TERRAIN[terrain] ?? 0;
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
    case 'daredevil':
      quirk = terrain === 'descent' ? 1 : 0;
      break;
    case 'rainKing':
      quirk = isWet(race) ? 1 : 0;
      break;
    case 'sugarCube':
      quirk = isWet(race) ? -1 : 0;
      break;
  }

  let event = 0;
  const ev = race.event;
  if (ev) {
    const def = EVENTS[ev.id];
    const g = def.global ?? 0;
    event += g < 0 && rider.quirk === 'windHardened' ? 0 : g;
    const t = def.terrain?.[terrain] ?? 0;
    event += t < 0 && perks.wetGrip > 0 && ev.id === 'rain' ? 0 : t;
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
    help: 0,
    item: 0,
    team: 0,
    crash: 0,
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
  // Een helpende knecht rijdt qua energie als Normaal; zijn eigen beweging laat hij liggen.
  let effort: Effort = chosen === 'helpen' ? 'normaal' : chosen;
  if (effort === 'alles' && energy < allesCost(perks)) effort = 'normaal';
  if (effort === 'normaal' && energy < 1) effort = 'rustig';
  return { effort, exhausted: energy <= 0 && chosen !== 'rustig' };
}

export function sumParts(p: MoveParts): number {
  return Math.max(
    0,
    p.effort + p.stat + p.terrain + p.quirk + p.event + p.luck + p.tired + p.draft + p.chase + p.help + p.item + p.team + p.crash,
  );
}

// ---- Hulpfuncties ------------------------------------------------------------

export function teamOf(s: GameState, teamId: string): Team {
  const t = s.teams.find((x) => x.id === teamId);
  if (!t) throw new RuleError('Onbekend team');
  return t;
}

export function riderOf(s: GameState, riderId: string): Rider {
  const r = s.riders.find((x) => x.id === riderId);
  if (!r) throw new RuleError('Onbekende renner');
  return r;
}

export function perksOfTeam(team: Team): Required<Perk> {
  return perksOf(teamDefIds(team.slots));
}

export function leaderRider(riders: Rider[]): Rider {
  return riders.reduce((best, r) => (r.pos > best.pos ? r : best), riders[0]);
}

export function takeFromHand(team: Team, cardId: string): Card {
  const i = team.hand.findIndex((c) => c.id === cardId);
  if (i < 0) throw new RuleError('Je hebt die kaart niet');
  return team.hand.splice(i, 1)[0];
}

export function currentDraftTeam(s: GameState): string | null {
  return s.draft && s.draft.idx < s.draft.order.length ? s.draft.order[s.draft.idx] : null;
}
