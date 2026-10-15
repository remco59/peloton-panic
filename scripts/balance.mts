// Balans-simulatie: speelt honderden seizoenen met verschillende bot-strategieën en
// rapporteert of voorbereiding loont, of overtraining straft en hoe lang etappes duren.
//
//   npx tsx scripts/balance.mts [aantal seizoenen]

import { CARD_DEFS } from '../src/shared/content';
import {
  botDraft,
  botEfforts,
  botShopStep,
  botRacePlan,
  botStep,
  canHelp,
  createGame,
  overtrainPenalty,
  perksOf,
  reduce,
  stageFit,
  teamDefIds,
} from '../src/shared/engine';
import { SLOT_LIMITS, STAGE_FACTOR, STAGES, TRAININGS_PER_RIDER } from '../src/shared/types';
import type { Action, Effort, GameState, SlotKind } from '../src/shared/types';

type Rand = () => number;

interface Policy {
  name: string;
  step(s: GameState, teamId: string, rand: Rand): Action | null;
  efforts?: (s: GameState, teamId: string, rand: Rand) => Record<string, Effort>;
  /** Wat de bot naast het tempo doet: standaard alles. */
  extras?: 'none' | 'car' | 'cards';
}

/** Zelfde bot, maar knechten helpen nooit of altijd. */
const noHelp = (s: GameState, teamId: string, rand: Rand) => {
  const out = botEfforts(s, teamId, rand);
  for (const k of Object.keys(out)) if (out[k] === 'helpen') out[k] = 'normaal';
  return out as Record<string, Effort>;
};
const allHelp = (s: GameState, teamId: string, rand: Rand) => {
  const out = botEfforts(s, teamId, rand);
  const kop = s.kopman[teamId];
  for (const k of Object.keys(out)) {
    const r = s.riders.find((x) => x.id === k)!;
    if (k !== kop && canHelp(s, r)) out[k] = 'helpen';
  }
  return out as Record<string, Effort>;
};

/** Kiest met opzet de renner die het slechtst bij het parcours past als kopman. */
function worstKopman(inner: Policy['step']): Policy['step'] {
  return (s, teamId, rand) => {
    const team = s.teams.find((t) => t.id === teamId)!;
    const worst = [...team.riderIds]
      .map((id) => s.riders.find((r) => r.id === id)!)
      .sort((a, b) => stageFit(a, s.terrain, 0) - stageFit(b, s.terrain, 0))[0];
    if (s.kopman[teamId] !== worst.id) return { type: 'kopman', teamId, riderId: worst.id };
    return inner(s, teamId, rand);
  };
}

/** De kopman valt elke ronde vol gas aan, de rest rijdt rustig en helpt. */
function breakaway(s: GameState, teamId: string, rand: Rand): Record<string, Effort> {
  const out = botEfforts(s, teamId, rand);
  const kop = s.kopman[teamId];
  if (kop) out[kop] = 'alles';
  return out;
}

const always = (e: Effort) => (s: GameState, teamId: string) =>
  Object.fromEntries(s.teams.find((t) => t.id === teamId)!.riderIds.map((id) => [id, e])) as Record<string, Effort>;

const slotKinds = Object.keys(SLOT_LIMITS) as SlotKind[];

/** Gebruikt kaarten zoals de standaard-bot, maar met eigen regels voor training. */
function custom(opts: { train: 'none' | 'safe' | 'max' | 'star'; assets: boolean; buy: boolean }): Policy['step'] {
  return (s, teamId, rand) => {
    const team = s.teams.find((t) => t.id === teamId)!;
    const riders = s.riders.filter((r) => r.teamId === teamId);
    for (const c of team.hand) {
      const d = CARD_DEFS[c.def];
      if (d.kind === 'training' && opts.train !== 'none') {
        const rest = (d.fatigue ?? 0) < 0;
        if (opts.train === 'star') {
          // Stapelt alles op de eerste renner, nooit rust: de klassieke overtrainer.
          if (rest) continue;
          const star = riders[0];
          if (star.trained < TRAININGS_PER_RIDER) return { type: 'train', teamId, cardId: c.id, riderId: star.id };
          continue;
        }
        if (rest) {
          const tired = [...riders].sort((a, b) => b.fatigue - a.fatigue)[0];
          if (opts.train === 'safe' && tired.fatigue >= 3) return { type: 'train', teamId, cardId: c.id, riderId: tired.id };
          continue;
        }
        const limit = opts.train === 'max' ? 99 : 3;
        const r = riders
          .filter((x) => x.trained < TRAININGS_PER_RIDER && x.fatigue + (d.fatigue ?? 0) <= limit)
          .sort((a, b) => a.fatigue - b.fatigue)[0];
        if (r) return { type: 'train', teamId, cardId: c.id, riderId: r.id };
      }
      if (opts.assets && d.kind !== 'training' && d.kind !== 'sabotage' && d.kind !== 'race') {
        const slot = team.slots[d.kind as SlotKind];
        if (slot.length < SLOT_LIMITS[d.kind as SlotKind]) return { type: 'install', teamId, cardId: c.id };
      }
    }
    if (opts.buy && team.coins >= 2 && rand() < 0.8) {
      const options = s.market
        .map((c, i) => ({ i, d: CARD_DEFS[c.def] }))
        .filter((x) => x.d.price <= team.coins && (opts.train !== 'none' || x.d.kind !== 'training'))
        .filter((x) => opts.assets || x.d.kind === 'training');
      if (options.length) return { type: 'buy', teamId, source: { kind: 'market', index: options[0].i } };
    }
    return null;
  };
}

const POLICIES: Policy[] = [
  { name: 'slim (standaard bot)', step: botStep },
  { name: 'passief (niets gebruiken)', step: () => null },
  { name: 'trainer (max training)', step: custom({ train: 'max', assets: true, buy: true }) },
  { name: 'spullen (geen training)', step: custom({ train: 'none', assets: true, buy: true }) },
  { name: 'alleen training', step: custom({ train: 'safe', assets: false, buy: true }) },
  { name: 'ster (stapelt op 1 renner)', step: custom({ train: 'star', assets: true, buy: true }) },
  { name: 'roekeloos (altijd alles)', step: botStep, efforts: always('alles') },
  { name: 'saai (altijd normaal)', step: botStep, efforts: always('normaal') },
  { name: 'nooit helpen', step: botStep, efforts: noHelp },
  { name: 'altijd helpen', step: botStep, efforts: allHelp },
  { name: 'geen volgauto, geen kaarten', step: botStep, extras: 'none' },
  { name: 'alleen volgauto', step: botStep, extras: 'car' },
  { name: 'alleen koerskaarten', step: botStep, extras: 'cards' },
  { name: 'verkeerde kopman', step: worstKopman(custom({ train: 'safe', assets: true, buy: true })) },
  { name: 'ontsnapper (kopman altijd alles)', step: botStep, efforts: breakaway },
];

function makeRand(seed: number): Rand {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

interface Stats {
  wins: Record<string, number>;
  points: Record<string, number>;
  place: Record<string, number>;
  games: number;
  rounds: number[]; // per etappe
  riderRounds: number;
  exhausted: number;
  pech: number;
  shielded: number;
  alles: number;
  helping: number;
  gels: number;
  colas: number;
  blocks: number;
  cars: number;
  rustig: number;
  normaal: number;
  overtrained: number;
  riderStages: number;
  stageWinnerSpread: number[];
  stageLeaderGap: number[];
  leftover: number[]; // energie over bij de finish, als deel van het maximum
  soloLead: number; // rondes waarin de koploper alleen of met z'n tweeën rijdt
  leadRounds: number;
  soloWins: number; // etappes die gewonnen worden door een renner die in de slotronde alleen rijdt
  winMargin: number[];
  crashes: number;
  dominoes: number;
  injured: number;
  inPeloton: number;
  alone: number;
  teamBonus: number;
  weather: Record<string, number>;
  crashByWeather: Record<string, { rounds: number; crashes: number }>;
  // Per kaart, per etappe: scores als percentage van het gemiddelde team in die etappe. Per etappe vergeleken,
  // want kaarten stapelen zich op en late etappes tellen zwaarder (anders lijken bezitters beter dan ze zijn).
  withDef: Record<string, Record<number, { n: number; pct: number }>>;
  withoutDef: Record<string, Record<number, { n: number; pct: number }>>;
  comeback: { rank: number; won: number; games: number }[]; // rank na etappe 1 (0 = eerste)
}

function playSeason(seed: number, order: Policy[], st: Stats): void {
  const rand = makeRand(seed * 7919 + 13);
  let s = createGame(seed);
  for (let i = 0; i < order.length; i++) s = reduce(s, { type: 'join', name: `T${i}`, isBot: true });
  s = reduce(s, { type: 'start' });
  const policyOf = (teamId: string) => order[s.teams.findIndex((t) => t.id === teamId)];
  let guard = 0;
  let installed: Record<string, string[]> = {};
  let rankAfterOne: Record<string, number> | null = null;

  while (s.phase !== 'finished' && guard++ < 3000) {
    switch (s.phase) {
      case 'briefing':
        s = reduce(s, { type: 'briefDone' });
        break;
      case 'recruit': {
        for (const t of s.teams) {
          let a = botShopStep(s, t.id, rand);
          while (a) {
            s = reduce(s, a);
            a = s.phase === 'recruit' ? botShopStep(s, t.id, rand) : null;
          }
        }
        break;
      }
      case 'naming':
        for (const t of s.teams) if (s.phase === 'naming') s = reduce(s, { type: 'ready', teamId: t.id });
        break;
      case 'draft': {
        const teamId = s.draft!.order[s.draft!.idx];
        s = reduce(s, { type: 'draftPick', teamId, source: botDraft(s, teamId, rand) });
        break;
      }
      case 'team': {
        for (const t of s.teams) {
          const pol = policyOf(t.id);
          let n = 0;
          for (let step = pol.step(s, t.id, rand); step && n++ < 40; step = pol.step(s, t.id, rand)) {
            try {
              s = reduce(s, step);
            } catch {
              break;
            }
          }
          s = reduce(s, { type: 'ready', teamId: t.id });
        }
        // Statistiek aan de start van de race.
        installed = Object.fromEntries(s.teams.map((t) => [t.id, teamDefIds(t.slots)]));
        for (const t of s.teams) {
          const tol = perksOf(teamDefIds(t.slots)).overtrainTolerance;
          for (const id of t.riderIds) {
            const r = s.riders.find((x) => x.id === id)!;
            st.riderStages++;
            if (overtrainPenalty(r, tol) > 0) st.overtrained++;
          }
        }
        break;
      }
      case 'race': {
        for (const t of s.teams) {
          const pol = policyOf(t.id);
          const plan = botRacePlan(s, t.id, rand);
          s = reduce(s, {
            type: 'effort',
            teamId: t.id,
            efforts: pol.efforts?.(s, t.id, rand) ?? (pol.extras ? botEfforts(s, t.id, rand) : plan.efforts),
            car: pol.extras === 'none' || pol.extras === 'cards' ? null : plan.car,
            plays: pol.extras === 'none' || pol.extras === 'car' ? [] : plan.plays,
          });
        }
        break;
      }
      case 'resolve': {
        const rep = s.report!;
        const bucket = (st.crashByWeather[s.weather] ??= { rounds: 0, crashes: 0 });
        for (const m of rep.moves) {
          st.riderRounds++;
          bucket.rounds++;
          if (m.crash === 'fall') {
            st.crashes++;
            bucket.crashes++;
          }
          if (m.crash === 'domino') st.dominoes++;
          if (m.injured) st.injured++;
          if (m.groupSize >= 3) st.inPeloton++;
          else st.alone++;
          if (m.parts.team > 0) st.teamBonus++;
          if (m.exhausted) st.exhausted++;
          if (m.pech) st.pech++;
          if (m.shielded) st.shielded++;
          if (m.helping) st.helping++;
          if (m.item === 'gel') st.gels++;
          if (m.item === 'cola') st.colas++;
          if (m.item === 'blok') st.blocks++;
          if (m.car) st.cars++;
          if (m.effort === 'alles') st.alles++;
          else if (m.effort === 'rustig') st.rustig++;
          else st.normaal++;
        }
        {
          const top = [...rep.moves].sort((a, b) => b.to - a.to);
          st.leadRounds++;
          if (top[0].groupSize <= 2 && top[0].to - [...rep.moves].sort((a, b) => b.from - a.from)[2].from >= 3) st.soloLead++;
          if (rep.finished) {
            st.winMargin.push(top[0].to - top[1].to);
            for (const m of rep.moves) {
              const r = s.riders.find((x) => x.id === m.riderId)!;
              st.leftover.push(m.energyAfter / Math.max(1, r.maxEnergy));
            }
            if (top[0].groupSize <= 2) st.soloWins++;
          }
        }
        if (rep.finished) {
          st.rounds.push(rep.round);
          const pos = s.riders.map((r) => r.pos).sort((a, b) => b - a);
          st.stageLeaderGap.push(pos[0] - pos[Math.floor(pos.length / 2)]);
        }
        s = reduce(s, { type: 'next' });
        break;
      }
      case 'results': {
        const res = s.stageResult!;
        const tracked = Object.keys(CARD_DEFS).filter((d) => !['training', 'sabotage', 'race'].includes(CARD_DEFS[d].kind));
        const mean = res.teams.reduce((n, t) => n + t.stagePoints, 0) / res.teams.length || 1;
        for (const t of res.teams) {
          const have = new Set(installed[t.teamId] ?? []);
          for (const d of tracked) {
            const bucket = (have.has(d) ? st.withDef : st.withoutDef)[d] ??= {};
            const b = (bucket[res.stage] ??= { n: 0, pct: 0 });
            b.n += 1;
            b.pct += (100 * t.stagePoints) / mean;
          }
        }
        st.weather[s.weather] = (st.weather[s.weather] ?? 0) + 1;
        if (res.stage === 1) {
          const order = [...res.teams].sort((a, b) => b.totalPoints - a.totalPoints);
          rankAfterOne = Object.fromEntries(order.map((t, i) => [t.teamId, i]));
        }
        s = reduce(s, { type: 'nextStage' });
        break;
      }
      default:
        throw new Error(`onverwachte fase ${s.phase}`);
    }
  }

  const final = [...s.teams].sort((a, b) => b.points - a.points || b.coins - a.coins);
  final.forEach((t, i) => {
    const p = policyOf(t.id).name;
    st.points[p] = (st.points[p] ?? 0) + t.points;
    st.place[p] = (st.place[p] ?? 0) + i + 1;
    if (i === 0) st.wins[p] = (st.wins[p] ?? 0) + 1;
  });
  st.games += 1;
  if (rankAfterOne) {
    const winner = final[0].id;
    const startRank = rankAfterOne[winner];
    for (const c of st.comeback) c.games += 1;
    st.comeback[startRank].won += 1;
  }
}

function shuffled<T>(arr: T[], rand: Rand): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const N = Number(process.argv[2] ?? 300);
const st: Stats = {
  wins: {},
  points: {},
  place: {},
  games: 0,
  rounds: [],
  riderRounds: 0,
  exhausted: 0,
  pech: 0,
  shielded: 0,
  alles: 0,
  helping: 0,
  gels: 0,
  colas: 0,
  blocks: 0,
  cars: 0,
  rustig: 0,
  normaal: 0,
  overtrained: 0,
  riderStages: 0,
  stageWinnerSpread: [],
  stageLeaderGap: [],
  leftover: [],
  soloLead: 0,
  leadRounds: 0,
  soloWins: 0,
  winMargin: [],
  crashes: 0,
  dominoes: 0,
  injured: 0,
  inPeloton: 0,
  alone: 0,
  teamBonus: 0,
  weather: {},
  crashByWeather: {},
  withDef: {},
  withoutDef: {},
  comeback: Array.from({ length: 4 }, (_, rank) => ({ rank, won: 0, games: 0 })),
};

// Elk seizoen: 4 teams uit de strategieën, in willekeurige stoelvolgorde.
const seatRand = makeRand(4242);
const appearances: Record<string, number> = {};
for (let g = 0; g < N; g++) {
  const mirror = process.argv[3] === 'mirror';
  const pick = mirror ? [POLICIES[0], POLICIES[0], POLICIES[0], POLICIES[0]] : shuffled(POLICIES, seatRand).slice(0, 4);
  pick.forEach((p) => (appearances[p.name] = (appearances[p.name] ?? 0) + 1));
  playSeason(1000 + g, pick, st);
}

const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(1)}%`;

console.log(`\n${N} seizoenen, ${STAGES} etappes, 4 teams per seizoen\n`);
console.log('Strategie'.padEnd(30), 'zeges'.padStart(7), 'win%'.padStart(7), 'gem. pnt'.padStart(9), 'gem. plek'.padStart(10));
for (const p of POLICIES) {
  const n = appearances[p.name] ?? 0;
  console.log(
    p.name.padEnd(30),
    String(st.wins[p.name] ?? 0).padStart(7),
    pct(st.wins[p.name] ?? 0, n).padStart(7),
    ((st.points[p.name] ?? 0) / Math.max(1, n)).toFixed(1).padStart(9),
    ((st.place[p.name] ?? 0) / Math.max(1, n)).toFixed(2).padStart(10),
  );
}
console.log('\nRaceverloop');
console.log('  rondes per etappe: gem', avg(st.rounds).toFixed(1), 'min', Math.min(...st.rounds), 'max', Math.max(...st.rounds));
console.log('  op de fles:', pct(st.exhausted, st.riderRounds), 'van alle renner-rondes');
console.log('  pech:', pct(st.pech, st.riderRounds), '(opgevangen door reservefiets:', pct(st.shielded, st.riderRounds) + ')');
console.log('  tempo: rustig', pct(st.rustig, st.riderRounds), 'normaal', pct(st.normaal, st.riderRounds), 'alles', pct(st.alles, st.riderRounds));
console.log('  knechten die helpen:', pct(st.helping, st.riderRounds), 'van alle renner-rondes');
console.log(
  '  koerskaarten per etappe (4 teams): gel',
  (st.gels / (N * STAGES)).toFixed(1),
  'cola',
  (st.colas / (N * STAGES)).toFixed(1),
  'blok',
  (st.blocks / (N * STAGES)).toFixed(1),
  '· volgauto bij',
  pct(st.cars, st.riderRounds),
  'van alle renner-rondes',
);
console.log(
  '  valpartijen:',
  pct(st.crashes, st.riderRounds),
  'van alle renner-rondes (domino',
  pct(st.dominoes, st.riderRounds) + ', zware val',
  pct(st.injured, st.riderRounds) + ')',
);
for (const [w, b] of Object.entries(st.crashByWeather))
  console.log(`    bij ${w}: ${pct(b.crashes, b.rounds)} per renner-ronde (${st.weather[w] ?? 0} etappes)`);
console.log(
  '  in een peloton (>=3):',
  pct(st.inPeloton, st.riderRounds),
  '· alleen of met z\'n tweeën:',
  pct(st.alone, st.riderRounds),
  '· teamwerk-bonus:',
  pct(st.teamBonus, st.riderRounds),
);
console.log('  overtraind bij start race:', pct(st.overtrained, st.riderStages), 'van alle renner-etappes');
console.log(
  '  koploper alleen weg (>=3 voor de rest):',
  pct(st.soloLead, st.leadRounds),
  'van de rondes · etappewinnaar reed alleen/met z\'n tweeën:',
  pct(st.soloWins, st.winMargin.length),
  '· marge winnaar op nummer 2: gem',
  avg(st.winMargin).toFixed(1),
  'tegels',
);
console.log('  energie over bij de finish: gem', (100 * avg(st.leftover)).toFixed(0) + '% van het maximum');
console.log('  voorsprong leider op mediaan bij finish: gem', avg(st.stageLeaderGap).toFixed(1), 'tegels');

/** Hoe vaak wint de leider na etappe 1 als elke etappe puur toeval is? Dat is de ondergrens, niet 25%. */
function luckOnlyLeaderWinRate(n = 200000): number {
  const base = [22, 15, 10, 5];
  let wins = 0;
  for (let i = 0; i < n; i++) {
    const tot = [0, 0, 0, 0];
    let leader = -1;
    for (let st = 0; st < STAGES; st++) {
      const p = base.slice();
      for (let k = p.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [p[k], p[j]] = [p[j], p[k]];
      }
      for (let t = 0; t < 4; t++) tot[t] += p[t] * (STAGE_FACTOR[st] ?? 1);
      if (st === 0) leader = tot.indexOf(Math.max(...tot));
    }
    if (tot.indexOf(Math.max(...tot)) === leader) wins++;
  }
  return (100 * wins) / n;
}
console.log(`\nWie wint het seizoen, gerekend vanaf de stand na etappe 1 (bij puur toeval wint de leider al ${luckOnlyLeaderWinRate().toFixed(0)}%, niet 25%)`);
st.comeback.forEach((c) => console.log(`  na etappe 1 nummer ${c.rank + 1}: wint ${pct(c.won, c.games)}`));

console.log('\nWaarde per kaart: extra score per etappe als je het hebt, in % van het gemiddelde team (per etappe vergeleken)');
const rows = Object.keys(st.withDef)
  .map((d) => {
    let n = 0;
    let sum = 0;
    for (const [stage, w] of Object.entries(st.withDef[d])) {
      const wo = st.withoutDef[d]?.[Number(stage)];
      if (!wo || wo.n === 0) continue;
      n += w.n;
      sum += w.n * (w.pct / w.n - wo.pct / wo.n);
    }
    return { d, n, diff: n ? sum / n : 0 };
  })
  .sort((a, b) => b.diff - a.diff);
for (const r of rows) console.log(' ', CARD_DEFS[r.d].name.padEnd(26), (r.diff >= 0 ? '+' : '') + r.diff.toFixed(1) + '%', `(n=${r.n})`);
