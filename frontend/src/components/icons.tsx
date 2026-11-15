/** Tiny inline icons (stroke = currentColor). */
const base = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export const IconBack = () => (
  <svg {...base}>
    <circle cx="8" cy="8" r="6" />
    <path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" />
  </svg>
);
export const IconRect = () => (
  <svg {...base}>
    <rect x="2.5" y="3.5" width="11" height="9" rx="1" strokeDasharray="2.2 1.6" />
  </svg>
);
export const IconClose = () => (
  <svg {...base}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);
export const IconChat = () => (
  <svg {...base} width={18} height={18}>
    <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
  </svg>
);
export const IconUpload = () => (
  <svg {...base}>
    <path d="M8 11V3M5 6l3-3 3 3M3 13h10" />
  </svg>
);
export const IconDownload = () => (
  <svg {...base}>
    <path d="M8 3v8M5 8l3 3 3-3M3 13h10" />
  </svg>
);
export const IconSend = () => (
  <svg {...base}>
    <path d="M2.5 8h10M9 4.5L12.5 8 9 11.5" />
  </svg>
);
export const IconMap = () => (
  <svg {...base}>
    <path d="M2 4l4-1.5 4 1.5 4-1.5v9.5l-4 1.5-4-1.5-4 1.5z M6 2.5v9.5 M10 4v9.5" />
  </svg>
);
export const IconList = () => (
  <svg {...base}>
    <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />
  </svg>
);
