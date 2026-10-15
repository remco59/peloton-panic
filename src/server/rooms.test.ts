import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { RuleError } from '../shared/engine';
import type { ServerMsg } from '../shared/protocol';
import { createRoom, getRoom, sweepRooms, TIMING } from './rooms';

// Geen echte stemmen of netwerk in de tests.
vi.mock('./tts', () => ({ warm: () => {}, speak: async () => Buffer.alloc(0) }));

class FakeSocket {
  readyState = 1;
  sent: ServerMsg[] = [];
  send(raw: string): void {
    this.sent.push(JSON.parse(raw));
  }
  get last(): ServerMsg | undefined {
    return this.sent[this.sent.length - 1];
  }
}
const sock = () => new FakeSocket() as unknown as WebSocket & FakeSocket;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('room register', () => {
  it('creates 4-letter codes without I or O and finds rooms case-insensitively', () => {
    const room = createRoom('http://x');
    expect(room.code).toMatch(/^[A-HJ-NP-Z]{4}$/);
    expect(getRoom(` ${room.code.toLowerCase()} `)).toBe(room);
    expect(getRoom('ZZZZ')).toBeUndefined();
  });

  it('sweeps idle rooms but keeps rooms with a connection', () => {
    const idle = createRoom('http://x');
    const live = createRoom('http://x');
    live.attachTv(sock());
    idle.lastActive = live.lastActive = Date.now() - 10_000;
    sweepRooms(1_000);
    expect(getRoom(idle.code)).toBeUndefined();
    expect(getRoom(live.code)).toBe(live);
  });
});

describe('joining', () => {
  it('makes the first player president and lets a token rejoin the same team', () => {
    const room = createRoom('http://x');
    const a = room.join(sock(), 'Anna');
    const b = room.join(sock(), 'Ben');
    expect(room.presidentTeamId).toBe(a.teamId);
    expect(b.teamId).not.toBe(a.teamId);

    const back = room.join(sock(), 'Anna (telefoon 2)', a.token);
    expect(back.teamId).toBe(a.teamId);
    expect(room.state.teams).toHaveLength(2);
  });

  it('refuses new players once the season has started, but not returning ones', () => {
    const room = createRoom('http://x');
    const a = room.join(sock(), 'Anna');
    room.join(sock(), 'Ben');
    room.president(a.teamId, 'start');
    expect(() => room.join(sock(), 'Carl')).toThrow(RuleError);
    expect(room.join(sock(), 'Anna', a.token).teamId).toBe(a.teamId);
  });

  it('reports bots as connected and humans only while a socket is open', () => {
    const room = createRoom('http://x');
    const ws = sock();
    const a = room.join(ws, 'Anna');
    room.president(a.teamId, 'addBot');
    const tv = sock();
    room.attachTv(tv);
    const msg = tv.last;
    if (msg?.t !== 'tv:state') throw new Error('expected tv:state');
    const bot = room.state.teams.find((t) => t.isBot)!;
    expect(msg.connected[a.teamId]).toBe(true);
    expect(msg.connected[bot.id]).toBe(true);

    room.detach(ws);
    const after = tv.last;
    if (after?.t !== 'tv:state') throw new Error('expected tv:state');
    expect(after.connected[a.teamId]).toBe(false);
  });
});

describe('president actions', () => {
  it('rejects president actions from other teams', () => {
    const room = createRoom('http://x');
    room.join(sock(), 'Anna');
    const b = room.join(sock(), 'Ben');
    expect(() => room.president(b.teamId, 'start')).toThrow('Alleen de president');
  });

  it('needs at least two teams to start', () => {
    const room = createRoom('http://x');
    const a = room.join(sock(), 'Anna');
    expect(() => room.president(a.teamId, 'start')).toThrow(RuleError);
    room.president(a.teamId, 'addBot');
    room.president(a.teamId, 'start');
    expect(room.state.phase).toBe('briefing');
  });
});

describe('phase timers and bots', () => {
  function startedRoom() {
    const room = createRoom('http://x');
    const a = room.join(sock(), 'Anna');
    room.president(a.teamId, 'addBot');
    room.president(a.teamId, 'start');
    return { room, a };
  }

  it('has no timer during the briefing and starts recruiting after briefDone', () => {
    const { room, a } = startedRoom();
    expect(room.phaseEndsAt).toBeNull();
    vi.advanceTimersByTime(10 * 60_000);
    expect(room.state.phase).toBe('briefing');

    room.president(a.teamId, 'briefDone');
    expect(room.state.phase).toBe('recruit');
    expect(room.phaseEndsAt).toBeGreaterThan(Date.now());
  });

  it('moves on when the recruit timer runs out, even if the human never acts', () => {
    const { room, a } = startedRoom();
    room.president(a.teamId, 'briefDone');
    vi.advanceTimersByTime(TIMING.recruitMs + 1);
    expect(room.state.phase).not.toBe('recruit');
  });

  it('lets bots shop during recruit', () => {
    const { room, a } = startedRoom();
    room.president(a.teamId, 'briefDone');
    vi.advanceTimersByTime(30_000);
    const bot = room.state.teams.find((t) => t.isBot)!;
    expect(bot.riderIds.length).toBeGreaterThan(0);
  });

  it('waits in naming for the human (no timer), then runs on to the race by itself', () => {
    const { room, a } = startedRoom();
    room.president(a.teamId, 'briefDone');
    vi.advanceTimersByTime(TIMING.recruitMs + 1);
    expect(room.state.phase).toBe('naming');
    expect(room.phaseEndsAt).toBeNull();
    vi.advanceTimersByTime(10 * 60_000);
    expect(room.state.phase).toBe('naming'); // see issue #7: an idle human stalls the game

    room.playerAct(a.teamId, { type: 'ready' });
    // draft -> team -> race, each ending on its own timer
    for (let i = 0; i < 40 && room.state.phase !== 'race'; i++) vi.advanceTimersByTime(30_000);
    expect(room.state.phase).toBe('race');
  });
});
