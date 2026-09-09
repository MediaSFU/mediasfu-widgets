export const AUDIO_PLAYBACK_EDGE_FADE_SECONDS = 0.006;

export type AudioPlaybackEnvelope = {
  startAt: number;
  fadeInEndAt: number;
  fadeOutStartAt: number;
  endAt: number;
};

/** Build a click-suppression envelope whose ramps never overlap. */
export const getAudioPlaybackEnvelope = (
  startAt: number,
  endAt: number,
  requestedFadeSeconds = AUDIO_PLAYBACK_EDGE_FADE_SECONDS
): AudioPlaybackEnvelope => {
  const safeStartAt = Number.isFinite(startAt) ? startAt : 0;
  const safeEndAt = Math.max(
    safeStartAt,
    Number.isFinite(endAt) ? endAt : safeStartAt
  );
  const duration = safeEndAt - safeStartAt;
  const fadeSeconds = Math.min(
    Math.max(
      0,
      Number.isFinite(requestedFadeSeconds) ? requestedFadeSeconds : 0
    ),
    duration / 2
  );

  return {
    startAt: safeStartAt,
    fadeInEndAt: safeStartAt + fadeSeconds,
    fadeOutStartAt: safeEndAt - fadeSeconds,
    endAt: safeEndAt,
  };
};
