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
    setType: ex.setType,                 // "standard" | "bilateral" | "continuous"
    rounds: ex.rounds ?? null,           // standard: N; bilateral: 3 (fixed); continuous: null
    workingWeight: ex.workingWeight ?? 0,
    standardKey: ex.standardKey ?? null, // points into strength-standards
    createdAt: Date.now()
  }));
  await txDone(t);
  return id;
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

export async function startSession(exerciseId) {
  const t = await tx(["sessions"], "readwrite");
  const id = await reqAsPromise(t.objectStore("sessions").add({
    exerciseId,
    startedAt: Date.now(),
    endedAt: null
  }));
  await txDone(t);
  return id;
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

export async function setsForSession(sessionId) {
  const t = await tx(["sets"]);
  return reqAsPromise(t.objectStore("sets").index("by_sessionId").getAll(sessionId));
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

export async function lastSessionForExercise(exerciseId) {
  const t = await tx(["sessions"]);
  const idx = t.objectStore("sessions").index("by_exerciseId");
  return new Promise((resolve, reject) => {
    let best = null;
    const cur = idx.openCursor(IDBKeyRange.only(exerciseId));
    cur.onsuccess = (e) => {
      const c = e.target.result;
      if (!c) return resolve(best);
      if (!best || c.value.startedAt > best.startedAt) best = c.value;
      c.continue();
    };
    cur.onerror = () => reject(cur.error);
  });
}

/* -------------------- export / import -------------------- */

export async function exportAll() {
  const db = await openDb();
  const stores = ["profile", "weightLog", "exercises", "sessions", "sets"];
  const t = db.transaction(stores, "readonly");
  const out = { version: 1, exportedAt: Date.now() };
  for (const s of stores) {
    out[s] = await reqAsPromise(t.objectStore(s).getAll());
  }
  return out;
}

export async function importAll(data, { wipe = true } = {}) {
  if (!data || data.version !== 1) throw new Error("unsupported export version");
  const db = await openDb();
  const stores = ["profile", "weightLog", "exercises", "sessions", "sets"];
  const t = db.transaction(stores, "readwrite");
  if (wipe) for (const s of stores) t.objectStore(s).clear();
  for (const s of stores) {
    for (const row of (data[s] || [])) t.objectStore(s).put(row);
  }
  await txDone(t);
}

/* -------------------- seeding -------------------- */

export async function seedIfEmpty(starter) {
  const existing = await listExercises();
  if (existing.length > 0) return;
  for (const ex of starter) await addExercise(ex);
}
