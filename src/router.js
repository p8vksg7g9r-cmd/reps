// Hash-based router. Routes are registered as { pattern, handler }.
// Patterns may include :param segments, e.g. "/exercise/:id".

const routes = [];
let mountEl = null;
let currentCleanup = null;

export function registerRoute(pattern, handler) {
  routes.push({ pattern, handler });
}

export function mount(el) { mountEl = el; }

function parse(hash) {
  const path = (hash || "").replace(/^#/, "") || "/";
  for (const r of routes) {
    const params = match(r.pattern, path);
    if (params) return { handler: r.handler, params, path };
  }
  return null;
}

function match(pattern, path) {
  const ps = pattern.split("/").filter(Boolean);
  const xs = path.split("/").filter(Boolean);
  if (ps.length !== xs.length) return null;
  const params = {};
  for (let i = 0; i < ps.length; i++) {
    if (ps[i].startsWith(":")) params[ps[i].slice(1)] = decodeURIComponent(xs[i]);
    else if (ps[i] !== xs[i]) return null;
  }
  return params;
}

export async function go(hash) {
  if (location.hash !== hash) {
    location.hash = hash;
    return;
  }
  await render();
}

export async function render() {
  if (!mountEl) return;
  const r = parse(location.hash);
  if (!r) {
    location.hash = "#/home";
    return;
  }
  if (currentCleanup) try { currentCleanup(); } catch {}
  currentCleanup = null;
  mountEl.innerHTML = "";
  const result = await r.handler(r.params, mountEl);
  if (typeof result === "function") currentCleanup = result;
  updateTabbar(r.path);
  mountEl.scrollTop = 0;
}

function updateTabbar(path) {
  document.querySelectorAll(".tabbar a").forEach((a) => {
    const tab = a.dataset.tab;
    const active =
      (tab === "home" && path === "/home") ||
      (tab === "exercises" && path.startsWith("/exercises")) ||
      (tab === "history" && path.startsWith("/history")) ||
      (tab === "profile" && path.startsWith("/profile")) ||
      (tab === "exercises" && path.startsWith("/exercise/")) ||
      (tab === "exercises" && path.startsWith("/session/"));
    a.classList.toggle("active", !!active);
  });
}

export function start() {
  window.addEventListener("hashchange", render);
  if (!location.hash) location.hash = "#/home";
  render();
}
