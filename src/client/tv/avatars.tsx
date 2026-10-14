import type { CommentatorId } from '../../shared/content';

// Flat vector commentators: a circle badge, shoulders, head, hair and a headset.
const LOOK: Record<CommentatorId, { bg: string; hair: string; shirt: string; skin: string; long: boolean; moustache: boolean }> = {
  johan: { bg: '#2a3566', hair: '#6b4423', shirt: '#3e63dd', skin: '#f2c9a0', long: false, moustache: true },
  marieke: { bg: '#5a2a38', hair: '#c9822b', shirt: '#e5484d', skin: '#f2c9a0', long: true, moustache: false },
  fenna: { bg: '#1f4a40', hair: '#3a2a22', shirt: '#2fa37f', skin: '#f2c9a0', long: true, moustache: false },
};

export function Avatar({ who, speaking }: { who: CommentatorId; speaking: boolean }) {
  const l = LOOK[who];
  return (
    <svg class="avatar" viewBox="0 0 64 64" role="img" aria-label={who}>
      <defs>
        <clipPath id={`av-${who}`}>
          <circle cx="32" cy="32" r="32" />
        </clipPath>
      </defs>
      <g clip-path={`url(#av-${who})`}>
        <rect width="64" height="64" fill={l.bg} />
        {l.long && <rect x="14" y="20" width="36" height="34" rx="14" fill={l.hair} />}
        <path d="M6 70c0-16 12-22 26-22s26 6 26 22z" fill={l.shirt} />
        <rect x="27" y="40" width="10" height="10" fill={l.skin} />
        <circle cx="32" cy="29" r="13" fill={l.skin} />
        <path d="M18.5 27c0-9 6-14 13.5-14s13.5 5 13.5 14c-3-5-8-7-13.5-7s-10.5 2-13.5 7z" fill={l.hair} />
        <circle cx="26.5" cy="30" r="1.8" fill="#23242e" />
        <circle cx="37.5" cy="30" r="1.8" fill="#23242e" />
        {l.moustache && <rect x="26" y="34" width="12" height="3" rx="1.5" fill="#4a2f17" />}
        {speaking ? (
          <ellipse class="mouth" cx="32" cy="38.5" rx="3.2" ry="2.6" fill="#7a2e2e" />
        ) : (
          <rect x="29" y="38" width="6" height="1.8" rx="0.9" fill="#a8574f" />
        )}
        {/* headset */}
        <path d="M16.5 30v-3c0-9 6-15 15.5-15s15.5 6 15.5 15v3" fill="none" stroke="#c4c9e2" stroke-width="2.4" stroke-linecap="round" />
        <rect x="13.5" y="27" width="5" height="9" rx="2.5" fill="#c4c9e2" />
        <rect x="45.5" y="27" width="5" height="9" rx="2.5" fill="#c4c9e2" />
      </g>
    </svg>
  );
}
