// Speelt een heel seizoen tegen de draaiende dev-server: één simulatiespeler (de "speler"),
// drie bots, en maakt met headless Chrome screenshots van de tv en een telefoon.
//
//   npm run dev          (terminal 1)
//   npm run screenshots  (terminal 2)  ->  docs/screenshots/*.png

import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import WebSocket from 'ws';
import { CARD_DEFS } from '../src/shared/content';
import type { ClientMsg, ServerMsg } from '../src/shared/protocol';
import type { Effort, PlayerView, PublicState } from '../src/shared/types';

const BASE = process.env.PP_URL ?? 'http://localhost:3000';
const WS = BASE.replace(/^http/, 'ws') + '/ws';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = join(process.cwd(), 'docs', 'screenshots');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function capture(name: string, url: string, w: number, h: number, scale: number, waitMs: number): Promise<void> {
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
        `--timeout=${waitMs}`,
        `--screenshot=${join(OUT, name + '.png')}`,
        url,
      ],
      { timeout: 60000 },
      (err) => {
        console.log(err ? `MISLUKT ${name}: ${err.message}` : `opgeslagen ${name}`);
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
      } else if (m.t === 'error') console.log('serverfout:', m.message);
    });
    return new Promise((r) => this.ws.once('open', () => r()));
  }
  send(m: ClientMsg) {
    this.ws.send(JSON.stringify(m));
  }
  act(action: Extract<ClientMsg, { t: 'act' }>['action']) {
    this.send({ t: 'act', action });
  }
}

async function until(fn: () => boolean, ms = 60000, label = 'voorwaarde') {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error(`time-out: ${label}`);
    await sleep(100);
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const tv = new Client();
  await tv.open();
  tv.send({ t: 'tv:create', origin: BASE });
  await until(() => !!tv.code, 10000, 'kamercode');
  const code = tv.code;
  console.log('kamer', code);

  const me = new Client();
  await me.open();
  me.send({ t: 'player:join', code, name: 'Remco' });
  await until(() => !!me.token, 10000, 'meedoen');
  me.send({ t: 'president', what: 'tutorialOn' });
  for (let i = 0; i < 3; i++) {
    me.send({ t: 'president', what: 'addBot' });
    await sleep(150);
  }
  await until(() => (tv.state?.teams.length ?? 0) === 4, 10000, '4 teams');

  const tvUrl = `${BASE}/?room=${code}`;
  const phoneUrl = (extra = '') =>
    `${BASE}/device.html?src=${encodeURIComponent(`/play?room=${code}&token=${me.token}&name=Remco${extra}`)}`;
  const shotTv = (name: string, wait = 5000) => capture(name, tvUrl, 1920, 1080, 1, wait);
  const shotPhone = (name: string, extra = '', h = 900) => capture(name, phoneUrl(extra), 540, h, 2, 3500);

  // 1. Lobby
  await Promise.all([shotTv('tv-1-lobby'), shotPhone('phone-1-lobby')]);

  // De simulatiespeler doet alles zelf, behalve op de momenten waarop we een screenshot nemen.
  const done = new Set<string>();
  const once = (key: string, fn: () => void) => {
    if (done.has(key)) return false;
    done.add(key);
    fn();
    return true;
  };
  let hold = false;
  let seasonDone = false;

  const driveTeam = () => {
    const s = me.state!;
    const mine = s.teams.find((t) => t.id === me.teamId)!;
    const riders = s.riders.filter((r) => r.teamId === me.teamId);
    const hand = me.me!.hand;
    for (const c of hand) {
      const d = CARD_DEFS[c.def];
      if (d.kind === 'training') {
        const r = [...riders].sort((a, b) => a.trained - b.trained || a.fatigue - b.fatigue)[0];
        if ((d.fatigue ?? 0) < 0 && r.fatigue < 2) continue;
        if ((d.fatigue ?? 0) >= 0 && r.trained >= 2) continue;
        me.act({ type: 'train', cardId: c.id, riderId: r.id });
        return true;
      }
      if (d.kind !== 'sabotage') {
        const slot = mine.slots[d.kind as 'sponsor' | 'staff' | 'material' | 'car'];
        const limit = d.kind === 'car' ? 1 : 2;
        if (slot.length < limit) {
          me.act({ type: 'install', cardId: c.id });
          return true;
        }
      }
    }
    if (mine.coins >= 2 && !done.has(`buy-${s.stage}`)) {
      done.add(`buy-${s.stage}`);
      me.act({ type: 'buy', source: { kind: 'deck' } });
      return true;
    }
    return false;
  };

  const lock = (c: Client) => {
    const s = c.state!;
    const riders = s.riders.filter((r) => r.teamId === c.teamId);
    const efforts: Record<string, Effort> = {};
    for (const r of riders) {
      const toGo = s.trackLength - r.pos;
      efforts[r.id] = r.energy <= 2 ? 'rustig' : toGo <= 6 ? 'alles' : Math.random() < 0.3 ? 'alles' : 'normaal';
      // Een knecht in de buurt van de kopman helpt af en toe.
      const kop = s.riders.find((x) => x.id === c.me!.kopmanId);
      if (kop && r.id !== kop.id && Math.abs(r.pos - kop.pos) <= 3 && Math.random() < 0.5) efforts[r.id] = 'helpen';
    }
    c.act({ type: 'effort', efforts });
  };

  me.onState = (c) => {
    const s = c.state!;
    if (hold || !c.me) return;
    if (s.phase === 'briefing') {
      // De uitleg vooraf: eerst een pagina in het midden en de laatste, dan door naar de draft.
      once('brief', () => {
        hold = true;
        void (async () => {
          for (let i = 0; i < 2; i++) {
            c.send({ t: 'president', what: 'briefNext' });
            await sleep(300);
          }
          await Promise.all([shotTv('tv-1b-uitleg', 3500), shotPhone('phone-1b-uitleg')]);
          hold = false;
          c.send({ t: 'president', what: 'briefDone' });
        })();
      });
      return;
    }
    if (s.phase === 'recruit' && c.me.pickPending) {
      // Kies de eerste betaalbare renner, en neem bij de eerste keuze een screenshot.
      const coins = s.teams.find((t) => t.id === c.teamId)!.coins;
      const index = Math.max(0, s.recruit!.market.findIndex((m) => m.price <= coins && m.price > 0));
      if (!done.has('shot-recruit')) {
        done.add('shot-recruit');
        hold = true;
        void Promise.all([shotTv('tv-1c-rekruteren'), shotPhone('phone-1c-rekruteren')]).then(() => {
          hold = false;
          c.act({ type: 'recruit', index });
        });
        return;
      }
      once(`recruit-${s.recruit!.idx}`, () => c.act({ type: 'recruit', index }));
      return;
    }
    if (s.phase === 'naming') {
      once('naming', () => {
        c.act({ type: 'nameRiders', names: ['Remco Rouleur', 'Pieter Peddel', 'Wout van Weg'] });
        c.act({ type: 'ready' });
      });
      return;
    }
    if (s.phase === 'draft' && c.me.pickPending) {
      if (s.stage === 1 && !done.has('shot-draft')) {
        done.add('shot-draft');
        hold = true;
        void Promise.all([shotTv('tv-2-draft'), shotPhone('phone-2-draft')]).then(() => {
          hold = false;
          c.act({ type: 'draftPick', source: { kind: 'market', index: 0 } });
        });
        return;
      }
      once(`pick-${s.stage}-${s.draft!.idx}`, () => {
        // Kies een sponsor, staflid of wagen als dat er ligt, anders de eerste kaart.
        const pref = s.market.findIndex((d) => ['sponsor', 'staff', 'car'].includes(CARD_DEFS[d].kind));
        c.act({ type: 'draftPick', source: { kind: 'market', index: pref >= 0 ? pref : 0 } });
      });
    }
    if (s.phase === 'team') {
      if (s.stage === 1 && !done.has('shot-team')) {
        done.add('shot-team');
        hold = true;
        setTimeout(async () => {
          while (driveTeam()) await sleep(350);
          await sleep(500);
          await Promise.all([
            shotTv('tv-3-team'),
            shotPhone('phone-3-kaarten', '&tab=kaarten', 1100),
            shotPhone('phone-3b-plan', '&tab=plan', 1100),
            shotPhone('phone-4-team', '&tab=team', 1400),
          ]);
          hold = false;
          c.act({ type: 'ready' });
        }, 1500);
        return;
      }
      const t = s.teams.find((x) => x.id === c.teamId)!;
      if (!t.ready && !driveTeam()) c.act({ type: 'ready' });
    }
    if (s.phase === 'race' && !s.teams.find((t) => t.id === c.teamId)!.locked) {
      if (s.stage === 1 && s.round === 2 && !done.has('shot-race')) {
        done.add('shot-race');
        hold = true;
        void Promise.all([shotTv('tv-4-race', 4000), shotPhone('phone-5-race', '', 1100)]).then(() => {
          hold = false;
          lock(c);
        });
        return;
      }
      once(`race-${s.stage}-${s.round}`, () => lock(c));
    }
    if (s.phase === 'resolve' && s.stage === 1 && s.round === 3) {
      once('shot-resolve', () => void shotTv('tv-5-resolve', 3200));
    }
    if (s.phase === 'results') {
      once(`res-${s.stage}`, () => {
        void (async () => {
          if (s.stage === 1) await Promise.all([shotTv('tv-6-results'), shotPhone('phone-6-results')]);
          c.send({ t: 'president', what: 'nextStage' });
        })();
      });
    }
    if (s.phase === 'finished') seasonDone = true;
  };

  me.send({ t: 'president', what: 'start' });
  await until(() => seasonDone, 20 * 60 * 1000, 'einde seizoen');
  await sleep(1500);
  await Promise.all([shotTv('tv-7-finish'), shotPhone('phone-7-finish')]);
  console.log('klaar');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
