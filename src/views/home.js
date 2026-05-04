import { allSessions, listExercises, latestWeight, getOpenSession, endSession } from "../db/repo.js";
import { weeklySummary } from "../domain/week.js";
import { setVolume } from "../domain/volume.js";
import { h, eyebrow, stat, fmtVolume, fmtDelta } from "../ui/components.js";
import { tx, reqAsPromise } from "../db/schema.js";

async function allSets() {
  const t = await tx(["sets"]);
  return reqAsPromise(t.objectStore("sets").getAll());
}

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export async function HomeView(_params, root) {
  const [sessions, sets, exercises, lastWeight, openSession] = await Promise.all([
    allSessions(), allSets(), listExercises(), latestWeight(), getOpenSession()
  ]);

  const summary = weeklySummary({ sessions, sets });
  const { current, delta } = summary;

  const head = h("div", { class: "page-head" }, [
    eyebrow("Week so far"),
    h("h1", { class: "display-l" }, "REPS")
  ]);

  // Open-session banner — takes precedence over the weight reminder.
  let topBanner = null;
  if (openSession) {
    const sessionSets = sets.filter((s) => s.sessionId === openSession.id && s.reps != null);
    const exCount = new Set(sessionSets.map((s) => s.exerciseId)).size;
    topBanner = h("div", { class: "card stack-sm", style: "background: var(--brass); color: var(--navy-deep)" }, [
      h("div", { class: "row-between" }, [
        h("div", {}, [
          h("div", { class: "eyebrow", style: "color: var(--navy-deep); opacity:0.75" }, "Session in progress"),
          h("div", { class: "mono", style: "font-weight:600" },
            `Started ${fmtTime(openSession.startedAt)} · ${exCount} exercise${exCount === 1 ? "" : "s"}`)
        ])
      ]),
      h("div", { class: "row" }, [
        h("a", { href: "#/exercises", class: "btn btn-block", style: "background: var(--navy-deep); color: var(--paper); flex: 1" }, "Continue"),
        h("button", { class: "btn btn-ghost btn-block", style: "flex: 1; border-color: var(--navy-deep); color: var(--navy-deep)", onclick: async () => {
          await endSession(openSession.id);
          location.hash = `#/summary/${openSession.id}`;
        } }, "End session")
      ])
    ]);
  } else if (!lastWeight) {
    topBanner = h("div", { class: "banner" }, [
      h("span", {}, "Log your first weight"),
      h("button", { onclick: () => location.hash = "#/profile" }, "Add")
    ]);
  } else if (Date.now() - lastWeight.loggedAt > MONTH_MS) {
    topBanner = h("div", { class: "banner" }, [
      h("span", {}, "Time to log a fresh weight"),
      h("button", { onclick: () => location.hash = "#/profile" }, "Log")
    ]);
  }

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

  const ctaLabel = openSession ? "Add an exercise to this session" : "Start a session";
  const cta = h("a", { href: "#/exercises", class: "btn btn-primary btn-block btn-lg" }, ctaLabel);

  // Recent: last 3 closed sessions, with their exercise list derived from sets.
  const closed = sessions.filter((s) => s.endedAt != null).sort((a, b) => b.startedAt - a.startedAt).slice(0, 3);
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const recentSection = closed.length ? h("section", { class: "stack" }, [
    eyebrow("Recent sessions"),
    ...closed.map((s) => {
      const ssets = sets.filter((x) => x.sessionId === s.id && x.reps != null);
      const vol = ssets.reduce((sum, x) => sum + setVolume(x), 0);
      const names = [...new Set(ssets.map((x) => exById.get(x.exerciseId)?.name).filter(Boolean))];
      const subtitle = names.length === 0 ? "no sets logged" :
                       names.length <= 2 ? names.join(" · ") :
                       `${names.slice(0, 2).join(" · ")} +${names.length - 2}`;
      return h("a", {
        class: "ex-row",
        href: `#/summary/${s.id}`
      }, [
        h("div", { class: "meta" }, [
          h("div", { class: "name" }, new Date(s.startedAt).toLocaleDateString()),
          h("div", { class: "sub" }, `${subtitle} · ${fmtVolume(vol)} kg`)
        ])
      ]);
    })
  ]) : null;

  root.appendChild(head);
  if (topBanner) root.appendChild(topBanner);
  root.appendChild(h("div", { class: "stack" }, [grid, volStat, cta]));
  if (recentSection) {
    root.appendChild(h("div", { style: "height: 24px" }));
    root.appendChild(recentSection);
  }
}
