import { render, type ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import '../common/theme.css';
import './tv.css';
import {
  BRIEFING,
  CARD_DEFS,
  COMMENTATORS,
  EVENTS,
  KIND_COLORS,
  KIND_LABELS,
  PREMIE_INFO,
  QUIRKS,
  WEATHER,
  RIDER_TYPES,
  STAT_LABELS,
  TEAM_COLORS,
} from '../../shared/content';
import type { CommentatorId } from '../../shared/content';
import { effectiveStats, perksOf, teamDefIds } from '../../shared/engine';
import { stageProfile } from '../../shared/profile';
import { standing, tiles } from '../../shared/standing';
import { tvHint } from '../../shared/tutorial';
import type { FeedBatch, RoomInfo, ServerMsg, TvControl } from '../../shared/protocol';
import type { PublicState, PublicTeam, Rider, Stat } from '../../shared/types';
import { PREMIE_POINTS, STAGES } from '../../shared/types';
import { sound } from '../common/sound';
import { useBump, useChanged, useFlip } from '../common/motion';
import { openSocket } from '../common/ws';
import type { Socket } from '../common/ws';
import { Broadcaster } from './broadcast';
import type { Caption } from './broadcast';
import { Avatar } from './avatars';
import { CardBack, PlayingCard } from '../common/card';
import {
  Battery,
  Coins,
  Crown,
  ElevationProfile,
  EVENT_ICON,
  HandFan,
  Medal,
  Podium,
  QuirkTag,
  RiderAvatar,
  StatIcon,
  StatRadar,
  TeamJersey,
  TeamStack,
  TypeBadge,
} from '../common/visuals';
import type { PodiumEntry } from '../common/visuals';
import { TrackRenderer, H, W } from './render';
import { Soundtrack } from './soundtrack';

type Snapshot = { state: PublicState; feed: FeedBatch[] } & RoomInfo;

const ROOM_KEY = 'pp-tv-room';
const STATS: Stat[] = ['kracht', 'klim', 'sprint', 'uithouding'];

function useNow(ms = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const colorOf = (t: { color: number }) => TEAM_COLORS[t.color % TEAM_COLORS.length];
const teamById = (s: PublicState, id: string) => s.teams.find((t) => t.id === id)!;
const ridersOf = (s: PublicState, teamId: string): Rider[] => s.riders.filter((r) => r.teamId === teamId);
const toleranceOf = (t: PublicTeam) => perksOf(teamDefIds(t.slots)).overtrainTolerance;

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
        (talking) => sound.duck(talking),
      ),
    [],
  );
  const track = useMemo(() => new Soundtrack(), []);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const origin = location.origin;
    const s = openSocket({
      onStatus: setOnline,
      onOpen() {
        // ?room=CODE koppelt een extra tv aan een bestaande kamer (handig voor demo's en tests).
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
          track.update(msg.state);
          const maxId = msg.feed.reduce((m, b) => Math.max(m, b.id), 0);
          if (lastFeed.current === null) lastFeed.current = maxId; // sla de geschiedenis over bij laden
          for (const batch of msg.feed) {
            if (batch.id > lastFeed.current) {
              lastFeed.current = batch.id;
              if (batch.interrupt) broadcaster.clear();
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
    const onKey = () => {
      sound.unlock();
      void broadcaster.unlock();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onKey);
    return () => {
      s.close();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onKey);
    };
  }, [broadcaster, track]);
  useEffect(() => () => track.destroy(), [track]);

  if (!snap) {
    return (
      <div class="boot ty">
        <div>PELOTON PANIC</div>
        <div class="dim">{online ? 'Kamer openen...' : 'Verbinden...'}</div>
        {slow && (
          <div class="retry" role="status">
            Dit duurt langer dan normaal. Controleer of de server draait en of deze tv op hetzelfde wifi zit.
            <button class="retry-btn" onClick={() => location.reload()}>
              Opnieuw proberen
            </button>
          </div>
        )}
      </div>
    );
  }

  const { state } = snap;
  const clock = () => Date.now() + offset.current;
  const control = (what: TvControl) => sock.current?.send({ t: 'tv:control', what });
  const inRace = state.phase === 'race' || state.phase === 'resolve' || state.phase === 'results';
  const veiled = state.phase === 'lobby' || state.phase === 'briefing' || state.phase === 'results' || state.phase === 'finished';
  const panelPhase = state.phase === 'draft' || state.phase === 'team' || state.phase === 'sponsors' || state.phase === 'recruit' || state.phase === 'naming';

  return (
    <div class="tv">
      <Header snap={snap} clock={clock} online={online} onStop={() => control('stop')} onKick={(teamId) => sock.current?.send({ t: 'tv:kick', teamId })} />
      <div class="main">
        <Stage state={state}>{inRace && <TutorialCard state={state} variant="lower" />}</Stage>
        <aside class={`side ${veiled ? 'veiled' : ''}`}>
          {!panelPhase && !inRace && <TutorialCard state={state} />}
          {inRace ? <EventCard state={state} /> : <StageCard state={state} />}
          <Standings snap={snap} />
        </aside>
        {(state.phase === 'sponsors' || state.phase === 'recruit') && <RecruitPanel snap={snap} />}
        {state.phase === 'naming' && <NamingPanel snap={snap} />}
        {state.phase === 'draft' && <DraftPanel snap={snap} />}
        {state.phase === 'team' && <TeamPanel snap={snap} />}
      </div>
      <Minimap state={state} />
      <Booth caption={caption} audioOn={audioOn} tutorial={state.tutorial} onEnable={() => {
          sound.unlock();
          void broadcaster.unlock();
        }}
      />
      {state.phase === 'lobby' && <Lobby snap={snap} onStart={() => control('start')} />}
      {state.phase === 'briefing' && <Briefing snap={snap} />}
      {state.phase === 'results' && <Results snap={snap} />}
      {state.phase === 'finished' && <Finished snap={snap} onRematch={() => control('rematch')} />}
      {error && <div class="toast ty">{error}</div>}
    </div>
  );
}

// ---- Onderdelen ---------------------------------------------------------------

function Header({
  snap,
  clock,
  online,
  onStop,
  onKick,
}: {
  snap: Snapshot;
  clock: () => number;
  online: boolean;
  onStop: () => void;
  onKick: (teamId: string) => void;
}) {
  useNow(250);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    // Een vergeten bevestiging verdwijnt vanzelf, zodat de tv nooit met "Zeker weten?" blijft staan.
    if (!confirming) return;
    const id = setTimeout(() => setConfirming(false), 5000);
    return () => clearTimeout(id);
  }, [confirming]);
  const { state } = snap;
  const left = snap.phaseEndsAt ? Math.max(0, Math.ceil((snap.phaseEndsAt - clock()) / 1000)) : null;
  const [muted, setMuted] = useState(sound.muted);
  const timed = state.phase === 'sponsors' || state.phase === 'recruit' || state.phase === 'draft' || state.phase === 'team' || state.phase === 'race';
  useEffect(() => {
    // The last seconds of a timer tick down out loud, and visibly (see the .tick class).
    if (timed && left !== null && left > 0 && left <= 3) sound.ui('count');
  }, [left, state.phase]);
  const label: Record<string, string> = {
    lobby: 'Lobby',
    briefing: 'Eerst de uitleg',
    sponsors: 'Winkel: kies je sponsors',
    recruit: 'Winkel: kies je renners',
    naming: 'Geef je renners een naam',
    draft: 'Draft: kies je kaarten',
    team: 'Voorbereiding',
    race: `Ronde ${state.round}: kies je tempo`,
    resolve: `Ronde ${state.round}: de race`,
    results: 'Uitslag',
    finished: 'Eindstand',
  };
  return (
    <header class="head">
      <div class="logo ty">PELOTON PANIC</div>
      <div class="phase ty">
        {state.phase === 'lobby' || state.phase === 'briefing' ? 'SEIZOEN' : `ETAPPE ${state.stage}/${STAGES}`}
        <span class="sep">/</span>
        {label[state.phase]}
        {state.tutorial && <span class="tut ty">TUTORIAL</span>}
      </div>
      <div class="timer ty">
        {left !== null && state.phase !== 'resolve' ? (
          <span key={timed && left > 0 && left <= 3 ? left : 'steady'} class={timed && left > 0 && left <= 3 ? 'tick' : ''}>
            {left}s
          </span>
        ) : (
          ''
        )}
        {!online && <span class="bad"> OFFLINE</span>}
        <Roster snap={snap} onKick={onKick} />
        {snap.state.phase !== 'lobby' &&
          (confirming ? (
            <span class="stop-confirm ty">
              Spel stoppen?
              <button
                class="mute stop yes ty"
                onClick={() => {
                  setConfirming(false);
                  onStop();
                }}
              >
                JA, STOP
              </button>
              <button class="mute ty" onClick={() => setConfirming(false)}>
                NEE
              </button>
            </span>
          ) : (
            <button class="mute stop ty" title="Stop dit spel en ga terug naar de lobby" onClick={() => setConfirming(true)}>
              STOP SPEL
            </button>
          ))}
        <button
          class="mute ty"
          aria-label={muted ? 'Geluid aan' : 'Geluid uit'}
          title={muted ? 'Geluid aan' : 'Geluid uit'}
          onClick={() => {
            sound.unlock();
            sound.setMuted(!muted);
            setMuted(!muted);
          }}
        >
          {muted ? 'GELUID UIT' : 'GELUID'}
        </button>
      </div>
    </header>
  );
}

/** Spelers beheren vanaf de tv: wie er niet (meer) bij hoort, zet je eruit. */
function Roster({ snap, onKick }: { snap: Snapshot; onKick: (teamId: string) => void }) {
  const { state } = snap;
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  useEffect(() => {
    if (!confirm) return;
    const id = setTimeout(() => setConfirm(null), 5000);
    return () => clearTimeout(id);
  }, [confirm]);
  const lobby = state.phase === 'lobby';
  return (
    <span class="roster">
      <button class="mute ty" aria-expanded={open} onClick={() => setOpen(!open)}>
        SPELERS
      </button>
      {open && (
        <div class="roster-pop frame" role="dialog" aria-label="Spelers">
          {state.teams.length === 0 && <p class="dim">Nog niemand.</p>}
          {state.teams.map((t) => {
            // Een bot midden in het seizoen kun je niet weghalen: de stand verwijst nog naar het team.
            const removable = !t.isBot || lobby;
            const status = t.isBot
              ? 'bot'
              : snap.autopilot[t.id]
                ? 'bot speelt mee'
                : !snap.connected[t.id]
                  ? 'weg'
                  : '';
            return (
              <div class="roster-row" key={t.id}>
                <span class="chip" data-s={colorOf(t).shape} style={{ background: colorOf(t).hex }} />
                <span class="rn">{t.name}</span>
                {status && <span class="dim">{status}</span>}
                {removable &&
                  (confirm === t.id ? (
                    <button
                      class="mute stop yes ty"
                      onClick={() => {
                        setConfirm(null);
                        onKick(t.id);
                      }}
                    >
                      ZEKER?
                    </button>
                  ) : (
                    <button class="mute stop ty" onClick={() => setConfirm(t.id)}>
                      {t.isBot ? 'VERWIJDER' : 'ZET ERUIT'}
                    </button>
                  ))}
              </div>
            );
          })}
          {!lobby && <p class="dim s">Een speler die eruit gaat, wordt vervangen door een bot.</p>}
        </div>
      )}
    </span>
  );
}

function Stage({ state, children }: { state: PublicState; children?: ComponentChildren }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const r = useRef<TrackRenderer | null>(null);
  useEffect(() => {
    r.current = new TrackRenderer(ref.current!);
    return () => r.current?.destroy();
  }, []);
  useEffect(() => {
    r.current?.setState(demo(state));
  }, [state]);
  return (
    <div class="stage frame">
      <canvas ref={ref} width={W} height={H} role="img" aria-label="De koers: renners op het parcours" />
      {children}
    </div>
  );
}

/** Zonder parcours (lobby/draft) tekenen we een vlak voorbeeld, zodat het scherm leeft. */
function demo(state: PublicState): PublicState {
  if (state.terrain.length > 0) return state;
  return { ...state, terrain: Array.from({ length: 32 }, () => 'flat' as const), trackLength: 32 };
}

function TutorialCard({ state, variant = 'rail' }: { state: PublicState; variant?: 'rail' | 'inline' | 'lower' }) {
  const h = tvHint(state);
  if (!h) return null;
  return (
    <div class={`tutcard ${variant}`} role="note">
      <p>
        <b class="ty">{h.title}</b> {h.text}
      </p>
    </div>
  );
}

function StageCard({ state }: { state: PublicState }) {
  const info = stageProfile(state);
  const early = state.phase === 'lobby' || state.phase === 'briefing';
  return (
    <div class="event frame">
      <div class="tag ty">{early ? 'Seizoen' : `Etappe ${state.stage}`}</div>
      <div class="title ty">{early ? `${STAGES} etappes, 1 winnaar` : info.stageName}</div>
      <p>{early ? 'Bouw je team op, train je renners en win het seizoen.' : info.stageBlurb}</p>
      {!early && <p class="profile-line">Parcours: {info.summary}</p>}
      {!early && state.stage > 0 && (
        <p class={`weather ${state.weather}`}>
          <b>
            {WEATHER[state.weather].icon} {WEATHER[state.weather].label}
          </b>{' '}
          · {WEATHER[state.weather].blurb}
        </p>
      )}
      {!early && <PremieList state={state} />}
    </div>
  );
}

/** De premies van deze etappe: waar ze liggen en wie al heeft gescoord. */
function PremieList({ state }: { state: PublicState }) {
  if (state.premies.length === 0) return null;
  const nameOf = (id: string) => state.riders.find((r) => r.id === id)?.name.split(' ')[0] ?? '?';
  return (
    <div class="premies">
      {state.premies.map((p) => (
        <div class={`premie ${p.hits.length >= PREMIE_POINTS.length ? 'closed' : ''}`} key={p.id}>
          <span class="pn ty">⚑ {PREMIE_INFO[p.id].label}</span>
          <span class="pp">
            tegel {p.pos} · {PREMIE_POINTS.join('-')} punten
          </span>
          {p.hits.length > 0 && (
            <span class="ph">
              {p.hits.map((h, i) => `${i + 1}. ${nameOf(h.riderId)}`).join('  ')}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function EventCard({ state }: { state: PublicState }) {
  if (!state.event) return <div class="event frame" />;
  const def = EVENTS[state.event.id];
  const rider = state.event.targetRiderId ? state.riders.find((r) => r.id === state.event!.targetRiderId) : null;
  const team = state.event.targetTeamId ? teamById(state, state.event.targetTeamId) : null;
  return (
    <div class={`event frame ${def.silly ? 'silly' : ''}`}>
      <div class="tag ty">{def.silly ? 'Nieuws' : 'Omstandigheden'}</div>
      <div class="ev-head">
        <span class="ev-icon" aria-hidden="true">{EVENT_ICON[def.id]}</span>
        <div class="title ty">{def.title}</div>
      </div>
      <p>{def.blurb}</p>
      <p class={`weather ${state.weather}`}>
        {WEATHER[state.weather].icon} {WEATHER[state.weather].label}
      </p>
      {rider && <p class="target">Doelwit: {rider.name}</p>}
      {team && <p class="target">Doelwit: team van {team.name}</p>}
      <PremieList state={state} />
    </div>
  );
}

function EnergyBar({ value, max }: { value: number; max: number }) {
  return <Battery value={value} max={max} />;
}

/** De koers renner voor renner: plek, tegel en hoe ver ze van de kop en van elkaar liggen. */
function Ladder({ snap }: { snap: Snapshot }) {
  const { state } = snap;
  const rows = standing(state);
  const kopmen = new Set(Object.values(state.kopman));
  const lead = rows[0]?.tile ?? 0;
  const span = Math.max(1, rows[rows.length - 1] ? lead - rows[rows.length - 1].tile : 1);
  const ref = useRef<HTMLDivElement>(null);
  useFlip(ref);
  // The rider who just took the yellow jersey gets a sweep across the row.
  const took = useChanged(rows[0]?.rider.id ?? null);
  return (
    <div ref={ref} class={`standings ladder frame ${rows.length > 9 ? 'dense' : ''}`} style={{ '--n': rows.length }}>
      <div class="tag ty">
        Koers · {rows.length} renners · tegel {lead} van {state.trackLength}
      </div>
      {rows.map((row, i) => {
        const team = teamById(state, row.teamId);
        const col = colorOf(team);
        const tied = i > 0 && row.gapAhead === 0;
        const r = row.rider;
        const left = span > 0 ? (1 - row.gapLeader / span) * 100 : 100;
        return (
          <div key={r.id} data-flip={r.id}>
            {i > 0 && row.gapAhead > 0 && (
              <div class="gap" style={{ '--g': Math.min(row.gapAhead, 6) }}>
                <span>{rows.length > 9 && row.gapAhead < 2 ? '' : tiles(row.gapAhead)}</span>
              </div>
            )}
            <div class={`lrow ${row.rank === 1 ? 'first' : ''} ${tied ? 'tied' : ''} ${took === r.id && row.rank === 1 ? 'took' : ''}`} style={{ '--c': col.hex }}>
              <span class="rk ty">{tied ? '' : row.rank === 1 ? <Crown size={18} /> : row.rank}</span>
              <span class="av">
                <RiderAvatar rider={r} color={team.color} size="100%" />
              </span>
              <span class="nm">
                {kopmen.has(r.id) && <span class="star">★</span>}
                {r.name.split(' ')[0]} <i class="tm">{team.name}</i>
              </span>
              <span class="bar">
                <span class="fillp" style={{ width: `${left}%`, background: col.hex }} />
                <span class="dotp" style={{ left: `${left}%` }}>
                  <RiderAvatar rider={r} color={team.color} size="100%" />
                </span>
              </span>
              <Battery value={r.energy} max={r.maxEnergy} />
              <span class="tl ty">{row.tile}</span>
              <span class={`gl ty ${row.gapLeader === 0 ? 'ok' : ''}`}>{row.gapLeader === 0 ? 'KOP' : `−${row.gapLeader}`}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Standings({ snap }: { snap: Snapshot }) {
  const { state } = snap;
  const racing = state.phase === 'race' || state.phase === 'resolve' || state.phase === 'results';
  if (racing) return <Ladder snap={snap} />;
  return <TeamStandings snap={snap} />;
}

function Points({ n }: { n: number }) {
  return <span class={`best ty ${useBump(n)}`}>{n}</span>;
}

function TeamStandings({ snap }: { snap: Snapshot }) {
  const { state } = snap;
  const ref = useRef<HTMLDivElement>(null);
  useFlip(ref);
  const rows = [...state.teams].sort((a, b) => b.points - a.points);
  const maxPts = Math.max(1, ...rows.map((t) => t.points));
  return (
    <div ref={ref} class="standings frame">
      <div class="tag ty">Klassement</div>
      {rows.map((t, i) => {
        const col = colorOf(t);
        let waiting = '';
        if (state.phase === 'team' || state.phase === 'sponsors' || state.phase === 'recruit') waiting = t.ready ? 'KLAAR' : 'BEZIG';
        else if (state.phase === 'draft') waiting = state.draft?.currentTeamId === t.id ? 'AAN DE BEURT' : '';
        const turn = waiting === 'AAN DE BEURT';
        const rs = ridersOf(state, t.id);
        return (
          <div class={`row ${turn ? 'turn' : ''}`} key={t.id} data-flip={t.id} style={{ '--c': col.hex }}>
            <span class="rank">
              <Medal place={i + 1} size={26} />
            </span>
            {rs.length > 0 ? <TeamStack riders={rs} color={t.color} size={32} /> : <span class="chip" data-s={col.shape} style={{ background: col.hex }} />}
            <div class="who">
              <div class="name">
                {t.name}
                {t.isBot && <span class="bot"> bot</span>}
                {snap.autopilot[t.id] ? (
                  <span class="bot"> bot speelt mee</span>
                ) : (
                  !snap.connected[t.id] && <span class="bad"> weg</span>
                )}
              </div>
              <div class="riders">
                <Coins n={t.coins} />
                <HandFan n={t.handCount} />
                <span class={`state ty ${waiting === 'KLAAR' || turn ? 'ok' : ''}`}>{waiting}</span>
              </div>
              <span class="ptsbar">
                <i style={{ width: `${(t.points / maxPts) * 100}%` }} />
              </span>
            </div>
            <Points n={t.points} />
          </div>
        );
      })}
    </div>
  );
}

function Minimap({ state }: { state: PublicState }) {
  const racing = state.phase === 'race' || state.phase === 'resolve' || state.phase === 'results';
  const rows = racing ? standing(state) : [];
  const kopmen = new Set(Object.values(state.kopman));
  return (
    <div class="minimap frame">
      <ElevationProfile
        terrain={state.terrain}
        premies={state.premies}
        riders={rows.map((row) => ({
          id: row.rider.id,
          pos: row.rider.pos,
          type: row.rider.type,
          color: teamById(state, row.teamId).color,
          kop: kopmen.has(row.rider.id),
          first: row.rank === 1,
        }))}
      />
    </div>
  );
}

function Booth({
  caption,
  audioOn,
  tutorial,
  onEnable,
}: {
  caption: Caption | null;
  audioOn: boolean;
  tutorial: boolean;
  onEnable: () => void;
}) {
  const who: CommentatorId[] = tutorial ? ['johan', 'marieke', 'fenna'] : ['johan', 'marieke'];
  return (
    <footer class="booth frame" style={{ '--mics': who.length }}>
      {who.map((id) => {
        const speaking = caption?.speaker === id;
        return (
          <div class={`mic ${speaking ? 'on' : ''}`} key={id}>
            <Avatar who={id} speaking={speaking && audioOn} />
            <div class="meta">
              <div class="nm ty">{COMMENTATORS[id].name}</div>
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
          <span class="dim">De commentatoren nemen een slok koffie.</span>
        )}
      </div>
      {!audioOn && (
        <button class="sound ty" onClick={onEnable}>
          GELUID AAN
        </button>
      )}
    </footer>
  );
}

// ---- Kaarten en teambord -------------------------------------------------------

function StatBars({ rider, tolerance }: { rider: Rider; tolerance: number }) {
  const eff = effectiveStats(rider, tolerance);
  return (
    <div class="sbars">
      {STATS.map((k) => {
        const base = rider.base[k];
        const form = rider.form[k];
        const lost = Math.max(0, base + form - eff[k]);
        return (
          <div class="sb" key={k}>
            <span class="sl">
              <StatIcon stat={k} size={12} /> {STAT_LABELS[k].slice(0, 4)}
            </span>
            <span class="track">
              <span class="seg base" style={{ width: `${Math.min(100, (Math.min(base, eff[k]) / 10) * 100)}%` }} />
              <span class="seg form" style={{ width: `${(Math.max(0, eff[k] - base) / 10) * 100}%` }} />
              {lost > 0 && <span class="seg lost" style={{ width: `${(lost / 10) * 100}%` }} />}
            </span>
            <span class="sv ty">{eff[k]}</span>
          </div>
        );
      })}
    </div>
  );
}

function Fatigue({ value, tolerance }: { value: number; tolerance: number }) {
  const limit = 2 + tolerance;
  return (
    <span class="fat" title="Vermoeidheid">
      {Array.from({ length: 6 }, (_, i) => (
        <i key={i} class={i < value ? (i >= limit ? 'on over' : 'on') : ''} />
      ))}
    </span>
  );
}

function NamingPanel({ snap }: { snap: Snapshot }) {
  const { state } = snap;
  const done = state.teams.filter((t) => t.ready || t.isBot).length;
  return (
    <div class="panel frame">
      <div class="ph-head">
        <div>
          <div class="big-line ty">
            {done}/{state.teams.length} teams klaar. Geen timer, de draft begint zodra iedereen klaar is.
          </div>
        </div>
      </div>
      <TutorialCard state={state} variant="inline" />
      <div class="boards">
        {state.teams.map((t) => {
          const col = colorOf(t);
          const ready = t.ready || t.isBot;
          return (
            <div class={`board ${ready ? 'ready' : ''}`} key={t.id}>
              <div class="bh">
                <span class="chip" data-s={col.shape} style={{ background: col.hex }} />
                <b>{t.name}</b>
                {t.isBot && <span class="bot"> bot</span>}
                <span class={`rd ty ${ready ? 'ok' : ''}`}>{ready ? 'KLAAR' : 'BEZIG'}</span>
              </div>
              {ridersOf(state, t.id).map((r) => (
                <div class="br" key={r.id}>
                  <div class="rn">
                    {r.name} <i>{RIDER_TYPES[r.type].label}</i>
                  </div>
                  <div class="dim">{QUIRKS[r.quirk].label}</div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecruitPanel({ snap }: { snap: Snapshot }) {
  const { state } = snap;
  const rc = state.recruit!;
  const sponsorStep = state.phase === 'sponsors';
  const done = state.teams.filter((t) => t.ready).length;
  return (
    <div class="panel frame">
      <div class="ph-head">
        <div>
          <div class="big-line ty">
            {done}/{state.teams.length} teams klaar. {sponsorStep ? 'Eerst de sponsors.' : 'Nu de renners.'} Iedereen winkelt tegelijk, in zijn eigen winkel.
          </div>
        </div>
      </div>
      <TutorialCard state={state} variant="inline" />
      <div class="boards">
        {state.teams.map((t) => {
          const col = colorOf(t);
          const riders = ridersOf(state, t.id);
          return (
            <div class={`board ${t.ready ? 'ready' : ''}`} key={t.id}>
              <div class="bh">
                <TeamJersey color={t.color} size={26} />
                <b>{t.name}</b>
                {t.isBot && <span class="bot"> bot</span>}
                <span class="coins">
                  <Coins n={t.coins} />
                </span>
                <span class={`rd ty ${t.ready ? 'ok' : ''}`}>{t.ready ? 'KLAAR' : 'BEZIG'}</span>
              </div>
              {!sponsorStep && Array.from({ length: rc.picks }, (_, i) => {
                const r = riders[i];
                return r ? (
                  <div class="br" key={r.id}>
                    <RiderAvatar rider={r} color={t.color} size={46} />
                    <div class="brb">
                      <div class="rn">
                        {r.name} <TypeBadge type={r.type} />
                      </div>
                      <StatBars rider={r} tolerance={0} />
                    </div>
                  </div>
                ) : (
                  <div class="br empty" key={i}>
                    <span class="slot" />
                    <div class="rn dim">Nog geen renner</div>
                  </div>
                );
              })}
              <div class="assets">
                {Array.from({ length: rc.contracts }, (_, i) => {
                  const def = t.slots.sponsor[i];
                  return def ? (
                    <span class="asset" key={i} style={{ '--k': KIND_COLORS[CARD_DEFS[def].kind] } as Record<string, string>}>
                      {CARD_DEFS[def].name}
                    </span>
                  ) : (
                    <span class="asset empty" key={i}>
                      sponsor gezocht
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p class="hint">
        {sponsorStep
          ? 'Eerst maximaal twee sponsors per team. Sponsors betalen meteen, betalen bij succes of leveren spullen. Bij tegenstanders zie je pas wat ze tekenen als ze het doen. Daarna kiest iedereen drie renners.'
          : 'Nu drie renners per team, met het budget dat na de sponsors overblijft. Bij tegenstanders zie je pas wie ze kiezen als ze het doen.'}
      </p>
    </div>
  );
}

function DraftPanel({ snap }: { snap: Snapshot }) {
  const { state } = snap;
  const d = state.draft!;
  const current = d.currentTeamId ? teamById(state, d.currentTeamId) : null;
  return (
    <div class="panel frame">
      <div class="ph-head">
        <div>
          <div class="big-line ty">
            {current ? (
              <>
                <span class="chip" data-s={colorOf(current).shape} style={{ background: colorOf(current).hex }} /> {current.name} is aan de beurt
              </>
            ) : (
              'De draft is klaar'
            )}
          </div>
        </div>
        <div class="order">
          {d.order.map((id, i) => {
            const t = teamById(state, id);
            return (
              <span
                key={i}
                class={`ord ${i === d.idx ? 'now' : i < d.idx ? 'done' : ''}`}
                style={{ background: colorOf(t).hex }}
                title={t.name}
              >
                {t.name.slice(0, 1).toUpperCase()}
              </span>
            );
          })}
        </div>
      </div>
      <TutorialCard state={state} variant="inline" />
      <p class="profile-line">
        <b>{stageProfile(state).stageName}</b> · {stageProfile(state).summary}
        {state.premies.length > 0 && ` · premies: ${stageProfile(state).premies.toLowerCase()}`}
      </p>
      <div class="kicker ty">De markt ({state.deckCount} kaarten op de stapel)</div>
      <div class="market">
        {state.market.map((def, i) => (
          <PlayingCard key={i} def={def} price index={i} fan />
        ))}
        <CardBack count={state.deckCount} index={state.market.length} />
      </div>
      <p class="hint">
        Pak een kaart van de markt, of een onbekende van de stapel. Het team onderaan het klassement begint.
      </p>
    </div>
  );
}

function TeamPanel({ snap }: { snap: Snapshot }) {
  const { state } = snap;
  return (
    <div class="panel frame">
      <div class="ph-head">
        <div>
          <div class="big-line ty">Kies je kopman, train je renners en bouw je team uit</div>
          <p class="profile-line">
            {stageProfile(state).summary}
            {state.premies.length > 0 && ` · premies: ${stageProfile(state).premies.toLowerCase()}`}
          </p>
        </div>
      </div>
      <TutorialCard state={state} variant="inline" />
      <div class="boards">
        {state.teams.map((t) => {
          const col = colorOf(t);
          const tol = toleranceOf(t);
          const all = [...t.slots.sponsor, ...t.slots.staff, ...t.slots.material, ...t.slots.car];
          return (
            <div class={`board ${t.ready ? 'ready' : ''}`} key={t.id}>
              <div class="bh">
                <span class="chip" data-s={col.shape} style={{ background: col.hex }} />
                <b>{t.name}</b>
                {t.isBot && <span class="bot"> bot</span>}
                <span class="coins">
                  <Coins n={t.coins} />
                </span>
                <span class={`rd ty ${t.ready ? 'ok' : ''}`}>{t.ready ? 'KLAAR' : ''}</span>
              </div>
              {ridersOf(state, t.id).map((r) => (
                <div class="br" key={r.id}>
                  <RiderAvatar rider={r} color={t.color} size={46} />
                  <div class="brb">
                    <div class="rn">
                      {r.name} <TypeBadge type={r.type} />
                      {r.injury > 0 && <i class="injury"> 🩹</i>}
                      <Fatigue value={r.fatigue} tolerance={tol} />
                    </div>
                    <StatBars rider={r} tolerance={tol} />
                  </div>
                </div>
              ))}
              <div class="assets">
                {all.length === 0 && <span class="dim">Nog geen spullen</span>}
                {all.map((def, i) => (
                  <span class="asset" key={i} style={{ '--k': KIND_COLORS[CARD_DEFS[def].kind] } as Record<string, string>}>
                    {CARD_DEFS[def].name}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Lobby, uitslag, eindstand ------------------------------------------------

function Lobby({ snap, onStart }: { snap: Snapshot; onStart: () => void }) {
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
          <div class="ty kicker">DOE MEE MET JE TELEFOON</div>
          <div class="code ty">{snap.code}</div>
          <div class="qr" dangerouslySetInnerHTML={{ __html: qr }} />
          <div class="url">{snap.joinUrl.replace(/^https?:\/\//, '')}</div>
        </div>
        <div class="right">
          <div class="ty kicker">HET PELOTON ({state.teams.length}/6)</div>
          <div class="teams">
            {state.teams.length === 0 && <p class="dim">Wachten op de eerste renner...</p>}
            {state.teams.map((t) => {
              const col = colorOf(t);
              return (
                <div class="team" key={t.id}>
                  <div class="tn">
                    <TeamJersey color={t.color} size={30} /> {t.name}
                    {t.id === snap.presidentTeamId && <span class="crown ty"> PRESIDENT</span>}
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
              ? 'Je hebt minstens 2 teams nodig. De president kan bots toevoegen op de telefoon.'
              : president
                ? `${president.name} is de president: druk op Start op je telefoon, of start hier op de tv.`
                : 'Wachten op de president.'}
          </p>
          <button class="big-start ty" disabled={state.teams.length < 2} onClick={onStart}>
            START HET SEIZOEN
          </button>
          <p class="hint">Na de start volgt eerst een korte uitleg van het spel, zonder timer.</p>
          <p class={`tutstate ${state.tutorial ? 'on' : ''}`}>
            Tips tijdens het spel: <b>{state.tutorial ? 'aan' : 'uit'}</b>. {state.tutorial ? 'Kaartjes en Fenna herinneren je aan wat nu kan.' : 'Alleen de uitleg vooraf.'} Commentaar: <b>{state.commentary ? 'aan' : 'uit'}</b>.
          </p>
        </div>
      </div>
    </div>
  );
}

function Briefing({ snap }: { snap: Snapshot }) {
  const { state } = snap;
  const b = state.briefing;
  if (!b) return null;
  const page = BRIEFING[Math.min(b.page, BRIEFING.length - 1)];
  const okCount = state.teams.filter((t) => b.ok[t.id]).length;
  const president = state.teams.find((t) => t.id === snap.presidentTeamId);
  const last = b.page >= BRIEFING.length - 1;
  return (
    <div class="overlay">
      <div class="brief-tv frame">
        <div class="bt-top">
          <span class="ty kicker">
            DE SPELREGELS · {b.page + 1} VAN {BRIEFING.length}
          </span>
          <span class="dots">
            {BRIEFING.map((_, i) => (
              <i key={i} class={i === b.page ? 'on' : i < b.page ? 'done' : ''} />
            ))}
          </span>
        </div>
        <h1 class="ty">{page.title}</h1>
        <p class="lead">{page.lead}</p>
        <div class="bt-points">
          {page.points.map((p, i) => (
            <div class="bt-point" key={p.head}>
              <span class="n ty">{i + 1}</span>
              <div>
                <div class="ty h">{p.head}</div>
                <div class="t">{p.text}</div>
              </div>
            </div>
          ))}
        </div>
        <div class="bt-foot">
          <span class="okline">
            {last ? (
              <>
                <b>{okCount}</b> van {state.teams.length} snappen het.
                {state.teams.filter((t) => !b.ok[t.id]).length > 0 &&
                  ` Nog: ${state.teams
                    .filter((t) => !b.ok[t.id])
                    .map((t) => t.name)
                    .join(', ')}.`}
              </>
            ) : (
              <>Geen timer. Vraag het gerust als iets niet duidelijk is.</>
            )}
          </span>
          <span class="dim">
            {president ? `${president.name} bladert door op de telefoon.` : 'De president bladert door op de telefoon.'}
          </span>
        </div>
      </div>
    </div>
  );
}

function Results({ snap }: { snap: Snapshot }) {
  const { state } = snap;
  const res = state.stageResult!;
  const teams = [...res.teams].sort((a, b) => b.stagePoints - a.stagePoints);
  const rankOf = new Map(res.ranking.map((r) => [r.riderId, r.rank]));
  const entries: PodiumEntry[] = teams.map((t) => {
    const team = teamById(state, t.teamId);
    const best = [...ridersOf(state, team.id)].sort((a, b) => (rankOf.get(a.id) ?? 99) - (rankOf.get(b.id) ?? 99))[0];
    return {
      teamId: team.id,
      name: team.name,
      color: team.color,
      rider: best,
      riderLabel: best ? `${best.name.split(' ')[0]} · #${rankOf.get(best.id)}` : undefined,
      points: t.stagePoints,
      pointsLabel: `+${t.stagePoints}`,
      sub: `${t.totalPoints} totaal`,
    };
  });
  return (
    <div class="overlay">
      <div class="finish frame">
        <div class="ty kicker">UITSLAG ETAPPE {res.stage}</div>
        <Podium entries={entries} />
        <div class="podium details">
          {teams.map((t, i) => {
            const team = teamById(state, t.teamId);
            const col = colorOf(team);
            return (
              <div class={`pod p${i}`} key={t.teamId}>
                <div class="pn">
                  <Medal place={i + 1} size={22} />
                  <TeamStack riders={ridersOf(state, team.id)} color={team.color} size={26} /> {team.name}
                </div>
                {t.premiePoints > 0 && (
                  <div class="dim s">
                    eindstand {t.riderPoints} · premies {t.premiePoints}
                  </div>
                )}
                <div class="rs">
                  {ridersOf(state, team.id).map((r) => (
                    <span key={r.id} class="rr">
                      <RiderAvatar rider={r} color={team.color} size={22} />
                      <b class="ty">#{rankOf.get(r.id)}</b> {t.kopmanId === r.id ? '★ ' : ''}
                      {r.name}
                    </span>
                  ))}
                </div>
                <div class="reward">
                  <Coins n={t.prizeCoins + t.sponsorCoins} />
                  {t.sponsorCoins > 0 && <span class="dim"> (sponsor {t.sponsorCoins})</span>}
                </div>
                {t.bonusCards.length > 0 && (
                  <div class="bonus">
                    {t.bonusCards.map((d, k) => (
                      <span key={k} class="asset" style={{ '--k': KIND_COLORS[CARD_DEFS[d].kind] } as Record<string, string>}>
                        Bonus: {CARD_DEFS[d].name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {res.sabotages.length > 0 && (
          <div class="reveal">
            {res.sabotages.map((x, i) => (
              <p key={i}>
                <b>{teamById(state, x.fromTeamId).name}</b> zette <b>{CARD_DEFS[x.def].name}</b> in tegen{' '}
                <b>{teamById(state, x.toTeamId).name}</b>.
              </p>
            ))}
          </div>
        )}
        <p class="hint">
          ★ = kopman: zijn punten tellen dubbel. Training vervaagt nu met 1 per eigenschap. De volgende etappe begint zo vanzelf.
        </p>
      </div>
    </div>
  );
}

function Finished({ snap, onRematch }: { snap: Snapshot; onRematch: () => void }) {
  const { state } = snap;
  const res = state.season!;
  const strength = (r: Rider) => Object.values(r.base).reduce((n, v) => n + v, 0);
  const entries: PodiumEntry[] = res.teams.map((t) => {
    const team = teamById(state, t.teamId);
    const star = state.riders.find((r) => r.id === state.kopman[team.id]) ?? [...ridersOf(state, team.id)].sort((a, b) => strength(b) - strength(a))[0];
    return {
      teamId: team.id,
      name: team.name,
      color: team.color,
      rider: star,
      riderLabel: star ? star.name.split(' ')[0] : undefined,
      points: t.points,
      pointsLabel: `${t.points} pnt`,
      sub: `${t.coins} munten over`,
    };
  });
  const lantern = res.lanterneRougeTeamId ? teamById(state, res.lanterneRougeTeamId) : null;
  return (
    <div class="overlay">
      <div class="finish frame">
        <div class="ty kicker">EINDSTAND VAN HET SEIZOEN</div>
        <Podium entries={entries} />
        {lantern && (
          <p class="lantern">
            🏮 Rode lantaarn: <b>{lantern.name}</b>
          </p>
        )}
        <div class="awards">
          {res.awards.map((a) => {
            const team = teamById(state, a.teamId);
            const star = ridersOf(state, team.id)[0];
            return (
              <div class="award" key={a.title}>
                <div class="ty at">{a.title.toUpperCase()}</div>
                <div class="aw-team">
                  {star ? <RiderAvatar rider={star} color={team.color} size={30} /> : <span class="chip" data-s={colorOf(team).shape} style={{ background: colorOf(team).hex }} />}
                  {team.name}
                </div>
                <div class="dim">{a.blurb}</div>
              </div>
            );
          })}
        </div>
        <button class="big-start ty" onClick={onRematch}>
          NIEUW SEIZOEN
        </button>
        <p class="hint">De president kan ook een nieuw seizoen starten vanaf de telefoon.</p>
      </div>
    </div>
  );
}

render(<App />, document.getElementById('app')!);
