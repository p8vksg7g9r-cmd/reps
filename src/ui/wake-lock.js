// Screen wake lock helper. The Wake Lock API releases the lock automatically
// when the page becomes hidden — we re-acquire it on visibilitychange so the
// screen stays on across brief background switches during a session.
//
// `wanted` tracks the caller's intent. acquireWakeLock sets it to true; the
// visibility listener uses it to decide whether to re-acquire on return.
// releaseWakeLock clears it so we don't keep grabbing the lock forever after
// a session ends.

let wakeLock = null;
let wanted = false;

export async function acquireWakeLock() {
  wanted = true;
  if (!("wakeLock" in navigator)) return false;
  if (wakeLock) return true;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
    return true;
  } catch {
    wakeLock = null;
    return false;
  }
}

export function releaseWakeLock() {
  wanted = false;
  if (wakeLock) {
    try { wakeLock.release(); } catch {}
    wakeLock = null;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && wanted && !wakeLock) {
    acquireWakeLock().catch(() => {});
  }
});
