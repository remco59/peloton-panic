import { mkdtempSync, existsSync, readdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { RuleError } from '../shared/engine';
import type { ServerMsg } from '../shared/protocol';
import { createRoom, enablePersistence, flushRooms, getRoom, resetRooms, Room, sweepRooms, TIMING } from './rooms';

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
  resetRooms();
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

describe('tv controls', () => {
  it('starts the season from the tv once there are two teams', () => {
    const room = createRoom('http://x');
    const a = room.join(sock(), 'Anna');
    expect(() => room.tvControl('start')).toThrow(RuleError);
    room.president(a.teamId, 'addBot');
    room.tvControl('start');
    expect(room.state.phase).toBe('briefing');
  });

  it('stops a running game and returns everyone to the lobby, then starts a new one', () => {
    vi.useFakeTimers();
    try {
      const room = createRoom('http://x');
      const a = room.join(sock(), 'Anna');
      room.president(a.teamId, 'addBot');
      room.tvControl('start');
      room.president(a.teamId, 'briefDone');
      expect(room.state.phase).toBe('sponsors');

      room.tvControl('stop');
      expect(room.state.phase).toBe('lobby');
      expect(room.state.teams).toHaveLength(2);
      expect(room.state.riders).toHaveLength(0);
      expect(room.phaseEndsAt).toBeNull();
      expect(room.autopilot.size).toBe(0);

      // Geen verlopen timer van het afgebroken spel mag de lobby nog verstoren.
      vi.advanceTimersByTime(TIMING.sponsorsMs + 5_000);
      expect(room.state.phase).toBe('lobby');

      room.tvControl('start');
      expect(room.state.phase).toBe('briefing');
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses to stop when no game is running', () => {
    const room = createRoom('http://x');
    room.join(sock(), 'Anna');
    expect(() => room.tvControl('stop')).toThrow(RuleError);
  });
});

/** Beide winkelstappen, sponsors en dan renners, laten aflopen. */
const SHOP_MS = TIMING.sponsorsMs + TIMING.recruitMs + 2;

/** De mens zet de sponsors op klaar, wacht tot de bots ook klaar zijn en laat dan de rennertimer aflopen. */
function toNaming(room: Room, a: { teamId: string }): void {
  room.playerAct(a.teamId, { type: 'ready' });
  for (let i = 0; i < 60 && room.state.phase === 'sponsors'; i++) vi.advanceTimersByTime(1_000);
  expect(room.state.phase).toBe('recruit');
  vi.advanceTimersByTime(TIMING.recruitMs + 1);
  expect(room.state.phase).toBe('naming');
}

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
    expect(room.state.phase).toBe('sponsors');
    expect(room.phaseEndsAt).toBeGreaterThan(Date.now());
  });

  it('gives the shop steps a generous timer each: sponsors first, then riders', () => {
    expect(TIMING.sponsorsMs).toBeGreaterThanOrEqual(60_000);
    expect(TIMING.recruitMs).toBeGreaterThanOrEqual(120_000);
  });

  it('moves on when the sponsor and recruit timers run out, even if the human never acts', () => {
    const { room, a } = startedRoom();
    room.president(a.teamId, 'briefDone');
    vi.advanceTimersByTime(TIMING.sponsorsMs + 1);
    expect(room.state.phase).toBe('recruit');
    expect(room.phaseEndsAt).toBeGreaterThan(Date.now());
    vi.advanceTimersByTime(TIMING.recruitMs + 1);
    expect(room.state.phase).toBe('naming');
  });

  it('moves on to the riders as soon as every team has its sponsors ready', () => {
    const { room, a } = startedRoom();
    room.president(a.teamId, 'briefDone');
    vi.advanceTimersByTime(30_000); // the bot has signed and is ready
    expect(room.state.phase).toBe('sponsors');
    room.playerAct(a.teamId, { type: 'ready' });
    expect(room.state.phase).toBe('recruit');
  });

  it('lets bots shop sponsors first, then riders', () => {
    const { room, a } = startedRoom();
    room.president(a.teamId, 'briefDone');
    vi.advanceTimersByTime(30_000);
    const bot = room.state.teams.find((t) => t.isBot)!;
    expect(room.state.phase).toBe('sponsors');
    expect(bot.slots.sponsor.length).toBe(2);
    expect(bot.riderIds.length).toBe(0);
    room.playerAct(a.teamId, { type: 'ready' });
    vi.advanceTimersByTime(30_000);
    expect(room.state.teams.find((t) => t.isBot)!.riderIds.length).toBeGreaterThan(0);
  });

  it('waits in naming for the human, but moves on after the naming timer', () => {
    const { room, a } = startedRoom();
    room.president(a.teamId, 'briefDone');
    toNaming(room, a);
    expect(room.phaseEndsAt).toBeGreaterThan(Date.now());
    vi.advanceTimersByTime(TIMING.namingMs - 5_000);
    expect(room.state.phase).toBe('naming');
    vi.advanceTimersByTime(6_000);
    expect(room.state.phase).toBe('draft');
  });

  it('runs on from naming to the race by itself once the human is ready', () => {
    const { room, a } = startedRoom();
    room.president(a.teamId, 'briefDone');
    toNaming(room, a);
    room.playerAct(a.teamId, { type: 'ready' });
    // draft -> team -> race, each ending on its own timer
    for (let i = 0; i < 40 && room.state.phase !== 'race'; i++) vi.advanceTimersByTime(30_000);
    expect(room.state.phase).toBe('race');
  });
});

describe('automatic pilot', () => {
  function raceRoom() {
    const room = createRoom('http://x');
    const ws = sock();
    const a = room.join(ws, 'Anna');
    const bws = sock();
    const b = room.join(bws, 'Ben');
    room.president(a.teamId, 'start');
    room.president(a.teamId, 'briefDone');
    return { room, a, b, ws, bws };
  }

  it('puts a disconnected team on autopilot after the grace period and plays for it', () => {
    const { room, a, b, bws } = raceRoom();
    room.detach(bws);
    vi.advanceTimersByTime(TIMING.awayGraceMs - 1_000);
    expect(room.autopilot.has(b.teamId)).toBe(false);
    vi.advanceTimersByTime(2_000);
    expect(room.autopilot.has(b.teamId)).toBe(true);
    expect(room.autopilot.has(a.teamId)).toBe(false);

    // Anna ready up in naming: Ben must not hold the game up.
    toNaming(room, a);
    room.playerAct(a.teamId, { type: 'ready' });
    vi.advanceTimersByTime(10_000);
    expect(room.state.phase).toBe('draft');
    const benRiders = room.state.riders.filter((r) => r.teamId === b.teamId);
    expect(benRiders.length).toBe(3);
  });

  it('keeps an away player in the lobby without autopilot', () => {
    const room = createRoom('http://x');
    const ws = sock();
    const a = room.join(ws, 'Anna');
    room.detach(ws);
    vi.advanceTimersByTime(TIMING.awayGraceMs + 1_000);
    expect(room.autopilot.has(a.teamId)).toBe(false);
  });

  it('hands control back when the player returns with their token', () => {
    const { room, b, bws } = raceRoom();
    room.detach(bws);
    vi.advanceTimersByTime(TIMING.awayGraceMs + 1_000);
    expect(room.autopilot.has(b.teamId)).toBe(true);
    const back = sock();
    room.join(back, 'Ben', b.token);
    expect(room.autopilot.has(b.teamId)).toBe(false);
    const msg = back.last;
    if (msg?.t !== 'player:state') throw new Error('expected player:state');
    expect(msg.autopilot[b.teamId]).toBeUndefined();
  });

  it('a bot stops acting for a team the moment its player takes over', () => {
    const { room, b, bws } = raceRoom();
    room.detach(bws);
    vi.advanceTimersByTime(TIMING.awayGraceMs + 1_000);
    room.takeover(b.teamId);
    expect(room.autopilot.has(b.teamId)).toBe(false);
    const before = room.state.teams.find((t) => t.id === b.teamId)!.riderIds.length;
    vi.advanceTimersByTime(20_000); // pending bot steps fire and see they are no longer in charge
    expect(room.state.teams.find((t) => t.id === b.teamId)!.riderIds.length).toBe(before);
  });

  it('hands the presidency to a connected player when the president goes away mid-briefing', () => {
    const room = createRoom('http://x');
    const ws = sock();
    const a = room.join(ws, 'Anna');
    const b = room.join(sock(), 'Ben');
    room.president(a.teamId, 'start');
    expect(room.state.phase).toBe('briefing');
    room.detach(ws);
    expect(() => room.president(b.teamId, 'briefDone')).toThrow('Alleen de president');
    vi.advanceTimersByTime(TIMING.awayGraceMs + 1_000);
    expect(room.presidentTeamId).toBe(b.teamId);
    room.president(b.teamId, 'briefDone');
    expect(room.state.phase).toBe('sponsors');
  });

  it('flags a team that does nothing for two phase timers, but not one that acts', () => {
    const room = createRoom('http://x');
    const a = room.join(sock(), 'Anna');
    const b = room.join(sock(), 'Ben');
    room.president(a.teamId, 'start');
    room.president(a.teamId, 'briefDone');
    // Sponsor timer: Anna signs one, Ben does nothing at all.
    const shop = room.state.recruit!.shops[a.teamId];
    room.playerAct(a.teamId, { type: 'recruit', itemId: shop.find((x) => x.kind === 'contract')!.id });
    vi.advanceTimersByTime(TIMING.sponsorsMs + 1);
    expect(room.state.phase).toBe('recruit');
    expect(room.autopilot.has(b.teamId)).toBe(false); // one miss is not enough
    // Recruit timer: Anna picks a rider, nobody acts for Ben again -> second miss.
    room.playerAct(a.teamId, { type: 'recruit', itemId: room.state.recruit!.shops[a.teamId].find((x) => x.kind === 'rider')!.id });
    vi.advanceTimersByTime(TIMING.recruitMs + 1);
    expect(room.autopilot.has(b.teamId)).toBe(true);
    expect(room.autopilot.has(a.teamId)).toBe(false);
  });

  it('any action from the player clears autopilot, even while connected', () => {
    const room = createRoom('http://x');
    const a = room.join(sock(), 'Anna');
    const b = room.join(sock(), 'Ben');
    room.president(a.teamId, 'start');
    room.president(a.teamId, 'briefDone');
    vi.advanceTimersByTime(SHOP_MS);
    vi.advanceTimersByTime(TIMING.namingMs + 1);
    expect(room.autopilot.has(b.teamId)).toBe(true);
    room.playerAct(b.teamId, { type: 'unready' });
    expect(room.autopilot.has(b.teamId)).toBe(false);
  });
});

describe('persistence', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'peloton-rooms-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('does not write anything until persistence is enabled', () => {
    const room = createRoom('http://x');
    room.join(sock(), 'Anna');
    vi.advanceTimersByTime(2_000);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('saves a room after changes and restores it with the same state and tokens', () => {
    enablePersistence(dir);
    const room = createRoom('http://x');
    const a = room.join(sock(), 'Anna');
    room.president(a.teamId, 'addBot');
    room.president(a.teamId, 'start');
    room.president(a.teamId, 'briefDone');
    vi.advanceTimersByTime(1_000);
    expect(existsSync(join(dir, `${room.code}.json`))).toBe(true);
    const before = JSON.parse(JSON.stringify(room.state));
    const code = room.code;

    // "Restart": forget everything in memory and load from disk.
    resetRooms();
    expect(getRoom(code)).toBeUndefined();
    expect(enablePersistence(dir)).toBe(1);
    const again = getRoom(code)!;
    expect(again.state.phase).toBe('sponsors');
    expect(again.state.teams.map((t) => t.name)).toEqual(before.teams.map((t: { name: string }) => t.name));
    expect(again.presidentTeamId).toBe(a.teamId);

    // The phone reconnects with the old token and gets the same seat.
    const phone = sock();
    expect(again.join(phone, 'Anna', a.token).teamId).toBe(a.teamId);
    expect(phone.last?.t).toBe('player:state');
  });

  it('re-arms the phase timer with the remaining time and stays quiet', () => {
    enablePersistence(dir);
    const room = createRoom('http://x');
    const a = room.join(sock(), 'Anna');
    room.president(a.teamId, 'addBot');
    room.president(a.teamId, 'start');
    room.president(a.teamId, 'briefDone');
    vi.advanceTimersByTime(40_000);
    flushRooms();
    const code = room.code;
    const endsAt = room.phaseEndsAt!;

    resetRooms();
    enablePersistence(dir);
    const again = getRoom(code)!;
    expect(again.feed).toEqual([]); // no commentary replayed on restore
    expect(again.phaseEndsAt).toBeLessThanOrEqual(endsAt + 1_000);
    expect(again.state.phase).toBe('sponsors');
    vi.advanceTimersByTime(TIMING.sponsorsMs - 40_000 + 1_000);
    expect(again.state.phase).not.toBe('sponsors');
  });

  it('puts a restored team on autopilot if its phone never reconnects', () => {
    enablePersistence(dir);
    const room = createRoom('http://x');
    const a = room.join(sock(), 'Anna');
    room.president(a.teamId, 'addBot');
    room.president(a.teamId, 'start');
    room.president(a.teamId, 'briefDone');
    flushRooms();
    const code = room.code;
    resetRooms();
    enablePersistence(dir);
    const again = getRoom(code)!;
    expect(again.autopilot.has(a.teamId)).toBe(false);
    vi.advanceTimersByTime(TIMING.awayGraceMs + 1_000);
    expect(again.autopilot.has(a.teamId)).toBe(true);
  });

  it('skips corrupt and stale files and removes files of swept rooms', () => {
    enablePersistence(dir);
    const room = createRoom('http://x');
    room.join(sock(), 'Anna');
    flushRooms();
    const code = room.code;
    writeFileSync(join(dir, 'KAPOT.json'), '{ not json');
    writeFileSync(join(dir, 'OUD.json'), JSON.stringify({ v: 1, code: 'OUDD', lastActive: 0 }));
    utimesSync(join(dir, 'OUD.json'), new Date(0), new Date(0));

    resetRooms();
    expect(enablePersistence(dir)).toBe(1); // only the valid, recent room
    expect(existsSync(join(dir, 'OUD.json'))).toBe(false); // stale file cleaned up
    expect(getRoom(code)).toBeInstanceOf(Room);

    getRoom(code)!.lastActive = Date.now() - 10_000;
    sweepRooms(1_000);
    expect(getRoom(code)).toBeUndefined();
    expect(existsSync(join(dir, `${code}.json`))).toBe(false);
  });
});
