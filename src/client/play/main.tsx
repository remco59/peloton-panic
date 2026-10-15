import { createContext, render } from 'preact';
import { createPortal } from 'preact/compat';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import '../common/theme.css';
import { CardDetail, PlayingCard } from '../common/card';
import {
  Battery,
  Coins,
  Crown,
  ElevationProfile,
  Medal,
  Podium,
  QuirkTag,
  RiderAvatar,
  StatIcon,
  StatRadar,
  TypeBadge,
} from '../common/visuals';
import type { PodiumEntry } from '../common/visuals';
import './play.css';
import { installClickSounds, useCues } from './cues';
import {
  BRIEFING,
  CARD_DEFS,
  CARD_DEF_LIST,
  CONTRACT_LABELS,
  EFFORTS,
  EVENTS,
  KIND_COLORS,
  KIND_LABELS,
  PACE_ORDER,
  PREMIE_INFO,
  QUIRKS,
  RIDER_TYPES,
  STAT_HELP,
  STAT_LABELS,
  TEAM_COLORS,
  TERRAINS,
  WEATHER,
} from '../../shared/content';
import {
  allesCost,
  baseParts,
  canBlock,
  canHelp,
  effectiveStats,
  groupsOf,
  maxEnergyFor,
  perksOf,
  resolveEffort,
  stageFit,
  sumParts,
  teamDefIds,
  terrainAt,
} from '../../shared/engine';
import { stageProfile } from '../../shared/profile';
import { standing, tiles } from '../../shared/standing';
import type { StandingRow } from '../../shared/standing';
import type { PlayerAction, PresidentAction, RoomInfo, ServerMsg } from '../../shared/protocol';
import { phoneHint } from '../../shared/tutorial';
import type { Hint, HintContext } from '../../shared/tutorial';
import {
  BLIND_COST,
  BLOCK_PENALTY,
  BLOCK_RANGE,
  CAR_ENERGY,
  CAR_ENERGY_UPGRADED,
  COLA_BONUS,
  ALONE_COST,
  GEL_ENERGY,
  HELP_BONUS,
  HELP_RANGE,
  PELOTON_MIN,
  PELOTON_REST,
  PREMIE_POINTS,
  RECRUIT_PICKS,
  START_COINS,
  TEAM_BONUS,
  TEAM_BONUS_MAX,
  SLOT_LIMITS,
  STAGES,
  TRAININGS_PER_RIDER,
} from '../../shared/types';
import type {
  Card,
  Effort,
  OfferView,
  PlayerView,
  PublicState,
  RaceItem,
  RacePlay,
  Rider,
  ShopItem,
  SlotKind,
  Stat,
  Terrain,
} from '../../shared/types';
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
}: {
  def: string;
  price?: boolean;
  children?: preact.ComponentChildren;
  dim?: boolean;
}) {
  if (!CARD_DEFS[def]) return null;
  return <CardDetail def={def} price={price}>{children}</CardDetail>;
}

const colorIdx = (state: PublicState, r: Rider) => state.teams.find((t) => t.id === r.teamId)?.color ?? 0;

function Bars({ rider, tolerance }: { rider: Rider; tolerance: number }) {
  const eff = effectiveStats(rider, tolerance);
  return (
    <div class="sbars">
      {STATS.map((k) => {
        const lost = Math.max(0, rider.base[k] + rider.form[k] - eff[k]);
        return (
          <div class="sb" key={k} title={STAT_HELP[k]}>
            <span class="sl">
              <StatIcon stat={k} size={13} /> {STAT_LABELS[k]}
            </span>
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
      {!online && (
        <p class="dim" role="status">
          Verbinden met de server... Lukt dat niet? Controleer of je op hetzelfde wifi zit als de tv.
        </p>
      )}
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
  useCues(view, error);
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
    briefing: 'Uitleg',
    recruit: 'Rekruteren',
    naming: 'Namen',
    draft: 'Draft',
    team: 'Voorbereiding',
    race: `Ronde ${state.round}`,
    resolve: 'Kijk naar de tv',
    results: 'Uitslag',
    finished: 'Eindstand',
  };
  const stageTag =
    state.phase === 'lobby' || state.phase === 'briefing' || state.phase === 'finished' ? '' : `E${state.stage}/${STAGES} · `;

  return (
    <div class="game" style={{ '--team': col.hex } as Record<string, string>}>
      <header class="bar">
        <span class="chip" data-s={col.shape} style={{ background: col.hex }} />
        <b class="who">{team.name}</b>
        <span class="coins">
          <Coins n={team.coins} max={3} />
        </span>
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
          {state.phase === 'briefing' && <Briefing view={view} act={act} president={president} />}
          {state.phase === 'recruit' && <Recruit view={view} act={act} />}
          {state.phase === 'naming' && <Naming view={view} act={act} />}
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

/** Kaart als compacte speelkaart; de regels en acties staan in een sheet. */
function CardTile({ def, price, dim, index, onClick }: { def: string; price?: boolean; dim?: boolean; index?: number; onClick: () => void }) {
  return <PlayingCard def={def} size="sm" price={price} dim={dim} index={index} onClick={onClick} />;
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
        <div class="sheet-hero">
          <RiderAvatar rider={rider} color={colorIdx(state, rider)} size={96} />
          <StatRadar base={rider.base} eff={effectiveStats(rider, perks.overtrainTolerance)} size={116} color={TEAM_COLORS[colorIdx(state, rider) % TEAM_COLORS.length].hex} />
        </div>
        <div>
          <div class="small">{t.label}</div>
          <div>{t.blurb}</div>
        </div>
        <div>
          <div class="small">{q.label}</div>
          <div>{q.blurb}</div>
        </div>
        {rider.injury > 0 && (
          <div>
            <div class="small">Geblesseerd</div>
            <div>Een val van vorige etappe: -1 op alle eigenschappen. Een fysiotherapeut lost dit sneller op.</div>
          </div>
        )}
        {rider.hurt && (
          <div>
            <div class="small">Zwaar gevallen</div>
            <div>Begint de volgende etappe geblesseerd (-1 op alles), tenzij een fysiotherapeut ingrijpt.</div>
          </div>
        )}
        {state.kopman[rider.teamId] === rider.id && (
          <div>
            <div class="small">Kopman</div>
            <div>Zijn punten voor de eindstand tellen dubbel. Knechten binnen {HELP_RANGE} tegels kunnen helpen.</div>
          </div>
        )}
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

function Lobby({ view, president }: GameProps) {
  const { state, teamId } = view;
  const isPresident = view.presidentTeamId === teamId;
  const hasBot = state.teams.some((t) => t.isBot);
  const enough = state.teams.length >= 2;
  return (
    <section class="screen">
      <TutorialHint hint={hintFor(view, {})} />
      <div class="grow stack">
        <div class="frame recruit-note">
          <div class="ty">JE EIGEN WINKEL</div>
          <p class="dim">
            Na de uitleg opent iedereen zijn eigen winkel met € {START_COINS}. Kies {RECRUIT_PICKS} renners (neo-profs zijn
            gratis, sterren kosten munten) en teken sponsors: die betalen meteen, betalen bij succes of leveren spullen.
          </p>
        </div>
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
                <span class="dim s"> · tips tijdens het spel, uitgesproken door Fenna</span>
              </span>
            </label>
            <label class="toggle frame">
              <input
                type="checkbox"
                checked={state.commentary}
                onChange={(e) => president((e.target as HTMLInputElement).checked ? 'commentaryOn' : 'commentaryOff')}
              />
              <span>
                <b>Commentaar</b>
                <span class="dim s"> · Johan en Marieke</span>
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
              {enough ? 'START: EERST DE UITLEG' : 'VOEG EEN BOT TOE'}
            </button>
          </>
        ) : (
          <p class="dim center">
            {state.teams.length} team(s) in het peloton. Wachten tot de president het seizoen start.
          </p>
        )}
      </div>
    </section>
  );
}

// ---- Uitleg vooraf ------------------------------------------------------------

function Briefing({ view, act, president }: GameProps) {
  const { state, teamId } = view;
  const b = state.briefing!;
  const page = BRIEFING[Math.min(b.page, BRIEFING.length - 1)];
  const isPresident = view.presidentTeamId === teamId;
  const last = b.page >= BRIEFING.length - 1;
  const okCount = state.teams.filter((t) => b.ok[t.id]).length;
  const mine = !!b.ok[teamId];
  return (
    <section class="screen">
      <div class="brief-top">
        <span class="small">
          Uitleg {b.page + 1}/{BRIEFING.length}
        </span>
        <span class="dots">
          {BRIEFING.map((_, i) => (
            <i key={i} class={i === b.page ? 'on' : i < b.page ? 'done' : ''} />
          ))}
        </span>
      </div>
      <div class="brief grow">
        <h2 class="ty">{page.title}</h2>
        <p class="lead">{page.lead}</p>
        <div class="bpoints">
          {page.points.map((p) => (
            <div class="bp" key={p.head}>
              <b class="ty">{p.head}</b>
              <span>{p.text}</span>
            </div>
          ))}
        </div>
      </div>
      <div class="dock">
        {last && (
          <button class={`big ty ${mine ? '' : 'primary'}`} onClick={() => act({ type: 'briefOk', on: !mine })}>
            {mine ? `IK SNAP HET ✓ (${okCount}/${state.teams.length})` : `IK SNAP HET (${okCount}/${state.teams.length})`}
          </button>
        )}
        {isPresident ? (
          <div class="row2">
            <button class="big slim" disabled={b.page === 0} onClick={() => president('briefBack')}>
              Terug
            </button>
            {last ? (
              <button class="big slim primary ty" onClick={() => president('briefDone')}>
                START DE DRAFT
              </button>
            ) : (
              <button class="big slim primary ty" onClick={() => president('briefNext')}>
                Volgende
              </button>
            )}
          </div>
        ) : (
          <p class="dim center s">De president bladert door de uitleg. Kijk mee op de tv.</p>
        )}
        {isPresident && !last && (
          <button class="link-btn" onClick={() => president('briefDone')}>
            Uitleg overslaan
          </button>
        )}
      </div>
    </section>
  );
}

// ---- Parcours -----------------------------------------------------------------

/** Het parcours als berglandschap: terrein, premievlaggen en (in de race) de renners zelf. */
function Profile({ state, teamId, onClick }: { state: PublicState; teamId?: string; onClick?: () => void }) {
  const showRiders = state.phase === 'race' || state.phase === 'resolve';
  const kopmen = new Set(Object.values(state.kopman));
  const Tag = onClick ? 'button' : 'div';
  const lead = Math.max(0, ...state.riders.map((r) => Math.floor(r.pos)));
  return (
    <Tag class="profile" onClick={onClick} aria-label="Parcours">
      {onClick && showRiders && <span class="p-hint">Stand ›</span>}
      <ElevationProfile
        terrain={state.terrain}
        premies={state.premies}
        riders={
          showRiders
            ? state.riders.map((r) => ({
                id: r.id,
                pos: r.pos,
                type: r.type,
                color: colorIdx(state, r),
                mine: r.teamId === teamId,
                kop: kopmen.has(r.id),
                first: Math.floor(r.pos) === lead,
              }))
            : []
        }
      />
    </Tag>
  );
}

/** De hele koers op volgorde: wie waar rijdt en hoe ver het tot de kop en tot de renner ervoor is. */
function Stand({ state, teamId }: { state: PublicState; teamId?: string }) {
  const rows = standing(state);
  const kopmen = new Set(Object.values(state.kopman));
  return (
    <div class="stand">
      {rows.map((row, i) => {
        const team = state.teams.find((t) => t.id === row.teamId);
        const col = TEAM_COLORS[(team?.color ?? 0) % TEAM_COLORS.length];
        const tied = i > 0 && row.gapAhead === 0;
        return (
          <div key={row.rider.id}>
            {i > 0 && row.gapAhead > 0 && (
              <div class="stand-gap" style={{ '--g': Math.min(row.gapAhead, 5) }}>
                {tiles(row.gapAhead)}
              </div>
            )}
            <div class={`stand-row ${row.teamId === teamId ? 'mine' : ''}`}>
              <span class="rk ty">{tied ? '' : row.rank === 1 ? <Crown size={16} /> : row.rank}</span>
              <span class="sw" style={{ '--c': col.hex } as Record<string, string>}>
                <RiderAvatar rider={row.rider} color={team?.color ?? 0} size="100%" />
              </span>
              <span class="nm">
                {kopmen.has(row.rider.id) && <span class="star">★ </span>}
                <b>{firstName(row.rider.name)}</b> <span class="dim">{team?.name}</span>
              </span>
              <span class="tl">tegel {row.tile}</span>
              <span class={`gl ty ${row.gapLeader === 0 ? 'ok' : ''}`}>{row.gapLeader === 0 ? 'KOP' : `−${row.gapLeader}`}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Waar een renner zit ten opzichte van de kop: "aan de kop", "kop, met 2 anderen" of "4 tegels achter de kop". */
function placeText(row: StandingRow | undefined, state: PublicState): string {
  if (!row || row.gapLeader > 0) return row ? `${tiles(row.gapLeader)} achter de kop` : '';
  const same = state.riders.filter((x) => x.id !== row.rider.id && Math.floor(x.pos) === row.tile).length;
  return same > 0 ? `kop, met ${same} ${same === 1 ? 'ander' : 'anderen'}` : 'aan de kop';
}

function ProfileLegend({ state }: { state: PublicState }) {
  const p = stageProfile(state);
  return (
    <div class="legend">
      {(['climb', 'flat', 'cobbles', 'descent'] as Terrain[])
        .filter((t) => p.counts[t] > 0)
        .map((t) => (
          <span key={t}>
            <i class={`pf pf-${t}`} /> {p.counts[t]} {TERRAINS[t].label.toLowerCase()}
          </span>
        ))}
    </div>
  );
}

// ---- Rekruteren: je eigen winkel ----------------------------------------------

type RiderItem = Extract<ShopItem, { kind: 'rider' }>;
type ContractItem = Extract<ShopItem, { kind: 'contract' }>;

function Recruit({ view, act }: ViewProps) {
  const { state, me, teamId } = view;
  const rc = state.recruit!;
  const team = state.teams.find((t) => t.id === teamId)!;
  const shop = me?.shop ?? [];
  const riders = shop
    .filter((x): x is RiderItem => x.kind === 'rider')
    .sort((a, b) => b.price - a.price || a.rider.name.localeCompare(b.rider.name));
  const contracts = shop
    .filter((x): x is ContractItem => x.kind === 'contract')
    .sort((a, b) => CARD_DEFS[a.def].contract!.localeCompare(CARD_DEFS[b.def].contract!));
  const have = state.riders.filter((r) => r.teamId === teamId);
  const signed = team.slots.sponsor;
  const full = have.length >= rc.picks;
  const sponsorsFull = signed.length >= rc.contracts;
  const readyCount = state.teams.filter((t) => t.ready).length;
  const [tab, setTab] = useState<'riders' | 'sponsors'>('riders');
  // Op id, niet op plek: een gekocht ding verdwijnt uit de lijst.
  const [open, setOpen] = useState<string | null>(null);
  const item = open !== null ? shop.find((x) => x.id === open) : undefined;
  const noPerks = perksOf([]);
  const buy = (id: string) => {
    act({ type: 'recruit', itemId: id });
    setOpen(null);
  };
  return (
    <section class="screen">
      <TutorialHint hint={hintFor(view, {})} />
      <div class="shop-bar frame">
        <span>
          <span class="small">Budget</span>
          <b class="ty">€ {team.coins}</b>
        </span>
        <span>
          <span class="small">Renners</span>
          <b class="ty">
            {have.length}/{rc.picks}
          </b>
        </span>
        <span>
          <span class="small">Sponsors</span>
          <b class="ty">
            {signed.length}/{rc.contracts}
          </b>
        </span>
      </div>
      {(have.length > 0 || signed.length > 0) && (
        <div class="small shop-mine">
          {[
            ...have.map((r) => `${firstName(r.name)} (${RIDER_TYPES[r.type].label})`),
            ...signed.map((d) => CARD_DEFS[d].name),
          ].join(' · ')}
        </div>
      )}
      <div class="tabs two">
        <button class={`tab ty ${tab === 'riders' ? 'on' : ''}`} onClick={() => setTab('riders')}>
          RENNERS<span class="badge">{riders.length}</span>
        </button>
        <button class={`tab ty ${tab === 'sponsors' ? 'on' : ''}`} onClick={() => setTab('sponsors')}>
          SPONSORS<span class="badge">{contracts.length}</span>
        </button>
      </div>
      {tab === 'riders' ? (
        <div class="cands">
          {riders.map((c) => {
            const r = c.rider;
            const poor = c.price > team.coins || full;
            return (
              <button class={`cand frame ${poor ? 'poor' : ''}`} key={c.id} onClick={() => setOpen(c.id)}>
                <span class="cand-id">
                  <RiderAvatar rider={r} size={52} />
                  <span class="cand-who">
                    <span class="cand-top">
                      <b>{r.name}</b>
                      <span class={`price ty ${c.price === 0 ? 'free' : ''}`}>{c.price === 0 ? 'GRATIS' : `€ ${c.price}`}</span>
                    </span>
                    <span class="cand-tags">
                      <TypeBadge type={r.type} label />
                      <QuirkTag quirk={r.quirk} />
                    </span>
                  </span>
                  <StatRadar base={r.base} size={62} labels={false} color="#ffc83d" />
                </span>
                <span class="cand-stats s">
                  {STATS.map((k) => (
                    <span key={k} title={STAT_HELP[k]}>
                      <StatIcon stat={k} size={12} /> <b>{r.base[k]}</b>
                    </span>
                  ))}
                  <span>
                    Energie <b>{maxEnergyFor(r, noPerks, false)}</b>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div class="cands">
          <p class="dim s">
            Sponsors kosten niets, maar je tekent er maximaal {rc.contracts}. Sommige betalen meteen, sommige alleen als je presteert,
            en sommige leveren spullen.
          </p>
          <div class="cards">
            {contracts.map((c, i) => {
              const kind = CARD_DEFS[c.def].contract!;
              return (
                <div class="ct" key={c.id}>
                  <CardTile def={c.def} index={i} dim={sponsorsFull} onClick={() => setOpen(c.id)} />
                  <span class={`ct-tag ${kind}`}>{CONTRACT_LABELS[kind].label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div class="dock">
        {team.ready && <p class="dim center s">Je staat op klaar. Tik op wijzig om nog iets te kopen.</p>}
        <button
          class={`big ty ${team.ready ? '' : 'primary'}`}
          disabled={!team.ready && have.length < rc.picks}
          onClick={() => act(team.ready ? { type: 'unready' } : { type: 'ready' })}
        >
          {team.ready
            ? `KLAAR (${readyCount}/${state.teams.length}) · WIJZIG`
            : have.length < rc.picks
              ? `KIES NOG ${rc.picks - have.length} RENNER${rc.picks - have.length === 1 ? '' : 'S'}`
              : `KLAAR (${readyCount}/${state.teams.length})`}
        </button>
      </div>
      {item?.kind === 'rider' && (
        <Sheet title={item.rider.name} onClose={() => setOpen(null)}>
          <div class="stack tight">
            <div class="sheet-hero">
              <RiderAvatar rider={item.rider} size={96} />
              <StatRadar base={item.rider.base} size={110} color="#ffc83d" />
            </div>
            <div>
              <div class="small">{RIDER_TYPES[item.rider.type].label}</div>
              <div>{RIDER_TYPES[item.rider.type].blurb}</div>
            </div>
            <div>
              <div class="small">{QUIRKS[item.rider.quirk].label}</div>
              <div>{QUIRKS[item.rider.quirk].blurb}</div>
            </div>
            <Bars rider={item.rider} tolerance={0} />
            <div class="dim s">Energie in de race: {maxEnergyFor(item.rider, noPerks, false)}</div>
            <button
              class="big primary ty"
              disabled={team.ready || full || item.price > team.coins}
              onClick={() => buy(item.id)}
            >
              {item.price === 0 ? 'CONTRACTEER (GRATIS)' : `CONTRACTEER VOOR € ${item.price}`}
            </button>
            {team.ready && <p class="dim s">Haal eerst je klaar weg om nog te winkelen.</p>}
            {!team.ready && full && <p class="dim s">Je hebt al {rc.picks} renners.</p>}
            {!team.ready && !full && item.price > team.coins && <p class="bad s">Je hebt hier te weinig munten voor.</p>}
          </div>
        </Sheet>
      )}
      {item?.kind === 'contract' && (
        <Sheet title="Sponsorcontract" onClose={() => setOpen(null)}>
          <CardRow def={item.def}>
            <p class="dim s">
              <b>{CONTRACT_LABELS[CARD_DEFS[item.def].contract!].label}.</b> {CONTRACT_LABELS[CARD_DEFS[item.def].contract!].blurb}
            </p>
            <button class="small-btn primary" disabled={team.ready || sponsorsFull} onClick={() => buy(item.id)}>
              {CARD_DEFS[item.def].signing ? `Teken en ontvang € ${CARD_DEFS[item.def].signing}` : 'Teken contract'}
            </button>
            {team.ready && <p class="dim s">Haal eerst je klaar weg om nog te winkelen.</p>}
            {!team.ready && sponsorsFull && <p class="dim s">Je hebt al {rc.contracts} sponsors op je shirt.</p>}
          </CardRow>
        </Sheet>
      )}
    </section>
  );
}

function Naming({ view, act }: ViewProps) {
  const { state, teamId } = view;
  const team = state.teams.find((t) => t.id === teamId)!;
  const mine = state.riders.filter((r) => r.teamId === teamId);
  const [names, setNames] = useState(mine.map((r) => r.name));
  const [info, setInfo] = useState<number | null>(null);
  const readyCount = state.teams.filter((t) => t.ready || t.isBot).length;
  const r = info !== null ? mine[info] : null;
  const push = (next: string[]) => act({ type: 'nameRiders', names: next });
  return (
    <section class="screen">
      <TutorialHint hint={hintFor(view, {})} />
      <p class="dim">Geef je renners een naam, of houd de willekeurige namen. Er is geen timer.</p>
      <div class="grow stack">
        {mine.map((rd, i) => (
          <div class="rider-edit frame" key={rd.id}>
            <div class="re-id">
              <RiderAvatar rider={rd} color={team.color} size={44} />
              <span class="re-tags">
                <TypeBadge type={rd.type} label />
                <QuirkTag quirk={rd.quirk} />
              </span>
            </div>
            <div class="re-row">
              <input
                value={names[i] ?? ''}
                maxLength={20}
                disabled={team.ready}
                onInput={(e) => {
                  const next = [...names];
                  next[i] = (e.target as HTMLInputElement).value;
                  setNames(next);
                }}
                onBlur={() => push(names)}
              />
              <button class="info" onClick={() => setInfo(i)} aria-label={`Over ${names[i] || rd.name}`}>
                i
              </button>
            </div>
          </div>
        ))}
      </div>
      <div class="dock">
        <button
          class={`big ty ${team.ready ? '' : 'primary'}`}
          onClick={() => {
            if (team.ready) act({ type: 'unready' });
            else {
              push(names);
              act({ type: 'ready' });
            }
          }}
        >
          {team.ready ? `KLAAR (${readyCount}/${state.teams.length}) · WIJZIG` : `KLAAR (${readyCount}/${state.teams.length})`}
        </button>
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
      <div class="small">
        De markt · {state.deckCount} kaarten op de stapel · parcours: {stageProfile(state).summary}
      </div>
      <div class="cards">
        {state.market.map((m, i) => (
          <CardTile key={i} def={m} index={i} onClick={() => setPick(i)} />
        ))}
      </div>
      <div class="dock">
        {mine && (
          <div class="row2">
            <button class="big slim" onClick={() => act({ type: 'draftPick', source: { kind: 'deck' } })}>
              Van de stapel
            </button>
            <button class="big slim" onClick={() => act({ type: 'draftSkip' })}>
              Overslaan
            </button>
          </div>
        )}
        <button class="big slim" disabled={cards.length === 0} onClick={() => setHand(true)}>
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

type Tab = 'plan' | 'team' | 'kaarten' | 'winkel' | 'ruilen';
const TABS: Tab[] = ['plan', 'kaarten', 'team', 'winkel', 'ruilen'];

function TeamPhase({ view, act }: ViewProps) {
  const { state, me, teamId } = view;
  const team = state.teams.find((t) => t.id === teamId)!;
  const initial = new URLSearchParams(location.search).get('tab');
  const [tab, setTab] = useState<Tab>(TABS.includes(initial as Tab) ? (initial as Tab) : 'plan');
  const readyCount = state.teams.filter((t) => t.ready).length;
  const incoming = me!.offersIn.length;
  return (
    <section class="screen">
      <div class="tabs" role="tablist" aria-label="Voorbereiding">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} class={`tab ty ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            {t.toUpperCase()}
            {t === 'kaarten' && me!.hand.length > 0 && <span class="badge">{me!.hand.length}</span>}
            {t === 'ruilen' && incoming > 0 && <span class="badge hot">{incoming}</span>}
          </button>
        ))}
      </div>
      <TutorialHint hint={hintFor(view, { tab })} />
      {me!.sabotageOn.length > 0 && <div class="warn-s">⚠ Iemand heeft iets slechts in de zin met jouw team.</div>}
      <div class="tabbody">
        {tab === 'plan' && <PlanTab view={view} act={act} />}
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

function PlanTab({ view, act }: ViewProps) {
  const { state, me, teamId } = view;
  const team = state.teams.find((t) => t.id === teamId)!;
  const riders = state.riders.filter((r) => r.teamId === teamId);
  const perks = perksOf(teamDefIds(team.slots));
  const p = stageProfile(state);
  const fits = riders.map((r) => stageFit(r, state.terrain, perks.overtrainTolerance));
  const top = Math.max(...fits);
  return (
    <div class="stack tight">
      <div class="plan-head">
        <b class="ty">{p.stageName}</b>
        <span class="dim s">{p.premies ? `Premies: ${p.premies.toLowerCase()}` : 'Geen premies'}</span>
      </div>
      <Profile state={state} />
      <ProfileLegend state={state} />
      <div class="small sec">Kies je kopman: zijn punten tellen dubbel</div>
      <div class="stack tight">
        {riders.map((r, i) => {
          const sel = me!.kopmanId === r.id;
          const fit = Math.round((fits[i] / Math.max(top, 1)) * 100);
          const best = fits[i] === top;
          return (
            <button class={`kop-pick ${sel ? 'on' : ''}`} key={r.id} onClick={() => act({ type: 'kopman', riderId: r.id })}>
              <span class="kp-top">
                <RiderAvatar rider={r} color={colorIdx(state, r)} size={34} />
                <b>{r.name}</b>
                <TypeBadge type={r.type} />
                {sel && <span class="kp-tag ty">★ KOPMAN ×2</span>}
              </span>
              <span class="kp-fit">
                <span class="small">Past bij dit parcours{best ? ' · beste keuze' : ''}</span>
                <span class="ebar">
                  <span class={`fill ${fit >= 90 ? 'high' : fit >= 75 ? 'mid' : 'low'}`} style={{ width: `${fit}%` }} />
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p class="dim s">
        De andere twee zijn knechten. In de race kunnen ze binnen {HELP_RANGE} tegels van je kopman helpen: hij krijgt dan {HELP_BONUS} tegels extra.
        Train je kopman bij: dan past hij nog beter.
      </p>
    </div>
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
              <RiderAvatar rider={r} color={team.color} size={42} />
              <span class="r-who">
                <b>{r.name}</b>
                <TypeBadge type={r.type} label />
              </span>
              {r.injury > 0 && <span class="r-hurt" title="Geblesseerd">🩹</span>}
            </div>
            <Bars rider={r} tolerance={perks.overtrainTolerance} />
            <div class="r-meta">
              <span>
                Vermoeid <Pips value={r.fatigue} limit={limit} />
                {over && <span class="warn-s"> overtraind</span>}
                {r.injury > 0 && <span class="warn-s"> geblesseerd</span>}
              </span>
              <span class="dim">Training {r.trained}/{TRAININGS_PER_RIDER}</span>
            </div>
          </button>
        );
      })}
      <button class="big slim" onClick={() => setGear(true)}>
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
      <div class="cards">
        {hand.map((x, i) => (
          <CardTile key={x.id} def={x.def} index={i} onClick={() => setSel(x.id)} />
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
            {d.kind === 'race' && (
              <p class="dim">
                Je speelt deze kaart in de race, onder een renner. Ongebruikte kaarten blijven bewaard voor de
                volgende ronde en etappe.
              </p>
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
      <div class="cards">
        {state.market.map((m, i) => (
          <CardTile key={i} def={m} index={i} price dim={team.coins < CARD_DEFS[m].price} onClick={() => setPick(i)} />
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

interface PlannedItem {
  item: RaceItem;
  targetId?: string;
}

/** Kies welke tegenstander je blokkeert: alleen renners binnen bereik van je knecht. */
function AimSheet({ state, by, onPick }: { state: PublicState; by: Rider; onPick: (riderId: string) => void }) {
  const targets = state.riders
    .filter((x) => canBlock(by, x))
    .sort((a, b) => b.pos - a.pos);
  const rankOf = (r: Rider) => 1 + state.riders.filter((x) => x.pos > r.pos).length;
  return (
    <div class="stack tight">
      <p class="dim">
        {firstName(by.name)} knijpt een tegenstander dicht: die rijdt {BLOCK_PENALTY} tegels minder en krijgt geen drafting.
        Alleen renners binnen {BLOCK_RANGE} tegels.
      </p>
      {targets.length === 0 && <p>Er rijdt niemand binnen bereik.</p>}
      {targets.map((x) => {
        const gap = Math.round(x.pos - by.pos);
        const team = state.teams.find((t) => t.id === x.teamId);
        return (
          <button key={x.id} class="small-btn aim" onClick={() => onPick(x.id)}>
            <b>{x.name}</b>
            <span class="dim">
              {team?.name} · {ordinal(rankOf(x))} ·{' '}
              {gap === 0 ? 'naast je' : gap > 0 ? `${gap} voor je` : `${-gap} achter je`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Race({ view, act }: ViewProps) {
  const { state, me, teamId } = view;
  const team = state.teams.find((t) => t.id === teamId)!;
  // De kopman staat bovenaan: hij is waar het om draait.
  const riders = state.riders
    .filter((r) => r.teamId === teamId)
    .sort((a, b) => Number(b.id === me!.kopmanId) - Number(a.id === me!.kopmanId));
  const perks = perksOf(teamDefIds(team.slots));
  const rows = standing(state);
  const [choice, setChoice] = useState<Record<string, Effort>>({});
  const [sheet, setSheet] = useState<'event' | 'weather' | 'premies' | string | null>(null);
  // Volgauto en racekaarten: `undefined` = nog niets gekozen, dan stellen we de renner met de meeste dorst voor.
  const [carPick, setCarPick] = useState<string | null | undefined>(undefined);
  const [items, setItems] = useState<Record<string, PlannedItem>>({});
  const [aim, setAim] = useState<string | null>(null); // knecht die een blokkade-doelwit kiest
  useEffect(() => {
    setChoice({});
    setCarPick(undefined);
    setItems({});
    setAim(null);
  }, [state.round]);
  const locked = team.locked;
  const shown = locked ? me!.efforts : choice;
  const perkSet = perksOf(teamDefIds(team.slots));
  const hand = me!.hand;
  const itemOfCard = (id: string): RaceItem | undefined => {
    const c = hand.find((x) => x.id === id);
    return c ? CARD_DEFS[c.def].race : undefined;
  };
  const lockedItems: Record<string, PlannedItem> = {};
  for (const p of me!.plays) {
    const it = itemOfCard(p.cardId);
    if (it) lockedItems[p.riderId] = { item: it, targetId: p.targetId };
  }
  const shownItems = locked ? lockedItems : items;
  const thirst = (r: Rider) => r.maxEnergy - (r.energy + (shownItems[r.id]?.item === 'gel' ? GEL_ENERGY : 0));
  const suggestedCar = [...riders].sort((a, b) => thirst(b) - thirst(a))[0]?.id ?? null;
  const shownCar = locked ? me!.car : carPick === undefined ? suggestedCar : carPick;
  const haveOf = (item: RaceItem) => hand.filter((c) => CARD_DEFS[c.def].race === item).length;
  const plannedOf = (item: RaceItem, except?: string) =>
    Object.entries(shownItems).filter(([rid, p]) => p.item === item && rid !== except).length;
  const setItem = (riderId: string, p: PlannedItem | null) => {
    const next = { ...items };
    if (p) next[riderId] = p;
    else delete next[riderId];
    setItems(next);
  };
  const confirm = () => {
    const used = new Set<string>();
    const plays: RacePlay[] = [];
    for (const [riderId, p] of Object.entries(items)) {
      const card = hand.find((c) => CARD_DEFS[c.def].race === p.item && !used.has(c.id));
      if (!card) continue;
      used.add(card.id);
      plays.push({ cardId: card.id, riderId, ...(p.targetId ? { targetId: p.targetId } : {}) });
    }
    act({
      type: 'effort',
      efforts: Object.fromEntries(riders.map((r) => [r.id, choice[r.id] ?? (r.energy <= 0 && !items[r.id] ? 'rustig' : 'normaal')])),
      car: shownCar,
      plays,
    });
  };
  const unlock = () => {
    // Je keuzes blijven staan als je wijzigt, ook na een herlaad.
    setItems(lockedItems);
    setCarPick(me!.car);
    setChoice({ ...me!.efforts });
    act({ type: 'unlock' });
  };
  const ev = state.event ? EVENTS[state.event.id] : null;
  const groups = groupsOf(state.riders);
  const picked = riders.find((r) => r.id === sheet);
  const kopmanId = me!.kopmanId;
  const nameOf = (id: string) => state.riders.find((r) => r.id === id)?.name ?? '?';
  const teamOfRider = (id: string) => state.teams.find((t) => t.id === state.riders.find((r) => r.id === id)?.teamId);
  const SHORT: Record<Effort, string> = { rustig: 'Rustig', normaal: 'Normaal', alles: 'Alles', helpen: 'Helpen' };

  return (
    <section class="screen">
      <TutorialHint hint={hintFor(view, { locked })} />
      <div class="strip">
        {ev && <StripBtn label="Gebeurtenis" value={ev.title} tone={ev.silly ? 'silly' : ''} onClick={() => setSheet('event')} />}
        <StripBtn
          label="Weer"
          value={`${WEATHER[state.weather].icon} ${WEATHER[state.weather].label}`}
          tone={state.weather === 'rain' ? 'silly' : ''}
          onClick={() => setSheet('weather')}
        />
      </div>
      <Profile state={state} teamId={teamId} onClick={() => setSheet('premies')} />
      <div class="riders grow">
        {riders.map((r) => {
          const terrain = terrainAt(state, r.pos);
          const standRow = rows.find((x) => x.rider.id === r.id);
          const plan = shownItems[r.id];
          const gelOn = plan?.item === 'gel';
          const colaOn = plan?.item === 'cola';
          // Een gel telt mee voor wat je deze ronde kunt: de knoppen rekenen met de energie erna.
          const energy = gelOn ? Math.min(r.maxEnergy, r.energy + GEL_ENERGY) : r.energy;
          const empty = energy <= 0;
          const sel = shown[r.id] ?? 'normaal';
          const pct = r.maxEnergy ? Math.round((energy / r.maxEnergy) * 100) : 0;
          const targetName = plan?.targetId ? firstName(nameOf(plan.targetId)) : '';
          const inReach = state.riders.filter((x) => canBlock(r, x));
          const isKop = r.id === kopmanId;
          const near = !isKop && canHelp(state, r);
          const paces: Effort[] = isKop ? PACE_ORDER : [...PACE_ORDER, 'helpen'];
          // De kopman telt de hulp mee die zijn knechten nu hebben gekozen.
          const helpIn = isKop
            ? riders.filter((x) => x.id !== r.id && shown[x.id] === 'helpen' && canHelp(state, x)).length
            : 0;
          return (
            <div class="frame rider" key={r.id}>
              <div class="r-top">
                <RiderAvatar rider={r} color={colorIdx(state, r)} size={34} />
                <b class="r-name">{r.name}</b>
                {isKop && <span class="kp-tag ty">★ KOPMAN ×2</span>}
                <TypeBadge type={r.type} />
                <button class="info" aria-label={`Over ${r.name}`} onClick={() => setSheet(r.id)}>
                  i
                </button>
              </div>
              <div class="place">
                <b class={`pl ty ${standRow?.rank === 1 ? 'first' : ''}`}>{ordinal(standRow?.rank ?? 1)}</b>
                <span class="pl-text">{placeText(standRow, state)}</span>
                {standRow?.ahead && standRow.gapAhead > 0 && (
                  <span class="pl-ahead">
                    {tiles(standRow.gapAhead)} achter {firstName(standRow.ahead.name)}
                  </span>
                )}
              </div>
              <div class="energy">
                <span class={`terr t-${terrain}`}>
                  {TERRAINS[terrain].icon} {TERRAINS[terrain].label}
                </span>
                <Battery value={energy} max={r.maxEnergy} />
                <span class={`el ${empty ? 'warn-s' : ''} ${gelOn ? 'boost' : ''}`}>
                  {empty ? 'Op de fles' : `${energy}/${r.maxEnergy}`}
                </span>
              </div>
              <div class={`efforts ${paces.length === 4 ? 'four' : ''}`}>
                {paces.map((e) => {
                  const helpE = e === 'helpen';
                  const real = resolveEffort(energy, perks, e);
                  const parts = baseParts(state, r, perks, real.effort, real.exhausted);
                  if (helpE) parts.effort = 0;
                  const grp = groups.get(r.id);
                  const teamBonus = grp && !helpE ? Math.min(TEAM_BONUS_MAX, grp.mates * TEAM_BONUS) : 0;
                  const mv = sumParts(parts) + teamBonus + (isKop && !helpE ? HELP_BONUS * helpIn : 0) + (colaOn ? COLA_BONUS : 0);
                  const disabled = locked || (helpE ? !near : real.effort !== e);
                  let cost = e === 'alles' ? -allesCost(perks) : helpE ? EFFORTS.normaal.energy : EFFORTS[e].energy;
                  // In een peloton rijd je lichter, alleen kost het extra (vol gas blijft vol gas).
                  if (grp && !(real.exhausted)) {
                    if (grp.size >= PELOTON_MIN) cost += e === 'alles' ? 0 : PELOTON_REST;
                    else if (e !== 'rustig') cost -= ALONE_COST;
                  }
                  return (
                    <button
                      key={e}
                      class={`eff ${sel === e ? 'on' : ''} ${helpE ? 'help' : ''}`}
                      disabled={disabled}
                      onClick={() => setChoice({ ...choice, [r.id]: e })}
                    >
                      <span class="ty">{paces.length === 4 ? SHORT[e] : EFFORTS[e].label}</span>
                      <span class="mv">≈ +{mv}</span>
                      <span class="en">
                        {helpE
                          ? near
                            ? `kopman +${HELP_BONUS}`
                            : 'te ver weg'
                          : `${cost > 0 ? `+${cost}` : cost} energie`}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div class="extras">
                <button
                  class={`xbtn car ${shownCar === r.id ? 'on' : ''}`}
                  disabled={locked}
                  title="De volgauto rijdt bij deze renner en geeft hem een slok energie"
                  onClick={() => setCarPick(shownCar === r.id ? null : r.id)}
                >
                  🚗 Volgauto +{perkSet.service > 0 ? CAR_ENERGY_UPGRADED : CAR_ENERGY}
                </button>
                {(['gel', 'cola', 'blok'] as RaceItem[]).map((it) => {
                  const mine = plan?.item === it;
                  const left = haveOf(it) - plannedOf(it, r.id);
                  if (!mine && left <= 0) return null;
                  const gain = Math.min(GEL_ENERGY, r.maxEnergy - r.energy);
                  const full = it === 'gel' && gain <= 0;
                  const noTarget = it === 'blok' && inReach.length === 0;
                  const label = it === 'gel' ? 'Gel' : it === 'cola' ? 'Cola' : 'Blok';
                  const glyph = it === 'gel' ? '🧃' : it === 'cola' ? '🚀' : '🚧';
                  return (
                    <button
                      key={it}
                      class={`xbtn ${it} ${mine ? 'on' : ''}`}
                      disabled={locked || (!mine && (full || noTarget))}
                      title={full ? 'Volle energie' : noTarget ? `Niemand binnen ${BLOCK_RANGE} tegels` : CARD_DEFS[it].text}
                      onClick={() => {
                        if (mine) return setItem(r.id, null);
                        if (it === 'blok') return setAim(r.id);
                        setItem(r.id, { item: it });
                      }}
                    >
                      {glyph} {label}
                      {it === 'gel' && !full ? ` +${gain}` : ''}
                      {mine && it === 'blok' && targetName ? ` → ${targetName}` : ''}
                      {!mine && left > 1 ? ` ×${left}` : ''}
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
            <button class="big ty" onClick={unlock}>
              WIJZIG
            </button>
          </>
        ) : (
          <button class="big primary ty" onClick={confirm}>
            BEVESTIGEN
          </button>
        )}
      </div>
      {aim && (
        <Sheet title="Wie blokkeer je?" onClose={() => setAim(null)}>
          <AimSheet
            state={state}
            by={state.riders.find((r) => r.id === aim)!}
            onPick={(targetId) => {
              setItem(aim, { item: 'blok', targetId });
              setAim(null);
            }}
          />
        </Sheet>
      )}
      {sheet === 'weather' && (
        <Sheet title={`Weer: ${WEATHER[state.weather].label}`} onClose={() => setSheet(null)}>
          <p>{WEATHER[state.weather].blurb}</p>
          <p class="dim s">
            Bij nat wegdek valt er veel meer. Afdalingen, kasseien en Alles geven maken het risico groter, regenbanden
            helpen. Een gevallen renner verliest tegels en energie; bij een zware val begint hij de volgende etappe
            geblesseerd.
          </p>
        </Sheet>
      )}
      {sheet === 'event' && ev && (
        <Sheet title={ev.title} onClose={() => setSheet(null)}>
          <p>{ev.blurb}</p>
        </Sheet>
      )}
      {sheet === 'premies' && (
        <Sheet title="Stand en parcours" onClose={() => setSheet(null)}>
          <div class="stack">
            <Profile state={state} teamId={teamId} />
            <ProfileLegend state={state} />
            <Stand state={state} teamId={teamId} />
            {state.premies.map((p) => (
              <div class="stack tight" key={p.id}>
                <div class="small">
                  {PREMIE_INFO[p.id].label} · tegel {p.pos} van {state.trackLength}
                </div>
                <p class="dim">{PREMIE_INFO[p.id].blurb}</p>
                {p.hits.length === 0 && <p>Nog niemand gepasseerd. Er zijn nog {PREMIE_POINTS.length} plekken.</p>}
                {p.hits.map((h, i) => (
                  <p key={i}>
                    <b>
                      {i + 1}. {nameOf(h.riderId)}
                    </b>{' '}
                    ({teamOfRider(h.riderId)?.name}) +{h.points}
                  </p>
                ))}
              </div>
            ))}
            {state.premies.length === 0 && <p class="dim">Geen premies in deze etappe.</p>}
          </div>
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
  const nameOf = (id: string) => state.riders.find((r) => r.id === id)?.name ?? '?';
  const myTeam = state.teams.find((t) => t.id === teamId)!;
  const carBonus = perksOf(teamDefIds(myTeam.slots)).service > 0 ? CAR_ENERGY_UPGRADED : CAR_ENERGY;
  const rows = standing(state);
  return (
    <section class="screen">
      <TutorialHint hint={hintFor(view, {})} />
      <p class="center ty look">KIJK NAAR DE TV</p>
      {rep && rep.premies.some((h) => mine.some((r) => r.id === h.riderId)) && (
        <div class="frame premie-win">
          {rep.premies
            .filter((h) => mine.some((r) => r.id === h.riderId))
            .map((h, i) => (
              <p key={i}>
                <b>{PREMIE_INFO[h.premieId].label}:</b> {state.riders.find((r) => r.id === h.riderId)!.name} +{h.points} punten!
              </p>
            ))}
        </div>
      )}
      <div class="stack grow">
        {rep &&
          mine.map((r) => {
            const m = rep.moves.find((x) => x.riderId === r.id);
            if (!m) return null;
            const row = rows.find((x) => x.rider.id === r.id);
            const p = m.parts;
            const blokPlay = rep.plays.find((x) => x.riderId === r.id && x.item === 'blok');
            const blokTarget = blokPlay?.targetRiderId ? nameOf(blokPlay.targetRiderId) : '';
            const fmt = (n: number) => `${n > 0 ? '+' : ''}${n}`;
            const bits = [
              m.helping ? 'Helpen' : EFFORTS[m.effort].label,
              p.stat ? `kracht ${fmt(p.stat)}` : '',
              p.terrain ? `uitrusting/terrein ${fmt(p.terrain)}` : '',
              p.quirk ? `eigenaardigheid ${fmt(p.quirk)}` : '',
              p.event ? `omstandigheden ${fmt(p.event)}` : '',
              p.draft > 0 ? `drafting +${p.draft}` : '',
              p.draft < 0 ? `alleen in de wind ${p.draft}` : '',
              m.groupSize >= 3 ? 'in het peloton' : '',
              p.team ? `teamwerk +${p.team}` : '',
              p.chase ? `peloton jaagt +${p.chase}` : '',
              m.helping ? `helpt de kopman (+${HELP_BONUS} voor hem)` : '',
              p.help ? `knechten +${p.help}` : '',
              m.windPaid ? 'kopwerk: -1 energie' : '',
              m.pech ? `pech ${fmt(p.luck)}` : '',
              m.crash === 'fall' ? `GEVALLEN ${fmt(p.crash)}${m.injured ? ', zwaar: volgende etappe -1' : ''}` : '',
              m.crash === 'domino' ? `meegevallen ${fmt(p.crash)}` : '',
              m.shielded ? 'reservefiets of volgauto redt je' : '',
              m.boost ? 'meewind +1' : '',
              m.exhausted ? 'op de fles' : '',
              m.item === 'gel' ? `gel: +${GEL_ENERGY} energie` : '',
              m.item === 'cola' ? `cola: +${COLA_BONUS} tegels` : '',
              blokTarget ? `blokkade op ${firstName(blokTarget)}` : '',
              m.blockedBy ? `geblokkeerd door ${firstName(nameOf(m.blockedBy))}: ${fmt(p.item)} en geen drafting` : '',
              m.car ? `volgauto: +${carBonus} energie${m.shielded ? ', pech opgevangen' : ''}` : '',
            ].filter(Boolean);
            return (
              <div class="frame result" key={r.id}>
                <div class="r-top">
                  <b>{r.name}</b>
                  <span class="ty acc">+{m.to - m.from}</span>
                </div>
                <div class="dim s">{bits.join(' · ')}</div>
                <div class="dim s">Energie nu: {m.energyAfter}</div>
                {row && (
                  <div class="s now-place">
                    <b>{ordinal(row.rank)}</b> · {placeText(row, state)}
                    {row.ahead && row.gapAhead > 0 && ` · ${tiles(row.gapAhead)} achter ${firstName(row.ahead.name)}`}
                  </div>
                )}
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
  const rankOf = new Map(res.ranking.map((r) => [r.riderId, r.rank]));
  const entries: PodiumEntry[] = [...res.teams]
    .sort((a, b) => b.stagePoints - a.stagePoints)
    .map((t) => {
      const team = state.teams.find((x) => x.id === t.teamId)!;
      const best = state.riders.filter((r) => r.teamId === team.id).sort((a, b) => (rankOf.get(a.id) ?? 99) - (rankOf.get(b.id) ?? 99))[0];
      return { teamId: team.id, name: team.id === teamId ? 'Jij' : team.name, color: team.color, rider: best, points: t.stagePoints, pointsLabel: `+${t.stagePoints}` };
    });
  return (
    <section class="screen">
      <TutorialHint hint={hintFor(view, {})} />
      <div class="frame center big-result grow">
        <div class="small">Etappe {res.stage}</div>
        <Podium entries={entries} compact />
        <div class="place sm">{ordinal(place)}</div>
        <div>
          <b>+{mine.stagePoints}</b> punten · <b>{mine.totalPoints}</b> totaal
        </div>
        <div class="dim s">
          eindstand {mine.riderPoints} (kopman dubbel)
          {mine.premiePoints > 0 ? ` · premies ${mine.premiePoints}` : ''}
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
  const entries: PodiumEntry[] = res.teams.map((t) => {
    const team = state.teams.find((x) => x.id === t.teamId)!;
    const riders = state.riders.filter((r) => r.teamId === team.id);
    const star = riders.find((r) => r.id === state.kopman[team.id]) ?? riders[0];
    return { teamId: team.id, name: team.id === teamId ? 'Jij' : team.name, color: team.color, rider: star, points: t.points, pointsLabel: `${t.points}` };
  });
  return (
    <section class="screen">
      <TutorialHint hint={hintFor(view, {})} />
      <div class="frame center big-result grow">
        <div class="small">Seizoen afgerond</div>
        <Podium entries={entries} compact />
        <div class="place sm">{ordinal(place)}</div>
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

installClickSounds();
render(<App />, document.getElementById('app')!);

