// Fetch the Meralco rotational-brownout page and parse the embedded
// schedule into JSON. The page is served by Drupal as static HTML;
// the only obstacle is a WAF that 403s default fetcher User-Agents.
//
// Output:
//   public/data/latest.json        — most recent successful scrape
//   public/data/YYYY-MM-DD.json    — per-day archive (overwritten if same date)

import * as cheerio from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL =
  "https://company.meralco.com.ph/news-and-advisories/rotational-brownout";

// A real desktop Chrome UA — Meralco's WAF rejects undici/node defaults.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(PROJECT_ROOT, "public", "data");

async function fetchHtml() {
  const res = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) {
    throw new Error(`Meralco returned HTTP ${res.status} ${res.statusText}`);
  }
  return res.text();
}

// "Between 2:01PM and 5:00PM" → { start: "14:01", end: "17:00", label }
function parseWindowLabel(label) {
  const m = label.match(
    /Between\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s+and\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i
  );
  if (!m) return { start: null, end: null, label };
  const to24 = (h, mer) => {
    const n = parseInt(h, 10);
    if (/PM/i.test(mer)) return n === 12 ? 12 : n + 12;
    return n === 12 ? 0 : n;
  };
  const pad = (n) => String(n).padStart(2, "0");
  const start = `${pad(to24(m[1], m[3]))}:${m[2]}`;
  const end = `${pad(to24(m[4], m[6]))}:${m[5]}`;
  return { start, end, label };
}

// "1. BAGONG BARRIO" → "BAGONG BARRIO"
function cleanBarangay(text) {
  return text.replace(/^\s*\d+\.\s*/, "").trim();
}

// "Red Alert Locations (MAY) MAY 15, 2026" → "2026-05-15"
function parseScheduleDate($) {
  const heading = $(".node-field.body h3").first().text();
  const m = heading.match(
    /(JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\s+(\d{1,2}),\s*(\d{4})/i
  );
  if (!m) return null;
  const months = {
    JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
    JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
  };
  const mon = months[m[1].slice(0, 3).toUpperCase()];
  const day = String(m[2]).padStart(2, "0");
  return `${m[3]}-${mon}-${day}`;
}

function parseAdvisory($) {
  return $(".node-field.body > p").first().text().trim() || null;
}

function parse(html) {
  const $ = cheerio.load(html);
  const wrapper = $(".mld-report-wrapper").first();
  if (wrapper.length === 0) {
    throw new Error("No .mld-report-wrapper found — page structure changed");
  }

  // Walk wrapper children in order so each <h1> owns the following accordion.
  const windows = [];
  let current = null;

  wrapper.children().each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag === "h1") {
      if (current) windows.push(current);
      current = { ...parseWindowLabel($(el).text().trim()), provinces: [] };
      return;
    }
    if (tag === "div" && $(el).hasClass("faq-accordion") && current) {
      $(el)
        .find("> .faq-item")
        .each((__, item) => {
          const provinceName = $(item).find("> .faq-header > h2").first().text().trim();
          if (!provinceName) return;
          const province = { name: provinceName, cities: [] };
          let currentCity = null;
          $(item)
            .find(".faq-content")
            .children()
            .each((___, child) => {
              const ctag = child.tagName?.toLowerCase();
              const text = $(child).text().trim();
              if (ctag === "h3") {
                if (currentCity) province.cities.push(currentCity);
                currentCity = { name: text, barangays: [] };
              } else if (ctag === "p" && $(child).hasClass("barangay-item") && currentCity) {
                currentCity.barangays.push(cleanBarangay(text));
              }
            });
          if (currentCity) province.cities.push(currentCity);
          current.provinces.push(province);
        });
    }
  });
  if (current) windows.push(current);

  return {
    source_url: SOURCE_URL,
    scraped_at: new Date().toISOString(),
    schedule_date: parseScheduleDate($),
    advisory: parseAdvisory($),
    windows,
  };
}

function countBarangays(data) {
  let n = 0;
  for (const w of data.windows)
    for (const p of w.provinces)
      for (const c of p.cities) n += c.barangays.length;
  return n;
}

async function main() {
  console.log(`Fetching ${SOURCE_URL} ...`);
  const html = await fetchHtml();
  console.log(`  → ${html.length.toLocaleString()} bytes`);

  const data = parse(html);
  console.log(
    `Parsed: date=${data.schedule_date} windows=${data.windows.length} ` +
      `provinces=${data.windows.reduce((a, w) => a + w.provinces.length, 0)} ` +
      `barangays=${countBarangays(data)}`
  );
  if (data.windows.length === 0) {
    throw new Error("No schedule windows parsed — aborting write");
  }

  await mkdir(OUT_DIR, { recursive: true });
  const latestPath = join(OUT_DIR, "latest.json");
  await writeFile(latestPath, JSON.stringify(data, null, 2));
  console.log(`Wrote ${latestPath}`);

  if (data.schedule_date) {
    const datedPath = join(OUT_DIR, `${data.schedule_date}.json`);
    await writeFile(datedPath, JSON.stringify(data, null, 2));
    console.log(`Wrote ${datedPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
