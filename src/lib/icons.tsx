/** 少量线性图标，1.6px 描边，跟随文字颜色 */
const base = {width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round'} as const;

export const IconUndo = () => (
  <svg {...base} aria-hidden><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
);
export const IconRedo = () => (
  <svg {...base} aria-hidden><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg>
);
export const IconFit = () => (
  <svg {...base} aria-hidden><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
);
export const IconSpark = () => (
  <svg {...base} aria-hidden><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></svg>
);
export const IconRotate = () => (
  <svg {...base} aria-hidden><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>
);
export const IconTrash = () => (
  <svg {...base} aria-hidden><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
);
export const IconCube = () => (
  <svg {...base} aria-hidden><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></svg>
);
export const BrandMark = () => (
  <svg className="np-brand-mark" viewBox="0 0 32 32" aria-hidden>
    <rect width="32" height="32" rx="7" fill="#2747D6" />
    <path d="M7 25V12l9-6 9 6v13" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" />
    <path d="M12 25v-7h8v7" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" />
  </svg>
);
export const IconPlay = () => (
  <svg {...base} aria-hidden><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>
);
export const IconPause = () => (
  <svg {...base} aria-hidden><path d="M8 5v14M16 5v14" strokeWidth={2.6} /></svg>
);
export const IconRestart = () => (
  <svg {...base} aria-hidden><path d="M4 12a8 8 0 1 0 2.3-5.7" /><path d="M4 4v5h5" /></svg>
);
export const IconVideo = () => (
  <svg {...base} aria-hidden><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></svg>
);
export const IconPlus = () => (
  <svg {...base} aria-hidden><path d="M12 5v14M5 12h14" /></svg>
);
export const IconMinus = () => (
  <svg {...base} aria-hidden><path d="M5 12h14" /></svg>
);
export const IconLayers = () => (
  <svg {...base} aria-hidden><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></svg>
);
export const IconFile = () => (
  <svg {...base} aria-hidden><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5" /></svg>
);
export const IconCopy = () => (
  <svg {...base} aria-hidden><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
);
export const IconSun = () => (
  <svg {...base} aria-hidden><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
);
export const IconHeartPulse = () => (
  <svg {...base} aria-hidden><path d="M20.4 12.6 12 21l-8.4-8.4A5 5 0 0 1 12 6a5 5 0 0 1 8.4 6.6z" /><path d="M3 12h4l2-3 3 6 2-3h7" /></svg>
);
export const IconUsers = () => (
  <svg {...base} aria-hidden><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14a6.5 6.5 0 0 1 3 6" /></svg>
);
export const IconShare = () => (
  <svg {...base} aria-hidden><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>
);
export const IconPin = () => (
  <svg {...base} aria-hidden><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
);
export const IconCheck = () => (
  <svg {...base} aria-hidden><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
);
export const IconSend = () => (
  <svg {...base} aria-hidden><path d="M21 3 10 14M21 3l-7 18-4-7-7-4z" /></svg>
);
