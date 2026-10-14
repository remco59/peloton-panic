import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import '../common/theme.css';
import './tv.css';
import {
  CARD_DEFS,
  COMMENTATORS,
  EFFORTS,
  EVENTS,
  KIND_COLORS,
  KIND_LABELS,
  QUIRKS,
  RIDER_TYPES,
  STAGE_INFO,
  STAT_LABELS,
  TEAM_COLORS,
} from '../../shared/content';
import type { CommentatorId } from '../../shared/content';
import { effectiveStats, perksOf, teamDefIds } from '../../shared/engine';
import { tvHint } from '../../shared/tutorial';
import type { FeedBatch, RoomInfo, ServerMsg } from '../../shared/protocol';
import type { PublicState, PublicTeam, Rider, Stat } from '../../shared/types';
import { STAGES } from '../../shared/types';
import { openSocket } from '../common/ws';
import type { Socket } from '../common/ws';
import { Broadcaster } from './broadcast';
import type { Caption } from './broadcast';
import { Avatar } from './avatars';
import { TrackRenderer, terrainColor, H, W } from './render';

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
      ),
    [],
  );

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
          const maxId = msg.feed.reduce((m, b) => Math.max(m, b.id), 0);
          if (lastFeed.current === null) lastFeed.current = maxId; // sla de geschiedenis over bij laden
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
      <div class="boot ty">
        <div>PELOTON PANIC</div>
        <div class="dim">{online ? 'Kamer openen...' : 'Verbinden...'}</div>
      </div>
    );
  }

  const { state } = snap;
  const clock = () => Date.now() + offset.current;
  const inRace = state.phase === 'race' || state.phase === 'resolve' || state.phase === 'results';

  return (
    <div class="tv">
      <Header snap={snap} clock={clock} online={online} />
      <div class="main">
        <Stage state={state} />
        <aside class={`side ${state.tutorial && state.phase !== 'draft' && state.phase !== 'team' ? 'with-tut' : ''}`}>
          {state.phase !== 'draft' && state.phase !== 'team' && <TutorialCard state={state} />}
          {inRace ? <EventCard state={state} /> : <StageCard state={state} />}
          <Standings snap={snap} />
        </aside>
        {state.phase === 'draft' && <DraftPanel snap={snap} />}
        {state.phase === 'team' && <TeamPanel snap={snap} />}
      </div>
      <Minimap state={state} />
      <Booth caption={caption} audioOn={audioOn} onEnable={() => void broadcaster.unlock()} />
      {state.phase === 'lobby' && <Lobby snap={snap} />}
      {state.phase === 'results' && <Results snap={snap} />}
      {state.phase === 'finished' && <Finished snap={snap} />}
      {error && <div class="toast ty">{error}</div>}
    </div>
  );
}

// ---- Onderdelen ---------------------------------------------------------------

function Header({ snap, clock, online }: { snap: Snapshot; clock: () => number; online: boolean }) {
  useNow(250);
  const { state } = snap;
  const left = snap.phaseEndsAt ? Math.max(0, Math.ceil((snap.phaseEndsAt - clock()) / 1000)) : null;
  const label: Record<string, string> = {
    lobby: 'Lobby',
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
        {state.phase === 'lobby' ? 'SEIZOEN' : `ETAPPE ${state.stage}/${STAGES}`}
        <span class="sep">/</span>
        {label[state.phase]}
        {state.tutorial && <span class="tut ty">TUTORIAL</span>}
      </div>
      <div class="timer ty">
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
    r.current?.setState(demo(state));
  }, [state]);
  return (
    <div class="stage frame">
      <canvas ref={ref} width={W} height={H} />
    </div>
  );
}

/** Zonder parcours (lobby/draft) tekenen we een vlak voorbeeld, zodat het scherm leeft. */
function demo(state: PublicState): PublicState {
  if (state.terrain.length > 0) return state;
  return { ...state, terrain: Array.from({ length: 32 }, () => 'flat' as const), trackLength: 32 };
}

function TutorialCard({ state, inline }: { state: PublicState; inline?: boolean }) {
  const h = tvHint(state);
  if (!h) return null;
  return (
    <div class={`tutcard ${inline ? 'inline' : 'frame'}`}>
      <div class="tag ty">TUTORIAL · {h.title.toUpperCase()}</div>
      <p>{h.text}</p>
    </div>
  );
}

function StageCard({ state }: { state: PublicState }) {
  const info = STAGE_INFO[Math.min(STAGES, Math.max(1, state.stage)) - 1];
  return (
    <div class="event frame">
      <div class="tag ty">{state.phase === 'lobby' ? 'SEIZOEN' : `ETAPPE ${state.stage}`}</div>
      <div class="title ty">{state.phase === 'lobby' ? `${STAGES} etappes, 1 winnaar` : info.name}</div>
      <p>{state.phase === 'lobby' ? 'Bouw je team op, train je renners en win het seizoen.' : info.blurb}</p>
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
      <div class="tag ty">{def.silly ? 'NIEUWS' : 'OMSTANDIGHEDEN'}</div>
      <div class="title ty">{def.title}</div>
      <p>{def.blurb}</p>
      {rider && <p class="target">Doelwit: {rider.name}</p>}
      {team && <p class="target">Doelwit: team van {team.name}</p>}
    </div>
  );
}

function EnergyBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const tone = pct <= 25 ? 'low' : pct <= 55 ? 'mid' : 'high';
  return (
    <span class="ebar" title={`${value}/${max}`}>
      <span class={`fill ${tone}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

function Standings({ snap }: { snap: Snapshot }) {
  const { state } = snap;
  const racing = state.phase === 'race' || state.phase === 'resolve' || state.phase === 'results';
  const rows = state.teams
    .map((t) => ({ t, best: Math.max(0, ...ridersOf(state, t.id).map((r) => r.pos)) }))
    .sort((a, b) => (racing ? b.best - a.best : b.t.points - a.t.points));
  return (
    <div class="standings frame">
      <div class="tag ty">{racing ? 'KOERS' : 'KLASSEMENT'}</div>
      {rows.map(({ t, best }, i) => {
        const col = colorOf(t);
        let waiting = '';
        if (state.phase === 'race') waiting = t.locked ? 'KLAAR' : 'KIEST';
        else if (state.phase === 'team') waiting = t.ready ? 'KLAAR' : 'BEZIG';
        else if (state.phase === 'draft')
          waiting = state.draft?.currentTeamId === t.id ? 'AAN DE BEURT' : '';
        return (
          <div class="row" key={t.id}>
            <span class="rank ty">{i + 1}</span>
            <span class="chip" style={{ background: col.hex }} />
            <div class="who">
              <div class="name">
                {t.name}
                {t.isBot && <span class="bot"> bot</span>}
                {!snap.connected[t.id] && <span class="bad"> weg</span>}
              </div>
              {racing ? (
                <div class="riders">
                  {ridersOf(state, t.id).map((r) => (
                    <span key={r.id} class="rr" title={QUIRKS[r.quirk].label}>
                      {r.name.split(' ')[0]} <i>{Math.floor(r.pos)}</i>
                      <EnergyBar value={r.energy} max={r.maxEnergy} />
                    </span>
                  ))}
                </div>
              ) : (
                <div class="riders">
                  <span>
                    {t.coins} munten · {t.handCount} kaarten
                  </span>
                </div>
              )}
            </div>
            <span class={`state ty ${waiting === 'KLAAR' || waiting === 'AAN DE BEURT' ? 'ok' : ''}`}>{waiting}</span>
            <span class="best ty">{racing ? Math.floor(best) : t.points}</span>
          </div>
        );
      })}
    </div>
  );
}

function Minimap({ state }: { state: PublicState }) {
  const n = state.trackLength;
  const racing = state.phase === 'race' || state.phase === 'resolve' || state.phase === 'results';
  return (
    <svg class="minimap frame" viewBox={`0 0 ${n} 6`} preserveAspectRatio="none">
      {state.terrain.map((t, i) => (
        <rect key={i} x={i} y="3" width="1.02" height="3" fill={terrainColor(t)} />
      ))}
      {racing &&
        state.riders.map((r) => (
          <rect
            key={r.id}
            x={Math.min(n - 0.4, r.pos) - 0.2}
            y="0.4"
            width="0.5"
            height="2.4"
            rx="0.25"
            fill={colorOf(teamById(state, r.teamId)).hex}
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

function CardTile({ def, big }: { def: string; big?: boolean }) {
  const d = CARD_DEFS[def];
  if (!d) return null;
  return (
    <div class={`ctile ${big ? 'big' : ''}`} style={{ '--k': KIND_COLORS[d.kind] } as Record<string, string>}>
      <div class="ck ty">{KIND_LABELS[d.kind]}</div>
      <div class="cn">{d.name}</div>
      <div class="ct">{d.text}</div>
      <div class="cp ty">€ {d.price}</div>
    </div>
  );
}

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
            <span class="sl">{STAT_LABELS[k].slice(0, 4)}</span>
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

function DraftPanel({ snap }: { snap: Snapshot }) {
  const { state } = snap;
  const d = state.draft!;
  const current = d.currentTeamId ? teamById(state, d.currentTeamId) : null;
  return (
    <div class="panel frame">
      <div class="ph-head">
        <div>
          <div class="kicker ty">DRAFT: KIES JE KAARTEN</div>
          <div class="big-line ty">
            {current ? (
              <>
                <span class="chip" style={{ background: colorOf(current).hex }} /> {current.name} is aan de beurt
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
      <TutorialCard state={state} inline />
      <div class="kicker ty">DE MARKT ({state.deckCount} kaarten op de stapel)</div>
      <div class="market">
        {state.market.map((def, i) => (
          <CardTile key={i} def={def} big />
        ))}
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
          <div class="kicker ty">VOORBEREIDING: ETAPPE {state.stage}</div>
          <div class="big-line ty">Train je renners, bouw je team uit en ruil met de rest</div>
        </div>
      </div>
      <TutorialCard state={state} inline />
      <div class="boards">
        {state.teams.map((t) => {
          const col = colorOf(t);
          const tol = toleranceOf(t);
          const all = [...t.slots.sponsor, ...t.slots.staff, ...t.slots.material, ...t.slots.car];
          return (
            <div class={`board ${t.ready ? 'ready' : ''}`} key={t.id} style={{ borderColor: col.hex }}>
              <div class="bh">
                <span class="chip" style={{ background: col.hex }} />
                <b>{t.name}</b>
                {t.isBot && <span class="bot"> bot</span>}
                <span class="coins ty">€ {t.coins}</span>
                <span class={`rd ty ${t.ready ? 'ok' : ''}`}>{t.ready ? 'KLAAR' : ''}</span>
              </div>
              {ridersOf(state, t.id).map((r) => (
                <div class="br" key={r.id}>
                  <div class="rn">
                    {r.name} <i>{RIDER_TYPES[r.type].label}</i>
                    <Fatigue value={r.fatigue} tolerance={tol} />
                  </div>
                  <StatBars rider={r} tolerance={tol} />
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
                <div class="team" key={t.id} style={{ borderColor: col.hex }}>
                  <div class="tn">
                    <span class="chip" style={{ background: col.hex }} /> {t.name}
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
                ? `${president.name} is de president: druk op Start op je telefoon als iedereen er is.`
                : 'Wachten op de president.'}
          </p>
          <p class={`tutstate ${state.tutorial ? 'on' : ''}`}>
            Tutorial: <b>{state.tutorial ? 'aan' : 'uit'}</b>. De commentatoren leggen {state.tutorial ? 'het spel uit terwijl jullie spelen' : 'niets extra uit'}.
          </p>
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
  return (
    <div class="overlay">
      <div class="finish frame">
        <div class="ty kicker">UITSLAG ETAPPE {res.stage}</div>
        <div class="podium">
          {teams.map((t, i) => {
            const team = teamById(state, t.teamId);
            const col = colorOf(team);
            return (
              <div class={`pod p${i}`} key={t.teamId} style={{ borderColor: col.hex }}>
                <div class="ty pos">{i + 1}</div>
                <div class="pn">
                  <span class="chip" style={{ background: col.hex }} /> {team.name}
                </div>
                <div class="pts ty">
                  +{t.stagePoints} punten <span class="dim">({t.totalPoints} totaal)</span>
                </div>
                <div class="rs">
                  {ridersOf(state, team.id).map((r) => (
                    <span key={r.id}>
                      #{rankOf.get(r.id)} {r.name}
                    </span>
                  ))}
                </div>
                <div class="reward">
                  +{t.prizeCoins + t.sponsorCoins} munten
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
          Training vervaagt nu met 1 per eigenschap. Volgende etappe begint zo vanzelf, of de president drukt op Verder.
        </p>
      </div>
    </div>
  );
}

function Finished({ snap }: { snap: Snapshot }) {
  const { state } = snap;
  const res = state.season!;
  return (
    <div class="overlay">
      <div class="finish frame">
        <div class="ty kicker">EINDSTAND VAN HET SEIZOEN</div>
        <div class="podium">
          {res.teams.map((t, i) => {
            const team = teamById(state, t.teamId);
            const col = colorOf(team);
            return (
              <div class={`pod p${i}`} key={t.teamId} style={{ borderColor: col.hex }}>
                <div class="ty pos">{i + 1}</div>
                <div class="pn">
                  <span class="chip" style={{ background: col.hex }} /> {team.name}
                </div>
                <div class="pts ty">{t.points} punten</div>
                <div class="rs">
                  <span>{t.coins} munten over</span>
                </div>
              </div>
            );
          })}
        </div>
        <div class="awards">
          {res.awards.map((a) => {
            const team = teamById(state, a.teamId);
            return (
              <div class="award" key={a.title}>
                <div class="ty at">{a.title.toUpperCase()}</div>
                <div>
                  <span class="chip" style={{ background: colorOf(team).hex }} /> {team.name}
                </div>
                <div class="dim">{a.blurb}</div>
              </div>
            );
          })}
        </div>
        <p class="hint">De president kan een nieuw seizoen starten vanaf de telefoon.</p>
      </div>
    </div>
  );
}

render(<App />, document.getElementById('app')!);
