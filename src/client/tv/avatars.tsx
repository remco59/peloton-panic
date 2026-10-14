import { useEffect, useRef, useState } from 'preact/hooks';
import type { CommentatorId } from '../../shared/content';

// 12x12 pixel faces. Palette: H hair, S skin, E glasses, M moustache, T headset, L mouth, B shirt.
const COMMON = [
  '....HHHH....',
  '...HHHHHH...',
  '..THHHHHHT..',
  '..TSSSSSST..',
  '..TSESSEST..',
  '..TSSSSSST..',
  '...SMMMMS...',
  '...SSLLSS...',
  '....SSSS....',
  '..BBBBBBBB..',
  '.BBBBBBBBBB.',
  '.BBBBBBBBBB.',
];

const MARIEKE = [
  '...HHHHHH...',
  '..HHHHHHHH..',
  '.HTHHHHHHTH.',
  '.HTSSSSSSTH.',
  '.HTSESSESTH.',
  '.HTSSSSSSTH.',
  '..HSSSSSSH..',
  '..HSSLLSSH..',
  '...HSSSSH...',
  '..BBBBBBBB..',
  '.BBBBBBBBBB.',
  '.BBBBBBBBBB.',
];

const PALETTE: Record<CommentatorId, Record<string, string>> = {
  johan: { H: '#6b4423', S: '#f2c9a0', E: '#2b2b33', M: '#4a2f17', T: '#9aa3c7', L: '#7a2e2e', B: '#3e63dd' },
  marieke: { H: '#c9822b', S: '#f2c9a0', E: '#2b2b33', M: '#f2c9a0', T: '#9aa3c7', L: '#7a2e2e', B: '#e5484d' },
};

export function Avatar({ who, speaking }: { who: CommentatorId; speaking: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!speaking) return setOpen(false);
    const id = setInterval(() => setOpen((o) => !o), 130);
    return () => clearInterval(id);
  }, [speaking]);

  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 12, 12);
    const rows = who === 'johan' ? COMMON : MARIEKE;
    rows.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (ch === '.') return;
        let color = PALETTE[who][ch];
        if (ch === 'L' && !open) color = PALETTE[who].S;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      });
    });
  }, [who, open]);

  return <canvas ref={ref} width={12} height={12} class="avatar" />;
}
