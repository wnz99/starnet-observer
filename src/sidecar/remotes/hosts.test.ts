import { test } from "bun:test";
import assert from "node:assert/strict";
import { makeRemoteHosts } from "./hosts.js";
import { fakeSpawn, fakeTimers, row, required } from "./remotes.fixture.js";

test("close withdraws every host proof before any child teardown callback", () => {
  const fake = fakeSpawn();
  const timers = fakeTimers();
  const hosts = makeRemoteHosts({
    remotes: [
      { id: "first", ssh: "one" },
      { id: "second", ssh: "two" },
    ],
    spawn: fake.spawn,
    now: () => 1,
    ...timers,
  });
  const first = required(fake.children[0]);
  const second = required(fake.children[1]);
  second.stdout.emit(
    "data",
    JSON.stringify({
      health: "available",
      sessions: [row()],
      targets: [
        {
          pane_id: "w1:p1",
          workspace_id: "w1",
          terminal_id: "t1",
          agent: "claude",
          agent_session: null,
        },
      ],
    }) + "\n",
  );
  assert(hosts.controlTarget("second", "w1:p1"));
  const end = first.stdin.end;
  let duringClose: ReturnType<typeof hosts.controlTarget> | undefined;
  first.stdin.end = () => {
    end();
    duringClose = hosts.controlTarget("second", "w1:p1");
    second.emit("close", 0);
  };
  hosts.close();
  assert.equal(duringClose, null);
  assert.equal(timers.timers.length, 0, "another host cannot schedule a reconnect during shutdown");
  assert.equal(first.killed, "SIGTERM");
});
