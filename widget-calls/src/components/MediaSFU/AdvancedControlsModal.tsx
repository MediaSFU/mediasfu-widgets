import React, { useState, useEffect, useCallback, useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPhoneAlt,
  faVolumeUp,
  faRobot,
  faHeadphones,
} from "@fortawesome/free-solid-svg-icons";
import { callService } from "../../services/callService";
import { roomLogger } from "../../utils/logger";
import "./AdvancedControlsModal.css";

interface AdvancedControlsProps {
  callId: string;
  participants: any[];
  sourceParameters?: Record<string, any>;
}

interface PlayAudioState {
  type: "tts" | "url";
  value: string;
  loop: boolean;
  immediately: boolean;
}

interface AudioDeviceState {
  selectedMicrophone: string;
  availableDevices: MediaDeviceInfo[];
}

const AdvancedControlsModal: React.FC<AdvancedControlsProps> = React.memo(
  ({ callId, participants, sourceParameters = {} }) => {
    const [playAudioInput, setPlayAudioInput] = useState<PlayAudioState>({
      type: "tts",
      value: "",
      loop: false,
      immediately: true,
    });
    const [audioDevices, setAudioDevices] = useState<AudioDeviceState>({
      selectedMicrophone: "",
      availableDevices: [],
    });
    const [isLoading, setIsLoading] = useState(false);
    const [callSourceValue, setCallSourceValue] = useState("");

    // Load available audio devices on component mount
    useEffect(() => {
      const loadAudioDevices = async () => {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const audioInputs = devices.filter(
            (device) => device.kind === "audioinput"
          );
          const audioOutputs = devices.filter(
            (device) => device.kind === "audiooutput"
          );

          setAudioDevices((prev) => ({
            ...prev,
            availableDevices: [...audioInputs, ...audioOutputs],
          }));
        } catch (error) {
          roomLogger.error("Failed to load audio devices:", error);
        }
      };

      loadAudioDevices();
    }, []);

    // Intelligent agent detection function
    const hasAgentInRoom = useCallback((): boolean => {
      if (!participants || participants.length === 0) {
        return false;
      }

      return participants.some((participant: any) => {
        const name = (participant.name || "").toLowerCase();
        const id = (
          participant.id ||
          ""
        ).toLowerCase();

        const agentKeywords = [
          "agent",
          "ai",
          "bot",
          "assistant",
          "mediasfu",
          "voice",
          "system",
        ];

        return agentKeywords.some(
          (keyword) => name.includes(keyword) || id.includes(keyword)
        );
      });
    }, [participants]);

    // Memoize filtered participants to prevent re-renders
    const humanParticipants = useMemo(() => {
      return participants.filter((p: any) => {
        const id = (p.id || p.audioID || p.videoID || "").toLowerCase();
        const isSystemId = id.startsWith("sip_") || id.startsWith("sip-");
        const name = (p.name || "").toLowerCase();
        const agentKeywords = [
          "agent",
          "ai",
          "bot",
          "assistant",
          "mediasfu",
          "voice",
          "system",
        ];
        const isAgent = agentKeywords.some(
          (keyword) => name.includes(keyword) || id.includes(keyword)
        );

        return !isSystemId && !isAgent;
      });
    }, [participants]);

    const handlePlayAudio = useCallback(async () => {
      if (!playAudioInput.value.trim()) return;

      setIsLoading(true);
      try {
        const result = await callService.playAudio(
          callId,
          playAudioInput.type,
          playAudioInput.value,
          playAudioInput.loop,
          playAudioInput.immediately
        );

        if (result.success) {
          roomLogger.info("Successfully played audio", {
            callId,
            input: playAudioInput,
          });
          setPlayAudioInput((prev) => ({ ...prev, value: "" }));
        } else {
          roomLogger.error("Failed to play audio", {
            callId,
            error: result.error,
            input: playAudioInput,
          });
        }
      } catch (error) {
        roomLogger.error("Error playing audio:", {
          error,
          callId,
          input: playAudioInput,
        });
      } finally {
        setIsLoading(false);
      }
    }, [callId, playAudioInput]);

    const handleSwitchToHuman = useCallback(async () => {
      setIsLoading(true);
      try {
        const result = await callService.switchSource(callId, "human");

        if (result.success) {
          roomLogger.info("Successfully switched to human", { callId });
        } else {
          roomLogger.error("Failed to switch to human", {
            callId,
            error: result.error,
          });
        }
      } catch (error) {
        roomLogger.error("Error switching to human:", { error, callId });
      } finally {
        setIsLoading(false);
      }
    }, [callId]);

    const handleSwitchToAgent = useCallback(async () => {
      setIsLoading(true);
      try {
        const result = await callService.switchSource(callId, "agent");

        if (result.success) {
          roomLogger.info("Successfully switched to agent", { callId });
        } else {
          roomLogger.error("Failed to switch to agent", {
            callId,
            error: result.error,
          });
        }
      } catch (error) {
        roomLogger.error("Error switching to agent:", { error, callId });
      } finally {
        setIsLoading(false);
      }
    }, [callId]);

    const handleStartAgent = useCallback(async () => {
      setIsLoading(true);
      try {
        const result = await callService.startAgent(callId);

        if (result.success) {
          roomLogger.info("Successfully started agent", { callId });
        } else {
          roomLogger.error("Failed to start agent", {
            callId,
            error: result.error,
          });
        }
      } catch (error) {
        roomLogger.error("Error starting agent:", { error, callId });
      } finally {
        setIsLoading(false);
      }
    }, [callId]);

    const handleStopAgent = useCallback(async () => {
      setIsLoading(true);
      try {
        const result = await callService.stopAgent(callId);

        if (result.success) {
          roomLogger.info("Successfully stopped agent", { callId });
        } else {
          roomLogger.error("Failed to stop agent", {
            callId,
            error: result.error,
          });
        }
      } catch (error) {
        roomLogger.error("Error stopping agent:", { error, callId });
      } finally {
        setIsLoading(false);
      }
    }, [callId]);

    const handleMicrophoneChange = useCallback(
      async (deviceId: string) => {
        setAudioDevices((prev) => ({ ...prev, selectedMicrophone: deviceId }));
        roomLogger.info("Microphone changed", { callId, deviceId });
      },
      [callId]
    );

    // Content component that displays all controls at once - memoized to prevent re-renders
    const AdvancedControlsContent = useMemo(() => {
      return (
        <div className="advanced-controls-container">
          <div className="controls-grid">
            {/* Call Source Control */}
            <div className="control-card">
              <div className="control-card-header">
                <FontAwesomeIcon icon={faPhoneAlt} className="control-icon" />
                <h4>Call Source Control</h4>
              </div>
              <div className="control-card-content">
                <div className="input-group">
                  <label className="input-label">Call Source Control</label>
                  <select
                    className="modern-select"
                    disabled={isLoading}
                    value={callSourceValue}
                    onChange={(e) => {
                      const value = e.target.value;
                      setCallSourceValue(value);
                      if (value === "agent") {
                        handleSwitchToAgent();
                      } else if (value.startsWith("human-")) {
                        handleSwitchToHuman();
                      }
                    }}
                  >
                    <option value="">Choose who controls the call</option>
                    <option value="agent">Switch to Agent</option>
                    {humanParticipants.map((participant: any) => (
                      <option
                        key={
                          participant.id
                        }
                        value={`human-${
                          participant.id
                        }`}
                      >
                        {participant.name ||
                          `Participant ${(
                            participant.id ||
                            ""
                          ).slice(0, 8)}`}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="control-description">
                  Switch control between agent and human participants. Only
                  human participants are shown.
                </p>
              </div>
            </div>

            {/* Audio Playback */}
            <div className="control-card">
              <div className="control-card-header">
                <FontAwesomeIcon icon={faVolumeUp} className="control-icon" />
                <h4>Audio Playback</h4>
              </div>
              <div className="control-card-content">
                <div className="input-group">
                  <label className="input-label">Audio Source</label>
                  <select
                    value={playAudioInput.type}
                    onChange={(e) =>
                      setPlayAudioInput({
                        ...playAudioInput,
                        type: e.target.value as "url" | "tts",
                      })
                    }
                    className="modern-select"
                    disabled={isLoading}
                  >
                    <option value="tts">Text-to-Speech</option>
                    <option value="url">Audio URL</option>
                  </select>
                </div>

                <div className="input-group">
                  <label className="input-label">
                    {playAudioInput.type === "tts"
                      ? "Text to Speak"
                      : "Audio URL"}
                  </label>
                  <textarea
                    value={playAudioInput.value}
                    onChange={(e) =>
                      setPlayAudioInput({
                        ...playAudioInput,
                        value: e.target.value,
                      })
                    }
                    placeholder={
                      playAudioInput.type === "tts"
                        ? "Enter text to speak..."
                        : "Enter audio URL..."
                    }
                    className="modern-textarea"
                    disabled={isLoading}
                    rows={3}
                  />
                </div>

                <div className="checkbox-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={playAudioInput.loop}
                      onChange={(e) =>
                        setPlayAudioInput({
                          ...playAudioInput,
                          loop: e.target.checked,
                        })
                      }
                      disabled={isLoading}
                    />
                    <span>Loop Audio</span>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={playAudioInput.immediately}
                      onChange={(e) =>
                        setPlayAudioInput({
                          ...playAudioInput,
                          immediately: e.target.checked,
                        })
                      }
                      disabled={isLoading}
                    />
                    <span>Play Immediately</span>
                  </label>
                </div>

                <button
                  onClick={handlePlayAudio}
                  className="control-action-btn btn-success"
                  disabled={!playAudioInput.value.trim() || isLoading}
                >
                  {isLoading ? "Playing..." : "Play Audio"}
                </button>
              </div>
            </div>

            {/* Audio Device Settings */}
            <div className="control-card">
              <div className="control-card-header">
                <FontAwesomeIcon icon={faHeadphones} className="control-icon" />
                <h4>Audio Device Settings</h4>
              </div>
              <div className="control-card-content">
                <div className="input-group">
                  <label className="input-label">Microphone</label>
                  <select
                    value={audioDevices.selectedMicrophone}
                    onChange={(e) => handleMicrophoneChange(e.target.value)}
                    className="modern-select"
                    disabled={isLoading}
                  >
                    <option value="">Select Microphone</option>
                    {audioDevices.availableDevices
                      .filter((device) => device.kind === "audioinput")
                      .map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label ||
                            `Microphone ${device.deviceId.slice(0, 8)}`}
                        </option>
                      ))}
                  </select>
                </div>

                <p className="control-description">
                  Select your preferred microphone device for the call.
                </p>
              </div>
            </div>

            {/* Agent Management */}
            <div className="control-card">
              <div className="control-card-header">
                <FontAwesomeIcon icon={faRobot} className="control-icon" />
                <h4>Agent Management</h4>
              </div>
              <div className="control-card-content">
                <p className="control-description">
                  Start or stop the AI agent for automated call handling.
                </p>
                {hasAgentInRoom() ? (
                  <div className="agent-actions">
                    <button
                      onClick={handleStartAgent}
                      className="control-action-btn btn-success"
                      disabled={isLoading}
                    >
                      {isLoading ? "Starting..." : "Start Agent"}
                    </button>

                    <button
                      onClick={handleStopAgent}
                      className="control-action-btn btn-warning"
                      disabled={isLoading}
                    >
                      {isLoading ? "Stopping..." : "Stop Agent"}
                    </button>
                  </div>
                ) : (
                  <div className="no-agent-message">
                    <p>No agent in room. Agent controls are only available when an agent is present.</p>
                  </div>
                )}

                {hasAgentInRoom() && (
                  <div className="agent-status">
                    <span className="status-indicator active">
                      ● Agent is active
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }, [
      isLoading,
      callSourceValue,
      humanParticipants,
      playAudioInput,
      audioDevices,
      hasAgentInRoom,
      handleSwitchToAgent,
      handleSwitchToHuman,
      handlePlayAudio,
      handleStartAgent,
      handleStopAgent,
      handleMicrophoneChange,
    ]);

    // Always render as inline component
    return (
      <div className="advanced-controls-inline">{AdvancedControlsContent}</div>
    );
  }
);

export default AdvancedControlsModal;
