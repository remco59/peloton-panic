// Vangnet voor de toegankelijkheidsbasis van de clients: leesbare tekst, zoom en taal.
// De tv wordt vanaf de bank gelezen en de telefoon in de hand; 13px is de ondergrens voor alles.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname);
const MIN_PX = 13;

function files(dir: string, ext: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? files(p, ext) : p.endsWith(ext) ? [p] : [];
  });
}

describe('toegankelijkheid van de clients', () => {
  it(`gebruikt nergens tekst kleiner dan ${MIN_PX}px`, () => {
    const small: string[] = [];
    for (const file of files(ROOT, '.css')) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const m of line.matchAll(/font-size:\s*([0-9.]+)px/g)) {
            if (Number(m[1]) < MIN_PX) small.push(`${file.replace(ROOT, 'src/client')}:${i + 1} ${m[0]}`);
          }
        });
    }
    expect(small).toEqual([]);
  });

  it('laat inzoomen en zet de taal op Nederlands', () => {
    for (const file of files(ROOT, '.html')) {
      const html = readFileSync(file, 'utf8');
      expect(html, file).toMatch(/<html[^>]*lang="nl"/);
      expect(html, file).not.toMatch(/user-scalable\s*=\s*(no|0)/);
      expect(html, file).not.toMatch(/maximum-scale\s*=\s*1(\.0)?\b/);
    }
  });

  it('heeft een zichtbare toetsenbordfocus voor alles wat je kunt bedienen', () => {
    const theme = readFileSync(join(ROOT, 'common', 'theme.css'), 'utf8');
    expect(theme).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px/);
  });
});
