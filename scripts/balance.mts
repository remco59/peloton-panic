// Balans-simulatie: speelt honderden seizoenen met verschillende bot-strategieën en
// rapporteert of voorbereiding loont, of overtraining straft en hoe lang etappes duren.
//
//   npx tsx scripts/balance.mts [aantal seizoenen]

import { CARD_DEFS } from '../src/shared/content';
import {
  botDraft,
  botEfforts,
  botStep,
  createGame,
  overtrainPenalty,
  perksOf,
  reduce,
  teamDefIds,
} from '../src/shared/engine';
import { SLOT_LIMITS, STAGES, TRAININGS_PER_RIDER } from '../src/shared/types';
import type { Action, Effort, GameState, SlotKind } from '../src/shared/types';

type Rand = () => number;

interface Policy {
  name: string;
  step(s: GameState, teamId: string, rand: Rand): Action | null;
  efforts?: (s: GameState, teamId: string) => Record<string, Effort>;
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
      if (opts.assets && d.kind !== 'training' && d.kind !== 'sabotage') {
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
  rustig: number;
  normaal: number;
  overtrained: number;
  riderStages: number;
  stageWinnerSpread: number[];
  stageLeaderGap: number[];
  withDef: Record<string, { n: number; pts: number }>;
  withoutDef: Record<string, { n: number; pts: number }>;
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
        for (const t of s.teams)
          s = reduce(s, {
            type: 'effort',
            teamId: t.id,
            efforts: (policyOf(t.id).efforts ?? ((x, id) => botEfforts(x, id, rand) as Record<string, Effort>))(s, t.id),
          });
        break;
      }
      case 'resolve': {
        const rep = s.report!;
        for (const m of rep.moves) {
          st.riderRounds++;
          if (m.exhausted) st.exhausted++;
          if (m.pech) st.pech++;
          if (m.shielded) st.shielded++;
          if (m.effort === 'alles') st.alles++;
          else if (m.effort === 'rustig') st.rustig++;
          else st.normaal++;
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
        const tracked = Object.keys(CARD_DEFS).filter((d) => !['training', 'sabotage'].includes(CARD_DEFS[d].kind));
        for (const t of res.teams) {
          const have = new Set(installed[t.teamId] ?? []);
          for (const d of tracked) {
            const bucket = have.has(d) ? st.withDef : st.withoutDef;
            bucket[d] ??= { n: 0, pts: 0 };
            bucket[d].n += 1;
            bucket[d].pts += t.stagePoints;
          }
        }
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
  rustig: 0,
  normaal: 0,
  overtrained: 0,
  riderStages: 0,
  stageWinnerSpread: [],
  stageLeaderGap: [],
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
console.log('  overtraind bij start race:', pct(st.overtrained, st.riderStages), 'van alle renner-etappes');
console.log('  voorsprong leider op mediaan bij finish: gem', avg(st.stageLeaderGap).toFixed(1), 'tegels');

console.log('\nWie wint het seizoen, gerekend vanaf de stand na etappe 1 (25% = gelijk)');
st.comeback.forEach((c) => console.log(`  na etappe 1 nummer ${c.rank + 1}: wint ${pct(c.won, c.games)}`));

console.log('\nWaarde per kaart: extra punten per etappe als je het hebt (t.o.v. zonder)');
const rows = Object.keys(st.withDef)
  .map((d) => {
    const w = st.withDef[d];
    const wo = st.withoutDef[d] ?? { n: 0, pts: 0 };
    return { d, n: w.n, diff: w.pts / Math.max(1, w.n) - wo.pts / Math.max(1, wo.n) };
  })
  .sort((a, b) => b.diff - a.diff);
for (const r of rows) console.log(' ', CARD_DEFS[r.d].name.padEnd(26), (r.diff >= 0 ? '+' : '') + r.diff.toFixed(2), `(n=${r.n})`);
