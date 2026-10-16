import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { makeControl } from "./index.js";
import type { ControlOptions, Execute } from "./types.js";
import { object } from "../overseer-state/identity.js";

async function uncertainOverseer() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "observer-uncertain-"));
  const endpoint = "/fixture/pinned.sock",
    calls: string[][] = [];
  let missing = false,
    valid = false;
  const identity = {
    pane_id: "target",
    workspace_id: "work",
    terminal_id: "term",
    agent: "claude",
  };
  const execute: Execute = (command, args, settings) =>
    Promise.resolve().then(() => {
      calls.push([command, ...args]);
      assert.equal(settings.env?.HERDR_SOCKET_PATH, endpoint);
      const key = args.slice(0, 2).join(" ");
      const reply = (result: unknown) => ({ stdout: JSON.stringify({ result }) });
      if (command === "osascript") return { stdout: "" };
      if (key === "workspace create") return reply({ root_pane: { pane_id: "target" } });
      if (["pane wait-output", "agent start"].includes(key)) return reply({});
      if (key === "agent get")
        return reply({ agent: valid ? identity : { ...identity, terminal_id: null } });
      if (key === "pane get") {
        if (missing) {
          missing = false;
          throw Object.assign(new Error("CLI exit 1"), {
            stdout: JSON.stringify({
              error: { code: "pane_not_found", message: "pane target not found" },
            }),
          });
        }
        return reply({ pane: identity });
      }
      if (key === "agent list") return reply({ agents: [] });
      throw Error("unexpected call");
    });
  const options: ControlOptions = {
    execute,
    endpoint,
    platform: "darwin",
    overseerHome: home,
    sleep: () => Promise.resolve(),
  };
  try {
    await assert.rejects(makeControl(options).overseer("claude"), /overseer-unavailable/);
    assert(!calls.some((call) => call[0] === "osascript"), "unverified launch is never attached");
    const created = () =>
      calls.filter((call) => call[1] === "workspace" && call[2] === "create").length;
    await assert.rejects(makeControl(options).overseer("claude"), /overseer-unavailable/);
    assert.equal(created(), 1, "uncertain launch survives observer/control restart");
    missing = true;
    valid = true;
    await makeControl(options).overseer("claude");
    assert.equal(created(), 2, "only confirmed missing pane permits replacement");
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

async function providerBriefs() {
  for (const provider of ["claude", "codex"]) {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "observer-provider-")),
      calls: string[][] = [];
    const identity = { pane_id: "p1", workspace_id: "w1", terminal_id: "t1", agent: provider };
    const options: ControlOptions = {
      overseerHome: home,
      endpoint: "/fixture/providers.sock",
      platform: "darwin",
      sleep: () => Promise.resolve(),
      claudeArgs: ["--fixture-claude-arg"],
      execute: (command, args) => {
        calls.push([command, ...args]);
        const key = args.slice(0, 2).join(" ");
        const result =
          key === "workspace create"
            ? { root_pane: { pane_id: "p1" } }
            : key === "agent get"
              ? { agent: identity }
              : key === "pane get"
                ? { pane: identity }
                : key === "agent list"
                  ? { agents: [identity] }
                  : {};
        return Promise.resolve({ stdout: JSON.stringify({ result }) });
      },
    };
    try {
      await makeControl(options).overseer(provider);
      assert.deepEqual(
        calls.find((call) => call[1] === "agent" && call[2] === "start"),
        [
          "herdr",
          "agent",
          "start",
          "overseer",
          "--kind",
          provider,
          "--pane",
          "p1",
          "--timeout",
          "60000",
          ...(provider === "claude" ? ["--", "--fixture-claude-arg"] : []),
        ],
      );
      const original = await fs.readFile(path.join(home, "AGENTS.md"), "utf8");
      assert.equal(await fs.readFile(path.join(home, "CLAUDE.md"), "utf8"), original);
      assert.equal(
        identityProvider(await fs.readFile(path.join(home, "identity.json"), "utf8")),
        provider,
      );
      await assert.rejects(
        makeControl(options).overseer(provider === "claude" ? "codex" : "claude"),
        (error: unknown) =>
          object(error) && error.message === "overseer-exists" && error.paneId === "p1",
      );
      for (const existing of ["AGENTS.md", "CLAUDE.md"]) {
        await fs.unlink(path.join(home, "identity.json"));
        const missing = existing === "AGENTS.md" ? "CLAUDE.md" : "AGENTS.md";
        await fs.unlink(path.join(home, missing));
        const edited = Buffer.from("user edits\r\n" + existing + "\u0000");
        await fs.writeFile(path.join(home, existing), edited);
        await makeControl(options).overseer(provider);
        assert.deepEqual(await fs.readFile(path.join(home, existing)), edited);
        assert.equal(await fs.readFile(path.join(home, missing), "utf8"), original);
      }
      await fs.unlink(path.join(home, "identity.json"));
      for (const file of ["AGENTS.md", "CLAUDE.md"])
        await fs.writeFile(path.join(home, file), "divergent " + file);
      await makeControl(options).overseer(provider);
      for (const file of ["AGENTS.md", "CLAUDE.md"])
        assert.equal(await fs.readFile(path.join(home, file), "utf8"), "divergent " + file);
      // Simulate a user creating AGENTS.md immediately before the exclusive create.
      await fs.unlink(path.join(home, "identity.json"));
      await fs.unlink(path.join(home, "AGENTS.md"));
      await makeControl({
        ...options,
        fs: {
          ...fs,
          writeFile: async (file, content, settings) => {
            if (file === path.join(home, "AGENTS.md"))
              await fs.writeFile(file, "concurrent user edit");
            return fs.writeFile(file, content, settings);
          },
        },
      }).overseer(provider);
      assert.equal(await fs.readFile(path.join(home, "AGENTS.md"), "utf8"), "concurrent user edit");
      assert.equal(await fs.readFile(path.join(home, "CLAUDE.md"), "utf8"), "divergent CLAUDE.md");
      await fs.writeFile(path.join(home, "identity.json"), "{corrupt");
      const before = calls.length;
      await assert.rejects(makeControl(options).overseer(provider), /overseer-unavailable/);
      assert.equal(calls.length, before, "corrupt identity never reaches Herdr");
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  }
}

test("uncertain overseer ownership survives restart until confirmed absent", uncertainOverseer);
test("provider briefs retain user files and launch native provider", providerBriefs);

function identityProvider(text: string) {
  const record: unknown = JSON.parse(text);
  assert(object(record));
  return record.provider;
}

test("reserved malformed pane ids retain raw ownership until native absence is proven", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "observer-reserved-argv-"));
  const endpoint = "/fixture/reserved.sock";
  try {
    for (const paneId of [42, true, {}, [], ["pane"], { toString: null }]) {
      const record = { version: 1, endpoint, reservation: "fixture-owner", paneId };
      const file = path.join(home, "identity.json");
      const original = JSON.stringify(record);
      await fs.writeFile(file, original);
      const calls: string[][] = [];
      const control = makeControl({
        overseerHome: home,
        endpoint,
        execute: (_command, args) => {
          calls.push(args);
          const result = args[0] === "agent" ? { agents: [] } : { pane: {} };
          return Promise.resolve({ stdout: JSON.stringify({ result }) });
        },
      });
      await assert.rejects(control.overseer("claude"), /overseer-unavailable/);
      assert.equal(await fs.readFile(file, "utf8"), original);
      assert.deepEqual(calls[0], ["agent", "list"]);
      if (object(paneId) && Object.hasOwn(paneId, "toString")) assert.equal(calls.length, 1);
      else assert.deepEqual(calls[1], ["pane", "get", String(paneId)]);
      assert(!calls.some((args) => args[0] === "workspace"));
    }
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
