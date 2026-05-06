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
    default: return setTypeName(ex?.setType);
  }
}

export function fmtAge(dobMs) {
  const d = new Date(dobMs);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
  return age;
}
