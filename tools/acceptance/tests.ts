import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { bun, fixture } from "./fixture.js";
export async function actualAssertionProbe() {
  return fixture(async (root) => {
    const file = path.join(root, "src/shared/scene-art-roles.test.ts");
    const original = await fs.readFile(file, "utf8");
    const mutant = original.replace(
      "Object.keys(SCENE_ART_ROLES).length, 34",
      "Object.keys(SCENE_ART_ROLES).length, 35",
    );
    assert.notEqual(mutant, original);
    await fs.writeFile(file, mutant);
    const output = bun(root, ["test", "./src/shared/scene-art-roles.test.ts"], 1);
    assert.match(output, /native role geometry preserves independent projected bounds/);
    assert.match(output, /34|35/);
    assert.match(output, /1 fail/);
    await fs.writeFile(file, original);
    bun(root, ["test", "./src/shared/scene-art-roles.test.ts"]);
    return "actual native role geometry behavior assertion rejects wrong expectation and passes restored";
  });
}
