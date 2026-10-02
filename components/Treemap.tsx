"use client";

import { hierarchy, treemap, treemapSquarify, type HierarchyRectangularNode } from "d3-hierarchy";
import { useEffect, useMemo, useRef, useState } from "react";
import { pct } from "@/lib/format";
import type { TreemapNode } from "@/lib/service";

const SLOTS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)"];
const HEIGHT = 440;
const GROUP_LABEL = 18;

type Rect = HierarchyRectangularNode<TreemapNode>;

/**
 * Look-through treemap: every cell is a security sized by its weight in the
 * root fund. Cells take the colour of the top-level fund they come through,
 * so a fund-of-funds reads as one block per sleeve.
 */
export default function Treemap({ data }: { data: TreemapNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [tip, setTip] = useState<{ x: number; y: number; node: Rect } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sleeves = useMemo(() => (data.children ?? []).filter((c) => c.children), [data]);
  const colourOf = useMemo(() => {
    const map = new Map<string, string>();
    sleeves.slice(0, SLOTS.length).forEach((s, i) => map.set(s.ticker ?? s.name, SLOTS[i]));
    return (n: Rect) => {
      if (sleeves.length === 0) return n.data.other ? "var(--series-other)" : SLOTS[0];
      const top = n.ancestors().find((a) => a.depth === 1);
      return (top && map.get(top.data.ticker ?? top.data.name)) ?? "var(--series-other)";
    };
  }, [sleeves]);

  const root = useMemo(() => {
    if (width === 0) return null;
    const h = hierarchy(data)
      .sum((d) => (d.children ? 0 : Math.max(d.weight ?? 0, 0)))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return treemap<TreemapNode>()
      .tile(treemapSquarify)
      .size([width, HEIGHT])
      .paddingInner(2)
      .paddingTop((d) => (d.depth === 1 && d.children ? GROUP_LABEL : 0))(h);
  }, [data, width]);

  const leaves = root?.leaves() ?? [];
  const groups = root?.children?.filter((c) => c.children) ?? [];
  const otherShare = (data.children ?? []).filter((c) => !c.children).reduce((s, c) => s + (c.weight ?? 0), 0);

  return (
    <div>
      {sleeves.length > 0 && (
        <div className="legend" style={{ marginBottom: 8 }}>
          {sleeves.map((s, i) => (
            <span key={s.ticker ?? s.name}>
              <span className="swatch" style={{ background: SLOTS[i] ?? "var(--series-other)" }} />
              {s.ticker} <span className="muted">{s.name}</span>
            </span>
          ))}
          {otherShare > 0 && (
            <span>
              <span className="swatch" style={{ background: "var(--series-other)" }} />
              Held directly
            </span>
          )}
        </div>
      )}
      <div ref={wrap} style={{ position: "relative", width: "100%", height: HEIGHT }}>
        {root && (
          <svg width={width} height={HEIGHT} role="img" aria-label="Treemap of looked-through holdings">
            {leaves.map((n, i) => {
              const w = n.x1 - n.x0;
              const h = n.y1 - n.y0;
              if (w <= 0 || h <= 0) return null;
              const label = n.data.ticker ?? (w > 90 ? n.data.name : "");
              return (
                <g
                  key={i}
                  transform={`translate(${n.x0},${n.y0})`}
                  onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, node: n })}
                  onMouseLeave={() => setTip(null)}
                >
                  <rect width={w} height={h} rx={2} fill={colourOf(n)} fillOpacity={n.data.other ? 0.45 : 0.9} />
                  {w > 34 && h > 16 && (
                    <text x={4} y={13} fontSize={11} fill="var(--text-primary)" style={{ pointerEvents: "none" }}>
                      {label.slice(0, Math.floor(w / 7))}
                    </text>
                  )}
                  {w > 44 && h > 30 && (
                    <text x={4} y={26} fontSize={10} fill="var(--text-primary)" opacity={0.8} style={{ pointerEvents: "none" }}>
                      {pct(n.value ?? 0)}
                    </text>
                  )}
                </g>
              );
            })}
            {groups.map((g) => (
              <text
                key={g.data.ticker ?? g.data.name}
                x={g.x0 + 2}
                y={g.y0 + 13}
                fontSize={11}
                fill="var(--text-secondary)"
                style={{ pointerEvents: "none" }}
              >
                {`${g.data.ticker ?? ""} ${pct(g.value ?? 0, 1)}`.slice(0, Math.max(0, Math.floor((g.x1 - g.x0) / 7)))}
              </text>
            ))}
          </svg>
        )}
      </div>
      {tip && (
        <div className="tooltip" style={{ left: tip.x + 12, top: tip.y + 12 }}>
          <div>
            {tip.node.data.ticker && <span className="tk">{tip.node.data.ticker} </span>}
            {tip.node.data.name}
          </div>
          <div>{pct(tip.node.value ?? 0, 3)} of fund</div>
          <div className="muted">
            via{" "}
            {tip.node
              .ancestors()
              .reverse()
              .slice(0, -1)
              .map((a) => a.data.ticker ?? a.data.name)
              .join(" › ")}
          </div>
        </div>
      )}
    </div>
  );
}
