// Share-or-download backup. On iOS Safari with files supported in
// navigator.share, this opens the native Share Sheet so the user can
// save to iCloud Files, AirDrop to a Mac, email, etc. Where files
// aren't supported (some Android browsers, desktop Firefox), it falls
// back to a regular download via an <a download> click.

import { exportAll } from "../db/repo.js";

function todayFilename() {
  return `reps-backup-${new Date().toISOString().slice(0, 10)}.json`;
}

export async function buildBackupBlob() {
  const data = await exportAll();
  const json = JSON.stringify(data, null, 2);
  return new Blob([json], { type: "application/json" });
}

export async function shareOrDownloadBackup() {
  const blob = await buildBackupBlob();
  const filename = todayFilename();

  if (typeof navigator.share === "function" && typeof navigator.canShare === "function") {
    try {
      const file = new File([blob], filename, { type: "application/json" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "REPS backup",
          text: "REPS data backup"
        });
        return "shared";
      }
    } catch (err) {
      if (err && err.name === "AbortError") return "cancelled";
      // Otherwise drop through to download fallback.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return "downloaded";
}
