// Motion helpers shared by tv and phone. CSS owns the keyframes; this file only covers what CSS cannot
// know: that a value just changed, or that a list was re-ordered.

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

export const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Returns a class name that replays a short flash each time `value` changes (never on first render).
 * Two alternating names make the animation restart when the value changes again mid-flash.
 */
export function useBump(value: number | string): string {
  const prev = useRef(value);
  const flips = useRef(0);
  const [cls, setCls] = useState('');
  useEffect(() => {
    if (prev.current === value) return;
    const up = typeof value === 'number' && typeof prev.current === 'number' ? value > prev.current : true;
    prev.current = value;
    flips.current += 1;
    setCls(`bump-${up ? 'up' : 'down'} bump-${flips.current % 2 ? 'a' : 'b'}`);
    const id = setTimeout(() => setCls(''), 700);
    return () => clearTimeout(id);
  }, [value]);
  return cls;
}

/** The previous value of `value` that differs from the current one, once it has changed. */
export function useChanged<T>(value: T, hold = 1800): T | null {
  const prev = useRef(value);
  const [changed, setChanged] = useState<T | null>(null);
  useEffect(() => {
    if (prev.current === value) return;
    prev.current = value;
    setChanged(value);
    const id = setTimeout(() => setChanged(null), hold);
    return () => clearTimeout(id);
  }, [value, hold]);
  return changed;
}

/**
 * FLIP for a list: children marked `data-flip="<id>"` glide from where they were to where they now are
 * whenever a render re-orders or re-flows them. Runs after every render; a no-op without movement.
 * An animation interrupted by a new render continues from where the row visibly is, so rows never jump.
 */
export function useFlip(ref: RefObject<HTMLElement | null>, duration = 800): void {
  const last = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const skip = reducedMotion() || document.hidden;
    const next = new Map<string, number>();
    for (const el of root.querySelectorAll<HTMLElement>('[data-flip]')) {
      const id = el.dataset.flip!;
      const running = el.getAnimations();
      const shown = el.getBoundingClientRect().top;
      for (const a of running) a.cancel();
      const settled = el.getBoundingClientRect().top;
      next.set(id, settled);
      const before = last.current.get(id);
      if (before === undefined || skip) continue;
      const offset = running.length ? shown - settled : 0;
      const dy = before + offset - settled;
      if (Math.abs(dy) < 2) continue;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], {
        duration,
        easing: EASE_OUT,
      });
    }
    last.current = next;
  });
}

/** Counts from 0 up to `to` once on mount. Shows the final value straight away under reduced motion. */
export function useCountUp(to: number, ms = 650): number {
  const [n, setN] = useState(reducedMotion() ? to : 0);
  useEffect(() => {
    if (reducedMotion()) {
      setN(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      setN(Math.round(to * (1 - Math.pow(1 - p, 4))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return n;
}
