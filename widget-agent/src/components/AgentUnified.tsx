/**
 * AgentUnified – Unified AI Agent Widget Component
 *
 * Merges business logic from AgentsVoice + AgentsMultimodal into a single
 * component with a modern pre-session flow and support for voice-only,
 * camera-only, or combined modes.
 *
 * Key changes from originals:
 *   - Pre-session screen replaces auto-connect / welcome modal
 *   - Camera-only mode supported (user types, vision pipeline runs)
 *   - Text input sends to pipeline via socket (fixes /help bug)
 *   - Simplified config (widgetConfig overrides only, no dev model selectors)
 *   - Modern orb + split-panel UI
 *   - All pipeline/socket/AEC business logic preserved exactly
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Socket } from "socket.io-client";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faMicrophone,
  faMicrophoneSlash,
  faVideo,
  faVideoSlash,
  faStop,
  faPause,
  faPlay,
  faPaperPlane,
  faDeaf,
  faAssistiveListeningSystems,
  faTimes,
  faSyncAlt,
} from "@fortawesome/free-solid-svg-icons";

import "./AgentUnified.css";
import {
  toggleAudio,
  toggleVideo,
  disconnectRoom,
  switchCamera,
} from "../hooks/useAudioVideoSDK";
import MediaSFUHandler, { MediaSFUHandlerProps } from "./MediaSFUHandler";
import type { WidgetConfig } from "../hooks/useWidgetAgent";

// ─── Types ──────────────────────────────────────────────────────

type SessionPhase = "presession" | "connecting" | "active" | "ended";
type StartMode = "voice" | "vision" | "both";
export type IdleStyle = "orb" | "card" | "glass" | "welcome";

export interface AgentUnifiedProps {
  baseUrl: string;
  credentials: { apiUserName: string; apiKey: string };
  widgetConfig?: WidgetConfig;
  onDisconnect?: () => void;
  darkMode?: boolean;
  agentName?: string;
  showBranding?: boolean;
  mode?: "voice" | "multimodal";
  idleStyle?: IdleStyle;
  sessionToken?: string;
}

type EncodedSocketAudio =
  | string
  | ArrayBuffer
  | Uint8Array
  | { type?: string; data?: number[] };

type QueuedAudioPlayback =
  | { kind: "encoded"; audio: string }
  | { kind: "pcm16"; audio: EncodedSocketAudio; sampleRate?: number };

type PcmJitterBufferState = {
  key: string;
  chunks: Uint8Array[];
  byteLength: number;
  sampleRate: number;
  started: boolean;
  startTimer: ReturnType<typeof setTimeout> | null;
};

const STREAM_INITIAL_BUFFER_MS = 120;
const STREAM_MAX_START_WAIT_MS = 220;

// ─── Helpers ────────────────────────────────────────────────────

function postToParent(type: string, payload: Record<string, unknown> = {}) {
  if (window.parent && window.parent !== window) {
    let targetOrigin = "*";
    try {
      if (document.referrer) targetOrigin = new URL(document.referrer).origin;
    } catch {
      /* fallback */
    }
    window.parent.postMessage(
      { type: `mediasfu:${type}`, payload },
      targetOrigin
    );
  }
}

function intelligent(text: string): boolean {
  return (
    text !== "It." &&
    text !== "" &&
    text !== "No speech recognized." &&
    text !== "ASR processing failed." &&
    text !== "Sorry, I didn't catch that." &&
    text !== "Sorry, I didn't get that." &&
    text !== "Sorry, I could not understand that."
  );
}

function hasKnowledgeBinding(widgetConfig?: WidgetConfig): boolean {
  const knowledgeBase = widgetConfig?.knowledgeBase || {};
  return Boolean(
    widgetConfig?.knowledgeResourceId ||
      knowledgeBase.resourceId ||
      (knowledgeBase.enabled && (widgetConfig?.knowledgeResourceType || knowledgeBase.resourceType))
  );
}

async function fetchKnowledgeContext(
  baseUrl: string,
  sessionToken: string | undefined,
  query: string
): Promise<string> {
  if (!sessionToken || !query.trim()) return "";

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/widget/knowledge-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken, query, limit: 4 }),
  });

  if (!response.ok) return "";
  const data = await response.json().catch(() => ({}));
  return typeof data.context === "string" ? data.context.trim() : "";
}

function withKnowledgeContext(text: string, context: string): string {
  if (!context) return text;

  return [
    text,
    "Relevant knowledge base context:",
    context,
    "Use the knowledge base context when it is relevant. Do not mention it unless it helps answer the user.",
  ].join("\n\n");
}

function formatRelativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

// ─── Pipeline config ────────────────────────────────────────────

const SESSION_DURATION = 15 * 60 * 1000; // 15 minutes

type RuntimeBlock = Record<string, any> & {
  pipeline: string[];
  ttsParams?: Record<string, any>;
};

type RuntimeConfig = {
  audio: RuntimeBlock;
  vision: RuntimeBlock;
};

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function runtimeObject(value: unknown): Record<string, any> {
  return isPlainObject(value) ? value : {};
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function mergeRuntimeObjects(...values: unknown[]): Record<string, any> {
  return values.reduce<Record<string, any>>((merged, value) => {
    if (isPlainObject(value)) Object.assign(merged, value);
    return merged;
  }, {});
}

function hasUsableValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return value !== undefined && value !== null;
}

function hasExplicitRuntimeConfig(widgetConfig?: WidgetConfig): boolean {
  if (!widgetConfig) return false;
  const keys = [
    "sttNickName",
    "llmNickName",
    "textLlmNickName",
    "visionLlmNickName",
    "visionLLMNickName",
    "visionLlmNickname",
    "visionLLMNickname",
    "ttsNickName",
    "voiceId",
    "speechEngine",
    "realtimeNickName",
    "realtimeProvider",
    "realtimeModel",
    "realtimeUrl",
    "realtimeParams",
    "audioConfig",
    "visionConfig",
    "audio",
    "vision",
  ];
  const record = widgetConfig as Record<string, unknown>;
  return keys.some((key) => {
    if (key === "speechEngine") {
      return firstNonEmptyString(record[key]).toLowerCase() === "realtime";
    }
    return hasUsableValue(record[key]);
  });
}

function pipelineIncludes(value: unknown, stage: string): boolean {
  return Array.isArray(value) && value.some((item) => String(item).trim() === stage);
}

function normalizePipeline(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const normalized = value
    .map((item) => String(item).trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : [...fallback];
}

function createDefaultRuntimeConfig(useDemoDefaults = true): RuntimeConfig {
  const audio: RuntimeBlock = {
    format: "wav",
    channels: 1,
    sampleRate: 16000,
    denoise: {
      enable: true,
      highpass: 200,
      lowpass: 3000,
      detectSilence: true,
      silenceThreshold: -35,
      silenceDuration: 0.25,
      silenceMinDuration: 0.25,
      pauseOnSilence: true,
    },
    pipeline: ["stt", "ttllm", "tts"],
    ttsParams: { voiceId: "", voice: "" },
    returnAudioFormat: "base64",
    returnAll: true,
  };
  const vision: RuntimeBlock = {
    fps: 0.5,
    pipeline: ["visionllm", "tts"],
    ttsParams: { voiceId: "", voice: "" },
    returnAudioFormat: "base64",
    returnAll: true,
  };

  if (useDemoDefaults) {
    audio.sttNickName = "demoGoogleSTT";
    audio.llmNickName = "demoGeminiLLM";
    audio.ttsNickName = "demoGoogleTTS";
    vision.llmNickName = "demoGeminiLLM";
    vision.ttsNickName = "demoGoogleTTS";
  }

  return { audio, vision };
}

const config = createDefaultRuntimeConfig(true);

// ─── Component ──────────────────────────────────────────────────

const AgentUnified: React.FC<AgentUnifiedProps> = ({
  baseUrl,
  credentials,
  widgetConfig,
  onDisconnect,
  darkMode: initialDarkMode = true,
  agentName,
  showBranding = true,
  mode = "multimodal",
  idleStyle = "orb",
  sessionToken,
}) => {
  // ── Phase state machine ─────────────────────────────────────
  const [phase, setPhase] = useState<SessionPhase>("presession");
  const startModeRef = useRef<StartMode>("voice");

  // ── Core refs (from AgentsMultimodal — preserved exactly) ───
  const socket = useRef<Socket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioUnlocked = useRef<boolean>(false);
  const isAudioPlaying = useRef<boolean>(false);
  const audioQueue = useRef<QueuedAudioPlayback[]>([]);
  const audioQueueDraining = useRef<boolean>(false);
  const activeAudioSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const playbackCursor = useRef<number>(0);
  const playbackGeneration = useRef<number>(0);
  const playbackMutedMic = useRef<boolean>(false);
  const streamedAudioPending = useRef<boolean>(false);
  const streamedAudioResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStreamedAudioAt = useRef<number>(0);
  const realtimeAudioAccumulator = useRef<{
    key: string;
    bytes: Uint8Array | null;
    updatedAt: number;
  }>({ key: "", bytes: null, updatedAt: 0 });
  const pcmJitterBuffer = useRef<PcmJitterBufferState | null>(null);
  const agentTextStream = useRef<{ text: string; updatedAt: number }>({
    text: "",
    updatedAt: 0,
  });
  const userTextStream = useRef<{ text: string; updatedAt: number }>({
    text: "",
    updatedAt: 0,
  });
  const socketListenerCleanup = useRef<(() => void) | null>(null);

  const micOn = useRef<boolean>(false);
  const tempMicOn = useRef<boolean>(false);
  const doAEC = useRef<boolean>(true);
  const roomConnected = useRef<boolean>(false);
  const autoCaptureTriggered = useRef<boolean>(false);
  const agentRoom = useRef<string>("");
  const lastCaptureToggleRef = useRef<number>(0);
  const voicePipelineConfirmed = useRef<boolean>(false);
  const realtimeVoiceMode = useRef<boolean>(false);
  const sessionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Source parameters (MediaSFU SDK) ────────────────────────
  const sourceParameters = useRef<Record<string, any>>({});
  const [sourceChanged, setSourceChanged] = useState<number>(0);
  const updateSourceParameters = useCallback((data: Record<string, any>) => {
    sourceParameters.current = data;
    setSourceChanged((prev) => prev + 1);
  }, []);

  const showRoomDetails = useRef<MediaSFUHandlerProps>({
    action: "create",
    name: "agent",
    sourceParameters: sourceParameters.current,
    updateSourceParameters,
  });

  // ── UI states ───────────────────────────────────────────────
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [transcript, setTranscript] = useState<string>("");
  const [videoOn, setVideoOn] = useState<boolean>(false);
  const [showRoom, setShowRoom] = useState<boolean>(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(initialDarkMode);
  const [animate, setAnimate] = useState<boolean>(false);
  const selfVideoRef = useRef<HTMLVideoElement | null>(null);
  const audioLevel = useRef<number>(0);

  // ── Chat ────────────────────────────────────────────────────
  const [chatMessages, setChatMessages] = useState<
    { sender: string; message: string; timestamp: number }[]
  >([]);
  const [chatInput, setChatInput] = useState<string>("");
  const chatBoxRef = useRef<HTMLDivElement | null>(null);

  // ── Toast ───────────────────────────────────────────────────
  const [toast, setToast] = useState<string>("");
  const [toastType, setToastType] = useState<"error" | "success" | "info">(
    "info"
  );
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Periodic tick — refreshes relative timestamps & cooldown UI ──
  const [, setTick] = useState(0);

  // ── Vision time management ──────────────────────────────────
  const totalVisionTime = useRef<number>(0);
  const sessionVisionTime = useRef<number>(0);
  const disableVision = useRef<boolean>(false);
  const sessionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const visionTimeLimitPerCapture = 5000; // 5s per burst
  const visionTimeLimitTotal = 0; // 0 = unlimited

  // ── Vision caption overlay ──────────────────────────────────
  const [visionCaption, setVisionCaption] = useState<string>("");
  const visionCaptionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Mic alert tracking ──────────────────────────────────────
  const lastMicAlert = useRef<number>(0);

  // ═══════════════════════════════════════════════════════════════
  // AUDIO PLAYBACK — preserved exactly from AgentsMultimodal
  // ═══════════════════════════════════════════════════════════════

  const unlockAudioContext = async () => {
    if (!audioContextRef.current) audioContextRef.current = new AudioContext();
    if (audioContextRef.current.state === "suspended") {
      try {
        await audioContextRef.current.resume();
        audioUnlocked.current = true;
      } catch (e) {
        console.error("AudioContext unlock failed:", e);
      }
    }
  };

  const showToast = useCallback(
    (message: string, type: "error" | "success" | "info" = "info") => {
      setToast(message);
      setToastType(type);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(""), 4000);
    },
    []
  );

  const pushMsg = (sender: string, message: string) =>
    setChatMessages((prev) => [...prev, { sender, message, timestamp: Date.now() }]);

  const normalizeMessageText = (value: unknown): string =>
    typeof value === "string" ? value.trim() : "";

  const compactMessageText = (value: string): string =>
    value.replace(/\s+/g, " ").trim().toLowerCase();

  const joinTextFragment = (current: string, fragment: string): string => {
    const next = normalizeMessageText(fragment);
    if (!next) return current;
    if (!current) return next;
    if (next.startsWith(current)) return next;
    if (current.endsWith(next)) return current;
    const needsSpace =
      !/[\s([{'"“‘]$/.test(current) && !/^[\s.,!?;:;)\]}]/.test(next);
    return `${current}${needsSpace ? " " : ""}${next}`;
  };

  const upsertStreamingMessage = (
    sender: string,
    fragment: string,
    streamRef: React.MutableRefObject<{ text: string; updatedAt: number }>,
    options: { prefix?: string; windowMs?: number } = {}
  ) => {
    const text = normalizeMessageText(fragment);
    if (!text) return;

    const now = Date.now();
    const windowMs = options.windowMs ?? 10000;
    const hadActiveStream =
      Boolean(streamRef.current.text) &&
      now - streamRef.current.updatedAt < windowMs;
    const mergedText = hadActiveStream
      ? joinTextFragment(streamRef.current.text, text)
      : text;
    const displayText = `${options.prefix || ""}${mergedText}`;

    streamRef.current = { text: mergedText, updatedAt: now };

    setChatMessages((prev) => {
      if (!hadActiveStream) {
        return [...prev, { sender, message: displayText, timestamp: now }];
      }

      const updated = [...prev];
      for (let index = updated.length - 1; index >= 0; index -= 1) {
        const candidate = updated[index];
        if (candidate.sender === sender && now - candidate.timestamp < windowMs) {
          updated[index] = { ...candidate, message: displayText };
          return updated;
        }
      }

      return [...updated, { sender, message: displayText, timestamp: now }];
    });
  };

  const readPayloadString = (data: any, path: string): string => {
    const value = path.split(".").reduce<any>((current, key) => current?.[key], data);
    return normalizeMessageText(value);
  };

  const payloadSignalText = (data: any, paths: string[]): string =>
    paths
      .map((path) => readPayloadString(data, path).toLowerCase())
      .filter(Boolean)
      .join(" ");

  const isRealtimeTextPayload = (data: any): boolean => {
    const eventType = String(data?.eventType || data?.type || "")
      .trim()
      .toLowerCase();
    const outputFormat = String(data?.outputFormat || "")
      .trim()
      .toLowerCase();
    return Boolean(
      data?.realtime === true ||
        data?.ttsStreamChunk === true ||
        data?.partial === true ||
        data?.isFinal === false ||
        data?.final === false ||
        outputFormat === "s16le" ||
        eventType.includes("response.") ||
        eventType.includes(".delta") ||
        eventType.includes("delta") ||
        streamedAudioPending.current ||
        Date.now() - lastStreamedAudioAt.current < 8000
    );
  };

  const inferTextPayloadRole = (data: any): "user" | "agent" | "" => {
    const roleSignals = payloadSignalText(data, [
      "role",
      "speaker",
      "sender",
      "source",
      "from",
      "origin",
      "speakerType",
      "participantRole",
      "message.role",
      "item.role",
      "event.role",
    ]);

    if (/\b(user|caller|customer|human|participant|client|member|input)\b/.test(roleSignals)) {
      return "user";
    }
    if (/\b(agent|assistant|ai|bot|model|response|output)\b/.test(roleSignals)) {
      return "agent";
    }

    const eventType = payloadSignalText(data, ["eventType", "type", "event", "name"]);
    const compactEventType = eventType.replace(/[\s._:-]+/g, "");
    if (
      eventType.includes("input_audio") ||
      eventType.includes("input.transcription") ||
      eventType.includes("input_transcription") ||
      compactEventType.includes("inputtranscription") ||
      eventType.includes("user.transcript") ||
      eventType.includes("speech_final")
    ) {
      return "user";
    }
    if (
      eventType.includes("response.") ||
      eventType.includes("response_") ||
      eventType.includes("output_transcription") ||
      compactEventType.includes("outputtranscription") ||
      eventType.includes("assistant") ||
      eventType.includes("agent")
    ) {
      return "agent";
    }

    const transcript = normalizeMessageText(data?.transcript);
    const text = normalizeMessageText(data?.text);
    if (
      data?.realtime === true &&
      transcript &&
      text &&
      compactMessageText(transcript) === compactMessageText(text)
    ) {
      // Realtime input transcriptions are emitted as both transcript and text;
      // only explicit response/agent signals above should turn that into Agent.
      return "user";
    }

    return "";
  };

  const updateVisionCaption = (text: string) => {
    setVisionCaption(text);
    if (visionCaptionTimer.current) clearTimeout(visionCaptionTimer.current);
    visionCaptionTimer.current = setTimeout(() => setVisionCaption(""), 8000);
  };

  const appendResolvedTextMessage = (
    sender: "You" | "Agent",
    message: string,
    realtimePayload: boolean,
    options: { vision?: boolean } = {}
  ) => {
    const text = normalizeMessageText(message);
    if (!text) return;

    if (sender === "You") {
      if (!intelligent(text)) return;
      setTranscript(text);
      if (realtimePayload) {
        upsertStreamingMessage("You", text, userTextStream);
      } else {
        pushMsg("You", text);
      }
      return;
    }

    const prefix = options.vision ? "\u{1F441}\uFE0F " : "";
    if (options.vision) updateVisionCaption(text);
    if (realtimePayload) {
      upsertStreamingMessage("Agent", text, agentTextStream, { prefix });
    } else {
      pushMsg("Agent", prefix ? prefix + text : text);
    }
  };

  const handlePipelineTextPayload = (
    data: any,
    options: { vision?: boolean } = {}
  ) => {
    const text = normalizeMessageText(data?.text);
    const transcript = normalizeMessageText(data?.transcript);
    const realtimePayload = isRealtimeTextPayload(data);
    const role = inferTextPayloadRole(data);

    if (role === "user") {
      appendResolvedTextMessage("You", transcript || text, realtimePayload);
      return;
    }

    if (role === "agent") {
      appendResolvedTextMessage("Agent", text || transcript, realtimePayload, options);
      return;
    }

    if (transcript && (!text || compactMessageText(transcript) !== compactMessageText(text))) {
      appendResolvedTextMessage("You", transcript, realtimePayload);
    }

    if (text) {
      appendResolvedTextMessage("Agent", text, realtimePayload, options);
    } else if (transcript && !text && !realtimePayload) {
      appendResolvedTextMessage("You", transcript, realtimePayload);
    }
  };

  const buildKnowledgeAugmentedMessage = useCallback(
    async (text: string) => {
      if (!hasKnowledgeBinding(widgetConfig)) return text;

      try {
        const context = await fetchKnowledgeContext(baseUrl, sessionToken, text);
        return withKnowledgeContext(text, context);
      } catch (error) {
        console.warn("[widget-agent] Knowledge retrieval failed:", error);
        return text;
      }
    },
    [baseUrl, sessionToken, widgetConfig]
  );

  const clearStreamedAudioPending = () => {
    streamedAudioPending.current = false;
    if (streamedAudioResetTimer.current) {
      clearTimeout(streamedAudioResetTimer.current);
      streamedAudioResetTimer.current = null;
    }
  };

  const markStreamedAudioPending = () => {
    streamedAudioPending.current = true;
    lastStreamedAudioAt.current = Date.now();
    if (streamedAudioResetTimer.current) {
      clearTimeout(streamedAudioResetTimer.current);
    }
    streamedAudioResetTimer.current = setTimeout(() => {
      streamedAudioPending.current = false;
      streamedAudioResetTimer.current = null;
    }, 8000);
  };

  const resetPcmJitterBuffer = () => {
    const current = pcmJitterBuffer.current;
    if (current?.startTimer) clearTimeout(current.startTimer);
    pcmJitterBuffer.current = null;
  };

  const decodeBase64Bytes = (base64: string): Uint8Array => {
    const byteCharacters = atob(base64);
    return Uint8Array.from(byteCharacters, (char) => char.charCodeAt(0));
  };

  const normalizeSocketAudio = (
    audio: EncodedSocketAudio | null | undefined
  ): Uint8Array | null => {
    if (!audio) return null;
    if (typeof audio === "string") {
      return decodeBase64Bytes(audio);
    }
    if (audio instanceof ArrayBuffer) {
      return new Uint8Array(audio);
    }
    if (ArrayBuffer.isView(audio)) {
      return new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength);
    }
    if (
      typeof audio === "object" &&
      Array.isArray((audio as { data?: number[] }).data)
    ) {
      return Uint8Array.from((audio as { data: number[] }).data);
    }
    return null;
  };

  const decodeQueuedAudio = async (
    item: QueuedAudioPlayback
  ): Promise<AudioBuffer | null> => {
    if (!audioContextRef.current) audioContextRef.current = new AudioContext();
    const audioContext = audioContextRef.current;

    if (item.kind === "encoded") {
      const byteArray = decodeBase64Bytes(item.audio);
      const audioData = byteArray.buffer.slice(
        byteArray.byteOffset,
        byteArray.byteOffset + byteArray.byteLength
      ) as ArrayBuffer;
      return audioContext.decodeAudioData(audioData);
    }

    const pcmBytes = normalizeSocketAudio(item.audio);
    if (!pcmBytes || pcmBytes.byteLength < 2) return null;

    const sampleRate =
      Number.isFinite(Number(item.sampleRate)) && Number(item.sampleRate) > 0
        ? Number(item.sampleRate)
        : 24000;
    const frameCount = Math.floor(pcmBytes.byteLength / 2);
    const audioBuffer = audioContext.createBuffer(1, frameCount, sampleRate);
    const channelData = audioBuffer.getChannelData(0);
    const view = new DataView(
      pcmBytes.buffer,
      pcmBytes.byteOffset,
      pcmBytes.byteLength
    );

    for (let index = 0; index < frameCount; index += 1) {
      channelData[index] = view.getInt16(index * 2, true) / 32768;
    }

    return audioBuffer;
  };

  const finishAgentPlaybackIfIdle = async (
    generation = playbackGeneration.current
  ) => {
    if (generation !== playbackGeneration.current) return;
    if (
      audioQueueDraining.current ||
      audioQueue.current.length > 0 ||
      activeAudioSources.current.size > 0
    ) {
      return;
    }

    isAudioPlaying.current = false;
    playbackCursor.current = 0;
    setAnimate(false);

    if (playbackMutedMic.current) {
      playbackMutedMic.current = false;
      tempMicOn.current = false;
      try {
        await toggleAudio({ sourceParameters: sourceParameters.current });
      } catch (error) {
        console.warn("[widget-agent] Failed to restore mic after playback:", error);
      }
    }
  };

  const beginAgentPlayback = async (generation: number) => {
    if (generation !== playbackGeneration.current) return false;
    isAudioPlaying.current = true;
    setAnimate(true);

    // Realtime speech stays full duplex. Browser/WebRTC AEC needs the mic
    // track to remain live so users can barge in without capture gaps.
    if (
      micOn.current &&
      doAEC.current &&
      !realtimeVoiceMode.current &&
      !playbackMutedMic.current
    ) {
      playbackMutedMic.current = true;
      tempMicOn.current = true;
      try {
        await toggleAudio({ sourceParameters: sourceParameters.current });
      } catch (error) {
        playbackMutedMic.current = false;
        tempMicOn.current = false;
        console.warn("[widget-agent] Failed to mute mic during playback:", error);
      }
    }

    return generation === playbackGeneration.current;
  };

  const scheduleAudioBuffer = async (
    audioBuffer: AudioBuffer,
    generation: number
  ) => {
    if (!audioContextRef.current) return;
    const canPlay = await beginAgentPlayback(generation);
    if (!canPlay || !audioContextRef.current) return;

    const audioContext = audioContextRef.current;
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    activeAudioSources.current.add(source);

    const startAt = Math.max(
      playbackCursor.current || 0,
      audioContext.currentTime + 0.02
    );
    playbackCursor.current = startAt + audioBuffer.duration;

    source.onended = () => {
      activeAudioSources.current.delete(source);
      void finishAgentPlaybackIfIdle(generation);
    };

    try {
      source.start(startAt);
    } catch (error) {
      activeAudioSources.current.delete(source);
      console.warn("[widget-agent] Failed to schedule audio chunk:", error);
      void finishAgentPlaybackIfIdle(generation);
    }
  };

  const drainAudioQueue = async () => {
    if (audioQueueDraining.current) return;
    audioQueueDraining.current = true;
    const generation = playbackGeneration.current;

    try {
      while (
        audioQueue.current.length > 0 &&
        generation === playbackGeneration.current
      ) {
        const item = audioQueue.current.shift();
        if (!item) continue;
        const audioBuffer = await decodeQueuedAudio(item);
        if (!audioBuffer || generation !== playbackGeneration.current) continue;
        await scheduleAudioBuffer(audioBuffer, generation);
      }
    } catch (error) {
      console.error("[widget-agent] Failed to drain audio queue:", error);
    } finally {
      audioQueueDraining.current = false;
      if (
        audioQueue.current.length > 0 &&
        generation === playbackGeneration.current
      ) {
        void drainAudioQueue();
      } else {
        void finishAgentPlaybackIfIdle(generation);
      }
    }
  };

  const resetAudioPlayback = (
    options: { restoreMic?: boolean } = { restoreMic: true }
  ) => {
    playbackGeneration.current += 1;
    audioQueue.current = [];
    audioQueueDraining.current = false;
    playbackCursor.current = audioContextRef.current?.currentTime || 0;
    realtimeAudioAccumulator.current = { key: "", bytes: null, updatedAt: 0 };
    resetPcmJitterBuffer();
    agentTextStream.current = { text: "", updatedAt: 0 };
    userTextStream.current = { text: "", updatedAt: 0 };
    clearStreamedAudioPending();

    activeAudioSources.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    });
    activeAudioSources.current.clear();

    isAudioPlaying.current = false;
    setAnimate(false);

    if (playbackMutedMic.current) {
      playbackMutedMic.current = false;
      tempMicOn.current = false;
      if (options.restoreMic !== false) {
        void toggleAudio({ sourceParameters: sourceParameters.current }).catch((error) => {
          console.warn("[widget-agent] Failed to restore mic after reset:", error);
        });
      }
    }
  };

  const queueAudioPlayback = (item: QueuedAudioPlayback) => {
    audioQueue.current.push(item);
    void drainAudioQueue();
  };

  async function playQueuedBase64(base64: string) {
    queueAudioPlayback({ kind: "encoded", audio: base64 });
  }

  async function playQueuedPcm16(
    audio: EncodedSocketAudio,
    sampleRate?: number
  ) {
    queueAudioPlayback({ kind: "pcm16", audio, sampleRate });
  }

  const flushPcmJitterBuffer = (expectedKey?: string) => {
    const current = pcmJitterBuffer.current;
    if (!current || (expectedKey && current.key !== expectedKey)) return;

    if (current.startTimer) {
      clearTimeout(current.startTimer);
      current.startTimer = null;
    }
    if (current.chunks.length === 0) return;

    const combined = new Uint8Array(current.byteLength);
    let offset = 0;
    current.chunks.forEach((chunk) => {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    });
    current.chunks = [];
    current.byteLength = 0;
    current.started = true;
    void playQueuedPcm16(combined, current.sampleRate);
  };

  const queueStreamedPcm16 = (
    data: any,
    audio: Uint8Array,
    requestedSampleRate?: number
  ) => {
    const sampleRate =
      Number.isFinite(Number(requestedSampleRate)) && Number(requestedSampleRate) > 0
        ? Number(requestedSampleRate)
        : 24000;
    const key = realtimeAudioKey(data) || "default-stream";
    let current = pcmJitterBuffer.current;

    if (current && (current.key !== key || current.sampleRate !== sampleRate)) {
      flushPcmJitterBuffer(current.key);
      resetPcmJitterBuffer();
      current = null;
    }

    if (!current) {
      current = {
        key,
        chunks: [],
        byteLength: 0,
        sampleRate,
        started: false,
        startTimer: null,
      };
      pcmJitterBuffer.current = current;
    }

    if (current.started) {
      void playQueuedPcm16(audio, sampleRate);
      return;
    }

    current.chunks.push(audio);
    current.byteLength += audio.byteLength;
    const bufferedMs = (current.byteLength / (sampleRate * 2)) * 1000;
    const isFinalChunk = data?.isFinalChunk === true || data?.isFinal === true;

    if (isFinalChunk || bufferedMs >= STREAM_INITIAL_BUFFER_MS) {
      flushPcmJitterBuffer(key);
      return;
    }

    if (!current.startTimer) {
      current.startTimer = setTimeout(() => {
        flushPcmJitterBuffer(key);
      }, STREAM_MAX_START_WAIT_MS);
    }
  };

  const bytesStartWith = (value: Uint8Array, prefix: Uint8Array): boolean => {
    if (prefix.byteLength > value.byteLength) return false;
    for (let index = 0; index < prefix.byteLength; index += 1) {
      if (value[index] !== prefix[index]) return false;
    }
    return true;
  };

  const realtimeAudioKey = (data: any): string =>
    String(
      data?.responseId ||
        data?.response_id ||
        data?.itemId ||
        data?.item_id ||
        data?.turnId ||
        data?.turn_id ||
        data?.id ||
        ""
    );

  const getRealtimePcmDelta = (
    data: any,
    audioPayload: EncodedSocketAudio
  ): Uint8Array | null => {
    const bytes = normalizeSocketAudio(audioPayload);
    if (!bytes || bytes.byteLength < 2) return null;

    const now = Date.now();
    const key = realtimeAudioKey(data);
    const previous = realtimeAudioAccumulator.current;
    const sameStream =
      previous.bytes &&
      now - previous.updatedAt < 8000 &&
      (!key || !previous.key || key === previous.key);

    if (sameStream && previous.bytes) {
      if (bytes.byteLength === previous.bytes.byteLength && bytesStartWith(bytes, previous.bytes)) {
        previous.updatedAt = now;
        return null;
      }
      if (bytes.byteLength > previous.bytes.byteLength && bytesStartWith(bytes, previous.bytes)) {
        const delta = bytes.slice(previous.bytes.byteLength);
        realtimeAudioAccumulator.current = {
          key: key || previous.key,
          bytes,
          updatedAt: now,
        };
        return delta.byteLength >= 2 ? delta : null;
      }
    }

    realtimeAudioAccumulator.current = { key, bytes, updatedAt: now };
    return bytes;
  };

  const handleSocketAudioPayload = (
    data: any,
    options: { suppressIfStreaming?: boolean } = {}
  ) => {
    const audioPayload = data?.audio ?? data?.audioBuffer;
    if (!audioPayload) return;

    const outputFormat = String(data?.outputFormat || "").trim().toLowerCase();
    const isChunkEvent =
      data?.ttsStreamChunk === true ||
      String(data?.eventType || "").trim().toLowerCase() ===
        "response.audio.delta";
    const isPcm16 = outputFormat === "s16le";

    if (isChunkEvent) {
      markStreamedAudioPending();
      const delta = getRealtimePcmDelta(data, audioPayload as EncodedSocketAudio);
      if (delta) {
        queueStreamedPcm16(data, delta, Number(data?.sampleRate) || undefined);
      }
      return;
    }

    const recentlyStreamedAudio =
      streamedAudioPending.current ||
      Date.now() - lastStreamedAudioAt.current < 8000;
    if (options.suppressIfStreaming && recentlyStreamedAudio) {
      flushPcmJitterBuffer();
      resetPcmJitterBuffer();
      clearStreamedAudioPending();
      return;
    }

    if (isPcm16) {
      markStreamedAudioPending();
      const delta = getRealtimePcmDelta(data, audioPayload as EncodedSocketAudio);
      if (delta) {
        void playQueuedPcm16(delta, Number(data?.sampleRate) || undefined);
      }
      return;
    }

    if (typeof audioPayload === "string") {
      void playQueuedBase64(audioPayload);
      return;
    }

    const normalizedAudio = normalizeSocketAudio(
      audioPayload as EncodedSocketAudio
    );
    if (normalizedAudio) {
      void playQueuedPcm16(
        normalizedAudio,
        Number(data?.sampleRate) || undefined
      );
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // PIPELINE CONFIG UPDATE — builds mode-aware config
  // ═══════════════════════════════════════════════════════════════

  /**
   * Returns a config object tailored to the current startMode:
   *  - "voice"  → { audio } only (no vision block)
   *  - "vision" → { audio, vision } (vision needs audio for TTS output)
   *  - "both"   → { audio, vision }
   *
   * widgetConfig overrides (credentials, voiceId, systemPrompt, extra)
   * are applied to the relevant blocks.
   */
  const buildRuntimeConfig = () => {
    const widgetRecord = (widgetConfig || {}) as Record<string, unknown>;
    const audioSource = runtimeObject(widgetRecord.audioConfig || widgetRecord.audio);
    const visionSource = runtimeObject(widgetRecord.visionConfig || widgetRecord.vision);
    const agentProfileSource = runtimeObject(widgetRecord.agentProfile);
    const useDemoDefaults = !hasExplicitRuntimeConfig(widgetConfig);
    const freshConfig = createDefaultRuntimeConfig(useDemoDefaults);
    config.audio = freshConfig.audio;
    config.vision = freshConfig.vision;

    const applyRuntimeFields = (
      target: Record<string, any>,
      source: Record<string, any>,
      keys: string[]
    ) => {
      for (const key of keys) {
        if (hasUsableValue(source[key])) target[key] = source[key];
      }
    };

    applyRuntimeFields(config.audio, audioSource, [
      "format",
      "channels",
      "sampleRate",
      "chunkDuration",
      "maxUtteranceDuration",
      "bargeInMinSpeechMs",
      "interruptOnSpeech",
      "returnAudioFormat",
      "returnAll",
    ]);
    applyRuntimeFields(config.vision, visionSource, [
      "fps",
      "returnAudioFormat",
      "returnAll",
    ]);

    if (isPlainObject(audioSource.denoise)) {
      config.audio.denoise = { ...(config.audio.denoise || {}), ...audioSource.denoise };
    }
    if (Array.isArray(audioSource.pipeline)) {
      config.audio.pipeline = normalizePipeline(audioSource.pipeline, config.audio.pipeline);
    }
    if (Array.isArray(visionSource.pipeline)) {
      config.vision.pipeline = normalizePipeline(visionSource.pipeline, config.vision.pipeline);
    }

    const audioParams = runtimeObject(audioSource.ttsParams);
    const visionParams = runtimeObject(visionSource.ttsParams);
    const sttNickName = firstNonEmptyString(widgetRecord.sttNickName, audioSource.sttNickName);
    const llmNickName = firstNonEmptyString(widgetRecord.llmNickName, audioSource.llmNickName);
    const visionLlmNickName = firstNonEmptyString(
      widgetRecord.visionLlmNickName,
      widgetRecord.visionLLMNickName,
      widgetRecord.visionLlmNickname,
      widgetRecord.visionLLMNickname,
      visionSource.llmNickName,
      visionSource.visionLlmNickName,
      visionSource.visionLLMNickName,
      llmNickName
    );
    const ttsNickName = firstNonEmptyString(
      widgetRecord.ttsNickName,
      audioSource.ttsNickName,
      visionSource.ttsNickName
    );
    const resolvedVoiceId = firstNonEmptyString(
      widgetRecord.voiceId,
      audioParams.voiceId,
      audioParams.voice,
      visionParams.voiceId,
      visionParams.voice
    );
    const realtimeParams = mergeRuntimeObjects(audioSource.realtimeParams, widgetRecord.realtimeParams);
    const speechEngine = firstNonEmptyString(widgetRecord.speechEngine, audioSource.speechEngine);
    const realtimeProvider = firstNonEmptyString(
      widgetRecord.realtimeProvider,
      audioSource.realtimeProvider
    );
    const realtimeModel = firstNonEmptyString(widgetRecord.realtimeModel, audioSource.realtimeModel);
    const realtimeUrl = firstNonEmptyString(widgetRecord.realtimeUrl, audioSource.realtimeUrl);
    const realtimeNickName = firstNonEmptyString(
      widgetRecord.realtimeNickName,
      audioSource.realtimeNickName
    );
    const textLlmNickName = firstNonEmptyString(
      widgetRecord.textLlmNickName,
      audioSource.textLlmNickName,
      widgetRecord.fallbackLlmNickName,
      audioSource.fallbackLlmNickName,
      widgetRecord.classicLlmNickName,
      audioSource.classicLlmNickName
    );
    const realtimeMode =
      speechEngine.toLowerCase() === "realtime" ||
      pipelineIncludes(config.audio.pipeline, "realtime") ||
      Boolean(realtimeNickName || realtimeUrl || realtimeProvider || realtimeModel);

    if (sttNickName) config.audio.sttNickName = sttNickName;
    if (llmNickName) config.audio.llmNickName = llmNickName;
    if (visionLlmNickName) config.vision.llmNickName = visionLlmNickName;
    if (ttsNickName) {
      config.audio.ttsNickName = ttsNickName;
      config.vision.ttsNickName = ttsNickName;
    }

    const mergedSttParams = mergeRuntimeObjects(audioSource.sttParams, widgetRecord.sttParams);
    const mergedLlmParams = mergeRuntimeObjects(audioSource.llmParams, widgetRecord.llmParams);
    const mergedTtsParams = mergeRuntimeObjects(audioParams, widgetRecord.ttsParams);
    if (Object.keys(mergedSttParams).length > 0) config.audio.sttParams = mergedSttParams;
    if (Object.keys(mergedLlmParams).length > 0) config.audio.llmParams = mergedLlmParams;
    if (Object.keys(mergedTtsParams).length > 0) {
      config.audio.ttsParams = { ...(config.audio.ttsParams || {}), ...mergedTtsParams };
      config.vision.ttsParams = { ...(config.vision.ttsParams || {}), ...mergedTtsParams };
    }
    if (resolvedVoiceId) {
      config.audio.ttsParams = { ...(config.audio.ttsParams || {}), voiceId: resolvedVoiceId, voice: resolvedVoiceId };
      config.vision.ttsParams = { ...(config.vision.ttsParams || {}), voiceId: resolvedVoiceId, voice: resolvedVoiceId };
    }

    if (realtimeMode) {
      const audioConfig = config.audio as any;
      if (realtimeUrl && realtimeParams.endpoint === undefined) {
        realtimeParams.endpoint = realtimeUrl;
      }
      if (realtimeModel && realtimeParams.model === undefined) {
        realtimeParams.model = realtimeModel;
      }

      audioConfig.speechEngine = "realtime";
      audioConfig.pipeline = ["realtime", "return"] as string[];
      audioConfig.realtimeLLM = true;
      audioConfig.realtimeAgent = true;
      audioConfig.realtimeSpeech = true;
      audioConfig.realtimeNickName = realtimeNickName;
      if (textLlmNickName) audioConfig.textLlmNickName = textLlmNickName;
      audioConfig.realtimeProvider = realtimeProvider;
      audioConfig.realtimeModel = realtimeModel;
      audioConfig.realtimeUrl = realtimeUrl;
      audioConfig.realtimeParams = realtimeParams;

      delete audioConfig.sttNickName;
      delete audioConfig.llmNickName;
      delete audioConfig.ttsNickName;
      delete audioConfig.sttParams;
      delete audioConfig.llmParams;
      delete audioConfig.ttsParams;

      const visionConfig = config.vision as any;
      const shouldEnableVision =
        mode === "multimodal" &&
        (Boolean(visionLlmNickName) || !hasExplicitRuntimeConfig(widgetConfig) || pipelineIncludes(visionSource.pipeline, "visionllm"));

      if (shouldEnableVision) {
        visionConfig.pipeline = normalizePipeline(visionSource.pipeline, ["visionllm", "tts"]);
        if (visionLlmNickName) visionConfig.llmNickName = visionLlmNickName;
        else delete visionConfig.llmNickName;
        if (!visionConfig.pipeline.includes("tts")) visionConfig.pipeline.push("tts");
        visionConfig.speechEngine = "realtime";
        visionConfig.realtimeLLM = true;
        visionConfig.realtimeAgent = true;
        visionConfig.realtimeSpeech = true;
        visionConfig.realtimeNickName = realtimeNickName;
        visionConfig.realtimeProvider = realtimeProvider;
        visionConfig.realtimeModel = realtimeModel;
        visionConfig.realtimeUrl = realtimeUrl;
        visionConfig.realtimeParams = { ...realtimeParams };
        delete visionConfig.ttsNickName;
        delete visionConfig.ttsParams;
      } else {
        visionConfig.pipeline = [];
        delete visionConfig.llmNickName;
        delete visionConfig.ttsNickName;
        delete visionConfig.ttsParams;
      }
    }

    const systemPrompt = firstNonEmptyString(
      widgetRecord.systemPrompt,
      agentProfileSource.systemPrompt,
      audioSource.systemPrompt,
      visionSource.systemPrompt
    );
    const fallbackBehavior = firstNonEmptyString(
      widgetRecord.fallbackBehavior,
      agentProfileSource.fallbackBehavior,
      audioSource.fallbackBehavior,
      visionSource.fallbackBehavior
    );
    const fallbackText = firstNonEmptyString(
      widgetRecord.fallbackMessage,
      widgetRecord.fallbackResponse,
      agentProfileSource.fallbackMessage,
      agentProfileSource.fallbackResponse,
      audioSource.fallbackMessage,
      audioSource.fallbackResponse,
      visionSource.fallbackMessage,
      visionSource.fallbackResponse
    );

    if (systemPrompt) {
      (config.audio as any).systemPrompt = systemPrompt;
      (config.vision as any).systemPrompt = systemPrompt;
    }
    if (fallbackBehavior) {
      (config.audio as any).fallbackBehavior = fallbackBehavior;
      (config.vision as any).fallbackBehavior = fallbackBehavior;
    }
    if (fallbackText) {
      (config.audio as any).fallbackMessage = fallbackText;
      (config.audio as any).fallbackResponse = fallbackText;
      (config.vision as any).fallbackMessage = fallbackText;
      (config.vision as any).fallbackResponse = fallbackText;
    }
    if (widgetConfig?.extra && Array.isArray(widgetConfig.extra) && widgetConfig.extra.length > 0) {
      (config.audio as any).extra = widgetConfig.extra;
      (config.vision as any).extra = widgetConfig.extra;
    }

    if (hasKnowledgeBinding(widgetConfig)) {
      const knowledgeBase = widgetConfig?.knowledgeBase || {};
      const knowledgeResourceType = widgetConfig?.knowledgeResourceType || knowledgeBase.resourceType;
      const knowledgeResourceId = widgetConfig?.knowledgeResourceId || knowledgeBase.resourceId;
      const runtimeKnowledge = {
        ...knowledgeBase,
        enabled: knowledgeBase.enabled !== false,
        resourceType: knowledgeResourceType,
        resourceId: knowledgeResourceId,
        searchEndpoint: `${baseUrl.replace(/\/$/, "")}/v1/widget/knowledge-search`,
        sessionScoped: true,
        ...(sessionToken ? { sessionToken } : {}),
      };

      (config.audio as any).knowledgeResourceType = knowledgeResourceType;
      (config.audio as any).knowledgeResourceId = knowledgeResourceId;
      (config.audio as any).knowledgeBase = runtimeKnowledge;
      (config.vision as any).knowledgeResourceType = knowledgeResourceType;
      (config.vision as any).knowledgeResourceId = knowledgeResourceId;
      (config.vision as any).knowledgeBase = runtimeKnowledge;
    }

    // Sanitize empty values so Joi validation on the server receives only active fields.
    const stripEmpty = (obj: Record<string, any>) => {
      const cleaned: Record<string, any> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v !== "" && v !== null && v !== undefined) cleaned[k] = v;
      }
      return Object.keys(cleaned).length > 0 ? cleaned : undefined;
    };

    const sanitizeBlock = (block: Record<string, any>) => {
      const out = { ...block };
      for (const [key, value] of Object.entries(out)) {
        if (value === "" || value === null || value === undefined) delete out[key];
      }
      for (const key of ["ttsParams", "sttParams", "llmParams", "realtimeParams"] as const) {
        if (out[key] && typeof out[key] === "object") {
          const cleaned = stripEmpty(out[key]);
          if (cleaned) out[key] = cleaned;
          else delete out[key];
        }
      }
      return out;
    };

    const audioOut = sanitizeBlock(config.audio);
    const visionOut = sanitizeBlock(config.vision);
    if (mode === "multimodal" && Array.isArray(visionOut.pipeline) && visionOut.pipeline.length > 0) {
      return {
        audio: audioOut,
        vision: visionOut,
      };
    }
    return { audio: audioOut };
  };
  const confirmVoicePipelineReady = (attempt = 0) => {
    if (voicePipelineConfirmed.current || !socket.current || !agentRoom.current) {
      return;
    }

    socket.current.emit(
      "confirmVoicePipelineActive",
      { roomName: agentRoom.current, sessionId: socket.current.id },
      (ack?: { success?: boolean; retryable?: boolean }) => {
        if (ack?.success) {
          voicePipelineConfirmed.current = true;
          return;
        }

        if (ack?.retryable && attempt < 40) {
          const retryDelayMs = attempt < 8 ? 250 : 500;
          setTimeout(() => confirmVoicePipelineReady(attempt + 1), retryDelayMs);
          return;
        }

        if (attempt >= 40) {
          voicePipelineConfirmed.current = false;
          showToast("Media is still connecting. Try again in a moment.", "info");
        }
      }
    );
  };

  // ═══════════════════════════════════════════════════════════════
  // CAPTURE CONTROLS — preserved from AgentsMultimodal
  // ═══════════════════════════════════════════════════════════════

  const applyRealtimeCaptureConstraints = async () => {
    if (!realtimeVoiceMode.current || !doAEC.current) return;

    const current = sourceParameters.current;
    const params =
      typeof current.getUpdatedAllParams === "function"
        ? current.getUpdatedAllParams()
        : current;
    const streams = [
      params?.localStreamAudio,
      params?.localStream,
      params?.audioStream,
    ];
    const tracks = streams.flatMap((stream) =>
      typeof stream?.getAudioTracks === "function" ? stream.getAudioTracks() : []
    );

    await Promise.allSettled(
      [...new Set(tracks)].map((track: MediaStreamTrack) =>
        track.applyConstraints({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        })
      )
    );
  };

  const startCapture = () => {
    if (!roomConnected.current) {
      showToast("Still connecting — just a moment.", "info");
      return;
    }

    const now = Date.now();
    if (now - lastCaptureToggleRef.current < 15000 && lastCaptureToggleRef.current > 0) {
      const timeLeft = Math.ceil(
        (15000 - (now - lastCaptureToggleRef.current)) / 1000
      );
      showToast(`Please wait ${timeLeft}s before toggling again.`, "info");
      return;
    }

    if (isCapturing) {
      stopCapture();
      return;
    }

    const runtimeConfig = buildRuntimeConfig();
    const audioRuntimeConfig: any = runtimeConfig?.audio || {};
    realtimeVoiceMode.current =
      String(audioRuntimeConfig.speechEngine || "").trim().toLowerCase() ===
        "realtime" ||
      (Array.isArray(audioRuntimeConfig.pipeline) &&
        audioRuntimeConfig.pipeline.includes("realtime"));
    void applyRealtimeCaptureConstraints();
    voicePipelineConfirmed.current = false;

    try {
      if (socket.current && agentRoom.current && socket.current?.id) {
        socket.current.off("startBuffers");
        socket.current.once("startBuffers", () => {
          socket.current?.emit(
            "startBuffer",
            { roomName: agentRoom.current, member: "agent" },
            (response: any) => {
              if (response.success) {
                setIsCapturing(true);
                lastCaptureToggleRef.current = Date.now();
                setTimeout(() => setTick((t) => t + 1), 15500);
                confirmVoicePipelineReady();
              } else {
                voicePipelineConfirmed.current = false;
                setIsCapturing(false);
                console.warn("[widget-agent] Failed to start buffer:", response.reason);
                showToast(response?.reason || "Could not start media capture.", "error");
              }
            }
          );
        });

        socket.current.emit(
          "startDataBuffer",
          { roomName: agentRoom.current, config: runtimeConfig },
          (response: any) => {
            if (response.success) {
              confirmVoicePipelineReady();
            } else {
              voicePipelineConfirmed.current = false;
              setIsCapturing(false);
              socket.current?.off("startBuffers");
              console.warn("[widget-agent] Failed to start data buffer:", response?.reason);
              showToast(response?.reason || "Could not prepare media capture.", "error");
            }
          }
        );
      }
    } catch (error) {
      console.error("Failed to start capture:", error);
    }
  };

  const stopCapture = () => {
    if (!isCapturing) return;
    const now = Date.now();
    if (now - lastCaptureToggleRef.current < 15000 && lastCaptureToggleRef.current > 0) {
      const timeLeft = Math.ceil(
        (15000 - (now - lastCaptureToggleRef.current)) / 1000
      );
      showToast(`Please wait ${timeLeft}s before toggling again.`, "info");
      return;
    }

    if (socket.current) {
      socket.current.emit(
        "stopDataBuffer",
        { roomName: agentRoom.current },
        (response: any) => {
          if (response.success) {
            resetAudioPlayback();
            setIsCapturing(false);
            voicePipelineConfirmed.current = false;
            lastCaptureToggleRef.current = now;
            setTimeout(() => setTick((t) => t + 1), 15500);
          } else {
            console.warn("[widget-agent] Failed to stop data buffer:", response.reason);
          }
        }
      );
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // SESSION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  const startSession = async (selectedMode: StartMode) => {
    startModeRef.current = selectedMode;
    setPhase("connecting");
    await unlockAudioContext();
    setShowRoom(true);

    // 15-minute session timeout
    sessionTimeoutRef.current = setTimeout(() => {
      showToast("Session time limit reached.", "info");
      endSession();
    }, SESSION_DURATION);
  };

  const endSession = useCallback(() => {
    resetAudioPlayback({ restoreMic: false });
    setPhase("ended");
    if (isCapturing) {
      // Direct emit to stop capture
      if (socket.current) {
        socket.current.emit("stopDataBuffer", { roomName: agentRoom.current });
      }
      setIsCapturing(false);
      voicePipelineConfirmed.current = false;
    }
    disconnectRoom({ sourceParameters: sourceParameters.current });
    setShowRoom(false);
    if (sessionTimeoutRef.current) clearTimeout(sessionTimeoutRef.current);
    postToParent("agentDisconnect");
    onDisconnect?.();
  }, [isCapturing, onDisconnect]);

  // ═══════════════════════════════════════════════════════════════
  // TEXT INPUT — sends to pipeline via socket
  // ═══════════════════════════════════════════════════════════════

  const sendTextMessage = async () => {
    const text = chatInput.trim();
    if (!text) return;

    pushMsg("You", text);
    setChatInput("");

    if (!isCapturing || !socket.current || !roomConnected.current) {
      pushMsg("System", "Start mic or camera first to send messages.");
      return;
    }

    const messageContent = await buildKnowledgeAugmentedMessage(text);
    const runtimeConfig = buildRuntimeConfig();
    const audioRuntimeConfig: any = runtimeConfig?.audio || {};
    const realtimeMode =
      String(audioRuntimeConfig.speechEngine || "").trim().toLowerCase() === "realtime" ||
      (Array.isArray(audioRuntimeConfig.pipeline) && audioRuntimeConfig.pipeline.includes("realtime"));

    if (realtimeMode && !voicePipelineConfirmed.current) {


      confirmVoicePipelineReady();


      pushMsg("System", "Media is still connecting. Try again in a moment.");


      return;


    }



    // Route through the correct pipeline


    if (
      videoOn &&
      !disableVision.current &&
      config.vision.pipeline.length > 0
    ) {
      // Vision pipeline — customVisionAction
      socket.current.emit("customVisionAction", {
        id: `${Date.now()}`,
        message: { role: "user", content: messageContent },
        useImage: true,
        forceImage: false,
        returnTextOrAudio: "all",
      });
    } else if (
      realtimeMode ||
      (
        Array.isArray(audioRuntimeConfig.pipeline) &&
        audioRuntimeConfig.pipeline.length > 0 &&
        audioRuntimeConfig.pipeline.some((p: string) => p === "ttllm")
      )
    ) {
      // Audio LLM pipeline — customAction
      socket.current.emit("customAction", {
        id: `${Date.now()}`,
        message: { role: "user", content: messageContent },
        returnTextOrAudio: "all",
      });
    } else {
      pushMsg("System", "No LLM pipeline active to handle text.");
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // MEDIA CONTROLS
  // ═══════════════════════════════════════════════════════════════

  const toggleMicHandler = async () => {
    if (!audioUnlocked.current) await unlockAudioContext();
    if (Object.keys(sourceParameters.current).length === 0) {
      showToast("Please connect first.", "info");
      return;
    }
    await toggleAudio({ sourceParameters: sourceParameters.current });
  };

  const toggleCameraHandler = async () => {
    if (!audioUnlocked.current) await unlockAudioContext();
    // Reset disableVision so user can start a new burst
    if (disableVision.current && !videoOn) {
      disableVision.current = false;
      sessionVisionTime.current = 0;
    }
    if (Object.keys(sourceParameters.current).length === 0) {
      showToast("Please connect first.", "info");
      return;
    }
    await toggleVideo({ sourceParameters: sourceParameters.current });
  };

  const swapCamera = async () => {
    if (Object.keys(sourceParameters.current).length === 0) return;
    await switchCamera({ sourceParameters: sourceParameters.current });
  };

  const toggleAECHandler = () => {
    doAEC.current = !doAEC.current;
    if (doAEC.current && realtimeVoiceMode.current) {
      void applyRealtimeCaptureConstraints();
    }
    showToast(
      `Echo cancellation ${doAEC.current ? "on" : "off"}`,
      "info"
    );
    // Force re-render for UI update
    setSourceChanged((prev) => prev + 1);
  };

  // ═══════════════════════════════════════════════════════════════
  // VISION TIME MANAGEMENT — preserved exactly
  // ═══════════════════════════════════════════════════════════════

  const manageVisionTime = () => {
    if ((!videoOn || !isCapturing) && sessionTimerRef.current) {
      clearInterval(sessionTimerRef.current);
    }
    if (disableVision.current) return;
    if (sessionTimerRef.current) return;

    if (visionTimeLimitTotal > 0 && totalVisionTime.current >= visionTimeLimitTotal) {
      if (!disableVision.current) {
        showToast("Vision disabled. Maximum time reached.", "info");
        if (Object.keys(sourceParameters.current).length !== 0) {
          toggleVideo({ sourceParameters: sourceParameters.current });
        }
        disableVision.current = true;
        return;
      }
    }

    sessionVisionTime.current = 0;
    sessionTimerRef.current = setInterval(() => {
      if (!videoOn || !isCapturing) {
        clearInterval(sessionTimerRef.current!);
        sessionTimerRef.current = null;
        return;
      }
      sessionVisionTime.current += 1000;
      totalVisionTime.current += 1000;

      if (sessionVisionTime.current >= visionTimeLimitPerCapture) {
        // Burst complete — turn camera off; user can toggle back on for next burst
        if (Object.keys(sourceParameters.current).length !== 0) {
          toggleVideo({ sourceParameters: sourceParameters.current });
        }
        disableVision.current = true;
        clearInterval(sessionTimerRef.current!);
        sessionTimerRef.current = null;
        showToast("Camera paused after vision burst. Tap camera to start a new burst.", "info");
      }
      if (visionTimeLimitTotal > 0 && totalVisionTime.current >= visionTimeLimitTotal) {
        if (Object.keys(sourceParameters.current).length !== 0) {
          toggleVideo({ sourceParameters: sourceParameters.current });
        }
        disableVision.current = true;
        clearInterval(sessionTimerRef.current!);
        sessionTimerRef.current = null;
        showToast("Vision disabled. Maximum camera time reached.", "info");
      }
    }, 1000);
  };

  // ═══════════════════════════════════════════════════════════════
  // SOURCE PARAMETER WIRING + SOCKET SETUP
  // (The critical effect — preserved from AgentsMultimodal)
  // ═══════════════════════════════════════════════════════════════

  useEffect(() => {
    if (Object.keys(sourceParameters.current).length === 0) return;

    // Sync mic state
    if (sourceParameters.current.audioAlreadyOn !== micOn.current) {
      micOn.current = sourceParameters.current.audioAlreadyOn;
    }
    // Sync video state
    if (sourceParameters.current.videoAlreadyOn !== videoOn) {
      setVideoOn(sourceParameters.current.videoAlreadyOn);
    }
    // This widget is cloud-only. Buffer and agent events belong to the
    // primary MediaSFU room socket; localSocket is the community/cloud bridge.
    if (sourceParameters.current.socket?.id && !socket.current) {
      socket.current = sourceParameters.current.socket;
    }
    // Audio level
    if (sourceParameters.current.audioLevel !== audioLevel.current) {
      audioLevel.current = sourceParameters.current.audioLevel;
    }
    // Video stream → selfVideoRef
    if (sourceParameters.current.localStreamVideo && selfVideoRef.current) {
      if (
        selfVideoRef.current.srcObject !==
        sourceParameters.current.localStreamVideo
      ) {
        selfVideoRef.current.srcObject =
          sourceParameters.current.localStreamVideo;
      }
    }

    // ── Room connected — wire socket listeners + auto-capture ──
    if (sourceParameters.current.socket?.id && !roomConnected.current) {
      roomConnected.current = true;
      setPhase("active");

      const modeLabel =
        startModeRef.current === "vision"
          ? "Show something on camera or type below."
          : startModeRef.current === "both"
          ? "Speak, show something, or type below."
          : "Start speaking or type below.";
      setChatMessages([
        {
          sender: "Agent",
          message: `Hello! I'm ${
            agentName || "your AI assistant"
          }. ${modeLabel}`,
          timestamp: Date.now(),
        },
      ]);
      console.log("[widget-agent] Connected to room");

      if (sourceParameters.current.roomName !== agentRoom.current) {
        agentRoom.current = sourceParameters.current.roomName;
      }

      try {
        if (!socket.current) return;

        socketListenerCleanup.current?.();
        const boundSocket = socket.current;
        const listeners: Array<[string, (...args: any[]) => void]> = [
          ["pipelineAudioChunk", (data: any) => {
            handleSocketAudioPayload(data);
          }],
          ["pipelineAudioStreamComplete", (data: any) => {
            const streamKey = realtimeAudioKey(data);
            flushPcmJitterBuffer(streamKey || undefined);
            resetPcmJitterBuffer();
            realtimeAudioAccumulator.current = {
              key: "",
              bytes: null,
              updatedAt: 0,
            };
            clearStreamedAudioPending();
          }],
          ["pipelineResult", (data: any) => {
            handlePipelineTextPayload(data);
            handleSocketAudioPayload(data, { suppressIfStreaming: true });
          }],
          ["pipelineResultVision", (data: any) => {
            handlePipelineTextPayload(data, { vision: true });
            // Vision audio is only emitted with the final result; it has no
            // preceding pipelineAudioChunk to deduplicate.
            handleSocketAudioPayload(data);
          }],
          ["customResult", (data: any) => {
            handlePipelineTextPayload(data);
            handleSocketAudioPayload(data, { suppressIfStreaming: true });
          }],
          ["customResultVision", (data: any) => {
            handlePipelineTextPayload(data, { vision: true });
            // Custom vision audio is also final-only, so it should not be
            // suppressed by recent realtime audio chunks from the mic path.
            handleSocketAudioPayload(data);
          }],
          ["pipelineError", (data: any) => {
            console.warn("[widget-agent] pipelineError:", data?.error || data);
          }],
          ["pipelineErrorVision", (data: any) => {
            console.warn("[widget-agent] pipelineErrorVision:", data?.error || data);
          }],
          ["customError", (data: any) => {
            console.warn("[widget-agent] customError:", data?.error || data);
          }],
          ["customErrorVision", (data: any) => {
            console.warn("[widget-agent] customErrorVision:", data?.error || data);
          }],
          ["disconnect", () => {
            resetAudioPlayback({ restoreMic: false });
            roomConnected.current = false;
            autoCaptureTriggered.current = false;
            pushMsg("System", "Session ended.");
            console.warn("[widget-agent] Socket disconnected");
            postToParent("agentDisconnect");
            onDisconnect?.();
          }],
        ];

        listeners.forEach(([event, handler]) => {
          boundSocket.on(event, handler);
        });
        const cleanup = () => {
          listeners.forEach(([event, handler]) => {
            boundSocket.off(event, handler);
          });
          if (socketListenerCleanup.current === cleanup) {
            socketListenerCleanup.current = null;
          }
        };
        socketListenerCleanup.current = cleanup;
      } catch (error) {
        console.error("Failed to set up socket listeners:", error);
      }

      // ── Auto-capture: enable media based on startMode ──
      if (!autoCaptureTriggered.current) {
        autoCaptureTriggered.current = true;
        setTimeout(async () => {
          try {
            // Unlock audio context for playback
            if (!audioContextRef.current)
              audioContextRef.current = new AudioContext();
            if (audioContextRef.current.state === "suspended") {
              await audioContextRef.current.resume();
              audioUnlocked.current = true;
            }

            // Turn on mic if user chose voice or both
            if (
              (startModeRef.current === "voice" ||
                startModeRef.current === "both") &&
              !micOn.current
            ) {
              await toggleAudio({
                sourceParameters: sourceParameters.current,
              });
            }

            // Turn on camera if user chose vision or both
            if (
              (startModeRef.current === "vision" ||
                startModeRef.current === "both") &&
              !sourceParameters.current.videoAlreadyOn
            ) {
              await toggleVideo({
                sourceParameters: sourceParameters.current,
              });
            }

            // Start capture after media is ready
            setTimeout(() => {
              if (roomConnected.current && !isCapturing) {
                startCapture();
              }
            }, 1200);
          } catch (e) {
            console.error("Auto-capture setup failed:", e);
          }
        }, 800);
      }
    }

    // Alert messages from SDK
    if (
      sourceParameters.current.alertMessage &&
      sourceParameters.current.alertMessage !== ""
    ) {
      showToast(sourceParameters.current.alertMessage, "info");
      if (
        sourceParameters.current.alertMessage.includes(
          "You have been disconnected"
        )
      ) {
        postToParent("agentDisconnect");
        onDisconnect?.();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceChanged]);

  // ── Vision time tracking ──
  useEffect(() => {
    if (videoOn && isCapturing) {
      manageVisionTime();
    } else {
      if (sessionTimerRef.current) {
        clearInterval(sessionTimerRef.current);
        sessionTimerRef.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoOn, isCapturing]);

  // ── Cleanup socket listeners ──
  useEffect(() => {
    return () => {
      try {
        socketListenerCleanup.current?.();
        socket.current?.off("startBuffers");
      } catch {
        /* ignore */
      }
    };
  }, []);

  // ── Cleanup room on unmount ──
  useEffect(() => {
    return () => {
      resetAudioPlayback({ restoreMic: false });
      if (roomConnected.current) {
        disconnectRoom({ sourceParameters: sourceParameters.current });
      }
      if (sessionTimeoutRef.current) clearTimeout(sessionTimeoutRef.current);
      if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
      if (visionCaptionTimer.current)
        clearTimeout(visionCaptionTimer.current);
      if (streamedAudioResetTimer.current)
        clearTimeout(streamedAudioResetTimer.current);
    };
  }, []);

  // ── Auto-scroll chat ──
  useEffect(() => {
    if (chatBoxRef.current)
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
  }, [chatMessages]);

  // ── Periodic mic reminder ──
  useEffect(() => {
    const interval = setInterval(() => {
      if (
        !micOn.current &&
        !videoOn &&
        isCapturing &&
        Date.now() - lastMicAlert.current > 30000
      ) {
        showToast("Tap mic or camera to interact", "info");
        lastMicAlert.current = Date.now();
      } else {
        lastMicAlert.current = Date.now();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [isCapturing, videoOn, showToast]);

  // ── Dark mode body class ──
  useEffect(() => {
    document.body.classList.toggle("dark", isDarkMode);
  }, [isDarkMode]);

  // ── Tick interval — update timestamps & cooldown state ──
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // ORB STATE
  // ═══════════════════════════════════════════════════════════════

  const orbState = (() => {
    if (!roomConnected.current || !isCapturing) return "inactive";
    if (animate) return "speaking";
    if (micOn.current) return "listening";
    return "idle";
  })();

  const orbLabel = (() => {
    if (phase === "connecting") return "Connecting\u2026";
    if (!roomConnected.current) return "Connecting\u2026";
    if (!isCapturing) {
      return lastCaptureToggleRef.current > 0 ? "Session paused" : "Starting\u2026";
    }
    if (animate) return "Speaking\u2026";
    if (micOn.current) return "Listening\u2026";
    return "Ready when you are";
  })();

  const displayName = agentName || (mode === "voice" ? "Voice Agent" : "AI Agent");
  const initial = displayName.charAt(0).toUpperCase();

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  return (
    <div className={`au ${isDarkMode ? "" : "au-light"}`}>
      {/* ── MediaSFU Handler (hidden — creates room) ────────── */}
      {showRoom && (
        <MediaSFUHandler
          action={showRoomDetails.current.action}
          duration={showRoomDetails.current.duration}
          capacity={showRoomDetails.current.capacity}
          name={showRoomDetails.current.name}
          meetingID={showRoomDetails.current.meetingID}
          sourceParameters={sourceParameters.current}
          updateSourceParameters={updateSourceParameters}
          apiBaseUrl={baseUrl}
          credentials={credentials}
        />
      )}

      {/* ══════════════ PRE-SESSION ══════════════ */}
      {phase === "presession" && (
        <div className={`au-presession au-idle-${idleStyle}`}>

          {/* ── Style: Classic Orb (default) ──────────────────── */}
          {idleStyle === "orb" && (
            <>
              <div className="au-orb-idle">
                <div className="au-orb-ring au-orb-ring--outer" />
                <div className="au-orb-ring au-orb-ring--mid" />
                <div className="au-orb-ring au-orb-ring--inner" />
                <div className="au-orb-core" onClick={() => startSession("voice")} style={{ cursor: 'pointer' }}>
                  <svg viewBox="0 0 24 24" className="au-orb-mic"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
                </div>
              </div>
              <span className="au-orb-label" onClick={() => startSession("voice")} style={{ cursor: 'pointer' }}>Tap to speak</span>
              <p className="au-pre-sub">{displayName}</p>
              {mode === "voice" ? (
                <button className="au-pre-start au-pre-start--voice" onClick={() => startSession("voice")}>
                  Start Conversation
                </button>
              ) : (
                <div className="au-mode-row">
                  <button className="au-mode-pill" onClick={() => startSession("voice")}>🎤 Voice</button>
                  <button className="au-mode-pill" onClick={() => startSession("vision")}>📹 Camera</button>
                  <button className="au-mode-pill" onClick={() => startSession("both")}>✦ Both</button>
                </div>
              )}
            </>
          )}

          {/* ── Style: Agent Card ─────────────────────────────── */}
          {idleStyle === "card" && (
            <>
              <div className="au-card-idle">
                <div className="au-card-avatar">
                  <span className="au-card-initial">{initial}</span>
                  <span className="au-card-status" />
                </div>
                <h3 className="au-card-name">{displayName}</h3>
                <span className="au-card-role">AI Assistant</span>
                <p className="au-card-desc">
                  {mode === "voice"
                    ? "Ready for a voice conversation"
                    : "Voice, camera, or text — your choice"}
                </p>
                {mode === "voice" ? (
                  <button className="au-card-cta" onClick={() => startSession("voice")}>
                    Start Conversation
                  </button>
                ) : (
                  <div className="au-mode-row">
                    <button className="au-mode-pill" onClick={() => startSession("voice")}>🎤 Voice</button>
                    <button className="au-mode-pill" onClick={() => startSession("vision")}>📹 Camera</button>
                    <button className="au-mode-pill" onClick={() => startSession("both")}>✦ Both</button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Style: Glass Panel ────────────────────────────── */}
          {idleStyle === "glass" && (
            <>
              <div className="au-glass-idle">
                <div className="au-glass-glow" />
                <div className="au-glass-content">
                  <div className="au-glass-icon">
                    <svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
                  </div>
                  <h3 className="au-glass-title">{displayName}</h3>
                  <span className="au-glass-status">● Online</span>
                  <div className="au-glass-modes">
                    <button className="au-glass-btn" onClick={() => startSession("voice")} title="Voice">
                      <svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
                    </button>
                    {mode === "multimodal" && (
                      <>
                        <button className="au-glass-btn" onClick={() => startSession("vision")} title="Camera">
                          <svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
                        </button>
                        <button className="au-glass-btn" onClick={() => startSession("both")} title="Both">
                          <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── Style: Welcome Panel ──────────────────────────── */}
          {idleStyle === "welcome" && (
            <>
              <div className="au-welcome-idle">
                <div className="au-welcome-header">
                  <div className="au-welcome-brand">
                    <div className="au-welcome-logo">{initial}</div>
                    <span className="au-welcome-name">{displayName}</span>
                  </div>
                  <span className="au-welcome-online">● Online</span>
                </div>
                <div className="au-welcome-body">
                  <h2 className="au-welcome-greeting">
                    Hello! 👋
                  </h2>
                  <p className="au-welcome-text">
                    {mode === "voice"
                      ? "I'm ready to chat. Tap below to start a voice conversation."
                      : "Choose how you'd like to interact — voice, camera, or both."}
                  </p>
                  {mode === "voice" ? (
                    <button className="au-welcome-cta" onClick={() => startSession("voice")}>
                      🎤 Start Voice Chat
                    </button>
                  ) : (
                    <div className="au-welcome-modes">
                      <button className="au-welcome-mode" onClick={() => startSession("voice")}>
                        <span className="au-welcome-mode-icon">🎤</span>
                        <span className="au-welcome-mode-label">Voice</span>
                      </button>
                      <button className="au-welcome-mode" onClick={() => startSession("vision")}>
                        <span className="au-welcome-mode-icon">📹</span>
                        <span className="au-welcome-mode-label">Camera</span>
                      </button>
                      <button className="au-welcome-mode" onClick={() => startSession("both")}>
                        <span className="au-welcome-mode-icon">✦</span>
                        <span className="au-welcome-mode-label">Both</span>
                      </button>
                    </div>
                  )}
                </div>
                <div className="au-welcome-footer">
                  <span>Voice & video processed in real-time</span>
                </div>
              </div>
            </>
          )}

          {/* ── Shared: disclaimer + branding ─────────────────── */}
          {idleStyle !== "welcome" && (
            <p className="au-pre-disclaimer">
              By connecting you agree to our Terms &amp; Privacy Policy.
              <br />
              Voice and video are processed in real-time and not stored.
            </p>
          )}
          {showBranding && (
            <span className="au-branding">Powered by <a href="https://mediasfu.com" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>MediaSFU</a></span>
          )}
        </div>
      )}

      {/* ══════════════ CONNECTING ══════════════ */}
      {phase === "connecting" && (
        <div className="au-connecting">
          <div className="au-spinner" />
          <p className="au-connecting-text">
            {startModeRef.current === "vision"
              ? "Requesting camera access..."
              : "Requesting microphone access..."}
          </p>
          <p className="au-connecting-sub">Setting up your session</p>
        </div>
      )}

      {/* ══════════════ ACTIVE SESSION ══════════════ */}
      {phase === "active" && (
        <div className="au-active">
          {/* ── Header ── */}
          <div className="au-header">
            <div className="au-header-left">
              <div className="au-avatar">{initial}</div>
              <div className="au-header-info">
                <span className="au-agent-name">{displayName}</span>
                <span className="au-agent-status">
                  <span className="au-status-dot" />
                  {isCapturing ? "Live" : "Connected"}
                </span>
              </div>
            </div>
            <div className="au-header-right">
              {isCapturing && (
                <span className="au-live-badge">
                  <span className="au-live-dot" /> LIVE
                </span>
              )}
              <button
                className="au-icon-btn au-icon-btn--theme"
                onClick={() => setIsDarkMode((p) => !p)}
                title="Toggle theme"
              >
                {isDarkMode ? "☀️" : "🌙"}
              </button>
              <button
                className="au-icon-btn au-icon-btn--close"
                onClick={endSession}
                title="End session"
              >
                <FontAwesomeIcon icon={faTimes} />
              </button>
            </div>
          </div>

          {/* ── Video pane (when camera on) ── */}
          {videoOn && (
            <div className="au-video-pane">
              <video
                ref={selfVideoRef}
                className="au-video"
                autoPlay
                muted
                playsInline
              />
              {/* Agent status overlay on video */}
              <div className="au-video-agent-status">
                <div className={`au-mini-orb ${orbState}`}>
                  {animate ? (
                    <div className="au-mini-wave">
                      {[...Array(3)].map((_, i) => (
                        <div
                          key={i}
                          className="au-mini-wave-bar"
                          style={{ animationDelay: `${i * 0.12}s` }}
                        />
                      ))}
                    </div>
                  ) : (
                    <span>{initial}</span>
                  )}
                </div>
                <span className="au-video-status-label">{orbLabel}</span>
              </div>
              {/* Vision caption overlay */}
              {visionCaption && (
                <div className="au-vision-caption">
                  <span className="au-vision-tag">👁️ Vision</span>
                  <span>{visionCaption}</span>
                </div>
              )}
              {/* Switch camera */}
              <button
                className="au-swap-cam"
                onClick={swapCamera}
                title="Switch camera"
              >
                <FontAwesomeIcon icon={faSyncAlt} />
              </button>
            </div>
          )}

          {/* ── Orb section (when no camera) ── */}
          {!videoOn && (
            <div className="au-orb-section">
              <div
                className={`au-orb ${orbState}`}
                onClick={toggleMicHandler}
                title={
                  micOn.current ? "Click to mute" : "Click to unmute"
                }
              >
                <div className="au-orb-ring" />
                <div className="au-orb-ring au-orb-ring--2" />
                <div className="au-orb-core">
                  {orbState === "speaking" ? (
                    <div className="au-waveform">
                      {[...Array(7)].map((_, i) => (
                        <div
                          key={i}
                          className="au-waveform-bar"
                          style={{ animationDelay: `${i * 0.08}s` }}
                        />
                      ))}
                    </div>
                  ) : (
                    <FontAwesomeIcon
                      icon={
                        micOn.current ? faMicrophone : faMicrophoneSlash
                      }
                      className="au-orb-icon"
                    />
                  )}
                </div>
              </div>
              <span className={`au-orb-label au-orb-label--${orbState}`}>
                {orbLabel}
              </span>
              {orbState === "listening" && (
                <span className="au-orb-sub">I&apos;m all ears</span>
              )}
              {orbState === "speaking" && (
                <span className="au-orb-sub">
                  Agent responding
                  {doAEC.current
                    ? realtimeVoiceMode.current
                      ? " · echo cancellation on"
                      : " · mic auto-muted"
                    : ""}
                </span>
              )}
            </div>
          )}

          {/* ── Transcript bar ── */}
          <div className="au-transcript">
            {transcript ? (
              <p>
                <span className="au-transcript-tag">🎤 You:</span>{" "}
                {transcript}
              </p>
            ) : (
              <p className="au-transcript-empty">
                {micOn.current
                  ? "Listening for speech..."
                  : "Speak or type below..."}
              </p>
            )}
          </div>

          {/* ── Chat messages ── */}
          <div className="au-chat" ref={chatBoxRef}>
            {chatMessages.length === 0 && (
              <div className="au-msg au-msg--system">
                <em>Session starting...</em>
              </div>
            )}
            {chatMessages.map((msg, idx) => (
              <div
                key={idx}
                className={`au-msg au-msg--${msg.sender.toLowerCase()}`}
              >
                {msg.sender === "System" ? (
                  <em className="au-msg-system-text">{msg.message}</em>
                ) : (
                  <>
                    <div className="au-msg-avatar">
                      {msg.sender === "Agent"
                        ? initial
                        : msg.sender === "You"
                        ? "Y"
                        : "ℹ"}
                    </div>
                    <div className="au-msg-content">
                      <div className="au-msg-bubble">{msg.message}</div>
                      <span className="au-msg-meta">
                        {msg.sender === "Agent"
                          ? displayName
                          : "You"}{" "}
                        · {formatRelativeTime(msg.timestamp)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* ── Text input ── */}
          <div className="au-input-row">
            <input
              type="text"
              className="au-input"
              placeholder={
                isCapturing
                  ? "Type a message..."
                  : "Start session to send messages"
              }
              value={chatInput}
              maxLength={500}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendTextMessage();
              }}
              disabled={!isCapturing}
            />
            <button
              className="au-send-btn"
              onClick={sendTextMessage}
              disabled={!isCapturing || !chatInput.trim()}
            >
              <FontAwesomeIcon icon={faPaperPlane} />
            </button>
          </div>

          {/* ── Controls dock ── */}
          <div className="au-controls">
            <button
              className={`au-ctrl ${micOn.current ? "au-ctrl--on" : "au-ctrl--off"}`}
              onClick={toggleMicHandler}
              disabled={isAudioPlaying.current}
              title={micOn.current ? "Mute" : "Unmute"}
            >
              <span className="au-ctrl-icon">
                <FontAwesomeIcon
                  icon={micOn.current ? faMicrophone : faMicrophoneSlash}
                />
              </span>
              <span className="au-ctrl-label">Mic</span>
            </button>

            {mode === "multimodal" && (
              <button
                className={`au-ctrl ${videoOn ? "au-ctrl--cam" : "au-ctrl--off"}`}
                onClick={toggleCameraHandler}
                title={videoOn ? "Camera Off" : "Camera On"}
              >
                <span className="au-ctrl-icon">
                  <FontAwesomeIcon
                    icon={videoOn ? faVideo : faVideoSlash}
                  />
                </span>
                <span className="au-ctrl-label">Cam</span>
              </button>
            )}

            {mode === "multimodal" && (
              <button
                className={`au-ctrl ${isCapturing ? "au-ctrl--on" : "au-ctrl--off"}`}
                onClick={() => (isCapturing ? stopCapture() : startCapture())}
                disabled={
                  Date.now() - lastCaptureToggleRef.current < 15000 &&
                  lastCaptureToggleRef.current > 0
                }
                title={isCapturing ? "Pause session" : "Resume session"}
              >
                <span className="au-ctrl-icon">
                  <FontAwesomeIcon icon={isCapturing ? faPause : faPlay} />
                </span>
                <span className="au-ctrl-label">
                  {isCapturing ? "Pause" : "Resume"}
                </span>
              </button>
            )}

            <button
              className="au-ctrl au-ctrl--end"
              onClick={endSession}
              title="End session"
            >
              <span className="au-ctrl-icon">
                <FontAwesomeIcon icon={faStop} />
              </span>
              <span className="au-ctrl-label">End</span>
            </button>

            <button
              className={`au-ctrl ${doAEC.current ? "au-ctrl--aec" : "au-ctrl--off"}`}
              onClick={toggleAECHandler}
              title="Echo Cancellation"
            >
              <span className="au-ctrl-icon">
                <FontAwesomeIcon
                  icon={
                    doAEC.current
                      ? faDeaf
                      : faAssistiveListeningSystems
                  }
                />
              </span>
              <span className="au-ctrl-label">AEC</span>
            </button>
          </div>
        </div>
      )}

      {/* ══════════════ ENDED ══════════════ */}
      {phase === "ended" && (
        <div className="au-ended">
          <div className="au-ended-icon">👋</div>
          <h2 className="au-ended-title">Session Ended</h2>
          <p className="au-ended-text">
            Thank you for using {displayName}.
          </p>
          <button
            className="au-ended-restart"
            onClick={() => {
              // Reset all state for a new session
              roomConnected.current = false;
              autoCaptureTriggered.current = false;
              socket.current = null;
              agentRoom.current = "";
              setChatMessages([]);
              setTranscript("");
              setIsCapturing(false);
              voicePipelineConfirmed.current = false;
              setVideoOn(false);
              setAnimate(false);
              setVisionCaption("");
              totalVisionTime.current = 0;
              sessionVisionTime.current = 0;
              disableVision.current = false;
              lastCaptureToggleRef.current = 0;
              resetAudioPlayback({ restoreMic: false });
              audioQueue.current = [];
              isAudioPlaying.current = false;
              setPhase("presession");
            }}
          >
            Start New Session
          </button>
          {showBranding && (
            <span className="au-branding">Powered by <a href="https://mediasfu.com" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>MediaSFU</a></span>
          )}
        </div>
      )}

      {/* ── Toast notification ── */}
      {toast && (
        <div className={`au-toast au-toast--${toastType}`}>{toast}</div>
      )}
    </div>
  );
};

export default AgentUnified;
