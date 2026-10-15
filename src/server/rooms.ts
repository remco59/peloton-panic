// Kamers: één Room per tv-sessie. Bewaart de gezaghebbende GameState, de verbonden
// sockets, fasetimers, bots en de commentaarfeed.

import { randomInt, randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  contractLines,
  eventLines,
  finishLines,
  introLines,
  kopmanLines,
  namingLines,
  pickLines,
  recruitIntroLines,
  recruitLines,
  roundLines,
  stageLines,
  stageResultLines,
  teamPhaseLines,
  tutorialLines,
} from '../shared/commentary';
import type { Line, TutorialTopic } from '../shared/commentary';
import {
  botDraft,
  botRacePlan,
  botShopStep,
  botStep,
  createGame,
  reduce,
  RuleError,
  toPlayerView,
  toPublic,
} from '../shared/engine';
import type { ClientMsg, FeedBatch, PlayerAction, PresidentAction, RoomInfo, ServerMsg } from '../shared/protocol';
import { BRIEFING } from '../shared/content';
import type { Action, GameState } from '../shared/types';
import { warm } from './tts';

export const TIMING = {
  recruitMs: 90_000, // iedereen winkelt tegelijk in zijn eigen winkel
  draftMs: 20_000,
  teamMs: 90_000,
  raceMs: 30_000, // naast het tempo kies je ook volgauto en kaarten
  resolveMs: 7_000,
  resultsMs: 35_000,
  tutorialFactor: 1.6, // meer tijd als de commentatoren uitleg geven
};

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // geen I of O
const FEED_KEEP = 10;
const BOT_NAMES = ['Bot Bram', 'Bot Sanne', 'Bot Joris', 'Bot Fleur', 'Bot Daan', 'Bot Lotte'];

interface Seat {
  token: string;
  sockets: Set<WebSocket>; // een stoel kan op meer dan één apparaat open staan
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
  private explained = new Set<TutorialTopic>();

  constructor(
    readonly code: string,
    public joinBase: string,
  ) {}

  // ---- Berichten ----

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
      const msg: ServerMsg = { t: 'player:state', state, me: toPlayerView(this.state, teamId), teamId, ...info };
      for (const ws of seat.sockets) send(ws, msg);
    }
  }

  private say(all: Line[], interrupt = false): void {
    // Met commentaar uit blijft alleen Fenna (de tutorial-uitleg) over.
    const lines = this.state.commentary ? all : all.filter((l) => l.speaker === 'fenna');
    if (lines.length === 0) return;
    this.feed.push({ id: ++this.feedSeq, lines, ...(interrupt ? { interrupt } : {}) });
    if (this.feed.length > FEED_KEEP) this.feed.shift();
    for (const l of lines) warm(l.speaker, l.text);
  }

  /** Uitleg, alleen bij tutorial en slechts één keer per onderwerp. */
  private explain(topic: TutorialTopic): Line[] {
    if (!this.state.tutorial || this.explained.has(topic)) return [];
    this.explained.add(topic);
    return tutorialLines(topic, toPublic(this.state));
  }

  private scaled(ms: number): number {
    return this.state.tutorial ? Math.round(ms * TIMING.tutorialFactor) : ms;
  }

  // ---- Verbindingen ----

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
    if (this.state.phase !== 'lobby') throw new RuleError('Deze race is al begonnen. Vraag om de volgende!');
    this.state = reduce(this.state, { type: 'join', name });
    const team = this.state.teams[this.state.teams.length - 1];
    const seat: Seat = { token: randomUUID(), sockets: new Set([ws]) };
    this.seats.set(team.id, seat);
    if (!this.presidentTeamId) this.presidentTeamId = team.id;
    this.broadcast();
    return { teamId: team.id, token: seat.token };
  }

  // ---- Acties ----

  playerAct(teamId: string, a: PlayerAction): void {
    this.lastActive = Date.now();
    this.dispatch({ ...a, teamId } as Action);
  }

  president(teamId: string, what: PresidentAction): void {
    if (teamId !== this.presidentTeamId) throw new RuleError('Alleen de president kan dat');
    this.lastActive = Date.now();
    switch (what) {
      case 'start':
        return this.dispatch({ type: 'start' });
      case 'rematch':
        return this.dispatch({ type: 'rematch' });
      case 'removeBot':
        return this.dispatch({ type: 'removeBot' });
      case 'nextStage':
        return this.dispatch({ type: 'nextStage' });
      case 'briefNext':
      case 'briefBack': {
        const page = this.state.briefing?.page ?? 0;
        return this.dispatch({ type: 'briefPage', page: page + (what === 'briefNext' ? 1 : -1) });
      }
      case 'briefDone':
        return this.dispatch({ type: 'briefDone' });
      case 'tutorialOn':
        return this.dispatch({ type: 'setTutorial', on: true });
      case 'tutorialOff':
        return this.dispatch({ type: 'setTutorial', on: false });
      case 'commentaryOn':
        return this.dispatch({ type: 'setCommentary', on: true });
      case 'commentaryOff':
        return this.dispatch({ type: 'setCommentary', on: false });
      case 'addBot':
        return this.dispatch({
          type: 'join',
          name: BOT_NAMES[this.state.teams.length % BOT_NAMES.length],
          isBot: true,
        });
    }
  }

  /** De enige plek waar de toestand verandert: timers, bots en commentaar bij overgangen. */
  dispatch(action: Action): void {
    const prev = this.state;
    this.state = reduce(prev, action); // gooit RuleError bij een illegale zet
    const s = this.state;

    if (action.type === 'draftPick') this.commentPick(prev, action.teamId, action.source);
    if (action.type === 'recruit') this.commentRecruit(prev, action.teamId, action.itemId);
    // Bij het bladeren door de uitleg leest een commentator de samenvatting van de nieuwe pagina voor.
    if (action.type === 'briefPage' && s.briefing && s.briefing.page !== prev.briefing?.page) {
      const say = BRIEFING[s.briefing.page]?.say;
      if (say) this.say([say], true);
    }
    if (action.type === 'setTutorial' || action.type === 'rematch') this.explained.clear();

    const draftTurn = (x: GameState) => (x.phase === 'draft' && x.draft ? x.draft.idx : -1);
    const changed =
      prev.phase !== s.phase ||
      prev.round !== s.round ||
      prev.stage !== s.stage ||
      draftTurn(prev) !== draftTurn(s);
    if (changed) this.onEnter(prev);
    this.broadcast();
  }

  private commentPick(prev: GameState, teamId: string, source: Extract<Action, { type: 'draftPick' }>['source']): void {
    const team = this.state.teams.find((t) => t.id === teamId);
    if (!team) return;
    const def =
      source.kind === 'market' ? prev.market[source.index]?.def : team.hand[team.hand.length - 1]?.def;
    if (def) this.say(pickLines(team.name, def));
  }

  private commentRecruit(prev: GameState, teamId: string, itemId: string): void {
    const team = this.state.teams.find((t) => t.id === teamId);
    const item = prev.recruit?.shops[teamId]?.find((x) => x.id === itemId);
    if (!team || !item) return;
    this.say(item.kind === 'rider' ? recruitLines(team.name, item.rider, item.price) : contractLines(team.name, item.def));
  }

  private clearTimers(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const t of this.botTimers) clearTimeout(t);
    this.botTimers = [];
  }

  private after(ms: number, fn: () => void, bot = false): NodeJS.Timeout {
    const t = setTimeout(() => {
      try {
        fn();
      } catch (e) {
        if (!(e instanceof RuleError)) console.error('[room]', e);
      }
    }, ms);
    if (bot) this.botTimers.push(t);
    return t;
  }

  private setPhaseTimer(ms: number, action: Action): void {
    this.phaseEndsAt = Date.now() + ms;
    this.timer = this.after(ms, () => this.dispatch(action));
  }

  private onEnter(prev: GameState): void {
    this.clearTimers();
    const s = this.state;
    const pub = toPublic(s);
    switch (s.phase) {
      case 'briefing': {
        // Geen timer: de president bladert door de uitleg, iedereen leest mee.
        this.phaseEndsAt = null;
        this.say([BRIEFING[0].say], true);
        break;
      }
      case 'recruit': {
        this.say([...recruitIntroLines(pub), ...this.explain('recruit')]);
        this.setPhaseTimer(this.scaled(TIMING.recruitMs), { type: 'timeout' });
        this.scheduleBotRecruit();
        break;
      }
      case 'naming': {
        // Geen timer: iedereen geeft zijn renners een naam en drukt op klaar.
        this.phaseEndsAt = null;
        this.say(namingLines(pub));
        break;
      }
      case 'draft': {
        const first = s.draft?.idx === 0;
        if (first) {
          const lines: Line[] = [];
          if (prev.phase === 'briefing') lines.push(...introLines(pub));
          else lines.push(...this.explain('fade'));
          lines.push(...stageLines(pub));
          lines.push(...this.explain('draft'));
          this.say(lines);
        }
        this.setPhaseTimer(this.scaled(TIMING.draftMs), { type: 'timeout' });
        this.scheduleBotDraft();
        this.nudgeDraftTurn();
        break;
      }
      case 'team': {
        this.say([...teamPhaseLines(pub), ...this.explain('team')]);
        this.setPhaseTimer(this.scaled(TIMING.teamMs), { type: 'timeout' });
        this.scheduleBotTeams();
        // Uitleg in doseerbare stukjes, terwijl spelers aan het werk zijn.
        if (this.state.tutorial) {
          this.after(this.scaled(30_000), () => this.say(this.explain('train')), true);
          this.after(this.scaled(55_000), () => this.say(this.explain('trade')), true);
        }
        break;
      }
      case 'race': {
        this.say([
          ...(s.round === 1 ? kopmanLines(pub) : []),
          ...eventLines(pub),
          ...this.explain('race'),
          // De uitleg over gel, volgauto en blokkades komt een ronde later, zodat het niet te veel tegelijk is.
          ...(s.round >= 2 ? this.explain('items') : []),
        ]);
        this.setPhaseTimer(this.scaled(TIMING.raceMs), { type: 'timeout' });
        this.scheduleBotEfforts();
        break;
      }
      case 'resolve': {
        const extra = [...this.explain('resolve')];
        if (s.report?.moves.some((m) => m.exhausted)) extra.push(...this.explain('exhausted'));
        this.say([...roundLines(pub), ...extra]);
        this.setPhaseTimer(this.scaled(TIMING.resolveMs), { type: 'next' });
        break;
      }
      case 'results': {
        this.say([...stageResultLines(pub), ...this.explain('results')]);
        this.setPhaseTimer(this.scaled(TIMING.resultsMs), { type: 'nextStage' });
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

  /** Met tutorial aan: zeg wie er aan de beurt is, zodat niemand zijn kans mist. */
  private nudgeDraftTurn(): void {
    if (!this.state.tutorial) return;
    const id = this.state.draft ? this.state.draft.order[this.state.draft.idx] : null;
    const team = this.state.teams.find((t) => t.id === id);
    if (!team || team.isBot) return;
    this.say([
      { speaker: 'fenna', text: `${team.name}, jij bent aan de beurt. Pak een kaart op je telefoon.` },
    ]);
  }

  // ---- Bots ----

  private scheduleBotRecruit(): void {
    for (const t of this.state.teams) {
      if (!t.isBot) continue;
      const step = () => {
        if (this.state.phase !== 'recruit') return;
        const next = botShopStep(this.state, t.id, Math.random);
        if (!next) return;
        this.dispatch(next);
        this.after(900 + Math.random() * 1400, step, true);
      };
      this.after(1500 + Math.random() * 3000, step, true);
    }
  }

  private scheduleBotDraft(): void {
    const s = this.state;
    const teamId = s.draft ? s.draft.order[s.draft.idx] : null;
    const team = s.teams.find((t) => t.id === teamId);
    if (!team?.isBot) return;
    this.after(
      1200 + Math.random() * 1800,
      () => {
        if (this.state.phase !== 'draft' || this.state.draft?.order[this.state.draft.idx] !== team.id) return;
        this.dispatch({ type: 'draftPick', teamId: team.id, source: botDraft(this.state, team.id, Math.random) });
      },
      true,
    );
  }

  private scheduleBotTeams(): void {
    for (const t of this.state.teams) {
      if (!t.isBot) continue;
      const step = () => {
        if (this.state.phase !== 'team') return;
        const next = botStep(this.state, t.id, Math.random);
        if (next) {
          this.dispatch(next);
          this.after(700 + Math.random() * 900, step, true);
        } else {
          this.dispatch({ type: 'ready', teamId: t.id });
        }
      };
      this.after(1500 + Math.random() * 3000, step, true);
    }
  }

  private scheduleBotEfforts(): void {
    const round = this.state.round;
    for (const t of this.state.teams) {
      if (!t.isBot) continue;
      this.after(
        2500 + Math.random() * 6000,
        () => {
          if (this.state.phase !== 'race' || this.state.round !== round) return;
          this.dispatch({ type: 'effort', teamId: t.id, ...botRacePlan(this.state, t.id, Math.random) });
        },
        true,
      );
    }
  }
}

// ---- Register -----------------------------------------------------------------

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

// Voor de volledigheid: ClientMsg wordt in index.ts gebruikt.
export type { ClientMsg };
