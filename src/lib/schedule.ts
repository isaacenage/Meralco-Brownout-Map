export interface Barangay {
  name: string;
}

export interface City {
  name: string;
  barangays: string[];
}

export interface Province {
  name: string;
  cities: City[];
}

export interface ScheduleWindow {
  start: string | null;
  end: string | null;
  label: string;
  provinces: Province[];
}

export interface Schedule {
  source_url: string;
  scraped_at: string;
  schedule_date: string | null;
  advisory: string | null;
  windows: ScheduleWindow[];
}

export function countBarangays(w: ScheduleWindow): number {
  let n = 0;
  for (const p of w.provinces) for (const c of p.cities) n += c.barangays.length;
  return n;
}
