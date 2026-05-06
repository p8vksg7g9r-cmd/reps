import { allSessions, allSets, listExercises, latestWeight, getOpenSession, endSession } from "../db/repo.js";
import { weeklySummary, startOfIsoWeek } from "../domain/week.js";
import { setVolume } from "../domain/volume.js";
import {
  h, eyebrow, stat, fmtVolume, fmtDelta, fmtMeters, fmtMmSs, fmtHoursMinutes,
  isStandalonePWA, openSessionBanner
} from "../ui/components.js";

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const WEEK_MS  = 7 * 24 * 60 * 60 * 1000;

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

  // Open-session banner takes precedence over the weight reminder.
  let topBanner = null;
  if (openSession) {
    const sessionSets = sets.filter((s) => s.sessionId === openSession.id && s.reps != null);
    topBanner = openSessionBanner({ openSession, sessionSets, variant: "home", endSession });
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

  /* ---------------- Lifts card ---------------- */

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

  // Training load = weekly volume / latest bodyweight, in kg/kg = bodyweight
  // multiples. Trend uses the same bodyweight on both sides for consistency.
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
    bw == null         ? "Log a bodyweight to track this" :
    ratioDelta == null ? "no prior week" :
    ratioDelta === 0   ? `flat ${arrow} vs last week` :
                         `${ratioDelta > 0 ? "+" : "−"}${Math.abs(Math.round(ratioDelta))}× ${arrow} vs last week`;

  const loadStat = h("div", { class: "stat" }, [
    h("div", { class: "label" }, "Training load · weekly"),
    h("div", { class: "value mono" }, ratio == null ? "—" : `${Math.round(ratio)}× BW`),
    h("div", { class: deltaClass }, deltaText)
  ]);

  const liftsSection = h("section", { class: "stack" }, [
    h("div", { class: "section-eyebrow" }, "Lifts · this week"),
    grid, volStat, loadStat
  ]);

  /* ---------------- Cardio card (conditional) ---------------- */

  // Sets in the current ISO week, with reps != null (real entries only).
  const weekStart = summary.weekStart;
  const weekEnd   = weekStart + WEEK_MS;
  const weekSessionIds = new Set(
    sessions.filter((s) => s.startedAt >= weekStart && s.startedAt < weekEnd).map((s) => s.id)
  );
  const weekSets = sets.filter((s) => weekSessionIds.has(s.sessionId) && s.reps != null);
  const swimSets = weekSets.filter((s) => s.setType === "cardio_swim");
  const bikeSets = weekSets.filter((s) => s.setType === "cardio_bike");

  const cardioCard = (swimSets.length || bikeSets.length)
    ? buildCardioCard(swimSets, bikeSets)
    : null;

  /* ---------------- CTA + recent ---------------- */

  const ctaLabel = openSession ? "Add an exercise to this session" : "Start a session";
  const cta = h("a", { href: "#/exercises", class: "btn btn-primary btn-block btn-lg" }, ctaLabel);

  // Recent: last 3 closed sessions.
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
      return h("a", { class: "ex-row", href: `#/summary/${s.id}` }, [
        h("div", { class: "meta" }, [
          h("div", { class: "name" }, new Date(s.startedAt).toLocaleDateString()),
          h("div", { class: "sub" }, vol > 0 ? `${subtitle} · ${fmtVolume(vol)}` : subtitle)
        ])
      ]);
    })
  ]) : null;

  /* ---------------- Layout ---------------- */

  root.appendChild(head);

  if (!isStandalonePWA()) {
    root.appendChild(h("div", { class: "card card-amber" }, [
      h("div", { class: "eyebrow" }, "Add to Home Screen"),
      h("p", { class: "body", style: "margin: 6px 0 0; font-weight: 600" },
        "For best experience and to preserve your data, add this app to your home screen."),
      h("p", { class: "body-s", style: "margin: 4px 0 0" },
        "Data stored in Safari browser is separate from the home-screen app.")
    ]));
  }

  if (topBanner) root.appendChild(topBanner);

  const summaryStack = [liftsSection];
  if (cardioCard) summaryStack.push(cardioCard);
  summaryStack.push(cta);
  root.appendChild(h("div", { class: "stack-lg" }, summaryStack));

  if (recentSection) {
    root.appendChild(h("div", { style: "height: 24px" }));
    root.appendChild(recentSection);
  }
}

/* ----------------------------------------------------------------- */

function metricRow(label, value) {
  return h("div", { class: "row-between mono", style: "font-size: 14px; padding: 4px 0" }, [
    h("span", { style: "color: var(--ink-mute)" }, label),
    h("span", { style: "font-weight: 600" }, value)
  ]);
}

function buildCardioCard(swimSets, bikeSets) {
  const sections = [];

  if (swimSets.length) {
    const distanceM   = swimSets.reduce((sum, s) => sum + (Number(s.metrics?.distanceM)   || 0), 0);
    const durationSec = swimSets.reduce((sum, s) => sum + (Number(s.metrics?.durationSec) || 0), 0);
    // Pace per 1500 m = total swim time scaled to 1500 m. Only meaningful if
    // there's any distance to divide by.
    const pacePer1500Sec = distanceM > 0 ? (durationSec / distanceM) * 1500 : null;

    sections.push(h("div", { class: "stack-sm" }, [
      h("div", { class: "eyebrow" }, "Swimming"),
      metricRow("Distance", fmtMeters(distanceM)),
      pacePer1500Sec != null ? metricRow("Pace per 1500 m", fmtMmSs(pacePer1500Sec)) : null
    ].filter(Boolean)));
  }

  if (bikeSets.length) {
    if (sections.length) sections.push(h("div", { class: "divider" }));
    const durationSec = bikeSets.reduce((sum, s) => sum + (Number(s.metrics?.durationSec) || 0), 0);
    const metMin      = bikeSets.reduce((sum, s) => sum + (Number(s.metrics?.metMin)      || 0), 0);

    const rows = [
      h("div", { class: "eyebrow" }, "Bike"),
      metricRow("Total time", fmtHoursMinutes(durationSec))
    ];
    if (metMin > 0) rows.push(metricRow("MET·minutes", String(metMin)));
    sections.push(h("div", { class: "stack-sm" }, rows));
  }

  return h("div", { class: "card stack" }, [
    h("div", { class: "section-eyebrow" }, "Cardio · this week"),
    ...sections
  ]);
}
