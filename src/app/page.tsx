import Link from "next/link";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import BrownoutMap from "@/components/BrownoutMap";
import IntroPage from "@/components/IntroPage";
import LocationPrompt from "@/components/LocationPrompt";
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
      <IntroPage>
      <main className="min-h-screen min-h-[100dvh] bg-gradient-to-br from-yellow-50 via-orange-50 to-white flex items-center justify-center p-6 sm:p-8 intro-safe-pad">
        <div className="max-w-md text-center bg-white border border-amber-200 rounded-none shadow-[0_10px_30px_rgba(234,88,12,0.18)] p-8">
          <div className="inline-flex items-center gap-2 mb-3 px-3 py-1 rounded-none bg-orange-100 text-orange-700 text-[11px] font-bold uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-none bg-orange-500" />
            No data yet
          </div>
          <h1 className="text-xl font-bold text-[var(--bo-ink)]">
            Meralco Rotational Brownout Map
          </h1>
          <p className="mt-2 text-sm text-[var(--bo-ink-soft)]">
            Run{" "}
            <code className="px-1.5 py-0.5 bg-yellow-100 text-orange-700 rounded-none font-semibold">
              npm run scrape
            </code>{" "}
            to fetch the latest brownout schedule.
          </p>
          <div className="mt-5 pt-4 border-t border-amber-100 text-[10px] text-[var(--bo-ink-soft)] flex items-center justify-between gap-2">
            <span>Unofficial · Not affiliated with Meralco or NGCP</span>
            <Link
              href="/legal"
              className="font-bold uppercase tracking-widest text-orange-700 hover:text-orange-900"
            >
              Terms &amp; Privacy
            </Link>
          </div>
        </div>
      </main>
      </IntroPage>
    );
  }

  return (
    <IntroPage>
      <LocationPrompt schedule={schedule}>
        <BrownoutMap schedule={schedule} />
      </LocationPrompt>
    </IntroPage>
  );
}
