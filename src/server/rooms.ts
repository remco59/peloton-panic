// Room management: one Room per TV session. Holds the authoritative GameState, the
// connected sockets, phase timers, bots, and the commentary feed.

import { randomInt, randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { eventLines, finishLines, introLines, roundLines, tradeLines } from '../shared/commentary';
import type { Line } from '../shared/commentary';
import { botPlays, createGame, matchSpecs, reduce, RuleError, toPlayerView, toPublic } from '../shared/engine';
import type { ClientMsg, FeedBatch, PlayerAction, RoomInfo, ServerMsg } from '../shared/protocol';
import type { Action, GameState } from '../shared/types';
import { warm } from './tts';

export const TIMING = {
  playMs: 30_000,
  resolveMs: 7_000,
  tradeMs: 25_000,
};

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
const FEED_KEEP = 8;

interface Seat {
  token: string;
  sockets: Set<WebSocket>; // a seat may be open on more than one device (phone plus a spare tab)
}

export class Room {
  state: GameState = createGame(randomInt(1, 2 ** 31 - 1));
  tvs = new Set<WebSocket>();
  seats = new Map<string, Seat>();
  presidentTeamId: string | null = null;
  phaseEndsAt: number | null = null;
  feed: FeedBatch[] = [];
  lastActive = Date.now();
  private feedSeq = 0;
  private timer: NodeJS.Timeout | null = null;
  private botTimers: NodeJS.Timeout[] = [];

  constructor(
    readonly code: string,
    public joinBase: string,
  ) {}

  // ---- Messaging ----

  private info(): RoomInfo {
    const connected: Record<string, boolean> = {};
    for (const t of this.state.teams) connected[t.id] = t.isBot || (this.seats.get(t.id)?.sockets.size ?? 0) > 0;
    return {
      code: this.code,
      joinUrl: `${this.joinBase}/play?room=${this.code}`,
      presidentTeamId: this.presidentTeamId,
      connected,
      phaseEndsAt: this.phaseEndsAt,
      serverNow: Date.now(),
    };
  }

  broadcast(): void {
    const state = toPublic(this.state);
    const info = this.info();
    for (const ws of this.tvs) send(ws, { t: 'tv:state', state, feed: this.feed, ...info });
    for (const [teamId, seat] of this.seats) {
      const msg: ServerMsg = {
        t: 'player:state',
        state,
        me: toPlayerView(this.state, teamId),
        teamId,
        ...info,
      };
      for (const ws of seat.sockets) send(ws, msg);
    }
  }

  private say(lines: Line[]): void {
    if (lines.length === 0) return;
    this.feed.push({ id: ++this.feedSeq, lines });
    if (this.feed.length > FEED_KEEP) this.feed.shift();
    for (const l of lines) warm(l.speaker, l.text);
  }

  // ---- Connections ----

  attachTv(ws: WebSocket): void {
    this.tvs.add(ws);
    this.broadcast();
  }

  detach(ws: WebSocket): void {
    this.tvs.delete(ws);
    for (const seat of this.seats.values()) seat.sockets.delete(ws);
    this.broadcast();
  }

  join(ws: WebSocket, name: string, token?: string): { teamId: string; token: string } {
    this.lastActive = Date.now();
    if (token) {
      for (const [teamId, seat] of this.seats) {
        if (seat.token === token) {
          seat.sockets.add(ws);
          this.broadcast();
          return { teamId, token };
        }
      }
    }
    if (this.state.phase !== 'lobby') throw new RuleError('This race has already started. Ask for the next one!');
    this.state = reduce(this.state, { type: 'join', name });
    const team = this.state.teams[this.state.teams.length - 1];
    const seat: Seat = { token: randomUUID(), sockets: new Set([ws]) };
    this.seats.set(team.id, seat);
    if (!this.presidentTeamId) this.presidentTeamId = team.id;
    this.broadcast();
    return { teamId: team.id, token: seat.token };
  }

  // ---- Actions ----

  playerAct(teamId: string, a: PlayerAction): void {
    this.lastActive = Date.now();
    let action: Action;
    switch (a.type) {
      case 'nameRiders':
        action = { type: 'nameRiders', teamId, names: a.names };
        break;
      case 'play':
        action = { type: 'play', teamId, plays: a.plays };
        break;
      case 'unlock':
        action = { type: 'unlock', teamId };
        break;
      case 'offer':
        action = { type: 'offer', teamId, to: a.to, give: a.give, want: a.want };
        break;
      case 'withdraw':
        action = { type: 'withdraw', teamId };
        break;
      case 'respond':
        action = { type: 'respond', teamId, offerId: a.offerId, accept: a.accept };
        break;
      case 'tradeReady':
        action = { type: 'tradeReady', teamId };
        break;
    }
    this.dispatch(action);
  }

  president(teamId: string, what: Extract<ClientMsg, { t: 'president' }>['what']): void {
    if (teamId !== this.presidentTeamId) throw new RuleError('Only the president can do that');
    this.lastActive = Date.now();
    switch (what) {
      case 'start':
        return this.dispatch({ type: 'start' });
      case 'rematch':
        return this.dispatch({ type: 'rematch' });
      case 'removeBot':
        return this.dispatch({ type: 'removeBot' });
      case 'addBot': {
        const names = ['Bot Bram', 'Bot Sanne', 'Bot Joris', 'Bot Fleur', 'Bot Daan', 'Bot Lotte'];
        return this.dispatch({
          type: 'join',
          name: names[this.state.teams.length % names.length],
          isBot: true,
        });
      }
    }
  }

  /** The single place state changes. Handles timers, bots and commentary on transitions. */
  dispatch(action: Action): void {
    const prev = this.state;
    this.state = reduce(prev, action); // throws RuleError on illegal moves
    const changed = prev.phase !== this.state.phase || prev.round !== this.state.round;
    if (changed) this.onEnter(prev);
    else if (this.state.phase === 'trade') this.scheduleBotTrades();
    this.broadcast();
  }

  private clearTimers(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const t of this.botTimers) clearTimeout(t);
    this.botTimers = [];
  }

  private after(ms: number, fn: () => void): NodeJS.Timeout {
    return setTimeout(() => {
      try {
        fn();
      } catch (e) {
        if (!(e instanceof RuleError)) console.error('[room]', e);
      }
    }, ms);
  }

  private onEnter(prev: GameState): void {
    this.clearTimers();
    const s = this.state;
    const pub = toPublic(s);
    switch (s.phase) {
      case 'play': {
        const lines: Line[] = [];
        if (prev.phase === 'lobby') lines.push(...introLines(pub));
        lines.push(...eventLines(pub));
        this.say(lines);
        this.phaseEndsAt = Date.now() + TIMING.playMs;
        this.timer = this.after(TIMING.playMs, () => this.dispatch({ type: 'timeout' }));
        this.scheduleBotPlays();
        break;
      }
      case 'resolve': {
        this.say(roundLines(pub));
        this.phaseEndsAt = Date.now() + TIMING.resolveMs;
        this.timer = this.after(TIMING.resolveMs, () => this.dispatch({ type: 'next' }));
        break;
      }
      case 'trade': {
        this.say(tradeLines(pub));
        this.phaseEndsAt = Date.now() + TIMING.tradeMs;
        this.timer = this.after(TIMING.tradeMs, () => this.dispatch({ type: 'timeout' }));
        this.scheduleBotTrades();
        break;
      }
      case 'finished':
        this.say(finishLines(pub));
        this.phaseEndsAt = null;
        break;
      case 'lobby':
        this.phaseEndsAt = null;
        this.feed = [];
        break;
    }
  }

  private scheduleBotPlays(): void {
    const round = this.state.round;
    for (const t of this.state.teams) {
      if (!t.isBot) continue;
      const delay = 2500 + Math.random() * 9000;
      this.botTimers.push(
        this.after(delay, () => {
          if (this.state.phase !== 'play' || this.state.round !== round) return;
          const plays = botPlays(this.state, t.id, Math.random);
          this.dispatch({ type: 'play', teamId: t.id, plays });
        }),
      );
    }
  }

  private scheduledOffers = new Set<string>();

  private scheduleBotTrades(): void {
    const round = this.state.round;
    for (const t of this.state.teams) {
      if (!t.isBot) continue;
      if (!this.scheduledOffers.has(`ready:${round}:${t.id}`)) {
        this.scheduledOffers.add(`ready:${round}:${t.id}`);
        this.botTimers.push(
          this.after(4000 + Math.random() * 6000, () => {
            if (this.state.phase === 'trade' && this.state.round === round)
              this.dispatch({ type: 'tradeReady', teamId: t.id });
          }),
        );
      }
    }
    for (const o of this.state.offers) {
      const to = this.state.teams.find((x) => x.id === o.to);
      if (!to?.isBot || this.scheduledOffers.has(o.id)) continue;
      this.scheduledOffers.add(o.id);
      this.botTimers.push(
        this.after(1500 + Math.random() * 2500, () => {
          if (this.state.phase !== 'trade') return;
          const live = this.state.offers.find((x) => x.id === o.id);
          if (!live) return;
          const team = this.state.teams.find((x) => x.id === o.to)!;
          const can = !!matchSpecs(team.hand, live.want);
          this.dispatch({ type: 'respond', teamId: o.to, offerId: o.id, accept: can && Math.random() < 0.6 });
        }),
      );
    }
  }
}

// ---- Registry -----------------------------------------------------------------

const rooms = new Map<string, Room>();

export function createRoom(joinBase: string): Room {
  let code = '';
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  const room = new Room(code, joinBase);
  rooms.set(code, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.trim().toUpperCase());
}

export function sweepRooms(maxIdleMs = 3 * 60 * 60 * 1000): void {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const alive = room.tvs.size > 0 || [...room.seats.values()].some((s) => s.sockets.size > 0);
    if (!alive && now - room.lastActive > maxIdleMs) rooms.delete(code);
  }
}

export function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
