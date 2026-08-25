/**
 * MediaSFU Calls Widget Styles
 */

export const callsWidgetStyles = `
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

  .mediasfu-calls {
    position: relative;
    border-radius: 12px;
    overflow: visible;
    width: 100%;
  }

  .light .mediasfu-calls {
    background: #f5f5f5;
    border: 1px solid #e5e7eb;
  }

  .dark .mediasfu-calls {
    background: #0f0f23;
    border: 1px solid #374151;
  }

  /* Iframe */
  .calls-iframe {
    width: 100%;
    border: none;
    border-radius: 12px;
  }

  /* Loading */
  .calls-loading {
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
    border-top-color: #4f8ef7;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .calls-loading p {
    font-size: 14px;
    opacity: 0.8;
  }

  /* Error */
  .calls-error {
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

  .calls-error .error-icon {
    font-size: 32px;
  }

  .calls-error .error-message {
    color: #aaa;
    font-size: 14px;
    max-width: 360px;
  }

  .retry-btn {
    padding: 8px 20px;
    border: 1px solid #4f8ef7;
    background: transparent;
    color: #4f8ef7;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;
  }

  .retry-btn:hover {
    background: #4f8ef7;
    color: #fff;
  }
`;
