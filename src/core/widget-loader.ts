/**
 * MediaSFU Widget Loader
 * Scans DOM for widget elements and initializes them
 * Supports multiple platforms: generic HTML, WordPress, Shopify, React, Vue, Angular, etc.
 */

import type { WidgetConfig, WidgetType, WidgetInstance } from '../types';
import { MediaSFUCallButton } from '../components/call-button/CallButton';
import { MediaSFUAIAgent } from '../components/ai-agent/AIAgent';
import { MediaSFUMeetingJoin } from '../components/meeting-join/MeetingJoin';
import { MediaSFUCalls } from '../components/calls-widget/CallsWidget';
import { MediaSFUWebAgent } from '../components/web-agent/WebAgent';
import { MediaSFUAgentDashboard } from '../components/agent-dashboard/AgentDashboard';
import { getConfig as getConfigFromStore, setConfig as setConfigInStore } from './config-store';
import { getApiUrl, getCdnUrl } from './environments';

// Platform detection types
export type Platform =
  | 'generic'
  | 'wordpress'
  | 'shopify'
  | 'wix'
  | 'squarespace'
  | 'webflow'
  | 'react'
  | 'vue'
  | 'angular'
  | 'nextjs'
  | 'nuxt';

// Local state
let detectedPlatform: Platform = 'generic';
const widgetInstances: Map<string, WidgetInstance> = new Map();

/**
 * Detect the current platform/environment
 */
function detectPlatform(): Platform {
  if (typeof window === 'undefined') {
    return 'generic';
  }

  const w = window as any;

  // WordPress detection
  if (w.wp || document.body.classList.contains('wp-admin') ||
      document.querySelector('meta[name="generator"][content*="WordPress"]')) {
    return 'wordpress';
  }

  // Shopify detection
  if (w.Shopify || document.querySelector('meta[name="shopify-checkout-api-token"]') ||
      window.location.hostname.includes('.myshopify.com')) {
    return 'shopify';
  }

  // Wix detection
  if (w.wixBiSession || w.WixCodeApi || document.querySelector('[data-mesh-id]')) {
    return 'wix';
  }

  // Squarespace detection
  if (w.Static || document.querySelector('[data-squarespace-cacheversion]') ||
      document.body.id?.includes('squarespace')) {
    return 'squarespace';
  }

  // Webflow detection
  if (w.Webflow || document.querySelector('[data-wf-page]')) {
    return 'webflow';
  }

  // React detection (without server components)
  if (w.__REACT_DEVTOOLS_GLOBAL_HOOK__ || document.querySelector('[data-reactroot]')) {
    // Check if it's Next.js
    if (w.__NEXT_DATA__ || document.querySelector('script[id="__NEXT_DATA__"]')) {
      return 'nextjs';
    }
    return 'react';
  }

  // Vue detection
  if (w.__VUE__ || w.__VUE_DEVTOOLS_GLOBAL_HOOK__) {
    // Check if it's Nuxt
    if (w.__NUXT__ || document.querySelector('script[id="__NUXT_DATA__"]')) {
      return 'nuxt';
    }
    return 'vue';
  }

  // Angular detection
  if (w.ng || w.getAllAngularRootElements || document.querySelector('[ng-version]')) {
    return 'angular';
  }

  return 'generic';
}

/**
 * Get platform-specific configuration adjustments
 */
function getPlatformConfig(platform: Platform): Partial<WidgetConfig> {
  switch (platform) {
    case 'wordpress':
      return {
        // WordPress often has aggressive caching, use timestamp
        cacheBuster: true,
        // Avoid conflicts with WordPress scripts
        isolateStyles: true,
      };

    case 'shopify':
      return {
        // Shopify liquid templates may need deferred loading
        deferLoad: true,
        // Track conversions for e-commerce
        enableAnalytics: true,
      };

    case 'wix':
    case 'squarespace':
    case 'webflow':
      return {
        // These builders inject their own styles
        isolateStyles: true,
        // Wait for builder to finish rendering
        deferLoad: true,
      };

    case 'react':
    case 'vue':
    case 'angular':
    case 'nextjs':
    case 'nuxt':
      return {
        // SPA frameworks handle their own lifecycle
        autoInit: false,
        // Use framework-specific event handling
        useCustomEvents: true,
      };

    default:
      return {};
  }
}

/**
 * Get the detected platform
 */
export function getPlatform(): Platform {
  return detectedPlatform;
}

// Widget element tag names
const WIDGET_TAGS: Record<WidgetType, string> = {
  'call-button': 'mediasfu-call-button',
  'click-to-call': 'mediasfu-call-button', // Alias for call-button
  'ai-agent': 'mediasfu-ai-agent',
  'meeting-join': 'mediasfu-meeting-join',
  'calls': 'mediasfu-calls',
  'web-agent-embed': 'mediasfu-web-agent',
  'web-agent-dashboard': 'mediasfu-agent-dashboard',
};

// Widget class constructors
const WIDGET_CLASSES: Record<WidgetType, typeof HTMLElement> = {
  'call-button': MediaSFUCallButton,
  'click-to-call': MediaSFUCallButton, // Alias for call-button
  'ai-agent': MediaSFUAIAgent,
  'meeting-join': MediaSFUMeetingJoin,
  'calls': MediaSFUCalls,
  'web-agent-embed': MediaSFUWebAgent,
  'web-agent-dashboard': MediaSFUAgentDashboard,
};

/**
 * Initialize MediaSFU widgets with global configuration
 */
export function init(config: WidgetConfig): void {
  // Detect platform first
  detectedPlatform = detectPlatform();
  const platformConfig = getPlatformConfig(detectedPlatform);

  const mergedConfig: WidgetConfig = {
    apiUrl: getApiUrl(),       // Auto-detect from environment
    cdnUrl: getCdnUrl(),       // Auto-detect from environment
    debug: false,
    platform: detectedPlatform,
    ...platformConfig,
    ...config, // User config overrides platform defaults
  };

  // Store in shared config store
  setConfigInStore(mergedConfig);

  if (mergedConfig.debug) {
    console.log('[MediaSFU] Detected platform:', detectedPlatform);
    console.log('[MediaSFU] Initialized with config:', mergedConfig);
  }

  // Register custom elements if not already registered
  registerCustomElements();

  // Apply platform-specific initializations
  applyPlatformInit(detectedPlatform);

  // Notify ready
  if (mergedConfig.onReady) {
    mergedConfig.onReady();
  }
}

/**
 * Apply platform-specific initialization logic
 */
function applyPlatformInit(platform: Platform): void {
  switch (platform) {
    case 'wordpress':
      // WordPress: Hook into wp.domReady if available
      if (typeof (window as any).wp?.domReady === 'function') {
        (window as any).wp.domReady(() => autoInit());
      }
      break;

    case 'shopify':
      // Shopify: Wait for Shopify to be ready
      if (typeof (window as any).Shopify?.Checkout?.step === 'function') {
        document.addEventListener('page:load', () => autoInit());
      }
      break;

    case 'wix':
      // Wix: Use $w.onReady if in Wix context
      if (typeof (window as any).$w?.onReady === 'function') {
        (window as any).$w.onReady(() => autoInit());
      }
      break;

    case 'react':
    case 'vue':
    case 'angular':
    case 'nextjs':
    case 'nuxt':
      // SPA frameworks: Components handle their own lifecycle
      // Just ensure custom elements are registered
      break;

    default:
      // Generic: Use MutationObserver for dynamic content
      observeDOMChanges();
      break;
  }
}

/**
 * Observe DOM for dynamically added widget elements
 */
function observeDOMChanges(): void {
  if (typeof MutationObserver === 'undefined') return;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) {
          // Check if it's a MediaSFU widget
          const tagName = node.tagName.toLowerCase();
          if (tagName.startsWith('mediasfu-')) {
            if (getConfigFromStore()?.debug) {
              console.log(`[MediaSFU] Dynamic widget detected: <${tagName}>`);
            }
          }
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

/**
 * Register all custom elements (Web Components)
 */
function registerCustomElements(): void {
  for (const [type, tagName] of Object.entries(WIDGET_TAGS)) {
    if (!customElements.get(tagName)) {
      const WidgetClass = WIDGET_CLASSES[type as WidgetType];
      customElements.define(tagName, WidgetClass);

      if (getConfigFromStore()?.debug) {
        console.log(`[MediaSFU] Registered custom element: <${tagName}>`);
      }
    }
  }
}

/**
 * Create a widget programmatically
 */
export function createWidget(
  type: WidgetType,
  config: Record<string, unknown> & { container?: string | HTMLElement }
): WidgetInstance {
  const { container, ...widgetConfig } = config;

  // Get or create container element
  let containerEl: HTMLElement;
  if (typeof container === 'string') {
    containerEl = document.querySelector(container) as HTMLElement;
    if (!containerEl) {
      throw new Error(`Container element not found: ${container}`);
    }
  } else if (container instanceof HTMLElement) {
    containerEl = container;
  } else {
    throw new Error('Container must be a selector string or HTMLElement');
  }

  // Create widget element
  const tagName = WIDGET_TAGS[type];
  const widgetEl = document.createElement(tagName);

  // Set attributes from config
  for (const [key, value] of Object.entries(widgetConfig)) {
    if (value !== undefined && value !== null) {
      // Convert camelCase to kebab-case for HTML attributes
      const attrName = key.replace(/([A-Z])/g, '-$1').toLowerCase();
      widgetEl.setAttribute(attrName, String(value));
    }
  }

  // Set global widget key if not provided
  const currentConfig = getConfigFromStore();
  if (!widgetEl.hasAttribute('widget-key') && currentConfig?.widgetKey) {
    widgetEl.setAttribute('widget-key', currentConfig.widgetKey);
  }

  // Append to container
  containerEl.appendChild(widgetEl);

  // Create instance wrapper
  const instanceId = `widget-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // Store wrapped listeners for proper removal
  const listenerMap = new Map<string, Map<(data: unknown) => void, EventListener>>();

  const instance: WidgetInstance = {
    id: instanceId,
    type,
    element: widgetEl,
    state: 'loading',
    destroy: () => {
      widgetEl.remove();
      listenerMap.clear();
      widgetInstances.delete(instanceId);
    },
    on: (event: string, handler: (data: unknown) => void) => {
      const wrapped = ((e: CustomEvent) => handler(e.detail)) as EventListener;
      if (!listenerMap.has(event)) listenerMap.set(event, new Map());
      listenerMap.get(event)!.set(handler, wrapped);
      widgetEl.addEventListener(event, wrapped);
    },
    off: (event: string, handler?: (data: unknown) => void) => {
      if (handler) {
        const wrapped = listenerMap.get(event)?.get(handler);
        if (wrapped) {
          widgetEl.removeEventListener(event, wrapped);
          listenerMap.get(event)!.delete(handler);
        }
      }
    },
  };

  widgetInstances.set(instanceId, instance);

  return instance;
}

/**
 * Auto-initialize widgets when DOM is ready
 * Scans for mediasfu-* elements and registers custom elements
 */
export function autoInit(): void {
  const config = getConfigFromStore();
  if (config?.debug) {
    console.log('[MediaSFU] Auto-initializing widgets...');
  }

  // Register custom elements
  registerCustomElements();

  // Find all MediaSFU widget elements
  for (const tagName of Object.values(WIDGET_TAGS)) {
    const elements = document.querySelectorAll(tagName);
    if (config?.debug && elements.length > 0) {
      console.log(`[MediaSFU] Found ${elements.length} <${tagName}> element(s)`);
    }
  }
}

/**
 * Get global configuration
 */
export function getConfig(): WidgetConfig | null {
  return getConfigFromStore();
}

/**
 * Get all widget instances
 */
export function getInstances(): Map<string, WidgetInstance> {
  return widgetInstances;
}

/**
 * Main MediaSFU Widget object exposed globally
 */
export const MediaSFUWidget = {
  init,
  createWidget,
  getConfig,
  getInstances,
  getPlatform,
  VERSION: '0.1.0',
};

// Expose to window for script tag usage
if (typeof window !== 'undefined') {
  (window as unknown as { MediaSFU: typeof MediaSFUWidget }).MediaSFU = MediaSFUWidget;

  // Auto-detect platform on load
  detectedPlatform = detectPlatform();

  // Auto-initialize when DOM is ready (for script tag usage)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Only auto-init if init() hasn't been called yet
      if (!getConfigFromStore()) {
        autoInit();
      }
    });
  } else {
    // DOM already ready
    if (!getConfigFromStore()) {
      autoInit();
    }
  }
}
