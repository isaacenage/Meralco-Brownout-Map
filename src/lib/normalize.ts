// Mirror of scripts/convert_barangays_to_parquet.py — must stay in sync so
// match keys generated at build time (Python) and runtime (TS) agree.
// See the Python file's module docstring for the rationale behind each rule.

import type { ScheduleWindow } from "./schedule";

const ABBREV: Record<string, string> = {
  STA: "SANTA",
  STO: "SANTO",
  MT: "MOUNT",
  GEN: "GENERAL",
  PRES: "PRESIDENT",
  BRGY: "",
  BARANGAY: "BARANGAY",
};

const ROMAN_VALUES: Record<string, number> = {
  I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000,
};
const ROMAN_RE = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
const PAREN_RE = /\([^)]*\)/g;
const PUNCT_TRIM_RE = /^[.,;:'"]+|[.,;:'"]+$/g;
const SPACE_RE = /\s+/g;

function toAsciiUpper(value: string): string {
  return value.normalize("NFD").replace(/\p{M}+/gu, "").toUpperCase();
}

function tokens(value: string): string[] {
  const noParens = value.replace(PAREN_RE, " ");
  const out: string[] = [];
  for (const raw of noParens.split(/\s+/)) {
    const token = raw.replace(PUNCT_TRIM_RE, "");
    if (!token) continue;
    if (token in ABBREV) {
      const replacement = ABBREV[token];
      if (replacement) out.push(replacement);
    } else {
      out.push(token);
    }
  }
  return out;
}

function romanToInt(token: string): number | null {
  if (!token || !ROMAN_RE.test(token)) return null;
  let total = 0;
  let prev = 0;
  for (let i = token.length - 1; i >= 0; i--) {
    const v = ROMAN_VALUES[token[i]];
    total = v < prev ? total - v : total + v;
    prev = v;
  }
  return total;
}

function convertRomanTail(token: string): string {
  const parts = token.split("-");
  let changed = false;
  const out = parts.map((p) => {
    const n = romanToInt(p);
    if (n !== null) {
      changed = true;
      return String(n);
    }
    return p;
  });
  return changed ? out.join("-") : token;
}

export function normalizeCity(value: string | null | undefined): string {
  if (!value) return "";
  const tks = tokens(toAsciiUpper(value));
  if (!tks.length) return "";
  let trimmed = tks;
  if (trimmed[0] === "CITY" && trimmed.length > 1 && trimmed[1] === "OF") {
    trimmed = trimmed.slice(2);
  } else if (trimmed[trimmed.length - 1] === "CITY") {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.join(" ").replace(SPACE_RE, " ").trim();
}

export function normalizeBarangay(value: string | null | undefined): string {
  if (!value) return "";
  const tks = tokens(toAsciiUpper(value));
  if (!tks.length) return "";
  if (tks.length >= 2 && tks[tks.length - 2] === "TOWN" && tks[tks.length - 1] === "PROPER") {
    return "POBLACION";
  }
  tks[tks.length - 1] = convertRomanTail(tks[tks.length - 1]);
  return tks.join(" ").replace(SPACE_RE, " ").trim();
}

/** Build the lookup keys for every (city, barangay) pair in a schedule window. */
export function matchKeysForWindow(window: ScheduleWindow): string[] {
  const set = new Set<string>();
  for (const province of window.provinces) {
    for (const city of province.cities) {
      const cityKey = normalizeCity(city.name);
      if (!cityKey) continue;
      for (const barangay of city.barangays) {
        const brgyKey = normalizeBarangay(barangay);
        if (!brgyKey) continue;
        set.add(`${cityKey}|${brgyKey}`);
      }
    }
  }
  return Array.from(set);
}
