import { readFile } from "node:fs/promises";
import { join } from "node:path";
import BrownoutMap from "@/components/BrownoutMap";
import type { Schedule } from "@/lib/schedule";

async function loadSchedule(): Promise<Schedule | null> {
  try {
    const path = join(process.cwd(), "public", "data", "latest.json");
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as Schedule;
  } catch {
    return null;
  }
}

export default async function Page() {
  const schedule = await loadSchedule();

  if (!schedule) {
    return (
      <main className="p-8">
        <h1 className="text-xl font-semibold">No schedule data yet</h1>
        <p className="mt-2 text-sm text-gray-400">
          Run <code className="px-1 py-0.5 bg-gray-800 rounded">npm run scrape</code> to fetch the latest brownout schedule.
        </p>
      </main>
    );
  }

  return <BrownoutMap schedule={schedule} />;
}
