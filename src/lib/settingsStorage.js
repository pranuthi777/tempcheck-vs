"use client";

/**
 * Persists kitchen-level settings that don't change shift to shift — the
 * establishment name and the thermometer's ID/calibration date (see the
 * HACCP PDF — Round-2 critique #P1-8: an inspector wants to know whose
 * establishment this is and which thermometer was used, and that it's
 * actually calibrated). "Set once in settings," not re-asked every shift,
 * unlike the cook's name (see shiftStorage.js — that's per-shift).
 */
const KEY = "tempcheck.settings.v1";

export function loadSettings() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveSettings(settings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Best-effort; the app continues to work with in-memory-only settings.
  }
}
