import Link from "next/link";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import MaintenanceMap from "@/components/MaintenanceMap";
import type { MaintenanceSchedule } from "@/lib/maintenance";

export const metadata = {
  title: "Meralco Maintenance Schedule",
  description:
    "Daily-scraped, barangay-pinned view of Meralco's planned maintenance schedule.",
};

async function loadSchedule(): Promise<MaintenanceSchedule | null> {
  try {
    const path = join(
      process.cwd(),
      "public",
      "data",
      "maintenance",
      "all.json",
    );
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as MaintenanceSchedule;
  } catch {
    return null;
  }
}

export default async function MaintenancePage() {
  const schedule = await loadSchedule();

  if (!schedule || schedule.entries.length === 0) {
    return (
      <main className="min-h-screen min-h-[100dvh] bg-gradient-to-br from-yellow-50 via-orange-50 to-white flex items-center justify-center p-6 sm:p-8">
        <div className="max-w-md text-center bg-white border border-amber-200 rounded-none shadow-[0_10px_30px_rgba(234,88,12,0.18)] p-8">
          <div className="inline-flex items-center gap-2 mb-3 px-3 py-1 rounded-none bg-orange-100 text-orange-700 text-[11px] font-bold uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-none bg-orange-500" />
            No data yet
          </div>
          <h1 className="text-xl font-bold text-[var(--bo-ink)]">
            Maintenance Schedule
          </h1>
          <p className="mt-2 text-sm text-[var(--bo-ink-soft)]">
            Run{" "}
            <code className="px-1.5 py-0.5 bg-yellow-100 text-orange-700 rounded-none font-semibold">
              python scripts/scrape_maintenance.py
            </code>{" "}
            to populate this page with Meralco&apos;s upcoming maintenance
            advisories.
          </p>
          <div className="mt-5 pt-4 border-t border-amber-100 text-[10px] text-[var(--bo-ink-soft)] flex items-center justify-between gap-2">
            <Link
              href="/"
              className="font-bold uppercase tracking-widest text-orange-700 hover:text-orange-900"
            >
              ← Back to Brownout Map
            </Link>
            <Link
              href="/legal"
              className="font-bold uppercase tracking-widest text-orange-700 hover:text-orange-900"
            >
              Terms &amp; Privacy
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return <MaintenanceMap schedule={schedule} />;
}
