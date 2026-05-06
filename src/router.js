// Hash-based router with a *persistent session container*.
//
// Most routes render into the regular `#view` mount: each navigation runs the
// previous view's cleanup and rebuilds DOM from scratch.
//
// The session route (`/session/new/:exerciseId`) is special — it renders into
// its own `#session-view` container that survives navigation. When the user
// taps a tab while an exercise is active, we just hide the session container
// and reveal `#view`; the timer engine, audio, and DOM state stay alive in
// the background. A persistent "Resume" bar is shown so the user can jump
// back. The session is torn down explicitly via a `session:teardown`
// CustomEvent dispatched by End Session / Start New Exercise / when the
// user navigates to a different exercise.

const routes = [];
let mountEl = null;
let sessionEl = null;
let activeBar = null;

let currentCleanup = null;          // cleanup for the regular #view route
let sessionMounted = null;          // { exerciseId, exerciseName, cleanup }

export function registerRoute(pattern, handler) {
  routes.push({ pattern, handler });
}

/** mount(viewEl, sessionContainerEl, activeBarEl) */
export function mount(view, sessionContainer, bar) {
  mountEl = view;
  sessionEl = sessionContainer;
  activeBar = bar;
}

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

function isSessionPath(path) {
  return path.startsWith("/session/new/");
}

async function renderRegularRoute(r) {
  if (currentCleanup) try { currentCleanup(); } catch {}
  currentCleanup = null;
  if (mountEl) {
    mountEl.innerHTML = "";
    mountEl.classList.remove("hidden");
  }
  if (sessionEl) sessionEl.classList.add("hidden");
  const result = await r.handler(r.params, mountEl);
  if (typeof result === "function") currentCleanup = result;
  if (mountEl) mountEl.scrollTop = 0;
  updateActiveBar();
}

async function renderSessionRoute(r) {
  const exerciseId = Number(r.params.exerciseId);
  if (sessionMounted && sessionMounted.exerciseId === exerciseId) {
    showSessionContainer();
    return;
  }
  // Mounting fresh — switch out any prior session.
  if (sessionMounted) tearDownSession();
  if (mountEl) mountEl.classList.add("hidden");
  if (sessionEl) {
    sessionEl.innerHTML = "";
    sessionEl.classList.remove("hidden");
  }
  hideActiveBar();
  const result = await r.handler(r.params, sessionEl);
  sessionMounted = {
    exerciseId,
    exerciseName: null,             // session view will fill this in via event
    cleanup: typeof result === "function" ? result : null
  };
  if (sessionEl) sessionEl.scrollTop = 0;
}

function showSessionContainer() {
  if (mountEl) mountEl.classList.add("hidden");
  if (sessionEl) sessionEl.classList.remove("hidden");
  hideActiveBar();
}

function tearDownSession() {
  if (sessionMounted?.cleanup) {
    try { sessionMounted.cleanup(); } catch {}
  }
  if (sessionEl) sessionEl.innerHTML = "";
  sessionMounted = null;
  hideActiveBar();
}

function showActiveBar() {
  if (!activeBar || !sessionMounted) return;
  activeBar.classList.remove("hidden");
  document.body.classList.add("has-active-bar");
  activeBar.href = `#/session/new/${sessionMounted.exerciseId}`;
  activeBar.textContent = sessionMounted.exerciseName
    ? `▸ Resume ${sessionMounted.exerciseName}`
    : "▸ Resume exercise";
}

function hideActiveBar() {
  if (!activeBar) return;
  activeBar.classList.add("hidden");
  document.body.classList.remove("has-active-bar");
}

function updateActiveBar() {
  if (sessionMounted) showActiveBar();
  else hideActiveBar();
}

export async function render() {
  if (!mountEl) return;
  const r = parse(location.hash);
  if (!r) { location.hash = "#/home"; return; }

  if (isSessionPath(r.path)) {
    await renderSessionRoute(r);
  } else {
    await renderRegularRoute(r);
  }
  updateTabbar(r.path);
}

function updateTabbar(path) {
  document.querySelectorAll(".tabbar a").forEach((a) => {
    const tab = a.dataset.tab;
    const active =
      (tab === "home" && path === "/home") ||
      (tab === "exercises" && (
        path.startsWith("/exercises") ||
        path.startsWith("/exercise/") ||
        path.startsWith("/session/") ||
        path.startsWith("/quicklog/")
      )) ||
      (tab === "history" && path.startsWith("/history")) ||
      (tab === "profile" && path.startsWith("/profile"));
    a.classList.toggle("active", !!active);
  });
}

window.addEventListener("session:teardown", tearDownSession);
window.addEventListener("session:setname", (e) => {
  if (sessionMounted && e.detail?.exerciseId === sessionMounted.exerciseId) {
    sessionMounted.exerciseName = e.detail.name;
    if (!sessionEl?.classList.contains("hidden")) return; // currently showing — bar stays hidden
    updateActiveBar();
  }
});

export function start() {
  window.addEventListener("hashchange", render);
  if (!location.hash) location.hash = "#/home";
  render();
}
