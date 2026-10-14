import { createContext, render } from 'preact';
import { createPortal } from 'preact/compat';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import '../common/theme.css';
import './play.css';
import {
  CARD_DEFS,
  CARD_DEF_LIST,
  EFFORTS,
  EVENTS,
  KIND_COLORS,
  KIND_LABELS,
  QUIRKS,
  RIDER_TYPES,
  STAT_HELP,
  STAT_LABELS,
  TEAM_COLORS,
  TERRAINS,
} from '../../shared/content';
import {
  allesCost,
  baseParts,
  effectiveStats,
  maxEnergyFor,
  perksOf,
  resolveEffort,
  sumParts,
  teamDefIds,
  terrainAt,
} from '../../shared/engine';
import type { PlayerAction, PresidentAction, RoomInfo, ServerMsg } from '../../shared/protocol';
import { phoneHint } from '../../shared/tutorial';
import type { Hint, HintContext } from '../../shared/tutorial';
import { BLIND_COST, SLOT_LIMITS, STAGES, TRAININGS_PER_RIDER } from '../../shared/types';
import type { Card, Effort, OfferView, PlayerView, PublicState, Rider, SlotKind, Stat } from '../../shared/types';
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
const STATS: Stat[] = ['kracht', 'klim', 'sprint', 'uithouding'];

const load = (): Saved | null => {
  // ?room=CODE&token=T[&name=N] hervat direct een stoel (demo's en tests).
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
    // privémodus: de sessie overleeft een herlaad dan niet
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

const ordinal = (n: number) => `${n}e`;
const firstName = (n: string) => n.split(' ')[0];
const slotOf = (def: string): SlotKind | null => {
  const k = CARD_DEFS[def]?.kind;
  return k === 'sponsor' || k === 'staff' || k === 'material' || k === 'car' ? k : null;
};
const SLOT_LABEL: Record<SlotKind, string> = { sponsor: 'Sponsors', staff: 'Staf', material: 'Materiaal', car: 'Wagen' };

// ---- Kleine onderdelen -------------------------------------------------------

const HINT_KEY = 'pp-hints-seen';
function seenHints(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(HINT_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function markSeen(id: string) {
  try {
    const s = seenHints();
    s.add(id);
    sessionStorage.setItem(HINT_KEY, JSON.stringify([...s]));
  } catch {
    // zonder opslag toont de uitleg gewoon opnieuw
  }
}

/** Bottom sheet: de plek voor alles wat het hoofdscherm niet altijd nodig heeft. */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: preact.ComponentChildren }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div class="sheet-wrap" onClick={onClose}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div class="sheet-grip" />
        <div class="sheet-head">
          <b class="sheet-title">{title}</b>
          <button class="x" onClick={onClose} aria-label="Sluiten">
            ✕
          </button>
        </div>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/** Waar de "?"-knop van de uitleg in de kopbalk terechtkomt. */
const HintSlot = createContext<HTMLElement | null>(null);

/** Uitleg bij de huidige fase (alleen met tutorial aan): een sheet, terug te halen met "?" in de kopbalk. */
function TutorialHint({ hint }: { hint: Hint | null }) {
  const slot = useContext(HintSlot);
  const id = hint?.id;
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(id ? !seenHints().has(id) : false), [id]);
  if (!hint) return null;
  const close = () => {
    markSeen(hint.id);
    setOpen(false);
  };
  return (
    <>
      {slot &&
        createPortal(
          <button class="hint-btn" onClick={() => setOpen(true)} aria-label={`Uitleg: ${hint.title}`}>
            ?
          </button>,
          slot,
        )}
      {open && (
        <Sheet title={hint.title} onClose={close}>
          <div class="hint">
            <ol>
              {hint.steps.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ol>
          </div>
          <button class="big primary ty" onClick={close}>
            BEGREPEN
          </button>
        </Sheet>
      )}
    </>
  );
}

function hintFor(view: { state: PublicState; me: PlayerView | null; teamId: string; presidentTeamId: string | null }, extra: Partial<HintContext>): Hint | null {
  const team = view.state.teams.find((t) => t.id === view.teamId);
  return phoneHint(view.state, {
    myTurn: !!view.me?.pickPending,
    tab: 'kaarten',
    handCount: view.me?.hand.length ?? 0,
    ready: !!team?.ready,
    locked: !!team?.locked,
    isPresident: view.presidentTeamId === view.teamId,
    coins: team?.coins ?? 0,
    ...extra,
  });
}

function CardRow({
  def,
  price,
  children,
  dim,
}: {
  def: string;
  price?: boolean;
  children?: preact.ComponentChildren;
  dim?: boolean;
}) {
  const d = CARD_DEFS[def];
  if (!d) return null;
  return (
    <div class={`pcard ${dim ? 'dim' : ''}`} style={{ '--k': KIND_COLORS[d.kind] } as Record<string, string>}>
      <div class="pc-top">
        <span class="pc-kind ty">{KIND_LABELS[d.kind]}</span>
        {price && <span class="pc-price ty">€ {d.price}</span>}
      </div>
      <div class="pc-name">{d.name}</div>
      <div class="pc-text">{d.text}</div>
      {children && <div class="pc-actions">{children}</div>}
    </div>
  );
}

function Bars({ rider, tolerance }: { rider: Rider; tolerance: number }) {
  const eff = effectiveStats(rider, tolerance);
  return (
    <div class="sbars">
      {STATS.map((k) => {
        const lost = Math.max(0, rider.base[k] + rider.form[k] - eff[k]);
        return (
          <div class="sb" key={k} title={STAT_HELP[k]}>
            <span class="sl">{STAT_LABELS[k]}</span>
            <span class="track">
              <span class="seg base" style={{ width: `${(Math.min(rider.base[k], eff[k]) / 10) * 100}%` }} />
              <span class="seg form" style={{ width: `${(Math.max(0, eff[k] - rider.base[k]) / 10) * 100}%` }} />
              {lost > 0 && <span class="seg lost" style={{ width: `${(lost / 10) * 100}%` }} />}
            </span>
            <span class="sv ty">{eff[k]}</span>
          </div>
        );
      })}
    </div>
  );
}

function Pips({ value, limit }: { value: number; limit: number }) {
  return (
    <span class="pips" title="Vermoeidheid">
      {Array.from({ length: 6 }, (_, i) => (
        <i key={i} class={i < value ? (i >= limit ? 'on over' : 'on') : ''} />
      ))}
    </span>
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
  const president = (what: PresidentAction) => sock.current?.send({ t: 'president', what });
  const join = (code: string, name: string) => {
    const next = { code: code.toUpperCase(), token: '', name };
    setSaved(next);
    savedRef.current = next;
    setFatal(null);
    sock.current?.send({ t: 'player:join', code: next.code, name });
  };

  if (!view) return <JoinScreen online={online} fatal={fatal ?? error} onJoin={join} connecting={!!saved && online} />;
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

// ---- Meedoen ------------------------------------------------------------------

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
      <h1 class="ty">PELOTON PANIC</h1>
      <p class="dim">Doe mee met de race met de kamercode van de tv.</p>
      <label>
        <span>Kamercode</span>
        <input
          class="code"
          value={code}
          maxLength={4}
          autocapitalize="characters"
          autocomplete="off"
          onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z]/g, ''))}
          placeholder="ABCD"
        />
      </label>
      <label>
        <span>Jouw naam</span>
        <input
          value={name}
          maxLength={16}
          autocomplete="off"
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          placeholder="Teammanager"
        />
      </label>
      <button class="big primary ty" disabled={!ready} onClick={() => onJoin(code, name.trim())}>
        {connecting ? 'MEEDOEN...' : 'MEEDOEN'}
      </button>
      {!online && <p class="bad">Verbinden met de server...</p>}
      {fatal && <p class="bad">{fatal}</p>}
    </div>
  );
}

// ---- Schil --------------------------------------------------------------------

interface ViewProps {
  view: View;
  act: (a: PlayerAction) => void;
}

interface GameProps extends ViewProps {
  president: (w: PresidentAction) => void;
}

function Game({
  view,
  act,
  president,
  error,
  online,
  clock,
  leave,
}: GameProps & { error: string | null; online: boolean; clock: () => number; leave: () => void }) {
  useNow(500);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const { state, me, teamId } = view;
  const team = state.teams.find((t) => t.id === teamId);
  const col = TEAM_COLORS[(team?.color ?? 0) % TEAM_COLORS.length];
  const left = view.phaseEndsAt ? Math.max(0, Math.ceil((view.phaseEndsAt - clock()) / 1000)) : null;

  if (!team || !me) {
    return (
      <div class="join">
        <p>Je doet niet meer mee aan deze race.</p>
        <button class="big ty" onClick={leave}>
          OPNIEUW BEGINNEN
        </button>
      </div>
    );
  }

  const title: Record<string, string> = {
    lobby: 'Lobby',
    draft: 'Draft',
    team: 'Voorbereiding',
    race: `Ronde ${state.round}`,
    resolve: 'Kijk naar de tv',
    results: 'Uitslag',
    finished: 'Eindstand',
  };
  const stageTag = state.phase === 'lobby' || state.phase === 'finished' ? '' : `E${state.stage}/${STAGES} · `;

  return (
    <div class="game" style={{ '--team': col.hex } as Record<string, string>}>
      <header class="bar">
        <span class="chip" style={{ background: col.hex }} />
        <b class="who">{team.name}</b>
        <span class="coins ty">€ {team.coins}</span>
        <span class="ph">
          {stageTag}
          {title[state.phase]}
        </span>
        <span class="tm ty">{left !== null && state.phase !== 'resolve' ? `${left}s` : ''}</span>
        <span class="hint-slot" ref={setSlot} />
      </header>
      {!online && <div class="offline">Opnieuw verbinden...</div>}
      {error && <div class="err">{error}</div>}
      <HintSlot.Provider value={slot}>
        <main key={state.phase}>
          {state.phase === 'lobby' && <Lobby view={view} act={act} president={president} />}
          {state.phase === 'draft' && <Draft view={view} act={act} />}
          {state.phase === 'team' && <TeamPhase view={view} act={act} />}
          {state.phase === 'race' && <Race view={view} act={act} />}
          {state.phase === 'resolve' && <Resolve view={view} />}
          {state.phase === 'results' && <Results view={view} president={president} />}
          {state.phase === 'finished' && <Finished view={view} president={president} />}
        </main>
      </HintSlot.Provider>
    </div>
  );
}

/** Kaart als compacte tegel of rij; de details en acties staan in een sheet. */
function CardTile({ def, price, dim, onClick }: { def: string; price?: boolean; dim?: boolean; onClick: () => void }) {
  const d = CARD_DEFS[def];
  if (!d) return null;
  return (
    <button class={`ctile ${dim ? 'dim' : ''}`} style={{ '--k': KIND_COLORS[d.kind] } as Record<string, string>} onClick={onClick}>
      <span class="ct-main">
        <span class="ct-kind ty">{KIND_LABELS[d.kind]}</span>
        <span class="ct-name">{d.name}</span>
      </span>
      {price && <span class="ct-price ty">€ {d.price}</span>}
    </button>
  );
}

/** Rijtje strip-knoppen onder de kopbalk: klein label + waarde, opent een sheet. */
function StripBtn({ label, value, onClick, tone, disabled }: { label: string; value: string; onClick: () => void; tone?: string; disabled?: boolean }) {
  return (
    <button class={`strip-btn ${tone ?? ''}`} onClick={onClick} disabled={disabled}>
      <span class="small">{label}</span>
      <b>{value}</b>
    </button>
  );
}

function RiderSheet({ rider, state, onClose, race, perks, bidon }: {
  rider: Rider;
  state: PublicState;
  onClose: () => void;
  race?: boolean;
  perks: ReturnType<typeof perksOf>;
  bidon: boolean;
}) {
  const t = RIDER_TYPES[rider.type];
  const q = QUIRKS[rider.quirk];
  const terrain = terrainAt(state, rider.pos);
  const limit = 2 + perks.overtrainTolerance;
  const over = rider.fatigue > limit;
  return (
    <Sheet title={rider.name} onClose={onClose}>
      <div class="stack tight">
        <div>
          <div class="small">{t.label}</div>
          <div>{t.blurb}</div>
        </div>
        <div>
          <div class="small">{q.label}</div>
          <div>{q.blurb}</div>
        </div>
        {race && (
          <div>
            <div class="small">Nu</div>
            <div>
              {TERRAINS[terrain].label}, nog {state.trackLength - Math.floor(rider.pos)} tegels te gaan. Energie {rider.energy}/{rider.maxEnergy}.
              {rider.energy <= 0 && ' Op de fles: je kunt alleen Rustig rijden.'}
              {state.event?.targetRiderId === rider.id && ' Doelwit van de gebeurtenis.'}
            </div>
            <p class="dim s mt">De tegels bij een tempo zijn een schatting: drafting, wind en geluk komen er nog bij.</p>
          </div>
        )}
        {!race && (
          <div>
            <div class="small">Start met</div>
            <div>{maxEnergyFor(rider, perks, bidon)} energie</div>
          </div>
        )}
        {over && <div class="warn-s">Overtraind: alle eigenschappen {rider.fatigue - limit} lager. Neem een rustdag!</div>}
      </div>
    </Sheet>
  );
}

// ---- Lobby --------------------------------------------------------------------

function Lobby({ view, act, president }: GameProps) {
  const { state, teamId } = view;
  const isPresident = view.presidentTeamId === teamId;
  const mine = state.riders.filter((r) => r.teamId === teamId);
  const [names, setNames] = useState(mine.map((r) => r.name));
  const [info, setInfo] = useState<number | null>(null);
  const hasBot = state.teams.some((t) => t.isBot);
  const enough = state.teams.length >= 2;
  const r = info !== null ? mine[info] : null;
  return (
    <section class="screen">
      <TutorialHint hint={hintFor(view, {})} />
      <p class="dim">Geef je drie renners een naam, of houd de willekeurige namen.</p>
      <div class="grow stack">
        {mine.map((rd, i) => (
          <div class="rider-edit frame" key={rd.id}>
            <div class="re-head">
              <span class="small">{RIDER_TYPES[rd.type].label}</span>
              <button class="info" onClick={() => setInfo(i)} aria-label={`Over ${names[i] || rd.name}`}>
                i
              </button>
            </div>
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
          </div>
        ))}
      </div>
      <div class="dock">
        {isPresident ? (
          <>
            <label class="toggle frame">
              <input
                type="checkbox"
                checked={state.tutorial}
                onChange={(e) => president((e.target as HTMLInputElement).checked ? 'tutorialOn' : 'tutorialOff')}
              />
              <span>
                <b>Tutorial-modus</b>
                <span class="dim s"> · uitleg onderweg</span>
              </span>
            </label>
            <div class="bots">
              <button class="small-btn" onClick={() => president('removeBot')} disabled={!hasBot}>
                − Bot
              </button>
              <span class="small">{state.teams.length} teams</span>
              <button class="small-btn" onClick={() => president('addBot')} disabled={state.teams.length >= 6}>
                + Bot
              </button>
            </div>
            <button class="big primary ty" disabled={!enough} onClick={() => president('start')}>
              {enough ? 'START HET SEIZOEN' : 'VOEG EEN BOT TOE'}
            </button>
          </>
        ) : (
          <p class="dim center">
            {state.teams.length} team(s) in het peloton. Wachten tot de president het seizoen start.
          </p>
        )}
      </div>
      {r && (
        <Sheet title={names[info!] || r.name} onClose={() => setInfo(null)}>
          <div class="stack tight">
            <div>
              <div class="small">{RIDER_TYPES[r.type].label}</div>
              <div>{RIDER_TYPES[r.type].blurb}</div>
            </div>
            <div>
              <div class="small">{QUIRKS[r.quirk].label}</div>
              <div>{QUIRKS[r.quirk].blurb}</div>
            </div>
          </div>
        </Sheet>
      )}
    </section>
  );
}

// ---- Draft --------------------------------------------------------------------

function Draft({ view, act }: ViewProps) {
  const { state, me } = view;
  const d = state.draft!;
  const mine = !!me?.pickPending;
  const current = d.currentTeamId ? state.teams.find((t) => t.id === d.currentTeamId) : null;
  const picksLeft = d.order.slice(d.idx).filter((id) => id === view.teamId).length;
  const [pick, setPick] = useState<number | null>(null);
  const [hand, setHand] = useState(false);
  const cards = me?.hand ?? [];
  const def = pick !== null ? state.market[pick] : undefined;
  return (
    <section class="screen">
      <TutorialHint hint={hintFor(view, { myTurn: mine })} />
      <div class={`turn frame ${mine ? 'mine' : ''}`}>
        {mine ? (
          <>
            <div class="ty">JIJ BENT AAN DE BEURT</div>
            <p>Tik op een kaart om hem te pakken, of trek van de stapel.</p>
          </>
        ) : (
          <>
            <div class="ty">{current ? `${current.name} KIEST` : 'DRAFT KLAAR'}</div>
            <p class="dim">Jij hebt nog {picksLeft} keuze{picksLeft === 1 ? '' : 's'}.</p>
          </>
        )}
      </div>
      <div class="small">De markt · {state.deckCount} kaarten op de stapel</div>
      <div class="list grow">
        {state.market.map((m, i) => (
          <CardTile key={i} def={m} onClick={() => setPick(i)} />
        ))}
      </div>
      <div class="dock">
        {mine && (
          <div class="row2">
            <button class="big" onClick={() => act({ type: 'draftPick', source: { kind: 'deck' } })}>
              Van de stapel
            </button>
            <button class="big" onClick={() => act({ type: 'draftSkip' })}>
              Overslaan
            </button>
          </div>
        )}
        <button class="big" disabled={cards.length === 0} onClick={() => setHand(true)}>
          Jouw kaarten ({cards.length})
        </button>
      </div>
      {def && (
        <Sheet title="Kaart uit de markt" onClose={() => setPick(null)}>
          <CardRow def={def}>
            {mine && (
              <button
                class="small-btn primary"
                onClick={() => {
                  act({ type: 'draftPick', source: { kind: 'market', index: pick! } });
                  setPick(null);
                }}
              >
                Pak deze
              </button>
            )}
          </CardRow>
        </Sheet>
      )}
      {hand && (
        <Sheet title={`Jouw kaarten (${cards.length})`} onClose={() => setHand(false)}>
          <div class="chips">
            {cards.map((c) => (
              <span class="asset" key={c.id} style={{ '--k': KIND_COLORS[CARD_DEFS[c.def].kind] } as Record<string, string>}>
                {CARD_DEFS[c.def].name}
              </span>
            ))}
          </div>
        </Sheet>
      )}
    </section>
  );
}

// ---- Voorbereiding ------------------------------------------------------------

type Tab = 'team' | 'kaarten' | 'winkel' | 'ruilen';

function TeamPhase({ view, act }: ViewProps) {
  const { state, me, teamId } = view;
  const team = state.teams.find((t) => t.id === teamId)!;
  const initial = new URLSearchParams(location.search).get('tab');
  const [tab, setTab] = useState<Tab>(initial === 'team' || initial === 'winkel' || initial === 'ruilen' ? initial : 'kaarten');
  const readyCount = state.teams.filter((t) => t.ready).length;
  const incoming = me!.offersIn.length;
  return (
    <section class="screen">
      <div class="tabs">
        {(['kaarten', 'team', 'winkel', 'ruilen'] as Tab[]).map((t) => (
          <button key={t} class={`tab ty ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            {t.toUpperCase()}
            {t === 'kaarten' && me!.hand.length > 0 && <span class="badge">{me!.hand.length}</span>}
            {t === 'ruilen' && incoming > 0 && <span class="badge hot">{incoming}</span>}
          </button>
        ))}
      </div>
      <TutorialHint hint={hintFor(view, { tab })} />
      {me!.sabotageOn.length > 0 && <div class="warn-s">⚠ Iemand heeft iets slechts in de zin met jouw team.</div>}
      <div class="tabbody">
        {tab === 'kaarten' && <HandTab view={view} act={act} />}
        {tab === 'team' && <BoardTab view={view} />}
        {tab === 'winkel' && <ShopTab view={view} act={act} />}
        {tab === 'ruilen' && <TradeTab view={view} act={act} />}
      </div>
      <div class="dock">
        <button class={`big ty ${team.ready ? '' : 'primary'}`} onClick={() => act(team.ready ? { type: 'unready' } : { type: 'ready' })}>
          {team.ready ? `KLAAR (${readyCount}/${state.teams.length}) · WIJZIG` : `KLAAR VOOR DE RACE (${readyCount}/${state.teams.length})`}
        </button>
      </div>
    </section>
  );
}

function BoardTab({ view }: { view: View }) {
  const { state, teamId } = view;
  const team = state.teams.find((t) => t.id === teamId)!;
  const riders = state.riders.filter((r) => r.teamId === teamId);
  const perks = perksOf(teamDefIds(team.slots));
  const bidon = view.me!.sabotageOn.includes('bidon');
  const [rid, setRid] = useState<string | null>(null);
  const [gear, setGear] = useState(false);
  const picked = riders.find((r) => r.id === rid);
  const total = (Object.keys(SLOT_LIMITS) as SlotKind[]).reduce((n, k) => n + SLOT_LIMITS[k], 0);
  const filled = (Object.keys(SLOT_LIMITS) as SlotKind[]).reduce((n, k) => n + team.slots[k].length, 0);
  return (
    <div class="stack">
      {riders.map((r) => {
        const limit = 2 + perks.overtrainTolerance;
        const over = r.fatigue > limit;
        return (
          <button class="frame rbox" key={r.id} onClick={() => setRid(r.id)}>
            <div class="r-top">
              <b>{r.name}</b>
              <span class="dim">{RIDER_TYPES[r.type].label}</span>
            </div>
            <Bars rider={r} tolerance={perks.overtrainTolerance} />
            <div class="r-meta">
              <span>
                Vermoeid <Pips value={r.fatigue} limit={limit} />
                {over && <span class="warn-s"> overtraind</span>}
              </span>
              <span class="dim">Training {r.trained}/{TRAININGS_PER_RIDER}</span>
            </div>
          </button>
        );
      })}
      <button class="big" onClick={() => setGear(true)}>
        Jouw spullen ({filled}/{total})
      </button>
      {picked && <RiderSheet rider={picked} state={state} perks={perks} bidon={bidon} onClose={() => setRid(null)} />}
      {gear && (
        <Sheet title="Jouw spullen" onClose={() => setGear(false)}>
          {(Object.keys(SLOT_LIMITS) as SlotKind[]).map((k) => (
            <div class="slotrow" key={k}>
              <span class="sk">{SLOT_LABEL[k]}</span>
              <span class="sv2">
                {Array.from({ length: SLOT_LIMITS[k] }, (_, i) => {
                  const def = team.slots[k][i];
                  return def ? (
                    <span class="asset" key={i} style={{ '--k': KIND_COLORS[CARD_DEFS[def].kind] } as Record<string, string>}>
                      {CARD_DEFS[def].name}
                    </span>
                  ) : (
                    <span class="asset empty" key={i}>
                      leeg
                    </span>
                  );
                })}
              </span>
            </div>
          ))}
        </Sheet>
      )}
    </div>
  );
}

function HandTab({ view, act }: ViewProps) {
  const { state, me, teamId } = view;
  const team = state.teams.find((t) => t.id === teamId)!;
  const riders = state.riders.filter((r) => r.teamId === teamId);
  const others = state.teams.filter((t) => t.id !== teamId);
  const [replacing, setReplacing] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const hand = me!.hand;
  if (hand.length === 0)
    return <div class="frame center dim">Je hebt geen kaarten. Haal er in de winkel of via ruilen een paar.</div>;
  const c = hand.find((x) => x.id === sel);
  const close = () => {
    setSel(null);
    setReplacing(false);
  };
  const d = c ? CARD_DEFS[c.def] : null;
  const slot = c ? slotOf(c.def) : null;
  const full = slot ? team.slots[slot].length >= SLOT_LIMITS[slot] : false;
  return (
    <>
      <div class="tiles">
        {hand.map((x) => (
          <CardTile key={x.id} def={x.def} onClick={() => setSel(x.id)} />
        ))}
      </div>
      {c && d && (
        <Sheet title="Jouw kaart" onClose={close}>
          <CardRow def={c.def}>
            {d.kind === 'training' && (
              <div class="chips">
                {riders.map((r) => {
                  const rest = (d.fatigue ?? 0) < 0;
                  const blocked = !rest && r.trained >= TRAININGS_PER_RIDER;
                  return (
                    <button
                      key={r.id}
                      class="small-btn"
                      disabled={blocked}
                      onClick={() => {
                        act({ type: 'train', cardId: c.id, riderId: r.id });
                        close();
                      }}
                    >
                      {firstName(r.name)}
                    </button>
                  );
                })}
              </div>
            )}
            {slot && !full && (
              <button
                class="small-btn primary"
                onClick={() => {
                  act({ type: 'install', cardId: c.id });
                  close();
                }}
              >
                Op je bord leggen
              </button>
            )}
            {slot && full && !replacing && (
              <button class="small-btn" onClick={() => setReplacing(true)}>
                Vak vol: vervangen...
              </button>
            )}
            {slot && full && replacing && (
              <div class="chips">
                {team.slots[slot].map((def, i) => (
                  <button
                    key={i}
                    class="small-btn"
                    onClick={() => {
                      act({ type: 'install', cardId: c.id, replaceDef: def });
                      close();
                    }}
                  >
                    Vervang {CARD_DEFS[def].name}
                  </button>
                ))}
              </div>
            )}
            {d.kind === 'sabotage' && (
              <div class="chips">
                {others.map((t) => (
                  <button
                    key={t.id}
                    class="small-btn"
                    onClick={() => {
                      act({ type: 'sabotage', cardId: c.id, targetTeamId: t.id });
                      close();
                    }}
                  >
                    Tegen {t.name}
                  </button>
                ))}
              </div>
            )}
          </CardRow>
        </Sheet>
      )}
    </>
  );
}

function ShopTab({ view, act }: ViewProps) {
  const { state, teamId } = view;
  const team = state.teams.find((t) => t.id === teamId)!;
  const [pick, setPick] = useState<number | null>(null);
  const def = pick !== null ? state.market[pick] : undefined;
  return (
    <div class="stack">
      <div class="shop-top">
        <span class="small">Je hebt € {team.coins}</span>
        <button class="small-btn" disabled={team.coins < BLIND_COST} onClick={() => act({ type: 'buy', source: { kind: 'deck' } })}>
          Blind trekken (€ {BLIND_COST})
        </button>
      </div>
      <div class="list">
        {state.market.map((m, i) => (
          <CardTile key={i} def={m} price dim={team.coins < CARD_DEFS[m].price} onClick={() => setPick(i)} />
        ))}
      </div>
      {def && (
        <Sheet title="Winkel" onClose={() => setPick(null)}>
          <CardRow def={def} price>
            <button
              class="small-btn primary"
              disabled={team.coins < CARD_DEFS[def].price}
              onClick={() => {
                act({ type: 'buy', source: { kind: 'market', index: pick! } });
                setPick(null);
              }}
            >
              Koop voor € {CARD_DEFS[def].price}
            </button>
          </CardRow>
        </Sheet>
      )}
    </div>
  );
}

function OfferBox({
  o,
  state,
  mine,
  hand,
  act,
}: {
  o: OfferView;
  state: PublicState;
  mine: boolean;
  hand: Card[];
  act: (a: PlayerAction) => void;
}) {
  const other = state.teams.find((t) => t.id === (mine ? o.to : o.from))!;
  const owned = new Map<string, number>();
  hand.forEach((c) => owned.set(c.def, (owned.get(c.def) ?? 0) + 1));
  const need = new Map<string, number>();
  o.want.forEach((d) => need.set(d, (need.get(d) ?? 0) + 1));
  const can = !mine && [...need].every(([d, n]) => (owned.get(d) ?? 0) >= n);
  const names = (list: string[]) => (list.length ? list.map((d) => CARD_DEFS[d].name).join(', ') : 'niets');
  return (
    <div class="stack tight">
      <div class="small">{mine ? `Jouw voorstel aan ${other.name}` : `Voorstel van ${other.name}`}</div>
      <p>
        {mine ? 'Jij geeft' : 'Zij geven'}: <b>{names(o.giveCards.map((c) => c.def))}</b>
        {o.giveCoins > 0 && <> + € {o.giveCoins}</>}
      </p>
      <p>
        {mine ? 'Jij vraagt' : 'Zij vragen'}: <b>{names(o.want)}</b>
        {o.wantCoins > 0 && <> + € {o.wantCoins}</>}
      </p>
      {mine ? (
        <button class="small-btn" onClick={() => act({ type: 'withdraw' })}>
          Intrekken
        </button>
      ) : (
        <div class="row2">
          <button class="small-btn primary" disabled={!can} onClick={() => act({ type: 'respond', offerId: o.id, accept: true })}>
            {can ? 'Accepteren' : 'Kan niet'}
          </button>
          <button class="small-btn" onClick={() => act({ type: 'respond', offerId: o.id, accept: false })}>
            Afwijzen
          </button>
        </div>
      )}
    </div>
  );
}

type TradeSheet = { k: 'in'; id: string } | { k: 'out' } | { k: 'make' };

function TradeTab({ view, act }: ViewProps) {
  const { state, me, teamId } = view;
  const team = state.teams.find((t) => t.id === teamId)!;
  const others = state.teams.filter((t) => t.id !== teamId);
  const [sheet, setSheet] = useState<TradeSheet | null>(null);
  const [to, setTo] = useState<string | null>(others[0]?.id ?? null);
  const [give, setGive] = useState<string[]>([]);
  const [giveCoins, setGiveCoins] = useState(0);
  const [want, setWant] = useState<string[]>([]);
  const [wantCoins, setWantCoins] = useState(0);
  const hand = me!.hand;
  const offersIn = me!.offersIn;
  const out = me!.offerOut;
  const close = () => setSheet(null);

  // Een voorstel dat binnenkomt terwijl er niets open staat, springt in beeld.
  const prevIn = useRef(offersIn.length);
  useEffect(() => {
    if (offersIn.length > prevIn.current) setSheet((s) => s ?? { k: 'in', id: offersIn[offersIn.length - 1].id });
    prevIn.current = offersIn.length;
  }, [offersIn.length]);

  const toggle = (id: string) => setGive((g) => (g.includes(id) ? g.filter((x) => x !== id) : g.length < 3 ? [...g, id] : g));
  const canSend = !!to && give.length + want.length + giveCoins + wantCoins > 0;
  const names = (list: string[]) => (list.length ? list.map((d) => CARD_DEFS[d].name).join(', ') : 'niets');
  const inSel = sheet?.k === 'in' ? offersIn.find((o) => o.id === sheet.id) : undefined;
  const nameOf = (id: string) => state.teams.find((t) => t.id === id)?.name ?? '?';

  return (
    <div class="stack">
      {offersIn.map((o) => (
        <button class="offer-row frame hot" key={o.id} onClick={() => setSheet({ k: 'in', id: o.id })}>
          <span class="small">Voorstel van {nameOf(o.from)}</span>
          <span class="or-text">
            Zij geven {names(o.giveCards.map((c) => c.def))}
            {o.giveCoins > 0 ? ` + € ${o.giveCoins}` : ''}
          </span>
        </button>
      ))}
      {out && (
        <button class="offer-row frame" onClick={() => setSheet({ k: 'out' })}>
          <span class="small">Jouw voorstel aan {nameOf(out.to)}</span>
          <span class="or-text">Wacht op antwoord</span>
        </button>
      )}
      {offersIn.length === 0 && !out && <div class="frame center dim">Nog geen voorstellen. Ruil kaarten of munten met een ander team.</div>}
      <button class="big primary ty" disabled={others.length === 0} onClick={() => setSheet({ k: 'make' })}>
        {out ? 'NIEUW VOORSTEL' : 'VOORSTEL MAKEN'}
      </button>

      {inSel && (
        <Sheet title="Voorstel" onClose={close}>
          <OfferBox o={inSel} state={state} mine={false} hand={hand} act={(a) => { act(a); close(); }} />
        </Sheet>
      )}
      {sheet?.k === 'out' && out && (
        <Sheet title="Jouw voorstel" onClose={close}>
          <OfferBox o={out} state={state} mine hand={hand} act={(a) => { act(a); close(); }} />
        </Sheet>
      )}
      {sheet?.k === 'make' && (
        <Sheet title="Maak een voorstel" onClose={close}>
          <div class="stack">
            <div class="chips">
              {others.map((t) => (
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
            <div>
              <div class="small sec">Jij geeft ({give.length}/3)</div>
              <div class="chips">
                {hand.length === 0 && <span class="dim">Je hebt geen kaarten</span>}
                {hand.map((c) => (
                  <button key={c.id} class={`pill small ${give.includes(c.id) ? 'on' : ''}`} onClick={() => toggle(c.id)}>
                    {CARD_DEFS[c.def].name}
                  </button>
                ))}
              </div>
              <Stepper label="Munten erbij" value={giveCoins} max={team.coins} onChange={setGiveCoins} />
            </div>
            <div>
              <div class="small sec">Jij vraagt ({want.length}/3)</div>
              <select
                class="pick"
                value=""
                disabled={want.length >= 3}
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value;
                  if (v) setWant((w) => (w.length < 3 ? [...w, v] : w));
                  (e.target as HTMLSelectElement).value = '';
                }}
              >
                <option value="">+ Kaart kiezen...</option>
                {CARD_DEF_LIST.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <div class="chips mt">
                {want.length === 0 && <span class="dim">nog niets gekozen</span>}
                {want.map((d, i) => (
                  <button key={i} class="pill small on" onClick={() => setWant(want.filter((_, j) => j !== i))}>
                    {CARD_DEFS[d].name} ✕
                  </button>
                ))}
              </div>
              <Stepper label="Munten vragen" value={wantCoins} max={20} onChange={setWantCoins} />
            </div>
            <button
              class="big primary ty"
              disabled={!canSend}
              onClick={() => {
                act({ type: 'offer', to: to!, give, giveCoins, want, wantCoins });
                setGive([]);
                setWant([]);
                setGiveCoins(0);
                setWantCoins(0);
                close();
              }}
            >
              VOORSTEL STUREN
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function Stepper({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (n: number) => void }) {
  return (
    <div class="stepper">
      <span>{label}</span>
      <button class="small-btn" disabled={value <= 0} onClick={() => onChange(value - 1)}>
        −
      </button>
      <b class="ty">€ {value}</b>
      <button class="small-btn" disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

// ---- Race ---------------------------------------------------------------------

function Race({ view, act }: ViewProps) {
  const { state, me, teamId } = view;
  const team = state.teams.find((t) => t.id === teamId)!;
  const riders = state.riders.filter((r) => r.teamId === teamId);
  const perks = perksOf(teamDefIds(team.slots));
  const [choice, setChoice] = useState<Record<string, Effort>>({});
  const [sheet, setSheet] = useState<'event' | string | null>(null);
  useEffect(() => setChoice({}), [state.round]);
  const locked = team.locked;
  const shown = locked ? me!.efforts : choice;
  const ev = state.event ? EVENTS[state.event.id] : null;
  const picked = riders.find((r) => r.id === sheet);

  return (
    <section class="screen">
      <TutorialHint hint={hintFor(view, { locked })} />
      {ev && (
        <div class="strip">
          <StripBtn label="Gebeurtenis" value={ev.title} tone={ev.silly ? 'silly' : ''} onClick={() => setSheet('event')} />
        </div>
      )}
      <div class="riders grow">
        {riders.map((r) => {
          const terrain = terrainAt(state, r.pos);
          const empty = r.energy <= 0;
          const sel = shown[r.id] ?? 'normaal';
          const pct = r.maxEnergy ? Math.round((r.energy / r.maxEnergy) * 100) : 0;
          return (
            <div class="frame rider" key={r.id}>
              <div class="r-top">
                <b class="r-name">{r.name}</b>
                <span class="dim r-sub">
                  {RIDER_TYPES[r.type].label} · {ordinal(1 + state.riders.filter((x) => x.pos > r.pos).length)}
                </span>
                <button class="info" aria-label={`Over ${r.name}`} onClick={() => setSheet(r.id)}>
                  i
                </button>
              </div>
              <div class="energy">
                <span class={`terr t-${terrain}`}>
                  {TERRAINS[terrain].icon} {TERRAINS[terrain].label}
                </span>
                <span class="ebar">
                  <span class={`fill ${pct <= 25 ? 'low' : pct <= 55 ? 'mid' : 'high'}`} style={{ width: `${pct}%` }} />
                </span>
                <span class={`el ${empty ? 'warn-s' : ''}`}>{empty ? 'Op de fles' : `${r.energy}/${r.maxEnergy}`}</span>
              </div>
              <div class="efforts">
                {(Object.keys(EFFORTS) as Effort[]).map((e) => {
                  const real = resolveEffort(r.energy, perks, e);
                  const mv = sumParts(baseParts(state, r, perks, real.effort, real.exhausted));
                  const disabled = locked || real.effort !== e;
                  const cost = e === 'alles' ? -allesCost(perks) : EFFORTS[e].energy;
                  return (
                    <button
                      key={e}
                      class={`eff ${sel === e ? 'on' : ''}`}
                      disabled={disabled}
                      onClick={() => setChoice({ ...choice, [r.id]: e })}
                    >
                      <span class="ty">{EFFORTS[e].label}</span>
                      <span class="mv">≈ +{mv}</span>
                      <span class="en">{cost > 0 ? `+${cost}` : cost} energie</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div class="dock">
        {locked ? (
          <>
            <p class="ok center ty">TEMPO VASTGELEGD</p>
            <button class="big ty" onClick={() => act({ type: 'unlock' })}>
              WIJZIG
            </button>
          </>
        ) : (
          <button
            class="big primary ty"
            onClick={() =>
              act({
                type: 'effort',
                efforts: Object.fromEntries(riders.map((r) => [r.id, choice[r.id] ?? (r.energy <= 0 ? 'rustig' : 'normaal')])),
              })
            }
          >
            BEVESTIGEN
          </button>
        )}
      </div>
      {sheet === 'event' && ev && (
        <Sheet title={ev.title} onClose={() => setSheet(null)}>
          <p>{ev.blurb}</p>
        </Sheet>
      )}
      {picked && (
        <RiderSheet
          rider={picked}
          state={state}
          race
          perks={perks}
          bidon={me!.sabotageOn.includes('bidon')}
          onClose={() => setSheet(null)}
        />
      )}
    </section>
  );
}

function Resolve({ view }: { view: View }) {
  const { state, teamId } = view;
  const rep = state.report;
  const mine = state.riders.filter((r) => r.teamId === teamId);
  return (
    <section class="screen">
      <TutorialHint hint={hintFor(view, {})} />
      <p class="center ty look">KIJK NAAR DE TV</p>
      <div class="stack grow">
        {rep &&
          mine.map((r) => {
            const m = rep.moves.find((x) => x.riderId === r.id);
            if (!m) return null;
            const p = m.parts;
            const fmt = (n: number) => `${n > 0 ? '+' : ''}${n}`;
            const bits = [
              EFFORTS[m.effort].label,
              p.stat ? `kracht ${fmt(p.stat)}` : '',
              p.terrain ? `uitrusting/terrein ${fmt(p.terrain)}` : '',
              p.quirk ? `eigenaardigheid ${fmt(p.quirk)}` : '',
              p.event ? `omstandigheden ${fmt(p.event)}` : '',
              p.draft ? 'drafting +1' : '',
              p.chase ? `peloton trekt terug +${p.chase}` : '',
              m.windPaid ? 'kopwerk: -1 energie' : '',
              m.pech ? `pech ${fmt(p.luck)}` : '',
              m.shielded ? 'reservefiets redt je' : '',
              m.boost ? 'meewind +1' : '',
              m.exhausted ? 'op de fles' : '',
              m.service ? 'volgauto: +3 energie' : '',
            ].filter(Boolean);
            return (
              <div class="frame result" key={r.id}>
                <div class="r-top">
                  <b>{r.name}</b>
                  <span class="ty acc">+{m.to - m.from}</span>
                </div>
                <div class="dim s">{bits.join(' · ')}</div>
                <div class="dim s">Energie nu: {m.energyAfter}</div>
              </div>
            );
          })}
      </div>
    </section>
  );
}

// ---- Uitslag ------------------------------------------------------------------

function Results({ view, president }: { view: View; president: (w: PresidentAction) => void }) {
  const { state, teamId } = view;
  const [sheet, setSheet] = useState<'reward' | 'sab' | null>(null);
  const res = state.stageResult!;
  const mine = res.teams.find((t) => t.teamId === teamId)!;
  const isPresident = view.presidentTeamId === teamId;
  const place = [...res.teams].sort((a, b) => b.stagePoints - a.stagePoints).findIndex((t) => t.teamId === teamId) + 1;
  const sab = res.sabotages.filter((x) => x.toTeamId === teamId || x.fromTeamId === teamId);
  const coins = mine.prizeCoins + mine.sponsorCoins;
  return (
    <section class="screen">
      <TutorialHint hint={hintFor(view, {})} />
      <div class="frame center big-result grow">
        <div class="small">Etappe {res.stage}</div>
        <div class="place">{ordinal(place)}</div>
        <div>
          <b>+{mine.stagePoints}</b> punten · <b>{mine.totalPoints}</b> totaal
        </div>
      </div>
      <div class="strip">
        <StripBtn label="Beloning" value={`+€ ${coins}${mine.bonusCards.length ? ` · ${mine.bonusCards.length} kaart` : ''}`} onClick={() => setSheet('reward')} />
        {sab.length > 0 && <StripBtn label="Sabotage" value={`${sab.length} incident${sab.length === 1 ? '' : 'en'}`} tone="silly" onClick={() => setSheet('sab')} />}
      </div>
      <div class="dock">
        {isPresident ? (
          <button class="big primary ty" onClick={() => president('nextStage')}>
            {state.stage >= STAGES ? 'NAAR DE EINDSTAND' : 'VOLGENDE ETAPPE'}
          </button>
        ) : (
          <p class="dim center">De volgende etappe begint vanzelf.</p>
        )}
      </div>
      {sheet === 'reward' && (
        <Sheet title="Beloning" onClose={() => setSheet(null)}>
          <div class="stack tight">
            <p>
              +{mine.prizeCoins} munten voor de uitslag{mine.sponsorCoins > 0 ? `, +${mine.sponsorCoins} van sponsors` : ''}.
            </p>
            {mine.bonusCards.length > 0 && (
              <div class="chips">
                {mine.bonusCards.map((d, i) => (
                  <span class="asset" key={i} style={{ '--k': KIND_COLORS[CARD_DEFS[d].kind] } as Record<string, string>}>
                    Bonus: {CARD_DEFS[d].name}
                  </span>
                ))}
              </div>
            )}
            <p class="dim s">Training vervaagt nu met 1. Vermoeidheid zakt langzaam. Plan je volgende voorbereiding slim.</p>
          </div>
        </Sheet>
      )}
      {sheet === 'sab' && (
        <Sheet title="Sabotage" onClose={() => setSheet(null)}>
          <div class="stack tight">
            {sab.map((x, i) => (
              <p key={i}>
                {state.teams.find((t) => t.id === x.fromTeamId)!.name} zette {CARD_DEFS[x.def].name} in tegen{' '}
                {state.teams.find((t) => t.id === x.toTeamId)!.name}.
              </p>
            ))}
          </div>
        </Sheet>
      )}
    </section>
  );
}

function Finished({ view, president }: { view: View; president: (w: PresidentAction) => void }) {
  const { state, teamId } = view;
  const [sheet, setSheet] = useState(false);
  const res = state.season!;
  const isPresident = view.presidentTeamId === teamId;
  const place = res.teams.findIndex((t) => t.teamId === teamId) + 1;
  const mine = res.teams.find((t) => t.teamId === teamId)!;
  const awards = res.awards.filter((a) => a.teamId === teamId);
  return (
    <section class="screen">
      <TutorialHint hint={hintFor(view, {})} />
      <div class="frame center big-result grow">
        <div class="small">Seizoen afgerond</div>
        <div class="place">{ordinal(place)}</div>
        <div>
          <b>{mine.points}</b> punten · € {mine.coins} over
        </div>
      </div>
      {awards.length > 0 && (
        <div class="strip">
          <StripBtn label="Prijzen" value={awards.map((a) => a.title).join(' · ')} onClick={() => setSheet(true)} />
        </div>
      )}
      <div class="dock">
        {isPresident ? (
          <button class="big primary ty" onClick={() => president('rematch')}>
            NIEUW SEIZOEN
          </button>
        ) : (
          <p class="dim center">De president kan een nieuw seizoen starten.</p>
        )}
      </div>
      {sheet && (
        <Sheet title="Jouw prijzen" onClose={() => setSheet(false)}>
          <div class="stack">
            {awards.map((a) => (
              <div class="stack tight" key={a.title}>
                <div class="small">{a.title}</div>
                <p class="dim">{a.blurb}</p>
              </div>
            ))}
          </div>
        </Sheet>
      )}
    </section>
  );
}

render(<App />, document.getElementById('app')!);

