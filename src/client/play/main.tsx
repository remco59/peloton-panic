import '@fontsource/press-start-2p';
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import '../common/theme.css';
import './play.css';
import { CONTRACTS, EVENTS, QUIRKS, RIDER_TYPES, TEAM_COLORS, TERRAINS } from '../../shared/content';
import { matchSpecs, previewMove, terrainAt } from '../../shared/engine';
import type { PlayerAction, RoomInfo, ServerMsg } from '../../shared/protocol';
import type { Card, CardSpec, OfferView, PlayerView, PublicState, Rider } from '../../shared/types';
import { openSocket } from '../common/ws';
import type { Socket } from '../common/ws';

interface View extends RoomInfo {
  state: PublicState;
  me: PlayerView | null;
  teamId: string;
}

interface Saved {
  code: string;
  token: string;
  name: string;
}

const KEY = 'pp-session';
const load = (): Saved | null => {
  // ?room=CODE&token=T[&name=N] resumes a seat directly (used by demos and tests).
  const q = new URLSearchParams(location.search);
  if (q.get('room') && q.get('token')) {
    return { code: q.get('room')!.toUpperCase(), token: q.get('token')!, name: q.get('name') ?? '' };
  }
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
};
const save = (s: Saved | null) => {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    // private mode: the session just will not survive a reload
  }
};

function useNow(ms = 500) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4]}`;

function cardLabel(c: { kind: string; value: number }): string {
  if (c.kind === 'gel') return 'GEL';
  if (c.kind === 'attack') return 'ATK';
  if (c.kind === 'tired') return 'ZZZ';
  return String(c.value);
}

function CardView({
  card,
  selected,
  dim,
  onClick,
  small,
}: {
  card: { kind: string; value: number };
  selected?: boolean;
  dim?: boolean;
  onClick?: () => void;
  small?: boolean;
}) {
  const hint =
    card.kind === 'gel' ? 'Move 4. Used up' : card.kind === 'attack' ? 'Move 6, +2 tired' : card.kind === 'tired' ? 'Move 0' : `Move ${card.value}`;
  return (
    <button
      class={`card k-${card.kind} v-${card.value} ${selected ? 'sel' : ''} ${dim ? 'dim' : ''} ${small ? 'small' : ''}`}
      onClick={onClick}
      style={onClick ? undefined : { pointerEvents: 'none' }}
      tabIndex={onClick ? 0 : -1}
    >
      <span class="num pixel">{cardLabel(card)}</span>
      <span class="sub">{small ? '' : hint}</span>
    </button>
  );
}

// ---- Root ---------------------------------------------------------------------

function App() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(load());
  const [fatal, setFatal] = useState<string | null>(null);
  const sock = useRef<Socket | null>(null);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const offset = useRef(0);

  useEffect(() => {
    const s = openSocket({
      onStatus: setOnline,
      onOpen() {
        const sv = savedRef.current;
        if (sv) s.send({ t: 'player:join', code: sv.code, name: sv.name, token: sv.token });
      },
      onMessage(msg: ServerMsg) {
        if (msg.t === 'player:state') {
          offset.current = msg.serverNow - Date.now();
          setView(msg);
          setError(null);
        } else if (msg.t === 'joined') {
          const next = { code: msg.code, token: msg.token, name: savedRef.current?.name ?? '' };
          save(next);
          setSaved(next);
        } else if (msg.t === 'error') {
          if (msg.fatal) {
            save(null);
            setSaved(null);
            setView(null);
            setFatal(msg.message);
          } else {
            setError(msg.message);
            setTimeout(() => setError(null), 3500);
          }
        }
      },
    });
    sock.current = s;
    return () => s.close();
  }, []);

  const act = (action: PlayerAction) => sock.current?.send({ t: 'act', action });
  const president = (what: 'start' | 'addBot' | 'rematch' | 'removeBot') => sock.current?.send({ t: 'president', what });
  const join = (code: string, name: string) => {
    const next = { code: code.toUpperCase(), token: '', name };
    setSaved(next);
    savedRef.current = next;
    setFatal(null);
    sock.current?.send({ t: 'player:join', code: next.code, name });
  };

  if (!view) {
    return <JoinScreen online={online} fatal={fatal ?? error} onJoin={join} connecting={!!saved && online} />;
  }
  return (
    <Game
      view={view}
      act={act}
      president={president}
      error={error}
      online={online}
      clock={() => Date.now() + offset.current}
      leave={() => {
        save(null);
        location.reload();
      }}
    />
  );
}

// ---- Join ---------------------------------------------------------------------

function JoinScreen({
  online,
  fatal,
  onJoin,
  connecting,
}: {
  online: boolean;
  fatal: string | null;
  onJoin: (code: string, name: string) => void;
  connecting: boolean;
}) {
  const params = new URLSearchParams(location.search);
  const [code, setCode] = useState((params.get('room') ?? '').toUpperCase().slice(0, 4));
  const [name, setName] = useState(load()?.name ?? '');
  const ready = code.length === 4 && name.trim().length > 0 && online;
  return (
    <div class="join">
      <h1 class="pixel">PELOTON PANIC</h1>
      <p class="dim">Join the race with the room code on the TV.</p>
      <label>
        <span class="pixel">ROOM CODE</span>
        <input
          class="pixel code"
          value={code}
          maxLength={4}
          autocapitalize="characters"
          autocomplete="off"
          onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z]/g, ''))}
          placeholder="ABCD"
        />
      </label>
      <label>
        <span class="pixel">YOUR NAME</span>
        <input
          value={name}
          maxLength={16}
          autocomplete="off"
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          placeholder="Team captain"
        />
      </label>
      <button class="big primary pixel" disabled={!ready} onClick={() => onJoin(code, name.trim())}>
        {connecting ? 'JOINING...' : 'JOIN RACE'}
      </button>
      {!online && <p class="bad">Connecting to the server...</p>}
      {fatal && <p class="bad">{fatal}</p>}
    </div>
  );
}

// ---- Game shell ---------------------------------------------------------------

function Game({
  view,
  act,
  president,
  error,
  online,
  clock,
  leave,
}: {
  view: View;
  act: (a: PlayerAction) => void;
  president: (w: 'start' | 'addBot' | 'rematch' | 'removeBot') => void;
  error: string | null;
  online: boolean;
  clock: () => number;
  leave: () => void;
}) {
  useNow(500);
  const { state, me, teamId } = view;
  const team = state.teams.find((t) => t.id === teamId);
  const col = TEAM_COLORS[(team?.color ?? 0) % TEAM_COLORS.length];
  const isPresident = view.presidentTeamId === teamId;
  const left = view.phaseEndsAt ? Math.max(0, Math.ceil((view.phaseEndsAt - clock()) / 1000)) : null;

  if (!team || !me) {
    return (
      <div class="join">
        <p>You are no longer part of this race.</p>
        <button class="big pixel" onClick={leave}>
          START OVER
        </button>
      </div>
    );
  }

  const title: Record<string, string> = {
    lobby: 'LOBBY',
    play: 'CHOOSE EFFORT',
    resolve: 'WATCH THE TV',
    trade: 'TRADE',
    finished: 'FINISH',
  };

  return (
    <div class="game" style={{ '--team': col.hex } as Record<string, string>}>
      <header class="bar">
        <span class="chip" style={{ background: col.hex }} />
        <b class="who">{team.name}</b>
        <span class="ph pixel">{title[state.phase]}</span>
        <span class="tm pixel">{left !== null && state.phase !== 'resolve' ? `${left}s` : ''}</span>
      </header>
      {!online && <div class="offline pixel">RECONNECTING...</div>}
      {error && <div class="err">{error}</div>}
      <main>
        {state.phase === 'lobby' && <Lobby view={view} act={act} president={president} isPresident={isPresident} />}
        {state.phase === 'play' && <Play view={view} act={act} />}
        {state.phase === 'resolve' && <Resolve view={view} />}
        {state.phase === 'trade' && <Trade view={view} act={act} />}
        {state.phase === 'finished' && <Finished view={view} president={president} isPresident={isPresident} />}
      </main>
    </div>
  );
}

// ---- Lobby --------------------------------------------------------------------

function Lobby({
  view,
  act,
  president,
  isPresident,
}: {
  view: View;
  act: (a: PlayerAction) => void;
  president: (w: 'start' | 'addBot' | 'rematch' | 'removeBot') => void;
  isPresident: boolean;
}) {
  const { state, teamId } = view;
  const team = state.teams.find((t) => t.id === teamId)!;
  const mine = state.riders.filter((r) => r.teamId === teamId);
  const [names, setNames] = useState(mine.map((r) => r.name));
  const hasBot = state.teams.some((t) => t.isBot);
  const enough = state.teams.length >= 2;
  return (
    <section class="stack">
      <p class="dim">
        You are the manager of <b>{team.name}'s team</b>. Name your three riders, or keep the random ones.
      </p>
      {mine.map((r, i) => (
        <div class="rider-edit frame" key={r.id}>
          <div class="pixel small">{RIDER_TYPES[r.type].label.toUpperCase()}</div>
          <input
            value={names[i] ?? ''}
            maxLength={20}
            onInput={(e) => {
              const next = [...names];
              next[i] = (e.target as HTMLInputElement).value;
              setNames(next);
            }}
            onBlur={() => act({ type: 'nameRiders', names })}
          />
          <div class="quirk">
            <b>{QUIRKS[r.quirk].label}.</b> {QUIRKS[r.quirk].blurb}
          </div>
        </div>
      ))}
      <p class="dim">{state.teams.length} team(s) in the peloton.</p>
      {isPresident ? (
        <div class="stack">
          <p class="crown pixel">YOU ARE THE PRESIDENT</p>
          <div class="row2">
            <button class="big pixel" onClick={() => president('addBot')} disabled={state.teams.length >= 6}>
              + BOT
            </button>
            <button class="big pixel" onClick={() => president('removeBot')} disabled={!hasBot}>
              - BOT
            </button>
          </div>
          <button class="big primary pixel" disabled={!enough} onClick={() => president('start')}>
            START RACE
          </button>
          {!enough && <p class="dim">Needs at least 2 teams. Add a bot to try it alone.</p>}
        </div>
      ) : (
        <p class="dim">Waiting for the president to start the race.</p>
      )}
    </section>
  );
}

// ---- Play ---------------------------------------------------------------------

function rankOf(state: PublicState, rider: Rider): number {
  return 1 + state.riders.filter((r) => r.pos > rider.pos).length;
}

function Play({ view, act }: { view: View; act: (a: PlayerAction) => void }) {
  const { state, me, teamId } = view;
  const team = state.teams.find((t) => t.id === teamId)!;
  const mine = state.riders.filter((r) => r.teamId === teamId);
  const locked = team.locked;
  const [assign, setAssign] = useState<Record<string, string | null>>({});
  const [active, setActive] = useState(0);
  useEffect(() => {
    setAssign({});
    setActive(0);
  }, [state.round]);
  const shown = locked ? me!.plays : assign;
  const hand = me!.hand;
  const used = new Set(Object.values(shown).filter(Boolean) as string[]);
  const ev = state.event ? EVENTS[state.event.id] : null;

  const choose = (card: Card) => {
    if (locked) return;
    const next: Record<string, string | null> = { ...assign };
    for (const k of Object.keys(next)) if (next[k] === card.id) next[k] = null;
    const rider = mine[active];
    next[rider.id] = card.id;
    setAssign(next);
    const idx = mine.findIndex((r, i) => i !== active && !next[r.id]);
    if (idx >= 0) setActive(idx);
  };

  const coasting = mine.filter((r) => !shown[r.id]).length;

  return (
    <section class="stack">
      {ev && (
        <div class={`event frame ${ev.silly ? 'silly' : ''}`}>
          <b>{ev.title}.</b> {ev.blurb}
        </div>
      )}
      <div class="riders">
        {mine.map((r, i) => {
          const card = hand.find((c) => c.id === shown[r.id]) ?? null;
          const terrain = terrainAt(state, r.pos);
          const move = card ? previewMove(state, r, card) : previewMove(state, r, null);
          return (
            <button
              key={r.id}
              class={`rider frame ${i === active && !locked ? 'active' : ''}`}
              onClick={() => {
                if (locked) return;
                if (i === active && shown[r.id]) setAssign({ ...assign, [r.id]: null });
                else setActive(i);
              }}
            >
              <div class="r-top">
                <b>{r.name}</b>
                <span class="dim">
                  {RIDER_TYPES[r.type].label} · {ordinal(rankOf(state, r))}
                </span>
              </div>
              <div class="r-mid">
                <span class={`terr t-${terrain}`}>
                  {TERRAINS[terrain].icon} {TERRAINS[terrain].label}
                </span>
                <span class="dim quirk-s">{QUIRKS[r.quirk].label}</span>
              </div>
              <div class="r-bot">
                {card ? <CardView card={card} small /> : <span class="slot">{locked ? 'coasting' : 'tap a card'}</span>}
                <span class="mv pixel">
                  {card ? '+' : '~+'}
                  {move}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      <div class="hand-head">
        <span class="pixel small">YOUR HAND ({hand.length})</span>
        <span class="dim">Uncovered riders coast and recover.</span>
      </div>
      <div class="hand">
        {hand.map((c) => (
          <CardView key={c.id} card={c} selected={used.has(c.id)} onClick={locked ? undefined : () => choose(c)} />
        ))}
      </div>
      {locked ? (
        <div class="stack">
          <p class="ok pixel center">LOCKED IN</p>
          <button class="big pixel" onClick={() => act({ type: 'unlock' })}>
            CHANGE PLAN
          </button>
        </div>
      ) : (
        <button
          class="big primary pixel"
          onClick={() => act({ type: 'play', plays: Object.fromEntries(mine.map((r) => [r.id, assign[r.id] ?? null])) })}
        >
          LOCK IN{coasting > 0 ? ` (${coasting} COAST)` : ''}
        </button>
      )}
      <Contract view={view} />
    </section>
  );
}

function Contract({ view }: { view: View }) {
  const c = view.me!.contract;
  return (
    <div class="contract frame">
      <div class="pixel small">SECRET SPONSOR CONTRACT</div>
      <b>{CONTRACTS[c].label}</b>
      <div class="dim">{CONTRACTS[c].blurb} Worth +5 points.</div>
    </div>
  );
}

// ---- Resolve ------------------------------------------------------------------

function Resolve({ view }: { view: View }) {
  const { state, teamId } = view;
  const rep = state.report;
  const mine = state.riders.filter((r) => r.teamId === teamId);
  return (
    <section class="stack">
      <p class="center pixel">EYES ON THE TV</p>
      {rep &&
        mine.map((r) => {
          const m = rep.moves.find((x) => x.riderId === r.id);
          if (!m) return null;
          const p = m.parts;
          const bits = [
            m.coasted ? 'coasted' : `card ${m.cardValue}`,
            p.type ? `type ${p.type > 0 ? '+' : ''}${p.type}` : '',
            p.quirk ? `quirk ${p.quirk > 0 ? '+' : ''}${p.quirk}` : '',
            p.event ? `event ${p.event > 0 ? '+' : ''}${p.event}` : '',
            p.draft ? 'draft +1' : '',
            p.chase ? `chase +${p.chase}` : '',
            m.windPaid ? 'led into the wind: +1 tired' : '',
          ].filter(Boolean);
          return (
            <div class="frame result" key={r.id}>
              <div class="r-top">
                <b>{r.name}</b>
                <span class="pixel">+{m.to - m.from}</span>
              </div>
              <div class="dim">{bits.join(' · ')}</div>
            </div>
          );
        })}
    </section>
  );
}

// ---- Trade --------------------------------------------------------------------

const SPECS: CardSpec[] = [
  { kind: 'energy', value: 1 },
  { kind: 'energy', value: 2 },
  { kind: 'energy', value: 3 },
  { kind: 'energy', value: 4 },
  { kind: 'energy', value: 5 },
  { kind: 'gel', value: 4 },
  { kind: 'attack', value: 6 },
];

function OfferLine({ o, state, mine, onAccept, onDecline, onWithdraw, hand }: {
  o: OfferView;
  state: PublicState;
  mine: boolean;
  hand: Card[];
  onAccept?: () => void;
  onDecline?: () => void;
  onWithdraw?: () => void;
}) {
  const other = state.teams.find((t) => t.id === (mine ? o.to : o.from))!;
  const can = !mine && !!matchSpecs(hand, o.want);
  return (
    <div class="frame offer">
      <div class="pixel small">{mine ? `YOU OFFER ${other.name.toUpperCase()}` : `${other.name.toUpperCase()} OFFERS`}</div>
      <div class="offer-cards">
        {o.giveCards.length ? o.giveCards.map((c) => <CardView key={c.id} card={c} small />) : <span class="dim">nothing</span>}
        <span class="arrow pixel">{'>'}</span>
        {o.want.length ? o.want.map((c, i) => <CardView key={i} card={c} small />) : <span class="dim">a favour</span>}
      </div>
      {mine ? (
        <button class="pixel small-btn" onClick={onWithdraw}>
          WITHDRAW
        </button>
      ) : (
        <div class="row2">
          <button class="pixel small-btn primary" disabled={!can} onClick={onAccept}>
            {can ? 'ACCEPT' : 'CANNOT'}
          </button>
          <button class="pixel small-btn" onClick={onDecline}>
            DECLINE
          </button>
        </div>
      )}
    </div>
  );
}

function Trade({ view, act }: { view: View; act: (a: PlayerAction) => void }) {
  const { state, me, teamId } = view;
  const team = state.teams.find((t) => t.id === teamId)!;
  const others = state.teams.filter((t) => t.id !== teamId);
  const [to, setTo] = useState<string | null>(others[0]?.id ?? null);
  const [give, setGive] = useState<string[]>([]);
  const [want, setWant] = useState<CardSpec[]>([]);
  useEffect(() => {
    setGive([]);
    setWant([]);
  }, [state.round]);
  const hand = me!.hand;
  const toggle = (id: string) =>
    setGive((g) => (g.includes(id) ? g.filter((x) => x !== id) : g.length < 3 ? [...g, id] : g));
  const addWant = (s: CardSpec) => setWant((w) => (w.length < 3 ? [...w, s] : w));
  const canSend = to && (give.length > 0 || want.length > 0);
  const humanTargets = useMemo(() => others, [state.teams.length]);

  return (
    <section class="stack">
      <p class="dim">Cut a deal. Cards you hand over are gone from your hand; you draw back up to 6 next round.</p>
      {me!.offersIn.map((o) => (
        <OfferLine
          key={o.id}
          o={o}
          state={state}
          mine={false}
          hand={hand}
          onAccept={() => act({ type: 'respond', offerId: o.id, accept: true })}
          onDecline={() => act({ type: 'respond', offerId: o.id, accept: false })}
        />
      ))}
      {me!.offerOut && (
        <OfferLine o={me!.offerOut} state={state} mine hand={hand} onWithdraw={() => act({ type: 'withdraw' })} />
      )}

      <div class="pixel small">YOUR HAND</div>
      <div class="hand">
        {hand.map((c) => (
          <CardView key={c.id} card={c} selected={give.includes(c.id)} onClick={() => toggle(c.id)} />
        ))}
      </div>

      <div class="frame make">
        <div class="pixel small">MAKE AN OFFER</div>
        <div class="chips">
          {humanTargets.map((t) => (
            <button
              key={t.id}
              class={`pill ${to === t.id ? 'on' : ''}`}
              style={{ '--c': TEAM_COLORS[t.color % TEAM_COLORS.length].hex } as Record<string, string>}
              onClick={() => setTo(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>
        <div class="dim">You give: tap cards in your hand above ({give.length}/3).</div>
        <div class="dim">You ask for:</div>
        <div class="chips">
          {SPECS.map((s, i) => (
            <CardView key={i} card={s} small onClick={() => addWant(s)} />
          ))}
        </div>
        <div class="want-row">
          {want.length === 0 && <span class="dim">nothing yet</span>}
          {want.map((w, i) => (
            <CardView key={i} card={w} small selected onClick={() => setWant(want.filter((_, j) => j !== i))} />
          ))}
        </div>
        <button
          class="big primary pixel"
          disabled={!canSend}
          onClick={() => {
            act({ type: 'offer', to: to!, give, want });
            setGive([]);
            setWant([]);
          }}
        >
          SEND OFFER
        </button>
      </div>

      <button class={`big pixel ${team.ready ? '' : 'primary'}`} disabled={team.ready} onClick={() => act({ type: 'tradeReady' })}>
        {team.ready ? 'READY. WAITING...' : 'READY FOR NEXT ROUND'}
      </button>
    </section>
  );
}

// ---- Finished -----------------------------------------------------------------

function Finished({
  view,
  president,
  isPresident,
}: {
  view: View;
  president: (w: 'start' | 'addBot' | 'rematch' | 'removeBot') => void;
  isPresident: boolean;
}) {
  const { state, teamId } = view;
  const res = state.results!;
  const mineT = res.teams.find((t) => t.teamId === teamId)!;
  const place = [...res.teams].sort((a, b) => b.total - a.total).findIndex((t) => t.teamId === teamId) + 1;
  const awards = res.awards.filter((a) => a.teamId === teamId);
  return (
    <section class="stack">
      <div class="frame center big-result">
        <div class="pixel small">YOU FINISHED</div>
        <div class="pixel place">{ordinal(place)}</div>
        <div>{mineT.total} points</div>
      </div>
      <div class={`frame contract ${mineT.contractMet ? 'met' : ''}`}>
        <div class="pixel small">YOUR CONTRACT</div>
        <b>{CONTRACTS[mineT.contract].label}</b>
        <div class="dim">{CONTRACTS[mineT.contract].blurb}</div>
        <div class={mineT.contractMet ? 'ok' : 'dim'}>{mineT.contractMet ? 'Completed: +5 points' : 'Missed this time'}</div>
      </div>
      {awards.map((a) => (
        <div class="frame" key={a.title}>
          <div class="pixel small">{a.title.toUpperCase()}</div>
          <div class="dim">{a.blurb}</div>
        </div>
      ))}
      {isPresident ? (
        <button class="big primary pixel" onClick={() => president('rematch')}>
          RACE AGAIN
        </button>
      ) : (
        <p class="dim center">The president can start a rematch.</p>
      )}
    </section>
  );
}

render(<App />, document.getElementById('app')!);
