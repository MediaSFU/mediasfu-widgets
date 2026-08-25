/**
 * MediaSFU AI Agent Styles (iframe-based)
 */

export const aiAgentStyles = `
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

  .mediasfu-ai-agent {
    position: relative;
    border-radius: 12px;
    overflow: hidden;
    width: 100%;
    height: 100%;
  }

  .mediasfu-ai-agent.light {
    background: #f5f5f5;
    border: 1px solid #e5e7eb;
  }

  .mediasfu-ai-agent.dark {
    background: #0f0f23;
    border: 1px solid #374151;
  }

  /* Iframe */
  .agent-iframe {
    width: 100%;
    height: 100%;
    border: none;
    border-radius: 12px;
  }

  /* Loading */
  .agent-loading {
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
    border-top-color: #8b5cf6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .agent-loading p {
    font-size: 14px;
    opacity: 0.8;
  }

  /* Error */
  .agent-error {
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

  .agent-error .error-icon {
    font-size: 32px;
  }

  .agent-error .error-message {
    color: #aaa;
    font-size: 14px;
    max-width: 360px;
  }

  .retry-btn {
    padding: 8px 24px;
    border: 1px solid #555;
    border-radius: 8px;
    background: transparent;
    color: #fff;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .retry-btn:hover {
    background: rgba(139, 92, 246, 0.2);
    border-color: #8b5cf6;
  }
`;
