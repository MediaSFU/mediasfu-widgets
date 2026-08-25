export type ActiveCallIdentity = {
  callId: string;
  roomName?: string;
};

const TERMINAL_STATUSES = new Set([
  'ended', 'failed', 'completed', 'rejected', 'terminated',
  'terminating', 'cancelled', 'canceled',
]);

const ACTIVE_STATUSES = new Set([
  'active', 'connected', 'answered', 'connecting', 'ringing',
  'initiating', 'initiated', 'calling', 'trying', 'progress',
  'in-progress', 'in_progress', 'early', 'bridged', 'established',
  'hold', 'on-hold', 'onhold',
]);

function nonEmptyString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

const PLACEHOLDER_ROOM_NAMES = new Set([
  'unknown',
  'n/a',
  'na',
  'none',
  'null',
  'undefined',
  '-',
]);

function getNestedRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

/** Returns only a server-supplied room identifier that is safe to join. */
export function getAuthoritativeCallRoomName(value: unknown): string | null {
  const raw = getNestedRecord(value);
  if (!raw) return null;

  const nestedCandidates = [raw.call, raw.state, raw.data]
    .map(getNestedRecord)
    .filter((candidate): candidate is Record<string, any> => Boolean(candidate));
  const candidates = [raw, ...nestedCandidates];
  const roomValue = candidates
    .map((candidate) => candidate.roomName || candidate.room_name || candidate.roomId || candidate.room_id || candidate.room)
    .map(nonEmptyString)
    .find((roomName) => roomName && !PLACEHOLDER_ROOM_NAMES.has(roomName.toLowerCase()));

  return roomValue || null;
}

export function extractCallRecords(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const body = payload as Record<string, unknown>;
  const nestedData = body.data && typeof body.data === 'object'
    ? body.data as Record<string, unknown>
    : null;
  const candidates = [
    body.data,
    body.calls,
    body.results,
    body.items,
    nestedData?.calls,
    nestedData?.data,
    nestedData?.results,
    nestedData?.items,
  ];

  return (candidates.find(Array.isArray) as unknown[]) || [];
}

export function normalizeCallRecord(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const raw = value as Record<string, any>;
  const sipCallId = nonEmptyString(
    raw.sipCallId || raw.sip_call_id || raw.callId || raw.call_id || raw.callID || raw.id
  );
  if (!sipCallId) return null;

  const roomName = getAuthoritativeCallRoomName(raw);
  return {
    ...raw,
    sipCallId,
    id: nonEmptyString(raw.id) || sipCallId,
    ...(roomName ? { roomName } : {}),
  };
}

const EXPLICIT_LIVE_FLAGS = [
  'isActive',
  'active',
  'isLive',
  'callActive',
  'connected',
] as const;

const EXPLICIT_NOT_ENDED_FLAGS = ['callEnded', 'call_ended', 'ended', 'isTerminated', 'is_terminated'] as const;

export function isActiveCallRecord(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const status = nonEmptyString(record.status).toLowerCase();
  if (TERMINAL_STATUSES.has(status)) return false;
  if (status) return ACTIVE_STATUSES.has(status);

  // A statusless record is not evidence of a live call. Accept it only when
  // an authoritative response explicitly supplies a positive live flag.
  if (EXPLICIT_LIVE_FLAGS.some((field) => record[field] === true)) return true;

  // Some Drachtio responses omit status while explicitly reporting that the call has not ended.
  return EXPLICIT_NOT_ENDED_FLAGS.some((field) => record[field] === false);
}

export function getActiveCallIdentity(value: unknown): ActiveCallIdentity | null {
  const call = normalizeCallRecord(value);
  if (!call || call.sipCallId.toLowerCase().startsWith('dummy_') || !isActiveCallRecord(call)) {
    return null;
  }

  return call.roomName
    ? { callId: call.sipCallId, roomName: call.roomName }
    : { callId: call.sipCallId };
}
