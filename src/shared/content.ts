// Alle spelinhoud (Nederlands): kaarten, renners, gebeurtenissen, commentatoren.

import type { CardKind, Effort, EventId, QuirkId, RiderType, Stat, Stats, Terrain } from './types';

export const TEAM_COLORS = [
  { name: 'Rood', hex: '#e5484d', dark: '#9c2a2e' },
  { name: 'Blauw', hex: '#3e63dd', dark: '#2a4399' },
  { name: 'Groen', hex: '#30a46c', dark: '#1f7048' },
  { name: 'Geel', hex: '#f5c518', dark: '#a8860c' },
  { name: 'Paars', hex: '#8e4ec6', dark: '#62308c' },
  { name: 'Oranje', hex: '#f76b15', dark: '#a84708' },
] as const;

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
  alles: { label: 'Alles geven', blurb: 'Vol gas, kost 3 energie', base: 4, energy: -3 },
};

export const QUIRKS: Record<QuirkId, { label: string; blurb: string }> = {
  croissant: { label: 'Rijdt op croissants', blurb: '+1 extra herstel bij Rustig' },
  waver: { label: 'Zwaait naar iedereen', blurb: '-1 op vlak, +1 op klimmen (groter publiek)' },
  cobbleKing: { label: 'Geboren op kasseien', blurb: '+1 op kasseien' },
  descentFear: { label: 'Bang in afdalingen', blurb: 'Krijgt geen bonus in afdalingen' },
  windHardened: { label: 'Windgehard', blurb: 'Trekt zich niets aan van tegenwind' },
  socks: { label: 'Verschillende sokken', blurb: 'Geen effect. De commentatoren zijn geobsedeerd.' },
  finisher: { label: 'Eindsprint-instinct', blurb: '+1 in de laatste 3 tegels' },
};

// ---- Kaarten ---------------------------------------------------------------

export interface Perk {
  income?: number; // sponsor: munten per etappe
  podiumBonus?: number; // sponsor: extra munten bij een renner in de top 3
  startEnergy?: number;
  restBonus?: number; // extra herstel bij Rustig
  allesDiscount?: number; // Alles geven kost zoveel minder
  pechReduction?: number;
  shield?: number; // pechgevallen per etappe die niets kosten
  flat?: number;
  climb?: number;
  descent?: number;
  service?: number; // servicemomenten per race
  fatigueRecover?: number; // extra herstel na de etappe
  overtrainTolerance?: number;
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
}

export const KIND_LABELS: Record<CardKind, string> = {
  training: 'Training',
  sponsor: 'Sponsor',
  staff: 'Staf',
  material: 'Materiaal',
  car: 'Wagen',
  sabotage: 'Sabotage',
};

export const KIND_COLORS: Record<CardKind, string> = {
  training: '#5eea8d',
  sponsor: '#ffd23f',
  staff: '#6ea8ff',
  material: '#c9a672',
  car: '#c792ea',
  sabotage: '#ff6b6b',
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

  // Sponsors: leveren munten per etappe.
  { id: 'bakker', kind: 'sponsor', name: 'Bakkerij De Gouden Korst', text: '+2 munten per etappe.', price: 2, count: 2, perk: { income: 2 } },
  { id: 'bank', kind: 'sponsor', name: 'Regiobank', text: '+3 munten per etappe.', price: 3, count: 2, perk: { income: 3 } },
  { id: 'drankje', kind: 'sponsor', name: 'Energiedrank XL', text: '+2 munten per etappe, +3 extra bij een podiumplek.', price: 3, count: 1, perk: { income: 2, podiumBonus: 3 } },

  // Staf.
  { id: 'mecanicien', kind: 'staff', name: 'Mecanicien', text: 'Een lekke band of val kost 1 minder.', price: 3, count: 2, perk: { pechReduction: 1 } },
  { id: 'soigneur', kind: 'staff', name: 'Soigneur', text: '+1 herstel als je Rustig rijdt.', price: 3, count: 2, perk: { restBonus: 1 } },
  { id: 'ploegleider', kind: 'staff', name: 'Ploegleider', text: 'Alles geven kost 1 energie minder.', price: 3, count: 2, perk: { allesDiscount: 1 } },
  { id: 'voeding', kind: 'staff', name: 'Voedingsdeskundige', text: 'Elke renner start met +2 energie.', price: 3, count: 2, perk: { startEnergy: 2 } },
  { id: 'fysio', kind: 'staff', name: 'Fysiotherapeut', text: 'Na elke etappe 1 extra vermoeidheid weg. Overtraining begint 1 later.', price: 2, count: 2, perk: { fatigueRecover: 1, overtrainTolerance: 1 } },

  // Materiaal.
  { id: 'reservefiets', kind: 'material', name: 'Reservefiets', text: 'Vangt 2 lekke banden of vallen per etappe volledig op.', price: 3, count: 2, perk: { shield: 2 } },
  { id: 'aerowielen', kind: 'material', name: 'Aero-wielen', text: '+1 beweging op vlakke stukken, als je Normaal of Alles rijdt.', price: 4, count: 1, perk: { flat: 1 } },
  { id: 'klimfiets', kind: 'material', name: 'Lichte klimfiets', text: '+1 beweging op klimmen, als je Normaal of Alles rijdt.', price: 4, count: 1, perk: { climb: 1 } },

  // Teamwagens.
  { id: 'volgauto', kind: 'car', name: 'Volgauto', text: 'Twee keer: een renner met bijna lege benen krijgt +3 energie.', price: 3, count: 2, perk: { service: 2 } },
  { id: 'teambus', kind: 'car', name: 'Teambus', text: 'Iedereen start met +3 energie.', price: 4, count: 1, perk: { startEnergy: 3 } },

  // Sabotage: een lichte hinder voor één ander team, nooit uitschakeling.
  { id: 'spijkers', kind: 'sabotage', name: 'Spijkers op de weg', text: 'Doelwit krijgt dubbel zoveel kans op pech.', price: 3, count: 2, sabotage: 'spijkers' },
  { id: 'bidon', kind: 'sabotage', name: 'Verwisselde bidons', text: 'Alle renners van het doelwit starten met -2 energie.', price: 3, count: 1, sabotage: 'bidon' },
];

export const CARD_DEFS: Record<string, CardDef> = Object.fromEntries(defs.map((d) => [d.id, d]));
export const CARD_DEF_LIST: CardDef[] = defs;

// ---- Etappes ---------------------------------------------------------------

export const STAGE_INFO = [
  { name: 'Etappe 1: de vlakke opener', blurb: 'Vooral vlak met wat kasseien. Sprinters en rouleurs voelen zich thuis.', body: ['flat', 'flat', 'cobbles', 'flat', 'climb', 'cobbles'] as Terrain[] },
  { name: 'Etappe 2: de bergrit', blurb: 'Klimmen, klimmen en nog eens klimmen. Klimmers krijgen hier hun moment.', body: ['climb', 'climb', 'descent', 'flat', 'climb', 'descent'] as Terrain[] },
  { name: 'Etappe 3: de slotetappe', blurb: 'Van alles wat, en een sprint om het seizoen te beslissen. Alle punten tellen dubbel.', body: ['flat', 'climb', 'cobbles', 'descent', 'flat', 'climb'] as Terrain[] },
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
}

export const EVENTS: Record<EventId, EventDef> = {
  calm: { id: 'calm', title: 'Rustig weer', blurb: 'Zonnig en stil. Verdacht.' },
  tailwind: { id: 'tailwind', title: 'Meewind', blurb: 'Iedereen rijdt +1.', global: 1 },
  headwind: { id: 'headwind', title: 'Tegenwind', blurb: 'Iedereen rijdt -1.', global: -1 },
  crosswind: { id: 'crosswind', title: 'Waaiers', blurb: 'De wind komt van opzij. Niet drafting deze ronde.', noDraft: true },
  rain: { id: 'rain', title: 'Regen', blurb: 'Glad! Afdalingen en kasseien zijn -1.', terrain: { descent: -1, cobbles: -1 } },
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
};

export const EVENT_IDS = Object.keys(EVENTS) as EventId[];

export const RIDER_NAME_POOL = [
  'Jos Vermeulen', 'Sven de Bruin', 'Maarten Kuipers', 'Lars Pedaal', 'Wout van Gaal',
  'Piet Peddel', 'Daan Kettingman', 'Bram Bidon', 'Thijs Tailwind', 'Joris Jersey',
  'Ruben Remmers', 'Kees Klimmer', 'Niels Nachtegaal', 'Floris Fietsbel', 'Stijn Sprint',
  'Gijs Gel', 'Teun Tandwiel', 'Milan Mudguard', 'Hugo Helling', 'Olaf Omloop',
  'Jan-Willem Wiel', 'Cas Cadans', 'Tim Penningmeester', 'Rick Rouleur', 'Luuk Lanterne',
  'Bas Banden', 'Mees Musette', 'Sander Slipstream', 'Pim Peloton', 'Noud Nootjes',
];

export const COMMENTATORS = {
  johan: { name: 'Johan', role: 'Verslaggever', voice: 'nl-BE-ArnaudNeural', rate: '+15%', pitch: '+4Hz', volume: '+10%' },
  marieke: { name: 'Marieke', role: 'Analist', voice: 'nl-BE-DenaNeural', rate: '+15%', pitch: '+4Hz', volume: '+10%' },
} as const;

export type CommentatorId = keyof typeof COMMENTATORS;

export function cardName(def: string): string {
  return CARD_DEFS[def]?.name ?? def;
}
