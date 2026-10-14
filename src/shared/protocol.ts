import type { Line } from './commentary';
import type { Effort, PickSource, PlayerView, PublicState } from './types';

/** Acties die een telefoon mag vragen. De server vult het team-id in vanuit de verbinding. */
export type PlayerAction =
  | { type: 'nameRiders'; names: string[] }
  | { type: 'draftPick'; source: PickSource }
  | { type: 'draftSkip' }
  | { type: 'buy'; source: PickSource }
  | { type: 'train'; cardId: string; riderId: string }
  | { type: 'install'; cardId: string; replaceDef?: string }
  | { type: 'sabotage'; cardId: string; targetTeamId: string }
  | { type: 'offer'; to: string; give: string[]; giveCoins: number; want: string[]; wantCoins: number }
  | { type: 'withdraw' }
  | { type: 'respond'; offerId: string; accept: boolean }
  | { type: 'ready' }
  | { type: 'unready' }
  | { type: 'effort'; efforts: Record<string, Effort> }
  | { type: 'unlock' };

// ---- client -> server ----
export type PresidentAction = 'start' | 'addBot' | 'removeBot' | 'rematch' | 'nextStage' | 'tutorialOn' | 'tutorialOff';

export type ClientMsg =
  | { t: 'tv:create'; origin: string }
  | { t: 'tv:resume'; code: string; origin: string }
  | { t: 'player:join'; code: string; name: string; token?: string }
  | { t: 'act'; action: PlayerAction }
  | { t: 'president'; what: PresidentAction };

export interface FeedBatch {
  id: number;
  lines: Line[];
}

export interface RoomInfo {
  code: string;
  joinUrl: string;
  presidentTeamId: string | null;
  connected: Record<string, boolean>;
  phaseEndsAt: number | null;
  serverNow: number;
}

// ---- server -> client ----
export type ServerMsg =
  | { t: 'error'; message: string; fatal?: boolean }
  | ({ t: 'tv:state'; state: PublicState; feed: FeedBatch[] } & RoomInfo)
  | { t: 'joined'; teamId: string; token: string; code: string }
  | ({ t: 'player:state'; state: PublicState; me: PlayerView | null; teamId: string } & RoomInfo);
