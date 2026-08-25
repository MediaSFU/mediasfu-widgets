/**
 * AIAgentBlock
 *
 * Building block for AI voice agent controls.
 * Manages STT → LLM → TTS pipeline with voice/vision modes.
 *
 * Based on patterns from:
 * - agents-src/components/AgentsPlayground.tsx
 * - agents-src/hooks/useAudioVideoSDK.ts
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { AIAgentBlockProps } from '../types/building-blocks';

// Icons
const RobotIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="8" width="18" height="12" rx="2" />
    <circle cx="9" cy="14" r="2" />
    <circle cx="15" cy="14" r="2" />
    <path d="M12 2v4" />
    <path d="M8 8V6a4 4 0 0 1 8 0v2" />
  </svg>
);

const MicIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const StopIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

const VolumeIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
  </svg>
);

const LoadingSpinner = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="msfu-spinner">
    <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
    <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
  </svg>
);

type AgentState = 'idle' | 'listening' | 'processing' | 'speaking';

interface TranscriptEntry {
  id: string;
  type: 'user' | 'agent';
  text: string;
  timestamp: Date;
  isFinal?: boolean;
}

export const AIAgentBlock: React.FC<AIAgentBlockProps> = ({
  sourceParameters,
  updateSourceParameters,
  agentConfig,
  onAgentResponse,
  onTranscript,
  onStateChange,
  className = '',
  style,
  disabled = false
}) => {
  const [agentState, setAgentState] = useState<AgentState>('idle');
  const [isAgentActive, setIsAgentActive] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [currentInterimText, setCurrentInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<any>(null);

  // Scroll to bottom of transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, currentInterimText]);

  // Update state and notify parent
  const updateAgentState = useCallback((newState: AgentState) => {
    setAgentState(newState);
    onStateChange?.(newState);
  }, [onStateChange]);

  // Add transcript entry
  const addTranscriptEntry = useCallback((type: 'user' | 'agent', text: string, isFinal = true) => {
    const entry: TranscriptEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type,
      text,
      timestamp: new Date(),
      isFinal
    };

    setTranscript(prev => [...prev, entry]);
    onTranscript?.(text, isFinal);

    if (type === 'agent') {
      onAgentResponse?.(text);
    }
  }, [onTranscript, onAgentResponse]);

  // Start agent
  const startAgent = useCallback(async () => {
    if (disabled || isAgentActive) return;

    setError(null);

    try {
      // Get socket from sourceParameters
      const socket = sourceParameters.socket || sourceParameters.localSocket;
      if (!socket) {
        throw new Error('No active socket connection. Connect to a room first.');
      }

      socketRef.current = socket;

      // Build agent configuration for the socket
      const agentParams = {
        mode: agentConfig.mode,
        audio: {
          sttNickName: agentConfig.audio.sttNickName,
          sttApiKey: agentConfig.audio.apiKey,
          language: agentConfig.audio.language || 'en-US'
        },
        llm: {
          llmNickName: agentConfig.llm.llmNickName,
          llmApiKey: agentConfig.llm.apiKey,
          model: agentConfig.llm.model,
          systemPrompt: agentConfig.llm.systemPrompt || 'You are a helpful AI assistant.',
          maxTokens: agentConfig.llm.maxTokens || 1024,
          temperature: agentConfig.llm.temperature || 0.7
        },
        tts: {
          ttsNickName: agentConfig.tts.ttsNickName,
          ttsApiKey: agentConfig.tts.apiKey,
          voice: agentConfig.tts.voice
        },
        visionInterval: agentConfig.visionInterval,
        silenceThreshold: agentConfig.silenceThreshold || 1500,
        maxSpeakingDuration: agentConfig.maxSpeakingDuration || 30000
      };

      // Emit start agent event
      socket.emit('startAgent', agentParams);

      // Listen for agent events
      socket.on('agentListening', () => {
        updateAgentState('listening');
      });

      socket.on('agentProcessing', () => {
        updateAgentState('processing');
        setCurrentInterimText('');
      });

      socket.on('agentSpeaking', () => {
        updateAgentState('speaking');
      });

      socket.on('agentTranscript', (data: { text: string; isFinal: boolean; type: 'user' | 'agent' }) => {
        if (data.isFinal) {
          addTranscriptEntry(data.type, data.text, true);
          setCurrentInterimText('');
        } else {
          setCurrentInterimText(data.text);
        }
      });

      socket.on('agentError', (error: { message: string }) => {
        setError(error.message);
        updateAgentState('idle');
      });

      socket.on('agentStopped', () => {
        setIsAgentActive(false);
        updateAgentState('idle');
      });

      setIsAgentActive(true);
      updateAgentState('listening');

    } catch (err) {
      console.error('[AIAgentBlock] Error starting agent:', err);
      setError(err instanceof Error ? err.message : 'Failed to start agent');
    }
  }, [
    sourceParameters,
    agentConfig,
    disabled,
    isAgentActive,
    updateAgentState,
    addTranscriptEntry
  ]);

  // Stop agent
  const stopAgent = useCallback(() => {
    if (!isAgentActive || !socketRef.current) return;

    try {
      socketRef.current.emit('stopAgent');

      // Clean up listeners
      socketRef.current.off('agentListening');
      socketRef.current.off('agentProcessing');
      socketRef.current.off('agentSpeaking');
      socketRef.current.off('agentTranscript');
      socketRef.current.off('agentError');
      socketRef.current.off('agentStopped');

      setIsAgentActive(false);
      updateAgentState('idle');
      setCurrentInterimText('');
    } catch (err) {
      console.error('[AIAgentBlock] Error stopping agent:', err);
    }
  }, [isAgentActive, updateAgentState]);

  // Take control (interrupt agent)
  const takeControl = useCallback(() => {
    if (!isAgentActive || !socketRef.current) return;

    try {
      socketRef.current.emit('takeControl');
      updateAgentState('listening');
    } catch (err) {
      console.error('[AIAgentBlock] Error taking control:', err);
    }
  }, [isAgentActive, updateAgentState]);

  // Clear transcript
  const clearTranscript = useCallback(() => {
    setTranscript([]);
    setCurrentInterimText('');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isAgentActive) {
        stopAgent();
      }
    };
  }, [isAgentActive, stopAgent]);

  // Get state indicator color
  const getStateColor = (): string => {
    switch (agentState) {
      case 'listening': return 'var(--msfu-color-success, #10b981)';
      case 'processing': return 'var(--msfu-color-warning, #f59e0b)';
      case 'speaking': return 'var(--msfu-color-primary, #14a394)';
      default: return 'var(--msfu-color-text-muted, #6b7280)';
    }
  };

  // Get state label
  const getStateLabel = (): string => {
    switch (agentState) {
      case 'listening': return 'Listening...';
      case 'processing': return 'Thinking...';
      case 'speaking': return 'Speaking...';
      default: return 'Ready';
    }
  };

  return (
    <div
      className={`msfu-ai-agent ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--msfu-spacing-md, 16px)',
        ...style
      }}
    >
      {/* Agent Status Header */}
      <div
        className="msfu-ai-agent__header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--msfu-spacing-sm, 8px) var(--msfu-spacing-md, 16px)',
          backgroundColor: 'var(--msfu-color-surface, white)',
          borderRadius: 'var(--msfu-border-radius, 8px)',
          border: '1px solid var(--msfu-color-border, #e5e7eb)'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--msfu-spacing-sm, 8px)'
          }}
        >
          {/* Agent Icon */}
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              backgroundColor: isAgentActive
                ? 'var(--msfu-color-primary-light, #e6f7f4)'
                : 'var(--msfu-color-surface-dark, #f3f4f6)',
              color: isAgentActive
                ? 'var(--msfu-color-primary, #14a394)'
                : 'var(--msfu-color-text-muted, #6b7280)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <RobotIcon />
          </div>

          <div>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 500,
                color: 'var(--msfu-color-text, #1f2937)'
              }}
            >
              AI Voice Agent
            </div>
            <div
              style={{
                fontSize: '12px',
                color: getStateColor(),
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              {isAgentActive && agentState === 'processing' && <LoadingSpinner />}
              {getStateLabel()}
            </div>
          </div>
        </div>

        {/* Mode Badge */}
        <div
          style={{
            padding: '4px 8px',
            borderRadius: '12px',
            backgroundColor: 'var(--msfu-color-secondary-light, #f5f3ff)',
            color: 'var(--msfu-color-secondary, #8b5cf6)',
            fontSize: '12px',
            fontWeight: 500,
            textTransform: 'capitalize'
          }}
        >
          {agentConfig.mode}
        </div>
      </div>

      {/* Transcript Area */}
      <div
        className="msfu-ai-agent__transcript"
        style={{
          flex: 1,
          minHeight: '200px',
          maxHeight: '400px',
          overflowY: 'auto',
          padding: 'var(--msfu-spacing-md, 16px)',
          backgroundColor: 'var(--msfu-color-background, #f9fafb)',
          borderRadius: 'var(--msfu-border-radius, 8px)',
          border: '1px solid var(--msfu-color-border, #e5e7eb)'
        }}
      >
        {transcript.length === 0 && !currentInterimText && (
          <div
            style={{
              textAlign: 'center',
              color: 'var(--msfu-color-text-muted, #6b7280)',
              padding: 'var(--msfu-spacing-xl, 32px)'
            }}
          >
            {isAgentActive
              ? 'Start speaking to interact with the AI agent...'
              : 'Press Start to begin the conversation'}
          </div>
        )}

        {/* Transcript Entries */}
        {transcript.map((entry) => (
          <div
            key={entry.id}
            className={`msfu-ai-agent__message msfu-ai-agent__message--${entry.type}`}
            style={{
              display: 'flex',
              justifyContent: entry.type === 'user' ? 'flex-end' : 'flex-start',
              marginBottom: 'var(--msfu-spacing-sm, 8px)'
            }}
          >
            <div
              style={{
                maxWidth: '80%',
                padding: 'var(--msfu-spacing-sm, 8px) var(--msfu-spacing-md, 16px)',
                borderRadius: 'var(--msfu-border-radius, 8px)',
                backgroundColor: entry.type === 'user'
                  ? 'var(--msfu-color-primary, #14a394)'
                  : 'var(--msfu-color-surface, white)',
                color: entry.type === 'user'
                  ? 'white'
                  : 'var(--msfu-color-text, #1f2937)',
                fontSize: '14px',
                boxShadow: entry.type === 'agent'
                  ? 'var(--msfu-shadow-sm, 0 1px 2px rgba(16,24,40,0.06), 0 0 0 1px rgba(16,24,40,0.04))'
                  : 'none'
              }}
            >
              {entry.text}
            </div>
          </div>
        ))}

        {/* Interim Text (user speaking) */}
        {currentInterimText && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              marginBottom: 'var(--msfu-spacing-sm, 8px)'
            }}
          >
            <div
              style={{
                maxWidth: '80%',
                padding: 'var(--msfu-spacing-sm, 8px) var(--msfu-spacing-md, 16px)',
                borderRadius: 'var(--msfu-border-radius, 8px)',
                backgroundColor: 'var(--msfu-color-primary, #14a394)',
                color: 'white',
                fontSize: '14px',
                opacity: 0.7
              }}
            >
              {currentInterimText}...
            </div>
          </div>
        )}

        <div ref={transcriptEndRef} />
      </div>

      {/* Error Message */}
      {error && (
        <div
          style={{
            padding: 'var(--msfu-spacing-sm, 8px) var(--msfu-spacing-md, 16px)',
            backgroundColor: 'var(--msfu-color-error-light, #fef2f2)',
            color: 'var(--msfu-color-error, #ef4444)',
            borderRadius: 'var(--msfu-border-radius, 8px)',
            fontSize: '14px'
          }}
        >
          {error}
        </div>
      )}

      {/* Control Buttons */}
      <div
        className="msfu-ai-agent__controls"
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 'var(--msfu-spacing-md, 16px)'
        }}
      >
        {/* Start/Stop Button */}
        <button
          type="button"
          onClick={isAgentActive ? stopAgent : startAgent}
          disabled={disabled}
          aria-label={isAgentActive ? 'Stop agent' : 'Start agent'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--msfu-spacing-xs, 4px)',
            padding: 'var(--msfu-spacing-sm, 8px) var(--msfu-spacing-lg, 24px)',
            borderRadius: 'var(--msfu-border-radius-lg, 12px)',
            border: 'none',
            backgroundColor: isAgentActive
              ? 'var(--msfu-color-error, #ef4444)'
              : 'var(--msfu-color-primary, #14a394)',
            color: 'white',
            fontSize: '14px',
            fontWeight: 500,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            transition: 'all 0.2s ease'
          }}
        >
          {isAgentActive ? (
            <>
              <StopIcon />
              Stop Agent
            </>
          ) : (
            <>
              <MicIcon />
              Start Agent
            </>
          )}
        </button>

        {/* Take Control Button (when agent is speaking) */}
        {isAgentActive && agentState === 'speaking' && (
          <button
            type="button"
            onClick={takeControl}
            disabled={disabled}
            aria-label="Take control"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--msfu-spacing-xs, 4px)',
              padding: 'var(--msfu-spacing-sm, 8px) var(--msfu-spacing-md, 16px)',
              borderRadius: 'var(--msfu-border-radius, 8px)',
              border: '1px solid var(--msfu-color-border, #e5e7eb)',
              backgroundColor: 'var(--msfu-color-surface, white)',
              color: 'var(--msfu-color-text, #1f2937)',
              fontSize: '14px',
              cursor: 'pointer'
            }}
          >
            <VolumeIcon />
            Interrupt
          </button>
        )}

        {/* Clear Transcript */}
        {transcript.length > 0 && (
          <button
            type="button"
            onClick={clearTranscript}
            disabled={disabled}
            aria-label="Clear transcript"
            style={{
              padding: 'var(--msfu-spacing-sm, 8px) var(--msfu-spacing-md, 16px)',
              borderRadius: 'var(--msfu-border-radius, 8px)',
              border: '1px solid var(--msfu-color-border, #e5e7eb)',
              backgroundColor: 'transparent',
              color: 'var(--msfu-color-text-muted, #6b7280)',
              fontSize: '14px',
              cursor: 'pointer'
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Pipeline Info */}
      <div
        className="msfu-ai-agent__pipeline"
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 'var(--msfu-spacing-md, 16px)',
          fontSize: '12px',
          color: 'var(--msfu-color-text-muted, #6b7280)'
        }}
      >
        <span>STT: {agentConfig.audio.sttNickName}</span>
        <span>•</span>
        <span>LLM: {agentConfig.llm.llmNickName}</span>
        <span>•</span>
        <span>TTS: {agentConfig.tts.ttsNickName}</span>
      </div>

      {/* Inline Styles */}
      <style>{`
        @keyframes msfu-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .msfu-spinner {
          animation: msfu-spin 1s linear infinite;
        }

        .msfu-ai-agent__transcript::-webkit-scrollbar {
          width: 6px;
        }

        .msfu-ai-agent__transcript::-webkit-scrollbar-track {
          background: transparent;
        }

        .msfu-ai-agent__transcript::-webkit-scrollbar-thumb {
          background: var(--msfu-color-border, #e5e7eb);
          border-radius: 3px;
        }
      `}</style>
    </div>
  );
};

export default AIAgentBlock;
