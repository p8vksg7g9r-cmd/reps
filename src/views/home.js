import { allSessions, listExercises, latestWeight } from "../db/repo.js";
import { weeklySummary } from "../domain/week.js";
import { setVolume } from "../domain/volume.js";
import { h, eyebrow, stat, fmtVolume, fmtDelta } from "../ui/components.js";
import { tx, reqAsPromise } from "../db/schema.js";

async function allSets() {
  const t = await tx(["sets"]);
  return reqAsPromise(t.objectStore("sets").getAll());
}

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export async function HomeView(_params, root) {
  const [sessions, sets, exercises, lastWeight] = await Promise.all([
    allSessions(), allSets(), listExercises(), latestWeight()
  ]);

  const summary = weeklySummary({ sessions, sets });
  const { current, delta } = summary;

  const head = h("div", { class: "page-head" }, [
    eyebrow("Week so far"),
    h("h1", { class: "display-l" }, "REPS")
  ]);

  // Weight reminder banner
  const banner = (() => {
    if (!lastWeight) {
      return h("div", { class: "banner" }, [
        h("span", {}, "Log your first weight"),
        h("button", { onclick: () => location.hash = "#/profile" }, "Add")
      ]);
    }
    if (Date.now() - lastWeight.loggedAt > MONTH_MS) {
      return h("div", { class: "banner" }, [
        h("span", {}, "Time to log a fresh weight"),
        h("button", { onclick: () => location.hash = "#/profile" }, "Log")
      ]);
    }
    return null;
  })();

  const grid = h("div", { class: "grid-2" }, [
    stat({
      label: "Sessions",
      value: String(current.sessions),
      delta: delta.sessions === 0 ? "no change" : fmtDelta(delta.sessions)
    }),
    stat({
      label: "Exercises",
      value: String(current.exercises),
      delta: delta.exercises === 0 ? "no change" : fmtDelta(delta.exercises)
    })
  ]);

  const volStat = stat({
    label: "Total volume",
    value: fmtVolume(current.volume) + " kg",
    delta: delta.volume === 0 ? "no change" : fmtDelta(Math.round(delta.volume), " kg")
  });

  const cta = h("a", { href: "#/exercises", class: "btn btn-primary btn-block btn-lg" }, "Start a lift");

  // Recent activity (last 3 sessions)
  const recent = sessions.sort((a, b) => b.startedAt - a.startedAt).slice(0, 3);
  const recentSection = recent.length ? h("section", { class: "stack" }, [
    eyebrow("Recent"),
    ...recent.map((s) => {
      const ex = exercises.find((e) => e.id === s.exerciseId);
      const ssets = sets.filter((x) => x.sessionId === s.id);
      const vol = ssets.reduce((sum, x) => sum + setVolume(x), 0);
      return h("a", {
        class: "ex-row",
        href: `#/exercise/${ex?.id ?? ""}`,
      }, [
        h("div", { class: "meta" }, [
          h("div", { class: "name" }, ex?.name ?? "Exercise"),
          h("div", { class: "sub" }, `${new Date(s.startedAt).toLocaleDateString()} · ${fmtVolume(vol)} kg`)
        ])
      ]);
    })
  ]) : null;

  root.appendChild(head);
  if (banner) root.appendChild(banner);
  root.appendChild(h("div", { class: "stack" }, [grid, volStat, cta]));
  if (recentSection) {
    root.appendChild(h("div", { style: "height: 24px" }));
    root.appendChild(recentSection);
  }
}
