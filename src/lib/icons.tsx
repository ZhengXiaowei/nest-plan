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
