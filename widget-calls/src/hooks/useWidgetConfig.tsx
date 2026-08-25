/**
 * Widget Configuration Context & Hook
 *
 * Replaces useVoipConfig for the widget-calls iframe.
 * Configuration comes from URL query params (passed by the parent widget-loader),
 * NOT from localStorage.
 *
 * URL params expected:
 *   sessionToken - JWT from widget auth
 *   widgetKey    - widget key for identification
 *   theme        - 'light' | 'dark' (default: 'light')
 *   brandColor   - custom primary brand color (hex)
 *   baseUrl      - API base URL override
 */

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { AppConfig, DEFAULT_CONFIG } from '../types';
import { WidgetHttpClient } from '../services/widgetHttpClient';
import { WidgetCallService, setCallServiceSingleton } from '../services/callService';

// ─── Widget-specific config extensions ───────────────────────────

export interface WidgetParams {
  sessionToken: string;
  widgetKey: string;
  theme: 'light' | 'dark';
  brandColor?: string;
  baseUrl: string;
  studioOperatorMode: boolean;
  operatorGrant?: string;
  // Resolved after validate-session
  apiUserName?: string;
  apiKey?: string;
}

interface WidgetConfigContextValue {
  config: AppConfig;
  widgetParams: WidgetParams;
  httpClient: WidgetHttpClient;
  callService: WidgetCallService;
  isAuthenticated: boolean;
  setAuthenticated: (v: boolean) => void;
  setCredentials: (apiUserName: string, apiKey: string) => void;
  setOperatorGrant: (operatorGrant: string) => void;
  updateTheme: (theme: 'light' | 'dark') => void;
}

const WidgetConfigContext = createContext<WidgetConfigContextValue | null>(null);

// ─── Parse URL query params ──────────────────────────────────────

function getApiBaseUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get('baseUrl') || params.get('apiUrl');
  if (explicit) return explicit.replace(/\/$/, '');

  return 'https://mediasfu.com';
}

function parseWidgetParams(): WidgetParams {
  const params = new URLSearchParams(window.location.search);
  return {
    sessionToken: params.get('sessionToken') || params.get('token') || '',
    widgetKey: params.get('widgetKey') || '',
    theme: (params.get('theme') as 'light' | 'dark') || 'light',
    brandColor: params.get('brandColor') || undefined,
    baseUrl: getApiBaseUrl(),
    studioOperatorMode: params.get('studioOperator') === '1',
  };
}

// ─── Provider ────────────────────────────────────────────────────

export const WidgetConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [widgetParams, setWidgetParams] = useState<WidgetParams>(parseWidgetParams);
  const [isAuthenticated, setAuthenticated] = useState(false);

  // Build config matching AppConfig shape for CallsPage compatibility
  const config = useMemo<AppConfig>(() => ({
    ...DEFAULT_CONFIG,
    api: {
      key: widgetParams.apiKey || '',
      userName: widgetParams.apiUserName || '',
      baseUrl: widgetParams.baseUrl,
    },
    ui: {
      theme: widgetParams.theme,
      compactMode: false,
    },
  }), [widgetParams]);

  // Singleton HTTP client & call service
  const httpClient = useMemo(
    () => new WidgetHttpClient(
      widgetParams.baseUrl,
      widgetParams.sessionToken,
      widgetParams.operatorGrant
    ),
    [widgetParams.baseUrl, widgetParams.sessionToken, widgetParams.operatorGrant]
  );

  const callService = useMemo(
    () => {
      const svc = new WidgetCallService(httpClient);
      setCallServiceSingleton(svc);
      return svc;
    },
    [httpClient]
  );

  const updateTheme = useCallback((theme: 'light' | 'dark') => {
    setWidgetParams((prev) => ({ ...prev, theme }));
  }, []);

  const setCredentials = useCallback((apiUserName: string, apiKey: string) => {
    if (httpClient.hasOperatorGrant) return;
    httpClient.setCredentials(apiUserName, apiKey);
    setWidgetParams((prev) => ({ ...prev, apiUserName, apiKey }));
    try {
      localStorage.setItem('mediaSFUCredentials', JSON.stringify({ apiUserName, apiKey }));
    } catch { /* ignore storage errors */ }
  }, [httpClient]);

  const setOperatorGrant = useCallback((operatorGrant: string) => {
    const grant = String(operatorGrant || '').trim();
    httpClient.setOperatorGrant(grant);
    setWidgetParams((prev) => ({
      ...prev,
      operatorGrant: grant,
      apiUserName: undefined,
      apiKey: undefined,
    }));
    try {
      localStorage.removeItem('mediaSFUCredentials');
      localStorage.removeItem('widget_call_history');
    } catch { /* ignore storage errors */ }
  }, [httpClient]);

  const value = useMemo<WidgetConfigContextValue>(() => ({
    config,
    widgetParams,
    httpClient,
    callService,
    isAuthenticated,
    setAuthenticated,
    setCredentials,
    setOperatorGrant,
    updateTheme,
  }), [
    config,
    widgetParams,
    httpClient,
    callService,
    isAuthenticated,
    setCredentials,
    setOperatorGrant,
    updateTheme,
  ]);

  return (
    <WidgetConfigContext.Provider value={value}>
      {children}
    </WidgetConfigContext.Provider>
  );
};

// ─── Hook ────────────────────────────────────────────────────────

export const useWidgetConfig = () => {
  const ctx = useContext(WidgetConfigContext);
  if (!ctx) {
    throw new Error('useWidgetConfig must be used within WidgetConfigProvider');
  }
  return ctx;
};

/**
 * Compatibility shim: returns the same shape as useVoipConfig()
 * so CallsPage can use it without changes.
 */
export const useVoipConfig = () => {
  const { config } = useWidgetConfig();
  return {
    config,
    // Stubs for methods CallsPage might call
    updateConfig: () => {},
    updateApiConfig: () => {},
    updateRealtimeConfig: () => {},
    updateUIConfig: () => {},
    updateCallsConfig: () => {},
    isApiConfigured: () => !!(config.api.key && config.api.userName),
    getApiCredentials: () => ({ apiUserName: config.api.userName, apiKey: config.api.key }),
    resetConfig: () => {},
    toggleTheme: () => {},
    exportConfig: () => JSON.stringify(config),
    importConfig: () => false,
  };
};
