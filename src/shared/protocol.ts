import type { Line } from './commentary';
import type { CardSpec, PlayerView, PublicState } from './types';

/** Actions a phone may ask for. The server fills in the team id from the connection. */
export type PlayerAction =
  | { type: 'nameRiders'; names: string[] }
  | { type: 'play'; plays: Record<string, string | null> }
  | { type: 'unlock' }
  | { type: 'offer'; to: string; give: string[]; want: CardSpec[] }
  | { type: 'withdraw' }
  | { type: 'respond'; offerId: string; accept: boolean }
  | { type: 'tradeReady' };

// ---- client -> server ----
export type ClientMsg =
  | { t: 'tv:create'; origin: string }
  | { t: 'tv:resume'; code: string; origin: string }
  | { t: 'player:join'; code: string; name: string; token?: string }
  | { t: 'act'; action: PlayerAction }
  | { t: 'president'; what: 'start' | 'addBot' | 'rematch' | 'removeBot' };

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
