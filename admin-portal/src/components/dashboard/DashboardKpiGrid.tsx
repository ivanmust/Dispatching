import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  Percent,
  Timer,
  Wrench,
} from "lucide-react";
import type { ExecutiveKpis } from "../../lib/dashboardAggregates";
import { trendDelta } from "../../lib/dashboardAggregates";
import { formatDurationHours } from "../../lib/dashboardTimeFormat";

type Props = {
  current: ExecutiveKpis;
  previous: ExecutiveKpis | null;
  loading?: boolean;
};

function fmtNum(n: number | null, suffix = ""): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n}${suffix}`;
}

function Trend({
  prev,
  curr,
  mode,
}: {
  prev: number | null;
  curr: number | null;
  mode: "higher-better" | "lower-better" | "neutral";
}) {
  const { kind, pct } = trendDelta(prev, curr);
  if (mode === "neutral" || (kind === "flat" && (pct == null || pct === 0))) {
    return <span className="execKpiTrend execKpiTrendNeutral">{pct === 0 ? "→ 0%" : "—"}</span>;
  }
  const up = kind === "up";
  const good = mode === "lower-better" ? !up : up;
  const arrow = up ? "↑" : kind === "down" ? "↓" : "→";
  const cls = good ? "execKpiTrendGood" : "execKpiTrendBad";
  const label = pct != null ? `${arrow} ${Math.abs(pct)}%` : arrow;
  return <span className={`execKpiTrend ${cls}`}>{label}</span>;
}

function KpiCard({
  label,
  value,
  trend,
  icon,
  accent,
}: {
  label: string;
  value: ReactNode;
  trend?: ReactNode;
  icon: React.ReactNode;
  accent: "teal" | "blue" | "amber" | "rose" | "slate";
}) {
  return (
    <div className={`execKpiCard execKpiAccent-${accent}`}>
      <div className="execKpiCardTop">
        <span className="execKpiIcon" aria-hidden>
          {icon}
        </span>
        {trend}
      </div>
      <div className="execKpiValue">{value}</div>
      <div className="execKpiLabel">{label}</div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="execKpiGrid">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="execKpiCard execKpiSkeleton" />
      ))}
    </div>
  );
}

export function DashboardKpiGrid({ current, previous, loading }: Props) {
  if (loading) return <SkeletonGrid />;

  const p = previous;

  return (
    <div className="execKpiGrid">
      <KpiCard
        accent="slate"
        icon={<Layers size={20} />}
        label="Total incidents"
        value={current.totalIncidents}
        trend={<Trend prev={p?.totalIncidents ?? null} curr={current.totalIncidents} mode="neutral" />}
      />
      <KpiCard
        accent="amber"
        icon={<AlertTriangle size={20} />}
        label="Open cases"
        value={current.openCases}
        trend={<Trend prev={p?.openCases ?? null} curr={current.openCases} mode="lower-better" />}
      />
      <KpiCard
        accent="teal"
        icon={<CheckCircle2 size={20} />}
        label="Completed cases"
        value={current.completedCases}
        trend={<Trend prev={p?.completedCases ?? null} curr={current.completedCases} mode="higher-better" />}
      />
      <KpiCard
        accent="blue"
        icon={<Activity size={20} />}
        label="Ongoing (field)"
        value={current.ongoingCases}
        trend={<Trend prev={p?.ongoingCases ?? null} curr={current.ongoingCases} mode="lower-better" />}
      />
      <KpiCard
        accent="rose"
        icon={<Clock size={20} />}
        label="Reopened cases"
        value={current.reopenedCases}
        trend={<Trend prev={p?.reopenedCases ?? null} curr={current.reopenedCases} mode="lower-better" />}
      />
      <KpiCard
        accent="blue"
        icon={<Timer size={20} />}
        label="Avg response time"
        value={formatDurationHours(current.avgResponseHours)}
        trend={<Trend prev={p?.avgResponseHours ?? null} curr={current.avgResponseHours ?? null} mode="lower-better" />}
      />
      <KpiCard
        accent="teal"
        icon={<Wrench size={20} />}
        label="Avg repair time"
        value={formatDurationHours(current.avgRepairHours)}
        trend={<Trend prev={p?.avgRepairHours ?? null} curr={current.avgRepairHours ?? null} mode="lower-better" />}
      />
      <KpiCard
        accent="teal"
        icon={<Percent size={20} />}
        label="SLA compliance"
        value={current.slaCompliancePct == null ? "—" : `${current.slaCompliancePct}%`}
        trend={
          <Trend
            prev={p?.slaCompliancePct ?? null}
            curr={current.slaCompliancePct ?? null}
            mode="higher-better"
          />
        }
      />
    </div>
  );
}
