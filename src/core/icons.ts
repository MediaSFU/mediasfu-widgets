/**
 * Inline SVG icons for the shipped widgets.
 *
 * The widgets previously drew their icons as emoji (phone, bell, warning and so on). Emoji are
 * painted by the host platform's colour font, which means a MediaSFU widget
 * embedded on a customer's site:
 *   - cannot take the widget's own theme colour,
 *   - looks different on Windows, macOS, Android and Linux,
 *   - and cannot be dimmed - reducing opacity only desaturates it.
 *
 * These are 24x24 stroke paths that inherit `currentColor`, so one icon set
 * works on any background a customer puts the widget on. They are inlined
 * rather than fetched: widgets are distributed standalone over a CDN and must
 * not depend on an icon font being present on the host page.
 *
 * Paths are deliberately minimal - the widgets render them small.
 */

export type IconName =
  | 'phone'
  | 'phoneOff'
  | 'phoneIncoming'
  | 'bell'
  | 'mic'
  | 'micOff'
  | 'video'
  | 'videoOff'
  | 'warning'
  | 'lock'
  | 'unlock'
  | 'user'
  | 'users'
  | 'close'
  | 'chevronDown'
  | 'check'
  | 'rocket'
  | 'cloud'
  | 'star'
  | 'robot'
  | 'play'
  | 'pause'
  | 'keypad'
  | 'arrowDownLeft'
  | 'arrowUpRight';

const PATHS: Record<IconName, string> = {
  phone:
    'M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.24 11.4 11.4 0 0 0 3.6.58 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11.4 11.4 0 0 0 .58 3.6 1 1 0 0 1-.25 1z',
  phoneOff:
    'M10.7 13.3a15.1 15.1 0 0 1-4.1-2.5l2.2-2.2a1 1 0 0 0 .25-1A11.4 11.4 0 0 1 8.5 4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1a17 17 0 0 0 17 17 1 1 0 0 0 1-1v-3.5a1 1 0 0 0-1-1 11.4 11.4 0 0 1-3.6-.58M3 3l18 18',
  phoneIncoming: 'M16 8V3m0 5h5m-5 0 5-5M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.24 11.4 11.4 0 0 0 3.6.58 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11.4 11.4 0 0 0 .58 3.6 1 1 0 0 1-.25 1z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  mic: 'M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zM19 10v1a7 7 0 0 1-14 0v-1M12 18v4',
  micOff: 'M9 5a3 3 0 0 1 6 0v5m-6 1a3 3 0 0 0 5.1 2.1M19 10v1a7 7 0 0 1-11.5 5.4M5 10v1a7 7 0 0 0 2 4.9M12 18v4M3 3l18 18',
  video: 'M23 7l-7 5 7 5V7zM3 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  videoOff: 'M10 5h4a2 2 0 0 1 2 2v3m0 4v3a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2M23 7l-7 5M3 3l18 18',
  warning: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM8 11V7a4 4 0 0 1 7.5-2',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  close: 'M18 6 6 18M6 6l12 12',
  chevronDown: 'M6 9l6 6 6-6',
  check: 'M20 6 9 17l-5-5',
  rocket: 'M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2a2.1 2.1 0 0 0-3-3zM12 15l-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2a12.9 12.9 0 0 1-6.1 11 22 22 0 0 1-3.9 2z',
  cloud: 'M18 10h-1.3A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  robot: 'M12 2v4M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM9 13h.01M15 13h.01M9 17h6',
  play: 'M6 4l14 8-14 8V4z',
  pause: 'M9 4v16M15 4v16',
  keypad:
    'M6 6h.01M12 6h.01M18 6h.01M6 12h.01M12 12h.01M18 12h.01M6 18h.01M12 18h.01M18 18h.01',
  arrowDownLeft: 'M17 7 7 17M17 17H7V7',
  arrowUpRight: 'M7 17 17 7M7 7h10v10',
};

export interface IconOptions {
  /** Pixel size. Widgets render these small, so 14-20 is typical. */
  size?: number;
  /** Stroke width in the 24x24 viewBox. */
  strokeWidth?: number;
  /** Extra class on the <svg>, for per-widget styling hooks. */
  className?: string;
  /**
   * Accessible label. Omit for decorative icons - they get aria-hidden, which
   * is correct when adjacent text already names the thing.
   */
  title?: string;
}

/**
 * SVG markup for an icon.
 *
 * The result is trusted markup and must NOT be passed through an HTML escaper -
 * the widgets escape user-supplied strings, and escaping this would print the
 * raw tags instead of drawing the icon.
 */
export const renderIcon = (name: IconName, options: IconOptions = {}): string => {
  const { size = 16, strokeWidth = 2, className = '', title } = options;
  const d = PATHS[name];
  if (!d) return '';

  const a11y = title
    ? `role="img" aria-label="${title.replace(/"/g, '&quot;')}"`
    : 'aria-hidden="true"';

  const classAttr = `msfu-icon${className ? ` ${className}` : ''}`;

  return (
    `<svg class="${classAttr}"` +
    ` width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"` +
    ` stroke="currentColor" stroke-width="${strokeWidth}"` +
    ` stroke-linecap="round" stroke-linejoin="round" ${a11y}>` +
    `<path d="${d}"/></svg>`
  );
};

/** Is this a name we can draw? */
export const hasIcon = (name: string): name is IconName => name in PATHS;
