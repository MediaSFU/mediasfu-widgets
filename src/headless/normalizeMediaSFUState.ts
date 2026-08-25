import type {
  ActionState,
  MediaSFURole,
  MediaSFUState,
  SemanticMediaControl,
  SemanticDevice,
  SemanticMessage,
  SemanticParticipant,
  SemanticPermissions,
  SessionStatus,
} from './types';

/** Internal SDK state only; this type is intentionally not re-exported. */
type RawSourceParameters = Record<string, unknown>;

const IDLE_ACTION: ActionState = Object.freeze({ status: 'idle' });

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function roleFromRaw(value: unknown, fallback: MediaSFURole): MediaSFURole {
  if (value === 'host' || value === 'cohost' || value === 'participant') return value;
  if (value === '2' || value === 2) return 'host';
  if (value === '1' || value === 1) return 'cohost';
  return fallback;
}

function isAllowed(setting: unknown): boolean {
  return setting === undefined || setting === null || setting === '' || setting === 'allow';
}

function freezeControl(active: boolean, available: boolean): SemanticMediaControl {
  return Object.freeze({ active, available });
}

function normalizeDevices(raw: unknown, kind: 'microphone' | 'camera', fallbackLabel: string): readonly SemanticDevice[] {
  if (!Array.isArray(raw)) return Object.freeze([]);
  const seen = new Set<string>();
  return Object.freeze(raw.flatMap((value, index) => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    const id = readString(item.deviceId) ?? readString(item.id);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [Object.freeze({ id, label: readString(item.label) ?? `${fallbackLabel} ${index + 1}`, kind })];
  }));
}

function normalizeParticipants(raw: unknown, memberId?: string, memberName?: string): readonly SemanticParticipant[] {
  if (!Array.isArray(raw)) return Object.freeze([]);
  // A display name is not an identity. Prefer the SDK member ID whenever it is
  // available; only use the first matching name as a legacy fallback.
  let matchedFallbackName = false;
  return Object.freeze(raw.flatMap((value, index) => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    const id = readString(item.id) ?? readString(item.socketId) ?? `participant-${index}`;
    const name = readString(item.name) ?? id;
    const isSelfById = Boolean(memberId) && id === memberId;
    const isSelfByName = !memberId && !matchedFallbackName && name === memberName;
    if (isSelfByName) matchedFallbackName = true;
    return [Object.freeze({
      id,
      name,
      role: roleFromRaw(item.islevel, 'participant'),
      isSelf: isSelfById || isSelfByName,
      microphoneActive: item.audioOn === true,
      cameraActive: item.videoOn === true,
    })];
  }));
}

function normalizeMessages(raw: unknown): readonly SemanticMessage[] {
  if (!Array.isArray(raw)) return Object.freeze([]);
  return Object.freeze(raw.flatMap((value, index) => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    const text = readString(item.message) ?? readString(item.text);
    if (!text) return [];
    const timestamp = item.timestamp ?? item.time ?? item.createdAt;
    return [Object.freeze({
      id: readString(item.id) ?? `message-${index}`,
      sender: readString(item.sender) ?? readString(item.member) ?? 'Unknown',
      text,
      sentAt: typeof timestamp === 'string' ? timestamp : undefined,
      group: item.group !== false,
    })];
  }));
}

function readyStatus(raw: RawSourceParameters): SessionStatus {
  const alert = readString(raw.alertMessage)?.toLowerCase();
  if (alert && /(failed|error|not found|ended)/.test(alert)) return 'error';
  if (!readString(raw.roomName) || !readString(raw.member) || raw.validated !== true) return 'connecting';
  const socket = raw.socket as { connected?: unknown; emit?: unknown } | undefined;
  if (socket?.connected === true && typeof socket.emit === 'function') return 'ready';
  if (socket && typeof socket.emit === 'function') return 'reconnecting';
  return 'connecting';
}

/**
 * Converts mutable SDK state into a frozen, serializable semantic snapshot.
 * It intentionally drops streams, sockets, functions, device handles, and credentials.
 */
export function normalizeMediaSFUState(
  raw: RawSourceParameters | undefined,
  role: MediaSFURole = 'participant',
): Omit<MediaSFUState, 'actionStates'> {
  const source = raw ?? {};
  const status = readyStatus(source);
  const memberId = readString(source.memberId);
  const displayName = readString(source.member);
  const effectiveRole = roleFromRaw(source.islevel, role);
  const ready = status === 'ready';
  const waitingForRoom = status === 'reconnecting' ? 'Wait for reconnection' : 'Join the room';

  const microphoneReason = !ready
    ? `${waitingForRoom} before using the microphone.`
    : !isAllowed(source.audioSetting)
      ? 'The host has not enabled microphones.'
      : undefined;
  const cameraReason = !ready
    ? `${waitingForRoom} before using the camera.`
    : !isAllowed(source.videoSetting)
      ? 'The host has not enabled cameras.'
      : undefined;
  const screenReason = !ready
    ? `${waitingForRoom} before sharing your screen.`
    : !isAllowed(source.screenshareSetting)
      ? 'The host has not enabled screen sharing.'
      : source.adminRestrictSetting === true && effectiveRole === 'participant'
        ? 'Only hosts and co-hosts can share their screen in this room.'
        : undefined;
  const messageReason = !ready
    ? `${waitingForRoom} before sending a message.`
    : !isAllowed(source.chatSetting)
      ? 'The host has disabled messages.'
      : undefined;

  const permissions: SemanticPermissions = Object.freeze({
    canUseMicrophone: !microphoneReason,
    canUseCamera: !cameraReason,
    canShareScreen: !screenReason,
    canSendMessage: !messageReason,
    microphoneDisabledReason: microphoneReason,
    cameraDisabledReason: cameraReason,
    screenDisabledReason: screenReason,
    messageDisabledReason: messageReason,
  });

  return Object.freeze({
    session: Object.freeze({
      status,
      roomId: readString(source.roomName),
      memberId,
      displayName,
      role: effectiveRole,
      error: status === 'error' ? readString(source.alertMessage) : undefined,
    }),
    media: Object.freeze({
      microphone: freezeControl(source.audioAlreadyOn === true, permissions.canUseMicrophone),
      camera: freezeControl(source.videoAlreadyOn === true, permissions.canUseCamera),
      screen: freezeControl(source.screenAlreadyOn === true, permissions.canShareScreen),
    }),
    devices: Object.freeze({
      microphones: ready ? normalizeDevices(source.audioInputs, 'microphone', 'Microphone') : Object.freeze([]),
      cameras: ready ? normalizeDevices(source.videoInputs, 'camera', 'Camera') : Object.freeze([]),
    }),
    participants: normalizeParticipants(source.participants, memberId, displayName),
    messages: normalizeMessages(source.messages),
    permissions,
  });
}
