"use strict";
const { test } = require("bun:test");

test("observer-arrangement regression contracts", async () => {
  const assert = require("node:assert/strict");
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const path = require("node:path");
  const { promisify } = require("node:util");
  const execFile = promisify(require("node:child_process").execFile);
  const { makeProjectResolver } = require("./observer-projects.js");
  const { parseRemote, validateRooms } = require("./observer-arrangement.js");
  const Model = require("../frontend/app/observer-model.js");

  // Remote parsing: https, scp-like and ssh:// agree; local paths are not remotes; credentials never survive.
  assert.deepEqual(parseRemote("https://github.com/Banqora/bq-web.git"), {
    host: "github.com",
    org: "banqora",
    name: "bq-web",
  });
  assert.deepEqual(parseRemote("git@github.com:banqora/bq-web.git\n"), {
    host: "github.com",
    org: "banqora",
    name: "bq-web",
  });
  assert.deepEqual(parseRemote("ssh://git@git.example.com:2222/team/tool"), {
    host: "git.example.com",
    org: "team",
    name: "tool",
  });
  assert.deepEqual(parseRemote("https://user:secret@github.com/acme/x"), {
    host: "github.com",
    org: "acme",
    name: "x",
  });
  for (const local of ["/srv/git/x.git", "./x", "file:///srv/x", "", null])
    assert.equal(parseRemote(local), null);
  // Rooms file validation is strict, like the config.
  assert.deepEqual(
    validateRooms({
      rooms: [{ name: "Banqora", match: ["~/dev/repos/bq-*", "github.com/banqora/*"] }],
    }),
    [
      {
        name: "Banqora",
        match: [
          { kind: "path", pattern: "~/dev/repos/bq-*" },
          { kind: "remote", pattern: "github.com/banqora/*" },
        ],
      },
    ],
  );
  for (const bad of [
    null,
    [],
    { rooms: "x" },
    { rooms: [{ name: "", match: ["/a"] }] },
    { rooms: [{ name: "A", match: [] }] },
    { rooms: [{ name: "A", match: ["../x"] }] },
    { rooms: [{ name: "A", match: ["not a pattern"] }] },
    {
      rooms: [
        { name: "A", match: ["/a"] },
        { name: "a", match: ["/b"] },
      ],
    },
    { rooms: [], extra: 1 },
    { rooms: [{ name: "A", match: ["/a"], x: 1 }] },
  ])
    assert.throws(() => validateRooms(bad));

  await (async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "observer-arrange-"));
    try {
      const git = (cwd, args) =>
        execFile("git", ["-c", "core.hooksPath=/dev/null", "-C", cwd, ...args]);
      const repository = async (folder, remote) => {
        await fs.mkdir(folder, { recursive: true });
        await git(folder, ["init", "-q"]);
        if (remote) await git(folder, ["remote", "add", "origin", remote]);
      };
      const home = path.join(temp, "home"),
        repos = path.join(home, "dev", "repos"),
        roomsFile = path.join(temp, "rooms.json");
      await repository(path.join(repos, "bq-web"), "https://github.com/banqora/bq-web.git");
      await repository(path.join(repos, "bq-infra"), "git@github.com:banqora/bq-infra.git");
      await repository(path.join(repos, "mono"));
      await fs.mkdir(path.join(repos, "mono", "packages", "api"), { recursive: true });
      await repository(path.join(repos, "station"));
      await repository(
        path.join(repos, "station", "observer"),
        "https://github.com/wnz99/starnet-observer.git",
      );
      await repository(path.join(repos, "llm-bus"), "https://github.com/wnz99/llm-bus.git");
      await repository(path.join(repos, "acme-one"), "https://github.com/acme/one.git");
      // A scratch folder that happens to hold two clones must not split its own sub-folders into rooms.
      await fs.mkdir(path.join(repos, "work-agents", "cv"), { recursive: true });
      await repository(path.join(repos, "work-agents", "clone-a"));
      await repository(path.join(repos, "work-agents", "clone-b"));
      await fs.mkdir(path.join(home, "HomeAssistant", "automations"), { recursive: true });
      const warnings = [];
      let clock = 1000;
      const resolver = makeProjectResolver({
        now: () => clock,
        execute: execFile,
        arrange: { home, roomsFile, warn: (message) => warnings.push(message) },
      });
      const at = (...parts) => path.join(repos, ...parts);
      const cwds = [
        at("bq-web"),
        at("bq-infra"),
        at("mono"),
        at("mono", "packages", "api"),
        at("station"),
        at("station", "observer"),
        at("llm-bus"),
        at("acme-one"),
        at("work-agents"),
        at("work-agents", "cv"),
        path.join(home, "HomeAssistant", "automations"),
        path.join(temp, "missing"),
      ];
      const rows = await resolver.resolveMany(cwds);
      const [
        web,
        infra,
        mono,
        api,
        station,
        observer,
        bus,
        acme,
        work,
        cv,
        homeAssistant,
        missing,
      ] = rows.map((row) => row.arrangement);
      // d. two observed units of one org share an org room; one alone keeps its own.
      assert.equal(web.roomId, infra.roomId);
      assert.equal(web.room, "banqora");
      assert.deepEqual([web.section, infra.section], ["bq-web", "bq-infra"]);
      assert.notEqual(web.sectionId, infra.sectionId);
      assert.equal(acme.room, "acme-one", "a lone org member is its own room");
      // a. a repository is a unit; its sub-folders are sections (monorepos).
      assert.equal(mono.roomId, api.roomId);
      assert.equal(mono.room, "mono");
      assert.deepEqual([mono.section, api.section], ["mono", "packages/api"]);
      assert.notEqual(mono.sectionId, api.sectionId);
      // c. a nested repository joins the outer unit's room; its org-mate follows it there, unambiguously.
      assert.equal(observer.roomId, station.roomId);
      assert.equal(observer.room, "station");
      assert.equal(observer.section, "observer");
      assert.equal(
        bus.roomId,
        station.roomId,
        "org-mate of a nested repository joins its single room",
      );
      assert.equal(bus.section, "llm-bus");
      // b. non-Git folders: the top-most folder under a workspace root (one holding observed repositories), else under $HOME.
      assert.equal(cv.roomId, work.roomId);
      assert.equal(cv.room, "work-agents");
      assert.deepEqual([work.section, cv.section], ["work-agents", "cv"]);
      assert.equal(homeAssistant.room, "HomeAssistant");
      assert.equal(homeAssistant.section, "automations");
      assert.deepEqual(missing, {
        roomId: "unassigned",
        room: "Unassigned",
        sectionId: "unassigned",
        section: "",
      });
      // Folder grouping is untouched: the arrangement is an extra field.
      assert.equal(rows[0].project, "repos");
      assert.equal(
        rows[9].project,
        "cv",
        "folder grouping still gives the stray folder its own room",
      );
      const all = JSON.stringify(rows);
      assert(
        !all.includes(temp) &&
          !all.includes(await fs.realpath(temp)) &&
          !all.includes("github.com"),
        "no paths or remote URLs cross the resolver",
      );

      // Linked checkout subfolders keep separate sections, using real Git checkout discovery.
      await git(at("mono"), [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--allow-empty",
        "-qm",
        "fixture",
      ]);
      const linked = at("mono-linked");
      await git(at("mono"), ["worktree", "add", "-qb", "fixture-linked", linked]);
      await fs.mkdir(path.join(linked, "src"));
      await fs.mkdir(path.join(linked, "test"));
      const linkedRows = await resolver.resolveMany([
        at("mono"),
        linked,
        path.join(linked, "src"),
        path.join(linked, "test"),
      ]);
      assert.equal(
        new Set(linkedRows.map((row) => row.arrangement.roomId)).size,
        1,
        "linked checkout belongs to repository room",
      );
      assert.equal(
        new Set(linkedRows.map((row) => row.arrangement.sectionId)).size,
        4,
        "main, linked root, src and test remain distinct",
      );
      assert.equal(
        new Set(linkedRows.map((row) => Model.sectionKey(Model.arranged(row)))).size,
        4,
        "ARRANGE preserves every checkout subfolder section",
      );

      // Resolve the outer organization room before inheriting it, regardless of input order or nesting depth.
      await repository(at("outer"), "https://github.com/acme/outer.git");
      await repository(at("mate"), "https://github.com/acme/mate.git");
      await repository(at("outer", "inner"));
      await repository(at("outer", "inner", "deep"));
      const nestedResolver = makeProjectResolver({
        now: () => clock,
        execute: execFile,
        arrange: { home },
      });
      const nestedPaths = [
        at("outer", "inner", "deep"),
        at("outer", "inner"),
        at("mate"),
        at("outer"),
      ];
      const nested = await nestedResolver.resolveMany(nestedPaths);
      assert.deepEqual(
        nested.map((row) => row.arrangement.room),
        ["acme", "acme", "acme", "acme"],
        "all nested units inherit the final outer organization room",
      );
      const nestedAgain = await nestedResolver.resolveMany([...nestedPaths].reverse());
      assert(
        nestedAgain.every((row) => row.arrangement.roomId === nested[0].arrangement.roomId),
        "sticky placement preserves consistent ancestry",
      );
      const skippedResolver = makeProjectResolver({
        now: () => clock,
        execute: execFile,
        arrange: { home },
      });
      const skipped = await skippedResolver.resolveMany([
        at("outer", "inner", "deep"),
        at("mate"),
        at("outer"),
      ]);
      assert(
        skipped.every((row) => row.arrangement.room === "acme"),
        "unobserved intermediate checkout inherits the known outer room",
      );
      // An outer repository can itself follow an organization mate nested under another outer unit.
      await repository(at("B"), "https://github.com/team/B.git");
      await repository(at("B", "A"));
      await repository(at("D"));
      await repository(at("D", "C"), "https://github.com/team/C.git");
      for (const order of [
        [at("B", "A"), at("B"), at("D", "C"), at("D")],
        [at("D"), at("D", "C"), at("B"), at("B", "A")],
      ]) {
        const dependent = await makeProjectResolver({
          now: () => clock,
          execute: execFile,
          arrange: { home },
        }).resolveMany(order);
        assert(
          dependent.every((row) => row.arrangement.room === "D"),
          "nested descendants follow the outer unit final organization dependency",
        );
      }

      // Inherited file overrides are temporary, including a fresh start while the rule already exists.
      const inheritedFile = path.join(temp, "inherited-rooms.json");
      const explicit = JSON.stringify({
        rooms: [{ name: "Explicit", match: [await fs.realpath(at("outer"))] }],
      });
      await fs.writeFile(inheritedFile, explicit);
      const inheritedResolver = makeProjectResolver({
        now: () => clock,
        execute: execFile,
        arrange: { home, roomsFile: inheritedFile },
      });
      const inheritedPaths = [at("outer"), at("outer", "inner")];
      assert(
        (await inheritedResolver.resolveMany(inheritedPaths)).every(
          (row) => row.arrangement.room === "Explicit",
        ),
      );
      await fs.rm(inheritedFile);
      assert(
        (await inheritedResolver.resolveMany(inheritedPaths)).every(
          (row) => row.arrangement.room === "outer",
        ),
        "removing a startup rule clears inherited temporary rooms",
      );
      await fs.writeFile(inheritedFile, explicit);
      assert(
        (await inheritedResolver.resolveMany(inheritedPaths)).every(
          (row) => row.arrangement.room === "Explicit",
        ),
        "new outer override reaches already-sticky descendants",
      );
      await fs.rm(inheritedFile);
      assert(
        (await inheritedResolver.resolveMany(inheritedPaths)).every(
          (row) => row.arrangement.room === "outer",
        ),
        "rule removal restores the original rule-made sticky room",
      );

      // Stability: a later org-mate joins the existing room and never moves anyone; a lone unit's room is kept.
      await repository(at("bq-exec"), "https://github.com/banqora/bq-exec.git");
      await repository(at("acme-two"), "https://github.com/acme/two.git");
      const later = (await resolver.resolveMany([...cwds, at("bq-exec"), at("acme-two")])).map(
        (row) => row.arrangement,
      );
      assert.deepEqual(
        later.slice(0, cwds.length),
        rows.map((row) => row.arrangement),
        "no existing unit moves",
      );
      assert.equal(later[cwds.length].roomId, web.roomId, "a new org-mate joins the org room");
      assert.equal(
        later[cwds.length + 1].roomId,
        acme.roomId,
        "a new org-mate joins the lone unit room instead of moving it",
      );
      // Sticky organization evidence is independent of the canonical processing order.
      await repository(at("z-held"), "https://github.com/sticky/z.git");
      await repository(at("a-later"), "https://github.com/sticky/a.git");
      const heldResolver = makeProjectResolver({
        now: () => clock,
        execute: execFile,
        arrange: { home },
      });
      const heldRoom = (await heldResolver.resolve(at("z-held"))).arrangement.roomId;
      const joined = await heldResolver.resolveMany([at("a-later"), at("z-held")]);
      assert(
        joined.every((row) => row.arrangement.roomId === heldRoom),
        "a newly sorted-first organization mate joins the established sticky room",
      );

      // A repository later observed inside the scratch folder does not re-home its sub-folders.
      clock += 400000;
      const scratch = (
        await resolver.resolveMany([at("work-agents", "clone-a"), at("work-agents", "cv")])
      ).map((row) => row.arrangement);
      assert.equal(
        scratch[1].roomId,
        cv.roomId,
        "cv keeps its room after a clone inside work-agents is observed",
      );

      // e. rooms file: first match wins over rules, by path glob or remote pattern; edits take effect; bad files are ignored.
      await fs.writeFile(
        roomsFile,
        JSON.stringify({
          rooms: [
            { name: "Platform", match: ["~/dev/repos/bq-infra", "github.com/wnz99/llm-bus"] },
            { name: "Everything", match: ["~/dev/**"] },
          ],
        }),
      );
      let filed = (
        await resolver.resolveMany([
          at("bq-infra"),
          at("llm-bus"),
          at("bq-web"),
          at("work-agents", "cv"),
        ])
      ).map((row) => row.arrangement);
      assert.deepEqual(
        filed.map((value) => value.room),
        ["Platform", "Platform", "Everything", "Everything"],
      );
      assert.equal(
        filed[3].section,
        "work-agents/cv",
        "a section outside its own room is prefixed with its unit",
      );
      await fs.writeFile(
        roomsFile,
        JSON.stringify({ rooms: [{ name: "Infra only", match: ["github.com/banqora/bq-infra"] }] }),
      );
      await fs.utimes(roomsFile, new Date(5000), new Date(5000));
      filed = (await resolver.resolveMany([at("bq-infra"), at("bq-web")])).map(
        (row) => row.arrangement,
      );
      assert.deepEqual(
        filed.map((value) => value.room),
        ["Infra only", "banqora"],
        "an edited rooms file re-arranges; unmatched units return to their sticky room",
      );
      await fs.writeFile(roomsFile, "{ not json");
      await fs.utimes(roomsFile, new Date(9000), new Date(9000));
      filed = (await resolver.resolveMany([at("bq-infra")])).map((row) => row.arrangement);
      assert.equal(filed[0].room, "banqora", "an invalid rooms file is ignored");
      assert.deepEqual(warnings, ["Rooms file ignored: invalid JSON"]);
      await fs.rm(roomsFile);

      // Without `arrange` the resolver output is exactly the folder grouping.
      const plain = await makeProjectResolver({ now: () => 1000, execute: execFile }).resolve(
        at("bq-web"),
      );
      assert.equal(Object.hasOwn(plain, "arrangement"), false);
      console.log(
        "observer arrangement: remotes, strict rooms file, monorepo sections, nested repos, org rooms (2+), non-Git units under workspace roots, stickiness, rooms-file overrides/reload and no paths OK",
      );
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }

    // Page side: ARRANGE swaps the grouping fields; rows without an arrangement are returned unchanged (identity).
    const row = {
      id: "obs_" + "a".repeat(24),
      projectId: "prj_1",
      project: "repos",
      repoId: "repo_1",
      repo: "bq-web",
      folder: "src",
      arrangement: { roomId: "room_1", room: "banqora", sectionId: "sec_1", section: "bq-web" },
    };
    assert.deepEqual(Model.arranged(row), {
      ...row,
      projectId: "room_1",
      project: "banqora",
      projectKind: "group",
      repoId: "sec_1",
      repo: "bq-web",
      folder: "",
    });
    const bare = { id: "x", projectId: "prj_2" };
    assert.equal(Model.arranged(bare), bare);
    const layout = Model.createLayout(),
      arrangedLayout = Model.createLayout();
    const second = {
      ...row,
      id: "obs_" + "b".repeat(24),
      projectId: "prj_2",
      project: "infra-parent",
      repoId: "repo_2",
      repo: "bq-infra",
      arrangement: { roomId: "room_1", room: "banqora", sectionId: "sec_2", section: "bq-infra" },
    };
    layout.reconcile([row, second]);
    arrangedLayout.reconcile([row, second].map(Model.arranged));
    assert.equal(layout.onPage(0).length, 2, "folder grouping: two rooms");
    assert.equal(arrangedLayout.onPage(0).length, 1, "arranged: one room");
    assert.equal(arrangedLayout.onPage(0)[0].name, "banqora");
    const seats = [row, second].map((value) => arrangedLayout.seatFor(value.id));
    arrangedLayout.reconcile([row, second].map(Model.arranged));
    assert.deepEqual(
      [row, second].map((value) => arrangedLayout.seatFor(value.id)),
      seats,
      "desks hold between polls while arranged",
    );
    console.log(
      "observer arrangement: page toggle swaps grouping, identity without arrangement, one room per arranged project, stable seats OK",
    );
  })();
}, 30000);
