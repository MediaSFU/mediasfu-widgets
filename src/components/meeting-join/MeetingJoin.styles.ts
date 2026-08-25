/**
 * MediaSFU Meeting Join Styles
 */

export const meetingJoinStyles = `
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

  .mediasfu-meeting-join {
    max-width: 400px;
    margin: 0 auto;
  }

  /* Form */
  .join-form {
    padding: 24px;
    border-radius: 16px;
  }

  .light .join-form {
    background: #ffffff;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    border: 1px solid #e5e7eb;
  }

  .dark .join-form {
    background: #1f2937;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    border: 1px solid #374151;
  }

  .form-title {
    font-size: 22px;
    font-weight: 600;
    margin-bottom: 20px;
    text-align: center;
  }

  .light .form-title {
    color: #111827;
  }

  .dark .form-title {
    color: #f9fafb;
  }

  /* Tab bar */
  .tab-bar {
    display: flex;
    gap: 0;
    margin-bottom: 18px;
    border-radius: 10px;
    overflow: hidden;
    border: 1px solid;
  }

  .light .tab-bar {
    border-color: #d1d5db;
    background: #f3f4f6;
  }

  .dark .tab-bar {
    border-color: #4b5563;
    background: #374151;
  }

  .tab-btn {
    flex: 1;
    padding: 10px 0;
    border: none;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    background: transparent;
  }

  .light .tab-btn {
    color: #6b7280;
  }

  .dark .tab-btn {
    color: #9ca3af;
  }

  .light .tab-btn:hover {
    color: #374151;
    background: #e5e7eb;
  }

  .dark .tab-btn:hover {
    color: #d1d5db;
    background: #4b5563;
  }

  .tab-btn--active {
    position: relative;
  }

  .light .tab-btn--active {
    color: #2563eb;
    background: #ffffff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }

  .dark .tab-btn--active {
    color: #60a5fa;
    background: #1f2937;
    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
  }

  /* Form row (side-by-side fields) */
  .form-row {
    display: flex;
    gap: 12px;
  }
  .form-group--half {
    flex: 1;
    min-width: 0;
  }

  /* Create settings group */
  .create-settings {
    margin-bottom: 4px;
  }

  /* Mode hint */
  .mode-hint {
    margin-top: 12px;
    font-size: 11px;
    text-align: center;
    line-height: 1.5;
  }

  .light .mode-hint {
    color: #9ca3af;
  }

  .dark .mode-hint {
    color: #6b7280;
  }

  .form-group {
    margin-bottom: 16px;
  }

  .form-group label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    margin-bottom: 6px;
  }

  .light .form-group label {
    color: #374151;
  }

  .dark .form-group label {
    color: #d1d5db;
  }

  .form-input {
    width: 100%;
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid;
    font-size: 14px;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
    outline: none;
  }

  .light .form-input {
    background: #f9fafb;
    border-color: #d1d5db;
    color: #111827;
  }

  .light .form-input:focus {
    border-color: #2563eb;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
  }

  .dark .form-input {
    background: #374151;
    border-color: #4b5563;
    color: #f9fafb;
  }

  .dark .form-input:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
  }

  .room-input-wrapper {
    display: flex;
    align-items: center;
  }

  .room-prefix {
    padding: 12px 14px;
    border-radius: 10px 0 0 10px;
    border: 1px solid;
    border-right: none;
    font-size: 14px;
    font-weight: 500;
  }

  .light .room-prefix {
    background: #e5e7eb;
    border-color: #d1d5db;
    color: #6b7280;
  }

  .dark .room-prefix {
    background: #4b5563;
    border-color: #4b5563;
    color: #9ca3af;
  }

  .room-input-wrapper .form-input {
    border-radius: 0 10px 10px 0;
  }

  /* Buttons */
  .join-btn {
    width: 100%;
    padding: 14px;
    border: none;
    border-radius: 10px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    margin-top: 8px;
  }

  .light .join-btn {
    background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
    color: white;
  }

  .light .join-btn:hover {
    background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);
    transform: translateY(-1px);
  }

  .dark .join-btn {
    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
    color: white;
  }

  .dark .join-btn:hover {
    background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
    transform: translateY(-1px);
  }

  .join-btn.secondary {
    background: transparent;
    border: 2px solid;
  }

  .light .join-btn.secondary {
    color: #2563eb;
    border-color: #2563eb;
  }

  .dark .join-btn.secondary {
    color: #60a5fa;
    border-color: #60a5fa;
  }

  .back-btn {
    padding: 12px 20px;
    border: none;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .light .back-btn {
    background: #f3f4f6;
    color: #374151;
  }

  .light .back-btn:hover {
    background: #e5e7eb;
  }

  .dark .back-btn {
    background: #374151;
    color: #d1d5db;
  }

  .dark .back-btn:hover {
    background: #4b5563;
  }

  /* Preview */
  .preview-container {
    padding: 24px;
    border-radius: 16px;
  }

  .light .preview-container {
    background: #ffffff;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    border: 1px solid #e5e7eb;
  }

  .dark .preview-container {
    background: #1f2937;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    border: 1px solid #374151;
  }

  .video-preview {
    position: relative;
    width: 100%;
    aspect-ratio: 4/3;
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 16px;
  }

  .light .video-preview {
    background: #111827;
  }

  .dark .video-preview {
    background: #000000;
  }

  .preview-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .preview-placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: #9ca3af;
    font-size: 14px;
  }

  .preview-placeholder span:first-child {
    font-size: 32px;
  }

  .placeholder-spinner {
    width: 28px;
    height: 28px;
    border: 3px solid rgba(156,163,175,0.3);
    border-top-color: #9ca3af;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: inline-block;
  }

  /* Preview title */
  .preview-title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 12px;
  }
  .light .preview-title { color: #111827; }
  .dark .preview-title { color: #f9fafb; }

  /* Device selectors */
  .device-selectors {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }

  .device-group {
    flex: 1;
    min-width: 0;
  }

  .device-group label {
    display: block;
    font-size: 11px;
    font-weight: 500;
    margin-bottom: 4px;
  }

  .light .device-group label { color: #374151; }
  .dark .device-group label { color: #d1d5db; }

  .device-select {
    width: 100%;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid;
    font-size: 12px;
    outline: none;
    cursor: pointer;
    appearance: auto;
  }

  .light .device-select {
    background: #f9fafb;
    border-color: #d1d5db;
    color: #111827;
  }

  .dark .device-select {
    background: #374151;
    border-color: #4b5563;
    color: #f9fafb;
  }

  .dark .device-select option {
    background: #1a1a2e;
    color: #f9fafb;
  }

  /* Mic level meter */
  .mic-level-container {
    margin-bottom: 10px;
  }

  .mic-level-container label {
    display: block;
    font-size: 11px;
    font-weight: 500;
    margin-bottom: 4px;
  }

  .light .mic-level-container label { color: #374151; }
  .dark .mic-level-container label { color: #d1d5db; }

  .mic-level-track {
    width: 100%;
    height: 6px;
    border-radius: 3px;
    overflow: hidden;
  }

  .light .mic-level-track { background: #e5e7eb; }
  .dark .mic-level-track { background: #374151; }

  .mic-level-fill {
    height: 100%;
    width: 0%;
    border-radius: 3px;
    background: linear-gradient(90deg, #22c55e 0%, #facc15 60%, #ef4444 100%);
    transition: width 0.08s linear;
  }

  /* Mic test button */
  .mic-test-btn {
    width: 100%;
    padding: 8px 12px;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    margin-bottom: 12px;
    transition: all 0.2s ease;
  }

  .light .mic-test-btn {
    background: #f3f4f6;
    color: #374151;
  }
  .light .mic-test-btn:hover {
    background: #e5e7eb;
  }

  .dark .mic-test-btn {
    background: #374151;
    color: #d1d5db;
  }
  .dark .mic-test-btn:hover {
    background: #4b5563;
  }

  .mic-test-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .preview-info {
    margin-bottom: 16px;
    padding: 12px;
    border-radius: 8px;
  }

  .light .preview-info {
    background: #f3f4f6;
  }

  .dark .preview-info {
    background: #374151;
  }

  .preview-info p {
    font-size: 13px;
    margin-bottom: 4px;
  }

  .light .preview-info p {
    color: #374151;
  }

  .dark .preview-info p {
    color: #d1d5db;
  }

  .preview-controls {
    display: flex;
    justify-content: center;
    gap: 12px;
    margin-bottom: 16px;
  }

  .control-btn {
    width: 50px;
    height: 50px;
    border: none;
    border-radius: 50%;
    font-size: 20px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .light .control-btn {
    background: #f3f4f6;
  }

  .light .control-btn:hover {
    background: #e5e7eb;
  }

  .dark .control-btn {
    background: #374151;
  }

  .dark .control-btn:hover {
    background: #4b5563;
  }

  .preview-actions {
    display: flex;
    gap: 12px;
  }

  .preview-actions .join-btn {
    flex: 1;
    margin-top: 0;
  }

  /* Joining */
  .joining-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 48px;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(0, 0, 0, 0.1);
    border-top-color: #2563eb;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .dark .spinner {
    border-color: rgba(255, 255, 255, 0.1);
    border-top-color: #60a5fa;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .light .joining-container p {
    color: #374151;
  }

  .dark .joining-container p {
    color: #d1d5db;
  }

  /* Error */
  .error-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 32px;
    border-radius: 16px;
    text-align: center;
  }

  .light .error-container {
    background: #fef2f2;
    border: 1px solid #fecaca;
  }

  .dark .error-container {
    background: #450a0a;
    border: 1px solid #7f1d1d;
  }

  .error-icon {
    font-size: 32px;
  }

  .error-message {
    font-size: 14px;
  }

  .light .error-message {
    color: #dc2626;
  }

  .dark .error-message {
    color: #fca5a5;
  }

  .field-hint {
    display: block;
    font-size: 11px;
    margin-top: 2px;
  }
  .light .field-hint { color: #6b7280; }
  .dark  .field-hint { color: #9ca3af; }

  /* ── Code-gate (Create tab authorization) ── */
  .code-gate {
    text-align: center;
    padding: 16px 0 8px;
  }
  .code-gate-icon {
    font-size: 40px;
    margin-bottom: 10px;
  }
  .code-gate-msg {
    font-size: 14px;
    line-height: 1.5;
    margin: 8px 0 0;
  }
  .light .code-gate-msg { color: #6b7280; }
  .dark  .code-gate-msg { color: #9ca3af; }
  .code-gate .form-group { text-align: left; }
  .code-gate .join-btn {
    margin-top: 12px;
    width: 100%;
  }

  .code-verified {
    font-size: 13px;
    text-align: center;
    margin: 0 0 8px;
    padding: 6px 10px;
    border-radius: 8px;
  }
  .light .code-verified { color: #059669; background: #ecfdf5; }
  .dark  .code-verified { color: #34d399; background: rgba(52,211,153,0.1); }

  .tab-btn:focus-visible,
  .join-btn:focus-visible,
  .back-btn:focus-visible,
  .mic-test-btn:focus-visible,
  .control-btn:focus-visible,
  .form-input:focus-visible,
  .device-select:focus-visible {
    outline: 3px solid color-mix(in srgb, #38bdf8 58%, transparent);
    outline-offset: 2px;
  }

  .tab-btn,
  .join-btn,
  .back-btn,
  .mic-test-btn,
  .control-btn {
    touch-action: manipulation;
  }

  .join-btn:not(:disabled):active,
  .back-btn:not(:disabled):active,
  .control-btn:not(:disabled):active {
    transform: translateY(1px);
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner,
    .placeholder-spinner {
      animation-duration: 1.8s;
    }

    .tab-btn,
    .join-btn,
    .back-btn,
    .mic-test-btn,
    .control-btn {
      transition: none;
    }
  }

  /* Responsive */
  @media (max-width: 440px) {
    .mediasfu-meeting-join {
      max-width: 100%;
    }

    .join-form,
    .preview-container {
      padding: 18px;
      border-radius: 12px;
    }

    .form-row,
    .device-selectors,
    .preview-actions {
      flex-direction: column;
    }

    .form-group--half {
      width: 100%;
    }

    .tab-btn,
    .join-btn,
    .back-btn,
    .mic-test-btn {
      min-height: 44px;
    }

    .preview-actions .join-btn,
    .preview-actions .back-btn {
      width: 100%;
    }
  }
`;
