const CALL_BOOTSTRAP_PATTERN = /^[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{43}$/;
const GENERIC_BOOTSTRAP_ERROR = 'Call access is invalid or expired.';

const FIELD_LIMITS = Object.freeze({
  userName: 160,
  apiUserName: 160,
  apiKey: 512,
  islevel: 8,
  sec: 512,
  isWidgetCall: 8,
  widgetKey: 256,
  audioOnly: 8,
  sipCallId: 256,
  callId: 256,
  roomName: 256,
  sipConfigId: 256,
  did: 64,
  callerName: 160,
  callerNumber: 64,
  callerEmail: 255,
  autoRecord: 8,
  autoStartAgent: 8,
  agentName: 160,
  socketUrl: 2048,
  serverCallStarted: 8,
});

const REQUIRED_FIELDS = Object.freeze([
  'userName', 'apiUserName', 'apiKey', 'islevel', 'sec', 'isWidgetCall',
  'widgetKey', 'audioOnly', 'sipCallId', 'callId', 'autoRecord',
  'autoStartAgent',
] as const);

export type WidgetCallBootstrapPayload = Partial<Record<keyof typeof FIELD_LIMITS, string>>;

export type BootstrapRedemption =
  | { valid: true; payload: WidgetCallBootstrapPayload }
  | { valid: false; error: string };

export function captureCallBootstrap(
  locationLike: Pick<Location, 'hash' | 'pathname' | 'search'> = window.location,
  historyLike: Pick<History, 'replaceState' | 'state'> = window.history,
): string {
  if (!locationLike.hash) return '';
  const fragment = new URLSearchParams(locationLike.hash.replace(/^#/, ''));
  if (!fragment.has('bootstrap')) return '';
  const token = fragment.get('bootstrap') || '';
  historyLike.replaceState(historyLike.state, '', `${locationLike.pathname}${locationLike.search}`);
  return CALL_BOOTSTRAP_PATTERN.test(token) ? token : '';
}

export function canonicalBootstrapPayload(value: unknown): WidgetCallBootstrapPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !(key in FIELD_LIMITS))) return null;

  const result: WidgetCallBootstrapPayload = {};
  for (const [key, limit] of Object.entries(FIELD_LIMITS) as Array<[keyof typeof FIELD_LIMITS, number]>) {
    const field = source[key];
    if (field === undefined || field === null || field === '') continue;
    if (typeof field !== 'string' || field.length > limit || /[\0\r\n]/.test(field)) return null;
    result[key] = field;
  }
  if (REQUIRED_FIELDS.some((key) => !result[key])) return null;
  if (result.isWidgetCall !== 'true' || result.audioOnly !== 'true') return null;
  if (!['true', 'false'].includes(result.autoRecord || '') ||
      !['true', 'false'].includes(result.autoStartAgent || '')) return null;
  return Object.freeze(result);
}

export async function redeemCallBootstrap(
  token: string,
  apiBaseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BootstrapRedemption> {
  if (!CALL_BOOTSTRAP_PATTERN.test(token)) {
    return { valid: false, error: GENERIC_BOOTSTRAP_ERROR };
  }
  try {
    const response = await fetchImpl(`${apiBaseUrl}/v1/widget/call-bootstrap/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bootstrap: token }),
      cache: 'no-store',
      credentials: 'same-origin',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) return { valid: false, error: GENERIC_BOOTSTRAP_ERROR };
    const body = await response.json();
    const payload = canonicalBootstrapPayload(body?.success === true ? body.payload : null);
    return payload
      ? { valid: true, payload }
      : { valid: false, error: GENERIC_BOOTSTRAP_ERROR };
  } catch {
    return { valid: false, error: GENERIC_BOOTSTRAP_ERROR };
  }
}

export { CALL_BOOTSTRAP_PATTERN, GENERIC_BOOTSTRAP_ERROR };
