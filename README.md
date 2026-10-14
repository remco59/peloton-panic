# Peloton Panic

Een bankhangspel voor 2 tot 6 spelers. De tv is het speelbord, jullie telefoons zijn je hand.
Je managet een ploeg van drie renners door een seizoen van drie etappes: kaarten kiezen,
renners trainen, spullen en staf inkopen, en dan een simpele race waarin jouw voorbereiding
het verschil maakt. Wie laatste eindigt, krijgt de rode lantaarn.

![De race op de tv](docs/screenshots/tv-4-race.png)

## Starten

```bash
npm install
npm run setup:tts   # optioneel: installeert rany2/edge-tts in ./.venv voor de commentatorstemmen
npm run dev
```

- Tv: open <http://localhost:3000> in de browser van de computer of tv.
- Telefoons: scan de QR-code op de tv, of ga naar het adres onder de kamercode. Telefoons moeten
  op hetzelfde wifi zitten als de computer waarop de server draait.
- De eerste speler die meedoet is de **president**: die start het seizoen, voegt bots toe en kan de
  **tutorial-modus** aanzetten.

## Hoe een etappe werkt

1. **Draft**: op de tv ligt een markt van 5 kaarten. Om de beurt pak je er een, of een onbekende
   van de stapel. Het team onderaan het klassement begint.
2. **Voorbereiding** (telefoon): train je renners, leg spullen op je bord, koop extra kaarten met
   munten, ruil met anderen of saboteer iemand (licht).
3. **Race**: elke ronde kies je per renner **Rustig**, **Normaal** of **Alles geven**. Energie,
   training, staf en materiaal bepalen hoe ver je komt. Drafting, wind en pech doen de rest.
4. **Uitslag**: punten voor de top zes, munten voor de uitslag en je sponsors, bonuskaarten voor
   het podium en een troostkaart voor de rode lantaarn.

### Training en overtraining

Training maakt een renner sterker, maar **vervaagt** na elke etappe met 1 per eigenschap. Elke
training kost vermoeidheid. Is die te hoog, dan ben je **overtraind** en word je juist zwakker.
Een rustdag of fysiotherapeut helpt.

### Spullen

| Soort | Voorbeelden |
| --- | --- |
| Training | Duurloop, Krachttraining, Klimstage, Hoogtestage, Trainingskamp, Rustdag |
| Sponsor | Bakkerij, Regiobank, Energiedrank (munten per etappe) |
| Staf | Mecanicien, Soigneur, Ploegleider, Voedingsdeskundige, Fysio |
| Materiaal | Reservefiets, Aero-wielen, Lichte klimfiets |
| Wagen | Volgauto, Teambus |
| Sabotage | Spijkers op de weg, Verwisselde bidons (altijd een lichte hinder, nooit uitschakeling) |

## Tutorial-modus

De president zet de tutorial aan in de lobby. Er is geen apart spel: iedereen speelt gewoon
mee, en de commentatoren leggen onderweg uit wat er gebeurt (draft, voorbereiding, tempo kiezen,
drafting, uitslag), elk onderwerp één keer. Er is meer tijd per fase.

## Commentatoren

Twee commentatoren (Johan en Marieke) vertellen vanuit het spelverloop, in het Nederlands. De stemmen
komen van Microsoft Edge via [edge-tts](https://github.com/rany2/edge-tts), op de server
gegenereerd en gecachet in `.cache/tts`. Zonder edge-tts valt het terug op spraak van de browser en
daarna op ondertitels. Klik één keer op de tv om geluid toe te staan.

Edge TTS is een onofficiële client van een Microsoft-dienst: prima voor een spelletje thuis, maar
niets om een product op te bouwen. Stemmen staan in `src/shared/content.ts`.

## Projectindeling

```
src/shared/   regelmotor (pure reducer), inhoud, commentaar, protocol
src/server/   kamers, WebSocket-server, bots, TTS
src/client/   tv/ (canvas-parcours + panelen) en play/ (telefoon)
scripts/      setup-tts.sh, screenshots.mts
```

De regels zijn `(state, action) -> state` in `src/shared/engine.ts`, dus een heel seizoen is
deterministisch vanaf een seed en gedekt door `npm test`.

## Commando's

| Commando | Wat het doet |
| --- | --- |
| `npm run dev` | Server plus Vite op :3000 |
| `npm test` | Tests van de regelmotor |
| `npm run typecheck` | TypeScript-controle |
| `npm run build` / `npm start` | Productiebuild en server |
| `npm run screenshots` | Speelt een seizoen met bots en slaat screenshots op in `docs/screenshots` (vereist Google Chrome) |

## Screenshots

| | |
|---|---|
| ![Lobby](docs/screenshots/tv-1-lobby.png) | ![Draft](docs/screenshots/tv-2-draft.png) |
| ![Voorbereiding](docs/screenshots/tv-3-team.png) | ![Uitslag](docs/screenshots/tv-6-results.png) |

<p>
<img src="docs/screenshots/phone-2-draft.png" width="220" />
<img src="docs/screenshots/phone-3-kaarten.png" width="220" />
<img src="docs/screenshots/phone-5-race.png" width="220" />
</p>
