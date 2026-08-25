import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
// Router removed for widget iframe context
import { useCallManager, useCallHistory } from "../../hooks";
import { useWidgetConfig } from "../../hooks/useWidgetConfig";
import { useOutgoingCallRoomManager } from "../../hooks/useOutgoingCallRoomManager";
import { SIPConfig, Call } from "../../types/call.types";
// callService now comes from useWidgetConfig context
import LoadingSpinner from "../Common/LoadingSpinner";
import { startVisibleInterval } from "../../utils/visibleInterval";
import {
  getAuthoritativeCallRoomName,
  isActiveCallRecord,
  type ActiveCallIdentity,
} from "../../services/activeCallIdentity";
import { createActiveCallsPublisher } from "../../services/activeCallsPublication";

import MediaSFURoomDisplay from "../MediaSFU/MediaSFURoomDisplay";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faMicrophone, faMicrophoneSlash, faPhone, faPhoneSlash, faArrowDown, faArrowUp,
  faCircle, faCircleCheck, faMusic, faRobot, faUser, faHeadset, faPause, faPlay,
  faBullseye, faChevronDown, faChevronRight, faChevronUp, faBell, faBuilding,
  faLink, faSatelliteDish, faCheck, faSpinner, faMobileAlt, faXmark, faPhoneVolume,
  faTrash, faClipboardList, faChartBar, faStar, faCloud, faComment
} from '@fortawesome/free-solid-svg-icons';
import NotificationModal from "../Common/NotificationModal";
import ConfirmationModal from "../Common/ConfirmationModal";
import { callLogger, roomLogger } from "../../utils/logger";
import {
  parseSipCaller,
  getCallerDisplayString,
  extractCleanIdentifier,
} from "../../utils/sipCallerParser";
import { parsePhoneNumber, isValidPhoneNumber, AsYouType } from "libphonenumber-js";
import "./CallsPage.css";
import "./CallsPagePremium.css";
import "./CallFlowSteps.css";
import CallsTooltips from "./CallsTooltips";

/**
 * Gives a non-<button> element the keyboard behaviour of a button.
 *
 * The expandable call and history headers are divs because they carry layout
 * the default button styling would fight. Rather than change the element — and
 * with it the visuals — we attach the semantics a button would have provided:
 * activation on Enter and Space. Pair it with role="button" and tabIndex={0}.
 */
const buttonKeys =
  (handler: () => void) => (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handler();
    }
  };

// System SIP dummy number — backend detects this sentinel and resolves the real number
const SYSTEM_SIP_DUMMY_NUMBER = '+10000000000';

/**
 * Display-friendly FROM identifier. For system SIP (shared MediaSFU number) calls,
 * shows "MediaSFU Number" instead of the raw obfuscated SIP URI.
 */
const getFromDisplay = (callerIdRaw: string, isSystemSip: boolean): string => {
  if (!callerIdRaw) return 'Unknown';
  // System SIP sentinel from frontend state
  if (callerIdRaw === '__system_sip__' || isSystemSip) {
    return 'MediaSFU Number';
  }
  // Detect heavily obfuscated numbers (mostly X's from server-side obfuscation)
  const cleaned = extractCleanIdentifier(callerIdRaw);
  const xCount = (cleaned.match(/X/gi) || []).length;
  const nonXDigits = (cleaned.replace(/[^0-9]/g, '') || '').length;
  if (xCount > 4 && xCount > nonXDigits) {
    // More X's than digits — show short version instead
    const lastDigits = cleaned.replace(/[^0-9]/g, '').slice(-2);
    return lastDigits ? `MediaSFU (***${lastDigits})` : 'MediaSFU Number';
  }
  return cleaned;
};

// Import contacts context for contact name lookup (optional - may not be wrapped)
// Widget mode: contacts context is not available — use no-op fallback
const useContactsContext: () => {
  contacts: Array<{ _id: string; name: string; phoneNumber: string; phoneNumbers?: Array<{ number: string; type: string }> }>;
  favorites: Array<{ _id: string; name: string; phoneNumber: string; phoneNumbers?: Array<{ number: string; type: string }> }>;
  isLoaded: boolean;
  getDisplayName: (phone: string) => string | null;
  getContactInfo: (phone: string) => { name: string; company?: string; isFavorite?: boolean } | null;
  searchContacts: (query: string, limit?: number) => Array<{ _id: string; name: string; phoneNumber: string; phoneNumbers?: Array<{ number: string; type: string }> }>;
  recordCall: (phone: string, duration?: number) => Promise<any>;
} = () => ({
  contacts: [],
  favorites: [],
  isLoaded: true,
  getDisplayName: () => null,
  getContactInfo: () => null,
  searchContacts: () => [],
  recordCall: () => Promise.resolve(null),
});

// Call status display helper — returns icon + formatted label for status badges
// Uses CSS status classes for color-coded indicators
type CallStatusSnapshot = {
  status?: string | null;
  durationSeconds?: number | null;
};

const getUserFacingCallStatus = (call?: CallStatusSnapshot | null): string => {
  const normalizedStatus = (call?.status || '').toString().toLowerCase();

  if (!normalizedStatus) {
    return '';
  }

  if (normalizedStatus === 'answered') {
    return 'connected';
  }

  if (normalizedStatus === 'connected' && !(call?.durationSeconds && call.durationSeconds > 0)) {
    return 'ringing';
  }

  return normalizedStatus;
};

const hasRemotePartyAnswered = (call?: CallStatusSnapshot | null): boolean => {
  const status = getUserFacingCallStatus(call);
  return status === 'active' || status === 'connected';
};

const getStatusBadgeClassSuffix = (
  callOrStatus?: CallStatusSnapshot | string | null
): string => {
  if (typeof callOrStatus === 'string') {
    return getUserFacingCallStatus({ status: callOrStatus }) || callOrStatus.toLowerCase();
  }

  return (
    getUserFacingCallStatus(callOrStatus) ||
    (callOrStatus?.status || '').toString().toLowerCase()
  );
};

const getCallStatusDisplay = (
  callOrStatus: CallStatusSnapshot | string | undefined
): { icon: string; label: string } => {
  const fallbackStatus =
    typeof callOrStatus === 'string'
      ? callOrStatus
      : (callOrStatus?.status || '');
  const s =
    typeof callOrStatus === 'string'
      ? getUserFacingCallStatus({ status: callOrStatus }) || callOrStatus.toLowerCase()
      : getUserFacingCallStatus(callOrStatus) || fallbackStatus.toString().toLowerCase();
  switch (s) {
    case 'active':
    case 'connected':
      return { icon: '●', label: 'Active' };
    case 'ringing':
      return { icon: '●', label: 'Ringing' };
    case 'connecting':
      return { icon: '●', label: 'Connecting' };
    case 'hold':
    case 'on-hold':
    case 'onhold':
      return { icon: '●', label: 'On Hold' };
    case 'ended':
    case 'completed':
    case 'terminated':
    case 'terminating':
      return { icon: '●', label: 'Ended' };
    case 'failed':
    case 'rejected':
      return { icon: '●', label: 'Failed' };
    default:
      return { icon: '●', label: fallbackStatus || 'Unknown' };
  }
};

const LIVE_DURATION_STATUSES = new Set(["ANSWERED", "CONNECTED", "ACTIVE", "ON-HOLD", "ON_HOLD"]);

// Helper function for duration calculation with fallback like react_ref
const formatDurationWithFallback = (
  call: {
    durationSeconds?: number;
    startTimeISO?: string;
    endTimeISO?: string;
    status?: string;
    sipCallId?: string;
    extras?: any;
  }
): string => {
  // Skip duration for booth rooms without real SIP calls (dummy calls)
  if (
    call.extras?.isOutgoingRoomSetup &&
    (!call.sipCallId || call.sipCallId.startsWith("dummy_"))
  ) {
    return "—"; // Show dash instead of duration for booth rooms without active calls
  }

  // If we have a valid duration, use it
  if (call.durationSeconds && call.durationSeconds > 0) {
    return formatDuration(call.durationSeconds);
  }

  // For active calls with zero duration, calculate runtime duration
  if (
    call.startTimeISO &&
    LIVE_DURATION_STATUSES.has(String(call.status || "").trim().toUpperCase())
  ) {
    try {
      // Handle both ISO string format and timestamp formats
      const startTime = new Date(call.startTimeISO);
      const currentTime = new Date();

      // Validate the date was parsed correctly
      if (isNaN(startTime.getTime())) {
        // If ISO parsing failed, try as timestamp (fallback)
        const timestamp = parseInt(call.startTimeISO, 10);
        const startTimeFromTimestamp = new Date(
          timestamp < 10000000000 ? timestamp * 1000 : timestamp
        );
        if (!isNaN(startTimeFromTimestamp.getTime())) {
          const runtimeSeconds = Math.floor(
            (currentTime.getTime() - startTimeFromTimestamp.getTime()) / 1000
          );
          if (runtimeSeconds > 0) {
            return formatDuration(runtimeSeconds) + " (live)";
          }
        }
      } else {
        const runtimeSeconds = Math.floor(
          (currentTime.getTime() - startTime.getTime()) / 1000
        );
        if (runtimeSeconds > 0) {
          return formatDuration(runtimeSeconds) + " (live)";
        }
      }
    } catch (error) {
      // Failed to calculate runtime duration - continue with fallback
    }
  }

  // For terminated calls with zero duration, try to calculate from start/end times
  if (
    call.startTimeISO &&
    ["TERMINATED", "COMPLETED"].includes(call.status || "")
  ) {
    try {
      // Handle both ISO string format and timestamp formats for start time
      let startTime: Date;
      const startTimeFromISO = new Date(call.startTimeISO);

      if (isNaN(startTimeFromISO.getTime())) {
        // If ISO parsing failed, try as timestamp
        const timestamp = parseInt(call.startTimeISO, 10);
        startTime = new Date(
          timestamp < 10000000000 ? timestamp * 1000 : timestamp
        );
      } else {
        startTime = startTimeFromISO;
      }

      // Handle end time similarly if available
      let estimatedEndTime: Date;
      if (call.endTimeISO) {
        const endTimeFromISO = new Date(call.endTimeISO);
        if (isNaN(endTimeFromISO.getTime())) {
          const timestamp = parseInt(call.endTimeISO, 10);
          estimatedEndTime = new Date(
            timestamp < 10000000000 ? timestamp * 1000 : timestamp
          );
        } else {
          estimatedEndTime = endTimeFromISO;
        }
      } else {
        estimatedEndTime = new Date();
      }

      if (!isNaN(startTime.getTime()) && !isNaN(estimatedEndTime.getTime())) {
        const estimatedSeconds = Math.floor(
          (estimatedEndTime.getTime() - startTime.getTime()) / 1000
        );

        if (estimatedSeconds > 0) {
          const suffix = call.endTimeISO ? "" : " (est.)";
          return formatDuration(estimatedSeconds) + suffix;
        }
      }
    } catch (error) {
      // Failed to calculate estimated duration - continue with fallback
    }
  }

  return "00:00";
};

// Basic duration formatter
const formatDuration = (seconds?: number): string => {
  if (!seconds || seconds < 0) return "00:00";

  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hrs > 0) {
    return `${hrs.toString().padStart(2, "0")}:${mins
      .toString()
      .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
};

/**
 * Renders a call's duration and owns the clock that keeps it moving.
 *
 * This used to be driven by a `liveDurationUpdateTrigger` counter held in
 * CallsPage: a 1s interval bumped the counter, and because the counter was
 * read in the page body, every tick re-rendered the whole component — the
 * full JSX tree, 80+ inline style objects and every list render — purely to
 * refresh a handful of duration strings. Owning the tick here confines that
 * work to this one text node.
 *
 * Two further guards: the interval only runs while the duration is actually
 * live (a finished call's duration is static), and it stops while the tab is
 * hidden, so embedded copies of this widget stop burning a timer on other
 * people's pages when nobody is looking. Becoming visible again recomputes
 * immediately so the value is never seen stale.
 *
 * Renders a bare fragment so the surrounding DOM and CSS are unchanged.
 */
const LiveDuration: React.FC<{
  call: Parameters<typeof formatDurationWithFallback>[0];
}> = ({ call }) => {
  const [, setTick] = useState(0);

  const text = formatDurationWithFallback(call);
  const isLive = text.endsWith("(live)");

  useEffect(() => {
    if (!isLive) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (intervalId === null) {
        intervalId = setInterval(() => setTick((t) => t + 1), 1000);
      }
    };
    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
      } else {
        setTick((t) => t + 1);
        start();
      }
    };

    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [isLive]);

  return <>{text}</>;
};

const normalizeToTimestamp = (
  value: Date | string | number | undefined | null
): number | null => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }
    return value < 100000000000 ? value * 1000 : value;
  }

  if (typeof value === "string") {
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && numeric > 0) {
      return numeric < 100000000000 ? numeric * 1000 : numeric;
    }

    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
};

const getCallStartTimestamp = (call: Call): number => {
  const timestampFromStart = normalizeToTimestamp(call.startTime);

  if (timestampFromStart !== null) {
    return timestampFromStart;
  }

  const timestampFromIso = normalizeToTimestamp(call.startTimeISO);

  if (timestampFromIso !== null) {
    return timestampFromIso;
  }

  return 0;
};

interface CallsPageProps {
  isApiConfigured?: boolean;
  // System SIP support - when user has system credits and no own SIP configs
  systemSipEligible?: boolean;       // Whether user is eligible for system SIP
  systemSipBalance?: number;         // Current SIP credit balance
  systemSipUsername?: string;        // Username for system SIP billing
  systemSipBaseUrl?: string;         // Base URL for allocateSystemSipConfigForCall API
  contentOverrides?: Record<string, { text?: string }>;
  onActiveCallsChanged?: (calls: ActiveCallIdentity[]) => void;
}

type MicrophoneProceedMode = "muted" | "unmute" | null;

const CallsPage: React.FC<CallsPageProps> = ({
  isApiConfigured = true,
  systemSipEligible = false,
  systemSipBalance = 0,
  systemSipUsername,
  systemSipBaseUrl,
  contentOverrides,
  onActiveCallsChanged,
}) => {
  // Widget hooks — must be called before any other hooks
  const callManager = useCallManager();
  const { config, callService, widgetParams } = useWidgetConfig();
  const isStudioOperator = widgetParams.studioOperatorMode === true;

  const publishActiveCalls = useMemo(
    () => createActiveCallsPublisher(onActiveCallsChanged),
    [onActiveCallsChanged]
  );

  const callsContentOverrides = useMemo<Record<string, { text?: string }>>(() => {
    if (contentOverrides && typeof contentOverrides === "object") {
      return contentOverrides;
    }
    const raw = new URLSearchParams(window.location.search).get("contentOverrides");
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }, [contentOverrides]);
  const overrideText = useCallback(
    (id: string, fallback: string) => {
      const value = callsContentOverrides[id]?.text;
      return typeof value === "string" && value.trim() ? value.trim() : fallback;
    },
    [callsContentOverrides]
  );

  const [phoneNumber, setPhoneNumber] = useState(""); // Start with empty string
  const [isDialing, setIsDialing] = useState(false);
  const [selectedFromNumber, setSelectedFromNumber] = useState<string>("");

  // System SIP state - for MediaSFU pooled number support
  // Note: Number allocation now happens server-side in diff_.js (dummy number approach)
  const [isUsingSystemSip, setIsUsingSystemSip] = useState(false);

  // Contact lookup from ContactsContext (if available)
  const { contacts, favorites, isLoaded: contactsLoaded, getDisplayName, getContactInfo, searchContacts, recordCall: recordContactCall } = useContactsContext();

  // Contact search state for phone number input
  const [contactSearchQuery, setContactSearchQuery] = useState<string>("");
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const [filteredContacts, setFilteredContacts] = useState<Array<{ _id: string; name: string; phoneNumber: string; phoneNumbers?: Array<{ number: string; type: string }>; isFavorite?: boolean }>>([]);

  // MediaSFU Room State - Enhanced with outgoing call room management
  const [currentRoomName, setCurrentRoomName] = useState<string>(""); // Keep for backward compatibility
  const [requestedRoomName, setRequestedRoomName] = useState<string>(""); // Track what we requested vs what MediaSFU gives us
  const [currentParticipantName, setCurrentParticipantName] =
    useState<string>("voipuser");
  const [isConnectedToRoom, setIsConnectedToRoom] = useState(false);
  const [isMicrophoneEnabled, setIsMicrophoneEnabled] = useState(false);

  // Quick settings state
  const [selectedDuration, setSelectedDuration] = useState<number>(15); // Default 15 minutes

  // Outgoing call room state (transitioning to hook - use hook as primary source)
  const [legacyOutgoingCallRoom, setOutgoingCallRoom] = useState<{
    roomName: string;
    requestedRoomName: string;
    displayName: string;
    createdAt: Date;
    isActive: boolean;
    hasActiveSipCall: boolean;
    isMediaSFUConnected: boolean;
    sipCallId?: string;
    callData?: any;
  } | null>(null);

  // Dialpad State
  const [isDialpadCollapsed, setIsDialpadCollapsed] = useState(true);

  // Call History UI state
  const [showCallHistory, setShowCallHistory] = useState(false);

  // Quick Call state
  const [showQuickCallDialog, setShowQuickCallDialog] = useState(false);
  const [quickCallPhone, setQuickCallPhone] = useState("");
  const [quickCallContactTab, setQuickCallContactTab] = useState<0 | 1>(0); // 0=Favorites, 1=All Contacts
  const [quickCallSearchQuery, setQuickCallSearchQuery] = useState("");

  // Notification State for toast messages
  const [notification, setNotification] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: "success" | "error" | "warning" | "info";
  }>({
    isOpen: false,
    title: "",
    message: "",
    type: "info",
  });

  // Microphone confirmation state
  const [microphoneConfirmation, setMicrophoneConfirmation] = useState<{
    isOpen: boolean;
    isProcessing: boolean;
    mode: MicrophoneProceedMode;
  }>({
    isOpen: false,
    isProcessing: false,
    mode: null,
  });

  // Navigation confirmation state
  const [navigationConfirmation, setNavigationConfirmation] = useState<{
    isOpen: boolean;
    onConfirm: (() => void) | null;
    onCancel: (() => void) | null;
    message: string;
  }>({
    isOpen: false,
    onConfirm: null,
    onCancel: null,
    message: "",
  });

  const [callStatusInterval, setCallStatusInterval] =
    useState<ReturnType<typeof setInterval> | null>(null);

  // Bot call timeout handling
  const [botCallTimeoutRef, setBotCallTimeoutRef] =
    useState<ReturnType<typeof setTimeout> | null>(null);

  // Flag to prevent auto-recreation of rooms after manual close
  const [roomManuallyClosedRef, setRoomManuallyClosedRef] = useState<
    string | null
  >(null);

  // Room switching state to prevent false "call ended" notifications
  const [isRoomSwitching, setIsRoomSwitching] = useState(false);

  // All Current Calls (incoming + outgoing) - These are "active calls" that are not terminated
  // Based on MediaSFU API: calls with status != 'ended', 'failed', 'completed', 'rejected'
  const [currentCalls, setCurrentCalls] = useState<Call[]>([]);

  // Shared API call cache to prevent rate limiting. Keep it outside React state
  // so cache writes do not restart the polling effect while a call is binding.
  const cachedCallsResponseRef = useRef<{
    data: Call[];
    timestamp: number;
  } | null>(null);
  const inFlightCallsRequestRef = useRef<Promise<{
    success: boolean;
    data?: Call[];
  }> | null>(null);
  const apiCallCacheTimeout = 3000; // 3 seconds cache

  // Clear cache when appropriate to ensure fresh data for important events
  const clearApiCache = useCallback(() => {
    cachedCallsResponseRef.current = null;
  }, []);

  // Enhanced outgoing call room management using reference pattern
  const {
    outgoingCallRoom: hookOutgoingCallRoom,
    createOutgoingRoom,
    updateRoomName,
    syncCallToRoom,
    clearCallFromRoom,
    clearOutgoingRoom,
    getDummyCallForOutgoingRoom,
  } = useOutgoingCallRoomManager({
    currentCalls,
    currentRoomName,
    currentParticipantName,
  });

  // Use dummy call for outgoing room display (following reference pattern)
  const dummyCallForOutgoingRoom = useMemo(() => {
    return getDummyCallForOutgoingRoom();
  }, [getDummyCallForOutgoingRoom]);

  // Enhanced current calls including dummy call for outgoing room (following reference pattern)
  const enhancedCurrentCalls = useMemo(() => {
    let calls = [...currentCalls];

    // Add dummy call for outgoing room ONLY when active but NO real SIP call yet
    if (
      dummyCallForOutgoingRoom &&
      hookOutgoingCallRoom?.isActive &&
      !hookOutgoingCallRoom.hasActiveSipCall
    ) {
      // Add dummy call at the beginning when we're in setup phase (no real call yet)
      calls = [dummyCallForOutgoingRoom, ...calls];
    }

    // When we have a real SIP call, keep it (don't filter it out)
    // The real call has the sipCallId that MediaSFU needs for proper controls

    calls.sort((a, b) => getCallStartTimestamp(b) - getCallStartTimestamp(a));

    return calls;
  }, [
    currentCalls,
    dummyCallForOutgoingRoom,
    hookOutgoingCallRoom?.isActive,
    hookOutgoingCallRoom?.hasActiveSipCall,
  ]);

  // Use hook's outgoing room as primary source, fallback to legacy
  const outgoingCallRoom = hookOutgoingCallRoom || legacyOutgoingCallRoom;
  // Holds the cancel function from startVisibleInterval, not a timer id.
  const [callsPollingInterval, setCallsPollingInterval] =
    useState<(() => void) | null>(null);
  const [expandedCalls, setExpandedCalls] = useState<Set<string>>(new Set());
  const [collapsedMetadata, setCollapsedMetadata] = useState<Set<string>>(
    new Set()
  );
  const [showDialer, setShowDialer] = useState(false);

  // Room creation loading state
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [roomCreationError, setRoomCreationError] = useState<string | null>(
    null
  );
  const [roomCreationTimeoutRef, setRoomCreationTimeoutRef] =
    useState<ReturnType<typeof setTimeout> | null>(null);

  // Notification debounce - prevent duplicate call ended notifications
  const [lastCallEndNotificationId, setLastCallEndNotificationId] = useState<
    string | null
  >(null);

  // Flag to prevent repeated call end detection for the same call
  const [callEndProcessed, setCallEndProcessed] = useState<string | null>(null);

  // Controlled outgoing call flow state
  const [callFlowStep, setCallFlowStep] = useState<
    | "closed"
    | "select-number"
    | "enter-phone"
    | "choose-mode"
    | "dialing"
    | "resolving"
    | "ringing"
    | "connecting"
    | "connected"
  >("select-number");

  // Refs to track room state for async polling inside handleMakeCall
  // (React state isn't readable inside closures — refs give us current values)
  const isConnectedToRoomRef = useRef(isConnectedToRoom);
  const currentRoomNameRef = useRef(currentRoomName);
  const pendingRoomDisconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const participantDepartureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { isConnectedToRoomRef.current = isConnectedToRoom; }, [isConnectedToRoom]);
  useEffect(() => { currentRoomNameRef.current = currentRoomName; }, [currentRoomName]);

  const observedSipParticipantsRef = useRef<Set<string>>(new Set());
  const hasDetectedSipParticipantRef = useRef(false);
  const ringingNotificationCallKeyRef = useRef<string | null>(null);

  const clearPendingParticipantDeparture = useCallback(() => {
    if (participantDepartureTimeoutRef.current) {
      clearTimeout(participantDepartureTimeoutRef.current);
      participantDepartureTimeoutRef.current = null;
    }
  }, []);

  const resetSipParticipantTracking = useCallback(() => {
    clearPendingParticipantDeparture();
    observedSipParticipantsRef.current = new Set();
    hasDetectedSipParticipantRef.current = false;
    ringingNotificationCallKeyRef.current = null;
  }, [clearPendingParticipantDeparture]);

  const hasObservedRemoteParticipant = useCallback(
    () =>
      observedSipParticipantsRef.current.size > 0 ||
      hasDetectedSipParticipantRef.current,
    []
  );

  const clearPendingRoomDisconnect = useCallback(() => {
    if (pendingRoomDisconnectTimeoutRef.current) {
      clearTimeout(pendingRoomDisconnectTimeoutRef.current);
      pendingRoomDisconnectTimeoutRef.current = null;
    }
  }, []);

  // Utility function to clear all MediaSFU room state
  const clearMediaSFUState = useCallback(
    (reason?: string) => {
      clearPendingRoomDisconnect();
      setCurrentRoomName("");
      setCurrentParticipantName("voipuser");
      setIsConnectedToRoom(false);
      setIsMicrophoneEnabled(false);
      setRequestedRoomName("");
      // CRITICAL: Clear loading states to close loading modal
      setIsCreatingRoom(false);
      setRoomCreationError(null);
      resetSipParticipantTracking();
      // Clear room creation timeout if active
      if (roomCreationTimeoutRef) {
        clearTimeout(roomCreationTimeoutRef);
        setRoomCreationTimeoutRef(null);
      }
      roomLogger.info(
        `MediaSFU state cleared: ${reason || "No reason provided"}`
      );
    },
    [clearPendingRoomDisconnect, roomCreationTimeoutRef, resetSipParticipantTracking]
  );

  useEffect(() => {
    return () => {
      clearPendingRoomDisconnect();
      clearPendingParticipantDeparture();
    };
  }, [clearPendingParticipantDeparture, clearPendingRoomDisconnect]);

  // Shared API call function to prevent rate limiting
  const getCallsWithCache = useCallback(async (): Promise<{
    success: boolean;
    data?: Call[];
  }> => {
    const now = Date.now();
    const cachedCallsResponse = cachedCallsResponseRef.current;

    // Check if we have a recent cached response (within 3 seconds)
    if (
      cachedCallsResponse &&
      now - cachedCallsResponse.timestamp < apiCallCacheTimeout
    ) {
      return { success: true, data: cachedCallsResponse.data };
    }

    if (inFlightCallsRequestRef.current) {
      return inFlightCallsRequestRef.current;
    }

    // Make one API request when the cache is stale or empty. The in-flight
    // guard prevents concurrent effects from observing different snapshots.
    const request = (async () => {
      try {
        const response = await callService.getAllCalls();
        if (response.success && response.data) {
          cachedCallsResponseRef.current = {
            data: response.data,
            timestamp: Date.now(),
          };
          return response;
        }
        return { success: false };
      } catch (error) {
        callLogger.error("Error in shared API call:", error);
        return { success: false };
      } finally {
        inFlightCallsRequestRef.current = null;
      }
    })();

    inFlightCallsRequestRef.current = request;
    return request;
  }, [callService, apiCallCacheTimeout]);

  // Room origin tracking system - track which rooms we created via outgoing setup
  const getCreatedRooms = useCallback((): Set<string> => {
    try {
      const stored = localStorage.getItem("mediasfu_created_rooms");
      if (!stored) return new Set();
      const data = JSON.parse(stored);
      const now = Date.now();

      // Filter out expired entries (older than 1 day)
      const validRooms = new Set<string>();
      for (const roomName in data) {
        if (data[roomName] && now - data[roomName] < 24 * 60 * 60 * 1000) {
          validRooms.add(roomName);
        }
      }

      // Clean up localStorage if we removed any expired entries
      if (validRooms.size !== Object.keys(data).length) {
        const cleanData: Record<string, number> = {};
        validRooms.forEach((room) => {
          cleanData[room] = data[room];
        });
        localStorage.setItem(
          "mediasfu_created_rooms",
          JSON.stringify(cleanData)
        );
      }

      return validRooms;
    } catch (error) {
      // Error reading created rooms from localStorage - return empty set
      return new Set();
    }
  }, []);

  const markRoomAsCreated = useCallback((roomName: string) => {
    try {
      const existingData = localStorage.getItem("mediasfu_created_rooms");
      const data = existingData ? JSON.parse(existingData) : {};
      data[roomName] = Date.now();
      localStorage.setItem("mediasfu_created_rooms", JSON.stringify(data));
    } catch (error) {
      // Error storing created room to localStorage - continue without throwing
    }
  }, []);

  const isRoomCreatedByUs = useCallback(
    (roomName: string): boolean => {
      const createdRooms = getCreatedRooms();
      return createdRooms.has(roomName);
    },
    [getCreatedRooms]
  );

  // Step flow management
  const startCallFlow = useCallback(() => {
    setCallFlowStep("select-number");
    setShowDialer(true);
    setIsQuickCallRoom(false); // Normal call flow, not quick call
  }, []);

  const closeCallFlow = useCallback(() => {
    setCallFlowStep("closed");
    setShowDialer(false);
    // Reset form state when closing
    setPhoneNumber("");
    setSelectedFromNumber("");
    // Reset system SIP state
    setIsUsingSystemSip(false);
  }, []);

  // Quick call trigger flag — when set to true, a useEffect fires handleMakeCall
  const [quickCallTriggered, setQuickCallTriggered] = useState(false);

  // Track whether current room was created for a quick call (auto-close when call ends)
  const [isQuickCallRoom, setIsQuickCallRoom] = useState(false);
  const isQuickCallRoomRef = useRef(false);
  useEffect(() => { isQuickCallRoomRef.current = isQuickCallRoom; }, [isQuickCallRoom]);

  // Auto-unmute state for outgoing calls (follows Flutter's _autoUnmuteCompleter pattern)
  const [shouldAutoUnmute, setShouldAutoUnmute] = useState(false);
  const autoUnmuteResolverRef = useRef<((success: boolean) => void) | null>(null);
  const microphoneProceedModeRef = useRef<MicrophoneProceedMode>(null);
  const isMicrophoneEnabledRef = useRef(isMicrophoneEnabled);
  useEffect(() => {
    isMicrophoneEnabledRef.current = isMicrophoneEnabled;
  }, [isMicrophoneEnabled]);

  const triggerAutoUnmuteForCall = useCallback(
    async (postSuccessDelayMs: number = 0): Promise<boolean> => {
      if (!isConnectedToRoomRef.current) {
        return false;
      }

      if (isMicrophoneEnabledRef.current) {
        if (postSuccessDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, postSuccessDelayMs));
        }
        return true;
      }

      callLogger.info('Auto-unmute: mic is off in outgoing room, triggering auto-unmute...');

      try {
        const autoUnmutePromise = new Promise<boolean>((resolve) => {
          autoUnmuteResolverRef.current = resolve;
          setShouldAutoUnmute(true);
        });

        const autoUnmuteSuccess = await Promise.race([
          autoUnmutePromise,
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10000)),
        ]);

        callLogger.info(`Auto-unmute result: ${autoUnmuteSuccess ? 'success' : 'timed out / failed'}`);

        if (autoUnmuteSuccess && postSuccessDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, postSuccessDelayMs));
        }

        return autoUnmuteSuccess;
      } catch (err) {
        callLogger.warn('Auto-unmute: error during auto-unmute', err);
        return false;
      } finally {
        setShouldAutoUnmute(false);
        autoUnmuteResolverRef.current = null;
      }
    },
    []
  );

  const nextStep = useCallback(() => {
    if (callFlowStep === "select-number" && selectedFromNumber) {
      setCallFlowStep("enter-phone");
    } else if (callFlowStep === "enter-phone" && phoneNumber) {
      // We'll validate phone number in the UI, just check it exists here
      setCallFlowStep("choose-mode");
    } else if (callFlowStep === "choose-mode") {
      setCallFlowStep("dialing");
    }
  }, [callFlowStep, selectedFromNumber, phoneNumber]);

  const prevStep = useCallback(() => {
    if (callFlowStep === "enter-phone") {
      setCallFlowStep("select-number");
    } else if (callFlowStep === "choose-mode") {
      setCallFlowStep("enter-phone");
    } else if (callFlowStep === "connecting") {
      setCallFlowStep("choose-mode");
    }
  }, [callFlowStep]);

  // Call History Management (using custom hook)
  const { addCallToHistory, markCallsAsTerminated, callHistory, clearCallHistory } = useCallHistory();

  // Notification helper function
  const showNotification = useCallback(
    (
      title: string,
      message: string,
      type: "success" | "error" | "warning" | "info" = "info"
    ) => {
      setNotification({
        isOpen: true,
        title,
        message,
        type,
      });
    },
    []
  );

  const closeNotification = useCallback(() => {
    setNotification((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // Helper function to extract clean error messages
  const extractErrorMessage = useCallback((error: any): string => {
    if (typeof error === "string") {
      const match = error.match(/\{"error":"([^"]+)"\}/);
      if (match) {
        return match[1];
      }
      if (error.includes("HTTP")) {
        const cleanError = error.split(":").pop()?.trim();
        if (cleanError && cleanError !== error) {
          return cleanError;
        }
      }
      return error;
    }

    if (error?.error) {
      return typeof error.error === "string" ? error.error : "Call failed";
    }

    if (error?.message) {
      return error.message;
    }

    return "Call failed. Please try again.";
  }, []);

  const handleRoomParticipantsUpdate = useCallback(
    (updatedParticipants: { id?: string; name?: string; muted?: boolean; islevel?: string }[]) => {
      if (!hookOutgoingCallRoom?.isActive) {
        return;
      }

      const localName = (currentParticipantName || "voipuser").toLowerCase();
      const sipParticipants = new Set<string>();
      const hasMultipleParticipantsInRoom = updatedParticipants.length > 1;

      // Detect if this is a widget call by checking sipCallId for _widget_
      const isWidgetCall = Boolean(
        hookOutgoingCallRoom?.sipCallId?.includes("_widget_") ||
        currentCalls.some((c) => c.sipCallId?.includes("_widget_"))
      );

      updatedParticipants.forEach((participant) => {
        const id = (participant?.id ?? "").toString();
        const name = (participant?.name ?? "").toString();
        const idLower = id.toLowerCase();
        const nameLower = name.toLowerCase();

        const isAgent = idLower.endsWith("_agent") || nameLower.endsWith("_agent");
        if (isAgent) {
          return;
        }

        const isSelf = idLower === localName || nameLower === localName;
        if (isSelf) {
          return;
        }

        if (isWidgetCall) {
          // Widget call: the widget caller (visitor) created the room,
          // so they are the host with islevel '2'.
          // The dashboard user who joins to answer has a different islevel.
          // Count the host explicitly, but also treat any other non-self,
          // non-agent participant as evidence that someone else joined.
          const islevel = participant?.islevel != null ? String(participant.islevel) : undefined;
          const isWidgetCaller = islevel === "2";
          if (isWidgetCaller || hasMultipleParticipantsInRoom) {
            const identifier = idLower || nameLower;
            if (identifier) {
              sipParticipants.add(identifier);
            }
          }
        } else {
          // Regular SIP call: look for participants with sip_ prefix
          const looksSip = idLower.startsWith("sip_") || nameLower.startsWith("sip");
          if (looksSip || hasMultipleParticipantsInRoom) {
            const identifier = idLower || nameLower;
            if (identifier) {
              sipParticipants.add(identifier);
            }
          }
        }
      });

      const previousParticipants = observedSipParticipantsRef.current;
      const newParticipants = Array.from(sipParticipants).filter(
        (identifier) => !previousParticipants.has(identifier),
      );
      const everyoneLeft =
        sipParticipants.size === 0 && previousParticipants.size > 0;
      const trackedCallKey =
        hookOutgoingCallRoom.sipCallId ||
        hookOutgoingCallRoom.roomName ||
        currentRoomNameRef.current ||
        '__unknown_call__';

      observedSipParticipantsRef.current = sipParticipants;

      if (sipParticipants.size > 0) {
        clearPendingParticipantDeparture();
      }

      if (everyoneLeft) {
        clearPendingParticipantDeparture();
        participantDepartureTimeoutRef.current = setTimeout(() => {
          participantDepartureTimeoutRef.current = null;

          if (observedSipParticipantsRef.current.size > 0) {
            return;
          }

          hasDetectedSipParticipantRef.current = false;

          if (isWidgetCall) {
            // Widget caller (host) left the room — no human visitor on the line
            showNotification(
              'Widget Caller Left',
              'The website visitor has disconnected. You can end the call or wait for a reconnect.',
              "warning"
            );
          }
        }, 4000);
      }

      const trackedPhases = new Set([
        "select-number",
        "enter-phone",
        "choose-mode",
        "dialing",
        "resolving",
        "ringing",
        "connecting",
      ]);

      if (!trackedPhases.has(callFlowStep)) {
        return;
      }

      if (newParticipants.length > 0 && !hasDetectedSipParticipantRef.current) {
        hasDetectedSipParticipantRef.current = true;

        // A newly observed non-self, non-agent participant is the best live
        // signal that the call was actually answered.
        if (callFlowStep !== "closed") {
          setCallFlowStep("connected");
        }

        if (ringingNotificationCallKeyRef.current !== trackedCallKey) {
          ringingNotificationCallKeyRef.current = trackedCallKey;
          showNotification(
            'Connected',
            'Another participant joined the room. The call is now live.',
            "info"
          );
        }
      }
    },
    [
      callFlowStep,
      clearPendingParticipantDeparture,
      currentCalls,
      currentParticipantName,
      hookOutgoingCallRoom,
      showNotification,
    ]
  );

  // Navigation protection helper
  const checkNavigationSafety = useCallback(() => {
    const hasActiveMediaSFU = isConnectedToRoom && currentRoomName;
    const hasActiveCalls = currentCalls.length > 0;
    return {
      hasActiveMediaSFU,
      hasActiveCalls,
      shouldProtect: hasActiveMediaSFU || hasActiveCalls,
    };
  }, [isConnectedToRoom, currentRoomName, currentCalls.length]);

  // Widget mode: no router navigation needed
  // postMessage to parent for navigation requests
  const postToParent = useCallback((type: string, payload?: any) => {
    try {
      window.parent?.postMessage({ type, payload }, '*');
    } catch { /* ignore */ }
  }, []);

  // Navigation protection function (currently unused but may be needed for future features)
  // const handleNavigationWithProtection = useCallback(
  //   (targetPath: string) => {
  //     const { hasActiveMediaSFU, shouldProtect } = checkNavigationSafety();

  //     if (shouldProtect) {
  //       const message = hasActiveMediaSFU
  //         ? `You have an active MediaSFU room connection${
  //             currentRoomName ? ` (${currentRoomName})` : ""
  //           }. Navigating away will disconnect you and may end any ongoing calls.`
  //         : "You have active calls. Navigating away may affect your call experience.";

  //       setNavigationConfirmation({
  //         isOpen: true,
  //         message,
  //         onConfirm: () => {
  //           setNavigationConfirmation({
  //             isOpen: false,
  //             onConfirm: null,
  //             onCancel: null,
  //             message: "",
  //           });
  //           // Clear MediaSFU state before navigation to clean up properly
  //           if (hasActiveMediaSFU) {
  //             clearMediaSFUState("navigation away from calls page");
  //           }
  //           postToParent("mediasfu:navigateRequest", { path: targetPath });
  //         },
  //         onCancel: () => {
  //           setNavigationConfirmation({
  //             isOpen: false,
  //             onConfirm: null,
  //             onCancel: null,
  //             message: "",
  //           });
  //         },
  //       });
  //     } else {
  //       // Safe to navigate without confirmation
  //       postToParent("mediasfu:navigateRequest", { path: targetPath });
  //     }
  //   },
  //   [checkNavigationSafety, currentRoomName, postToParent, clearMediaSFUState]
  // );

  const stopCallMonitoring = useCallback(() => {
    if (callStatusInterval) {
      clearInterval(callStatusInterval);
      setCallStatusInterval(null);
    }
  }, [callStatusInterval]);

  // Enhanced call monitoring with proper room state synchronization
  const startCallMonitoring = useCallback(
    (sipCallId: string, roomName: string) => {
      if (callStatusInterval) {
        clearInterval(callStatusInterval);
      }

      // Track timeout to clear it when call is established
      let monitoringTimeout: ReturnType<typeof setTimeout> | null = null;

      const interval = setInterval(async () => {
        try {
          callLogger.debug("Polling for specific call status...");
          const allCalls = await getCallsWithCache();

          if (allCalls.success && allCalls.data) {
            // First try to match by sipCallId, then by roomName
            const call = allCalls.data.find(
              (c) =>
                c.id === sipCallId ||
                c.roomName === roomName ||
                c.sipCallId === sipCallId
            );

            if (call) {
              callLogger.debug("Found matching call:", call);

              // CRITICAL: Inject call into currentCalls immediately so it appears
              // in the active calls list, instead of waiting for the 8-second poll.
              setCurrentCalls((prevCalls) => {
                const callKey = call.sipCallId || call.id;
                const exists = prevCalls.some(
                  (c) => (c.sipCallId || c.id) === callKey
                );
                if (!exists) {
                  callLogger.info(
                    "Injecting call into currentCalls from monitor:",
                    callKey
                  );
                  return [call, ...prevCalls];
                }
                // Update existing call data (status changes, etc.)
                const updated = prevCalls.map((c) =>
                  (c.sipCallId || c.id) === callKey ? { ...c, ...call } : c
                );
                // Only return new ref if something changed
                const hasChange = prevCalls.some((c, i) => {
                  const key = c.sipCallId || c.id;
                  return key === callKey && c.status !== call.status;
                });
                return hasChange ? updated : prevCalls;
              });

              const backendStatus = call.status as string;

              switch (backendStatus) {
                case "RINGING":
                  // Callee's phone is ringing — show ringing UI
                  if (callFlowStep !== "ringing" && callFlowStep !== "connected" && callFlowStep !== "closed") {
                    setCallFlowStep("ringing");
                  }
                  break;
                case "INITIATING":
                  // Still in dialing phase
                  if (callFlowStep === "connecting" || callFlowStep === "dialing") {
                    setCallFlowStep("dialing");
                  }
                  break;
                case "CONNECTING":
                  // Media negotiation phase
                  if (callFlowStep !== "connected" && callFlowStep !== "closed") {
                    setCallFlowStep("connecting");
                  }
                  break;
                case "CONNECTED":
                case "ANSWERED":
                case "connected":
                  if (!hasRemotePartyAnswered(call) && !hasObservedRemoteParticipant()) {
                    if (callFlowStep !== "ringing" && callFlowStep !== "closed") {
                      setCallFlowStep("ringing");
                    }
                    break;
                  }

                  setCallFlowStep("connected");

                  // Clear API cache to force fresh data on next continuous poll
                  clearApiCache();

                  // CRITICAL: Update outgoing room with established call data
                  if (outgoingCallRoom?.isActive) {
                    setOutgoingCallRoom((prev) =>
                      prev
                        ? {
                            ...prev,
                            hasActiveSipCall: true,
                            sipCallId: call.sipCallId || call.id,
                            callData: {
                              status: call.status,
                              direction: call.direction,
                              callerIdRaw: call.callerIdRaw,
                              calledUri: call.calledUri,
                              startTimeISO: call.startTimeISO,
                              durationSeconds: call.durationSeconds,
                              onHold: call.onHold,
                              activeMediaSource: call.activeMediaSource,
                              humanParticipantName: call.humanParticipantName,
                            },
                          }
                        : null
                    );
                  }

                  // Auto-hide dialer with smooth transition
                  setTimeout(() => {
                    setShowDialer(false);
                    setCallFlowStep("closed");
                  }, 2000);

                  // Force UI update to reflect connected state
                  setTimeout(() => {
                    setCurrentCalls((prevCalls) => [...prevCalls]);
                  }, 100);

                  // Stop monitoring - call is established
                  if (monitoringTimeout) {
                    clearTimeout(monitoringTimeout);
                    monitoringTimeout = null;
                  }
                  stopCallMonitoring();
                  break;
                case "TERMINATED":
                case "FAILED":
                case "DECLINED":
                case "BUSY":
                  callLogger.warn("Call failed or ended:", {
                    status: backendStatus,
                    callId: sipCallId,
                  });
                  setCallFlowStep("closed");
                  stopCallMonitoring();
                  break;
                default:
                  callLogger.debug("Unknown call status:", backendStatus);
              }
            } else {
              callLogger.debug(
                "No matching call found in list - trying direct sipCallId lookup"
              );

              // FALLBACK: Direct sipCallId query bypasses apiUserName filter
              try {
                const directResult = await callService.getCallStateDirectly(sipCallId);
                if (directResult.success && directResult.data) {
                  const call = directResult.data;
                  // Inject into currentCalls
                  setCurrentCalls((prevCalls) => {
                    const callKey = call.sipCallId || call.id;
                    const exists = prevCalls.some((c) => (c.sipCallId || c.id) === callKey);
                    if (!exists) {
                      callLogger.info("Injecting call from direct lookup:", callKey);
                      return [call, ...prevCalls];
                    }
                    return prevCalls;
                  });

                  // Process status like above
                  const backendStatus = (call.status as string)?.toUpperCase();
                  if (hasRemotePartyAnswered(call) || hasObservedRemoteParticipant()) {
                    setCallFlowStep("connected");
                    clearApiCache();
                  } else if (
                    backendStatus === "CONNECTED" ||
                    backendStatus === "ANSWERED" ||
                    backendStatus === "RINGING"
                  ) {
                    if (callFlowStep !== "ringing" && callFlowStep !== "connected" && callFlowStep !== "closed") {
                      setCallFlowStep("ringing");
                    }
                  }
                }
              } catch (directErr) {
                callLogger.debug("Direct sipCallId lookup failed:", directErr);
              }
            }
          } else {
            callLogger.error(
              "Failed to fetch all calls - cached response failed"
            );
          }
        } catch (error) {
          callLogger.error("Error monitoring call status:", error);
        }
      }, 2500); // Check every 2.5 seconds (matching Flutter)

      setCallStatusInterval(interval);

      // Auto-stop monitoring after 120 seconds (long-ringing calls need time)
      monitoringTimeout = setTimeout(() => {
        setCallFlowStep("closed");
        stopCallMonitoring();
      }, 120 * 1000);
    },
    [
      callStatusInterval,
      stopCallMonitoring,
      outgoingCallRoom,
      getCallsWithCache,
      clearApiCache,
      callFlowStep,
      hasObservedRemoteParticipant,
    ]
  );

  // Helper functions for expandable calls
  const toggleCallExpansion = useCallback(
    (callId: string) => {
      // Find the call being toggled from enhancedCurrentCalls
      const call = enhancedCurrentCalls.find(
        (c) =>
          (c.sipCallId || `call-${enhancedCurrentCalls.indexOf(c)}`) === callId
      );

      // Check if this call has an active MediaSFU connection that would be disrupted
      // AND the MediaSFU room display is currently shown for this specific call
      const hasActiveMediaSFU =
        call?.roomName &&
        currentRoomName === call.roomName &&
        isConnectedToRoom;

      // Check if the MediaSFU interface is currently embedded/displayed for this call
      // MediaSFU is embedded when the call is NOT from our outgoing setup room
      const isMediaSFUEmbedded =
        hasActiveMediaSFU &&
        currentRoomName &&
        !isRoomCreatedByUs(currentRoomName) &&
        isConnectedToRoom;

      setExpandedCalls((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(callId)) {
          // Only prevent collapsing if MediaSFU is actively embedded for this call
          if (isMediaSFUEmbedded) {
            // Show notification instead of alert
            showNotification(
              "Cannot Collapse Call",
              'Cannot collapse this call while MediaSFU room interface is active. Please disconnect from the room first using the "Close Room" or "End Call" button in the MediaSFU interface to maintain your connection stability.',
              "warning"
            );
            return prev; // Don't change the state
          }
          newSet.delete(callId);
        } else {
          newSet.add(callId);
        }
        return newSet;
      });
    },
    [
      enhancedCurrentCalls,
      currentRoomName,
      isConnectedToRoom,
      showNotification,
      isRoomCreatedByUs,
    ]
  );

  // Helper functions for metadata collapse/expand
  const toggleMetadataCollapse = useCallback((callId: string) => {
    setCollapsedMetadata((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(callId)) {
        newSet.delete(callId);
      } else {
        newSet.add(callId);
      }
      return newSet;
    });
  }, []);

  const isMetadataCollapsed = useCallback(
    (callId: string) => {
      return collapsedMetadata.has(callId);
    },
    [collapsedMetadata]
  );

  const isCallExpanded = useCallback(
    (callId: string) => {
      return expandedCalls.has(callId);
    },
    [expandedCalls]
  );

  // Join call function (for calls not yet joined) - Simplified for direct embedding
  const handleJoinCall = useCallback(
    async (call: Call) => {
      if (isStudioOperator) {
        callLogger.info("Skipping MediaSFU room join for studio operator surface", {
          callId: call.sipCallId || call.id,
        });
        return;
      }

      const authoritativeRoomName = getAuthoritativeCallRoomName(call);
      if (!authoritativeRoomName) {
        callLogger.warn("Cannot join call without an authoritative room name", {
          callId: call.sipCallId || call.id,
        });
        return;
      }

      try {
        // Check if already connected to this room
        if (isConnectedToRoom && currentRoomName === authoritativeRoomName) {
          return;
        }

        // Set room switching flag to prevent false "call ended" notifications
        setIsRoomSwitching(true);

        // Disconnect from current room if connected to a different one
        if (
          isConnectedToRoom &&
          currentRoomName &&
          currentRoomName !== authoritativeRoomName
        ) {
          // Properly disconnect from MediaSFU room first
          setCurrentRoomName("");
          setCurrentParticipantName("voipuser");
          setIsConnectedToRoom(false);
          setIsMicrophoneEnabled(false);

          // Wait a moment for cleanup
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        // Determine participant name - use humanParticipantName from call or generate from config
        const participantName =
          call.humanParticipantName || currentParticipantName || "voipuser";

        // IMPORTANT: If we're joining a room that's different from our outgoing room,
        // clear outgoing room state to show proper joined call UI
        if (
          hookOutgoingCallRoom?.isActive &&
          hookOutgoingCallRoom.roomName !== authoritativeRoomName
        ) {
          // Clear outgoing room state to show proper joined call UI
          if (clearOutgoingRoom) {
            clearOutgoingRoom();
            resetSipParticipantTracking();
          }
        }

        // Set up room state for joining and show the display
        setCurrentRoomName(authoritativeRoomName);
        setCurrentParticipantName(participantName);

        // Clear room switching flag after a delay
        setTimeout(() => {
          setIsRoomSwitching(false);
        }, 2000);
      } catch (error) {
        callLogger.error("Failed to join call room:", error);
        // Clear switching flag on error
        setIsRoomSwitching(false);
      }
    },
    [
      isConnectedToRoom,
      currentRoomName,
      currentParticipantName,
      hookOutgoingCallRoom,
      clearOutgoingRoom,
      resetSipParticipantTracking,
      isStudioOperator,
    ]
  );

  // End call function
  const handleEndCall = useCallback(
    async (call: Call) => {
      const callId = call.sipCallId || call.id;
      if (!callId) {
        callLogger.error("No call ID available for ending call");
        return;
      }

      try {
        callLogger.info(`Ending call: ${callId}`);

        // Call the hangup service
        const result = await callService.hangupCall(callId);

        if (result.success) {
          callLogger.info(`Call ${callId} ended successfully`);

          const callNotificationId = call.roomName
            ? `${call.roomName}_${call.sipCallId || call.id || callId}`
            : null;

          if (callNotificationId) {
            setCallEndProcessed(callNotificationId);
            setLastCallEndNotificationId(callNotificationId);
          }

          // Update UI optimistically
          setCurrentCalls((prev) =>
            prev.filter((c) => c.sipCallId !== callId && c.id !== callId)
          );

          clearApiCache();

          const isTrackedOutgoingCall = Boolean(
            hookOutgoingCallRoom?.isActive && (
              (hookOutgoingCallRoom.sipCallId && hookOutgoingCallRoom.sipCallId === callId) ||
              (call.roomName && (
                call.roomName === hookOutgoingCallRoom.roomName ||
                call.roomName === hookOutgoingCallRoom.requestedRoomName
              ))
            )
          );

          if (isTrackedOutgoingCall && hookOutgoingCallRoom) {
            const hasOtherCallsInRoom = currentCalls.some(
              (existingCall) =>
                existingCall.roomName === hookOutgoingCallRoom.roomName &&
                existingCall.sipCallId !== callId &&
                existingCall.id !== callId &&
                existingCall.status !== "ended" &&
                existingCall.status !== "failed" &&
                existingCall.status !== "completed" &&
                existingCall.status !== "rejected" &&
                existingCall.status !== "terminated" &&
                existingCall.status !== "terminating" &&
                !existingCall.callEnded
            );

            const shouldAutoCloseQuickCallRoom =
              !hasOtherCallsInRoom &&
              isQuickCallRoomRef.current &&
              isRoomCreatedByUs(hookOutgoingCallRoom.roomName);

            clearCallFromRoom();
            setIsDialing(false);
            setPhoneNumber("");

            if (shouldAutoCloseQuickCallRoom) {
              clearMediaSFUState("quick call ended in outgoing room");
              clearOutgoingRoom();
              setOutgoingCallRoom(null);
              setIsQuickCallRoom(false);
              setCallFlowStep("closed");

              if (hookOutgoingCallRoom.roomName) {
                setRoomManuallyClosedRef(hookOutgoingCallRoom.roomName);
              }
            } else {
              if (!hasOtherCallsInRoom) {
                callLogger.info("Outgoing room preserved after ending call", {
                  isQuickCall: isQuickCallRoomRef.current,
                  roomName: hookOutgoingCallRoom.roomName,
                });
              }

              setCallFlowStep(hasOtherCallsInRoom ? "closed" : "enter-phone");
            }
          }

          // Refresh calls list after a short delay
          setTimeout(() => {
            // The continuous polling will update the list
          }, 1000);
        } else {
          callLogger.error(`Failed to end call ${callId}:`, result.error);
          showNotification(
            "Call End Failed",
            `Failed to end call: ${result.error}. Please try again in a moment. If the call still appears active, use End Call once more.`,
            "error"
          );
        }
      } catch (error) {
        callLogger.error(`Error ending call ${callId}:`, error);
        showNotification(
          "Call End Error",
          `Error ending call: ${
            error instanceof Error ? error.message : "Unknown error"
          }. Please try again in a moment.`,
          "error"
        );
      }
    },
    [
      showNotification,
      clearApiCache,
      hookOutgoingCallRoom,
      currentCalls,
      clearCallFromRoom,
      isRoomCreatedByUs,
      clearMediaSFUState,
      clearOutgoingRoom,
    ]
  );

  // Handle room-initiated end call
  const handleRoomEndCall = useCallback(
    async (callId: string) => {
      // Find the call by ID and use existing handleEndCall
      const call = currentCalls.find(
        (c) => c.sipCallId === callId || c.id === callId
      );
      if (call) {
        await handleEndCall(call);
        return;
      }

      if (hookOutgoingCallRoom?.isActive && hookOutgoingCallRoom.sipCallId === callId) {
        const fallbackCall: Call = {
          sipCallId: hookOutgoingCallRoom.sipCallId,
          id: hookOutgoingCallRoom.sipCallId,
          status: ((hookOutgoingCallRoom.callData?.status || "connected").toLowerCase() as Call["status"]),
          direction: (hookOutgoingCallRoom.callData?.direction || "outgoing") as Call["direction"],
          startTimeISO: hookOutgoingCallRoom.callData?.startTimeISO || new Date().toISOString(),
          durationSeconds: hookOutgoingCallRoom.callData?.durationSeconds || 0,
          roomName: hookOutgoingCallRoom.roomName || currentRoomName || "",
          callerIdRaw: hookOutgoingCallRoom.callData?.callerIdRaw || selectedFromNumber || "voipuser",
          calledUri: hookOutgoingCallRoom.callData?.calledUri || phoneNumber || "",
          audioOnly: true,
          activeMediaSource: hookOutgoingCallRoom.callData?.activeMediaSource || "human",
          humanParticipantName: hookOutgoingCallRoom.callData?.humanParticipantName || currentParticipantName,
          playingMusic: false,
          playingPrompt: false,
          currentPromptType: null,
          pendingHumanIntervention: false,
          callbackState: "none",
          callbackPin: null,
          activeSpeaker: null,
          callEnded: false,
          needsCallback: false,
          callbackHonored: false,
          calledBackRef: null,
        };

        await handleEndCall(fallbackCall);
        return;
      }

      callLogger.warn("Could not find call to end:", callId);
    },
    [
      currentCalls,
      handleEndCall,
      hookOutgoingCallRoom,
      currentRoomName,
      selectedFromNumber,
      phoneNumber,
      currentParticipantName,
    ]
  );

  // Hold call function
  const handleHoldCall = useCallback(
    async (call: Call) => {
      const callId = call.sipCallId || call.id;
      if (!callId) {
        callLogger.error("No call ID available for holding call");
        return;
      }

      const shouldHold = !(call.onHold ?? false);

      try {
        callLogger.info(
          `${shouldHold ? "Placing" : "Releasing"} call ${callId} ${
            shouldHold ? "on hold" : "from hold"
          }`
        );

        const response = await callService.toggleHold(callId, shouldHold);

        if (!response.success) {
          const message =
            response.error || "Unable to update the call's hold state.";
          showNotification(
            shouldHold ? "Could not hold call" : "Could not resume call",
            message,
            "error"
          );
          return;
        }

        setCurrentCalls((previousCalls) =>
          previousCalls.map((existingCall) =>
            existingCall.sipCallId === callId || existingCall.id === callId
              ? {
                  ...existingCall,
                  onHold: shouldHold,
                  // When unholding, clear stale hold-related flags so the hold button
                  // remains enabled for subsequent hold attempts.
                  ...(shouldHold ? {} : { playingMusic: false, pendingHumanIntervention: false }),
                }
              : existingCall
          )
        );

        showNotification(
          shouldHold ? "Call placed on hold" : "Call resumed",
          shouldHold
            ? "The caller now hears your configured hold experience."
            : "The caller has been returned to the conversation.",
          "success"
        );
      } catch (error) {
        const message = extractErrorMessage(error);
        callLogger.error(`Error toggling hold for call ${callId}:`, error);
        showNotification(
          shouldHold ? "Could not hold call" : "Could not resume call",
          message,
          "error"
        );
      }
    },
    [extractErrorMessage, showNotification, setCurrentCalls]
  );

  // Transfer call function
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleTransferCall = useCallback(
    async (call: Call) => {
      const callId = call.sipCallId || call.id;
      if (!callId) {
        callLogger.error("No call ID available for transferring call");
        return;
      }

      try {
        callLogger.info(`Transfer call: ${callId}`);
        // Note: Transfer functionality would need to be implemented in callService
        // For now, just log the action
        showNotification(
          "Feature Not Available",
          "Transfer call functionality - to be implemented with SIP service",
          "info"
        );
      } catch (error) {
        callLogger.error(`Error transferring call ${callId}:`, error);
      }
    },
    [showNotification]
  );

  // Answer call function
  const handleAnswerCall = useCallback(
    async (call: Call) => {
      const callId = call.sipCallId || call.id;
      if (!callId) {
        callLogger.error("No call ID available for answering call");
        return;
      }

      try {
        // For answering calls, we need to join the MediaSFU room
        if (call.roomName) {
          await handleJoinCall(call);
        }

        // Note: Answer functionality would need to be implemented in callService
        // For now, just join the room
      } catch (error) {
        callLogger.error(`Error answering call ${callId}:`, error);
      }
    },
    [handleJoinCall]
  );

  // Decline call function
  const handleDeclineCall = useCallback(
    async (call: Call) => {
      const callId = call.sipCallId || call.id;
      if (!callId) {
        callLogger.error("No call ID available for declining call");
        return;
      }

      try {
        callLogger.info(`Declining call: ${callId}`);

        // Use the reject call service
        const result = await callService.rejectCall(callId);

        if (result.success) {
          callLogger.info(`Call ${callId} declined successfully`);

          // Update UI optimistically
          setCurrentCalls((prev) =>
            prev.filter((c) => c.sipCallId !== callId && c.id !== callId)
          );

          // Refresh calls list after a short delay
          setTimeout(() => {
            // The continuous polling will update the list
          }, 1000);
        } else {
          callLogger.error(`Failed to decline call ${callId}:`, result.error);
          showNotification(
            "Call Decline Failed",
            `Failed to decline call: ${result.error}`,
            "error"
          );
        }
      } catch (error) {
        callLogger.error(`Error declining call ${callId}:`, error);
        showNotification(
          "Call Decline Error",
          `Error declining call: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
          "error"
        );
      }
    },
    [showNotification]
  );

  // Use refs to avoid circular dependencies in polling.
  // Holds the cancel function from startVisibleInterval, not a timer id.
  const callsPollingIntervalRef = useRef<(() => void) | null>(null);

  // Refs to store latest values for polling without causing re-renders
  const hookOutgoingCallRoomRef = useRef(hookOutgoingCallRoom);
  const botCallTimeoutRefValue = useRef(botCallTimeoutRef);
  const callEndProcessedRef = useRef(callEndProcessed);
  const lastCallEndNotificationIdRef = useRef(lastCallEndNotificationId);
  const allDisplayCallsRef = useRef<Call[]>([]);

  // Track consecutive polls where a call is missing (to prevent false positives from API hiccups)
  const callMissingCountRef = useRef<Map<string, number>>(new Map());
  const CONSECUTIVE_MISSING_THRESHOLD = 3; // Require 3 consecutive polls (15 seconds) before declaring call ended
  const QUICK_CALL_MISSING_THRESHOLD = 3; // Quick call rooms still need debounce to survive temporary API gaps
  const CONNECTED_ROOM_MISSING_THRESHOLD = 4; // Connected rooms get one extra grace poll before teardown

  const isCallActive = useCallback((call?: Partial<Call> | null) => {
    if (!call) {
      return false;
    }

    const status = (call.status || '').toLowerCase();
    return ![
      'ended',
      'failed',
      'completed',
      'rejected',
      'terminated',
      'terminating',
      'cancelled',
    ].includes(status) && !call.callEnded;
  }, []);

  const matchesTrackedOutgoingCall = useCallback(
    (call: Partial<Call> | null | undefined, outgoingRoom: NonNullable<typeof hookOutgoingCallRoom>) => {
      if (!call) {
        return false;
      }

      return Boolean(
        (outgoingRoom.sipCallId && call.sipCallId === outgoingRoom.sipCallId) ||
          (outgoingRoom.roomName && call.roomName === outgoingRoom.roomName) ||
          (outgoingRoom.requestedRoomName &&
            call.roomName === outgoingRoom.requestedRoomName)
      );
    },
    []
  );

  const upsertCurrentCall = useCallback((call: Call) => {
    setCurrentCalls((prevCalls) => {
      const callKey = call.sipCallId || call.id;
      const existingIndex = prevCalls.findIndex(
        (existingCall) =>
          (callKey && (existingCall.sipCallId === callKey || existingCall.id === callKey)) ||
          (call.roomName && existingCall.roomName === call.roomName)
      );

      if (existingIndex === -1) {
        return [call, ...prevCalls];
      }

      const updatedCalls = [...prevCalls];
      updatedCalls[existingIndex] = {
        ...updatedCalls[existingIndex],
        ...call,
      };
      return updatedCalls;
    });
  }, []);

  const confirmCallPresenceDirectly = useCallback(
    async (outgoingRoom: NonNullable<typeof hookOutgoingCallRoom>) => {
      if (!outgoingRoom.sipCallId) {
        return null;
      }

      try {
        const directStateResponse = await callService.getCallStateDirectly(outgoingRoom.sipCallId);
        if (
          directStateResponse.success &&
          directStateResponse.data &&
          isCallActive(directStateResponse.data)
        ) {
          return directStateResponse.data;
        }
      } catch (error) {
        callLogger.debug('Direct call-state confirmation failed during missing-call check', {
          roomName: outgoingRoom.roomName,
          sipCallId: outgoingRoom.sipCallId,
          error,
        });
      }

      return null;
    },
    [callService, isCallActive]
  );

  // Keep refs in sync with state
  useEffect(() => {
    hookOutgoingCallRoomRef.current = hookOutgoingCallRoom;
  }, [hookOutgoingCallRoom]);

  useEffect(() => {
    botCallTimeoutRefValue.current = botCallTimeoutRef;
  }, [botCallTimeoutRef]);

  useEffect(() => {
    callEndProcessedRef.current = callEndProcessed;
  }, [callEndProcessed]);

  useEffect(() => {
    lastCallEndNotificationIdRef.current = lastCallEndNotificationId;
  }, [lastCallEndNotificationId]);

  const stopContinuousCallsPolling = useCallback(() => {
    if (callsPollingIntervalRef.current) {
      callsPollingIntervalRef.current();
      callsPollingIntervalRef.current = null;
      setCallsPollingInterval(null);
    }
  }, []);

  const handleRoomConnectionChange = useCallback(
    (connected: boolean) => {
      setIsConnectedToRoom(connected);

      if (connected) {
        clearPendingRoomDisconnect();
        setIsCreatingRoom(false);
        setRoomCreationError(null);

        if (roomCreationTimeoutRef) {
          clearTimeout(roomCreationTimeoutRef);
          setRoomCreationTimeoutRef(null);
        }

        if (roomManuallyClosedRef) {
          setRoomManuallyClosedRef(null);
          roomLogger.info("roomManuallyClosedRef cleared on connect");
        }

        return;
      }

      const disconnectRoomName = currentRoomNameRef.current;
      const outgoingRoom = hookOutgoingCallRoomRef.current;
      const hasTrackedActiveCall = Boolean(
        outgoingRoom?.hasActiveSipCall ||
          outgoingRoom?.callData ||
          (disconnectRoomName &&
            allDisplayCallsRef.current.some(
              (call) =>
                (call.roomName === disconnectRoomName ||
                  call.roomName === outgoingRoom?.requestedRoomName) &&
                call.status !== "ended" &&
                call.status !== "failed" &&
                call.status !== "completed" &&
                call.status !== "rejected" &&
                call.status !== "terminated" &&
                call.status !== "terminating" &&
                !call.callEnded
            ))
      );

      if (hasTrackedActiveCall && disconnectRoomName) {
        clearPendingRoomDisconnect();
        pendingRoomDisconnectTimeoutRef.current = setTimeout(() => {
          pendingRoomDisconnectTimeoutRef.current = null;

          if (
            isConnectedToRoomRef.current ||
            currentRoomNameRef.current !== disconnectRoomName
          ) {
            return;
          }

          roomLogger.warn(
            "MediaSFU room remained disconnected after grace period - clearing room state",
            {
              roomName: disconnectRoomName,
              hasOutgoingCall: Boolean(hookOutgoingCallRoomRef.current?.hasActiveSipCall),
            }
          );

          setCurrentRoomName("");
          setIsCreatingRoom(false);
          setRoomCreationError(null);

          if (hookOutgoingCallRoomRef.current?.isActive) {
            roomLogger.info("Clearing outgoing room after sustained connection loss");
            clearOutgoingRoom();
            setOutgoingCallRoom(null);
            localStorage.removeItem("mediasfu_outgoing_room");
          }

          if (roomManuallyClosedRef) {
            setRoomManuallyClosedRef(null);
            roomLogger.info("roomManuallyClosedRef cleared on disconnect");
          }
        }, 6000);

        roomLogger.warn(
          "Transient MediaSFU disconnect detected - delaying room teardown",
          {
            roomName: disconnectRoomName,
            hasOutgoingCall: Boolean(outgoingRoom?.hasActiveSipCall),
          }
        );
        return;
      }

      setCurrentRoomName("");
      setIsCreatingRoom(false);
      setRoomCreationError(null);

      if (hookOutgoingCallRoomRef.current?.isActive) {
        roomLogger.info("Clearing outgoing room on connection loss");
        clearOutgoingRoom();
        setOutgoingCallRoom(null);
        localStorage.removeItem("mediasfu_outgoing_room");
      }

      if (roomManuallyClosedRef) {
        setRoomManuallyClosedRef(null);
        roomLogger.info("roomManuallyClosedRef cleared on disconnect");
      }
    },
    [
      clearOutgoingRoom,
      clearPendingRoomDisconnect,
      roomCreationTimeoutRef,
      roomManuallyClosedRef,
    ]
  );

  // Continuous polling for all calls (incoming + outgoing)
  const startContinuousCallsPolling = useCallback(() => {
    // Clear any existing polling first
    stopContinuousCallsPolling();

    let consecutiveErrors = 0;
    const maxErrors = 3;

    const pollCalls = async () => {
      try {
        const allCallsResponse = await getCallsWithCache();
        if (allCallsResponse.success && allCallsResponse.data) {

          // Reset error count on successful response
          consecutiveErrors = 0;

          // Add ALL calls to history (active and terminated) for record keeping
          allCallsResponse.data.forEach((call) => {
            if (call.sipCallId) {
              // Only add calls with valid sipCallId
              addCallToHistory(call);
            }
          });

          // Filter for active/current calls (anything not terminated/terminating)
          // These are calls that should appear in the UI as "current calls"
          // Similar to reference implementation's "activeCalls" filtering
          const activeCalls = allCallsResponse.data.filter((call) => {
            const isActiveCall = isActiveCallRecord(call);

            if (!isActiveCall) {
              callLogger.debug(
                `Filtered out call ${call.sipCallId} with status: ${call.status}`
              );
            }
            return isActiveCall;
          });

          // Mark any calls in history that are no longer in the active list as terminated
          const activeSipCallIds = activeCalls
            .map((call) => call.sipCallId)
            .filter(Boolean);
          markCallsAsTerminated(activeSipCallIds);

          // Remove duplicates based on sipCallId as primary key, fallback to id
          const uniqueActiveCalls = activeCalls.reduce(
            (unique: Call[], call: Call) => {
              const callId = call.sipCallId || call.id;
              const existingCall = unique.find(
                (existing) =>
                  (existing.sipCallId && existing.sipCallId === callId) ||
                  (existing.id && existing.id === callId) ||
                  (existing.sipCallId === call.sipCallId && call.sipCallId) ||
                  (existing.id === call.id && call.id)
              );

              if (!existingCall) {
                unique.push(call);
              } else {
                callLogger.debug(`Filtered duplicate call: ${callId}`, {
                  existing: existingCall,
                  duplicate: call,
                });
              }

              return unique;
            },
            []
          );

          // Publish directly from the successful scoped poll. This covers the
          // short window where the backend has rehydrated callIds but React has
          // not yet committed the derived display list.
          publishActiveCalls(uniqueActiveCalls);

          const outgoingRoom = hookOutgoingCallRoomRef.current;

          // Update state with smarter change detection (by sipCallId, not index position)
          setCurrentCalls((prevCalls) => {
            let nextActiveCalls = uniqueActiveCalls;

            if (outgoingRoom?.hasActiveSipCall) {
              const trackedPrevCall = prevCalls.find(
                (call) =>
                  matchesTrackedOutgoingCall(call, outgoingRoom) &&
                  isCallActive(call)
              );
              const trackedCallStillListed = uniqueActiveCalls.some((call) =>
                matchesTrackedOutgoingCall(call, outgoingRoom)
              );

              if (trackedPrevCall && !trackedCallStillListed) {
                nextActiveCalls = [trackedPrevCall, ...uniqueActiveCalls];
              }
            }

            // Create maps for efficient lookup
            const prevCallsMap = new Map(prevCalls.map(c => [c.sipCallId || c.id, c]));
            const newCallsMap = new Map(nextActiveCalls.map(c => [c.sipCallId || c.id, c]));

            // Check if the set of call IDs changed
            const prevIds = new Set(prevCallsMap.keys());
            const newIds = new Set(newCallsMap.keys());

            // Check for added or removed calls
            const idsChanged = prevIds.size !== newIds.size ||
              [...prevIds].some(id => !newIds.has(id)) ||
              [...newIds].some(id => !prevIds.has(id));

            // Check for status/property changes on existing calls
            const statusChanged = [...newIds].some(id => {
              const prevCall = prevCallsMap.get(id);
              const newCall = newCallsMap.get(id);
              return prevCall && newCall && (
                prevCall.status !== newCall.status ||
                prevCall.onHold !== newCall.onHold ||
                prevCall.activeMediaSource !== newCall.activeMediaSource ||
                prevCall.playingMusic !== newCall.playingMusic ||
                prevCall.pendingHumanIntervention !== newCall.pendingHumanIntervention
              );
            });

            if (idsChanged || statusChanged) {
              return nextActiveCalls;
            }
            return prevCalls; // No meaningful changes, keep same reference
          });

          // Enhanced outgoing call room synchronization with establishment detection
          if (outgoingRoom?.isActive) {
            // CRITICAL: Use room-based discovery to find SIP calls
            // Look for active calls that match our outgoing room name (not terminated/failed)
            const sipCallInRoom = uniqueActiveCalls.find(
              (call) =>
                (call.roomName === outgoingRoom.roomName ||
                  call.roomName === outgoingRoom.requestedRoomName) &&
                call.status !== "ended" &&
                call.status !== "failed" &&
                call.status !== "completed" &&
                call.status !== "rejected" &&
                call.status !== "terminated" &&
                call.status !== "terminating" &&
                !call.callEnded
            );

            // Track whether call is found or missing for debouncing
            const callTrackingId = outgoingRoom.sipCallId || outgoingRoom.roomName;

            if (
              sipCallInRoom &&
              (!outgoingRoom.hasActiveSipCall ||
                !outgoingRoom.callData)
            ) {
              // Call found - reset missing counter
              callMissingCountRef.current.delete(callTrackingId);

              // Clear bot call timeout if call is now connected (case-insensitive)
              const currentBotTimeout = botCallTimeoutRefValue.current;
              if (
                (sipCallInRoom.status?.toLowerCase() === "connected" ||
                  sipCallInRoom.status?.toLowerCase() === "active") &&
                currentBotTimeout
              ) {
                clearTimeout(currentBotTimeout);
                setBotCallTimeoutRef(null);
                callLogger.info("Call connected - cleared timeout");
              }

              // Use hook to sync call to room
              syncCallToRoom(sipCallInRoom);

              // Update UI to reflect call establishment (case-insensitive)
              if (hasRemotePartyAnswered(sipCallInRoom) || hasObservedRemoteParticipant()) {
                setCallFlowStep("connected");

                // Auto-hide dialer after call establishment
                setTimeout(() => {
                  setShowDialer(false);
                  setCallFlowStep("closed");
                }, 2000);
              } else if (
                getUserFacingCallStatus(sipCallInRoom) === "ringing" &&
                callFlowStep !== "ringing" &&
                callFlowStep !== "connected" &&
                callFlowStep !== "closed"
              ) {
                setCallFlowStep("ringing");
              }
            } else if (
              sipCallInRoom &&
              outgoingRoom.hasActiveSipCall &&
              outgoingRoom.callData
            ) {
              // Update existing call data (status changes, duration updates, etc.)
              const hasStatusChange =
                outgoingRoom.callData.status !== sipCallInRoom.status;
              const hasDurationChange =
                outgoingRoom.callData.durationSeconds !==
                sipCallInRoom.durationSeconds;

              if (hasStatusChange || hasDurationChange) {
                setOutgoingCallRoom((prev) =>
                  prev
                    ? {
                        ...prev,
                        callData: {
                          ...prev.callData!,
                          status: sipCallInRoom.status,
                          durationSeconds: sipCallInRoom.durationSeconds,
                          onHold: sipCallInRoom.onHold,
                          activeMediaSource: sipCallInRoom.activeMediaSource,
                        },
                      }
                    : null
                );

                if (hasStatusChange) {
                  // Check if call has ended (terminated, failed, completed)
                  const callEndedStatuses = [
                    "TERMINATED",
                    "FAILED",
                    "COMPLETED",
                    "CANCELLED",
                  ];
                  if (
                    callEndedStatuses.includes(
                      sipCallInRoom.status?.toUpperCase() || ""
                    )
                  ) {
                    const hasOtherCallsInRoom = uniqueActiveCalls.some(
                      (call) =>
                        call.roomName === outgoingRoom.roomName &&
                        call.sipCallId !== outgoingRoom.sipCallId
                    );

                    const shouldAutoCloseQuickCallRoom =
                      isQuickCallRoomRef.current &&
                      !hasOtherCallsInRoom &&
                      isRoomCreatedByUs(outgoingRoom.roomName);

                    // Call ended — keep reusable outgoing rooms open; only quick call rooms auto-close.
                    setTimeout(() => {
                      // Safety check: room hasn't been reused for a new active call
                      const roomRef = hookOutgoingCallRoomRef.current;
                      if (roomRef?.hasActiveSipCall && roomRef?.callData?.status === 'CONNECTED') {
                        return; // New call started in room, don't close
                      }
                      clearCallFromRoom();
                      setIsDialing(false);
                      setPhoneNumber("");

                      if (shouldAutoCloseQuickCallRoom) {
                        callLogger.info("Quick call room auto-closing after call ended (status detection)", {
                          isQuickCall: isQuickCallRoomRef.current,
                          roomName: outgoingRoom.roomName,
                          endedStatus: sipCallInRoom?.status,
                        });
                        clearMediaSFUState("quick call ended in outgoing room, auto-closing");
                        clearOutgoingRoom();
                        setOutgoingCallRoom(null);
                        setIsQuickCallRoom(false);
                        setCallFlowStep("closed");
                        if (outgoingRoom.roomName) {
                          setRoomManuallyClosedRef(outgoingRoom.roomName);
                        }
                      } else {
                        callLogger.info("Outgoing room preserved after call ended (status detection)", {
                          isQuickCall: isQuickCallRoomRef.current,
                          roomName: outgoingRoom.roomName,
                          endedStatus: sipCallInRoom?.status,
                        });
                        if (!hasOtherCallsInRoom) {
                          setCallFlowStep("enter-phone");
                        }
                      }
                    }, 1500); // 1.5s delay — lets the user see the final status
                  }
                }
              }
            } else if (sipCallInRoom && outgoingRoom.hasActiveSipCall) {
              // Call still exists and we know about it - reset missing counter
              callMissingCountRef.current.delete(callTrackingId);
            } else if (
              !sipCallInRoom &&
              outgoingRoom.hasActiveSipCall
            ) {
              // Call not found - increment missing counter
              const currentMissingCount = (callMissingCountRef.current.get(callTrackingId) || 0) + 1;
              callMissingCountRef.current.set(callTrackingId, currentMissingCount);

              callLogger.debug(`Call missing from poll ${currentMissingCount}/${CONSECUTIVE_MISSING_THRESHOLD}`, {
                callTrackingId,
                roomName: outgoingRoom.roomName,
                sipCallId: outgoingRoom.sipCallId,
              });

              const directlyConfirmedCall = await confirmCallPresenceDirectly(outgoingRoom);

              if (directlyConfirmedCall) {
                callLogger.info('Call missing from live poll but still present in direct call-state lookup - preserving active room', {
                  callTrackingId,
                  roomName: outgoingRoom.roomName,
                  sipCallId: outgoingRoom.sipCallId,
                  currentMissingCount,
                });

                callMissingCountRef.current.delete(callTrackingId);
                syncCallToRoom(directlyConfirmedCall);
                upsertCurrentCall(directlyConfirmedCall);
                return;
              }

              // Only declare call ended if missing from multiple consecutive polls
              // Quick call rooms use a lower threshold since we expect them to auto-close
              const baseThreshold = isQuickCallRoomRef.current
                ? QUICK_CALL_MISSING_THRESHOLD
                : CONSECUTIVE_MISSING_THRESHOLD;
              const threshold = (isConnectedToRoomRef.current || outgoingRoom.isMediaSFUConnected)
                ? Math.max(baseThreshold, CONNECTED_ROOM_MISSING_THRESHOLD)
                : baseThreshold;
              if (currentMissingCount < threshold) {
                // Not enough consecutive misses yet - don't process as ended
                return;
              }

              // Reset the counter since we're processing now
              callMissingCountRef.current.delete(callTrackingId);

              // CRITICAL: SIP call was found before but now disappeared for multiple polls
              const originalSipCallId = outgoingRoom.sipCallId;
              const callNotificationId = originalSipCallId
                ? `${outgoingRoom.roomName}_${originalSipCallId}`
                : `${outgoingRoom.roomName}_${Date.now()}`;

              // Skip if already processed by fast detection (use ref)
              if (callEndProcessedRef.current === callNotificationId) {
                return; // Already handled by fast detection, don't duplicate
              }

              // Mark as processed to prevent fast detection from duplicating
              setCallEndProcessed(callNotificationId);

              setCurrentCalls((prevCalls) =>
                prevCalls.filter(
                  (call) => !matchesTrackedOutgoingCall(call, outgoingRoom)
                )
              );

              // Use hook method instead of legacy state management
              clearCallFromRoom();

              // Check if there are other calls in the room
              const hasOtherCallsInRoom = uniqueActiveCalls.some(
                (call) =>
                  call.roomName === outgoingRoom.roomName &&
                  call.sipCallId !== outgoingRoom.sipCallId
              );

              // Determine if this is an outgoing setup room we created
              const isOurOutgoingRoom = isRoomCreatedByUs(outgoingRoom.roomName);

              // Keep normal outgoing setup rooms reusable; only quick call rooms auto-close.
              const shouldAutoClose =
                isOurOutgoingRoom &&
                isQuickCallRoomRef.current &&
                !hasOtherCallsInRoom;

              if (shouldAutoClose) {
                clearMediaSFUState(
                  "quick call ended in outgoing room, auto-closing"
                );
              }

              // Auto-close: clear outgoing room state completely
              if (shouldAutoClose) {
                callLogger.info("Quick call room auto-closing after call disappeared from polls", {
                  isQuickCall: isQuickCallRoomRef.current,
                  roomName: outgoingRoom.roomName,
                });
                clearOutgoingRoom();
                setOutgoingCallRoom(null);
                setIsQuickCallRoom(false);
                setCallFlowStep("closed");
                // Prevent auto-recreation
                if (outgoingRoom.roomName) {
                  setRoomManuallyClosedRef(outgoingRoom.roomName);
                }
              } else if (!hasOtherCallsInRoom) {
                callLogger.info("Outgoing room preserved after call disappeared from polls", {
                  isQuickCall: isQuickCallRoomRef.current,
                  roomName: outgoingRoom.roomName,
                });
                setCallFlowStep("enter-phone");
              }

              // Show notification only if not already shown (use ref)
              if (lastCallEndNotificationIdRef.current !== callNotificationId) {
                showNotification(
                  "Call Ended",
                  shouldAutoClose
                    ? "The call has ended and the room has been closed."
                    : "The call has ended. Your voice room is still available for making another call.",
                  "info"
                );

                setLastCallEndNotificationId(callNotificationId);
              }

              // Clear any dialpad state that might be showing
              setIsDialing(false);
              setPhoneNumber(""); // Clear the phone number for next call
            }
          }
        } else {
          consecutiveErrors++;
          callLogger.error(
            `Failed to poll calls (${consecutiveErrors}/${maxErrors}) - cached response failed`
          );

          // Stop polling after too many consecutive errors
          if (consecutiveErrors >= maxErrors) {
            callLogger.error("Too many consecutive errors, stopping polling");
            stopContinuousCallsPolling();
          }
        }
      } catch (error) {
        consecutiveErrors++;
        callLogger.error(
          `Error in continuous calls polling (${consecutiveErrors}/${maxErrors}):`,
          error
        );

        // Stop polling after too many consecutive errors
        if (consecutiveErrors >= maxErrors) {
          callLogger.error("Too many consecutive errors, stopping polling");
          stopContinuousCallsPolling();
        }
      }
    };

    // Initial poll
    pollCalls();

    // Poll every 5 seconds, but only while the tab is visible. Returning to
    // the tab re-polls immediately so call state is never shown stale.
    const cancel = startVisibleInterval(pollCalls, 5000);
    callsPollingIntervalRef.current = cancel;
    setCallsPollingInterval(() => cancel);
  }, [
    stopContinuousCallsPolling,
    addCallToHistory,
    markCallsAsTerminated,
    // Use stable function references only - state values are read via refs
    setBotCallTimeoutRef,
    syncCallToRoom,
    showNotification,
    clearMediaSFUState,
    setCallEndProcessed,
    clearCallFromRoom,
    setLastCallEndNotificationId,
    confirmCallPresenceDirectly,
    getCallsWithCache,
    publishActiveCalls,
    isCallActive,
    isRoomCreatedByUs,
    matchesTrackedOutgoingCall,
    callFlowStep,
    hasObservedRemoteParticipant,
    clearOutgoingRoom,
    upsertCurrentCall,
  ]);

  // Track if polling has been started
  const pollingStartedRef = useRef(false);

  // Start continuous polling when component mounts (only once)
  // Refactored to use refs for state values to prevent re-render loops
  useEffect(() => {
    if (!pollingStartedRef.current) {
      pollingStartedRef.current = true;
      startContinuousCallsPolling();
    }

    return () => {
      stopContinuousCallsPolling();
      pollingStartedRef.current = false;
    };
  }, [startContinuousCallsPolling, stopContinuousCallsPolling]);

  // Enhanced call end detection with faster monitoring for outgoing room calls
  // TEMPORARILY DISABLED for debugging
  /*
  useEffect(() => {
    // Only run enhanced monitoring if we have an active outgoing room with a call
    if (
      !hookOutgoingCallRoom?.isActive ||
      !hookOutgoingCallRoom.hasActiveSipCall
    ) {
      return;
    }

    // Store the current call ID for tracking
    const currentSipCallId = hookOutgoingCallRoom.sipCallId;

    // Use moderate polling for call end detection (4 seconds) since we have
    // caching. Suspended while the tab is hidden; returning re-checks at once.
    const cancelPolling = startVisibleInterval(async () => {
      try {
        // Quick call status check for the specific room using shared cache
        const allCallsResponse = await getCallsWithCache();
        if (allCallsResponse.success && allCallsResponse.data) {
          // Method 1: Check if our specific call still exists and is active by room name
          const currentCallInRoom = allCallsResponse.data.find(
            (call) =>
              (call.roomName === hookOutgoingCallRoom.roomName ||
                call.roomName === hookOutgoingCallRoom.requestedRoomName) &&
              call.status !== "ended" &&
              call.status !== "failed" &&
              call.status !== "completed" &&
              call.status !== "rejected" &&
              call.status !== "terminated" &&
              call.status !== "terminating" &&
              !call.callEnded
          );

          // Method 2: Also check by specific SIP call ID if we have one
          let specificCallExists = false;
          if (currentSipCallId) {
            specificCallExists = allCallsResponse.data.some(
              (call) =>
                call.sipCallId === currentSipCallId &&
                call.status !== "ended" &&
                call.status !== "failed" &&
                call.status !== "completed" &&
                call.status !== "rejected" &&
                call.status !== "terminated" &&
                call.status !== "terminating" &&
                !call.callEnded
            );
          }

          // Call ended if neither room-based nor ID-based detection finds it
          const callEnded =
            !currentCallInRoom &&
            (currentSipCallId ? !specificCallExists : true);

          // If call disappeared and we thought we had one, it ended
          if (callEnded && hookOutgoingCallRoom.hasActiveSipCall) {
            // Create a more reliable notification ID that includes the original SIP call ID from the room
            const originalSipCallId = hookOutgoingCallRoom.sipCallId;
            const callNotificationId = originalSipCallId
              ? `${hookOutgoingCallRoom.roomName}_${originalSipCallId}`
              : `${hookOutgoingCallRoom.roomName}_${Date.now()}`; // Fallback with timestamp

            // Prevent repeated processing of the same call end
            if (callEndProcessed === callNotificationId) {
              return; // Already processed this call end, skip
            }

            // Mark this call end as being processed
            setCallEndProcessed(callNotificationId);

            callLogger.warn(
              `Fast detection: Call ended in room ${hookOutgoingCallRoom.roomName}`,
              {
                method: currentSipCallId ? "room+id" : "room-only",
                sipCallId: currentSipCallId,
                originalSipCallId,
                roomCallFound: !!currentCallInRoom,
                specificCallFound: specificCallExists,
                totalActiveCalls: allCallsResponse.data.length,
                notificationId: callNotificationId,
              }
            );

            // Only show notification if we haven't already shown it for this specific call
            if (lastCallEndNotificationId !== callNotificationId) {
              showNotification(
                "Call Ended",
                "The call has ended. Your voice room is still available for making another call.",
                "info"
              );

              // Mark this notification as shown for this specific call
              setLastCallEndNotificationId(callNotificationId);
            }

            // Preserve the room but mark as no longer having active call
            clearCallFromRoom();

            // Clear call UI state
            setIsDialing(false);
            setPhoneNumber("");
          }
        }
      } catch (error) {
        callLogger.debug("Call monitoring error (non-critical):", error);
      }
    }, 4000); // Check every 4 seconds with caching

    return cancelPolling;
  }, [
    hookOutgoingCallRoom?.isActive,
    hookOutgoingCallRoom?.hasActiveSipCall,
    hookOutgoingCallRoom?.roomName,
    hookOutgoingCallRoom?.requestedRoomName,
    hookOutgoingCallRoom?.sipCallId,
    currentRoomName,
    showNotification,
    lastCallEndNotificationId,
    setLastCallEndNotificationId,
    clearMediaSFUState,
    clearCallFromRoom,
    callEndProcessed,
    setCallEndProcessed,
    getCallsWithCache,
  ]);
  */

  // Background room state verification - clean up stale room state
  // TEMPORARILY DISABLED for debugging
  /*
  useEffect(() => {
    // Only run this check if we think we have an active room
    if (!currentRoomName || !isConnectedToRoom) {
      return;
    }

    const verifyRoomState = () => {
      // Check if room has any active calls associated with it
      const hasCallsInRoom = currentCalls.some(
        (call) => call.roomName === currentRoomName
      );

      // Check if this is our active outgoing setup room (valid even without calls)
      const isOurActiveOutgoingRoom =
        hookOutgoingCallRoom?.isActive &&
        hookOutgoingCallRoom.roomName === currentRoomName;

      // Check if this is a room we created ourselves (valid even without calls initially)
      const wasRoomCreatedByUs = currentRoomName
        ? isRoomCreatedByUs(currentRoomName)
        : false;

      // Room is valid if it has calls OR it's our outgoing setup room OR we created it
      const isValidRoom =
        hasCallsInRoom || isOurActiveOutgoingRoom || wasRoomCreatedByUs;

      // If no calls associated with this room AND it's not our setup room, it might be stale
      if (!isValidRoom) {
        roomLogger.warn(
          "Background check: MediaSFU room has no associated calls and is not our setup room - potential stale state:",
          {
            roomName: currentRoomName,
            isConnected: isConnectedToRoom,
            totalActiveCalls: currentCalls.length,
            allCallRooms: currentCalls.map((c) => c.roomName),
            isOurActiveOutgoingRoom,
            wasRoomCreatedByUs,
            hasCallsInRoom,
            hookOutgoingCallRoom: hookOutgoingCallRoom
              ? {
                  isActive: hookOutgoingCallRoom.isActive,
                  roomName: hookOutgoingCallRoom.roomName,
                  hasActiveSipCall: hookOutgoingCallRoom.hasActiveSipCall,
                }
              : null,
            validation: {
              hasCallsInRoom,
              isOurActiveOutgoingRoom,
              wasRoomCreatedByUs,
              isValidRoom,
            },
          }
        );

        // Clear the stale room state
        clearMediaSFUState(
          "background verification - no associated calls and not our setup room"
        );

        // Clear any related outgoing room state
        if (
          hookOutgoingCallRoom?.isActive &&
          hookOutgoingCallRoom.roomName === currentRoomName
        ) {
          setOutgoingCallRoom(null);
          localStorage.removeItem("outgoingCallRoom");
        }
      } else {
        // Room is valid - log for debugging
        roomLogger.debug("Background check: MediaSFU room is valid:", {
          roomName: currentRoomName,
          hasCallsInRoom,
          isOurActiveOutgoingRoom,
          wasRoomCreatedByUs,
          hookOutgoingCallRoom: hookOutgoingCallRoom
            ? {
                isActive: hookOutgoingCallRoom.isActive,
                roomName: hookOutgoingCallRoom.roomName,
                hasActiveSipCall: hookOutgoingCallRoom.hasActiveSipCall,
              }
            : null,
        });
      }
    };

    // Check immediately and then every 10 seconds
    verifyRoomState();
    // Suspended while hidden; re-verifies immediately on return to the tab.
    return startVisibleInterval(verifyRoomState, 10000);
  }, [
    currentRoomName,
    isConnectedToRoom,
    currentCalls,
    clearMediaSFUState,
    hookOutgoingCallRoom,
    isRoomCreatedByUs,
  ]);
  */

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (callStatusInterval) {
        clearInterval(callStatusInterval);
      }
      if (callsPollingInterval) {
        callsPollingInterval();
      }
      if (roomCreationTimeoutRef) {
        clearTimeout(roomCreationTimeoutRef);
      }
    };
  }, [callStatusInterval, callsPollingInterval, roomCreationTimeoutRef]);

  // Live duration ticking now lives inside <LiveDuration>, which owns a timer
  // per rendered duration instead of re-rendering this entire component once a
  // second. See the component definition near formatDurationWithFallback.

  // Navigation protection - warn when leaving page with active MediaSFU room
  useEffect(() => {
    const hasActiveMediaSFU = isConnectedToRoom && currentRoomName;
    const hasActiveCalls = currentCalls.length > 0;
    const shouldProtect = hasActiveMediaSFU || hasActiveCalls;

    // Browser beforeunload event for page refresh/close
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (shouldProtect) {
        const message = hasActiveMediaSFU
          ? "You have an active MediaSFU room connection. Leaving this page will disconnect you."
          : "You have active calls. Leaving this page may affect your call experience.";

        event.preventDefault();
        event.returnValue = message; // Legacy support
        return message;
      }
    };

    // Add event listener when protection is needed
    if (shouldProtect) {
      window.addEventListener("beforeunload", handleBeforeUnload);

      // Log protection status for debugging
      roomLogger.info("Navigation protection enabled", {
        hasActiveMediaSFU,
        hasActiveCalls,
        currentRoomName,
        isConnectedToRoom,
      });
    }

    // Cleanup
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isConnectedToRoom, currentRoomName, currentCalls.length]);

  // Widget mode: no React Router navigation protection needed
  // The iframe is always on the calls page

  // SIP Configuration State
  const [sipConfigs, setSipConfigs] = useState<SIPConfig[]>([]);
  const [sipLoading, setSipLoading] = useState(false);
  const sipConfigsFetchedRef = useRef(false); // Track if we've fetched to prevent cycling

  // Check if a SIP config is eligible for outgoing calls
  const isEligibleForOutgoing = useCallback((config: SIPConfig) => {
    const isSipActive = config.supportSipActive !== false;
    const allowsOutgoing = config.allowOutgoing !== false;
    return isSipActive && allowsOutgoing;
  }, []);

  // ============================================
  // QUICK CALL FEATURE
  // ============================================

  const startQuickCall = useCallback(() => {
    let fromNumber = selectedFromNumber;
    let usingSystem = isUsingSystemSip;

    if (!fromNumber && sipConfigs.length > 0) {
      const eligible = sipConfigs.find((c) => isEligibleForOutgoing(c));
      const config = eligible || sipConfigs[0];
      fromNumber = config.contactNumber || config.phoneNumber || "";
    }

    if (!fromNumber && sipConfigs.length === 0 && systemSipEligible) {
      fromNumber = "__system_sip__";
      usingSystem = true;
    }

    if (fromNumber) {
      setSelectedFromNumber(fromNumber);
      setIsUsingSystemSip(usingSystem);
    }

    setShowQuickCallDialog(true);
    setQuickCallPhone("");
    setQuickCallContactTab(0);
    setQuickCallSearchQuery("");
  }, [selectedFromNumber, isUsingSystemSip, sipConfigs, systemSipEligible, isEligibleForOutgoing]);

  const closeQuickCallDialog = useCallback(() => {
    setShowQuickCallDialog(false);
    setQuickCallPhone("");
    setQuickCallSearchQuery("");
  }, []);

  // Escape closes the quick call dialog. Without this the only way out was
  // clicking the backdrop or the close button, neither reachable by keyboard
  // in a predictable way.
  useEffect(() => {
    if (!showQuickCallDialog) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeQuickCallDialog();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showQuickCallDialog, closeQuickCallDialog]);

  const initiateQuickCall = useCallback(
    (phone: string) => {
      if (!phone) {
        setNotification({
          isOpen: true,
          title: "Invalid Number",
          message: "Please enter a valid phone number.",
          type: "error",
        });
        return;
      }

      let fromNumber = selectedFromNumber;
      let usingSystem = isUsingSystemSip;

      if (!fromNumber && sipConfigs.length > 0) {
        const eligible = sipConfigs.find((c) => isEligibleForOutgoing(c));
        const config = eligible || sipConfigs[0];
        fromNumber = config.contactNumber || config.phoneNumber || "";
      }

      if (!fromNumber && sipConfigs.length === 0 && systemSipEligible) {
        fromNumber = "__system_sip__";
        usingSystem = true;
      }

      if (!fromNumber) {
        setNotification({
          isOpen: true,
          title: "No Caller ID",
          message: "No phone numbers available. Please configure SIP in Settings.",
          type: "error",
        });
        return;
      }

      setSelectedFromNumber(fromNumber);
      setIsUsingSystemSip(usingSystem);
      setPhoneNumber(phone);
      setShowQuickCallDialog(false);
      setQuickCallPhone("");

      // Flag for auto-trigger — keep dialer hidden during quick call (like Flutter's _showDialer = false)
      setShowDialer(false);
      setIsDialpadCollapsed(true);
      setCallFlowStep("dialing");
      setIsQuickCallRoom(true); // Mark as quick call — auto-close room when call ends
      setQuickCallTriggered(true);
    },
    [selectedFromNumber, isUsingSystemSip, sipConfigs, systemSipEligible, isEligibleForOutgoing]
  );

  // Validate E.164 format
  const isValidE164 = useCallback((phoneNumber: string): boolean => {
    try {
      // Remove any whitespace
      const cleanNumber = phoneNumber.trim();

      // Check if it starts with + (E.164 requirement)
      if (!cleanNumber.startsWith('+')) {
        return false;
      }

      // Use libphonenumber-js for validation
      return isValidPhoneNumber(cleanNumber);
    } catch (error) {
      return false;
    }
  }, []);

  // Format phone number as user types
  const formatPhoneNumber = useCallback((value: string): string => {
    try {
      // Remove all non-digit and non-plus characters
      let cleaned = value.replace(/[^\d+]/g, "");

      // Ensure it starts with +
      if (!cleaned.startsWith("+")) {
        cleaned = "+" + cleaned.replace(/\+/g, "");
      } else {
        // Remove any additional + signs after the first one
        cleaned = "+" + cleaned.substring(1).replace(/\+/g, "");
      }

      // Limit to 16 characters (+ and up to 15 digits for E.164)
      cleaned = cleaned.substring(0, 16);

      // Try to format using libphonenumber-js for better formatting
      if (cleaned.length > 2) {
        const formatter = new AsYouType();
        const formatted = formatter.input(cleaned);
        // If the formatted version is valid and properly formatted, use it
        if (formatted && formatted.startsWith('+')) {
          return formatted;
        }
      }

      return cleaned;
    } catch (error) {
      // Fallback to basic formatting if libphonenumber-js fails
      let cleaned = value.replace(/[^\d+]/g, "");
      if (!cleaned.startsWith("+")) {
        cleaned = "+" + cleaned.replace(/\+/g, "");
      } else {
        cleaned = "+" + cleaned.substring(1).replace(/\+/g, "");
      }
      return cleaned.substring(0, 16);
    }
  }, []);

  // Format phone number for display (international format for readability)
  const formatPhoneNumberForDisplay = useCallback((phoneNumber: string): string => {
    try {
      const cleanNumber = phoneNumber.trim();

      if (!cleanNumber.startsWith('+')) {
        return cleanNumber;
      }

      const parsed = parsePhoneNumber(cleanNumber);
      if (parsed && parsed.isValid()) {
        // Return in international format for display
        return parsed.formatInternational();
      }

      return cleanNumber;
    } catch (error) {
      return phoneNumber;
    }
  }, []);

  // Note: System SIP number allocation now happens server-side in diff_.js
  // CallsPage sends SYSTEM_SIP_DUMMY_NUMBER and the backend resolves the real number

  // Get eligibility reason for display
  const getEligibilityReason = useCallback((config: SIPConfig) => {
    const isSipActive = config.supportSipActive !== false;
    const allowsOutgoing = config.allowOutgoing !== false;

    if (!isSipActive && !allowsOutgoing) {
      return "SIP inactive & outgoing disabled";
    } else if (!isSipActive) {
      return "SIP inactive";
    } else if (!allowsOutgoing) {
      return "Outgoing calls disabled";
    }
    return null;
  }, []);

  // Fetch SIP configurations from MediaSFU
  const fetchSipConfigs = useCallback(async () => {
    if (!config.api.key || !config.api.userName) return;

    setSipLoading(true);
    try {
      let baseUrl = config.api.baseUrl || "https://mediasfu.com";
      // If baseUrl is localhost or IP address, use production instead
      if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1') || /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(baseUrl)) {
        baseUrl = 'https://mediasfu.com';
      }
      const url = new URL(`${baseUrl}/v1/sipconfigs/`);
      url.searchParams.append("action", "get");
      url.searchParams.append("startIndex", "0");
      url.searchParams.append("pageSize", "20");

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.api.userName}:${config.api.key}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.sipConfigs) {
          setSipConfigs(data.sipConfigs);
          // Auto-select first eligible number for outgoing calls
          if (data.sipConfigs.length > 0 && !selectedFromNumber) {
            const eligibleConfig = data.sipConfigs.find(
              (config: SIPConfig) =>
                config.supportSipActive !== false &&
                config.allowOutgoing !== false
            );
            if (eligibleConfig) {
              setSelectedFromNumber(
                eligibleConfig.contactNumber || eligibleConfig.phoneNumber || ""
              );
            }
          }

          // Auto-select system SIP when no own configs but eligible
          if (data.sipConfigs.length === 0 && systemSipEligible && !selectedFromNumber) {
            setSelectedFromNumber('__system_sip__');
            setIsUsingSystemSip(true);
          }
        }
      }
    } catch (error) {
      callLogger.error("Failed to fetch SIP configs:", error);
    } finally {
      setSipLoading(false);
    }
  }, [config.api.key, config.api.userName, selectedFromNumber, systemSipEligible]);

  // Fetch SIP configs on mount (only once when API is configured)
  useEffect(() => {
    if (isApiConfigured && !sipConfigsFetchedRef.current) {
      sipConfigsFetchedRef.current = true;
      fetchSipConfigs();
    }
  }, [isApiConfigured]); // Remove fetchSipConfigs from deps to prevent cycling

  // Auto-clear manually closed room flag after 30 seconds
  useEffect(() => {
    if (roomManuallyClosedRef) {
      const timeoutId = setTimeout(() => {
        setRoomManuallyClosedRef(null);
      }, 30000);

      return () => clearTimeout(timeoutId);
    }
  }, [roomManuallyClosedRef]);

  const handleMakeCall = async () => {
    // Update flow to dialing step (first phase — Flutter-matching progression)
    setCallFlowStep("dialing");

    if (!phoneNumber || !callManager || !selectedFromNumber) {
      // Reset call flow step and stop loading
      setCallFlowStep("choose-mode");
      setIsDialing(false);
      return;
    }

    // Validate E.164 format
    if (!isValidE164(phoneNumber)) {
      callLogger.error(
        "Invalid phone number format. Must be E.164 format (e.g., +15551234567)"
      );
      showNotification(
        "Invalid Phone Number",
        "Please enter a valid phone number in E.164 format (e.g., +15551234567)",
        "error"
      );
      setCallFlowStep("enter-phone");
      setIsDialing(false);
      return;
    }

    // SYSTEM SIP PATH: Send dummy number — backend (diff_.js) resolves the real number
    let selectedConfig: SIPConfig | null = null;
    let useSystemSipForCall = false;
    let systemSipUsernameForCall: string | null = null;

    if (isUsingSystemSip && selectedFromNumber === '__system_sip__') {
      callLogger.info('Using system SIP — sending dummy number, backend will resolve real number');
      useSystemSipForCall = true;
      systemSipUsernameForCall = systemSipUsername || null;

      // Create a synthetic SIP config with the dummy number
      // The backend will replace this with the real allocated number
      selectedConfig = {
        id: 'system_sip_pending',
        contactNumber: SYSTEM_SIP_DUMMY_NUMBER,
        phoneNumber: SYSTEM_SIP_DUMMY_NUMBER,
        provider: 'system',
        supportSipActive: true,
        allowOutgoing: true,
        isSystem: true,
        // Force no AI bot mode for system SIP
        autoAgent: { enabled: false },
      } as unknown as SIPConfig;
    } else {
      // NORMAL PATH: Use user's own SIP config
      selectedConfig = sipConfigs.find(
        (config) =>
          (config.contactNumber || config.phoneNumber) === selectedFromNumber
      ) || null;
    }

    if (!selectedConfig) {
      callLogger.error("No SIP configuration found for selected number");
      showNotification(
        "Configuration Error",
        "No SIP configuration found for the selected number. Please try a different number.",
        "error"
      );
      setCallFlowStep("select-number");
      setIsDialing(false);
      return;
    }

    // Check if we're trying to create a room that was manually closed
    if (roomManuallyClosedRef) {
      showNotification(
        "Room Closed",
        "The previous room was manually closed. Please wait or use a different approach.",
        "warning"
      );
      setCallFlowStep("choose-mode");
      setIsDialing(false);
      return;
    }

    if (!useSystemSipForCall && !isEligibleForOutgoing(selectedConfig)) {
      callLogger.error("Selected number is not eligible for outgoing calls");
      showNotification(
        "Number Not Eligible",
        "The selected number is not eligible for outgoing calls. Please select a different number.",
        "error"
      );
      setCallFlowStep("select-number");
      setIsDialing(false);
      return;
    }

    // Room check removed — the room-creation flow below (Step 1 else branch)
    // automatically creates an outgoing call room when no room is connected.
    // This allows Quick Call and other auto-call flows to work without a pre-existing room.

    setIsDialing(true);

    // Clear API cache to ensure fresh data for call initiation
    clearApiCache();

    // Reset call end notification ID when starting a new call
    setLastCallEndNotificationId(null);

    // Reset call end processing flag for new call
    setCallEndProcessed(null);

    // Auto-collapse dialpad when call starts
    setIsDialpadCollapsed(true);

    // Check if we're making a call from an outgoing setup room without microphone enabled
    const isInOutgoingSetupRoom =
      hookOutgoingCallRoom?.isActive &&
      isConnectedToRoom &&
      currentRoomName === hookOutgoingCallRoom.roomName;
    const selectedMicrophoneProceedMode = microphoneProceedModeRef.current;
    const microphoneOffInOutgoingRoom =
      isInOutgoingSetupRoom && !isMicrophoneEnabledRef.current;

    // If we're in an outgoing setup room but microphone is off, ask for confirmation.
    if (microphoneOffInOutgoingRoom && !selectedMicrophoneProceedMode) {
      callLogger.warn(
        "Making call from outgoing setup room with microphone disabled - requesting user confirmation"
      );

      setMicrophoneConfirmation({
        isOpen: true,
        isProcessing: false,
        mode: null,
      });

      return;
    }

    microphoneProceedModeRef.current = null;

    try {
      let roomName: string;
      let participantName: string;

      // Step 1: Use outgoing call room if available, otherwise create one
      if (
        outgoingCallRoom?.isActive &&
        isConnectedToRoom &&
        currentRoomName === outgoingCallRoom.roomName
      ) {
        // Use the active outgoing call room - validate we're actually connected to it
        roomName = outgoingCallRoom.roomName; // This is the real MediaSFU room name
        participantName = currentParticipantName;
      } else if (isConnectedToRoom && currentRoomName) {
        // User is connected to some other MediaSFU room - use it
        roomName = currentRoomName;
        participantName = currentParticipantName;
      } else {
        // No room available - determine approach based on autoAgent configuration
        // Transition to resolving phase — matching call with room
        setCallFlowStep("resolving");
        const autoAgent = selectedConfig.autoAgent;
        const autoAgentAvailable =
          autoAgent?.enabled &&
          autoAgent.type &&
          (autoAgent.type === "AI" ||
            autoAgent.type === "IVR" ||
            autoAgent.type === "PLAYBACK");
        const botModeValidForOutgoing =
          autoAgentAvailable && autoAgent?.outgoingType === "AI";
          //&& !isQuickCallRoomRef.current; // Quick calls always use human voice mode

        if (botModeValidForOutgoing) {
          // Option 2: Using bot - create room via API to get valid room name

          // CRITICAL FIX: Use the same participant name for both room creation and call making
          // Ensure the participant name is properly formatted for MediaSFU
          const rawParticipantName = currentParticipantName || "voipuser";
          const callParticipantName =
            rawParticipantName.replace(/[^a-zA-Z0-9]/g, "").substring(0, 10) ||
            "voipuser";

          // For bot calls, create a real MediaSFU room via direct API call
          const roomResult = await callManager.createOrUseMediaRoom({
            sipConfig: selectedConfig,
            participantName: callParticipantName,
            duration: selectedDuration || 30
          });

          if (!roomResult.success || !roomResult.roomName) {
            throw new Error(roomResult.error || "Failed to create MediaSFU room for bot call");
          }

          roomName = roomResult.roomName;
          participantName = roomResult.participantName || callParticipantName;

          callLogger.info("Created MediaSFU room for bot call:", {
            roomName,
            participantName,
            duration: selectedDuration || 30
          });
        } else {
          // Option 1: Using own audio - create outgoing call room and render media room

          // CRITICAL FIX: Use the same participant name for both room creation and call making
          // Ensure the participant name is properly formatted for MediaSFU
          const rawParticipantName = currentParticipantName || "voipuser";
          const callParticipantName =
            rawParticipantName.replace(/[^a-zA-Z0-9]/g, "").substring(0, 10) ||
            "voipuser";

          // Generate temporary room name - MediaSFU will provide the real one
          // (temp name is only used for local widget rendering; the real name comes from MediaSFU SDK)
          const tempRoomName = `outgoing_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 6)}`;
          const displayName = `Outgoing Call Room (${callParticipantName})`;

          // Use hook's createOutgoingRoom to setup room state
          createOutgoingRoom(tempRoomName, displayName);

          // Mark room as created by us so isRoomCreatedByUs() returns true
          // (required for MediaSFURoomDisplay render condition)
          markRoomAsCreated(tempRoomName);

          // Set room state for MediaSFU - MediaSFUHandler will create the actual room
          setRequestedRoomName(tempRoomName);
          setCurrentRoomName(tempRoomName);
          setCurrentParticipantName(callParticipantName);
          setIsCreatingRoom(true); // CRITICAL: must be true so MediaSFURoomDisplay renders

          participantName = callParticipantName;

          // Wait for MediaSFU to connect and return the real room name (matching Flutter's _waitForMediaSFUConnection)
          // The MediaSFURoomDisplay widget will:
          //   1. Create the real room via MediaSFU SDK
          //   2. Fire onRoomNameUpdate(realRoomName) → updates currentRoomNameRef
          //   3. Fire onConnectionStatusChange(true) → updates isConnectedToRoomRef
          const POLL_INTERVAL_MS = 200;
          const TIMEOUT_MS = 30000; // 30 seconds, same as Flutter
          const startTime = Date.now();
          let connected = false;

          while (Date.now() - startTime < TIMEOUT_MS) {
            const roomRef = hookOutgoingCallRoomRef.current;
            const connectedNow = isConnectedToRoomRef.current || roomRef?.isMediaSFUConnected;
            const realName = roomRef?.roomName || currentRoomNameRef.current;
            const hasRealName = realName && realName !== tempRoomName;


            if (connectedNow && hasRealName) {
              connected = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
          }

          setIsCreatingRoom(false); // Room creation phase complete

          if (!connected) {
            throw new Error("Could not connect to voice room. Timed out after 30 seconds.");
          }

          // Read the REAL room name that MediaSFU assigned (via onRoomNameUpdate → handleRoomNameUpdate)
          roomName = hookOutgoingCallRoomRef.current?.roomName || currentRoomNameRef.current || tempRoomName;

          // Room is connected — transition to connecting phase
          setCallFlowStep("connecting");
        }
      }

      // Step 2: Determine startWithInitiatorAudio based on MediaSFU room state and autoAgent configuration
      const autoAgent = selectedConfig.autoAgent;
      const autoAgentAvailable =
        autoAgent?.enabled &&
        autoAgent.type &&
        (autoAgent.type === "AI" ||
          autoAgent.type === "IVR" ||
          autoAgent.type === "PLAYBACK");
      const botModeValidForOutgoing =
        autoAgentAvailable && autoAgent?.outgoingType === "AI";
        //&& !isQuickCallRoomRef.current; // Quick calls always use human voice mode

      const shouldProceedMuted = selectedMicrophoneProceedMode === "muted";
      const shouldUnmuteBeforeProceeding = selectedMicrophoneProceedMode === "unmute";
      let microphoneEnabledForCall = isMicrophoneEnabledRef.current;

      // AUTO-UNMUTE: For non-bot calls, automatically unmute the microphone before placing the call.
      // This follows Flutter's _executeAutoCallFlow() pattern:
      //   1. Set autoUnmute=true on MediaSFURoomDisplay
      //   2. Wait for onAutoUnmuteComplete callback (up to 10s timeout)
      //   3. Proceed with call using mic-enabled state
      if (shouldUnmuteBeforeProceeding && isConnectedToRoomRef.current && !microphoneEnabledForCall) {
        const autoUnmuteSuccess = await triggerAutoUnmuteForCall(250);

        if (!autoUnmuteSuccess) {
          microphoneProceedModeRef.current = null;
          setMicrophoneConfirmation((current) => ({
            ...current,
            isProcessing: false,
            mode: null,
          }));
          showNotification(
            "Unable to Unmute",
            "We couldn't enable your microphone. Please unmute manually or use Proceed Muted.",
            "warning"
          );
          setCallFlowStep("choose-mode");
          setIsDialing(false);
          return;
        }

        microphoneEnabledForCall = true;
      } else if (!shouldProceedMuted && !botModeValidForOutgoing && isConnectedToRoomRef.current && !microphoneEnabledForCall) {
        const autoUnmuteSuccess = await triggerAutoUnmuteForCall();
        microphoneEnabledForCall = autoUnmuteSuccess || isMicrophoneEnabledRef.current;
      }

      if (selectedMicrophoneProceedMode && microphoneConfirmation.isOpen) {
        closeMicrophoneConfirmation();
      }

      // startWithInitiatorAudio: true if user is connected to MediaSFU room with microphone enabled,
      // or if no valid bot mode is available
      // This ensures the user has control over their audio participation
      // Use ref for isConnectedToRoom since state may have changed during async room creation above
      const startWithInitiatorAudio =
        shouldProceedMuted
          ? false
          : !botModeValidForOutgoing || (isConnectedToRoomRef.current && microphoneEnabledForCall);

      if (!startWithInitiatorAudio) {
        //wait for 250ms
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      // Step 3: Make the call using the enhanced callService with proper parameters
      // remove any spaces and characters from phone number aside the leading +
      const phoneNumberCleaned = phoneNumber.replace(/[^\d+]/g, "");
      // For system SIP, use the allocated real number; otherwise use selected from number
      const callerIdForCall = useSystemSipForCall && selectedConfig
        ? (selectedConfig.contactNumber || selectedConfig.phoneNumber || '').replace(/[^\d+]/g, "")
        : selectedFromNumber.replace(/[^\d+]/g, "");

      const result = await callService.makeCallWithOptions(
        phoneNumberCleaned, // calledDid (E.164 format)
        callerIdForCall, // callerIdNumber - real number for system SIP
        roomName, // roomName (MediaSFU room)
        participantName, // initiatorName
        {
          startWithInitiatorAudio, // Whether the initiator (user) starts with audio
          calleeDisplayName: "sipcallee",
          useBackupPeer: false,
          // System SIP fields for MediaSFU shared number billing
          ...(useSystemSipForCall && {
            useSystemSip: true,
            systemSipUsername: systemSipUsernameForCall || undefined,
          }),
        }
      );

      if (result.success) {
        const callType = botModeValidForOutgoing ? "AI agent" : "human";
        const roomSource =
          isConnectedToRoom && currentRoomName ? "existing" : "new";

        callLogger.info(
          `Call initiated successfully (${callType} mode) using ${roomSource} room: ${roomName}`
        );

        // Clear room manually closed flag on successful call initiation
        if (roomManuallyClosedRef) {
          roomLogger.info(
            "Clearing room manually closed flag after successful call initiation"
          );
          setRoomManuallyClosedRef(null);
        }

        // Start monitoring call status with the room name
        // The actual room name will be updated via onRoomNameUpdate callback from MediaSFU
        if (result.data?.sipCallId) {
          startCallMonitoring(result.data.sipCallId, roomName);

          // For bot calls, set up timeout detection (60 seconds) - no outgoing room state needed
          if (!startWithInitiatorAudio) {
            const timeoutId = setTimeout(() => {
              // Check if call is still in waiting state after 60 seconds
              const currentCall = currentCalls.find(
                (call) =>
                  call.sipCallId === result.data.sipCallId ||
                  call.roomName === roomName
              );

              if (
                currentCall &&
                (currentCall.status === "connecting" ||
                  currentCall.status === "ringing")
              ) {
                callLogger.warn(
                  "Bot call timeout after 60 seconds - marking as failed"
                );
                showNotification(
                  "Call Timeout",
                  "Call attempt timed out after 60 seconds",
                  "warning"
                );
              }
            }, 60000); // 60 seconds

            setBotCallTimeoutRef(timeoutId);
          }

          // Update outgoing call room with SIP call ID and initial call data (only for human calls)
          if (startWithInitiatorAudio && outgoingCallRoom?.isActive) {
            setOutgoingCallRoom((prev) =>
              prev
                ? {
                    ...prev,
                    hasActiveSipCall: true,
                    sipCallId: result.data.sipCallId,
                    callData: {
                      status: "CONNECTING",
                      direction: "OUTGOING",
                      calledUri: phoneNumber,
                      callerIdRaw: selectedFromNumber,
                      startTimeISO: new Date().toISOString(),
                      durationSeconds: 0,
                      onHold: false,
                      activeMediaSource: startWithInitiatorAudio
                        ? "human"
                        : "agent",
                      humanParticipantName: participantName,
                    },
                  }
                : null
            );
          }
        } else {
          // If no sipCallId returned immediately, wait for it to appear in call polling
          // This can happen with some SIP providers that return call ID after initial setup
          callLogger.warn(
            "No sipCallId returned immediately, will wait for call polling to detect it",
            {
              roomName,
              phoneNumber,
            }
          );

          // Start a short-term monitoring to detect when the call appears with a proper ID
          let attempts = 0;
          const maxAttempts = 10; // 10 attempts over 30 seconds

          const waitForCallId = setInterval(async () => {
            attempts++;
            try {
              const allCalls = await getCallsWithCache();
              if (allCalls.success && allCalls.data) {
                // Look for a call that matches our EXACT room name only
                // This ensures we only detect calls that are actually part of our current room
                const detectedCall = allCalls.data.find(
                  (c) => c.roomName === roomName
                );

                if (detectedCall && detectedCall.sipCallId) {
                  clearInterval(waitForCallId);
                  startCallMonitoring(
                    detectedCall.sipCallId,
                    detectedCall.roomName
                  );

                  // Update current room name if the call was created in a different room
                  if (detectedCall.roomName !== roomName) {
                    setCurrentRoomName(detectedCall.roomName);
                  }

                  // Update outgoing room with detected call data
                  if (outgoingCallRoom?.isActive) {
                    setOutgoingCallRoom((prev) =>
                      prev
                        ? {
                            ...prev,
                            hasActiveSipCall: true,
                            sipCallId: detectedCall.sipCallId,
                            roomName: detectedCall.roomName, // Use the actual room name
                            callData: {
                              status: detectedCall.status,
                              direction: detectedCall.direction,
                              calledUri: detectedCall.calledUri,
                              callerIdRaw: detectedCall.callerIdRaw,
                              startTimeISO: detectedCall.startTimeISO,
                              durationSeconds: detectedCall.durationSeconds,
                              onHold: detectedCall.onHold,
                              activeMediaSource: detectedCall.activeMediaSource,
                              humanParticipantName:
                                detectedCall.humanParticipantName,
                            },
                          }
                        : null
                    );
                  }
                  return;
                }
              }

              if (attempts >= maxAttempts) {
                clearInterval(waitForCallId);
                callLogger.warn(
                  "Failed to detect call with sipCallId after maximum attempts",
                  {
                    attempts,
                    roomName,
                  }
                );
              }
            } catch (error) {
              callLogger.error("Error while waiting for call ID:", error);
            }
          }, 3000); // Check every 3 seconds
        }

        setPhoneNumber(""); // Reset to + instead of empty

        // Keep the UI in ringing until the remote side actually answers.
        setCallFlowStep("ringing");
      } else {
        // Handle API response with success: false
        callLogger.error(
          "Failed to initiate call - API returned success: false:",
          result.error || result
        );
        setIsDialpadCollapsed(false); // Expand dialpad on failure

        // Show user-friendly notification for call failure
        showNotification(
          "Call Failed",
          result.error ||
            "The outgoing call could not be initiated. Please try again.",
          "error"
        );

        // Keep the outgoing room alive so users can correct the number and retry immediately.
        // We only clear any tracked SIP call metadata for the failed attempt.
        if (startWithInitiatorAudio && outgoingCallRoom?.isActive) {
          clearCallFromRoom();
          resetSipParticipantTracking();
        }

        // Return to phone entry so retry is immediate.
        setCallFlowStep("enter-phone");
      }
    } catch (error) {
      callLogger.error("Failed to make call:", error);
      setIsDialpadCollapsed(false); // Expand dialpad on failure

      // Return to choose-mode step on error
      setCallFlowStep("choose-mode");
    } finally {
      setIsDialing(false);
    }
  };

  const closeMicrophoneConfirmation = useCallback(() => {
    setMicrophoneConfirmation({
      isOpen: false,
      isProcessing: false,
      mode: null,
    });
  }, []);

  const handleMicrophoneGoBack = useCallback(() => {
    if (microphoneConfirmation.isProcessing) {
      return;
    }

    microphoneProceedModeRef.current = null;
    closeMicrophoneConfirmation();
    setCallFlowStep("choose-mode");
    setIsDialing(false);
  }, [closeMicrophoneConfirmation, microphoneConfirmation.isProcessing]);

  const retryMakeCallWithMicrophoneMode = useCallback(
    (mode: Exclude<MicrophoneProceedMode, null>) => {
      if (microphoneConfirmation.isProcessing) {
        return;
      }

      microphoneProceedModeRef.current = mode;
      setMicrophoneConfirmation({
        isOpen: true,
        isProcessing: true,
        mode,
      });
      setTimeout(() => {
        handleMakeCall();
      }, 0);
    },
    [handleMakeCall, microphoneConfirmation.isProcessing]
  );

  // Quick Call trigger — fires handleMakeCall after state is settled
  useEffect(() => {
    if (quickCallTriggered) {
      setQuickCallTriggered(false);
      handleMakeCall();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickCallTriggered]);

  const handleMicrophoneChange = useCallback((enabled: boolean) => {
    setIsMicrophoneEnabled(enabled);
  }, []);

  const handleRoomNameUpdate = useCallback(
    (realRoomName: string) => {
      const previousRoomName = currentRoomName;
      setCurrentRoomName(realRoomName);

      // If this is a real room name for a room we created, mark the new name as created by us too
      if (
        requestedRoomName &&
        isRoomCreatedByUs(requestedRoomName) &&
        realRoomName !== requestedRoomName
      ) {
        markRoomAsCreated(realRoomName);
      }

      // Update outgoing call room with real MediaSFU room name using hook
      if (
        outgoingCallRoom?.isActive &&
        outgoingCallRoom.requestedRoomName &&
        (previousRoomName === outgoingCallRoom.requestedRoomName ||
          previousRoomName === outgoingCallRoom.roomName)
      ) {
        updateRoomName(realRoomName);
      }

      // Update any active call monitoring to use the real room name
      if (callStatusInterval && previousRoomName !== realRoomName) {
        // Don't restart monitoring here - let it continue with the current sipCallId
        // The monitoring will pick up calls by roomName automatically
      }
    },
    [
      currentRoomName,
      requestedRoomName,
      outgoingCallRoom,
      callStatusInterval,
      updateRoomName,
      isRoomCreatedByUs,
      markRoomAsCreated,
    ]
  );

  const handleRoomDisconnect = useCallback(
    (reason?: {
      type: "user" | "room-ended" | "socket-error";
      details?: string;
    }) => {
      // Enhanced room disconnect with state preservation logic based on actual disconnect reason
      const roomEnded =
        reason?.type === "room-ended" || reason?.type === "socket-error";

      // Auto-detect room ending if no reason provided (backward compatibility)
      let finalRoomEnded = roomEnded;
      if (!reason) {
        const appearsToBeRoomEnding = !isConnectedToRoom || !currentRoomName;
        if (appearsToBeRoomEnding) {
          finalRoomEnded = true;
        }
      }

      const hasActiveCalls = currentCalls.length > 0;
      const isOurOutgoingRoom =
        outgoingCallRoom?.isActive &&
        currentRoomName === outgoingCallRoom.roomName;

      // Determine if this room has active SIP calls that belong to it
      const roomHasActiveSipCalls = currentCalls.some(
        (call) => call.roomName === currentRoomName
      );

      // Check if this is specifically our media booth (outgoing room setup for voice calls)
      const isOurMediaBooth =
        isOurOutgoingRoom &&
        outgoingCallRoom?.displayName?.includes("Outgoing Call Room");

      // CRITICAL: Don't show notifications or clear state if we're just switching rooms
      if (isRoomSwitching) {
        roomLogger.info(
          "Room disconnect during room switching - suppressing notifications",
          {
            currentRoom: currentRoomName,
            reason: reason?.details || "Room switching in progress",
          }
        );
        return;
      }

      // CRITICAL: If the MediaSFU room itself has ended, ALWAYS clear state
      // The room no longer exists so there's no point in trying to preserve the connection
      if (finalRoomEnded) {
        clearMediaSFUState(
          `MediaSFU room ended: ${reason?.details || "Unknown reason"}`
        );

        // Show notification for connection timeout or other socket errors
        if (
          reason?.type === "socket-error" &&
          reason?.details?.includes("timeout")
        ) {
          showNotification(
            "Connection Failed",
            "Room creation timed out. Please check your internet connection and try again.",
            "error"
          );
        } else if (reason?.type === "socket-error") {
          showNotification(
            "Connection Error",
            reason?.details ||
              "Failed to connect to the media room. Please try again.",
            "error"
          );
        }

        // Clear outgoing room state if this was our outgoing room
        if (isOurOutgoingRoom) {
          clearOutgoingRoom();
          setOutgoingCallRoom(null);
          setRoomManuallyClosedRef(currentRoomName);

          // Clear bot call timeout if active
          if (botCallTimeoutRef) {
            clearTimeout(botCallTimeoutRef);
            setBotCallTimeoutRef(null);
          }
        }

        return;
      }

      // For user-initiated disconnects, use the existing logic:
      // 1. For incoming calls: Always allow disconnect (they can leave safely without ending call)
      // 2. For our media booth with active calls: Warn user as disconnecting might end the call
      // 3. For our media booth without active calls: Allow disconnect (setup cancellation)
      // 4. For other outgoing rooms: Use standard logic
      if (isOurMediaBooth && roomHasActiveSipCalls) {
        // This is OUR media booth with active calls - warn user as disconnecting might end the call
        roomLogger.warn(
          "Our media booth disconnect requested with active calls - may end call"
        );
        showNotification(
          "Disconnect Warning",
          'Disconnecting from this media booth may end the active call since you created it. Use "End Call" button to properly terminate the call first.',
          "warning"
        );
        return;
      }

      // Safe to disconnect in these cases:
      // - No active calls
      // - Incoming call room (safe to leave)
      // - Outgoing room without active calls (setup cancellation)
      clearMediaSFUState("manual room disconnect");

      // CRITICAL: Clear outgoing room state when disconnecting
      if (isOurOutgoingRoom) {
        roomLogger.info(
          "Clearing outgoing room state on disconnect - room manually closed"
        );
        clearOutgoingRoom();
        setOutgoingCallRoom(null);
        // Also clear from localStorage
        localStorage.removeItem("mediasfu_outgoing_room");

        // Set flag to prevent auto-recreation for bot calls
        setRoomManuallyClosedRef(currentRoomName);

        // Clear bot call timeout if active
        if (botCallTimeoutRef) {
          clearTimeout(botCallTimeoutRef);
          setBotCallTimeoutRef(null);
        }
      }

      roomLogger.info("Disconnected from MediaSFU room", {
        clearedOutgoingRoom: isOurOutgoingRoom,
        wasIncomingRoom: !isOurOutgoingRoom && hasActiveCalls,
      });
    },
    [
      currentCalls,
      currentRoomName,
      outgoingCallRoom,
      botCallTimeoutRef,
      showNotification,
      clearMediaSFUState,
      clearOutgoingRoom,
      isConnectedToRoom,
      isRoomSwitching,
    ]
  );

  // Manual room connection for testing - Enhanced with outgoing call room pattern
  const handleConnectToRoom = useCallback(async () => {
    if (!selectedFromNumber) {
      callLogger.warn("Please select a number first");
      return;
    }

    // ENHANCED ROOM VALIDATION: Check for existing valid rooms more thoroughly
    const hasActiveConnection = isConnectedToRoom && currentRoomName;
    const hasValidOutgoingRoom =
      hookOutgoingCallRoom?.isActive &&
      hookOutgoingCallRoom?.isMediaSFUConnected &&
      isConnectedToRoom &&
      currentRoomName === hookOutgoingCallRoom?.roomName;

    // Check if current room name is a valid MediaSFU room (starts with 's' or 'p', alphanumeric)
    const isCurrentRoomValidMediaSFU =
      currentRoomName && /^[sp][a-zA-Z0-9]+$/.test(currentRoomName);

    // If we have a valid MediaSFU room that's connected, don't create another one
    if (hasActiveConnection && isCurrentRoomValidMediaSFU) {
      roomLogger.info(
        "Already connected to valid MediaSFU room, not creating new one:",
        {
          currentRoom: currentRoomName,
          isConnected: isConnectedToRoom,
          isValidMediaSFUFormat: isCurrentRoomValidMediaSFU,
        }
      );
      showNotification(
        "Already Connected",
        `You're already connected to room: ${currentRoomName}`,
        "info"
      );
      return;
    }

    // Check if room creation is already in progress (prevent spam clicking)
    if (isCreatingRoom) {
      roomLogger.warn("Room creation already in progress");
      return;
    }

    // Only block if we have a VALID connection with actual purpose (calls or valid outgoing room)
    const shouldBlockForActiveRoom =
      hasValidOutgoingRoom ||
      (hasActiveConnection &&
        currentCalls.some((call) => call.roomName === currentRoomName));

    if (shouldBlockForActiveRoom) {
      showNotification(
        "Room Active",
        "You're already connected to an active room with ongoing calls",
        "warning"
      );
      return;
    }

    // Clean up any stale connections before creating new room
    if (
      hasActiveConnection &&
      !hasValidOutgoingRoom &&
      !isCurrentRoomValidMediaSFU
    ) {
      roomLogger.warn(
        "Detected stale room connection - cleaning up before creating new room:",
        {
          staleRoom: currentRoomName,
          isConnected: isConnectedToRoom,
          hasAssociatedCalls: currentCalls.some(
            (call) => call.roomName === currentRoomName
          ),
        }
      );

      clearMediaSFUState("cleaning stale room before new creation");

      if (hookOutgoingCallRoom?.isActive) {
        setOutgoingCallRoom(null);
        localStorage.removeItem("outgoingCallRoom");
      }
    }

    const selectedConfig = isUsingSystemSip
      ? null  // System SIP doesn't need own SIP config for room creation
      : sipConfigs.find(
          (config) =>
            (config.contactNumber || config.phoneNumber) === selectedFromNumber
        );

    if (!selectedConfig && !isUsingSystemSip) {
      callLogger.error("No SIP configuration found for selected number");
      return;
    }

    try {
      // Clear any previous error state and set loading
      setRoomCreationError(null);
      setIsCreatingRoom(true);

      roomLogger.info("Setting up outgoing call room for call preparation...");

      // Generate participant name
      const participantName = currentParticipantName || "voipuser";

      // Generate a temporary room name - MediaSFU will provide the real one via MediaSFUHandler
      const tempRoomName = `outgoing_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 6)}`;
      const displayName = `Outgoing Call Room (${participantName})`;

      // Use hook's createOutgoingRoom to setup room state
      createOutgoingRoom(tempRoomName, displayName);

      // Mark this room as created by us for proper UI display
      markRoomAsCreated(tempRoomName);

      // Set room state for MediaSFU - the MediaSFUHandler with action="create" will handle room creation
      setRequestedRoomName(tempRoomName);
      setCurrentRoomName(tempRoomName);
      setCurrentParticipantName(participantName);

      roomLogger.info("Outgoing call room setup initiated:", {
        tempRoomName,
        displayName,
        participantName,
        duration: selectedDuration || 30,
        note: "MediaSFUHandler with action='create' will create the actual room",
      });

      // Set up a timeout to handle creation failure
      const creationTimeout = setTimeout(() => {
        setIsCreatingRoom(false);
        setRoomCreationError("Room creation timed out. Please try again.");
        setRoomCreationTimeoutRef(null); // Clear the timeout ref
        roomLogger.error("Room creation timed out after 60 seconds");
      }, 60000); // 60 second timeout (1 minute)

      // Store timeout ref for cleanup
      setRoomCreationTimeoutRef(creationTimeout);

      // CRITICAL FIX: Give React time to render the MediaSFURoomDisplay component
      // which will trigger the actual room creation via MediaSFU

      // Small delay to ensure state updates are processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      roomLogger.info(
        "Room setup complete - MediaSFURoomDisplay should now be visible and connecting...",
        {
          currentRoomName,
          isConnectedToRoom,
          tempRoomName,
        }
      );

      // hide the dialer when room is created
      setShowDialer(false);
    } catch (error) {
      setIsCreatingRoom(false);
      setRoomCreationError(`Failed to setup room: ${(error as Error).message}`);
      // Clear timeout if it was set
      if (roomCreationTimeoutRef) {
        clearTimeout(roomCreationTimeoutRef);
        setRoomCreationTimeoutRef(null);
      }
      callLogger.error("Error setting up outgoing call room:", error);
      showNotification(
        "Room Setup Failed",
        `Failed to setup voice room: ${(error as Error).message}`,
        "error"
      );
    }
  }, [
    selectedFromNumber,
    sipConfigs,
    isConnectedToRoom,
    currentRoomName,
    isCreatingRoom,
    hookOutgoingCallRoom?.isActive,
    hookOutgoingCallRoom?.isMediaSFUConnected,
    hookOutgoingCallRoom?.roomName,
    currentParticipantName,
    createOutgoingRoom,
    selectedDuration,
    showNotification,
    markRoomAsCreated,
    roomCreationTimeoutRef,
    clearMediaSFUState,
    currentCalls,
  ]);

  const dialpadButtons = [
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "*",
    "0",
    "#",
    "+", // Added + for international dialing
  ];

  const handleDialpadClick = (digit: string) => {
    const newValue = formatPhoneNumber(phoneNumber + digit);
    setPhoneNumber(newValue);
  };

  // Create combined calls array including outgoing call room (simplified approach)
  const allDisplayCalls = useMemo(() => {
    // Use enhanced calls from hook which includes dummy calls
    return [...enhancedCurrentCalls]; // Simplified - just return enhanced calls
  }, [enhancedCurrentCalls]); // Reduced dependencies

  useEffect(() => {
    allDisplayCallsRef.current = allDisplayCalls;
  }, [allDisplayCalls]);

  useEffect(() => {
    publishActiveCalls(allDisplayCalls);
  }, [allDisplayCalls, publishActiveCalls]);

  if (!isApiConfigured) {
    return (
      <div className="calls-page">
        <div className="not-configured card">
          <h2>API Not Configured</h2>
          <p>Please configure your API settings to make calls.</p>
          <button
            className="btn btn-primary"
            onClick={() => window.open('https://mediasfu.com/dashboard#sip-configs', '_blank')}
          >
            Go to Settings
          </button>
        </div>
      </div>
    );
  }

  // Check if already connected to an outgoing call room specifically
  const isConnectedToOutgoingRoom =
    isConnectedToRoom &&
    currentRoomName &&
    (currentRoomName.startsWith("outgoing_") ||
      isRoomCreatedByUs(currentRoomName) ||
      (outgoingCallRoom?.isActive &&
        currentRoomName === outgoingCallRoom.roomName));
  const outgoingRoomDisplayStatus = getUserFacingCallStatus(
    outgoingCallRoom?.callData
  );

  return (
    <div className="calls-page">
      <CallsTooltips />
      {/* Quick Settings Header */}
      <div className="quick-settings-header">
        <div className="quick-settings-content">
          <h2><FontAwesomeIcon icon={faPhone} /> {overrideText("pageTitle", "Outgoing Call Room")}</h2>
          <div className="quick-actions">
            <div className="quick-action-group">
              <button
                className="btn btn-secondary quick-action-btn"
                onClick={handleConnectToRoom}
                disabled={
                  sipLoading ||
                  !selectedFromNumber ||
                  isConnectedToOutgoingRoom ||
                  isCreatingRoom
                }
                title={
                  isConnectedToOutgoingRoom
                    ? "Already connected to outgoing call room"
                    : isCreatingRoom
                    ? "Creating room..."
                    : sipLoading
                    ? "Loading SIP configurations..."
                    : !selectedFromNumber && sipConfigs.length > 0
                    ? "Open the dialer below to select a number first"
                    : !selectedFromNumber
                    ? "No phone number configured — set up SIP in your dashboard"
                    : "Create a voice room for calls"
                }
              >
                {isCreatingRoom ? (
                  <>
                    <LoadingSpinner size="small" />
                    Creating Room...
                  </>
                ) : (
                  <>
                    <FontAwesomeIcon icon={faMicrophone} />{" "}
                    {isConnectedToOutgoingRoom
                      ? "Connected to Room"
                      : overrideText("createRoomButton", "Create Voice Room")}
                  </>
                )}
              </button>
              <span className="quick-action-subtext">
                {!selectedFromNumber && !isConnectedToOutgoingRoom && !isCreatingRoom
                  ? (sipConfigs.length > 0 || systemSipEligible
                    ? "Open dialer to select a number"
                    : "Configure SIP to enable")
                  : "Manual + More Options"}
              </span>
            </div>

            {/* Quick Call button — visible when no outgoing room, or when outgoing room exists but has no active SIP call */}
            {(!outgoingCallRoom?.isActive || !outgoingCallRoom?.hasActiveSipCall) && (
              <div className="quick-action-group">
                <button
                  className="btn btn-success quick-action-btn quick-call-trigger-btn"
                  onClick={startQuickCall}
                  disabled={
                    isDialing ||
                    isCreatingRoom ||
                    (sipConfigs.length === 0 && !systemSipEligible)
                  }
                  title="Dial a number or pick a contact to call instantly"
                >
                  <FontAwesomeIcon icon={faMobileAlt} /> {overrideText("quickCallButton", "Quick Call")}
                </button>
                <span className="quick-action-subtext">Dial instantly</span>
              </div>
            )}

            <div className="room-duration-setting">
              <label htmlFor="roomDuration" className="duration-label">
                Max call duration
              </label>
              <select
                id="roomDuration"
                className="duration-select"
                value={selectedDuration || 30}
                onChange={(e) => setSelectedDuration(Number(e.target.value))}
                title="Maximum duration for new voice rooms"
              >
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
                <option value={90}>90 minutes</option>
              </select>
            </div>

            {currentRoomName && isRoomCreatedByUs(currentRoomName) && (
              <div className="current-room-info">
                <span className="room-indicator">
                  <FontAwesomeIcon icon={faCircle} style={{ fontSize: '0.5rem', color: '#22c55e' }} /> Room: {currentRoomName}
                  {isMicrophoneEnabled ? <> <FontAwesomeIcon icon={faMicrophone} /></> : <> <FontAwesomeIcon icon={faMicrophoneSlash} /></>}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Room Creation Loading Spinner */}
      {isCreatingRoom && (
        <div className="room-creation-loading-overlay">
          <div className="loading-content">
            <div className="loading-header">
              <LoadingSpinner size="medium" />
              <h3>Creating Voice Room</h3>
            </div>
            <p>
              Setting up your conference room. This will only take a moment.
            </p>

            {roomCreationError && (
              <div className="error-section">
                <span className="error-message">{roomCreationError}</span>
                <button
                  className="btn btn-sm btn-outline retry-btn"
                  onClick={() => {
                    setRoomCreationError(null);
                    handleConnectToRoom();
                  }}
                  title="Retry room creation"
                >
                  <FontAwesomeIcon icon={faSpinner} spin /> Retry
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MediaSFU Room Display - Show ONLY for outgoing setup rooms we created */}
      {/* give almost no height if isCreatingRoom to avoid layout shift */}
      {!isStudioOperator && currentRoomName &&
        (isConnectedToRoom || isCreatingRoom) &&
        isRoomCreatedByUs(currentRoomName) && (
          <div className="mediasfu-section" style={{ position: "relative", height: isCreatingRoom ? 10 : "auto" }}>
            {/* Call Progress Overlay — overlays the room display during call setup */}
            {(callFlowStep === "dialing" || callFlowStep === "resolving" || callFlowStep === "ringing" || callFlowStep === "connecting" || callFlowStep === "connected") && (
              <div className="call-progress-room-overlay">
                <div className="call-progress-chips">
                  {[
                    { key: "dialing",     label: "Dialing",     icon: "☎" },
                    { key: "resolving",   label: "Resolving",   icon: "↗" },
                    { key: "ringing",     label: "Ringing",     icon: "♪" },
                    { key: "connecting",  label: "Connecting",  icon: "○" },
                    { key: "connected",   label: "Connected",   icon: "✓" },
                  ].map((phase) => {
                    const phaseOrder = ["dialing", "resolving", "ringing", "connecting", "connected"];
                    const currentIdx = phaseOrder.indexOf(callFlowStep);
                    const phaseIdx = phaseOrder.indexOf(phase.key);
                    const isCompleted = phaseIdx < currentIdx;
                    const isCurrent = phase.key === callFlowStep;
                    const isPending = phaseIdx > currentIdx;
                    return (
                      <div
                        key={phase.key}
                        className={`progress-chip ${isCompleted ? "completed" : ""} ${isCurrent ? "current" : ""} ${isPending ? "pending" : ""}`}
                      >
                        <span className="chip-icon">
                          {isCompleted ? "✓" : phase.icon}
                        </span>
                        <span className="chip-label">{phase.label}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="call-progress-bar-container">
                  <div
                    className="call-progress-bar-fill"
                    style={{
                      width: callFlowStep === "dialing" ? "20%"
                           : callFlowStep === "resolving" ? "40%"
                           : callFlowStep === "ringing" ? "65%"
                           : callFlowStep === "connecting" ? "85%"
                           : "100%"
                    }}
                  />
                </div>
                <div className={`call-status-card status-phase-${callFlowStep}`}>
                  <div className="status-card-icon">
                    {callFlowStep === "dialing" && <FontAwesomeIcon icon={faPhone} />}
                    {callFlowStep === "resolving" && <FontAwesomeIcon icon={faLink} />}
                    {callFlowStep === "ringing" && <FontAwesomeIcon icon={faBell} />}
                    {callFlowStep === "connecting" && <FontAwesomeIcon icon={faSatelliteDish} />}
                    {callFlowStep === "connected" && <FontAwesomeIcon icon={faCircleCheck} />}
                  </div>
                  <div className="status-card-content">
                    <div className="status-card-title">
                      {callFlowStep === "dialing" && "DIALING"}
                      {callFlowStep === "resolving" && "RESOLVING"}
                      {callFlowStep === "ringing" && "RINGING"}
                      {callFlowStep === "connecting" && "CONNECTING"}
                      {callFlowStep === "connected" && "CONNECTED"}
                    </div>
                    <div className="status-card-message">
                      {callFlowStep === "dialing" && `Dialing ${phoneNumber}...`}
                      {callFlowStep === "resolving" && "Setting up your voice room..."}
                      {callFlowStep === "ringing" && "The callee is being alerted. Hang tight."}
                      {callFlowStep === "connecting" && "Negotiating media streams..."}
                      {callFlowStep === "connected" && "The remote party answered. You're live."}
                    </div>
                  </div>
                  {callFlowStep !== "connected" && (
                    <div className="status-card-spinner">
                      <LoadingSpinner size="small" />
                    </div>
                  )}
                </div>
                {callFlowStep === "connected" && (
                  <p className="connected-hint">
                    Monitor the call in the Active Calls section below.
                  </p>
                )}
              </div>
            )}
            {/* Enhanced Status Header for the room */}
            <div className="voice-room-header">
              <div className="room-header-gradient">
                <div className="room-header-content">
                  <div className="room-title-section">
                    <div className="room-icon"><FontAwesomeIcon icon={faMicrophone} /></div>
                    <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1rem', fontWeight: 600 }}>Voice Room</h3>
                    <span className="room-name-display">
                      {currentRoomName}
                    </span>

                    {/* Compact Inline Call Metadata - Show as part of title section */}
                    {hookOutgoingCallRoom?.isActive &&
                      hookOutgoingCallRoom.hasActiveSipCall &&
                      hookOutgoingCallRoom.callData && (
                        <div className="room-call-metadata-inline">
                          <span className="metadata-item">
                            <FontAwesomeIcon icon={faPhone} />{" "}
                            {hookOutgoingCallRoom.callData.direction ===
                            "outgoing"
                              ? extractCleanIdentifier(
                                  hookOutgoingCallRoom.callData.calledUri || ""
                                )
                              : extractCleanIdentifier(
                                  hookOutgoingCallRoom.callData.callerIdRaw ||
                                    ""
                                )}
                          </span>
                          <span
                            className={`metadata-item status-${hookOutgoingCallRoom.callData.status}`}
                          >
                            {hookOutgoingCallRoom.callData.status}
                          </span>
                          {hookOutgoingCallRoom.callData.startTimeISO && (
                            <span className="metadata-item">
                              <LiveDuration
                                call={hookOutgoingCallRoom.callData}
                              />
                            </span>
                          )}
                        </div>
                      )}
                  </div>

                  <div className="room-status-badges">
                    {hookOutgoingCallRoom?.isActive ? (
                      hookOutgoingCallRoom.hasActiveSipCall ? (
                        <span className="status-badge status-active">
                          <span className="badge-icon"><FontAwesomeIcon icon={faPhone} /></span>
                          Call in Progress
                        </span>
                      ) : (
                        <span className="status-badge status-ready">
                          <span className="badge-icon"><FontAwesomeIcon icon={faCircleCheck} /></span>
                          Ready for Calls
                        </span>
                      )
                    ) : (
                      <span className="status-badge status-connecting">
                        <span className="badge-icon"><FontAwesomeIcon icon={faSpinner} spin /></span>
                        Setting up...
                      </span>
                    )}

                    {/* Connection Status */}
                    <span
                      className={`status-badge ${
                        isConnectedToRoom
                          ? "status-connected"
                          : "status-disconnected"
                      }`}
                    >
                      <span className="badge-icon">
                        {isConnectedToRoom ? <FontAwesomeIcon icon={faCircle} style={{ fontSize: '0.5rem', color: '#22c55e' }} /> : <FontAwesomeIcon icon={faCircle} style={{ fontSize: '0.5rem', color: '#ef4444' }} />}
                      </span>
                      {isConnectedToRoom ? "Connected" : "Connecting..."}
                    </span>

                    {/* Microphone Status */}
                    <span
                      className={`status-badge ${
                        isMicrophoneEnabled ? "status-mic-on" : "status-mic-off"
                      }`}
                    >
                      <span className="badge-icon">
                        {isMicrophoneEnabled ? <FontAwesomeIcon icon={faMicrophone} /> : <FontAwesomeIcon icon={faMicrophoneSlash} />}
                      </span>
                      {isMicrophoneEnabled ? "Mic On" : "Mic Off"}
                    </span>

                    {/* Active Call Status - Show when we have an active call in this room */}
                    {currentRoomName &&
                      isRoomCreatedByUs(currentRoomName) &&
                      hookOutgoingCallRoom?.isActive &&
                      hookOutgoingCallRoom.roomName === currentRoomName &&
                      hookOutgoingCallRoom.hasActiveSipCall &&
                      hookOutgoingCallRoom.callData && (
                        <span
                          className={`status-badge status-${outgoingRoomDisplayStatus || hookOutgoingCallRoom.callData.status}`}
                        >
                          <span className="badge-icon">
                            {outgoingRoomDisplayStatus === "active" || outgoingRoomDisplayStatus === "connected"
                              ? <FontAwesomeIcon icon={faPhone} />
                              : outgoingRoomDisplayStatus ===
                                "ringing"
                              ? <FontAwesomeIcon icon={faBell} />
                              : <FontAwesomeIcon icon={faSpinner} spin />}
                          </span>
                          Call {getCallStatusDisplay(hookOutgoingCallRoom.callData).label}
                        </span>
                      )}
                  </div>

                  {/* Room Info Grid - inline on large screens */}
                  <div className="room-info-grid">
                    <div className="room-info-card">
                      <div className="info-label">From Number</div>
                      <div className="info-value">
                        {isUsingSystemSip
                          ? <><FontAwesomeIcon icon={faBuilding} /> MediaSFU Number</>
                          : (selectedFromNumber || "Not selected")}
                      </div>
                    </div>

                  {(() => {
                    // For outgoing setup rooms, use the room's call data directly
                    if (
                      currentRoomName &&
                      isRoomCreatedByUs(currentRoomName) &&
                      hookOutgoingCallRoom?.isActive &&
                      hookOutgoingCallRoom.roomName === currentRoomName &&
                      hookOutgoingCallRoom.hasActiveSipCall &&
                      hookOutgoingCallRoom.callData
                    ) {
                      // Show active call metadata in room info using outgoing room data
                      const callData = hookOutgoingCallRoom.callData;
                      const callStatus = getUserFacingCallStatus(callData);
                      const callStatusDisplay = getCallStatusDisplay(callData);
                      return (
                        <>
                          <div className="room-info-card">
                            <div className="info-label">Call Status</div>
                            <div className="info-value">{callStatusDisplay.label}</div>
                          </div>
                          <div className="room-info-card">
                            <div className="info-label">
                              {callData.direction === "outgoing"
                                ? "Calling"
                                : "From"}
                            </div>
                            <div className="info-value">
                              {callData.direction === "outgoing"
                                ? extractCleanIdentifier(
                                    callData.calledUri || ""
                                  )
                                : extractCleanIdentifier(
                                    callData.callerIdRaw || ""
                                  )}
                            </div>
                          </div>
                          {callData.startTimeISO && (
                            <div className="room-info-card">
                              <div className="info-label">Duration</div>
                              <div className="info-value">
                                <LiveDuration call={callData} />
                              </div>
                            </div>
                          )}

                          {/* Call control actions for active call */}
                          <div className="room-info-card room-action-card">
                            {callStatus === "active" || callStatus === "connected" ? (
                              <button
                                className="btn btn-danger btn-compact"
                                onClick={() => {
                                  if (hookOutgoingCallRoom.sipCallId) {
                                    handleRoomEndCall(hookOutgoingCallRoom.sipCallId);
                                  }
                                }}
                                title="End the active call"
                                disabled={!hookOutgoingCallRoom.sipCallId}
                              >
                                <FontAwesomeIcon icon={faCircle} style={{ fontSize: '0.5rem', color: '#ef4444' }} /> End Call
                              </button>
                            ) : callStatus === "ringing" &&
                              callData.direction !== "outgoing" ? (
                              <>
                                <button
                                  className="btn btn-success btn-compact"
                                  onClick={() => {
                                    if (hookOutgoingCallRoom.sipCallId) {
                                      const existingCall = currentCalls.find(
                                        (c) =>
                                          c.sipCallId ===
                                          hookOutgoingCallRoom.sipCallId
                                      );
                                      if (existingCall) {
                                        handleAnswerCall(existingCall);
                                      }
                                    }
                                  }}
                                  title="Answer the incoming call"
                                  style={{ marginRight: "0.5rem" }}
                                  disabled={!hookOutgoingCallRoom.sipCallId}
                                >
                                  <FontAwesomeIcon icon={faPhone} /> Answer
                                </button>
                                <button
                                  className="btn btn-danger btn-compact"
                                  onClick={() => {
                                    if (hookOutgoingCallRoom.sipCallId) {
                                      const existingCall = currentCalls.find(
                                        (c) =>
                                          c.sipCallId ===
                                          hookOutgoingCallRoom.sipCallId
                                      );
                                      if (existingCall) {
                                        handleDeclineCall(existingCall);
                                      }
                                    }
                                  }}
                                  title="Decline the incoming call"
                                  disabled={!hookOutgoingCallRoom.sipCallId}
                                >
                                  <FontAwesomeIcon icon={faXmark} /> Decline
                                </button>
                              </>
                            ) : (
                              <span className="call-status-info">
                                {callStatus === "ringing" &&
                                callData.direction === "outgoing"
                                  ? <><FontAwesomeIcon icon={faPhone} style={{ marginRight: 4 }} /> Ringing...</>
                                  : callStatus === "connecting"
                                  ? <><FontAwesomeIcon icon={faSpinner} spin style={{ marginRight: 4 }} /> Connecting...</>
                                  : callStatus === "active" || callStatus === "connected"
                                  ? <><FontAwesomeIcon icon={faPhone} style={{ marginRight: 4 }} /> Connected</>
                                  : <><FontAwesomeIcon icon={faPhone} style={{ marginRight: 4 }} /> {callStatusDisplay.label}</>}
                              </span>
                            )}
                          </div>
                        </>
                      );
                    }

                    // No active call - show outgoing call setup OR joined room info
                    return hookOutgoingCallRoom?.isActive ? (
                      <>
                        <div className="room-info-card" title="Outgoing Call Setup Room">
                          <div className="info-label">Room Type</div>
                          <div className="info-value">Outgoing Call</div>
                        </div>
                        <div className="room-info-card">
                          <div className="info-label">Duration</div>
                          <div className="info-value">
                            {selectedDuration} min
                          </div>
                        </div>

                        {/* Contact Selector - only show when contacts are available (widget has no CRM endpoint) */}
                        {!hookOutgoingCallRoom.hasActiveSipCall && contactsLoaded && (contacts.length > 0 || favorites.length > 0) && (
                          <div className="room-info-card room-input-card" style={{ position: 'relative', minWidth: '200px', maxWidth: '240px' }}>
                            <div className="info-label">Contact</div>
                            {!contactsLoaded ? (
                              <div style={{ fontSize: '0.7rem', color: '#94a3b8', padding: '0.3rem' }}>Loading...</div>
                            ) : contacts.length === 0 && favorites.length === 0 ? (
                              <div style={{ fontSize: '0.7rem', color: '#64748b', padding: '0.3rem' }}>No contacts</div>
                            ) : (
                              <>
                                <input
                                  type="text"
                                  className="room-phone-input"
                                  value={contactSearchQuery}
                                  onChange={(e) => {
                                    setContactSearchQuery(e.target.value);
                                    if (e.target.value.length >= 2) {
                                      // searchContacts requires 2+ chars
                                      setFilteredContacts(searchContacts(e.target.value, 6));
                                      setShowContactDropdown(true);
                                    } else if (e.target.value.length >= 1) {
                                      // 1 char: show favorites or first contacts
                                      if (favorites.length > 0) {
                                        setFilteredContacts(favorites.slice(0, 5));
                                      } else if (contacts.length > 0) {
                                        setFilteredContacts(contacts.slice(0, 5));
                                      }
                                      setShowContactDropdown(true);
                                    } else {
                                      setShowContactDropdown(false);
                                    }
                                  }}
                                  onFocus={() => {
                                    // Show favorites first, then recent contacts
                                    if (favorites.length > 0) {
                                      setFilteredContacts(favorites.slice(0, 5));
                                      setShowContactDropdown(true);
                                    } else if (contacts.length > 0) {
                                      setFilteredContacts(contacts.slice(0, 5));
                                      setShowContactDropdown(true);
                                    }
                                  }}
                                  onBlur={() => setTimeout(() => setShowContactDropdown(false), 250)}
                                  placeholder="Search name..."
                                  title="Search contacts to populate To Number"
                                />
                                {/* Contact dropdown */}
                                {showContactDropdown && filteredContacts.length > 0 && (
                                  <div style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: 0,
                                    right: 0,
                                    background: '#1e293b',
                                    border: '1px solid #475569',
                                    borderRadius: '6px',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                                    zIndex: 100,
                                    maxHeight: '150px',
                                    overflowY: 'auto',
                                  }}>
                                    {filteredContacts.map((c) => (
                                      <div
                                        key={c._id}
                                        onMouseDown={(e) => {
                                          e.preventDefault();
                                          const num = c.phoneNumber || c.phoneNumbers?.[0]?.number;
                                          if (num) {
                                            setPhoneNumber(formatPhoneNumber(num));
                                            setContactSearchQuery(c.name);
                                            setShowContactDropdown(false);
                                          }
                                        }}
                                        style={{
                                          padding: '6px 10px',
                                          cursor: 'pointer',
                                          borderBottom: '1px solid #334155',
                                          fontSize: '0.75rem',
                                        }}
                                        onMouseEnter={(e) => (e.currentTarget.style.background = '#334155')}
                                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                      >
                                        <div style={{ fontWeight: 500, color: '#f1f5f9' }}>
                                          {c.isFavorite && <><FontAwesomeIcon icon={faStar} style={{ color: '#fbbf24', marginRight: '0.25rem' }} /></>}{c.name}
                                        </div>
                                        <div style={{ color: '#94a3b8', fontSize: '0.65rem' }}>
                                          {c.phoneNumber || c.phoneNumbers?.[0]?.number}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}

                        {/* To Number input - numeric only */}
                        {!hookOutgoingCallRoom.hasActiveSipCall && (
                          <div className="room-info-card room-input-card" style={{ minWidth: '188px', maxWidth: '220px' }}>
                            <div className="info-label">To Number</div>
                            <input
                              type="text"
                              className="room-phone-input"
                              value={phoneNumber}
                              onChange={(e) => setPhoneNumber(formatPhoneNumber(e.target.value))}
                              placeholder="+1234567890"
                              maxLength={20}
                              title="Enter phone number to call"
                            />
                          </div>
                        )}

                        {/* Quick Actions integrated into info grid */}
                        {!hookOutgoingCallRoom.hasActiveSipCall && (
                          <div className="room-info-card room-action-card">
                            <button
                              className="btn btn-success btn-compact"
                              onClick={handleMakeCall}
                              disabled={
                                !isConnectedToRoom ||
                                !phoneNumber ||
                                !isValidE164(phoneNumber) ||
                                isDialing
                              }
                              title={
                                !isConnectedToRoom
                                  ? "Wait for room connection"
                                  : !phoneNumber
                                  ? "Enter a phone number first"
                                  : !isValidE164(phoneNumber)
                                  ? "Enter a valid phone number"
                                  : isDialing
                                  ? "Call in progress..."
                                  : "Make a call using this room"
                              }
                            >
                              {isDialing ? <><FontAwesomeIcon icon={faPhone} /> Calling...</> : <><FontAwesomeIcon icon={faPhone} /> Make Call</>}
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      // Joined room - show basic room info
                      <>
                        <div className="room-info-card" title="Joined Call Room">
                          <div className="info-label">Room Type</div>
                          <div className="info-value">Joined Call</div>
                        </div>
                        <div className="room-info-card">
                          <div className="info-label">Status</div>
                          <div className="info-value">
                            {isConnectedToRoom
                              ? <><FontAwesomeIcon icon={faCircleCheck} /> Connected</>
                              : <><FontAwesomeIcon icon={faSpinner} spin /> Connecting</>}
                          </div>
                        </div>
                        <div className="room-info-card" title={currentParticipantName || "voipuser"}>
                          <div className="info-label">Participant</div>
                          <div className="info-value">
                            {currentParticipantName || "voipuser"}
                          </div>
                        </div>
                        <div className="room-info-card room-action-card">
                          <span className="call-status-info">
                            <FontAwesomeIcon icon={faComment} /> Ready for call activity
                          </span>
                        </div>
                      </>
                    );
                  })()}
                </div>
                {/* End room-info-grid */}
              </div>
              {/* End room-header-content */}
            </div>
            {/* End room-header-gradient */}
          </div>
          {/* End voice-room-header */}

            {/* Outgoing Call Setup Status - Show when room is being set up */}
            {hookOutgoingCallRoom?.isActive &&
              !hookOutgoingCallRoom.hasActiveSipCall &&
              phoneNumber && (
                <div className="outgoing-setup-status">
                  <div className="setup-status-header">
                    <div className="setup-info">
                      <span className="status-badge status-setup">
                        <FontAwesomeIcon icon={faSpinner} spin /> SETTING UP CALL
                      </span>
                      <span className="setup-details">
                        Preparing to call: {phoneNumber}
                      </span>
                    </div>

                    {/* Quick call controls in setup */}
                    <div className="setup-quick-controls">
                      <input
                        type="text"
                        className="phone-number-input compact"
                        value={phoneNumber}
                        onChange={(e) =>
                          setPhoneNumber(formatPhoneNumber(e.target.value))
                        }
                        placeholder="+1234567890"
                        maxLength={16}
                      />
                      <button
                        className="btn btn-success btn-xs"
                        onClick={handleMakeCall}
                        disabled={
                          !phoneNumber || !isValidE164(phoneNumber) || isDialing
                        }
                        title="Call this number using the room"
                        style={{
                          padding: "4px 8px",
                          fontSize: "12px",
                          minHeight: "28px",
                        }}
                      >
                        {isDialing ? <><FontAwesomeIcon icon={faPhone} /> Calling...</> : <><FontAwesomeIcon icon={faPhone} /> Call</>}
                      </button>
                      {phoneNumber &&
                        phoneNumber.length > 3 &&
                        !isValidE164(phoneNumber) && (
                          <div className="validation-message error compact">
                            Invalid format. Use: +1234567890
                          </div>
                        )}
                    </div>
                  </div>
                </div>
              )}

            <MediaSFURoomDisplay
              roomName={currentRoomName}
              participantName={currentParticipantName}
              isConnected={isConnectedToRoom}
              callId={(() => {
                // CRITICAL: Find SIP call by room name matching first (regardless of status)
                // This is the correct logic - we poll data, find calls with same roomName as current room,
                // and match by roomName to get proper SIP call details (sipCallId)
                let activeCall = null;

                if (currentRoomName) {
                  // First, try to find any active call in the current room (not terminated/failed)
                  activeCall = allDisplayCalls.find(
                    (call) =>
                      call.roomName === currentRoomName &&
                      call.status !== "ended" &&
                      call.status !== "failed" &&
                      call.status !== "completed" &&
                      call.status !== "rejected" &&
                      call.status !== "terminated" &&
                      call.status !== "terminating" &&
                      !call.callEnded
                  );
                }

                // If no call found in current room, but we have an outgoing room active,
                // try to find calls that match the outgoing room name (discovery mode)
                if (!activeCall && hookOutgoingCallRoom?.isActive) {
                  // Look for calls in the outgoing room (either real or requested name)
                  activeCall = allDisplayCalls.find(
                    (call) =>
                      (call.roomName === hookOutgoingCallRoom.roomName ||
                        call.roomName ===
                          hookOutgoingCallRoom.requestedRoomName) &&
                      call.status !== "ended" &&
                      call.status !== "failed" &&
                      call.status !== "completed" &&
                      call.status !== "rejected" &&
                      call.status !== "terminated" &&
                      call.status !== "terminating" &&
                      !call.callEnded
                  );
                }

                // Return the discovered SIP call ID
                return activeCall?.sipCallId;
              })()}
              onConnectionChange={handleRoomConnectionChange}
              onMicrophoneChange={handleMicrophoneChange}
              onRoomNameUpdate={handleRoomNameUpdate}
              onDisconnect={handleRoomDisconnect}
              onEndCall={handleRoomEndCall}
              autoJoin={!isStudioOperator}
              isOutgoingCallSetup={
                currentRoomName ? isRoomCreatedByUs(currentRoomName) : false
              }
              onParticipantsUpdate={handleRoomParticipantsUpdate}
              currentCall={
                // For outgoing setup rooms, use the room's call data state directly
                currentRoomName &&
                isRoomCreatedByUs(currentRoomName) &&
                hookOutgoingCallRoom?.isActive &&
                hookOutgoingCallRoom.roomName === currentRoomName
                  ? hookOutgoingCallRoom.hasActiveSipCall
                    ? hookOutgoingCallRoom.callData
                    : undefined
                  : // For other rooms, find active call in this room from all calls
                  currentRoomName
                  ? allDisplayCalls.find(
                      (call) =>
                        call.roomName === currentRoomName &&
                        call.status !== "ended" &&
                        call.status !== "failed" &&
                        call.status !== "completed" &&
                        call.status !== "rejected" &&
                        call.status !== "terminated" &&
                        call.status !== "terminating" &&
                        !call.callEnded
                    )
                  : undefined
              }
              duration={selectedDuration}
              autoUnmute={!isStudioOperator && shouldAutoUnmute}
              onAutoUnmuteComplete={(success) => {
                callLogger.info(`Auto-unmute callback fired: success=${success}`);
                if (autoUnmuteResolverRef.current) {
                  autoUnmuteResolverRef.current(success);
                  autoUnmuteResolverRef.current = null;
                }
              }}
            />
          </div>
        )}

      {/* Make Call Section */}
      {showDialer && (
        <div
          className={`dialer-section card ${
            callFlowStep !== "closed" ? "step-flow-active" : ""
          }`}
        >
          <div className="dialer-header">
            <h3><FontAwesomeIcon icon={faPhone} /> Make a Call</h3>
            <button
              className="btn btn-secondary close-dialer"
              onClick={() => closeCallFlow()}
              aria-label="Hide Dialer"
            >
              <FontAwesomeIcon icon={faChevronUp} /> Hide
            </button>
          </div>

          <div className="dialer-content">
            {/* Step 1: Select Number */}
            {callFlowStep === "select-number" && (
              <div className="step-content">
                <h4>Step 1: Select a number to call from</h4>
                <div className="from-number-section">
                  {sipLoading ? (
                    <div className="loading-indicator">
                      <LoadingSpinner size="small" />
                      Loading your phone numbers...
                    </div>
                  ) : sipConfigs.length > 0 ? (
                    <>
                      <select
                        id="fromNumber"
                        className="from-number-select"
                        value={selectedFromNumber}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSelectedFromNumber(val);
                          setIsUsingSystemSip(val === '__system_sip__');
                        }}
                      >
                        <option value="">Select a number to call from</option>
                        {sipConfigs.map((config, index) => {
                          const phoneNumber =
                            config.contactNumber ||
                            config.phoneNumber ||
                            "Unknown";
                          const provider = config.provider || "Unknown Provider";
                          const isEligible = isEligibleForOutgoing(config);
                          const eligibilityReason = getEligibilityReason(config);

                          return (
                            <option
                              key={config.id || `config-${index}`}
                              value={phoneNumber}
                              disabled={!isEligible}
                            >
                              ☎ {formatPhoneNumberForDisplay(phoneNumber)} ({provider}){" "}
                              {isEligible ? "✓" : `✗ ${eligibilityReason}`}
                            </option>
                          );
                        })}
                        {/* System SIP option when eligible */}
                        {systemSipEligible && systemSipBalance > 0 && (
                          <option value="__system_sip__">
                            <FontAwesomeIcon icon={faBuilding} /> MediaSFU Number (System) — Balance: ${systemSipBalance.toFixed(2)} ✓
                          </option>
                        )}
                      </select>
                      {isUsingSystemSip && selectedFromNumber === '__system_sip__' && (
                        <div style={{
                          marginTop: '10px',
                          padding: '10px 14px',
                          background: 'rgba(245, 158, 11, 0.1)',
                          border: '1px solid rgba(245, 158, 11, 0.3)',
                          borderRadius: '8px',
                          fontSize: '0.85rem',
                          color: 'var(--warning-text, #f59e0b)',
                        }}>
                          <strong>Note:</strong> Outbound calls only.
                          No inbound, no AI bot. Best regional number will be auto-selected.
                        </div>
                      )}
                    </>
                  ) : systemSipEligible && systemSipBalance > 0 ? (
                    // No own SIP configs but system SIP is available
                    <div>
                      <div style={{
                        padding: '16px',
                        background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(99, 102, 241, 0.1))',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        borderRadius: '12px',
                        marginBottom: '12px',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                          <span style={{ fontSize: '1.5rem' }}><FontAwesomeIcon icon={faBuilding} /></span>
                          <div>
                            <strong style={{ color: 'var(--text-primary, #e2e8f0)', display: 'block' }}>
                              Use MediaSFU Number
                            </strong>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary, #94a3b8)' }}>
                              Make calls using a MediaSFU system number
                            </span>
                          </div>
                        </div>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '16px',
                          fontSize: '0.85rem',
                          color: 'var(--text-secondary, #94a3b8)',
                          marginTop: '8px',
                        }}>
                          <span>Balance: <strong style={{ color: systemSipBalance < 5 ? '#f44336' : 'var(--primary, #3b82f6)' }}>${systemSipBalance.toFixed(2)}</strong></span>
                          <span>Outbound only</span>
                          <span>No AI bot</span>
                        </div>
                      </div>
                      <button
                        className="btn btn-primary"
                        style={{ width: '100%' }}
                        onClick={() => {
                          setSelectedFromNumber('__system_sip__');
                          setIsUsingSystemSip(true);
                        }}
                      >
                        <FontAwesomeIcon icon={faPhone} /> Use MediaSFU Number
                      </button>
                      <div style={{ textAlign: 'center', margin: '16px 0 8px', color: 'var(--text-muted, #64748b)', fontSize: '0.8rem' }}>
                        — or —
                      </div>
                      <button
                        className="btn btn-secondary btn-configure-sip"
                        onClick={() => window.open('https://mediasfu.com/dashboard#sip-configs', '_blank')}
                        style={{ width: '100%' }}
                      >
                        Configure Your Own SIP Number
                      </button>
                    </div>
                  ) : (
                    <div className="no-numbers-message">
                      <p>
                        No SIP configurations found. Set up your phone numbers
                        in the SIP Configuration section.
                      </p>
                      <button
                        className="btn btn-primary btn-configure-sip"
                        onClick={() => window.open('https://mediasfu.com/dashboard#sip-configs', '_blank')}
                        style={{ marginTop: '12px' }}
                      >
                        Configure SIP Settings
                      </button>
                    </div>
                  )}
                </div>
                <div className="step-actions">
                  <button
                    className="btn btn-primary"
                    onClick={nextStep}
                    disabled={!selectedFromNumber}
                  >
                    Next: Enter Phone Number →
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Enter Phone Number */}
            {callFlowStep === "enter-phone" && (
              <div className="step-content">
                <h4>Step 2: Enter the phone number to call</h4>
                <div className="phone-number-section">
                  <label htmlFor="phoneNumber">Phone Number:</label>

                  {/* Contact Selector - only show when contacts are available (widget has no CRM endpoint) */}
                  {contactsLoaded && (contacts.length > 0 || favorites.length > 0) && (
                  <div className="contact-selector" style={{ marginBottom: '1rem' }}>
                    {contacts.length > 0 || favorites.length > 0 ? (
                      <>
                        <div className="contact-search-wrapper" style={{ position: 'relative' }}>
                          <input
                            type="text"
                            className="contact-search-input"
                            placeholder="Search contacts by name or number..."
                            value={contactSearchQuery}
                            onChange={(e) => {
                              setContactSearchQuery(e.target.value);
                              if (e.target.value.length >= 2) {
                                setFilteredContacts(searchContacts(e.target.value, 10));
                                setShowContactDropdown(true);
                              } else {
                                setShowContactDropdown(false);
                              }
                            }}
                            onFocus={() => {
                              if (favorites.length > 0 && contactSearchQuery.length < 2) {
                                setFilteredContacts(favorites.slice(0, 5));
                                setShowContactDropdown(true);
                              } else if (contacts.length > 0 && contactSearchQuery.length < 2) {
                                setFilteredContacts(contacts.slice(0, 5));
                                setShowContactDropdown(true);
                              }
                            }}
                            onBlur={() => {
                              // Delay hiding to allow click on dropdown items
                              setTimeout(() => setShowContactDropdown(false), 200);
                            }}
                            style={{
                              width: '100%',
                              padding: '10px 12px',
                              border: '1px solid var(--border-color, #d1d5db)',
                              borderRadius: '8px',
                              fontSize: '0.95rem',
                              background: 'var(--input-bg, #fff)',
                              color: 'var(--text-color, #1f2937)',
                            }}
                          />
                          {showContactDropdown && filteredContacts.length > 0 && (
                            <div
                              className="contact-dropdown"
                              style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                right: 0,
                                background: 'var(--card-bg, #1f2937)',
                                border: '1px solid var(--border-color, #374151)',
                                borderRadius: '8px',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                                zIndex: 100,
                                maxHeight: '250px',
                                overflowY: 'auto',
                              }}
                            >
                              {favorites.length > 0 && contactSearchQuery.length < 2 && (
                                <div style={{ padding: '8px 12px', fontSize: '0.8rem', color: 'var(--text-muted, #6b7280)', borderBottom: '1px solid var(--border-color, #e5e7eb)' }}>
                                  <FontAwesomeIcon icon={faStar} style={{ color: '#fbbf24' }} /> Favorites
                                </div>
                              )}
                              {filteredContacts.map((contact) => (
                                <div
                                  key={contact._id}
                                  className="contact-dropdown-item"
                                  onMouseDown={(e) => {
                                    // Use onMouseDown to fire before onBlur hides the dropdown
                                    e.preventDefault();
                                    // If contact has multiple numbers, prefer primary or first
                                    const number = contact.phoneNumber || contact.phoneNumbers?.[0]?.number;
                                    if (number) {
                                      setPhoneNumber(formatPhoneNumber(number));
                                      setContactSearchQuery(contact.name);
                                      setShowContactDropdown(false);
                                    }
                                  }}
                                  style={{
                                    padding: '10px 12px',
                                    cursor: 'pointer',
                                    borderBottom: '1px solid var(--border-color, #f3f4f6)',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-bg, #f9fafb)')}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                >
                                  <div>
                                    <div style={{ fontWeight: 500 }}>{contact.name}</div>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted, #6b7280)' }}>
                                      {contact.phoneNumber || contact.phoneNumbers?.[0]?.number}
                                    </div>
                                  </div>
                                  {contact.phoneNumbers && contact.phoneNumbers.length > 1 && (
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9ca3af)' }}>
                                      +{contact.phoneNumbers.length - 1} more
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: 'center', color: 'var(--text-muted, #9ca3af)', fontSize: '0.85rem', margin: '8px 0' }}>
                          — or enter manually —
                        </div>
                      </>
                    ) : (
                      <div style={{
                        padding: '12px',
                        background: 'var(--info-bg, #1e3a5f)',
                        border: '1px solid var(--info-border, #3b82f6)',
                        borderRadius: '8px',
                        color: 'var(--info-text, #93c5fd)',
                        fontSize: '0.9rem',
                        textAlign: 'center',
                        marginBottom: '8px'
                      }}>
                        Add contacts in the <strong>Contacts</strong> section to quickly select numbers here
                      </div>
                    )}
                  </div>
                  )}

                  <input
                    id="phoneNumber"
                    type="text"
                    className="phone-number-input"
                    value={phoneNumber}
                    onChange={(e) =>
                      setPhoneNumber(formatPhoneNumber(e.target.value))
                    }
                    placeholder="+1234567890"
                    maxLength={16}
                  />
                  {phoneNumber &&
                    phoneNumber.length > 1 &&
                    !isValidE164(phoneNumber) && (
                      <div className="validation-message error">
                        Invalid phone number format. Use international format:
                        +1234567890
                      </div>
                    )}

                  {/* Dialpad Toggle */}
                  <div className="input-controls" style={{ marginTop: "1rem" }}>
                    <button
                      className="btn btn-info dialpad-toggle"
                      onClick={() => setIsDialpadCollapsed(!isDialpadCollapsed)}
                      title={
                        isDialpadCollapsed ? "Show Dialpad" : "Hide Dialpad"
                      }
                    >
                      {isDialpadCollapsed
                        ? "Show Dialpad"
                        : "Hide Dialpad"}
                    </button>
                  </div>

                  {/* Collapsible Dialpad */}
                  {!isDialpadCollapsed && (
                    <div className="dialpad" style={{ marginTop: "1rem" }}>
                      {dialpadButtons.map((digit, index) => (
                        <button
                          key={digit}
                          className={`dialpad-btn ${
                            digit === "+" ? "dialpad-plus" : ""
                          }`}
                          onClick={() => handleDialpadClick(digit)}
                          disabled={isDialing}
                          style={index === 12 ? { gridColumn: "2" } : {}} // Center the + button
                        >
                          {digit}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="step-actions">
                  <button className="btn btn-secondary" onClick={prevStep}>
                    ← Back
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={nextStep}
                    disabled={!phoneNumber || !isValidE164(phoneNumber)}
                  >
                    Next: Choose Mode →
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Choose Call Mode */}
            {callFlowStep === "choose-mode" && (
              <div className="step-content">
                <h4>Step 3: Choose how to handle the call</h4>
                <div className="call-mode-section">
                  {(() => {
                    // For system SIP, no bot mode available
                    const isSystemSipCall = isUsingSystemSip && selectedFromNumber === '__system_sip__';

                    const selectedConfig = isSystemSipCall
                      ? null
                      : sipConfigs.find(
                          (config) =>
                            (config.contactNumber || config.phoneNumber) ===
                            selectedFromNumber
                        );
                    const autoAgent = selectedConfig?.autoAgent;

                    // Check if bot mode is properly configured for outgoing calls
                    const autoAgentAvailable =
                      autoAgent?.enabled &&
                      autoAgent.type &&
                      (autoAgent.type === "AI" ||
                        autoAgent.type === "IVR" ||
                        autoAgent.type === "PLAYBACK");

                    // CRITICAL: Check outgoingType is set to AI for bot outgoing calls
                    const botModeAvailable =
                      autoAgentAvailable && autoAgent?.outgoingType === "AI";

                    // Enhanced voice mode detection - check for existing rooms and ability to create new ones
                    const hasExistingActiveRoom =
                      (isConnectedToRoom && currentRoomName) ||
                      hookOutgoingCallRoom?.isActive;
                    const canCreateNewRoom =
                      !isConnectedToRoom &&
                      !hookOutgoingCallRoom?.isActive &&
                      selectedFromNumber;

                    // Voice mode is available if we have an active room OR can create one
                    const voiceModeAvailable =
                      hasExistingActiveRoom || canCreateNewRoom;

                    // Auto-select the best available option
                    const shouldSelectBot =
                      botModeAvailable &&
                      (!hasExistingActiveRoom || !isMicrophoneEnabled);
                    const shouldSelectVoice =
                      voiceModeAvailable &&
                      hasExistingActiveRoom &&
                      isMicrophoneEnabled;

                    return (
                      <div className="mode-options">
                        {/* Bot Call Option */}
                        <div
                          className={`mode-option bot-mode ${
                            shouldSelectBot ? "auto-selected" : ""
                          } ${!botModeAvailable ? "disabled" : ""}`}
                        >
                          <div className="mode-header">
                            <div className="mode-title">
                              <h5><FontAwesomeIcon icon={faRobot} /> Bot Call</h5>
                              {shouldSelectBot && (
                                <span className="auto-selected-badge">
                                  <FontAwesomeIcon icon={faCircleCheck} /> Recommended
                                </span>
                              )}
                              {!botModeAvailable && (
                                <span className="unavailable-badge">
                                  Unavailable
                                </span>
                              )}
                            </div>
                            <span className="mode-description">
                              {botModeAvailable
                                ? "AI agent handles the call automatically"
                                : autoAgentAvailable
                                ? "Agent configured but outgoingType not set to AI"
                                : "No AI agent configured for this number"}
                            </span>
                          </div>
                          <div className="mode-details">
                            {botModeAvailable ? (
                              <>
                                <p>Agent Type: {autoAgent.type}</p>
                                <p>Outgoing Type: {autoAgent.outgoingType}</p>
                                <p>
                                  Perfect for automated calls, surveys, or
                                  information delivery
                                </p>
                                <p><FontAwesomeIcon icon={faCircleCheck} /> No room connection required</p>
                              </>
                            ) : autoAgentAvailable ? (
                              <>
                                <p>Agent Type: {autoAgent.type}</p>
                                <p>
                                  Outgoing Type:{" "}
                                  {autoAgent.outgoingType || "Not set"} (needs
                                  "AI")
                                </p>
                                <p>
                                  The auto agent exists but outgoingType must be
                                  set to "AI" for bot calls
                                </p>
                                <p>
                                  Configure outgoingType to "AI" in SIP settings
                                  to enable bot calls
                                </p>
                              </>
                            ) : (
                              <>
                                <p>No auto agent configured</p>
                                <p>
                                  This number doesn't have AI/IVR/PLAYBACK agent
                                  setup
                                </p>
                                <p>
                                  Configure auto agent in SIP settings to enable
                                  bot calls
                                </p>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Voice Call Option */}
                        <div
                          className={`mode-option user-mode ${
                            shouldSelectVoice ? "auto-selected" : ""
                          } ${!voiceModeAvailable ? "disabled" : ""}`}
                        >
                          <div className="mode-header">
                            <div className="mode-title">
                              <h5><FontAwesomeIcon icon={faUser} /> Voice Call</h5>
                              {shouldSelectVoice && (
                                <span className="auto-selected-badge">
                                  <FontAwesomeIcon icon={faCircleCheck} /> Ready
                                </span>
                              )}
                            </div>
                            <span className="mode-description">
                              You talk directly with the caller
                            </span>
                          </div>
                          <div className="mode-details">
                            <p>Requires: Active MediaSFU room connection</p>

                            {/* Show current room status */}
                            {isConnectedToRoom && currentRoomName && (
                              <>
                                <p
                                  style={{
                                    color: "var(--success-color, #28a745)",
                                    fontWeight: "bold",
                                  }}
                                >
                                  <FontAwesomeIcon icon={faCircleCheck} /> Connected to room: {currentRoomName}
                                </p>
                                {isMicrophoneEnabled && (
                                  <p
                                    style={{
                                      color: "var(--success-color, #28a745)",
                                      fontWeight: "bold",
                                    }}
                                  >
                                    <FontAwesomeIcon icon={faMicrophone} /> Microphone is active and ready
                                  </p>
                                )}
                                {!isMicrophoneEnabled && (
                                  <p
                                    style={{
                                      color: "var(--warning-color, #ffc107)",
                                      fontWeight: "bold",
                                    }}
                                  >
                                    <FontAwesomeIcon icon={faMicrophoneSlash} /> Microphone is muted (you can still make
                                    the call)
                                  </p>
                                )}
                              </>
                            )}

                            {/* Show outgoing room status */}
                            {hookOutgoingCallRoom?.isActive && (
                              <>
                                <p
                                  style={{
                                    color: "var(--success-color, #28a745)",
                                    fontWeight: "bold",
                                  }}
                                >
                                  <FontAwesomeIcon icon={faCircleCheck} /> Outgoing call room ready:{" "}
                                  {hookOutgoingCallRoom.displayName}
                                </p>
                                {hookOutgoingCallRoom.isMediaSFUConnected &&
                                  isMicrophoneEnabled && (
                                    <p
                                      style={{
                                        color: "var(--success-color, #28a745)",
                                        fontWeight: "bold",
                                      }}
                                    >
                                      <FontAwesomeIcon icon={faMicrophone} /> Microphone is active and ready
                                    </p>
                                  )}
                              </>
                            )}

                            {/* Show option to create room if no existing room */}
                            {!isConnectedToOutgoingRoom &&
                              !hookOutgoingCallRoom?.isActive && (
                                <>
                                  <p className="requirement-info">
                                    You can create a voice room for this call
                                  </p>
                                  <button
                                    className="btn btn-primary"
                                    onClick={handleConnectToRoom}
                                    disabled={
                                      sipLoading ||
                                      !selectedFromNumber ||
                                      isCreatingRoom
                                    }
                                    style={{ marginTop: "0.5rem" }}
                                  >
                                    {isCreatingRoom ? (
                                      <>
                                        <LoadingSpinner size="small" />
                                        Creating Room...
                                      </>
                                    ) : (
                                      <><FontAwesomeIcon icon={faMicrophone} /> Create Voice Room</>
                                    )}
                                  </button>
                                  <p
                                    style={{
                                      fontSize: "0.875rem",
                                      color: "var(--text-muted, #6b7280)",
                                      marginTop: "0.5rem",
                                    }}
                                  >
                                    Duration: {selectedDuration} minutes
                                  </p>
                                </>
                              )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <div className="step-actions">
                  <button className="btn btn-secondary" onClick={prevStep}>
                    ← Back
                  </button>
                  <button
                    className="btn btn-success"
                    onClick={handleMakeCall}
                    disabled={(() => {
                      const selectedConfig = sipConfigs.find(
                        (config) =>
                          (config.contactNumber || config.phoneNumber) ===
                          selectedFromNumber
                      );
                      const autoAgent = selectedConfig?.autoAgent;
                      const autoAgentAvailable =
                        autoAgent?.enabled &&
                        autoAgent.type &&
                        (autoAgent.type === "AI" ||
                          autoAgent.type === "IVR" ||
                          autoAgent.type === "PLAYBACK");
                      const botModeAvailable =
                        autoAgentAvailable && autoAgent?.outgoingType === "AI";

                      // Enhanced room availability check
                      const hasExistingActiveRoom =
                        (isConnectedToRoom && currentRoomName) ||
                        hookOutgoingCallRoom?.isActive;
                      const canCreateNewRoom =
                        !isConnectedToRoom &&
                        !hookOutgoingCallRoom?.isActive &&
                        selectedFromNumber;
                      const voiceModeAvailable =
                        hasExistingActiveRoom || canCreateNewRoom;

                      // Call is valid if either:
                      // 1. Bot mode is available (has auto agent AND outgoingType is AI), OR
                      // 2. Voice mode is available (has active room OR can create one)
                      const canMakeCall =
                        botModeAvailable || voiceModeAvailable;

                      return !canMakeCall;
                    })()}
                    title="Make a call with the selected options"
                  >
                    <FontAwesomeIcon icon={faPhone} /> Make Call
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: Call Progress — brief status indicator (main progress is on the room overlay) */}
            {(callFlowStep === "dialing" || callFlowStep === "resolving" || callFlowStep === "ringing" || callFlowStep === "connecting" || callFlowStep === "connected") && (
              <div className="step-content call-progress-section">
                <div className={`call-status-card status-phase-${callFlowStep}`}>
                  <div className="status-card-icon">
                    {callFlowStep === "dialing" && <FontAwesomeIcon icon={faPhone} />}
                    {callFlowStep === "resolving" && <FontAwesomeIcon icon={faLink} />}
                    {callFlowStep === "ringing" && <FontAwesomeIcon icon={faBell} />}
                    {callFlowStep === "connecting" && <FontAwesomeIcon icon={faSatelliteDish} />}
                    {callFlowStep === "connected" && <FontAwesomeIcon icon={faCircleCheck} />}
                  </div>
                  <div className="status-card-content">
                    <div className="status-card-title">
                      {callFlowStep === "dialing" && "DIALING"}
                      {callFlowStep === "resolving" && "RESOLVING"}
                      {callFlowStep === "ringing" && "RINGING"}
                      {callFlowStep === "connecting" && "CONNECTING"}
                      {callFlowStep === "connected" && "CONNECTED"}
                    </div>
                    <div className="status-card-message">
                      Calling {phoneNumber} — see the progress overlay on the room above.
                    </div>
                  </div>
                  {callFlowStep !== "connected" && (
                    <div className="status-card-spinner">
                      <LoadingSpinner size="small" />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quick Call Progress Overlay — removed, progress now overlays the MediaSFU room display */}
      <br />

      <div className="calls-header">
        <div className="header-content">
          <div className="calls-header-title">
            <span className="calls-section-eyebrow">Operator workspace</span>
            <h1>{overrideText("activeHeader", "Active Calls")}</h1>
            <p>See who is waiting, who is connected, and where attention is needed.</p>
          </div>
          <button
            className="btn btn-primary make-call-btn"
            onClick={() => (showDialer ? closeCallFlow() : startCallFlow())}
          >
            {showDialer ? <><FontAwesomeIcon icon={faChevronUp} /> Hide Dialer</> : <><FontAwesomeIcon icon={faPhone} /> Show Dialer</>}
          </button>
        </div>
      </div>

      {/* Active Calls - Full width main content */}
      {allDisplayCalls.filter(
        (call) => !call.sipCallId?.startsWith("dummy_outgoing_")
      ).length > 0 ? (
        <div className="active-calls-main card">
          <div className="active-calls-heading">
            <div className="active-calls-heading-copy">
              <span className="calls-section-eyebrow">Live workspace</span>
              <h3><FontAwesomeIcon icon={faPhone} /> Current Active Calls</h3>
            </div>
            <span className="active-calls-count">
              {allDisplayCalls.filter(
                (call) => !call.sipCallId?.startsWith("dummy_outgoing_")
              ).length}{" "}live{" "}
              {allDisplayCalls.filter(
                (call) => !call.sipCallId?.startsWith("dummy_outgoing_")
              ).length === 1 ? "call" : "calls"}
            </span>
          </div>
          {/* <p className="call-status-info">
            Showing all non-terminated calls (ringing, connecting, active, on-hold)
          </p> */}
          <div className="calls-list">
            {allDisplayCalls
              .filter((call) => !call.sipCallId?.startsWith("dummy_outgoing_"))
              .map((call, index) => {
                const callId = call.sipCallId || `call-${index}`;
                const isExpanded = isCallExpanded(callId);
                const userFacingCallStatus = getUserFacingCallStatus(call);
                const callStatusDisplay = getCallStatusDisplay(call);

                // Determine direction class for styling
                const directionClass =
                  call.direction === "inbound" || call.direction === "incoming"
                    ? "incoming"
                    : "outgoing";

                return (
                  <div
                    key={callId}
                    className={`call-item ${directionClass} ${
                      isExpanded ? "expanded" : ""
                    } ${call.onHold ? "on-hold" : ""}`}
                  >
                    <div
                      className="call-header"
                      role="button"
                      tabIndex={0}
                      aria-expanded={expandedCalls.has(callId)}
                      onKeyDown={buttonKeys(() => toggleCallExpansion(callId))}
                      onClick={() => toggleCallExpansion(callId)}
                    >
                      <div
                        className={`call-direction ${
                          call.direction === "inbound" ||
                          call.direction === "incoming"
                            ? "incoming"
                            : "outgoing"
                        }`}
                      >
                        {call.direction === "inbound" ||
                        call.direction === "incoming"
                          ? <FontAwesomeIcon icon={faArrowDown} />
                          : <FontAwesomeIcon icon={faArrowUp} />}
                        <span className="direction-text">
                          {call.direction === "inbound" ||
                          call.direction === "incoming"
                            ? "Incoming"
                            : "Outgoing"}
                        </span>
                      </div>
                      <div className="call-details">
                        <span className="phone-number">
                          {(() => {
                            const sipUri =
                              call.direction === "outgoing"
                                ? call.calledUri
                                : call.callerIdRaw;
                            const cleanNumber = extractCleanIdentifier(sipUri || "Unknown");
                            // Try to get contact name first
                            const contactName = getDisplayName(cleanNumber);
                            if (contactName) {
                              return (
                                <>
                                  <span className="contact-name-badge">{contactName}</span>
                                  <span className="phone-number-small">{cleanNumber}</span>
                                </>
                              );
                            }
                            return cleanNumber;
                          })()}
                        </span>
                        <span className="caller-name">
                          {(() => {
                            // First try contact lookup
                            const sipUri =
                              call.direction === "outgoing"
                                ? call.calledUri
                                : call.callerIdRaw;
                            const cleanNumber = extractCleanIdentifier(sipUri || "");
                            const contactInfo = getContactInfo(cleanNumber);
                            if (contactInfo?.name) {
                              return contactInfo.company
                                ? `${contactInfo.name} • ${contactInfo.company}`
                                : contactInfo.name;
                            }

                            // Fallback to SIP caller parsing
                            const callerIdRaw = call.callerIdRaw || "";
                            const direction =
                              call.direction === "inbound" ||
                              call.direction === "incoming"
                                ? "INCOMING"
                                : "OUTGOING";
                            const calledUri = call.calledUri || "";

                            if (callerIdRaw) {
                              const callerInfo = parseSipCaller(
                                callerIdRaw,
                                direction,
                                calledUri
                              );
                              return getCallerDisplayString(callerInfo);
                            }

                            return (
                              call.humanParticipantName || "Unknown Caller"
                            );
                          })()}
                        </span>
                        <span className="call-party-line" aria-label="Caller and operator relationship">
                          <span>{directionClass === "incoming" ? "Customer" : "Your team"}</span>
                          <FontAwesomeIcon icon={faArrowDown} />
                          <span>{directionClass === "incoming" ? "Your team" : "Customer"}</span>
                        </span>
                      </div>
                      <div className="call-status">
                        <span className={`status-badge status-${getStatusBadgeClassSuffix(call)}`}>
                          {callStatusDisplay.icon} {callStatusDisplay.label}
                        </span>
                        <span className="call-state-context">
                          {userFacingCallStatus === "active" || userFacingCallStatus === "connected"
                            ? "Conversation live"
                            : userFacingCallStatus === "ringing"
                            ? "Waiting for answer"
                            : userFacingCallStatus === "connecting"
                            ? "Connecting parties"
                            : call.onHold
                            ? "Caller on hold"
                            : "Status pending"}
                        </span>
                        {call.onHold && call.status !== 'on-hold' && (
                          <span className="status-badge status-hold">
                            <FontAwesomeIcon icon={faCircle} style={{ fontSize: '0.5rem', color: '#eab308' }} /> On Hold
                          </span>
                        )}
                        {call.startTimeISO && (
                          <span className="call-time">
                            {new Date(call.startTimeISO).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                      {!isExpanded && (
                        <span className="expand-hint">
                          click to expand for details
                        </span>
                      )}
                      <div className="expand-icon">
                        {isExpanded ? <FontAwesomeIcon icon={faChevronDown} /> : <FontAwesomeIcon icon={faChevronRight} />}
                      </div>
                    </div>

                    {/* Hold banner - visible when call is on hold */}
                    {call.onHold && (
                      <div className="hold-banner">
                        <span className="hold-banner-icon"><FontAwesomeIcon icon={faMusic} /></span>
                        <span>Caller is hearing hold music</span>
                      </div>
                    )}

                    {/* Metrics row - always visible */}
                    <div className="call-metrics-row">
                      <div className="call-metric call-metric-duration">
                        <span className="metric-label">Duration</span>
                        <span className="metric-value"><LiveDuration call={call} /></span>
                      </div>
                      {call.startTimeISO && (
                        <div className="call-metric">
                          <span className="metric-label">Started</span>
                          <span className="metric-value">{new Date(call.startTimeISO).toLocaleTimeString()}</span>
                        </div>
                      )}
                      <div className="call-metric">
                        <span className="metric-label">Source</span>
                        <span className="metric-value">
                          {call.onHold ? <><FontAwesomeIcon icon={faPause} /> On Hold</> :
                           call.activeMediaSource === 'agent' && call.playingMusic ? <><FontAwesomeIcon icon={faMusic} /> Wait Music</> :
                           call.activeMediaSource === 'agent' ? <><FontAwesomeIcon icon={faRobot} /> AI Agent</> :
                           call.activeMediaSource === 'human' ? <><FontAwesomeIcon icon={faUser} /> {call.humanParticipantName || 'Human'}</> :
                           (call.activeMediaSource === 'playback' || call.playingMusic) && call.pendingHumanIntervention ? <><FontAwesomeIcon icon={faMusic} /> Wait Music</> :
                           call.playingMusic ? <><FontAwesomeIcon icon={faMusic} /> Music</> : '—'}
                        </span>
                      </div>
                      {call.roomName && (
                        <div className="call-metric">
                          <span className="metric-label">Room</span>
                          <span className="metric-value metric-mono">{call.roomName}</span>
                        </div>
                      )}
                    </div>

                    {/* Auto-expand for expanded calls and show expanded content when expanded */}
                    {isExpanded && (
                      <div className="call-quick-actions">
                        {/* Join call action for non-joined calls */}
                        {!isStudioOperator && call.roomName && currentRoomName !== call.roomName && (
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleJoinCall(call);
                            }}
                            title={
                              isConnectedToRoom
                                ? "Switch to this call's room"
                                : "Join MediaSFU room for this call"
                            }
                          >
                            <FontAwesomeIcon icon={faBullseye} /> {isConnectedToRoom ? "Switch Room" : "Join Room"}
                          </button>
                        )}

                        {/* Answer/Decline for incoming calls */}
                        {(call.direction === "incoming" ||
                          call.direction === "inbound") &&
                          (call.status === "ringing" ||
                            call.status === "connecting") && (
                            <>
                              <button
                                className="btn btn-success btn-sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAnswerCall(call);
                                }}
                                title="Answer Call"
                              >
                                <FontAwesomeIcon icon={faPhone} /> Answer
                              </button>
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeclineCall(call);
                                }}
                                title="Decline Call"
                              >
                                <FontAwesomeIcon icon={faXmark} /> Decline
                              </button>
                            </>
                          )}

                        {/* Hold/End for active calls */}
                        {(userFacingCallStatus === "active" ||
                          userFacingCallStatus === "connected" ||
                          call.onHold) && (
                          <>
                            <button
                              className={`btn btn-sm ${call.onHold ? 'btn-success' : 'btn-warning'}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleHoldCall(call);
                              }}
                              disabled={!call.onHold && call.playingMusic && call.pendingHumanIntervention && call.activeMediaSource !== 'agent'}
                              title={
                                !call.onHold && call.playingMusic && call.pendingHumanIntervention && call.activeMediaSource !== 'agent'
                                  ? "Wait music already playing"
                                  : call.onHold ? "Resume Call" : "Hold Call"
                              }
                            >
                              {call.onHold ? <><FontAwesomeIcon icon={faPlay} /> Resume</> : <><FontAwesomeIcon icon={faPause} /> Hold</>}
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEndCall(call);
                              }}
                              title="End Call"
                            >
                              <FontAwesomeIcon icon={faCircle} style={{ fontSize: '0.5rem', color: '#ef4444' }} /> End Call
                            </button>
                          </>
                        )}
                      </div>
                    )}

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="call-expanded-details">
                        {/* Critical metadata - always visible when expanded */}
                        <div className="call-metadata critical">
                          <div className="metadata-row">
                            <strong>Status:</strong>{" "}
                            <span
                              className={`status-badge status-${getStatusBadgeClassSuffix(call)}`}
                            >
                              {callStatusDisplay.icon} {callStatusDisplay.label}
                            </span>
                          </div>
                          <div className="metadata-row">
                            <strong>Direction:</strong>{" "}
                            <span className="capitalize">{call.direction}</span>
                          </div>
                          {(call.durationSeconds || call.startTimeISO) && (
                            <div className="metadata-row">
                              <strong>Duration:</strong>{" "}
                              <span>
                                <LiveDuration call={call} />
                              </span>
                            </div>
                          )}
                          {call.startTimeISO && (
                            <div className="metadata-row">
                              <strong>Started:</strong>{" "}
                              <span>
                                {new Date(
                                  call.startTimeISO
                                ).toLocaleTimeString()}
                              </span>
                            </div>
                          )}
                          {call.roomName && (
                            <div className="metadata-row">
                              <strong>Room:</strong>{" "}
                              <span>{call.roomName}</span>
                            </div>
                          )}
                          {call.pendingHumanIntervention && (
                            <div className="metadata-row">
                              <strong>Needs Attention:</strong>{" "}
                              <span className="status-warning">
                                Human intervention required
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Detailed metadata toggle header */}
                        <div className="metadata-section-header">
                          <h4>Detailed Information</h4>
                          <button
                            className="metadata-toggle-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleMetadataCollapse(callId);
                            }}
                            title={
                              isMetadataCollapsed(callId)
                                ? "Show detailed metadata"
                                : "Hide detailed metadata"
                            }
                          >
                            {isMetadataCollapsed(callId)
                              ? <><FontAwesomeIcon icon={faChevronRight} /> Show</>
                              : <><FontAwesomeIcon icon={faChevronDown} /> Hide</>}
                          </button>
                        </div>

                        {/* Detailed metadata - additional technical details */}
                        {!isMetadataCollapsed(callId) && (
                          <div className="call-metadata detailed">
                            <div className="metadata-row">
                              <strong>Call ID:</strong>{" "}
                              <span>{call.sipCallId || "N/A"}</span>
                            </div>
                            <div className="metadata-row">
                              <strong>From:</strong>{" "}
                              <span>
                                {call.direction === "outgoing" || call.direction === "outbound"
                                  ? getFromDisplay(call.callerIdRaw || "", isUsingSystemSip)
                                  : extractCleanIdentifier(call.callerIdRaw || "")}
                              </span>
                            </div>
                            <div className="metadata-row">
                              <strong>To:</strong>{" "}
                              <span>
                                {extractCleanIdentifier(call.calledUri || "")}
                              </span>
                            </div>
                            {call.humanParticipantName && (
                              <div className="metadata-row">
                                <strong>Human Participant:</strong>{" "}
                                <span>{call.humanParticipantName}</span>
                              </div>
                            )}
                            {call.startTimeISO && (
                              <div className="metadata-row">
                                <strong>Full Start Time:</strong>{" "}
                                <span>
                                  {new Date(call.startTimeISO).toLocaleString()}
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Advanced actions in expanded view */}
                        <div className="call-advanced-actions">
                          {!isStudioOperator && call.roomName &&
                            currentRoomName !== call.roomName && (
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleJoinCall(call);
                                }}
                                title={
                                  isConnectedToRoom
                                    ? "Switch to this call's room"
                                    : "Join MediaSFU room for this call"
                                }
                              >
                                <FontAwesomeIcon icon={faBullseye} />{" "}
                                {isConnectedToRoom
                                  ? "Switch Room"
                                  : "Join Room"}
                              </button>
                            )}

                          {/* Call Control Buttons */}
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEndCall(call);
                            }}
                            title="End Call"
                          >
                            <FontAwesomeIcon icon={faCircle} style={{ fontSize: '0.5rem', color: '#ef4444' }} /> End Call
                          </button>

                          <button
                            className={`btn btn-sm ${call.onHold ? 'btn-success' : 'btn-warning'}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleHoldCall(call);
                            }}
                            disabled={!call.onHold && call.playingMusic && call.pendingHumanIntervention && call.activeMediaSource !== 'agent'}
                            title={
                              !call.onHold && call.playingMusic && call.pendingHumanIntervention && call.activeMediaSource !== 'agent'
                                ? "Wait music already playing"
                                : call.onHold ? "Resume Call" : "Hold Call"
                            }
                          >
                            {call.onHold ? <><FontAwesomeIcon icon={faPlay} /> Resume Call</> : <><FontAwesomeIcon icon={faPause} /> Hold Call</>}
                          </button>
                        </div>

                        {/* Media Room Integration - Show when expanded and NOT currently connected to this room */}
                        {!isStudioOperator && call.roomName &&
                          isExpanded &&
                          currentRoomName !== call.roomName && (
                            <div className="call-room-integration">
                              <h4><FontAwesomeIcon icon={faHeadset} /> Media Room Integration</h4>

                              {/* Not connected - Show room details and join button */}
                              <div className="room-details-simple">
                                <div className="room-info">
                                  <span className="room-name">
                                    Room: {call.roomName}
                                  </span>
                                  <span className="status-indicator disconnected">
                                    <FontAwesomeIcon icon={faCircle} style={{ fontSize: '0.5rem', color: '#ef4444' }} /> Not Connected
                                  </span>
                                </div>
                                <p className="connection-help">
                                  Join the media room to participate in
                                  voice/video for this call
                                </p>
                                <button
                                  className="btn btn-primary"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleJoinCall(call);
                                  }}
                                  title="Join MediaSFU room for this call"
                                >
                                  <FontAwesomeIcon icon={faBullseye} /> Join Media Room
                                </button>
                              </div>
                            </div>
                          )}

                        {/* Current Room Notice - Show when this call is in the currently active room */}
                        {!isStudioOperator && call.roomName &&
                          isExpanded &&
                          currentRoomName === call.roomName && (
                            <div className="call-room-integration">
                              <h4><FontAwesomeIcon icon={faHeadset} /> Media Room Integration</h4>
                              <div className="room-details-simple">
                                <div className="room-info">
                                  <span className="room-name">
                                    Room: {call.roomName}
                                  </span>
                                  <span className="status-indicator connected">
                                    <FontAwesomeIcon icon={faCircle} style={{ fontSize: '0.5rem', color: '#22c55e' }} /> Currently Active
                                  </span>
                                </div>

                                {/* Show MediaSFU display for external rooms (rooms we didn't create) */}
                                {/* CRITICAL: Don't render MediaSFURoomDisplay here if this is our active outgoing setup room */}
                                {!isRoomCreatedByUs(call.roomName) &&
                                  !(
                                    currentRoomName === call.roomName &&
                                    isRoomCreatedByUs(currentRoomName)
                                  ) && (
                                    <div className="external-room-mediasfu">
                                      <MediaSFURoomDisplay
                                        roomName={call.roomName}
                                        callId={call.sipCallId}
                                        participantName={currentParticipantName}
                                        isConnected={isConnectedToRoom}
                                        onConnectionChange={handleRoomConnectionChange}
                                        onMicrophoneChange={
                                          handleMicrophoneChange
                                        }
                                        onRoomNameUpdate={handleRoomNameUpdate}
                                        onDisconnect={handleRoomDisconnect}
                                        onEndCall={handleRoomEndCall}
                                        autoJoin={!isStudioOperator}
                                        isOutgoingCallSetup={false}
                                        currentCall={call}
                                        duration={30}
                                      />
                                    </div>
                                  )}
                              </div>
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      ) : (
        <div className="no-calls-state card">
          <div className="no-calls-content">
            <div className="no-calls-icon"><FontAwesomeIcon icon={faPhone} /></div>
            <span className="no-calls-kicker">Workspace clear</span>
            <h3>{overrideText("emptyTitle", "No Active Calls")}</h3>
            <p>
              No caller needs attention right now. Open the dialer when ready,
              or keep this workspace open for inbound calls.
            </p>
            <button className="btn btn-primary" onClick={() => startCallFlow()}>
              {showDialer ? <><FontAwesomeIcon icon={faChevronUp} /> Hide Dialer</> : <><FontAwesomeIcon icon={faPhone} /> Show Dialer</>}
            </button>
          </div>
        </div>
      )}

      {/* ─── Recent Call History (localStorage) ─── */}
      {callHistory.length > 0 && (
        <div className="call-history-section card" style={{ marginTop: '1rem' }}>
          <div
            className="call-history-header"
            role="button"
            tabIndex={0}
            aria-expanded={showCallHistory}
            onKeyDown={buttonKeys(() => setShowCallHistory(!showCallHistory))}
            onClick={() => setShowCallHistory(!showCallHistory)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer', padding: '0.75rem 1rem',
              background: 'var(--card-bg, #1e293b)', borderRadius: showCallHistory ? '8px 8px 0 0' : '8px',
              border: '1px solid var(--border-color, #334155)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1rem' }}><FontAwesomeIcon icon={faClipboardList} /></span>
              <h3 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-color, #e2e8f0)' }}>
                Recent Calls ({callHistory.length})
              </h3>
              <span style={{
                fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px',
                background: 'rgba(59,130,246,0.15)', color: '#60a5fa', fontWeight: 500,
              }}>
                session only
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                className="btn btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm('Clear all call history?')) clearCallHistory();
                }}
                title="Clear history"
                style={{
                  background: 'transparent', border: 'none', color: '#94a3b8',
                  fontSize: '0.75rem', cursor: 'pointer', padding: '2px 6px',
                }}
              >
                <FontAwesomeIcon icon={faTrash} />
              </button>
              <span style={{ color: '#94a3b8', fontSize: '0.8rem', transition: 'transform 0.2s', transform: showCallHistory ? 'rotate(180deg)' : 'rotate(0)' }}>
                ▼
              </span>
            </div>
          </div>

          {showCallHistory && (
            <div style={{
              border: '1px solid var(--border-color, #334155)', borderTop: 'none',
              borderRadius: '0 0 8px 8px', maxHeight: '300px', overflowY: 'auto',
            }}>
              {callHistory
                .sort((a, b) => {
                  const aTime = a.startTimeISO ? new Date(a.startTimeISO).getTime() : (a.startTime ? new Date(a.startTime).getTime() : 0);
                  const bTime = b.startTimeISO ? new Date(b.startTimeISO).getTime() : (b.startTime ? new Date(b.startTime).getTime() : 0);
                  return bTime - aTime;
                })
                .slice(0, 50)
                .map((call, i) => {
                  const sipUri = call.direction === 'outgoing' || call.direction === 'outbound'
                    ? call.calledUri : call.callerIdRaw;
                  const number = extractCleanIdentifier(sipUri || 'Unknown');
                  const duration = call.durationSeconds || call.duration || 0;
                  const isTerminated = ['terminated', 'ended', 'failed', 'completed'].includes(call.status || '');
                  const timeStr = call.startTimeISO
                    ? new Date(call.startTimeISO).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : call.startTime ? new Date(call.startTime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
                  const statusIcon = isTerminated ? (duration > 0 ? '✓' : '✗') : call.status === 'active' ? '●' : '○';

                  return (
                    <div
                      key={call.sipCallId || `hist-${i}`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                        padding: '0.6rem 1rem',
                        borderBottom: '1px solid var(--border-color, #1e293b)',
                        background: 'var(--card-bg, #0f172a)',
                        fontSize: '0.85rem',
                      }}
                    >
                      {(() => {
                        const isIncoming = call.direction === 'inbound' || call.direction === 'incoming';
                        return (
                          <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                            background: isIncoming ? 'rgba(59,130,246,0.15)' : 'rgba(34,197,94,0.15)',
                          }}>
                            <span style={{
                              fontSize: '0.85rem',
                              display: 'inline-block',
                              transform: isIncoming ? 'rotate(135deg)' : 'rotate(-45deg)',
                            }}>
                              ➜
                            </span>
                          </div>
                        );
                      })()}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ fontWeight: 500, color: 'var(--text-color, #e2e8f0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {number}
                          </span>
                          <span style={{
                            fontSize: '0.6rem', padding: '1px 5px', borderRadius: '3px', fontWeight: 600, flexShrink: 0,
                            background: (call.direction === 'inbound' || call.direction === 'incoming') ? 'rgba(59,130,246,0.2)' : 'rgba(34,197,94,0.2)',
                            color: (call.direction === 'inbound' || call.direction === 'incoming') ? '#60a5fa' : '#4ade80',
                          }}>
                            {(call.direction === 'inbound' || call.direction === 'incoming') ? 'IN' : 'OUT'}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                          {timeStr}
                          {duration > 0 && ` · ${Math.floor(duration / 60)}m ${duration % 60}s`}
                        </div>
                      </div>
                      <span style={{ fontSize: '0.75rem', flexShrink: 0 }}>{statusIcon}</span>
                    </div>
                  );
                })}

              {/* Footer with link to full dashboard */}
              <div style={{
                padding: '0.6rem 1rem', textAlign: 'center',
                background: 'rgba(59,130,246,0.05)',
                borderTop: '1px solid var(--border-color, #334155)',
                fontSize: '0.75rem', color: '#94a3b8',
              }}>
                <FontAwesomeIcon icon={faChartBar} style={{ marginRight: '0.25rem' }} /> For full call history & analytics, visit{' '}
                <a
                  href="https://mediasfu.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#60a5fa', textDecoration: 'none' }}
                >
                  mediasfu.com/dashboard
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      <br />

      {/* Notification Modal for toast messages */}
      <NotificationModal
        isOpen={notification.isOpen}
        title={notification.title}
        message={notification.message}
        type={notification.type}
        onClose={closeNotification}
      />

      {/* Quick Call Dialog */}
      {showQuickCallDialog && (
        <div className="quick-call-overlay" onClick={closeQuickCallDialog}>
          <div
            className="quick-call-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Quick call"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="quick-call-header">
              <div className="quick-call-title-row">
                <span className="quick-call-icon"><FontAwesomeIcon icon={faMobileAlt} /></span>
                <h3>Quick Call</h3>
              </div>
              <button
                className="quick-call-close-btn"
                onClick={closeQuickCallDialog}
                title="Close"
              >
                ✕
              </button>
            </div>
            <p className="quick-call-subtitle">
              Enter a number or select a contact to call instantly
            </p>

            {/* Caller ID display */}
            {selectedFromNumber && (
              <div className="quick-call-caller-id">
                Calling from:{" "}
                <strong>
                  {isUsingSystemSip
                    ? "MediaSFU System Number"
                    : selectedFromNumber}
                </strong>
              </div>
            )}

            {/* Phone number input */}
            <div className="quick-call-input-row">
              <input
                type="tel"
                className="quick-call-input"
                placeholder="+15551234567"
                value={quickCallPhone}
                onChange={(e) => setQuickCallPhone(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && quickCallPhone) {
                    initiateQuickCall(quickCallPhone);
                  }
                }}
                autoFocus
              />
              <button
                className="btn btn-success quick-call-btn"
                onClick={() => initiateQuickCall(quickCallPhone)}
                disabled={!quickCallPhone}
              >
                <FontAwesomeIcon icon={faPhone} /> {overrideText("callButton", "Call Now")}
              </button>
            </div>

            {/* Contacts section - only show when contacts are available (widget has no CRM endpoint) */}
            {contactsLoaded && (contacts.length > 0 || favorites.length > 0) && (<>
            {/* Divider */}
            <div className="quick-call-divider">
              <span>— or select a contact —</span>
            </div>

            {/* Tab selector */}
            <div className="quick-call-tabs">
              <button
                className={`quick-call-tab ${
                  quickCallContactTab === 0 ? "active" : ""
                }`}
                onClick={() => setQuickCallContactTab(0)}
              >
                <FontAwesomeIcon icon={faStar} /> Favorites
              </button>
              <button
                className={`quick-call-tab ${
                  quickCallContactTab === 1 ? "active" : ""
                }`}
                onClick={() => setQuickCallContactTab(1)}
              >
                <FontAwesomeIcon icon={faCloud} /> All Contacts
              </button>
            </div>

            {/* Search within contacts */}
            <input
              type="text"
              className="quick-call-search"
              placeholder="Search contacts..."
              value={quickCallSearchQuery}
              onChange={(e) => setQuickCallSearchQuery(e.target.value)}
            />

            {/* Contacts list */}
            <div className="quick-call-contacts-list">
              {(() => {
                const sourceContacts =
                  quickCallContactTab === 0
                    ? favorites || []
                    : contacts || [];
                const filtered = quickCallSearchQuery
                  ? sourceContacts.filter(
                      (c: any) =>
                        (c.name || "")
                          .toLowerCase()
                          .includes(quickCallSearchQuery.toLowerCase()) ||
                        (c.phoneNumber || "")
                          .includes(quickCallSearchQuery)
                    )
                  : sourceContacts;

                if (!contactsLoaded) {
                  return (
                    <div className="quick-call-empty-state">
                      Loading contacts...
                    </div>
                  );
                }

                if (filtered.length === 0) {
                  return (
                    <div className="quick-call-empty-state">
                      {quickCallContactTab === 0
                        ? "No favorite contacts found"
                        : "No contacts found"}
                    </div>
                  );
                }

                return filtered.slice(0, 30).map((contact: any) => {
                  const phone =
                    contact.phoneNumber ||
                    (contact.phoneNumbers?.[0]?.number ?? "");
                  const initials = (contact.name || "?")
                    .split(" ")
                    .map((w: string) => w[0])
                    .join("")
                    .substring(0, 2)
                    .toUpperCase();
                  return (
                    <div
                      key={contact._id || phone}
                      className="quick-call-contact-item"
                    >
                      <div className="quick-call-contact-avatar">
                        {initials}
                      </div>
                      <div className="quick-call-contact-info">
                        <span className="quick-call-contact-name">
                          {contact.name || "Unknown"}
                        </span>
                        <span className="quick-call-contact-phone">
                          {phone}
                        </span>
                      </div>
                      <button
                        className="btn btn-success quick-call-contact-call-btn"
                        onClick={() => phone && initiateQuickCall(phone)}
                        disabled={!phone}
                        title={`Call ${contact.name}`}
                      >
                        <FontAwesomeIcon icon={faPhone} />
                      </button>
                    </div>
                  );
                });
              })()}
            </div>
          </>)}
          </div>
        </div>
      )}

      {/* Microphone Confirmation Modal */}
      <ConfirmationModal
        isOpen={microphoneConfirmation.isOpen}
        title="Microphone Disabled"
        message="You're making a call from your voice room but your microphone is disabled. The call will start without your audio participation. Do you want to proceed anyway?"
        onConfirm={handleMicrophoneGoBack}
        onCancel={handleMicrophoneGoBack}
        footerContent={(
          <div
            className="confirmation-modal-actions confirmation-modal-actions-stacked"
            aria-busy={microphoneConfirmation.isProcessing}
          >
            <button
              onClick={() => retryMakeCallWithMicrophoneMode("unmute")}
              className="confirmation-btn confirmation-btn-confirm confirmation-btn-wide"
              disabled={microphoneConfirmation.isProcessing}
              title="Turn your microphone on first, wait briefly for MediaSFU to apply it, then place the call with your audio enabled."
            >
              <FontAwesomeIcon
                icon={
                  microphoneConfirmation.isProcessing &&
                  microphoneConfirmation.mode === "unmute"
                    ? faSpinner
                    : faMicrophone
                }
                spin={
                  microphoneConfirmation.isProcessing &&
                  microphoneConfirmation.mode === "unmute"
                }
              />
              {microphoneConfirmation.isProcessing &&
              microphoneConfirmation.mode === "unmute"
                ? "Unmuting and Continuing..."
                : "Unmute and Proceed"}
            </button>
            <div className="confirmation-modal-actions-row">
              <button
                onClick={handleMicrophoneGoBack}
                className="confirmation-btn confirmation-btn-cancel"
                disabled={microphoneConfirmation.isProcessing}
                title="Return to the call flow without placing the call."
              >
                <FontAwesomeIcon icon={faXmark} />
                Go Back
              </button>
              <button
                onClick={() => retryMakeCallWithMicrophoneMode("muted")}
                className="confirmation-btn confirmation-btn-confirm warning"
                disabled={microphoneConfirmation.isProcessing}
                title="Place the call immediately and stay muted at the start of the conversation."
              >
                <FontAwesomeIcon
                  icon={
                    microphoneConfirmation.isProcessing &&
                    microphoneConfirmation.mode === "muted"
                      ? faSpinner
                      : faMicrophoneSlash
                  }
                  spin={
                    microphoneConfirmation.isProcessing &&
                    microphoneConfirmation.mode === "muted"
                  }
                />
                {microphoneConfirmation.isProcessing &&
                microphoneConfirmation.mode === "muted"
                  ? "Continuing Call..."
                  : "Proceed Muted"}
              </button>
            </div>
          </div>
        )}
        type="warning"
      />

      {/* Navigation confirmation modal */}
      <ConfirmationModal
        isOpen={navigationConfirmation.isOpen}
        title="Leave Page?"
        message={navigationConfirmation.message}
        confirmText="Leave Page"
        cancelText="Stay Here"
        onConfirm={() => {
          if (navigationConfirmation.onConfirm) {
            navigationConfirmation.onConfirm();
          }
        }}
        onCancel={() => {
          if (navigationConfirmation.onCancel) {
            navigationConfirmation.onCancel();
          }
        }}
        type="warning"
      />
    </div>
  );
};

export default CallsPage;
