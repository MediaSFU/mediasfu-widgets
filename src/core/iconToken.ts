export type ButtonIconName = 'phone' | 'video' | 'headset' | 'none';

const ICON_ALIASES: Record<string, ButtonIconName> = {
  phone: 'phone',
  faphone: 'phone',
  phonealt: 'phone',
  faphonealt: 'phone',
  handset: 'phone',

  video: 'video',
  favideo: 'video',
  videocamera: 'video',
  favideocamera: 'video',
  camera: 'video',

  headset: 'headset',
  faheadset: 'headset',
  headphones: 'headset',
  faheadphones: 'headset',

  none: 'none',
  off: 'none'
};

const sanitizeToken = (token: string): string =>
  token
    .toLowerCase()
    .replace(/^[srlbd]?\s+/, '')
    .replace(/^fa\s+/, '')
    .replace(/^fa-/, 'fa')
    .replace(/^fa/, 'fa')
    .replace(/[^a-z0-9]/g, '');

const extractClassIconToken = (value: string): string | null => {
  const classes = value.split(/\s+/).filter(Boolean);
  const match = classes.find(
    (className) =>
      className.startsWith('fa-') &&
      className !== 'fa-solid' &&
      className !== 'fa-regular' &&
      className !== 'fa-brands'
  );
  return match || null;
};

export const resolveButtonIconToken = (input: unknown, fallback: ButtonIconName = 'phone'): ButtonIconName => {
  if (typeof input !== 'string') return fallback;
  const value = input.trim();
  if (!value) return fallback;

  const source = value.includes(' ') ? extractClassIconToken(value) || value : value;
  const normalized = sanitizeToken(source);

  return ICON_ALIASES[normalized] || fallback;
};

export const isKnownButtonIconToken = (input: unknown): boolean => {
  if (typeof input !== 'string') return false;
  const value = input.trim();
  if (!value) return false;
  const source = value.includes(' ') ? extractClassIconToken(value) || value : value;
  return Boolean(ICON_ALIASES[sanitizeToken(source)]);
};
