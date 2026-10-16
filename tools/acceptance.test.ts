import { expect, test } from "bun:test";
import { runTestProbes } from "./acceptance";

test("native runner rejects wrong results, no discovery, rejected promises and incomplete exit fixtures", () => {
  const probes = runTestProbes();
  expect(probes.map((probe) => [probe.name, probe.status])).toEqual([
    ["wrong expectation", 1],
    ["empty discovery", 1],
    ["awaited rejection", 1],
    ["early exit", 1],
  ]);
}, 30000);
