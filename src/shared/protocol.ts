import type { Line } from './commentary';
import type { Effort, PickSource, PlayerView, PublicState, RacePlay } from './types';

/** Acties die een telefoon mag vragen. De server vult het team-id in vanuit de verbinding. */
export type PlayerAction =
  | { type: 'recruit'; itemId: string }
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
  | { type: 'kopman'; riderId: string }
  | { type: 'briefOk'; on: boolean }
  | { type: 'ready' }
  | { type: 'unready' }
  | { type: 'effort'; efforts: Record<string, Effort>; car?: string | null; plays?: RacePlay[] }
  | { type: 'unlock' };

// ---- client -> server ----
export type PresidentAction =
  | 'start'
  | 'addBot'
  | 'removeBot'
  | 'rematch'
  | 'nextStage'
  | 'tutorialOn'
  | 'tutorialOff'
  | 'commentaryOn'
  | 'commentaryOff'
  | 'briefNext'
  | 'briefBack'
  | 'briefDone';

/** Wat de tv (of de laptop waarop de tv draait) zelf mag doen, zonder telefoon. */
export type TvControl = 'start' | 'stop' | 'rematch';

export type ClientMsg =
  | { t: 'tv:create'; origin: string }
  | { t: 'tv:resume'; code: string; origin: string }
  | { t: 'tv:control'; what: TvControl }
  | { t: 'player:join'; code: string; name: string; token?: string }
  | { t: 'act'; action: PlayerAction }
  | { t: 'president'; what: PresidentAction }
  | { t: 'takeover' }; // een speler neemt zijn ploeg terug van de automatische piloot

export interface FeedBatch {
  id: number;
  lines: Line[];
  interrupt?: boolean; // onderbreek wat er nog wordt voorgelezen (bij het bladeren door de uitleg)
}

export interface RoomInfo {
  code: string;
  joinUrl: string;
  presidentTeamId: string | null;
  connected: Record<string, boolean>;
  autopilot: Record<string, boolean>; // een bot speelt voor dit team omdat de speler weg of afwezig is
  phaseEndsAt: number | null;
  serverNow: number;
}

// ---- server -> client ----
export type ServerMsg =
  | { t: 'error'; message: string; fatal?: boolean }
  | ({ t: 'tv:state'; state: PublicState; feed: FeedBatch[] } & RoomInfo)
  | { t: 'joined'; teamId: string; token: string; code: string }
  | ({ t: 'player:state'; state: PublicState; me: PlayerView | null; teamId: string } & RoomInfo);
