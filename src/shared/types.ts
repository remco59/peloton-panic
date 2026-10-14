// Gedeelde types voor Peloton Panic: server, TV en telefoon gebruiken dezelfde.

export const MIN_TEAMS = 2;
export const MAX_TEAMS = 6;
export const RIDERS_PER_TEAM = 3;
export const TRACK_LENGTH = 48;
export const STAT_FACTOR = 1; // hoeveel een eigenschapspunt aan beweging oplevert
export const STAGES = 3;
export const START_COINS = 5;
export const MARKET_SIZE = 5;
export const BLIND_COST = 2;
export const TRAININGS_PER_RIDER = 2;
export const FORM_CAP = 4;
export const FATIGUE_CAP = 6;
export const OVERTRAIN_FREE = 2; // vermoeidheid tot en met dit niveau geeft geen straf
export const CHASE_GAP = 4; // tegels achter de mediaan voor de peloton je terugtrekt
export const POINTS_BY_RANK = [10, 7, 5, 3, 2, 1];
export const SLOT_LIMITS = { sponsor: 2, staff: 2, material: 2, car: 1 } as const;

export type Terrain = 'flat' | 'climb' | 'descent' | 'cobbles';
export type RiderType = 'sprinter' | 'climber' | 'rouleur';
export type Stat = 'kracht' | 'klim' | 'sprint' | 'uithouding';
export type Stats = Record<Stat, number>;
export type Effort = 'rustig' | 'normaal' | 'alles';
export type Phase = 'lobby' | 'draft' | 'team' | 'race' | 'resolve' | 'results' | 'finished';
export type CardKind = 'training' | 'sponsor' | 'staff' | 'material' | 'car' | 'sabotage';
export type SlotKind = keyof typeof SLOT_LIMITS;

export type QuirkId =
  | 'croissant'
  | 'waver'
  | 'cobbleKing'
  | 'descentFear'
  | 'windHardened'
  | 'socks'
  | 'finisher';

export type EventId =
  | 'calm'
  | 'tailwind'
  | 'headwind'
  | 'crosswind'
  | 'rain'
  | 'feedzone'
  | 'chicken'
  | 'wrongTurn'
  | 'sandwich'
  | 'crowd';

export interface Card {
  id: string;
  def: string; // sleutel in CARD_DEFS
}

export interface Rider {
  id: string;
  teamId: string;
  name: string;
  type: RiderType;
  quirk: QuirkId;
  pos: number;
  base: Stats; // blijvende basiswaarden
  form: Stats; // training: vervaagt 1 per etappe
  fatigue: number; // vermoeidheid: te hoog = overtraind
  trained: number; // trainingen deze etappe
  energy: number; // alleen in de race
  maxEnergy: number;
}

export interface TeamStats {
  roundsLed: number;
  trades: number;
  trainings: number;
  alles: number;
  exhausted: number;
  sabotages: number;
}

export interface Team {
  id: string;
  name: string; // naam van de speler
  color: number;
  riderIds: string[];
  coins: number;
  points: number; // seizoenspunten
  hand: Card[];
  slots: Record<SlotKind, Card[]>;
  sabotage: string[]; // def-ids van sabotage die dit team deze etappe treft
  raceShield: number; // reservefietsen die nog pech opvangen
  raceService: number; // volgauto-servicemomenten die nog over zijn
  stats: TeamStats;
  isBot: boolean;
}

export interface ActiveEvent {
  id: EventId;
  targetTeamId?: string;
  targetRiderId?: string;
}

export interface Offer {
  id: string;
  from: string;
  to: string;
  give: string[]; // kaart-ids uit de hand van `from`
  giveCoins: number;
  want: string[]; // def-ids die `from` vraagt uit de hand van `to`
  wantCoins: number;
}

export interface OfferView extends Offer {
  giveCards: Card[];
}

export interface MoveParts {
  effort: number;
  stat: number;
  terrain: number;
  quirk: number;
  event: number;
  luck: number; // pech (negatief) of meewind (+1)
  tired: number; // op de fles
  draft: number;
  chase: number;
}

export interface RiderMove {
  riderId: string;
  from: number;
  to: number;
  terrain: Terrain;
  effort: Effort;
  parts: MoveParts;
  roll: number;
  windPaid: boolean;
  exhausted: boolean;
  pech: boolean;
  shielded: boolean;
  boost: boolean;
  service: boolean;
  energyAfter: number;
  clusterIndex: number;
}

export interface ResolveReport {
  round: number;
  moves: RiderMove[];
  leaderRiderId: string;
  prevLeaderRiderId: string;
  finished: boolean;
}

export interface DraftState {
  order: string[]; // teamIds, volledige volgorde (slang)
  idx: number;
}

export interface StageTeamResult {
  teamId: string;
  stagePoints: number;
  prizeCoins: number;
  sponsorCoins: number;
  bonusCards: string[]; // def-ids
  totalPoints: number;
}

export interface StageResult {
  stage: number;
  ranking: { riderId: string; rank: number; points: number }[];
  teams: StageTeamResult[];
  lanterneRougeTeamId: string;
  sabotages: { fromTeamId: string; toTeamId: string; def: string }[];
}

export interface Award {
  title: string;
  teamId: string;
  blurb: string;
}

export interface SeasonResult {
  teams: { teamId: string; points: number; coins: number }[];
  winnerTeamId: string;
  lanterneRougeTeamId: string;
  awards: Award[];
}

export interface GameState {
  phase: Phase;
  tutorial: boolean;
  round: number;
  stage: number;
  trackLength: number;
  terrain: Terrain[];
  teams: Team[];
  riders: Rider[];
  event: ActiveEvent | null;
  eventDeck: EventId[];
  deck: Card[];
  discard: Card[];
  market: Card[];
  draft: DraftState | null;
  ready: Record<string, boolean>;
  efforts: Record<string, Effort>;
  locked: Record<string, boolean>;
  offers: Offer[];
  sabotageLog: { fromTeamId: string; toTeamId: string; def: string }[];
  report: ResolveReport | null;
  stageResult: StageResult | null;
  season: SeasonResult | null;
  rng: number;
  nextCardId: number;
  nextOfferId: number;
}

// ---- Wat over de lijn gaat ---------------------------------------------------

export interface PublicTeam {
  id: string;
  name: string;
  color: number;
  riderIds: string[];
  coins: number;
  points: number;
  handCount: number;
  slots: Record<SlotKind, string[]>; // def-ids: spullen zijn openbaar
  locked: boolean;
  ready: boolean;
  isBot: boolean;
  trainings: number;
}

export interface PublicState {
  phase: Phase;
  tutorial: boolean;
  round: number;
  stage: number;
  trackLength: number;
  terrain: Terrain[];
  teams: PublicTeam[];
  riders: Rider[];
  event: ActiveEvent | null;
  market: string[]; // def-ids
  marketCards: Card[];
  deckCount: number;
  draft: { order: string[]; idx: number; currentTeamId: string | null; total: number } | null;
  report: ResolveReport | null;
  stageResult: StageResult | null;
  season: SeasonResult | null;
}

export interface PlayerView {
  teamId: string;
  hand: Card[];
  efforts: Record<string, Effort>;
  offersIn: OfferView[];
  offerOut: OfferView | null;
  sabotageOn: string[]; // wat iemand tegen jou inzet: pas bij de uitslag zichtbaar wie
  pickPending: boolean; // jij bent aan de beurt in de draft
  stats: TeamStats;
}

// ---- Acties ----------------------------------------------------------------

export type PickSource = { kind: 'market'; index: number } | { kind: 'deck' };

export type Action =
  | { type: 'join'; name: string; isBot?: boolean }
  | { type: 'nameRiders'; teamId: string; names: string[] }
  | { type: 'setTutorial'; on: boolean }
  | { type: 'start' }
  | { type: 'draftPick'; teamId: string; source: PickSource }
  | { type: 'draftSkip'; teamId: string }
  | { type: 'buy'; teamId: string; source: PickSource }
  | { type: 'train'; teamId: string; cardId: string; riderId: string }
  | { type: 'install'; teamId: string; cardId: string; replaceDef?: string }
  | { type: 'sabotage'; teamId: string; cardId: string; targetTeamId: string }
  | { type: 'offer'; teamId: string; to: string; give: string[]; giveCoins: number; want: string[]; wantCoins: number }
  | { type: 'withdraw'; teamId: string }
  | { type: 'respond'; teamId: string; offerId: string; accept: boolean }
  | { type: 'ready'; teamId: string }
  | { type: 'unready'; teamId: string }
  | { type: 'effort'; teamId: string; efforts: Record<string, Effort> }
  | { type: 'unlock'; teamId: string }
  | { type: 'next' }
  | { type: 'timeout' }
  | { type: 'nextStage' }
  | { type: 'rematch' }
  | { type: 'removeBot' };
