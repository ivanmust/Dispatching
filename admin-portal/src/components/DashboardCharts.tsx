import {
  Chart as ChartJS,
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";
import { Bar, Doughnut, Line } from "react-chartjs-2";

ChartJS.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Title,
  Tooltip
);

const anim = { duration: 650, easing: "easeOutQuart" as const };

const gridColor = "rgba(148, 163, 184, 0.2)";
const teal = "rgb(45, 138, 140)";
const tealFill = "rgba(45, 138, 140, 0.2)";
const blue = "rgb(74, 159, 212)";
const blueFill = "rgba(74, 159, 212, 0.22)";
const amber = "rgb(217, 119, 6)";
const rose = "rgb(225, 29, 72)";

const baseOptions: ChartOptions<"line"> = {
  responsive: true,
  maintainAspectRatio: false,
  animation: anim,
  plugins: {
    legend: { display: false },
    title: { display: false },
    tooltip: {
      mode: "index",
      intersect: false,
    },
  },
  interaction: { mode: "nearest", axis: "x", intersect: false },
};

export type LineChartCardProps = {
  title: string;
  labels: string[];
  values: number[];
  yAxisLabel?: string;
};

export function DashboardLineChart({ title, labels, values, yAxisLabel }: LineChartCardProps) {
  const data = {
    labels,
    datasets: [
      {
        label: title,
        data: values,
        borderColor: blue,
        backgroundColor: blueFill,
        tension: 0.35,
        fill: true,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: "#fff",
        pointBorderColor: blue,
        pointBorderWidth: 2,
      },
    ],
  };

  const options: ChartOptions<"line"> = {
    ...baseOptions,
    plugins: {
      ...baseOptions.plugins,
      tooltip: {
        ...baseOptions.plugins?.tooltip,
        callbacks: {
          label: (ctx: TooltipItem<"line">) => {
            const y = ctx.parsed.y;
            return y == null ? "" : `${ctx.dataset.label ?? ""}: ${y}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { color: gridColor },
        ticks: { maxRotation: 40, minRotation: 0, font: { size: 10 } },
      },
      y: {
        beginAtZero: true,
        title: yAxisLabel ? { display: true, text: yAxisLabel, font: { size: 11 } } : undefined,
        grid: { color: gridColor },
        ticks: { font: { size: 10 } },
      },
    },
  };

  return (
    <div className="execChartCard">
      <div className="execChartCardTitle">{title}</div>
      <div className="execChartBody">
        <Line data={data} options={options} />
      </div>
    </div>
  );
}

const donutColors = [
  "rgba(45, 138, 140, 0.85)",
  "rgba(74, 159, 212, 0.85)",
  "rgba(217, 119, 6, 0.85)",
  "rgba(99, 102, 241, 0.85)",
  "rgba(34, 197, 94, 0.75)",
  "rgba(225, 29, 72, 0.75)",
  "rgba(100, 116, 139, 0.75)",
];

export type DonutChartProps = {
  title: string;
  labels: string[];
  values: number[];
};

export function DashboardDonutChart({ title, labels, values }: DonutChartProps) {
  const data = {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: labels.map((_, i) => donutColors[i % donutColors.length]),
        borderWidth: 2,
        borderColor: "rgba(255,255,255,0.92)",
        hoverOffset: 8,
      },
    ],
  };

  const options: ChartOptions<"doughnut"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: anim,
    cutout: "58%",
    plugins: {
      legend: {
        position: "bottom",
        labels: { boxWidth: 12, font: { size: 10 }, padding: 10 },
      },
      title: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const n = Number(ctx.raw);
            const sum = values.reduce((a, b) => a + b, 0) || 1;
            const pct = Math.round((n / sum) * 1000) / 10;
            return `${ctx.label}: ${n} (${pct}%)`;
          },
        },
      },
    },
  };

  return (
    <div className="execChartCard execChartCardWide">
      <div className="execChartCardTitle">{title}</div>
      <div className="execChartBody execChartBodyDonut">
        <Doughnut data={data} options={options} />
      </div>
    </div>
  );
}

export type DualLineChartProps = {
  title: string;
  labels: string[];
  seriesA: { label: string; values: number[] };
  seriesB: { label: string; values: number[] };
  yAxisLabel?: string;
};

export function DashboardDualLineChart({ title, labels, seriesA, seriesB, yAxisLabel }: DualLineChartProps) {
  const data = {
    labels,
    datasets: [
      {
        label: seriesA.label,
        data: seriesA.values,
        borderColor: teal,
        backgroundColor: tealFill,
        tension: 0.35,
        fill: true,
        pointRadius: 3,
        pointHoverRadius: 5,
      },
      {
        label: seriesB.label,
        data: seriesB.values,
        borderColor: blue,
        backgroundColor: blueFill,
        tension: 0.35,
        fill: true,
        pointRadius: 3,
        pointHoverRadius: 5,
      },
    ],
  };

  const options: ChartOptions<"line"> = {
    ...baseOptions,
    plugins: {
      legend: {
        display: true,
        position: "bottom",
        labels: { boxWidth: 10, font: { size: 10 }, padding: 8 },
      },
      title: { display: false },
      tooltip: { mode: "index", intersect: false },
    },
    scales: {
      x: {
        grid: { color: gridColor },
        ticks: { maxRotation: 45, font: { size: 9 } },
      },
      y: {
        beginAtZero: true,
        title: yAxisLabel ? { display: true, text: yAxisLabel, font: { size: 11 } } : undefined,
        grid: { color: gridColor },
        ticks: { font: { size: 10 } },
      },
    },
  };

  return (
    <div className="execChartCard execChartCardWide">
      <div className="execChartCardTitle">{title}</div>
      <div className="execChartBody">
        <Line data={data} options={options} />
      </div>
    </div>
  );
}

export type BarChartCardProps = {
  title: string;
  labels: string[];
  values: number[];
  yAxisLabel?: string;
  horizontal?: boolean;
  barColor?: string;
};

export function DashboardBarChart({ title, labels, values, yAxisLabel, horizontal, barColor }: BarChartCardProps) {
  const color = barColor ?? amber;
  const data = {
    labels,
    datasets: [
      {
        label: title,
        data: values,
        backgroundColor: labels.map(() => color),
        borderRadius: horizontal ? 4 : 6,
        borderSkipped: false,
      },
    ],
  };

  const options: ChartOptions<"bar"> = {
    indexAxis: horizontal ? "y" : "x",
    responsive: true,
    maintainAspectRatio: false,
    animation: anim,
    plugins: {
      legend: { display: false },
      title: { display: false },
      tooltip: { intersect: false },
    },
    scales: horizontal
      ? {
          x: {
            beginAtZero: true,
            title: yAxisLabel ? { display: true, text: yAxisLabel, font: { size: 11 } } : undefined,
            grid: { color: gridColor },
            ticks: { font: { size: 10 } },
          },
          y: { grid: { display: false }, ticks: { font: { size: 10 } } },
        }
      : {
          x: { grid: { color: gridColor }, ticks: { font: { size: 10 } } },
          y: {
            beginAtZero: true,
            title: yAxisLabel ? { display: true, text: yAxisLabel, font: { size: 11 } } : undefined,
            grid: { color: gridColor },
            ticks: { font: { size: 10 } },
          },
        },
  };

  return (
    <div className="execChartCard">
      <div className="execChartCardTitle">{title}</div>
      <div className="execChartBody">
        <Bar data={data} options={options} />
      </div>
    </div>
  );
}

export function DashboardRateBarChart({ title, labels, values }: { title: string; labels: string[]; values: number[] }) {
  return (
    <DashboardBarChart
      title={title}
      labels={labels}
      values={values}
      yAxisLabel="Reopen %"
      barColor={rose}
    />
  );
}
