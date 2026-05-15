"use client";

import { useEffect, useRef, useState } from "react";
import type { Schedule } from "@/lib/schedule";
import {
  checkByCoords,
  checkByName,
  type LocationMatch,
  type MatchedWindow,
} from "@/lib/locationCheck";

type Phase = "waiting" | "prompt" | "detecting" | "result" | "dismissed";

const STORAGE_KEY = "bo-location-detected-v2";
const INTRO_FLAG = "bo-intro-seen";

function toTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

function detectedLine(match: LocationMatch): string {
  const parts: string[] = [];
  if (match.barangay) parts.push(toTitle(match.barangay));
  if (match.city) parts.push(toTitle(match.city));
  return parts.join(", ");
}

function formatHHMM(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, "0")}${period}`;
}

function rangeLabel(w: MatchedWindow): string {
  if (w.start && w.end) return `${formatHHMM(w.start)}–${formatHHMM(w.end)}`;
  return w.label;
}

function windowDate(scheduleDate: string | null, hhmm: string | null): Date | null {
  if (!scheduleDate || !hhmm) return null;
  const [Y, M, D] = scheduleDate.split("-").map(Number);
  const [h, m] = hhmm.split(":").map(Number);
  if (![Y, M, D, h, m].every(Number.isFinite)) return null;
  return new Date(Y, M - 1, D, h, m, 0, 0);
}

type Bucket = "past" | "current" | "future";

function classifyWindow(
  w: MatchedWindow,
  scheduleDate: string | null,
  now: Date
): Bucket {
  const start = windowDate(scheduleDate, w.start);
  const end = windowDate(scheduleDate, w.end);
  if (end && end.getTime() < now.getTime()) return "past";
  if (start && start.getTime() > now.getTime()) return "future";
  if (start && end) return "current";
  // No times available — show as future (forward-looking) by default.
  return "future";
}

function bucketWindows(
  windows: MatchedWindow[] | undefined,
  scheduleDate: string | null
): { past: string[]; current: string[]; future: string[] } {
  const now = new Date();
  const out = { past: [] as string[], current: [] as string[], future: [] as string[] };
  if (!windows) return out;
  for (const w of windows) {
    const label = rangeLabel(w);
    out[classifyWindow(w, scheduleDate, now)].push(label);
  }
  return out;
}

export default function LocationPrompt({
  schedule,
  children,
}: {
  schedule: Schedule;
  children: React.ReactNode;
}) {
  const [phase, setPhase] = useState<Phase>("waiting");
  const [match, setMatch] = useState<LocationMatch | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Hold off rendering the prompt until IntroPage has dismissed itself.
  // IntroPage writes "bo-intro-seen=1" to sessionStorage on exit; we poll
  // for that signal so any future timing change in IntroPage stays in sync.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as LocationMatch;
        setMatch(parsed);
        setPhase("result");
        return;
      }
    } catch {
      // Corrupt storage — ignore and continue to the prompt flow.
    }

    const introDone = () => sessionStorage.getItem(INTRO_FLAG) === "1";
    if (introDone()) {
      setPhase("prompt");
      return;
    }
    const id = window.setInterval(() => {
      if (introDone()) {
        window.clearInterval(id);
        setPhase("prompt");
      }
    }, 150);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (phase === "prompt") inputRef.current?.focus();
  }, [phase]);

  function finish(result: LocationMatch) {
    setMatch(result);
    setPhase("result");
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result));
    } catch {
      // sessionStorage may be unavailable (private mode); banner still works.
    }
  }

  function handleGeolocate() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Geolocation is not available on this device.");
      return;
    }
    setError(null);
    setPhase("detecting");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const result = await checkByCoords(
            pos.coords.longitude,
            pos.coords.latitude,
            schedule
          );
          finish(result);
        } catch (err) {
          console.error("checkByCoords failed", err);
          setError("Hindi mahanap ang barangay mo. Subukan ang manual input.");
          setPhase("prompt");
        }
      },
      (err) => {
        console.warn("geolocation denied/failed", err);
        const msg =
          err.code === err.PERMISSION_DENIED
            ? "Hindi pinayagan ang location access. Subukan ang manual input."
            : "Hindi makuha ang location mo. Subukan ang manual input.";
        setError(msg);
        setPhase("prompt");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60_000 }
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const raw = input.trim();
    if (raw.length < 3) {
      setError("Type at least 3 characters.");
      return;
    }
    setError(null);
    setPhase("detecting");
    try {
      // checkByName preserves the raw query in `result.query`, so a no-hit
      // response carries enough context for the "walang brownout" banner.
      const result = await checkByName(raw, schedule);
      finish(result);
    } catch (err) {
      console.error("checkByName failed", err);
      setError("Hindi mahanap ang barangay mo. Subukan muli.");
      setPhase("prompt");
    }
  }

  function handleSkip() {
    setPhase("dismissed");
  }

  function handleCloseBanner() {
    setPhase("dismissed");
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  const showOverlay = phase === "prompt" || phase === "detecting";
  const showBanner = phase === "result" && match !== null;

  return (
    <>
      {children}
      {showOverlay && (
        <div
          className="loc-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Saan ka nakatira"
        >
          <div className="loc-card">
            <div className="loc-eyebrow">Quick check</div>
            <h2 className="loc-headline">
              May brownout ba sa
              <br />
              barangay ko today?
            </h2>
            <p className="loc-sub">
              I-share ang location mo o i-type ang pangalan ng iyong barangay,
              munisipalidad, o probinsya.
            </p>

            <button
              type="button"
              className="loc-geo-btn"
              onClick={handleGeolocate}
              disabled={phase === "detecting"}
            >
              <svg
                className="loc-geo-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
              {phase === "detecting" ? "Hinahanap…" : "Use my location"}
            </button>

            <div className="loc-divider">
              <span>or</span>
            </div>

            <form onSubmit={handleSubmit} className="loc-form">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="e.g. Bagumbayan Quezon City"
                className="loc-input"
                disabled={phase === "detecting"}
                aria-label="Barangay, city, or province"
              />
              <button
                type="submit"
                className="loc-submit"
                disabled={phase === "detecting"}
              >
                Enter
              </button>
            </form>

            {error && <p className="loc-error">{error}</p>}

            <button type="button" className="loc-skip" onClick={handleSkip}>
              Skip — just show me the map
            </button>
          </div>
        </div>
      )}

      {showBanner && match && (() => {
        const buckets = match.isAffected
          ? bucketWindows(match.windows, schedule.schedule_date)
          : { past: [], current: [], future: [] };
        const onlyPast =
          match.isAffected &&
          buckets.past.length > 0 &&
          buckets.current.length === 0 &&
          buckets.future.length === 0;
        return (
          <div className="loc-banner-wrap" role="status" aria-live="polite">
            <div
              className={
                "loc-banner " +
                (match.isAffected ? "loc-banner-bad" : "loc-banner-good")
              }
            >
              <button
                type="button"
                className="loc-banner-close"
                onClick={handleCloseBanner}
                aria-label="Close"
              >
                ×
              </button>
              {match.isAffected ? (
                <>
                  <div className="loc-banner-eyebrow">
                    {onlyPast ? "Tapos na!" : "Malas mo!"}
                  </div>
                  {buckets.past.length > 0 && (
                    <div className="loc-banner-text">
                      Nagka-brownout sa inyo kaninang{" "}
                      <span className="loc-banner-time">
                        {buckets.past.join(" · ")}
                      </span>
                    </div>
                  )}
                  {buckets.current.length > 0 && (
                    <div className="loc-banner-text">
                      {buckets.past.length > 0 ? "At may " : "May "}
                      brownout sa inyo ngayong{" "}
                      <span className="loc-banner-time">
                        {buckets.current.join(" · ")}
                      </span>
                    </div>
                  )}
                  {buckets.future.length > 0 && (
                    <div className="loc-banner-text">
                      {buckets.past.length > 0 || buckets.current.length > 0
                        ? "At magkakaroon ng "
                        : "May "}
                      brownout sa inyo mamayang{" "}
                      <span className="loc-banner-time">
                        {buckets.future.join(" · ")}
                      </span>
                    </div>
                  )}
                  {detectedLine(match) && (
                    <div className="loc-banner-sub">{detectedLine(match)}</div>
                  )}
                </>
              ) : (
                <>
                  <div className="loc-banner-eyebrow">Yehey!</div>
                  <div className="loc-banner-text">Walang brownout today!</div>
                  {match.query && (
                    <div className="loc-banner-sub">
                      Hinanap: {toTitle(match.query)}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}
    </>
  );
}
