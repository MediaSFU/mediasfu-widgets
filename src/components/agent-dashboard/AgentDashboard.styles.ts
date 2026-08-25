/**
 * MediaSFU Agent Dashboard Styles (iframe-based)
 */

export const agentDashboardStyles = `
  :host {
    display: block;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  .mediasfu-agent-dashboard {
    position: relative;
    border-radius: 12px;
    overflow: visible;
    width: 100%;
  }

  .light .mediasfu-agent-dashboard {
    background: #f5f5f5;
    border: 1px solid #e5e7eb;
  }

  .dark .mediasfu-agent-dashboard {
    background: #0f0f23;
    border: 1px solid #374151;
  }

  /* Iframe */
  .dashboard-iframe {
    width: 100%;
    border: none;
    border-radius: 12px;
  }

  /* Loading */
  .dashboard-loading {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    background: linear-gradient(135deg, #0f0f23 0%, #1a1a3e 100%);
    color: #ffffff;
  }

  .spinner {
    width: 48px;
    height: 48px;
    border: 4px solid rgba(255, 255, 255, 0.2);
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .dashboard-loading p {
    font-size: 14px;
    opacity: 0.8;
  }

  /* Error */
  .dashboard-error {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px;
    text-align: center;
    background: #0f0f23;
    color: #ff6b6b;
  }

  .dashboard-error .error-icon {
    font-size: 32px;
  }

  .dashboard-error .error-message {
    color: #aaa;
    font-size: 14px;
    max-width: 360px;
  }

  .retry-btn {
    padding: 8px 20px;
    border: 1px solid #3b82f6;
    background: transparent;
    color: #3b82f6;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;
  }

  .retry-btn:hover {
    background: #3b82f6;
    color: #fff;
  }
`;
