/**
 * MediaSFU Widget Authentication
 * Handles widget key validation and session token management
 */

import type { AuthResponse, WidgetError, WidgetType } from '../types';
import { getApiUrl } from './config-store';

// Session token cache — keyed by widget key so multiple widgets on the same page
// each get their own auth response (destination, sipConfigId, etc.)
interface CachedEntry {
  token: string;
  expiresAt: Date;
  config: AuthResponse['config'];
}
const sessionCache = new Map<string, CachedEntry>();

// Legacy pointer: tracks the most-recently-authenticated widget key so
// getSessionToken / getSessionConfig still work without a key argument.
let lastAuthKey: string | null = null;

/**
 * Authenticate widget and get session token
 */
export async function authenticate(
  widgetKey: string,
  widgetType: WidgetType
): Promise<AuthResponse> {
  const apiUrl = getApiUrl();

  // Check per-key cache first
  const cached = sessionCache.get(widgetKey);
  if (cached && new Date() < cached.expiresAt) {
    lastAuthKey = widgetKey;
    return {
      success: true,
      sessionToken: cached.token,
      expiresAt: cached.expiresAt.toISOString(),
      config: cached.config,
    };
  }

  // Send the exact browser origin so short-lived sessions can be bound to an
  // allowlisted scheme + host + port tuple.
  const domain = window.location.origin;
  const fingerprint = await generateFingerprint();

  try {
    const response = await fetch(`${apiUrl}/v1/widget/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        widgetKey,
        domain,
        widgetType,
        fingerprint,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw createWidgetError(error.code || 'INVALID_WIDGET_KEY', error.message);
    }

    const data: AuthResponse = await response.json();

    // Cache the session per widget key
    sessionCache.set(widgetKey, {
      token: data.sessionToken,
      expiresAt: new Date(data.expiresAt),
      config: data.config,
    });
    lastAuthKey = widgetKey;

    return data;
  } catch (error) {
    if (isWidgetError(error)) {
      throw error;
    }
    throw createWidgetError('NETWORK_ERROR', 'Failed to authenticate widget');
  }
}

/**
 * Get current session token (for a specific widget key, or the last-authenticated one)
 */
export function getSessionToken(widgetKey?: string): string | null {
  const key = widgetKey || lastAuthKey;
  if (!key) return null;
  const entry = sessionCache.get(key);
  if (entry && new Date() < entry.expiresAt) {
    return entry.token;
  }
  return null;
}

/**
 * Clear cached session (optionally for a specific widget key)
 */
export function clearSession(widgetKey?: string): void {
  if (widgetKey) {
    sessionCache.delete(widgetKey);
  } else {
    sessionCache.clear();
    lastAuthKey = null;
  }
}

/**
 * Check if session is valid (for a specific widget key, or the last-authenticated one)
 */
export function isSessionValid(widgetKey?: string): boolean {
  const key = widgetKey || lastAuthKey;
  if (!key) return false;
  const entry = sessionCache.get(key);
  return entry !== null && entry !== undefined && new Date() < entry.expiresAt;
}

/**
 * Get session config (for a specific widget key, or the last-authenticated one)
 */
export function getSessionConfig(widgetKey?: string): AuthResponse['config'] | null {
  const key = widgetKey || lastAuthKey;
  if (!key) return null;
  return sessionCache.get(key)?.config || null;
}

/**
 * Generate browser fingerprint for fraud prevention
 */
async function generateFingerprint(): Promise<string> {
  const components = [
    navigator.userAgent,
    navigator.language,
    window.screen.width,
    window.screen.height,
    window.screen.colorDepth,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 0,
  ];

  const fingerprint = components.join('|');

  // Use SubtleCrypto if available, otherwise simple hash
  if (window.crypto && window.crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(fingerprint);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback: simple hash
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    const char = fingerprint.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

/**
 * Create a WidgetError object
 */
export function createWidgetError(
  code: WidgetError['code'],
  message: string,
  details?: Record<string, unknown>
): WidgetError {
  return { code, message, details };
}

/**
 * Type guard for WidgetError
 */
function isWidgetError(error: unknown): error is WidgetError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error
  );
}
