import { test } from "bun:test";
import assert from "node:assert/strict";
import { build } from "./build.js";
import { present } from "./values.fixture.js";
import { crosses } from "./navigation.js";
import { createModel } from "../model.js";
import { canonicalTheme } from "../theme.fixture.js";
import type { Scene, RelaySpoke } from "./types.js";
import type { LayoutRow } from "../model/types.js";

const rows = (): LayoutRow[] =>
  Array.from({ length: 10 }, (_, index) => ({
    id: String(index),
    project: "Project " + String(index),
    projectId: String(index),
    projectKind: "group",
    repo: "repo",
    repoId: String(index),
    provider: "codex",
    status: "idle",
    ...(index >= 8 ? { host: index === 8 ? "one" : "two" } : {}),
  }));

function verifySpoke(spoke: RelaySpoke, scene: Scene) {
  const ships = present(scene.ships),
    relay = present(present(scene.relays)[0]);
  const own =
    spoke.host === null
      ? scene.mail
      : present(present(ships.find((ship) => ship.id === spoke.host)).mail);
  assert.deepEqual(spoke.path[0], own.hub);
  assert.deepEqual(spoke.path.at(-1), relay.mail.hub);
  for (let index = 1; index < spoke.path.length; index++)
    for (const other of ships.filter((ship) => ship.id !== spoke.host))
      assert.equal(
        crosses(other.rect, present(spoke.path[index - 1]), present(spoke.path[index])),
        false,
        "tunnels do not enter another machine",
      );
}

test("relay tunnels form a star; no machine is a transit hop to another machine", () => {
  const layout = createModel(canonicalTheme()).createLayout();
  layout.reconcile(rows());
  const scene = build(layout.onPage(0), 0, {
    hosts: [
      { id: "one", health: "available" },
      { id: "two", health: "stale" },
    ],
    relays: [
      {
        relay: "relay.example",
        members: [null, "one", "two"].map((host) => ({
          host,
          machine: host ?? "mac",
          lastActivityAt: null,
          state: "quiet",
          crossed: [],
        })),
        shadows: [],
      },
    ],
  });
  const relay = present(present(scene.relays)[0]);
  assert.equal(relay.spokes.length, 3);
  assert.equal(relay.links.length, 3);
  const ships = present(scene.ships);
  for (const spoke of relay.spokes) verifySpoke(spoke, scene);
  for (const link of relay.links) {
    assert.ok(link.path.includes(relay.mail.hub));
    for (const third of ships.filter((ship) => ship.id !== link.from && ship.id !== link.to))
      assert.ok(
        !link.path.some(
          (point) =>
            point.x === present(third.mail ?? scene.mail).hub.x &&
            point.y === present(third.mail ?? scene.mail).hub.y,
        ),
      );
  }
  for (const wire of present(scene.links)) {
    assert.ok(wire.path.length > 2);
    assert.ok(
      !wire.path.some((point) => point.x === relay.mail.hub.x && point.y === relay.mail.hub.y),
      "SSH bypasses the relay room",
    );
    for (const platform of scene.platforms)
      for (let index = 1; index < wire.path.length; index++)
        assert.equal(
          crosses(platform.rect, present(wire.path[index - 1]), present(wire.path[index])),
          false,
          "SSH follows the tunnel's clear edge",
        );
  }
  assert.deepEqual(
    present(scene.links).map((wire) => [wire.host, wire.health]),
    [
      ["one", "available"],
      ["two", "stale"],
    ],
  );
});

test("SSH remains available without a relay and excludes shadow ships", () => {
  const scene = build([], 0, {
    hosts: [
      { id: "one", health: "available" },
      { id: "two", health: "stale" },
      { id: "shadow", shadow: true },
    ],
  });
  assert.deepEqual(
    present(scene.links).map((wire) => wire.host),
    ["one", "two"],
  );
  assert.equal(scene.relays, undefined);
  assert.equal(build([], 0).links, undefined);
});
