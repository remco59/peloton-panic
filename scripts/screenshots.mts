// Plays a real game against the running dev server with simulated phones, and uses
// headless Chrome's --screenshot to capture the TV and a phone at key moments.
//
//   npm run dev          (terminal 1)
//   npm run screenshots  (terminal 2)  ->  docs/screenshots/*.png

import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { ClientMsg, ServerMsg } from '../src/shared/protocol';
import type { PlayerView, PublicState } from '../src/shared/types';

const BASE = process.env.PP_URL ?? 'http://localhost:3000';
const WS = BASE.replace(/^http/, 'ws') + '/ws';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = join(process.cwd(), 'docs', 'screenshots');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function capture(name: string, url: string, w: number, h: number, scale: number, budgetMs: number): Promise<void> {
  return new Promise((resolve) => {
    execFile(
      CHROME,
      [
        '--headless=new',
        `--user-data-dir=/tmp/pp-shot-${name}-${Date.now()}`,
        '--no-first-run',
        '--hide-scrollbars',
        `--window-size=${w},${h}`,
        `--force-device-scale-factor=${scale}`,
        `--timeout=${budgetMs}`,
        `--screenshot=${join(OUT, name + '.png')}`,
        url,
      ],
      { timeout: 40000 },
      (err) => {
        console.log(err ? `FAILED ${name}: ${err.message}` : `saved ${name}`);
        resolve();
      },
    );
  });
}

class Client {
  ws!: WebSocket;
  state: PublicState | null = null;
  me: PlayerView | null = null;
  token = '';
  teamId = '';
  code = '';
  onState: (c: Client) => void = () => {};
  open(): Promise<void> {
    this.ws = new WebSocket(WS);
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as ServerMsg;
      if (m.t === 'tv:state' || m.t === 'player:state') {
        this.state = m.state;
        this.code = m.code;
        if (m.t === 'player:state') this.me = m.me;
        this.onState(this);
      } else if (m.t === 'joined') {
        this.token = m.token;
        this.teamId = m.teamId;
      } else if (m.t === 'error') console.log('server error:', m.message);
    });
    return new Promise((r) => this.ws.once('open', () => r()));
  }
  send(m: ClientMsg) {
    this.ws.send(JSON.stringify(m));
  }
}

async function until(fn: () => boolean, ms = 60000, label = 'condition') {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out: ${label}`);
    await sleep(100);
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const tv = new Client();
  await tv.open();
  tv.send({ t: 'tv:create', origin: BASE });
  await until(() => !!tv.code, 10000, 'room code');
  const code = tv.code;
  console.log('room', code);

  const names = ['Remco', 'Sanne', 'Daan', 'Fleur'];
  const players: Client[] = [];
  for (const n of names) {
    const p = new Client();
    await p.open();
    p.send({ t: 'player:join', code, name: n });
    await until(() => !!p.token, 10000, 'joined');
    players.push(p);
    await sleep(150);
  }
  players[0].send({ t: 'act', action: { type: 'nameRiders', names: ['Remco Rouleur', 'Pieter Peddel', 'Wout van Weg'] } });
  await sleep(300);

  const tvUrl = `${BASE}/?room=${code}`;
  const phoneUrl = (p: Client) =>
    `${BASE}/device.html?src=${encodeURIComponent(`/play?room=${code}&token=${p.token}&name=Remco`)}`;

  // 1. Lobby
  await Promise.all([
    capture('tv-1-lobby', tvUrl, 1920, 1080, 1, 6000),
    capture('phone-1-lobby', phoneUrl(players[0]), 540, 900, 2, 4000),
  ]);

  players[0].send({ t: 'president', what: 'start' });
  await until(() => tv.state?.phase === 'play', 10000, 'play phase');

  // 2. Play: nobody locks until the screenshots are done.
  await Promise.all([
    capture('tv-2-play', tvUrl, 1920, 1080, 1, 6000),
    capture('phone-2-play', phoneUrl(players[0]), 540, 900, 2, 4000),
  ]);

  const lockRandom = (p: Client) => {
    if (!p.me || !p.state || p.state.phase !== 'play') return;
    const team = p.state.teams.find((t) => t.id === p.teamId)!;
    if (team.locked) return;
    const hand = [...p.me.hand].filter((c) => c.kind !== 'tired').sort(() => Math.random() - 0.5);
    const plays: Record<string, string | null> = {};
    team.riderIds.forEach((id, i) => (plays[id] = hand[i] && Math.random() > 0.12 ? hand[i].id : null));
    p.send({ t: 'act', action: { type: 'play', plays } });
  };

  let phoneTradeShot = false;
  let tvTradeShot = false;
  let raceShot = false;
  let midShot = false;
  let released = false;

  for (const p of players) {
    p.onState = (c) => {
      const s = c.state!;
      if (s.phase === 'play' && released) setTimeout(() => lockRandom(c), 300 + Math.random() * 1200);
      if (s.phase === 'trade' && c.me) {
        const team = s.teams.find((t) => t.id === c.teamId)!;
        if (!team.ready) setTimeout(() => c.send({ t: 'act', action: { type: 'tradeReady' } }), 6000 + Math.random() * 3000);
      }
    };
  }

  tv.onState = (c) => {
    const s = c.state!;
    if (s.phase === 'resolve' && s.round === 2 && !raceShot) {
      raceShot = true;
      void capture('tv-3-race', tvUrl, 1920, 1080, 1, 2600);
      void capture('phone-3-resolve', phoneUrl(players[0]), 540, 900, 2, 3000);
    }
    if (s.phase === 'resolve' && s.round === 6 && !midShot) {
      midShot = true;
      void capture('tv-5-midrace', tvUrl, 1920, 1080, 1, 2800);
    }
    if (s.phase === 'trade' && s.round === 2 && !tvTradeShot) {
      tvTradeShot = true;
      // Sanne offers Remco a swap so the incoming-offer UI is on screen.
      const give = players[1].me?.hand.find((x) => x.kind === 'energy');
      const want = players[0].me?.hand.find((x) => x.kind === 'energy');
      if (give && want) {
        players[1].send({
          t: 'act',
          action: { type: 'offer', to: players[0].teamId, give: [give.id], want: [{ kind: 'energy', value: want.value }] },
        });
      }
      setTimeout(() => {
        if (!phoneTradeShot) {
          phoneTradeShot = true;
          void capture('phone-4-trade', phoneUrl(players[0]), 540, 1000, 2, 3000);
          void capture('tv-4-trade', tvUrl, 1920, 1080, 1, 4000);
        }
      }, 700);
    }
  };

  // Release the first round.
  released = true;
  players.forEach((p) => lockRandom(p));

  await until(() => tv.state?.phase === 'finished', 8 * 60 * 1000, 'finish');
  await sleep(1500);
  await Promise.all([
    capture('tv-6-finish', tvUrl, 1920, 1080, 1, 6000),
    capture('phone-5-finish', phoneUrl(players[0]), 540, 900, 2, 4000),
  ]);
  console.log('done');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
