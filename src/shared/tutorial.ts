// Tutorial-inhoud: korte, concrete uitleg per fase, voor de telefoon en de tv.
// De tutorial is geen apart spel: iedereen speelt gewoon mee en deze kaarten verschijnen erbij.

import { START_COINS } from './types';
import type { PublicState } from './types';

export type PhoneTab = 'plan' | 'kaarten' | 'team' | 'winkel' | 'ruilen';

export interface Hint {
  id: string; // stabiel: de telefoon onthoudt welke uitleg je al hebt weggeklikt
  title: string;
  steps: string[];
}

export interface HintContext {
  myTurn: boolean;
  tab: PhoneTab;
  handCount: number;
  ready: boolean;
  locked: boolean;
  isPresident: boolean;
  coins: number;
}

const READY_STEP = 'Klaar? Druk onderaan op Klaar. De race begint zodra iedereen klaar is.';

export function phoneHint(s: PublicState, c: HintContext): Hint | null {
  if (!s.tutorial) return null;
  switch (s.phase) {
    case 'lobby':
      return c.isPresident
        ? {
            id: 'lobby-president',
            title: 'Zo begin je',
            steps: [
              'Te weinig spelers? Voeg bots toe met + BOT.',
              'Druk op Start het seizoen als iedereen binnen is. Daarna winkelt iedereen eerst in zijn eigen winkel.',
              'Daarna ben je 3 etappes bezig.',
            ],
          }
        : {
            id: 'lobby-player',
            title: 'Even wachten',
            steps: ['Je winkelt straks in je eigen winkel: drie renners en sponsors.', 'De president start het seizoen zodra iedereen er is.'],
          };
    case 'briefing':
      return null; // de uitleg vooraf is zelf het scherm
    case 'recruit':
      return {
        id: 'recruit-shop',
        title: 'Je eigen winkel',
        steps: [
          `Iedereen heeft een eigen winkel, dus je hoeft niet op een ander te wachten. Je begint met € ${START_COINS}.`,
          'Tab Renners: kies er drie. Neo-profs zijn gratis, talenten en sterren kosten munten. Maak een mix van types.',
          'Tab Sponsors: teken er maximaal twee. Ze kosten niets. Sommige betalen meteen, sommige alleen als je presteert, en sommige leveren spullen.',
          'Munten die je overhoudt, heb je later nodig voor kaarten. Druk op Klaar als je er drie hebt.',
        ],
      };
    case 'naming':
      return {
        id: 'naming',
        title: 'Geef je renners een naam',
        steps: ['Tik op een naam om hem aan te passen, of laat de willekeurige namen staan.', 'Geen timer: druk op Klaar als je klaar bent. De draft begint zodra iedereen klaar is.'],
      };
    case 'draft':
      return c.myTurn
        ? {
            id: 'draft-turn',
            title: 'Jij bent aan de beurt',
            steps: [
              'Tik bij een kaart op Pak deze, of trek een onbekende van de stapel.',
              'Staf en materiaal helpen in de race. Training maakt een renner sterker. Sponsors heb je al in de winkel getekend.',
              'Je kunt straks nog kaarten kopen en ruilen, dus pak wat je nu het hardst nodig hebt.',
            ],
          }
        : {
            id: 'draft-wait',
            title: 'Wacht op je beurt',
            steps: [
              'Iedereen kiest uit dezelfde markt. Kijk alvast wat je wilt hebben.',
              'Het team onderaan het klassement begint. Je krijgt twee keuzes, eerst vooruit en daarna terug.',
            ],
          };
    case 'team': {
      const tabs: Record<PhoneTab, Hint> = {
        plan: {
          id: 'team-plan',
          title: 'Je plan voor deze etappe',
          steps: [
            'Bovenaan zie je het parcours: klimmen, vlak, kasseien en de premies waar je punten kunt halen.',
            'Kies je kopman. Zijn punten tellen dubbel, dus kies de renner die bij het parcours past.',
            'De andere twee zijn knechten. Zij kunnen in de race de kopman meetrekken.',
            READY_STEP,
          ],
        },
        kaarten: {
          id: 'team-kaarten',
          title: 'Kaarten gebruiken',
          steps: [
            c.handCount === 0
              ? 'Je hebt nog geen kaarten. Haal er een paar via Winkel of Ruilen.'
              : 'Trainingskaart: tik op de naam van de renner. Die wordt sterker, maar ook vermoeider.',
            'Staf, materiaal of wagen: tik op Op je bord leggen. Die werken de hele etappe.',
            'Sabotage: kies een tegenstander. Het is een lichte hinder, nooit een uitschakeling.',
            READY_STEP,
          ],
        },
        team: {
          id: 'team-team',
          title: 'Je team lezen',
          steps: [
            'Kracht telt op vlak en kasseien, Klimmen in de bergen, Sprint in de laatste 3 tegels. Uithouding bepaalt je energie.',
            'Groen is training en vervaagt na elke etappe met 1. Rood betekent overtraining.',
            'De bolletjes zijn vermoeidheid. Rode bolletjes: je renner is overtraind en wordt zwakker. Neem een Rustdag.',
            READY_STEP,
          ],
        },
        winkel: {
          id: 'team-winkel',
          title: 'Winkel',
          steps: [
            'Munten verdien je met je sponsors en de uitslag.',
            'Een kaart uit de markt kost de prijs op de kaart. Blind trekken kost € 2.',
            'Spaar niet te lang: ongebruikte munten leveren niets op.',
            READY_STEP,
          ],
        },
        ruilen: {
          id: 'team-ruilen',
          title: 'Ruilen',
          steps: [
            'Kies een team, kies wat je geeft en wat je vraagt. Munten mogen ook.',
            'De ander kan accepteren of afwijzen. Praat erover aan tafel, dat hoort erbij.',
            READY_STEP,
          ],
        },
      };
      return tabs[c.tab];
    }
    case 'race':
      return c.locked
        ? {
            id: 'race-locked',
            title: 'Tempo vastgelegd',
            steps: ['Wacht op de anderen, of tik op Wijzig om je keuze aan te passen.'],
          }
        : {
            id: 'race-choose',
            title: 'Kies een tempo per renner',
            steps: [
              'Rustig: langzaam, je herstelt energie. Normaal: stevig tempo, kost 1 energie (in een peloton niets). Alles geven: het snelst, kost 4 energie.',
              'Helpen: een knecht binnen 3 tegels van de kopman rijdt zelf geen tempo, maar de kopman krijgt 3 tegels extra.',
              'Het getal bij elke knop is een schatting van het aantal tegels. Drafting, wind en geluk komen er nog bij.',
              'Onder elke renner: zet de volgauto bij hem (+1 energie, en pech vangt hij op), eet een gel (+4 energie), drink een cola (+3 tegels) of blokkeer een tegenstander vlakbij.',
              'Let op de premies: vlak ervoor is vol gas goud waard. Tik op Bevestigen als je klaar bent.',
            ],
          };
    case 'resolve':
      return {
        id: 'resolve',
        title: 'Zo lees je de ronde',
        steps: [
          'Onder je renners zie je waaruit hun beweging bestond, inclusief hulp van je knechten.',
          'Drafting: gratis +1 als je vlak achter iemand rijdt, +2 in een groep van drie of meer. Kopwerk kost 1 energie, alleen rijden extra.',
          'Samen met je team in één groep geeft extra tegels. In het peloton rijd je lichter; wie wegrijdt wordt teruggehaald.',
          'Pech, valpartijen en meewind komen door een dobbelsteen. Een reservefiets, mecanicien of een volgauto bij de renner vangt pech op. Bij regen vallen er meer renners.',
          'Gel, cola, blokkade en de volgauto zie je terug onder de renner die ze gebruikte.',
        ],
      };
    case 'results':
      return {
        id: 'results',
        title: 'De uitslag',
        steps: [
          'Je ziet je punten (kopman dubbel), je premies, je munten en bonuskaarten. De laagste in het klassement krijgt extra hulp.',
          'Training vervaagt nu met 1 per eigenschap. Vermoeidheid zakt langzaam.',
          s.stage >= 3 ? 'Dit was de slotetappe. Zo zie je de eindstand.' : 'Hierna begint een nieuwe draft. Plan je voorbereiding slim.',
        ],
      };
    case 'finished':
      return {
        id: 'finished',
        title: 'Seizoen voorbij',
        steps: ['Het team met de meeste punten wint. De laatste krijgt de rode lantaarn.', 'Nog een keer? De president kan een nieuw seizoen starten.'],
      };
  }
}

/** Grote instructie voor de tv, zodat de zaal weet wat er nu gebeurt. */
export function tvHint(s: PublicState): { title: string; text: string } | null {
  if (!s.tutorial) return null;
  switch (s.phase) {
    case 'briefing':
      return null;
    case 'lobby':
      return { title: 'Meedoen', text: 'Scan de QR-code met je telefoon. De eerste speler is president en start het seizoen.' };
    case 'recruit':
      return { title: 'De winkel', text: 'Iedereen winkelt tegelijk in zijn eigen winkel: kies drie renners en maximaal twee sponsors. Sterren kosten munten, neo-profs en sponsors zijn gratis.' };
    case 'naming':
      return { title: 'Namen', text: 'Op je telefoon: geef je renners een naam en druk op Klaar. Er is geen timer.' };
    case 'draft':
      return { title: 'Op je telefoon', text: 'Ben je aan de beurt? Pak een kaart uit de markt of trek er een van de stapel.' };
    case 'team':
      return {
        title: 'Voorbereiding',
        text: 'Op je telefoon: kies je kopman, train je renners, leg spullen op je bord, koop en ruil. Druk op Klaar als je klaar bent.',
      };
    case 'race':
      return { title: 'Tempo kiezen', text: 'Kies per renner Rustig, Normaal of Alles geven, of laat een knecht helpen. Zet de volgauto bij een renner, eet een gel of blokkeer een tegenstander. Blijf in het peloton en bij je team, want wegrijden kost veel.' };
    case 'resolve':
      return { title: 'Kijk mee', text: 'Drafting, wind en pech bepalen wie vooruit komt. Op je telefoon zie je de uitleg.' };
    case 'results':
      return { title: 'Beloning', text: 'Punten, munten en bonuskaarten. Training vervaagt met 1 punt per eigenschap.' };
    case 'finished':
      return { title: 'Seizoen voorbij', text: 'Het team met de meeste punten wint. De president kan een nieuw seizoen starten.' };
  }
}
