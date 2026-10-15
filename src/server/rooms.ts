// Kamers: één Room per tv-sessie. Bewaart de gezaghebbende GameState, de verbonden
// sockets, fasetimers, bots en de commentaarfeed.

import { randomInt, randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  sponsorsIntroLines,
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
import type { ClientMsg, FeedBatch, PlayerAction, PresidentAction, RoomInfo, ServerMsg, TvControl } from '../shared/protocol';
import { BRIEFING } from '../shared/content';
import type { Action, GameState } from '../shared/types';
import { warm } from './tts';

export const TIMING = {
  sponsorsMs: 75_000, // eerst de sponsors: iedereen kiest tegelijk uit zijn eigen zes contracten
  recruitMs: 150_000, // dan de renners: negen kandidaten om te vergelijken, met het budget dat overblijft
  namingMs: 120_000, // renners een naam geven; daarna houdt wie niets deed de willekeurige namen
  draftMs: 20_000,
  teamMs: 90_000,
  raceMs: 30_000, // naast het tempo kies je ook volgauto en kaarten
  resolveMs: 7_000,
  resultsMs: 35_000,
  tutorialFactor: 1.6, // meer tijd als de commentatoren uitleg geven
  awayGraceMs: 30_000, // zo lang mag een telefoon weg zijn voordat een bot overneemt
  idleMisses: 2, // zo vaak achter elkaar een timer missen voordat een bot overneemt
};

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // geen I of O
const FEED_KEEP = 10;
const BOT_NAMES = ['Bot Bram', 'Bot Sanne', 'Bot Joris', 'Bot Fleur', 'Bot Daan', 'Bot Lotte'];

interface Seat {
  token: string;
  sockets: Set<WebSocket>; // een stoel kan op meer dan één apparaat open staan
}

/** Alles wat nodig is om een kamer na een herstart van de server weer op te pakken. */
export interface RoomSnapshot {
  v: 1;
  code: string;
  joinBase: string;
  state: GameState;
  seats: Record<string, string>; // team-id -> token
  presidentTeamId: string | null;
  phaseEndsAt: number | null;
  autopilot: string[];
  missed: Record<string, number>;
  explained: TutorialTopic[];
  lastActive: number;
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
  /** Teams waar een bot voor speelt omdat de speler weg of afwezig is. */
  autopilot = new Set<string>();
  private missed = new Map<string, number>();
  private acted = new Set<string>(); // teams die sinds de vorige fasetimer iets hebben gedaan
  private awayTimers = new Map<string, NodeJS.Timeout>();
  /** Wordt na elke wijziging aangeroepen, zodat de kamer bewaard kan worden. */
  onChange: ((room: Room) => void) | null = null;
  private quiet = false; // tijdens herstel: geen commentaar
  private resumeMs: number | null = null; // tijdens herstel: de resterende tijd van de fase

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
      autopilot: Object.fromEntries([...this.autopilot].map((id) => [id, true])),
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
    this.onChange?.(this);
  }

  snapshot(): RoomSnapshot {
    return {
      v: 1,
      code: this.code,
      joinBase: this.joinBase,
      state: this.state,
      seats: Object.fromEntries([...this.seats].map(([teamId, seat]) => [teamId, seat.token])),
      presidentTeamId: this.presidentTeamId,
      phaseEndsAt: this.phaseEndsAt,
      autopilot: [...this.autopilot],
      missed: Object.fromEntries(this.missed),
      explained: [...this.explained],
      lastActive: this.lastActive,
    };
  }

  /** Zet een bewaarde kamer weer in gang: timers en bots lopen door, commentaar blijft stil. */
  static restore(snap: RoomSnapshot): Room {
    const room = new Room(snap.code, snap.joinBase);
    room.state = snap.state;
    for (const [teamId, token] of Object.entries(snap.seats)) room.seats.set(teamId, { token, sockets: new Set() });
    room.presidentTeamId = snap.presidentTeamId;
    room.autopilot = new Set(snap.autopilot);
    room.missed = new Map(Object.entries(snap.missed));
    room.explained = new Set(snap.explained);
    room.lastActive = snap.lastActive;
    room.quiet = true;
    room.resumeMs = snap.phaseEndsAt ? Math.max(3_000, snap.phaseEndsAt - Date.now()) : null;
    try {
      room.onEnter(room.state);
    } finally {
      room.quiet = false;
      room.resumeMs = null;
    }
    // Telefoons moeten zich opnieuw melden; wie dat niet doet, krijgt na de gratietijd een bot.
    for (const teamId of room.seats.keys()) room.watchAway(teamId);
    return room;
  }

  private say(all: Line[], interrupt = false): void {
    if (this.quiet) return;
    // Met commentaar uit blijft alleen Fenna (de tutorial-uitleg) over.
    const lines = this.state.commentary ? all : all.filter((l) => l.speaker === 'fenna');
    if (lines.length === 0) return;
    this.feed.push({ id: ++this.feedSeq, lines, ...(interrupt ? { interrupt } : {}) });
    if (this.feed.length > FEED_KEEP) this.feed.shift();
    for (const l of lines) warm(l.speaker, l.text);
  }

  /** Uitleg, alleen bij tutorial en slechts één keer per onderwerp. */
  private explain(topic: TutorialTopic): Line[] {
    if (this.quiet || !this.state.tutorial || this.explained.has(topic)) return [];
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
    for (const [teamId, seat] of this.seats) {
      if (seat.sockets.delete(ws) && seat.sockets.size === 0) this.watchAway(teamId);
    }
    this.broadcast();
  }

  // ---- Automatische piloot ----

  private botLike(teamId: string): boolean {
    return !!this.state.teams.find((t) => t.id === teamId)?.isBot || this.autopilot.has(teamId);
  }

  /** Start de gratietijd; is de telefoon daarna nog weg, dan neemt een bot over. */
  private watchAway(teamId: string): void {
    clearTimeout(this.awayTimers.get(teamId));
    this.awayTimers.set(
      teamId,
      setTimeout(() => {
        this.awayTimers.delete(teamId);
        if ((this.seats.get(teamId)?.sockets.size ?? 0) === 0) this.goAuto(teamId);
      }, TIMING.awayGraceMs),
    );
  }

  private goAuto(teamId: string): void {
    const team = this.state.teams.find((t) => t.id === teamId);
    if (!team || team.isBot) return;
    // Zonder aanwezige president kan niemand de uitleg doorbladeren of de volgende etappe starten.
    if (this.presidentTeamId === teamId) this.passPresident();
    const playing = this.state.phase !== 'lobby' && this.state.phase !== 'finished';
    if (playing && !this.autopilot.has(teamId)) {
      this.autopilot.add(teamId);
      this.kickAuto(teamId);
    }
    this.broadcast();
  }

  private passPresident(): void {
    const next = this.state.teams.find(
      (t) => !t.isBot && t.id !== this.presidentTeamId && (this.seats.get(t.id)?.sockets.size ?? 0) > 0,
    );
    if (next) this.presidentTeamId = next.id;
  }

  /** De speler is terug (of doet iets): hij speelt weer zelf. */
  private handBack(teamId: string): void {
    clearTimeout(this.awayTimers.get(teamId));
    this.awayTimers.delete(teamId);
    this.missed.delete(teamId);
    this.autopilot.delete(teamId);
  }

  takeover(teamId: string): void {
    this.lastActive = Date.now();
    this.handBack(teamId);
    this.acted.add(teamId);
    this.broadcast();
  }

  /** Een team dat zojuist op de piloot is gezet, doet meteen mee met wat er in deze fase te doen is. */
  private kickAuto(teamId: string): void {
    switch (this.state.phase) {
      case 'sponsors':
      case 'recruit':
        return this.scheduleBotRecruit([teamId]);
      case 'naming':
        return this.scheduleAutoNaming([teamId]);
      case 'draft':
        return this.scheduleBotDraft();
      case 'team':
        return this.scheduleBotTeams([teamId]);
      case 'race':
        return this.scheduleBotEfforts([teamId]);
    }
  }

  /**
   * Bij het aflopen van een fasetimer: een team dat sinds de vorige timer helemaal niets deed en nu
   * ook niet klaar of vergrendeld is, krijgt een strafpunt. Twee achter elkaar is afwezig.
   * Wie alleen de timer laat aflopen nadat hij wel iets deed, blijft zelf spelen.
   */
  private noteMisses(): void {
    const s = this.state;
    let waiting: string[] = [];
    if (s.phase === 'race') waiting = s.teams.filter((t) => !s.locked[t.id]).map((t) => t.id);
    else if (s.phase === 'team' || s.phase === 'sponsors' || s.phase === 'recruit' || s.phase === 'naming') waiting = s.teams.filter((t) => !s.ready[t.id]).map((t) => t.id);
    else if (s.phase === 'draft' && s.draft) waiting = [s.draft.order[s.draft.idx]];
    for (const t of s.teams) {
      if (this.botLike(t.id)) continue;
      if (this.acted.has(t.id) || !waiting.includes(t.id)) {
        this.missed.delete(t.id);
        continue;
      }
      const n = (this.missed.get(t.id) ?? 0) + 1;
      this.missed.set(t.id, n);
      if (n >= TIMING.idleMisses) this.autopilot.add(t.id);
    }
    this.acted.clear();
  }

  join(ws: WebSocket, name: string, token?: string): { teamId: string; token: string } {
    this.lastActive = Date.now();
    if (token) {
      for (const [teamId, seat] of this.seats) {
        if (seat.token === token) {
          seat.sockets.add(ws);
          this.handBack(teamId);
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
    this.handBack(teamId);
    this.acted.add(teamId);
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

  /** Een bediening vanaf de tv of laptop: starten, het spel afbreken of een nieuw seizoen beginnen. */
  tvControl(what: TvControl): void {
    this.lastActive = Date.now();
    this.dispatch({ type: what });
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
    if (action.type === 'setTutorial' || action.type === 'rematch' || action.type === 'stop') this.explained.clear();
    if (action.type === 'rematch' || action.type === 'stop') {
      // Een nieuw spel begint schoon: niemand speelt nog op de piloot of heeft strafpunten.
      this.autopilot.clear();
      this.missed.clear();
      this.acted.clear();
    }

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

  private setPhaseTimer(fullMs: number, action: Action): void {
    const ms = this.resumeMs ?? fullMs;
    this.phaseEndsAt = Date.now() + ms;
    this.timer = this.after(ms, () => {
      if (action.type === 'timeout') this.noteMisses();
      this.dispatch(action);
    });
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
      case 'sponsors': {
        this.say([...sponsorsIntroLines(pub), ...this.explain('sponsors')]);
        this.setPhaseTimer(this.scaled(TIMING.sponsorsMs), { type: 'timeout' });
        this.scheduleBotRecruit();
        break;
      }
      case 'recruit': {
        this.say([...recruitIntroLines(pub), ...this.explain('recruit')]);
        this.setPhaseTimer(this.scaled(TIMING.recruitMs), { type: 'timeout' });
        this.scheduleBotRecruit();
        break;
      }
      case 'naming': {
        this.say(namingLines(pub));
        this.setPhaseTimer(this.scaled(TIMING.namingMs), { type: 'timeout' });
        this.scheduleAutoNaming();
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

  /** Bots winkelen in de sponsorfase en in de rekruteerfase; in elke fase begint hun planning opnieuw. */
  private scheduleBotRecruit(only?: string[]): void {
    const phase = this.state.phase;
    for (const t of this.state.teams) {
      if (!this.botLike(t.id) || (only && !only.includes(t.id))) continue;
      const step = () => {
        if (this.state.phase !== phase || !this.botLike(t.id)) return;
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
    if (!team || !this.botLike(team.id)) return;
    this.after(
      1200 + Math.random() * 1800,
      () => {
        if (this.state.phase !== 'draft' || this.state.draft?.order[this.state.draft.idx] !== team.id) return;
        if (!this.botLike(team.id)) return;
        this.dispatch({ type: 'draftPick', teamId: team.id, source: botDraft(this.state, team.id, Math.random) });
      },
      true,
    );
  }

  private scheduleBotTeams(only?: string[]): void {
    for (const t of this.state.teams) {
      if (!this.botLike(t.id) || (only && !only.includes(t.id))) continue;
      const step = () => {
        if (this.state.phase !== 'team' || !this.botLike(t.id)) return;
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

  /** Een team op de piloot geeft zijn renners geen eigen naam, maar houdt de willekeurige en meldt zich klaar. */
  private scheduleAutoNaming(only?: string[]): void {
    for (const t of this.state.teams) {
      if (t.isBot || !this.autopilot.has(t.id) || (only && !only.includes(t.id))) continue;
      this.after(
        1500 + Math.random() * 2500,
        () => {
          if (this.state.phase !== 'naming' || !this.autopilot.has(t.id) || this.state.ready[t.id]) return;
          this.dispatch({ type: 'ready', teamId: t.id });
        },
        true,
      );
    }
  }

  private scheduleBotEfforts(only?: string[]): void {
    const round = this.state.round;
    for (const t of this.state.teams) {
      if (!this.botLike(t.id) || (only && !only.includes(t.id))) continue;
      this.after(
        2500 + Math.random() * 6000,
        () => {
          if (this.state.phase !== 'race' || this.state.round !== round || !this.botLike(t.id)) return;
          this.dispatch({ type: 'effort', teamId: t.id, ...botRacePlan(this.state, t.id, Math.random) });
        },
        true,
      );
    }
  }
}

// ---- Register -----------------------------------------------------------------

const rooms = new Map<string, Room>();

// ---- Bewaren -------------------------------------------------------------------
// Uit totdat de server `enablePersistence` aanroept, zodat tests geen bestanden schrijven.

let persistDir: string | null = null;
const saveTimers = new Map<string, NodeJS.Timeout>();
const SAVE_DEBOUNCE_MS = 400;

function fileOf(code: string): string {
  return join(persistDir!, `${code}.json`);
}

function writeRoom(room: Room): void {
  if (!persistDir) return;
  try {
    const file = fileOf(room.code);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(room.snapshot()));
    renameSync(tmp, file); // atomair: een crash midden in het schrijven laat nooit een half bestand achter
  } catch (e) {
    console.warn('[rooms] bewaren mislukt:', (e as Error).message);
  }
}

function saveSoon(room: Room): void {
  if (saveTimers.has(room.code)) return;
  saveTimers.set(
    room.code,
    setTimeout(() => {
      saveTimers.delete(room.code);
      writeRoom(room);
    }, SAVE_DEBOUNCE_MS),
  );
}

/** Schrijf alle kamers nu weg (bij afsluiten van de server). */
export function flushRooms(): void {
  for (const t of saveTimers.values()) clearTimeout(t);
  saveTimers.clear();
  for (const room of rooms.values()) writeRoom(room);
}

/** Bewaar kamers in `dir` en laad de kamers die daar al staan. Geeft het aantal herstelde kamers. */
export function enablePersistence(dir: string, maxIdleMs = 3 * 60 * 60 * 1000): number {
  mkdirSync(dir, { recursive: true });
  persistDir = dir;
  let restored = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const file = join(dir, name);
    try {
      const snap = JSON.parse(readFileSync(file, 'utf8')) as RoomSnapshot;
      if (snap.v !== 1 || !snap.code || rooms.has(snap.code)) continue;
      if (Date.now() - snap.lastActive > maxIdleMs) {
        rmSync(file, { force: true });
        continue;
      }
      const room = Room.restore(snap);
      room.onChange = saveSoon;
      rooms.set(room.code, room);
      restored++;
    } catch (e) {
      console.warn(`[rooms] ${name} overgeslagen:`, (e as Error).message);
    }
  }
  return restored;
}

/** Alleen voor tests: vergeet alle kamers en stop met bewaren. */
export function resetRooms(): void {
  for (const t of saveTimers.values()) clearTimeout(t);
  saveTimers.clear();
  rooms.clear();
  persistDir = null;
}

export function createRoom(joinBase: string): Room {
  let code = '';
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  const room = new Room(code, joinBase);
  if (persistDir) room.onChange = saveSoon;
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
    if (!alive && now - room.lastActive > maxIdleMs) {
      rooms.delete(code);
      clearTimeout(saveTimers.get(code));
      saveTimers.delete(code);
      if (persistDir) rmSync(fileOf(code), { force: true });
    }
  }
}

export function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// Voor de volledigheid: ClientMsg wordt in index.ts gebruikt.
export type { ClientMsg };
