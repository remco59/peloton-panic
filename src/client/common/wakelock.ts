/**
 * Keep the screen on while this page is open, so the laptop behind the TV doesn't dim or sleep
 * in the middle of a race. Needs a secure context (localhost counts) and is a no-op elsewhere.
 */
export function keepScreenOn(): void {
  if (!('wakeLock' in navigator)) return;

  let lock: WakeLockSentinel | null = null;

  const acquire = async () => {
    if (lock || document.visibilityState !== 'visible') return;
    try {
      lock = await navigator.wakeLock.request('screen');
      // The browser drops the lock when the tab is hidden or the battery is low; ask again later.
      lock.addEventListener('release', () => {
        lock = null;
      });
    } catch {
      // Denied (battery saver, no user gesture yet): the next visibility change or tap retries.
    }
  };

  void acquire();
  document.addEventListener('visibilitychange', () => void acquire());
  // Some browsers only grant the lock after a user gesture; the TV needs one click for sound anyway.
  window.addEventListener('pointerdown', () => void acquire());
  window.addEventListener('keydown', () => void acquire());
}
