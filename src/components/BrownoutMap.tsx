"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import { countBarangays, type Schedule, type ScheduleWindow } from "@/lib/schedule";

// OpenFreeMap's hosted style — no API key, OSM data.
// https://openfreemap.org
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

// Center on the Meralco franchise area (greater Metro Manila + Luzon).
const INITIAL_VIEW = { lng: 121.0, lat: 14.65, zoom: 8.5 };

function formatRange(w: ScheduleWindow): string {
  return w.label.replace(/^Between\s+/i, "");
}

export default function BrownoutMap({ schedule }: { schedule: Schedule }) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const selected = schedule.windows[selectedIdx];
  const totalBarangaysForWindow = useMemo(
    () => (selected ? countBarangays(selected) : 0),
    [selected]
  );

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
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <main className="h-screen w-screen grid grid-cols-1 lg:grid-cols-[1fr_420px] grid-rows-[auto_1fr] lg:grid-rows-1">
      <div className="relative">
        <div ref={mapContainerRef} className="absolute inset-0" />
        <div className="absolute top-3 left-3 bg-black/70 backdrop-blur px-3 py-2 rounded text-sm">
          <div className="font-semibold">Meralco Rotational Brownout</div>
          <div className="text-xs text-gray-300">
            {schedule.schedule_date ?? "date unknown"} ·{" "}
            {schedule.windows.length} time window
            {schedule.windows.length === 1 ? "" : "s"} · scraped{" "}
            {new Date(schedule.scraped_at).toLocaleString()}
          </div>
        </div>
      </div>

      <aside className="overflow-y-auto bg-[#0b1220] border-l border-gray-800">
        <div className="p-4 border-b border-gray-800">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400 mb-2">
            Time window
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {schedule.windows.map((w, i) => (
              <button
                key={w.label}
                onClick={() => setSelectedIdx(i)}
                className={
                  "text-xs px-2.5 py-1.5 rounded border transition " +
                  (i === selectedIdx
                    ? "bg-orange-600 border-orange-500 text-white"
                    : "bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800")
                }
              >
                {formatRange(w)}
              </button>
            ))}
          </div>
          {selected && (
            <p className="mt-3 text-xs text-gray-400">
              {selected.provinces.length} provinces ·{" "}
              {selected.provinces.reduce((a, p) => a + p.cities.length, 0)}{" "}
              cities/municipalities · {totalBarangaysForWindow} barangays
            </p>
          )}
        </div>

        <div className="p-4 space-y-4">
          {selected?.provinces.map((province) => (
            <section key={province.name}>
              <h3 className="text-sm font-semibold text-orange-300">
                {province.name}
              </h3>
              <div className="mt-2 space-y-2">
                {province.cities.map((city) => (
                  <div key={city.name} className="text-xs">
                    <div className="font-medium text-gray-200">{city.name}</div>
                    <ul className="mt-0.5 pl-3 text-gray-400 leading-relaxed">
                      {city.barangays.map((b, idx) => (
                        <li key={`${city.name}-${b}-${idx}`}>{b}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {schedule.advisory && (
          <div className="p-4 border-t border-gray-800 text-xs text-gray-500 leading-relaxed">
            {schedule.advisory}
          </div>
        )}
      </aside>
    </main>
  );
}
