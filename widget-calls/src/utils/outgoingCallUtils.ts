import Cookies from 'js-cookie';

// Cookie key for storing created outgoing call rooms
const OUTGOING_ROOMS_COOKIE_KEY = 'mediasfu_created_outgoing_rooms';

// Interface for stored room data
interface StoredOutgoingRoom {
  roomName: string;
  createdAt: number;
  originalParticipantName: string;
}

/**
 * Store a room name that was created for an outgoing call
 * @param roomName - The MediaSFU room name
 * @param participantName - The original participant name used
 */
export function storeCreatedOutgoingRoom(roomName: string, participantName: string): void {
  try {
    const stored = getStoredOutgoingRooms();

    // Add the new room
    stored[roomName] = {
      roomName,
      createdAt: Date.now(),
      originalParticipantName: participantName
    };

    // Clean up expired rooms (older than 6 hours)
    const sixHoursAgo = Date.now() - (6 * 60 * 60 * 1000);
    Object.keys(stored).forEach(key => {
      if (stored[key].createdAt < sixHoursAgo) {
        delete stored[key];
      }
    });

    // Store back in cookies with 6 hour expiration
    Cookies.set(OUTGOING_ROOMS_COOKIE_KEY, JSON.stringify(stored), {
      expires: 1/4, // 6 hours (1/4 of a day)
      sameSite: 'strict',
      secure: window.location.protocol === 'https:'
    });
  } catch (error) {
    // Failed to store outgoing room - continue without throwing
  }
}

/**
 * Check if we created a specific room for an outgoing call
 * @param roomName - The MediaSFU room name to check
 * @returns The stored room data if we created it, null otherwise
 */
export function wasRoomCreatedByUs(roomName: string): StoredOutgoingRoom | null {
  try {
    const stored = getStoredOutgoingRooms();
    return stored[roomName] || null;
  } catch (error) {
    // Failed to check stored room - return null
    return null;
  }
}

/**
 * Generate a name variant to avoid "participant already exists" error
 * @param originalName - The original participant name
 * @param increment - The numeric increment to add (default: 1)
 * @returns Modified name variant
 */
export function generateNameVariant(originalName: string, increment: number = 1): string {
  if (!originalName) return `User${increment}`;

  // If name is less than 10 characters, append the increment
  if (originalName.length < 10) {
    return `${originalName}${increment}`;
  }

  // If name is 10+ characters, remove last character and add increment
  return `${originalName.slice(0, -1)}${increment}`;
}

/**
 * Get the appropriate participant name for joining a room
 * @param roomName - The MediaSFU room name
 * @param originalParticipantName - The original participant name
 * @returns The name to use (variant if we created the room, original otherwise)
 */
export function getParticipantNameForRoom(roomName: string, originalParticipantName: string): string {
  const storedRoom = wasRoomCreatedByUs(roomName);

  if (storedRoom) {
    // We created this room, use a name variant to avoid conflict
    // Use increment 2 since the original name (increment 1) is already taken
    return generateNameVariant(storedRoom.originalParticipantName, 2);
  }

  // We didn't create this room, use the original name
  return originalParticipantName;
}

/**
 * Remove a stored outgoing room (cleanup when room is closed)
 * @param roomName - The MediaSFU room name to remove
 */
export function removeStoredOutgoingRoom(roomName: string): void {
  try {
    const stored = getStoredOutgoingRooms();
    delete stored[roomName];

    Cookies.set(OUTGOING_ROOMS_COOKIE_KEY, JSON.stringify(stored), {
      expires: 1/4, // 6 hours
      sameSite: 'strict',
      secure: window.location.protocol === 'https:'
    });
  } catch (error) {
    // Failed to remove stored room - continue without throwing
  }
}

/**
 * Get all stored outgoing rooms from cookies
 * @returns Object with room names as keys and StoredOutgoingRoom data as values
 */
function getStoredOutgoingRooms(): Record<string, StoredOutgoingRoom> {
  try {
    const stored = Cookies.get(OUTGOING_ROOMS_COOKIE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    // Failed to parse stored rooms - return empty object
    return {};
  }
}

/**
 * Format username for MediaSFU (alphanumeric only, max 10 characters)
 * @param username - The original username
 * @returns Formatted username suitable for MediaSFU
 */
export function formatUsernameForMediaSFU(username: string): string {
  if (!username) return "user";

  // Remove non-alphanumeric characters and limit to 10 characters
  const cleaned = username.replace(/[^a-zA-Z0-9]/g, "");
  return cleaned.substring(0, 10) || "user";
}

/**
 * Get stored MediaSFU participant name from cookies
 * @returns Stored participant name or empty string
 */
export function getStoredMediaSFUName(): string {
  try {
    return Cookies.get("mediasfu_participant_name") || "";
  } catch {
    return "";
  }
}

/**
 * Store MediaSFU participant name in cookies
 * @param name - The participant name to store
 */
export function setStoredMediaSFUName(name: string): void {
  try {
    Cookies.set("mediasfu_participant_name", name, { expires: 365 });
  } catch {
    // Ignore cookie errors
  }
}

/**
 * Get the appropriate MediaSFU participant name
 * @param apiUserName - The API username to use as fallback
 * @returns Properly formatted participant name
 */
export function getMediaSFUParticipantName(apiUserName?: string): string {
  // Check if we have a stored name first
  let storedName = getStoredMediaSFUName();

  if (!storedName && apiUserName) {
    // Generate and store a new formatted name from apiUserName
    storedName = formatUsernameForMediaSFU(apiUserName);
    setStoredMediaSFUName(storedName);
  }

  return storedName || "voipuser";
}
