/**
 * Widget-Calls App.tsx
 *
 * Entry point for the CallsPage iframe widget.
 *
 * Flow:
 * 1. Receive a session grant from the parent (legacy URL tokens remain supported)
 * 2. POST /v1/widget/validate-session → get apiUserName + apiKey
 * 3. Inject credentials into WidgetConfigProvider
 * 4. Render CallsPage
 * 5. PostMessage bridge for parent communication
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { WidgetConfigProvider, useWidgetConfig } from "./hooks/useWidgetConfig";
import CallsPage from "./components/Calls/CallsPage";
import CallsPagePreview from "./components/Calls/CallsPagePreview";
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
  if (!sessionToken) {
    return { valid: false, error: "No session token provided" };
  }
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
      return {
        valid: false,
        error: (err as { error?: string }).error || "Invalid session",
      };
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
    window.parent.postMessage(
      { type: `mediasfu:${type}`, payload },
      targetOrigin
    );
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

// ─── Inner App (inside WidgetConfigProvider) ────────────────────

function InnerApp() {
  const reportActiveCalls = useCallback((calls: Array<{ callId: string; roomName?: string }>) => {
    postToParent("activeCallsChanged", { calls });
  }, []);
  const {
    widgetParams,
    isAuthenticated,
    setAuthenticated,
    setCredentials,
    setOperatorGrant,
    updateTheme,
  } = useWidgetConfig();

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionConfig, setSessionConfig] = useState<Record<string, unknown>>({});
  const queryParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const [parentSessionToken, setParentSessionToken] = useState('');
  const parentSession = queryParams.get('parentSession') === '1';
  const effectiveSessionToken = parentSessionToken || widgetParams.sessionToken;
  const isPresentationMode = queryParams.get("presentation") === "1";
  const queryCustomCss = queryParams.get("customCSS") || "";
  const savedCustomCss = typeof sessionConfig.customCSS === "string"
    ? sessionConfig.customCSS
    : typeof sessionConfig.customCss === "string"
    ? sessionConfig.customCss
    : "";
  const customCss = queryCustomCss || savedCustomCss;
  const contentOverrides = useMemo<Record<string, { text?: string }>>(() => {
    const queryValue = queryParams.get("contentOverrides");
    const source = queryValue || sessionConfig.contentOverrides;
    if (!source) return {};
    if (typeof source === "object" && !Array.isArray(source)) {
      return source as Record<string, { text?: string }>;
    }
    if (typeof source !== "string") return {};
    try {
      const parsed = JSON.parse(source);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }, [queryParams, sessionConfig]);

  // Apply theme class to body
  useEffect(() => {
    document.body.classList.toggle("dark", widgetParams.theme === "dark");
    document.body.classList.toggle("light", widgetParams.theme === "light");
  }, [widgetParams.theme]);

  useEffect(() => {
    const styleId = "mediasfu-calls-custom-css";
    let style = document.getElementById(styleId) as HTMLStyleElement | null;

    if (!customCss) {
      style?.remove();
      return;
    }

    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      document.head.appendChild(style);
    }
    style.textContent = customCss;

    return () => style?.remove();
  }, [customCss]);

  // Auto-resize: report content height to parent frame
  useEffect(() => {
    if (window.parent === window) return; // not in iframe
    let lastHeight = 0;
    const report = () => {
      const h = document.documentElement.scrollHeight;
      if (h && h !== lastHeight) {
        lastHeight = h;
        postToParent('resize', { height: h });
      }
    };
    // ResizeObserver for layout changes
    const ro = new ResizeObserver(report);
    ro.observe(document.body);
    // Also poll briefly for dynamic content
    const interval = setInterval(report, 1000);
    report();
    return () => { ro.disconnect(); clearInterval(interval); };
  }, []);

  // Apply brand color CSS variable
  useEffect(() => {
    if (widgetParams.brandColor) {
      document.documentElement.style.setProperty(
        "--brand-primary",
        widgetParams.brandColor
      );
    }
  }, [widgetParams.brandColor]);

  useEffect(() => {
    if (!parentSession || widgetParams.studioOperatorMode) return undefined;
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
  }, [parentSession, widgetParams.studioOperatorMode]);

  // Validate the granted session on mount. Direct URL tokens are legacy-only.
  useEffect(() => {
    if (isPresentationMode) {
      setError(null);
      setLoading(false);
      return;
    }
    if (isAuthenticated) return;
    if (widgetParams.studioOperatorMode) {
      postToParent("studioOperatorGrantRequest");
      return;
    }
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
        postToParent("authError", {
          error: result.error || "Session validation failed",
        });
        return;
      }

      setSessionConfig(result.config || {});

      // Inject credentials into widget context
      setCredentials(
        result.credentials.apiUserName,
        result.credentials.apiKey
      );
      setAuthenticated(true);
      setLoading(false);

      postToParent("callsReady", {
        apiUserName: result.credentials.apiUserName,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isPresentationMode,
    isAuthenticated,
    effectiveSessionToken,
    parentSession,
    parentSessionToken,
    setAuthenticated,
    setCredentials,
    widgetParams.studioOperatorMode,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for parent messages
  useEffect(() => {
    function handleParentMessage(event: MessageEvent) {
      const parentOrigin = resolveParentOrigin();
      if (!parentOrigin || event.source !== window.parent || event.origin !== parentOrigin) return;

      const { type, payload } = event.data || {};
      if (!type || !type.startsWith("mediasfu:")) return;

      switch (type) {
        case "mediasfu:studioOperatorGrant": {
          if (!widgetParams.studioOperatorMode) break;
          const grant = String(payload?.grant || "").trim();
          if (!grant) {
            setError("Studio operator grant is missing.");
            setLoading(false);
            break;
          }
          setOperatorGrant(grant);
          setError(null);
          setAuthenticated(true);
          setLoading(false);
          postToParent("callsReady", { scope: "studio" });
          break;
        }
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
  }, [
    isAuthenticated,
    setAuthenticated,
    setOperatorGrant,
    updateTheme,
    widgetParams.studioOperatorMode,
  ]);

  // ── Loading UI ──
  if (isPresentationMode) {
    return (
      <div className={`app ${widgetParams.theme}`}>
        <CallsPagePreview />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="widget-loading">
        <div className="spinner" />
        <p>Connecting...</p>
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

  // ── Ready ──
  return <div className={`app ${widgetParams.theme}`}><CallsPage contentOverrides={contentOverrides} onActiveCallsChanged={reportActiveCalls} /></div>;
}

// ─── Root App ───────────────────────────────────────────────────

export default function App() {
  return (
    <WidgetConfigProvider>
      <InnerApp />
    </WidgetConfigProvider>
  );
}
