import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TopicPerformance } from "../results/model";

export default function TopicChart({ topics }: { topics: TopicPerformance[] }) {
  const height = Math.max(220, topics.length * 48 + 50);
  return (
    <figure className="topic-chart" aria-label="Topic quiz accuracy bar chart">
      <div className="chart-scroll">
        <ResponsiveContainer
          width="100%"
          height={height}
          minWidth={0}
          initialDimension={{ width: 800, height }}
        >
          <BarChart
            data={topics}
            layout="vertical"
            margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
            accessibilityLayer
          >
            <CartesianGrid stroke="var(--border)" horizontal={false} />
            <XAxis
              type="number"
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(value) => value + "%"}
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="topic"
              width={180}
              tickFormatter={(value) =>
                String(value).length > 24
                  ? String(value).slice(0, 22) + "…"
                  : String(value)
              }
              tick={{ fill: "var(--text)", fontSize: 13 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(value) => [String(value) + "%", "Quiz accuracy"]}
              contentStyle={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--text)",
                fontSize: 14,
              }}
            />
            <Bar
              dataKey="scorePercent"
              name="Quiz accuracy"
              fill="#8b5cf6"
              radius={[0, 5, 5, 0]}
              barSize={22}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption>
        Quiz accuracy = correct answers ÷ submitted answers × 100. AI reasoning
        assessments never change these bars. Full topic names and counts are in
        the table below.
      </figcaption>
    </figure>
  );
}
