// Shared types for Peloton Panic. Used by server, TV and phone clients.

export const MIN_TEAMS = 2;
export const MAX_TEAMS = 6;
export const RIDERS_PER_TEAM = 3;
export const HAND_SIZE = 6;
export const TRACK_LENGTH = 32;
export const CHASE_GAP = 4; // tiles behind the median rider before the peloton "pulls you back"
export const POINTS_BY_RANK = [10, 7, 5, 3, 2, 1];
export const CONTRACT_BONUS = 5;

export type Terrain = 'flat' | 'climb' | 'descent' | 'cobbles';
export type RiderType = 'sprinter' | 'climber' | 'rouleur';
export type CardKind = 'energy' | 'gel' | 'attack' | 'tired';
export type Phase = 'lobby' | 'play' | 'resolve' | 'trade' | 'finished';

export type QuirkId =
  | 'croissant'
  | 'waver'
  | 'cobbleKing'
  | 'descentFear'
  | 'windHardened'
  | 'socks'
  | 'finisher';

export type ContractId =
  | 'loneWolf'
  | 'domestiques'
  | 'sprintKing'
  | 'wheelMerchant'
  | 'freshLegs';

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
  kind: CardKind;
  value: number;
}

export interface CardSpec {
  kind: CardKind;
  value: number;
}

export interface Rider {
  id: string;
  teamId: string;
  name: string;
  type: RiderType;
  quirk: QuirkId;
  pos: number;
}

export interface TeamStats {
  roundsLed: number;
  trades: number;
  tired: number;
}

export interface Team {
  id: string;
  name: string; // player's name
  color: number; // index into TEAM_COLORS
  riderIds: string[];
  draw: Card[];
  hand: Card[];
  discard: Card[];
  contract: ContractId;
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
  give: string[]; // card ids from `from`'s hand
  want: CardSpec[]; // what `from` asks for out of `to`'s hand
}

export interface OfferView extends Offer {
  giveCards: Card[]; // resolved so the receiver can see what is on the table
}

export interface MoveParts {
  base: number;
  type: number;
  quirk: number;
  event: number;
  draft: number;
  chase: number;
}

export interface RiderMove {
  riderId: string;
  from: number;
  to: number;
  terrain: Terrain;
  cardKind: CardKind | null;
  cardValue: number | null;
  coasted: boolean;
  parts: MoveParts;
  windPaid: boolean;
  clusterIndex: number;
}

export interface ResolveReport {
  round: number;
  moves: RiderMove[];
  leaderRiderId: string;
  prevLeaderRiderId: string;
  finished: boolean;
}

export interface ContractResult {
  teamId: string;
  contract: ContractId;
  met: boolean;
}

export interface Award {
  title: string;
  teamId: string;
  blurb: string;
}

export interface Results {
  ranking: { riderId: string; rank: number; points: number }[];
  teams: {
    teamId: string;
    stagePoints: number;
    contract: ContractId;
    contractMet: boolean;
    total: number;
  }[];
  winnerTeamId: string;
  lanterneRougeTeamId: string;
  awards: Award[];
}

export interface GameState {
  phase: Phase;
  round: number;
  stage: number;
  trackLength: number;
  terrain: Terrain[];
  teams: Team[];
  riders: Rider[];
  event: ActiveEvent | null;
  eventDeck: EventId[];
  plays: Record<string, Record<string, string | null>>; // teamId -> riderId -> cardId
  locked: Record<string, boolean>;
  tradeReady: Record<string, boolean>;
  offers: Offer[];
  report: ResolveReport | null;
  results: Results | null;
  rng: number;
  nextCardId: number;
  nextOfferId: number;
}

// ---- Views sent over the wire ---------------------------------------------

export interface PublicTeam {
  id: string;
  name: string;
  color: number;
  riderIds: string[];
  handCount: number;
  drawCount: number;
  discardCount: number;
  locked: boolean;
  ready: boolean;
  isBot: boolean;
}

export interface PublicState {
  phase: Phase;
  round: number;
  stage: number;
  trackLength: number;
  terrain: Terrain[];
  teams: PublicTeam[];
  riders: Rider[];
  event: ActiveEvent | null;
  report: ResolveReport | null;
  results: Results | null;
  contractsRevealed: ContractResult[] | null;
}

export interface PlayerView {
  teamId: string;
  hand: Card[];
  contract: ContractId;
  plays: Record<string, string | null>;
  offersIn: OfferView[];
  offerOut: OfferView | null;
  stats: TeamStats;
}

// ---- Actions ----------------------------------------------------------------

export type Action =
  | { type: 'join'; name: string; isBot?: boolean }
  | { type: 'nameRiders'; teamId: string; names: string[] }
  | { type: 'start' }
  | { type: 'play'; teamId: string; plays: Record<string, string | null> }
  | { type: 'unlock'; teamId: string }
  | { type: 'offer'; teamId: string; to: string; give: string[]; want: CardSpec[] }
  | { type: 'withdraw'; teamId: string }
  | { type: 'respond'; teamId: string; offerId: string; accept: boolean }
  | { type: 'tradeReady'; teamId: string }
  | { type: 'next' }
  | { type: 'timeout' }
  | { type: 'rematch' }
  | { type: 'removeBot' };
