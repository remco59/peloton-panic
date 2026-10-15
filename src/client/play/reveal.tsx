// Kaart onthullen: wat je trekt of koopt vliegt even in beeld voordat het in je hand verdwijnt.
// Blind trekken is spannend (rug, schudden, omdraaien); een kaart uit de markt kent je al en komt alleen binnen.

import { useEffect, useRef, useState } from 'preact/hooks';
import { CARD_DEFS, KIND_COLORS, KIND_LABELS } from '../../shared/content';
import type { PlayerAction } from '../../shared/protocol';
import type { Card, PlayerView } from '../../shared/types';
import { CardBack, PlayingCard } from '../common/card';
import { sound } from '../common/sound';
import './reveal.css';

/** blind: van de stapel (onbekend). buy/pick: uit de markt (bekend). */
export type RevealHow = 'blind' | 'buy' | 'pick';

export interface Reveal {
  card: Card;
  how: RevealHow;
}

const INTENT_TTL = 6000;

function howOf(a: PlayerAction): RevealHow | null {
  if (a.type === 'buy') return a.source.kind === 'deck' ? 'blind' : 'buy';
  if (a.type === 'draftPick') return a.source.kind === 'deck' ? 'blind' : 'pick';
  return null;
}

/**
 * Onthoudt dat jij net een kaart nam en koppelt dat aan de nieuwe kaart in je hand. Zo triggeren ruilen,
 * prijzen en andere kaarten die binnenkomen de animatie niet. Gebruik `note` voor elke actie die je verstuurt.
 */
export function useReveal(hand: Card[] | undefined) {
  const intent = useRef<{ how: RevealHow; at: number } | null>(null);
  const known = useRef<Set<string> | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);

  useEffect(() => {
    if (!hand) return;
    const prev = known.current;
    known.current = new Set(hand.map((c) => c.id));
    const i = intent.current;
    if (!prev || !i) return;
    const fresh = hand.filter((c) => !prev.has(c.id));
    if (fresh.length === 0) return;
    intent.current = null;
    if (Date.now() - i.at < INTENT_TTL) setReveal({ card: fresh[fresh.length - 1], how: i.how });
  }, [hand]);

  return {
    reveal,
    note(a: PlayerAction) {
      const how = howOf(a);
      if (how) intent.current = { how, at: Date.now() };
    },
    close: () => setReveal(null),
  };
}

const CAPTION: Record<RevealHow, [before: string, after: string]> = {
  blind: ['Je trekt van de stapel...', 'Dit heb je getrokken!'],
  buy: ['Gekocht!', 'Gekocht!'],
  pick: ['Gepakt!', 'Gepakt!'],
};

// Tijdlijn in ms, gelijk aan de keyframes in reveal.css.
const FLIP_AT = 1000;
const AUTO_CLOSE = { blind: 5500, buy: 1700, pick: 1700 } as const;
const FADE = 220;

export function CardReveal({ reveal, deckCount, onClose }: { reveal: Reveal; deckCount: number; onClose: () => void }) {
  const { card, how } = reveal;
  const d = CARD_DEFS[card.def];
  const blind = how === 'blind';
  const [flipped, setFlipped] = useState(!blind);
  const [closing, setClosing] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);

  const close = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, FADE);
  };

  useEffect(() => {
    const timers: number[] = [];
    if (blind) {
      sound.ui('card');
      timers.push(window.setTimeout(() => sound.ui('card'), 350));
      timers.push(
        window.setTimeout(() => {
          sound.ui('whoosh');
          setFlipped(true);
        }, FLIP_AT),
      );
      timers.push(window.setTimeout(() => sound.ui('ding'), FLIP_AT + 380));
    } else {
      sound.ui('card');
    }
    timers.push(window.setTimeout(close, AUTO_CLOSE[how]));
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (flipped && blind) btn.current?.focus({ preventScroll: true });
  }, [flipped]);

  if (!d) return null;
  return (
    <div
      class={`rv ${how} ${flipped ? 'flipped' : ''} ${closing ? 'closing' : ''}`}
      style={{ '--k': KIND_COLORS[d.kind] } as Record<string, string>}
      role="dialog"
      aria-modal="true"
      aria-label={`${CAPTION[how][1]} ${d.name}`}
      onClick={close}
    >
      <div class="rv-caption ty" aria-live="polite">
        {CAPTION[how][flipped ? 1 : 0]}
      </div>
      <div class="rv-stage">
        <div class="rv-burst" aria-hidden="true" />
        <div class="rv-ring" aria-hidden="true" />
        <div class="rv-card">
          <div class="rv-shake">
            <div class="rv-flipper">
              <div class="rv-face rv-back">
                <CardBack count={deckCount} />
              </div>
              <div class="rv-face rv-front">
                <PlayingCard def={card.def} />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="rv-kind small">{flipped ? KIND_LABELS[d.kind] : ' '}</div>
      {blind && (
        <button ref={btn} type="button" class="big primary ty rv-ok" onClick={close} tabIndex={flipped ? 0 : -1}>
          NAAR MIJN KAARTEN
        </button>
      )}
    </div>
  );
}
