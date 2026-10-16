import { present } from "./values.fixture.js";
import assert from "node:assert/strict";
import type { LayoutRow } from "../model/types.js";
import type {
  Point,
  Rect,
  RelayNetwork,
  RelayShadow,
  Host,
  SceneMessage,
  RelayBus,
} from "./types.js";
import { createModel } from "../model.js";
import { canonicalTheme } from "../theme.fixture.js";
import { test } from "bun:test";
import * as Scene from "./index.js";

test("observer-relay-scene regression contracts", () => {
  const Model = createModel(canonicalTheme());

  const NOW = 10 * 3600000;
  const row = (id: string, extra: Partial<LayoutRow> = {}): LayoutRow => ({
    id,
    project: "P",
    projectId: "p" + (extra.host || ""),
    projectKind: "group",
    repo: "r",
    repoId: "r",
    provider: "codex",
    status: "idle",
    ...extra,
  });
  const agent = (c: string, repo = "llm-bus", provider: "codex" | "claude" = "codex") => ({
    id: "peer_" + c.repeat(24),
    provider,
    repo,
    lastSeen: NOW - 120000,
  });
  const remote = (
    machine: string,
    extra: Partial<NonNullable<RelayBus["remote"]>> = {},
  ): NonNullable<RelayBus["remote"]> => ({
    relay: "relay.example.dev",
    machine,
    lastActivityAt: NOW - 60000,
    peers: [],
    ...extra,
  });
  const peer = (
    machine: string,
    list: NonNullable<RelayBus["remote"]>["peers"][number]["list"],
    extra: Partial<Omit<RelayShadow, "host">> = {},
  ) => ({
    machine,
    repos: [...new Set(list.map((value) => value.repo))],
    agents: list.length,
    lastSeen: NOW - 120000,
    list,
    ...extra,
  });
  const inside = (point: Point, rect: Rect) =>
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h;
  const shadowHost = (net: RelayNetwork, shadow: RelayShadow, member: Host) => ({
    id: shadow.host,
    shadow: true,
    health: "shadow",
    machine: shadow.machine,
    relay: net.relay,
    member,
    agents: shadow.agents,
  });

  // Networks: one per relay host from each bus's own binding; observed machines are members, never shadows.
  {
    const nets = Scene.relayNetworks(
      [
        [
          null,
          {
            health: "available",
            remote: remote("mac", {
              lastActivityAt: NOW - 20 * 60000,
              peers: [peer("whitenoise", [agent("a")]), peer("vm-1", [agent("v")])],
            }),
          },
        ],
        [
          "vm",
          {
            health: "available",
            remote: remote("vm-1", {
              peers: [
                peer("whitenoise", [agent("a"), agent("b", "docs", "claude")]),
                peer("mac", [agent("m")]),
              ],
            }),
          },
        ],
        [
          "down",
          { health: "unavailable", remote: remote("down-1", { relay: "other.example.dev" }) },
        ],
        ["plain", { health: "available" }],
        ["broken", { health: "available", remote: { relay: 7 } }],
        ["none", null],
      ],
      NOW,
    );
    assert.deepEqual(
      nets.map((net) => net.relay),
      ["other.example.dev", "relay.example.dev"],
    );
    const main = nets[1];
    assert.deepEqual(
      present(main).members.map((member) => [member.host, member.machine, member.state]),
      [
        [null, "mac", "quiet"],
        ["vm", "vm-1", "active"],
      ],
      "this machine first; active only with relay activity in the last 15 minutes",
    );
    assert.deepEqual(
      present(main).shadows.map((shadow) => [
        shadow.host,
        shadow.machine,
        shadow.agents,
        shadow.list.map((value) => value.id),
      ]),
      [["relay:whitenoise", "whitenoise", 2, [agent("b").id, agent("a").id]]],
      "rosters merged across members, sorted by repo; observed machines are never shadows",
    );
    assert.deepEqual(
      present(nets[0]).members.map((member) => member.state),
      ["unknown"],
      "an unreadable bus never claims a live relay",
    );
    assert.equal(
      present(
        present(
          Scene.relayNetworks(
            [[null, { health: "available", remote: remote("mac", { lastActivityAt: null }) }]],
            NOW,
          )[0],
        ).members[0],
      ).state,
      "quiet",
      "no activity seen is quiet, not live",
    );

    const ghosts = Scene.shadowRows(nets);
    assert.deepEqual(
      ghosts.map((value) => [
        value.id,
        value.host,
        value.provider,
        value.repo,
        value.status,
        value.shadow,
        value.source,
      ]),
      [
        [agent("b").id, "relay:whitenoise", "claude", "docs", "unknown", true, "relay"],
        [agent("a").id, "relay:whitenoise", "codex", "llm-bus", "unknown", true, "relay"],
      ],
      "one ghost row per listed agent, room per shared repo, status unknown",
    );
    assert.ok(
      ghosts.every((value) => !value.paneId && !value.sessionId),
      "ghosts carry nothing that could address, inspect or control a session",
    );
  }

  // This machine on a relay with one unobserved machine: a shadow ship docks beside the flagship, ghost crew at desks.
  {
    const nets = Scene.relayNetworks(
      [
        [
          null,
          {
            health: "available",
            remote: remote("mac", { peers: [peer("whitenoise", [agent("a"), agent("b")])] }),
          },
        ],
      ],
      NOW,
    );
    const ghosts = Scene.shadowRows(nets),
      layout = Model.createLayout();
    layout.reconcile([row("obs_a"), ...ghosts]);
    const plainLayout = Model.createLayout();
    plainLayout.reconcile([row("obs_a")]);
    const plain = Scene.build(plainLayout.onPage(0), 0);
    const scene = Scene.build(layout.onPage(0), 0, {
      relays: nets,
      hosts: [shadowHost(present(nets[0]), present(present(nets[0]).shadows[0]), null)],
    });
    const flagship = present(scene.ships).find((ship) => ship.local),
      shadow = present(scene.ships).find((ship) => ship.shadow);
    assert.equal(plain.relays, undefined, "no relay without a bus that reports one");
    assert.ok(
      present(shadow).rect.x > present(flagship).rect.x + present(flagship).rect.w,
      "the shadow ship docks east of the flagship",
    );
    assert.equal(present(scene.links).length, 0, "a shadow ship has no ssh observation link");
    const crew = scene.workers.filter((worker) => worker.row.shadow);
    assert.deepEqual(
      crew.map((worker) => worker.id).sort(),
      ghosts.map((value) => value.id).sort(),
      "every listed agent has a desk",
    );
    for (const worker of crew)
      assert.ok(inside(worker.chair, present(shadow).rect), "ghost crew sit on their own ship");
    for (const worker of crew)
      assert.deepEqual(
        present(worker.route).at(-1),
        present(present(shadow).mail).hub,
        "ghost crew walk to their own mailroom",
      );
    const local = scene.workers.find((worker) => worker.id === "obs_a"),
      alone = plain.workers.find((worker) => worker.id === "obs_a");
    assert.deepEqual(
      present(local).route,
      present(alone).route,
      "observed crew routes are unchanged",
    );
    assert.deepEqual(
      present(present(scene.relays)[0]).links.map((link) => [
        link.from,
        link.to,
        link.shadow,
        link.verified,
      ]),
      [[null, "relay:whitenoise", true, false]],
      "one highway, mailroom to mailroom, unverified until mail crosses",
    );
    const link = present(present(scene.relays)[0]).links[0];
    assert.deepEqual(
      [present(link).path[0], present(link).path.at(-1)],
      [scene.mail.hub, present(present(shadow).mail).hub],
      "it runs from this mailroom to the shadow mailroom",
    );
    const overlap = (a: Rect, b: Rect) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const highway = scene.walkways.filter((walkway) => walkway.kind === "relay-highway");
    for (const segment of highway)
      for (const solid of [...scene.platforms.map((p) => p.rect), scene.observatory.rect])
        assert.ok(!overlap(segment.rect, solid), "around every floor and the observatory");
    for (let index = 1; index < present(link).path.length; index++)
      assert.ok(
        present(present(link).path[index]).x === present(present(link).path[index - 1]).x ||
          present(present(link).path[index]).y === present(present(link).path[index - 1]).y,
        "axis-aligned like every walkway",
      );

    // Couriers: desk → this mailroom → across the relay link → the far mailroom → the far agent's desk, and back.
    const fake = {
      seatFor: (id: string) => (scene.workers.some((w) => w.id === id) ? 0 : undefined),
      pageFor: () => 0,
      colorFor: () => ({ accent: "#fff" }),
    };
    const target = present(crew[0]).id,
      sent = (state: NonNullable<SceneMessage["relay"]>["state"]): SceneMessage => ({
        from: "obs_a",
        to: "external",
        acknowledgedAt: null,
        wake: "unsupported",
        relay: { direction: "out", machine: "whitenoise", repo: "llm-bus", peer: target, state },
      });
    const out = Scene.route(scene, fake, sent("accepted_remote"), []);
    assert.equal(out.key, "obs_a>" + target);
    assert.deepEqual(out.to.at(-1), scene.mail.hub, "the outbound leg starts at this hub");
    assert.ok(
      out.to.some(
        (point) =>
          point.x === present(present(shadow).mail).hub.x &&
          point.y === present(present(shadow).mail).hub.y,
      ),
      "passes through the far hub",
    );
    for (const point of present(link).path.slice(1, -1))
      assert.ok(
        out.to.some((value) => value.x === point.x && value.y === point.y),
        "and follows the highway",
      );
    assert.deepEqual(
      out.to[0],
      present(present(crew[0]).route)[0],
      "and ends at the far agent's chair",
    );
    assert.deepEqual(out.from.at(-1), scene.mail.hub);
    const inbound = Scene.route(
      scene,
      fake,
      {
        from: "external",
        to: "obs_a",
        relay: {
          direction: "in",
          machine: "whitenoise",
          repo: "llm-bus",
          peer: target,
          state: "delivered_local",
        },
      },
      [],
    );
    assert.equal(inbound.key, target + ">obs_a");
    assert.deepEqual(inbound.from[0], present(present(crew[0]).route)[0]);
    const unknown = Scene.route(
      scene,
      fake,
      {
        ...sent("accepted_remote"),
        relay: { ...present(sent("accepted_remote").relay), peer: "peer_" + "f".repeat(24) },
      },
      [],
    );
    assert.deepEqual(
      [unknown.to[0], unknown.to.at(-1)],
      [
        { ...present(present(shadow).mail).hub, z: 0 },
        { ...scene.mail.hub, z: 0 },
      ],
      "an agent the roster no longer lists: that machine's mailroom, along the highway",
    );
    assert.equal(
      Scene.route(scene, fake, { from: "obs_a", to: "external" }, []).key,
      "obs_a>chute",
      "unrelayed outside mail still uses the chute",
    );
    assert.equal(
      Scene.route(
        scene,
        fake,
        {
          ...sent("queued_local"),
          relay: { ...present(sent("queued_local").relay), machine: "elsewhere" },
        },
        [],
      ).key,
      "obs_a>chute",
      "a machine with no relay link: chute",
    );

    // Pending: where llm-bus last proved it is.
    const at = (state: NonNullable<SceneMessage["relay"]>["state"]) =>
      Scene.pending(scene, fake, [sent(state)]);
    assert.ok(
      inside(present(at("queued_local")[0]).point, scene.mail.rect),
      "queued: still in this mailroom",
    );
    const mid = present(at("accepted_remote")[0]).point;
    assert.ok(
      highway.some((segment) => inside(mid, segment.rect)),
      "held by the relay: on the highway",
    );
    assert.deepEqual(
      [present(at("delivered_local")[0]).point.x, present(at("delivered_local")[0]).point.y],
      [
        present(present(present(crew[0]).route)[0]).x,
        present(present(present(crew[0]).route)[0]).y,
      ],
      "delivered: at the far agent's desk",
    );
    assert.deepEqual(at("expired"), [], "expired is not pending anywhere");
    assert.deepEqual(
      { mark: present(at("accepted_remote")[0]).mark },
      { mark: true },
      "relay sends never wake locally: marked like any unsupported wake",
    );
  }

  // Expiry belongs to the message even when the peer is absent or omitted by render caps.
  {
    const layout = Model.createLayout(),
      empty = Scene.build([], 0);
    const message: SceneMessage = {
      from: "external",
      to: "external",
      acknowledgedAt: null,
      relay: { direction: "out", machine: "absent", repo: "llm-bus", state: "expired" },
    };
    assert.deepEqual(
      Scene.pending(empty, layout, [message]),
      [],
      "expired outgoing mail has no pending spot without a peer route",
    );
    assert.equal(
      Scene.pending(empty, layout, [
        { ...message, relay: { ...present(message.relay), state: "queued_local" } },
      ]).length,
      1,
      "unexpired mail still uses the existing chute fallback when the peer is absent",
    );
    assert.equal(
      Scene.pending(empty, layout, [
        {
          ...message,
          relay: { ...present(message.relay), direction: "in", state: "delivered_local" },
        },
      ]).length,
      1,
      "incoming delivery remains pending locally until acknowledgement",
    );

    const nets = Scene.relayNetworks(
      [
        [
          null,
          {
            health: "available",
            remote: remote("mac", {
              peers: Array.from({ length: 7 }, (_, i) =>
                peer("peer-" + String(i), [agent(String(i))]),
              ),
            }),
          },
        ],
      ],
      NOW,
    );
    const omitted = "peer-6";
    assert.equal(present(nets[0]).shadows.length, 6);
    assert.deepEqual(
      { omitted: present(nets[0]).shadows.some((shadow) => shadow.machine === omitted) },
      { omitted: false },
      "fixture peer is excluded by the render cap",
    );
    layout.reconcile(Scene.shadowRows(nets));
    const capped = Scene.build(layout.onPage(0), 0, {
      relays: nets,
      hosts: present(nets[0]).shadows.map((shadow) => shadowHost(present(nets[0]), shadow, null)),
    });
    assert.deepEqual(
      Scene.pending(capped, layout, [
        { ...message, relay: { ...present(message.relay), machine: omitted } },
      ]),
      [],
      "expired mail to a real but capped peer cannot reappear at the outside chute",
    );
  }

  // Two observed machines on one relay: their mailrooms are linked; each ship shows only its own half of a crossing.
  {
    const layout = Model.createLayout();
    layout.reconcile([row("obs_l"), row("obs_v", { host: "vm" })]);
    const nets = Scene.relayNetworks(
      [
        [
          null,
          { health: "available", remote: remote("mac", { peers: [peer("vm-1", [agent("v")])] }) },
        ],
        [
          "vm",
          { health: "available", remote: remote("vm-1", { peers: [peer("mac", [agent("m")])] }) },
        ],
      ],
      NOW,
    );
    const scene = Scene.build(layout.onPage(0), 0, {
        hosts: [{ id: "vm", health: "available", agents: 1 }],
        relays: nets,
      }),
      vmShip = present(scene.ships).find((ship) => ship.id === "vm");
    assert.deepEqual(present(nets[0]).shadows, [], "both machines are observed: no shadows");
    assert.deepEqual(
      present(present(scene.relays)[0]).links.map((link) => [link.from, link.to, link.shadow]),
      [[null, "vm", false]],
    );
    const column = scene.walkways.filter((walkway) => walkway.kind === "relay-highway");
    assert.ok(
      column.length === 1 &&
        present(column[0]).rect.x + present(column[0]).rect.w / 2 === scene.mail.hub.x,
      "member to member: straight down the centre line between the banks",
    );
    const fake = {
      seatFor: (id: string) => (["obs_l", "obs_v"].includes(id) ? 0 : undefined),
      pageFor: () => 0,
      colorFor: () => ({ accent: "#fff" }),
    };
    const vmOut = Scene.route(
      scene,
      fake,
      {
        from: "obs_v",
        to: "external",
        relay: { direction: "out", machine: "mac", repo: "llm-bus", state: "accepted_remote" },
      },
      [],
      "vm",
    );
    assert.deepEqual(
      [vmOut.to[0], vmOut.to.at(-1)],
      [
        { ...scene.mail.hub, z: 0 },
        { ...present(present(vmShip).mail).hub, z: 0 },
      ],
      "the vm half runs from the vm mailroom to this machine's",
    );
    assert.deepEqual(vmOut.from.at(-1), present(present(vmShip).mail).hub);
    assert.deepEqual(
      Scene.pending(
        scene,
        fake,
        [
          {
            to: "external",
            acknowledgedAt: null,
            relay: { direction: "out", machine: "mac", repo: "llm-bus", state: "delivered_local" },
          },
        ],
        "vm",
      ),
      [],
      "delivered to an observed machine: its own mailroom shows the copy, so none is drawn here",
    );
  }
  // Evidence: a highway is verified once mail demonstrably crossed with that machine (received from, or delivered to).
  {
    const base = remote("mac", { peers: [peer("whitenoise", [agent("a")])] });
    const crossed = (messages: NonNullable<RelayBus["messages"]>) =>
      present(
        present(
          Scene.relayNetworks([[null, { health: "available", messages, remote: base }]], NOW)[0],
        ).members[0],
      ).crossed;
    assert.deepEqual(crossed([]), []);
    assert.deepEqual(
      crossed([{ relay: { direction: "out", machine: "whitenoise", state: "accepted_remote" } }]),
      [],
      "held by the relay is not proof of the far end",
    );
    assert.deepEqual(
      crossed([{ relay: { direction: "out", machine: "whitenoise", state: "delivered_local" } }]),
      ["whitenoise"],
    );
    assert.deepEqual(
      crossed([{ relay: { direction: "in", machine: "whitenoise", state: "delivered_local" } }]),
      ["whitenoise"],
    );
  }
  console.log(
    "relay scene: networks and shadows from bus bindings, ghost crew rows, shadow ships docked beside their member, unchanged crew and ssh links, desk-to-desk relay couriers and truthful pending spots OK",
  );
}, 30000);
