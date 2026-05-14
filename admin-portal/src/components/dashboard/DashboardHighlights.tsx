import { Lightbulb } from "lucide-react";
import type { SmartInsight } from "../../lib/dashboardAggregates";

export function DashboardHighlights({ items }: { items: SmartInsight[] }) {
  if (!items.length) return null;
  return (
    <section className="execHighlights" aria-label="Key insights">
      <div className="execHighlightsHeader">
        <Lightbulb size={22} className="execHighlightsIcon" aria-hidden />
        <div>
          <h2 className="execSectionTitle">Key insights</h2>
          <p className="execSectionSub">Auto-generated from the same filtered dataset as KPIs and charts.</p>
        </div>
      </div>
      <ul className="execHighlightsList">
        {items.map((it, i) => (
          <li key={i} className={`execHighlightItem execHighlight-${it.tone}`}>
            <span className="execHighlightEmoji" aria-hidden>
              {it.icon}
            </span>
            <span>{it.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
