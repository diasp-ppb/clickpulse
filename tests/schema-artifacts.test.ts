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

// Strip SQL line comments so the commented-out SigNoz bridge MV is not parsed.
const schema = read("schema.sql").replace(/^\s*--.*$/gm, "");
const backfill = read("scripts/backfill-materialized-views.sql");
const migration = read("scripts/migrate-daily-site-stats.sql");

const tables = new Set(
  [...schema.matchAll(/CREATE TABLE IF NOT EXISTS clickpulse\.(\w+)/g)].map(
    (match) => match[1]
  )
);

const mvTargets = [
  ...schema.matchAll(/TO clickpulse\.(\w+)/g)
].map((match) => match[1]);

function tableColumns(table: string): string[] {
  const match = schema.match(
    new RegExp(
      `CREATE TABLE IF NOT EXISTS clickpulse\\.${table}\\s*\\(([\\s\\S]*?)\\)\\s*ENGINE`
    )
  );
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[0])
    .filter((column) => /^\w+$/.test(column));
}

function mvBody(table: string): string {
  const match = schema.match(
    new RegExp(
      `CREATE MATERIALIZED VIEW IF NOT EXISTS clickpulse\\.\\w+\\s+TO clickpulse\\.${table}\\s+AS([\\s\\S]*?);`
    )
  );
  return match ? match[1] : "";
}

function backfillBody(table: string): string {
  const match = backfill.match(
    new RegExp(
      `INSERT INTO clickpulse\\.${table}\\s*(?:\\([^)]*\\)\\s*)?SELECT([\\s\\S]*?);`
    )
  );
  return match ? match[1] : "";
}

function backfillColumns(table: string): string[] {
  const match = backfill.match(
    new RegExp(`INSERT INTO clickpulse\\.${table}\\s*\\(([^)]*)\\)`)
  );
  return match
    ? match[1]
        .split(",")
        .map((column) => column.trim())
        .filter(Boolean)
    : [];
}

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

  it("keeps MV and backfill SELECTs aligned with the target table columns", () => {
    for (const target of new Set(mvTargets)) {
      const columns = tableColumns(target);
      const mv = mvBody(target);
      const insert = backfillBody(target);

      expect(columns.length, `no columns parsed for ${target}`).toBeGreaterThan(
        0
      );
      expect(mv, `no materialized view found for ${target}`).not.toBe("");
      expect(insert, `no backfill INSERT found for ${target}`).not.toBe("");

      for (const column of columns) {
        expect(
          mv,
          `${target}.${column} is missing from the materialized view`
        ).toMatch(new RegExp(`\\b${column}\\b`));
        expect(
          insert,
          `${target}.${column} is missing from the backfill script`
        ).toMatch(new RegExp(`\\b${column}\\b`));
      }

      // ALTER TABLE ... ADD COLUMN appends at the end, so positional INSERTs
      // break after a migration. Require an explicit, complete column list.
      const listed = backfillColumns(target);
      expect(
        [...listed].sort(),
        `backfill INSERT for ${target} must list every column`
      ).toEqual([...columns].sort());
    }
  });

  it("uses explicit column lists in every script INSERT", () => {
    for (const script of [backfill, migration]) {
      for (const match of script.matchAll(
        /INSERT INTO clickpulse\.(\w+)\s*(\([^)]*\))?/g
      )) {
        expect(
          match[2],
          `INSERT into ${match[1]} must list its columns explicitly`
        ).toBeTruthy();
      }
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

      it("filters daily tables with $__dateFilter, never $__timeFilter(date)", () => {
        for (const query of queries) {
          if (!query.includes("clickpulse.daily_") || !query.includes("$__")) {
            continue;
          }
          expect(
            query,
            `${file} must use $__dateFilter for Date columns`
          ).toMatch(/\$__dateFilter\(/);
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
