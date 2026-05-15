"use client";

import * as duckdb from "@duckdb/duckdb-wasm";

const PARQUET_PATH = "/data/barangays/barangays.parquet";
const REGISTERED_NAME = "barangays.parquet";

function parquetUrl(): string {
  // The DuckDB worker runs from a blob URL, so its base URI is not the page
  // origin — relative paths fail in XHR with "Invalid URL". Build an absolute
  // URL against the document origin instead.
  if (typeof window === "undefined") return PARQUET_PATH;
  return new URL(PARQUET_PATH, window.location.origin).toString();
}

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;
let registered = false;

async function initDb(): Promise<duckdb.AsyncDuckDB> {
  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);
  // Worker is served from a different origin (jsDelivr) — wrapping the script
  // in a blob URL sidesteps cross-origin worker restrictions.
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker!}");`], {
      type: "application/javascript",
    })
  );
  const worker = new Worker(workerUrl);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  return db;
}

export async function getDuckDB(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) dbPromise = initDb();
  const db = await dbPromise;
  if (!registered) {
    await db.registerFileURL(
      REGISTERED_NAME,
      parquetUrl(),
      duckdb.DuckDBDataProtocol.HTTP,
      false
    );
    registered = true;
  }
  return db;
}

export interface BarangayRow {
  geometry: Uint8Array;
  city_norm: string;
  barangay_norm: string;
  adm4_pcode: string;
  match_keys: string[];
}

function readStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v)).filter((v) => v.length > 0);
  }
  // Arrow lists sometimes come back as Vector-like objects with toArray().
  if (value && typeof (value as { toArray?: () => unknown }).toArray === "function") {
    const arr = (value as { toArray: () => unknown }).toArray();
    if (Array.isArray(arr)) return arr.map((v) => String(v)).filter((v) => v.length > 0);
  }
  return [];
}

export async function queryBarangaysByMatchKeys(
  matchKeys: string[]
): Promise<BarangayRow[]> {
  if (matchKeys.length === 0) return [];
  const db = await getDuckDB();
  const conn = await db.connect();
  try {
    // Using a literal list — DuckDB's prepared-statement support for arrays in
    // the WASM build is uneven, and the key set is small (<2k strings).
    const literal = matchKeys
      .map((k) => `'${k.replace(/'/g, "''")}'`)
      .join(",");
    const sql = `
      SELECT geometry, city_norm, barangay_norm, ADM4_PCODE AS adm4_pcode, match_keys
      FROM '${REGISTERED_NAME}'
      WHERE list_has_any(match_keys, [${literal}])
    `;
    const result = await conn.query(sql);
    const rows: BarangayRow[] = [];
    for (let i = 0; i < result.numRows; i++) {
      const row = result.get(i);
      if (!row) continue;
      rows.push({
        geometry: row.geometry as Uint8Array,
        city_norm: String(row.city_norm ?? ""),
        barangay_norm: String(row.barangay_norm ?? ""),
        adm4_pcode: String(row.adm4_pcode ?? ""),
        match_keys: readStringList(row.match_keys),
      });
    }
    return rows;
  } finally {
    await conn.close();
  }
}
