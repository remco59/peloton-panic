import { describe, expect, it } from 'vitest';
import { gapLabel, standing, tiles } from './standing';
import type { Rider } from './types';

const rider = (id: string, teamId: string, pos: number): Rider =>
  ({ id, teamId, name: id, pos }) as unknown as Rider;

describe('standing', () => {
  const riders = [rider('a', 't1', 4), rider('b', 't2', 9), rider('c', 't1', 9), rider('d', 't2', 6.7)];
  const rows = standing({ riders });

  it('sorteert van voor naar achter en houdt de veldvolgorde bij gelijke tegel', () => {
    expect(rows.map((r) => r.rider.id)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('geeft gelijke plekken aan renners op dezelfde tegel', () => {
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3, 4]);
  });

  it('rekent afstanden in hele tegels', () => {
    expect(rows.map((r) => r.gapLeader)).toEqual([0, 0, 3, 5]);
    expect(rows.map((r) => r.gapAhead)).toEqual([0, 0, 3, 2]);
    expect(rows[2].ahead?.id).toBe('c');
    expect(rows[0].ahead).toBeNull();
  });

  it('kan met een leeg veld overweg', () => {
    expect(standing({ riders: [] })).toEqual([]);
  });

  it('formatteert afstanden', () => {
    expect(gapLabel(0)).toBe('kop');
    expect(gapLabel(3)).toBe('−3');
    expect(tiles(1)).toBe('1 tegel');
    expect(tiles(4)).toBe('4 tegels');
  });
});
