"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, {
  type DataDrivenPropertyValueSpecification,
  type GeoJSONSource,
  type Map as MapLibreMap,
} from "maplibre-gl";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import {
  countBarangays,
  type Schedule,
  type ScheduleWindow,
  type Province,
  type City,
} from "@/lib/schedule";
import { matchKeysForWindow } from "@/lib/normalize";
import { queryBarangaysByMatchKeys } from "@/lib/duckdb";
import { wkbToGeometry } from "@/lib/wkb";

type KeyToWindows = Map<string, string[]>;

const PROVINCE_PRIORITY = [
  "METRO MANILA",
  "BULACAN",
  "RIZAL PROVINCE",
  "CAVITE",
  "LAGUNA",
  "QUEZON PROVINCE",
];

const PROVINCE_DISPLAY: Record<string, string> = {
  "METRO MANILA": "Metro Manila",
  BULACAN: "Bulacan",
  "RIZAL PROVINCE": "Rizal",
  CAVITE: "Cavite",
  LAGUNA: "Laguna",
  "QUEZON PROVINCE": "Quezon",
};

function provinceRank(name: string): number {
  const idx = PROVINCE_PRIORITY.indexOf(name.toUpperCase());
  return idx === -1 ? PROVINCE_PRIORITY.length : idx;
}

function displayProvince(name: string): string {
  return PROVINCE_DISPLAY[name.toUpperCase()] ?? toTitle(name);
}

function toTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())
    .replace(/(\s)(De|Del|Of|And|The)(?=\s|$)/gi, (_, sp, m) => sp + m.toLowerCase());
}

function buildKeyToWindows(schedule: Schedule): KeyToWindows {
  const map: KeyToWindows = new Map();
  for (const w of schedule.windows) {
    const label = formatRange(w);
    for (const key of matchKeysForWindow(w)) {
      const existing = map.get(key);
      if (existing) {
        if (!existing.includes(label)) existing.push(label);
      } else {
        map.set(key, [label]);
      }
    }
  }
  return map;
}

function windowsForRow(matchKeys: string[], lookup: KeyToWindows): string[] {
  const out: string[] = [];
  for (const k of matchKeys) {
    const labels = lookup.get(k);
    if (!labels) continue;
    for (const label of labels) {
      if (!out.includes(label)) out.push(label);
    }
  }
  return out;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MAP_STYLE = "/map-style.json";
const INITIAL_VIEW = { lng: 121.0, lat: 14.65, zoom: 8.5 };

const SOURCE_ID = "affected-barangays";
const FILL_LAYER_ID = "affected-barangays-fill";
const OUTLINE_LAYER_ID = "affected-barangays-outline";

const FILL_COLOR_DEFAULT = "#fc5c00";
const FILL_COLOR_HOVER = "#000000";
const FILL_OPACITY_DEFAULT = 0.6;
const FILL_OPACITY_HOVER = 0.85;
const OUTLINE_COLOR = "#1e3a8a";
const OUTLINE_WIDTH_DEFAULT = 1.5;
const OUTLINE_WIDTH_HOVER = 3;

const EMPTY_FC: FeatureCollection<Polygon | MultiPolygon> = {
  type: "FeatureCollection",
  features: [],
};

function formatRange(w: ScheduleWindow): string {
  return w.label.replace(/^Between\s+/i, "");
}

function shortTime(t: string | null): string {
  if (!t) return "";
  // Inputs look like "14:01" or similar from ScheduleWindow.start/end.
  // Fall back to slicing the label if needed.
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const period = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${min} ${period}`;
}

function compactClock(t: string | null): string {
  if (!t) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const period = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return min === "00" ? `${h}${period}` : `${h}:${min}${period}`;
}

function compactRange(w: ScheduleWindow): string {
  return `${compactClock(w.start)}–${compactClock(w.end)}`;
}

function parseTimeStr(t: string | null): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function todayInManila(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function isStaleSchedule(scheduleDate: string | null, now: Date): boolean {
  if (!scheduleDate) return false;
  return scheduleDate < todayInManila(now);
}

function formatScheduleDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function isLiveNow(
  w: ScheduleWindow,
  scheduleDate: string | null,
  now: Date
): boolean {
  if (!scheduleDate) return false;
  if (scheduleDate !== todayInManila(now)) return false;
  const start = parseTimeStr(w.start);
  const end = parseTimeStr(w.end);
  if (start == null || end == null) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // Handle wrap-around (e.g. 9:01PM - 12:00AM)
  if (end < start) {
    return nowMin >= start || nowMin <= end;
  }
  return nowMin >= start && nowMin <= end;
}

type BarangayFeature = Feature<
  Polygon | MultiPolygon,
  {
    city: string;
    barangay: string;
    pcode: string;
    windows: string[];
  }
>;

async function buildFeatureCollection(
  window: ScheduleWindow,
  keyToWindows: KeyToWindows
): Promise<FeatureCollection<Polygon | MultiPolygon>> {
  const keys = matchKeysForWindow(window);
  if (keys.length === 0) return EMPTY_FC;
  const rows = await queryBarangaysByMatchKeys(keys);
  const features: BarangayFeature[] = [];
  for (const row of rows) {
    try {
      features.push({
        type: "Feature",
        geometry: wkbToGeometry(row.geometry),
        properties: {
          city: row.city_norm,
          barangay: row.barangay_norm,
          pcode: row.adm4_pcode,
          windows: windowsForRow(row.match_keys, keyToWindows),
        },
      });
    } catch (err) {
      console.warn("WKB parse failed for", row.adm4_pcode, err);
    }
  }
  return { type: "FeatureCollection", features };
}

function ensureLayers(map: MapLibreMap) {
  const fillColor: DataDrivenPropertyValueSpecification<string> = [
    "case",
    ["boolean", ["feature-state", "hover"], false],
    FILL_COLOR_HOVER,
    FILL_COLOR_DEFAULT,
  ];
  const fillOpacity: DataDrivenPropertyValueSpecification<number> = [
    "case",
    ["boolean", ["feature-state", "hover"], false],
    FILL_OPACITY_HOVER,
    FILL_OPACITY_DEFAULT,
  ];
  const lineWidth: DataDrivenPropertyValueSpecification<number> = [
    "case",
    ["boolean", ["feature-state", "hover"], false],
    OUTLINE_WIDTH_HOVER,
    OUTLINE_WIDTH_DEFAULT,
  ];

  if (map.getSource(SOURCE_ID)) {
    if (map.getLayer(FILL_LAYER_ID)) {
      map.setPaintProperty(FILL_LAYER_ID, "fill-color", fillColor);
      map.setPaintProperty(FILL_LAYER_ID, "fill-opacity", fillOpacity);
    }
    if (map.getLayer(OUTLINE_LAYER_ID)) {
      map.setPaintProperty(OUTLINE_LAYER_ID, "line-color", OUTLINE_COLOR);
      map.setPaintProperty(OUTLINE_LAYER_ID, "line-width", lineWidth);
    }
    return;
  }

  map.addSource(SOURCE_ID, {
    type: "geojson",
    data: EMPTY_FC,
    generateId: true,
  });
  map.addLayer({
    id: FILL_LAYER_ID,
    type: "fill",
    source: SOURCE_ID,
    paint: {
      "fill-color": fillColor,
      "fill-opacity": fillOpacity,
    },
  });
  map.addLayer({
    id: OUTLINE_LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    paint: {
      "line-color": OUTLINE_COLOR,
      "line-width": lineWidth,
    },
  });
}

function fitToFeatures(
  map: MapLibreMap,
  fc: FeatureCollection<Polygon | MultiPolygon>
) {
  if (fc.features.length === 0) return;
  const b = new maplibregl.LngLatBounds();
  for (const f of fc.features) {
    const polys =
      f.geometry.type === "Polygon"
        ? [f.geometry.coordinates]
        : f.geometry.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        for (const [x, y] of ring) b.extend([x, y]);
      }
    }
  }
  if (!b.isEmpty()) {
    map.fitBounds(b, { padding: 60, maxZoom: 12, duration: 600 });
  }
}

// ---------- Sidebar helpers ----------

interface FilteredProvince {
  province: Province;
  cities: FilteredCity[];
  totalBarangays: number;
}

interface FilteredCity {
  city: City;
  barangays: FilteredBarangay[];
}

interface FilteredBarangay {
  name: string;
  windows: number[]; // indices into schedule.windows; only populated during search
}

interface AggregatedWindows {
  provinces: Province[];
  barangayWindows: Map<string, number[]>; // key = `${province}|${city}|${barangay}`
}

function aggregateWindows(windows: ScheduleWindow[]): AggregatedWindows {
  const barangayWindows = new Map<string, number[]>();
  const cityByProv = new Map<string, Map<string, string[]>>();
  const provOrder: string[] = [];
  const cityOrder = new Map<string, string[]>();

  windows.forEach((w, wIdx) => {
    for (const prov of w.provinces) {
      let cities = cityByProv.get(prov.name);
      if (!cities) {
        cities = new Map();
        cityByProv.set(prov.name, cities);
        provOrder.push(prov.name);
        cityOrder.set(prov.name, []);
      }
      for (const city of prov.cities) {
        let barangays = cities.get(city.name);
        if (!barangays) {
          barangays = [];
          cities.set(city.name, barangays);
          cityOrder.get(prov.name)!.push(city.name);
        }
        for (const brgy of city.barangays) {
          const key = `${prov.name}|${city.name}|${brgy}`;
          const idxs = barangayWindows.get(key);
          if (idxs) {
            if (!idxs.includes(wIdx)) idxs.push(wIdx);
          } else {
            barangayWindows.set(key, [wIdx]);
            barangays.push(brgy);
          }
        }
      }
    }
  });

  const provinces: Province[] = provOrder.map((pn) => ({
    name: pn,
    cities: (cityOrder.get(pn) ?? []).map((cn) => ({
      name: cn,
      barangays: cityByProv.get(pn)!.get(cn)!,
    })),
  }));

  return { provinces, barangayWindows };
}

function sortAndFilterProvinces(
  provinces: Province[],
  query: string,
  barangayWindows: Map<string, number[]> | null
): FilteredProvince[] {
  const q = query.trim().toLowerCase();
  const sorted = [...provinces].sort(
    (a, b) =>
      provinceRank(a.name) - provinceRank(b.name) ||
      a.name.localeCompare(b.name)
  );
  const out: FilteredProvince[] = [];
  for (const province of sorted) {
    const provMatches =
      !q ||
      province.name.toLowerCase().includes(q) ||
      displayProvince(province.name).toLowerCase().includes(q);
    const filteredCities: FilteredCity[] = [];
    let total = 0;
    for (const city of province.cities) {
      const cityMatches =
        !q || city.name.toLowerCase().includes(q) || provMatches;
      const names = !q || cityMatches
        ? city.barangays
        : city.barangays.filter((b) => b.toLowerCase().includes(q));
      if (names.length === 0) continue;
      const barangays: FilteredBarangay[] = names.map((b) => ({
        name: b,
        windows: barangayWindows?.get(`${province.name}|${city.name}|${b}`) ?? [],
      }));
      filteredCities.push({ city, barangays });
      total += barangays.length;
    }
    if (filteredCities.length > 0) {
      out.push({ province, cities: filteredCities, totalBarangays: total });
    }
  }
  return out;
}

function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return toTitle(text);
  const titled = toTitle(text);
  const idx = titled.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return titled;
  return (
    <>
      {titled.slice(0, idx)}
      <mark className="bo-mark">{titled.slice(idx, idx + q.length)}</mark>
      {titled.slice(idx + q.length)}
    </>
  );
}

export default function BrownoutMap({ schedule }: { schedule: Schedule }) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapReadyRef = useRef(false);
  const hoveredIdRef = useRef<number | string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [matchedCount, setMatchedCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [openProvinces, setOpenProvinces] = useState<Set<string>>(
    () => new Set(["METRO MANILA"])
  );
  const [openCities, setOpenCities] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => new Date());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [windowDropdownOpen, setWindowDropdownOpen] = useState(false);
  const [selectedFeature, setSelectedFeature] = useState<{
    barangay: string;
    city: string;
    windows: string[];
  } | null>(null);
  const isTouchRef = useRef(false);
  const windowDropdownRef = useRef<HTMLDivElement | null>(null);

  // Refresh "now" every 30 seconds so the LIVE badge updates as time passes.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Detect coarse pointer / no-hover devices so we can swap hover popup for
  // a tap-driven bottom sheet on mobile.
  useEffect(() => {
    if (typeof window === "undefined") return;
    isTouchRef.current = window.matchMedia("(hover: none)").matches;
  }, []);

  // Close the time-window dropdown on outside click or Escape.
  useEffect(() => {
    if (!windowDropdownOpen) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (
        windowDropdownRef.current &&
        !windowDropdownRef.current.contains(e.target as Node)
      ) {
        setWindowDropdownOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWindowDropdownOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [windowDropdownOpen]);

  // Compute the initially selected window: the one currently live if any,
  // else the earliest window.
  const initialIdx = useMemo(() => {
    const liveIdx = schedule.windows.findIndex((w) =>
      isLiveNow(w, schedule.schedule_date, new Date())
    );
    return liveIdx >= 0 ? liveIdx : 0;
  }, [schedule]);

  const [selectedIdx, setSelectedIdx] = useState(initialIdx);

  const selected = schedule.windows[selectedIdx];
  const liveWindowIdx = useMemo(
    () =>
      schedule.windows.findIndex((w) =>
        isLiveNow(w, schedule.schedule_date, now)
      ),
    [schedule, now]
  );
  const isStale = useMemo(
    () => isStaleSchedule(schedule.schedule_date, now),
    [schedule.schedule_date, now]
  );

  const totalBarangaysForWindow = useMemo(
    () => (selected ? countBarangays(selected) : 0),
    [selected]
  );
  const keyToWindows = useMemo(() => buildKeyToWindows(schedule), [schedule]);

  const aggregated = useMemo(
    () => aggregateWindows(schedule.windows),
    [schedule]
  );

  const filteredProvinces = useMemo(() => {
    if (searchQuery.trim()) {
      // Search spans the whole day so a barangay shows up regardless of
      // which time window is currently selected. Each match carries the
      // window indices it belongs to so we can surface them as badges.
      return sortAndFilterProvinces(
        aggregated.provinces,
        searchQuery,
        aggregated.barangayWindows
      );
    }
    return sortAndFilterProvinces(selected?.provinces ?? [], "", null);
  }, [selected, searchQuery, aggregated]);

  // When a search is active, auto-expand provinces/cities that have matches.
  useEffect(() => {
    if (!searchQuery.trim()) return;
    const ps = new Set<string>();
    const cs = new Set<string>();
    for (const fp of filteredProvinces) {
      ps.add(fp.province.name);
      for (const fc of fp.cities) cs.add(`${fp.province.name}|${fc.city.name}`);
    }
    setOpenProvinces(ps);
    setOpenCities(cs);
  }, [searchQuery, filteredProvinces]);

  // Reset open state when the user switches time windows, but leave the
  // search-time expansion untouched so badge-driven window switches don't
  // collapse the matches the user is looking at.
  useEffect(() => {
    if (searchQuery.trim()) return;
    setOpenProvinces(new Set(["METRO MANILA"]));
    setOpenCities(new Set());
  }, [selectedIdx, searchQuery]);

  const toggleProvince = (name: string) => {
    setOpenProvinces((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleCity = (provinceName: string, cityName: string) => {
    const key = `${provinceName}|${cityName}`;
    setOpenCities((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: [INITIAL_VIEW.lng, INITIAL_VIEW.lat],
      zoom: INITIAL_VIEW.zoom,
      attributionControl: false,
    });
    const isMobile =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 1023px)").matches;
    if (!isMobile) {
      map.addControl(new maplibregl.NavigationControl(), "top-right");
    }
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserLocation: true,
      }),
      isMobile ? "bottom-right" : "top-right"
    );

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 8,
      className: "brownout-popup",
    });

    const clearHover = () => {
      if (hoveredIdRef.current !== null) {
        map.setFeatureState(
          { source: SOURCE_ID, id: hoveredIdRef.current },
          { hover: false }
        );
        hoveredIdRef.current = null;
      }
    };

    map.on("load", () => {
      ensureLayers(map);
      mapReadyRef.current = true;
    });

    map.on("mousemove", FILL_LAYER_ID, (e) => {
      if (isTouchRef.current) return;
      const feature = e.features?.[0];
      if (!feature) return;
      map.getCanvas().style.cursor = "pointer";

      const fid = feature.id;
      if (fid !== undefined && fid !== hoveredIdRef.current) {
        clearHover();
        hoveredIdRef.current = fid;
        map.setFeatureState(
          { source: SOURCE_ID, id: fid },
          { hover: true }
        );
      }

      const props = feature.properties ?? {};
      const barangay = String(props.barangay ?? "");
      const city = String(props.city ?? "");
      const rawWindows = (props as { windows?: unknown }).windows;
      let windows: string[] = [];
      if (Array.isArray(rawWindows)) {
        windows = rawWindows.map((v) => String(v));
      } else if (typeof rawWindows === "string") {
        try {
          const parsed = JSON.parse(rawWindows);
          if (Array.isArray(parsed)) windows = parsed.map((v) => String(v));
        } catch {
          windows = [rawWindows];
        }
      }

      const title = [barangay, city].filter(Boolean).join(", ");
      const windowsHtml = windows.length
        ? `<ul class="brownout-popup-windows">${windows
            .map((w) => `<li>${escapeHtml(w)}</li>`)
            .join("")}</ul>`
        : `<div class="brownout-popup-windows-empty">No scheduled brownout</div>`;

      popup
        .setLngLat(e.lngLat)
        .setHTML(
          `<div class="brownout-popup-title">${escapeHtml(title)}</div>` +
            `<div class="brownout-popup-label">Brownout window${
              windows.length === 1 ? "" : "s"
            }</div>` +
            windowsHtml
        )
        .addTo(map);
    });

    map.on("mouseleave", FILL_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
      clearHover();
      popup.remove();
    });

    // Tap-to-open bottom sheet on mobile; harmless on desktop because the
    // sheet wrapper is hidden via `lg:hidden`.
    map.on("click", FILL_LAYER_ID, (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const props = feature.properties ?? {};
      const barangay = String(props.barangay ?? "");
      const city = String(props.city ?? "");
      const rawWindows = (props as { windows?: unknown }).windows;
      let windows: string[] = [];
      if (Array.isArray(rawWindows)) {
        windows = rawWindows.map((v) => String(v));
      } else if (typeof rawWindows === "string") {
        try {
          const parsed = JSON.parse(rawWindows);
          if (Array.isArray(parsed)) windows = parsed.map((v) => String(v));
        } catch {
          windows = [rawWindows];
        }
      }
      setSelectedFeature({ barangay, city, windows });
    });

    mapRef.current = map;
    return () => {
      popup.remove();
      map.remove();
      mapRef.current = null;
      mapReadyRef.current = false;
      hoveredIdRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    const run = async () => {
      setStatus("loading");
      try {
        const waitForMap = () =>
          new Promise<void>((resolve) => {
            const tick = () => {
              if (mapReadyRef.current) resolve();
              else setTimeout(tick, 50);
            };
            tick();
          });
        const [fc] = await Promise.all([
          buildFeatureCollection(selected, keyToWindows),
          waitForMap(),
        ]);
        if (cancelled) return;
        const map = mapRef.current;
        if (!map) return;
        ensureLayers(map);
        if (hoveredIdRef.current !== null) {
          map.setFeatureState(
            { source: SOURCE_ID, id: hoveredIdRef.current },
            { hover: false }
          );
          hoveredIdRef.current = null;
        }
        const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
        source?.setData(fc);
        setMatchedCount(fc.features.length);
        fitToFeatures(map, fc);
        setStatus("idle");
      } catch (err) {
        console.error("Failed to load barangay polygons", err);
        if (!cancelled) setStatus("error");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [selected, keyToWindows]);

  const totalProvincesAll = useMemo(
    () => filteredProvinces.length,
    [filteredProvinces]
  );
  const totalCitiesAll = useMemo(
    () => filteredProvinces.reduce((acc, p) => acc + p.cities.length, 0),
    [filteredProvinces]
  );
  const totalBarangaysFiltered = useMemo(
    () =>
      filteredProvinces.reduce((acc, p) => acc + p.totalBarangays, 0),
    [filteredProvinces]
  );

  const sidebarBody = (
    <>
      {/* Summary + Search (topmost) */}
      <div className="px-4 pt-4 pb-3 border-b border-amber-100 flex-shrink-0">
          <div className="grid grid-cols-3 gap-2 mb-3">
            <SummaryCard
              label="Provinces"
              value={totalProvincesAll}
              accent="bg-orange-100 text-orange-700"
            />
            <SummaryCard
              label="Cities"
              value={totalCitiesAll}
              accent="bg-amber-100 text-amber-800"
            />
            <SummaryCard
              label="Barangays"
              value={totalBarangaysFiltered}
              accent="bg-yellow-100 text-yellow-800"
            />
          </div>
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-orange-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search barangay, city, or province…"
              className="w-full bg-white border border-amber-200 rounded-none pl-9 pr-9 py-2 text-sm text-[var(--bo-ink)] placeholder:text-[var(--bo-ink-soft)]/60 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-orange-400"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--bo-ink-soft)] hover:text-orange-700 rounded-none w-8 h-8 inline-flex items-center justify-center hover:bg-orange-100 text-base"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Accordion list */}
        <div className="flex-1 overflow-y-auto bo-scroll px-3 py-3">
          {filteredProvinces.length === 0 && (
            <div className="text-center py-10 text-sm text-[var(--bo-ink-soft)]">
              {searchQuery
                ? `No matches for "${searchQuery}"`
                : "No areas affected in this window"}
            </div>
          )}
          <div className="space-y-2">
            {filteredProvinces.map((fp) => {
              const isProvOpen = openProvinces.has(fp.province.name);
              return (
                <div
                  key={fp.province.name}
                  className="rounded-none border border-amber-200 bg-white overflow-hidden"
                >
                  <button
                    onClick={() => toggleProvince(fp.province.name)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 bg-gradient-to-r from-orange-100 to-yellow-50 hover:from-orange-200 hover:to-yellow-100 transition text-left"
                  >
                    <svg
                      className={`bo-chev ${isProvOpen ? "open" : ""} w-3.5 h-3.5 text-orange-700 flex-shrink-0`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                    <span className="font-bold text-[var(--bo-ink)] text-sm">
                      {displayProvince(fp.province.name)}
                    </span>
                    <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-none bg-orange-600 text-white">
                      {fp.totalBarangays}
                    </span>
                    <span className="text-[10px] text-[var(--bo-ink-soft)] font-medium">
                      {fp.cities.length}{" "}
                      {fp.cities.length === 1 ? "city" : "cities"}
                    </span>
                  </button>
                  {isProvOpen && (
                    <div className="bo-accordion-content divide-y divide-amber-100">
                      {fp.cities.map((fc) => {
                        const cityKey = `${fp.province.name}|${fc.city.name}`;
                        const isCityOpen = openCities.has(cityKey);
                        return (
                          <div key={cityKey}>
                            <button
                              onClick={() =>
                                toggleCity(fp.province.name, fc.city.name)
                              }
                              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-yellow-50 transition text-left"
                            >
                              <svg
                                className={`bo-chev ${isCityOpen ? "open" : ""} w-3 h-3 text-orange-500 flex-shrink-0`}
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden
                              >
                                <path d="m9 6 6 6-6 6" />
                              </svg>
                              <span className="text-[13px] font-semibold text-[var(--bo-ink)]">
                                {highlight(fc.city.name, searchQuery)}
                              </span>
                              <span className="ml-auto text-[10px] font-semibold text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded-none">
                                {fc.barangays.length}
                              </span>
                            </button>
                            {isCityOpen && (
                              <ul className="bo-accordion-content pl-8 pr-3 pb-2 grid grid-cols-1 gap-0.5">
                                {fc.barangays.map((b, idx) => (
                                  <li
                                    key={`${cityKey}-${b.name}-${idx}`}
                                    className="text-[12px] text-[var(--bo-ink-soft)] py-0.5 px-2 rounded-none hover:bg-yellow-100 hover:text-[var(--bo-ink)] transition flex items-center gap-2"
                                  >
                                    <span className="w-1 h-1 rounded-none bg-orange-400 flex-shrink-0" />
                                    <span className="truncate flex-1">
                                      {highlight(b.name, searchQuery)}
                                    </span>
                                    {b.windows.length > 0 && (
                                      <span className="flex flex-wrap gap-1 justify-end">
                                        {b.windows.map((wIdx) => {
                                          const w = schedule.windows[wIdx];
                                          if (!w) return null;
                                          const isSel = wIdx === selectedIdx;
                                          return (
                                            <button
                                              key={wIdx}
                                              type="button"
                                              onClick={() => setSelectedIdx(wIdx)}
                                              className={
                                                "text-[9px] font-bold tabular-nums tracking-wide px-1.5 py-0.5 rounded-none whitespace-nowrap transition " +
                                                (isSel
                                                  ? "bg-orange-500 text-white"
                                                  : "bg-orange-100 text-orange-700 hover:bg-orange-200")
                                              }
                                              title="Show this time window on the map"
                                            >
                                              {compactRange(w)}
                                            </button>
                                          );
                                        })}
                                      </span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

      {schedule.advisory && (
        <div className="px-4 py-3 border-t border-amber-200 bg-yellow-50 text-[11px] text-[var(--bo-ink-soft)] leading-relaxed flex-shrink-0">
          <span className="font-bold text-orange-700 uppercase tracking-wider text-[10px] block mb-1">
            Advisory
          </span>
          {schedule.advisory}
        </div>
      )}
      <div className="px-4 py-3 border-t border-amber-200 bg-white text-[11px] text-[var(--bo-ink-soft)] leading-relaxed flex-shrink-0 flex items-center gap-2">
        <span className="flex-1">
          Ayaw mo maniwala sa datos dito? Check mo 'to
        </span>
        <a
          href="https://company.meralco.com.ph/news-and-advisories/rotational-brownout"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open official Meralco rotational brownout source"
          title="Official Source"
          className="inline-flex items-center justify-center w-8 h-8 rounded-none bg-orange-100 text-orange-700 hover:bg-orange-200 hover:text-orange-900 transition flex-shrink-0"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M14 3h7v7" />
            <path d="M10 14 21 3" />
            <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
          </svg>
        </a>
      </div>
      <div className="px-4 py-2.5 border-t border-amber-200 bg-white text-[10px] text-[var(--bo-ink-soft)] flex items-center justify-between gap-2 flex-shrink-0">
        <span>
          Unofficial · Not affiliated with Meralco or NGCP
        </span>
        <a
          href="/legal"
          className="font-bold uppercase tracking-widest text-orange-700 hover:text-orange-900"
        >
          Terms &amp; Privacy
        </a>
      </div>
    </>
  );

  const liveHeader = (
    <div
      ref={windowDropdownRef}
      className={
        "absolute live-header-pos lg:max-w-[520px] " +
        (windowDropdownOpen ? "z-40" : "z-20")
      }
    >
      <div className="bg-white/95 backdrop-blur-md border border-amber-200 rounded-none shadow-[0_10px_30px_rgba(234,88,12,0.18)] overflow-hidden">
        {isStale ? (
          <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-400">
            <span
              className="w-2.5 h-2.5 rounded-none bg-white animate-pulse"
              aria-hidden
            />
            <div className="text-white font-bold tracking-wide text-[12px] sm:text-sm leading-tight">
              AWAITING TODAY&apos;S UPDATE
            </div>
            <div className="ml-auto text-[10px] uppercase tracking-widest text-white/90 font-semibold hidden sm:block">
              Latest Advisory
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 bg-gradient-to-r from-orange-500 via-orange-400 to-yellow-400">
            <span className="live-dot" aria-hidden />
            <div className="text-white font-bold tracking-wide text-[12px] sm:text-sm leading-tight">
              LIVE · Meralco Rotational Brownout
            </div>
            <div className="ml-auto text-[10px] uppercase tracking-widest text-white/90 font-semibold hidden sm:block">
              Realtime Monitor
            </div>
          </div>
        )}
        {isStale && schedule.schedule_date && (
          <div className="px-3 sm:px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-[11px] sm:text-xs leading-relaxed text-[var(--bo-ink)]">
            <span className="font-bold text-amber-800">
              Today&apos;s rotational brownout advisory has not yet been
              published by Meralco.
            </span>{" "}
            The schedule and map shown reflect the most recent advisory, dated{" "}
            <span className="font-semibold">
              {formatScheduleDate(schedule.schedule_date)}
            </span>
            . This view will refresh automatically once a new advisory is
            posted.
          </div>
        )}
        {selected && (
          <div
            className={
              "px-3 sm:px-4 py-2.5 sm:py-3 border-b border-amber-100 " +
              (selectedIdx === liveWindowIdx
                ? "bg-gradient-to-r from-red-50 via-orange-50 to-yellow-50"
                : "bg-gradient-to-r from-orange-50 to-yellow-50")
            }
          >
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[9px] sm:text-[10px] uppercase tracking-widest font-bold text-orange-700">
                {selectedIdx === liveWindowIdx ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-none bg-red-500 animate-pulse" />
                    <span className="text-red-600">Live Now</span>
                  </span>
                ) : (
                  "Showing Time Window"
                )}
              </div>
              <div className="text-[9px] sm:text-[10px] uppercase tracking-wider font-semibold text-[var(--bo-ink-soft)]">
                Window {selectedIdx + 1} of {schedule.windows.length}
              </div>
            </div>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setWindowDropdownOpen((v) => !v)}
                className="group flex items-center gap-2 text-xl sm:text-2xl lg:text-3xl font-extrabold tabular-nums text-[var(--bo-ink)] leading-tight whitespace-nowrap rounded-none px-2 -mx-2 py-0.5 hover:bg-orange-100/60 transition focus:outline-none focus:ring-2 focus:ring-orange-400"
                aria-haspopup="listbox"
                aria-expanded={windowDropdownOpen}
              >
                <span>
                  {shortTime(selected.start)}{" "}
                  <span className="text-orange-500">→</span>{" "}
                  {shortTime(selected.end)}
                </span>
                <svg
                  className={
                    "w-4 h-4 sm:w-5 sm:h-5 text-orange-500 transition-transform " +
                    (windowDropdownOpen ? "rotate-180" : "")
                  }
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {liveWindowIdx >= 0 && selectedIdx !== liveWindowIdx && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedIdx(liveWindowIdx);
                    setWindowDropdownOpen(false);
                  }}
                  className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-none bg-red-500 text-white inline-flex items-center gap-1.5 hover:bg-red-600 transition focus:outline-none focus:ring-2 focus:ring-red-400 flex-shrink-0"
                  title="Jump to the currently live time window"
                >
                  <span className="w-1.5 h-1.5 rounded-none bg-white animate-pulse" />
                  Go Live
                </button>
              )}
            </div>
          </div>
        )}
        <div className="px-3 sm:px-4 py-2 sm:py-3 flex flex-wrap items-center gap-x-3 sm:gap-x-5 gap-y-0.5 text-[10px] sm:text-xs text-[var(--bo-ink-soft)]">
          <div>
            <span className="font-semibold text-[var(--bo-ink)]">
              {schedule.schedule_date ?? "Date unknown"}
            </span>
          </div>
          <div>
            <span className="font-semibold text-[var(--bo-ink)]">
              {schedule.windows.length}
            </span>{" "}
            time windows
          </div>
          <div className="ml-auto text-[11px] hidden sm:block">
            Updated{" "}
            <span className="font-semibold text-[var(--bo-ink)]">
              {new Date(schedule.scraped_at).toLocaleString()}
            </span>
          </div>
        </div>
        {(status === "loading" || status === "error") && (
          <div className="px-3 sm:px-4 pb-2 sm:pb-3 -mt-1 text-[10px] sm:text-[11px] font-medium">
            {status === "loading" && (
              <span className="inline-flex items-center gap-1.5 text-orange-700">
                <span className="inline-block w-2 h-2 rounded-none bg-orange-500 animate-pulse" />
                Loading polygons…
              </span>
            )}
            {status === "error" && (
              <span className="text-red-600">Failed to load polygons</span>
            )}
          </div>
        )}
      </div>
      {windowDropdownOpen && (
        <div
          role="listbox"
          aria-label="Select time window"
          className="mt-2 bg-white border border-amber-200 rounded-none shadow-[0_14px_36px_rgba(234,88,12,0.28)] overflow-hidden"
        >
          <ul className="max-h-[60dvh] overflow-y-auto bo-scroll bo-overscroll-contain divide-y divide-amber-100">
            {schedule.windows.map((w, i) => {
              const live = i === liveWindowIdx;
              const isSelected = i === selectedIdx;
              const count = countBarangays(w);
              return (
                <li key={w.label}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      setSelectedIdx(i);
                      setWindowDropdownOpen(false);
                    }}
                    className={
                      "w-full px-3 py-2.5 text-left flex items-center gap-3 transition focus:outline-none " +
                      (isSelected
                        ? "bg-gradient-to-r from-orange-50 to-yellow-50"
                        : "hover:bg-yellow-50")
                    }
                  >
                    <div className="flex-1 min-w-0">
                      <div
                        className={
                          "text-[14px] font-bold tabular-nums whitespace-nowrap " +
                          (isSelected ? "text-orange-700" : "text-[var(--bo-ink)]")
                        }
                      >
                        {shortTime(w.start)}{" "}
                        <span className="text-orange-500">→</span>{" "}
                        {shortTime(w.end)}
                      </div>
                      <div className="text-[10px] text-[var(--bo-ink-soft)] mt-0.5">
                        {count} barangay{count === 1 ? "" : "s"} affected
                      </div>
                    </div>
                    {live && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-none bg-red-500 text-white inline-flex items-center gap-1 flex-shrink-0">
                        <span className="w-1 h-1 rounded-none bg-white animate-pulse" />
                        Live
                      </span>
                    )}
                    {isSelected && !live && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-none bg-orange-100 text-orange-700 flex-shrink-0">
                        Active
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );

  return (
    <main className="app-shell bg-[var(--bo-cream)] flex">
      {/* Map column */}
      <div className="relative flex-1 min-w-0">
        <div ref={mapContainerRef} className="absolute inset-0" />
        {liveHeader}
      </div>

      {/* Desktop sidebar (lg+) */}
      <aside className="hidden lg:flex w-[440px] flex-shrink-0 overflow-hidden bg-white border-l border-amber-200 flex-col">
        {sidebarBody}
      </aside>

      {/* Mobile trigger pill — opens the right drawer */}
      {!drawerOpen && (
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="lg:hidden fixed mobile-pill-pos z-30 bg-white border border-amber-200 rounded-none shadow-[0_8px_24px_rgba(234,88,12,0.22)] px-4 py-3 active:bg-orange-50 transition text-left flex items-center gap-3"
          aria-label="Open schedule"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-orange-700 flex-shrink-0">
              Schedule
            </span>
            {selected && (
              <span className="text-[12px] font-bold text-[var(--bo-ink)] tabular-nums truncate">
                {shortTime(selected.start)} → {shortTime(selected.end)}
              </span>
            )}
            <span className="text-[10px] font-semibold text-orange-700 bg-orange-100 rounded-none px-2 py-0.5 flex-shrink-0">
              {totalBarangaysFiltered}
            </span>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600 flex items-center gap-1 flex-shrink-0">
            Open
            <svg
              className="w-3 h-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
          </span>
        </button>
      )}

      {/* Mobile right drawer */}
      <div className="lg:hidden">
        {drawerOpen && (
          <button
            type="button"
            aria-label="Close schedule"
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 bg-black/40 z-30"
          />
        )}
        <div
          className={
            "fixed top-0 bottom-0 right-0 z-40 w-[92%] max-w-sm sm:max-w-md mobile-drawer-pad transform transition-transform duration-300 ease-out " +
            (drawerOpen ? "translate-x-0" : "translate-x-full pointer-events-none")
          }
          role="dialog"
          aria-label="Brownout schedule"
          aria-hidden={!drawerOpen}
        >
          <div className="h-full bg-white border-l-2 border-orange-300 shadow-[-12px_0_40px_rgba(234,88,12,0.25)] flex flex-col overflow-hidden bo-overscroll-contain">
            <div className="flex-shrink-0 px-4 pt-3 pb-2 flex items-center justify-between gap-2 border-b border-amber-100 bg-gradient-to-r from-orange-50 to-yellow-50">
              <span className="text-[10px] font-bold uppercase tracking-widest text-orange-700">
                Schedule
              </span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="w-8 h-8 rounded-none bg-amber-100 text-orange-700 flex items-center justify-center text-lg font-bold hover:bg-amber-200 active:bg-amber-300 transition"
                aria-label="Close schedule"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              {sidebarBody}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile barangay detail sheet */}
      {selectedFeature && (
        <div className="lg:hidden">
          <button
            type="button"
            aria-label="Close barangay details"
            onClick={() => setSelectedFeature(null)}
            className="fixed inset-0 bg-black/40 z-40"
          />
          <div
            className="fixed inset-x-0 bottom-0 z-50 mobile-sheet-pad"
            role="dialog"
            aria-label="Barangay details"
          >
            <div className="bg-white rounded-none shadow-[0_-12px_40px_rgba(234,88,12,0.35)] border-t-2 border-orange-400 max-h-[70dvh] overflow-y-auto bo-scroll bo-overscroll-contain">
              <div className="sticky top-0 bg-white pt-2 pb-2 z-10">
                <div className="w-12 h-1.5 rounded-none bg-amber-300 mx-auto" />
              </div>
              <div className="px-5 pb-5">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-widest text-orange-700 font-bold mb-1">
                      Barangay
                    </div>
                    <div className="font-extrabold text-lg leading-tight text-[var(--bo-ink)] break-words">
                      {toTitle(selectedFeature.barangay)}
                    </div>
                    <div className="text-xs text-[var(--bo-ink-soft)] mt-0.5">
                      {toTitle(selectedFeature.city)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedFeature(null)}
                    className="w-9 h-9 rounded-none bg-amber-100 text-orange-700 flex items-center justify-center text-lg font-bold flex-shrink-0 hover:bg-amber-200 active:bg-amber-300 transition"
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
                <div className="text-[10px] uppercase tracking-widest text-orange-700 font-bold mb-2">
                  Brownout window
                  {selectedFeature.windows.length === 1 ? "" : "s"}
                </div>
                {selectedFeature.windows.length > 0 ? (
                  <ul className="flex flex-col gap-1.5 items-start">
                    {selectedFeature.windows.map((w, i) => (
                      <li
                        key={i}
                        className="bg-orange-100 text-orange-800 font-semibold px-3 py-1.5 rounded-none text-sm"
                      >
                        {w}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-sm text-[var(--bo-ink-soft)] italic">
                    No scheduled brownout
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className={`rounded-none px-2.5 py-2 ${accent}`}>
      <div className="text-[9px] font-bold uppercase tracking-widest opacity-80">
        {label}
      </div>
      <div className="text-lg font-extrabold leading-none mt-0.5">{value}</div>
    </div>
  );
}
