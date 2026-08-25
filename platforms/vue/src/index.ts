/**
 * MediaSFU Widgets Vue Components
 *
 * Vue 3 wrapper components for MediaSFU embeddable widgets.
 */

import {
  defineComponent,
  h,
  ref,
  onMounted,
  onUnmounted,
  watch,
  inject,
  provide,
  type PropType,
  type Ref,
} from 'vue';

// ============================================================================
// Types
// ============================================================================

export type WidgetTheme = 'light' | 'dark' | 'auto';
export type WidgetPosition = 'inline' | 'bottom-right' | 'bottom-left' | 'floating';
export type AgentMode = 'voice' | 'chat' | 'both';

// ============================================================================
// Script Loader
// ============================================================================

const WIDGET_SCRIPT_URL = 'https://cdn.mediasfu.com/widget.js';
let scriptLoaded = false;
let scriptLoading = false;
const loadCallbacks: (() => void)[] = [];

function loadWidgetScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (scriptLoaded) {
      resolve();
      return;
    }

    if (scriptLoading) {
      loadCallbacks.push(resolve);
      return;
    }

    scriptLoading = true;

    const script = document.createElement('script');
    script.src = WIDGET_SCRIPT_URL;
    script.async = true;

    script.onload = () => {
      scriptLoaded = true;
      scriptLoading = false;
      resolve();
      loadCallbacks.forEach(cb => cb());
      loadCallbacks.length = 0;
    };

    script.onerror = () => {
      scriptLoading = false;
      reject(new Error('Failed to load MediaSFU widget script'));
    };

    document.head.appendChild(script);
  });
}

// ============================================================================
// Composable
// ============================================================================

export function useMediaSFUWidget(widgetKey: Ref<string>) {
  const elementRef = ref<HTMLElement | null>(null);

  const findWidget = () => {
    if (!elementRef.value) {
      elementRef.value = document.querySelector(`[widget-key="${widgetKey.value}"]`);
    }
    return elementRef.value;
  };

  const call = (destination: string) => {
    const element = findWidget();
    if (element && 'call' in element) {
      (element as any).call(destination);
    }
  };

  const hangup = () => {
    const element = findWidget();
    if (element && 'hangup' in element) {
      (element as any).hangup();
    }
  };

  const mute = (muted: boolean) => {
    const element = findWidget();
    if (element && 'mute' in element) {
      (element as any).mute(muted);
    }
  };

  const setTheme = (theme: WidgetTheme) => {
    const element = findWidget();
    if (element) {
      element.setAttribute('theme', theme);
    }
  };

  return {
    elementRef,
    call,
    hangup,
    mute,
    setTheme,
  };
}

// ============================================================================
// Components
// ============================================================================

/**
 * Call Button Widget
 */
export const CallButton = defineComponent({
  name: 'MediaSFUCallButton',
  props: {
    widgetKey: { type: String, required: true },
    destination: { type: String, required: true },
    buttonText: { type: String, default: 'Call Now' },
    buttonIcon: { type: String },
    theme: { type: String as PropType<WidgetTheme>, default: 'light' },
    position: { type: String as PropType<WidgetPosition>, default: 'inline' },
  },
  emits: ['ready', 'error', 'call-start', 'call-end', 'connect', 'disconnect'],
  setup(props, { emit }) {
    const elementRef = ref<HTMLElement | null>(null);

    onMounted(async () => {
      try {
        await loadWidgetScript();
        emit('ready');
      } catch (error) {
        emit('error', error);
      }

      const el = elementRef.value;
      if (el) {
        el.addEventListener('mediasfu:call-start', () => emit('call-start'));
        el.addEventListener('mediasfu:call-end', () => emit('call-end'));
        el.addEventListener('mediasfu:connect', () => emit('connect'));
        el.addEventListener('mediasfu:disconnect', () => emit('disconnect'));
      }
    });

    return () => h('mediasfu-call-button', {
      ref: elementRef,
      'widget-key': props.widgetKey,
      destination: props.destination,
      'button-text': props.buttonText,
      'button-icon': props.buttonIcon,
      theme: props.theme,
      position: props.position,
    });
  },
});

/**
 * AI Agent Widget
 */
export const AIAgent = defineComponent({
  name: 'MediaSFUAIAgent',
  props: {
    widgetKey: { type: String, required: true },
    agentName: { type: String },
    greeting: { type: String },
    mode: { type: String as PropType<AgentMode>, default: 'voice' },
    systemPrompt: { type: String },
    voice: { type: String },
    theme: { type: String as PropType<WidgetTheme>, default: 'light' },
    position: { type: String as PropType<WidgetPosition>, default: 'inline' },
  },
  emits: ['ready', 'error', 'message', 'connect', 'disconnect'],
  setup(props, { emit }) {
    const elementRef = ref<HTMLElement | null>(null);

    onMounted(async () => {
      try {
        await loadWidgetScript();
        emit('ready');
      } catch (error) {
        emit('error', error);
      }

      const el = elementRef.value;
      if (el) {
        el.addEventListener('mediasfu:message', ((e: CustomEvent) => {
          emit('message', e.detail);
        }) as EventListener);
        el.addEventListener('mediasfu:connect', () => emit('connect'));
        el.addEventListener('mediasfu:disconnect', () => emit('disconnect'));
      }
    });

    return () => h('mediasfu-ai-agent', {
      ref: elementRef,
      'widget-key': props.widgetKey,
      'agent-name': props.agentName,
      greeting: props.greeting,
      mode: props.mode,
      'system-prompt': props.systemPrompt,
      voice: props.voice,
      theme: props.theme,
      position: props.position,
    });
  },
});

/**
 * Meeting Join Widget
 */
export const MeetingJoin = defineComponent({
  name: 'MediaSFUMeetingJoin',
  props: {
    widgetKey: { type: String, required: true },
    roomPrefix: { type: String },
    showPreview: { type: Boolean, default: true },
    requireName: { type: Boolean, default: true },
    requireEmail: { type: Boolean, default: false },
    defaultName: { type: String },
    defaultEmail: { type: String },
    theme: { type: String as PropType<WidgetTheme>, default: 'light' },
  },
  emits: ['ready', 'error', 'join'],
  setup(props, { emit }) {
    const elementRef = ref<HTMLElement | null>(null);

    onMounted(async () => {
      try {
        await loadWidgetScript();
        emit('ready');
      } catch (error) {
        emit('error', error);
      }

      const el = elementRef.value;
      if (el) {
        el.addEventListener('mediasfu:join', ((e: CustomEvent) => {
          emit('join', e.detail);
        }) as EventListener);
      }
    });

    return () => h('mediasfu-meeting-join', {
      ref: elementRef,
      'widget-key': props.widgetKey,
      'room-prefix': props.roomPrefix,
      'show-preview': props.showPreview,
      'require-name': props.requireName,
      'require-email': props.requireEmail,
      'default-name': props.defaultName,
      'default-email': props.defaultEmail,
      theme: props.theme,
    });
  },
});

/**
 * Meeting Room Widget
 */
export const MeetingRoom = defineComponent({
  name: 'MediaSFUMeetingRoom',
  props: {
    widgetKey: { type: String, required: true },
    roomName: { type: String },
    userName: { type: String },
    userEmail: { type: String },
    width: { type: [String, Number], default: '100%' },
    height: { type: [String, Number], default: '600px' },
    features: { type: Array as PropType<string[]> },
    theme: { type: String as PropType<WidgetTheme>, default: 'light' },
  },
  emits: ['ready', 'error', 'participant-join', 'participant-leave'],
  setup(props, { emit }) {
    const elementRef = ref<HTMLElement | null>(null);

    onMounted(async () => {
      try {
        await loadWidgetScript();
        emit('ready');
      } catch (error) {
        emit('error', error);
      }

      const el = elementRef.value;
      if (el) {
        el.addEventListener('mediasfu:participant-join', ((e: CustomEvent) => {
          emit('participant-join', e.detail);
        }) as EventListener);
        el.addEventListener('mediasfu:participant-leave', ((e: CustomEvent) => {
          emit('participant-leave', e.detail);
        }) as EventListener);
      }
    });

    const widthStyle = typeof props.width === 'number' ? `${props.width}px` : props.width;
    const heightStyle = typeof props.height === 'number' ? `${props.height}px` : props.height;

    return () => h('mediasfu-meeting-room', {
      ref: elementRef,
      'widget-key': props.widgetKey,
      'room-name': props.roomName,
      'user-name': props.userName,
      'user-email': props.userEmail,
      features: props.features?.join(','),
      theme: props.theme,
      style: { width: widthStyle, height: heightStyle },
    });
  },
});

/**
 * SIP Phone Widget
 */
export const SIPPhone = defineComponent({
  name: 'MediaSFUSIPPhone',
  props: {
    widgetKey: { type: String, required: true },
    autoRegister: { type: Boolean, default: true },
    defaultNumber: { type: String },
    theme: { type: String as PropType<WidgetTheme>, default: 'light' },
    position: { type: String as PropType<WidgetPosition>, default: 'bottom-right' },
  },
  emits: ['ready', 'error', 'register', 'incoming-call'],
  setup(props, { emit }) {
    const elementRef = ref<HTMLElement | null>(null);

    onMounted(async () => {
      try {
        await loadWidgetScript();
        emit('ready');
      } catch (error) {
        emit('error', error);
      }

      const el = elementRef.value;
      if (el) {
        el.addEventListener('mediasfu:register', () => emit('register'));
        el.addEventListener('mediasfu:incoming-call', ((e: CustomEvent) => {
          emit('incoming-call', e.detail.caller);
        }) as EventListener);
      }
    });

    return () => h('mediasfu-sip-phone', {
      ref: elementRef,
      'widget-key': props.widgetKey,
      'auto-register': props.autoRegister,
      'default-number': props.defaultNumber,
      theme: props.theme,
      position: props.position,
    });
  },
});

// ============================================================================
// Plugin
// ============================================================================

export const MediaSFUPlugin = {
  install(app: any) {
    app.component('MediaSFUCallButton', CallButton);
    app.component('MediaSFUAIAgent', AIAgent);
    app.component('MediaSFUMeetingJoin', MeetingJoin);
    app.component('MediaSFUMeetingRoom', MeetingRoom);
    app.component('MediaSFUSIPPhone', SIPPhone);

    // Load script on install
    loadWidgetScript();
  },
};

// ============================================================================
// Exports
// ============================================================================

export default {
  CallButton,
  AIAgent,
  MeetingJoin,
  MeetingRoom,
  SIPPhone,
  MediaSFUPlugin,
  useMediaSFUWidget,
};
