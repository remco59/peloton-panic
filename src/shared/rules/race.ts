// De race: tempo, groepen, pech, valpartijen en afhandeling per ronde.

import { CARD_DEFS, EFFORTS, EVENT_IDS, EVENTS } from '../content';
import type { Perk } from '../content';
import { pick, randInt, shuffle } from '../rng';
import { ALONE_COST, ALONE_MOVE, BLOCK_PENALTY, BLOCK_RANGE, CAR_ENERGY, CAR_ENERGY_UPGRADED, CHASE_FAR, CHASE_GAP, CHASE_NEAR, COLA_BONUS, CRASH_ENERGY, CRASH_LOSS, DOMINO_CHANCE, DOMINO_LOSS, DOMINO_RANGE, DRAFT_BIG, FATIGUE_CAP, GEL_ENERGY, HELP_BONUS, PECH_CHANCE, PELOTON_MIN, PELOTON_REST, PREMIE_POINTS, TEAM_BONUS, TEAM_BONUS_MAX } from '../types';
import type { ActiveEvent, Effort, EventId, GameState, MoveParts, PlayHit, PremieHit, RaceItem, RacePlay, ResolveReport, Rider, RiderMove, Team } from '../types';
import { RuleError } from './base';
import { allesCost, baseParts, crashChance, groupsOf, isWet, leaderRider, maxEnergyFor, perksOfTeam, resolveEffort, riderOf, startEnergyFor, sumParts, teamOf, terrainAt } from './calc';
import type { GroupInfo } from './calc';
import { canBlock, canHelp } from './lobby';
import { finishStage } from './results';

// ---- Race --------------------------------------------------------------------

export function startRace(s: GameState): void {
  s.offers = [];
  s.round = 0;
  for (const team of s.teams) {
    const perks = perksOfTeam(team);
    const bidon = team.sabotage.includes('bidon');
    team.raceShield = perks.shield;
    for (const id of team.riderIds) {
      const r = riderOf(s, id);
      r.maxEnergy = maxEnergyFor(r, perks, bidon);
      r.energy = startEnergyFor(r.maxEnergy, perks, r.quirk === 'napper');
    }
  }
  startRound(s);
}

export function drawEvent(s: GameState): void {
  if (s.eventDeck.length === 0) {
    // Het weer van de etappe bepaalt welke omstandigheden kunnen voorkomen.
    const ids: EventId[] = EVENT_IDS.filter((id) => {
      const only = EVENTS[id].weather;
      return !only || only.includes(s.weather);
    });
    s.eventDeck = shuffle(s, ids);
  }
  const id = s.eventDeck.pop()!;
  const def = EVENTS[id];
  const ev: ActiveEvent = { id };
  if (def.target === 'leader') ev.targetRiderId = leaderRider(s.riders).id;
  if (def.target === 'randomRider') ev.targetRiderId = pick(s, s.riders).id;
  if (def.target === 'randomTeam') ev.targetTeamId = pick(s, s.teams).id;
  s.event = ev;
}

export function startRound(s: GameState): void {
  s.round += 1;
  drawEvent(s);
  s.efforts = {};
  s.cars = {};
  s.plays = {};
  s.locked = {};
  s.phase = 'race';
}

export function setEfforts(
  s: GameState,
  teamId: string,
  efforts: Record<string, Effort>,
  car?: string | null,
  plays?: RacePlay[],
): GameState {
  if (s.phase !== 'race') throw new RuleError('Nu kies je geen tempo');
  const team = teamOf(s, teamId);
  for (const id of team.riderIds) {
    const e = efforts[id] ?? 'normaal';
    if (!(e in EFFORTS)) throw new RuleError('Onbekend tempo');
    if (e === 'helpen') {
      if (s.kopman[teamId] === id) throw new RuleError('Je kopman kan zichzelf niet helpen');
      if (!canHelp(s, riderOf(s, id))) throw new RuleError('Die knecht rijdt te ver van je kopman om te helpen');
    }
    s.efforts[id] = e;
  }

  // Volgauto: bij welke renner rijdt hij deze ronde?
  if (car) {
    if (!team.riderIds.includes(car)) throw new RuleError('De volgauto rijdt bij een renner van je eigen team');
    s.cars[teamId] = car;
  } else delete s.cars[teamId];

  // Racekaarten: één per renner, elke kaart één keer. Ze blijven in je hand tot de ronde wordt gereden.
  const usedCards = new Set<string>();
  const usedRiders = new Set<string>();
  const planned: RacePlay[] = [];
  for (const p of plays ?? []) {
    const card = team.hand.find((c) => c.id === p.cardId);
    const item = card ? CARD_DEFS[card.def].race : undefined;
    if (!card || !item) throw new RuleError('Dat is geen racekaart');
    if (usedCards.has(card.id)) throw new RuleError('Elke kaart speel je één keer');
    const rider = riderOf(s, p.riderId);
    if (rider.teamId !== teamId) throw new RuleError('Dat is jouw renner niet');
    if (usedRiders.has(rider.id)) throw new RuleError('Eén racekaart per renner per ronde');
    if (item === 'gel' && rider.energy >= rider.maxEnergy) throw new RuleError(`${rider.name} heeft al volle energie`);
    let targetId: string | undefined;
    if (item === 'blok') {
      const target = p.targetId ? riderOf(s, p.targetId) : null;
      if (!target || !canBlock(rider, target))
        throw new RuleError(`Je kunt alleen een tegenstander binnen ${BLOCK_RANGE} tegels blokkeren`);
      targetId = target.id;
    }
    usedCards.add(card.id);
    usedRiders.add(rider.id);
    planned.push({ cardId: card.id, riderId: rider.id, ...(targetId ? { targetId } : {}) });
  }
  s.plays[teamId] = planned;
  s.locked[teamId] = true;
  if (s.teams.every((t) => s.locked[t.id])) resolveRound(s);
  return s;
}

export function resolveRound(s: GameState): void {
  const prevLeader = leaderRider(s.riders);
  const sortedPos = s.riders.map((r) => r.pos).sort((a, b) => a - b);
  const median = sortedPos[Math.floor(sortedPos.length / 2)];
  const noDraft = s.event ? !!EVENTS[s.event.id].noDraft : false;
  const ev = s.event ? EVENTS[s.event.id] : null;

  // Knechten die helpen: ze rijden rustig en trekken de kopman van hun team mee. Een echte knecht trekt harder.
  const helping = new Set<string>();
  const helpers = new Map<string, number>();
  const domestiqueHelp = new Map<string, number>();
  for (const r of s.riders) {
    if (s.efforts[r.id] !== 'helpen' || !canHelp(s, r)) continue;
    helping.add(r.id);
    helpers.set(r.teamId, (helpers.get(r.teamId) ?? 0) + 1);
    if (r.type === 'domestique') domestiqueHelp.set(r.teamId, (domestiqueHelp.get(r.teamId) ?? 0) + 1);
  }

  // Racekaarten en volgauto's: wat komt er van de plannen terecht? Kaarten worden hier verbruikt.
  const itemOf = new Map<string, RaceItem>(); // riderId -> kaart die hij gebruikt
  const blockedBy = new Map<string, string>(); // geblokkeerde renner -> blokkerende knecht
  const playHits: PlayHit[] = [];
  for (const team of s.teams) {
    for (const p of s.plays[team.id] ?? []) {
      const idx = team.hand.findIndex((c) => c.id === p.cardId);
      const item = idx >= 0 ? CARD_DEFS[team.hand[idx].def].race : undefined;
      const user = s.riders.find((r) => r.id === p.riderId && r.teamId === team.id);
      if (!item || !user || itemOf.has(user.id)) continue;
      let target: Rider | undefined;
      if (item === 'blok') {
        target = s.riders.find((r) => r.id === p.targetId);
        // Een renner die al geblokkeerd wordt, kan niet nog eens worden dichtgeknepen: kaart blijft in je hand.
        if (!target || !canBlock(user, target) || blockedBy.has(target.id)) continue;
        blockedBy.set(target.id, user.id);
        team.stats.blocks += 1;
      }
      if (item === 'gel') user.energy = Math.min(user.maxEnergy, user.energy + GEL_ENERGY);
      itemOf.set(user.id, item);
      s.discard.push(team.hand.splice(idx, 1)[0]);
      team.stats.items += 1;
      playHits.push({ teamId: team.id, riderId: user.id, item, ...(target ? { targetRiderId: target.id } : {}) });
    }
  }
  const carOf = new Set<string>();
  for (const team of s.teams) {
    const id = s.cars[team.id];
    if (id && team.riderIds.includes(id)) carOf.add(id);
  }

  interface Work {
    rider: Rider;
    index: number;
    effort: Effort;
    parts: MoveParts;
    roll: number;
    pech: boolean;
    shielded: boolean;
    boost: boolean;
    crash: 'none' | 'fall' | 'domino';
    injured: boolean;
    exhausted: boolean;
    target: number;
    cluster: number;
    front: boolean;
  }

  // Wie rijdt met wie: groepen aan het begin van de ronde, voor teamwerk, jacht, valkans en energie.
  const groups = groupsOf(s.riders);
  const smallAhead = (g: GroupInfo): GroupInfo | null => {
    let near: GroupInfo | null = null;
    for (const o of groups.values()) {
      if (o.size >= PELOTON_MIN || o.bottom <= g.top) continue;
      if (!near || o.bottom < near.bottom) near = o;
    }
    return near;
  };
  const pelotonGap = (g: GroupInfo): number => {
    if (g.size < PELOTON_MIN) return 0;
    const ahead = smallAhead(g);
    return ahead ? ahead.bottom - g.top : 0;
  };
  const wet = isWet(s);
  const noPech = !!ev?.noPech;

  // Eerste ronde van lot: pech, val en meevaller. Een val is meestal een kwestie van pech met een kop.
  interface Pre {
    rider: Rider;
    index: number;
    team: Team;
    perks: Required<Perk>;
    effort: Effort;
    exhausted: boolean;
    parts: MoveParts;
    roll: number;
    fell: boolean;
  }
  const pre: Pre[] = s.riders.map((rider, index) => {
    const team = teamOf(s, rider.teamId);
    const perks = perksOfTeam(team);
    const asked: Effort = s.efforts[rider.id] === 'helpen' ? 'normaal' : (s.efforts[rider.id] ?? 'normaal');
    const { effort, exhausted } = resolveEffort(rider.energy, perks, asked);
    const parts = baseParts(s, rider, perks, effort, exhausted);
    const g = groups.get(rider.id)!;
    if (helping.has(rider.id) && !exhausted) parts.effort = 0;
    if (rider.pos <= median - CHASE_GAP) parts.chase = 2;
    const gap = pelotonGap(g);
    if (gap > 0) parts.chase = Math.max(parts.chase, gap >= CHASE_FAR ? 3 : gap >= CHASE_NEAR ? 2 : 0);
    if (g.mates > 0 && !helping.has(rider.id)) parts.team = Math.min(TEAM_BONUS_MAX, g.mates * TEAM_BONUS);
    if (s.kopman[rider.teamId] === rider.id) parts.help = HELP_BONUS * (helpers.get(rider.teamId) ?? 0) + (domestiqueHelp.get(rider.teamId) ?? 0);
    if (itemOf.get(rider.id) === 'cola') parts.item += COLA_BONUS;
    if (blockedBy.has(rider.id)) parts.item -= BLOCK_PENALTY;
    const roll = randInt(s, 10) + 1;
    const neighbours = s.riders.filter((o) => o.id !== rider.id && Math.abs(o.pos - rider.pos) <= 1).length;
    const fell = randInt(s, 100) < crashChance(s, rider, effort, perks, neighbours);
    return { rider, index, team, perks, effort, exhausted, parts, roll, fell };
  });
  // Domino: wie vlak naast of achter een gevallen renner rijdt, kan meevallen.
  const domino = new Set<string>();
  for (const c of pre.filter((p) => p.fell)) {
    for (const p of pre) {
      if (p.fell || domino.has(p.rider.id) || Math.abs(p.rider.pos - c.rider.pos) > DOMINO_RANGE) continue;
      if (randInt(s, 100) < DOMINO_CHANCE + (wet ? 20 : 0)) domino.add(p.rider.id);
    }
  }

  const work: Work[] = pre.map((p) => {
    const { rider, index, team, perks, effort, exhausted, parts, roll } = p;
    const threshold = Math.min(
      6,
      PECH_CHANCE + (team.sabotage.includes('spijkers') ? 1 : 0) + (ev?.pechBonus ?? 0),
    );
    const pechAt = rider.quirk === 'lucky' ? Math.max(1, Math.ceil(threshold / 2)) : threshold;
    let pech = false;
    let shielded = false;
    let boost = false;
    let crash: Work['crash'] = 'none';
    let injured = false;
    if (p.fell || domino.has(rider.id)) {
      if (team.raceShield > 0) {
        // De reservefiets en een snelle monteur maken van een val een kleine hindernis.
        team.raceShield -= 1;
        shielded = true;
      } else {
        crash = p.fell ? 'fall' : 'domino';
        const serviced = carOf.has(rider.id) && perks.service > 0 ? 2 : 0;
        const loss = p.fell ? CRASH_LOSS : DOMINO_LOSS;
        parts.crash = -Math.max(1, loss - perks.pechReduction - serviced);
        team.stats.crashes += 1;
        if (p.fell) {
          rider.fatigue = Math.min(FATIGUE_CAP, rider.fatigue + 1);
          const severe = 35 + (wet ? 20 : 0) + (terrainAt(s, rider.pos) === 'descent' ? 15 : 0);
          if (randInt(s, 100) < severe) {
            rider.hurt = true;
            injured = true;
          }
        }
      }
    } else if (!noPech && roll <= pechAt) {
      if (carOf.has(rider.id)) {
        // De volgauto rijdt precies bij deze renner en is er meteen bij.
        shielded = true;
      } else if (team.raceShield > 0) {
        team.raceShield -= 1;
        shielded = true;
      } else {
        pech = true;
        parts.luck = -Math.max(1, 3 - perks.pechReduction);
      }
    } else if (roll === 10) {
      boost = true;
      parts.luck = 1;
    }
    const raw = sumParts(parts);
    return {
      rider,
      index,
      effort,
      parts,
      roll,
      pech,
      crash,
      injured,
      shielded,
      boost,
      exhausted,
      target: rider.pos + raw,
      cluster: 0,
      front: false,
    };
  });

  // Groepen: kettingen met gaten van hooguit 1 tegel. Volgers draften, de kop betaalt de wind.
  const order = [...work].sort((a, b) => b.target - a.target || a.index - b.index);
  let cluster = -1;
  let prevTarget = Infinity;
  for (const w of order) {
    if (prevTarget - w.target > 1) {
      cluster++;
      w.front = true;
    }
    w.cluster = cluster;
    prevTarget = w.target;
  }
  const size = new Map<number, number>();
  for (const w of work) size.set(w.cluster, (size.get(w.cluster) ?? 0) + 1);

  const moves: RiderMove[] = [];
  for (const w of work) {
    let windPaid = false;
    if (!noDraft) {
      if (!w.front && !blockedBy.has(w.rider.id)) w.parts.draft = (size.get(w.cluster) ?? 1) >= PELOTON_MIN ? DRAFT_BIG : 1;
      else if (w.effort !== 'rustig' && ((size.get(w.cluster) ?? 1) >= 2 || w.cluster === 0)) windPaid = true;
      // Echt alleen rijden is zwaar: geen wiel, en de wind komt van voren (niet in een afdaling).
      if (w.front && (size.get(w.cluster) ?? 1) === 1 && !helping.has(w.rider.id) && terrainAt(s, w.rider.pos) !== 'descent')
        w.parts.draft = -ALONE_MOVE;
    }
    const rider = w.rider;
    const team = teamOf(s, rider.teamId);
    const perks = perksOfTeam(team);
    const from = rider.pos;
    const to = from + sumParts(w.parts);

    // Energie bijwerken.
    let delta = EFFORTS[w.effort].energy;
    if (w.effort === 'rustig') delta += perks.restBonus + (rider.quirk === 'croissant' ? 1 : 0);
    if (w.effort === 'alles') {
      delta = -allesCost(perks);
      team.stats.alles += 1;
    }
    if (windPaid) delta -= 1;
    const g = groups.get(rider.id)!;
    if (!w.exhausted) {
      // Lichter in het peloton, zwaarder alleen. Teamgenoten in je groep geven een extra duwtje.
      // Vol gas blijft vol gas: de voordelen gelden voor rustig en normaal rijden.
      if (g.size >= PELOTON_MIN) {
        if (w.effort !== 'alles') delta += PELOTON_REST;
      } else if (w.effort !== 'rustig') delta -= ALONE_COST;
    }
    if (w.crash === 'fall') delta -= CRASH_ENERGY;
    if (w.crash === 'domino') delta -= 1;
    if (carOf.has(rider.id)) delta += perks.service > 0 ? CAR_ENERGY_UPGRADED : CAR_ENERGY;
    if (ev?.energyAll) delta += ev.energyAll;
    if (s.event?.targetRiderId === rider.id && ev?.targetEnergy) delta += ev.targetEnergy;
    rider.energy = Math.max(0, Math.min(rider.maxEnergy, rider.energy + delta));
    if (w.exhausted) team.stats.exhausted += 1;
    if (helping.has(rider.id)) team.stats.helps += 1;

    moves.push({
      riderId: rider.id,
      from,
      to,
      terrain: terrainAt(s, from),
      effort: w.effort,
      parts: w.parts,
      roll: w.roll,
      windPaid,
      exhausted: w.exhausted,
      pech: w.pech,
      crash: w.crash,
      injured: w.injured,
      groupSize: g.size,
      teammates: g.mates,
      shielded: w.shielded,
      boost: w.boost,
      car: carOf.has(rider.id),
      item: itemOf.get(rider.id) ?? null,
      blockedBy: blockedBy.get(rider.id) ?? null,
      helping: helping.has(rider.id),
      energyAfter: rider.energy,
      clusterIndex: w.cluster,
    });
  }
  for (const m of moves) riderOf(s, m.riderId).pos = m.to;

  // Premies: wie de lijn deze ronde passeert, scoort. Verder voorbij de lijn gaat voor.
  const premieHits: PremieHit[] = [];
  for (const p of s.premies) {
    const crossers = moves
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.from < p.pos && m.to >= p.pos)
      .sort((a, b) => b.m.to - a.m.to || a.i - b.i);
    for (const { m } of crossers) {
      if (p.hits.length >= PREMIE_POINTS.length) break;
      const hit = { riderId: m.riderId, points: PREMIE_POINTS[p.hits.length] };
      p.hits.push(hit);
      premieHits.push({ premieId: p.id, ...hit });
      teamOf(s, riderOf(s, m.riderId).teamId).stats.premies += hit.points;
    }
  }

  const leader = leaderRider(s.riders);
  teamOf(s, leader.teamId).stats.roundsLed += 1;
  s.report = {
    round: s.round,
    moves,
    premies: premieHits,
    plays: playHits,
    carRiderIds: [...carOf],
    leaderRiderId: leader.id,
    prevLeaderRiderId: prevLeader.id,
    finished: s.riders.some((r) => r.pos >= s.trackLength),
  } satisfies ResolveReport;
  s.phase = 'resolve';
}

export function afterResolve(s: GameState): void {
  if (s.report?.finished) finishStage(s);
  else startRound(s);
}
