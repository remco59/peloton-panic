// Alle spelinhoud (Nederlands): kaarten, renners, gebeurtenissen, commentatoren.

import type { CardKind, ContractKind, Effort, EventId, PremieId, QuirkId, RaceItem, RiderType, Stat, Stats, Terrain, Weather } from './types';

// Team colours avoid red, green and yellow: those carry danger, success and the leader highlight.
// Every team also has a shape, so players who cannot tell two hues apart still can tell the teams apart.
export const TEAM_COLORS = [
  { name: 'Blauw', hex: '#4f8dff', dark: '#2c5bc0', shape: 'circle' },
  { name: 'Paars', hex: '#b27cff', dark: '#7547c2', shape: 'square' },
  { name: 'Cyaan', hex: '#33d3e6', dark: '#16909f', shape: 'triangle' },
  { name: 'Oranje', hex: '#ff8a2b', dark: '#b45a0d', shape: 'diamond' },
  { name: 'Zilver', hex: '#e4e8f2', dark: '#8a93aa', shape: 'hexagon' },
  { name: 'Roze', hex: '#ff7eb8', dark: '#b84a80', shape: 'plus' },
] as const;
export type TeamShape = (typeof TEAM_COLORS)[number]['shape'];

export const STAT_LABELS: Record<Stat, string> = {
  kracht: 'Kracht',
  klim: 'Klimmen',
  sprint: 'Sprint',
  uithouding: 'Uithouding',
};

export const STAT_HELP: Record<Stat, string> = {
  kracht: 'Snelheid op vlak, kasseien en in afdalingen',
  klim: 'Snelheid in de bergen',
  sprint: 'Snelheid in de laatste drie tegels',
  uithouding: 'Bepaalt je energievoorraad in de race',
};

export const RIDER_TYPES: Record<RiderType, { label: string; blurb: string; base: Stats }> = {
  sprinter: {
    label: 'Sprinter',
    blurb: 'Gevaarlijk in de eindsprint',
    base: { kracht: 3, klim: 1, sprint: 4, uithouding: 2 },
  },
  climber: {
    label: 'Klimmer',
    blurb: 'Vliegt de berg op',
    base: { kracht: 2, klim: 4, sprint: 1, uithouding: 3 },
  },
  rouleur: {
    label: 'Rouleur',
    blurb: 'Sterk op het vlakke',
    base: { kracht: 4, klim: 2, sprint: 2, uithouding: 3 },
  },
  puncheur: {
    label: 'Puncheur',
    blurb: 'Houdt van korte, gemene hellingen en kasseien',
    base: { kracht: 3, klim: 3, sprint: 2, uithouding: 2 },
  },
  domestique: {
    label: 'Knecht',
    blurb: 'Zwak in de sprint, maar rijdt eindeloos. Trekt de kopman extra hard mee',
    base: { kracht: 2, klim: 2, sprint: 1, uithouding: 4 },
  },
};

/** Welke types een ploeg als eerste kan rekruteren, in volgorde van voorkomen. */
export const RIDER_TYPE_LIST: RiderType[] = ['sprinter', 'climber', 'rouleur', 'puncheur', 'domestique'];

/** Talent bepaalt prijs en sterkte van een renner in de winkel. `count` is hoeveel er in elke winkel liggen. */
export const TALENT_TIERS = [
  { id: 'neo', label: 'Neo-prof', price: 0, main: -1, extra: 0, count: 3 },
  { id: 'vast', label: 'Vaste waarde', price: 2, main: 0, extra: 0, count: 3 },
  { id: 'talent', label: 'Talent', price: 3, main: 1, extra: 0, count: 2 },
  { id: 'ster', label: 'Ster', price: 5, main: 1, extra: 1, count: 1 },
] as const;

export type WeatherInfo = { label: string; icon: string; blurb: string };
export const WEATHER: Record<Weather, WeatherInfo> = {
  dry: { label: 'Droog', icon: '☀', blurb: 'Droog en zonnig. Valpartijen zijn zeldzaam, tenzij iemand zijn best doet.' },
  mixed: { label: 'Wisselvallig', icon: '⛅', blurb: 'Af en toe een bui. Kijk uit voor natte kasseien en afdalingen.' },
  rain: { label: 'Regen', icon: '☔', blurb: 'De hele etappe nat. Afdalingen en kasseien zijn glad en er wordt veel gevallen.' },
};

export const TERRAINS: Record<Terrain, { label: string; icon: string }> = {
  flat: { label: 'Vlak', icon: '—' },
  climb: { label: 'Klim', icon: '▲' },
  descent: { label: 'Afdaling', icon: '▼' },
  cobbles: { label: 'Kasseien', icon: '▒' },
};

export const EFFORTS: Record<Effort, { label: string; blurb: string; base: number; energy: number }> = {
  rustig: { label: 'Rustig', blurb: 'Langzaam, je herstelt energie', base: 0, energy: +1 },
  normaal: { label: 'Normaal', blurb: 'Stevig tempo, kost 1 energie', base: 2, energy: -1 },
  alles: { label: 'Alles geven', blurb: 'Vol gas, kost 4 energie', base: 4, energy: -4 },
  helpen: { label: 'Helpen', blurb: 'Rijdt rustig en trekt je kopman mee: +3 tegels voor hem', base: 0, energy: +1 },
};

/** De tempo's die je kiest; Helpen is er alleen voor knechten. */
export const PACE_ORDER: Effort[] = ['rustig', 'normaal', 'alles'];

export const PREMIE_INFO: Record<PremieId, { label: string; short: string; blurb: string }> = {
  sprint: { label: 'Tussensprint', short: 'SPRINT', blurb: 'De eerste drie renners over de lijn scoren 3, 2 en 1 punt.' },
  berg: { label: 'Bergpremie', short: 'BERG', blurb: 'De eerste drie renners boven op de berg scoren 3, 2 en 1 punt.' },
};

export const QUIRKS: Record<QuirkId, { label: string; blurb: string }> = {
  croissant: { label: 'Rijdt op croissants', blurb: '+1 extra herstel bij Rustig' },
  waver: { label: 'Zwaait naar iedereen', blurb: '-1 op vlak, +1 op klimmen (groter publiek)' },
  cobbleKing: { label: 'Geboren op kasseien', blurb: '+1 op kasseien' },
  descentFear: { label: 'Bang in afdalingen', blurb: 'Krijgt geen bonus in afdalingen' },
  windHardened: { label: 'Windgehard', blurb: 'Trekt zich niets aan van tegenwind' },
  socks: { label: 'Verschillende sokken', blurb: 'Geen effect. De commentatoren zijn geobsedeerd.' },
  finisher: { label: 'Eindsprint-instinct', blurb: '+1 in de laatste 3 tegels' },
  napper: { label: 'Dutje voor de start', blurb: 'Start de etappe met volle energie' },
  rainKing: { label: 'Regenkoning', blurb: '+1 bij regen, en valt minder snel' },
  sugarCube: { label: 'Suikerklontje', blurb: '-1 bij regen. Staat te fluiten bij een buitje' },
  clumsy: { label: 'Twee linkervoeten', blurb: 'Valt vaker. Staat gelukkig altijd weer op' },
  daredevil: { label: 'Waaghals', blurb: '+1 in afdalingen, maar valt vaker' },
  lucky: { label: 'Geluksvarken', blurb: 'Heeft half zoveel kans op pech' },
};

// ---- Kaarten ---------------------------------------------------------------

export interface Perk {
  income?: number; // sponsor: munten per etappe
  podiumBonus?: number; // sponsor: extra munten bij een renner in de top 3
  winBonus?: number; // sponsor: extra munten als je de etappe wint (de meeste punten)
  pointBonus?: number; // sponsor: munten per POINT_BONUS_STEP etappepunten
  gels?: number; // leverancier: extra gels aan het begin van elke etappe
  colas?: number; // leverancier: extra cola's aan het begin van elke etappe
  startEnergy?: number;
  restBonus?: number; // extra herstel bij Rustig
  allesDiscount?: number; // Alles geven kost zoveel minder
  pechReduction?: number;
  shield?: number; // pechgevallen per etappe die niets kosten
  flat?: number;
  climb?: number;
  descent?: number;
  service?: number; // Volgauto-kaart: de auto geeft meer energie en vangt pech op
  fatigueRecover?: number; // extra herstel na de etappe
  overtrainTolerance?: number;
  wetGrip?: number; // minder valkans bij nat wegdek en geen straf van regen op kasseien en afdalingen
}

export interface CardDef {
  id: string;
  kind: CardKind;
  name: string;
  text: string;
  price: number;
  count: number;
  stats?: Partial<Stats>; // training
  fatigue?: number; // training (negatief = rust)
  perk?: Perk;
  sabotage?: 'spijkers' | 'bidon';
  race?: RaceItem; // racekaart: wordt in de race ingezet, één keer
  contract?: ContractKind; // sponsorcontract: ligt alleen in de winkel, niet in de stapel
  signing?: number; // contract: munten die de sponsor betaalt bij het tekenen
}

export const CONTRACT_LABELS: Record<ContractKind, { label: string; blurb: string }> = {
  cash: { label: 'Direct geld', blurb: 'Betaalt meteen uit, ook als het tegenzit.' },
  bonus: { label: 'Bonus bij succes', blurb: 'Betaalt meer naarmate je beter presteert.' },
  supply: { label: 'Leverancier', blurb: 'Levert gratis spullen: gels, staf, een wagen.' },
};

export const KIND_LABELS: Record<CardKind, string> = {
  training: 'Training',
  sponsor: 'Sponsor',
  staff: 'Staf',
  material: 'Materiaal',
  car: 'Wagen',
  sabotage: 'Sabotage',
  race: 'Koers',
};

export const KIND_COLORS: Record<CardKind, string> = {
  training: '#5eea8d',
  sponsor: '#ffd23f',
  staff: '#6ea8ff',
  material: '#c9a672',
  car: '#c792ea',
  sabotage: '#ff6b6b',
  race: '#ff9f43',
};

const defs: CardDef[] = [
  // Trainingsschema's: direct toepassen op een renner.
  { id: 'duurloop', kind: 'training', name: 'Duurloop', text: 'Uithouding +2. Vermoeidheid +1.', price: 2, count: 3, stats: { uithouding: 2 }, fatigue: 1 },
  { id: 'kracht', kind: 'training', name: 'Krachttraining', text: 'Kracht +2. Vermoeidheid +1.', price: 2, count: 3, stats: { kracht: 2 }, fatigue: 1 },
  { id: 'interval', kind: 'training', name: 'Intervaltraining', text: 'Sprint +2. Vermoeidheid +1.', price: 2, count: 3, stats: { sprint: 2 }, fatigue: 1 },
  { id: 'klimstage', kind: 'training', name: 'Klimstage Pyreneeën', text: 'Klimmen +3. Vermoeidheid +2.', price: 3, count: 2, stats: { klim: 3 }, fatigue: 2 },
  { id: 'hoogte', kind: 'training', name: 'Hoogtestage', text: 'Klimmen +1, Uithouding +1. Vermoeidheid +1.', price: 3, count: 2, stats: { klim: 1, uithouding: 1 }, fatigue: 1 },
  { id: 'kamp', kind: 'training', name: 'Trainingskamp', text: 'Alles +1. Vermoeidheid +2.', price: 3, count: 2, stats: { kracht: 1, klim: 1, sprint: 1, uithouding: 1 }, fatigue: 2 },
  { id: 'rustdag', kind: 'training', name: 'Rustdag', text: 'Vermoeidheid -2. Dit telt niet als training.', price: 1, count: 3, fatigue: -2 },

  // Sponsorcontracten: ze liggen alleen in de eigen winkel van elk team, niet in de stapel.
  // Elk team tekent er maximaal SLOT_LIMITS.sponsor. Tekenen kost niets: de keuze is welke je neemt.
  { id: 'aannemer', kind: 'sponsor', contract: 'cash', name: 'Aannemer Van Dijk', text: 'Betaalt € 5 bij het tekenen. Daarna hoor je niets meer van hem.', price: 0, count: 0, signing: 5 },
  { id: 'bakker', kind: 'sponsor', contract: 'cash', name: 'Bakkerij De Gouden Korst', text: '€ 3 bij het tekenen en € 1 per etappe, plus een croissant op de bus.', price: 0, count: 0, signing: 3, perk: { income: 1 } },
  { id: 'bank', kind: 'sponsor', contract: 'bonus', name: 'Regiobank', text: '€ 1 per etappe, en € 3 extra als een van je renners op het podium eindigt.', price: 0, count: 0, perk: { income: 1, podiumBonus: 3 } },
  { id: 'drankje', kind: 'sponsor', contract: 'bonus', name: 'Energiedrank XL', text: '€ 4 voor elke etappe die jij wint (de meeste punten), en € 2 voor elk podium.', price: 0, count: 0, perk: { winBonus: 4, podiumBonus: 2 } },
  { id: 'omroep', kind: 'sponsor', contract: 'bonus', name: 'Regionale Omroep', text: '€ 1 per 3 etappepunten. Hoe harder jullie rijden, hoe meer ze zenden.', price: 0, count: 0, perk: { pointBonus: 1 } },
  { id: 'gelfabriek', kind: 'sponsor', contract: 'supply', name: 'Gelfabriek Plakkie', text: 'Levert elke etappe 2 extra energiegels. Plakkerig, maar het werkt.', price: 0, count: 0, perk: { gels: 2 } },
  { id: 'colafabriek', kind: 'sponsor', contract: 'supply', name: 'Colafabriek Prik', text: 'Levert elke etappe 1 spurtcola en 1 energiegel.', price: 0, count: 0, perk: { colas: 1, gels: 1 } },
  { id: 'autodealer', kind: 'sponsor', contract: 'supply', name: 'Autodealer Van der Wiel', text: 'Levert een volgauto met geheime extra\'s: de wagen geeft +2 energie en je renners starten met +1 energie.', price: 0, count: 0, perk: { service: 1, startEnergy: 1 } },
  { id: 'fietsenmaker', kind: 'sponsor', contract: 'supply', name: 'Fietsenmaker Kettinkie', text: 'Levert een reservefiets en een monteur: één pech of val per etappe is gedekt, en pech kost 1 tegel minder.', price: 0, count: 0, perk: { shield: 1, pechReduction: 1 } },
  { id: 'fysiopraktijk', kind: 'sponsor', contract: 'supply', name: 'Fysiopraktijk Soepel', text: 'Levert een fysio en een soigneur: vermoeidheid zakt sneller, overtraining begint later en Rustig geeft +1 energie extra.', price: 0, count: 0, perk: { fatigueRecover: 1, overtrainTolerance: 1, restBonus: 1 } },

  // Staf.
  { id: 'mecanicien', kind: 'staff', name: 'Mecanicien', text: 'Een lekke band of val kost 1 tegel minder.', price: 3, count: 2, perk: { pechReduction: 1 } },
  { id: 'soigneur', kind: 'staff', name: 'Soigneur', text: '+1 herstel als je Rustig rijdt.', price: 3, count: 2, perk: { restBonus: 1 } },
  { id: 'ploegleider', kind: 'staff', name: 'Ploegleider', text: 'Alles geven kost 1 energie minder.', price: 3, count: 2, perk: { allesDiscount: 1 } },
  { id: 'voeding', kind: 'staff', name: 'Voedingsdeskundige', text: 'Elke renner start met +2 energie.', price: 3, count: 2, perk: { startEnergy: 2 } },
  { id: 'fysio', kind: 'staff', name: 'Fysiotherapeut', text: 'Na elke etappe 1 extra vermoeidheid weg. Overtraining begint 1 later.', price: 2, count: 2, perk: { fatigueRecover: 1, overtrainTolerance: 1 } },

  // Materiaal.
  { id: 'reservefiets', kind: 'material', name: 'Reservefiets', text: 'Vangt 2 lekke banden of vallen per etappe volledig op.', price: 3, count: 2, perk: { shield: 2 } },
  { id: 'aerowielen', kind: 'material', name: 'Aero-wielen', text: '+1 beweging op vlakke stukken, als je Normaal of Alles rijdt.', price: 4, count: 1, perk: { flat: 1 } },
  { id: 'klimfiets', kind: 'material', name: 'Lichte klimfiets', text: '+1 beweging op klimmen, als je Normaal of Alles rijdt.', price: 4, count: 1, perk: { climb: 1 } },
  { id: 'regenbanden', kind: 'material', name: 'Regenbanden', text: 'Bij nat wegdek valt je renner veel minder snel en regen kost hem niets op kasseien en afdalingen.', price: 3, count: 2, perk: { wetGrip: 1 } },

  // Teamwagens.
  { id: 'volgauto', kind: 'car', name: 'Volgauto', text: 'De volgauto geeft +2 energie in plaats van +1 en helpt ook na een val: dan verliest die renner 2 tegels minder.', price: 3, count: 2, perk: { service: 1 } },
  { id: 'teambus', kind: 'car', name: 'Teambus', text: 'Iedereen start met +3 energie.', price: 4, count: 1, perk: { startEnergy: 3 } },

  // Koerskaarten: je speelt ze tijdens de race, één keer. Elke renner kan er per ronde één gebruiken.
  { id: 'gel', kind: 'race', name: 'Energiegel', text: 'Eén renner krijgt direct +4 energie, genoeg voor één keer Alles geven. Handig als je net iets te zuinig was.', price: 2, count: 4, race: 'gel' },
  { id: 'cola', kind: 'race', name: 'Spurtcola', text: 'Eén renner rijdt deze ronde +3 tegels extra. Kost geen energie.', price: 2, count: 3, race: 'cola' },
  { id: 'blok', kind: 'race', name: 'Blokkade', text: 'Een knecht knijpt een tegenstander binnen 3 tegels dicht: die rijdt -2 en krijgt geen drafting.', price: 3, count: 3, race: 'blok' },

  // Sabotage: een lichte hinder voor één ander team, nooit uitschakeling.
  { id: 'spijkers', kind: 'sabotage', name: 'Spijkers op de weg', text: 'Doelwit heeft veel meer kans op pech.', price: 3, count: 2, sabotage: 'spijkers' },
  { id: 'bidon', kind: 'sabotage', name: 'Verwisselde bidons', text: 'Alle renners van het doelwit starten met -3 energie.', price: 3, count: 1, sabotage: 'bidon' },
];

export const CARD_DEFS: Record<string, CardDef> = Object.fromEntries(defs.map((d) => [d.id, d]));
/** Wat in de stapel en de markt kan zitten. */
export const CARD_DEF_LIST: CardDef[] = defs.filter((d) => !d.contract);
/** Sponsorcontracten: alleen in de winkel. */
export const CONTRACT_LIST: CardDef[] = defs.filter((d) => !!d.contract);

// ---- Etappes ---------------------------------------------------------------

export const STAGE_INFO = [
  { name: 'Etappe 1: de vlakke opener', blurb: 'Vooral vlak met wat kasseien. Sprinters en rouleurs voelen zich thuis, de rest voelt zich vooral uitgenodigd.', body: ['flat', 'flat', 'cobbles', 'flat', 'climb', 'cobbles'] as Terrain[] },
  { name: 'Etappe 2: de bergrit', blurb: 'Klimmen, klimmen en nog eens klimmen. Klimmers krijgen hier hun moment, de rest krijgt blaren.', body: ['climb', 'climb', 'descent', 'flat', 'climb', 'descent'] as Terrain[] },
  { name: 'Etappe 3: de slotetappe', blurb: 'Van alles wat, en een sprint om het seizoen te beslissen. Alle punten tellen dubbel, net als de zenuwen.', body: ['flat', 'climb', 'cobbles', 'descent', 'flat', 'climb'] as Terrain[] },
];

// ---- Uitleg vooraf ---------------------------------------------------------
// Wordt voor de eerste draft getoond, zonder timer. Op de tv groot, op de telefoon klein.

export interface BriefPage {
  title: string;
  lead: string; // één zin: de kern
  points: { head: string; text: string }[];
  say: { speaker: CommentatorId; text: string };
}

export const BRIEFING: BriefPage[] = [
  {
    title: 'Het doel',
    lead: 'Jullie managen elk een wielerploeg van drie renners. Wie na drie etappes de meeste punten heeft, wint.',
    points: [
      { head: 'Je eigen winkel', text: 'Eerst winkelt iedereen tegelijk in zijn eigen winkel, met € 10: drie renners en maximaal twee sponsors.' },
      { head: 'Drie etappes', text: 'Elke etappe heeft een eigen parcours en eigen weer: vlak, bergen, droog of nat.' },
      { head: 'Punten', text: 'Je scoort met de eindstand van je renners en met premies onderweg.' },
      { head: 'Slotetappe', text: 'De laatste etappe telt dubbel, dus niemand is kansloos.' },
    ],
    say: { speaker: 'johan', text: 'Jullie managen elk een ploeg van drie renners. Na drie etappes wint het team met de meeste punten. Eerst winkelt iedereen in zijn eigen winkel.' },
  },
  {
    title: 'Een etappe in vier stappen',
    lead: 'Elke etappe doorloop je dezelfde vier stappen. Op je telefoon staat steeds wat nu kan.',
    points: [
      { head: '1. Draft', text: 'Kies om de beurt kaarten uit de markt: training, staf, materiaal, koerskaarten.' },
      { head: '2. Voorbereiding', text: 'Train je renners, leg spullen op je bord, ruil en kies je kopman.' },
      { head: '3. Race', text: 'Elke ronde kies je per renner een tempo. Dan rijdt het peloton.' },
      { head: '4. Uitslag', text: 'Punten, munten (ook van je sponsors) en nieuwe kaarten. De laagste in het klassement krijgt extra hulp.' },
    ],
    say: { speaker: 'marieke', text: 'Elke etappe heeft vier stappen: draft, voorbereiding, race en uitslag. Wat je in de voorbereiding doet, bepaalt hoe de race loopt.' },
  },
  {
    title: 'Zo scoor je punten',
    lead: 'Alles draait om de eindstand van je renners, en om de premies onderweg.',
    points: [
      { head: 'Eindstand', text: 'De eerste zes renners over de streep krijgen 10, 7, 5, 3, 2 en 1 punt.' },
      { head: 'Kopman', text: 'Kies voor de race één kopman. Zijn punten tellen dubbel. Kies de renner die bij het parcours past.' },
      { head: 'Premies', text: 'Een tussensprint en een bergpremie onderweg: de eerste drie renners scoren 3, 2 en 1 punt.' },
    ],
    say: { speaker: 'johan', text: 'Punten krijg je voor de eindstand en voor premies onderweg. Je kopman scoort dubbel, dus kies zijn parcours met zorg.' },
  },
  {
    title: 'In de race: energie',
    lead: 'Elke ronde kies je per renner hoe hard hij rijdt. Dat kost energie, en je energie is beperkt.',
    points: [
      { head: 'Rustig', text: 'Langzaam, maar je herstelt 1 energie.' },
      { head: 'Normaal', text: 'Stevig tempo. Kost 1 energie.' },
      { head: 'Alles geven', text: 'Het snelst, maar kost 4 energie. Dat houd je niet de hele etappe vol.' },
      { head: 'Helpen', text: 'Een knecht rijdt rustig en trekt de kopman mee: 3 tegels extra voor hem.' },
    ],
    say: { speaker: 'marieke', text: 'Energie is je brandstof. Wie vol gas geeft heeft straks niets meer over. Spaar dus voor de premies en de finish.' },
  },
  {
    title: 'In de race: slimme zetten',
    lead: 'Naast het tempo heb je elke ronde nog drie keuzes. Ze worden pas onthuld als de ronde begint.',
    points: [
      { head: 'Volgauto', text: 'Kies bij welke renner de auto rijdt: die krijgt +1 energie. Zet hem bij wie het hardst nodig heeft.' },
      { head: 'Gel of cola', text: 'Een gel geeft direct +4 energie, een cola +3 tegels. Elke renner krijgt elke etappe een gratis gel; cola en meer gels koop je in de winkel.' },
      { head: 'Blokkeren', text: 'Rijdt een tegenstander binnen 3 tegels van een van je knechten, dan kun je hem dichtknijpen: -2 en geen drafting.' },
    ],
    say: { speaker: 'johan', text: 'Elke ronde kies je ook waar de volgauto rijdt, en of je een gel, een cola of een blokkade inzet. Dat gebeurt tegelijk, dus niemand weet wat de ander doet.' },
  },
  {
    title: 'Peloton, pech en vallen',
    lead: 'Samen is lichter. Wie wegrijdt, betaalt. En af en toe gaat er iemand onderuit, zeker bij regen.',
    points: [
      { head: 'Peloton', text: 'Een groep van drie of meer rijdt lichter en krijgt meer drafting. Alleen rijden kost extra energie en je wordt teruggehaald.' },
      { head: 'Team', text: 'Rijd je met teamgenoten in dezelfde groep, dan krijgt iedereen extra tegels.' },
      { head: 'Pech en vallen', text: 'Pech komt vaker voor: zet je volgauto bij de renner die het nodig heeft. Bij regen en in afdalingen vallen er renners, en die vallen kunnen blessures geven.' },
    ],
    say: { speaker: 'johan', text: 'Samen rijden loont, alleen wegrijden kost veel. En bij regen vallen er renners. Zet de volgauto daar waar het misgaat.' },
  },
  {
    title: 'Zo speel je mee',
    lead: 'Je telefoon is je hand, de tv is het bord. Elke fase heeft een korte timer, dus denk vooruit.',
    points: [
      { head: 'Telefoon', text: 'Kaarten, team, winkel en ruilen staan in de voorbereiding. Het tempo kies je in de race.' },
      { head: 'Tv', text: 'Hier zie je de markt, het parcours, de premies en de race.' },
      { head: 'Eerste keer?', text: 'Kies een kopman die bij het parcours past, train hem, en geef vol gas vlak voor een premie of de finish. Bewaar je gel voor het moment dat je er echt iets mee wint.' },
    ],
    say: { speaker: 'marieke', text: 'Eerste keer? Kies een kopman die bij het parcours past, train hem, en geef vol gas vlak voor een premie of de finish. Tik hieronder op ik snap het.' },
  },
];

// ---- Gebeurtenissen --------------------------------------------------------

export interface EventDef {
  id: EventId;
  title: string;
  blurb: string;
  global?: number;
  terrain?: Partial<Record<Terrain, number>>;
  noDraft?: boolean;
  energyAll?: number;
  targetRider?: number;
  targetEnergy?: number;
  targetTeam?: number;
  target?: 'leader' | 'randomRider' | 'randomTeam';
  silly?: boolean;
  crashBonus?: number; // extra procent valkans voor iedereen deze ronde
  pechBonus?: number; // extra op 10 voor pech deze ronde
  noPech?: boolean; // geen pech deze ronde
  weather?: Weather[]; // alleen in een etappe met dit weer (anders overal)
}

export const EVENTS: Record<EventId, EventDef> = {
  calm: { id: 'calm', title: 'Rustig weer', blurb: 'Zonnig en stil. Verdacht.' },
  tailwind: { id: 'tailwind', title: 'Meewind', blurb: 'Iedereen rijdt +1.', global: 1 },
  headwind: { id: 'headwind', title: 'Tegenwind', blurb: 'Iedereen rijdt -1.', global: -1 },
  crosswind: { id: 'crosswind', title: 'Waaiers', blurb: 'De wind komt van opzij. Niet drafting deze ronde.', noDraft: true },
  rain: { id: 'rain', title: 'Regen', blurb: 'Glad! Afdalingen en kasseien zijn -1 en vallen is veel waarschijnlijker.', terrain: { descent: -1, cobbles: -1 }, crashBonus: 6, weather: ['mixed'] },
  feedzone: { id: 'feedzone', title: 'Bevoorrading', blurb: 'Iedereen krijgt +2 energie.', energyAll: 2 },
  crowd: { id: 'crowd', title: 'Joelend publiek', blurb: 'Klimmen is +1.', terrain: { climb: 1 } },
  chicken: {
    id: 'chicken',
    title: 'Kip op de weg',
    blurb: 'Een toeschouwer in kippenpak rent de weg op. De koploper remt: -2.',
    targetRider: -2,
    target: 'leader',
    silly: true,
  },
  wrongTurn: {
    id: 'wrongTurn',
    title: 'Teamauto neemt verkeerde afslag',
    blurb: 'De volgauto volgt de verkeerde bus. Eén team rijdt -1 per renner.',
    targetTeam: -1,
    target: 'randomTeam',
    silly: true,
  },
  sandwich: {
    id: 'sandwich',
    title: 'Verdacht broodje',
    blurb: 'Een soigneur geeft één renner een broodje: +3 beweging, maar -2 energie.',
    targetRider: 3,
    targetEnergy: -2,
    target: 'randomRider',
    silly: true,
  },
  cow: {
    id: 'cow',
    title: 'Koe op de weg',
    blurb: 'Een koe kijkt peinzend naar het peloton. Niemand durft in haar wiel: geen drafting.',
    noDraft: true,
    silly: true,
  },
  tractor: {
    id: 'tractor',
    title: 'Tractor voor het peloton',
    blurb: 'Een tractor tuft voor de kop uit en wil niet ruimen. Vlakke stukken zijn -1.',
    terrain: { flat: -1 },
    silly: true,
  },
  goat: {
    id: 'goat',
    title: 'Berggeit',
    blurb: 'Een berggeit passeert zonder zichtbare moeite. De klimmers kijken gekrenkt: klimmen is -1.',
    terrain: { climb: -1 },
    silly: true,
  },
  selfie: {
    id: 'selfie',
    title: 'Selfie op de weg',
    blurb: 'Een toeschouwer maakt een selfie midden op het parcours. Eén renner remt en lacht netjes mee: -2.',
    targetRider: -2,
    target: 'randomRider',
    silly: true,
  },
  bbq: {
    id: 'bbq',
    title: 'Barbecue langs de route',
    blurb: 'De geur van worst waait over het parcours. Iedereen krijgt +1 energie, maar rijdt -1 uit pure afleiding.',
    global: -1,
    energyAll: 1,
    silly: true,
  },
  oil: {
    id: 'oil',
    title: 'Olievlek op de weg',
    blurb: 'Een tractor heeft een ruimhartig spoor achtergelaten. De valkans gaat omhoog.',
    crashBonus: 8,
    silly: true,
  },
  storm: {
    id: 'storm',
    title: 'Onweer',
    blurb: 'De lucht wordt zwart, de bliksem is dichtbij. Iedereen -1 en vallen is veel waarschijnlijker.',
    global: -1,
    crashBonus: 6,
    weather: ['rain'],
  },
  mist: {
    id: 'mist',
    title: 'Dikke mist',
    blurb: 'Je ziet het achterwiel nog net. Afdalingen zijn -1 en vallen is iets waarschijnlijker.',
    terrain: { descent: -1 },
    crashBonus: 3,
  },
  nails: {
    id: 'nails',
    title: 'Spijkerveld',
    blurb: 'Iemand heeft een doos punaises uitgestrooid. Pech is veel waarschijnlijker.',
    pechBonus: 3,
    silly: true,
  },
  blessing: {
    id: 'blessing',
    title: 'Pastoor zegent het peloton',
    blurb: 'Een pastoor zwaait met wijwater. Deze ronde geen pech.',
    noPech: true,
    silly: true,
  },
  wasps: {
    id: 'wasps',
    title: 'Wespennest',
    blurb: 'Een wespennest in een bidonhouder. Eén renner rijdt -3 en gaat een stuk sneller dan hij wilde.',
    targetRider: -3,
    target: 'randomRider',
    silly: true,
  },
  drone: {
    id: 'drone',
    title: 'Drone van de tv',
    blurb: 'De koploper kijkt omhoog en zwaait. Terwijl hij zwaait rijdt hij -1.',
    targetRider: -1,
    target: 'leader',
    silly: true,
  },
  fanBottle: {
    id: 'fanBottle',
    title: 'Fan met bidon',
    blurb: 'Een fan rent mee met een bidon: één renner krijgt +2 energie en +1 beweging.',
    targetRider: 1,
    targetEnergy: 2,
    target: 'randomRider',
    silly: true,
  },
  dogRun: {
    id: 'dogRun',
    title: 'Hond rent mee',
    blurb: 'Een hond rent een stuk mee en blaft vrolijk. Eén renner krijgt er vleugels van: +2.',
    targetRider: 2,
    target: 'randomRider',
    silly: true,
  },
  detour: {
    id: 'detour',
    title: 'Omleiding',
    blurb: 'Het peloton gaat rechts, de pijl wijst links. Geen drafting deze ronde.',
    noDraft: true,
    silly: true,
  },
  mascot: {
    id: 'mascot',
    title: 'Mascotte op een eenwieler',
    blurb: 'Een mascotte op een eenwieler trekt het peloton mee. Iedereen +1 op vlak.',
    terrain: { flat: 1 },
    silly: true,
  },
  grandma: {
    id: 'grandma',
    title: 'Oma met koffie',
    blurb: 'Oma staat langs de kant met koffie en een koek. Eén renner krijgt +3 energie.',
    targetEnergy: 3,
    target: 'randomRider',
    silly: true,
  },
};

export const EVENT_IDS = Object.keys(EVENTS) as EventId[];

export const RIDER_NAME_POOL = [
  'Jos Vermeulen', 'Sven de Bruin', 'Maarten Kuipers', 'Lars Pedaal', 'Wout van Gaal',
  'Piet Peddel', 'Daan Kettingman', 'Bram Bidon', 'Thijs Tailwind', 'Joris Jersey',
  'Ruben Remmers', 'Kees Klimmer', 'Niels Nachtegaal', 'Floris Fietsbel', 'Stijn Sprint',
  'Gijs Gel', 'Teun Tandwiel', 'Milan Mudguard', 'Hugo Helling', 'Olaf Omloop',
  'Jan-Willem Wiel', 'Cas Cadans', 'Tim Penningmeester', 'Rick Rouleur', 'Luuk Lanterne',
  'Bas Banden', 'Mees Musette', 'Sander Slipstream', 'Pim Peloton', 'Noud Nootjes',
  'Kasper Koffiekop', 'Jelle Jam', 'Marcel Modder', 'Rik Regenpak', 'Wessel Wielrenner',
  'Dirk Doorzetter', 'Fons Fietspomp', 'Gerrit Gelletje', 'Harm Helmpje', 'Ivo Ijsco',
  'Joep Jerseyman', 'Koen Kuit', 'Lex Lekkeband', 'Mick Mechanicien', 'Nick Nepvlag',
  'Otto Oortje', 'Pepijn Pech', 'Quinten Quick', 'Rens Remblok', 'Siem Spatbord',
  'Tijn Tegenwind', 'Ulrich Uitlaat', 'Vince Vooruit', 'Wim Wieldop', 'Xander Zadelpijn',
  'Yvo IJzerhard', 'Zeger Zuurstof', 'Aart Achterwiel', 'Boudewijn Bidon', 'Cor Cadans',
  'Dolf Derailleur', 'Evert Eindsprint', 'Freek Frambozen', 'Gideon Gearing',
];

export const COMMENTATORS = {
  johan: { name: 'Johan', role: 'Verslaggever', voice: 'nl-BE-ArnaudNeural', rate: '+15%', pitch: '+4Hz', volume: '+10%' },
  marieke: { name: 'Marieke', role: 'Analist', voice: 'nl-BE-DenaNeural', rate: '+15%', pitch: '+4Hz', volume: '+10%' },
  // Nederlandse stem, alleen voor de tutorial-uitleg: zo hoor je het verschil met de Belgische commentatoren.
  fenna: { name: 'Fenna', role: 'Uitleg', voice: 'nl-NL-FennaNeural', rate: '+5%', pitch: '+0Hz', volume: '+10%' },
} as const;

export type CommentatorId = keyof typeof COMMENTATORS;

export function cardName(def: string): string {
  return CARD_DEFS[def]?.name ?? def;
}
