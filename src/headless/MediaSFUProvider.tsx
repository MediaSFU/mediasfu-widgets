import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mediasfuSdk from 'mediasfu-reactjs';
import { normalizeMediaSFUState } from './normalizeMediaSFUState';
import type { ActionResult, ActionState, DeviceKind, MediaSFUActions, MediaSFUContextValue, MediaSFUProviderProps, MediaSFUState, MediaSFURole, EndRoomManagementAdapter } from './types';

// mediasfu-reactjs currently publishes one CommonJS artifact for both its
// `import` and `require` conditions. Reading its default namespace keeps this
// package's ESM subpaths directly importable in Node as well as in bundlers.

type ActionName = 'leave' | 'endRoom' | 'microphone' | 'camera' | 'screen' | 'device' | 'message';
type RawParameters = Record<string, any>;
type EmitSocket = { connected?: unknown; emit?: unknown };
type CredentialIdentity = Readonly<{ apiUserName: string; apiKey: string }>;
type ExitRecord = Readonly<{ generation: number; promise: Promise<ActionResult> }>;
type ExitOutcome = Readonly<{ generation: number; status?: 'leaving' | 'left' }>;

const actionError = (value: unknown) => typeof value === 'string' && value.trim() ? value : value instanceof Error && value.message.trim() ? value.message : 'The action could not be completed.';
const idle = (): ActionState => Object.freeze({ status: 'idle' });
const disabled = (reason: string): ActionState => Object.freeze({ status: 'disabled', disabledReason: reason });
const pending = (): ActionState => Object.freeze({ status: 'pending' });
const succeeded = (): ActionState => Object.freeze({ status: 'success' });
const failed = (value: unknown): ActionState => Object.freeze({ status: 'error', error: actionError(value) });
const ok = (effect?: 'exit-requested' | 'server-confirmed', alreadyApplied?: boolean): ActionResult => Object.freeze(effect ? { ok: true, effect, alreadyApplied } : { ok: true });
const no = (value: unknown): ActionResult => Object.freeze({ ok: false, error: actionError(value) });
const stale = (): ActionResult => no('This action belongs to a stale session.');
const actionNames: readonly ActionName[] = Object.freeze(['leave', 'endRoom', 'microphone', 'camera', 'screen', 'device', 'message']);
const sameAction = (left: ActionState, right: ActionState): boolean => left.status === right.status && left.disabledReason === right.disabledReason && left.error === right.error;
const sameState = (left: MediaSFUState, right: MediaSFUState): boolean => JSON.stringify(left) === JSON.stringify(right);
const actionFor = (available: boolean, reason: string): ActionState => available ? idle() : disabled(reason);

function reconcileActionStates(
  normalized: Omit<MediaSFUState, 'actionStates'>,
  current: MediaSFUState,
  generation: number,
  pendingActions: ReadonlyMap<ActionName, number>,
): MediaSFUState['actionStates'] {
  const ready = normalized.session.status === 'ready';
  const role = normalized.session.role;
  const joinReason = 'Join the room before using this action.';
  const microphoneReason = normalized.permissions.microphoneDisabledReason ?? 'The microphone is unavailable.';
  const cameraReason = normalized.permissions.cameraDisabledReason ?? 'The camera is unavailable.';
  const screenReason = normalized.permissions.screenDisabledReason ?? 'Screen sharing is unavailable.';
  const messageReason = normalized.permissions.messageDisabledReason ?? 'Messages are unavailable.';
  const deviceAvailable = normalized.permissions.canUseMicrophone || normalized.permissions.canUseCamera;
  const deviceReason = normalized.permissions.canUseMicrophone ? cameraReason : microphoneReason;
  const desired: Record<ActionName, ActionState> = {
    leave: actionFor(ready && role !== 'host', !ready ? joinReason : 'Hosts must use end room instead of leave.'),
    endRoom: actionFor(ready && role === 'host', !ready ? joinReason : 'Only the host can end the room.'),
    microphone: actionFor(normalized.permissions.canUseMicrophone, microphoneReason),
    camera: actionFor(normalized.permissions.canUseCamera, cameraReason),
    screen: actionFor(normalized.permissions.canShareScreen, screenReason),
    device: actionFor(deviceAvailable, deviceReason),
    message: actionFor(normalized.permissions.canSendMessage, messageReason),
  };
  const actionStates = {} as Record<ActionName, ActionState>;
  for (const name of actionNames) actionStates[name] = pendingActions.get(name) === generation ? current.actionStates[name] : desired[name];
  return Object.freeze(actionStates);
}
const credentialIdentity = (credentials: MediaSFUProviderProps['credentials']): CredentialIdentity => Object.freeze({
  apiUserName: credentials?.apiUserName ?? '',
  apiKey: credentials?.apiKey ?? '',
});

function isMediaSFURole(value: unknown): value is MediaSFURole {
  return value === 'host' || value === 'cohost' || value === 'participant';
}
function isEventType(value: unknown): value is NonNullable<MediaSFUProviderProps['eventType']> {
  return value === 'conference' || value === 'broadcast' || value === 'webinar' || value === 'chat';
}
function isPositiveWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function configurationError(operation: unknown, userName: string, role: unknown, meetingId: unknown, duration: unknown, capacity: unknown, eventType: unknown): string | undefined {
  if (!userName) return 'A user name is required to create or join a room.';
  if (operation !== 'create' && operation !== 'join') return 'Unsupported room operation.';
  if (!isMediaSFURole(role)) return 'Unsupported MediaSFU role.';
  if (operation === 'create') {
    if (role !== 'host') return 'Only the host role can create a room.';
    if (!isPositiveWholeNumber(duration)) return 'Room duration must be a positive whole number of minutes.';
    if (!isPositiveWholeNumber(capacity)) return 'Room capacity must be a positive whole number.';
    if (!isEventType(eventType)) return 'Unsupported event type.';
    return undefined;
  }
  if (typeof meetingId !== 'string' || !meetingId.trim()) return 'A meeting ID is required to join a room.';
  return role === 'host' ? 'Host role must create a room instead of joining one.' : undefined;
}
function initialState(role: MediaSFURole, error?: string): MediaSFUState {
  const wait = error ?? 'Connecting to MediaSFU.';
  return Object.freeze({
    session: Object.freeze({ status: error ? 'error' : 'connecting', role, error }),
    media: Object.freeze({ microphone: Object.freeze({ active: false, available: false }), camera: Object.freeze({ active: false, available: false }), screen: Object.freeze({ active: false, available: false }) }),
    devices: Object.freeze({ microphones: Object.freeze([]), cameras: Object.freeze([]) }),
    participants: Object.freeze([]), messages: Object.freeze([]),
    permissions: Object.freeze({ canUseMicrophone: false, canUseCamera: false, canShareScreen: false, canSendMessage: false, microphoneDisabledReason: wait, cameraDisabledReason: wait, screenDisabledReason: wait, messageDisabledReason: wait }),
    actionStates: Object.freeze({ leave: disabled(wait), endRoom: disabled(wait), microphone: disabled(wait), camera: disabled(wait), screen: disabled(wait), device: disabled(wait), message: disabled(wait) }),
  });
}

export const MediaSFUContext = createContext<MediaSFUContextValue | null>(null);

export function MediaSFUProvider(props: MediaSFUProviderProps): React.ReactElement {
  const { children, operation, userName, role = 'participant', meetingId, duration = 30, capacity = 5, eventType = 'conference', credentials, localLink, endRoomAdapter, onStateChange } = props;
  const normalizedUserName = typeof userName === 'string' ? userName.trim() : '';
  const safeRole: MediaSFURole = isMediaSFURole(role) ? role : 'participant';
  const configError = configurationError(operation, normalizedUserName, role, meetingId, duration, capacity, eventType);
  // This identity intentionally omits API keys. Credential values are compared privately below.
  const identity = JSON.stringify([operation, role, userName, meetingId ?? '', duration, capacity, eventType, localLink ?? '', credentials?.apiUserName ?? '']);
  const nextCredentials = credentialIdentity(credentials);
  const rawRef = useRef<RawParameters>({});
  const generationRef = useRef(0);
  const identityRef = useRef(identity);
  const credentialIdentityRef = useRef<CredentialIdentity>(nextCredentials);
  const endRoomAdapterRef = useRef<EndRoomManagementAdapter | undefined>(endRoomAdapter);
  const exitRef = useRef<ExitRecord | null>(null);
  const exitOutcomeRef = useRef<ExitOutcome>(Object.freeze({ generation: 0 }));
  const pendingActionsRef = useRef<ReadonlyMap<ActionName, number>>(new Map());
  const identityChanged = identityRef.current !== identity;
  const credentialsChanged = credentialIdentityRef.current.apiUserName !== nextCredentials.apiUserName || credentialIdentityRef.current.apiKey !== nextCredentials.apiKey;
  const adapterChanged = endRoomAdapterRef.current !== endRoomAdapter;
  if (identityChanged || credentialsChanged || adapterChanged) {
    identityRef.current = identity;
    credentialIdentityRef.current = nextCredentials;
    endRoomAdapterRef.current = endRoomAdapter;
    generationRef.current += 1;
    rawRef.current = {};
    exitRef.current = null;
    exitOutcomeRef.current = Object.freeze({ generation: generationRef.current });
    pendingActionsRef.current = new Map();
  }
  const generation = generationRef.current;
  const sdkKey = `${identity}:${generation}`;
  const [state, setState] = useState<MediaSFUState>(() => initialState(safeRole, configError));
  useEffect(() => { setState(initialState(safeRole, configError)); }, [generation, safeRole, configError]);
  useEffect(() => { onStateChange?.(state); }, [onStateChange, state]);
  const isCurrent = useCallback((requestGeneration: number): boolean => requestGeneration === generationRef.current, []);
  const updateAction = useCallback((requestGeneration: number, name: ActionName, value: ActionState): void => {
    if (requestGeneration !== generationRef.current) return;
    const pendingActions = new Map(pendingActionsRef.current);
    if (value.status === 'pending') pendingActions.set(name, requestGeneration);
    else if (pendingActions.get(name) === requestGeneration) pendingActions.delete(name);
    pendingActionsRef.current = pendingActions;
    setState(current => {
      if (requestGeneration !== generationRef.current || sameAction(current.actionStates[name], value)) return current;
      return Object.freeze({ ...current, actionStates: Object.freeze({ ...current.actionStates, [name]: value }) });
    });
  }, []);
  const markExited = useCallback((requestGeneration: number, status: 'leaving' | 'left'): boolean => {
    if (!isCurrent(requestGeneration)) return false;
    exitOutcomeRef.current = Object.freeze({ generation: requestGeneration, status });
    setState(current => {
      if (requestGeneration !== generationRef.current || current.session.status === status) return current;
      return Object.freeze({ ...current, session: Object.freeze({ ...current.session, status }) });
    });
    return true;
  }, [isCurrent]);
  const capture = useCallback((next: RawParameters) => {
    const captureGeneration = generation;
    if (!isCurrent(captureGeneration) || configError) return;
    rawRef.current = next;
    const normalized = normalizeMediaSFUState(next, safeRole);
    setState(current => {
      if (!isCurrent(captureGeneration)) return current;
      const outcome = exitOutcomeRef.current;
      const session = outcome.generation === captureGeneration && outcome.status
        ? Object.freeze({ ...normalized.session, status: outcome.status })
        : normalized.session;
      const actionStates = reconcileActionStates(normalized, current, captureGeneration, pendingActionsRef.current);
      const nextState = Object.freeze({ ...normalized, session, actionStates });
      return sameState(current, nextState) ? current : nextState;
    });
  }, [configError, generation, isCurrent, safeRole]);
  const fresh = useCallback((): RawParameters => { const current = rawRef.current; return typeof current.getUpdatedAllParams === 'function' ? current.getUpdatedAllParams() : current; }, []);
  const gate = useCallback((name: ActionName, allowed: boolean, reason: string): ActionResult | null => {
    if (!isCurrent(generation)) return stale();
    const outcome = exitOutcomeRef.current;
    if (outcome.generation === generation && outcome.status) return no('This session has already been exited.');
    if (configError) return no(configError);
    if (allowed) return null;
    updateAction(generation, name, disabled(reason));
    return no(reason);
  }, [configError, generation, isCurrent, updateAction]);
  const run = useCallback(async (requestGeneration: number, name: ActionName, task: () => Promise<void>, effect?: 'exit-requested' | 'server-confirmed'): Promise<ActionResult> => {
    if (!isCurrent(requestGeneration)) return stale();
    updateAction(requestGeneration, name, pending());
    try {
      await task();
      if (!isCurrent(requestGeneration)) return stale();
      updateAction(requestGeneration, name, succeeded());
      return ok(effect);
    } catch (error) {
      if (!isCurrent(requestGeneration)) return stale();
      updateAction(requestGeneration, name, failed(error));
      return no(error);
    }
  }, [isCurrent, updateAction]);
  const leave = useCallback(async (): Promise<ActionResult> => {
    const requestGeneration = generation;
    if (!isCurrent(requestGeneration)) return stale();
    const authorization = normalizeMediaSFUState(fresh(), safeRole);
    if (authorization.session.role === 'host') return no('Hosts cannot leave through leave(); use endRoom() to request a local exit.');
    const existing = exitRef.current;
    if (existing?.generation === requestGeneration) return existing.promise;
    const snapshot = normalizeMediaSFUState(fresh(), safeRole);
    const blocked = gate('leave', snapshot.session.status === 'ready', 'Join the room before leaving it.');
    if (blocked) return blocked;
    const request = run(requestGeneration, 'leave', async () => {
      if (!isCurrent(requestGeneration)) return;
      const p = fresh();
      await mediasfuSdk.confirmExit({ member: p.member, socket: p.socket, localSocket: p.localSocket, roomName: p.roomName, ban: false });
      if (!isCurrent(requestGeneration)) return;
      markExited(requestGeneration, 'leaving');
    }, 'exit-requested');
    const record: ExitRecord = Object.freeze({ generation: requestGeneration, promise: request });
    if (!isCurrent(requestGeneration)) return stale();
    exitRef.current = record;
    try {
      return await request;
    } finally {
      if (isCurrent(requestGeneration) && exitRef.current === record) exitRef.current = null;
    }
  }, [fresh, gate, generation, isCurrent, markExited, safeRole, run]);
  const endRoom = useCallback(async (): Promise<ActionResult> => {
    const requestGeneration = generation;
    if (!isCurrent(requestGeneration)) return stale();
    const authorization = normalizeMediaSFUState(fresh(), safeRole);
    if (authorization.session.role !== 'host') return no('Only the host can request room end locally.');
    const existing = exitRef.current;
    if (existing?.generation === requestGeneration) return existing.promise;
    const snapshot = normalizeMediaSFUState(fresh(), safeRole);
    const blocked = gate('endRoom', snapshot.session.status === 'ready', 'Join the room before ending it.');
    if (blocked) return blocked;
    const adapter = endRoomAdapter;
    if (!adapter) {
      const request = run(requestGeneration, 'endRoom', async () => {
        if (!isCurrent(requestGeneration)) return;
        const p = fresh();
        await mediasfuSdk.confirmExit({ member: p.member, socket: p.socket, localSocket: p.localSocket, roomName: p.roomName, ban: false });
        if (!isCurrent(requestGeneration)) return;
        markExited(requestGeneration, 'leaving');
      }, 'exit-requested');
      const record: ExitRecord = Object.freeze({ generation: requestGeneration, promise: request });
      if (!isCurrent(requestGeneration)) return stale();
      exitRef.current = record;
      try {
        return await request;
      } finally {
        if (isCurrent(requestGeneration) && exitRef.current === record) exitRef.current = null;
      }
    }
    const request = (async (): Promise<ActionResult> => {
      if (!isCurrent(requestGeneration)) return stale();
      updateAction(requestGeneration, 'endRoom', pending());
      try {
        const response = await adapter.endRoom();
        if (!isCurrent(requestGeneration)) return stale();
        if (!response.ok) {
          updateAction(requestGeneration, 'endRoom', failed(response.error));
          return response;
        }
        if (!markExited(requestGeneration, 'left') || !isCurrent(requestGeneration)) return stale();
        updateAction(requestGeneration, 'endRoom', succeeded());
        return ok('server-confirmed', response.alreadyApplied);
      } catch (error) {
        if (!isCurrent(requestGeneration)) return stale();
        updateAction(requestGeneration, 'endRoom', failed(error));
        return no(error);
      }
    })();
    const record: ExitRecord = Object.freeze({ generation: requestGeneration, promise: request });
    if (!isCurrent(requestGeneration)) return stale();
    exitRef.current = record;
    try {
      return await request;
    } finally {
      if (isCurrent(requestGeneration) && exitRef.current === record) exitRef.current = null;
    }
  }, [endRoomAdapter, fresh, gate, generation, isCurrent, markExited, run, safeRole, updateAction]);
  const media = useCallback((name: 'microphone' | 'camera' | 'screen', fn: (p: any) => Promise<void>) => async (): Promise<ActionResult> => {
    const requestGeneration = generation;
    if (!isCurrent(requestGeneration)) return stale();
    const s = normalizeMediaSFUState(fresh(), safeRole);
    const allowed = name === 'microphone' ? s.permissions.canUseMicrophone : name === 'camera' ? s.permissions.canUseCamera : s.permissions.canShareScreen;
    const reason = name === 'microphone' ? s.permissions.microphoneDisabledReason : name === 'camera' ? s.permissions.cameraDisabledReason : s.permissions.screenDisabledReason;
    const blocked = gate(name, allowed, reason ?? 'This media action is unavailable.');
    return blocked ?? run(requestGeneration, name, () => fn(fresh()));
  }, [fresh, gate, generation, isCurrent, safeRole, run]);
  const toggleMicrophone = useCallback(() => media('microphone', p => mediasfuSdk.clickAudio({ parameters: p }))(), [media]);
  const toggleCamera = useCallback(() => media('camera', p => mediasfuSdk.clickVideo({ parameters: p }))(), [media]);
  const toggleScreenShare = useCallback(() => media('screen', p => mediasfuSdk.clickScreenShare({ parameters: p }))(), [media]);
  const selectDevice = useCallback(async (kind: DeviceKind, deviceId: string): Promise<ActionResult> => {
    const requestGeneration = generation;
    if (!isCurrent(requestGeneration)) return stale();
    if (kind !== 'microphone' && kind !== 'camera') return no('Unsupported device kind.');
    const s = normalizeMediaSFUState(fresh(), safeRole);
    const allowed = kind === 'microphone' ? s.permissions.canUseMicrophone : s.permissions.canUseCamera;
    const blocked = gate('device', Boolean(deviceId.trim()) && allowed, 'Choose an enabled microphone or camera device.');
    if (blocked) return blocked;
    return run(requestGeneration, 'device', async () => {
      const p = fresh();
      if (kind === 'microphone') await mediasfuSdk.switchUserAudio({ audioPreference: deviceId, parameters: p as any });
      else await mediasfuSdk.switchUserVideo({ videoPreference: deviceId, checkoff: false, parameters: p as any });
    });
  }, [fresh, gate, generation, isCurrent, safeRole, run]);
  const sendMessage = useCallback(async (text: string): Promise<ActionResult> => {
    const requestGeneration = generation;
    if (!isCurrent(requestGeneration)) return stale();
    const s = normalizeMediaSFUState(fresh(), role);
    const p = fresh();
    const local = p.localSocket as EmitSocket | undefined;
    const primary = p.socket as EmitSocket | undefined;
    const socket = local?.connected === true && typeof local.emit === 'function' ? local : primary?.connected === true && typeof primary.emit === 'function' ? primary : undefined;
    const blocked = gate('message', Boolean(text.trim()) && s.permissions.canSendMessage && Boolean(socket), socket ? (s.permissions.messageDisabledReason ?? 'Messages are unavailable.') : 'No connected message socket is available.');
    if (blocked) return blocked;
    return run(requestGeneration, 'message', () => mediasfuSdk.sendMessage({ member: p.member, islevel: p.islevel, showAlert: p.showAlert, coHostResponsibility: p.coHostResponsibility ?? [], coHost: p.coHost ?? '', chatSetting: p.chatSetting ?? 'allow', message: text.trim(), roomName: p.roomName, messagesLength: Array.isArray(p.messages) ? p.messages.length : 0, receivers: [], group: true, sender: p.member, socket: socket as any }));
  }, [fresh, gate, generation, isCurrent, role, run]);
  const actions = useMemo<MediaSFUActions>(() => Object.freeze({ leave, endRoom, toggleMicrophone, toggleCamera, toggleScreenShare, selectDevice, sendMessage }), [endRoom, leave, selectDevice, sendMessage, toggleCamera, toggleMicrophone, toggleScreenShare]);
  const value = useMemo<MediaSFUContextValue>(() => Object.freeze({ ...state, actions }), [actions, state]);
  const options = useMemo(() => operation === 'create' ? { action: 'create', duration, capacity, userName: normalizedUserName, eventType, recordOnly: false, dataBuffer: true, bufferType: 'all' } : { action: 'join', userName: normalizedUserName, meetingID: meetingId ?? '' }, [operation, duration, capacity, normalizedUserName, eventType, meetingId]);
  return <MediaSFUContext.Provider value={value}>{!configError && <mediasfuSdk.ModernMediasfuGeneric key={sdkKey} returnUI={false} connectMediaSFU={true} sourceParameters={rawRef.current} updateSourceParameters={capture} noUIPreJoinOptions={options as any} credentials={credentials} localLink={localLink} />}{children}</MediaSFUContext.Provider>;
}
