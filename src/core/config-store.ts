/**
 * MediaSFU Widget Configuration Store
 * Shared configuration state to avoid circular dependencies
 */

import type { WidgetConfig } from '../types';
import {
  getApiUrl as getEnvApiUrl,
  getRoomUrl as getEnvRoomUrl,
  getCallsUrl as getEnvCallsUrl,
  getAgentUrl as getEnvAgentUrl,
  getCdnUrl as getEnvCdnUrl,
  getWebAgentUrl as getEnvWebAgentUrl,
  getDashboardUrl as getEnvDashboardUrl,
  getCurrentEnvironment
} from './environments';

// Global configuration store
let globalConfig: WidgetConfig | null = null;

/**
 * Get current widget configuration
 */
export function getConfig(): WidgetConfig | null {
  return globalConfig;
}

/**
 * Set widget configuration
 */
export function setConfig(config: WidgetConfig): void {
  globalConfig = config;
}

/**
 * Get API URL from config or environment default
 */
export function getApiUrl(): string {
  return globalConfig?.apiUrl || getEnvApiUrl();
}

/**
 * Get room URL from config or environment default
 */
export function getRoomUrl(): string {
  return globalConfig?.roomUrl || getEnvRoomUrl();
}

/**
 * Get calls URL from config or environment default
 */
export function getCallsUrl(): string {
  return globalConfig?.callsUrl || getEnvCallsUrl();
}

/**
 * Get agent URL from config or environment default
 */
export function getAgentUrl(): string {
  return globalConfig?.agentUrl || getEnvAgentUrl();
}

/**
 * Get web agent embed URL from config or environment default
 */
export function getWebAgentUrl(): string {
  return (globalConfig as any)?.webAgentUrl || getEnvWebAgentUrl();
}

/**
 * Get agent dashboard embed URL from config or environment default
 */
export function getDashboardUrl(): string {
  return (globalConfig as any)?.dashboardUrl || getEnvDashboardUrl();
}

/**
 * Get CDN URL from config or environment default
 */
export function getCdnUrl(): string {
  return globalConfig?.cdnUrl || getEnvCdnUrl();
}

/**
 * Get current environment name
 */
export function getEnvironment(): string {
  return getCurrentEnvironment();
}
