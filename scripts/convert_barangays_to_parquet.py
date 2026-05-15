"""Combine downloaded barangay GeoJSONs into a single GeoParquet file.

Adds a `match_keys` list column so the browser can filter polygons against the
scraped Meralco schedule, which only carries names. Normalization handles the
known shape mismatches between Meralco's wording and PSGC:

* Province is dropped from the key — Meralco says "METRO MANILA" but PSGC splits
  NCR into four districts plus the City of Manila. (city, barangay) is unique
  enough across the Meralco franchise area.
* City: "CITY OF MAKATI" / "MAKATI CITY" both normalize to "MAKATI".
* Barangay: Roman numerals at the tail of the name normalize to Arabic
  ("Bunsuran III" -> "BUNSURAN 3"); diacritics stripped; "X TOWN PROPER" maps
  to "POBLACION"; parenthetical asides are dropped.
* Manila zones: PSGC stores Binondo/Tondo/Sampaloc/etc as ADM3-level districts
  whose barangays are numbered ("Barangay 287"). Meralco publishes by zone
  name. So every polygon in a Manila district also gets the zone key
  "MANILA|<DISTRICT>" so a single Meralco line like "MANILA -> BINONDO"
  highlights the whole district.

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
    "MT": "MOUNT",
    "GEN": "GENERAL",
    "PRES": "PRESIDENT",
    "BRGY": "",
    "BARANGAY": "BARANGAY",
}

ROMAN_VALUES = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
ROMAN_RE = re.compile(
    r"^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$"
)
PAREN_RE = re.compile(r"\([^)]*\)")
SPACE_RE = re.compile(r"\s+")

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


def _to_ascii_upper(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    ascii_only = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    return ascii_only.upper()


def _tokens(value: str) -> list[str]:
    no_parens = PAREN_RE.sub(" ", value)
    out: list[str] = []
    for raw in no_parens.split():
        token = raw.strip(".,;:'\"")
        if not token:
            continue
        replacement = ABBREV.get(token)
        if replacement is None:
            out.append(token)
        elif replacement:
            out.append(replacement)
    return out


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


def _convert_roman_tail(token: str) -> str:
    """Convert Roman numerals appearing as standalone parts of the last token.

    Handles plain ("III") and hyphenated ("II-A") tail tokens. Standalone "I"
    is left alone since it collides with too many real names.
    """
    parts = token.split("-")
    changed = False
    out: list[str] = []
    for p in parts:
        n = _roman_to_int(p)
        if n is not None:
            out.append(str(n))
            changed = True
        else:
            out.append(p)
    return "-".join(out) if changed else token


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
    return SPACE_RE.sub(" ", " ".join(tokens)).strip()


def normalize_brgy(value: object) -> str:
    if not isinstance(value, str):
        return ""
    upper = _to_ascii_upper(value)
    tokens = _tokens(upper)
    if not tokens:
        return ""
    if len(tokens) >= 2 and tokens[-2:] == ["TOWN", "PROPER"]:
        return "POBLACION"
    tokens[-1] = _convert_roman_tail(tokens[-1])
    return SPACE_RE.sub(" ", " ".join(tokens)).strip()


def build_match_keys(adm1_en: str, adm3_en: str, adm4_en: str) -> list[str]:
    city = normalize_city(adm3_en)
    brgy = normalize_brgy(adm4_en)
    keys: list[str] = []
    if city and brgy:
        keys.append(f"{city}|{brgy}")
    # Manila districts: also expose the parent zone key so a scraped
    # MANILA / BINONDO line highlights every numbered barangay in Binondo.
    if isinstance(adm1_en, str) and "NCR" in adm1_en.upper():
        zone = MANILA_DISTRICTS.get(adm3_en)
        if zone:
            keys.append(f"MANILA|{zone}")
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
