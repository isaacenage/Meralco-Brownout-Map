"use client";

// Two-mode "is my barangay affected today?" check.
//   checkByName  — pure string matching against the schedule's affected list.
//   checkByCoords — point-in-polygon over the affected polygons (uses DuckDB).
// Both share the same result shape so the UI banner is mode-agnostic.

import type { Schedule } from "./schedule";
import { matchKeysForWindow, normalizeBarangay, normalizeCity } from "./normalize";
import { queryBarangaysByMatchKeys, queryBarangaysByTokens } from "./duckdb";
import { wkbToGeometry } from "./wkb";

export interface MatchedWindow {
  start: string | null;
  end: string | null;
  label: string;
}

export interface LocationMatch {
  isAffected: boolean;
  barangay: string | null;
  city: string | null;
  province: string | null;
  windows: MatchedWindow[];
  query: string | null;
}

const EMPTY: LocationMatch = {
  isAffected: false,
  barangay: null,
  city: null,
  province: null,
  windows: [],
  query: null,
};

function trimLabel(label: string): string {
  return label.replace(/^Between\s+/i, "");
}

function buildScheduleKeyIndex(
  schedule: Schedule
): Map<string, MatchedWindow[]> {
  const keyToWindows = new Map<string, MatchedWindow[]>();
  for (const w of schedule.windows) {
    const win: MatchedWindow = {
      start: w.start,
      end: w.end,
      label: trimLabel(w.label),
    };
    for (const k of matchKeysForWindow(w)) {
      const arr = keyToWindows.get(k);
      if (arr) {
        if (!arr.some((existing) => existing.label === win.label)) arr.push(win);
      } else {
        keyToWindows.set(k, [win]);
      }
    }
  }
  return keyToWindows;
}

export async function checkByName(
  input: string,
  schedule: Schedule
): Promise<LocationMatch> {
  const raw = input.trim();
  if (raw.length < 3) return { ...EMPTY, query: raw || null };

  const normed = normalizeBarangay(raw);
  if (!normed) return { ...EMPTY, query: raw };

  // Token-based AND match: every token in the input must appear somewhere in
  // the candidate "<city> <barangay> <province>" haystack. Catches both
  // "Bagumbayan" and "Bagumbayan Quezon City" against the same record.
  const tokens = normed.split(" ").filter((t) => t.length >= 2);
  if (tokens.length === 0) return { ...EMPTY, query: raw };

  const matched: MatchedWindow[] = [];
  const seenLabels = new Set<string>();
  let firstHit: { barangay: string; city: string; province: string } | null = null;

  // Pass 1: direct match against the schedule's listed names. Handles exact
  // cluster matches ("Caloocan City Proper") and non-NCR province lookups.
  for (const w of schedule.windows) {
    const label = trimLabel(w.label);
    let hitInWindow = false;
    for (const province of w.provinces) {
      const provKey = normalizeBarangay(province.name);
      for (const city of province.cities) {
        const cityKey = normalizeCity(city.name);
        for (const barangay of city.barangays) {
          const brgyKey = normalizeBarangay(barangay);
          const haystack = `${cityKey} ${brgyKey} ${provKey}`;
          const matches = tokens.every((t) => haystack.includes(t));
          if (!matches) continue;
          hitInWindow = true;
          if (!firstHit) {
            firstHit = {
              barangay,
              city: city.name,
              province: province.name,
            };
          }
        }
      }
    }
    if (hitInWindow && !seenLabels.has(label)) {
      seenLabels.add(label);
      matched.push({ start: w.start, end: w.end, label });
    }
  }

  if (matched.length > 0) {
    return {
      isAffected: true,
      barangay: firstHit?.barangay ?? null,
      city: firstHit?.city ?? null,
      province: firstHit?.province ?? null,
      windows: matched,
      query: raw,
    };
  }

  // Pass 2: parquet fallback. Meralco often lists named clusters that PSGC
  // stores as numbered constituent barangays — e.g. "Caloocan City Proper"
  // covers brgys 1–85, "Pasay City Proper" covers brgys 1–201, "Bagong Silang"
  // covers brgy 176. If the user typed a constituent name, the parquet's
  // pre-built match_keys carry the cluster alias; intersect those with the
  // schedule's keys to resolve the hit.
  const keyToWindows = buildScheduleKeyIndex(schedule);
  if (keyToWindows.size === 0) return { ...EMPTY, query: raw };

  try {
    const rows = await queryBarangaysByTokens(
      tokens,
      Array.from(keyToWindows.keys())
    );
    for (const row of rows) {
      const matchedWindows: MatchedWindow[] = [];
      const seen = new Set<string>();
      for (const k of row.match_keys) {
        const arr = keyToWindows.get(k);
        if (!arr) continue;
        for (const w of arr) {
          if (seen.has(w.label)) continue;
          seen.add(w.label);
          matchedWindows.push(w);
        }
      }
      if (matchedWindows.length > 0) {
        return {
          isAffected: true,
          barangay: row.barangay_norm,
          city: row.city_norm,
          province: null,
          windows: matchedWindows,
          query: raw,
        };
      }
    }
  } catch (err) {
    console.warn("checkByName parquet fallback failed", err);
  }

  return { ...EMPTY, query: raw };
}

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const dy = yj - yi || 1e-12;
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / dy + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export async function checkByCoords(
  lng: number,
  lat: number,
  schedule: Schedule
): Promise<LocationMatch> {
  const keyToWindows = new Map<string, MatchedWindow[]>();
  for (const w of schedule.windows) {
    const win: MatchedWindow = {
      start: w.start,
      end: w.end,
      label: trimLabel(w.label),
    };
    for (const k of matchKeysForWindow(w)) {
      const arr = keyToWindows.get(k);
      if (arr) {
        if (!arr.some((existing) => existing.label === win.label)) arr.push(win);
      } else {
        keyToWindows.set(k, [win]);
      }
    }
  }
  if (keyToWindows.size === 0) return { ...EMPTY };

  const allKeys = Array.from(keyToWindows.keys());
  const rows = await queryBarangaysByMatchKeys(allKeys);

  for (const row of rows) {
    let geom;
    try {
      geom = wkbToGeometry(row.geometry);
    } catch {
      continue;
    }
    const polygons =
      geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
    for (const poly of polygons) {
      if (!poly.length) continue;
      // Outer ring only — barangay polygons rarely have meaningful holes.
      if (pointInRing(lng, lat, poly[0])) {
        const matched: MatchedWindow[] = [];
        const seen = new Set<string>();
        for (const k of row.match_keys) {
          const arr = keyToWindows.get(k);
          if (!arr) continue;
          for (const w of arr) {
            if (seen.has(w.label)) continue;
            seen.add(w.label);
            matched.push(w);
          }
        }
        return {
          isAffected: matched.length > 0,
          barangay: row.barangay_norm,
          city: row.city_norm,
          province: null,
          windows: matched,
          query: null,
        };
      }
    }
  }

  return { ...EMPTY };
}
