"""Combine downloaded barangay GeoJSONs into a single GeoParquet file.

Adds a `match_keys` list column so the browser can filter polygons against the
scraped Meralco schedule, which only carries names. Normalization handles the
known shape mismatches between Meralco's wording and PSGC:

* Province is dropped from the key — Meralco says "METRO MANILA" but PSGC splits
  NCR into four districts plus the City of Manila. (city, barangay) is unique
  enough across the Meralco franchise area.
* City: "CITY OF MAKATI" / "MAKATI CITY" both normalize to "MAKATI".
* Barangay: Roman numerals + Spanish ordinals at the tail normalize to Arabic
  ("Bunsuran III" / "Pamplona Uno" -> "BUNSURAN 3" / "PAMPLONA 1");
  diacritics stripped; "X TOWN PROPER" maps to "POBLACION"; parenthetical
  asides like "(Pob.)" become extra alias keys ("POBLACION"); "/"-joined
  Meralco forms ("MARIANA/DAMAYAN LAGI", "GULOD/NOVALICHES") expand to each
  segment.
* Common abbreviations: BGY, SN, HEN, VILL, HTS, ST. (Saint), POB, etc.
* Manila zones: PSGC stores Binondo/Tondo/Sampaloc/etc as ADM3-level districts
  whose barangays are numbered ("Barangay 287"). Meralco publishes by zone
  name, so every polygon in a Manila district also gets the zone key
  "MANILA|<DISTRICT>". Sta. Mesa is a sub-zone of Sampaloc (PSGC has no
  separate ADM3) so its barangays get a "MANILA|STA. MESA" alias too.
* Caloocan / Pasay / Las Piñas: Meralco labels named clusters (Dagat-Dagatan,
  Grace Park, "Caloocan City Proper", "Pasay City Proper", "Las Piñas City
  Proper") which PSGC stores as numbered barangays. CITY_GROUPS expands each
  named cluster to its constituent numbered barangays so the cluster name
  lights up the whole area on the map.
* Cross-city transfers: the 10 EMBO district barangays (Cembo, South Cembo,
  Pembo, East/West Rembo, Comembo, Pitogo, Rizal, Post Proper N/S) sit under
  Makati in this PSGC snapshot but Meralco schedules list them under Taguig
  after the 2023 jurisdictional transfer. CITY_TRANSFERS aliases them to both.

The TS side mirrors `normalize_city`/`normalize_brgy` so both sides agree on
match keys.
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

import geopandas as gpd
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "public" / "data" / "barangays" / "raw"
OUTPUT = ROOT / "public" / "data" / "barangays" / "barangays.parquet"

ABBREV: dict[str, str] = {
    "STA": "SANTA",
    "STO": "SANTO",
    "ST": "SAINT",
    "MT": "MOUNT",
    "GEN": "GENERAL",
    "HEN": "GENERAL",
    "PRES": "PRESIDENT",
    "BRGY": "",
    "BGY": "",
    "BARANGAY": "BARANGAY",
    "SN": "SAN",
    "VILL": "VILLAGE",
    "VILLE": "VILLAGE",
    "HTS": "HEIGHTS",
    "HGTS": "HEIGHTS",
    "POB": "POBLACION",
}

# Spanish/Filipino ordinal words at the tail of barangay names.
SPANISH_NUMERALS: dict[str, str] = {
    "UNO": "1", "DOS": "2", "TRES": "3",
    "KUATRO": "4", "CUATRO": "4", "QUATRO": "4",
    "SINGKO": "5", "CINCO": "5",
    "SAIS": "6", "SEIS": "6",
    "SIETE": "7", "OTSO": "8", "OCHO": "8",
    "NUEVE": "9", "DIES": "10", "DIEZ": "10",
}

ROMAN_VALUES = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
ROMAN_RE = re.compile(
    r"^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$"
)
PAREN_RE = re.compile(r"\([^)]*\)")
PAREN_CAPTURE_RE = re.compile(r"\(([^)]+)\)")
APOSTROPHE_RE = re.compile(r"['‘’]")
ORDINAL_SUFFIX_RE = re.compile(r"^(\d+)(?:ST|ND|RD|TH)$", re.IGNORECASE)
SPACE_RE = re.compile(r"\s+")
INITIALS_RUN_RE = re.compile(r"\b([A-Z])\.\s*([A-Z])\.(?:\s*([A-Z])\.)?")
PHRASE_REWRITES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bPULANG\s+LUPA\b"), "PULANGLUPA"),
    (re.compile(r"\bDUYAN\s+DUYAN\b"), "DUYAN-DUYAN"),
    (re.compile(r"\bDAMAYAN\s+LAGI\b"), "DAMAYANG LAGI"),
    (re.compile(r"\bDELA\s+PAZ\b"), "DE LA PAZ"),
    (re.compile(r"\bCARUHATAN\b"), "KARUHATAN"),
    (re.compile(r"\bGENERAL\s+M\s+ALVAREZ\b"), "GENERAL MARIANO ALVAREZ"),
    (re.compile(r"\bTRECE\s+MARTIREZ\b"), "TRECE MARTIRES"),
    (re.compile(r"\bMARIANO\s+ESPELETA\b"), "ESPELETA"),
]

# PSGC ADM3_EN names for the City of Manila districts; Meralco scrapes them as
# barangays under city="MANILA".
MANILA_DISTRICTS: dict[str, str] = {
    "BINONDO": "BINONDO",
    "ERMITA": "ERMITA",
    "INTRAMUROS": "INTRAMUROS",
    "MALATE": "MALATE",
    "PACO": "PACO",
    "PANDACAN": "PANDACAN",
    "PORT AREA": "PORT AREA",
    "QUIAPO": "QUIAPO",
    "SAMPALOC": "SAMPALOC",
    "SAN MIGUEL": "SAN MIGUEL",
    "SAN NICOLAS": "SAN NICOLAS",
    "SANTA ANA": "SANTA ANA",
    "SANTA CRUZ": "SANTA CRUZ",
    "TONDO I / II": "TONDO",
}

# Manila sub-zones: zones inside a PSGC ADM3 district that Meralco scrapes as
# their own "barangay" name. Sta. Mesa lives inside the Sampaloc district per
# PSGC but Meralco lists it separately, so every Sampaloc barangay in the Sta.
# Mesa range gets an extra "MANILA|STA. MESA" key.
# Sta. Mesa, Manila: brgys 587 through 636 (plus 587-A) in the Sampaloc PSGC
# district. Sources: Wikipedia "Santa Mesa, Manila"; Manila barangay zoning.
def _santa_mesa_members() -> set[str]:
    out = {f"BARANGAY {n}" for n in range(587, 637)}
    out.add("BARANGAY 587-A")
    return out


MANILA_SUB_ZONES: dict[str, dict[str, set[str]]] = {
    # PSGC_ADM3_norm -> { Meralco_zone_name_norm -> set of primary brgy names }
    "SAMPALOC": {"SANTA MESA": _santa_mesa_members()},
}


def _range_brgys(*ranges: range) -> set[str]:
    out: set[str] = set()
    for r in ranges:
        for n in r:
            out.add(f"BARANGAY {n}")
    return out


def _bacoor_panapaan() -> dict[str, set[str]]:
    """Bacoor's "Panapaan I–VIII" cluster maps to "P.F. Espiritu I–VIII"
    (renamed in PSGC but kept as a Meralco label). Only Panapaan I has the
    explicit PSGC paren-alias, so add 2–8 manually."""
    return {f"PANAPAAN {i}": {f"PF ESPIRITU {i}"} for i in range(1, 9)}


# CITY_GROUPS: city-internal name clusters. Meralco names a cluster
# ("DAGAT-DAGATAN", "GRACE PARK", "CALOOCAN CITY PROPER", "PASAY CITY PROPER",
# ...); PSGC stores the constituent numbered barangays. Each entry maps the
# Meralco cluster name (already normalized) to the set of PSGC barangay names
# (normalized) that belong to it. A PSGC row whose primary normalized name is
# in any cluster gets that cluster's key appended.
#
# Caloocan sources: en.wikipedia.org/wiki/Caloocan barangay tables (Grace Park
# East/West, Bagong Barrio West/East, Maypajo, Sangandaan, Poblacion clusters),
# en.wikipedia.org/wiki/Bagong_Silang, RA 11993 (Bagong Silang split into
# 176-A..F — this dataset still has the pre-split "Barangay 176").
CITY_GROUPS: dict[str, dict[str, set[str]]] = {
    "CALOOCAN": {
        # Whole 1st District (South Caloocan) — Meralco's "Caloocan City
        # Proper" line covers the historic city, brgys 1–85.
        "CALOOCAN CITY PROPER": _range_brgys(range(1, 86)),
        # South Caloocan named clusters
        "SANGANDAAN": _range_brgys(range(1, 8)),
        "POBLACION": {"BARANGAY 9", "BARANGAY 13", "BARANGAY 15"},
        "DAGAT-DAGATAN": {"BARANGAY 8", "BARANGAY 12", "BARANGAY 14", "BARANGAY 28"},
        "SAMPALUKAN": _range_brgys(range(20, 25)),
        "MAYPAJO": _range_brgys(range(25, 36)),
        # Grace Park straddles both districts: West (38–76) is South Caloocan,
        # East (86–124) is North Caloocan. Meralco's single "GRACE PARK" line
        # should highlight both halves.
        "GRACE PARK": _range_brgys(range(38, 77), range(86, 125)),
        # Bagong Barrio West (132–141) and East (156–164) — both in North.
        "BAGONG BARRIO": _range_brgys(range(132, 142), range(156, 165)),
        # North Caloocan named clusters
        "STA QUITERIA": {"BARANGAY 162"},
        "SANTA QUITERIA": {"BARANGAY 162"},
        "TALIPAPA": {"BARANGAY 164"},
        "KAYBIGA": {"BARANGAY 166"},
        "LLANO": {"BARANGAY 167"},
        "DEPARO": {"BARANGAY 168", "BARANGAY 170"},
        "KABATUHAN": {"BARANGAY 168"},
        "BAGUMBONG": {"BARANGAY 171"},
        "CAMARIN": {"BARANGAY 174", "BARANGAY 175", "BARANGAY 177", "BARANGAY 178"},
        # PSGC still has the pre-2024 "Barangay 176"; RA 11993 split it into
        # 176-A..F. Both Kaliwa/Kanan halves map to the whole 176 polygon for
        # now (no sub-polygon available in this dataset).
        "BAGONG SILANG": {"BARANGAY 176"},
        "BAGONG SILANG - KALIWA": {"BARANGAY 176"},
        "BAGONG SILANG - KANAN": {"BARANGAY 176"},
        "TALA": _range_brgys(range(180, 184)),
    },
    # Pasay's only Meralco label is the city-wide "PASAY CITY PROPER" — every
    # one of the 201 numbered barangays.
    "PASAY": {
        "PASAY CITY PROPER": _range_brgys(range(1, 202)),
    },
    "MALABON": {
        # Geographically Dagat-Dagatan is the Catmon/reclamation strip.
        "DAGAT-DAGATAN": {"CATMON"},
    },
    "NAVOTAS": {
        # On the Navotas side it's the Daanghari + Bangculasi area.
        "DAGAT-DAGATAN": {"DAANGHARI", "BANGCULASI"},
    },
    "MUNTINLUPA": {
        # PSGC still files Ayala-Alabang as "New Alabang Village".
        "AYALA-ALABANG": {"NEW ALABANG VILLAGE"},
    },
    "PARANAQUE": {
        # PSGC has "Marcelo Green Village" (full name); Meralco shortens.
        "MARCELO GREEN": {"MARCELO GREEN VILLAGE"},
    },
    "MANDALUYONG": {
        # PSGC has "Wack-Wack Greenhills" only; Meralco appends "East".
        "WACK-WACK GREENHILLS EAST": {"WACK-WACK GREENHILLS"},
    },
    "DASMARINAS": {
        # PSGC has plain "Burol" plus numbered Burol 1/2/3.
        "BUROL MAIN": {"BUROL"},
    },
    "SAN PEDRO": {
        # PSGC suffixes with "Village".
        "SAMPAGUITA": {"SAMPAGUITA VILLAGE"},
    },
    "MALOLOS": {
        # Meralco compounds two adjacent area names.
        "MAUNLAD-MOJON": {"MOJON"},
    },
    "CALAMBA": {
        # Meralco uses the English "OUT" for PSGC's Tagalog "LABAS".
        "MAJADA OUT": {"MAJADA LABAS"},
    },
    "TRECE MARTIRES": {
        # PSGC truncates the historical "Hugo Perez" to just "Perez".
        "HUGO PEREZ": {"PEREZ"},
    },
    "TAGUIG": {
        # PSGC has Central/North/South Signal Village as three separate
        # barangays; Meralco's "SIGNAL VILLAGE" line covers all three.
        "SIGNAL VILLAGE": {
            "CENTRAL SIGNAL VILLAGE",
            "NORTH SIGNAL VILLAGE",
            "SOUTH SIGNAL VILLAGE",
        },
    },
    "BACOOR": _bacoor_panapaan(),
    # Las Piñas: Meralco lists "LAS PIÑAS CITY PROPER" as a catch-all for
    # barangays not split by name (rare). Map it to every Las Piñas brgy.
    "LAS PINAS": {
        "LAS PINAS CITY PROPER": {
            "ALMANZA UNO", "ALMANZA DOS", "ALMANZA 1", "ALMANZA 2",
            "B F INTERNATIONAL VILLAGE", "BF INTERNATIONAL VILLAGE",
            "DANIEL FAJARDO", "ELIAS ALDANA", "ILAYA",
            "MANUYO UNO", "MANUYO DOS", "MANUYO 1", "MANUYO 2",
            "PAMPLONA UNO", "PAMPLONA DOS", "PAMPLONA TRES",
            "PAMPLONA 1", "PAMPLONA 2", "PAMPLONA 3",
            "PILAR",
            "PULANGLUPA UNO", "PULANGLUPA DOS", "PULANGLUPA 1", "PULANGLUPA 2",
            "PULANG LUPA UNO", "PULANG LUPA DOS",
            "TALON UNO", "TALON DOS", "TALON TRES", "TALON KUATRO", "TALON SINGKO",
            "TALON 1", "TALON 2", "TALON 3", "TALON 4", "TALON 5",
            "ZAPOTE",
        },
    },
}

# City-wide aliases: Meralco labels that mean "the whole city". Every PSGC
# barangay in the city gets these as extra keys, on top of the implicit
# "<CITY> CITY PROPER" / "<CITY> TOWN PROPER" auto-aliases generated for
# every barangay in build_match_keys (skipped if CITY_GROUPS already defines
# them, so the Caloocan 1-85 scope stays correct).
CITY_WIDE_ALIASES: dict[str, set[str]] = {
    # Meralco's "GENERAL TRIAS" under "GENERAL TRIAS CITY" -> entire GT.
    "GENERAL TRIAS": {"GENERAL TRIAS"},
    # Meralco hyphenates the city name with "Poblacion" as a city-wide label.
    "CARMONA": {"CARMONA-POBLACION"},
}

# Cross-city transfers: PSGC still files these barangays under Makati but the
# 2023 RA 11871 transferred them to Taguig. Meralco lists them under Taguig.
# For each (psgc_city, brgy), also emit a Taguig-keyed match key.
CITY_TRANSFERS: dict[tuple[str, str], list[str]] = {
    ("MAKATI", "CEMBO"): ["TAGUIG"],
    ("MAKATI", "COMEMBO"): ["TAGUIG"],
    ("MAKATI", "EAST REMBO"): ["TAGUIG"],
    ("MAKATI", "PEMBO"): ["TAGUIG"],
    ("MAKATI", "PITOGO"): ["TAGUIG"],
    ("MAKATI", "POST PROPER NORTHSIDE"): ["TAGUIG"],
    ("MAKATI", "POST PROPER SOUTHSIDE"): ["TAGUIG"],
    ("MAKATI", "RIZAL"): ["TAGUIG"],
    ("MAKATI", "SOUTH CEMBO"): ["TAGUIG"],
    ("MAKATI", "WEST REMBO"): ["TAGUIG"],
}


def _to_ascii_upper(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    ascii_only = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    return APOSTROPHE_RE.sub("", ascii_only).upper()


def _collapse_initials(value: str) -> str:
    def repl(m: re.Match[str]) -> str:
        a, b, c = m.group(1), m.group(2), m.group(3)
        return a + b + (c or "") + " "
    return INITIALS_RUN_RE.sub(repl, value)


def _pre_normalize(upper: str) -> str:
    # Drop QC-style "-PROJ N" district suffix dangling at the end.
    out = re.sub(r"[-\s]+PROJ(?:ECT)?\.?\s*\d+\s*$", "", upper, flags=re.IGNORECASE)
    out = _collapse_initials(out)
    # Replace internal periods with spaces ("STA.MESA" -> "STA MESA").
    out = out.replace(".", " ")
    out = SPACE_RE.sub(" ", out).strip()
    return out


def _tokens(value: str) -> list[str]:
    no_parens = PAREN_RE.sub(" ", value)
    pre = _pre_normalize(no_parens)
    out: list[str] = []
    for raw in pre.split():
        token = raw.strip(".,;:'\"")
        if not token:
            continue
        ord_m = ORDINAL_SUFFIX_RE.match(token)
        if ord_m:
            token = ord_m.group(1)
        replacement = ABBREV.get(token)
        if replacement is None:
            out.append(token)
        elif replacement:
            out.append(replacement)
    # Merge consecutive single letters: ["N","S","AMORANTO"] -> ["NS","AMORANTO"].
    merged: list[str] = []
    buf = ""
    for t in out:
        if len(t) == 1 and "A" <= t <= "Z":
            buf += t
        else:
            if buf:
                merged.append(buf)
                buf = ""
            merged.append(t)
    if buf:
        merged.append(buf)
    return merged


def _roman_to_int(token: str) -> int | None:
    if not token or not ROMAN_RE.fullmatch(token):
        return None
    total = 0
    prev = 0
    for ch in reversed(token):
        v = ROMAN_VALUES[ch]
        total = total - v if v < prev else total + v
        prev = v
    return total


def _convert_numeral(token: str) -> str:
    """Convert Roman/Spanish numerals to Arabic.

    Handles plain Roman ("III"), plain Spanish ("Uno"), and hyphenated
    forms ("II-A"). Applied at every token position so embedded numerals
    ("MAITIM II EAST") normalize the same as tail ones.
    """
    if token in SPANISH_NUMERALS:
        return SPANISH_NUMERALS[token]
    parts = token.split("-")
    changed = False
    out: list[str] = []
    for p in parts:
        n = _roman_to_int(p)
        if n is not None:
            out.append(str(n))
            changed = True
            continue
        if p in SPANISH_NUMERALS:
            out.append(SPANISH_NUMERALS[p])
            changed = True
            continue
        out.append(p)
    return "-".join(out) if changed else token


def _apply_phrase_rewrites(value: str) -> str:
    for pattern, repl in PHRASE_REWRITES:
        value = pattern.sub(repl, value)
    return value


def normalize_city(value: object) -> str:
    if not isinstance(value, str):
        return ""
    upper = _to_ascii_upper(value)
    tokens = _tokens(upper)
    if not tokens:
        return ""
    if tokens[0] == "CITY" and len(tokens) > 1 and tokens[1] == "OF":
        tokens = tokens[2:]
    elif tokens[-1] == "CITY":
        tokens = tokens[:-1]
    return _apply_phrase_rewrites(SPACE_RE.sub(" ", " ".join(tokens)).strip())


def _normalize_brgy_single(value: str) -> str:
    upper = _to_ascii_upper(value)
    tokens = _tokens(upper)
    if not tokens:
        return ""
    # "<CITY> CITY PROPER" / "<CITY> TOWN PROPER" stay intact so they match the
    # city-wide auto-aliases the parquet emits for every barangay.
    converted = [_convert_numeral(t) for t in tokens]
    return _apply_phrase_rewrites(SPACE_RE.sub(" ", " ".join(converted)).strip())


def normalize_brgy(value: object) -> str:
    """Primary normalization. For "/"-joined Meralco forms, use the first
    segment so the existing single-string contract still holds; the build-time
    parquet writer uses paren+group expansion to add additional alias keys."""
    if not isinstance(value, str):
        return ""
    head = value.split("/", 1)[0] if "/" in value else value
    return _normalize_brgy_single(head)


def normalize_brgy_variants(value: object) -> list[str]:
    """All normalized variants for the value (handles "/"-joined Meralco
    forms and parenthetical alias hints like "PULO NI SARA (PANTIHAN 4)")."""
    if not isinstance(value, str):
        return []
    seen: list[str] = []
    used: set[str] = set()
    for segment in (value.split("/") if "/" in value else [value]):
        s = segment.strip()
        if not s:
            continue
        n = _normalize_brgy_single(s)
        if n and n not in used:
            used.add(n)
            seen.append(n)
        for inner in PAREN_CAPTURE_RE.findall(s):
            inner = inner.strip()
            if not inner:
                continue
            nn = _normalize_brgy_single(inner)
            if nn and nn not in used:
                used.add(nn)
                seen.append(nn)
    return seen


def _paren_aliases(value: str) -> list[str]:
    """Extra normalized aliases extracted from parenthetical asides.

    PSGC writes "Tañong (Pob.)", "Central Signal Village (Signal Village)",
    "Tanyag (Bagong Tanyag)" — the paren content is usually a Meralco-friendly
    alias that should also light up the polygon.
    """
    out: list[str] = []
    for inner in PAREN_CAPTURE_RE.findall(value):
        inner = inner.strip()
        if not inner:
            continue
        norm = _normalize_brgy_single(inner)
        if norm and norm not in out:
            out.append(norm)
    return out


def build_match_keys(adm1_en: str, adm3_en: str, adm4_en: str) -> list[str]:
    city = normalize_city(adm3_en)
    primary = normalize_brgy(adm4_en)
    keys: list[str] = []
    seen: set[str] = set()

    def add(c: str, b: str) -> None:
        if not c or not b:
            return
        k = f"{c}|{b}"
        if k not in seen:
            seen.add(k)
            keys.append(k)

    if city and primary:
        add(city, primary)
        # Paren-extracted aliases (Pob., Signal Village, Bagong Tanyag, ...).
        for alias in _paren_aliases(adm4_en) if isinstance(adm4_en, str) else []:
            add(city, alias)
        # Auto city-wide aliases: "<CITY> CITY PROPER" / "TOWN PROPER" on
        # every barangay, unless CITY_GROUPS explicitly defines the same name
        # (so Caloocan's 1-85 scope stays correct).
        explicit_group_names = set(CITY_GROUPS.get(city, {}).keys())
        for auto_name in (f"{city} CITY PROPER", f"{city} TOWN PROPER"):
            if auto_name not in explicit_group_names:
                add(city, auto_name)
        # Other city-wide aliases (e.g. plain "GENERAL TRIAS").
        for alias in CITY_WIDE_ALIASES.get(city, ()):
            add(city, alias)
        # City-internal cluster groups (Caloocan/Pasay/Las Piñas/etc).
        for group_name, members in CITY_GROUPS.get(city, {}).items():
            if primary in members:
                add(city, group_name)
        # Cross-city transfers (EMBO 10: PSGC says Makati, Meralco says Taguig).
        for alt_city in CITY_TRANSFERS.get((city, primary), ()):
            add(alt_city, primary)

    # Manila districts: also expose the parent zone key so a scraped
    # MANILA / BINONDO line highlights every numbered barangay in Binondo.
    if isinstance(adm1_en, str) and "NCR" in adm1_en.upper():
        zone = MANILA_DISTRICTS.get(adm3_en)
        if zone:
            add("MANILA", zone)
        # Manila sub-zones (Sta. Mesa under Sampaloc).
        sub_zones = MANILA_SUB_ZONES.get(city, {})
        for sub_name, members in sub_zones.items():
            if primary in members:
                add("MANILA", sub_name)
    return keys


def main() -> None:
    files = sorted(RAW_DIR.glob("*.json"))
    if not files:
        raise SystemExit(f"No GeoJSON files found in {RAW_DIR}")

    print(f"Reading {len(files)} GeoJSON files...")
    frames = [gpd.read_file(f) for f in files]
    gdf = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs=frames[0].crs)
    print(f"Combined: {len(gdf)} barangays, CRS={gdf.crs}")

    gdf["city_norm"] = gdf["ADM3_EN"].map(normalize_city)
    gdf["barangay_norm"] = gdf["ADM4_EN"].map(normalize_brgy)
    gdf["match_keys"] = [
        build_match_keys(a1, a3, a4)
        for a1, a3, a4 in zip(gdf["ADM1_EN"], gdf["ADM3_EN"], gdf["ADM4_EN"])
    ]

    flat = [k for ks in gdf["match_keys"] for k in ks]
    print(f"Columns: {list(gdf.columns)}")
    print(f"Total match keys: {len(flat)} ({len(set(flat))} unique)")

    # Write as plain Parquet (not GeoParquet): geometry becomes a raw Binary
    # column with no `geoarrow.wkb` Arrow extension metadata. DuckDB-WASM lacks
    # the spatial extension by default; with the extension metadata present it
    # auto-promotes the column to GEOMETRY and SELECT geometry fails. Stripping
    # the metadata keeps the column as BLOB on both ends.
    df = pd.DataFrame(gdf.drop(columns="geometry"))
    df["geometry"] = gdf.geometry.to_wkb()
    df.to_parquet(OUTPUT, compression="zstd", index=False)
    size_mb = OUTPUT.stat().st_size / (1024 * 1024)
    print(f"Wrote {OUTPUT.relative_to(ROOT)} ({size_mb:.2f} MB)")


if __name__ == "__main__":
    main()
