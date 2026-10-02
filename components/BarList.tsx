import { pct } from "@/lib/format";

/** Single-series horizontal bars for a breakdown; values printed in text ink, bars in slot 1. */
export default function BarList({ items, max = 10 }: { items: { label: string; weight: number }[]; max?: number }) {
  const shown = items.slice(0, max);
  const rest = items.slice(max).reduce((s, i) => s + i.weight, 0);
  if (rest > 0) shown.push({ label: `${items.length - max} others`, weight: rest });
  const top = Math.max(...shown.map((i) => i.weight), 1e-9);
  return (
    <div className="bars">
      {shown.map((i) => (
        <div className="bar-row" key={i.label} title={`${i.label}: ${pct(i.weight)}`}>
          <span className="truncate">{i.label}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(i.weight / top) * 100}%` }} />
          </div>
          <span style={{ textAlign: "right" }}>{pct(i.weight, 1)}</span>
        </div>
      ))}
    </div>
  );
}
