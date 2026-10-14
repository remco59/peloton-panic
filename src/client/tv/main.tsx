import '@fontsource/press-start-2p';
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import '../common/theme.css';
import './tv.css';
import { CONTRACTS, EVENTS, QUIRKS, RIDER_TYPES, TEAM_COLORS, COMMENTATORS } from '../../shared/content';
import type { CommentatorId } from '../../shared/content';
import type { FeedBatch, RoomInfo, ServerMsg } from '../../shared/protocol';
import type { PublicState, Rider } from '../../shared/types';
import { openSocket } from '../common/ws';
import type { Socket } from '../common/ws';
import { Broadcaster } from './broadcast';
import type { Caption } from './broadcast';
import { Avatar } from './avatars';
import { TrackRenderer, terrainColor, H, W } from './render';

type Snapshot = { state: PublicState; feed: FeedBatch[] } & RoomInfo;

const ROOM_KEY = 'pp-tv-room';

function useNow(ms = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function teamHex(s: PublicState, teamId: string) {
  const t = s.teams.find((x) => x.id === teamId);
  return TEAM_COLORS[(t?.color ?? 0) % TEAM_COLORS.length];
}

// ---- Root ---------------------------------------------------------------------

function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [caption, setCaption] = useState<Caption | null>(null);
  const [audioOn, setAudioOn] = useState(false);
  const offset = useRef(0);
  const sock = useRef<Socket | null>(null);
  const lastFeed = useRef<number | null>(null);
  const broadcaster = useMemo(
    () =>
      new Broadcaster(
        (c) => setCaption(c),
        () => setAudioOn(true),
      ),
    [],
  );

  useEffect(() => {
    const origin = location.origin;
    const s = openSocket({
      onStatus: setOnline,
      onOpen() {
        // ?room=CODE attaches an extra TV screen to an existing room (handy for demos and tests).
        const code = new URLSearchParams(location.search).get('room') || sessionStorage.getItem(ROOM_KEY);
        if (code) s.send({ t: 'tv:resume', code, origin });
        else s.send({ t: 'tv:create', origin });
      },
      onMessage(msg: ServerMsg) {
        if (msg.t === 'tv:state') {
          sessionStorage.setItem(ROOM_KEY, msg.code);
          offset.current = msg.serverNow - Date.now();
          setError(null);
          setSnap(msg);
          const maxId = msg.feed.reduce((m, b) => Math.max(m, b.id), 0);
          if (lastFeed.current === null) lastFeed.current = maxId; // skip history on first load
          for (const batch of msg.feed) {
            if (batch.id > lastFeed.current) {
              lastFeed.current = batch.id;
              broadcaster.enqueue(batch.lines);
            }
          }
          if (msg.state.phase === 'lobby') broadcaster.clear();
        } else if (msg.t === 'error') {
          if (msg.fatal) {
            sessionStorage.removeItem(ROOM_KEY);
            lastFeed.current = null;
            s.send({ t: 'tv:create', origin });
          } else setError(msg.message);
        }
      },
    });
    sock.current = s;
    const onKey = () => void broadcaster.unlock();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onKey);
    return () => {
      s.close();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onKey);
    };
  }, [broadcaster]);

  if (!snap) {
    return (
      <div class="boot pixel">
        <div>PELOTON PANIC</div>
        <div class="dim">{online ? 'Opening a room...' : 'Connecting...'}</div>
      </div>
    );
  }

  const { state } = snap;
  const clock = () => Date.now() + offset.current;

  return (
    <div class="tv">
      <Header snap={snap} clock={clock} online={online} />
      <div class="main">
        <Stage state={state} />
        <aside class="side">
          <EventCard state={state} />
          <Standings snap={snap} />
        </aside>
      </div>
      <Minimap state={state} />
      <Booth caption={caption} audioOn={audioOn} onEnable={() => void broadcaster.unlock()} />
      {state.phase === 'lobby' && <Lobby snap={snap} />}
      {state.phase === 'finished' && <Finished snap={snap} />}
      {error && <div class="toast pixel">{error}</div>}
    </div>
  );
}

// ---- Pieces -------------------------------------------------------------------

function Header({ snap, clock, online }: { snap: Snapshot; clock: () => number; online: boolean }) {
  useNow(250);
  const { state } = snap;
  const left = snap.phaseEndsAt ? Math.max(0, Math.ceil((snap.phaseEndsAt - clock()) / 1000)) : null;
  const label: Record<string, string> = {
    lobby: 'Lobby',
    play: 'Choose your effort',
    resolve: 'The race unfolds',
    trade: 'Talk and trade',
    finished: 'Finish',
  };
  return (
    <header class="head">
      <div class="logo pixel">PELOTON PANIC</div>
      <div class="phase pixel">
        {state.phase === 'lobby' ? 'STAGE 1' : `STAGE 1 · ROUND ${state.round}`}
        <span class="sep">/</span>
        {label[state.phase]}
      </div>
      <div class="timer pixel">
        {left !== null && state.phase !== 'resolve' ? `${left}s` : ''}
        {!online && <span class="bad"> OFFLINE</span>}
      </div>
    </header>
  );
}

function Stage({ state }: { state: PublicState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const r = useRef<TrackRenderer | null>(null);
  useEffect(() => {
    r.current = new TrackRenderer(ref.current!);
    return () => r.current?.destroy();
  }, []);
  useEffect(() => {
    if (state.terrain.length > 0 || state.phase === 'lobby') r.current?.setState(demo(state));
  }, [state]);
  return (
    <div class="stage frame">
      <canvas ref={ref} width={W} height={H} />
    </div>
  );
}

/** In the lobby there is no track yet; draw a flat preview so the screen is alive. */
function demo(state: PublicState): PublicState {
  if (state.terrain.length > 0) return state;
  return { ...state, terrain: Array.from({ length: 32 }, () => 'flat' as const), trackLength: 32 };
}

function EventCard({ state }: { state: PublicState }) {
  if (!state.event || state.phase === 'lobby' || state.phase === 'finished') return <div class="event frame" />;
  const def = EVENTS[state.event.id];
  const rider = state.event.targetRiderId ? state.riders.find((r) => r.id === state.event!.targetRiderId) : null;
  const team = state.event.targetTeamId ? state.teams.find((t) => t.id === state.event!.targetTeamId) : null;
  return (
    <div class={`event frame ${def.silly ? 'silly' : ''}`}>
      <div class="tag pixel">{def.silly ? 'BREAKING NEWS' : 'CONDITIONS'}</div>
      <div class="title pixel">{def.title}</div>
      <p>{def.blurb}</p>
      {rider && <p class="target">Target: {rider.name}</p>}
      {team && <p class="target">Target: {team.name}'s team</p>}
    </div>
  );
}

function ridersOf(state: PublicState, teamId: string): Rider[] {
  return state.riders.filter((r) => r.teamId === teamId);
}

function Standings({ snap }: { snap: Snapshot }) {
  const { state } = snap;
  const rows = state.teams
    .map((t) => ({ t, best: Math.max(...ridersOf(state, t.id).map((r) => r.pos)) }))
    .sort((a, b) => b.best - a.best);
  return (
    <div class="standings frame">
      <div class="tag pixel">STANDINGS</div>
      {rows.map(({ t, best }, i) => {
        const col = TEAM_COLORS[t.color % TEAM_COLORS.length];
        const waiting =
          state.phase === 'play' ? (t.locked ? 'LOCKED' : 'THINKING') : state.phase === 'trade' ? (t.ready ? 'READY' : 'TALKING') : '';
        return (
          <div class="row" key={t.id}>
            <span class="rank pixel">{i + 1}</span>
            <span class="chip" style={{ background: col.hex }} />
            <div class="who">
              <div class="name">
                {t.name}
                {t.isBot && <span class="bot"> bot</span>}
                {!snap.connected[t.id] && <span class="bad"> away</span>}
              </div>
              <div class="riders">
                {ridersOf(state, t.id).map((r) => (
                  <span key={r.id} title={QUIRKS[r.quirk].label}>
                    {r.name.split(' ')[0]} <i>{Math.floor(r.pos)}</i>
                  </span>
                ))}
              </div>
            </div>
            <span class={`state pixel ${waiting === 'LOCKED' || waiting === 'READY' ? 'ok' : ''}`}>{waiting}</span>
            <span class="best pixel">{state.phase === 'lobby' ? '' : Math.floor(best)}</span>
          </div>
        );
      })}
    </div>
  );
}

function Minimap({ state }: { state: PublicState }) {
  const n = state.trackLength;
  return (
    <svg class="minimap frame" viewBox={`0 0 ${n} 6`} preserveAspectRatio="none">
      {state.terrain.map((t, i) => (
        <rect key={i} x={i} y="3" width="1.02" height="3" fill={terrainColor(t)} />
      ))}
      {state.riders.map((r) => (
        <rect
          key={r.id}
          x={Math.min(n - 0.4, r.pos) - 0.2}
          y="0.4"
          width="0.5"
          height="2.4"
          fill={teamHex(state, r.teamId).hex}
          stroke="#000"
          stroke-width="0.08"
        />
      ))}
    </svg>
  );
}

function Booth({ caption, audioOn, onEnable }: { caption: Caption | null; audioOn: boolean; onEnable: () => void }) {
  const who: CommentatorId[] = ['johan', 'marieke'];
  return (
    <footer class="booth frame">
      {who.map((id) => {
        const speaking = caption?.speaker === id;
        return (
          <div class={`mic ${speaking ? 'on' : ''}`} key={id}>
            <Avatar who={id} speaking={speaking && audioOn} />
            <div class="meta">
              <div class="nm pixel">{COMMENTATORS[id].name}</div>
              <div class="role">{COMMENTATORS[id].role}</div>
            </div>
          </div>
        );
      })}
      <div class="bubble">
        {caption ? (
          <>
            <b>{COMMENTATORS[caption.speaker].name}:</b> {caption.text}
          </>
        ) : (
          <span class="dim">The commentators sip their coffee.</span>
        )}
      </div>
      {!audioOn && (
        <button class="sound pixel" onClick={onEnable}>
          ENABLE SOUND
        </button>
      )}
    </footer>
  );
}

function Lobby({ snap }: { snap: Snapshot }) {
  const { state } = snap;
  const [qr, setQr] = useState('');
  useEffect(() => {
    QRCode.toString(snap.joinUrl, { type: 'svg', margin: 1, color: { dark: '#0f1224', light: '#ffffff' } }).then(setQr);
  }, [snap.joinUrl]);
  const president = state.teams.find((t) => t.id === snap.presidentTeamId);
  return (
    <div class="overlay">
      <div class="lobby frame">
        <div class="left">
          <div class="pixel kicker">JOIN ON YOUR PHONE</div>
          <div class="code pixel">{snap.code}</div>
          <div class="qr" dangerouslySetInnerHTML={{ __html: qr }} />
          <div class="url">{snap.joinUrl.replace(/^https?:\/\//, '')}</div>
        </div>
        <div class="right">
          <div class="pixel kicker">THE PELOTON ({state.teams.length}/6)</div>
          <div class="teams">
            {state.teams.length === 0 && <p class="dim">Waiting for the first rider to roll up...</p>}
            {state.teams.map((t) => {
              const col = TEAM_COLORS[t.color % TEAM_COLORS.length];
              return (
                <div class="team" key={t.id} style={{ borderColor: col.hex }}>
                  <div class="tn">
                    <span class="chip" style={{ background: col.hex }} /> {t.name}
                    {t.id === snap.presidentTeamId && <span class="crown pixel"> PRESIDENT</span>}
                    {t.isBot && <span class="bot"> bot</span>}
                  </div>
                  <div class="rs">
                    {ridersOf(state, t.id).map((r) => (
                      <span key={r.id}>
                        {r.name} <i>{RIDER_TYPES[r.type].label}</i>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <p class="hint">
            {state.teams.length < 2
              ? 'You need at least 2 teams. The president can add bots from their phone.'
              : president
                ? `${president.name} is the president: press Start Race on your phone when everyone is in.`
                : 'Waiting for the president.'}
          </p>
        </div>
      </div>
    </div>
  );
}

function Finished({ snap }: { snap: Snapshot }) {
  const { state } = snap;
  const res = state.results!;
  const ordered = [...res.teams].sort((a, b) => b.total - a.total);
  const rankOf = new Map(res.ranking.map((r) => [r.riderId, r.rank]));
  return (
    <div class="overlay">
      <div class="finish frame">
        <div class="pixel kicker">STAGE 1 RESULT</div>
        <div class="podium">
          {ordered.map((t, i) => {
            const team = state.teams.find((x) => x.id === t.teamId)!;
            const col = TEAM_COLORS[team.color % TEAM_COLORS.length];
            return (
              <div class={`pod p${i}`} key={t.teamId} style={{ borderColor: col.hex }}>
                <div class="pixel pos">{i + 1}</div>
                <div class="pn">
                  <span class="chip" style={{ background: col.hex }} /> {team.name}
                </div>
                <div class="pts pixel">{t.total} pts</div>
                <div class="rs">
                  {ridersOf(state, team.id).map((r) => (
                    <span key={r.id}>
                      #{rankOf.get(r.id)} {r.name}
                    </span>
                  ))}
                </div>
                <div class={`contract ${t.contractMet ? 'met' : 'miss'}`}>
                  {CONTRACTS[t.contract].label}: {t.contractMet ? '+5' : 'missed'}
                </div>
              </div>
            );
          })}
        </div>
        <div class="awards">
          {res.awards.map((a) => {
            const team = state.teams.find((x) => x.id === a.teamId)!;
            return (
              <div class="award" key={a.title}>
                <div class="pixel at">{a.title.toUpperCase()}</div>
                <div>
                  <span class="chip" style={{ background: TEAM_COLORS[team.color % TEAM_COLORS.length].hex }} />{' '}
                  {team.name}
                </div>
                <div class="dim">{a.blurb}</div>
              </div>
            );
          })}
        </div>
        <p class="hint">The president can start a rematch from their phone.</p>
      </div>
    </div>
  );
}

render(<App />, document.getElementById('app')!);
