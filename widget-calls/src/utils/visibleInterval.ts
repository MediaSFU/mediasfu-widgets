/**
 * setInterval that suspends itself while the document is hidden.
 *
 * This widget is embedded on other people's websites, where a tab can sit in
 * the background for hours. A plain setInterval keeps polling the whole time —
 * spending the host page's network budget and the visitor's battery to produce
 * output nobody can see. The calls widget is the worst offender: during an
 * active call it runs a 5s calls poll, a 4s call-end poll and a 10s room
 * verification concurrently.
 *
 * Behaviour:
 *  - starts immediately if the document is currently visible
 *  - clears the timer on `visibilitychange` → hidden
 *  - on return to visible, runs the callback once straight away (so call state
 *    is never seen stale) and then resumes the normal cadence
 *
 * Returns a cancel function that clears both the timer and the listener; call
 * it from the effect cleanup exactly where you previously called
 * clearInterval.
 */
export const startVisibleInterval = (
  callback: () => void,
  intervalMs: number,
  options: { runOnVisible?: boolean } = {}
): (() => void) => {
  const { runOnVisible = true } = options;

  let timerId: ReturnType<typeof setInterval> | null = null;

  const start = () => {
    if (timerId === null) {
      timerId = setInterval(callback, intervalMs);
    }
  };

  const stop = () => {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  };

  const handleVisibility = () => {
    if (document.visibilityState === "hidden") {
      stop();
    } else {
      if (runOnVisible) callback();
      start();
    }
  };

  if (document.visibilityState !== "hidden") start();
  document.addEventListener("visibilitychange", handleVisibility);

  return () => {
    stop();
    document.removeEventListener("visibilitychange", handleVisibility);
  };
};
