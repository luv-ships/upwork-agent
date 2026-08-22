import { createHash } from "node:crypto";

function canonicalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Hash inputs cannot contain non-finite numbers");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new TypeError("Hash input contains an unsupported value");
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, seen));
  if (typeof value === "object") {
    if (seen.has(value)) throw new TypeError("Hash inputs cannot contain cycles");
    seen.add(value);
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) result[key] = canonicalize(record[key], seen);
    seen.delete(value);
    return result;
  }
  throw new TypeError("Hash input contains an unsupported value");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set<object>()));
}

export function createInputHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
