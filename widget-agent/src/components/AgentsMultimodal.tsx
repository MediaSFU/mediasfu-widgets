/**
 * AgentsMultimodal – Widget-adapted multimodal AI agent
 *
 * Adapted from agents-src/components/AgentsAd.tsx
 * Changes from original:
 *   - Removed axios → fetch
 *   - Removed cookie-based rate limiting (widget manages server-side)
 *   - Removed sessionStorage welcome state
 *   - Removed process.env.REACT_APP_BACKEND_URL → props.baseUrl
 *   - Removed window.location.reload → postToParent("disconnect")
 *   - Removed demo alert banner and navigation links
 *   - Added props: credentials, baseUrl, onDisconnect
 */

import React, { useState, useEffect, useRef } from "react";
import { Socket } from "socket.io-client";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faMicrophone,
  faMicrophoneSlash,
  faVideo,
  faVideoSlash,
  faPlay,
  faStop,
  faSun,
  faMoon,
  faSyncAlt,
  faPaperPlane,
  faAssistiveListeningSystems,
  faDeaf,
} from "@fortawesome/free-solid-svg-icons";
import "../App.css";
import AudioVisualizer from "./AudioVisualizer";
import {
  toggleAudio,
  toggleVideo,
  disconnectRoom,
  switchCamera,
  selectCamera,
} from "../hooks/useAudioVideoSDK";
import MediaSFUHandler, { MediaSFUHandlerProps } from "./MediaSFUHandler";

// ─── Props ──────────────────────────────────────────────────────

import type { WidgetConfig } from '../hooks/useWidgetAgent';

export interface AgentsMultimodalProps {
  /** API base URL for MediaSFU (e.g. https://mediasfu.com) */
  baseUrl: string;
  /** Credentials from widget session validation */
  credentials: { apiUserName: string; apiKey: string };
  /** Widget configuration from the dashboard (STT/LLM/TTS nicknames, system prompt, etc.) */
  widgetConfig?: WidgetConfig;
  /** Called when the agent session ends / disconnects */
  onDisconnect?: () => void;
  /** Initial dark mode preference */
  darkMode?: boolean;
  /** Custom agent name displayed in the header (e.g. "Acme Support Agent") */
  agentName?: string;
  /** Show 'Powered by MediaSFU' branding link (default: true) */
  showBranding?: boolean;
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

// ─── Audio/pipeline config ──────────────────────────────────────

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
      silenceDuration: 0.25,
      silenceMinDuration: 0.25,
      pauseOnSilence: true,
    },
    pipeline: ["stt", "ttllm", "tts"],
    sttNickName: "demoGoogleSTT",
    llmNickName: "demoGeminiLLM",
    ttsNickName: "demoGoogleTTS",
    ttsParams: { voiceId: "", voice: "" },
    returnAudioFormat: "base64",
    returnAll: true,
  },
  vision: {
    fps: 0.5,
    pipeline: ["visionllm", "tts"],
    llmNickName: "demoGeminiLLM",
    ttsNickName: "demoGoogleTTS",
    ttsParams: { voiceId: "", voice: "" },
    returnAudioFormat: "base64",
    returnAll: true,
  },
};

// Strip empty-string/null/undefined values from param objects before sending
// (Joi.string() disallows '' by default in validateInput.cjs)
function sanitizeConfig(cfg: typeof config) {
  const stripEmpty = (obj: Record<string, any>) => {
    const cleaned: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== "" && v !== null && v !== undefined) cleaned[k] = v;
    }
    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
  };
  const sanitizeBlock = (block: Record<string, any>) => {
    const out = { ...block };
    for (const key of ["ttsParams", "sttParams", "llmParams"] as const) {
      if (out[key] && typeof out[key] === "object") {
        const cleaned = stripEmpty(out[key]);
        if (cleaned) out[key] = cleaned;
        else delete out[key];
      }
    }
    return out;
  };
  const result: Record<string, any> = {};
  if (cfg.audio) result.audio = sanitizeBlock(cfg.audio);
  if (cfg.vision) result.vision = sanitizeBlock(cfg.vision);
  return result;
}

// ─── Component ──────────────────────────────────────────────────

const AgentsMultimodal: React.FC<AgentsMultimodalProps> = ({
  baseUrl,
  credentials,
  widgetConfig,
  onDisconnect,
  darkMode: initialDarkMode = true,
  agentName,
  showBranding = true,
}) => {
  const socket = useRef<Socket | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioUnlocked = useRef<boolean>(false);
  const isAudioPlaying = useRef<boolean>(false);
  const audioQueue = useRef<string[]>([]);

  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [transcript, setTranscript] = useState<string>("");
  const [validTranscript, setValidTranscript] = useState<string>("");
  const selfVideoRef = useRef<HTMLVideoElement | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  const asrModelChoice = useRef<string>("GoogleSTT");
  const ttsChoice = useRef<string>("GoogleTTS");
  const visionModelChoice = useRef<string>("Gemini-Vision");
  const llmChoice = useRef<string>("OpenAI GPT-4");
  const outputMode = useRef<string>("Audio+Text");
  const googleAvialableVoices = useRef<
    { voice_id: string; name: string; gender: string; accent: string; description: string; language: string; label: string }[]
  >([]);
  const elevenLabsAvialableVoices = useRef<
    { voice_id: string; name: string; gender: string; accent: string; description: string; language: string; label: string }[]
  >([]);

  const micOn = useRef<boolean>(false);
  const tempMicOn = useRef<boolean>(false);
  const doAEC = useRef<boolean>(true);
  const [videoOn, setVideoOn] = useState<boolean>(false);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoInput, setSelectedVideoInput] = useState<string>("");
  const roomConnected = useRef<boolean>(false);
  const autoCaptureTriggered = useRef(false);
  const agentRoom = useRef<string>("");
  const [sourceChanged, setSourceChanged] = useState<number>(0);
  const sourceParameters = useRef<Record<string, any>>({});
  const updateSourceParameters = (data: Record<string, any>) => {
    sourceParameters.current = data;
    setSourceChanged((prev) => prev + 1);
  };

  // Chat States
  const [chatMessages, setChatMessages] = useState<{ sender: string; message: string }[]>([]);
  const [chatInput, setChatInput] = useState<string>("");
  const [waitingForAgent, setWaitingForAgent] = useState<boolean>(false);

  // Loading States
  const [isDarkMode, setIsDarkMode] = useState<boolean>(initialDarkMode);
  const [toast, setToast] = useState<string>("");
  const [toastType, setToastType] = useState<"error" | "success" | "info">("info");
  const modelToast = useRef<boolean>(false);

  const [userConnectPrompt, setUserConnectPrompt] = useState<boolean>(false);
  const [modelBarCollapsed, setModelBarCollapsed] = useState(false);
  const [animate, setAnimate] = useState(false);
  const audioLevel = useRef<number>(0);
  const prevAudioLevel = useRef<number>(0);
  const lastMicAlert = useRef<number>(0);
  const lastVideoAlert = useRef<number>(0);
  const showRoomDetails = useRef<MediaSFUHandlerProps | null>({
    action: "create",
    name: "agent",
    sourceParameters: sourceParameters.current,
    updateSourceParameters,
  });
  const chatBoxRef = useRef<HTMLDivElement | null>(null);

  // Voice selection
  const [availableVoices, setAvailableVoices] = useState<
    { voice_id: string; name: string; gender: string; accent: string; description: string; language: string; label: string }[]
  >([]);
  const [loadingVoices, setLoadingVoices] = useState<boolean>(true);
  const selectedVoiceId = useRef<string>("en-US-Wavenet-D");

  // Vision Time Management
  const totalVisionTime = useRef<number>(0);
  const sessionVisionTime = useRef<number>(0);
  const disableVision = useRef<boolean>(false);
  const visionTimeLimitPerCapture = 5000;
  const visionTimeLimitTotal = 30000;

  const manageVisionTime = () => {
    if ((!videoOn || !isCapturing) && sessionTimerRef.current) {
      clearInterval(sessionTimerRef.current);
    }
    if (disableVision.current) return;
    if (sessionTimerRef.current) return;

    if (totalVisionTime.current >= visionTimeLimitTotal) {
      if (!disableVision.current) {
        showToast("Vision model disabled. Maximum vision time reached.", "info");
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
        showToast("Session vision time limit (5s) exceeded. Turning off camera.", "info");
        if (Object.keys(sourceParameters.current).length !== 0) {
          toggleVideo({ sourceParameters: sourceParameters.current });
        }
        disableVision.current = true;
        clearInterval(sessionTimerRef.current!);
        sessionTimerRef.current = null;
      }
      if (totalVisionTime.current >= visionTimeLimitTotal) {
        showToast("Vision model disabled. Maximum vision time reached.", "info");
        if (Object.keys(sourceParameters.current).length !== 0) {
          toggleVideo({ sourceParameters: sourceParameters.current });
        }
        disableVision.current = true;
        clearInterval(sessionTimerRef.current!);
        sessionTimerRef.current = null;
      }
    }, 1000);
  };

  // Capture cooldown
  const lastCaptureToggleRef = useRef<number>(0);
  const sessionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const intelligent = (text: string) => {
    return (
      text !== "It." &&
      text !== "" &&
      text !== "No speech recognized." &&
      text !== "ASR processing failed." &&
      text !== "Sorry, I didn't catch that." &&
      text !== "Sorry, I didn't get that." &&
      text !== "Sorry, I could not understand that."
    );
  };

  const playSound = (type: string) => {
    let url: string | undefined;
    if (type === "error") {
      if (availableVoices.length > 0) {
        const selectedVoice = availableVoices.find((v) => v.voice_id === selectedVoiceId.current);
        if (selectedVoice && selectedVoice.gender === "male") {
          url = "https://mediasfu.com/sorry_agent_male.mp3";
        }
      }
      if (!url) url = "https://mediasfu.com/sorry_agent.wav";
    } else {
      url = "https://mediasfu.com/welcome_agent.wav";
    }

    if (!isAudioPlaying.current) {
      const audio = new Audio(url);
      isAudioPlaying.current = true;
      setAnimate(true);
      if (micOn.current && doAEC.current) {
        tempMicOn.current = true;
        toggleAudio({ sourceParameters: sourceParameters.current });
      }
      audio.play().catch((error) => {
        console.error("Error playing audio:", error);
        isAudioPlaying.current = false;
        setAnimate(false);
        if (tempMicOn.current) {
          toggleAudio({ sourceParameters: sourceParameters.current });
          tempMicOn.current = false;
        }
      });
      audio.onended = () => {
        isAudioPlaying.current = false;
        setAnimate(false);
        if (tempMicOn.current) {
          toggleAudio({ sourceParameters: sourceParameters.current });
          tempMicOn.current = false;
        }
      };
    }
  };

  const showToast = (message: string, type: "error" | "success" | "info" = "info") => {
    setToast(message);
    setToastType(type);
    setTimeout(() => setToast(""), 5000);
  };

  // ─── Fetch Voices (uses fetch instead of axios)  ──────────

  const fetchVoices = async () => {
    try {
      const voicesUrl = `${baseUrl}/api/voices?model=${ttsChoice.current}`;
      const response = await fetch(voicesUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const voices = data.voices;

      let processedVoices: typeof availableVoices = [];
      if (ttsChoice.current === "ElevenLabs") {
        processedVoices = voices.map((voice: any) => ({
          voice_id: voice.voice_id,
          name: voice.name,
          gender: voice.labels?.gender || "Unknown",
          accent: voice.labels?.accent || "Unknown",
          description: voice.labels?.description || "Unknown",
          language: voice.labels?.language || "Unknown",
          label: `${voice.name} - ${voice.labels?.accent || "Unknown"} - ${voice.labels?.gender || "Unknown"}`,
        }));
        elevenLabsAvialableVoices.current = processedVoices;
      } else if (ttsChoice.current === "GoogleTTS") {
        processedVoices = voices.map((voice: any) => ({
          voice_id: voice.name,
          name: voice.name,
          gender: voice.ssmlGender || "Unknown",
          accent: voice.languageCodes.join(", "),
          description: `${voice.naturalSampleRateHertz}Hz`,
          language: voice.languageCodes[0],
          label: `${voice.name} - ${voice.languageCodes[0]} - ${voice.ssmlGender}`,
        }));
        googleAvialableVoices.current = processedVoices;
      }

      setAvailableVoices(processedVoices);
      if (ttsChoice.current === "GoogleTTS") {
        const english = processedVoices.filter((v: any) => v.language.includes("en"));
        selectedVoiceId.current = english[0]?.voice_id || "";
      } else {
        selectedVoiceId.current = processedVoices[0]?.voice_id || "";
      }
    } catch (error) {
      console.error("Error fetching voices:", error);
    } finally {
      setLoadingVoices(false);
    }
  };

  useEffect(() => {
    fetchVoices();
  }, []);

  useEffect(() => {
    if (videoOn && isCapturing) {
      manageVisionTime();
    } else {
      if (sessionTimerRef.current) {
        clearTimeout(sessionTimerRef.current);
        sessionTimerRef.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoOn, isCapturing]);

  const checkTTS = async (value: string) => {
    if (value === "ElevenLabs") {
      if (elevenLabsAvialableVoices.current.length === 0) {
        await fetchVoices();
      } else {
        selectedVoiceId.current = elevenLabsAvialableVoices.current[0]?.voice_id || "";
      }
    } else if (value === "GoogleTTS") {
      if (googleAvialableVoices.current.length === 0) {
        await fetchVoices();
      } else {
        selectedVoiceId.current = googleAvialableVoices.current[0]?.voice_id || "";
      }
    }
    ttsChoice.current = value;
  };

  // ─── Source parameter + socket wiring ─────────────────────

  useEffect(() => {
    if (Object.keys(sourceParameters.current).length > 0) {
      if (sourceParameters.current.audioAlreadyOn !== micOn.current) {
        micOn.current = sourceParameters.current.audioAlreadyOn;
      }
      if (sourceParameters.current.videoAlreadyOn !== videoOn) {
        setVideoOn(sourceParameters.current.videoAlreadyOn);
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
        prevAudioLevel.current = audioLevel.current;
        audioLevel.current = sourceParameters.current.audioLevel;
      }
      if (
        sourceParameters.current.userDefaultVideoInputDevice !== "" &&
        sourceParameters.current.userDefaultVideoInputDevice !== selectedVideoInput
      ) {
        setSelectedVideoInput(sourceParameters.current.userDefaultVideoInputDevice);
      }
      if (sourceParameters.current.localStreamVideo && selfVideoRef.current) {
        if (selfVideoRef.current.srcObject !== sourceParameters.current.localStreamVideo) {
          selfVideoRef.current.srcObject = sourceParameters.current.localStreamVideo;
        }
      }

      if (sourceParameters.current.socket?.id && !roomConnected.current) {
        roomConnected.current = true;
        console.log("[widget-agent] Connected to room");
        setChatMessages((prev) => [...prev, { sender: "System", message: "Ready to assist you!" }]);
        setWaitingForAgent(false);

        try {
          if (!socket.current) return;

          socket.current?.on("image", () => { /* vision placeholder */ });

          if (sourceParameters.current.roomName !== agentRoom.current) {
            agentRoom.current = sourceParameters.current.roomName;
          }
          socket.current?.on("audio", () => { /* audio placeholder */ });
          socket.current?.on("silenceDetected", () => { /* silence placeholder */ });

          socket.current?.on("pipelineResult", (data) => {
            if (
              data.text !== null &&
              config?.audio?.pipeline.length !== 0 &&
              config?.audio?.pipeline.some((item) => item === "ttllm") &&
              data.text !== ""
            ) {
              setChatMessages((prev) => [...prev, { sender: "Agent", message: data.text }]);
            }
            if (
              data.text !== null &&
              config?.audio?.pipeline.length === 0 &&
              config?.audio?.pipeline.some((item) => item === "tts") &&
              data.text !== ""
            ) {
              setTranscript(data.text);
            }
            if (data.transcript !== null && data.transcript !== "") {
              setTranscript(data.transcript);
            }
            if (data.audio !== null) {
              playQueuedBase64(data.audio);
            }
          });

          socket.current?.on("pipelineResultVision", (data) => {
            if (data.text !== null && data.text !== "") {
              setChatMessages((prev) => [...prev, { sender: "Agent", message: data.text }]);
            }
            if (data.audio !== null) {
              playQueuedBase64(data.audio);
            }
          });

          socket.current?.on("pipelineError", (data) => {
            console.warn("[widget-agent] pipelineError:", data?.error || data);
          });

          socket.current?.on("pipelineErrorVision", (data) => {
            console.warn("[widget-agent] pipelineErrorVision:", data);
          });

          socket.current?.on("disconnect", () => {
            roomConnected.current = false;
            autoCaptureTriggered.current = false;
            setChatMessages((prev) => [...prev, { sender: "System", message: "Session ended. Refresh to reconnect." }]);
            console.warn("[widget-agent] Socket disconnected");
            postToParent("agentDisconnect");
            onDisconnect?.();
          });
        } catch (error) {
          console.error("Failed to connect to the agent room:", error);
        }

        // Auto-capture: turn on mic and start capture after connecting
        if (!autoCaptureTriggered.current) {
          autoCaptureTriggered.current = true;
          setTimeout(async () => {
            try {
              // Unlock audio context for playback
              if (!audioContextRef.current) audioContextRef.current = new AudioContext();
              if (audioContextRef.current.state === "suspended") {
                await audioContextRef.current.resume();
                audioUnlocked.current = true;
              }
              // Turn on mic if not already on
              if (!micOn.current) {
                await toggleAudio({ sourceParameters: sourceParameters.current });
              }
              // Start capture after mic is ready
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

      if (sourceParameters.current.alertMessage) {
        console.warn("[widget-agent] alertMessage:", sourceParameters.current.alertMessage);
        if (sourceParameters.current.alertMessage.includes("You have been disconnected")) {
          postToParent("agentDisconnect");
          onDisconnect?.();
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceChanged, videoOn, selectedVideoInput]);

  // Cleanup socket listeners
  useEffect(() => {
    return () => {
      try {
        socket.current?.off("pipelineResult");
        socket.current?.off("pipelineResultVision");
        socket.current?.off("silenceDetected");
        socket.current?.off("pipelineError");
        socket.current?.off("pipelineErrorVision");
        socket.current?.off("disconnect");
      } catch { /* ignore */ }
    };
  }, []);

  // Cleanup room on unmount
  useEffect(() => {
    return () => {
      if (roomConnected.current) {
        disconnectRoom({ sourceParameters: sourceParameters.current });
      }
    };
  }, []);

  // ─── Capture Controls ────────────────────────────────────

  const startCapture = () => {
    if (!roomConnected.current) {
      showToast("Still connecting — just a moment.", "info");
      return;
    }

    const now = Date.now();
    if (now - lastCaptureToggleRef.current < 15000) {
      const timeLeft = Math.ceil((15000 - (now - lastCaptureToggleRef.current)) / 1000);
      showToast(`Please wait ${timeLeft}s before toggling capture again.`, "info");
      return;
    }

    updateConfig();

    if (isCapturing) {
      stopCapture();
      return;
    }

    try {
      if (socket.current && agentRoom.current && socket.current?.id) {
        socket.current.on("startBuffers", () => {
          socket.current?.emit(
            "startBuffer",
            { roomName: agentRoom.current, member: "agent" },
            (response: any) => {
              if (response.success) {
                setIsCapturing(true);
              } else {
                console.warn("[widget-agent] Failed to start buffer:", response.reason);
              }
            }
          );
        });

        socket.current.emit(
          "startDataBuffer",
          { roomName: agentRoom.current, config: sanitizeConfig(config) },
          (response: any) => {
            if (response.success) {
              setIsCapturing(true);
            } else {
              console.warn("[widget-agent] Failed to start data buffer:", response.reason);
            }
          }
        );
      }
    } catch (error) {
      console.error("Failed to start data buffer:", error);
    }
  };

  const stopCapture = () => {
    if (!isCapturing) return;
    const now = Date.now();
    if (now - lastCaptureToggleRef.current < 15000) {
      const timeLeft = Math.ceil((15000 - (now - lastCaptureToggleRef.current)) / 1000);
      showToast(`Please wait ${timeLeft}s before toggling capture again.`, "info");
      return;
    }

    if (socket.current) {
      socket.current.emit(
        "stopDataBuffer",
        { roomName: agentRoom.current },
        (response: any) => {
          if (response.success) {
            setIsCapturing(false);
            lastCaptureToggleRef.current = now;
          } else {
            console.warn("[widget-agent] Failed to stop data buffer:", response.reason);
          }
        }
      );
    }
  };

  const alertRestartNeeded = () => {
    if (isCapturing) {
      modelToast.current = true;
      showToast("Changes require restarting capture. Please stop and start capture again.", "info");
      setTimeout(() => { modelToast.current = false; }, 5000);
    }
  };

  // ─── Pipeline Config ─────────────────────────────────────

  const updateConfig = () => {
    // ── Widget config overrides (from dashboard widget settings) ──
    // If the widget builder set specific AI service nicknames, use those
    // instead of the UI model-selector choices (which are for demo/dev use).
    if (widgetConfig?.sttNickName) {
      config.audio.sttNickName = widgetConfig.sttNickName;
    } else {
      // STT from UI selector
      if (asrModelChoice.current === "AssemblyAI") config.audio.sttNickName = "demoAssemblyAI";
      else if (asrModelChoice.current === "Deepgram") config.audio.sttNickName = "demoDeepgram";
      else if (asrModelChoice.current === "GoogleSTT") config.audio.sttNickName = "demoGoogleSTT";
      else if (asrModelChoice.current === "Whisper") config.audio.sttNickName = "demoWhisper";
    }

    if (widgetConfig?.llmNickName) {
      config.audio.llmNickName = widgetConfig.llmNickName;
    } else {
      // LLM from UI selector
      if (llmChoice.current === "OpenAI GPT-4") config.audio.llmNickName = "demoOpenAILLM";
      else if (llmChoice.current === "Anthropic Claude") config.audio.llmNickName = "demoClaudeLLM";
      else if (llmChoice.current === "Gemini") config.audio.llmNickName = "demoGeminiLLM";
    }

    // Vision LLM
    if (widgetConfig?.llmNickName) {
      config.vision.llmNickName = widgetConfig.llmNickName;
    } else {
      config.vision.llmNickName = visionModelChoice.current === "Gemini-Vision" ? "demoGeminiLLM" : "demoOpenAILLM";
    }

    if (widgetConfig?.ttsNickName) {
      config.audio.ttsNickName = widgetConfig.ttsNickName;
      config.vision.ttsNickName = widgetConfig.ttsNickName;
    } else {
      // TTS from UI selector
      if (ttsChoice.current === "GoogleTTS") {
        config.audio.ttsNickName = "demoGoogleTTS";
        config.vision.ttsNickName = "demoGoogleTTS";
      } else if (ttsChoice.current === "ElevenLabs") {
        config.audio.ttsNickName = "demoElevenLabs";
        config.vision.ttsNickName = "demoElevenLabs";
      }
    }

    // Voice ID — prefer widget config, then UI picker
    if (widgetConfig?.voiceId) {
      config.audio.ttsParams.voiceId = widgetConfig.voiceId;
    } else {
      config.audio.ttsParams.voiceId =
        selectedVoiceId.current || (ttsChoice.current === "GoogleTTS" ? "en-US-Wavenet-D" : "9BWtsMINqrJLrRacOk9x");
    }
    (config.audio.ttsParams as any).voice = config.audio.ttsParams.voiceId;
    config.vision.ttsParams.voiceId = config.audio.ttsParams.voiceId;
    (config.vision.ttsParams as any).voice = config.audio.ttsParams.voiceId;

    // Output Mode
    if (outputMode.current === "Text") {
      config.audio.pipeline = config.audio.pipeline.filter((p) => p !== "tts");
      config.vision.pipeline = config.vision.pipeline.filter((p) => p !== "tts");
    } else {
      if (!config.audio.pipeline.includes("tts")) config.audio.pipeline.push("tts");
      if (!config.vision.pipeline.includes("tts")) config.vision.pipeline.push("tts");
    }

    // System prompt and fallback controls - pass through to backend pipeline
    const agentProfile = (widgetConfig?.agentProfile || {}) as Record<string, any>;
    const audioWidgetConfig = (widgetConfig?.audioConfig || widgetConfig?.audio || {}) as Record<string, any>;
    const visionWidgetConfig = (widgetConfig?.visionConfig || widgetConfig?.vision || {}) as Record<string, any>;
    const systemPrompt = widgetConfig?.systemPrompt || agentProfile.systemPrompt || audioWidgetConfig.systemPrompt || visionWidgetConfig.systemPrompt;
    const fallbackBehavior =
      widgetConfig?.fallbackBehavior ||
      agentProfile.fallbackBehavior ||
      audioWidgetConfig.fallbackBehavior ||
      visionWidgetConfig.fallbackBehavior;
    const fallbackText =
      widgetConfig?.fallbackMessage ||
      widgetConfig?.fallbackResponse ||
      agentProfile.fallbackMessage ||
      agentProfile.fallbackResponse ||
      audioWidgetConfig.fallbackMessage ||
      audioWidgetConfig.fallbackResponse ||
      visionWidgetConfig.fallbackMessage ||
      visionWidgetConfig.fallbackResponse;
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

    // Extra (MCP tool integrations, etc.)
    if (widgetConfig?.extra) {
      (config.audio as any).extra = widgetConfig.extra;
      (config.vision as any).extra = widgetConfig.extra;
    }

    const knowledgeBase = widgetConfig?.knowledgeBase || {};
    const knowledgeResourceType = widgetConfig?.knowledgeResourceType || knowledgeBase.resourceType;
    const knowledgeResourceId = widgetConfig?.knowledgeResourceId || knowledgeBase.resourceId;
    if (knowledgeResourceType && knowledgeResourceId) {
      const runtimeKnowledge = {
        ...knowledgeBase,
        enabled: knowledgeBase.enabled !== false,
        resourceType: knowledgeResourceType,
        resourceId: knowledgeResourceId,
      };
      (config.audio as any).knowledgeResourceType = knowledgeResourceType;
      (config.audio as any).knowledgeResourceId = knowledgeResourceId;
      (config.audio as any).knowledgeBase = runtimeKnowledge;
      (config.vision as any).knowledgeResourceType = knowledgeResourceType;
      (config.vision as any).knowledgeResourceId = knowledgeResourceId;
      (config.vision as any).knowledgeBase = runtimeKnowledge;
    }
  };

  // ─── Media Controls ──────────────────────────────────────

  const unlockAudioContext = async () => {
    if (!audioContextRef.current) audioContextRef.current = new AudioContext();
    if (audioContextRef.current.state === "suspended") {
      try { await audioContextRef.current.resume(); audioUnlocked.current = true; } catch (e) { console.error("AudioContext unlock failed:", e); }
    }
  };

  const toggleMic = async () => {
    if (!audioUnlocked.current) await unlockAudioContext();
    if (Object.keys(sourceParameters.current).length === 0) {
      showToast("Please connect first.", "info");
    } else {
      await toggleAudio({ sourceParameters: sourceParameters.current });
    }
  };

  const toggleCamera = async () => {
    if (!audioUnlocked.current) await unlockAudioContext();
    if (disableVision.current && !videoOn) {
      showToast("Vision model is disabled due to time limits.", "info");
      return;
    }
    if (Object.keys(sourceParameters.current).length === 0) {
      showToast("Please connect first.", "info");
    } else {
      await toggleVideo({ sourceParameters: sourceParameters.current });
      if (videoInputs.length === 0) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setVideoInputs(devices.filter((d) => d.kind === "videoinput"));
        !isModalOpen && setIsModalOpen(true);
      }
    }
  };

  const pickCamera = async ({ deviceId }: { deviceId: string }) => {
    if (disableVision.current && !videoOn) { showToast("Vision disabled.", "info"); return; }
    if (Object.keys(sourceParameters.current).length === 0) { showToast("Connect first.", "info"); return; }
    await selectCamera({ deviceId, sourceParameters: sourceParameters.current });
  };

  const swapCamera = async () => {
    if (disableVision.current && !videoOn) { showToast("Vision disabled.", "info"); return; }
    if (Object.keys(sourceParameters.current).length === 0) { showToast("Connect first.", "info"); return; }
    await switchCamera({ sourceParameters: sourceParameters.current });
  };

  const toggleDarkMode = () => setIsDarkMode((prev) => !prev);

  useEffect(() => {
    document.body.classList.toggle("dark-mode", isDarkMode);
  }, [isDarkMode]);

  // Auto-connect on mount
  useEffect(() => {
    if (!roomConnected.current && !userConnectPrompt) {
      setUserConnectPrompt(true);
      setChatMessages((prev) => [...prev, { sender: "System", message: "Setting things up..." }]);
      setWaitingForAgent(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (transcript && intelligent(transcript)) {
      setValidTranscript(transcript);
      const timeout = setTimeout(() => setValidTranscript(""), 500);
      return () => clearTimeout(timeout);
    }
  }, [validTranscript, transcript]);

  useEffect(() => {
    if (chatBoxRef.current) chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
  }, [chatMessages]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (micOn.current && !isCapturing && Date.now() - lastMicAlert.current > 60000) {
        showToast("Tap Start to begin.", "info");
        lastMicAlert.current = Date.now();
      }
      if (videoOn && !isCapturing && Date.now() - lastVideoAlert.current > 60000) {
        showToast("Tap Start to begin.", "info");
        lastVideoAlert.current = Date.now();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [videoOn, isCapturing]);

  // ─── Chat ────────────────────────────────────────────────

  const sendMessage = () => {
    if (!chatInput.trim()) return;
    if (waitingForAgent) { showToast("Please wait for the agent to respond.", "info"); return; }

    const input = chatInput.trim();
    setChatMessages((prev) => [...prev, { sender: "You", message: input }]);
    setChatInput("");

    if (input === "/connect") {
      if (!roomConnected.current) {
        setUserConnectPrompt(true);
        setChatMessages((prev) => [...prev, { sender: "System", message: "Reconnecting..." }]);
        setWaitingForAgent(true);
      } else {
        showToast("Already connected.", "info");
      }
    } else if (input === "/help") {
      setChatMessages((prev) => [
        ...prev,
        { sender: "System", message: "Commands: /connect — reconnect · /help — show commands" },
      ]);
    } else {
      setChatMessages((prev) => [...prev, { sender: "System", message: "Try /help for available commands." }]);
    }
  };

  // ─── Render ──────────────────────────────────────────────

  const agentStatus = animate
    ? "Speaking..."
    : isCapturing
    ? "Listening..."
    : roomConnected.current
    ? "Ready"
    : "Connecting...";

  return (
    <div className={`container ${isDarkMode ? "dark" : ""}`}>
      {/* MediaSFU Handler — fires immediately for auto-connect */}
      {userConnectPrompt && showRoomDetails.current && (
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

      {/* Hidden model selection bar (kept for internal use) */}
      <div className="modelSelectionBar-container">
        <div className="modelSelectionBar-header">
          <h3>Model Selection</h3>
          <button className="collapseButton" onClick={() => setModelBarCollapsed((prev) => !prev)}>
            {modelBarCollapsed ? "Expand" : "Collapse"}
          </button>
        </div>
        {!modelBarCollapsed && (
          <div className="modelSelectionBar">
            <div>
              <label>Vision Model:</label>
              <select value={visionModelChoice.current} onChange={(e) => { visionModelChoice.current = e.target.value; alertRestartNeeded(); }}>
                <option value="OpenAI-Vision">OpenAI Vision API (Limited)</option>
                <option value="Gemini-Vision">Gemini Vision API (Limited)</option>
              </select>
            </div>
            <div>
              <label>ASR Model:</label>
              <select value={asrModelChoice.current} onChange={(e) => { asrModelChoice.current = e.target.value; alertRestartNeeded(); }}>
                <option value="AssemblyAI">AssemblyAI</option>
                <option value="Deepgram">Deepgram</option>
                <option value="GoogleSTT">Google</option>
                <option value="Whisper">OpenAI Whisper API</option>
              </select>
            </div>
            <div>
              <label>LLM:</label>
              <select value={llmChoice.current} onChange={(e) => { llmChoice.current = e.target.value; alertRestartNeeded(); }}>
                <option value="OpenAI GPT-4">OpenAI GPT-4</option>
                <option value="Anthropic Claude">Anthropic Claude</option>
                <option value="Gemini">Gemini</option>
              </select>
            </div>
            <div>
              <label>TTS Model:</label>
              <select value={ttsChoice.current} onChange={(e) => { ttsChoice.current = e.target.value; checkTTS(e.target.value); alertRestartNeeded(); }}>
                <option value="GoogleTTS">Google</option>
                <option value="ElevenLabs">ElevenLabs</option>
              </select>
            </div>
            <div>
              <label>Output Mode:</label>
              <select value={outputMode.current} onChange={(e) => { outputMode.current = e.target.value; alertRestartNeeded(); }}>
                <option value="Text">Text Only</option>
                <option value="Audio+Text">Audio + Text</option>
              </select>
            </div>
            <div>
              <label htmlFor="voiceSelect">TTS Voice:</label>
              {loadingVoices ? (
                <span>Loading voices...</span>
              ) : (
                <select id="voiceSelect" value={selectedVoiceId.current} onChange={(e) => { selectedVoiceId.current = e.target.value; alertRestartNeeded(); }}>
                  {availableVoices.map((voice) => (
                    <option key={voice.voice_id} value={voice.voice_id}>{voice.label}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}
        {toast && modelToast.current && (
          <div id="toast-container" className={`toast ${toastType}`}>{toast}</div>
        )}
      </div>

      {/* ─── Header ─── */}
      <div className="header-bar">
        <div className="header-left">
          <h1>{agentName || "AI Agent"}</h1>
          {showBranding !== false && (
            <a href="https://mediasfu.com" target="_blank" rel="noopener noreferrer" className="powered-by">
              Powered by MediaSFU
            </a>
          )}
        </div>
        <div className="header-right">
          <div className={`status-indicator ${roomConnected.current ? "live" : ""}`}>
            <span className={`status-dot ${roomConnected.current ? "connected" : "disconnected"}`} />
            <span className="status-text">{roomConnected.current ? "Live" : "Connecting"}</span>
          </div>
          <button onClick={toggleDarkMode} className="darkModeToggle" title="Toggle theme" aria-label="Toggle theme">
            <FontAwesomeIcon icon={isDarkMode ? faSun : faMoon} />
          </button>
        </div>
      </div>

      {/* ─── Main Content (single column) ─── */}
      <div className="content">
        {/* Hero — Agent Orb + Visualizer */}
        <div className="agent-hero">
          <div className={`agent-orb ${animate ? "speaking" : isCapturing ? "listening" : ""}`}>
            <div className="agent-orb-inner">
              <AudioVisualizer animate={animate} />
            </div>
            {animate && <div className="agent-pulse-ring" />}
            {animate && <div className="agent-pulse-ring delay" />}
          </div>
          <div className={`agent-status-label ${animate ? "speaking" : isCapturing ? "listening" : roomConnected.current ? "ready" : "connecting"}`}>
            {agentStatus}
          </div>
        </div>

        {/* Transcript bar */}
        <div className="transcript-bar">
          {transcript ? (
            <p className="transcript-text"><span className="transcript-you">You:</span> {transcript}</p>
          ) : (
            <p className="transcript-placeholder">Waiting for speech...</p>
          )}
        </div>

        {/* Chat area */}
        <div className="chatCard">
          <div className="chatBox" ref={chatBoxRef}>
            {chatMessages.length === 0 && (
              <div className="chatMessage system">
                <em>Agent session starting...</em>
              </div>
            )}
            {chatMessages.map((msg, index) => (
              <div
                key={index}
                className={`chatMessage ${msg.sender === "You" ? "user" : msg.sender === "Agent" ? "agent" : "system"}`}
              >
                {msg.sender === "System" ? (
                  <em>{msg.message}</em>
                ) : (
                  <><strong>{msg.sender === "Agent" ? (agentName || "Agent") : "You"}:</strong> {msg.message}</>
                )}
              </div>
            ))}
          </div>
          {toast && !modelToast.current && (
            <div className={`toast ${toastType}`}>{toast}</div>
          )}
          <div className="chatInputContainer">
            <input
              type="text"
              placeholder="Type a message..."
              className="chatInput"
              value={chatInput}
              maxLength={200}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === "Enter") sendMessage();
              }}
            />
            <button className="sendButton" onClick={sendMessage}>
              <FontAwesomeIcon icon={faPaperPlane} />
            </button>
          </div>
        </div>
      </div>

      {/* Floating self-view pip (only when camera on) */}
      {videoOn && (
        <div className="self-view-pip">
          <video ref={selfVideoRef} className="pip-video" autoPlay muted playsInline />
          {videoInputs.length > 1 && (
            <select
              className="pip-cam-select"
              value={selectedVideoInput || ""}
              onChange={(e) => pickCamera({ deviceId: e.target.value })}
            >
              {videoInputs.map((input) => (
                <option key={input.deviceId} value={input.deviceId}>
                  {input.label || `Camera ${input.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          )}
          <button className="pip-swap" onClick={swapCamera} title="Switch Camera">
            <FontAwesomeIcon icon={faSyncAlt} />
          </button>
        </div>
      )}

      {/* ─── Control Dock ─── */}
      <div className="bottomBar">
        <button
          onClick={toggleMic}
          className={`ctrl-btn ${micOn.current ? "active" : ""}`}
          title={micOn.current ? "Mute" : "Unmute"}
          disabled={isAudioPlaying.current}
        >
          <span className="ctrl-icon">
            <FontAwesomeIcon icon={micOn.current ? faMicrophone : faMicrophoneSlash} />
          </span>
          <span className="ctrl-label">Mic</span>
        </button>

        <button
          onClick={toggleCamera}
          className={`ctrl-btn ${videoOn ? "active" : ""}`}
          title={videoOn ? "Camera Off" : "Camera On"}
        >
          <span className="ctrl-icon">
            <FontAwesomeIcon icon={videoOn ? faVideo : faVideoSlash} />
          </span>
          <span className="ctrl-label">Cam</span>
        </button>

        <button
          onClick={isCapturing ? stopCapture : startCapture}
          disabled={!(micOn.current || videoOn)}
          className={`ctrl-btn capture ${isCapturing ? "active stop" : ""}`}
          title={isCapturing ? "Stop Capture" : "Start Capture"}
        >
          <span className="ctrl-icon">
            <FontAwesomeIcon icon={isCapturing ? faStop : faPlay} />
          </span>
          <span className="ctrl-label">{isCapturing ? "Pause" : "Start"}</span>
        </button>

        <button
          onClick={() => {
            doAEC.current = !doAEC.current;
            showToast(`Echo cancellation ${doAEC.current ? "on" : "off"}`, "info");
          }}
          className={`ctrl-btn ${doAEC.current ? "active" : ""}`}
          title="Echo Cancellation"
        >
          <span className="ctrl-icon">
            <FontAwesomeIcon icon={doAEC.current ? faDeaf : faAssistiveListeningSystems} />
          </span>
          <span className="ctrl-label">AEC</span>
        </button>
      </div>
    </div>
  );
};

export default AgentsMultimodal;
