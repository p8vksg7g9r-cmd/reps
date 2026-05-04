// Big tap-counter button with long-press undo.

export function makeTapCounter({ onChange } = {}) {
  let count = 0;
  let pressTimer = null;
  let didLongPress = false;

  const root = document.createElement("button");
  root.type = "button";
  root.className = "tap-button";
  root.setAttribute("aria-label", "Tap to count rep, long-press to undo");
  root.textContent = "0";

  function set(n) {
    count = Math.max(0, n);
    root.textContent = String(count);
    onChange?.(count);
  }

  function startPress() {
    didLongPress = false;
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      didLongPress = true;
      set(count - 1);
      // Haptic-ish double pulse via visual flash (no Vibration API on iOS PWA).
      root.animate(
        [{ transform: "scale(1)" }, { transform: "scale(0.96)" }, { transform: "scale(1)" }],
        { duration: 180 }
      );
      if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
    }, 550);
  }

  function endPress(e) {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    if (didLongPress) { didLongPress = false; e?.preventDefault?.(); return; }
    set(count + 1);
    if (navigator.vibrate) navigator.vibrate(8);
  }

  root.addEventListener("pointerdown", startPress);
  root.addEventListener("pointerup", endPress);
  root.addEventListener("pointerleave", () => {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    didLongPress = false;
  });
  root.addEventListener("contextmenu", (e) => e.preventDefault());

  return {
    el: root,
    get count() { return count; },
    reset() { set(0); },
    set
  };
}
