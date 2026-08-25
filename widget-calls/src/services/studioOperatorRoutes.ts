export const STUDIO_CALLS_BASE_PATH = '/v1/studio-operator/calls';

function encodeIdentifier(value: string): string {
  return encodeURIComponent(String(value || '').trim());
}

export function studioCallsCollectionPath(): string {
  return STUDIO_CALLS_BASE_PATH;
}

export function studioCallPath(callId: string): string {
  return `${STUDIO_CALLS_BASE_PATH}/${encodeIdentifier(callId)}`;
}

export function studioCallControlPath(callId: string, action: string): string {
  return `${studioCallPath(callId)}/control/${encodeIdentifier(action)}`;
}
