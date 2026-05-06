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

export const APP_VERSION = "v0.17";

async function boot() {
  // Best-effort portrait lock. Unsupported on iOS Safari (no API at all);
  // requires fullscreen on most Android browsers. Swallow rejections.
  try {
    if (screen.orientation && typeof screen.orientation.lock === "function") {
      screen.orientation.lock("portrait").catch(() => {});
    }
  } catch {}

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
    try { await navigator.serviceWorker.register("./service-worker.js"); }
    catch (err) { console.warn("SW registration failed", err); }
  }
}

boot().catch((err) => {
  console.error(err);
  document.getElementById("view").innerHTML =
    `<p style="padding:24px; color:#a85a36">Failed to start: ${err.message}</p>`;
});
