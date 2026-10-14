import type { ComponentChildren } from 'preact';
import { CARD_DEFS, KIND_COLORS, KIND_LABELS } from '../../shared/content';
import type { CardKind } from '../../shared/types';

const GLYPHS: Record<string, string> = {
  duurloop: '🏃',
  kracht: '🏋️',
  interval: '⚡',
  klimstage: '⛰️',
  hoogte: '🏔️',
  kamp: '⛺',
  rustdag: '😴',
  bakker: '🥐',
  bank: '🏦',
  drankje: '🥤',
  mecanicien: '🔧',
  soigneur: '💆',
  ploegleider: '📋',
  voeding: '🥗',
  fysio: '🩺',
  reservefiets: '🚲',
  aerowielen: '💨',
  klimfiets: '🪶',
  volgauto: '🚗',
  teambus: '🚌',
  spijkers: '📌',
  bidon: '🧴',
  gel: '🧃',
  cola: '🚀',
  blok: '🚧',
};

const KIND_GLYPHS: Record<CardKind, string> = {
  training: '💪',
  sponsor: '💰',
  staff: '🧑‍🔧',
  material: '🚲',
  car: '🚗',
  sabotage: '😈',
  race: '🎒',
};

interface CardProps {
  def: string;
  /** `sm`: compact face without rules text (phone grid); `lg`: full card. */
  size?: 'sm' | 'lg';
  /** Show the cost coin. */
  price?: boolean;
  dim?: boolean;
  /** Position in a row: staggers the deal-in animation and, with `fan`, tilts the card. */
  index?: number;
  fan?: boolean;
  onClick?: () => void;
}

/** A playing card: coloured frame, paper face, art window, cost coin. Scales with its own width. */
export function PlayingCard({ def, size = 'lg', price, dim, index = 0, fan, onClick }: CardProps) {
  const d = CARD_DEFS[def];
  if (!d) return null;
  const style: Record<string, string> = { '--k': KIND_COLORS[d.kind], '--i': String(index) };
  if (fan) style['--tilt'] = `${((index - 2) * 1.1).toFixed(2)}deg`;
  const cls = `gc ${size}${dim ? ' dim' : ''}${onClick ? ' tap' : ''}`;
  const body = (
    <span class="gc-frame">
      <span class="gc-face">
        <span class="gc-head">
          <span class="gc-kind">{KIND_LABELS[d.kind]}</span>
          {price && <span class="gc-cost">€{d.price}</span>}
        </span>
        <span class="gc-art">
          <span class="gc-glyph">{GLYPHS[d.id] ?? KIND_GLYPHS[d.kind]}</span>
        </span>
        <span class="gc-name">{d.name}</span>
        <span class="gc-text">{d.text}</span>
        <span class="gc-foot">{KIND_LABELS[d.kind]}</span>
      </span>
    </span>
  );
  return onClick ? (
    <button type="button" class={cls} style={style} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div class={cls} style={style}>
      {body}
    </div>
  );
}

/** The face-down draw pile. */
export function CardBack({ count, index = 0 }: { count: number; index?: number }) {
  return (
    <div class="gc back lg" style={{ '--i': String(index) } as Record<string, string>}>
      <span class="gc-frame">
        <span class="gc-backface">
          <span class="gc-logo">PP</span>
          <span class="gc-count">{count} op de stapel</span>
        </span>
      </span>
    </div>
  );
}

/** A card with its actions underneath, for the phone's detail sheet. */
export function CardDetail({ def, price, children }: { def: string; price?: boolean; children?: ComponentChildren }) {
  return (
    <div class="gc-detail">
      <div class="gc-detail-card">
        <PlayingCard def={def} price={price} />
      </div>
      {children && <div class="pc-actions">{children}</div>}
    </div>
  );
}
