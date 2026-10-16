import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "bun:test";
import { loadConfig, validateConfig, DEFAULT_ROOMS } from "./config/index.js";

const ENABLED = true;
const DISABLED = false;
const BUILD_LAUNCH_TIMEOUT = 45000;

test(
  "config regression contracts",
  () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "observer-config-"));
    const file = path.join(folder, "settings.json"),
      missing = path.join(folder, "missing.json");
    const write = (value: unknown) => {
      fs.writeFileSync(file, JSON.stringify(value));
    };
    try {
      const defaults = settings([], missing);
      assert.equal(defaults.presentation, DISABLED);
      assert.equal(defaults.labels.company, "Helioforge");
      assert.equal(settings(["--presentation"], missing).presentation, ENABLED);
      write({
        presentation: true,
        company: "Orbit Works",
        repoPrefix: "orbit",
        rooms: [{ name: "Delivery", repos: ["orbit-api"] }],
      });
      const configured = settings([], file);
      assert.equal(configured.presentation, ENABLED);
      assert.equal(configured.labels.company, "Orbit Works");
      assert.deepEqual(configured.labels.rooms, [{ name: "Delivery", repos: ["orbit-api"] }]);
      const overridden = settings(
        [
          "--config",
          file,
          "--company",
          "Acme Studio",
          "--repo-prefix",
          "acme",
          "--no-presentation",
        ],
        missing,
      );
      assert.equal(overridden.presentation, DISABLED);
      assert.equal(overridden.labels.company, "Acme Studio");
      assert.equal(overridden.labels.repoPrefix, "acme");
      assert.deepEqual(
        overridden.labels.rooms,
        configured.labels.rooms,
        "explicit aliases are kept verbatim",
      );
      write({ presentation: false, repoPrefix: "orbit" });
      const enabled = settings(["--presentation"], file);
      assert.equal(enabled.presentation, ENABLED);
      assert.equal(enabled.labels.rooms.at(0)?.repos.at(0), "orbit-web");
      assert.equal(
        settings(["--repo-prefix", "custom"], missing).labels.rooms.at(0)?.repos.at(0),
        "custom-web",
      );
      write({ theme: { fx: false, colors: { accent: "#ABCDEF" } } });
      assert.deepEqual(settings(["--fx"], file).theme, { fx: true, colors: { accent: "#ABCDEF" } });
      assert.equal(settings(["--no-fx"], file).theme.fx, DISABLED);
      // Dynamic arrangement: theme default and the rooms file path (relative to the config file, default next to package.json).
      write({ theme: { arrange: true }, roomsFile: "my-rooms.json" });
      const arranged = settings([], file);
      assert.equal(arranged.theme.arrange, ENABLED);
      assert.equal(arranged.roomsFile, path.join(folder, "my-rooms.json"));
      assert.equal(settings([], missing).roomsFile, DEFAULT_ROOMS);
      for (const bad of [
        { theme: { arrange: "yes" } },
        { roomsFile: "" },
        { roomsFile: 3 },
        { roomsFile: "a\u0000b" },
      ])
        assert.throws(() => validateConfig(bad));
      assert.throws(() => settings(["--fx", "--no-fx"], missing));
      for (const theme of [
        null,
        [],
        { fx: "false" },
        { scripts: "bad" },
        { colors: { accent: "red" } },
        { colors: { accent: "#123" } },
        { colors: { custom: "#123456" } },
      ])
        assert.throws(() => validateConfig({ theme }));
      assert.deepEqual(validateConfig({ theme: { pack: "starnet" } }), {
        theme: { pack: "starnet" },
      });
      write({ theme: { pack: "sample", fx: false } });
      assert.deepEqual(settings(["--fx"], file).theme, { pack: "sample", fx: true });
      for (const pack of ["", "../sample", "Sample", "-sample", "a".repeat(33), null, 1])
        assert.throws(() => validateConfig({ theme: { pack } }), /theme.pack/);
      const basic = settings(
        ["--config", path.join(__dirname, "../../themes/basic.json")],
        missing,
      );
      assert.equal(basic.presentation, DISABLED);
      assert.equal(basic.theme.fx, DISABLED);
      const helio = settings(
        ["--config", path.join(__dirname, "../../themes/helioforge.json")],
        missing,
      );
      assert.equal(helio.presentation, ENABLED);
      assert.equal(helio.labels.company, "Helioforge");
      assert.equal(helio.theme.fx, ENABLED);
      assert.equal(helio.theme.colors?.accent, "#77dce8");
      assert.equal("help" in loadConfig(["--help"], file), ENABLED);
      assert.throws(() => settings(["--presentaton"], missing));
      assert.throws(() => settings(["unexpected"], missing));
      assert.throws(() => settings(["--presentation", "--no-presentation"], missing));
      assert.throws(() => settings(["--company"], missing));
      assert.throws(() => settings(["--config", missing], missing), /Cannot load/);
      assert.throws(() => settings(["--config", ""], missing), /nonempty/);
      for (const input of [
        null,
        [],
        { presentation: "true" },
        { compny: "Typo" },
        { company: "" },
        { company: "line\nbreak" },
        { company: "x".repeat(81) },
        { repoPrefix: "bad prefix" },
        { repoPrefix: "-bad" },
        { rooms: [] },
        { rooms: ["Product"] },
        { rooms: [{ name: "Product", reops: [] }] },
        { rooms: [{ name: "Product", repos: "repo" }] },
        { rooms: [{ name: "Product" }, { name: "product" }] },
        {
          rooms: [
            { name: "Product", repos: ["api"] },
            { name: "Platform", repos: ["API"] },
          ],
        },
      ])
        assert.throws(() => validateConfig(input));
      write({ presentation: true, compny: "Typo" });
      assert.throws(
        () => settings(["--company", "Override"], file),
        /Unknown/,
        "invalid file cannot silently disable masking or be hidden by flags",
      );
      fs.writeFileSync(file, "{invalid private text");
      assert.throws(() => settings([], file), /invalid JSON/);
      fs.writeFileSync(file, " ".repeat(65537));
      assert.throws(() => settings([], file), /64 KiB/);
      const server = path.join(__dirname, "../../dist/runtime/src/server/main.js");
      const invalid = spawnSync(process.execPath, ["--no-env-file", server, "--config", file], {
        cwd: folder,
        encoding: "utf8",
        timeout: 3000,
      });
      assert.equal(invalid.status, 1);
      assert.match(invalid.stderr, /config/);
      assert.doesNotMatch(invalid.stdout, /Local Observer:/);
      write({ theme: { pack: "uninstalled-test-pack" } });
      const missingPack = spawnSync(process.execPath, ["--no-env-file", server, "--config", file], {
        cwd: folder,
        encoding: "utf8",
        timeout: 3000,
      });
      assert.equal(missingPack.status, 1);
      assert.match(missingPack.stderr, /Unknown or uninstalled theme pack/);
      assert.doesNotMatch(missingPack.stdout, /Local Observer:/);
      const help = spawnSync(process.execPath, ["--no-env-file", server, "--help"], {
        cwd: folder,
        encoding: "utf8",
        timeout: 3000,
      });
      assert.equal(help.status, 0);
      assert.match(help.stdout, /--no-presentation/);
      assert.match(help.stdout, /Usage: bun --no-env-file dist\/runtime\/src\/server\/main\.js/);
      const executable = spawnSync(server, ["--help"], {
        cwd: folder,
        encoding: "utf8",
        timeout: 3000,
      });
      assert.equal(executable.status, 0, executable.stderr);
      assert.match(
        executable.stdout,
        /Usage: bun --no-env-file dist\/runtime\/src\/server\/main\.js/,
      );
      for (const script of ["start", "presentation"]) {
        const launched = spawnSync(process.execPath, ["run", script, "--help"], {
          cwd: path.join(__dirname, "../.."),
          encoding: "utf8",
          timeout: BUILD_LAUNCH_TIMEOUT,
        });
        assert.equal(launched.status, 0, launched.stderr);
        assert.match(
          launched.stdout,
          /Usage: bun --no-env-file dist\/runtime\/src\/server\/main\.js/,
        );
      }
      const example: unknown = JSON.parse(
        fs.readFileSync(path.join(__dirname, "../../observer.config.example.json"), "utf8"),
      );
      validateConfig(example);
      // Remotes: validated ids, ssh targets that can never be read as ssh options, plain dirs, defaults.
      assert.deepEqual(settings([], missing).remotes, []);
      write({
        remotes: [
          { id: "herdr-dev-2", ssh: "nick@34.153.167.160" },
          { id: "box", ssh: "devbox", dir: "/srv/observer" },
        ],
      });
      assert.deepEqual(settings([], file).remotes, [
        { id: "herdr-dev-2", ssh: "nick@34.153.167.160", dir: "~/starnet-observer" },
        { id: "box", ssh: "devbox", dir: "/srv/observer" },
      ]);
      // Mail topology is never configured: relays are drawn only from each bus's own binding.
      assert.throws(
        () => validateConfig({ remotes: [{ id: "a", ssh: "h", mail: "relay" }] }),
        /mail/,
      );
      for (const remotes of [
        {},
        Array.from({ length: 17 }, (_, i) => ({ id: `h${String(i)}`, ssh: "h" })),
        [{ id: "A", ssh: "h" }],
        [{ id: "local", ssh: "h" }],
        [
          { id: "a", ssh: "h" },
          { id: "a", ssh: "g" },
        ],
        [{ id: "a", ssh: "-oProxyCommand=touch /tmp/x" }],
        [{ id: "a", ssh: "h; rm" }],
        [{ id: "a", ssh: "u@h@x" }],
        [{ id: "a", ssh: "h", dir: "~/x; rm -rf ~" }],
        [{ id: "a", ssh: "h", dir: "../up" }],
        [{ id: "a", ssh: "h", dir: "$HOME" }],
        [{ id: "a", ssh: "h", port: 22 }],
      ])
        assert.throws(() => validateConfig({ remotes }));
      console.log(
        "config: defaults, optional/explicit files, CLI precedence, custom names, strict validation, help and fail-before-startup passed",
      );
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  },
  2 * BUILD_LAUNCH_TIMEOUT + 20000,
);

test("injected install root keeps automatic files separate from explicit cwd paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-root-"));
  const cwd = path.join(root, "caller");
  fs.mkdirSync(cwd);
  try {
    fs.writeFileSync(
      path.join(root, "observer.config.json"),
      JSON.stringify({ company: "Installed", theme: { arrange: true } }),
    );
    fs.writeFileSync(
      path.join(cwd, "selected.json"),
      JSON.stringify({ company: "Explicit", roomsFile: "custom-rooms.json" }),
    );
    const automatic = settings([], undefined, { installRoot: root, cwd });
    assert.equal(automatic.labels.company, "Installed");
    assert.equal(automatic.roomsFile, path.join(root, "rooms.json"));
    assert.equal(automatic.theme.arrange, ENABLED);
    const explicit = settings(["--config", "selected.json"], undefined, { installRoot: root, cwd });
    assert.equal(explicit.labels.company, "Explicit");
    assert.equal(explicit.roomsFile, path.join(cwd, "custom-rooms.json"));
    fs.writeFileSync(path.join(root, "observer.config.json"), "{broken");
    assert.throws(() => settings([], undefined, { installRoot: root, cwd }), /invalid JSON/);
    fs.writeFileSync(path.join(root, "observer.config.json"), JSON.stringify({ unknown: true }));
    assert.throws(
      () => settings([], undefined, { installRoot: root, cwd }),
      /Unknown config field/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function settings(...args: Parameters<typeof loadConfig>) {
  const value = loadConfig(...args);
  if ("help" in value) throw new Error("unexpected help");
  return value;
}
