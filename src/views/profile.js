import { getProfile, saveProfile, listWeights, logWeight, importAll } from "../db/repo.js";
import { h, eyebrow, field, fmtKg, fmtAge } from "../ui/components.js";
import { shareOrDownloadBackup } from "../ui/share.js";
import { APP_VERSION } from "../app.js";

export async function ProfileView(_params, root) {
  const [profile, weights] = await Promise.all([getProfile(), listWeights()]);

  const head = h("div", { class: "page-head" }, [
    eyebrow("You"),
    h("h1", { class: "display-l" }, "Profile")
  ]);

  // ----- profile form -----
  const dobInput = h("input", { type: "date", value: profile?.dob ? new Date(profile.dob).toISOString().slice(0, 10) : "" });
  const sexSel = h("select", {}, [
    h("option", { value: "" }, "—"),
    h("option", { value: "male", selected: profile?.sex === "male" }, "Male"),
    h("option", { value: "female", selected: profile?.sex === "female" }, "Female")
  ]);
  const heightInput = h("input", { type: "number", value: profile?.heightCm ? String(profile.heightCm) : "", step: "0.5", placeholder: "cm" });

  const profileCard = h("div", { class: "card stack" }, [
    eyebrow("Personal"),
    field("Date of birth", dobInput),
    field("Sex", sexSel),
    field("Height (cm)", heightInput),
    h("button", { class: "btn btn-primary btn-block", onclick: async () => {
      const dob = dobInput.value ? new Date(dobInput.value).getTime() : null;
      await saveProfile({
        dob, sex: sexSel.value || null,
        heightCm: heightInput.value ? Number(heightInput.value) : null
      });
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } }, "Save profile")
  ]);

  if (profile?.dob) {
    profileCard.insertBefore(h("p", { class: "mono", style: "font-size:13px; color: var(--ink-mute)" }, `Age: ${fmtAge(profile.dob)}`), profileCard.children[2]);
  }

  // ----- weight log -----
  const newWeight = h("input", { type: "number", step: "0.1", placeholder: "kg" });
  const weightCard = h("div", { class: "card stack" }, [
    eyebrow("Weight log"),
    weights[0]
      ? h("div", { class: "row-between" }, [
          h("div", {}, [
            h("div", { class: "display-m mono" }, fmtKg(weights[0].kg)),
            h("div", { class: "mono", style: "font-size:11px; color: var(--ink-mute)" },
              `Logged ${new Date(weights[0].loggedAt).toLocaleDateString()}`)
          ])
        ])
      : h("p", { class: "body-s", style: "color: var(--ink-mute)" }, "No weight logged yet."),
    field("Log new weight", newWeight),
    h("button", { class: "btn btn-primary btn-block", onclick: async () => {
      const v = Number(newWeight.value);
      if (!v || v < 20 || v > 400) return alert("Enter a sensible weight in kg.");
      await logWeight(v);
      newWeight.value = "";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } }, "Log weight")
  ]);

  // recent history rows
  if (weights.length > 1) {
    const list = h("div", { class: "stack-sm" }, weights.slice(1, 11).map((w) =>
      h("div", { class: "row-between mono", style: "font-size:13px; color: var(--ink-soft)" }, [
        h("span", {}, new Date(w.loggedAt).toLocaleDateString()),
        h("span", {}, fmtKg(w.kg))
      ])
    ));
    weightCard.appendChild(h("div", { class: "divider" }));
    weightCard.appendChild(list);
  }

  // ----- backup -----
  const backupCard = h("div", { class: "card stack" }, [
    eyebrow("Backup"),
    h("p", { class: "body-s", style: "color: var(--ink-mute)" },
      "Storage is local. Export periodically — clearing site data will wipe your history."),
    h("div", { class: "grid-2" }, [
      h("button", { class: "btn btn-ghost", onclick: doExport }, "Export JSON"),
      h("label", { class: "btn btn-ghost", style: "cursor:pointer" }, [
        "Import JSON",
        h("input", { type: "file", accept: "application/json", style: "display:none", onchange: doImport })
      ])
    ])
  ]);

  const settingsCard = h("div", { class: "card stack" }, [
    eyebrow("Settings"),
    h("a", { href: "#/manage-exercises", class: "btn btn-ghost btn-block" }, "Manage exercises")
  ]);

  root.appendChild(head);
  root.appendChild(h("div", { class: "stack" }, [profileCard, weightCard, settingsCard, backupCard]));
  root.appendChild(h("div", { class: "version-footer" }, `REPS · ${APP_VERSION}`));

  async function doExport() {
    try { await shareOrDownloadBackup(); }
    catch (err) { alert("Backup failed: " + err.message); }
  }

  async function doImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm("Importing replaces ALL local data. Continue?")) return;
    try {
      const data = JSON.parse(await file.text());
      await importAll(data, { wipe: true });
      alert("Imported.");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } catch (err) {
      alert("Import failed: " + err.message);
    }
  }
}
