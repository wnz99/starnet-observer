import { test } from "bun:test";
import assert from "node:assert/strict";
import { createModel } from "../model.js";
import { canonicalTheme } from "../theme.fixture.js";
import { build } from "./build.js";
import { project } from "./geometry.js";
import { crosses } from "./navigation.js";
import { present } from "./values.fixture.js";
import type { LayoutRow } from "../model/types.js";
import type { Rect, Scene } from "./types.js";

function station(hostCount: number, firstHostRoots = 1) {
  const hosts = Array.from({ length: hostCount }, (_, index) => "host" + String(index));
  const row = (id: string, projectId: string, host?: string): LayoutRow => ({
    id,
    projectId,
    project: projectId,
    projectKind: "group",
    repo: "repo",
    repoId: projectId,
    provider: "codex",
    status: "idle",
    ...(host ? { host } : {}),
  });
  const layout = createModel(canonicalTheme()).createLayout();
  layout.reconcile([
    ...Array.from({ length: 4 }, (_, index) =>
      row("local" + String(index), "local" + String(index)),
    ),
    ...hosts.flatMap((host, index) =>
      Array.from({ length: index === 0 ? firstHostRoots : 1 }, (_, root) =>
        row(host + String(root), host, host),
      ),
    ),
  ]);
  return build(layout.onPage(0), 0, {
    hosts: hosts.map((id) => ({ id, health: "available" })),
    relays: [
      {
        relay: "relay.example",
        members: [null, ...hosts].map((host) => ({
          host,
          machine: host ?? "local",
          state: "quiet",
          lastActivityAt: null,
        })),
        shadows: [],
      },
    ],
  });
}
function overlap(a: Rect, b: Rect) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function verifyClearConnections(scene: Scene) {
  const relay = present(present(scene.relays)[0]);
  for (const spoke of relay.spokes)
    for (const ship of present(scene.ships).filter((ship) => ship.id !== spoke.host))
      for (let index = 1; index < spoke.path.length; index++)
        assert.equal(
          crosses(ship.rect, present(spoke.path[index - 1]), present(spoke.path[index])),
          false,
        );
  for (const wire of present(scene.links))
    for (let index = 1; index < wire.path.length; index++)
      assert.equal(
        crosses(relay.mail.rect, present(wire.path[index - 1]), present(wire.path[index])),
        false,
      );
}

test("the relay dock stays at the marked station-front anchor as machines and annexes grow", () => {
  for (const scene of [station(1), station(2), station(6), station(6, 97)]) {
    const relay = present(present(scene.relays)[0]);
    assert.deepEqual(relay.mail.rect, { x: 24, y: 30, w: 14, h: 12 });
    const rects = [...present(scene.ships).map((ship) => ship.rect), relay.mail.rect];
    for (let index = 0; index < rects.length; index++)
      for (const other of rects.slice(index + 1))
        assert.equal(overlap(present(rects[index]), other), false);
    const ships = present(scene.ships).filter((ship) => !ship.local);
    assert.equal(new Set(ships.map((ship) => ship.rect.y)).size, 1);
    verifyClearConnections(scene);
  }
});

test("parallel machine rows join an external spine beside the fixed relay", () => {
  const scene = station(2),
    relay = project(present(present(scene.relays)[0]).mail.hub);
  const centers = present(scene.ships)
    .filter((ship) => !ship.local)
    .map((ship) =>
      project({
        x: ship.rect.x + ship.rect.w / 2,
        y: ship.rect.y + ship.rect.h / 2,
      }),
    );
  assert.ok(present(centers[0]).x < relay.x && present(centers[0]).y < relay.y);
  assert.ok(present(centers[1]).x < relay.x && present(centers[1]).y > relay.y);
  const network = present(present(scene.relays)[0]);
  const port = (host: string | null) =>
    present(present(network.spokes.find((spoke) => spoke.host === host)).path.at(-3));
  assert.equal(
    port(null).y,
    network.mail.rect.y,
    "the main station approaches the relay from its back edge",
  );
  assert.equal(port("host0").y, network.mail.rect.y + network.mail.rect.h);
  assert.equal(
    port("host1").y,
    network.mail.rect.y + network.mail.rect.h,
    "both rows join the spine at the relay's front entrance",
  );
  const ships = present(scene.ships).filter((ship) => !ship.local);
  assert.equal(present(ships[0]).rect.y, present(ships[1]).rect.y);
  assert.ok(present(ships[1]).rect.x > present(ships[0]).rect.x + present(ships[0]).rect.w);
  const junctions = network.spokes
    .filter((spoke) => spoke.host !== null)
    .map((spoke) => present(spoke.junction));
  assert.equal(present(junctions[0]).y, present(junctions[1]).y);
  for (const wire of present(scene.links))
    for (let index = 1; index < wire.path.length; index++)
      assert.equal(
        crosses(network.mail.rect, present(wire.path[index - 1]), present(wire.path[index])),
        false,
        "SSH stays beside the tunnels and bypasses the relay room",
      );
});
