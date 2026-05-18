"""Scrape Meralco's maintenance schedule into JSON for the /maintenance map.

Source: https://company.meralco.com.ph/news-and-advisories/maintenance-schedule

The page is a Drupal view paginated with infinite-scroll: each `?page=N`
contains two entries. Pages are sorted newest-first. The view shows future
maintenance announcements that gradually age into the past; we walk from
page 0 forward and stop once we've seen enough older entries to be confident
we've captured the upcoming window.

For each entry we capture:
    - dates (handles "May 24, 2026" and "May 22 - 23, 2026" multi-day forms)
    - city, barangays (parsed from the title's "City (B1 And B2)" parenthesis)
    - time windows ("BETWEEN 8:30AM AND 9:00AM AND THEN BETWEEN ..." etc.)
    - body description and reason
    - source URL slug

For each (city, barangay) pair we attach a representative lat/lng. The first
choice is a polygon centroid from public/data/barangays/barangays.parquet
(same dataset that powers the brownout map's match_keys), which means
addresses inside Meralco's franchise area never need an external API. Anything
the parquet doesn't cover falls back to Nominatim, with results cached in
public/data/maintenance/geocode-cache.json so repeated runs only pay the
Nominatim cost for genuinely new combinations.

Outputs:
    public/data/maintenance/all.json
    public/data/maintenance/latest.json
    public/data/maintenance/geocode-cache.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup, Tag

# Reuse normalize helpers so the same (city, barangay) -> key mapping
# the parquet was built with also drives our centroid lookups.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from convert_barangays_to_parquet import (  # noqa: E402
    normalize_brgy_variants,
    normalize_city,
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PARQUET_PATH = PROJECT_ROOT / "public" / "data" / "barangays" / "barangays.parquet"
OUT_DIR = PROJECT_ROOT / "public" / "data" / "maintenance"
GEOCODE_CACHE_PATH = OUT_DIR / "geocode-cache.json"

BASE_URL = "https://company.meralco.com.ph/news-and-advisories/maintenance-schedule"
ENTRY_URL_PREFIX = "https://company.meralco.com.ph/news-and-advisories/maintenance-schedule/"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
# Nominatim's usage policy requires identification and 1 req/sec.
NOMINATIM_USER_AGENT = "meralco-brownout-map/maintenance-scraper (github.com/IsaacEnage)"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_DELAY_SEC = 1.1

MONTHS: dict[str, int] = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7, "aug": 8,
    "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}

# "May 24, 2026", "May 22 - 23, 2026", "April 29-30, 2026"
DATE_RANGE_RE = re.compile(
    r"\b(?P<m1>[A-Za-z]+)\s+(?P<d1>\d{1,2})"
    r"(?:\s*[-–]\s*(?:(?P<m2>[A-Za-z]+)\s+)?(?P<d2>\d{1,2}))?"
    r",\s*(?P<y>\d{4})",
)

# "BETWEEN 8:30AM AND 9:00AM" / "BETWEEN 11:00PM (FRI., 05/22/26) AND 5:00AM (SAT., 05/23/26)"
TIME_RANGE_RE = re.compile(
    r"BETWEEN\s+(?P<h1>\d{1,2}):(?P<min1>\d{2})\s*(?P<mer1>AM|PM)"
    r"(?:\s*\([^)]*\))?"
    r"\s+AND\s+(?P<h2>\d{1,2}):(?P<min2>\d{2})\s*(?P<mer2>AM|PM)"
    r"(?:\s*\([^)]*\))?",
    re.IGNORECASE,
)

CIRCUIT_RE = re.compile(r"CIRCUIT\s+([A-Z0-9 .\-/]+?)(?=\s*$|\s*[.,;])", re.IGNORECASE)


@dataclass
class TimeRange:
    start: str  # "HH:MM" 24h
    end: str


@dataclass
class MaintenanceWindow:
    label: str
    ranges: list[TimeRange] = field(default_factory=list)
    circuit: str | None = None
    description: str = ""


@dataclass
class GeoPoint:
    barangay: str
    city: str
    lat: float
    lng: float
    source: str  # "parquet" | "nominatim"


# Meralco's loc filter has these as single-option "areas" that cover the whole
# province; entries titled with these put the actual city/municipality inside
# the title's parenthesis. Anything not in this set is treated as a city.
PROVINCE_AREAS: set[str] = {
    "BATANGAS",
    "BULACAN",
    "CAVITE",
    "LAGUNA",
    "PAMPANGA",
    "QUEZON PROVINCE",
    "RIZAL",
}


@dataclass
class MaintenanceEntry:
    slug: str
    url: str
    title: str
    dates: list[str]  # ISO YYYY-MM-DD, one per affected day
    area: str  # left-of-paren in the title (a city or a province)
    is_province: bool
    locations: list[str]  # paren contents — barangays if !is_province, else cities
    windows: list[MaintenanceWindow]
    reason: str | None
    points: list[GeoPoint]

    @property
    def city(self) -> str:
        """Best-effort city label for display. When area is a province, fall
        back to the first paren entry (typically the affected city)."""
        if self.is_province and self.locations:
            return self.locations[0]
        return self.area

    @property
    def barangays(self) -> list[str]:
        return [] if self.is_province else list(self.locations)


# ---------- HTTP ----------

def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": (
            "text/html,application/xhtml+xml,application/xml;q=0.9,"
            "image/webp,*/*;q=0.8"
        ),
        "Accept-Language": "en-US,en;q=0.9",
    })
    return s


def fetch_listing(session: requests.Session, page: int) -> str:
    url = BASE_URL if page == 0 else f"{BASE_URL}?page={page}"
    res = session.get(url, timeout=30)
    res.raise_for_status()
    return res.text


# ---------- Parsing ----------

def parse_listing(html: str) -> tuple[list[Tag], bool]:
    """Return (entry_items, has_next_page)."""
    soup = BeautifulSoup(html, "html.parser")
    # The grid wraps each page's pair of entries in one `.row.views-row`, with
    # individual entries as `.item .inner` children. Selecting `.views-row .inner`
    # gives one element per actual entry.
    items = soup.select(".views-element-container .views-row .inner")
    has_next = soup.select_one(".js-pager__items a.load-more") is not None
    return items, has_next


def parse_title(title: str) -> tuple[list[str], str, list[str]]:
    """Split a title like 'May 24, 2026 - Manila (Paco And Ermita)' into
    (iso_dates, area, locations). `area` is the left-of-paren label (a city or
    a province); `locations` is the comma/'And'-separated parenthesized list."""
    iso_dates = parse_dates_from_text(title)

    # Strip the date portion so what's left is "<Area> (<Locations>)".
    rest = re.sub(
        r"^[A-Za-z]+\s+\d{1,2}(?:\s*[-–]\s*(?:[A-Za-z]+\s+)?\d{1,2})?,\s*\d{4}\s*[-–]\s*",
        "",
        title,
    ).strip()

    area = ""
    locations: list[str] = []
    paren = re.search(r"^(?P<area>[^()]+?)\s*\((?P<locs>[^)]+)\)\s*$", rest)
    if paren:
        area = paren.group("area").strip()
        raw = paren.group("locs")
        for part in re.split(
            r"\s*[,;]\s*(?:and\s+)?|\s+And\s+|\s+&\s+",
            raw,
            flags=re.IGNORECASE,
        ):
            part = part.strip().strip(";,. ")
            # Catch a leading "And " that survived an unusual separator combo.
            part = re.sub(r"^And\s+", "", part, flags=re.IGNORECASE)
            if part:
                locations.append(part)
    else:
        area = rest
    return iso_dates, area, locations


def parse_dates_from_text(text: str) -> list[str]:
    """Extract every date in text. 'May 22 - 23, 2026' expands to both days."""
    out: list[str] = []
    for m in DATE_RANGE_RE.finditer(text):
        year = int(m.group("y"))
        m1 = MONTHS.get(m.group("m1").lower())
        if not m1:
            continue
        d1 = int(m.group("d1"))
        d2_raw = m.group("d2")
        if d2_raw is None:
            try:
                iso = date(year, m1, d1).isoformat()
            except ValueError:
                continue
            if iso not in out:
                out.append(iso)
            continue
        m2 = MONTHS.get((m.group("m2") or m.group("m1")).lower())
        if not m2:
            continue
        d2 = int(d2_raw)
        try:
            cur = date(year, m1, d1)
            end = date(year, m2, d2)
        except ValueError:
            continue
        if end < cur:
            cur, end = end, cur
        while cur <= end:
            iso = cur.isoformat()
            if iso not in out:
                out.append(iso)
            cur += timedelta(days=1)
    return out


def to_24h(hour: int, minute: int, meridiem: str) -> str:
    h = hour % 12
    if meridiem.upper() == "PM":
        h += 12
    return f"{h:02d}:{minute:02d}"


def parse_windows(body_node: Tag) -> list[MaintenanceWindow]:
    """The body is an HTML blob: <strong>HEADER (with BETWEEN x AND y)</strong>
    followed by lines of address descriptions, repeated per window.

    We walk the body's contents in order, building a window every time we see
    a <strong> header that contains BETWEEN ... AND ...; everything between
    that and the next header (or end-of-body) is the description."""

    # The body is typically a single <p> with inline <strong> headers and <br>
    # separators between description lines. Walk the descendants in document
    # order and group by <strong> boundaries.
    container = body_node
    inner_p = container.find("p")
    if inner_p is not None:
        container = inner_p

    # Convert <br> to newlines once for clean splitting.
    for br in container.find_all("br"):
        br.replace_with("\n")

    segments: list[tuple[str, str]] = []  # (kind, text); kind in {"header","line"}
    buf: list[str] = []

    def push_buf() -> None:
        if not buf:
            return
        text = "".join(buf).replace("\xa0", " ")
        for line in text.split("\n"):
            stripped = line.strip()
            if stripped:
                segments.append(("line", stripped))
        buf.clear()

    for child in container.children:
        if isinstance(child, Tag) and child.name == "strong":
            push_buf()
            header_text = child.get_text(" ", strip=True).replace("\xa0", " ")
            if TIME_RANGE_RE.search(header_text):
                segments.append(("header", header_text))
            else:
                # Non-time <strong>: treat as inline emphasis inline.
                buf.append(child.get_text(" ", strip=True))
        elif isinstance(child, Tag):
            buf.append(child.get_text(" ", strip=False))
        else:
            buf.append(str(child))
    push_buf()

    windows: list[MaintenanceWindow] = []
    current: MaintenanceWindow | None = None
    desc_lines: list[str] = []

    def commit() -> None:
        nonlocal current
        if current is not None:
            current.description = "\n".join(desc_lines).strip()
            windows.append(current)
        desc_lines.clear()

    for kind, text in segments:
        if kind == "header":
            commit()
            ranges = [
                TimeRange(
                    start=to_24h(int(m.group("h1")), int(m.group("min1")), m.group("mer1")),
                    end=to_24h(int(m.group("h2")), int(m.group("min2")), m.group("mer2")),
                )
                for m in TIME_RANGE_RE.finditer(text)
            ]
            circuit_m = CIRCUIT_RE.search(text)
            circuit = circuit_m.group(1).strip() if circuit_m else None
            current = MaintenanceWindow(label=text, ranges=ranges, circuit=circuit)
        else:
            if current is None:
                current = MaintenanceWindow(
                    label="Maintenance schedule", ranges=[], circuit=None,
                )
            desc_lines.append(text)
    commit()
    return windows


def parse_entry(row: Tag) -> MaintenanceEntry | None:
    title_a = row.select_one(".views-field-title a")
    if title_a is None:
        return None
    title = title_a.get_text(" ", strip=True)
    href = (title_a.get("href") or "").strip()
    slug = ""
    if href.startswith(ENTRY_URL_PREFIX):
        slug = href[len(ENTRY_URL_PREFIX):].strip("/")
    elif "/maintenance-schedule/" in href:
        slug = href.rsplit("/maintenance-schedule/", 1)[1].strip("/")
    if not slug:
        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")

    dates, area, locations = parse_title(title)
    area_key = re.sub(r"\s+PROVINCE$", "", area.upper()).strip()
    is_province = area_key in PROVINCE_AREAS or area.upper().endswith(" PROVINCE")

    body_field = row.select_one(".views-field-body .field-content")
    windows: list[MaintenanceWindow] = []
    if body_field is not None:
        windows = parse_windows(body_field)

    reason_node = row.select_one(".views-field-field-reason .alert")
    reason: str | None = None
    if reason_node is not None:
        reason_text = reason_node.get_text(" ", strip=True)
        reason_text = re.sub(r"^REASON\s*:\s*", "", reason_text, flags=re.IGNORECASE)
        reason = reason_text.strip() or None

    return MaintenanceEntry(
        slug=slug,
        url=href if href else f"{ENTRY_URL_PREFIX}{slug}",
        title=title,
        dates=dates,
        area=area,
        is_province=is_province,
        locations=locations,
        windows=windows,
        reason=reason,
        points=[],
    )


# ---------- Geocoding ----------

def load_geocode_cache() -> dict[str, GeoPoint]:
    if not GEOCODE_CACHE_PATH.exists():
        return {}
    try:
        raw = json.loads(GEOCODE_CACHE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    out: dict[str, GeoPoint] = {}
    for key, value in raw.items():
        try:
            out[key] = GeoPoint(
                barangay=value["barangay"],
                city=value["city"],
                lat=float(value["lat"]),
                lng=float(value["lng"]),
                source=value.get("source", "cache"),
            )
        except (KeyError, TypeError, ValueError):
            continue
    return out


def save_geocode_cache(cache: dict[str, GeoPoint]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    serializable = {
        k: {
            "barangay": v.barangay,
            "city": v.city,
            "lat": v.lat,
            "lng": v.lng,
            "source": v.source,
        }
        for k, v in cache.items()
    }
    GEOCODE_CACHE_PATH.write_text(
        json.dumps(serializable, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )


# Candidate ADM3_EN values for a Meralco-style area name. PSGC writes
# component cities as "CITY OF X" (or "X CITY"), highly-urbanized cities as
# "X CITY", and municipalities as bare "X". A "(Capital)" suffix decorates the
# provincial capital. We generate every reasonable variant so that one of them
# matches what's actually in the parquet.
def _city_adm3_candidates(area: str) -> list[str]:
    if not area:
        return []
    upper = area.strip().upper()
    # Normalize via normalize_city to expand abbreviations (STA. -> SANTA, etc.)
    # while also keeping the raw input so PSGC's "(Capital)" / "City of X" forms
    # still match. normalize_city strips trailing CITY, so we re-derive it.
    normalized = normalize_city(area)
    bases: list[str] = []
    has_city_raw = bool(re.search(r"\bCITY\b", upper))
    for base in (normalized, re.sub(r"^CITY OF\s+", "", re.sub(r"\s+CITY$", "", upper)).strip()):
        base = re.sub(r"\s*\(\s*CAPITAL\s*\)\s*$", "", base).strip()
        if base and base not in bases:
            bases.append(base)

    variants: list[str] = []
    for base in bases:
        forms = [
            f"{base} CITY",
            f"CITY OF {base}",
            f"{base} CITY (CAPITAL)",
            f"CITY OF {base} (CAPITAL)",
        ]
        if not has_city_raw:
            # Caller didn't say "City", so the bare municipality is fine.
            forms = [base] + forms
        for v in forms:
            if v not in variants:
                variants.append(v)
    return variants


# ADM3_EN names for the City of Manila districts. Used to compute a city-wide
# centroid for entries whose area is "Manila" (Manila has no ADM3='MANILA').
MANILA_ADM3_DISTRICTS: list[str] = [
    "BINONDO", "ERMITA", "INTRAMUROS", "MALATE", "PACO", "PANDACAN",
    "PORT AREA", "QUIAPO", "SAMPALOC", "SAN MIGUEL", "SAN NICOLAS",
    "SANTA ANA", "SANTA CRUZ", "TONDO I / II",
]


@dataclass
class ParquetLookup:
    by_keys: "callable"  # (list[str]) -> (lat, lng) | None
    by_city: "callable"  # (area, *, province=None) -> (lat, lng) | None


def open_parquet_lookup() -> ParquetLookup | None:
    if not PARQUET_PATH.exists():
        return None
    try:
        import duckdb  # type: ignore
    except ImportError:
        print("  ! duckdb not installed; skipping parquet centroid lookup",
              file=sys.stderr)
        return None

    con = duckdb.connect(database=":memory:")
    try:
        con.execute("INSTALL spatial; LOAD spatial;")
    except duckdb.Error as exc:
        print(f"  ! could not load DuckDB spatial extension: {exc}",
              file=sys.stderr)
        return None

    parquet_str = str(PARQUET_PATH).replace("'", "''")
    con.execute(f"""
        CREATE VIEW b AS
        SELECT
            upper(ADM1_EN) AS adm1_en,
            upper(ADM2_EN) AS adm2_en,
            upper(ADM3_EN) AS adm3_en,
            city_norm,
            barangay_norm,
            match_keys,
            ST_Centroid(ST_GeomFromWKB(geometry)) AS centroid
        FROM '{parquet_str}'
    """)

    def by_keys(keys: list[str]) -> tuple[float, float] | None:
        if not keys:
            return None
        rows = con.execute(
            """
            SELECT AVG(ST_Y(centroid)), AVG(ST_X(centroid))
            FROM b
            WHERE list_has_any(match_keys, ?)
            """,
            [keys],
        ).fetchone()
        if not rows or rows[0] is None:
            return None
        return float(rows[0]), float(rows[1])

    def by_city(area: str, *, province: str | None = None) -> tuple[float, float] | None:
        if not area:
            return None
        upper_area = area.strip().upper()
        # Manila is split across ADM3 districts.
        if upper_area == "MANILA":
            rows = con.execute(
                """
                SELECT AVG(ST_Y(centroid)), AVG(ST_X(centroid))
                FROM b
                WHERE adm3_en IN ?
                """,
                [MANILA_ADM3_DISTRICTS],
            ).fetchone()
            if rows and rows[0] is not None:
                return float(rows[0]), float(rows[1])
            return None

        candidates = _city_adm3_candidates(area)
        if not candidates:
            return None
        province_upper = province.strip().upper() if province else None

        # When a province scope is known, ambiguity with NCR/QC is impossible,
        # so the bare municipality form is safe to accept too.
        if province_upper:
            normalized = normalize_city(area)
            for v in (normalized, re.sub(r"\s+CITY$", "", area.strip().upper())):
                v = v.strip()
                if v and v not in candidates:
                    candidates.append(v)

        # Exact ADM3_EN match first.
        params: list = [candidates]
        sql = (
            "SELECT AVG(ST_Y(centroid)), AVG(ST_X(centroid)) FROM b "
            "WHERE adm3_en IN ?"
        )
        if province_upper:
            sql += " AND adm2_en = ?"
            params.append(province_upper)
        rows = con.execute(sql, params).fetchone()
        if rows and rows[0] is not None:
            return float(rows[0]), float(rows[1])

        # Prefix match: catches PSGC quirks like "MENDEZ (MENDEZ-NUNEZ)" where
        # the canonical name is followed by a parenthetical alias. Also handle
        # hyphenated Meralco names like "Mendez - Nunez" by trying the first
        # word as a prefix.
        prefix_candidates: list[str] = list(candidates)
        first_word = re.split(r"[\s\-]+", candidates[0])[0] if candidates else ""
        if first_word and len(first_word) >= 4 and first_word not in prefix_candidates:
            prefix_candidates.append(first_word)
        for cand in prefix_candidates:
            prefix_params: list = [f"{cand}%"]
            prefix_sql = (
                "SELECT AVG(ST_Y(centroid)), AVG(ST_X(centroid)) FROM b "
                "WHERE adm3_en LIKE ?"
            )
            if province_upper:
                prefix_sql += " AND adm2_en = ?"
                prefix_params.append(province_upper)
            rows = con.execute(prefix_sql, prefix_params).fetchone()
            if rows and rows[0] is not None:
                return float(rows[0]), float(rows[1])
        return None

    return ParquetLookup(by_keys=by_keys, by_city=by_city)


def nominatim_geocode(session: requests.Session, query: str) -> tuple[float, float] | None:
    """Forward-geocode `query` via Nominatim. Returns (lat, lng) or None."""
    try:
        res = session.get(
            NOMINATIM_URL,
            params={"q": query, "format": "jsonv2", "limit": 1, "countrycodes": "ph"},
            headers={"User-Agent": NOMINATIM_USER_AGENT},
            timeout=20,
        )
        res.raise_for_status()
    except requests.RequestException as exc:
        print(f"  ! Nominatim error for '{query}': {exc}", file=sys.stderr)
        return None
    data = res.json()
    if not data:
        return None
    try:
        return float(data[0]["lat"]), float(data[0]["lon"])
    except (KeyError, ValueError, TypeError):
        return None


def resolve_points(
    entries: list[MaintenanceEntry],
    cache: dict[str, GeoPoint],
    *,
    use_nominatim: bool,
    session: requests.Session,
) -> None:
    parquet = open_parquet_lookup()
    stats = {"parquet_brgy": 0, "parquet_city": 0, "nominatim": 0, "miss": 0}
    last_nominatim_call = [0.0]

    def nominatim_throttle() -> None:
        wait = NOMINATIM_DELAY_SEC - (time.monotonic() - last_nominatim_call[0])
        if wait > 0:
            time.sleep(wait)
        last_nominatim_call[0] = time.monotonic()

    def resolve_one(
        *, area: str, location: str, is_province: bool,
    ) -> tuple[tuple[float, float] | None, str]:
        """Return ((lat, lng), source) or (None, '') if unresolved."""
        # When the area is a province, the parens hold a city, not a barangay.
        if is_province:
            province = re.sub(r"\s+PROVINCE$", "", area, flags=re.IGNORECASE).strip()
            if parquet is not None:
                point = parquet.by_city(location, province=province)
                if point is not None:
                    return point, "parquet"
            if use_nominatim:
                nominatim_throttle()
                point = nominatim_geocode(
                    session, f"{location}, {area}, Philippines",
                )
                if point is not None:
                    return point, "nominatim"
            return None, ""

        # Otherwise it's a barangay inside a city.
        city_norm = normalize_city(area)
        variants = normalize_brgy_variants(location)
        if parquet is not None and city_norm and variants:
            keys = [f"{city_norm}|{v}" for v in variants]
            point = parquet.by_keys(keys)
            if point is not None:
                return point, "parquet"
        # Fall back to a city-wide centroid for cities where the named
        # barangay doesn't match (e.g. Meralco zone names PSGC doesn't have).
        if parquet is not None:
            point = parquet.by_city(area)
            if point is not None:
                return point, "parquet"
        if use_nominatim:
            nominatim_throttle()
            point = nominatim_geocode(
                session, f"{location}, {area}, Philippines",
            )
            if point is not None:
                return point, "nominatim"
            nominatim_throttle()
            point = nominatim_geocode(session, f"{area}, Philippines")
            if point is not None:
                return point, "nominatim"
        return None, ""

    for entry in entries:
        for location in entry.locations:
            cache_key = "|".join([
                "province" if entry.is_province else "city",
                entry.area.upper(),
                location.upper(),
            ])
            if cache_key in cache:
                cached = cache[cache_key]
                entry.points.append(GeoPoint(
                    barangay=location,
                    city=entry.city,
                    lat=cached.lat,
                    lng=cached.lng,
                    source=cached.source,
                ))
                continue
            point, source = resolve_one(
                area=entry.area,
                location=location,
                is_province=entry.is_province,
            )
            if point is None:
                stats["miss"] += 1
                print(
                    f"  ! no geocode for {entry.area} / {location} "
                    f"(slug={entry.slug})",
                    file=sys.stderr,
                )
                continue
            if source == "parquet":
                stats["parquet_brgy" if not entry.is_province and normalize_brgy_variants(location) else "parquet_city"] += 1
            else:
                stats[source] += 1
            lat, lng = point
            geo = GeoPoint(
                barangay=location,
                city=entry.city,
                lat=lat,
                lng=lng,
                source=source,
            )
            cache[cache_key] = geo
            entry.points.append(geo)

    print(
        "Geocode: "
        f"parquet_brgy={stats['parquet_brgy']}, "
        f"parquet_city={stats['parquet_city']}, "
        f"nominatim={stats['nominatim']}, "
        f"misses={stats['miss']}, cache_size={len(cache)}"
    )


# ---------- Scrape loop ----------

def scrape(
    *,
    lookback_days: int,
    max_pages: int,
    stop_after_empty_pages: int,
    use_nominatim: bool,
    today: date | None = None,
) -> list[MaintenanceEntry]:
    today = today or date.today()
    cutoff = today - timedelta(days=lookback_days)
    session = make_session()
    seen_slugs: set[str] = set()
    entries: list[MaintenanceEntry] = []
    consecutive_old = 0

    for page in range(max_pages):
        html = fetch_listing(session, page)
        rows, has_next = parse_listing(html)
        page_kept = 0
        page_total = 0
        for row in rows:
            entry = parse_entry(row)
            if entry is None:
                continue
            page_total += 1
            if entry.slug in seen_slugs:
                continue
            if not entry.dates:
                # Keep undated entries — they might be in-progress notices.
                seen_slugs.add(entry.slug)
                entries.append(entry)
                page_kept += 1
                continue
            latest_date = max(date.fromisoformat(d) for d in entry.dates)
            if latest_date < cutoff:
                continue
            seen_slugs.add(entry.slug)
            entries.append(entry)
            page_kept += 1

        print(
            f"page={page}: parsed {page_total} rows, kept {page_kept}, "
            f"running total = {len(entries)}"
        )

        if not has_next:
            print("  (no load-more link; reached end of listing)")
            break
        if page_total == 0:
            print("  (empty page; bailing)")
            break

        if page_kept == 0:
            consecutive_old += 1
            if consecutive_old >= stop_after_empty_pages:
                print(
                    f"  (stopping: {stop_after_empty_pages} consecutive pages "
                    f"older than {cutoff})"
                )
                break
        else:
            consecutive_old = 0

    # Sort by earliest date ascending, then by slug.
    def sort_key(e: MaintenanceEntry) -> tuple[str, str]:
        first = min(e.dates) if e.dates else "9999-99-99"
        return (first, e.slug)

    entries.sort(key=sort_key)

    cache = load_geocode_cache()
    resolve_points(entries, cache, use_nominatim=use_nominatim, session=session)
    save_geocode_cache(cache)
    return entries


# ---------- Serialization ----------

def serialize_entries(entries: list[MaintenanceEntry]) -> list[dict]:
    out: list[dict] = []
    for e in entries:
        out.append({
            "slug": e.slug,
            "url": e.url,
            "title": e.title,
            "dates": e.dates,
            "area": e.area,
            "is_province": e.is_province,
            "locations": e.locations,
            "city": e.city,
            "barangays": e.barangays,
            "windows": [
                {
                    "label": w.label,
                    "ranges": [{"start": r.start, "end": r.end} for r in w.ranges],
                    "circuit": w.circuit,
                    "description": w.description,
                }
                for w in e.windows
            ],
            "reason": e.reason,
            "points": [
                {
                    "barangay": p.barangay,
                    "city": p.city,
                    "lat": p.lat,
                    "lng": p.lng,
                    "source": p.source,
                }
                for p in e.points
            ],
        })
    return out


def write_output(entries: list[MaintenanceEntry]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "source_url": BASE_URL,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "entries": serialize_entries(entries),
    }
    raw = json.dumps(payload, ensure_ascii=False, indent=2)
    (OUT_DIR / "all.json").write_text(raw, encoding="utf-8")
    (OUT_DIR / "latest.json").write_text(raw, encoding="utf-8")
    print(f"Wrote {OUT_DIR / 'all.json'} ({len(entries)} entries)")


# ---------- CLI ----------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--lookback-days",
        type=int,
        default=14,
        help="Keep entries whose latest date is no older than today minus N. "
             "Defaults to 14.",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=80,
        help="Hard cap on pages walked. Each page has ~2 entries.",
    )
    parser.add_argument(
        "--stop-after-empty-pages",
        type=int,
        default=3,
        help="Stop once this many consecutive pages have no kept entries.",
    )
    parser.add_argument(
        "--no-nominatim",
        action="store_true",
        help="Skip the Nominatim fallback; parquet centroids only.",
    )
    args = parser.parse_args(argv)

    entries = scrape(
        lookback_days=args.lookback_days,
        max_pages=args.max_pages,
        stop_after_empty_pages=args.stop_after_empty_pages,
        use_nominatim=not args.no_nominatim,
    )
    if not entries:
        print("No entries kept — aborting write so we don't clobber on a parse failure.",
              file=sys.stderr)
        return 1
    write_output(entries)
    return 0


if __name__ == "__main__":
    sys.exit(main())
