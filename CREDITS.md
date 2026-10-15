# Credits en licenties

## Geluid (`src/client/public/audio/`)

| Bestand(en) | Bron | Licentie |
| --- | --- | --- |
| `sea`, `forest`, `morning`, `farm`, `pedal`, `rain`, `storm`, `wheel`, `thunder`, `cheer`, `pass-gravel`, `pass-fast`, `car`, `click`, `shout` | [Mixkit](https://mixkit.co) (bronnamen staan in `scripts/build-audio.py`) | [Mixkit Sound Effects Free License](https://mixkit.co/license/#sfxFree) |
| `crowd.mp3` | YouTube-video "Race Crowd Cheering Ambience Sound Effect" | **Onbekend, niet gecontroleerd** |

### Open punt: `crowd.mp3`

Dit bestand is uit een YouTube-video gehaald en de licentie is niet vastgesteld. Voor thuisgebruik
is dat geen probleem, maar **verspreid het spel niet publiek** zolang dit niet is opgelost. Opties:

1. Vervang het door een geluid met een bekende licentie (bijvoorbeeld een publieksgeluid van
   Mixkit): zet de wav in de bronmap, pas de bron van `crowd` aan in `scripts/build-audio.py` en
   draai `python3 scripts/build-audio.py <map>`.
2. Toestemming of een vrije licentie van de maker van het origineel vastleggen en hier invullen.

De UI-geluiden en de claxon zijn gesynthetiseerd en hebben geen bestand nodig.

## Stemmen

De commentaarstemmen komen van Microsoft Edge via [edge-tts](https://github.com/rany2/edge-tts),
een onofficiële client (zie README). Alleen voor gebruik thuis.

## Lettertypen

[Inter](https://fontsource.org/fonts/inter) en
[Barlow Condensed](https://fontsource.org/fonts/barlow-condensed), via Fontsource (SIL Open Font
License 1.1).
