// Uitslag en beloning.

import { KOPMAN_FACTOR, POINT_BONUS_STEP, POINTS_BY_RANK, STAGE_FACTOR, STAGES, START_COINS } from '../types';
import type { Award, GameState, Team } from '../types';
import { RuleError, STAT_KEYS } from './base';
import { perksOfTeam, teamOf } from './calc';
import { beginStage } from './lobby';
import { drawCard } from './setup';

// ---- Uitslag en beloning -----------------------------------------------------

export function finishStage(s: GameState): void {
  const ordered = s.riders.map((r, i) => ({ r, i })).sort((a, b) => b.r.pos - a.r.pos || a.i - b.i);
  const rankOf = new Map<string, number>();
  ordered.forEach((x, i) => rankOf.set(x.r.id, i + 1));
  // De slotetappe telt dubbel, zodat het seizoen tot het einde spannend blijft.
  const factor = STAGE_FACTOR[s.stage - 1] ?? 1;
  const isKopman = (riderId: string) => Object.values(s.kopman).includes(riderId);
  const ranking = ordered.map((x, i) => {
    const kopman = isKopman(x.r.id);
    return {
      riderId: x.r.id,
      rank: i + 1,
      points: (POINTS_BY_RANK[i] ?? 0) * factor * (kopman ? KOPMAN_FACTOR : 1),
      kopman,
    };
  });

  const results = s.teams.map((t) => {
    const mine = ranking.filter((x) => t.riderIds.includes(x.riderId));
    const riderPoints = mine.reduce((sum, x) => sum + x.points, 0);
    const premiePoints = s.premies
      .flatMap((p) => p.hits)
      .filter((h) => t.riderIds.includes(h.riderId))
      .reduce((sum, h) => sum + h.points * factor, 0);
    const stagePoints = riderPoints + premiePoints;
    const best = Math.min(...mine.map((x) => x.rank));
    const perks = perksOfTeam(t);
    const prizeCoins = best === 1 ? 3 : best <= 3 ? 2 : 1;
    const sponsorCoins =
      perks.income + (best <= 3 ? perks.podiumBonus : 0) + Math.floor(stagePoints / POINT_BONUS_STEP) * perks.pointBonus;
    return {
      teamId: t.id,
      kopmanId: s.kopman[t.id],
      riderPoints,
      premiePoints,
      stagePoints,
      prizeCoins,
      sponsorCoins,
      bonusCards: [] as string[],
      totalPoints: 0,
      best,
    };
  });

  // Bonuskaarten en inhaalhulp: de etappewinnaar krijgt 1 kaart, de laagste in het klassement
  // 2 kaarten en 2 munten, de een-na-laagste 1 kaart. Zo blijft achterliggen te winnen.
  const give = (teamId: string, n: number) => {
    const x = results.find((r) => r.teamId === teamId)!;
    for (let k = 0; k < n; k++) {
      const c = drawCard(s);
      if (c) {
        teamOf(s, teamId).hand.push(c);
        x.bonusCards.push(c.def);
      }
    }
  };
  const byPoints = [...results].sort((a, b) => b.stagePoints - a.stagePoints || a.best - b.best);
  const lastRiderTeam = ordered[ordered.length - 1].r.teamId;
  give(byPoints[0].teamId, 1);
  // Sponsors die betalen voor winst: de etappewinnaar (de meeste punten) krijgt zijn bonus.
  const winner = results.find((r) => r.teamId === byPoints[0].teamId)!;
  winner.sponsorCoins += perksOfTeam(teamOf(s, winner.teamId)).winBonus;
  const standing = [...s.teams]
    .map((t) => ({ t, total: t.points + (results.find((r) => r.teamId === t.id)?.stagePoints ?? 0) }))
    .sort((a, b) => a.total - b.total || a.t.coins - b.t.coins);
  give(standing[0].t.id, 2);
  results.find((r) => r.teamId === standing[0].t.id)!.prizeCoins += 2;
  if (standing.length >= 4) give(standing[1].t.id, 1);

  for (const x of results) {
    const t = teamOf(s, x.teamId);
    t.coins += x.prizeCoins + x.sponsorCoins;
    t.points += x.stagePoints;
    x.totalPoints = t.points;
  }

  // Fade en herstel.
  for (const r of s.riders) {
    const perks = perksOfTeam(teamOf(s, r.teamId));
    for (const k of STAT_KEYS) r.form[k] = Math.max(0, r.form[k] - 1);
    r.fatigue = Math.max(0, r.fatigue - 1 - perks.fatigueRecover);
    r.trained = 0;
    // Een zware val werkt door in de volgende etappe, tenzij een fysio hem er meteen bovenop zet.
    r.injury = r.hurt && perks.fatigueRecover === 0 ? 1 : 0;
    r.hurt = false;
  }
  s.teams.forEach((t) => {
    t.sabotage = [];
  });

  s.stageResult = {
    stage: s.stage,
    ranking,
    premies: s.premies,
    teams: results.map(({ best: _best, ...rest }) => rest),
    lanterneRougeTeamId: lastRiderTeam,
    sabotages: s.sabotageLog,
  };
  s.phase = 'results';
}

export function afterResults(s: GameState): void {
  if (s.stage >= STAGES) finishSeason(s);
  else beginStage(s);
}

export function finishSeason(s: GameState): void {
  const sorted = [...s.teams].sort((a, b) => b.points - a.points || b.coins - a.coins);
  const winner = sorted[0];
  const lantern = sorted[sorted.length - 1];
  const awards: Award[] = [];
  const top = (f: (t: Team) => number) => [...s.teams].sort((a, b) => f(b) - f(a))[0];
  const led = top((t) => t.stats.roundsLed);
  if (led.stats.roundsLed > 0)
    awards.push({ title: 'Meest aanvallend', teamId: led.id, blurb: `${led.stats.roundsLed} rondes aan kop van de race.` });
  const alles = top((t) => t.stats.alles);
  if (alles.stats.alles > 0)
    awards.push({ title: 'Vol gas', teamId: alles.id, blurb: `${alles.stats.alles} keer Alles geven.` });
  const trainer = top((t) => t.stats.trainings);
  if (trainer.stats.trainings > 0)
    awards.push({ title: 'Beste voorbereiding', teamId: trainer.id, blurb: `${trainer.stats.trainings} trainingen gedaan.` });
  const trader = top((t) => t.stats.trades);
  if (trader.stats.trades > 0)
    awards.push({ title: 'Handelaar', teamId: trader.id, blurb: `${trader.stats.trades} ruilen afgerond.` });
  const hamer = top((t) => t.stats.exhausted);
  if (hamer.stats.exhausted > 0)
    awards.push({ title: 'Man met de hamer', teamId: hamer.id, blurb: `${hamer.stats.exhausted} keer op de fles.` });
  const helper = top((t) => t.stats.helps);
  if (helper.stats.helps > 0)
    awards.push({ title: 'Beste knechten', teamId: helper.id, blurb: `${helper.stats.helps} keer de kopman meegetrokken.` });
  const blocker = top((t) => t.stats.blocks);
  if (blocker.stats.blocks > 0)
    awards.push({ title: 'Dwarsligger', teamId: blocker.id, blurb: `${blocker.stats.blocks} keer een tegenstander dichtgeknepen.` });
  const premie = top((t) => t.stats.premies);
  if (premie.stats.premies > 0)
    awards.push({ title: 'Premiejager', teamId: premie.id, blurb: `${premie.stats.premies} punten bij sprints en bergen.` });
  const faller = top((t) => t.stats.crashes);
  if (faller.stats.crashes > 0)
    awards.push({ title: 'Pechvogel', teamId: faller.id, blurb: `${faller.stats.crashes} keer onderuit gegaan. Je bent altijd welkom op de grond.` });
  const rich = top((t) => t.coins);
  awards.push({ title: 'Spaarvarken', teamId: rich.id, blurb: `${rich.coins} munten over.` });
  awards.push({ title: 'Lanterne Rouge', teamId: lantern.id, blurb: 'Laatste in het klassement. Draag de rode lantaarn met trots.' });
  s.season = {
    teams: sorted.map((t) => ({ teamId: t.id, points: t.points, coins: t.coins })),
    winnerTeamId: winner.id,
    lanterneRougeTeamId: lantern.id,
    awards,
  };
  s.phase = 'finished';
}

export function rematch(s: GameState): GameState {
  if (s.phase !== 'finished') throw new RuleError('Het seizoen is nog niet voorbij');
  s.phase = 'lobby';
  s.briefing = null;
  s.kopman = {};
  s.premies = [];
  s.round = 0;
  s.stage = 0;
  s.terrain = [];
  s.event = null;
  s.eventDeck = [];
  s.deck = [];
  s.discard = [];
  s.market = [];
  s.draft = null;
  s.ready = {};
  s.efforts = {};
  s.cars = {};
  s.plays = {};
  s.locked = {};
  s.offers = [];
  s.report = null;
  s.stageResult = null;
  s.season = null;
  s.sabotageLog = [];
  s.riders = [];
  s.recruit = null;
  s.weather = 'dry';
  s.teams.forEach((t) => {
    t.riderIds = [];
    t.hand = [];
    t.slots = { sponsor: [], staff: [], material: [], car: [] };
    t.coins = START_COINS;
    t.points = 0;
    t.sabotage = [];
    t.stats = { roundsLed: 0, trades: 0, trainings: 0, alles: 0, exhausted: 0, sabotages: 0, helps: 0, premies: 0, items: 0, blocks: 0, crashes: 0 };
  });
  return s;
}
