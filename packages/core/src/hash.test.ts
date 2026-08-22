import { describe, expect, it } from "vitest";

import { canonicalJson, createInputHash } from "./index.js";

describe("canonical input hashing", () => {
  it("sorts object keys recursively and produces lowercase SHA-256 hex", () => {
    const left = {
      z: 3,
      nested: { beta: true, alpha: "value" },
      a: [{ second: 2, first: 1 }]
    };
    const right = {
      a: [{ first: 1, second: 2 }],
      nested: { alpha: "value", beta: true },
      z: 3
    };

    expect(canonicalJson(left)).toBe(
      '{"a":[{"first":1,"second":2}],"nested":{"alpha":"value","beta":true},"z":3}'
    );
    expect(createInputHash(left)).toBe(createInputHash(right));
    expect(createInputHash(left)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("preserves array order and canonicalizes dates and negative zero", () => {
    expect(createInputHash(["first", "second"])).not.toBe(
      createInputHash(["second", "first"])
    );
    expect(canonicalJson({ zero: -0, date: new Date("2026-08-12T00:00:00.000Z") })).toBe(
      '{"date":"2026-08-12T00:00:00.000Z","zero":0}'
    );
  });

  it.each([
    { label: "undefined", makeValue: (): unknown => ({ value: undefined }) },
    { label: "a non-finite number", makeValue: (): unknown => ({ value: Number.NaN }) },
    { label: "a bigint", makeValue: (): unknown => ({ value: BigInt(1) }) }
  ])("rejects $label", ({ makeValue }) => {
    expect(() => createInputHash(makeValue())).toThrow(TypeError);
  });

  it("rejects cyclic objects", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(() => createInputHash(cyclic)).toThrow("Hash inputs cannot contain cycles");
  });
});
