import { useContext, useMemo } from 'react';
import { MediaSFUContext } from './MediaSFUProvider';
import type { MediaSFUActions, MediaSFUContextValue, MediaSFUState } from './types';

/** Returns semantic room state and capability-gated actions from MediaSFUProvider. */
export function useMediaSFU(): MediaSFUContextValue {
  const value = useContext(MediaSFUContext);
  if (!value) {
    throw new Error('useMediaSFU must be used inside a MediaSFUProvider.');
  }
  return value;
}

/** Selects the semantic, serializable room state without exposing controller actions. */
export function useMediaSFUState(): MediaSFUState {
  const value = useMediaSFU();
  return useMemo<MediaSFUState>(() => Object.freeze({
    session: value.session,
    media: value.media,
    devices: value.devices,
    participants: value.participants,
    messages: value.messages,
    permissions: value.permissions,
    actionStates: value.actionStates,
  }), [value.session, value.media, value.devices, value.participants, value.messages, value.permissions, value.actionStates]);
}

/** Selects the stable capability-gated action bag without exposing raw SDK state. */
export function useMediaSFUActions(): MediaSFUActions {
  return useMediaSFU().actions;
}
