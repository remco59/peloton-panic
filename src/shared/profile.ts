// Parcoursprofiel: tel de terreinsoorten en vat samen wat er onderweg te halen valt.

import { PREMIE_INFO, stageInfo, TERRAINS } from './content';
import type { PublicState, Terrain } from './types';
import { STAGES } from './types';

export interface Profile {
  counts: Record<Terrain, number>;
  climbShare: number; // aandeel klimmende tegels, 0..1
  summary: string; // "22 klim, 14 vlak, 8 kasseien, 4 afdaling"
  premies: string; // "Bergpremie en Tussensprint"
  stageName: string;
  stageBlurb: string;
}

const ORDER: Terrain[] = ['climb', 'flat', 'cobbles', 'descent'];
const LABEL: Record<Terrain, string> = { climb: 'klim', flat: 'vlak', cobbles: 'kasseien', descent: 'afdaling' };

export function stageProfile(s: Pick<PublicState, 'terrain' | 'premies' | 'stage' | 'course'>): Profile {
  const counts: Record<Terrain, number> = { flat: 0, climb: 0, descent: 0, cobbles: 0 };
  for (const t of s.terrain) counts[t] += 1;
  const total = Math.max(1, s.terrain.length);
  const info = stageInfo(s.course, Math.min(STAGES, Math.max(1, s.stage)));
  return {
    counts,
    climbShare: counts.climb / total,
    summary: ORDER.filter((t) => counts[t] > 0)
      .map((t) => `${counts[t]} ${LABEL[t]}`)
      .join(', '),
    premies: s.premies.map((p) => PREMIE_INFO[p.id].label).join(' en '),
    stageName: info.name,
    stageBlurb: info.blurb,
  };
}

export { TERRAINS };
