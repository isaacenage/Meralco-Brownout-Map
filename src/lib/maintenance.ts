// Shape of public/data/maintenance/all.json, produced by
// scripts/scrape_maintenance.py.

export interface MaintenanceTimeRange {
  start: string; // "HH:MM" 24h
  end: string;
}

export interface MaintenanceWindow {
  label: string;
  ranges: MaintenanceTimeRange[];
  circuit: string | null;
  description: string;
}

export interface MaintenancePoint {
  barangay: string;
  city: string;
  lat: number;
  lng: number;
  source: string;
}

export interface MaintenanceEntry {
  slug: string;
  url: string;
  title: string;
  dates: string[]; // ISO YYYY-MM-DD
  area: string;
  is_province: boolean;
  locations: string[];
  city: string;
  barangays: string[];
  windows: MaintenanceWindow[];
  reason: string | null;
  points: MaintenancePoint[];
}

export interface MaintenanceSchedule {
  source_url: string;
  scraped_at: string;
  entries: MaintenanceEntry[];
}

export function todayInManila(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function uniqueDates(entries: MaintenanceEntry[]): string[] {
  const set = new Set<string>();
  for (const e of entries) for (const d of e.dates) set.add(d);
  return Array.from(set).sort();
}

export function entriesForDate(
  entries: MaintenanceEntry[],
  date: string,
): MaintenanceEntry[] {
  return entries.filter((e) => e.dates.includes(date));
}

export function formatScheduleDate(iso: string): string {
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

export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

export function formatTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const period = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return min === "00" ? `${h}${period}` : `${h}:${min}${period}`;
}

export function formatRange(r: MaintenanceTimeRange): string {
  return `${formatTime(r.start)}–${formatTime(r.end)}`;
}
