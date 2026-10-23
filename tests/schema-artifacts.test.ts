// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function collectSql(node: unknown, acc: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) collectSql(child, acc);
    return acc;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if ((key === "rawSql" || key === "query") && typeof value === "string") {
        acc.push(value);
      } else {
        collectSql(value, acc);
      }
    }
  }
  return acc;
}

const schema = read("schema.sql");

const tables = new Set(
  [...schema.matchAll(/CREATE TABLE IF NOT EXISTS clickpulse\.(\w+)/g)].map(
    (match) => match[1]
  )
);

const mvTargets = [
  ...schema.matchAll(/TO clickpulse\.(\w+)/g)
].map((match) => match[1]);

const dashboardFiles = [
  "dashboards/grafana/web-analytics-dashboard.json",
  "dashboards/signoz/clickpulse-web-analytics-v2.json",
  "dashboards/signoz/web-analytics-dashboard.json"
];

describe("Schema artifacts", () => {
  it("defines the daily_session_stats table used by bounce/duration queries", () => {
    expect(tables.has("daily_session_stats")).toBe(true);
    expect(schema).toMatch(
      /CREATE TABLE IF NOT EXISTS clickpulse\.daily_session_stats[\s\S]*?pageviews\s+SimpleAggregateFunction\(sum, UInt64\)/
    );
  });

  it("points every materialized view at a table defined in schema.sql", () => {
    expect(mvTargets.length).toBeGreaterThan(0);
    for (const target of mvTargets) {
      expect(tables.has(target), `MV target ${target} is not defined`).toBe(true);
    }
  });

  it("only references known ClickHouse tables in documentation queries", () => {
    const docs = read("docs/clickhouse-queries.md");
    const referenced = [
      ...docs.matchAll(/clickpulse\.(\w+)/g)
    ].map((match) => match[1]);

    for (const table of referenced) {
      expect(tables.has(table), `docs reference unknown table ${table}`).toBe(
        true
      );
    }
  });

  for (const file of dashboardFiles) {
    describe(file, () => {
      const dashboard = JSON.parse(read(file)) as {
        panels?: Array<{ id?: number }>;
        spec?: { panels?: Record<string, unknown> };
      };
      const queries = collectSql(dashboard);

      it("contains at least one SQL query", () => {
        expect(queries.length).toBeGreaterThan(0);
      });

      it("only references tables defined in schema.sql", () => {
        for (const query of queries) {
          for (const match of query.matchAll(/clickpulse\.(\w+)/g)) {
            expect(
              tables.has(match[1]),
              `${file} references unknown table ${match[1]}`
            ).toBe(true);
          }
        }
      });

      it("uses $__dateFilter for Date columns instead of $__timeFilter", () => {
        for (const query of queries) {
          expect(query).not.toMatch(/\$__timeFilter\(\s*date\s*\)/);
        }
      });
    });
  }

  it("keeps Grafana panel ids unique", () => {
    const grafana = JSON.parse(
      read("dashboards/grafana/web-analytics-dashboard.json")
    ) as { panels: Array<{ id: number }> };
    const ids = grafana.panels.map((panel) => panel.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
