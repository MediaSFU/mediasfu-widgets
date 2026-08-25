/**
 * Public, semantic contract for the Phase C React controller.
 *
 * This module deliberately contains no sockets, credentials, MediaStreams, or
 * SDK helper bags. Those stay inside MediaSFUProvider.
 */

export type MediaSFURole = 'host' | 'cohost' | 'participant';
export type SessionStatus = 'idle' | 'connecting' | 'reconnecting' | 'ready' | 'leaving' | 'left' | 'error';
export type ActionStatus = 'idle' | 'pending' | 'success' | 'error' | 'disabled';
export type DeviceKind = 'microphone' | 'camera';

/** Stable outcome returned by every public controller action. */
export type ActionResult =
  | Readonly<{ ok: true; effect?: 'exit-requested' | 'server-confirmed'; alreadyApplied?: boolean }>
  | Readonly<{ ok: false; error: string }>;

export interface ActionState {
  readonly status: ActionStatus;
  readonly disabledReason?: string;
  readonly error?: string;
}

export interface SemanticSession {
  readonly status: SessionStatus;
  readonly roomId?: string;
  readonly memberId?: string;
  readonly displayName?: string;
  readonly role: MediaSFURole;
  readonly error?: string;
}

export interface SemanticMediaControl {
  readonly active: boolean;
  readonly available: boolean;
}

export interface SemanticMediaState {
  readonly microphone: SemanticMediaControl;
  readonly camera: SemanticMediaControl;
  readonly screen: SemanticMediaControl;
}

export interface SemanticDevice {
  readonly id: string;
  readonly label: string;
  readonly kind: DeviceKind;
}

export interface SemanticDeviceState {
  readonly microphones: readonly SemanticDevice[];
  readonly cameras: readonly SemanticDevice[];
}

export interface SemanticParticipant {
  readonly id: string;
  readonly name: string;
  readonly role: MediaSFURole;
  readonly isSelf: boolean;
  readonly microphoneActive: boolean;
  readonly cameraActive: boolean;
}

export interface SemanticMessage {
  readonly id: string;
  readonly sender: string;
  readonly text: string;
  readonly sentAt?: string;
  readonly group: boolean;
}

export interface SemanticPermissions {
  readonly canUseMicrophone: boolean;
  readonly canUseCamera: boolean;
  readonly canShareScreen: boolean;
  readonly canSendMessage: boolean;
  readonly microphoneDisabledReason?: string;
  readonly cameraDisabledReason?: string;
  readonly screenDisabledReason?: string;
  readonly messageDisabledReason?: string;
}

export interface MediaSFUState {
  readonly session: SemanticSession;
  readonly media: SemanticMediaState;
  readonly devices: SemanticDeviceState;
  readonly participants: readonly SemanticParticipant[];
  readonly messages: readonly SemanticMessage[];
  readonly permissions: SemanticPermissions;
  readonly actionStates: {
    readonly leave: ActionState;
    readonly endRoom: ActionState;
    readonly microphone: ActionState;
    readonly camera: ActionState;
    readonly screen: ActionState;
    readonly device: ActionState;
    readonly message: ActionState;
  };
}

export interface MediaSFUActions {
  /** Participants and co-hosts use the local SDK leave action, which returns `exit-requested`; hosts must use endRoom. */
  leave(): Promise<ActionResult>;
  /** Hosts use the SDK confirmExit path by default (`exit-requested`); an optional authorized management adapter may return `server-confirmed`. */
  endRoom(): Promise<ActionResult>;
  toggleMicrophone(): Promise<ActionResult>;
  toggleCamera(): Promise<ActionResult>;
  toggleScreenShare(): Promise<ActionResult>;
  selectDevice(kind: DeviceKind, deviceId: string): Promise<ActionResult>;
  sendMessage(text: string): Promise<ActionResult>;
}

export interface MediaSFUContextValue extends MediaSFUState {
  readonly actions: MediaSFUActions;
}

export interface MediaSFUCredentialsInput {
  readonly apiUserName: string;
  readonly apiKey: string;
}

export interface EndRoomManagementAdapter {
  endRoom(): Promise<ActionResult>;
}
export interface MediaSFUProviderProps {
  readonly children?: import('react').ReactNode;
  readonly operation: 'create' | 'join';
  readonly userName: string;
  readonly role?: MediaSFURole;
  readonly meetingId?: string;
  readonly duration?: number;
  readonly capacity?: number;
  readonly eventType?: 'conference' | 'broadcast' | 'webinar' | 'chat';
  readonly credentials?: MediaSFUCredentialsInput;
  readonly localLink?: string;
  /** Authorized owner-scoped management capability; never exposed through context. */
  readonly endRoomAdapter?: EndRoomManagementAdapter;
  readonly onStateChange?: (state: MediaSFUState) => void;
}
