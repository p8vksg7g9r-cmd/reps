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
    input.value = String(n);
    onChange?.(n);
  }
  dec.addEventListener("click", () => commit(Number(input.value || 0) - step));
  inc.addEventListener("click", () => commit(Number(input.value || 0) + step));
  input.addEventListener("change", () => {
    if (input.value === "") { onChange?.(null); return; }
    commit(Number(input.value));
  });
  input.addEventListener("input", () => {
    if (input.value === "") onChange?.(null);
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

export function fmtVolume(n) {
  if (!n) return "0";
  if (n >= 10000) return `${(n / 1000).toFixed(1)}t`; // tonnes
  if (n >= 1000) return `${(n / 1000).toFixed(2)}t`;
  return String(Math.round(n));
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

export function fmtAge(dobMs) {
  const d = new Date(dobMs);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
  return age;
}
