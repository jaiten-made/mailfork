const RECONCILE_HOUR = 3;

/** Milliseconds from `now` until the next RECONCILE_HOUR:00, local time. */
function untilNextRun(now: Date) {
  const next = new Date(now);
  next.setHours(RECONCILE_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * Runs the task every night at 03:00 local time. The delay is worked out
 * again before each run, so daylight saving never shifts it.
 */
export function scheduleNightly(task: () => Promise<unknown>) {
  const scheduleNext = () => {
    setTimeout(async () => {
      try {
        await task();
      } catch (error) {
        console.error("Nightly task failed:", error instanceof Error ? error.message : error);
      }
      scheduleNext();
    }, untilNextRun(new Date()));
  };
  scheduleNext();
}
