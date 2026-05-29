// REPS bootstrap: registers SW, seeds DB, mounts router.
import { registerRoute, mount, start } from "./router.js";
import { seedIfEmpty, seedCardioIfNeeded } from "./db/repo.js";
import { STARTER_EXERCISES } from "./data/starter-exercises.js";

import { HomeView } from "./views/home.js";
import { ExercisesView } from "./views/exercises.js";
import { SessionView } from "./views/session.js";
import { ExerciseDetailView } from "./views/exercise-detail.js";
import { HistoryView } from "./views/history.js";
import { ProfileView } from "./views/profile.js";
import { ManageExercisesView } from "./views/manage-exercises.js";
import { SessionSummaryView } from "./views/session-summary.js";
import { EditExerciseView } from "./views/edit-exercise.js";
import { QuickLogView } from "./views/quicklog.js";

export const APP_VERSION = "v0.32";

// Best-effort portrait lock. Unsupported on iOS Safari (no API at all);
// requires fullscreen on most Android browsers. Swallow rejections.
// Re-attempted on orientation/visibility change so a rotation that slips
// through (e.g. when the user briefly leaves fullscreen) gets snapped back.
function tryLockPortrait() {
  try {
    if (screen.orientation && typeof screen.orientation.lock === "function") {
      screen.orientation.lock("portrait").catch(() => {});
    }
  } catch {}
}

async function boot() {
  tryLockPortrait();
  if (screen.orientation && typeof screen.orientation.addEventListener === "function") {
    screen.orientation.addEventListener("change", () => {
      if (screen.orientation.type && !screen.orientation.type.startsWith("portrait")) {
        tryLockPortrait();
      }
    });
  }
  window.addEventListener("orientationchange", tryLockPortrait);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tryLockPortrait();
  });

  await seedIfEmpty(STARTER_EXERCISES);
  await seedCardioIfNeeded();

  registerRoute("/home", HomeView);
  registerRoute("/exercises", ExercisesView);
  registerRoute("/exercise/:id", ExerciseDetailView);
  registerRoute("/session/new/:exerciseId", SessionView);
  registerRoute("/quicklog/:exerciseId", QuickLogView);
  registerRoute("/history", HistoryView);
  registerRoute("/profile", ProfileView);
  registerRoute("/manage-exercises", ManageExercisesView);
  registerRoute("/summary/:sessionId", SessionSummaryView);
  registerRoute("/edit-exercise/:sessionId/:exerciseId", EditExerciseView);

  mount(
    document.getElementById("view"),
    document.getElementById("session-view"),
    document.getElementById("active-bar")
  );
  start();

  if ("serviceWorker" in navigator) {
    // iOS PWAs aggressively suspend and restore from snapshot, so a swipe-
    // close + reopen often does NOT re-run boot and never picks up a new
    // SW. Three nudges combined have made updates reliable enough not to
    // need a delete-and-reinstall:
    //
    //   1. controllerchange listener BEFORE register. When a new SW
    //      activates and claims the page, reload so the in-memory JS
    //      (which the browser doesn't otherwise refresh) matches what
    //      the SW now serves. Guarded so we don't reload on the very
    //      first activation (initial install).
    //
    //   2. updateViaCache: "none" — forces the browser to bypass its
    //      HTTP cache when fetching service-worker.js for update checks.
    //      Github Pages defaults to a 10-min Cache-Control on the SW
    //      file, which can mask a fresh deploy.
    //
    //   3. registration.update() on visibilitychange. The page becoming
    //      visible is the only reliable signal we get on iOS that the
    //      user is "back" — re-check for a new SW then.
    let initialActivation = !navigator.serviceWorker.controller;
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (initialActivation) { initialActivation = false; return; }
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    try {
      const reg = await navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" });
      reg.update().catch(() => {});
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          reg.update().catch(() => {});
        }
      });
    } catch (err) {
      console.warn("SW registration failed", err);
    }
  }
}

boot().catch((err) => {
  console.error(err);
  document.getElementById("view").innerHTML =
    `<p style="padding:24px; color:#a85a36">Failed to start: ${err.message}</p>`;
});
