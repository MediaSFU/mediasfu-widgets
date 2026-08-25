import React from 'react';
import { MediaSFUProvider } from '../headless/MediaSFUProvider';
import { useMediaSFU } from '../headless/useMediaSFU';
import type { ActionState, MediaSFUProviderProps, MediaSFUState } from '../headless/types';

/** A small, accessible participant-only join surface using semantic controller data. */
export interface HeadlessMeetingJoinWidgetProps {
  /** Optional legacy room prefix; preserved as a direct prefix of meetingID. */
  readonly roomPrefix?: string;
  /** The room identifier supplied by the host experience. */
  readonly meetingID?: string;
  readonly userName: MediaSFUProviderProps['userName'];
  readonly credentials?: MediaSFUProviderProps['credentials'];
  readonly localLink?: MediaSFUProviderProps['localLink'];
  /** Receives semantic, serializable controller state only. */
  readonly onStateChange?: (state: MediaSFUState) => void;
}

const clean = (value: string | undefined): string => value?.trim() ?? '';

/** Keeps legacy prefix behaviour while treating a blank room ID as invalid. */
export function resolveHeadlessMeetingID(roomPrefix?: string, meetingID?: string): string | undefined {
  const id = clean(meetingID);
  if (!id) return undefined;
  return `${clean(roomPrefix)}${id}`;
}

function actionDisabled(status: string): boolean {
  return status === 'disabled' || status === 'pending';
}

type ActionFeedback = Readonly<{ id: string; message: string; alert: boolean; disabled: boolean }>;

function feedbackFor(id: string, label: string, action: ActionState): ActionFeedback | undefined {
  const alert = action.status === 'error' && Boolean(action.error);
  const disabled = action.status === 'disabled' && Boolean(action.disabledReason);
  const detail = alert ? action.error : disabled ? action.disabledReason : undefined;
  return detail ? Object.freeze({ id, message: label + ': ' + detail, alert, disabled }) : undefined;
}

function HeadlessMeetingJoinControls(): React.ReactElement {
  const { session, media, devices, participants, messages, actionStates, actions } = useMediaSFU();
  const controlId = React.useId();
  const messageInputId = `${controlId}-message-input`;
  const microphoneSelectId = `${controlId}-microphone-select`;
  const cameraSelectId = `${controlId}-camera-select`;
  const microphoneFeedback = feedbackFor(`${controlId}-microphone-feedback`, 'Microphone', actionStates.microphone);
  const cameraFeedback = feedbackFor(`${controlId}-camera-feedback`, 'Camera', actionStates.camera);
  const screenFeedback = feedbackFor(`${controlId}-screen-feedback`, 'Screen share', actionStates.screen);
  const messageFeedback = feedbackFor(`${controlId}-message-feedback`, 'Message', actionStates.message);
  const deviceFeedback = feedbackFor(`${controlId}-device-feedback`, 'Media device', actionStates.device);
  const leaveFeedback = feedbackFor(`${controlId}-leave-feedback`, 'Leave meeting', actionStates.leave);
  const feedback = [microphoneFeedback, cameraFeedback, screenFeedback, messageFeedback, deviceFeedback, leaveFeedback].filter((entry): entry is ActionFeedback => Boolean(entry));
  const stateText = session.status === 'error'
    ? session.error ?? 'The meeting could not be joined.'
    : session.status === 'ready'
      ? 'Connected to the meeting.'
      : session.status === 'reconnecting'
        ? 'Reconnecting to the meeting.'
      : session.status === 'leaving'
        ? 'Leaving the meeting.'
        : session.status === 'left'
          ? 'Left the meeting.'
          : 'Connecting to the meeting.';
  return (
    <section aria-label="Meeting controls" data-media-sfu-status={session.status}>
      <p aria-live="polite">{stateText}</p>
      {session.status === 'error' && <p role="alert">{session.error ?? 'The meeting could not be joined.'}</p>}
      {feedback.map(entry => <p key={entry.id} id={entry.id} role={entry.alert ? 'alert' : undefined} aria-live={entry.alert ? undefined : 'polite'}>{entry.message}</p>)}
      <button type="button" aria-pressed={media.microphone.active} disabled={actionDisabled(actionStates.microphone.status)} aria-describedby={microphoneFeedback?.disabled ? microphoneFeedback.id : undefined} onClick={() => { void actions.toggleMicrophone(); }}>
        {media.microphone.active ? 'Turn microphone off' : 'Turn microphone on'}
      </button>
      <button type="button" aria-pressed={media.camera.active} disabled={actionDisabled(actionStates.camera.status)} aria-describedby={cameraFeedback?.disabled ? cameraFeedback.id : undefined} onClick={() => { void actions.toggleCamera(); }}>
        {media.camera.active ? 'Turn camera off' : 'Turn camera on'}
      </button>
      <button type="button" aria-pressed={media.screen.active} disabled={actionDisabled(actionStates.screen.status)} aria-describedby={screenFeedback?.disabled ? screenFeedback.id : undefined} onClick={() => { void actions.toggleScreenShare(); }}>
        {media.screen.active ? 'Stop sharing screen' : 'Share screen'}
      </button>
      <button type="button" disabled={actionDisabled(actionStates.leave.status)} aria-describedby={leaveFeedback?.disabled ? leaveFeedback.id : undefined} onClick={() => { void actions.leave(); }}>
        Leave meeting
      </button>
      <section aria-label="Media devices">
        <h2>Media devices</h2>
        <label htmlFor={microphoneSelectId}>Microphone</label>
        <select id={microphoneSelectId} defaultValue="" disabled={actionDisabled(actionStates.device.status) || devices.microphones.length === 0} aria-describedby={deviceFeedback?.disabled ? deviceFeedback.id : undefined} onChange={event => { if (event.currentTarget.value) void actions.selectDevice('microphone', event.currentTarget.value); }}>
          <option value="">Choose microphone</option>
          {devices.microphones.map(device => <option key={device.id} value={device.id}>{device.label}</option>)}
        </select>
        <label htmlFor={cameraSelectId}>Camera</label>
        <select id={cameraSelectId} defaultValue="" disabled={actionDisabled(actionStates.device.status) || devices.cameras.length === 0} aria-describedby={deviceFeedback?.disabled ? deviceFeedback.id : undefined} onChange={event => { if (event.currentTarget.value) void actions.selectDevice('camera', event.currentTarget.value); }}>
          <option value="">Choose camera</option>
          {devices.cameras.map(device => <option key={device.id} value={device.id}>{device.label}</option>)}
        </select>
      </section>
      <section aria-label="Participants">
        <h2>Participants</h2>
        {participants.length === 0
          ? <p>No participants yet.</p>
          : <ul>{participants.map(participant => <li key={participant.id} data-media-sfu-self={participant.isSelf ? 'true' : 'false'}><strong>{participant.name}</strong> ({participant.role}) - microphone {participant.microphoneActive ? 'on' : 'off'}, camera {participant.cameraActive ? 'on' : 'off'}</li>)}</ul>}
      </section>
      <section aria-label="Meeting messages">
        <h2>Meeting messages</h2>
        {messages.length === 0
          ? <p aria-live="polite">No messages yet.</p>
          : <ol>{messages.map(message => <li key={message.id}><strong>{message.sender}</strong>: {message.text}</li>)}</ol>}
        <form aria-label="Send meeting message" onSubmit={event => {
          event.preventDefault();
          const form = event.currentTarget;
          const text = String(new FormData(form).get('message') ?? '').trim();
          if (!text) return;
          void actions.sendMessage(text).then(result => { if (result.ok) form.reset(); });
        }}>
          <label htmlFor={messageInputId}>Message</label>
          <input id={messageInputId} name="message" type="text" required maxLength={2000} autoComplete="off" disabled={actionDisabled(actionStates.message.status)} aria-describedby={messageFeedback?.disabled ? messageFeedback.id : undefined} />
          <button type="submit" disabled={actionDisabled(actionStates.message.status)} aria-describedby={messageFeedback?.disabled ? messageFeedback.id : undefined}>Send message</button>
        </form>
      </section>
    </section>
  );
}

/** Joins only as a participant, preserving all existing pre-composed widgets. */
export function HeadlessMeetingJoinWidget({ roomPrefix, meetingID, userName, credentials, localLink, onStateChange }: HeadlessMeetingJoinWidgetProps): React.ReactElement {
  return (
    <MediaSFUProvider operation="join" role="participant" meetingId={resolveHeadlessMeetingID(roomPrefix, meetingID)} userName={userName} credentials={credentials} localLink={localLink} onStateChange={onStateChange}>
      <HeadlessMeetingJoinControls />
    </MediaSFUProvider>
  );
}
