/**
 * MediaSFU Call Button Styles
 * Encapsulated CSS for the Call Button Web Component
 */

export const callButtonStyles = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');

  :host {
    display: inline-block;
    font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  /* Container */
  .mediasfu-call-button {
    position: relative;
  }

  .mediasfu-call-button.bottom-right {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 9999;
  }

  .mediasfu-call-button.bottom-left {
    position: fixed;
    bottom: 20px;
    left: 20px;
    z-index: 9999;
  }

  .mediasfu-call-button.floating {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 9999;
  }

  /* Buttons */
  .call-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 24px;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    white-space: nowrap;
    font-family: inherit;
    letter-spacing: 0.2px;
    position: relative;
    overflow: hidden;
  }

  .call-btn::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 50%);
    pointer-events: none;
  }

  .call-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .call-btn .btn-icon {
    flex-shrink: 0;
  }

  /* Primary Button (Light Theme) */
  .light .call-btn.primary {
    background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
    color: #ffffff;
    box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35), 0 1px 3px rgba(0,0,0,0.08);
  }

  .light .call-btn.primary:hover:not(:disabled) {
    background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);
    box-shadow: 0 6px 20px rgba(37, 99, 235, 0.45), 0 2px 4px rgba(0,0,0,0.1);
    transform: translateY(-2px);
  }

  .light .call-btn.primary:active:not(:disabled) {
    transform: translateY(0);
    box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3);
  }

  /* Primary Button (Dark Theme) */
  .dark .call-btn.primary {
    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
    color: #ffffff;
    box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4), 0 0 0 1px rgba(255,255,255,0.05);
  }

  .dark .call-btn.primary:hover:not(:disabled) {
    background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
    box-shadow: 0 6px 20px rgba(59, 130, 246, 0.5), 0 0 0 1px rgba(255,255,255,0.08);
    transform: translateY(-2px);
  }

  /* Secondary Button */
  .call-btn.secondary {
    background: transparent;
    border: 1.5px solid currentColor;
    padding: 10px 22px;
  }

  .call-btn.secondary::before { display: none; }

  .light .call-btn.secondary {
    color: #2563eb;
  }

  .light .call-btn.secondary:hover {
    background: rgba(37, 99, 235, 0.08);
    transform: translateY(-1px);
  }

  .dark .call-btn.secondary {
    color: #60a5fa;
  }

  .dark .call-btn.secondary:hover {
    background: rgba(96, 165, 250, 0.1);
    transform: translateY(-1px);
  }

  /* Danger Button (End Call) */
  .call-btn.danger {
    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    color: #ffffff;
    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.35);
  }

  .call-btn.danger:hover:not(:disabled) {
    background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
    box-shadow: 0 6px 18px rgba(239, 68, 68, 0.45);
    transform: translateY(-1px);
  }

  /* Loading State */
  .call-btn.loading .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid transparent;
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Call Active Container */
  .call-active {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 20px;
    border-radius: 16px;
    min-width: 200px;
    position: relative;
  }

  .light .call-active {
    background: rgba(255,255,255,0.95);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0,0,0,0.04);
  }

  .dark .call-active {
    background: rgba(15,18,36,0.95);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.06);
  }

  /* Call Status */
  .call-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.3px;
  }

  .light .call-status {
    color: #374151;
  }

  .dark .call-status {
    color: #C8D6E5;
  }

  /* Pulse Animation */
  .pulse {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #22c55e;
    animation: pulse 1.5s ease-in-out infinite;
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.4);
  }

  .ringing .pulse {
    background: #f59e0b;
    box-shadow: 0 0 8px rgba(245, 158, 11, 0.4);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(1.3); }
  }

  /* Call Timer */
  .call-timer {
    font-size: 28px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: 1px;
  }

  .light .call-timer {
    color: #111827;
  }

  .dark .call-timer {
    color: #F5F6FA;
  }

  /* Connecting state for timer */
  .call-timer.connecting {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.5px;
    animation: pulse-glow 1.2s ease-in-out infinite;
  }

  .light .call-timer.connecting {
    color: #3b82f6;
  }

  .dark .call-timer.connecting {
    color: #60a5fa;
  }

  @keyframes pulse-glow {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* Call Controls */
  .call-controls {
    display: flex;
    gap: 14px;
    align-items: center;
  }

  .control-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    font-family: inherit;
  }

  .control-btn:hover {
    transform: scale(1.08);
  }

  .control-btn:active {
    transform: scale(0.95);
  }

  .light .control-btn {
    background: #f3f4f6;
    color: #374151;
    box-shadow: 0 2px 6px rgba(0,0,0,0.06);
  }

  .light .control-btn:hover {
    background: #e5e7eb;
    box-shadow: 0 4px 10px rgba(0,0,0,0.1);
  }

  /* Mic muted state - red */
  .light .control-btn.muted {
    background: rgba(239,68,68,0.12);
    color: #dc2626;
    box-shadow: 0 0 0 2px rgba(239,68,68,0.15);
  }

  /* Mic active state - green */
  .light .control-btn.mic-active {
    background: rgba(34,197,94,0.12);
    color: #16a34a;
    box-shadow: 0 0 0 2px rgba(34,197,94,0.15), 0 0 12px rgba(34,197,94,0.2);
  }

  .dark .control-btn {
    background: rgba(255,255,255,0.08);
    color: #C8D6E5;
    border: 1px solid rgba(255,255,255,0.08);
  }

  .dark .control-btn:hover {
    background: rgba(255,255,255,0.12);
    border-color: rgba(255,255,255,0.15);
  }

  /* Mic muted state - red (dark theme) */
  .dark .control-btn.muted {
    background: rgba(239,68,68,0.15);
    color: #fca5a5;
    border-color: rgba(239,68,68,0.25);
  }

  /* Mic active state - green (dark theme) */
  .dark .control-btn.mic-active {
    background: rgba(0,245,160,0.12);
    color: #86efac;
    border-color: rgba(0,245,160,0.25);
    box-shadow: 0 0 12px rgba(0,245,160,0.15);
  }

  .control-btn.end {
    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    color: #ffffff;
    box-shadow: 0 4px 12px rgba(239,68,68,0.3);
    border: none;
  }

  .control-btn.end:hover {
    background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
    box-shadow: 0 6px 16px rgba(239,68,68,0.4);
  }

  /* Error State */
  .call-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 20px;
    border-radius: 16px;
    text-align: center;
  }

  .light .call-error {
    background: rgba(254,242,242,0.95);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(254,202,202,0.5);
    box-shadow: 0 4px 16px rgba(239,68,68,0.08);
  }

  .dark .call-error {
    background: rgba(69,10,10,0.9);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(127,29,29,0.5);
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  }

  .error-icon {
    font-size: 24px;
  }

  .error-message {
    font-size: 13px;
    font-weight: 500;
    line-height: 1.4;
    max-width: 260px;
  }

  .light .error-message {
    color: #dc2626;
  }

  .dark .error-message {
    color: #fca5a5;
  }

  .call-launch {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .call-availability {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #526479;
    font-size: 11px;
    font-weight: 700;
  }

  .dark .call-availability { color: #a9bbce; }

  .call-availability-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #16b981;
    box-shadow: 0 0 0 4px rgba(22, 185, 129, 0.13);
    animation: availability-wave 2.4s ease-out infinite;
  }

  .call-btn:focus-visible {
    outline: 3px solid color-mix(in srgb, var(--primary-color, #3b82f6) 34%, transparent);
    outline-offset: 3px;
  }

  @keyframes availability-wave {
    0%, 45% { box-shadow: 0 0 0 4px rgba(22, 185, 129, 0.13); }
    75%, 100% { box-shadow: 0 0 0 10px rgba(22, 185, 129, 0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .call-availability-dot,
    .status-dot,
    .spinner { animation: none; }
  }

  /* Responsive */
  @media (max-width: 480px) {
    .call-btn {
      padding: 10px 20px;
      font-size: 13px;
    }

    .call-active {
      min-width: 170px;
      padding: 16px;
    }

    .call-timer {
      font-size: 24px;
    }

    .control-btn {
      width: 44px;
      height: 44px;
    }
  }
`;
