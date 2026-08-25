/**
 * Utility function to parse SIP caller information consistently across the application
 * Returns structured caller data without domain information, showing either number or IP
 */

import { logger } from './logger';

export interface ParsedSipCaller {
  name: string | null;
  number: string | null;
  ip: string | null;
  sip: string | null;
  display: string;
  type: 'pstn' | 'voip-ip' | 'voip-uri' | 'unknown';
}

/**
 * Extract clean phone number or IP address from SIP URI
 * Examples:
 * - "<sip:+15879916872@sip.zadarma.com>;tag=as676c34b8" -> "+15879916872"
 * - "<sip:192.168.1.203>;tag=9f923379" -> "192.168.1.203"
 * - "sip:+16475586650@sip.mediasfu.com" -> "+16475586650"
 */
export const extractCleanIdentifier = (sipUri: string): string => {
  if (!sipUri) return 'Unknown';

  try {
    // Remove < > brackets and anything after semicolon
    let cleaned = sipUri.replace(/[<>]/g, '').split(';')[0];

    // Extract the part between sip: and @
    const match = cleaned.match(/sip:([^@]+)/);
    if (match) {
      const identifier = match[1];

      // Check if it's a phone number (starts with + or contains only digits)
      if (identifier.match(/^\+?\d+$/)) {
        return identifier;
      }

      // Check if it's an IP address
      if (identifier.match(/^\d+\.\d+\.\d+\.\d+$/)) {
        return identifier;
      }

      // Return the identifier as-is for other cases
      return identifier;
    }

    // Fallback: return the original if no pattern matches
    return sipUri;
  } catch (error) {
    logger.warn('Error parsing SIP URI:', error);
    return sipUri;
  }
};

export const parseSipCaller = (callerIdRaw: string, direction?: 'INCOMING' | 'OUTGOING', calledUri?: string): ParsedSipCaller => {
  // For outgoing calls, use calledUri instead of callerIdRaw
  const sourceString = (direction === 'OUTGOING' && calledUri) ? calledUri : callerIdRaw;

  if (!sourceString) {
    return {
      name: null,
      number: null,
      ip: null,
      sip: null,
      display: direction === 'OUTGOING' ? 'Unknown Number' : 'Unknown Caller',
      type: 'unknown'
    };
  }

  try {
    // Pattern 1: "Name" <sip:+number@domain>;tag=...
    const namedSipPattern = /^"([^"]+)"\s*<sip:([^@>]+)@([^>]+)>/;
    const namedMatch = sourceString.match(namedSipPattern);

    if (namedMatch) {
      const [, name, identifier] = namedMatch;
      // Check if identifier is a phone number (starts with +)
      const isPhoneNumber = identifier.startsWith('+');

      return {
        name: name.trim(),
        number: isPhoneNumber ? identifier : null,
        ip: !isPhoneNumber ? identifier : null,
        sip: null,
        display: `${name.trim()}`,
        type: isPhoneNumber ? 'pstn' : 'voip-ip'
      };
    }

    // Pattern 2: <sip:identifier@domain> or <sip:identifier>;tag=...
    const simpleSipPattern = /<sip:([^@>;]+)(?:@([^>]+))?>/;
    const simpleMatch = sourceString.match(simpleSipPattern);

    if (simpleMatch) {
      const [, identifier] = simpleMatch;
      // Check if identifier looks like a phone number
      const isPhoneNumber = /^\+?\d+$/.test(identifier);
      // Check if identifier looks like an IP address
      const isIpAddress = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(identifier);

      let displayName = 'Unknown Caller';
      let type: ParsedSipCaller['type'] = 'unknown';

      if (isPhoneNumber) {
        displayName = identifier.startsWith('+') ? identifier : `+${identifier}`;
        type = 'pstn';
      } else if (isIpAddress) {
        displayName = identifier;
        type = 'voip-ip';
      } else {
        displayName = identifier;
        type = 'voip-uri';
      }

      return {
        name: null,
        number: isPhoneNumber ? (identifier.startsWith('+') ? identifier : `+${identifier}`) : null,
        ip: isIpAddress ? identifier : null,
        sip: !isPhoneNumber && !isIpAddress ? identifier : null,
        display: displayName,
        type
      };
    }

    // Pattern 2b: sip:identifier@domain (without angle brackets) - handles various SIP URI formats
    const sipUriPattern = /^sip:([^@;\s]+)(?:@([^;\s?&]+))?/;
    const sipUriMatch = sourceString.match(sipUriPattern);

    if (sipUriMatch) {
      const [, identifier] = sipUriMatch;
      // Check if identifier looks like a phone number
      const isPhoneNumber = /^\+?\d+$/.test(identifier);
      // Check if identifier looks like an IP address
      const isIpAddress = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(identifier);

      let displayName = 'Unknown Caller';
      let type: ParsedSipCaller['type'] = 'unknown';

      if (isPhoneNumber) {
        displayName = identifier.startsWith('+') ? identifier : `+${identifier}`;
        type = 'pstn';
      } else if (isIpAddress) {
        displayName = identifier;
        type = 'voip-ip';
      } else {
        displayName = identifier;
        type = 'voip-uri';
      }

      return {
        name: null,
        number: isPhoneNumber ? (identifier.startsWith('+') ? identifier : `+${identifier}`) : null,
        ip: isIpAddress ? identifier : null,
        sip: !isPhoneNumber && !isIpAddress ? identifier : null,
        display: displayName,
        type
      };
    }

    // Pattern 3: Direct phone number format
    const phonePattern = /^\+?\d+$/;
    if (phonePattern.test(sourceString.trim())) {
      const number = sourceString.trim().startsWith('+') ? sourceString.trim() : `+${sourceString.trim()}`;
      return {
        name: null,
        number,
        ip: null,
        sip: null,
        display: number,
        type: 'pstn'
      };
    }

    // Pattern 4: Direct IP address format
    const ipPattern = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
    if (ipPattern.test(sourceString.trim())) {
      return {
        name: null,
        number: null,
        ip: sourceString.trim(),
        sip: null,
        display: sourceString.trim(),
        type: 'voip-ip'
      };
    }

    // Fallback: return raw value if no pattern matches
    return {
      name: null,
      number: null,
      ip: null,
      sip: null,
      display: sourceString,
      type: 'unknown'
    };
  } catch (error) {
    logger.error('Error parsing SIP caller:', error);
    return {
      name: null,
      number: null,
      ip: null,
      sip: null,
      display: sourceString,
      type: 'unknown'
    };
  }
};

/**
 * Get a formatted display string for a caller
 */
export const getCallerDisplayString = (callerInfo: ParsedSipCaller): string => {
  if (callerInfo.name) {
    const identifier = callerInfo.number || callerInfo.ip || callerInfo.sip;
    return identifier ? `${callerInfo.name} (${identifier})` : callerInfo.name;
  }

  return callerInfo.display;
};

/**
 * Get the primary identifier (number or IP) for a caller
 */
export const getCallerIdentifier = (callerInfo: ParsedSipCaller): string | null => {
  return callerInfo.number || callerInfo.ip || callerInfo.sip;
};

/**
 * Get a type-specific icon for the caller
 */
export const getCallerTypeIcon = (type: ParsedSipCaller['type']): string => {
  switch (type) {
    case 'pstn':
      return '📞';
    case 'voip-ip':
    case 'voip-uri':
      return '🌐';
    default:
      return '❓';
  }
};
