import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service & Privacy Policy — Meralco Brownout Map",
  description:
    "Independent, public-use brownout schedule viewer built by Zenterra Systems. Not affiliated with Meralco or NGCP.",
};

export default function LegalPage() {
  return (
    <main className="min-h-screen min-h-[100dvh] bg-gradient-to-br from-yellow-50 via-orange-50 to-white">
      <div className="max-w-3xl mx-auto px-[max(1.25rem,env(safe-area-inset-left))] sm:px-8 py-10 sm:py-14" style={{ paddingRight: "max(1.25rem, env(safe-area-inset-right))" }}>
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-orange-700 hover:text-orange-900 transition"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            Back to map
          </Link>
        </div>

        <header className="mb-10">
          <div className="inline-flex items-center gap-2 mb-3 px-3 py-1 rounded-none bg-orange-100 text-orange-700 text-[10px] font-bold uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-none bg-orange-500" />
            Legal & About
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-[var(--bo-ink)] leading-tight">
            Terms of Service & Privacy Policy
          </h1>
          <p className="mt-3 text-sm text-[var(--bo-ink-soft)]">
            Last updated: May 15, 2026
          </p>
        </header>

        {/* Affiliation disclaimer — prominent */}
        <section className="mb-10 rounded-none border-2 border-orange-300 bg-white p-5 sm:p-6 shadow-[0_10px_30px_rgba(234,88,12,0.12)]">
          <div className="text-[10px] font-bold uppercase tracking-widest text-orange-700 mb-2">
            Important Disclaimer
          </div>
          <h2 className="text-xl font-extrabold text-[var(--bo-ink)] mb-3">
            This app is not affiliated with Meralco or NGCP.
          </h2>
          <p className="text-sm leading-relaxed text-[var(--bo-ink-soft)]">
            The Meralco Brownout Map is an{" "}
            <span className="font-semibold text-[var(--bo-ink)]">
              independent, unofficial tool
            </span>{" "}
            built and operated by{" "}
            <span className="font-semibold text-[var(--bo-ink)]">
              Zenterra Systems
            </span>
            . We have no relationship, partnership, endorsement, or affiliation
            with Manila Electric Company (Meralco), the National Grid
            Corporation of the Philippines (NGCP), the Department of Energy, or
            any government agency or utility provider. All trademarks, names,
            and brands referenced belong to their respective owners and are
            used here only for identification.
          </p>
        </section>

        {/* About / origin story */}
        <Section title="About this app">
          <p>
            Honestly, the whole thing started because the developer&apos;s
            girlfriend kept digging through Facebook posts and news feeds
            every time there was a brownout advisory, trying to find their
            barangay in those super long lists.
          </p>
          <p>
            It wasn&apos;t even really bothering him. He just felt bad
            watching her struggle through every post just to check if they
            were affected, so he figured why not just automate the lookup
            and make it easier for her.
          </p>
          <p>
            The result turned out to be useful beyond a household of two, so
            it&apos;s now freely available to the public. Anyone living in or
            around Meralco&apos;s service area is welcome to use it — no
            account, no payment, no strings.
          </p>
        </Section>

        {/* Data sources */}
        <Section title="Where the data comes from">
          <p>
            Brownout schedules shown here are aggregated in near real time
            from publicly available sources, including:
          </p>
          <ul className="list-disc pl-6 space-y-1.5 text-sm">
            <li>The official Meralco website and its public advisories</li>
            <li>News outlets and online news articles</li>
            <li>Public Facebook posts and pages that republish advisories</li>
            <li>Other publicly shared posts and screenshots</li>
          </ul>
          <p>
            Because the underlying sources can be inconsistent, late, or
            occasionally inaccurate, the schedule shown here can be too —
            despite our best effort to keep it correct. Always confirm
            critical decisions (medical equipment, business operations,
            travel, etc.) against the official Meralco channels.
          </p>
        </Section>

        {/* Terms of Service */}
        <Section title="Terms of Service">
          <h3 className="text-base font-bold text-[var(--bo-ink)] mt-2">
            1. Acceptance
          </h3>
          <p>
            By accessing or using this app, you agree to these terms. If you
            do not agree, please do not use the app.
          </p>

          <h3 className="text-base font-bold text-[var(--bo-ink)]">
            2. Free public use
          </h3>
          <p>
            The app is provided free of charge to the general public for
            personal, non-commercial informational use. You may share it with
            friends, family, neighbors, building admins, or anyone else who
            might find it useful.
          </p>

          <h3 className="text-base font-bold text-[var(--bo-ink)]">
            3. No warranty &amp; accuracy
          </h3>
          <p>
            The app is provided{" "}
            <span className="font-semibold text-[var(--bo-ink)]">
              &quot;as is&quot;
            </span>
            , without warranties of any kind, express or implied. We do not
            guarantee that brownout windows, barangay lists, time ranges, or
            map polygons are accurate, complete, current, or free of errors.
            Scraping public sources is inherently imperfect.
          </p>
          <p>
            <span className="font-semibold text-[var(--bo-ink)]">
              Do not rely on this app as a sole source of truth
            </span>{" "}
            for any decision that has health, safety, financial, or
            operational consequences. The authoritative source remains
            Meralco&apos;s official advisories.
          </p>

          <h3 className="text-base font-bold text-[var(--bo-ink)]">
            4. Limitation of liability
          </h3>
          <p>
            To the maximum extent permitted by law, Zenterra Systems and the
            developer are not liable for any direct, indirect, incidental,
            consequential, or special damages arising from your use of (or
            inability to use) this app — including missed appointments,
            spoiled food, lost work, equipment damage, or any other
            inconvenience caused by inaccurate or outdated schedule
            information.
          </p>

          <h3 className="text-base font-bold text-[var(--bo-ink)]">
            5. Acceptable use
          </h3>
          <p>You agree not to:</p>
          <ul className="list-disc pl-6 space-y-1.5 text-sm">
            <li>
              Misrepresent this app as an official Meralco, NGCP, or
              government product.
            </li>
            <li>
              Use automated tools to overload, scrape, or disrupt the site
              beyond what a normal browser would request.
            </li>
            <li>
              Resell or repackage the data as a paid product without
              independently verifying it with the original sources.
            </li>
          </ul>

          <h3 className="text-base font-bold text-[var(--bo-ink)]">
            6. Changes &amp; availability
          </h3>
          <p>
            The app may change, break, go offline, or be discontinued at any
            time without notice. These terms may also be updated; continued
            use after changes constitutes acceptance.
          </p>
        </Section>

        {/* Privacy Policy */}
        <Section title="Privacy Policy">
          <h3 className="text-base font-bold text-[var(--bo-ink)] mt-2">
            1. What we collect
          </h3>
          <p>
            We aim to collect as little as possible. The app does not require
            an account, login, email, name, location permission, or any other
            personal identifier to be used.
          </p>
          <p>
            Standard web server logs (IP address, user-agent, timestamps,
            referrer, requested paths) may be recorded by our hosting
            provider for security, abuse prevention, and basic operational
            metrics. These logs are not used to profile individual users and
            are rotated on a routine schedule.
          </p>

          <h3 className="text-base font-bold text-[var(--bo-ink)]">
            2. Cookies &amp; local storage
          </h3>
          <p>
            The app does not set advertising or tracking cookies. It may use
            local browser storage purely for UI state (such as remembering
            which sidebar section you had open). This data stays on your
            device and is not transmitted to us.
          </p>

          <h3 className="text-base font-bold text-[var(--bo-ink)]">
            3. Map tiles &amp; third-party services
          </h3>
          <p>
            Map tiles and styles are loaded from external map providers.
            Those requests are subject to the respective provider&apos;s
            privacy policy. We do not pass any personal information to them
            beyond what your browser includes by default when fetching a
            resource (such as IP and user-agent).
          </p>

          <h3 className="text-base font-bold text-[var(--bo-ink)]">
            4. No sale of data
          </h3>
          <p>
            We do not sell, rent, or trade any user data. There is nothing
            personal to sell.
          </p>

          <h3 className="text-base font-bold text-[var(--bo-ink)]">
            5. Children
          </h3>
          <p>
            The app is suitable for all ages and does not knowingly collect
            information from anyone, children included.
          </p>

          <h3 className="text-base font-bold text-[var(--bo-ink)]">
            6. Contact
          </h3>
          <p>
            Questions, corrections, or takedown requests about a specific
            data point can be sent to Zenterra Systems. We&apos;ll do our
            best to respond, though this is a hobby project — response times
            depend on real-life availability.
          </p>
        </Section>

        <footer className="mt-12 pt-6 border-t border-amber-200 text-xs text-[var(--bo-ink-soft)] flex flex-wrap items-center justify-between gap-3">
          <div>
            Built by{" "}
            <span className="font-semibold text-[var(--bo-ink)]">
              Zenterra Systems
            </span>
            . Independent &amp; unaffiliated.
          </div>
          <Link
            href="/"
            className="font-bold uppercase tracking-widest text-orange-700 hover:text-orange-900"
          >
            ← Back to map
          </Link>
        </footer>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="text-xl sm:text-2xl font-extrabold text-[var(--bo-ink)] mb-3">
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-[var(--bo-ink-soft)]">
        {children}
      </div>
    </section>
  );
}
