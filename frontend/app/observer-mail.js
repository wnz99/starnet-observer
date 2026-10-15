/* Courier display for real llm-bus delivery metadata. A drone stands only for observed message rows: it carries
   no content, and nothing here sends, acknowledges or wakes anything. Times are one monotonic clock (ms). */
"use strict";
const ObserverMail = (() => {
  const LEG = 3200,
    SORT = 800,
    FLIGHT = LEG * 2 + SORT,
    FADE = 600,
    GAP = 6000;
  const MAX_AIRBORNE = 6,
    MAX_QUEUE = 24,
    MAX_STACK = 3;
  const Themes =
    typeof module !== "undefined" && module.exports ? require("./theme-pack.js") : ThemePack;
  const MAIL_KEYS = ["mail-pending", "mail-acknowledged", "mail-unassigned"];

  // Point at `progress` (0..1) along a polyline of world tile coordinates.
  function along(points, progress) {
    const lengths = points
      .slice(1)
      .map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
    let distance =
      Math.max(0, Math.min(1, progress)) * lengths.reduce((sum, value) => sum + value, 0);
    for (let index = 0; index < lengths.length; index++) {
      if (distance <= lengths[index] && lengths[index] > 0) {
        const share = distance / lengths[index],
          a = points[index],
          b = points[index + 1];
        return { x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share };
      }
      distance -= lengths[index];
    }
    return { ...points[points.length - 1] };
  }

  /* `colors` is a scene colour map; only the mail keys are read, each defaulting to the canonical pack. A route
     without a recipient colour (an unassigned recipient) flies in `mail-unassigned`. */
  function createCourier({ colors = {} } = {}) {
    const defaults = Themes.getDefault().scene.colors;
    const [pendingColor, acknowledgedColor, unassignedColor] = MAIL_KEYS.map((key) =>
      typeof colors[key] === "string" ? colors[key] : defaults[key],
    );
    const tint = (route) => route.color || unassignedColor;
    let known = new Map(),
      top = 0,
      lastAt = null,
      deck = null,
      resume = true,
      primed = false;
    let airborne = [],
      queue = [],
      fades = [],
      skipped = 0;
    const clear = () => {
      airborne = [];
      queue = [];
      fades = [];
    };
    // Visibility resume, deck change or reload: the next snapshot rebases instead of replaying history.
    function reset() {
      resume = true;
      clear();
    }
    // Rows of one snapshot on one route share a flight; a full queue counts the row as applied without animation.
    function enqueue(message, route, now) {
      const joining =
        airborne.find((flight) => flight.key === route.key && flight.start === now) ||
        queue.find((flight) => flight.key === route.key);
      if (joining) {
        joining.ids.push(message.id);
        return;
      }
      if (queue.length >= MAX_QUEUE) {
        skipped++;
        return;
      }
      queue.push({
        key: route.key,
        ids: [message.id],
        from: route.from,
        to: route.to,
        color: tint(route),
        start: null,
      });
      step(now);
    }
    /* `route(message)` returns { key, from, to, color }: `from`/`to` are world waypoints that end at the hub.
       `live` is the inventory's own health: routes drawn from a stale pane list are not trusted either.
       Only a live bus and inventory after an already-observed live snapshot can start flights. Anything else
       (first read, stale bus or inventory, deck change, a gap over 6s, reduced motion) clears what is in the
       air, records the truth and unprimes, so the next live snapshot rebases instead of replaying. */
    function update(bus, { now, deck: nextDeck, reduced = false, live = true, route }) {
      const messages = bus && Array.isArray(bus.messages) ? bus.messages : [];
      const animate = live && !!bus && bus.health === "available";
      const newest = messages.reduce((max, message) => Math.max(max, message.id), 0);
      const rebase =
        !animate ||
        resume ||
        !primed ||
        lastAt === null ||
        nextDeck !== deck ||
        now - lastAt > GAP ||
        reduced ||
        newest < top;
      if (rebase) clear();
      else {
        for (const message of messages
          .filter((value) => value.id > top && !known.has(value.id))
          .sort((a, b) => a.id - b.id))
          enqueue(message, route(message), now);
        for (const message of messages) {
          const previous = known.get(message.id);
          if (previous && !previous.acked && message.acknowledgedAt) {
            const path = route(message);
            fades.push({ at: now, point: path.to[0], color: tint(path) });
          }
        }
      }
      known = new Map(messages.map((message) => [message.id, { acked: !!message.acknowledgedAt }]));
      top = rebase ? newest : Math.max(top, newest);
      primed = animate;
      lastAt = now;
      deck = nextDeck;
      resume = false;
      step(now);
    }
    // One airborne flight per route, at most six at once; the rest wait in order.
    function step(now) {
      airborne = airborne.filter((flight) => now - flight.start < FLIGHT);
      fades = fades.filter((fade) => now - fade.at < FADE);
      for (let index = 0; index < queue.length && airborne.length < MAX_AIRBORNE;) {
        if (airborne.some((flight) => flight.key === queue[index].key)) {
          index++;
          continue;
        }
        const [flight] = queue.splice(index, 1);
        flight.start = now;
        airborne.push(flight);
      }
    }
    function position(flight, now) {
      const elapsed = now - flight.start;
      if (elapsed < LEG) return { phase: "pickup", ...along(flight.from, elapsed / LEG) };
      if (elapsed < LEG + SORT) return { phase: "sort", ...flight.from[flight.from.length - 1] };
      return {
        phase: "outbound",
        ...along(flight.to.slice().reverse(), (elapsed - LEG - SORT) / LEG),
      };
    }
    const state = () => ({
      airborne: airborne.map((flight) => ({
        key: flight.key,
        ids: flight.ids.slice(),
        start: flight.start,
      })),
      queued: queue.length,
      skipped,
      fades: fades.length,
    });

    // Renderer-neutral snapshots share the same flight clock and never mutate the engine or input points.
    function frame(now, { reduced = false, pending = [], pads = [] } = {}) {
      const drones = pads
        .slice(0, reduced ? pads.length : Math.max(0, pads.length - airborne.length))
        .map((point) => ({
          point: { ...point, z: 0.4 },
          parked: true,
          phase: "parked",
          parcels: [],
        }));
      if (!reduced)
        for (const flight of airborne) {
          const { phase, ...point } = position(flight, now);
          drones.push({
            point: { ...point, z: phase === "sort" ? 0.4 : 2.2 },
            parked: false,
            phase,
            parcels: Array(Math.min(MAX_STACK, flight.ids.length)).fill(flight.color),
          });
        }
      const envelopes = pending.map((spot) => ({
        ...spot,
        point: { ...spot.point, z: 1.2 },
        alpha: 1,
        color: pendingColor,
      }));
      if (!reduced)
        for (const fade of fades)
          envelopes.push({
            point: { ...fade.point, z: 1.2 },
            count: 1,
            mark: false,
            label: "",
            alpha: Math.max(0, Math.min(1, 1 - (now - fade.at) / FADE)),
            color: acknowledgedColor,
          });
      return { drones, envelopes };
    }

    return { update, step, reset, position, state, frame };
  }

  return { createCourier, along, LEG, SORT, FLIGHT, FADE, GAP, MAX_AIRBORNE, MAX_QUEUE };
})();
if (typeof module !== "undefined" && module.exports) module.exports = ObserverMail;
