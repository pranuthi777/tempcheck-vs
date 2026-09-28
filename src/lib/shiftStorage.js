"use client";

/**
 * Persists the in-progress shift log to localStorage so a crashed tab,
 * accidental reload, or browser restart doesn't lose a shift's compliance
 * record — the whole point of the record is that it survives to be shown
 * to an inspector, so it shouldn't live only in memory.
 *
 * This is intentionally simple (no backend, no accounts): one browser's
 * localStorage holds the current/most-recent shift. It does NOT claim to
 * be multi-device or multi-user persistent storage — that's still a real,
 * disclosed limitation (see README) — but it does mean the single most
 * common failure mode (the tab itself dying mid-shift) no longer loses
 * the log.
 */
const KEY = "tempcheck.currentShift.v1";

export function loadShift() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.readings)) return null;
    return parsed;
  } catch {
    // Storage unavailable (private browsing, quota, etc.) — degrade to
    // in-memory only rather than throwing and breaking the app.
    return null;
  }
}

export function saveShift(shift) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(shift));
  } catch {
    // Best-effort; the shift continues to work in memory even if this fails.
  }
}

export function clearShift() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
