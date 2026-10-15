// Rekruteren: de eigen winkel per team.

import { CARD_DEFS, CONTRACT_LIST, RIDER_NAME_POOL, RIDER_TYPE_LIST, RIDER_TYPES, TALENT_TIERS } from '../content';
import type { CardDef } from '../content';
import { pick, shuffle } from '../rng';
import { RECRUIT_PICKS, SHOP_CONTRACTS, SLOT_LIMITS } from '../types';
import type { Action, GameState, Rider, RiderType, ShopItem, Stat, Stats, Team } from '../types';
import { QUIRK_IDS, RuleError, ZERO } from './base';
import { perksOfTeam, riderOf, teamOf } from './calc';
import { bestKopman } from './lobby';
import { newCard, stageFit } from './setup';

// ---- Rekruteren --------------------------------------------------------------

export const TYPE_MAIN: Record<RiderType, Stat> = {
  sprinter: 'sprint',
  climber: 'klim',
  rouleur: 'kracht',
  puncheur: 'kracht',
  domestique: 'uithouding',
};
export const TYPE_EXTRA: Record<RiderType, Stat> = {
  sprinter: 'kracht',
  climber: 'uithouding',
  rouleur: 'uithouding',
  puncheur: 'klim',
  domestique: 'kracht',
};

/** Wat de leveranciers van dit team aan het begin van een etappe afleveren: extra gels en cola's. */
export function deliverSupplies(s: GameState, team: Team): void {
  const perks = perksOfTeam(team);
  for (let i = 0; i < perks.gels; i++) team.hand.push(newCard(s, 'gel'));
  for (let i = 0; i < perks.colas; i++) team.hand.push(newCard(s, 'cola'));
}

/** Een nieuwe renner voor een winkel, met de eigenschappen van zijn type en talentniveau. */
export function makeShopRider(s: GameState, type: RiderType, tier: (typeof TALENT_TIERS)[number], taken: Set<string>): ShopItem {
  const base: Stats = { ...RIDER_TYPES[type].base };
  base[TYPE_MAIN[type]] = Math.max(1, base[TYPE_MAIN[type]] + tier.main);
  base[TYPE_EXTRA[type]] += tier.extra;
  const names = RIDER_NAME_POOL.filter((n) => !taken.has(n));
  const n = s.nextRiderId++;
  const name = names.length > 0 ? pick(s, names) : `Renner ${n}`;
  taken.add(name);
  const rider: Rider = {
    id: `cand${n}`,
    teamId: '',
    name,
    type,
    quirk: pick(s, QUIRK_IDS),
    pos: 0,
    base,
    form: { ...ZERO },
    fatigue: 0,
    trained: 0,
    energy: 0,
    maxEnergy: 0,
    injury: 0,
    hurt: false,
  };
  return { id: rider.id, kind: 'rider', price: tier.price, rider };
}

/**
 * De winkel van één team: negen renners (alle vijf de types, drie gratis neo-profs, één ster) en zes
 * sponsorcontracten (van elke soort minstens één). Elk team krijgt zijn eigen aanbod.
 */
export function makeShop(s: GameState, taken: Set<string>): ShopItem[] {
  const tiers = TALENT_TIERS.flatMap((t) => Array.from({ length: t.count }, () => t));
  const extra = shuffle(s, RIDER_TYPE_LIST).slice(0, Math.max(0, tiers.length - RIDER_TYPE_LIST.length));
  const types = shuffle(s, [...RIDER_TYPE_LIST, ...extra]);
  const riders = tiers.map((tier, i) => makeShopRider(s, types[i], tier, taken));

  const families: ('cash' | 'bonus' | 'supply')[] = ['cash', 'bonus', 'supply'];
  const chosen: CardDef[] = [];
  for (const f of families) {
    const d = pick(s, CONTRACT_LIST.filter((c) => c.contract === f));
    chosen.push(d);
  }
  const rest = shuffle(s, CONTRACT_LIST.filter((c) => !chosen.includes(c)));
  while (chosen.length < SHOP_CONTRACTS && rest.length > 0) chosen.push(rest.pop()!);
  const contracts: ShopItem[] = chosen.map((d) => ({ id: `contract-${d.id}`, kind: 'contract', def: d.id }));
  return [...riders, ...contracts];
}

export function startRecruit(s: GameState): void {
  const taken = new Set(s.riders.map((r) => r.name));
  const shops: Record<string, ShopItem[]> = {};
  for (const t of s.teams) shops[t.id] = makeShop(s, taken);
  s.recruit = { shops };
  s.ready = {};
  s.phase = 'recruit';
}

export function recruitBuy(s: GameState, teamId: string, itemId: string): GameState {
  if (s.phase !== 'recruit' || !s.recruit) throw new RuleError('Er wordt nu niet gerekruteerd');
  const team = teamOf(s, teamId);
  if (s.ready[teamId]) throw new RuleError('Je staat op klaar: haal dat weg om nog te winkelen');
  const shop = s.recruit.shops[teamId] ?? [];
  const i = shop.findIndex((x) => x.id === itemId);
  if (i < 0) throw new RuleError('Dat ligt niet in jouw winkel');
  const item = shop[i];
  if (item.kind === 'rider') {
    if (team.riderIds.length >= RECRUIT_PICKS) throw new RuleError(`Je hebt al ${RECRUIT_PICKS} renners`);
    if (item.price > team.coins) throw new RuleError(`${item.rider.name} kost ${item.price} munten en dat heb je niet`);
    team.coins -= item.price;
    const rider: Rider = { ...item.rider, id: `${teamId}r${team.riderIds.length + 1}`, teamId };
    s.riders.push(rider);
    team.riderIds.push(rider.id);
  } else {
    if (team.slots.sponsor.length >= SLOT_LIMITS.sponsor)
      throw new RuleError(`Je hebt al ${SLOT_LIMITS.sponsor} sponsors: meer passen er niet op je shirt`);
    team.coins += CARD_DEFS[item.def].signing ?? 0;
    team.slots.sponsor.push(newCard(s, item.def));
  }
  shop.splice(i, 1);
  return s;
}

export function endRecruit(s: GameState): void {
  s.recruit = null;
  for (const t of s.teams) {
    s.kopman[t.id] = bestKopman(s, t);
    // Etappe 1: de leveranciers leveren nu hun eerste lading af.
    if (s.stage === 1) deliverSupplies(s, t);
  }
  // Eerst de renners een naam geven: geen timer, iedereen drukt op klaar. Bots zijn meteen klaar.
  s.phase = 'naming';
  s.ready = Object.fromEntries(s.teams.filter((t) => t.isBot).map((t) => [t.id, true]));
  if (s.teams.every((t) => s.ready[t.id])) endNaming(s);
}

export function endNaming(s: GameState): void {
  s.ready = {};
  s.phase = 'draft';
}

export function nameRiders(s: GameState, teamId: string, names: string[]): GameState {
  if (s.phase !== 'naming') throw new RuleError('Je geeft je renners een naam na het rekruteren');
  const team = teamOf(s, teamId);
  team.riderIds.forEach((id, i) => {
    const n = (names[i] ?? '').trim().slice(0, 20);
    if (n) riderOf(s, id).name = n;
  });
  return s;
}

/** Grof geschat: wat is dit contract de speler in munten waard over een seizoen? */
export function contractValue(d: CardDef): number {
  const p = d.perk ?? {};
  return (
    (d.signing ?? 0) +
    (p.income ?? 0) * 2.5 +
    (p.podiumBonus ?? 0) * 0.8 +
    (p.winBonus ?? 0) * 0.6 +
    (p.pointBonus ?? 0) * 5.5 +
    (p.gels ?? 0) * 3 +
    (p.colas ?? 0) * 3 +
    (p.service ?? 0) * 3 +
    (p.startEnergy ?? 0) * 1.5 +
    (p.shield ?? 0) * 2.5 +
    (p.pechReduction ?? 0) * 2 +
    (p.fatigueRecover ?? 0) * 1.5 +
    (p.overtrainTolerance ?? 0) * 1 +
    (p.restBonus ?? 0) * 2
  );
}

/**
 * De volgende stap van een bot (of de automatische piloot bij een time-out) in de winkel:
 * eerst de beste contracten tekenen, dan de renners kiezen, dan klaar. Null als er niets meer te doen is.
 */
export function botShopStep(s: GameState, teamId: string, rand: () => number): Action | null {
  const team = teamOf(s, teamId);
  const shop = s.recruit?.shops[teamId] ?? [];
  if (s.phase !== 'recruit' || s.ready[teamId]) return null;

  // 1. Contracten: de waardevolste eerst. Direct geld vergroot meteen je budget voor renners.
  if (team.slots.sponsor.length < SLOT_LIMITS.sponsor) {
    const best = shop
      .filter((x): x is Extract<ShopItem, { kind: 'contract' }> => x.kind === 'contract')
      .map((x) => ({ x, v: contractValue(CARD_DEFS[x.def]) + rand() * 2 }))
      .sort((a, b) => b.v - a.v)[0];
    if (best) return { type: 'recruit', teamId, itemId: best.x.id };
  }

  // 2. Renners: wat past bij het parcours, met een mix van types in de ploeg.
  if (team.riderIds.length < RECRUIT_PICKS) {
    const owned = team.riderIds.map((id) => riderOf(s, id));
    const picksLeft = RECRUIT_PICKS - owned.length;
    let bestId: string | null = null;
    let bestScore = -Infinity;
    for (const x of shop) {
      if (x.kind !== 'rider' || x.price > team.coins) continue;
      const sameType = owned.some((r) => r.type === x.rider.type);
      // Hou iets over voor kaarten en voor de renners die nog moeten komen.
      const left = team.coins - x.price;
      const reserve = 1 + Math.max(0, picksLeft - 1);
      const score =
        stageFit(x.rider, s.terrain, 0) +
        x.rider.base.uithouding * 0.2 -
        x.price * 0.35 +
        (sameType ? -1.2 : 0.4) -
        (left < reserve ? 0.6 : 0) +
        rand() * 0.8;
      if (score > bestScore) {
        bestScore = score;
        bestId = x.id;
      }
    }
    if (bestId) return { type: 'recruit', teamId, itemId: bestId };
  }
  if (team.riderIds.length >= RECRUIT_PICKS) return { type: 'ready', teamId };
  return null;
}
