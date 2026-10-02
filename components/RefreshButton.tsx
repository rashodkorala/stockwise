"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Fetches the latest holdings for these funds (and the funds they hold),
 * bypassing the 12-hour cache, then reloads the page's data.
 */
export default function RefreshButton({ symbols, onRefreshed }: { symbols: string[]; onRefreshed?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");

  async function refresh() {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      if (body.tickers.length === 0) setNote("Refreshed moments ago");
      if (onRefreshed) onRefreshed();
      else startTransition(() => router.refresh());
    } catch (err) {
      setNote(`Refresh failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const working = busy || pending;
  return (
    <span className="toolbar">
      <button
        className="btn-ghost"
        onClick={refresh}
        disabled={working}
        title="Data is cached for up to 12 hours; this fetches the latest from the source now"
      >
        {working ? "Refreshing…" : "↻ Refresh data"}
      </button>
      {note && (
        <span className="muted" role="status">
          {note}
        </span>
      )}
    </span>
  );
}
