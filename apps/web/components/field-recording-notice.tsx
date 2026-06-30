"use client";

import { useEffect, useState } from "react";

type FieldRecordingNoticeProps = {
  tenantSlug: string;
};

export function FieldRecordingNotice({
  tenantSlug,
}: FieldRecordingNoticeProps) {
  const storageKey = `vizitum:${tenantSlug}:voice-notice:v1`;
  const [isReady, setIsReady] = useState(false);
  const [isAccepted, setIsAccepted] = useState(false);

  useEffect(() => {
    setIsAccepted(window.localStorage.getItem(storageKey) === "accepted");
    setIsReady(true);
  }, [storageKey]);

  function acceptNotice() {
    window.localStorage.setItem(storageKey, "accepted");
    setIsAccepted(true);
  }

  if (!isReady || isAccepted) {
    return null;
  }

  return (
    <section className="notice-panel" aria-labelledby="voice-notice-title">
      <div>
        <p className="eyebrow">Voice notes</p>
        <h2 id="voice-notice-title">Before the first recording</h2>
        <p>
          Voice notes may be transcribed and processed by AI for visit reports.
          Audio and transcripts are temporary processing data; the confirmed
          report is reviewed before it becomes official.
        </p>
      </div>
      <button className="primary-button" type="button" onClick={acceptNotice}>
        Acknowledge
      </button>
    </section>
  );
}
