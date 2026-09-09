export type AgentOutputModeNotice = {
  mode?: unknown;
  state?: unknown;
};

export type AgentOutputPlaybackMode =
  | "awaiting-webrtc"
  | "webrtc"
  | "socket-fallback"
  | "legacy-socket";

export type AgentAudioOutputConfig = Record<string, unknown> & {
  preferWebRTCOutput?: boolean;
  recordAgentOutput?: boolean;
};

/** Apply transport/recording defaults without overwriting explicit false values. */
export function withAgentOutputDefaults<T extends AgentAudioOutputConfig>(
  audio: T
): T & { preferWebRTCOutput: boolean; recordAgentOutput: boolean } {
  return {
    ...audio,
    preferWebRTCOutput: audio.preferWebRTCOutput ?? true,
    recordAgentOutput: audio.recordAgentOutput ?? true,
  };
}

export function initialAgentOutputMode(
  audio: AgentAudioOutputConfig
): AgentOutputPlaybackMode {
  return audio.preferWebRTCOutput === false
    ? "legacy-socket"
    : "awaiting-webrtc";
}

/** Ignore unknown/transitional notices so a slow WebRTC track cannot start PCM. */
export function nextAgentOutputMode(
  current: AgentOutputPlaybackMode,
  notice: AgentOutputModeNotice | null | undefined
): AgentOutputPlaybackMode {
  if (notice?.mode === "webrtc" && notice?.state === "active") {
    return "webrtc";
  }
  if (notice?.mode === "socket" && notice?.state === "fallback") {
    return "socket-fallback";
  }
  return current;
}

export function shouldPlaySocketAgentOutput(
  mode: AgentOutputPlaybackMode
): boolean {
  return mode === "socket-fallback" || mode === "legacy-socket";
}

/** Local ownership key; the per-widget instance prevents same-name collisions. */
export function createAgentOutputNamespace(
  roomName: string,
  agentIdentity: string,
  instanceIdentity: string
): string {
  return [roomName, agentIdentity, instanceIdentity]
    .map((part) => String(part || "unknown").trim() || "unknown")
    .join("::");
}
