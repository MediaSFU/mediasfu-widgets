import {
  getActiveCallIdentity,
  type ActiveCallIdentity,
} from './activeCallIdentity';

export function getActiveCallIdentities(values: unknown[]): ActiveCallIdentity[] {
  const identities = new Map<string, ActiveCallIdentity>();

  for (const value of values) {
    const identity = getActiveCallIdentity(value);
    if (identity) identities.set(identity.callId, identity);
  }

  return Array.from(identities.values());
}

export function getActiveCallIdentityKey(identities: ActiveCallIdentity[]): string {
  return identities
    .map(({ callId, roomName }) => `${callId}\u0000${roomName || ''}`)
    .join('\u0001');
}

export function createActiveCallsPublisher(
  onChange?: (calls: ActiveCallIdentity[]) => void
): (values: unknown[]) => void {
  let lastKey: string | null = null;

  return (values) => {
    if (!onChange) return;

    const identities = getActiveCallIdentities(values);
    const key = getActiveCallIdentityKey(identities);
    if (key === lastKey) return;

    lastKey = key;
    onChange(identities);
  };
}
