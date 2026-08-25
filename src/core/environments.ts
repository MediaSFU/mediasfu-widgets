/**
 * MediaSFU Widget Environment Configuration
 *
 * This file centralizes the public production defaults. Applications that use
 * MediaSFU Open or another approved deployment can override individual URLs
 * through MediaSFU.init without changing the package's environment.
 */

export type Environment = 'production';

export interface EnvironmentConfig {
  apiUrl: string;
  cdnUrl: string;
  roomUrl: string;
  callsUrl: string;
  agentUrl: string;
  webAgentUrl: string;
  dashboardUrl: string;
  wsUrl: string;
}

/**
 * Environment configurations
 */
export const environments: Record<Environment, EnvironmentConfig> = {
  production: {
    apiUrl: 'https://mediasfu.com',
    cdnUrl: 'https://cdn.mediasfu.com/v1',
    roomUrl: 'https://mediasfu.com/widget-room',
    callsUrl: 'https://mediasfu.com/widget-calls',
    agentUrl: 'https://mediasfu.com/widget-agent',
    webAgentUrl: 'https://mediasfu.com/web-agents/embed',
    dashboardUrl: 'https://mediasfu.com/web-agents/embed-dashboard',
    wsUrl: 'wss://mediasfu.com',
  },
};

/**
 * The public package always selects production. Deployment-specific URLs are
 * explicit configuration, never inferred from a consumer's page or script.
 */
export function detectEnvironment(): Environment {
  return 'production';
}

/**
 * Override environment detection (useful for testing)
 */
let overrideEnvironment: Environment | null = null;

export function setEnvironment(env: Environment | null): void {
  overrideEnvironment = env;
}

export function getCurrentEnvironment(): Environment {
  return overrideEnvironment || detectEnvironment();
}

/**
 * Get configuration for current environment (respects override)
 */
export function getEnvironmentConfig(): EnvironmentConfig {
  const env = getCurrentEnvironment();
  return environments[env];
}

/**
 * Get API URL for current environment
 */
export function getApiUrl(): string {
  return getEnvironmentConfig().apiUrl;
}

/**
 * Get CDN URL for current environment
 */
export function getCdnUrl(): string {
  return getEnvironmentConfig().cdnUrl;
}

/**
 * Get Room URL for current environment
 */
export function getRoomUrl(): string {
  return getEnvironmentConfig().roomUrl;
}

/**
 * Get Calls URL for current environment
 */
export function getCallsUrl(): string {
  return getEnvironmentConfig().callsUrl;
}

/**
 * Get Agent URL for current environment
 */
export function getAgentUrl(): string {
  return getEnvironmentConfig().agentUrl;
}

/**
 * Get Web Agent embed URL for current environment
 */
export function getWebAgentUrl(): string {
  return getEnvironmentConfig().webAgentUrl;
}

/**
 * Get Agent Dashboard embed URL for current environment
 */
export function getDashboardUrl(): string {
  return getEnvironmentConfig().dashboardUrl;
}

/**
 * Get WebSocket URL for current environment
 */
export function getWsUrl(): string {
  return getEnvironmentConfig().wsUrl;
}
