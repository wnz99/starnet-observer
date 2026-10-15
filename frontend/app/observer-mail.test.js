'use strict';
const { test } = require('bun:test');

test("observer-mail regression contracts", async () => {
const assert = require('node:assert/strict');
const Mail = require('./observer-mail.js');

// Every route runs desk (x 0) → hub (x 10) for pickup and hub → desk (x 20) outbound.
const route = message => ({ key: message.from + '>' + message.to, from: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
  to: [{ x: 20, y: 0 }, { x: 10, y: 0 }], color: '#abcdef' });
const message = (id, extra = {}) => ({ id, from: 'obs_a', to: 'obs_b', sentAt: null, acknowledgedAt: null, wake: 'none', ...extra });
const bus = (messages, health = 'available') => ({ health, window: 100, messages: messages.slice().sort((a, b) => b.id - a.id) });

assert.deepEqual(Mail.along([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], 0.75), { x: 4, y: 2 });

{
  const courier = Mail.createCourier();
  let now = 1000;
  const history = [message(1), message(2), message(3, { to: 'external' })];
  courier.update(bus(history), { now, deck: 0, route });
  assert.deepEqual(courier.state(), { airborne: [], queued: 0, skipped: 0, fades: 0 }, 'the first snapshot replays no history');

  now = 3000;
  const batch = [...history, message(4), message(5), message(6, { from: 'external' })];
  courier.update(bus(batch), { now, deck: 0, route });
  assert.deepEqual(courier.state().airborne.map(flight => [flight.key, flight.ids]), [['obs_a>obs_b', [4, 5]], ['external>obs_b', [6]]], 'new rows batch by route');
  const flight = { from: route(message(4)).from, to: route(message(4)).to, start: now };
  assert.deepEqual(courier.position(flight, now + Mail.LEG / 2), { phase: 'pickup', x: 5, y: 0 });
  assert.deepEqual(courier.position(flight, now + Mail.LEG + 100), { phase: 'sort', x: 10, y: 0 });
  assert.deepEqual(courier.position(flight, now + Mail.LEG + Mail.SORT + Mail.LEG / 2), { phase: 'outbound', x: 15, y: 0 });

  // One flight per route: a later row on a busy route waits, then flies once the first lands.
  now = 4000;
  courier.update(bus([...batch, message(7)]), { now, deck: 0, route });
  assert.equal(courier.state().queued, 1);
  courier.step(3000 + Mail.FLIGHT);
  assert.deepEqual(courier.state().airborne.map(flight => flight.ids), [[7]]);
  assert.equal(courier.state().queued, 0);

  // Acknowledgement fades for 600ms; wake changes alone start nothing.
  now = 5000;
  const acked = [...batch, message(7, { wake: 'requested' })].map(value => value.id === 1 ? { ...value, acknowledgedAt: '2026-10-11T10:00:00.000Z' } : value);
  courier.update(bus(acked), { now, deck: 0, route });
  assert.equal(courier.state().fades, 1); assert.equal(courier.state().airborne.length, 1);
  courier.step(now + Mail.FADE); assert.equal(courier.state().fades, 0);

  // Retained stale rows never fly, and are not replayed when the bus comes back.
  now = 6000;
  courier.update(bus([...acked, message(8)], 'unavailable'), { now, deck: 0, route });
  assert.equal(courier.state().queued, 0); assert(!courier.state().airborne.some(flight => flight.ids.includes(8)));
  now = 7000;
  courier.update(bus([...acked, message(8)]), { now, deck: 0, route });
  assert(!courier.state().airborne.some(flight => flight.ids.includes(8)));

  // A deck change rebases and clears flights in the old frame.
  now = 8000;
  courier.update(bus([...acked, message(8), message(9)]), { now, deck: 1, route });
  assert.deepEqual(courier.state().airborne, []); assert.equal(courier.state().queued, 0);
  // A gap over six seconds rebases.
  now = 8000 + Mail.GAP + 1;
  courier.update(bus([...acked, message(8), message(9), message(10)]), { now, deck: 1, route });
  assert.deepEqual(courier.state().airborne, []);
  // Reduced motion records the truth and never flies.
  now += 1000;
  courier.update(bus([...acked, message(8), message(9), message(10), message(11)]), { now, deck: 1, route, reduced: true });
  assert.deepEqual(courier.state().airborne, []);
  // Visibility resume rebases the next snapshot.
  now += 1000; courier.update(bus([...acked, message(8), message(9), message(10), message(11)]), { now, deck: 1, route });
  courier.reset(); now += 1000;
  courier.update(bus([...acked, message(8), message(9), message(10), message(11), message(12)]), { now, deck: 1, route });
  assert.deepEqual(courier.state().airborne, []);
}

{
  // Overflow is bounded: six airborne, 24 queued, the rest counted as applied without animation.
  const courier = Mail.createCourier(), seed = [message(1)];
  courier.update(bus(seed), { now: 0, deck: 0, route });
  courier.update(bus(seed), { now: 1000, deck: 0, route });
  const many = Array.from({ length: 40 }, (_, index) => message(index + 2, { from: 'obs_' + index }));
  courier.update(bus([...seed, ...many]), { now: 2000, deck: 0, route });
  const state = courier.state();
  assert.deepEqual([state.airborne.length, state.queued, state.skipped], [Mail.MAX_AIRBORNE, Mail.MAX_QUEUE, 40 - Mail.MAX_AIRBORNE - Mail.MAX_QUEUE]);
}

{
  // A bus that appears after polls without one still rebases first.
  const courier = Mail.createCourier();
  courier.update(null, { now: 0, deck: 0, route });
  courier.update(bus([message(1)], 'unavailable'), { now: 1000, deck: 0, route });
  courier.update(bus([message(1), message(2)]), { now: 2000, deck: 0, route });
  assert.deepEqual(courier.state().airborne, []);
  courier.update(bus([message(1), message(2), message(3)]), { now: 3000, deck: 0, route });
  assert.deepEqual(courier.state().airborne.map(flight => flight.ids), [[3]]);
}
{
  // A stale bus grounds what is in the air and unprimes: rows that arrived during the outage never replay.
  const courier = Mail.createCourier(), seed = [message(1)];
  courier.update(bus(seed), { now: 0, deck: 0, route });
  courier.update(bus([...seed, message(2), message(3, { from: 'obs_c' })]), { now: 1000, deck: 0, route });
  courier.update(bus([...seed, message(2), message(3, { from: 'obs_c' }), message(4)]), { now: 1500, deck: 0, route });
  assert.equal(courier.state().airborne.length, 2); assert.equal(courier.state().queued, 1);
  const retained = [...seed, message(2), message(3, { from: 'obs_c' }), message(4)];
  courier.update(bus(retained, 'unavailable'), { now: 2000, deck: 0, route });
  assert.deepEqual(courier.state(), { airborne: [], queued: 0, skipped: 0, fades: 0 }, 'stale health clears flights and queue');
  const recovered = [...retained, message(5), message(6, { from: 'obs_d' })];
  courier.update(bus(recovered), { now: 3000, deck: 0, route });
  assert.deepEqual(courier.state().airborne, [], 'stale -> healthy rebases without replaying outage rows');
  courier.update(bus([...recovered, message(7)]), { now: 4000, deck: 0, route });
  assert.deepEqual(courier.state().airborne.map(flight => flight.ids), [[7]], 'the next live row flies normally');

  // A live bus with a stale pane inventory shows no flights, and recovery rebases the same way.
  courier.update(bus([...recovered, message(7), message(8)]), { now: 5000, deck: 0, route, live: false });
  assert.deepEqual([courier.state().airborne, courier.state().queued], [[], 0], 'stale inventory routes nothing');
  courier.update(bus([...recovered, message(7), message(8), message(9)]), { now: 6000, deck: 0, route });
  assert.deepEqual(courier.state().airborne, []);
  courier.update(bus([...recovered, message(7), message(8), message(9), message(10)]), { now: 7000, deck: 0, route });
  assert.deepEqual(courier.state().airborne.map(flight => flight.ids), [[10]]);
}
{
  const courier = Mail.createCourier(), pending = [{ point: { x: 3, y: 4 }, count: 2, mark: true, label: 'D2' }], pads = [{ x: 7, y: 9 }];
  courier.update(bus([message(1)]), { now: 0, deck: 0, route });
  courier.update(bus([message(1), message(2)]), { now: 1000, deck: 0, route });
  let frame = courier.frame(1500, { reduced: false, pending, pads });
  assert.equal(frame.drones[0].point.z, 2.2); assert.equal(frame.drones[0].phase, 'pickup');
  assert.equal(frame.envelopes[0].point.z, 1.2); assert.equal(frame.envelopes[0].count, 2);
  frame.envelopes[0].point.x = 999; assert.equal(pending[0].point.x, 3, 'frames do not mutate source points');
  frame = courier.frame(1000 + Mail.LEG + 1, { reduced: false, pending, pads });
  assert.equal(frame.drones[0].phase, 'sort'); assert.equal(frame.drones[0].point.z, 0.4);
  frame = courier.frame(1500, { reduced: true, pending, pads });
  assert(frame.drones.every(d => d.parked)); assert.equal(frame.drones.length, pads.length);
  assert.equal(frame.drones[0].point.z, 0.4);
}
{
  const courier = Mail.createCourier(); courier.update(bus([message(1)]), { now: 0, deck: 0, route });
  courier.update(bus([1, 2, 3, 4, 5].map(id => message(id))), { now: 1000, deck: 0, route });
  const frame = courier.frame(1200, {});
  assert.deepEqual(frame.drones[0].parcels, ['#abcdef', '#abcdef', '#abcdef'], 'route batch parcels keep destination color and three-item cap');
  courier.update(bus([message(1, { acknowledgedAt: 'now' }), ...[2, 3, 4, 5].map(id => message(id))]), { now: 2000, deck: 0, route });
  const fade = courier.frame(2000 + Mail.FADE / 2, {}).envelopes[0];
  assert.equal(fade.alpha, 0.5); assert.equal(fade.color, '#9fe7b9'); assert.equal(fade.point.z, 1.2);
  courier.step(2000 + Mail.FADE); assert.equal(courier.frame(2000 + Mail.FADE, {}).envelopes.length, 0, 'acknowledged envelope expires on original engine clock');
}
console.log('observer mail: stale bus/inventory grounding and rebase, no history replay, route batching, clocked legs, queue/overflow bounds, ACK fade, stale/deck/gap/reduced/resume rebase and projected frames OK');

// Theme mail colours change only appearance: same flights, positions and parcels' destination colours as the default.
{
  const defaults = require('../assets/themes/starnet/theme.json').scene.colors;
  const colors = { ...defaults, 'mail-pending': '#102030', 'mail-acknowledged': '#203040', 'mail-unassigned': '#304050' };
  // A route whose recipient has no project colour (Scene.route returns null) flies in the unassigned colour.
  const mixed = item => ({ ...route(item), color: item.to === 'external' ? null : '#abcdef' });
  const drive = courier => {
    courier.update(bus([message(1)]), { now: 0, deck: 0, route: mixed });
    courier.update(bus([message(1), message(2), message(3, { to: 'external' })]), { now: 1000, deck: 0, route: mixed });
    courier.update(bus([message(1, { acknowledgedAt: 'now' }), message(2), message(3, { to: 'external' })]), { now: 1500, deck: 0, route: mixed });
    const pending = [{ point: { x: 3, y: 4 }, count: 1, mark: false, label: '' }];
    return { state: courier.state(), frame: courier.frame(1700, { pending, pads: [{ x: 1, y: 1 }] }) };
  };
  const plain = drive(Mail.createCourier()), themed = drive(Mail.createCourier({ colors }));
  assert.deepEqual(themed.state, plain.state, 'same flights and queue');
  const shape = frame => JSON.stringify({ drones: frame.drones.map(drone => ({ ...drone, parcels: drone.parcels.length })), envelopes: frame.envelopes.map(({ color, ...rest }) => rest) });
  assert.equal(shape(themed.frame), shape(plain.frame), 'same drone and envelope positions');
  const parcels = frame => frame.drones.flatMap(drone => drone.parcels);
  assert.deepEqual(parcels(plain.frame).sort(), ['#abcdef', defaults['mail-unassigned']].sort(), 'default unassigned colour comes from the canonical pack');
  assert.deepEqual(parcels(themed.frame).sort(), ['#abcdef', '#304050'].sort(), 'recipient colours stay; unassigned is themed');
  assert.deepEqual(plain.frame.envelopes.map(envelope => envelope.color), [defaults['mail-pending'], defaults['mail-acknowledged']]);
  assert.deepEqual(themed.frame.envelopes.map(envelope => envelope.color), ['#102030', '#203040'], 'pending and acknowledged envelopes are themed');
  console.log('theme mail colours: same routes and frames, themed envelopes and unassigned parcels OK');
}

}, 30000);
