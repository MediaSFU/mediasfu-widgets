import { renderIcon, hasIcon, type IconName } from './icons';

/**
 * Maps the icon tokens customers pass through `contentOverrides` onto the
 * widget icon set.
 *
 * Customers write FontAwesome-style names because that is what the docs show
 * ("fa-phone", "microphone", "faLock"). These used to resolve to emoji, which
 * meant every widget embedded on a customer site rendered platform colour
 * glyphs that could not take the widget's theme and looked different on every
 * operating system. They now resolve to inline SVG from `./icons`.
 *
 * Security note: an unrecognised token resolves to the fallback and is never
 * echoed back into the markup. That property must be preserved - the resolved
 * SVG is inserted unescaped, so anything derived from customer input reaching
 * it would be an injection.
 */
const GLYPH_ALIASES: Record<string, IconName> = {
  warning: 'warning',
  fawarning: 'warning',
  exclamationtriangle: 'warning',
  faexclamationtriangle: 'warning',

  lock: 'lock',
  falock: 'lock',
  unlock: 'unlock',
  faunlock: 'unlock',

  mic: 'mic',
  microphone: 'mic',
  famicrophone: 'mic',
  mute: 'micOff',
  muted: 'micOff',
  microphoneslash: 'micOff',
  famicrophoneslash: 'micOff',

  video: 'video',
  favideo: 'video',
  videocamera: 'video',
  favideocamera: 'video',
  camera: 'video',
  facamera: 'video',
  videoslash: 'videoOff',
  favideoslash: 'videoOff',

  rocket: 'rocket',
  farocket: 'rocket',

  phone: 'phone',
  faphone: 'phone',
  phoneslash: 'phoneOff',
  faphoneslash: 'phoneOff',
  bell: 'bell',
  fabell: 'bell',
  user: 'user',
  fauser: 'user',
  users: 'users',
  fausers: 'users',
  check: 'check',
  facheck: 'check',
  times: 'close',
  fatimes: 'close',
  xmark: 'close',
  faxmark: 'close',
  star: 'star',
  fastar: 'star',
  robot: 'robot',
  farobot: 'robot',
};

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/^fa-/, 'fa')
    .replace(/[^a-z0-9]/g, '');

const extractFaClass = (input: string): string => {
  const classes = input.split(/\s+/).filter(Boolean);
  const found = classes.find(
    (className) =>
      className.startsWith('fa-') &&
      className !== 'fa-solid' &&
      className !== 'fa-regular' &&
      className !== 'fa-brands'
  );
  return found || input;
};

/** The icon name a token maps to, or null when it is not one we draw. */
export const resolveGlyphIconName = (token: unknown): IconName | null => {
  if (typeof token !== 'string' || token.trim().length === 0) return null;
  const source = token.includes(' ') ? extractFaClass(token) : token;
  return GLYPH_ALIASES[normalize(source)] || null;
};

/**
 * Ready-to-insert SVG markup for a customer-supplied icon token.
 *
 * The result is trusted markup and must be inserted WITHOUT HTML escaping -
 * escaping it prints the raw tags. This is safe because the return value is
 * always drawn from the icon set, never from the caller's string.
 */
export const resolveGlyphIcon = (
  token: unknown,
  fallbackIcon: IconName,
  size = 16
): string => {
  const name = resolveGlyphIconName(token);
  return renderIcon(name && hasIcon(name) ? name : fallbackIcon, { size });
};

/*
 * There is deliberately no `resolveGlyphIconToken` export any more.
 *
 * It used to return a bare glyph, and every widget rendered whatever it handed
 * back. Leaving it in place after the migration would have been a trap: it
 * returns an icon *name* now, so any caller still using it would quietly print
 * the word "phone" where an icon belongs. Removing it turns that into a compile
 * error instead of a rendering bug on a customer's site.
 */
