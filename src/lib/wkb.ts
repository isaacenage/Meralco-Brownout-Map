// Minimal WKB → GeoJSON geometry parser. Polygon (3) and MultiPolygon (6) only;
// the barangays.parquet geometry column never contains anything else.
// Spec: https://www.ogc.org/standards/sfa (Well-Known Binary).

import type { Polygon, MultiPolygon, Position } from "geojson";

class Reader {
  private view: DataView;
  private offset = 0;
  private littleEndian = true;
  constructor(private buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  setEndian(byteOrder: number) {
    this.littleEndian = byteOrder === 1;
  }
  u8(): number {
    return this.view.getUint8(this.offset++);
  }
  u32(): number {
    const v = this.view.getUint32(this.offset, this.littleEndian);
    this.offset += 4;
    return v;
  }
  f64(): number {
    const v = this.view.getFloat64(this.offset, this.littleEndian);
    this.offset += 8;
    return v;
  }
}

function readPolygonRings(r: Reader): Position[][] {
  const numRings = r.u32();
  const rings: Position[][] = [];
  for (let i = 0; i < numRings; i++) {
    const numPoints = r.u32();
    const ring: Position[] = new Array(numPoints);
    for (let j = 0; j < numPoints; j++) {
      const x = r.f64();
      const y = r.f64();
      ring[j] = [x, y];
    }
    rings.push(ring);
  }
  return rings;
}

function readGeometry(r: Reader): Polygon | MultiPolygon {
  r.setEndian(r.u8());
  // Strip the EWKB SRID flag (0x20000000) and Z/M flags if present.
  const rawType = r.u32();
  const type = rawType & 0xff;
  if (rawType & 0x20000000) r.u32(); // skip SRID
  if (type === 3) {
    return { type: "Polygon", coordinates: readPolygonRings(r) };
  }
  if (type === 6) {
    const numPolys = r.u32();
    const polys: Position[][][] = [];
    for (let i = 0; i < numPolys; i++) {
      r.setEndian(r.u8());
      const sub = r.u32() & 0xff;
      if (sub !== 3) {
        throw new Error(`Unexpected sub-geometry type in MultiPolygon: ${sub}`);
      }
      polys.push(readPolygonRings(r));
    }
    return { type: "MultiPolygon", coordinates: polys };
  }
  throw new Error(`Unsupported WKB geometry type: ${type}`);
}

export function wkbToGeometry(wkb: Uint8Array): Polygon | MultiPolygon {
  return readGeometry(new Reader(wkb));
}
