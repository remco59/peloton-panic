// Wie rijdt waar en hoe ver zijn ze van elkaar: één bron voor tv en telefoon.

import type { PublicState, Rider } from './types';

export interface StandingRow {
  rider: Rider;
  teamId: string;
  rank: number; // gelijke tegel = gelijke plek, zoals in een echte uitslag
  tile: number; // hele tegel waar de renner nu rijdt
  gapLeader: number; // tegels achter de koploper (0 voor de kop)
  gapAhead: number; // tegels achter de renner direct voor hem (0 = zelfde tegel)
  ahead: Rider | null; // de renner direct voor hem, of null voor de kop
}

/** Alle renners van voor naar achter. Bij gelijke tegel blijft de volgorde van het veld staan. */
export function standing(state: Pick<PublicState, 'riders'>): StandingRow[] {
  const sorted = state.riders
    .map((rider, i) => ({ rider, i, tile: Math.floor(rider.pos) }))
    .sort((a, b) => b.tile - a.tile || a.i - b.i);
  const lead = sorted.length ? sorted[0].tile : 0;
  return sorted.map(({ rider, tile }, k) => {
    const ahead = k > 0 ? sorted[k - 1] : null;
    return {
      rider,
      teamId: rider.teamId,
      rank: 1 + sorted.filter((x) => x.tile > tile).length,
      tile,
      gapLeader: lead - tile,
      gapAhead: ahead ? ahead.tile - tile : 0,
      ahead: ahead ? ahead.rider : null,
    };
  });
}

/** "1 tegel", "3 tegels". */
export const tiles = (n: number) => `${n} ${n === 1 ? 'tegel' : 'tegels'}`;

/** Afstand als korte tekst: "kop", "zelfde tegel" of "−3". */
export function gapLabel(gap: number): string {
  return gap <= 0 ? 'kop' : `−${gap}`;
}
