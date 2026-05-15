// Mirror of scripts/convert_barangays_to_parquet.py — must stay in sync so
// match keys generated at build time (Python) and runtime (TS) agree.
// See the Python file's module docstring for the rationale behind each rule.

import type { ScheduleWindow } from "./schedule";

const ABBREV: Record<string, string> = {
  STA: "SANTA",
  STO: "SANTO",
  ST: "SAINT",
  MT: "MOUNT",
  GEN: "GENERAL",
  HEN: "GENERAL",
  PRES: "PRESIDENT",
  BRGY: "",
  BGY: "",
  BARANGAY: "BARANGAY",
  SN: "SAN",
  VILL: "VILLAGE",
  VILLE: "VILLAGE",
  HTS: "HEIGHTS",
  POB: "POBLACION",
  HGTS: "HEIGHTS",
};

// Spanish/Filipino ordinal words used at the tail of barangay names
// (Pamplona Uno, Talon Kuatro, Concepcion Dos). PSGC writes the word form,
// Meralco often writes Roman numerals — convert both to Arabic so the tail
// of "PAMPLONA UNO" and "PAMPLONA I" both end at "1".
const SPANISH_NUMERALS: Record<string, string> = {
  UNO: "1",
  DOS: "2",
  TRES: "3",
  KUATRO: "4",
  CUATRO: "4",
  QUATRO: "4",
  SINGKO: "5",
  CINCO: "5",
  SAIS: "6",
  SEIS: "6",
  SIETE: "7",
  OTSO: "8",
  OCHO: "8",
  NUEVE: "9",
  DIES: "10",
  DIEZ: "10",
};

const ROMAN_VALUES: Record<string, number> = {
  I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000,
};
const ROMAN_RE = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
const PAREN_RE = /\([^)]*\)/g;
// Internal apostrophes (Iba O'Este) stripped to align with Meralco's "OESTE".
const APOSTROPHE_RE = /['‘’]/g;
const PUNCT_TRIM_RE = /^[.,;:'"]+|[.,;:'"]+$/g;
const ORDINAL_SUFFIX_RE = /^(\d+)(?:ST|ND|RD|TH)$/i;
const SPACE_RE = /\s+/g;
// Single-letter-with-dot run, e.g. "B. F." or "N.S." — collapse to "BF" / "NS"
// before tokenization. Matches sequences of >=2 single letters each followed
// by a period (with optional spaces).
const INITIALS_RUN_RE = /\b([A-Z])\.\s*([A-Z])\.(?:\s*([A-Z])\.)?/g;
// Phrase-level rewrites applied to the normalized string (token-joined, upper).
// Used to bridge known spelling/spacing differences between Meralco and PSGC.
const PHRASE_REWRITES: Array<[RegExp, string]> = [
  [/\bPULANG\s+LUPA\b/g, "PULANGLUPA"],
  [/\bDUYAN\s+DUYAN\b/g, "DUYAN-DUYAN"],
  [/\bDAMAYAN\s+LAGI\b/g, "DAMAYANG LAGI"],
  [/\bDELA\s+PAZ\b/g, "DE LA PAZ"],
  [/\bCARUHATAN\b/g, "KARUHATAN"],
  [/\bGENERAL\s+M\s+ALVAREZ\b/g, "GENERAL MARIANO ALVAREZ"],
  [/\bTRECE\s+MARTIREZ\b/g, "TRECE MARTIRES"],
  [/\bMARIANO\s+ESPELETA\b/g, "ESPELETA"],
];

function toAsciiUpper(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(APOSTROPHE_RE, "")
    .toUpperCase();
}

// Splits Meralco's "<NAME>/<DISTRICT-HINT>" or "<A>/<B>/<HINT>" forms (mostly
// Quezon City) into individual candidate names so each can be matched
// separately. "GULOD/NOVALICHES" -> ["GULOD","NOVALICHES"]; PSGC only has the
// real barangay name, so the hint segment fails to match harmlessly.
function splitSlashVariants(value: string): string[] {
  if (!value.includes("/")) return [value];
  return value
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Pre-tokenization rewrites: collapse initials, strip "-PROJ N" suffix,
// replace internal periods with spaces so "N.S.AMORANTO" tokenizes cleanly.
function preNormalize(upper: string): string {
  let out = upper;
  // Strip QC-style "-PROJ N" or "-PROJECT N" district suffix when it dangles
  // off the end of the name, e.g. "AMIHAN-PROJ 3".
  out = out.replace(/[-\s]+PROJ(?:ECT)?\.?\s*\d+\s*$/i, "");
  // Collapse runs of single-letter initials with periods: "B. F." -> "BF",
  // "N.S." -> "NS". Trailing space ensures the next character is treated as
  // its own token (e.g. "N.S.AMORANTO" -> "NS AMORANTO" not "NSAMORANTO").
  out = out.replace(INITIALS_RUN_RE, (_m, a, b, c) => (c ? a + b + c : a + b) + " ");
  // Replace any remaining internal periods with spaces ("STA.QUITERIA" ->
  // "STA QUITERIA"), then collapse multi-space.
  out = out.replace(/\./g, " ").replace(SPACE_RE, " ").trim();
  return out;
}

function tokens(value: string): string[] {
  const noParens = value.replace(PAREN_RE, " ");
  const pre = preNormalize(noParens);
  const out: string[] = [];
  for (const raw of pre.split(/\s+/)) {
    let token = raw.replace(PUNCT_TRIM_RE, "");
    if (!token) continue;
    // Strip ordinal suffix on digits: "2ND" -> "2", "1ST" -> "1". PSGC writes
    // "Maitim 2nd East" where Meralco writes "MAITIM II EAST".
    const ord = ORDINAL_SUFFIX_RE.exec(token);
    if (ord) token = ord[1];
    if (token in ABBREV) {
      const replacement = ABBREV[token];
      if (replacement) out.push(replacement);
    } else {
      out.push(token);
    }
  }
  // Merge consecutive single-letter tokens into one (e.g. ["N","S","AMORANTO"]
  // -> ["NS","AMORANTO"]). This catches PSGC "B. F. Homes" and aligns it with
  // Meralco's "BF HOMES".
  const merged: string[] = [];
  let buf = "";
  for (const t of out) {
    if (t.length === 1 && /^[A-Z]$/.test(t)) {
      buf += t;
    } else {
      if (buf) {
        merged.push(buf);
        buf = "";
      }
      merged.push(t);
    }
  }
  if (buf) merged.push(buf);
  return merged;
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

function convertNumeral(token: string): string {
  // Single-token Spanish numeral ("Uno", "Dos") -> Arabic.
  if (token in SPANISH_NUMERALS) return SPANISH_NUMERALS[token];
  // Hyphenated like "II-A": convert each part if Roman/Spanish.
  const parts = token.split("-");
  let changed = false;
  const out = parts.map((p) => {
    const n = romanToInt(p);
    if (n !== null) {
      changed = true;
      return String(n);
    }
    if (p in SPANISH_NUMERALS) {
      changed = true;
      return SPANISH_NUMERALS[p];
    }
    return p;
  });
  return changed ? out.join("-") : token;
}

function applyPhraseRewrites(value: string): string {
  let out = value;
  for (const [re, repl] of PHRASE_REWRITES) out = out.replace(re, repl);
  return out;
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
  return applyPhraseRewrites(trimmed.join(" ").replace(SPACE_RE, " ").trim());
}

function normalizeBarangaySingle(value: string): string {
  const tks = tokens(toAsciiUpper(value));
  if (!tks.length) return "";
  // "<CITY> CITY PROPER" / "<CITY> TOWN PROPER" stay as-is so they hit the
  // city-wide auto-aliases the parquet emits for every barangay.
  const converted = tks.map((t) => convertNumeral(t));
  return applyPhraseRewrites(converted.join(" ").replace(SPACE_RE, " ").trim());
}

export function normalizeBarangay(value: string | null | undefined): string {
  if (!value) return "";
  // For the public API we keep the original single-string contract; the slash
  // variant expansion only matters at match-key time below.
  const variants = splitSlashVariants(value);
  return normalizeBarangaySingle(variants[0] ?? value);
}

/** Return every normalized variant of `value` (handles "/"-separated forms
 * and "(paren alias)" hints). Meralco occasionally writes a name like
 * "PULO NI SARA (PANTIHAN 4)" — the paren is its own searchable alias. */
export function normalizeBarangayVariants(
  value: string | null | undefined
): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  for (const variant of splitSlashVariants(value)) {
    const n = normalizeBarangaySingle(variant);
    if (n) seen.add(n);
    // Pull out parenthetical aliases as additional candidates.
    const parenMatches = variant.match(/\(([^)]+)\)/g);
    if (parenMatches) {
      for (const m of parenMatches) {
        const inner = m.slice(1, -1).trim();
        if (!inner) continue;
        const nn = normalizeBarangaySingle(inner);
        if (nn) seen.add(nn);
      }
    }
  }
  return Array.from(seen);
}

/** Build the lookup keys for every (city, barangay) pair in a schedule window. */
export function matchKeysForWindow(window: ScheduleWindow): string[] {
  const set = new Set<string>();
  for (const province of window.provinces) {
    for (const city of province.cities) {
      const cityKey = normalizeCity(city.name);
      if (!cityKey) continue;
      for (const barangay of city.barangays) {
        for (const brgyKey of normalizeBarangayVariants(barangay)) {
          set.add(`${cityKey}|${brgyKey}`);
        }
      }
    }
  }
  return Array.from(set);
}
