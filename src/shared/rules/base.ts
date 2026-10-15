// Gedeelde basis van de regelmotor: RuleError en constanten.

import type { QuirkId, Stat, Stats, Weather } from '../types';

export class RuleError extends Error {}

export const QUIRK_IDS: QuirkId[] = [
  'croissant',
  'waver',
  'cobbleKing',
  'descentFear',
  'windHardened',
  'socks',
  'finisher',
  'napper',
  'rainKing',
  'sugarCube',
  'clumsy',
  'daredevil',
  'lucky',
];
export const WEATHER_DECK: Weather[] = ['dry', 'dry', 'mixed', 'mixed', 'rain'];
export const STAT_KEYS: Stat[] = ['kracht', 'klim', 'sprint', 'uithouding'];
export const ZERO: Stats = { kracht: 0, klim: 0, sprint: 0, uithouding: 0 };
