import {
  DashboardBarChart,
  DashboardDonutChart,
  DashboardDualLineChart,
  DashboardLineChart,
  DashboardRateBarChart,
} from "../DashboardCharts";
import { countByStatus, meanByCategory, type EnrichedIncidentRow } from "../../lib/dashboardMetrics";
import { dailyRepairCompletionSeries, reopeningRateByCategory, topProblematicCategories } from "../../lib/dashboardAggregates";

function hoursToMeanMinutes(hours: number): number {
  return Math.round(hours * 60 * 10) / 10;
}

type Props = {
  rows: EnrichedIncidentRow[];
};

export function DashboardInsightCharts({ rows }: Props) {
  const status = countByStatus(rows);
  const response = meanByCategory(rows, (r) => r.responseHours);
  const daily = dailyRepairCompletionSeries(rows, 21);
  const problems = topProblematicCategories(rows, 5);
  const reopen = reopeningRateByCategory(rows);

  const responseMinutes = { ...response, values: response.values.map(hoursToMeanMinutes) };
  const dailyMinutes = {
    ...daily,
    repair: daily.repair.map(hoursToMeanMinutes),
    completion: daily.completion.map(hoursToMeanMinutes),
  };
  const problemsMinutes = problems.map((p) => ({ ...p, hours: hoursToMeanMinutes(p.hours) }));

  return (
    <section className="execChartsSection" aria-label="Insight charts">
      <h2 className="execSectionTitle execChartsSectionTitle">Performance charts</h2>
      <div className="execChartsLayout">
        <DashboardDonutChart title="Incident status distribution" labels={status.labels} values={status.values} />
        <DashboardLineChart
          title="Response time by category (mean minutes)"
          labels={responseMinutes.labels}
          values={responseMinutes.values}
          yAxisLabel="Minutes"
        />
        <DashboardDualLineChart
          title="Repair & completion trends (mean minutes by open day, UTC)"
          labels={dailyMinutes.labels}
          seriesA={{ label: "Repair (min)", values: dailyMinutes.repair }}
          seriesB={{ label: "Completion (min)", values: dailyMinutes.completion }}
          yAxisLabel="Minutes"
        />
        <DashboardBarChart
          title="Top categories by mean repair time"
          labels={problemsMinutes.map((p) => p.label)}
          values={problemsMinutes.map((p) => p.hours)}
          yAxisLabel="Minutes (mean)"
          horizontal
        />
        <DashboardRateBarChart title="Reopening rate by category (%)" labels={reopen.labels} values={reopen.rates} />
      </div>
    </section>
  );
}
