import type { ContractId, EventId, QuirkId, RiderType, Terrain } from './types';

export const TEAM_COLORS = [
  { name: 'Red', hex: '#e5484d', dark: '#9c2a2e' },
  { name: 'Blue', hex: '#3e63dd', dark: '#2a4399' },
  { name: 'Green', hex: '#30a46c', dark: '#1f7048' },
  { name: 'Yellow', hex: '#f5c518', dark: '#a8860c' },
  { name: 'Purple', hex: '#8e4ec6', dark: '#62308c' },
  { name: 'Orange', hex: '#f76b15', dark: '#a84708' },
] as const;

export const RIDER_TYPES: Record<RiderType, { label: string; blurb: string }> = {
  sprinter: { label: 'Sprinter', blurb: '+1 on flat, -1 on climbs' },
  climber: { label: 'Climber', blurb: '+2 on climbs, -1 on cobbles' },
  rouleur: { label: 'Rouleur', blurb: '+1 on cobbles' },
};

export const TERRAINS: Record<Terrain, { label: string; icon: string }> = {
  flat: { label: 'Flat', icon: '—' },
  climb: { label: 'Climb', icon: '▲' },
  descent: { label: 'Descent', icon: '▼' },
  cobbles: { label: 'Cobbles', icon: '▒' },
};

export const QUIRKS: Record<QuirkId, { label: string; blurb: string }> = {
  croissant: { label: 'Runs on croissants', blurb: '+1 when playing a 1 or 2 card' },
  waver: { label: 'Waves at every spectator', blurb: '-1 on flat, +1 on climbs (bigger crowds)' },
  cobbleKing: { label: 'Born on cobbles', blurb: '+1 on cobbles' },
  descentFear: { label: 'Afraid of descents', blurb: 'Gets no descent bonus' },
  windHardened: { label: 'Wind-hardened', blurb: 'Ignores headwind' },
  socks: { label: 'Mismatched socks', blurb: 'No effect. The commentators are obsessed.' },
  finisher: { label: 'Finishing kick', blurb: '+1 in the last 3 tiles' },
};

export const CONTRACTS: Record<ContractId, { label: string; blurb: string }> = {
  loneWolf: { label: 'Lone Wolf', blurb: 'Have the front-most rider in 4 or more rounds.' },
  domestiques: { label: 'Domestique Dream', blurb: 'Finish all three riders in the top half of the field.' },
  sprintKing: { label: 'Sprint King', blurb: 'Your sprinter wins the stage.' },
  wheelMerchant: { label: 'Wheel Merchant', blurb: 'Complete 3 or more trades.' },
  freshLegs: { label: 'Fresh Legs', blurb: 'Finish with at most 1 tired card in your whole deck.' },
};

export interface EventDef {
  id: EventId;
  title: string;
  blurb: string;
  global?: number; // added to every rider's move
  terrain?: Partial<Record<Terrain, number>>;
  noDraft?: boolean;
  extraDraw?: number;
  targetRider?: number; // applied to the chosen rider
  targetTeam?: number; // applied to each rider on the chosen team
  targetTired?: boolean; // chosen rider's team receives a tired card
  target?: 'leader' | 'randomRider' | 'randomTeam';
  silly?: boolean;
}

export const EVENTS: Record<EventId, EventDef> = {
  calm: { id: 'calm', title: 'Calm conditions', blurb: 'Sunny, quiet, nothing happens. Suspicious.' },
  tailwind: { id: 'tailwind', title: 'Tailwind', blurb: 'Everyone moves +1.', global: 1 },
  headwind: { id: 'headwind', title: 'Headwind', blurb: 'Everyone moves -1.', global: -1 },
  crosswind: {
    id: 'crosswind',
    title: 'Crosswind',
    blurb: 'Echelons form. No drafting this round.',
    noDraft: true,
  },
  rain: {
    id: 'rain',
    title: 'Rain',
    blurb: 'Slippery! Descents and cobbles are -1.',
    terrain: { descent: -1, cobbles: -1 },
  },
  feedzone: {
    id: 'feedzone',
    title: 'Feed zone',
    blurb: 'Everyone draws one extra card.',
    extraDraw: 1,
  },
  crowd: {
    id: 'crowd',
    title: 'Roaring crowd',
    blurb: 'Climbs are +1.',
    terrain: { climb: 1 },
  },
  chicken: {
    id: 'chicken',
    title: 'Chicken on the road',
    blurb: 'A spectator in a chicken costume runs onto the road. The race leader moves -2.',
    targetRider: -2,
    target: 'leader',
    silly: true,
  },
  wrongTurn: {
    id: 'wrongTurn',
    title: 'Team car takes a wrong turn',
    blurb: 'The team car follows the wrong bus. One team moves -1 per rider.',
    targetTeam: -1,
    target: 'randomTeam',
    silly: true,
  },
  sandwich: {
    id: 'sandwich',
    title: 'Suspicious sandwich',
    blurb: 'A soigneur hands one rider a sandwich: +3 move, but a tired card follows.',
    targetRider: 3,
    targetTired: true,
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
  'Jan-Willem Wiel', 'Cas Cadans', 'Tim Treasurer', 'Rick Rouleur', 'Luuk Lanterne',
  'Bas Banden', 'Mees Musette', 'Sander Slipstream', 'Pim Peloton', 'Noud Nootjes',
];

export const COMMENTATORS = {
  johan: { name: 'Johan', role: 'Play-by-play', voice: 'en-GB-RyanNeural', rate: '+8%', pitch: '+0Hz' },
  marieke: { name: 'Marieke', role: 'Analyst', voice: 'en-GB-SoniaNeural', rate: '+4%', pitch: '+0Hz' },
} as const;

export type CommentatorId = keyof typeof COMMENTATORS;
