// Phone sounds: a click for every button, plus a cue when the game wants your attention.
// The phone plays no ambience: the TV owns the room, the phone only answers your thumb.

import { useEffect, useRef } from 'preact/hooks';
import type { PlayerView, PublicState } from '../../shared/types';
import { sound } from '../common/sound';
import type { UiId } from '../common/sound';

function clickSound(el: HTMLElement): UiId {
  if (el.closest('.gc')) return 'card';
  if (el.matches('.primary')) return 'ok';
  if (el.matches('.x, .link-btn, [aria-label="Sluiten"]')) return 'back';
  if (el.matches('.tab, .pill, .strip-btn, .kop-pick, .info, .hint-btn')) return 'tick';
  return 'tap';
}

/** Call once. Unlocks audio on the first touch and plays a sound for every button press. */
export function installClickSounds(): void {
  document.addEventListener(
    'pointerdown',
    () => {
      sound.unlock();
    },
    { capture: true },
  );
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('button, [role="button"]');
      if (!el || el.matches(':disabled, [aria-disabled="true"]')) return;
      sound.ui(clickSound(el));
    },
    { capture: true },
  );
}

interface Seen {
  phase: PublicState['phase'];
  coins: number;
  offers: number;
  turn: boolean;
}

/** Cues driven by the game state: your draft turn, a trade offer, money, a new phase. */
export function useCues(
  view: { state: PublicState; me: PlayerView | null; teamId: string },
  error: string | null,
): void {
  const seen = useRef<Seen | null>(null);
  const { state, me, teamId } = view;
  const coins = state.teams.find((t) => t.id === teamId)?.coins ?? 0;

  useEffect(() => {
    const now: Seen = { phase: state.phase, coins, offers: me?.offersIn.length ?? 0, turn: !!me?.pickPending };
    const was = seen.current;
    seen.current = now;
    if (!was) return;
    if (now.phase !== was.phase) {
      if (now.phase === 'finished') sound.ui(state.season?.winnerTeamId === teamId ? 'fanfare' : 'ding');
      else if (now.phase === 'results') sound.ui('ding');
      else if (now.phase === 'race') sound.ui('go');
      else if (now.phase !== 'resolve') sound.ui('whoosh');
      return;
    }
    if (now.turn && !was.turn) sound.ui('turn');
    else if (now.offers > was.offers) sound.ui('ding');
    else if (now.coins > was.coins) sound.ui('coin');
  }, [state.phase, coins, me?.offersIn.length, me?.pickPending]);

  useEffect(() => {
    if (error) sound.ui('error');
  }, [error]);
}
