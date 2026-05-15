"use client";

import { useEffect, useState } from "react";

export default function IntroPage({ children }: { children: React.ReactNode }) {
  const [dismissed, setDismissed] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    sessionStorage.removeItem("bo-intro-seen");

    const leaveTimer = window.setTimeout(() => {
      setLeaving(true);
      sessionStorage.setItem("bo-intro-seen", "1");
    }, 5000);

    const dismissTimer = window.setTimeout(() => {
      setDismissed(true);
    }, 5650);

    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(dismissTimer);
    };
  }, []);

  return (
    <>
      {!dismissed && (
        <div
          className={`intro-overlay ${leaving ? "intro-leaving" : ""}`}
          role="dialog"
          aria-label="Brownout Na Naman intro"
        >
          <div className="intro-brownout" aria-hidden="true" />

          <div className="intro-content">
            <div className="intro-spark-row" aria-hidden="true">
              <span className="intro-spark" />
              <span className="intro-spark intro-spark-2" />
              <span className="intro-spark intro-spark-3" />
            </div>

            <h1 className="intro-title">
              <span className="intro-line">BROWNOUT</span>
              <span className="intro-line intro-line-2">NA NAMAN!</span>
            </h1>

            <p className="intro-subtitle">by Zenterra</p>
          </div>
        </div>
      )}
      {children}
    </>
  );
}
