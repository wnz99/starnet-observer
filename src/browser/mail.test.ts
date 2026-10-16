import { test, expect } from "bun:test";
import { createMail, along, LEG, SORT, FLIGHT, FADE, MAX_AIRBORNE, MAX_QUEUE } from "./mail.js";
import { canonicalTheme } from "./theme.fixture.js";
interface Message {
  id: number;
  from: string;
  to: string;
  acknowledgedAt: string | null;
}
const message = (id: number, extra: Partial<Message> = {}): Message => ({
  id,
  from: "a",
  to: "b",
  acknowledgedAt: null,
  ...extra,
});
const route = (row: Message) => ({
  key: `${row.from}>${row.to}`,
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
const bus = (messages: Message[], health = "available") => ({ messages, health });

test("couriers rebase history, batch routes, queue busy routes, and preserve the flight clock", () => {
  const courier = createMail(canonicalTheme()).createCourier();
  courier.update(bus([message(1)]), { now: 0, deck: 0, route });
  expect(courier.state().airborne).toEqual([]);
  courier.update(bus([message(1), message(2), message(3)]), { now: 1000, deck: 0, route });
  expect(courier.state().airborne.map((flight) => flight.ids)).toEqual([[2, 3]]);
  const flight = { ...route(message(2)), color: "#abcdef", ids: [2, 3], start: 1000 };
  expect(courier.position(flight, 1000 + LEG / 2)).toEqual({ phase: "pickup", x: 5, y: 0 });
  expect(courier.position(flight, 1000 + LEG + 100)).toEqual({ phase: "sort", x: 10, y: 0 });
  expect(courier.position(flight, 1000 + LEG + SORT + LEG / 2)).toEqual({
    phase: "outbound",
    x: 15,
    y: 0,
  });
  courier.update(bus([message(1), message(2), message(3), message(4)]), {
    now: 2000,
    deck: 0,
    route,
  });
  expect(courier.state().queued).toBe(1);
  courier.step(1000 + FLIGHT);
  expect(courier.state().airborne.map((item) => item.ids)).toEqual([[4]]);
  expect(
    along(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
      ],
      0.75,
    ),
  ).toEqual({ x: 4, y: 2 });
});
test("stale bus and inventory ground flights; recovery, deck changes and visibility never replay history", () => {
  const courier = createMail(canonicalTheme()).createCourier();
  const rows = [message(1)];
  courier.update(bus(rows), { now: 0, deck: 0, route });
  rows.push(message(2));
  courier.update(bus(rows), { now: 1000, deck: 0, route });
  expect(courier.state().airborne).toHaveLength(1);
  rows.push(message(3));
  courier.update(bus(rows, "unavailable"), { now: 2000, deck: 0, route });
  expect(courier.state().airborne).toEqual([]);
  rows.push(message(4));
  courier.update(bus(rows), { now: 3000, deck: 0, route });
  expect(courier.state().airborne).toEqual([]);
  rows.push(message(5));
  courier.update(bus(rows), { now: 4000, deck: 0, route });
  expect(courier.state().airborne.map((flight) => flight.ids)).toEqual([[5]]);
  courier.update(bus(rows), { now: 5000, deck: 0, route, live: false });
  expect(courier.state().airborne).toEqual([]);
  courier.update(bus(rows), { now: 6000, deck: 1, route });
  courier.reset();
  rows.push(message(6));
  courier.update(bus(rows), { now: 7000, deck: 1, route });
  expect(courier.state().airborne).toEqual([]);
});
test("bounded queue, ACK fade, reduced motion and theme colors preserve rendering inputs", () => {
  const courier = createMail(canonicalTheme()).createCourier({
    colors: {
      "mail-pending": "#102030",
      "mail-acknowledged": "#203040",
      "mail-unassigned": "#304050",
    },
  });
  const rows = [message(1)];
  courier.update(bus(rows), { now: 0, deck: 0, route });
  rows.push(
    ...Array.from({ length: 40 }, (_, index) => message(index + 2, { from: String(index) })),
  );
  courier.update(bus(rows), { now: 1000, deck: 0, route });
  expect(courier.state()).toMatchObject({
    queued: MAX_QUEUE,
    skipped: 40 - MAX_AIRBORNE - MAX_QUEUE,
  });
  expect(courier.state().airborne).toHaveLength(MAX_AIRBORNE);
  const pending = [{ point: { x: 3, y: 4 }, count: 2, mark: true, label: "D2" }];
  const frame = courier.frame(1200, { pending, pads: [{ x: 7, y: 9 }], reduced: true });
  expect(frame.drones.every((drone) => drone.parked)).toBeTruthy();
  expect(frame.envelopes[0]).toMatchObject({ point: { x: 3, y: 4, z: 1.2 }, color: "#102030" });
  const first = rows[0];
  if (!first) throw new Error("Missing fixture");
  first.acknowledgedAt = "now";
  courier.update(bus(rows), { now: 2000, deck: 0, route });
  expect(courier.frame(2000 + FADE / 2).envelopes[0]).toMatchObject({
    alpha: 0.5,
    color: "#203040",
  });
  courier.step(2000 + FADE);
  expect(courier.frame(2000 + FADE).envelopes).toEqual([]);
  expect(pending).toEqual([{ point: { x: 3, y: 4 }, count: 2, mark: true, label: "D2" }]);
});
