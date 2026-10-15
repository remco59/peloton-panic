import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { RuleError } from '../shared/engine';
import type { ClientMsg } from '../shared/protocol';
import { createRoom, enablePersistence, flushRooms, getRoom, send, sweepRooms } from './rooms';
import type { Room } from './rooms';
import { isSpeaker, speak, ttsAvailable } from './tts';

const PORT = Number(process.env.PORT ?? 3000);
const PROD = process.env.NODE_ENV === 'production';
const ROOT = process.cwd();

function lanAddress(): string | null {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address))
        return a.address;
    }
  }
  return null;
}

/** The address phones should use to reach this server. */
function joinBase(origin: string): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  try {
    const u = new URL(origin);
    if (['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname)) {
      const lan = lanAddress();
      if (lan) u.hostname = lan;
    }
    return u.origin;
  } catch {
    return `http://${lanAddress() ?? 'localhost'}:${PORT}`;
  }
}

const app = express();
const server = createServer(app);

app.get('/api/tts', async (req, res) => {
  const v = String(req.query.v ?? '');
  const t = String(req.query.t ?? '');
  if (!isSpeaker(v) || !t) return void res.status(400).end();
  try {
    const mp3 = await speak(v, t);
    res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400' }).send(mp3);
  } catch {
    res.status(503).end();
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, tts: ttsAvailable(), lan: lanAddress() });
});

// Phones use a clean URL.
app.get('/play', (req, _res, next) => {
  req.url = '/play.html' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
  next();
});

if (PROD) {
  app.use(express.static(join(ROOT, 'dist')));
} else {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({
    configFile: join(ROOT, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: { server } },
    appType: 'mpa',
  });
  app.use(vite.middlewares);
}

// ---- WebSocket ----------------------------------------------------------------

interface Conn {
  room?: Room;
  role?: 'tv' | 'player';
  teamId?: string;
}

// noServer: only claim upgrades for /ws, so Vite's own HMR socket (same port) is left alone.
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (req.url?.split('?')[0] === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  }
});

wss.on('connection', (ws: WebSocket) => {
  const conn: Conn = {};

  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    try {
      handle(ws, conn, msg);
    } catch (e) {
      if (e instanceof RuleError) send(ws, { t: 'error', message: e.message });
      else {
        console.error('[ws]', e);
        send(ws, { t: 'error', message: 'Something went wrong on the server' });
      }
    }
  });

  ws.on('close', () => conn.room?.detach(ws));
});

function handle(ws: WebSocket, conn: Conn, msg: ClientMsg): void {
  switch (msg.t) {
    case 'tv:create': {
      const room = createRoom(joinBase(msg.origin));
      conn.room = room;
      conn.role = 'tv';
      room.attachTv(ws);
      return;
    }
    case 'tv:resume': {
      const room = getRoom(msg.code);
      if (!room) return void send(ws, { t: 'error', message: 'That room has expired', fatal: true });
      room.joinBase = joinBase(msg.origin);
      conn.room = room;
      conn.role = 'tv';
      room.attachTv(ws);
      return;
    }
    case 'tv:control': {
      if (conn.role !== 'tv' || !conn.room) return;
      conn.room.tvControl(msg.what);
      return;
    }
    case 'tv:kick': {
      if (conn.role !== 'tv' || !conn.room) return;
      conn.room.kick(msg.teamId);
      return;
    }
    case 'player:join': {
      const room = getRoom(msg.code);
      if (!room) return void send(ws, { t: 'error', message: 'No room with that code', fatal: true });
      const { teamId, token } = room.join(ws, msg.name, msg.token);
      conn.room = room;
      conn.role = 'player';
      conn.teamId = teamId;
      send(ws, { t: 'joined', teamId, token, code: room.code });
      return;
    }
    case 'act': {
      if (conn.role !== 'player' || !conn.room || !conn.teamId || !conn.room.hasSeat(conn.teamId, ws)) return;
      conn.room.playerAct(conn.teamId, msg.action);
      return;
    }
    case 'takeover': {
      if (conn.role !== 'player' || !conn.room || !conn.teamId || !conn.room.hasSeat(conn.teamId, ws)) return;
      conn.room.takeover(conn.teamId);
      return;
    }
    case 'president': {
      if (conn.role !== 'player' || !conn.room || !conn.teamId || !conn.room.hasSeat(conn.teamId, ws)) return;
      conn.room.president(conn.teamId, msg.what);
      return;
    }
  }
}

setInterval(() => sweepRooms(), 10 * 60 * 1000).unref();

// Kamers overleven een herstart: ze staan als JSON in .cache/rooms (of ROOMS_DIR).
const restored = enablePersistence(process.env.ROOMS_DIR ?? join(ROOT, '.cache', 'rooms'));
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    flushRooms();
    process.exit(0);
  });
}

server.listen(PORT, '0.0.0.0', () => {
  const lan = lanAddress();
  console.log('\n  Peloton Panic is running');
  console.log(`  TV:      http://localhost:${PORT}/`);
  if (lan) console.log(`  Phones:  http://${lan}:${PORT}/play   (same Wi-Fi as this computer)`);
  if (restored > 0) console.log(`  Rooms:   ${restored} restored from the last run`);
  console.log(`  Voices:  ${ttsAvailable() ? 'edge-tts ready' : 'edge-tts missing, run: npm run setup:tts'}\n`);
});
