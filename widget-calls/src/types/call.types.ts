// Call related types - updated to match actual API response
export type CallStatus = 'ringing' | 'active' | 'on-hold' | 'ended' | 'failed' | 'connecting' | 'connected' | 'completed' | 'rejected' | 'terminated' | 'terminating';
export type CallType = 'inbound' | 'outbound';
export type CallDirection = 'incoming' | 'outgoing' | 'inbound' | 'outbound';

export interface Call {
  // Core fields from actual API response
  sipCallId: string;
  status: CallStatus;
  direction: CallDirection;
  startTimeISO: string;
  durationSeconds: number;
  roomName: string;
  callerIdRaw: string;
  calledUri: string;
  audioOnly: boolean;
  activeMediaSource: string;
  humanParticipantName: string | null;
  playingMusic: boolean;
  playingPrompt: boolean;
  currentPromptType: string | null;
  pendingHumanIntervention: boolean;
  callbackState: string;
  callbackPin: string | null;
  activeSpeaker: string | null;
  callEnded: boolean;
  needsCallback: boolean;
  callbackHonored: boolean;
  calledBackRef: string | null;
  agentCreated?: boolean;
  isWidgetCall?: boolean;

  // Computed/legacy fields for compatibility
  id?: string; // Will be mapped from sipCallId
  type?: CallType;
  from?: string; // Parsed from callerIdRaw
  to?: string; // Parsed from calledUri
  phoneNumber?: string; // For compatibility
  callerName?: string; // Parsed from callerIdRaw
  displayName?: string; // Parsed from callerIdRaw
  startTime?: Date; // Converted from startTimeISO
  endTime?: Date;
  duration?: number; // Mapped from durationSeconds
  recordingUrl?: string;
  mediasfuRoomId?: string;
  mediasfuEventType?: string;
  onHold?: boolean; // Derived from status
  participantName?: string; // Mapped from humanParticipantName
}

export interface CallStats {
  totalCalls: number;
  activeCalls: number;
  incomingCalls: number;
  outgoingCalls: number;
  avgDuration: number;
  successRate: number;
  todaysCalls: number;
}

export interface CallRequest {
  to: string;
  from?: string;
  displayName?: string;
  customData?: Record<string, any>;
}

export interface CallResponse {
  success: boolean;
  callId?: string;
  message?: string;
  error?: string;
}

export interface ActiveCallInfo {
  call: Call;
  mediasfuRoom?: {
    roomId: string;
    eventType: string;
    joinUrl: string;
  };
}

// MediaSFU integration types
export interface MediaSFURoom {
  roomId: string;
  eventType: 'chat' | 'broadcast' | 'webinar' | 'conference';
  userName: string;
  apiKey: string;
  apiUserName: string;
}

export interface MediaSFUJoinOptions {
  roomId: string;
  eventType: string;
  userName: string;
  apiKey: string;
  apiUserName: string;
  useLocalUIMode?: boolean;
}

// Parameters for creating outbound calls with human/agent control
export interface CreateCallParams {
  phoneNumber: string; // E.164 format (e.g., "+15559876543")
  roomName: string; // MediaSFU room to connect call to
  callerIdNumber?: string; // E.164 caller ID
  initiatorName?: string; // Name of person making the call
  calleeDisplayName?: string; // Display name for the callee
  startWithHuman?: boolean; // true = start with human audio, false = start with agent/bot
  audioOnly?: boolean; // Audio-only call (no video)
  useBackupPeer?: boolean; // Use backup SIP peer
  sipConfigId?: string; // SIP configuration ID (for SDK calls)
}

// SIP Configuration Types (from MediaSFU API specification)
export interface SIPPeerAuthConfig {
  username?: string;
  password?: string;
}

export interface SIPPeerConfig {
  provider?: string; // Provider name specific to this peer
  host: string; // SIP provider's domain/IP
  port?: number; // Default: 5060
  transport?: "UDP" | "TCP" | "TLS"; // Default: "UDP"
  register?: boolean; // Whether to register with this peer
  auth?: SIPPeerAuthConfig; // Authentication credentials
  providerId?: string; // External identifier for this trunk
}

export interface SIPInitialPromptConfig {
  // --- Fields for autoAgent.type === "AI" ---
  role?: string; // e.g., "Customer Support AI"
  systemPrompt?: string; // Main instructions for the AI
  speakFirst?: boolean; // Default: true. If true, AI speaks first.
  firstMessage?: string; // Default: "Welcome to {companyName}! How can I assist you today?"
  contextPrompt?: string; // Initial context for AI's first turn
  personalityTraits?: string[]; // e.g., ["friendly", "efficient"]
  responseGuidelines?: string; // How AI should structure responses
  fallbackBehavior?: string; // Policy for what the AI should do when uncertain or failing
  fallbackMessage?: string; // Caller-facing fallback copy used when the agent cannot continue
  fallbackResponse?: string; // Alias for fallbackMessage for older integrations
  maxResponseLength?: number; // Default: 250. Max characters/tokens for LLM response
  temperature?: number; // Default: 0.7. LLM creativity (0.0-1.0)
  // Fields for IVR/PLAYBACK types
  type?: "TTS" | "URL"; // Type of prompt
  text?: string; // TTS text
  value?: string; // URL value
}

export interface SIPAutoAgentSourceConfig {
  initialPrompt?: SIPInitialPromptConfig;
}

export interface SIPAutoAgentConfig {
  enabled?: boolean; // Default: false. Master switch for auto agent.
  type?: "AI" | "IVR" | "PLAYBACK"; // Default: "AI". Type of automated agent.
  outgoingType?: "AI" | "IVR" | "PLAYBACK"; // Default: "AI". Type for outgoing/outbound calls.
  source?: SIPAutoAgentSourceConfig;
  humanInterventionWebhookUrl?: string; // Webhook for AI escalation requests
  agentOnlyMode?: boolean; // Default: false. If true, AI handles call entirely.
  humanSupportNA?: boolean; // Default: false. If true, informs caller human support unavailable if escalation fails.
}

export interface SIPConfig {
  id?: string; // Unique identifier
  contactNumber: string; // E.164 format DID (required)
  subusername?: string; // Sub-username for organization
  provider: string; // User-friendly provider name (required)
  supportSipActive?: boolean; // Default: true
  supportSipNameCalls?: boolean; // Default: true - Allow display names
  allowOutgoing?: boolean; // Default: true
  preferPCMA?: boolean; // Default: false - Prefer PCMA codec
  createFreshRoomAlways?: boolean; // Default: false
  sipOnly?: boolean; // Default: false - Restrict to SIP-to-SIP
  audioOnly?: boolean; // Default: true - Enforce audio-only
  autoRecordSip?: boolean; // Default: false
  webhookUrl?: string; // Webhook for events
  secureCode?: string; // Security code
  ipAllowList?: string[]; // Allowed IPs or CIDRs
  ipBlockList?: string[]; // Blocked IPs or CIDRs
  geoAllowList?: string[]; // Allowed country codes (ISO 2-letter)
  geoBlockList?: string[]; // Blocked country codes
  autoAgent?: SIPAutoAgentConfig; // Auto agent configuration
  peer?: SIPPeerConfig; // Primary SIP peer configuration
  backupPeer?: SIPPeerConfig; // Backup SIP peer configuration
  extra?: Array<{ key: string; value: string }>; // Additional parameters

  // Legacy fields for backwards compatibility
  enabled?: boolean; // Maps to supportSipActive
  priority?: number; // Display priority
  name?: string; // Display name (maps to provider)
  phoneNumber?: string; // Display phone (maps to contactNumber)
  sipAddress?: string; // Calculated SIP address
}

// API response structure for call lists
export interface CallListResponse {
  success: boolean;
  calls?: Array<{
    id: string;
    sipCallId: string;
    status: string;
    direction: string;
    calledUri?: string;
    callerIdRaw?: string;
    startTimeISO?: string;
    durationSeconds?: number;
    onHold?: boolean;
    roomName?: string;
    humanParticipantName?: string;
    activeMediaSource?: string;
  }>;
  error?: string;
}
