import { element, required } from "../model/types.js";
import { projectKey } from "../model/identity.js";
import type {
  Scene,
  MailLayout,
  SceneMessage,
  Host,
  Point,
  PendingSpot,
  MessageRelay,
  RelayLink,
  Worker,
} from "./types.js";
import type { LayoutRow } from "../model/types.js";
const MAIL = { half: 2, pendingHeight: 1.2 };
const WAKE_MARKS = ["failed", "unsupported", "unknown"];
export const mailOf = (scene: Scene, host: Host) =>
  host ? (scene.ships || []).find((ship) => ship.id === host)?.mail || null : scene.mail;
export function endpoint(
  scene: Scene,
  layout: MailLayout,
  id: string,
  host: Host = null,
): { key: string; points: Point[]; deck?: number } {
  const own = mailOf(scene, host) || scene.mail;
  if (layout.seatFor(id) !== undefined) {
    const page = layout.pageFor(id),
      worker = scene.workers.find((w) => w.id === id);
    // Only a worker of this host's own ship can be a courier endpoint; anything else falls back to this host's pod.
    if (page === scene.page && worker && (worker.row.host || null) === host)
      return { key: id, points: worker.route ?? own.chute };
    return { key: "pod", points: own.pod, deck: (page ?? NaN) + 1 };
  }
  return { key: "chute", points: own.chute };
}
/* A relayed message's far side, as courier waypoints ending at this host's own hub: the far agent's desk on its shadow
   ship (desk → its mailroom → across the relay link → here), else that machine's mailroom (a shadow ship without that
   agent listed, or an observed machine, whose own bus shows the other half of the crossing). Null when no relay link
   from this host reaches that machine: the message then uses the plain outside chute. */
function relayLinkFor(scene: Scene, relay: MessageRelay, host: Host): RelayLink | undefined {
  return (scene.relays || [])
    .flatMap((value) => value.links)
    .find(
      (value) =>
        (value.from === host && value.machine === relay.machine) ||
        (value.to === host &&
          (scene.relays || []).some((net) =>
            net.members.some(
              (member) => member.host === value.from && member.machine === relay.machine,
            ),
          )),
    );
}
function ghostFor(
  scene: Scene,
  relay: MessageRelay,
  link: RelayLink,
  host: Host,
): Worker | undefined {
  if (!link.shadow || !relay.peer) return undefined;
  return scene.workers.find((worker) => worker.id === relay.peer && worker.row.host === host);
}
function relayEnd(scene: Scene, message: SceneMessage, host: Host) {
  const relay = message.relay;
  if (!relay) return null;
  const link = relayLinkFor(scene, relay, host);
  if (!link) return null;
  const farHost = link.from === host ? link.to : link.from,
    far = mailOf(scene, farHost);
  if (!far) return null;
  const ghost = ghostFor(scene, relay, link, farHost);
  // The highway from the far mailroom to this one (its path runs from the link's observed end).
  const across = (link.from === host ? link.path.slice().reverse() : link.path).map((point) => ({
    ...point,
    z: 0,
  }));
  return ghost
    ? {
        key: ghost.id,
        points: [...(ghost.route ?? []).slice(0, -1), ...across],
        desk: true,
        link,
        across,
      }
    : {
        key: `ship:${String(farHost)}`,
        points: across,
        desk: false,
        link,
        across,
        observed: !link.shadow,
      };
}
// The point halfway along a polyline (by length): where mail the relay holds is drawn on its highway.
function halfway(points: readonly Point[]) {
  const lengths = points
    .slice(1)
    .map((point, index) =>
      Math.hypot(point.x - element(points, index).x, point.y - element(points, index).y),
    );
  let left = lengths.reduce((sum, value) => sum + value, 0) / MAIL.half;
  for (let index = 0; index < lengths.length; index++) {
    if (left <= element(lengths, index) && element(lengths, index) > 0) {
      const t = left / element(lengths, index),
        a = element(points, index),
        b = element(points, index + 1);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: 0 };
    }
    left -= element(lengths, index);
  }
  return { ...element(points, points.length - 1), z: 0 };
}
function messageEndpoints(scene: Scene, layout: MailLayout, message: SceneMessage, host: Host) {
  const far = message.relay ? relayEnd(scene, message, host) : null;
  if (!far)
    return {
      from: endpoint(scene, layout, message.from ?? "", host),
      to: endpoint(scene, layout, message.to ?? "", host),
      recipientId: message.to,
    };
  if (message.relay?.direction === "out")
    return {
      from: endpoint(scene, layout, message.from ?? "", host),
      to: far,
      recipientId: message.relay.peer,
    };
  return {
    from: far,
    to: endpoint(scene, layout, message.to ?? "", host),
    recipientId: message.to,
  };
}
export function route(
  ...[scene, layout, message, rows, host = null]: [
    Scene,
    MailLayout,
    SceneMessage,
    readonly LayoutRow[],
    Host?,
  ]
) {
  const { from, to, recipientId } = messageEndpoints(scene, layout, message, host);
  const recipient = rows.find((row) => row.id === recipientId);
  return {
    key: `${from.key}>${to.key}`,
    from: from.points,
    to: to.points,
    color: recipient ? layout.colorFor(projectKey(recipient)).accent : null,
  };
  // The courier colours unassigned recipients.
}
type MailEnd = { key: string; points: Point[]; deck?: number };
type RelayEnd = NonNullable<ReturnType<typeof relayEnd>>;
function relayPending(
  own: NonNullable<ReturnType<typeof mailOf>>,
  far: RelayEnd,
  state: string | undefined,
): MailEnd {
  if (state === "queued_local") return { key: "queued", points: [element(own.chute, 0)] };
  if (state === "accepted_remote")
    return { key: `relay:${far.key}`, points: [halfway(far.across)] };
  return { key: far.key, points: far.points };
}
/* Outgoing relayed mail waits where llm-bus last proved it is: this mailroom when queued, halfway along the relay
   link once the relay holds it, and at the far agent's desk once delivered there (an observed far machine shows
   its own copy, so none is drawn here). Expired mail is not waiting anywhere. */
function pendingGone(state: string | undefined, far: RelayEnd | null) {
  return state === "expired" || (state === "delivered_local" && far?.observed);
}
function pendingEnd(
  scene: Scene,
  layout: MailLayout,
  message: SceneMessage,
  host: Host,
): MailEnd | null {
  const far = message.relay?.direction === "out" ? relayEnd(scene, message, host) : null;
  const state = message.relay?.state;
  if (pendingGone(state, far)) return null;
  if (far) return relayPending(mailOf(scene, host) || scene.mail, far, state);
  return endpoint(scene, layout, message.to ?? "", host);
}
export function pending(
  scene: Scene,
  layout: MailLayout,
  messages: readonly SceneMessage[],
  host: Host = null,
) {
  const spots = new Map<string, PendingSpot>();
  for (const message of messages) {
    if (message.acknowledgedAt) continue;
    const end = pendingEnd(scene, layout, message, host);
    if (!end) continue;
    const key = `${end.key}:${end.deck ? String(end.deck) : ""}`;
    if (!spots.has(key))
      spots.set(key, {
        point: { ...element(end.points, 0), z: MAIL.pendingHeight },
        count: 0,
        mark: false,
        label: end.deck ? `D${String(end.deck)}` : "",
      });
    const spot = required(spots, key);
    spot.count++;
    if (WAKE_MARKS.includes(message.wake ?? "")) spot.mark = true;
  }
  return [...spots.values()];
}
