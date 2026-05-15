"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, {
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
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(De|Del|Of|And|The|Las|Los)\b/gi, (m) => m.toLowerCase());
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

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const INITIAL_VIEW = { lng: 121.0, lat: 14.65, zoom: 8.5 };

const SOURCE_ID = "affected-barangays";
const FILL_LAYER_ID = "affected-barangays-fill";
const OUTLINE_LAYER_ID = "affected-barangays-outline";

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

function parseTimeStr(t: string | null): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function isLiveNow(
  w: ScheduleWindow,
  scheduleDate: string | null,
  now: Date
): boolean {
  if (!scheduleDate) return false;
  const todayIso = now.toISOString().slice(0, 10);
  if (todayIso !== scheduleDate) return false;
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
  if (map.getSource(SOURCE_ID)) return;
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
      "fill-color": [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        "#facc15",
        "#f97316",
      ],
      "fill-opacity": [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        0.75,
        0.45,
      ],
    },
  });
  map.addLayer({
    id: OUTLINE_LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    paint: {
      "line-color": "#ea580c",
      "line-width": [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        2.5,
        1.1,
      ],
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
  barangays: string[];
}

function sortAndFilterProvinces(
  provinces: Province[],
  query: string
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
      const barangays = !q
        ? city.barangays
        : cityMatches
        ? city.barangays
        : city.barangays.filter((b) => b.toLowerCase().includes(q));
      if (barangays.length > 0) {
        filteredCities.push({ city, barangays });
        total += barangays.length;
      }
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

  // Refresh "now" every 30 seconds so the LIVE badge updates as time passes.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

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

  const totalBarangaysForWindow = useMemo(
    () => (selected ? countBarangays(selected) : 0),
    [selected]
  );
  const keyToWindows = useMemo(() => buildKeyToWindows(schedule), [schedule]);

  const filteredProvinces = useMemo(
    () => sortAndFilterProvinces(selected?.provinces ?? [], searchQuery),
    [selected, searchQuery]
  );

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

  // Reset open state when the user switches time windows.
  useEffect(() => {
    setOpenProvinces(new Set(["METRO MANILA"]));
    setOpenCities(new Set());
  }, [selectedIdx]);

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
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");

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

  return (
    <main className="h-screen w-screen grid grid-cols-1 lg:grid-cols-[1fr_440px] grid-rows-[auto_1fr] lg:grid-rows-1 bg-[var(--bo-cream)]">
      <div className="relative">
        <div ref={mapContainerRef} className="absolute inset-0" />

        {/* Top-left status / live banner */}
        <div className="absolute top-4 left-4 right-4 lg:right-auto lg:max-w-[520px] z-10">
          <div className="bg-white/95 backdrop-blur-md border border-amber-200 rounded-2xl shadow-[0_10px_30px_rgba(234,88,12,0.18)] overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-orange-500 via-orange-400 to-yellow-400">
              <span className="live-dot" aria-hidden />
              <div className="text-white font-bold tracking-wide text-sm">
                LIVE · Meralco Rotational Brownout
              </div>
              <div className="ml-auto text-[10px] uppercase tracking-widest text-white/90 font-semibold">
                Realtime Monitor
              </div>
            </div>
            <div className="px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[var(--bo-ink-soft)]">
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
              <div className="ml-auto text-[11px]">
                Updated{" "}
                <span className="font-semibold text-[var(--bo-ink)]">
                  {new Date(schedule.scraped_at).toLocaleString()}
                </span>
              </div>
            </div>
            <div className="px-4 pb-3 -mt-1 text-[11px] font-medium">
              {status === "loading" && (
                <span className="inline-flex items-center gap-1.5 text-orange-700">
                  <span className="inline-block w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                  Loading polygons…
                </span>
              )}
              {status === "error" && (
                <span className="text-red-600">Failed to load polygons</span>
              )}
              {status === "idle" && selected && (
                <span className="text-[var(--bo-ink-soft)]">
                  <span className="font-bold text-orange-600">
                    {matchedCount}
                  </span>{" "}
                  of{" "}
                  <span className="font-bold text-[var(--bo-ink)]">
                    {totalBarangaysForWindow}
                  </span>{" "}
                  barangays mapped
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <aside className="overflow-hidden bg-white border-l border-amber-200 flex flex-col">
        {/* Time window picker */}
        <div className="p-4 border-b border-amber-200 bg-gradient-to-b from-yellow-50 to-white">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-orange-700">
              Time Window
            </h2>
            {liveWindowIdx >= 0 && (
              <button
                onClick={() => setSelectedIdx(liveWindowIdx)}
                className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-500 text-white inline-flex items-center gap-1 hover:bg-red-600 transition"
                title="Jump to currently active window"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                Live now
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {schedule.windows.map((w, i) => {
              const live = i === liveWindowIdx;
              const isSelected = i === selectedIdx;
              const count = countBarangays(w);
              return (
                <button
                  key={w.label}
                  onClick={() => setSelectedIdx(i)}
                  className={
                    "group relative text-left rounded-xl border px-3 py-2 transition focus:outline-none focus:ring-2 focus:ring-orange-400 " +
                    (isSelected
                      ? "bg-gradient-to-br from-orange-500 to-orange-600 border-orange-600 text-white shadow-md shadow-orange-300"
                      : "bg-white border-amber-200 text-[var(--bo-ink)] hover:border-orange-400 hover:bg-orange-50")
                  }
                >
                  {live && (
                    <span
                      className={
                        "absolute -top-1 -right-1 text-[8px] font-bold uppercase tracking-wider px-1.5 py-[1px] rounded-full " +
                        (isSelected
                          ? "bg-yellow-300 text-orange-900"
                          : "bg-red-500 text-white")
                      }
                    >
                      Live
                    </span>
                  )}
                  <div
                    className={
                      "text-[10px] uppercase tracking-wider font-semibold " +
                      (isSelected ? "text-orange-100" : "text-orange-600")
                    }
                  >
                    {shortTime(w.start)}
                  </div>
                  <div className="text-sm font-bold leading-tight">
                    → {shortTime(w.end)}
                  </div>
                  <div
                    className={
                      "mt-1 text-[10px] font-medium " +
                      (isSelected ? "text-orange-100" : "text-[var(--bo-ink-soft)]")
                    }
                  >
                    {count} barangay{count === 1 ? "" : "s"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Summary + Search */}
        <div className="px-4 pt-3 pb-2 border-b border-amber-100">
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
              className="w-full bg-white border border-amber-200 rounded-xl pl-9 pr-9 py-2 text-sm text-[var(--bo-ink)] placeholder:text-[var(--bo-ink-soft)]/60 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-orange-400"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--bo-ink-soft)] hover:text-orange-700 rounded-full w-6 h-6 inline-flex items-center justify-center hover:bg-orange-100"
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
                  className="rounded-xl border border-amber-200 bg-white overflow-hidden"
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
                    <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-600 text-white">
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
                              <span className="ml-auto text-[10px] font-semibold text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded-full">
                                {fc.barangays.length}
                              </span>
                            </button>
                            {isCityOpen && (
                              <ul className="bo-accordion-content pl-8 pr-3 pb-2 grid grid-cols-1 gap-0.5">
                                {fc.barangays.map((b, idx) => (
                                  <li
                                    key={`${cityKey}-${b}-${idx}`}
                                    className="text-[12px] text-[var(--bo-ink-soft)] py-0.5 px-2 rounded hover:bg-yellow-100 hover:text-[var(--bo-ink)] transition cursor-default flex items-center gap-2"
                                  >
                                    <span className="w-1 h-1 rounded-full bg-orange-400 flex-shrink-0" />
                                    <span className="truncate">
                                      {highlight(b, searchQuery)}
                                    </span>
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
          <div className="px-4 py-3 border-t border-amber-200 bg-yellow-50 text-[11px] text-[var(--bo-ink-soft)] leading-relaxed">
            <span className="font-bold text-orange-700 uppercase tracking-wider text-[10px] block mb-1">
              Advisory
            </span>
            {schedule.advisory}
          </div>
        )}
      </aside>
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
    <div className={`rounded-xl px-2.5 py-2 ${accent}`}>
      <div className="text-[9px] font-bold uppercase tracking-widest opacity-80">
        {label}
      </div>
      <div className="text-lg font-extrabold leading-none mt-0.5">{value}</div>
    </div>
  );
}
