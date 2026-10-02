import { SOURCE_LABELS } from "@/lib/format";
import type { SourceAttempt } from "@/lib/types";

export function LoadError({ title, error, attempts }: { title: string; error: string; attempts: SourceAttempt[] }) {
  return (
    <div className="notice error" role="alert">
      <strong>{title}</strong>: {error}
      {attempts.length > 0 && (
        <ul>
          {attempts.map((a, i) => (
            <li key={i}>
              {SOURCE_LABELS[a.source] ?? a.source}: {a.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FundSources({ funds }: { funds: { ticker: string; asOf?: string; source?: string; error?: string }[] }) {
  const seen = new Set<string>();
  const unique = funds.filter((f) => (seen.has(f.ticker) ? false : (seen.add(f.ticker), true)));
  const failed = unique.filter((f) => f.error);
  const sample = unique.some((f) => f.source === "sample");
  return (
    <>
      {sample && (
        <div className="notice">
          Showing <strong>sample data</strong> (STOCKWISE_FIXTURES=1). Weights are illustrative and cover only the largest holdings.
        </div>
      )}
      {failed.length > 0 && (
        <div className="notice error">
          Could not look through {failed.map((f) => f.ticker).join(", ")}; {failed.length === 1 ? "it is" : "they are"} shown as a
          single holding.
          <ul>
            {failed.map((f) => (
              <li key={f.ticker}>
                {f.ticker}: {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
