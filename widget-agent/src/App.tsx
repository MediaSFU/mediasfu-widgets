/**
 * Widget-Agent App.tsx
 *
 * Entry point for the AI Agent iframe widget.
 *
 * Flow:
 * 1. Receive a session grant from the parent (legacy URL tokens remain supported)
 * 2. POST /v1/widget/validate-session → get apiUserName + apiKey
 * 3. Inject credentials into WidgetAgentProvider
 * 4. Render AgentsVoice (mode=voice) or AgentsMultimodal (mode=multimodal)
 * 5. PostMessage bridge for parent communication
 */

import React, { useEffect, useState } from "react";
import { WidgetAgentProvider, useWidgetAgent } from "./hooks/useWidgetAgent";
import AgentUnified from "./components/AgentUnified";
import useEmbedCustomCss from "./hooks/useEmbedCustomCss";
import "./index.css";

// ─── API base URL resolution ────────────────────────────────────

function getApiBaseUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get("baseUrl") || params.get("apiUrl");
  if (explicit) return explicit.replace(/\/$/, "");

  return "https://mediasfu.com";
}

// ─── Session validation ─────────────────────────────────────────

async function validateSession(
  sessionToken: string
): Promise<{
  valid: boolean;
  credentials?: { apiUserName: string; apiKey: string };
  config?: Record<string, unknown>;
  error?: string;
}> {
  if (!sessionToken) return { valid: false, error: "No session token provided" };
  try {
    const response = await fetch(
      `${getApiBaseUrl()}/v1/widget/validate-session`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken }),
      }
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { valid: false, error: (err as { error?: string }).error || "Invalid session" };
    }
    const data = await response.json();
    return {
      valid: data.success,
      credentials: data.credentials,
      config: data.config,
    };
  } catch {
    return { valid: false, error: "Failed to validate session" };
  }
}

// ─── PostMessage helpers ────────────────────────────────────────

function postToParent(type: string, payload: Record<string, unknown> = {}) {
  if (window.parent && window.parent !== window) {
    const targetOrigin = resolveParentOrigin();
    if (!targetOrigin) return;
    window.parent.postMessage({ type: `mediasfu:${type}`, payload }, targetOrigin);
  }
}

function resolveParentOrigin(): string | null {
  const parseOrigin = (value: string | null): string | null => {
    if (!value || value.length > 2048) return null;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) return null;
      return url.origin;
    } catch {
      return null;
    }
  };

  const explicit = parseOrigin(new URLSearchParams(window.location.search).get('parentOrigin'));
  if (explicit) return explicit;
  try {
    return document.referrer ? new URL(document.referrer).origin : null;
  } catch {
    return null;
  }
}

function isValidSessionGrant(value: unknown): value is string {
  return typeof value === 'string' &&
    value === value.trim() &&
    value.length >= 20 &&
    value.length <= 8192 &&
    /^[A-Za-z0-9._~-]+$/.test(value);
}

// ─── Inner App ──────────────────────────────────────────────────

function InnerApp() {
  const {
    params,
    widgetConfig,
    isAuthenticated,
    setAuthenticated,
    setCredentials,
    setWidgetConfig,
    updateTheme,
  } = useWidgetAgent();

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [parentSessionToken, setParentSessionToken] = useState('');
  const parentSession = new URLSearchParams(window.location.search).get('parentSession') === '1';
  const effectiveSessionToken = parentSessionToken || params.sessionToken;

  // Apply theme
  useEffect(() => {
    document.body.classList.toggle("dark", params.theme === "dark");
  }, [params.theme]);

  // Apply brand color
  useEffect(() => {
    if (params.brandColor) {
      document.documentElement.style.setProperty("--brand-primary", params.brandColor);
    }
  }, [params.brandColor]);

  useEffect(() => {
    if (!parentSession) return undefined;
    const parentOrigin = resolveParentOrigin();
    if (!parentOrigin) {
      setError('Parent session transport is unavailable.');
      setLoading(false);
      return undefined;
    }

    let received = false;
    let requestTimer: ReturnType<typeof setInterval> | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const requestSession = () => {
      if (!received) postToParent('widgetSessionGrantRequest');
    };
    const handleSession = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== parentOrigin) return;
      if (event.data?.type !== 'mediasfu:widgetSessionGrant') return;
      const token = event.data?.payload?.sessionToken;
      if (!isValidSessionGrant(token)) {
        setError('Parent session transport is unavailable.');
        setLoading(false);
        return;
      }
      received = true;
      if (requestTimer) clearInterval(requestTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      setParentSessionToken(token);
    };

    window.addEventListener('message', handleSession);
    requestSession();
    requestTimer = setInterval(requestSession, 750);
    timeoutTimer = setTimeout(() => {
      if (received) return;
      if (requestTimer) clearInterval(requestTimer);
      setError('Parent session transport is unavailable.');
      setLoading(false);
    }, 12000);
    return () => {
      received = true;
      if (requestTimer) clearInterval(requestTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      window.removeEventListener('message', handleSession);
    };
  }, [parentSession]);

  // Validate the granted session on mount. Direct URL tokens are legacy-only.
  useEffect(() => {
    if (isAuthenticated) return;
    if (parentSession && !parentSessionToken) return;
    if (!effectiveSessionToken) {
      setError("Missing session token. Ensure the widget is properly configured.");
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      const result = await validateSession(effectiveSessionToken);
      if (cancelled) return;

      if (!result.valid || !result.credentials) {
        setError(result.error || "Session validation failed");
        setLoading(false);
        postToParent("authError", { error: result.error || "Session validation failed" });
        return;
      }

      setCredentials(result.credentials.apiUserName, result.credentials.apiKey);
      if (result.config) {
        setWidgetConfig(result.config as Record<string, unknown>);
      }
      setAuthenticated(true);
      setLoading(false);

      postToParent("agentReady", {
        apiUserName: result.credentials.apiUserName,
        mode: params.mode,
      });
    })();

    return () => { cancelled = true; };
  }, [effectiveSessionToken, parentSession, parentSessionToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for parent messages
  useEffect(() => {
    function handleParentMessage(event: MessageEvent) {
      const parentOrigin = resolveParentOrigin();
      if (!parentOrigin || event.source !== window.parent || event.origin !== parentOrigin) return;
      const { type, payload } = event.data || {};
      if (!type || !type.startsWith("mediasfu:")) return;

      switch (type) {
        case "mediasfu:setTheme":
          updateTheme(payload?.theme === "dark" ? "dark" : "light");
          break;
        case "mediasfu:ping":
          postToParent("pong", { authenticated: isAuthenticated });
          break;
        default:
          break;
      }
    }

    window.addEventListener("message", handleParentMessage);
    return () => window.removeEventListener("message", handleParentMessage);
  }, [isAuthenticated, updateTheme]);

  // Disconnect handler
  const handleDisconnect = () => {
    postToParent("agentDisconnect");
  };

  // ── Loading UI ──
  if (loading) {
    return (
      <div className="widget-loading">
        <div className="spinner" />
        <p>Connecting to agent...</p>
      </div>
    );
  }

  // ── Error UI ──
  if (error) {
    return (
      <div className="widget-error">
        <h2>Connection Error</h2>
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  // ── Ready — render based on mode ──
  return (
    <AgentUnified
      baseUrl={params.baseUrl}
      credentials={{
        apiUserName: params.apiUserName || "",
        apiKey: params.apiKey || "",
      }}
      widgetConfig={widgetConfig}
      onDisconnect={handleDisconnect}
      darkMode={params.theme === "dark"}
      agentName={params.agentName}
      showBranding={params.showBranding}
      mode={params.mode}
      idleStyle={params.idleStyle}
      sessionToken={effectiveSessionToken}
    />
  );
}

// ─── Root App ───────────────────────────────────────────────────

export default function App() {
  /* Preset/Studio token overrides forwarded by <mediasfu-ai-agent> as the
     `customCSS` parameter. Applied at the root so the whole agent surface
     picks them up. */
  useEmbedCustomCss();

  return (
    <WidgetAgentProvider>
      <InnerApp />
    </WidgetAgentProvider>
  );
}
