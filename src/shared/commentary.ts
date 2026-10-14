// Commentaar: twee commentatoren die vol ernst een licht absurde wielerwedstrijd beschrijven.
// Regels vermijden persoonlijke voornaamwoorden: renners worden bij naam genoemd.
// Met de tutorial aan leggen ze daarnaast per onderdeel uit hoe het spel werkt.

import { CARD_DEFS, COMMENTATORS, EVENTS, KIND_LABELS, PREMIE_INFO, QUIRKS, RIDER_TYPES, STAGE_INFO, WEATHER } from './content';
import type { CommentatorId } from './content';
import type { PublicState, Rider } from './types';
import { STAGES } from './types';

export interface Line {
  speaker: CommentatorId;
  text: string;
}

const j = (text: string): Line => ({ speaker: 'johan', text });
const m = (text: string): Line => ({ speaker: 'marieke', text });
const f = (text: string): Line => ({ speaker: 'fenna', text });
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
  if (socks) {
    out.push(
      m(
        choice([
          `${first(socks.name)} draagt verschillende sokken. Dat baart me zorgen.`,
          `Ik heb de startlijst bekeken. ${first(socks.name)} draagt verschillende sokken. Ik zeg verder niets, maar ik zie het wel.`,
        ]),
      ),
    );
  } else {
    out.push(
      m(
        choice([
          'De benen zien er goed uit en de fietsen glimmen. Iemand gaat dat straks verpesten.',
          'Ik heb de bidons gecontroleerd. Drie ervan bevatten daadwerkelijk water.',
          'Alle renners staan er fris bij. Dat duurt tot de eerste helling, en de eerste helling is dichterbij dan ze denken.',
        ]),
      ),
    );
  }
  return out;
}

export function stageLines(s: PublicState): Line[] {
  const info = STAGE_INFO[Math.min(STAGES, s.stage) - 1];
  const out: Line[] = [j(`${info.name}. ${info.blurb}`)];
  const weather: Record<string, string[]> = {
    dry: [
      'Het weer is droog. De wegen zijn goed, de excuses moeten uit het eigen hoofd komen.',
      'Droog weer. Valpartijen zijn zeldzaam, tenzij iemand zijn best doet.',
    ],
    mixed: [
      'Het weer is wisselvallig. Elke wolk wordt hier met argusogen bekeken.',
      'Wisselvallig weer. Af en toe een bui, dus kijk uit bij natte kasseien en in afdalingen.',
    ],
    rain: [
      'Het regent de hele dag. Afdalingen en kasseien worden spekglad en er wordt veel gevallen.',
      'Regen! De wegen glimmen, de benen glimmen, en de ploegleiders staan met een paraplu de lijst door te nemen.',
    ],
  };
  out.push(m(choice(weather[s.weather] ?? weather.dry)));
  return out;
}

// ---- Rekruteren ---------------------------------------------------------------

export function recruitIntroLines(s: PublicState): Line[] {
  return [
    j(
      choice([
        `Voor de start van het seizoen: de transfermarkt. ${s.teams.length} ploegen kiezen elk drie renners uit dezelfde pool.`,
        `Eerst de renners. ${s.teams.length} ploegen halen elk drie man binnen, uit één grote kring van hoop en spieren.`,
      ]),
    ),
    m(
      choice([
        'Neo-profs zijn gratis, sterren kosten munten. Dat is bij ons precies zoals in het echt, maar dan met minder ruzie.',
        'Een sprinter, een klimmer, een knecht: een ploeg heeft alles nodig. Behalve een plan, dat is optioneel.',
      ]),
    ),
  ];
}

export function namingLines(_s: PublicState): Line[] {
  return [
    j(
      choice([
        'De ploegen zijn compleet. Nu mogen de renners een naam krijgen, of een betere naam.',
        'Elke ploeg heeft zijn renners. Geef ze een naam waar ze trots op kunnen zijn, of een waar de tegenstander van lacht.',
      ]),
    ),
    m('Er is geen haast. Zodra iedereen op klaar drukt, begint de draft.'),
  ];
}

export function recruitLines(teamName: string, r: Rider, price: number): Line[] {
  if (Math.random() > 0.55) return [];
  const type = RIDER_TYPES[r.type].label.toLowerCase();
  const quirk = QUIRKS[r.quirk].label.toLowerCase();
  const n = first(r.name);
  const options: Line[] = [];
  if (price === 0) {
    options.push(
      m(`${teamName} neemt ${n} aan, gratis. Dat noem ik prijsbewust. Of hoopvol.`),
      j(`${n}, ${type}, kost niets. ${teamName} noemt het talentontwikkeling.`),
    );
  } else if (price >= 3) {
    options.push(
      j(`${teamName} betaalt € ${price} voor ${n}. Een ${type} van naam en rugnummer.`),
      m(`€ ${price} voor ${n}. ${teamName} gokt hoog en hoopt op goud.`),
    );
  } else {
    options.push(
      j(`${teamName} pakt ${n}, een ${type}, voor € ${price}.`),
      m(`${n} gaat naar ${teamName}. ${quirk[0].toUpperCase()}${quirk.slice(1)}, staat in de papieren. Dat wordt een leuke bus.`),
    );
  }
  if (r.quirk === 'socks') options.push(m(`En ${n} draagt verschillende sokken. ${teamName} heeft dat gezien, en gekocht.`));
  return [choice(options)];
}

/** Bij de start van de race: wie is de kopman van wie. */
export function kopmanLines(s: PublicState): Line[] {
  const picks = s.teams
    .map((t) => {
      const id = s.kopman[t.id];
      const r = id ? s.riders.find((x) => x.id === id) : null;
      return r ? { rider: first(r.name), team: t.name } : null;
    })
    .filter((x): x is { rider: string; team: string } => !!x);
  if (picks.length === 0) return [];
  const p = choice(picks);
  return [
    m(
      choice([
        'De kopmannen zijn bekend. Hun punten tellen dubbel, dus let op de knechten.',
        `${p.rider} is kopman van ${p.team}. De knechten zijn gewaarschuwd en hebben al gezucht.`,
        `De kopmannen zijn bekend. Voor de knechten betekent dat: veel werk, weinig foto's.`,
      ]),
    ),
  ];
}

export function pickLines(teamName: string, def: string): Line[] {
  const d = CARD_DEFS[def];
  if (!d) return [];
  const bits: Record<string, string[]> = {
    training: [
      'Daar wordt hard voor getraind.',
      'Wie traint, die wint. In theorie.',
      'Dat doet pijn, maar het is de goede soort pijn.',
      'Trainen is lijden met een plan.',
    ],
    sponsor: [
      'Dat is een slimme zet: geld is altijd welkom.',
      'Een sponsor in de pocket. Dat komt goed uit.',
      'Eindelijk kan de ploegleider stoppen met bidons vullen uit de kraan van het hotel.',
      'De sponsor krijgt de naam op de broek, en niemand vraagt hoe dat voelt.',
    ],
    staff: [
      'Goede staf is goud waard.',
      'Dat wordt een drukke dag voor de staf.',
      'Altijd handig: iemand met een pleister, een mening en een koffer vol ideeën.',
    ],
    material: [
      'Goed materiaal maakt het verschil.',
      'Het materiaal gaat een stap vooruit.',
      'Duur materiaal: de beste manier om de benen een excuus te geven.',
    ],
    car: [
      'Een ploegwagen volgt je door dik en dun.',
      'De wagen rijdt straks mooi achter de groep.',
      'In de volgauto zitten de beste stoelen van de hele koers. Dat is geen toeval.',
    ],
    sabotage: [
      'Hm. Dat is geen vriendelijke kaart.',
      'Iemand heeft kwaad in de zin.',
      'Ik zeg niets, maar ik zie wel een heel onschuldig gezicht.',
    ],
  };
  const t = `${teamName} pakt ${d.name}. ${choice(bits[d.kind] ?? [''])}`.trim();
  return Math.random() < 0.25 ? [(Math.random() < 0.5 ? j : m)(t)] : [];
}

export function teamPhaseLines(s: PublicState): Line[] {
  return [
    j(
      choice([
        `Voorbereiding voor etappe ${s.stage}. De ploegen trainen, kopen spullen en beraden zich over hun tactiek.`,
        `Voorbereiding voor etappe ${s.stage}. De ploegen trainen, kopen spullen en doen alsof er een plan is.`,
        `Voorbereiding voor etappe ${s.stage}. In de ploegbussen wordt hard nagedacht, of in elk geval hard gekeken.`,
      ]),
    ),
  ];
}

/** Op de gebeurtenis zelf: bij een gewone omstandigheid één regel, bij nieuws uit de berm twee. */
export function eventLines(s: PublicState): Line[] {
  const lines = eventLinesFull(s);
  if (!s.event) return lines;
  return EVENTS[s.event.id].silly ? lines : lines.slice(0, 1);
}

function eventLinesFull(s: PublicState): Line[] {
  if (!s.event) return [];
  const def = EVENTS[s.event.id];
  const target = s.event.targetRiderId ? rider(s, s.event.targetRiderId) : null;
  const team = s.event.targetTeamId ? teamLabel(s, s.event.targetTeamId) : null;
  const name = target ? first(target.name) : null;
  const head = `Ronde ${s.round}.`;
  switch (s.event.id) {
    case 'calm':
      return [
        j(
          choice([
            `${head} Rustig weer. Niets te melden. Dat is altijd het moment waarop er iets gebeurt.`,
            `${head} Zonnig en windstil. Het peloton ziet eruit als een schoolreisje, maar dan met kuitspieren.`,
            `${head} Er gebeurt niets. Ik vul de stilte met mijn eigen ademhaling.`,
          ]),
        ),
      ];
    case 'tailwind':
      return [
        j(
          choice([
            `${head} Meewind. Iedereen krijgt een duwtje, en iedereen doet alsof het talent is.`,
            `${head} De wind zit mee. Gratis snelheid, en niemand die klaagt.`,
          ]),
        ),
      ];
    case 'headwind':
      return [
        j(
          choice([
            `${head} Tegenwind. De renners voelen elke meter, en de meters voelen terug.`,
            `${head} Tegenwind. Windgeharde renners lachen erom, de rest lijdt in stilte.`,
          ]),
        ),
      ];
    case 'crosswind':
      return [
        j(
          choice([
            `${head} Zijwind! Het peloton splitst in waaiers, en iedereen is plotseling erg individualistisch.`,
            `${head} Zijwind, dus geen drafting. Iedereen staat er alleen voor, net als op een kerstdiner.`,
          ]),
        ),
      ];
    case 'rain':
      return [
        j(
          choice([
            `${head} Het regent. Afdalingen en kasseien zijn spekglad en spatborden waren leuk geweest.`,
            `${head} Regen! Afdalingen en kasseien zijn glad. Er zijn nu twee soorten renners: bang en nat.`,
          ]),
        ),
      ];
    case 'feedzone':
      return [
        j(
          choice([
            `${head} De bevoorrading! Soigneurs delen tassen uit en iedereen krijgt twee energie terug.`,
            `${head} Bevoorrading. Er wordt naar bananen gegrepen alsof het goudstaven zijn. Iedereen krijgt twee energie.`,
          ]),
        ),
      ];
    case 'crowd':
      return [
        j(
          choice([
            `${head} Het publiek juicht op de klim. Plus één op elke klim, en de kinderen met de toeters verdienen een medaille.`,
            `${head} Joelend publiek langs de berg. Een man in een zwembroek rent mee. Klimmen is plus één.`,
          ]),
        ),
      ];
    case 'chicken': {
      const who = name ?? 'De koploper';
      return choice([
        [
          j(`${head} Ongelooflijke taferelen. Een toeschouwer in kippenpak staat op de weg!`),
          m(`${who} voorop moet remmen. Min twee. Kippen hebben voorrang, dat staat in geen enkel reglement maar het is wel zo.`),
        ],
        [
          j(`${head} Er is een kip op het parcours! Of een man in een kippenpak. Dat is niet bevestigd.`),
          m(`${who} voorop moet remmen. Min twee. Ik denk niet dat de kip er van onder de indruk is.`),
        ],
        [
          j(`${head} Een kippenpak op de weg. De koploper kijkt, de kip kijkt terug.`),
          m(`Dat kost ${who} twee tegels. De kip heeft zich er niet voor verontschuldigd.`),
        ],
      ]);
    }
    case 'wrongTurn': {
      const t = team ?? 'een team';
      return choice([
        [
          j(`${head} ${team ?? 'Een team'} heeft problemen. De volgauto volgt de verkeerde bus.`),
          m('Dat is een drama voor de moraal en voor de bidons. Min één per renner.'),
        ],
        [
          j(`${head} De volgauto van ${t} rijdt achter de verkeerde bus aan. Dat is een bruiloft, geen ploegleiding.`),
          m('Het navigatiesysteem is nog niet aan het woord geweest. Min één per renner.'),
        ],
        [
          j(`${head} ${team ?? 'Een team'} is de volgauto kwijt. Die staat inmiddels bij een kermis.`),
          m('Ik zie een ploegleider met een plattegrond, en dat is nooit een goed teken. Min één per renner.'),
        ],
      ]);
    }
    case 'sandwich': {
      const who = name ?? 'een renner';
      return choice([
        [
          j(`${head} Een soigneur geeft ${who} een broodje. Niemand weet wat erop zit.`),
          m('Plus drie snelheid, min twee energie. Afwegingen, Johan.'),
        ],
        [
          j(`${head} ${who} krijgt een broodje aangereikt. Niemand weet wie het gesmeerd heeft.`),
          m('Drie tegels extra, twee energie minder. Dit soort broodjes staat niet op de bevoorradingskaart, Johan.'),
        ],
        [
          j(`${head} Een soigneur duwt ${who} een broodje in de hand en rent weg.`),
          m('Dat is een verdacht broodje, Johan. Plus drie beweging, min twee energie. Er zat dus iets in.'),
        ],
      ]);
    }
    case 'cow':
      return choice([
        [
          j(`${head} Er staat een koe op de weg. Een rustige koe. Een koe met een plan.`),
          m('Niemand wil in het wiel van een koe. Geen drafting deze ronde, en niemand die dat jammer vindt.'),
        ],
        [
          j(`${head} Een koe op het parcours. De koe kijkt naar het peloton met de rust van een wereldkampioen.`),
          m('Geen drafting deze ronde. Niemand wil een koe passeren op haar eigen terrein.'),
        ],
        [
          j(`${head} Een koe midden op de weg. De ploegleiders doen alsof ze overleg hebben, maar de koe beslist.`),
          m('Geen drafting deze ronde. Iedereen rijdt om de koe heen, op eigen risico.'),
        ],
      ]);
    case 'tractor':
      return choice([
        [
          j(`${head} Een tractor rijdt voor het peloton uit. Het is geen koersvoertuig, maar niemand durft het te zeggen.`),
          m('Op het vlakke is het min één voor iedereen. De boer zwaait vriendelijk, en dat maakt het erger.'),
        ],
        [
          j(`${head} Een tractor tuft voor de kop. De boer heeft de koers niet aangekondigd gekregen.`),
          m('Min één op het vlakke. Dit is de enige keer dat een renner blij is met een berg.'),
        ],
      ]);
    case 'goat':
      return choice([
        [
          j(`${head} Een berggeit passeert de klimmers zonder zichtbare moeite.`),
          m('Klimmen is min één. Een geit klimt omdat het kan, de rest klimt omdat het moet.'),
        ],
        [
          j(`${head} Er staat een geit langs het parcours, en die klimt beter dan de halve ploeg.`),
          m('Dit is een persoonlijke belediging voor de klimmers. Min één op de klim.'),
        ],
      ]);
    case 'selfie': {
      const who = name ?? 'een renner';
      return choice([
        [
          j(`${head} Een toeschouwer maakt een selfie midden op de weg, met ${who} op de achtergrond.`),
          m(`${who} remt en lacht netjes mee. Min twee. Die foto staat vanavond overal.`),
        ],
        [
          j(`${head} Selfiestick op het parcours! ${who} moet eromheen.`),
          m(`${who} remt en kijkt even in de lens. Min twee, maar de foto is uitstekend.`),
        ],
      ]);
    }
    case 'bbq':
      return choice([
        [
          j(`${head} Langs de route staat een barbecue. De geur van worst waait over het peloton.`),
          m('Iedereen krijgt een energie erbij, maar rijdt een tegel minder. Dat is wat afleiding doet.'),
        ],
        [
          j(`${head} Er wordt gebarbecued langs de weg, en het peloton kijkt mee.`),
          m('Plus één energie, min één beweging. Vraag me niet hoe, het is het worst-effect.'),
        ],
      ]);
    case 'oil':
      return choice([
        [
          j(`${head} Een olievlek op de weg. Een tractor heeft een fors spoor achtergelaten.`),
          m('Iedereen zoekt het droge stuk. De valkans gaat omhoog, en ploegleiders slaan de handen voor het gezicht.'),
        ],
        [
          j(`${head} Er ligt olie op het parcours, in een mooie regenboog.`),
          m('Dat ziet er prachtig uit en het gaat fout aflopen. De valkans stijgt.'),
        ],
      ]);
    case 'storm':
      return choice([
        [
          j(`${head} Onweer! De lucht is zwart en de bliksem is dichtbij.`),
          m('Iedereen rijdt min één en er wordt veel gevallen. Een paraplu helpt niet, dat hebben we al geprobeerd.'),
        ],
        [
          j(`${head} Onweer boven het peloton. De donder klinkt als een slecht geplaatste trommelaar.`),
          m('Min één voor iedereen en de valkans stijgt. De ploegleiders bidden, in alle stijlen.'),
        ],
      ]);
    case 'mist':
      return [
        j(`${head} Dikke mist. Je ziet het achterwiel nog net.`),
        m('Afdalingen zijn min één, en vallen is iets waarschijnlijker. Het peloton rijdt op gehoor.'),
      ];
    case 'nails':
      return choice([
        [
          j(`${head} Iemand heeft punaises over de weg uitgestrooid. Spijkerveld!`),
          m('De kans op pech is veel groter deze ronde. Zet de volgauto bij de renner die het meeste last van zijn banden heeft.'),
        ],
        [
          j(`${head} Er ligt een doos punaises op het parcours. Niemand weet waar die vandaan komt, iedereen weet wie het gedaan heeft.`),
          m('Pech is veel waarschijnlijker. Dit is een ronde voor reservefietsen en een stevig gebed.'),
        ],
      ]);
    case 'blessing':
      return [
        j(`${head} Een pastoor staat langs de weg en zwaait wijwater over het peloton.`),
        m('Deze ronde geen pech. Dat is bijzonder, en we zijn de pastoor zeer erkentelijk.'),
      ];
    case 'wasps': {
      const who = name ?? 'een renner';
      return choice([
        [
          j(`${head} Een wespennest in de bidonhouder van ${who}!`),
          m(`${who} heeft het plotseling heel druk met andere dingen dan fietsen. Min drie.`),
        ],
        [
          j(`${head} Wespen! ${who} zit er middenin.`),
          m(`Min drie voor ${who}. Hij gaat sneller dan hij wilde, maar de verkeerde kant op.`),
        ],
      ]);
    }
    case 'drone': {
      const who = name ?? 'De koploper';
      return [
        j(`${head} Een tv-drone hangt boven het peloton en ${who} kijkt omhoog.`),
        m(`${who} zwaait naar de camera en verliest een tegel. Dat is de prijs van roem.`),
      ];
    }
    case 'fanBottle': {
      const who = name ?? 'een renner';
      return choice([
        [
          j(`${head} Een fan rent mee met een bidon voor ${who}.`),
          m('Een bidon, een duwtje en twee energie erbij. Dit is een mooie fan.'),
        ],
        [
          j(`${head} Een fan met bidon en een hart van goud rent naast ${who}.`),
          m(`${who} drinkt, krijgt plus één en twee energie erbij. Niemand heeft het gezien, behalve iedereen.`),
        ],
      ]);
    }
    case 'dogRun': {
      const who = name ?? 'een renner';
      return choice([
        [
          j(`${head} Een hond rent een stuk mee met het peloton, kwispelend.`),
          m(`${who} krijgt er vleugels van. Plus twee. De hond blijft bescheiden.`),
        ],
        [
          j(`${head} Een hond rent over de weg en kiest ${who} als nieuwe vriend.`),
          m('Plus twee tegels voor de renner, en een extra koekje voor de hond.'),
        ],
      ]);
    }
    case 'detour':
      return [
        j(`${head} Omleiding! Het peloton gaat rechts, de pijl wijst links.`),
        m('Geen drafting deze ronde. Iedereen kiest zelf een kant, en alle kanten zijn fout.'),
      ];
    case 'mascot':
      return [
        j(`${head} Een mascotte op een eenwieler rijdt voor het peloton uit.`),
        m('Op het vlakke plus één voor iedereen. Dit is de gelukkigste ronde voor de eenwieler sinds de uitvinding.'),
      ];
    case 'grandma': {
      const who = name ?? 'een renner';
      return choice([
        [
          j(`${head} Oma staat langs de kant met koffie en een koek voor ${who}.`),
          m('Drie energie erbij. Oma is de beste soigneur van de koers, en dat zeggen we niet zomaar.'),
        ],
        [
          j(`${head} Oma met een thermoskan. ${who} krijgt koffie aangereikt.`),
          m('Plus drie energie. Er zit een speculaasje bij, en dat telt ook mee.'),
        ],
      ]);
    }
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

  const top = rep.premies.find((h) => h.points === 3);
  if (top && !rep.finished) {
    const r = rider(s, top.riderId);
    const label = PREMIE_INFO[top.premieId].label.toLowerCase();
    const team = teamLabel(s, r.teamId);
    out.push(
      j(
        choice([
          `${first(r.name)} wint de ${label} en pakt drie punten voor ${team}.`,
          `${first(r.name)} is het snelst bij de ${label} en neemt drie punten mee naar ${team}.`,
          `Drie punten bij de ${label}: ${first(r.name)} was er als eerste en ${team} is daar blij mee.`,
        ]),
      ),
    );
  }

  if (rep.finished) {
    out.push(
      j(
        choice([
          `${first(leader.name)} komt als eerste over de streep! ${teamLabel(s, leader.teamId)} wint de etappe.`,
          `${first(leader.name)} wint de etappe voor ${teamLabel(s, leader.teamId)}, met de armen in de lucht en een gezicht dat zegt: ik wist het.`,
        ]),
      ),
    );
    return out;
  }

  const togo = Math.max(0, s.trackLength - Math.floor(leader.pos));
  if (leader.id !== prev.id && leader.teamId !== prev.teamId) {
    const team = teamLabel(s, leader.teamId);
    out.push(
      j(
        choice([
          `${first(leader.name)} neemt de leiding over voor ${team}.`,
          `${first(leader.name)} neemt de kop. ${first(prev.name)} heeft nu een mooi uitzicht op het achterwiel.`,
          `${first(leader.name)} pakt de leiding voor ${team}. ${first(prev.name)} mag het achterwiel bewonderen.`,
        ]),
      ),
    );
  } else {
    out.push(
      j(
        choice([
          `${first(leader.name)} blijft aan kop. Nog ${togo} tegels te gaan.`,
          `${first(leader.name)} blijft voorop. Nog ${togo} tegels, en niemand die het overneemt.`,
          `Nog ${togo} tegels, en ${first(leader.name)} wil gewoon niet opgeven.`,
        ]),
      ),
    );
  }

  // Wat de ploegen deze ronde uit de kast haalden: blokkades eerst, die zijn het meest dramatisch.
  const plays = [...rep.plays].sort((a, b) => Number(b.item === 'blok') - Number(a.item === 'blok'));
  const play = plays[0];
  if (play) {
    const who = first(rider(s, play.riderId).name);
    const owner = teamLabel(s, play.teamId);
    if (play.item === 'blok' && play.targetRiderId) {
      const t = first(rider(s, play.targetRiderId).name);
      out.push(
        m(
          choice([
            `${who} knijpt ${t} dicht! Geen wiel om te volgen, en twee tegels verlies. Dat was ${owner}.`,
            `${who} sluit de deur voor ${t}. Twee tegels verlies en geen wiel. ${owner} zet de handtekening eronder.`,
            `Blokkade van ${who}! ${t} rijdt tegen een muur en ${owner} kijkt onschuldig de andere kant op.`,
          ]),
        ),
      );
    } else if (play.item === 'gel') {
      out.push(
        m(
          choice([
            `${who} eet een gelletje. Nieuwe energie op het juiste moment, mooi gedaan van ${owner}.`,
            `${who} knijpt een gel leeg. Het smaakt naar kunstmatige aardbei en het doet wonderen.`,
            `Een gelletje voor ${who}. Niemand weet wat erin zit, maar de benen vinden het prima.`,
          ]),
        ),
      );
    } else if (play.item === 'cola') {
      out.push(
        m(
          choice([
            `${who} schroeft een flesje cola open en schiet naar voren. Drie tegels extra voor ${owner}.`,
            `${who} drinkt cola en vertrekt als een fles die te lang is geschud. Drie tegels extra voor ${owner}.`,
            `Een flesje cola, en ${who} is een raket. Drie tegels erbij voor ${owner}.`,
          ]),
        ),
      );
    }
  }

  const pech = rep.moves.filter((x) => x.pech);
  const shielded = rep.moves.filter((x) => x.shielded);
  const empty = rep.moves.filter((x) => x.exhausted);
  const flying = [...rep.moves].sort((a, b) => b.to - b.from - (a.to - a.from))[0];

  const falls = rep.moves.filter((x) => x.crash === 'fall');
  const dominoes = rep.moves.filter((x) => x.crash === 'domino');
  const alone = rep.moves.find((x) => x.groupSize <= 2 && x.parts.draft < 0 && x.to >= leader.pos - 1);

  if (falls.length > 0) {
    const f0 = falls.find((x) => x.injured) ?? choice(falls);
    const n = first(rider(s, f0.riderId).name);
    const team = teamLabel(s, rider(s, f0.riderId).teamId);
    if (dominoes.length > 0) {
      const d = first(rider(s, choice(dominoes).riderId).name);
      out.push(
        m(
          choice([
            `Valpartij! ${n} gaat onderuit en ${d} kan er niet meer omheen. Dat is een rommeltje van fietsen en benen.`,
            `${n} valt, en ${d} valt mee. Dit ziet er niet goed uit voor ${team}.`,
          ]),
        ),
      );
    } else if (f0.injured) {
      out.push(
        m(
          choice([
            `${n} gaat onderuit en blijft even liggen. Dat ziet er niet goed uit voor ${team}: een blessure voor de volgende etappe.`,
            `Zware val voor ${n}. Opstaan lukt, maar de benen herinneren zich dit morgen nog.`,
          ]),
        ),
      );
    } else {
      out.push(
        m(
          choice([
            `${n} valt! Op, afstoffen en door, want het peloton wacht niet.`,
            `${n} glijdt weg in de bocht. Een schaafwond, een flinke schrik, en vijf tegels verlies.`,
            `Val van ${n}. Het fietsframe heeft meer last van de grond dan andersom.`,
          ]),
        ),
      );
    }
  } else if (alone && s.round > 1 && Math.random() < 0.7) {
    const n = first(rider(s, alone.riderId).name);
    out.push(
      m(
        choice([
          `${n} rijdt alleen in de wind. Dapper, en een tikje eenzaam. Het peloton is al onderweg.`,
          `${n} probeert het solo. De wind komt van voren en de achtervolgers weten het.`,
          `${n} heeft een gat geslagen, maar het peloton ruikt bloed.`,
        ]),
      ),
    );
  } else if (pech.length > 0) {
    const n = first(rider(s, choice(pech).riderId).name);
    out.push(
      m(
        choice([
          `${n} heeft pech. Een lekke band op het slechtst denkbare moment.`,
          `Lekke band voor ${n}. Dit gebeurt altijd op het moment dat het er toe doet.`,
          `${n} stopt langs de kant met pech. De monteur rent, en ook dat is een sport.`,
        ]),
      ),
    );
  } else if (shielded.length > 0) {
    const n = first(rider(s, shielded[0].riderId).name);
    out.push(
      m(
        shielded[0].car
          ? choice([
              `Pech voor ${n}, maar de volgauto rijdt er precies naast. Nieuw wiel erin en door.`,
              `Een lekke band bij ${n}, en de volgauto is er in een seconde. Dat heet vooruitdenken.`,
            ])
          : choice([
              `Pech voor ${n}, maar de reservefiets staat klaar. Dat scheelt een heleboel.`,
              `Pech bij ${n}, en de reservefiets staat al klaar. Dat heet huiswerk maken.`,
            ]),
      ),
    );
  } else if (empty.length > 0) {
    const n = first(rider(s, choice(empty).riderId).name);
    out.push(
      m(
        choice([
          `${n} is op de fles. De benen zijn leeg, en dat zie je.`,
          `${n} is leeg. De benen draaien nog, maar alleen uit gewoonte.`,
          `Op de fles bij ${n}. Daar helpt geen bidon meer tegen, wel misschien een stevig gebed.`,
        ]),
      ),
    );
  } else if (flying && flying.to - flying.from >= 8) {
    const n = first(rider(s, flying.riderId).name);
    const d = flying.to - flying.from;
    out.push(
      m(
        choice([
          `${n} vliegt. ${d} tegels in één ronde.`,
          `${n} vliegt weg met ${d} tegels in één ronde. Niemand weet waar dat vandaan komt.`,
          `${d} tegels in één ronde voor ${n}. Dat zijn geen benen meer, dat zijn raketten.`,
        ]),
      ),
    );
  } else {
    const wind = rep.moves.find((x) => x.windPaid);
    if (wind) {
      const r = rider(s, wind.riderId);
      const n = first(r.name);
      const team = teamLabel(s, r.teamId);
      out.push(
        m(
          choice([
            `${n} doet al het werk aan kop. Dat gaat ${team} nog kosten.`,
            `${n} zet zich voorop in de wind. Dapper, en een tikje onverstandig voor ${team}.`,
          ]),
        ),
      );
    }
  }

  const helpers = rep.moves.filter((x) => x.helping);
  if (helpers.length > 0 && out.length < 2) {
    const h = first(rider(s, helpers[0].riderId).name);
    out.push(
      j(
        choice([
          `${h} zet de eigen race opzij en trekt de kopman mee. Dat is ploegentactiek.`,
          `${h} trekt de kopman mee en vraagt niets terug. Behalve misschien een biertje.`,
        ]),
      ),
    );
  }

  const car = rep.moves.find((x) => x.car && x.energyAfter < (rider(s, x.riderId).maxEnergy ?? 0) / 2);
  if (car && out.length < 2) {
    const n = first(rider(s, car.riderId).name);
    out.push(
      j(
        choice([
          `De volgauto komt langszij bij ${n}. Een bidon en een duwtje: dat scheelt.`,
          `De volgauto geeft ${n} een bidon aan en een klopje op de schouder. Dat helpt vooral voor de moraal.`,
        ]),
      ),
    );
  }

  // Als er niets bijzonders te melden valt, vult Marieke de stilte met een observatie.
  if (out.length < 2 && Math.random() < 0.3) {
    const socks = s.riders.find((r) => r.quirk === 'socks');
    const any = first(choice(s.riders).name);
    const quips = [
      `${any} kijkt naar het achterwiel voor zich alsof het een goed boek is.`,
      `Het peloton is stil. Alleen de kettingen praten, en die zeuren.`,
      `Ergens achterin vraagt een renner zich af waarom dit ooit een goed idee leek.`,
      `Aan de kant staat een man met een bord. Er staat 'Hup' op. Meer is ook niet nodig.`,
      `${any} kijkt even naar de bidon alsof daar de uitslag in staat.`,
      `De ploegleiders zijn rustig. Dat zijn ze nooit, dus dit is verdacht.`,
      `In een volgauto gaat een zak chips open. Dat is geen gerucht, dat is geluid.`,
    ];
    if (socks && Math.random() < 0.4) {
      const n = first(socks.name);
      out.push(
        m(
          choice([
            `Ik moet de sokken van ${n} nog even noemen. Eén is groen, de ander ook, maar een andere groen.`,
            `Over ${n} gesproken: de sokken zijn nog steeds verschillend. Ik blijf het volgen.`,
            `Voor de goede orde: de sokken van ${n} zijn nog altijd niet gelijk. Ik wil dat hier gezegd hebben.`,
          ]),
        ),
      );
    } else out.push(m(choice(quips)));
  }
  return out.slice(0, 2);
}

export function stageResultLines(s: PublicState): Line[] {
  const r = s.stageResult;
  if (!r) return [];
  const winnerTeam = [...r.teams].sort((a, b) => b.stagePoints - a.stagePoints)[0];
  const winner = s.teams.find((t) => t.id === winnerTeam.teamId)!;
  const lantern = s.teams.find((t) => t.id === r.lanterneRougeTeamId)!;
  const top = first(rider(s, r.ranking[0].riderId).name);
  const out: Line[] = [
    j(
      choice([
        `Wat een finish. ${top} wint de etappe, en ${winner.name} pakt de meeste punten.`,
        `Dat was een etappe om in te lijsten. ${top} wint, en ${winner.name} pakt de meeste punten.`,
      ]),
    ),
    m(
      choice([
        `En de rode lantaarn gaat naar ${lantern.name}. Een mooie traditie. Je krijgt er een troostkaart bij.`,
        `De rode lantaarn is voor ${lantern.name}. Niemand wil hem, maar er hoort een troostkaart bij.`,
        `${lantern.name} neemt de rode lantaarn in ontvangst. Ik zeg altijd: iemand moet de weg verlichten.`,
      ]),
    ),
  ];
  const sab = r.sabotages[0];
  if (sab) {
    const from = s.teams.find((t) => t.id === sab.fromTeamId)!;
    const to = s.teams.find((t) => t.id === sab.toTeamId)!;
    const card = CARD_DEFS[sab.def]?.name.toLowerCase() ?? 'sabotage';
    out.push(
      j(
        choice([
          `En nu de waarheid: ${from.name} bleek ${card} te hebben ingezet tegen ${to.name}.`,
          `Er is een onthulling: ${from.name} had ${card} klaarliggen voor ${to.name}. Beleefdheid is ver te zoeken.`,
          `Het gerucht klopt: ${from.name} zette ${card} in tegen ${to.name}. Daarbij keek ${from.name} onschuldig de andere kant op.`,
        ]),
      ),
    );
  }
  return out;
}

export function finishLines(s: PublicState): Line[] {
  const r = s.season;
  if (!r) return [];
  const winner = s.teams.find((t) => t.id === r.winnerTeamId)!;
  const lantern = s.teams.find((t) => t.id === r.lanterneRougeTeamId)!;
  return [
    j(
      choice([
        `Het seizoen is voorbij. ${winner.name} is de grote winnaar en mag de bloemen in ontvangst nemen.`,
        `Het seizoen is voorbij. ${winner.name} wint, en krijgt een bos bloemen die al drie dagen in de bus lag.`,
      ]),
    ),
    m(
      choice([
        `En de rode lantaarn gaat naar ${lantern.name}. Draag hem met trots, want ook dat moet iemand doen.`,
        `De rode lantaarn is voor ${lantern.name}. Draag hem met trots: wie laatste is, heeft het langst van het parcours genoten.`,
        `En dan ${lantern.name}, met de rode lantaarn. Een lantaarn geeft licht, en dat is ook iets.`,
      ]),
    ),
  ];
}

// ---- Tutorial ----------------------------------------------------------------

export type TutorialTopic =
  | 'recruit'
  | 'draft'
  | 'team'
  | 'train'
  | 'trade'
  | 'race'
  | 'items'
  | 'resolve'
  | 'exhausted'
  | 'results'
  | 'fade';

/**
 * Herinneringen die alleen verschijnen als de tutorial aan staat, één keer per onderwerp.
 * De essentie van het spel staat in BRIEFING en wordt vooraf getoond, zonder timer.
 */
export function tutorialLines(topic: TutorialTopic, _s: PublicState): Line[] {
  switch (topic) {
    case 'recruit':
      return [
        f('Het seizoen begint met rekruteren. Om de beurt kies je een renner uit de pool, drie keer.'),
        f('Neo-profs zijn gratis, talenten en sterren kosten munten. Maak een mix: een klimmer voor de bergen, een sprinter voor de finish, en misschien een knecht.'),
      ];
    case 'draft':
      return [
        f('De draft. Om de beurt pak je een kaart uit de markt, of je trekt een onbekende van de stapel.'),
        f('Het team onderaan het klassement begint. Kijk naar het parcours: klimkaarten zijn goud waard in de bergen.'),
      ];
    case 'team':
      return [
        f('Voorbereiding. Begin bij Plan: kies je kopman. Zijn punten tellen dubbel, dus kies de renner die bij het parcours past.'),
        f('Train hem, leg spullen op je bord en druk op Klaar. De race begint zodra iedereen klaar is.'),
      ];
    case 'train':
      return [
        f('Een tip over training. Een trainingskaart geef je aan een renner. Die wordt sterker, maar ook vermoeider.'),
        f('Te vermoeid betekent overtraind, en dan word je juist zwakker. Een rustdag of fysiotherapeut helpt.'),
      ];
    case 'trade':
      return [f('Je mag ook ruilen. Kies een team, zeg wat je geeft en wat je vraagt. Praat er gewoon over aan tafel. Een pokerface helpt, maar is niet verplicht.')];
    case 'race':
      return [
        f('De race. Elke ronde kies je per renner Rustig, Normaal of Alles geven. Let op je energie en op de premies.'),
        f('Een knecht in de buurt van de kopman kan helpen: dan trekt hij de kopman twee tegels mee, en rijdt zelf geen tempo.'),
      ];
    case 'items':
      return [
        f('Naast het tempo kies je elke ronde waar de volgauto rijdt. Die renner krijgt een slok energie erbij, dus zet hem bij wie het nodig heeft.'),
        f('Een gel geeft meteen vier energie, een cola drie tegels. Een blokkade werkt alleen op een tegenstander binnen drie tegels van een knecht.'),
      ];
    case 'resolve':
      return [
        f('Kijk naar het peloton. Wie vlak achter een andere renner rijdt, drafting: gratis één extra tegel.'),
        f('De renner aan kop betaalt de wind, een extra energie. In een peloton van drie of meer rijd je lichter, en alleen rijden kost extra.'),
      ];
    case 'exhausted':
      return [
        f('Een renner zonder energie is op de fles. Die kan niet meer vol gas en rijdt een tegel minder. Dat krijg je ervan als je alles geeft en de rest vergeet.'),
        f('Los het op door Rustig te rijden, een gel te eten, de volgauto bij die renner te zetten, of met een soigneur of voeding in de voorbereiding.'),
      ];
    case 'results':
      return [
        f('De uitslag. De top zes renners scoort punten, de kopman dubbel, en de premies komen daar bovenop.'),
        f('De winnaar krijgt een bonuskaart. Het team onderaan het klassement krijgt extra hulp: twee kaarten en twee munten.'),
      ];
    case 'fade':
      return [
        f('Let op: training vervaagt na elke etappe met één punt, en vermoeidheid zakt maar langzaam. Plan je rustdagen. Net als een goede vakantie: sneller weg dan je hoopt.'),
      ];
  }
}

export function whoIs(id: CommentatorId): string {
  return COMMENTATORS[id].name;
}

export { KIND_LABELS };
