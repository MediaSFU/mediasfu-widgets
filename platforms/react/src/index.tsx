/**
 * MediaSFU Widgets React Components
 *
 * React wrapper components for MediaSFU embeddable widgets.
 */

import React, { useEffect, useRef, useCallback } from 'react';

// ============================================================================
// Types
// ============================================================================

export type WidgetTheme = 'light' | 'dark' | 'auto';
export type WidgetPosition = 'inline' | 'bottom-right' | 'bottom-left' | 'floating';
export type AgentMode = 'voice' | 'chat' | 'both';

interface BaseWidgetProps {
  widgetKey: string;
  theme?: WidgetTheme;
  position?: WidgetPosition;
  className?: string;
  style?: React.CSSProperties;
  onReady?: () => void;
  onError?: (error: Error) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export interface CallButtonProps extends BaseWidgetProps {
  destination: string;
  buttonText?: string;
  buttonIcon?: string;
  onCallStart?: () => void;
  onCallEnd?: () => void;
}

export interface AIAgentProps extends BaseWidgetProps {
  agentName?: string;
  greeting?: string;
  mode?: AgentMode;
  systemPrompt?: string;
  voice?: string;
  onMessage?: (message: { role: string; content: string }) => void;
}

export interface MeetingJoinProps extends BaseWidgetProps {
  roomPrefix?: string;
  showPreview?: boolean;
  requireName?: boolean;
  requireEmail?: boolean;
  defaultName?: string;
  defaultEmail?: string;
  onJoin?: (roomName: string, participant: { name: string; email?: string }) => void;
}

export interface MeetingRoomProps extends BaseWidgetProps {
  roomName?: string;
  userName?: string;
  userEmail?: string;
  width?: string | number;
  height?: string | number;
  features?: string[];
  onParticipantJoin?: (participant: { id: string; name: string }) => void;
  onParticipantLeave?: (participant: { id: string; name: string }) => void;
}

export interface SIPPhoneProps extends BaseWidgetProps {
  autoRegister?: boolean;
  defaultNumber?: string;
  onRegister?: () => void;
  onIncomingCall?: (caller: string) => void;
}

// ============================================================================
// Script Loader
// ============================================================================

const WIDGET_SCRIPT_URL = 'https://cdn.mediasfu.com/widget.js';
let scriptLoaded = false;
let scriptLoading = false;
const loadCallbacks: (() => void)[] = [];

function loadWidgetScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (scriptLoaded) {
      resolve();
      return;
    }

    if (scriptLoading) {
      loadCallbacks.push(resolve);
      return;
    }

    scriptLoading = true;

    const script = document.createElement('script');
    script.src = WIDGET_SCRIPT_URL;
    script.async = true;

    script.onload = () => {
      scriptLoaded = true;
      scriptLoading = false;
      resolve();
      loadCallbacks.forEach(cb => cb());
      loadCallbacks.length = 0;
    };

    script.onerror = () => {
      scriptLoading = false;
      reject(new Error('Failed to load MediaSFU widget script'));
    };

    document.head.appendChild(script);
  });
}

// ============================================================================
// Base Hook
// ============================================================================

function useWidgetElement<T extends HTMLElement>(
  tagName: string,
  props: BaseWidgetProps & Record<string, any>,
  attributeMap: Record<string, string>
): React.RefObject<T | null> {
  const ref = useRef<T>(null);
  const { onReady, onError, onConnect, onDisconnect, className, style, ...restProps } = props;

  useEffect(() => {
    loadWidgetScript()
      .then(() => {
        onReady?.();
      })
      .catch((error) => {
        onError?.(error);
      });
  }, [onReady, onError]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Set attributes
    Object.entries(restProps).forEach(([key, value]) => {
      const attrName = attributeMap[key] || key.replace(/([A-Z])/g, '-$1').toLowerCase();
      if (value !== undefined && value !== null) {
        if (typeof value === 'boolean') {
          if (value) {
            element.setAttribute(attrName, '');
          } else {
            element.removeAttribute(attrName);
          }
        } else if (Array.isArray(value)) {
          element.setAttribute(attrName, value.join(','));
        } else {
          element.setAttribute(attrName, String(value));
        }
      }
    });

    // Event listeners
    const handleConnect = () => onConnect?.();
    const handleDisconnect = () => onDisconnect?.();

    element.addEventListener('mediasfu:connect', handleConnect);
    element.addEventListener('mediasfu:disconnect', handleDisconnect);

    return () => {
      element.removeEventListener('mediasfu:connect', handleConnect);
      element.removeEventListener('mediasfu:disconnect', handleDisconnect);
    };
  }, [restProps, onConnect, onDisconnect, attributeMap]);

  return ref;
}

// ============================================================================
// Components
// ============================================================================

/**
 * Call Button Widget
 *
 * A click-to-call button that initiates voice/video calls.
 *
 * @example
 * ```tsx
 * <CallButton
 *   widgetKey="wk_xxx"
 *   destination="+1234567890"
 *   buttonText="Call Us"
 *   onCallStart={() => console.log('Call started')}
 * />
 * ```
 */
export const CallButton: React.FC<CallButtonProps> = (props) => {
  const { className, style, onCallStart, onCallEnd, ...widgetProps } = props;

  const ref = useWidgetElement<HTMLElement>('mediasfu-call-button', widgetProps, {
    widgetKey: 'widget-key',
    buttonText: 'button-text',
    buttonIcon: 'button-icon',
  });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const handleCallStart = () => onCallStart?.();
    const handleCallEnd = () => onCallEnd?.();

    element.addEventListener('mediasfu:call-start', handleCallStart);
    element.addEventListener('mediasfu:call-end', handleCallEnd);

    return () => {
      element.removeEventListener('mediasfu:call-start', handleCallStart);
      element.removeEventListener('mediasfu:call-end', handleCallEnd);
    };
  }, [onCallStart, onCallEnd]);

  return React.createElement('mediasfu-call-button', {
    ref,
    class: className,
    style,
  });
};

/**
 * AI Agent Widget
 *
 * An AI-powered voice/chat agent interface.
 *
 * @example
 * ```tsx
 * <AIAgent
 *   widgetKey="wk_xxx"
 *   agentName="Support Bot"
 *   mode="voice"
 *   greeting="Hello! How can I help you today?"
 * />
 * ```
 */
export const AIAgent: React.FC<AIAgentProps> = (props) => {
  const { className, style, onMessage, ...widgetProps } = props;

  const ref = useWidgetElement<HTMLElement>('mediasfu-ai-agent', widgetProps, {
    widgetKey: 'widget-key',
    agentName: 'agent-name',
    systemPrompt: 'system-prompt',
  });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const handleMessage = (event: CustomEvent) => {
      onMessage?.(event.detail);
    };

    element.addEventListener('mediasfu:message', handleMessage as EventListener);

    return () => {
      element.removeEventListener('mediasfu:message', handleMessage as EventListener);
    };
  }, [onMessage]);

  return React.createElement('mediasfu-ai-agent', {
    ref,
    class: className,
    style,
  });
};

/**
 * Meeting Join Widget
 *
 * A form for joining video meetings with optional preview.
 *
 * @example
 * ```tsx
 * <MeetingJoin
 *   widgetKey="wk_xxx"
 *   roomPrefix="team-"
 *   showPreview={true}
 *   requireName={true}
 *   onJoin={(room, participant) => console.log(`${participant.name} joining ${room}`)}
 * />
 * ```
 */
export const MeetingJoin: React.FC<MeetingJoinProps> = (props) => {
  const { className, style, onJoin, ...widgetProps } = props;

  const ref = useWidgetElement<HTMLElement>('mediasfu-meeting-join', widgetProps, {
    widgetKey: 'widget-key',
    roomPrefix: 'room-prefix',
    showPreview: 'show-preview',
    requireName: 'require-name',
    requireEmail: 'require-email',
    defaultName: 'default-name',
    defaultEmail: 'default-email',
  });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const handleJoin = (event: CustomEvent) => {
      onJoin?.(event.detail.roomName, event.detail.participant);
    };

    element.addEventListener('mediasfu:join', handleJoin as EventListener);

    return () => {
      element.removeEventListener('mediasfu:join', handleJoin as EventListener);
    };
  }, [onJoin]);

  return React.createElement('mediasfu-meeting-join', {
    ref,
    class: className,
    style,
  });
};

/**
 * Meeting Room Widget
 *
 * A full embedded video meeting room.
 *
 * @example
 * ```tsx
 * <MeetingRoom
 *   widgetKey="wk_xxx"
 *   roomName="team-standup"
 *   userName="John Doe"
 *   width="100%"
 *   height="600px"
 *   features={['chat', 'screenshare', 'recording']}
 * />
 * ```
 */
export const MeetingRoom: React.FC<MeetingRoomProps> = (props) => {
  const {
    className,
    style,
    width = '100%',
    height = '600px',
    onParticipantJoin,
    onParticipantLeave,
    ...widgetProps
  } = props;

  const ref = useWidgetElement<HTMLElement>('mediasfu-meeting-room', widgetProps, {
    widgetKey: 'widget-key',
    roomName: 'room-name',
    userName: 'user-name',
    userEmail: 'user-email',
  });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const handleParticipantJoin = (event: CustomEvent) => {
      onParticipantJoin?.(event.detail);
    };
    const handleParticipantLeave = (event: CustomEvent) => {
      onParticipantLeave?.(event.detail);
    };

    element.addEventListener('mediasfu:participant-join', handleParticipantJoin as EventListener);
    element.addEventListener('mediasfu:participant-leave', handleParticipantLeave as EventListener);

    return () => {
      element.removeEventListener('mediasfu:participant-join', handleParticipantJoin as EventListener);
      element.removeEventListener('mediasfu:participant-leave', handleParticipantLeave as EventListener);
    };
  }, [onParticipantJoin, onParticipantLeave]);

  const combinedStyle = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    ...style,
  };

  return React.createElement('mediasfu-meeting-room', {
    ref,
    class: className,
    style: combinedStyle,
  });
};

/**
 * SIP Phone Widget
 *
 * A SIP softphone interface for VoIP calls.
 *
 * @example
 * ```tsx
 * <SIPPhone
 *   widgetKey="wk_xxx"
 *   position="bottom-right"
 *   autoRegister={true}
 *   onIncomingCall={(caller) => console.log(`Incoming call from ${caller}`)}
 * />
 * ```
 */
export const SIPPhone: React.FC<SIPPhoneProps> = (props) => {
  const { className, style, onRegister, onIncomingCall, ...widgetProps } = props;

  const ref = useWidgetElement<HTMLElement>('mediasfu-sip-phone', widgetProps, {
    widgetKey: 'widget-key',
    autoRegister: 'auto-register',
    defaultNumber: 'default-number',
  });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const handleRegister = () => onRegister?.();
    const handleIncomingCall = (event: CustomEvent) => {
      onIncomingCall?.(event.detail.caller);
    };

    element.addEventListener('mediasfu:register', handleRegister);
    element.addEventListener('mediasfu:incoming-call', handleIncomingCall as EventListener);

    return () => {
      element.removeEventListener('mediasfu:register', handleRegister);
      element.removeEventListener('mediasfu:incoming-call', handleIncomingCall as EventListener);
    };
  }, [onRegister, onIncomingCall]);

  return React.createElement('mediasfu-sip-phone', {
    ref,
    class: className,
    style,
  });
};

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to imperatively control a MediaSFU widget
 */
export function useMediaSFUWidget(widgetKey: string) {
  const elementRef = useRef<HTMLElement | null>(null);

  const findWidget = useCallback(() => {
    if (!elementRef.current) {
      elementRef.current = document.querySelector(`[widget-key="${widgetKey}"]`);
    }
    return elementRef.current;
  }, [widgetKey]);

  const call = useCallback((destination: string) => {
    const element = findWidget();
    if (element && 'call' in element) {
      (element as any).call(destination);
    }
  }, [findWidget]);

  const hangup = useCallback(() => {
    const element = findWidget();
    if (element && 'hangup' in element) {
      (element as any).hangup();
    }
  }, [findWidget]);

  const mute = useCallback((muted: boolean) => {
    const element = findWidget();
    if (element && 'mute' in element) {
      (element as any).mute(muted);
    }
  }, [findWidget]);

  const setTheme = useCallback((theme: WidgetTheme) => {
    const element = findWidget();
    if (element) {
      element.setAttribute('theme', theme);
    }
  }, [findWidget]);

  return {
    call,
    hangup,
    mute,
    setTheme,
  };
}

// ============================================================================
// Provider (Optional)
// ============================================================================

interface MediaSFUProviderProps {
  children: React.ReactNode;
  defaultTheme?: WidgetTheme;
}

const MediaSFUContext = React.createContext<{
  theme: WidgetTheme;
  setTheme: (theme: WidgetTheme) => void;
}>({
  theme: 'light',
  setTheme: () => {},
});

export const MediaSFUProvider: React.FC<MediaSFUProviderProps> = ({
  children,
  defaultTheme = 'light'
}) => {
  const [theme, setTheme] = React.useState<WidgetTheme>(defaultTheme);

  useEffect(() => {
    loadWidgetScript();
  }, []);

  return React.createElement(
    MediaSFUContext.Provider,
    { value: { theme, setTheme } },
    children
  );
};

export const useMediaSFU = () => React.useContext(MediaSFUContext);

// ============================================================================
// Exports
// ============================================================================

export default {
  CallButton,
  AIAgent,
  MeetingJoin,
  MeetingRoom,
  SIPPhone,
  MediaSFUProvider,
  useMediaSFU,
  useMediaSFUWidget,
};
