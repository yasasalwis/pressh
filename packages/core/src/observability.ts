import { randomUUID } from "node:crypto";

/**
 * Minimal observability primitives (TDD §9). A Prometheus-text metrics registry
 * and a correlation-id helper. Structured logging is the Phase-1 pino logger;
 * an OpenTelemetry exporter plugs in at the app edge as a future enhancement.
 */
export function requestId(provided?: string | null): string {
  return provided && provided.length > 0 ? provided : randomUUID();
}

export type Labels = Record<string, string>;

type MetricType = "counter" | "gauge";

interface Series {
  labels: Labels;
  value: number;
}

interface Metric {
  type: MetricType;
  help: string;
  series: Map<string, Series>;
}

function labelKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${JSON.stringify(labels[k])}`)
    .join(",");
}

function labelText(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  return `{${keys.map((k) => `${k}=${JSON.stringify(labels[k])}`).join(",")}}`;
}

export interface Metrics {
  inc(name: string, help: string, labels?: Labels, value?: number): void;
  gauge(name: string, help: string, value: number, labels?: Labels): void;
  /** Records a value as `<name>_count` + `<name>_sum` counters (e.g. latency). */
  observe(name: string, help: string, value: number, labels?: Labels): void;
  render(): string;
}

export function createMetrics(): Metrics {
  const metrics = new Map<string, Metric>();

  function ensure(name: string, type: MetricType, help: string): Metric {
    let metric = metrics.get(name);
    if (!metric) {
      metric = { type, help, series: new Map() };
      metrics.set(name, metric);
    }
    return metric;
  }

  function add(name: string, help: string, labels: Labels, value: number): void {
    const metric = ensure(name, "counter", help);
    const key = labelKey(labels);
    const existing = metric.series.get(key);
    if (existing) existing.value += value;
    else metric.series.set(key, { labels, value });
  }

  return {
    inc(name, help, labels = {}, value = 1) {
      add(name, help, labels, value);
    },
    gauge(name, help, value, labels = {}) {
      const metric = ensure(name, "gauge", help);
      metric.series.set(labelKey(labels), { labels, value });
    },
    observe(name, help, value, labels = {}) {
      add(`${name}_count`, help, labels, 1);
      add(`${name}_sum`, help, labels, value);
    },
    render() {
      const lines: string[] = [];
      for (const [name, metric] of metrics) {
        lines.push(`# HELP ${name} ${metric.help}`);
        lines.push(`# TYPE ${name} ${metric.type}`);
        for (const series of metric.series.values()) {
          lines.push(`${name}${labelText(series.labels)} ${series.value}`);
        }
      }
      return `${lines.join("\n")}\n`;
    },
  };
}
