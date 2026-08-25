/**
 * Widget HTTP Client
 *
 * Adapted from voipsrc/src/services/httpClient.ts for widget (iframe) context.
 *
 * Auth modes:
 *  1. Initial: JWT session token (for validate-session only)
 *  2. Post-auth: apiUserName:apiKey credentials (for all /v1/sipcall/* calls)
 *
 * Once setCredentials() is called the client switches to credential auth,
 * which is what the standard /v1/sipcall/* endpoints expect.
 */

import { ApiResponse } from '../types/api.types';

export class WidgetHttpClient {
  private baseUrl: string;
  private sessionToken: string;
  private apiUserName: string = '';
  private apiKey: string = '';
  private operatorGrant: string = '';

  constructor(baseUrl: string, sessionToken: string, operatorGrant = '') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.sessionToken = sessionToken;
    this.setOperatorGrant(operatorGrant);
  }

  /** Update the session token (e.g., after refresh) */
  setSessionToken(token: string): void {
    this.sessionToken = token;
  }

  /** Activate Studio-scoped auth. This always clears broad account credentials. */
  setOperatorGrant(operatorGrant: string): void {
    this.operatorGrant = String(operatorGrant || '').trim();
    if (this.operatorGrant) {
      this.apiUserName = '';
      this.apiKey = '';
    }
  }

  /** Switch to credential-based auth after legacy widget session validation. */
  setCredentials(apiUserName: string, apiKey: string): void {
    if (this.hasOperatorGrant) return;
    this.apiUserName = apiUserName;
    this.apiKey = apiKey;
  }

  get hasOperatorGrant(): boolean {
    return Boolean(this.operatorGrant);
  }

  /** Whether legacy credential-based auth is active. */
  get hasCredentials(): boolean {
    return !this.hasOperatorGrant && !!(this.apiUserName && this.apiKey);
  }

  /** Update the base URL */
  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/$/, '');
  }

  private async request<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    data?: any
  ): Promise<ApiResponse<T>> {
    try {
      const url = `${this.baseUrl}${path}`;

      // Studio grants are exclusive: never exchange or fall back to account credentials.
      const authValue = this.hasOperatorGrant
        ? `Bearer ${this.operatorGrant}`
        : this.hasCredentials
        ? `Bearer ${this.apiUserName}:${this.apiKey}`
        : `Bearer ${this.sessionToken}`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': authValue,
      };

      const opts: RequestInit = { method, headers };
      if (data && (method === 'POST' || method === 'PUT')) {
        opts.body = JSON.stringify(data);
      }

      const response = await fetch(url, opts);

      if (response.status === 401) {
        // Notify parent of auth error
        window.parent?.postMessage(
          { type: 'mediasfu:authError', payload: { reason: 'session_expired' } },
          '*'
        );
        return { success: false, error: 'Session expired', status: 401 };
      }

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        return {
          success: false,
          error: body.error || body.message || `HTTP ${response.status}`,
          status: response.status,
        };
      }

      return { success: true, data: body as T, status: response.status };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Network request failed',
        status: 0,
      };
    }
  }

  async get<T = any>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path);
  }

  async post<T = any>(path: string, data?: any): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, data);
  }

  async put<T = any>(path: string, data?: any): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', path, data);
  }

  async delete<T = any>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path);
  }
}
