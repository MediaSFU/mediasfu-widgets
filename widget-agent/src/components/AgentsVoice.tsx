/**
 * AgentsVoice – Widget-adapted voice-only AI agent
 *
 * Adapted from agents-src/components/AgentsVoice.tsx
 * Changes from original:
 *   - Removed cookie-based rate limiting
 *   - Removed react-tooltip → tooltip attributes kept for CSS-only hints
 *   - Removed window.location.reload → postToParent("disconnect")
 *   - Removed navigation links to other routes
 *   - Added props: credentials, baseUrl, onDisconnect
 */

import React, { useState, useEffect, useRef } from "react";
import { Socket } from "socket.io-client";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faMicrophone,
  faMicrophoneSlash,
  faSun,
  faMoon,
  faAssistiveListeningSystems,
  faDeaf,
  faHeadphones,
  faWaveSquare,
  faCommentDots,
  faRobot,
  faCheck,
} from "@fortawesome/free-solid-svg-icons";

import "./AgentsVoice.css";
import { toggleAudio, disconnectRoom } from "../hooks/useAudioVideoSDK";
import MediaSFUHandler, { MediaSFUHandlerProps } from "./MediaSFUHandler";
import type { WidgetConfig } from '../hooks/useWidgetAgent';

// ─── Props ──────────────────────────────────────────────────────

export interface AgentsVoiceProps {
  /** API base URL for MediaSFU (e.g. https://mediasfu.com) */
  baseUrl: string;
  /** Credentials from widget session validation */
  credentials: { apiUserName: string; apiKey: string };
  /** Called when the agent session ends / disconnects */
  onDisconnect?: () => void;
  /** Initial dark mode preference */
  darkMode?: boolean;
  /** Custom display name for the agent (default: "Voice Agent") */
  agentName?: string;
  /** Show "Powered by MediaSFU" branding (default: true) */
  showBranding?: boolean;
  /** Widget configuration from the dashboard (STT/LLM/TTS nicknames, system prompt, etc.) */
  widgetConfig?: WidgetConfig;
}

// ─── PostMessage helper ─────────────────────────────────────────

function postToParent(type: string, payload: Record<string, unknown> = {}) {
  if (window.parent && window.parent !== window) {
    let targetOrigin = "*";
    try {
      if (document.referrer) targetOrigin = new URL(document.referrer).origin;
    } catch { /* fallback */ }
    window.parent.postMessage({ type: `mediasfu:${type}`, payload }, targetOrigin);
  }
}

// ─── Pipeline config ────────────────────────────────────────────

const SESSION_DURATION = 15 * 60 * 1000; // 15 minutes

const config = {
  audio: {
    format: "wav",
    channels: 1,
    sampleRate: 16000,
    denoise: {
      enable: true,
      highpass: 200,
      lowpass: 3000,
      detectSilence: true,
      silenceThreshold: -35,
      silenceDuration: 0.15,
      silenceMinDuration: 0.15,
      pauseOnSilence: true,
    },
    pipeline: ["stt", "ttllm", "tts"],
    sttNickName: "demoDeepgram",
    llmNickName: "demoOpenAILLM",
    ttsNickName: "demoDeepgramTTS",
    returnAudioFormat: "base64",
    returnAll: true,
  },
};

// ─── Component ──────────────────────────────────────────────────

const AgentsVoice: React.FC<AgentsVoiceProps> = ({
  baseUrl,
  credentials,
  onDisconnect,
  darkMode: initialDarkMode = true,
  agentName,
  showBranding = true,
  widgetConfig,
}) => {
  const socket = useRef<Socket | null>(null);
  const alertMessageRef = useRef<string>("");

  // Audio playback
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioUnlocked = useRef<boolean>(false);
  const isAudioPlaying = useRef<boolean>(false);
  const audioQueue = useRef<string[]>([]);

  const [transcript, setTranscript] = useState<string>("");

  // UI states
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const micOn = useRef<boolean>(false);
  const tempMicOn = useRef<boolean>(false);
  const doAEC = useRef<boolean>(true);
  const [showRoom, setShowRoom] = useState<boolean>(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(initialDarkMode);

  // Pipeline / Socket states
  const roomConnected = useRef<boolean>(false);
  const agentRoom = useRef<string>("");
  const sourceParameters = useRef<Record<string, any>>({});
  const [sourceChanged, setSourceChanged] = useState<number>(0);

  function updateSourceParameters(data: Record<string, any>) {
    sourceParameters.current = data;
    setSourceChanged((prev) => prev + 1);
  }

  const [chatMessages, setChatMessages] = useState<{ sender: string; message: string }[]>([]);
  const [showWelcome, setShowWelcome] = useState(true);
  const [animate, setAnimate] = useState(false);
  const audioLevel = useRef<number>(0);

  const showRoomDetails = useRef<MediaSFUHandlerProps | null>({
    action: "create",
    name: "agent",
    sourceParameters: sourceParameters.current,
    updateSourceParameters,
  });

  const lastMicAlert = useRef<number>(0);
  const chatBoxRef = useRef<HTMLDivElement | null>(null);

  // Toast
  const [toast, setToast] = useState<string>("");
  const [toastType, setToastType] = useState<"error" | "success" | "info">("info");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (message: string, type: "error" | "success" | "info" = "info") => {
    setToast(message);
    setToastType(type);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4000);
  };

  const unlockAudioContext = async () => {
    if (!audioContextRef.current) audioContextRef.current = new AudioContext();
    if (audioContextRef.current.state === "suspended") {
      try { await audioContextRef.current.resume(); audioUnlocked.current = true; } catch (e) { console.error("AudioContext unlock failed:", e); }
    }
  };

  async function toggleMic() {
    if (!audioUnlocked.current) await unlockAudioContext();
    if (!Object.keys(sourceParameters.current).length) return;
    await toggleAudio({ sourceParameters: sourceParameters.current });
  }

  // ─── Audio Playback ─────────────────────────────────────────

  async function playQueuedBase64(base64: string) {
    if (isAudioPlaying.current) {
      audioQueue.current.push(base64);
      return;
    }
    try {
      const byteCharacters = atob(base64);
      const byteArray = Uint8Array.from(byteCharacters, (char) => char.charCodeAt(0));
      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      const audioBuffer = await audioContextRef.current.decodeAudioData(byteArray.buffer);
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);

      if (micOn.current && doAEC.current) {
        tempMicOn.current = true;
        await toggleAudio({ sourceParameters: sourceParameters.current });
      }

      isAudioPlaying.current = true;
      setAnimate(true);
      source.start();

      source.onended = async () => {
        setAnimate(false);
        isAudioPlaying.current = false;
        if (tempMicOn.current) {
          await toggleAudio({ sourceParameters: sourceParameters.current });
          tempMicOn.current = false;
        }
        if (audioQueue.current.length > 0) {
          const nextAudio = audioQueue.current.shift();
          if (nextAudio) playQueuedBase64(nextAudio);
        }
      };
    } catch (error) {
      console.error("Failed to play audio:", error);
      isAudioPlaying.current = false;
      setAnimate(false);
      if (tempMicOn.current) {
        await toggleAudio({ sourceParameters: sourceParameters.current });
        tempMicOn.current = false;
      }
    }
  }

  // ─── Source param wiring ──────────────────────────────────

  useEffect(() => {
    if (Object.keys(sourceParameters.current).length > 0) {
      if (sourceParameters.current.audioAlreadyOn !== micOn.current) {
        micOn.current = sourceParameters.current.audioAlreadyOn;
      }
      if (
        (sourceParameters.current.socket && !socket.current) ||
        (sourceParameters.current.localSocket?.id && !socket.current)
      ) {
        socket.current = sourceParameters.current.localSocket?.id
          ? sourceParameters.current.localSocket
          : sourceParameters.current.socket;
      }
      if (sourceParameters.current.audioLevel !== audioLevel.current) {
        audioLevel.current = sourceParameters.current.audioLevel;
      }

      if (sourceParameters.current.socket?.id && !roomConnected.current) {
        roomConnected.current = true;
        setChatMessages([{ sender: "Agent", message: "Hello! I'm your voice assistant. How can I help you today?" }]);
        console.log("[widget-agent] Connected to room");

        if (sourceParameters.current.roomName !== agentRoom.current && sourceParameters.current.roomName !== "") {
          agentRoom.current = sourceParameters.current.roomName;
          if (!isCapturing) {
            setTimeout(() => startCapture(), 500);
          }
        }

        try {
          if (!socket.current) return;

          socket.current?.on("pipelineResult", (data) => {
            if (data.transcript) {
              setTranscript(data.transcript);
              setChatMessages((prev) => [...prev, { sender: "You", message: data.transcript }]);
            }
            if (data.text) {
              setChatMessages((prev) => [...prev, { sender: "Agent", message: data.text }]);
            }
            if (data.audio) {
              playQueuedBase64(data.audio);
            }
          });

          socket.current?.on("pipelineError", (data) => {
            console.warn("[widget-agent] pipelineError:", data?.error || data);
          });

          socket.current?.on("disconnect", () => {
            roomConnected.current = false;
            console.warn("[widget-agent] Socket disconnected");
            postToParent("agentDisconnect");
            onDisconnect?.();
          });
        } catch (error) {
          console.error("Failed to set up socket listeners:", error);
        }
      }

      if (
        sourceParameters.current.alertMessage &&
        sourceParameters.current.alertMessage !== "" &&
        sourceParameters.current.alertMessage !== alertMessageRef.current
      ) {
        alertMessageRef.current = sourceParameters.current.alertMessage;
        console.warn("[widget-agent] alertMessage:", sourceParameters.current.alertMessage);
      }
    }
  }, [sourceChanged]);

  useEffect(() => {
    return () => {
      try {
        socket.current?.off("pipelineResult");
        socket.current?.off("pipelineError");
        socket.current?.off("disconnect");
      } catch { /* ignore */ }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (roomConnected.current) {
        disconnectRoom({ sourceParameters: sourceParameters.current });
      }
    };
  }, []);

  // ─── Capture ──────────────────────────────────────────────

  function startCapture() {
    try {
      if (!roomConnected.current) { showToast("Connecting...", "info"); return; }
      if (isCapturing) return;

      if (!micOn.current) {
        toggleAudio({ sourceParameters: sourceParameters.current });
        micOn.current = true;
      }

      if (socket.current && agentRoom.current && socket.current?.id) {
        // ── Apply widget config overrides before emitting ──
        if (widgetConfig?.sttNickName) config.audio.sttNickName = widgetConfig.sttNickName;
        if (widgetConfig?.llmNickName) config.audio.llmNickName = widgetConfig.llmNickName;
        if (widgetConfig?.ttsNickName) config.audio.ttsNickName = widgetConfig.ttsNickName;
        const agentProfile = (widgetConfig?.agentProfile || {}) as Record<string, any>;
        const audioWidgetConfig = (widgetConfig?.audioConfig || widgetConfig?.audio || {}) as Record<string, any>;
        const systemPrompt = widgetConfig?.systemPrompt || agentProfile.systemPrompt || audioWidgetConfig.systemPrompt;
        const fallbackBehavior = widgetConfig?.fallbackBehavior || agentProfile.fallbackBehavior || audioWidgetConfig.fallbackBehavior;
        const fallbackText =
          widgetConfig?.fallbackMessage ||
          widgetConfig?.fallbackResponse ||
          agentProfile.fallbackMessage ||
          agentProfile.fallbackResponse ||
          audioWidgetConfig.fallbackMessage ||
          audioWidgetConfig.fallbackResponse;
        if (systemPrompt) (config.audio as any).systemPrompt = systemPrompt;
        if (fallbackBehavior) (config.audio as any).fallbackBehavior = fallbackBehavior;
        if (fallbackText) {
          (config.audio as any).fallbackMessage = fallbackText;
          (config.audio as any).fallbackResponse = fallbackText;
        }
        if (widgetConfig?.extra) (config.audio as any).extra = widgetConfig.extra;

        socket.current.on("startBuffers", () => {
          socket.current?.emit(
            "startBuffer",
            { roomName: agentRoom.current, member: "agent" },
            (response: any) => {
              if (response.success) setIsCapturing(true);
              else console.warn("[widget-agent] Failed to start buffer:", response.reason);
            }
          );
        });

        // Sanitize: strip empty-string values from param objects
        // (Joi.string() disallows '' in validateInput.cjs)
        const sanitized = { ...config };
        if (sanitized.audio) {
          const out = { ...sanitized.audio } as Record<string, any>;
          for (const key of ["ttsParams", "sttParams", "llmParams"] as const) {
            if (out[key] && typeof out[key] === "object") {
              const cleaned: Record<string, any> = {};
              for (const [k, v] of Object.entries(out[key] as Record<string, any>)) {
                if (v !== "" && v !== null && v !== undefined) cleaned[k] = v;
              }
              if (Object.keys(cleaned).length > 0) out[key] = cleaned;
              else delete out[key];
            }
          }
          sanitized.audio = out as typeof config.audio;
        }

        socket.current.emit(
          "startDataBuffer",
          { roomName: agentRoom.current, config: sanitized },
          (response: any) => {
            if (response.success) {
              setIsCapturing(true);
            } else {
              console.warn("[widget-agent] Failed to start data buffer:", response?.reason);
            }
          }
        );
      }
    } catch (error) {
      console.error("Failed to start capture:", error);
    }
  }

  function toggleDarkMode() {
    setIsDarkMode((prev) => !prev);
  }

  // Connect to room
  const connectToRoom = () => {
    if (showRoom) return;
    setShowRoom(true);

    // Session timeout
    setTimeout(() => {
      showToast("Session ended.", "info");
      postToParent("agentDisconnect");
      onDisconnect?.();
    }, SESSION_DURATION);
  };

  useEffect(() => {
    if (chatBoxRef.current) chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
  }, [chatMessages]);

  const dismissWelcome = () => {
    setShowWelcome(false);
    connectToRoom();
  };

  useEffect(() => {
    const interval = setInterval(() => {
      if (!micOn.current && isCapturing && Date.now() - lastMicAlert.current > 30000) {
        showToast("Tap the mic to start speaking", "info");
        lastMicAlert.current = Date.now();
      } else {
        lastMicAlert.current = Date.now();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [isCapturing]);

  // Orb state
  const getOrbState = () => {
    if (!roomConnected.current || !isCapturing) return "inactive";
    if (animate) return "speaking";
    if (micOn.current) return "listening";
    return "inactive";
  };

  const orbState = getOrbState();

  // ─── Render ──────────────────────────────────────────────

  return (
    <div className={`voice-agent ${!isDarkMode ? "va-light-mode" : ""}`}>
      {/* MediaSFU Handler - Hidden */}
      {showRoom && showRoomDetails.current && (
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

      {/* Welcome Modal */}
      {showWelcome && (
        <div className="voice-agent__welcome-overlay">
          <div className="voice-agent__welcome-card">
            <div className="voice-agent__welcome-icon">
              <FontAwesomeIcon icon={faHeadphones} />
            </div>
            <h2 className="voice-agent__welcome-title">Voice Agent</h2>
            <p className="voice-agent__welcome-text">
              Experience real-time voice conversations powered by MediaSFU&apos;s AI orchestration.
            </p>
            <div className="voice-agent__welcome-features">
              <div className="voice-agent__welcome-feature">
                <div className="voice-agent__welcome-feature-icon">
                  <FontAwesomeIcon icon={faWaveSquare} />
                </div>
                <span>Real-time speech recognition</span>
              </div>
              <div className="voice-agent__welcome-feature">
                <div className="voice-agent__welcome-feature-icon">
                  <FontAwesomeIcon icon={faRobot} />
                </div>
                <span>Intelligent AI responses</span>
              </div>
              <div className="voice-agent__welcome-feature">
                <div className="voice-agent__welcome-feature-icon">
                  <FontAwesomeIcon icon={faCommentDots} />
                </div>
                <span>Natural voice output</span>
              </div>
            </div>
            <button className="voice-agent__welcome-dismiss voice-agent__connect-btn" onClick={dismissWelcome}>
              <FontAwesomeIcon icon={faCheck} style={{ marginRight: 8 }} />
              Connect &amp; Get Started
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="voice-agent__header">
        <div className="voice-agent__logo">
          <div className="voice-agent__logo-icon">
            <FontAwesomeIcon icon={faHeadphones} />
          </div>
          <h1 className="voice-agent__title">{agentName || 'Voice Agent'}</h1>
          {showBranding !== false && (
            <a href="https://mediasfu.com" target="_blank" rel="noopener noreferrer" className="powered-by">Powered by MediaSFU</a>
          )}
        </div>
        <div className="voice-agent__controls-header">
          <div className="voice-agent__status">
            <span className={`voice-agent__status-dot ${roomConnected.current ? "connected" : ""}`} />
            <span>{roomConnected.current ? "Connected" : "Connecting..."}</span>
          </div>
          <button className="voice-agent__theme-btn" onClick={toggleDarkMode} title={isDarkMode ? "Light Mode" : "Dark Mode"}>
            <FontAwesomeIcon icon={isDarkMode ? faSun : faMoon} />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="voice-agent__main">
        {/* Voice Orb */}
        <div className="voice-agent__orb-container">
          <div className={`voice-agent__orb ${orbState}`} onClick={toggleMic} title={micOn.current ? "Click to mute" : "Click to unmute"}>
            <div className="voice-agent__orb-bg" />
            <div className="voice-agent__orb-ring" />
            <div className="voice-agent__orb-core">
              <FontAwesomeIcon
                icon={!roomConnected.current || !isCapturing ? faMicrophoneSlash : micOn.current ? faMicrophone : faMicrophoneSlash}
                className="voice-agent__orb-icon"
              />
            </div>
          </div>
          <div className="voice-agent__orb-label">
            <strong>
              {!roomConnected.current
                ? "Connecting..."
                : !isCapturing
                ? "Starting..."
                : animate
                ? "Speaking..."
                : micOn.current
                ? "Listening..."
                : "Tap to speak"}
            </strong>
            {orbState === "listening" && "I'm all ears"}
            {orbState === "speaking" && "Agent is responding"}
          </div>
          <div className={`voice-agent__level ${micOn.current && !animate ? "active" : ""}`}>
            <div className="voice-agent__level-bar" />
            <div className="voice-agent__level-bar" />
            <div className="voice-agent__level-bar" />
            <div className="voice-agent__level-bar" />
            <div className="voice-agent__level-bar" />
          </div>
        </div>

        {/* Transcript */}
        <div className="voice-agent__transcript">
          <div className="voice-agent__transcript-header">
            <span className="voice-agent__transcript-dot" />
            <span>Live Transcript</span>
          </div>
          <p className={`voice-agent__transcript-text ${!transcript ? "empty" : ""}`}>
            {transcript || "Your speech will appear here..."}
          </p>
        </div>

        {/* Chat Messages */}
        <div className="voice-agent__chat" ref={chatBoxRef}>
          {chatMessages.length === 0 ? (
            <div className="voice-agent__message system">
              <span className="voice-agent__message-text">
                {!roomConnected.current ? "Waiting for connection..." : !isCapturing ? "Connected! Starting capture..." : "Ready! Start speaking to the AI..."}
              </span>
            </div>
          ) : (
            chatMessages.map((msg, idx) => (
              <div key={idx} className={`voice-agent__message ${msg.sender === "You" ? "user" : msg.sender === "Agent" ? "agent" : "system"}`}>
                <span className="voice-agent__message-sender">{msg.sender}</span>
                <span className="voice-agent__message-text">{msg.message}</span>
              </div>
            ))
          )}
        </div>

        {/* Action Buttons */}
        <div className="voice-agent__actions">
          <button
            className={`voice-agent__btn voice-agent__btn--primary ${micOn.current ? "active" : ""}`}
            onClick={toggleMic}
            disabled={!roomConnected.current || !isCapturing || isAudioPlaying.current}
            title={micOn.current ? "Mute microphone" : "Unmute microphone"}
          >
            <FontAwesomeIcon icon={micOn.current ? faMicrophone : faMicrophoneSlash} />
            <span className="voice-agent__btn-label">{micOn.current ? "Mute" : "Unmute"}</span>
          </button>

          <button
            className={`voice-agent__btn voice-agent__btn--secondary ${doAEC.current ? "active" : ""}`}
            onClick={() => { doAEC.current = !doAEC.current; showToast(doAEC.current ? "Echo cancellation ON" : "Echo cancellation OFF", "info"); }}
            title={doAEC.current ? "Echo Cancellation On" : "Echo Cancellation Off"}
          >
            <FontAwesomeIcon icon={doAEC.current ? faDeaf : faAssistiveListeningSystems} />
            <span className="voice-agent__btn-label">AEC</span>
          </button>
        </div>
      </main>

      {/* Toast */}
      {toast && <div className={`voice-agent__toast ${toastType}`}>{toast}</div>}
    </div>
  );
};

export default AgentsVoice;
