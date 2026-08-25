/**
 * Widget Agent Configuration Context & Hook
 *
 * Configuration comes from URL query params (passed by the parent widget-loader).
 *
 * URL params expected:
 *   sessionToken - JWT from widget auth
 *   widgetKey    - widget key for identification
 *   theme        - 'light' | 'dark' (default: 'dark')
 *   brandColor   - custom primary brand color (hex)
 *   baseUrl      - API base URL override
 *   mode         - 'voice' | 'multimodal' (default: 'multimodal')
 *   agentId      - optional agent configuration ID
 *
 * After validation:
 *   apiUserName  - resolved from validate-session
 *   apiKey       - resolved from validate-session
 *   widgetConfig - full widget config from validate-session (sttNickName, llmNickName, etc.)
 */

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

// ─── Widget-specific config ──────────────────────────────────────

export interface WidgetConfig {
  sttNickName?: string;
  llmNickName?: string;
  textLlmNickName?: string;
  visionLlmNickName?: string;
  ttsNickName?: string;
  realtimeNickName?: string;
  speechEngine?: 'classic' | 'realtime' | string;
  realtimeProvider?: string;
  realtimeModel?: string;
  realtimeUrl?: string;
  realtimeParams?: Record<string, unknown>;
  audioConfig?: Record<string, unknown>;
  visionConfig?: Record<string, unknown>;
  audio?: Record<string, unknown>;
  vision?: Record<string, unknown>;
  pipeline?: string[];
  sttParams?: Record<string, unknown>;
  llmParams?: Record<string, unknown>;
  ttsParams?: Record<string, unknown>;
  systemPrompt?: string;
  fallbackBehavior?: string;
  fallbackMessage?: string;
  fallbackResponse?: string;
  language?: string;
  voiceId?: string;
  agentName?: string;
  mode?: string;
  extra?: Array<{ key: string; value: string }>;
  knowledgeResourceType?: 'sipConfig' | 'webAgentConfig' | 'widgetKey' | string;
  knowledgeResourceId?: string;
  knowledgeBase?: {
    enabled?: boolean;
    resourceType?: string;
    resourceId?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface WidgetAgentParams {
  sessionToken: string;
  widgetKey: string;
  theme: 'light' | 'dark';
  brandColor?: string;
  baseUrl: string;
  mode: 'voice' | 'multimodal';
  agentId?: string;
  agentName?: string;
  showBranding?: boolean;
  idleStyle?: 'orb' | 'card' | 'glass' | 'welcome';
  // Resolved after validate-session
  apiUserName?: string;
  apiKey?: string;
}

interface WidgetAgentContextValue {
  params: WidgetAgentParams;
  widgetConfig: WidgetConfig;
  isAuthenticated: boolean;
  setAuthenticated: (v: boolean) => void;
  setCredentials: (apiUserName: string, apiKey: string) => void;
  setWidgetConfig: (config: WidgetConfig) => void;
  updateTheme: (theme: 'light' | 'dark') => void;
}

const WidgetAgentContext = createContext<WidgetAgentContextValue | null>(null);

// ─── URL resolution ──────────────────────────────────────────────

function getApiBaseUrl(): string {
  const urlParams = new URLSearchParams(window.location.search);
  const explicit = urlParams.get('baseUrl') || urlParams.get('apiUrl');
  if (explicit) return explicit.replace(/\/$/, '');

  return 'https://mediasfu.com';
}

function parseWidgetParams(): WidgetAgentParams {
  const p = new URLSearchParams(window.location.search);
  return {
    sessionToken: p.get('sessionToken') || p.get('token') || '',
    widgetKey: p.get('widgetKey') || '',
    theme: (p.get('theme') as 'light' | 'dark') || 'dark',
    brandColor: p.get('brandColor') || undefined,
    baseUrl: getApiBaseUrl(),
    mode: (p.get('mode') as 'voice' | 'multimodal') || 'multimodal',
    agentId: p.get('agentId') || undefined,
    agentName: p.get('agentName') || undefined,
    showBranding: p.get('showBranding') !== 'false',
    idleStyle: (p.get('idleStyle') as 'orb' | 'card' | 'glass' | 'welcome') || 'orb',
  };
}

// ─── Provider ────────────────────────────────────────────────────

export const WidgetAgentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [params, setParams] = useState<WidgetAgentParams>(parseWidgetParams);
  const [widgetConfig, setWidgetConfigState] = useState<WidgetConfig>({});
  const [isAuthenticated, setAuthenticated] = useState(false);

  const setCredentials = useCallback((apiUserName: string, apiKey: string) => {
    setParams((prev) => ({ ...prev, apiUserName, apiKey }));
  }, []);

  const setWidgetConfig = useCallback((config: WidgetConfig) => {
    setWidgetConfigState(config || {});
  }, []);

  const updateTheme = useCallback((theme: 'light' | 'dark') => {
    setParams((prev) => ({ ...prev, theme }));
  }, []);

  const value = useMemo<WidgetAgentContextValue>(() => ({
    params,
    widgetConfig,
    isAuthenticated,
    setAuthenticated,
    setCredentials,
    setWidgetConfig,
    updateTheme,
  }), [params, widgetConfig, isAuthenticated, setCredentials, setWidgetConfig, updateTheme]);

  return (
    <WidgetAgentContext.Provider value={value}>
      {children}
    </WidgetAgentContext.Provider>
  );
};

// ─── Hook ────────────────────────────────────────────────────────

export const useWidgetAgent = () => {
  const ctx = useContext(WidgetAgentContext);
  if (!ctx) {
    throw new Error('useWidgetAgent must be used within WidgetAgentProvider');
  }
  return ctx;
};
