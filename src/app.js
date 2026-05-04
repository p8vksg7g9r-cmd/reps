// REPS bootstrap: registers SW, seeds DB, mounts router.
import { registerRoute, mount, start } from "./router.js";
import { seedIfEmpty } from "./db/repo.js";
import { STARTER_EXERCISES } from "./data/starter-exercises.js";

import { HomeView } from "./views/home.js";
import { ExercisesView } from "./views/exercises.js";
import { SessionView } from "./views/session.js";
import { ExerciseDetailView } from "./views/exercise-detail.js";
import { HistoryView } from "./views/history.js";
import { ProfileView } from "./views/profile.js";
import { ManageExercisesView } from "./views/manage-exercises.js";
import { SessionSummaryView } from "./views/session-summary.js";

// Bumped on every shipped change so the user can verify on the Profile screen
// which build is actually running on their device.
export const APP_VERSION = "v0.8";

async function boot() {
  await seedIfEmpty(STARTER_EXERCISES);

  registerRoute("/home", HomeView);
  registerRoute("/exercises", ExercisesView);
  registerRoute("/exercise/:id", ExerciseDetailView);
  registerRoute("/session/new/:exerciseId", SessionView);
  registerRoute("/history", HistoryView);
  registerRoute("/profile", ProfileView);
  registerRoute("/manage-exercises", ManageExercisesView);
  registerRoute("/summary/:sessionId", SessionSummaryView);

  mount(document.getElementById("view"));
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
