// Commentaar: twee commentatoren die vol ernst een licht absurde wielerwedstrijd beschrijven.
// Regels vermijden persoonlijke voornaamwoorden: renners worden bij naam genoemd.
// Met de tutorial aan leggen ze daarnaast per onderdeel uit hoe het spel werkt.

import { CARD_DEFS, COMMENTATORS, EVENTS, KIND_LABELS, STAGE_INFO } from './content';
import type { CommentatorId } from './content';
import type { PublicState, Rider } from './types';
import { STAGES } from './types';

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
  return t ? `het team van ${t.name}` : 'het team';
}

function rider(s: PublicState, id: string): Rider {
  return s.riders.find((r) => r.id === id)!;
}

// ---- Gewone commentaar -------------------------------------------------------

export function introLines(s: PublicState): Line[] {
  const n = s.teams.length;
  const socks = s.riders.find((r) => r.quirk === 'socks');
  const out: Line[] = [
    j(`Goedemiddag en welkom bij Peloton Panic. ${n} ploegen staan aan de start van een seizoen van ${STAGES} etappes.`),
  ];
  if (socks)
    out.push(m(`Johan, ik heb de startlijst bekeken. ${first(socks.name)} draagt verschillende sokken. Dat baart me zorgen.`));
  else out.push(m('Johan, de benen zien er goed uit en de fietsen glimmen. Iemand gaat dat straks verpesten.'));
  return out;
}

export function stageLines(s: PublicState): Line[] {
  const info = STAGE_INFO[Math.min(STAGES, s.stage) - 1];
  return [j(`${info.name}. ${info.blurb}`), m('Eerst de voorbereiding. Wie nu slim kiest, plukt daar straks de vruchten van.')];
}

export function pickLines(teamName: string, def: string): Line[] {
  const d = CARD_DEFS[def];
  if (!d) return [];
  const bits: Record<string, string[]> = {
    training: ['Daar wordt hard voor getraind.', 'Wie traint, die wint. In theorie.'],
    sponsor: ['Dat is een slimme zet: geld is altijd welkom.', 'Een sponsor in de pocket. Dat komt goed uit.'],
    staff: ['Goede staf is goud waard.', 'Dat wordt een drukke dag voor de staf.'],
    material: ['Goed materiaal maakt het verschil.', 'Het materiaal gaat een stap vooruit.'],
    car: ['Een ploegwagen volgt je door dik en dun.', 'De wagen rijdt straks mooi achter de groep.'],
    sabotage: ['Hm. Dat is geen vriendelijke kaart.', 'Iemand heeft kwaad in de zin.'],
  };
  const t = `${teamName} pakt ${d.name}. ${choice(bits[d.kind] ?? [''])}`.trim();
  return Math.random() < 0.6 ? [(Math.random() < 0.5 ? j : m)(t)] : [];
}

export function teamPhaseLines(s: PublicState): Line[] {
  return [
    j(`Voorbereiding voor etappe ${s.stage}. De ploegen trainen, kopen spullen en beraden zich over hun tactiek.`),
    m('Vergeet niet te ruilen. Wie praat, wint soms ook.'),
  ];
}

export function eventLines(s: PublicState): Line[] {
  if (!s.event) return [];
  const def = EVENTS[s.event.id];
  const target = s.event.targetRiderId ? rider(s, s.event.targetRiderId) : null;
  const team = s.event.targetTeamId ? teamLabel(s, s.event.targetTeamId) : null;
  const head = `Ronde ${s.round}.`;
  switch (s.event.id) {
    case 'calm':
      return [j(`${head} Rustig weer. Niets te melden.`), m('En dat is precies het moment waarop er iets gebeurt.')];
    case 'tailwind':
      return [j(`${head} Er staat meewind. Iedereen krijgt een duwtje.`), m('Gratis snelheid. Niemand klaagt, maar ze doen het toch.')];
    case 'headwind':
      return [j(`${head} Tegenwind. De renners voelen elke meter.`), m('Windgeharde renners lachen erom. De rest lijdt.')];
    case 'crosswind':
      return [j(`${head} Zijwind! Het peloton splitst in waaiers.`), m('Geen drafting deze ronde. Iedereen staat er alleen voor.')];
    case 'rain':
      return [j(`${head} Het regent. Afdalingen en kasseien zijn spekglad.`), m('Voorzichtig daar. Spatborden waren leuk geweest.')];
    case 'feedzone':
      return [j(`${head} De bevoorrading! Soigneurs delen tassen uit.`), m('Iedereen krijgt twee energie terug. Vooral broodjes, vermoed ik.')];
    case 'crowd':
      return [j(`${head} Het publiek juicht op de klim.`), m('Klimmers zijn dol op dit. Plus één op elke klim.')];
    case 'chicken':
      return [
        j(`${head} Ongelooflijke taferelen. Een toeschouwer in kippenpak staat op de weg!`),
        m(target ? `${first(target.name)} voorop moet remmen. Min twee.` : 'De koploper moet remmen.'),
      ];
    case 'wrongTurn':
      return [
        j(`${head} ${team ?? 'Een team'} heeft problemen. De volgauto volgt de verkeerde bus.`),
        m('Dat is een drama voor de moraal, en voor de bidons.'),
      ];
    case 'sandwich':
      return [
        j(`${head} Een soigneur geeft ${target ? first(target.name) : 'een renner'} een broodje. Niemand weet wat erop zit.`),
        m('Plus drie snelheid, min twee energie. Afwegingen, Johan.'),
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
    out.push(j(`${first(leader.name)} komt als eerste over de streep! ${teamLabel(s, leader.teamId)} wint de etappe.`));
    return out;
  }

  if (leader.id !== prev.id && leader.teamId !== prev.teamId)
    out.push(j(`${first(leader.name)} neemt de leiding over voor ${teamLabel(s, leader.teamId)}.`));
  else out.push(j(`${first(leader.name)} blijft aan kop. Nog ${Math.max(0, s.trackLength - Math.floor(leader.pos))} tegels te gaan.`));

  const pech = rep.moves.filter((x) => x.pech);
  const shielded = rep.moves.filter((x) => x.shielded);
  const empty = rep.moves.filter((x) => x.exhausted);
  const flying = [...rep.moves].sort((a, b) => b.to - b.from - (a.to - a.from))[0];

  if (pech.length > 0) {
    const r = rider(s, choice(pech).riderId);
    out.push(m(`${first(r.name)} heeft pech. Een lekke band op het slechtst denkbare moment.`));
  } else if (shielded.length > 0) {
    const r = rider(s, shielded[0].riderId);
    out.push(m(`Pech voor ${first(r.name)}, maar de reservefiets staat klaar. Dat scheelt een heleboel.`));
  } else if (empty.length > 0) {
    const r = rider(s, choice(empty).riderId);
    out.push(m(`${first(r.name)} is op de fles. De benen zijn leeg, en dat zie je.`));
  } else if (flying && flying.to - flying.from >= 8) {
    out.push(m(`${first(rider(s, flying.riderId).name)} vliegt. ${flying.to - flying.from} tegels in één ronde.`));
  } else {
    const wind = rep.moves.find((x) => x.windPaid);
    if (wind) {
      const r = rider(s, wind.riderId);
      out.push(m(`${first(r.name)} doet al het werk aan kop. Dat gaat ${teamLabel(s, r.teamId)} nog kosten.`));
    }
  }

  const service = rep.moves.find((x) => x.service);
  if (service && out.length < 3) {
    const r = rider(s, service.riderId);
    out.push(j(`De volgauto komt langszij bij ${first(r.name)}. Een bidon en een duwtje: nieuwe energie.`));
  }

  if (out.length < 3 && Math.random() < 0.2) {
    const socks = s.riders.find((r) => r.quirk === 'socks');
    if (socks) out.push(m(`Ik moet de sokken van ${first(socks.name)} nog even noemen. Eén is groen, de ander ook, maar een andere groen.`));
  }
  return out.slice(0, 3);
}

export function stageResultLines(s: PublicState): Line[] {
  const r = s.stageResult;
  if (!r) return [];
  const winnerTeam = [...r.teams].sort((a, b) => b.stagePoints - a.stagePoints)[0];
  const winner = s.teams.find((t) => t.id === winnerTeam.teamId)!;
  const lantern = s.teams.find((t) => t.id === r.lanterneRougeTeamId)!;
  const top = rider(s, r.ranking[0].riderId);
  const out: Line[] = [
    j(`Wat een finish. ${first(top.name)} wint de etappe, en ${winner.name} pakt de meeste punten.`),
    m(`En de rode lantaarn gaat naar ${lantern.name}. Een mooie traditie. Je krijgt er een troostkaart bij.`),
  ];
  const sab = r.sabotages[0];
  if (sab) {
    const from = s.teams.find((t) => t.id === sab.fromTeamId)!;
    const to = s.teams.find((t) => t.id === sab.toTeamId)!;
    out.push(j(`En nu de waarheid: ${from.name} bleek ${CARD_DEFS[sab.def]?.name.toLowerCase() ?? 'sabotage'} te hebben ingezet tegen ${to.name}.`));
  }
  return out;
}

export function finishLines(s: PublicState): Line[] {
  const r = s.season;
  if (!r) return [];
  const winner = s.teams.find((t) => t.id === r.winnerTeamId)!;
  const lantern = s.teams.find((t) => t.id === r.lanterneRougeTeamId)!;
  return [
    j(`Het seizoen is voorbij. ${winner.name} is de grote winnaar en mag de bloemen in ontvangst nemen.`),
    m(`En de rode lantaarn gaat naar ${lantern.name}. Draag hem met trots, want ook dat moet iemand doen.`),
  ];
}

// ---- Tutorial ----------------------------------------------------------------

export type TutorialTopic =
  | 'intro'
  | 'draft'
  | 'team'
  | 'race'
  | 'resolve'
  | 'exhausted'
  | 'results'
  | 'fade'
  | 'season';

/** Uitleg die alleen verschijnt als de tutorial aan staat. Elk onderwerp komt één keer. */
export function tutorialLines(topic: TutorialTopic, s: PublicState): Line[] {
  switch (topic) {
    case 'intro':
      return [
        j('Even hoe dit werkt. Jullie managen elk een ploeg van drie renners en spelen een seizoen van drie etappes.'),
        m('Elke etappe heeft drie delen: eerst de voorbereiding, dan de race, en daarna de uitslag met beloningen.'),
        j('Jullie telefoon is jullie teambord. Op de tv zien jullie de gezamenlijke markt en de race.'),
      ];
    case 'draft':
      return [
        j('We beginnen met de draft. Op de tv ligt een markt met vijf kaarten. Om de beurt pak je er een.'),
        m('Je pakt een kaart uit de markt, of een onbekende van de stapel. Het team onderaan het klassement mag als eerste.'),
        j('Er zijn trainingskaarten, sponsors, staf, materiaal en wagens. En sabotage, voor wie durft.'),
      ];
    case 'team':
      return [
        j('Nu de voorbereiding. Gebruik je kaarten op je telefoon. Een trainingskaart geef je aan een renner, die wordt dan sterker.'),
        m('Maar let op: training kost vermoeidheid. Te veel trainen betekent overtraining, en dan word je juist zwakker.'),
        j('Spullen zoals een sponsor, staf of reservefiets leg je op je bord. Die werken de hele etappe.'),
        m('Met munten koop je extra kaarten in de winkel, en je kunt kaarten ruilen met andere teams. Druk op Klaar als je er zin in hebt.'),
      ];
    case 'race':
      return [
        j('De race begint. Elke ronde kies je per renner een tempo: Rustig, Normaal of Alles geven.'),
        m('Alles geven is het snelst, maar het kost drie energie. Rustig herstelt juist wat. Heb je geen energie meer, dan ben je op de fles.'),
        j('Je energie en je training bepalen hoe ver je rijdt. Hoe beter je voorbereid bent, hoe meer je eruit haalt.'),
      ];
    case 'resolve':
      return [
        m('Kijk naar het peloton. Wie vlak achter een andere renner rijdt, drafting: gratis een extra tegel.'),
        j('De renner aan kop betaalt de wind: een extra energie. Voorop rijden is dapper, maar het kost wat.'),
        m('En er kan pech zijn. Een lekke band, een val. Een reservefiets of mecanicien vangt dat op.'),
      ];
    case 'exhausted':
      return [
        j('Een renner zonder energie is op de fles. Die kan niet meer vol gas en rijdt een tegel minder.'),
        m('Los het op door Rustig te rijden, of met een soigneur, een volgauto of voeding in de voorbereiding.'),
      ];
    case 'results':
      return [
        j('De uitslag. De top zes renners scoort punten, en elk team krijgt munten voor de einduitslag en voor sponsors.'),
        m('Het podium krijgt bonuskaarten. De rode lantaarn krijgt een troostkaart en twee munten, zodat je kunt terugkomen.'),
        j('Let op: je training vervaagt na elke etappe met één punt. Wat je nu opbouwt, is straks deels weg.'),
      ];
    case 'fade':
      return [
        m('Je renners zijn ouder en moe. Training vervaagt, en vermoeidheid zakt maar langzaam. Plan je rustdagen.'),
        j('Wie het hele seizoen slim bouwt, is op het einde de sterkste. Succes met etappe twee.'),
      ];
    case 'season':
      return [
        j('Na drie etappes tellen we de punten op. Wie het meeste heeft, wint het seizoen. De laatste krijgt de rode lantaarn.'),
      ];
  }
}

export function whoIs(id: CommentatorId): string {
  return COMMENTATORS[id].name;
}

export { KIND_LABELS };
