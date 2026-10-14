// Commentary: two straight-faced commentators describing a slightly absurd bike race.
// Lines avoid pronouns on purpose: riders are named, never gendered.

import { COMMENTATORS, EVENTS, QUIRKS, TERRAINS } from './content';
import type { CommentatorId } from './content';
import type { PublicState, Rider } from './types';

export interface Line {
  speaker: CommentatorId;
  text: string;
}

const j = (text: string): Line => ({ speaker: 'johan', text });
const m = (text: string): Line => ({ speaker: 'marieke', text });
const choice = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
const first = (name: string) => name.split(' ')[0];

function teamLabel(s: PublicState, teamId: string): string {
  const t = s.teams.find((x) => x.id === teamId);
  return t ? `${t.name}'s team` : 'the team';
}

function rider(s: PublicState, id: string): Rider {
  return s.riders.find((r) => r.id === id)!;
}

export function introLines(s: PublicState): Line[] {
  const n = s.teams.length;
  const socks = s.riders.find((r) => r.quirk === 'socks');
  const out: Line[] = [
    j(
      `Good afternoon, and welcome to Peloton Panic. ${n} teams are on the start line, and the weather is, frankly, absurdly pleasant.`,
    ),
  ];
  if (socks)
    out.push(
      m(
        `Johan, I have studied the start list. ${first(socks.name)} is wearing mismatched socks. That always worries me.`,
      ),
    );
  else out.push(m('Johan, the legs look good, the bikes look shiny. Somebody is going to ruin it.'));
  return out;
}

export function eventLines(s: PublicState): Line[] {
  if (!s.event) return [];
  const def = EVENTS[s.event.id];
  const target = s.event.targetRiderId ? rider(s, s.event.targetRiderId) : null;
  const team = s.event.targetTeamId ? teamLabel(s, s.event.targetTeamId) : null;
  const head = `Round ${s.round}.`;
  switch (s.event.id) {
    case 'calm':
      return [j(`${head} Calm conditions out there. Nothing to report.`), m('Which is exactly when something happens.')];
    case 'tailwind':
      return [j(`${head} A tailwind has picked up. Everyone gets a little push.`), m('Free speed. Nobody should complain, but they will.')];
    case 'headwind':
      return [j(`${head} Headwind. The riders are going to feel every metre.`), m('Wind-hardened riders will laugh at this. Everyone else will suffer.')];
    case 'crosswind':
      return [j(`${head} Crosswind! The peloton is splitting into echelons.`), m('No drafting this round. Everyone is on their own.')];
    case 'rain':
      return [j(`${head} Rain is falling. The descents and cobbles are suddenly very slippery.`), m('Careful out there. Mudguards would have been nice.')];
    case 'feedzone':
      return [j(`${head} The feed zone! Soigneurs are handing out bags.`), m('Everyone draws an extra card. Mostly sandwiches, I think.')];
    case 'crowd':
      return [j(`${head} The crowd is roaring on the climbs.`), m('Climbers love this. Plus one on every ascent.')];
    case 'chicken':
      return [
        j(`${head} Unbelievable scenes. A spectator in a chicken costume is on the road!`),
        m(target ? `${first(target.name)} is in front, and has to brake. That is minus two.` : 'The leader has to brake.'),
      ];
    case 'wrongTurn':
      return [
        j(`${head} ${team ?? 'A team'} is in trouble. The team car has followed the wrong bus.`),
        m('That is a disaster for morale, and for the drinks.'),
      ];
    case 'sandwich':
      return [
        j(`${head} A soigneur hands ${target ? first(target.name) : 'a rider'} a sandwich. Nobody knows what is in it.`),
        m('Plus three speed, but a tired card follows. Trade-offs, Johan.'),
      ];
    default:
      return [j(`${head} ${def.title}. ${def.blurb}`)];
  }
}

export function roundLines(s: PublicState): Line[] {
  const rep = s.report;
  if (!rep) return [];
  const out: Line[] = [];
  const leader = rider(s, rep.leaderRiderId);
  const prev = rider(s, rep.prevLeaderRiderId);

  if (rep.finished) {
    out.push(j(`${first(leader.name)} is across the line first! ${teamLabel(s, leader.teamId)} take the stage.`));
    return out;
  }

  if (leader.id !== prev.id && leader.teamId !== prev.teamId) {
    out.push(
      j(`${first(leader.name)} takes over at the front for ${teamLabel(s, leader.teamId)}.`),
    );
  } else {
    out.push(j(`${first(leader.name)} keeps the lead. ${s.trackLength - Math.floor(leader.pos)} tiles to go.`));
  }

  const flying = [...rep.moves].sort((a, b) => b.to - b.from - (a.to - a.from))[0];
  if (flying && flying.to - flying.from >= 6) {
    out.push(m(`${first(rider(s, flying.riderId).name)} is flying. ${flying.to - flying.from} tiles in one go.`));
  } else {
    const wind = rep.moves.find((x) => x.windPaid);
    if (wind) {
      const r = rider(s, wind.riderId);
      out.push(m(`${first(r.name)} is doing all the work at the front. That is going to cost ${teamLabel(s, r.teamId)} later.`));
    }
  }

  const chasers = rep.moves.filter((x) => x.parts.chase > 0);
  if (chasers.length > 0 && out.length < 3) {
    const r = rider(s, choice(chasers).riderId);
    out.push(j(`${first(r.name)} has been dropped, and the peloton is already pulling a gap back.`));
  }

  const croissant = rep.moves.find((x) => {
    const r = rider(s, x.riderId);
    return r.quirk === 'croissant' && x.cardValue !== null && x.cardValue <= 2 && x.cardKind === 'energy';
  });
  if (croissant && out.length < 3 && Math.random() < 0.5) {
    out.push(m(`${first(rider(s, croissant.riderId).name)} is riding on croissants. Cheap energy, and it works.`));
  }

  if (out.length < 3 && Math.random() < 0.2) {
    const socks = s.riders.find((r) => r.quirk === 'socks');
    if (socks) out.push(m(`I must mention ${first(socks.name)}'s socks again. One is green. The other is also green, but a different green.`));
  }
  return out.slice(0, 3);
}

export function tradeLines(s: PublicState): Line[] {
  if (Math.random() > 0.5) return [];
  return [
    choice([
      j('Plenty of talking in the bunch. Deals are being made.'),
      m('This is the part nobody puts in the highlights: the quiet little pacts.'),
      j('Riders are comparing cards. Allegedly. Nobody has seen anything.'),
    ]),
  ];
}

export function finishLines(s: PublicState): Line[] {
  const r = s.results;
  if (!r) return [];
  const winner = s.teams.find((t) => t.id === r.winnerTeamId)!;
  const lantern = s.teams.find((t) => t.id === r.lanterneRougeTeamId)!;
  const topRider = rider(s, r.ranking[0].riderId);
  return [
    j(`What a finish. ${first(topRider.name)} wins the stage, and ${winner.name}'s team takes the day on points.`),
    m(`And the red lantern goes to ${lantern.name}'s team. A proud tradition. Wear it well.`),
  ];
}

export function whoIs(id: CommentatorId): string {
  return COMMENTATORS[id].name;
}

// Re-exported for the UI so it only has to import from one place.
export { QUIRKS, TERRAINS };
