// Typed CRUD over IndexedDB. Pure-data in/out — no DOM.
import { tx, reqAsPromise, txDone, openDb } from "./schema.js";

/* -------------------- profile -------------------- */

export async function getProfile() {
  const t = await tx(["profile"]);
  const row = await reqAsPromise(t.objectStore("profile").get("me"));
  return row || null;
}

export async function saveProfile(profile) {
  const t = await tx(["profile"], "readwrite");
  t.objectStore("profile").put({ id: "me", ...profile });
  await txDone(t);
}

/* -------------------- weight log -------------------- */

export async function logWeight(kg, loggedAt = Date.now()) {
  const t = await tx(["weightLog"], "readwrite");
  const id = await reqAsPromise(t.objectStore("weightLog").add({ kg, loggedAt }));
  await txDone(t);
  return id;
}

export async function listWeights() {
  const t = await tx(["weightLog"]);
  const out = [];
  await new Promise((resolve, reject) => {
    const cur = t.objectStore("weightLog").index("by_loggedAt").openCursor(null, "prev");
    cur.onsuccess = (e) => {
      const c = e.target.result;
      if (!c) return resolve();
      out.push(c.value);
      c.continue();
    };
    cur.onerror = () => reject(cur.error);
  });
  return out;
}

export async function latestWeight() {
  const list = await listWeights();
  return list[0] || null;
}

/* -------------------- exercises -------------------- */

export async function listExercises() {
  const t = await tx(["exercises"]);
  return reqAsPromise(t.objectStore("exercises").getAll());
}

export async function getExercise(id) {
  const t = await tx(["exercises"]);
  return reqAsPromise(t.objectStore("exercises").get(id));
}

export async function getExerciseByName(name) {
  const t = await tx(["exercises"]);
  return reqAsPromise(t.objectStore("exercises").index("by_name").get(name));
}

export async function addExercise(ex) {
  const t = await tx(["exercises"], "readwrite");
  const id = await reqAsPromise(t.objectStore("exercises").add({
    name: ex.name,
    setType: ex.setType,                 // see set-type registry in components.js
    rounds: ex.rounds ?? null,           // standard: N; bilateral: 3; cardio/continuous: null
    workingWeight: ex.workingWeight ?? 0,
    standardKey: ex.standardKey ?? null, // strength-standards lookup key (cardio: null)
    bodyweight: !!ex.bodyweight,         // true = no external weight, hide weight field
    category: ex.category || "strength", // "strength" | "cardio"
    createdAt: Date.now()
  }));
  await txDone(t);
  return id;
}

/** Add only the cardio starter rows that the user doesn't already have, and
 *  remember we did the upgrade in localStorage so a deletion sticks the next
 *  time the app boots. New installs get cardio via the regular seedIfEmpty
 *  pass, so this only runs as a backfill for users on the previous schema. */
export async function seedCardioIfNeeded() {
  const flagKey = "reps:seeded:cardio_v1";
  if (typeof localStorage !== "undefined" && localStorage.getItem(flagKey)) return;
  try {
    const all = await listExercises();
    const haveTypes = new Set(all.map((e) => e.setType));
    if (!haveTypes.has("cardio_swim")) {
      await addExercise({ name: "Swimming", setType: "cardio_swim", category: "cardio" });
    }
    if (!haveTypes.has("cardio_bike")) {
      await addExercise({ name: "Stationary Bike", setType: "cardio_bike", category: "cardio" });
    }
    if (typeof localStorage !== "undefined") localStorage.setItem(flagKey, "1");
  } catch {}
}

export async function updateExercise(id, patch) {
  const t = await tx(["exercises"], "readwrite");
  const store = t.objectStore("exercises");
  const cur = await reqAsPromise(store.get(id));
  if (!cur) throw new Error("exercise not found");
  store.put({ ...cur, ...patch });
  await txDone(t);
}

export async function deleteExercise(id) {
  const t = await tx(["exercises", "sessions", "sets"], "readwrite");
  t.objectStore("exercises").delete(id);
  await txDone(t);
}

/* -------------------- sessions + sets -------------------- */
// A "session" is a gym visit. It contains multiple exercises. There's at most
// one OPEN session at a time (endedAt === null). Older session rows may carry
// a legacy `exerciseId` field — that field is ignored by new code and is no
// longer set on insert.

export async function startSession() {
  const t = await tx(["sessions"], "readwrite");
  const id = await reqAsPromise(t.objectStore("sessions").add({
    startedAt: Date.now(),
    endedAt: null
  }));
  await txDone(t);
  return id;
}

export async function getOpenSession() {
  const t = await tx(["sessions"]);
  const idx = t.objectStore("sessions").index("by_startedAt");
  return new Promise((resolve, reject) => {
    const cur = idx.openCursor(null, "prev");
    cur.onsuccess = (e) => {
      const c = e.target.result;
      if (!c) return resolve(null);
      if (c.value.endedAt == null) return resolve(c.value);
      c.continue();
    };
    cur.onerror = () => reject(cur.error);
  });
}

export async function getOrCreateOpenSession() {
  const open = await getOpenSession();
  if (open) return open;
  const id = await startSession();
  return { id, startedAt: Date.now(), endedAt: null };
}

export async function getSession(id) {
  const t = await tx(["sessions"]);
  return reqAsPromise(t.objectStore("sessions").get(id));
}

export async function endSession(sessionId) {
  const t = await tx(["sessions"], "readwrite");
  const store = t.objectStore("sessions");
  const s = await reqAsPromise(store.get(sessionId));
  if (s) { s.endedAt = Date.now(); store.put(s); }
  await txDone(t);
}

export async function recordSet(set) {
  // set: { sessionId, exerciseId, round, weight, reps, side?, completedAt }
  const t = await tx(["sets"], "readwrite");
  const id = await reqAsPromise(t.objectStore("sets").add({
    completedAt: Date.now(),
    ...set
  }));
  await txDone(t);
  return id;
}

export async function updateSet(id, patch) {
  const t = await tx(["sets"], "readwrite");
  const store = t.objectStore("sets");
  const cur = await reqAsPromise(store.get(id));
  if (!cur) throw new Error("set not found");
  store.put({ ...cur, ...patch });
  await txDone(t);
}

export async function setsForSession(sessionId) {
  const t = await tx(["sets"]);
  return reqAsPromise(t.objectStore("sets").index("by_sessionId").getAll(sessionId));
}

export async function setsForSessionExercise(sessionId, exerciseId) {
  const all = await setsForSession(sessionId);
  return all.filter((s) => s.exerciseId === exerciseId);
}

/**
 * Remove every set in the given session that belongs to the given exercise.
 * Used by History → per-exercise delete; the set rows are dropped, the
 * session itself stays (it may still contain other exercises).
 */
export async function deleteExerciseFromSession(sessionId, exerciseId) {
  const t = await tx(["sets"], "readwrite");
  const idx = t.objectStore("sets").index("by_sessionId");
  await new Promise((resolve, reject) => {
    const cur = idx.openCursor(IDBKeyRange.only(sessionId));
    cur.onsuccess = (e) => {
      const c = e.target.result;
      if (!c) return resolve();
      if (c.value.exerciseId === exerciseId) c.delete();
      c.continue();
    };
    cur.onerror = () => reject(cur.error);
  });
  await txDone(t);
}

export async function setsForExercise(exerciseId) {
  const t = await tx(["sets"]);
  const range = IDBKeyRange.bound([exerciseId, 0], [exerciseId, Number.MAX_SAFE_INTEGER]);
  return reqAsPromise(t.objectStore("sets").index("by_exercise_completedAt").getAll(range));
}

export async function listSessionsBetween(startMs, endMs) {
  const t = await tx(["sessions"]);
  const range = IDBKeyRange.bound(startMs, endMs);
  return reqAsPromise(t.objectStore("sessions").index("by_startedAt").getAll(range));
}

export async function allSessions() {
  const t = await tx(["sessions"]);
  return reqAsPromise(t.objectStore("sessions").getAll());
}

/**
 * The most recent session that contains at least one set for this exercise.
 * Optionally exclude a given session id (e.g. the currently open one) so the
 * "last time" reference points to a previous visit, not the in-progress one.
 *
 * Walks the sets-by-exercise index in descending order, picks the first
 * sessionId that doesn't match the exclusion, then fetches the session row.
 */
export async function lastSessionForExercise(exerciseId, { excludeSessionId } = {}) {
  const t1 = await tx(["sets"]);
  const setsIdx = t1.objectStore("sets").index("by_exercise_completedAt");
  const range = IDBKeyRange.bound([exerciseId, 0], [exerciseId, Number.MAX_SAFE_INTEGER]);

  const sessionId = await new Promise((resolve, reject) => {
    const cur = setsIdx.openCursor(range, "prev");
    cur.onsuccess = (e) => {
      const c = e.target.result;
      if (!c) return resolve(null);
      if (c.value.sessionId === excludeSessionId) { c.continue(); return; }
      resolve(c.value.sessionId);
    };
    cur.onerror = () => reject(cur.error);
  });

  if (sessionId == null) return null;
  const t2 = await tx(["sessions"]);
  return reqAsPromise(t2.objectStore("sessions").get(sessionId));
}

/* -------------------- export / import -------------------- */
// Backup contract: only USER DATA round-trips. The exercises store is
// app-managed structural data — its IDs and rows belong to the app code +
// the Manage Exercises UI, not to the backup file.
//
// Exported keys:
//   profile     — DOB / sex / height / etc.
//   weightLog   — bodyweight history (treated as profile data)
//   sessions    — gym visits
//   sets        — per-set rows (carry exerciseId references that the
//                 importer trusts but does not validate)
// NOT exported:
//   exercises   — definitions live in app code + the user's Manage screen
//
// Old v1 backups did include the exercises array. importAll accepts those
// for backwards-compat but silently ignores the exercises field.

const USER_STORES = ["profile", "weightLog", "sessions", "sets"];
const EXPORT_VERSION = 2;

export async function exportAll() {
  const db = await openDb();
  const t = db.transaction(USER_STORES, "readonly");
  const out = { version: EXPORT_VERSION, exportedAt: Date.now() };
  for (const s of USER_STORES) {
    out[s] = await reqAsPromise(t.objectStore(s).getAll());
  }
  return out;
}

export async function importAll(data, { wipe = true } = {}) {
  if (!data) throw new Error("no data");
  if (!(data.version === 1 || data.version === 2)) {
    throw new Error("unsupported export version");
  }
  const db = await openDb();
  const t = db.transaction(USER_STORES, "readwrite");
  if (wipe) for (const s of USER_STORES) t.objectStore(s).clear();
  for (const s of USER_STORES) {
    for (const row of (data[s] || [])) t.objectStore(s).put(row);
  }
  // Note: we deliberately do NOT touch the exercises store, even if a
  // legacy v1 backup carried one — exercises are app-managed.
  await txDone(t);
}

/* -------------------- seeding -------------------- */

/**
 * One-shot seed: only inserts the starter exercises when the store is empty.
 * NEVER overwrites or modifies user-added/edited exercises on later boots,
 * even if the starter list itself changes — adding new starters in the
 * source after first install requires the user to add them manually.
 */
export async function seedIfEmpty(starter) {
  const existing = await listExercises();
  if (existing.length > 0) return;
  for (const ex of starter) await addExercise(ex);
}
