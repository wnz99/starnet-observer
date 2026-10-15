"use strict";
// The observer needs only authenticated JSON GETs (plus opt-in control POSTs), not StarNet's provider/runtime client.
const Harness = {
  /* A restarted server issues a new per-launch token, so an open page's polls all come back 403 and the station
     freezes as stale. Reload once to pick up the new token instead of sitting frozen until someone notices. */
  reloadScheduled: false,
  tokenRejected(response, body) {
    if (response.status !== 403 || !/token/i.test(String((body && body.error) || ""))) return;
    if (Harness.reloadScheduled || !window.location || typeof window.location.reload !== "function")
      return;
    Harness.reloadScheduled = true;
    setTimeout(() => window.location.reload(), 1500);
  },
  api: {
    async get(path, options = {}) {
      const response = await fetch(path, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        signal: options.signal,
        headers: { "X-Observer-Token": window.__OBSERVER_TOKEN__ },
      });
      const body = await response.json();
      if (!response.ok) {
        Harness.tokenRejected(response, body);
        throw new Error(body.error || "Observer request failed (" + response.status + ")");
      }
      return body;
    },
    // Control actions (OBSERVER_CONTROL=1 only): the one POST surface, same token, JSON body.
    async post(path, payload) {
      const response = await fetch(path, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "X-Observer-Token": window.__OBSERVER_TOKEN__,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload || {}),
      });
      const body = await response.json();
      if (!response.ok) {
        Harness.tokenRejected(response, body);
        throw new Error(body.error || "Observer request failed (" + response.status + ")");
      }
      return body;
    },
  },
};
