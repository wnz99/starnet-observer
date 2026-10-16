import assert from "node:assert/strict";
import { test } from "bun:test";
import {
  createMail,
  along,
  LEG,
  SORT,
  FLIGHT,
  FADE,
  GAP,
  MAX_AIRBORNE,
  MAX_QUEUE,
} from "./mail.js";
import type { CourierMessage, CourierBus } from "./mail/types.js";
import { canonicalTheme } from "./theme.fixture.js";
interface Message extends CourierMessage {
  from: string;
  to: string;
  sentAt: string | null;
  wake: string;
}
function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  assert.ok(value !== undefined);
  return value;
}
const { createCourier } = createMail(canonicalTheme());
test("original courier route, recovery, frame and theme contracts", () => {
  const route = (message: Message) => ({
    key: message.from + ">" + message.to,
    from: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
    to: [
      { x: 20, y: 0 },
      { x: 10, y: 0 },
    ],
    color: "#abcdef",
  });
  const message = (id: number, extra: Partial<Message> = {}) => ({
    id,
    from: "obs_a",
    to: "obs_b",
    sentAt: null,
    acknowledgedAt: null,
    wake: "none",
    ...extra,
  });
  const bus = (messages: Message[], health = "available") => ({
    health,
    window: 100,
    messages: messages.slice().sort((a, b) => b.id - a.id),
  });

  assert.deepEqual(
    along(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
      ],
      0.75,
    ),
    { x: 4, y: 2 },
  );

  {
    const courier = createCourier();
    let now = 1000;
    const history = [message(1), message(2), message(3, { to: "external" })];
    courier.update(bus(history), { now, deck: 0, route });
    assert.deepEqual(
      courier.state(),
      { airborne: [], queued: 0, skipped: 0, fades: 0 },
      "the first snapshot replays no history",
    );

    now = 3000;
    const batch = [...history, message(4), message(5), message(6, { from: "external" })];
    courier.update(bus(batch), { now, deck: 0, route });
    assert.deepEqual(
      courier.state().airborne.map((flight) => [flight.key, flight.ids]),
      [
        ["obs_a>obs_b", [4, 5]],
        ["external>obs_b", [6]],
      ],
      "new rows batch by route",
    );
    const flight = { ...route(message(4)), ids: [4, 5], start: now };
    assert.deepEqual(courier.position(flight, now + LEG / 2), { phase: "pickup", x: 5, y: 0 });
    assert.deepEqual(courier.position(flight, now + LEG + 100), {
      phase: "sort",
      x: 10,
      y: 0,
    });
    assert.deepEqual(courier.position(flight, now + LEG + SORT + LEG / 2), {
      phase: "outbound",
      x: 15,
      y: 0,
    });

    now = 4000;
    courier.update(bus([...batch, message(7)]), { now, deck: 0, route });
    assert.equal(courier.state().queued, 1);
    courier.step(3000 + FLIGHT);
    assert.deepEqual(
      courier.state().airborne.map((flight) => flight.ids),
      [[7]],
    );
    assert.equal(courier.state().queued, 0);

    now = 5000;
    const acked = [...batch, message(7, { wake: "requested" })].map((value) =>
      value.id === 1 ? { ...value, acknowledgedAt: "2026-10-11T10:00:00.000Z" } : value,
    );
    courier.update(bus(acked), { now, deck: 0, route });
    assert.equal(courier.state().fades, 1);
    assert.equal(courier.state().airborne.length, 1);
    courier.step(now + FADE);
    assert.equal(courier.state().fades, 0);

    // Retained stale rows never fly, and are not replayed when the bus comes back.
    now = 6000;
    courier.update(bus([...acked, message(8)], "unavailable"), { now, deck: 0, route });
    assert.equal(courier.state().queued, 0);
    assert(!courier.state().airborne.some((flight) => flight.ids.includes(8)));
    now = 7000;
    courier.update(bus([...acked, message(8)]), { now, deck: 0, route });
    assert(!courier.state().airborne.some((flight) => flight.ids.includes(8)));

    // A deck change rebases and clears flights in the old frame.
    now = 8000;
    courier.update(bus([...acked, message(8), message(9)]), { now, deck: 1, route });
    assert.deepEqual(courier.state().airborne, []);
    assert.equal(courier.state().queued, 0);
    // A gap over six seconds rebases.
    now = 8000 + GAP + 1;
    courier.update(bus([...acked, message(8), message(9), message(10)]), { now, deck: 1, route });
    assert.deepEqual(courier.state().airborne, []);
    // Reduced motion records the truth and never flies.
    now += 1000;
    courier.update(bus([...acked, message(8), message(9), message(10), message(11)]), {
      now,
      deck: 1,
      route,
      reduced: true,
    });
    assert.deepEqual(courier.state().airborne, []);
    // Visibility resume rebases the next snapshot.
    now += 1000;
    courier.update(bus([...acked, message(8), message(9), message(10), message(11)]), {
      now,
      deck: 1,
      route,
    });
    courier.reset();
    now += 1000;
    courier.update(bus([...acked, message(8), message(9), message(10), message(11), message(12)]), {
      now,
      deck: 1,
      route,
    });
    assert.deepEqual(courier.state().airborne, []);
  }

  {
    const courier = createCourier(),
      seed = [message(1)];
    courier.update(bus(seed), { now: 0, deck: 0, route });
    courier.update(bus(seed), { now: 1000, deck: 0, route });
    const many = Array.from({ length: 40 }, (_, index) =>
      message(index + 2, { from: "obs_" + String(index) }),
    );
    courier.update(bus([...seed, ...many]), { now: 2000, deck: 0, route });
    const state = courier.state();
    assert.deepEqual(
      [state.airborne.length, state.queued, state.skipped],
      [MAX_AIRBORNE, MAX_QUEUE, 40 - MAX_AIRBORNE - MAX_QUEUE],
    );
  }

  {
    // A bus that appears after polls without one still rebases first.
    const courier = createCourier();
    courier.update(null, { now: 0, deck: 0, route });
    courier.update(bus([message(1)], "unavailable"), { now: 1000, deck: 0, route });
    courier.update(bus([message(1), message(2)]), { now: 2000, deck: 0, route });
    assert.deepEqual(courier.state().airborne, []);
    courier.update(bus([message(1), message(2), message(3)]), { now: 3000, deck: 0, route });
    assert.deepEqual(
      courier.state().airborne.map((flight) => flight.ids),
      [[3]],
    );
  }
  {
    const courier = createCourier(),
      seed = [message(1)];
    courier.update(bus(seed), { now: 0, deck: 0, route });
    courier.update(bus([...seed, message(2), message(3, { from: "obs_c" })]), {
      now: 1000,
      deck: 0,
      route,
    });
    courier.update(bus([...seed, message(2), message(3, { from: "obs_c" }), message(4)]), {
      now: 1500,
      deck: 0,
      route,
    });
    assert.equal(courier.state().airborne.length, 2);
    assert.equal(courier.state().queued, 1);
    const retained = [...seed, message(2), message(3, { from: "obs_c" }), message(4)];
    courier.update(bus(retained, "unavailable"), { now: 2000, deck: 0, route });
    assert.deepEqual(
      courier.state(),
      { airborne: [], queued: 0, skipped: 0, fades: 0 },
      "stale health clears flights and queue",
    );
    const recovered = [...retained, message(5), message(6, { from: "obs_d" })];
    courier.update(bus(recovered), { now: 3000, deck: 0, route });
    assert.deepEqual(
      courier.state().airborne,
      [],
      "stale -> healthy rebases without replaying outage rows",
    );
    courier.update(bus([...recovered, message(7)]), { now: 4000, deck: 0, route });
    assert.deepEqual(
      courier.state().airborne.map((flight) => flight.ids),
      [[7]],
      "the next live row flies normally",
    );

    // A live bus with a stale pane inventory shows no flights, and recovery rebases the same way.
    courier.update(bus([...recovered, message(7), message(8)]), {
      now: 5000,
      deck: 0,
      route,
      live: false,
    });
    assert.deepEqual(
      [courier.state().airborne, courier.state().queued],
      [[], 0],
      "stale inventory routes nothing",
    );
    courier.update(bus([...recovered, message(7), message(8), message(9)]), {
      now: 6000,
      deck: 0,
      route,
    });
    assert.deepEqual(courier.state().airborne, []);
    courier.update(bus([...recovered, message(7), message(8), message(9), message(10)]), {
      now: 7000,
      deck: 0,
      route,
    });
    assert.deepEqual(
      courier.state().airborne.map((flight) => flight.ids),
      [[10]],
    );
  }
  {
    const courier = createCourier(),
      pending = [{ point: { x: 3, y: 4 }, count: 2, mark: true, label: "D2" }],
      pads = [{ x: 7, y: 9 }];
    courier.update(bus([message(1)]), { now: 0, deck: 0, route });
    courier.update(bus([message(1), message(2)]), { now: 1000, deck: 0, route });
    let frame = courier.frame(1500, { reduced: false, pending, pads });
    assert.equal(at(frame.drones, 0).point.z, 2.2);
    assert.equal(at(frame.drones, 0).phase, "pickup");
    assert.equal(at(frame.envelopes, 0).point.z, 1.2);
    assert.equal(at(frame.envelopes, 0).count, 2);
    Reflect.set(at(frame.envelopes, 0).point, "x", 999);
    assert.equal(at(pending, 0).point.x, 3, "frames do not mutate source points");
    frame = courier.frame(1000 + LEG + 1, { reduced: false, pending, pads });
    assert.equal(at(frame.drones, 0).phase, "sort");
    assert.equal(at(frame.drones, 0).point.z, 0.4);
    frame = courier.frame(1500, { reduced: true, pending, pads });
    assert(frame.drones.every((d) => d.parked));
    assert.equal(frame.drones.length, pads.length);
    assert.equal(at(frame.drones, 0).point.z, 0.4);
  }
  {
    const courier = createCourier();
    courier.update(bus([message(1)]), { now: 0, deck: 0, route });
    courier.update(bus([1, 2, 3, 4, 5].map((id) => message(id))), { now: 1000, deck: 0, route });
    const frame = courier.frame(1200, {});
    assert.deepEqual(
      at(frame.drones, 0).parcels,
      ["#abcdef", "#abcdef", "#abcdef"],
      "route batch parcels keep destination color and three-item cap",
    );
    courier.update(
      bus([message(1, { acknowledgedAt: "now" }), ...[2, 3, 4, 5].map((id) => message(id))]),
      { now: 2000, deck: 0, route },
    );
    const fade = at(courier.frame(2000 + FADE / 2, {}).envelopes, 0);
    assert.equal(fade.alpha, 0.5);
    assert.equal(fade.color, "#9fe7b9");
    assert.equal(fade.point.z, 1.2);
    courier.step(2000 + FADE);
    assert.equal(
      courier.frame(2000 + FADE, {}).envelopes.length,
      0,
      "acknowledged envelope expires on original engine clock",
    );
  }

  {
    const defaults = canonicalTheme().scene.colors;
    const colors = {
      ...defaults,
      "mail-pending": "#102030",
      "mail-acknowledged": "#203040",
      "mail-unassigned": "#304050",
    };
    // A route whose recipient has no project colour (Scene.route returns null) flies in the unassigned colour.
    const mixed = (item: Message) => ({
      ...route(item),
      color: item.to === "external" ? null : "#abcdef",
    });
    const drive = (courier: ReturnType<typeof createCourier>) => {
      courier.update(bus([message(1)]), { now: 0, deck: 0, route: mixed });
      courier.update(bus([message(1), message(2), message(3, { to: "external" })]), {
        now: 1000,
        deck: 0,
        route: mixed,
      });
      courier.update(
        bus([message(1, { acknowledgedAt: "now" }), message(2), message(3, { to: "external" })]),
        { now: 1500, deck: 0, route: mixed },
      );
      const pending = [{ point: { x: 3, y: 4 }, count: 1, mark: false, label: "" }];
      return {
        state: courier.state(),
        frame: courier.frame(1700, { pending, pads: [{ x: 1, y: 1 }] }),
      };
    };
    const plain = drive(createCourier()),
      themed = drive(createCourier({ colors }));
    assert.deepEqual(themed.state, plain.state, "same flights and queue");
    const shape = (frame: ReturnType<ReturnType<typeof createCourier>["frame"]>) =>
      JSON.stringify({
        drones: frame.drones.map((drone) => ({ ...drone, parcels: drone.parcels.length })),
        envelopes: frame.envelopes.map(({ point, count, mark, label, alpha }) => ({
          point,
          count,
          mark,
          label,
          alpha,
        })),
      });
    assert.equal(shape(themed.frame), shape(plain.frame), "same drone and envelope positions");
    const parcels = (frame: ReturnType<ReturnType<typeof createCourier>["frame"]>) =>
      frame.drones.flatMap((drone) => drone.parcels);
    assert.deepEqual(
      parcels(plain.frame).sort(),
      ["#abcdef", defaults["mail-unassigned"]].sort(),
      "default unassigned colour comes from the canonical pack",
    );
    assert.deepEqual(
      parcels(themed.frame).sort(),
      ["#abcdef", "#304050"].sort(),
      "recipient colours stay; unassigned is themed",
    );
    assert.deepEqual(
      plain.frame.envelopes.map((envelope) => envelope.color),
      [defaults["mail-pending"], defaults["mail-acknowledged"]],
    );
    assert.deepEqual(
      themed.frame.envelopes.map((envelope) => envelope.color),
      ["#102030", "#203040"],
      "pending and acknowledged envelopes are themed",
    );
  }
});

test("partial observed buses never invent a courier flight", () => {
  const courier = createMail(canonicalTheme()).createCourier();
  const buses: CourierBus<CourierMessage>[] = [
    {},
    { health: "available" },
    { messages: [{ id: 1 }] },
  ];
  for (const [now, bus] of buses.entries()) {
    courier.update(bus, {
      now,
      deck: 0,
      route() {
        throw new Error("A partial observation must not launch mail");
      },
    });
    assert.deepEqual(courier.state(), { airborne: [], queued: 0, skipped: 0, fades: 0 });
  }
});
