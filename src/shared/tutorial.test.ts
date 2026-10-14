import { describe, expect, it } from 'vitest';
import type { TutorialTopic } from './commentary';
import { tutorialLines } from './commentary';
import { createGame, reduce, toPublic } from './engine';
import { phoneHint, tvHint } from './tutorial';
import type { HintContext } from './tutorial';
import type { Phase, PublicState } from './types';

const ctx: HintContext = { myTurn: false, tab: 'kaarten', handCount: 2, ready: false, locked: false, isPresident: false, coins: 5 };
const PHASES: Phase[] = ['lobby', 'draft', 'team', 'race', 'resolve', 'results', 'finished'];

function stateWith(phase: Phase, tutorial: boolean): PublicState {
  let g = createGame(1);
  g = reduce(g, { type: 'join', name: 'A' });
  g = reduce(g, { type: 'join', name: 'B' });
  g = reduce(g, { type: 'setTutorial', on: tutorial });
  return { ...toPublic(g), phase };
}

describe('tutorial-uitleg', () => {
  it('toont niets als de tutorial uit staat', () => {
    for (const p of PHASES) {
      const s = stateWith(p, false);
      expect(phoneHint(s, ctx)).toBeNull();
      expect(tvHint(s)).toBeNull();
    }
  });

  it('heeft uitleg voor elke fase op telefoon en tv', () => {
    for (const p of PHASES) {
      const s = stateWith(p, true);
      const h = phoneHint(s, ctx);
      expect(h, `telefoon ${p}`).not.toBeNull();
      expect(h!.steps.length).toBeGreaterThan(0);
      expect(h!.title.length).toBeGreaterThan(0);
      const t = tvHint(s);
      expect(t, `tv ${p}`).not.toBeNull();
      expect(t!.text.length).toBeGreaterThan(10);
    }
  });

  it('past de uitleg aan op beurt, tab en vastgelegd tempo', () => {
    const draft = stateWith('draft', true);
    expect(phoneHint(draft, { ...ctx, myTurn: true })!.id).toBe('draft-turn');
    expect(phoneHint(draft, { ...ctx, myTurn: false })!.id).toBe('draft-wait');
    const team = stateWith('team', true);
    const ids = (['kaarten', 'team', 'winkel', 'ruilen'] as const).map((tab) => phoneHint(team, { ...ctx, tab })!.id);
    expect(new Set(ids).size).toBe(4);
    const race = stateWith('race', true);
    expect(phoneHint(race, { ...ctx, locked: true })!.id).toBe('race-locked');
    expect(phoneHint(race, { ...ctx, locked: false })!.id).toBe('race-choose');
  });

  it('wijst bij een lege hand naar winkel of ruilen', () => {
    const team = stateWith('team', true);
    const h = phoneHint(team, { ...ctx, tab: 'kaarten', handCount: 0 })!;
    expect(h.steps[0]).toMatch(/Winkel|Ruilen/);
  });

  it('commentaaruitleg past in een TTS-regel (max 300 tekens) en bestaat voor elk onderwerp', () => {
    const s = toPublic(createGame(1));
    const topics: TutorialTopic[] = ['intro', 'season', 'draft', 'team', 'train', 'trade', 'race', 'resolve', 'exhausted', 'results', 'fade'];
    for (const t of topics) {
      const lines = tutorialLines(t, s);
      expect(lines.length, t).toBeGreaterThan(0);
      for (const l of lines) expect(l.text.length, `${t}: ${l.text}`).toBeLessThanOrEqual(300);
    }
  });
});
