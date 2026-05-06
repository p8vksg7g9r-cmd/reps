import { allSessions, listExercises, latestWeight, getOpenSession, endSession } from "../db/repo.js";
import { weeklySummary } from "../domain/week.js";
import { setVolume } from "../domain/volume.js";
import { h, eyebrow, stat, fmtVolume, fmtDelta, isStandalonePWA } from "../ui/components.js";
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
    value: fmtVolume(current.volume),
    delta: delta.volume === 0 ? "no change" : fmtDelta(Math.round(delta.volume), " kg")
  });

  // Training load = total weekly volume in kg ÷ user bodyweight in kg.
  // Higher numbers represent more relative work. Trend compares to the
  // previous week using the same bodyweight reference.
  const bw = lastWeight?.kg && lastWeight.kg > 0 ? lastWeight.kg : null;
  const ratio     = bw ? current.volume  / bw : null;
  const ratioPrev = bw ? summary.previous.volume / bw : null;
  const ratioDelta = (ratio != null && ratioPrev != null) ? ratio - ratioPrev : null;

  const arrow =
    ratioDelta == null ? "" :
    ratioDelta >  0.5  ? "↑" :
    ratioDelta < -0.5  ? "↓" :
                          "→";
  const deltaClass =
    ratioDelta == null ? "delta" :
    ratioDelta >  0.5  ? "delta up" :
    ratioDelta < -0.5  ? "delta down" :
                          "delta";
  const deltaText =
    bw == null              ? "Log a bodyweight to track this" :
    ratioDelta == null      ? "no prior week" :
    ratioDelta === 0        ? `flat ${arrow} vs last week` :
                              `${ratioDelta > 0 ? "+" : "−"}${Math.abs(Math.round(ratioDelta))}× ${arrow} vs last week`;

  const loadStat = h("div", { class: "stat" }, [
    h("div", { class: "label" }, "Training load · weekly"),
    h("div", { class: "value mono" }, ratio == null ? "—" : `${Math.round(ratio)}× BW`),
    h("div", { class: deltaClass }, deltaText)
  ]);

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
          h("div", { class: "sub" }, `${subtitle} · ${fmtVolume(vol)}`)
        ])
      ]);
    })
  ]) : null;

  root.appendChild(head);

  // Safari warning — shown only when the page is NOT running as an installed
  // PWA. Data stored in plain Safari is in a different storage scope from the
  // installed home-screen app, so the user could end up with two separate
  // datasets without realising it.
  if (!isStandalonePWA()) {
    root.appendChild(h("div", { class: "card", style: "background: var(--amber); color: var(--navy-deep)" }, [
      h("div", { class: "eyebrow", style: "color: var(--navy-deep); opacity: 0.75" }, "Add to Home Screen"),
      h("p", { class: "body", style: "margin: 6px 0 0; font-weight: 600" },
        "For best experience and to preserve your data, add this app to your home screen."),
      h("p", { class: "body-s", style: "margin: 4px 0 0" },
        "Data stored in Safari browser is separate from the home-screen app.")
    ]));
  }

  if (topBanner) root.appendChild(topBanner);
  root.appendChild(h("div", { class: "stack" }, [grid, volStat, loadStat, cta]));
  if (recentSection) {
    root.appendChild(h("div", { style: "height: 24px" }));
    root.appendChild(recentSection);
  }
}
