import { describe, it, expect } from "vitest";
import { createMetrics, requestId } from "@pressh/core";

describe("requestId", () => {
  it("passes through a provided id and generates one otherwise", () => {
    expect(requestId("abc")).toBe("abc");
    expect(requestId(null)).toMatch(/[0-9a-f-]{36}/);
    expect(requestId("")).toMatch(/[0-9a-f-]{36}/);
  });
});

describe("createMetrics", () => {
  it("renders counters with labels in Prometheus text", () => {
    const m = createMetrics();
    m.inc("pressh_http_requests_total", "reqs", { status: "200" });
    m.inc("pressh_http_requests_total", "reqs", { status: "200" });
    m.inc("pressh_http_requests_total", "reqs", { status: "404" });
    const text = m.render();
    expect(text).toContain("# TYPE pressh_http_requests_total counter");
    expect(text).toContain('pressh_http_requests_total{status="200"} 2');
    expect(text).toContain('pressh_http_requests_total{status="404"} 1');
  });

  it("records gauges and observations", () => {
    const m = createMetrics();
    m.gauge("pressh_workers", "workers", 3);
    m.observe("pressh_latency", "latency", 12);
    m.observe("pressh_latency", "latency", 8);
    const text = m.render();
    expect(text).toContain("pressh_workers 3");
    expect(text).toContain("pressh_latency_count 2");
    expect(text).toContain("pressh_latency_sum 20");
  });
});
