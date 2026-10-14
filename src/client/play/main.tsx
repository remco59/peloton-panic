import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
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

/** Uitleg bij de huidige fase (alleen met tutorial aan). Weg te klikken, en terug te halen. */
function TutorialHint({ hint }: { hint: Hint | null }) {
  const id = hint?.id;
  const [open, setOpen] = useState(true);
  useEffect(() => setOpen(id ? !seenHints().has(id) : false), [id]);
  if (!hint) return null;
  if (!open)
    return (
      <button class="hint-open" onClick={() => setOpen(true)}>
        ? Uitleg: {hint.title}
      </button>
    );
  return (
    <div class="hint">
      <div class="hint-head">
        <span class="small">Uitleg</span>
        <b>{hint.title}</b>
      </div>
      <ol>
        {hint.steps.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ol>
      <button
        class="small-btn"
        onClick={() => {
          markSeen(hint.id);
          setOpen(false);
        }}
      >
        Begrepen
      </button>
    </div>
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
  const stageTag = state.phase === 'lobby' ? '' : `Etappe ${state.stage}/${STAGES} · `;

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
      </header>
      {!online && <div class="offline">Opnieuw verbinden...</div>}
      {error && <div class="err">{error}</div>}
      <main>
        {state.phase === 'lobby' && <Lobby view={view} act={act} president={president} />}
        {state.phase === 'draft' && <Draft view={view} act={act} />}
        {state.phase === 'team' && <TeamPhase view={view} act={act} />}
        {state.phase === 'race' && <Race view={view} act={act} />}
        {state.phase === 'resolve' && <Resolve view={view} />}
        {state.phase === 'results' && <Results view={view} president={president} />}
        {state.phase === 'finished' && <Finished view={view} president={president} />}
      </main>
    </div>
  );
}

// ---- Lobby --------------------------------------------------------------------

function Lobby({ view, act, president }: GameProps) {
  const { state, teamId } = view;
  const team = state.teams.find((t) => t.id === teamId)!;
  const isPresident = view.presidentTeamId === teamId;
  const mine = state.riders.filter((r) => r.teamId === teamId);
  const [names, setNames] = useState(mine.map((r) => r.name));
  const hasBot = state.teams.some((t) => t.isBot);
  const enough = state.teams.length >= 2;
  return (
    <section class="stack">
      <TutorialHint hint={hintFor(view, {})} />
      <p class="dim">
        Je bent manager van het team van <b>{team.name}</b>. Geef je drie renners een naam, of houd de willekeurige namen.
      </p>
      {mine.map((r, i) => (
        <div class="rider-edit frame" key={r.id}>
          <div class="small">{RIDER_TYPES[r.type].label}</div>
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
      <p class="dim">{state.teams.length} team(s) in het peloton.</p>
      {isPresident ? (
        <div class="stack">
          <p class="crown">JIJ BENT DE PRESIDENT</p>
          <label class="toggle frame">
            <input
              type="checkbox"
              checked={state.tutorial}
              onChange={(e) => president((e.target as HTMLInputElement).checked ? 'tutorialOn' : 'tutorialOff')}
            />
            <span>
              <b>Tutorial-modus</b>
              <br />
              <span class="dim">De commentatoren leggen onderweg uit hoe het spel werkt. Aanrader voor een eerste keer.</span>
            </span>
          </label>
          <div class="row2">
            <button class="big ty" onClick={() => president('addBot')} disabled={state.teams.length >= 6}>
              + BOT
            </button>
            <button class="big ty" onClick={() => president('removeBot')} disabled={!hasBot}>
              - BOT
            </button>
          </div>
          <button class="big primary ty" disabled={!enough} onClick={() => president('start')}>
            START HET SEIZOEN
          </button>
          {!enough && <p class="dim">Je hebt minstens 2 teams nodig. Voeg een bot toe om alleen te proberen.</p>}
        </div>
      ) : (
        <p class="dim">Wachten tot de president het seizoen start.</p>
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
  return (
    <section class="stack">
      <TutorialHint hint={hintFor(view, { myTurn: mine })} />
      <div class={`turn frame ${mine ? 'mine' : ''}`}>
        {mine ? (
          <>
            <div class="ty">JIJ BENT AAN DE BEURT</div>
            <p>Pak een kaart van de markt, of trek een onbekende van de stapel.</p>
          </>
        ) : (
          <>
            <div class="ty">{current ? `${current.name} KIEST` : 'DRAFT KLAAR'}</div>
            <p class="dim">Jij hebt nog {picksLeft} keuze{picksLeft === 1 ? '' : 's'}. Kijk alvast wat er ligt.</p>
          </>
        )}
      </div>
      <div class="small">De markt ({state.deckCount} kaarten op de stapel)</div>
      <div class="list">
        {state.market.map((def, i) => (
          <CardRow key={i} def={def}>
            {mine && (
              <button class="small-btn primary" onClick={() => act({ type: 'draftPick', source: { kind: 'market', index: i } })}>
                Pak deze
              </button>
            )}
          </CardRow>
        ))}
      </div>
      {mine && (
        <div class="row2">
          <button class="big" onClick={() => act({ type: 'draftPick', source: { kind: 'deck' } })}>
            Trek van de stapel
          </button>
          <button class="big" onClick={() => act({ type: 'draftSkip' })}>
            Overslaan
          </button>
        </div>
      )}
      <HandSummary hand={me?.hand ?? []} />
    </section>
  );
}

function HandSummary({ hand }: { hand: Card[] }) {
  if (hand.length === 0) return null;
  return (
    <div class="frame">
      <div class="small">Jouw kaarten ({hand.length})</div>
      <div class="chips mt">
        {hand.map((c) => (
          <span class="asset" key={c.id} style={{ '--k': KIND_COLORS[CARD_DEFS[c.def].kind] } as Record<string, string>}>
            {CARD_DEFS[c.def].name}
          </span>
        ))}
      </div>
    </div>
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
    <section class="stack">
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
      {me!.sabotageOn.length > 0 && (
        <div class="frame warn">Iemand heeft iets slechts in de zin met jouw team... Je merkt het straks in de race.</div>
      )}
      {tab === 'kaarten' && <HandTab view={view} act={act} />}
      {tab === 'team' && <BoardTab view={view} />}
      {tab === 'winkel' && <ShopTab view={view} act={act} />}
      {tab === 'ruilen' && <TradeTab view={view} act={act} />}
      <div class="readybar">
        <button
          class={`big ty ${team.ready ? '' : 'primary'}`}
          onClick={() => act(team.ready ? { type: 'unready' } : { type: 'ready' })}
        >
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
  return (
    <div class="stack">
      {riders.map((r) => {
        const maxE = maxEnergyFor(r, perks, bidon);
        const limit = 2 + perks.overtrainTolerance;
        const over = r.fatigue > limit;
        return (
          <div class="frame rbox" key={r.id}>
            <div class="r-top">
              <b>{r.name}</b>
              <span class="dim">{RIDER_TYPES[r.type].label}</span>
            </div>
            <Bars rider={r} tolerance={perks.overtrainTolerance} />
            <div class="r-meta">
              <span>
                Vermoeidheid <Pips value={r.fatigue} limit={limit} />
              </span>
              <span class="dim">Training {r.trained}/{TRAININGS_PER_RIDER}</span>
            </div>
            {over && <div class="warn-s">Overtraind: alle eigenschappen {r.fatigue - limit} lager. Neem een rustdag!</div>}
            <div class="dim s">Start met {maxE} energie · {QUIRKS[r.quirk].label}</div>
          </div>
        );
      })}
      <div class="frame">
        <div class="small">Jouw spullen</div>
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
      </div>
    </div>
  );
}

function HandTab({ view, act }: ViewProps) {
  const { state, me, teamId } = view;
  const team = state.teams.find((t) => t.id === teamId)!;
  const riders = state.riders.filter((r) => r.teamId === teamId);
  const others = state.teams.filter((t) => t.id !== teamId);
  const [replacing, setReplacing] = useState<string | null>(null);
  const hand = me!.hand;
  if (hand.length === 0)
    return (
      <div class="frame center dim">
        Je hebt geen kaarten. Haal er in de winkel of via ruilen een paar.
      </div>
    );
  return (
    <div class="list">
      {hand.map((c) => {
        const d = CARD_DEFS[c.def];
        const slot = slotOf(c.def);
        const full = slot ? team.slots[slot].length >= SLOT_LIMITS[slot] : false;
        return (
          <CardRow key={c.id} def={c.def}>
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
                      onClick={() => act({ type: 'train', cardId: c.id, riderId: r.id })}
                    >
                      {firstName(r.name)}
                    </button>
                  );
                })}
              </div>
            )}
            {slot && !full && (
              <button class="small-btn primary" onClick={() => act({ type: 'install', cardId: c.id })}>
                Op je bord leggen
              </button>
            )}
            {slot && full && replacing !== c.id && (
              <button class="small-btn" onClick={() => setReplacing(c.id)}>
                Vak vol: vervangen...
              </button>
            )}
            {slot && full && replacing === c.id && (
              <div class="chips">
                {team.slots[slot].map((def, i) => (
                  <button
                    key={i}
                    class="small-btn"
                    onClick={() => {
                      act({ type: 'install', cardId: c.id, replaceDef: def });
                      setReplacing(null);
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
                    onClick={() => act({ type: 'sabotage', cardId: c.id, targetTeamId: t.id })}
                  >
                    Tegen {t.name}
                  </button>
                ))}
              </div>
            )}
          </CardRow>
        );
      })}
    </div>
  );
}

function ShopTab({ view, act }: ViewProps) {
  const { state, teamId } = view;
  const team = state.teams.find((t) => t.id === teamId)!;
  return (
    <div class="stack">
      <div class="frame">
        <div class="small">Je hebt € {team.coins}</div>
        <p class="dim s">Een kaart uit de markt kost de prijs op de kaart. Een onbekende van de stapel kost € {BLIND_COST}.</p>
        <button
          class="big mt"
          disabled={team.coins < BLIND_COST}
          onClick={() => act({ type: 'buy', source: { kind: 'deck' } })}
        >
          Blind trekken (€ {BLIND_COST})
        </button>
      </div>
      <div class="list">
        {state.market.map((def, i) => (
          <CardRow key={i} def={def} price>
            <button
              class="small-btn primary"
              disabled={team.coins < CARD_DEFS[def].price}
              onClick={() => act({ type: 'buy', source: { kind: 'market', index: i } })}
            >
              Koop voor € {CARD_DEFS[def].price}
            </button>
          </CardRow>
        ))}
      </div>
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
    <div class="frame offer">
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
          <button
            class="small-btn primary"
            disabled={!can}
            onClick={() => act({ type: 'respond', offerId: o.id, accept: true })}
          >
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

function TradeTab({ view, act }: ViewProps) {
  const { state, me, teamId } = view;
  const team = state.teams.find((t) => t.id === teamId)!;
  const others = state.teams.filter((t) => t.id !== teamId);
  const [to, setTo] = useState<string | null>(others[0]?.id ?? null);
  const [give, setGive] = useState<string[]>([]);
  const [giveCoins, setGiveCoins] = useState(0);
  const [want, setWant] = useState<string[]>([]);
  const [wantCoins, setWantCoins] = useState(0);
  const hand = me!.hand;
  const toggle = (id: string) => setGive((g) => (g.includes(id) ? g.filter((x) => x !== id) : g.length < 3 ? [...g, id] : g));
  const canSend = !!to && give.length + want.length + giveCoins + wantCoins > 0;
  return (
    <div class="stack">
      {me!.offersIn.map((o) => (
        <OfferBox key={o.id} o={o} state={state} mine={false} hand={hand} act={act} />
      ))}
      {me!.offerOut && <OfferBox o={me!.offerOut} state={state} mine hand={hand} act={act} />}
      <div class="frame make">
        <div class="small">Maak een voorstel</div>
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
        <div class="dim s">Jij geeft: tik kaarten aan ({give.length}/3)</div>
        <div class="chips">
          {hand.length === 0 && <span class="dim">Je hebt geen kaarten</span>}
          {hand.map((c) => (
            <button key={c.id} class={`pill small ${give.includes(c.id) ? 'on' : ''}`} onClick={() => toggle(c.id)}>
              {CARD_DEFS[c.def].name}
            </button>
          ))}
        </div>
        <Stepper label="Munten erbij" value={giveCoins} max={team.coins} onChange={setGiveCoins} />
        <div class="dim s">Jij vraagt: kies kaarten ({want.length}/3)</div>
        <div class="chips">
          {CARD_DEF_LIST.map((d) => (
            <button key={d.id} class="pill small" onClick={() => setWant((w) => (w.length < 3 ? [...w, d.id] : w))}>
              {d.name}
            </button>
          ))}
        </div>
        <div class="chips">
          {want.length === 0 && <span class="dim">nog niets gekozen</span>}
          {want.map((d, i) => (
            <button key={i} class="pill small on" onClick={() => setWant(want.filter((_, j) => j !== i))}>
              {CARD_DEFS[d].name} ✕
            </button>
          ))}
        </div>
        <Stepper label="Munten vragen" value={wantCoins} max={20} onChange={setWantCoins} />
        <button
          class="big primary ty"
          disabled={!canSend}
          onClick={() => {
            act({ type: 'offer', to: to!, give, giveCoins, want, wantCoins });
            setGive([]);
            setWant([]);
            setGiveCoins(0);
            setWantCoins(0);
          }}
        >
          VOORSTEL STUREN
        </button>
      </div>
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
  useEffect(() => setChoice({}), [state.round]);
  const locked = team.locked;
  const shown = locked ? me!.efforts : choice;
  const ev = state.event ? EVENTS[state.event.id] : null;
  const eventRider = state.event?.targetRiderId;

  return (
    <section class="stack">
      <TutorialHint hint={hintFor(view, { locked })} />
      {ev && (
        <div class={`event frame ${ev.silly ? 'silly' : ''}`}>
          <b>{ev.title}.</b> {ev.blurb}
        </div>
      )}
      <div class="riders">
        {riders.map((r) => {
          const terrain = terrainAt(state, r.pos);
          const empty = r.energy <= 0;
          const sel = shown[r.id] ?? 'normaal';
          const pct = r.maxEnergy ? Math.round((r.energy / r.maxEnergy) * 100) : 0;
          return (
            <div class="frame rider" key={r.id}>
              <div class="r-top">
                <b>{r.name}</b>
                <span class="dim">
                  {RIDER_TYPES[r.type].label} · {ordinal(1 + state.riders.filter((x) => x.pos > r.pos).length)}
                </span>
              </div>
              <div class="r-mid">
                <span class={`terr t-${terrain}`}>
                  {TERRAINS[terrain].icon} {TERRAINS[terrain].label}
                </span>
                <span class="dim">
                  {state.trackLength - Math.floor(r.pos)} tegels te gaan
                  {eventRider === r.id ? ' · doelwit' : ''}
                </span>
              </div>
              <div class="energy">
                <span class="el">Energie {r.energy}/{r.maxEnergy}</span>
                <span class="ebar">
                  <span class={`fill ${pct <= 25 ? 'low' : pct <= 55 ? 'mid' : 'high'}`} style={{ width: `${pct}%` }} />
                </span>
              </div>
              {empty && <div class="warn-s">Op de fles: je kunt alleen Rustig rijden.</div>}
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
      {locked ? (
        <div class="stack">
          <p class="ok center ty">TEMPO VASTGELEGD</p>
          <button class="big ty" onClick={() => act({ type: 'unlock' })}>
            WIJZIG
          </button>
        </div>
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
      <p class="dim s center">De tegels zijn een schatting: drafting, wind en geluk komen er nog bij.</p>
    </section>
  );
}

function Resolve({ view }: { view: View }) {
  const { state, teamId } = view;
  const rep = state.report;
  const mine = state.riders.filter((r) => r.teamId === teamId);
  return (
    <section class="stack">
      <TutorialHint hint={hintFor(view, {})} />
      <p class="center ty">KIJK NAAR DE TV</p>
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
    </section>
  );
}

// ---- Uitslag ------------------------------------------------------------------

function Results({ view, president }: { view: View; president: (w: PresidentAction) => void }) {
  const { state, teamId } = view;
  const res = state.stageResult!;
  const mine = res.teams.find((t) => t.teamId === teamId)!;
  const isPresident = view.presidentTeamId === teamId;
  const place = [...res.teams].sort((a, b) => b.stagePoints - a.stagePoints).findIndex((t) => t.teamId === teamId) + 1;
  const sab = res.sabotages.filter((x) => x.toTeamId === teamId || x.fromTeamId === teamId);
  return (
    <section class="stack">
      <TutorialHint hint={hintFor(view, {})} />
      <div class="frame center big-result">
        <div class="small">Etappe {res.stage}</div>
        <div class="place">{ordinal(place)}</div>
        <div>
          <b>+{mine.stagePoints}</b> punten · <b>{mine.totalPoints}</b> totaal
        </div>
      </div>
      <div class="frame">
        <div class="small">Beloning</div>
        <p>
          +{mine.prizeCoins} munten voor de uitslag{mine.sponsorCoins > 0 ? `, +${mine.sponsorCoins} van sponsors` : ''}.
        </p>
        {mine.bonusCards.length > 0 && (
          <div class="chips mt">
            {mine.bonusCards.map((d, i) => (
              <span class="asset" key={i} style={{ '--k': KIND_COLORS[CARD_DEFS[d].kind] } as Record<string, string>}>
                Bonus: {CARD_DEFS[d].name}
              </span>
            ))}
          </div>
        )}
      </div>
      {sab.map((x, i) => (
        <div class="frame warn" key={i}>
          {state.teams.find((t) => t.id === x.fromTeamId)!.name} zette {CARD_DEFS[x.def].name} in tegen{' '}
          {state.teams.find((t) => t.id === x.toTeamId)!.name}.
        </div>
      ))}
      <p class="dim s center">
        Training vervaagt nu met 1. Vermoeidheid zakt langzaam. Plan je volgende voorbereiding slim.
      </p>
      {isPresident ? (
        <button class="big primary ty" onClick={() => president('nextStage')}>
          {state.stage >= STAGES ? 'NAAR DE EINDSTAND' : 'VOLGENDE ETAPPE'}
        </button>
      ) : (
        <p class="dim center">De volgende etappe begint vanzelf.</p>
      )}
    </section>
  );
}

function Finished({ view, president }: { view: View; president: (w: PresidentAction) => void }) {
  const { state, teamId } = view;
  const res = state.season!;
  const isPresident = view.presidentTeamId === teamId;
  const place = res.teams.findIndex((t) => t.teamId === teamId) + 1;
  const mine = res.teams.find((t) => t.teamId === teamId)!;
  const awards = res.awards.filter((a) => a.teamId === teamId);
  return (
    <section class="stack">
      <TutorialHint hint={hintFor(view, {})} />
      <div class="frame center big-result">
        <div class="small">Seizoen afgerond</div>
        <div class="place">{ordinal(place)}</div>
        <div>
          <b>{mine.points}</b> punten · € {mine.coins} over
        </div>
      </div>
      {awards.map((a) => (
        <div class="frame" key={a.title}>
          <div class="small">{a.title}</div>
          <div class="dim">{a.blurb}</div>
        </div>
      ))}
      {isPresident ? (
        <button class="big primary ty" onClick={() => president('rematch')}>
          NIEUW SEIZOEN
        </button>
      ) : (
        <p class="dim center">De president kan een nieuw seizoen starten.</p>
      )}
    </section>
  );
}

render(<App />, document.getElementById('app')!);

