// Gedeelde types voor Peloton Panic: server, TV en telefoon gebruiken dezelfde.

export const MIN_TEAMS = 2;
export const MAX_TEAMS = 6;
export const RIDERS_PER_TEAM = 3;
export const TRACK_LENGTH = 48;
export const STAT_FACTOR = 1; // hoeveel een eigenschapspunt aan beweging oplevert
export const STAGES = 3;
export const START_COINS = 10;
export const MARKET_SIZE = 5;
export const BLIND_COST = 2;
export const TRAININGS_PER_RIDER = 2;
export const FORM_CAP = 4;
export const FATIGUE_CAP = 6;
export const OVERTRAIN_FREE = 2; // vermoeidheid tot en met dit niveau geeft geen straf
export const CHASE_GAP = 4; // tegels achter de mediaan voor de peloton je terugtrekt
export const POINTS_BY_RANK = [10, 7, 5, 3, 2, 1];
export const KOPMAN_FACTOR = 2; // de punten van je kopman tellen dubbel
export const STAGE_FACTOR = [1, 1, 2]; // puntenvermenigvuldiger per etappe: de slotetappe telt dubbel
export const HELP_BONUS = 3; // beweging die de kopman krijgt per knecht die helpt
export const HELP_RANGE = 3; // een knecht helpt alleen als hij zo dichtbij de kopman rijdt
export const PREMIE_POINTS = [3, 2, 1]; // tussensprint en bergpremie: de eerste drie renners
export const GEL_ENERGY = 4; // energie die een gel meteen geeft
export const COLA_BONUS = 3; // extra tegels van een cola, één ronde
export const BLOCK_RANGE = 3; // een knecht kan alleen een renner blokkeren die zo dichtbij rijdt
export const BLOCK_PENALTY = 2; // tegels die een geblokkeerde renner verliest
export const CAR_ENERGY = 1; // energie die de volgauto de gekozen renner geeft
export const CAR_ENERGY_UPGRADED = 2; // met een Volgauto-kaart
export const GROUP_GAP = 2; // renners met zo weinig tegels ertussen rijden in dezelfde groep
export const PELOTON_MIN = 3; // een groep van minstens zoveel renners is een peloton
export const PELOTON_REST = 1; // energie die je in een peloton terugkrijgt (je rijdt lichter)
export const ALONE_COST = 1; // extra energie voor wie alleen of met z'n tweeën rijdt
export const DRAFT_BIG = 2; // drafting in een peloton (cluster van minstens PELOTON_MIN) is sterker dan in een duo
export const ALONE_MOVE = 2; // tegels tegenwind voor wie echt alleen rijdt (niet in een afdaling)
export const TEAM_BONUS = 1; // tegels per teamgenoot in dezelfde groep
export const TEAM_BONUS_MAX = 2; // maximaal zoveel tegels teamwerk
export const CHASE_NEAR = 3; // een groep van >= PELOTON_MIN jaagt vanaf zoveel tegels achter een ontsnapper
export const CHASE_FAR = 6; // en krijgt meer hulp vanaf zoveel tegels
export const PECH_CHANCE = 2; // op 10: kans op pech per renner per ronde
export const CRASH_BASE = 3; // procent: kans op een val per renner per ronde
export const CRASH_WET = 8; // extra procent bij nat wegdek
export const CRASH_DESCENT = 3; // extra procent in een afdaling
export const CRASH_COBBLES = 2; // extra procent op kasseien
export const CRASH_ALL_OUT = 2; // extra procent bij Alles geven
export const CRASH_CROWD = 1; // extra procent per renner boven twee binnen één tegel
export const CRASH_LOSS = 5; // tegels die een gevallen renner verliest
export const CRASH_ENERGY = 2; // energie die een val kost
export const DOMINO_RANGE = 1; // renners binnen zoveel tegels kunnen meevallen
export const DOMINO_CHANCE = 35; // procent (nat: +20)
export const DOMINO_LOSS = 3; // tegels die een meegevallen renner verliest
export const RECRUIT_PICKS = 3; // renners per team
export const SHOP_CONTRACTS = 6; // sponsorcontracten in de eigen winkel van elk team
export const POINT_BONUS_STEP = 3; // een puntensponsor betaalt per zoveel etappepunten
export const ENERGY_BASE = 3; // maximale energie = ENERGY_BASE + ENERGY_PER_UITHOUDING * uithouding
export const ENERGY_PER_UITHOUDING = 2;
export const ENERGY_MIN = 6;
export const SLOT_LIMITS = { sponsor: 2, staff: 2, material: 2, car: 1 } as const;

export type Terrain = 'flat' | 'climb' | 'descent' | 'cobbles';
export type RiderType = 'sprinter' | 'climber' | 'rouleur' | 'puncheur' | 'domestique';
export type Weather = 'dry' | 'mixed' | 'rain';
export type Stat = 'kracht' | 'klim' | 'sprint' | 'uithouding';
export type Stats = Record<Stat, number>;
export type Effort = 'rustig' | 'normaal' | 'alles' | 'helpen';
export type Phase = 'lobby' | 'briefing' | 'sponsors' | 'recruit' | 'naming' | 'draft' | 'team' | 'race' | 'resolve' | 'results' | 'finished';
export type PremieId = 'sprint' | 'berg';
export type CardKind = 'training' | 'sponsor' | 'staff' | 'material' | 'car' | 'sabotage' | 'race';
export type RaceItem = 'gel' | 'cola' | 'blok';
export type SlotKind = keyof typeof SLOT_LIMITS;
/** Sponsorcontracten: direct geld, geld bij succes, of spullen die de sponsor levert. */
export type ContractKind = 'cash' | 'bonus' | 'supply';

export type QuirkId =
  | 'croissant'
  | 'waver'
  | 'cobbleKing'
  | 'descentFear'
  | 'windHardened'
  | 'socks'
  | 'finisher'
  | 'napper'
  | 'rainKing'
  | 'sugarCube'
  | 'clumsy'
  | 'daredevil'
  | 'lucky';

export type EventId =
  | 'calm'
  | 'tailwind'
  | 'headwind'
  | 'crosswind'
  | 'rain'
  | 'feedzone'
  | 'chicken'
  | 'wrongTurn'
  | 'sandwich'
  | 'cow'
  | 'tractor'
  | 'goat'
  | 'selfie'
  | 'bbq'
  | 'crowd'
  | 'oil'
  | 'storm'
  | 'mist'
  | 'nails'
  | 'blessing'
  | 'wasps'
  | 'drone'
  | 'fanBottle'
  | 'dogRun'
  | 'detour'
  | 'mascot'
  | 'grandma';

export interface Card {
  id: string;
  def: string; // sleutel in CARD_DEFS
}

export interface Rider {
  id: string;
  teamId: string;
  name: string;
  type: RiderType;
  quirk: QuirkId;
  pos: number;
  base: Stats; // blijvende basiswaarden
  form: Stats; // training: vervaagt 1 per etappe
  fatigue: number; // vermoeidheid: te hoog = overtraind
  trained: number; // trainingen deze etappe
  energy: number; // alleen in de race
  maxEnergy: number;
  injury: number; // 1 = geblesseerd in deze etappe: -1 op alle eigenschappen
  hurt: boolean; // viel zwaar in deze etappe: begint de volgende etappe geblesseerd
}

/** Wat een team in zijn eigen winkel kan kopen: een renner (kost munten) of een sponsorcontract (kost niets, maar neemt een plek in). */
export type ShopItem =
  | { id: string; kind: 'rider'; price: number; rider: Rider }
  | { id: string; kind: 'contract'; def: string };

export interface TeamStats {
  roundsLed: number;
  trades: number;
  trainings: number;
  alles: number;
  exhausted: number;
  sabotages: number;
  helps: number; // keer dat een knecht de kopman hielp
  crashes: number; // keren dat een renner van dit team viel
  premies: number; // premiepunten gehaald
  items: number; // racekaarten ingezet (gel, cola, blokkade)
  blocks: number; // keer dat een blokkade raak was
}

export interface Team {
  id: string;
  name: string; // naam van de speler
  color: number;
  riderIds: string[];
  coins: number;
  points: number; // seizoenspunten
  hand: Card[];
  slots: Record<SlotKind, Card[]>;
  sabotage: string[]; // def-ids van sabotage die dit team deze etappe treft
  raceShield: number; // reservefietsen die nog pech opvangen
  stats: TeamStats;
  isBot: boolean;
}

export interface ActiveEvent {
  id: EventId;
  targetTeamId?: string;
  targetRiderId?: string;
}

export interface Offer {
  id: string;
  from: string;
  to: string;
  give: string[]; // kaart-ids uit de hand van `from`
  giveCoins: number;
  want: string[]; // def-ids die `from` vraagt uit de hand van `to`
  wantCoins: number;
}

export interface OfferView extends Offer {
  giveCards: Card[];
}

export interface MoveParts {
  effort: number;
  stat: number;
  terrain: number;
  quirk: number;
  event: number;
  luck: number; // pech (negatief) of meewind (+1)
  tired: number; // op de fles
  draft: number;
  chase: number;
  help: number; // knechten die de kopman meetrekken
  item: number; // cola (+) of geblokkeerd (-)
  team: number; // teamgenoten in dezelfde groep
  crash: number; // valpartij (negatief)
}

export interface RiderMove {
  riderId: string;
  from: number;
  to: number;
  terrain: Terrain;
  effort: Effort;
  parts: MoveParts;
  roll: number;
  windPaid: boolean;
  exhausted: boolean;
  pech: boolean;
  crash: 'none' | 'fall' | 'domino'; // val: zelf gevallen of meegevallen
  injured: boolean; // zware val: blessure voor de volgende etappe
  groupSize: number; // hoeveel renners er in zijn groep reden
  teammates: number; // teamgenoten in zijn groep
  shielded: boolean;
  boost: boolean;
  car: boolean; // de volgauto reed bij deze renner
  item: RaceItem | null; // gel of cola die deze renner gebruikte
  blockedBy: string | null; // riderId van de knecht die hem blokkeerde
  helping: boolean; // dit was een knecht die de kopman hielp
  energyAfter: number;
  clusterIndex: number;
}

export interface Premie {
  id: PremieId;
  pos: number; // wie deze positie passeert, scoort
  hits: { riderId: string; points: number }[];
}

export interface PremieHit {
  premieId: PremieId;
  riderId: string;
  points: number;
}

/** Een racekaart die in deze ronde is ingezet: zichtbaar zodra de ronde wordt afgehandeld. */
export interface PlayHit {
  teamId: string;
  riderId: string; // renner die de kaart gebruikt (bij blokkade: de blokkerende knecht)
  item: RaceItem;
  targetRiderId?: string; // bij blokkade: de geblokkeerde renner
}

export interface ResolveReport {
  round: number;
  moves: RiderMove[];
  premies: PremieHit[];
  plays: PlayHit[];
  carRiderIds: string[]; // waar de volgauto's deze ronde reden
  leaderRiderId: string;
  prevLeaderRiderId: string;
  finished: boolean;
}

/** Een racekaart die een team voor deze ronde heeft klaargelegd. */
export interface RacePlay {
  cardId: string;
  riderId: string; // eigen renner die de kaart gebruikt
  targetId?: string; // alleen bij blokkade: de tegenstander
}

export interface DraftState {
  order: string[]; // teamIds, volledige volgorde (slang)
  idx: number;
}

/** Elk team heeft zijn eigen winkel: niemand wacht op een ander. */
export interface RecruitState {
  shops: Record<string, ShopItem[]>;
}

export interface StageTeamResult {
  teamId: string;
  kopmanId: string;
  riderPoints: number; // punten voor de eindstand, kopman dubbel
  premiePoints: number;
  stagePoints: number; // riderPoints + premiePoints
  prizeCoins: number;
  sponsorCoins: number; // wat je sponsors deze etappe hebben betaald
  bonusCards: string[]; // def-ids
  totalPoints: number;
}

export interface StageResult {
  stage: number;
  ranking: { riderId: string; rank: number; points: number; kopman: boolean }[];
  premies: Premie[];
  teams: StageTeamResult[];
  lanterneRougeTeamId: string;
  sabotages: { fromTeamId: string; toTeamId: string; def: string }[];
}

export interface Award {
  title: string;
  teamId: string;
  blurb: string;
}

export interface SeasonResult {
  teams: { teamId: string; points: number; coins: number }[];
  winnerTeamId: string;
  lanterneRougeTeamId: string;
  awards: Award[];
}

export interface Briefing {
  page: number;
  ok: Record<string, boolean>; // teamId -> "ik snap het"
}

export interface GameState {
  phase: Phase;
  tutorial: boolean;
  commentary: boolean;
  briefing: Briefing | null;
  kopman: Record<string, string>; // teamId -> riderId
  premies: Premie[];
  round: number;
  stage: number;
  course: string[]; // parcoursprofiel per etappe, bij de start van het seizoen getrokken
  trackLength: number;
  terrain: Terrain[];
  teams: Team[];
  riders: Rider[];
  event: ActiveEvent | null;
  eventDeck: EventId[];
  deck: Card[];
  discard: Card[];
  market: Card[];
  draft: DraftState | null;
  recruit: RecruitState | null;
  weather: Weather;
  ready: Record<string, boolean>;
  efforts: Record<string, Effort>;
  cars: Record<string, string>; // teamId -> renner bij wie de volgauto rijdt
  plays: Record<string, RacePlay[]>; // teamId -> racekaarten voor deze ronde
  locked: Record<string, boolean>;
  offers: Offer[];
  sabotageLog: { fromTeamId: string; toTeamId: string; def: string }[];
  report: ResolveReport | null;
  stageResult: StageResult | null;
  season: SeasonResult | null;
  rng: number;
  nextCardId: number;
  nextOfferId: number;
  nextRiderId: number;
}

// ---- Wat over de lijn gaat ---------------------------------------------------

export interface PublicTeam {
  id: string;
  name: string;
  color: number;
  riderIds: string[];
  coins: number;
  points: number;
  handCount: number;
  slots: Record<SlotKind, string[]>; // def-ids: spullen zijn openbaar
  locked: boolean;
  ready: boolean;
  isBot: boolean;
  trainings: number;
}

export interface PublicState {
  phase: Phase;
  tutorial: boolean;
  commentary: boolean;
  briefing: Briefing | null; // bots staan er al op ok
  kopman: Record<string, string>; // pas zichtbaar zodra de race begint
  premies: Premie[];
  round: number;
  stage: number;
  course: string[]; // parcoursprofiel per etappe, bij de start van het seizoen getrokken
  trackLength: number;
  terrain: Terrain[];
  teams: PublicTeam[];
  riders: Rider[];
  event: ActiveEvent | null;
  market: string[]; // def-ids
  marketCards: Card[];
  deckCount: number;
  draft: { order: string[]; idx: number; currentTeamId: string | null; total: number } | null;
  recruit: { picks: number; contracts: number } | null; // wat je in de winkel mag kiezen; de winkel zelf is privé
  weather: Weather;
  report: ResolveReport | null;
  stageResult: StageResult | null;
  season: SeasonResult | null;
}

export interface PlayerView {
  teamId: string;
  hand: Card[];
  efforts: Record<string, Effort>;
  car: string | null; // jouw volgauto-keuze voor deze ronde
  plays: RacePlay[]; // jouw klaargelegde racekaarten
  offersIn: OfferView[];
  offerOut: OfferView | null;
  sabotageOn: string[]; // wat iemand tegen jou inzet: pas bij de uitslag zichtbaar wie
  pickPending: boolean; // jij bent aan de beurt in de draft
  shop: ShopItem[]; // jouw eigen winkel tijdens het rekruteren
  kopmanId: string; // jouw kopman voor deze etappe
  stats: TeamStats;
}

// ---- Acties ----------------------------------------------------------------

export type PickSource = { kind: 'market'; index: number } | { kind: 'deck' };

export type Action =
  | { type: 'join'; name: string; isBot?: boolean }
  | { type: 'recruit'; teamId: string; itemId: string }
  | { type: 'nameRiders'; teamId: string; names: string[] }
  | { type: 'setTutorial'; on: boolean }
  | { type: 'setCommentary'; on: boolean }
  | { type: 'start' }
  | { type: 'briefPage'; page: number }
  | { type: 'briefOk'; teamId: string; on: boolean }
  | { type: 'briefDone' }
  | { type: 'kopman'; teamId: string; riderId: string }
  | { type: 'draftPick'; teamId: string; source: PickSource }
  | { type: 'draftSkip'; teamId: string }
  | { type: 'buy'; teamId: string; source: PickSource }
  | { type: 'train'; teamId: string; cardId: string; riderId: string }
  | { type: 'install'; teamId: string; cardId: string; replaceDef?: string }
  | { type: 'sabotage'; teamId: string; cardId: string; targetTeamId: string }
  | { type: 'offer'; teamId: string; to: string; give: string[]; giveCoins: number; want: string[]; wantCoins: number }
  | { type: 'withdraw'; teamId: string }
  | { type: 'respond'; teamId: string; offerId: string; accept: boolean }
  | { type: 'ready'; teamId: string }
  | { type: 'unready'; teamId: string }
  | { type: 'effort'; teamId: string; efforts: Record<string, Effort>; car?: string | null; plays?: RacePlay[] }
  | { type: 'unlock'; teamId: string }
  | { type: 'next' }
  | { type: 'timeout' }
  | { type: 'nextStage' }
  | { type: 'rematch' }
  | { type: 'stop' }
  | { type: 'kick'; teamId: string }
  | { type: 'removeBot' };
