"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
} from "maplibre-gl";
import type { Feature, FeatureCollection, Point } from "geojson";
import {
  entriesForDate,
  formatRange,
  formatScheduleDate,
  formatShortDate,
  todayInManila,
  uniqueDates,
  type MaintenanceEntry,
  type MaintenanceSchedule,
} from "@/lib/maintenance";

const MAP_STYLE = "/map-style.json";
const INITIAL_VIEW = { lng: 121.0, lat: 14.65, zoom: 8.5 };

const POINTS_SOURCE = "maintenance-points";
const POINTS_LAYER = "maintenance-points-circle";
const POINTS_HALO_LAYER = "maintenance-points-halo";

const EMPTY_FC: FeatureCollection<Point> = {
  type: "FeatureCollection",
  features: [],
};

type EntryPointFeature = Feature<
  Point,
  {
    slug: string;
    title: string;
    city: string;
    barangay: string;
  }
>;

function buildFeatures(entries: MaintenanceEntry[]): FeatureCollection<Point> {
  const features: EntryPointFeature[] = [];
  for (const e of entries) {
    for (const p of e.points) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        properties: {
          slug: e.slug,
          title: e.title,
          city: p.city,
          barangay: p.barangay,
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

function fitToFeatures(map: MapLibreMap, fc: FeatureCollection<Point>) {
  if (fc.features.length === 0) return;
  const b = new maplibregl.LngLatBounds();
  for (const f of fc.features) {
    const [x, y] = f.geometry.coordinates;
    b.extend([x, y]);
  }
  if (!b.isEmpty()) {
    map.fitBounds(b, { padding: 80, maxZoom: 12, duration: 600 });
  }
}

function ensureLayers(map: MapLibreMap) {
  if (map.getSource(POINTS_SOURCE)) return;
  map.addSource(POINTS_SOURCE, {
    type: "geojson",
    data: EMPTY_FC,
    generateId: true,
  });
  map.addLayer({
    id: POINTS_HALO_LAYER,
    type: "circle",
    source: POINTS_SOURCE,
    paint: {
      "circle-color": "#f97316",
      "circle-opacity": 0.18,
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        7, 10,
        12, 28,
      ],
    },
  });
  map.addLayer({
    id: POINTS_LAYER,
    type: "circle",
    source: POINTS_SOURCE,
    paint: {
      "circle-color": [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        "#1f2937",
        "#ea580c",
      ],
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        7, 4,
        12, 9,
      ],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
    },
  });
}

export default function MaintenanceMap({
  schedule,
}: {
  schedule: MaintenanceSchedule;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapReadyRef = useRef(false);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const selectedFeatureIdRef = useRef<number | string | null>(null);

  const dates = useMemo(() => uniqueDates(schedule.entries), [schedule]);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    if (dates.length === 0) return "";
    const today = todayInManila(new Date());
    const upcoming = dates.find((d) => d >= today);
    return upcoming ?? dates[dates.length - 1];
  });
  const [selectedEntrySlug, setSelectedEntrySlug] = useState<string | null>(
    null,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  const entries = useMemo(
    () => entriesForDate(schedule.entries, selectedDate),
    [schedule, selectedDate],
  );
  const fc = useMemo(() => buildFeatures(entries), [entries]);

  // Initialize the map once.
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
      isMobile ? "bottom-right" : "top-right",
    );

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 8,
      className: "brownout-popup",
    });
    popupRef.current = popup;

    map.on("load", () => {
      ensureLayers(map);
      mapReadyRef.current = true;
    });

    map.on("mousemove", POINTS_LAYER, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const coords = (f.geometry as Point).coordinates as [number, number];
      const props = f.properties as EntryPointFeature["properties"];
      popup
        .setLngLat(coords)
        .setHTML(
          `<div style="font-weight:700;font-size:12px">${escapeHtml(props.barangay)}</div>` +
            `<div style="font-size:11px;color:#6b4a2b">${escapeHtml(props.city)}</div>` +
            `<div style="margin-top:4px;font-size:11px">${escapeHtml(props.title)}</div>`,
        )
        .addTo(map);
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", POINTS_LAYER, () => {
      popup.remove();
      map.getCanvas().style.cursor = "";
    });

    map.on("click", POINTS_LAYER, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const slug = (f.properties as EntryPointFeature["properties"]).slug;
      setSelectedEntrySlug(slug);
      setDrawerOpen(true);
    });

    mapRef.current = map;
    return () => {
      popup.remove();
      map.remove();
      mapRef.current = null;
      mapReadyRef.current = false;
    };
  }, []);

  // Push features whenever they change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      ensureLayers(map);
      const src = map.getSource(POINTS_SOURCE) as GeoJSONSource | undefined;
      if (!src) return;
      src.setData(fc);
      fitToFeatures(map, fc);
    };
    if (mapReadyRef.current) {
      apply();
    } else {
      map.once("load", apply);
    }
  }, [fc]);

  // Reset selected entry when the date changes.
  useEffect(() => {
    setSelectedEntrySlug(null);
  }, [selectedDate]);

  const selectedEntry = useMemo(
    () => entries.find((e) => e.slug === selectedEntrySlug) ?? null,
    [entries, selectedEntrySlug],
  );

  // Highlight the active point on the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    if (selectedFeatureIdRef.current !== null) {
      map.setFeatureState(
        { source: POINTS_SOURCE, id: selectedFeatureIdRef.current },
        { selected: false },
      );
      selectedFeatureIdRef.current = null;
    }
    if (!selectedEntry) return;
    const features = map.querySourceFeatures(POINTS_SOURCE);
    for (const f of features) {
      const props = f.properties as EntryPointFeature["properties"] | undefined;
      if (props && props.slug === selectedEntry.slug && f.id !== undefined) {
        map.setFeatureState(
          { source: POINTS_SOURCE, id: f.id },
          { selected: true },
        );
        selectedFeatureIdRef.current = f.id;
        const [lng, lat] = (f.geometry as Point).coordinates as [
          number,
          number,
        ];
        map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 11) });
        break;
      }
    }
  }, [selectedEntry]);

  return (
    <main className="relative h-[100dvh] w-screen overflow-hidden bg-[var(--bo-cream)]">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none px-3 sm:px-6 pt-3 sm:pt-4">
        <div className="pointer-events-auto flex items-center justify-between gap-2 bg-white/95 backdrop-blur px-3 sm:px-4 py-2 border border-amber-200 shadow-[0_8px_24px_rgba(234,88,12,0.16)]">
          <div className="flex items-center gap-2 min-w-0">
            <a
              href="/"
              className="px-2 py-1 bg-orange-100 hover:bg-orange-200 text-orange-700 text-[11px] font-bold uppercase tracking-widest"
              aria-label="Back to Brownout Map"
            >
              ← Brownout
            </a>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest text-[var(--bo-ink-soft)]">
                Meralco
              </div>
              <div className="text-sm sm:text-base font-bold text-[var(--bo-ink)] truncate">
                Maintenance Schedule
              </div>
            </div>
          </div>
          <div className="text-[10px] text-[var(--bo-ink-soft)] hidden sm:block">
            {schedule.entries.length} entries · {dates.length} dates
          </div>
        </div>
      </div>

      {/* Date pill row */}
      <div className="absolute z-20 left-0 right-0 top-[68px] sm:top-[80px] pointer-events-none px-3 sm:px-6">
        <div className="pointer-events-auto bo-pill-scroll overflow-x-auto flex gap-1.5 py-1">
          {dates.map((d) => {
            const isActive = d === selectedDate;
            const today = todayInManila(new Date());
            const isToday = d === today;
            const isPast = d < today;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setSelectedDate(d)}
                className={[
                  "shrink-0 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest border transition-colors",
                  isActive
                    ? "bg-orange-600 text-white border-orange-600"
                    : isPast
                      ? "bg-white text-[var(--bo-ink-soft)] border-amber-200 hover:bg-amber-50"
                      : "bg-white text-orange-700 border-amber-200 hover:bg-amber-50",
                ].join(" ")}
              >
                <span>{formatShortDate(d)}</span>
                {isToday && (
                  <span className="ml-1.5 inline-block px-1.5 py-0.5 bg-red-500 text-white text-[9px]">
                    TODAY
                  </span>
                )}
              </button>
            );
          })}
          {dates.length === 0 && (
            <div className="px-3 py-1.5 text-[11px] text-[var(--bo-ink-soft)] italic">
              No scheduled maintenance found.
            </div>
          )}
        </div>
      </div>

      {/* Map */}
      <div ref={mapContainerRef} className="absolute inset-0 z-0" />

      {/* Entry list sidebar (desktop) */}
      <aside className="hidden lg:block absolute z-10 top-[140px] bottom-4 right-4 w-[380px] bg-white border border-amber-200 shadow-[0_10px_30px_rgba(234,88,12,0.18)] overflow-hidden">
        <div className="px-4 py-3 border-b border-amber-100">
          <div className="text-[10px] uppercase tracking-widest text-[var(--bo-ink-soft)]">
            {selectedDate ? formatScheduleDate(selectedDate) : "Select a date"}
          </div>
          <div className="text-sm font-bold text-[var(--bo-ink)]">
            {entries.length} affected location{entries.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="bo-scroll overflow-y-auto h-[calc(100%-58px)]">
          {entries.map((e) => (
            <EntryRow
              key={e.slug}
              entry={e}
              active={selectedEntrySlug === e.slug}
              onClick={() => setSelectedEntrySlug(e.slug)}
            />
          ))}
          {entries.length === 0 && (
            <div className="px-4 py-6 text-sm text-[var(--bo-ink-soft)]">
              No maintenance scheduled for this date.
            </div>
          )}
        </div>
      </aside>

      {/* Mobile bottom sheet */}
      <div className="lg:hidden absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
        <div className="pointer-events-auto bg-white border-t border-amber-200 shadow-[0_-10px_30px_rgba(234,88,12,0.18)]">
          <button
            type="button"
            onClick={() => setDrawerOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
            aria-expanded={drawerOpen}
          >
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest text-[var(--bo-ink-soft)]">
                {selectedDate ? formatShortDate(selectedDate) : "—"}
              </div>
              <div className="text-sm font-bold text-[var(--bo-ink)] truncate">
                {entries.length} affected location{entries.length === 1 ? "" : "s"}
              </div>
            </div>
            <span className="text-xs font-bold text-orange-700 uppercase tracking-widest">
              {drawerOpen ? "Close" : "View"}
            </span>
          </button>
          {drawerOpen && (
            <div className="bo-scroll max-h-[55vh] overflow-y-auto border-t border-amber-100">
              {entries.map((e) => (
                <EntryRow
                  key={e.slug}
                  entry={e}
                  active={selectedEntrySlug === e.slug}
                  onClick={() => setSelectedEntrySlug(e.slug)}
                />
              ))}
              {entries.length === 0 && (
                <div className="px-4 py-6 text-sm text-[var(--bo-ink-soft)]">
                  No maintenance scheduled for this date.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Entry detail overlay */}
      {selectedEntry && (
        <EntryDetail
          entry={selectedEntry}
          onClose={() => setSelectedEntrySlug(null)}
        />
      )}
    </main>
  );
}

function EntryRow({
  entry,
  active,
  onClick,
}: {
  entry: MaintenanceEntry;
  active: boolean;
  onClick: () => void;
}) {
  const windowSummary = entry.windows
    .flatMap((w) => w.ranges.map(formatRange))
    .slice(0, 3)
    .join(" · ");
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full text-left px-4 py-3 border-b border-amber-100 transition-colors",
        active
          ? "bg-orange-50"
          : "bg-white hover:bg-amber-50",
      ].join(" ")}
    >
      <div className="text-sm font-bold text-[var(--bo-ink)]">
        {entry.is_province
          ? `${entry.area} — ${entry.locations.join(", ")}`
          : `${entry.area} — ${entry.locations.join(", ")}`}
      </div>
      {windowSummary && (
        <div className="mt-1 text-[11px] uppercase tracking-widest text-orange-700 font-bold">
          {windowSummary}
        </div>
      )}
      {entry.reason && (
        <div className="mt-1 text-xs text-[var(--bo-ink-soft)] line-clamp-2">
          {entry.reason}
        </div>
      )}
    </button>
  );
}

function EntryDetail({
  entry,
  onClose,
}: {
  entry: MaintenanceEntry;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute z-30 inset-x-3 bottom-3 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[440px] bg-white border border-amber-200 shadow-[0_20px_50px_rgba(234,88,12,0.28)] max-h-[80vh] overflow-hidden flex flex-col"
      role="dialog"
      aria-label="Maintenance entry details"
    >
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-amber-100 bg-orange-50">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-orange-700 font-bold">
            {entry.dates.map(formatShortDate).join(" · ")}
          </div>
          <div className="text-sm font-bold text-[var(--bo-ink)] mt-0.5">
            {entry.title}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 px-2 py-1 bg-white border border-amber-300 text-[var(--bo-ink-soft)] hover:bg-amber-100 text-[11px] font-bold uppercase tracking-widest"
        >
          Close
        </button>
      </div>
      <div className="bo-scroll overflow-y-auto px-4 py-3 space-y-4">
        {entry.windows.map((w, i) => (
          <div key={i}>
            <div className="text-[11px] font-bold uppercase tracking-widest text-orange-700">
              {w.ranges.map(formatRange).join(" · ") || "Maintenance window"}
              {w.circuit && (
                <span className="ml-2 px-1.5 py-0.5 bg-amber-100 text-[var(--bo-ink)]">
                  Circuit {w.circuit}
                </span>
              )}
            </div>
            <div className="text-xs text-[var(--bo-ink-soft)] mt-0.5">
              {w.label}
            </div>
            {w.description && (
              <p className="mt-2 text-[13px] leading-relaxed whitespace-pre-line text-[var(--bo-ink)]">
                {w.description}
              </p>
            )}
          </div>
        ))}
        {entry.reason && (
          <div className="border-t border-amber-100 pt-3">
            <div className="text-[10px] uppercase tracking-widest text-[var(--bo-ink-soft)]">
              Reason
            </div>
            <p className="text-[13px] mt-1">{entry.reason}</p>
          </div>
        )}
        <div className="border-t border-amber-100 pt-3 text-[11px] text-[var(--bo-ink-soft)]">
          Source:{" "}
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-700 hover:text-orange-900 font-bold underline"
          >
            company.meralco.com.ph
          </a>
        </div>
      </div>
    </div>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
