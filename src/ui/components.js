// Tiny render helpers. No framework — just a thin h() and a few atoms.

export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k in el && typeof v !== "object") {
      try { el[k] = v; } catch { el.setAttribute(k, v); }
    } else {
      el.setAttribute(k, v);
    }
  }
  const arr = Array.isArray(children) ? children : [children];
  for (const c of arr) {
    if (c == null || c === false) continue;
    if (typeof c === "string" || typeof c === "number") el.appendChild(document.createTextNode(String(c)));
    else el.appendChild(c);
  }
  return el;
}

export function eyebrow(text) { return h("div", { class: "eyebrow" }, text); }

export function stat({ label, value, delta }) {
  const children = [
    h("div", { class: "label" }, label),
    h("div", { class: "value mono" }, value)
  ];
  if (delta) {
    const cls = delta.startsWith("+") ? "delta up" : delta.startsWith("−") || delta.startsWith("-") ? "delta down" : "delta";
    children.push(h("div", { class: cls }, delta));
  }
  return h("div", { class: "stat" }, children);
}

export function badge(text, kind = "") {
  return h("span", { class: `badge ${kind}` }, text);
}

export function modal(content, { onClose } = {}) {
  const backdrop = h("div", { class: "modal-backdrop" });
  const m = h("div", { class: "modal stack" }, content);
  backdrop.appendChild(m);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) { backdrop.remove(); onClose?.(); }
  });
  document.body.appendChild(backdrop);
  return {
    el: backdrop,
    close() { backdrop.remove(); onClose?.(); }
  };
}

export function stepper({ value, step = 1, min = 0, onChange, placeholder = "" }) {
  const initial = value == null || value === "" ? "" : String(value);
  const input = h("input", { type: "number", value: initial, inputmode: "decimal", placeholder });
  const dec = h("button", { type: "button", "aria-label": "Decrease" }, "−");
  const inc = h("button", { type: "button", "aria-label": "Increase" }, "+");

  function commit(n) {
    if (Number.isNaN(n)) n = min;
    if (n < min) n = min;
    // Round trailing float noise that builds up after many +0.5 increments.
    n = Math.round(n * 100) / 100;
    input.value = String(n);
    onChange?.(n);
  }

  // Long-press repeat: tap = single increment, hold = burst after 400ms.
  function attachRepeat(btn, delta) {
    let initialDelay = null;
    let interval = null;
    function trigger() { commit(Number(input.value || 0) + delta); }
    function stop() {
      if (initialDelay) { clearTimeout(initialDelay); initialDelay = null; }
      if (interval) { clearInterval(interval); interval = null; }
    }
    btn.addEventListener("pointerdown", (e) => {
      if (btn.disabled) return;
      e.preventDefault();           // suppress focus + iOS double-tap zoom
      try { btn.setPointerCapture(e.pointerId); } catch {}
      trigger();
      initialDelay = setTimeout(() => {
        interval = setInterval(trigger, 80);
      }, 400);
    });
    btn.addEventListener("pointerup", stop);
    btn.addEventListener("pointerleave", stop);
    btn.addEventListener("pointercancel", stop);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  attachRepeat(dec, -step);
  attachRepeat(inc, step);

  // Fire onChange on every keystroke so validators reading state see the
  // current value without waiting for blur.
  input.addEventListener("input", () => {
    if (input.value === "") { onChange?.(null); return; }
    const n = Number(input.value);
    if (!Number.isNaN(n)) onChange?.(n);
  });
  input.addEventListener("change", () => {
    if (input.value === "") { onChange?.(null); return; }
    commit(Number(input.value));
  });

  return h("div", { class: "stepper" }, [dec, input, inc]);
}

export function field(label, control) {
  return h("label", { class: "field" }, [h("span", { class: "label" }, label), control]);
}

/**
 * In-page numeric keypad. Used by the reps prompt during a rest phase so the
 * field is ready to log without any tap — phase events arrive via a worker
 * postMessage outside any user-gesture task, and iOS WebKit refuses to open
 * the OS soft keyboard for focus() calls in that context. A pure DOM keypad
 * sidesteps that restriction entirely.
 *
 * Keys: 1–9 in a 3-col grid, then a final row of ⌫ / 0 / Save.
 * pointerdown handlers preventDefault to suppress the iOS focus ring +
 * double-tap zoom shimmer, and to fire on press rather than waiting for
 * pointerup → click (which adds ~300ms perceptual lag on some browsers).
 */
export function repsNumpad({ value = "", maxDigits = 3, submitLabel = "Save", onChange, onSubmit }) {
  let buf = value == null ? "" : String(value);

  const display = h("div", { class: "numpad-display" });
  function render() {
    display.textContent = buf || "—";
    display.classList.toggle("empty", !buf);
  }
  render();

  function appendDigit(d) {
    if (buf.length >= maxDigits) return;
    if (buf === "0") buf = d;
    else buf += d;
    render();
    onChange?.(Number(buf));
  }
  function backspace() {
    if (!buf) return;
    buf = buf.slice(0, -1);
    render();
    onChange?.(buf ? Number(buf) : null);
  }
  function submit() {
    onSubmit?.(buf ? Number(buf) : null);
  }

  function makeKey(label, kind, handler) {
    const b = h("button", { type: "button", class: `np-key np-${kind}` }, label);
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      handler();
    });
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    return b;
  }
  const digit = (d) => makeKey(String(d), "digit", () => appendDigit(String(d)));

  const grid = h("div", { class: "numpad-grid" }, [
    digit(1), digit(2), digit(3),
    digit(4), digit(5), digit(6),
    digit(7), digit(8), digit(9),
    makeKey("⌫", "back", backspace),
    digit(0),
    makeKey(submitLabel, "submit", submit)
  ]);

  const root = h("div", { class: "numpad" }, [display, grid]);
  return {
    el: root,
    getValue() { return buf ? Number(buf) : null; },
    setValue(v) { buf = v == null ? "" : String(v); render(); }
  };
}

export function fmtKg(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const r = Math.round(n * 10) / 10;
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)} kg`;
}

// Always returns a unit-correct string. Callers must NOT append " kg" — the
// tonnes/kg switchover is owned here so the two unit suffixes can never both
// be rendered together.
export function fmtVolume(n) {
  if (!n) return "0 kg";
  if (n >= 10000) return `${(n / 1000).toFixed(1)} t`;
  if (n >= 1000)  return `${(n / 1000).toFixed(2)} t`;
  return `${Math.round(n)} kg`;
}

export function fmtDelta(n, unit = "") {
  if (!n) return "no change";
  const sign = n > 0 ? "+" : "−";
  const abs = Math.abs(n);
  return `${sign}${unit ? `${abs}${unit}` : abs}`;
}

export function fmtDate(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function fmtDay(ms) {
  const d = new Date(ms);
  const today = new Date(); today.setHours(0,0,0,0);
  const yest = new Date(today.getTime() - 86400000);
  const that = new Date(d); that.setHours(0,0,0,0);
  if (that.getTime() === today.getTime()) return "Today";
  if (that.getTime() === yest.getTime()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

/* ---------- shared callout components ---------- */

/**
 * Brass "Session in progress" banner used on Home and Exercises. Showing the
 * same banner from one place keeps the wording, controls, and copy in sync.
 *
 * Variants:
 *   "home"      — Continue + End-session buttons side by side
 *   "exercises" — single full-width End-session button (with confirm)
 */
export function openSessionBanner({ openSession, sessionSets, variant = "home", endSession }) {
  const exCount = new Set(sessionSets.map((s) => s.exerciseId)).size;
  const startedLabel = `Started ${fmtTime(openSession.startedAt)} · ${exCount} exercise${exCount === 1 ? "" : "s"}${variant === "exercises" ? " done" : ""}`;

  const meta = h("div", {}, [
    h("div", { class: "eyebrow" }, "Session in progress"),
    h("div", { class: "mono", style: "font-weight:600" }, startedLabel)
  ]);

  if (variant === "home") {
    return h("div", { class: "card card-brass stack-sm" }, [
      meta,
      h("div", { class: "row" }, [
        h("a", { href: "#/exercises", class: "btn btn-fill btn-block" }, "Continue"),
        h("button", { class: "btn btn-outline btn-block", onclick: async () => {
          await endSession(openSession.id);
          location.hash = `#/summary/${openSession.id}`;
        } }, "End session")
      ])
    ]);
  }
  // exercises variant
  return h("div", { class: "card card-brass stack-sm", style: "margin-bottom: 16px" }, [
    meta,
    h("button", { class: "btn btn-fill btn-block", onclick: async () => {
      if (!confirm("End this session now?")) return;
      await endSession(openSession.id);
      location.hash = `#/summary/${openSession.id}`;
    } }, "End session")
  ]);
}

/* ---------- environment ---------- */

/** True when the page is running as an installed PWA (iOS standalone or
 *  Android display-mode standalone). False when it's just a Safari tab. */
export function isStandalonePWA() {
  if (typeof window === "undefined") return false;
  if (window.navigator && window.navigator.standalone === true) return true;
  if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
  return false;
}

/* ---------- inline SVG icons ---------- */
// Returned as DOM nodes parsed from a string so the SVG element graph is real
// (not just innerHTML on the parent button), keeping the layout & color flow
// through currentColor consistent.
function svgFromString(s) {
  const wrap = document.createElement("div");
  wrap.innerHTML = s.trim();
  return wrap.firstElementChild;
}

const ICON_PENCIL = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
const ICON_TRASH = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>`;

export function iconPencil() { return svgFromString(ICON_PENCIL); }
export function iconTrash()  { return svgFromString(ICON_TRASH); }

/* ---------- set-type label helpers (single source of truth) ---------- */

export function setTypeName(setType) {
  switch (setType) {
    case "standard":         return "Standard";
    case "bilateral":        return "Bilateral";
    case "continuous":       return "10/10";
    case "six_ten":          return "6/10";
    case "ninety_bilateral": return "90 Bilateral";
    case "no_timer":         return "No Timer";
    case "cardio_swim":      return "Swimming";
    case "cardio_bike":      return "Stationary Bike";
    default: return setType || "Set";
  }
}

export function setTypeStructure(ex) {
  switch (ex?.setType) {
    case "standard":         return `Standard · ${ex.rounds || 3} sets`;
    case "bilateral":        return `Bilateral · 3 rounds`;
    case "continuous":       return `10/10 · 10 min block`;
    case "six_ten":          return `6/10 · 6 sets`;
    case "ninety_bilateral": return `90 Bilateral · 2 × 90s`;
    case "no_timer":         return `No Timer · per-set entry`;
    case "cardio_swim":      return "Cardio · Swimming";
    case "cardio_bike":      return "Cardio · Stationary Bike";
    default: return setTypeName(ex?.setType);
  }
}

/** Format meters as either "1.2 km" (>=1000) or "850 m". */
export function fmtMeters(m) {
  if (m == null || Number.isNaN(Number(m))) return "—";
  m = Number(m);
  if (m >= 1000) return `${(m / 1000).toFixed(2).replace(/\.?0+$/, "")} km`;
  return `${Math.round(m)} m`;
}

/** Format seconds as "Xh Ym" — used for weekly cardio totals where seconds
 *  precision would be noise. Sub-minute durations show as "0h 0m". */
export function fmtHoursMinutes(sec) {
  if (!sec || sec < 0) return "0h 0m";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

/** Format seconds as M:SS or H:MM:SS. */
export function fmtMmSs(sec) {
  if (sec == null || Number.isNaN(Number(sec))) return "—";
  sec = Math.max(0, Math.round(Number(sec)));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Compose a one-line metrics summary for a cardio set row. */
export function cardioMetricsLine(set) {
  if (!set || !set.metrics) return "—";
  const m = set.metrics;
  if (set.setType === "cardio_swim") {
    return `${fmtMeters(m.distanceM)} · ${fmtMmSs(m.durationSec)}`;
  }
  if (set.setType === "cardio_bike") {
    const parts = [];
    if (m.durationSec) parts.push(`${Math.round(m.durationSec / 60)} min`);
    if (m.metMin)      parts.push(`${m.metMin} MET·min`);
    if (m.avgPowerW)   parts.push(`${m.avgPowerW} W`);
    if (m.avgHrBpm)    parts.push(`${m.avgHrBpm} bpm`);
    return parts.length ? parts.join(" · ") : "—";
  }
  return "—";
}

/** Format a Date as a clock time, e.g. "14:30". */
export function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Format a duration in milliseconds as "1h 5m" / "5m 12s" / "12s". */
export function fmtDuration(ms) {
  if (!ms || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Read a number from a stepper element, or null if the input is blank. */
export function readStepperNumber(stepperEl) {
  const input = stepperEl?.querySelector("input");
  if (!input || input.value === "") return null;
  const n = Number(input.value);
  return Number.isFinite(n) ? n : null;
}

export function fmtAge(dobMs) {
  const d = new Date(dobMs);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
  return age;
}
