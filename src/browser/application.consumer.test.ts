import { test } from "bun:test";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import type { Server } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { consumerRoot } from "../server/application.consumer.test.js";
import type { AppRow, AppSnapshot } from "./app/data.js";
import type { Scene as SceneGeometry } from "./scene/types.js";
import type { ActorFrame } from "./scene/motion-types.js";
interface FixtureOptions {
  observer: { get: () => unknown; inspect: () => unknown };
  token: string;
  theme?: { pack: string };
  control?: { attach: () => unknown };
}
interface HttpModule {
  createServer: (options: FixtureOptions) => Server;
}
const TOKEN = "synthetic-browser-consumer-token";
interface CanvasProbe {
  activeScene: SceneGeometry;
  camera: { zoom: number; tx: number; ty: number };
  viewport: { width: number; height: number };
  mode: string;
  platform: string | null;
  cameraControl: { focusPlatform(key: string): boolean };
  actors: ActorFrame[];
  ctx: CanvasRenderingContext2D;
  framePaint: { paint(now: number): unknown };
  staticLayer: { builds: number } | null;
  plateFrame: unknown;
  callbacks: { onObservatory: () => void };
  interaction: {
    titleAt(point: { x: number; y: number }): unknown;
    signAt(point: { x: number; y: number }): unknown;
  };
  signRegions: { left: number; top: number; width: number; height: number }[];
  titleRegions: { left: number; top: number; width: number; height: number }[];
  regions: { left: number; top: number; width: number; height: number; id: string }[];
  observatoryRegion: { left: number; top: number; width: number; height: number } | null;
  focused: string | null;
  repositorySelection(): string | null;
}
function crewSnapshot(closed: boolean, bornAt: number | null) {
  const data = snapshot();
  const first = data.sessions[0];
  assert.ok(first);
  const panes: AppRow[] = Array.from({ length: 12 }, (_, index) => ({
    ...first,
    id: "obs_" + String(index).padStart(24, "0"),
    title: "Synthetic worker " + String(index),
    paneId: "w1:p" + String(index),
    status:
      index === 0
        ? "idle"
        : index < 9
          ? "working"
          : index === 9
            ? "done"
            : index === 10
              ? "unknown"
              : "idle",
    observedAt: index === 11 ? data.observedAt - 60000 : data.observedAt,
  }));
  const helpers: AppRow[] = Array.from({ length: 64 }, (_, index) => ({
    id: "helper_" + String(index).padStart(2, "0"),
    source: "helper",
    provider: "codex",
    project: first.project,
    projectId: first.projectId,
    repo: first.repo,
    repoId: first.repoId,
    parentId: panes[0]?.id ?? null,
    title: "Synthetic helper " + String(index),
    status: index < 2 ? "blocked" : "idle",
    lineageState: "verified",
    observedAt: data.observedAt,
    // Retained closed histories stay inspectable and contribute usage, never avatars.
    lifecycleEvidence: {
      state: index >= 8 || (closed && index === 0) ? "closed" : "open",
      reason: index === 0 && closed ? "killed" : null,
    },
  }));
  if (bornAt !== null)
    helpers.push({
      ...helpers[2],
      id: "helper_birth",
      parentId: panes[0]?.id ?? null,
      source: "helper",
      status: "idle",
      lifecycleEvidence: { state: "open" },
      taskEvidence: {
        state: "available",
        source: "codex:assignment",
        summary: "Synthetic arrival",
        observedAt: bornAt,
      },
      observedAt: data.observedAt,
    });
  return {
    ...data,
    sessions: [...panes, ...helpers],
    sources: { ...data.sources, herdr: { health: "available", observedAt: data.observedAt } },
    aggregate: {
      usage: {
        inputTokens: { value: 76000, state: "available" },
        outputTokens: { value: 1500, state: "partial" },
        cacheReadTokens: { value: 64000, state: "available" },
        cacheWriteTokens: { value: 0, state: "available" },
      },
      coverage: { eligible: 76, available: 75, partial: 1, unavailable: 0, stale: 0 },
    },
  };
}
async function paintedTargets(page: Page) {
  return page.evaluate(() => {
    const view = Reflect.get(window, "__view") as CanvasProbe;
    return {
      signs: view.signRegions,
      titles: view.titleRegions,
      bodies: view.regions,
      observatory: view.observatoryRegion,
      focused: view.focused,
      repository: view.repositorySelection(),
    };
  });
}
async function bodyTarget(page: Page) {
  return page.evaluate(() => {
    const view = Reflect.get(window, "__view") as CanvasProbe;
    for (const body of [...view.regions].sort((left, right) => left.left - right.left)) {
      const point = { x: body.left + body.width / 2, y: body.top + body.height * 0.75 };
      if (body.top > 100 && !view.interaction.titleAt(point) && !view.interaction.signAt(point))
        return { id: body.id, left: point.x, top: point.y, width: 0, height: 0 };
    }
    return null;
  });
}
async function hoverTitle(page: Page) {
  const body = await bodyTarget(page);
  const box = await page.locator("canvas").boundingBox();
  assert.ok(body && box);
  await page.mouse.move(box.x + 1, box.y + 1);
  await page.mouse.move(box.x + body.left, box.y + body.top);
  await expect.poll(async () => (await paintedTargets(page)).titles.length).toBeGreaterThan(0);
  const title = (await paintedTargets(page)).titles[0];
  assert.ok(title);
  return title;
}
async function nativeCanvas(browser: Browser, root: string, http: HttpModule, artifacts: string) {
  const original = await fs.readFile(path.join(root, "dist/public/app/main.js"), "utf8");
  const marker = "framePaint = new FramePaint(this);";
  assert.equal(
    original.split(marker).length,
    2,
    "emitted view instrumentation has one known entry",
  );
  const injected = original.replace(
    marker,
    "framePaint = (window.__view = this, new FramePaint(this));",
  );
  let closed = false;
  let bornAt: number | null = null;
  let crewEnabled = false;
  let annexRoots: number | null = null;
  let annexCompact = false;
  const fixture = await listen(http, {
    token: TOKEN,
    observer: {
      get: () => {
        if (annexRoots !== null) return annexSnapshot(annexRoots, annexCompact);
        if (crewEnabled) return crewSnapshot(closed, bornAt);
        const data = snapshot();
        const first = data.sessions[0];
        assert.ok(first);
        data.sessions = Array.from({ length: 16 }, (_, index) => ({
          ...first,
          id: "obs_" + String(index).padStart(24, "0"),
          title: "Synthetic worker " + String(index),
          paneId: "w1:p" + String(index),
        }));
        const { local } = data.sources.hosts;
        local.agents = 16;
        return data;
      },
      inspect: () => ({ health: "unavailable", turns: [] }),
    },
  });
  let canvasPage: Page | undefined;
  try {
    assert.equal(browser.version(), "156.0.8078.4");
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    canvasPage = page;
    const errors = observeErrors(page);
    await page.route("**/app/main.js", (route) =>
      route.fulfill({ body: injected, contentType: "text/javascript" }),
    );
    const fresh = async () => {
      await page.goto(fixture.url);
      await page.waitForFunction(() => {
        const view = Reflect.get(window, "__view") as CanvasProbe | undefined;
        return Boolean(view?.plateFrame);
      });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        const view = Reflect.get(window, "__view") as CanvasProbe;
        const original = view.callbacks.onObservatory;
        Reflect.set(window, "__observatoryCalls", 0);
        view.callbacks.onObservatory = () => {
          Reflect.set(
            window,
            "__observatoryCalls",
            Number(Reflect.get(window, "__observatoryCalls")) + 1,
          );
          original();
        };
      });
      await page.locator("canvas").focus();
      for (let zoom = 0; zoom < 9 && (await paintedTargets(page)).signs.length === 0; zoom++) {
        await page.keyboard.press("+");
        await page.waitForTimeout(40);
      }
    };
    const click = async (
      target: { left: number; top: number; width: number; height: number },
      mode: "single" | "double" = "single",
    ) => {
      const box = await page.locator("canvas").boundingBox();
      assert.ok(box);
      const x = box.x + target.left + target.width / 2,
        y = box.y + target.top + target.height / 2;
      if (mode === "double") await page.mouse.dblclick(x, y);
      else await page.mouse.click(x, y);
    };
    for (const delay of [0, 600, 1200]) {
      await fresh();
      const sign = (await paintedTargets(page)).signs[0];
      assert.ok(sign);
      await click(sign);
      await expect.poll(async () => (await paintedTargets(page)).repository).toBe("repo_fixture");
      await page.waitForTimeout(delay);
      await click(sign);
      await expect.poll(async () => (await paintedTargets(page)).repository).toBe(null);
      const title = await hoverTitle(page);
      await click(title);
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await page.waitForTimeout(delay);
      await click(title);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await fresh();
      const observatory = (await paintedTargets(page)).observatory;
      assert.ok(observatory);
      await click(observatory);
      await expect
        .poll(() => page.evaluate(() => Number(Reflect.get(window, "__observatoryCalls"))))
        .toBe(1);
      await page.waitForTimeout(delay);
      await click(observatory);
      await expect
        .poll(() => page.evaluate(() => Number(Reflect.get(window, "__observatoryCalls"))))
        .toBe(2);
    }
    await fresh();
    const sign = (await paintedTargets(page)).signs[0];
    assert.ok(sign);
    await click(sign, "double");
    await expect.poll(async () => (await paintedTargets(page)).repository).toBe("repo_fixture");
    const title = await hoverTitle(page);
    await click(title, "double");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await fresh();
    const observatory = (await paintedTargets(page)).observatory;
    assert.ok(observatory);
    await click(observatory, "double");
    await expect
      .poll(() => page.evaluate(() => Number(Reflect.get(window, "__observatoryCalls"))))
      .toBe(1);
    await fresh();
    const body = await bodyTarget(page);
    assert.ok(body);
    await click(body, "double");
    await expect.poll(async () => (await paintedTargets(page)).focused).toBe(body.id);
    await fresh();
    let overlap: { left: number; top: number; width: number; height: number } | null = null;
    for (let zoom = 0; zoom < 22 && !overlap; zoom++) {
      await page.keyboard.press(zoom < 12 ? "+" : "-");
      await page.waitForTimeout(35);
      const targets = await paintedTargets(page);
      overlap = signBodyOverlap(targets);
    }
    assert.ok(overlap, "fixture exposes an accepted sign over a padded body");
    await click(overlap);
    await expect.poll(async () => (await paintedTargets(page)).repository).toBe("repo_fixture");
    assert.equal(
      (await paintedTargets(page)).focused,
      null,
      "visible sign takes priority over padded body",
    );
    crewEnabled = true;
    await fresh();
    await crewBehavior(
      page,
      () => {
        closed = true;
      },
      () => {
        bornAt = Date.now();
      },
      artifacts,
    );
    closed = false;
    bornAt = null;
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await fresh();
    await crewMotion(
      page,
      () => {
        closed = true;
      },
      () => {
        bornAt = Date.now();
      },
      artifacts,
    );
    crewEnabled = false;
    annexRoots = 24;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await fresh();
    const annexes = await annexNavigation(page, artifacts, ({ roots, compact }) => {
      annexRoots = roots;
      annexCompact = compact;
    });
    assert.deepEqual(errors, []);
    return annexes;
  } finally {
    await canvasPage?.close();
    fixture.server.closeAllConnections();
    await new Promise<void>((resolve) =>
      fixture.server.close(() => {
        resolve();
      }),
    );
  }
}

function annexSnapshot(roots: number, compact: boolean): AppSnapshot {
  const data = snapshot(),
    now = data.observedAt;
  const family = (id: string, count: number, host?: string): AppRow[] =>
    Array.from({ length: count }, (_, index) => ({
      id: id + "_" + String(index),
      project: id,
      projectId: id,
      repo: id,
      repoId: id,
      provider: "codex",
      source: "herdr",
      status: "working",
      observedAt: now,
      ...(host ? { host } : {}),
    }));
  const sessions = [
    ...family("Left", roots),
    ...(compact
      ? []
      : [
          ...family("Right", 25),
          ...Array.from({ length: 7 }, (_, index) => family("Project" + String(index), 1)).flat(),
        ]),
    ...family("Remote", 25, "remote"),
  ];
  return {
    ...data,
    sessions,
    health: "available",
    sources: {
      hosts: {
        local: {
          health: "available",
          observedAt: now,
          agents: sessions.filter((row) => !row.host).length,
        },
        remote: { health: "available", observedAt: now, agents: 25 },
      },
    },
    bus: {
      health: "available",
      messages: [],
      remote: {
        relay: "relay.example.test",
        machine: "fixture-local",
        lastActivityAt: now,
        onRelay: [{ id: "Left_48", repo: "Left" }],
        peers: [
          {
            machine: "fixture-shadow",
            repos: ["Shadow"],
            agents: 49,
            lastSeen: now,
            list: Array.from({ length: 49 }, (_, index) => ({
              id: "peer_" + index.toString(16).padStart(24, "0"),
              provider: "codex",
              repo: "Shadow",
              lastSeen: now,
            })),
          },
        ],
      },
    },
  };
}

async function annexFrame(page: Page) {
  return page.evaluate(() => {
    const view = Reflect.get(window, "__view") as CanvasProbe;
    return {
      scene: view.activeScene,
      camera: view.camera,
      viewport: view.viewport,
      mode: view.mode,
      platform: view.platform,
      focused: view.focused,
      page: localStorage.getItem("observer.page"),
    };
  });
}

async function annexNavigation(
  page: Page,
  artifacts: string,
  change: (options: { roots: number; compact: boolean }) => void,
) {
  const baseline = await annexFrame(page);
  const parentDesks = baseline.scene.workers
    .filter((worker) => worker.row.projectId === "Left")
    .map((worker) => [worker.id, worker.chair]);
  change({ roots: 49, compact: false });
  await expect
    .poll(
      async () =>
        (await annexFrame(page)).scene.workers.find((worker) => worker.id === "Left_48")?.id,
    )
    .toBe("Left_48");
  const grown = await annexFrame(page);
  assert.deepEqual(
    grown.scene.workers
      .filter((worker) => parentDesks.some(([id]) => id === worker.id))
      .map((worker) => [worker.id, worker.chair]),
    parentDesks,
    "growth preserves all existing parent desks",
  );
  const platforms = grown.scene.platforms;
  const left = platforms.filter((platform) => platform.projectId === "Left");
  const right = platforms.filter((platform) => platform.projectId === "Right");
  assert.deepEqual(
    left.map((platform) => platform.rect.x),
    [-30, -54, -78],
  );
  assert.deepEqual(
    right.map((platform) => platform.rect.x),
    [24, 48],
  );
  assert.equal(platforms.filter((platform) => platform.host === "remote").length, 2);
  assert.equal(platforms.filter((platform) => platform.host?.startsWith("relay:")).length, 3);
  assert.equal(grown.scene.walkways.filter((walkway) => walkway.kind === "annex-link").length, 6);
  assert(
    grown.scene.walkways
      .filter((walkway) => walkway.kind === "annex-link" && !walkway.host)
      .some((walkway) => walkway.relay && walkway.accent === left[0]?.accent),
  );
  assertAnnexHulls(grown.scene);
  await page.locator("#overview").click();
  const overview = await annexFrame(page);
  assertAnnexFit(overview);
  await capture(page, path.join(artifacts, "annex-overview.png"));
  await page.locator("#next-page").click();
  await expect(page.locator("#page-label")).toHaveText("Deck 2 / 2");
  await page.locator('[data-session-id="Left_48"]').focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await annexFrame(page)).focused).toBe("Left_48");
  await expect(page.locator("#page-label")).toHaveText("Deck 1 / 2");
  await page.getByRole("button", { name: "Zoom to the Left platform" }).click();
  assert.equal((await annexFrame(page)).platform, left[0]?.key, "project zoom targets parent");
  await page.locator('[data-session-id="Left_48"]').focus();
  await page.keyboard.press("Enter");
  const empty = await emptyAnnexTarget(page);
  const box = await page.locator("canvas").boundingBox();
  assert.ok(box);
  await page.waitForTimeout(550);
  await page.mouse.dblclick(box.x + empty.x, box.y + empty.y);
  await expect.poll(async () => (await annexFrame(page)).platform).toBe(empty.key);
  assert.equal((await annexFrame(page)).mode, "platform");
  await capture(page, path.join(artifacts, "annex-focus.png"));
  await page.locator("canvas").focus();
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await annexFrame(page)).mode).toBe("overview");
  await annexGhost(page, box);
  await page.locator("#next-page").click();
  change({ roots: 24, compact: true });
  await expect
    .poll(
      async () =>
        (await annexFrame(page)).scene.platforms.filter((platform) => platform.projectId === "Left")
          .length,
    )
    .toBe(1);
  await expect(page.locator("#page-label")).toHaveText("Deck 1");
  assert.equal((await annexFrame(page)).page, "0");
  assert.deepEqual(
    (await annexFrame(page)).scene.workers
      .filter((worker) => worker.row.projectId === "Left")
      .map((worker) => [worker.id, worker.chair]),
    parentDesks,
    "shrink preserves parent desks",
  );
  return {
    roots: { left: 49, right: 25, remote: 25, shadow: 49, otherProjects: 7 },
    page: Number(overview.page ?? 0),
    platforms: platforms.map(({ key, rect, host }) => ({ key, rect, host })),
    assertions: {
      stableDesks: true,
      oppositeBanks: true,
      hullSeparation: true,
      overviewFit: true,
      offDeckSelection: true,
      parentZoom: true,
      annexFloorZoom: true,
      escapeOverview: true,
      ghostHoverOnly: true,
      savedPageClamp: true,
    },
    screenshots: ["annex-overview.png", "annex-focus.png"],
  };
}
function assertAnnexHulls(scene: SceneGeometry) {
  const hulls = scene.ships ?? [];
  for (const [index, hull] of hulls.entries()) {
    for (const other of hulls.slice(index + 1))
      assert(
        hull.rect.x + hull.rect.w <= other.rect.x ||
          other.rect.x + other.rect.w <= hull.rect.x ||
          hull.rect.y + hull.rect.h <= other.rect.y ||
          other.rect.y + other.rect.h <= hull.rect.y,
        "expanded hulls remain separate",
      );
  }
}
function assertAnnexFit(overview: Awaited<ReturnType<typeof annexFrame>>) {
  for (const walkway of overview.scene.walkways) {
    for (const x of [walkway.rect.x, walkway.rect.x + walkway.rect.w])
      for (const y of [walkway.rect.y, walkway.rect.y + walkway.rect.h]) {
        const sx = 24 * (x - y) * overview.camera.zoom + overview.camera.tx;
        const sy = 12 * (x + y) * overview.camera.zoom + overview.camera.ty;
        assert(
          sx >= 0 && sx <= overview.viewport.width && sy >= 0 && sy <= overview.viewport.height,
          "overview contains outer bridges",
        );
      }
  }
}
async function emptyAnnexTarget(page: Page) {
  return page.evaluate(() => {
    const view = Reflect.get(window, "__view") as CanvasProbe;
    const room = view.activeScene.platforms.find(
      (platform) => platform.projectId === "Left" && platform.key.endsWith(":2"),
    );
    if (!room) throw new Error("Missing outer annex");
    const free = (point: { x: number; y: number }) =>
      point.x > 0 &&
      point.x < view.viewport.width &&
      point.y > 0 &&
      point.y < view.viewport.height &&
      !view.interaction.titleAt(point) &&
      !view.interaction.signAt(point) &&
      !view.regions.some(
        (region) =>
          point.x >= region.left &&
          point.x <= region.left + region.width &&
          point.y >= region.top &&
          point.y <= region.top + region.height,
      );
    for (const dx of [10, 16, 4])
      for (const dy of [24, 22, 20]) {
        const x = room.rect.x + dx,
          y = room.rect.y + dy;
        const point = {
          x: 24 * (x - y) * view.camera.zoom + view.camera.tx,
          y: 12 * (x + y) * view.camera.zoom + view.camera.ty,
        };
        if (free(point)) return { ...point, key: room.key };
      }
    throw new Error("No empty annex floor target");
  });
}
async function annexGhost(page: Page, box: { x: number; y: number }) {
  const ghost = await page.evaluate(() => {
    const view = Reflect.get(window, "__view") as CanvasProbe;
    const worker = view.activeScene.workers.find(
      (worker) => worker.row.shadow && worker.platformKey.endsWith(":2"),
    );
    if (!worker) throw new Error("Missing shadow annex worker");
    view.cameraControl.focusPlatform(worker.platformKey);
    return worker.id;
  });
  await page.waitForTimeout(100);
  const target = (await paintedTargets(page)).bodies.find((body) => body.id === ghost);
  assert.ok(target, "ghost retains hover geometry");
  await page.mouse.click(
    box.x + target.left + target.width / 2,
    box.y + target.top + target.height * 0.75,
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  assert.equal((await annexFrame(page)).focused, null);
  await expect(page.locator(`[data-session-id="${ghost}"]`)).toHaveCount(0);
  await expect(page.locator(".row-attach, .row-close")).toHaveCount(0);
}
async function crewMotion(page: Page, close: () => void, birth: () => void, artifacts: string) {
  await page.getByRole("button", { name: "Zoom to the Fixture project platform" }).click();
  const probe = () =>
    page.evaluate(() => {
      const view = Reflect.get(window, "__view") as CanvasProbe;
      return {
        workers: view.activeScene.workers.map((worker) => ({
          id: worker.id,
          phase: worker.helperPhase,
        })),
        actors: view.actors,
      };
    });
  const before = await probe();
  await observeRosterMutations(page);
  await page.waitForTimeout(6000);
  assert.equal(
    await page.evaluate(() => Number(Reflect.get(window, "__rosterMutations"))),
    0,
    "normal actor frame ticks and unchanged polls preserve roster nodes",
  );
  const after = await probe();
  const links = await helperLinks(page);
  assert(links.away > 0, "normal-motion proof includes away helper chairs");
  assert(
    after.actors.some((actor) => {
      const previous = before.actors.find((value) => value.id === actor.id);
      return (
        previous &&
        Math.hypot(actor.point.x - previous.point.x, actor.point.y - previous.point.y) > 0.1
      );
    }),
    "normal-motion fixture advances actual actor coordinates",
  );
  await capture(page, path.join(artifacts, "helper-motion.png"));
  close();
  await expect
    .poll(async () => (await probe()).workers.find((worker) => worker.id === "helper_00")?.phase)
    .toBe("returning");
  await expect(page.locator('[data-session-id="helper_00"]')).toContainText("killed");
  await expect(page.locator('[data-session-id="helper_00"]')).toHaveCount(0, { timeout: 20000 });
  birth();
  await expect
    .poll(async () => (await probe()).workers.find((worker) => worker.id === "helper_birth")?.phase)
    .toBe("entering");
  await capture(page, path.join(artifacts, "helper-arrival.png"));
  await helperLinks(page);
  await expect
    .poll(
      async () => (await probe()).workers.find((worker) => worker.id === "helper_birth")?.phase,
      { timeout: 20000 },
    )
    .toBe("present");
  await expect(page.locator("#sessions .session-row")).toHaveCount(20);
}
async function crewBehavior(page: Page, close: () => void, birth: () => void, artifacts: string) {
  const rows = page.locator("#sessions .session-row");
  await expect(rows).toHaveCount(20);
  const sceneIds = () =>
    page.evaluate(() =>
      (Reflect.get(window, "__view") as CanvasProbe).activeScene.workers
        .map((worker) => worker.id)
        .sort(),
    );
  assert.deepEqual(
    await rows.evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.sessionId).sort(),
    ),
    await sceneIds(),
  );
  await expect(page.locator("#room-count")).toContainText("20 workers on this deck");
  await expect(page.locator("#counts")).toContainText(
    "8 working · 2 waiting · 20 total · 1 last known",
  );
  await page.locator("#station-stats-summary").click();
  await expect(page.locator("#station-stats")).toContainText(
    "20 displayed crew · 8 working · history In 76K / Out 1.5K · partial usage data",
  );
  await expect(page.locator("#station-totals")).toContainText(
    "8 working · 2 waiting · 7 idle · 1 done · 1 unknown · 1 stale",
  );
  await expect(page.locator("#station-stats")).not.toContainText(
    "Includes retained helper histories, including helpers hidden from the room.",
  );
  await expect(page.locator("#station-stats")).not.toContainText(
    "Codex input includes cached input; do not add cache read to input.",
  );
  await expect(page.locator("#station-totals dt")).toHaveText([
    "Displayed crew",
    "Status",
    "Cumulative session-history tokens",
    "Usage data coverage",
  ]);
  await expect(page.locator("#station-totals .total-counter")).toHaveText([
    "in 76K",
    "out 1.5K partial",
    "cache read 64K",
    "cache write 0",
  ]);
  await page
    .getByRole("button", {
      name: "Open details for Codex · helper · Synthetic helper 0",
      exact: false,
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "relationship verified · running presence unconfirmed",
  );
  await page.keyboard.press("Escape");
  const quarters = await page.evaluate(() =>
    (Reflect.get(window, "__view") as CanvasProbe).activeScene.platforms.map((platform) => ({
      rect: platform.rect,
      quarters: platform.quarters,
    })),
  );
  assert.equal(quarters.length, 1);
  const room = quarters[0];
  assert.ok(room && room.quarters.rect.w === 3 && room.quarters.rect.h === 1);
  assert.equal(room.quarters.rect.x - room.rect.x, 14);
  if ((await page.locator("#fx-toggle").getAttribute("aria-pressed")) === "true")
    await page.locator("#fx-toggle").click();
  await expect(page.locator("#fx-toggle")).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Zoom to the Fixture project platform" }).click();
  await capture(page, path.join(artifacts, "helper-quarters.png"));
  assert.equal(
    (await helperLinks(page)).occupied,
    8,
    "reduced motion keeps all present helpers at their chairs",
  );
  await page.locator("#search").fill("Synthetic worker 0");
  await expect(rows).toHaveCount(1);
  await expect(page.locator("#search")).toBeFocused();
  assert.equal((await sceneIds()).length, 20);
  await page.locator("#search").fill("");
  await expect(rows).toHaveCount(20);
  await observeRosterMutations(page);
  await page.waitForTimeout(2300);
  assert.equal(
    await page.evaluate(() => Number(Reflect.get(window, "__rosterMutations"))),
    0,
    "unchanged polls and frame ticks preserve roster nodes",
  );
  await page.locator('[data-session-id="helper_00"]').click();
  await page.locator("canvas").focus();
  close();
  await expect(rows).toHaveCount(19, { timeout: 10000 });
  assert.equal((await sceneIds()).length, 19);
  await expect(page.locator("#station-stats-summary")).toContainText("19 displayed crew");
  await expect(page.locator("canvas")).toBeFocused();
  assert.equal(
    (await paintedTargets(page)).focused,
    null,
    "settlement clears removed avatar selection without stealing keyboard focus",
  );
  birth();
  await expect(page.locator('[data-session-id="helper_birth"]')).toHaveCount(1, { timeout: 10000 });
  await expect(rows).toHaveCount(20);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (Reflect.get(window, "__view") as CanvasProbe).activeScene.workers.find(
            (worker) => worker.id === "helper_birth",
          )?.helperPhase,
      ),
    )
    .toBe("present");
  await expect(page.locator("#station-stats-summary")).toContainText("20 displayed crew");
  await expect(page.locator("#station-totals .total-counter").first()).toHaveText("in 76K");
}
async function helperLinks(page: Page) {
  const project = ({ x, y, z = 0 }: { x: number; y: number; z?: number | undefined }) => ({
    x: 24 * (x - y),
    y: 12 * (x + y) - 24 * z,
  });
  const frame = await page.evaluate(() => {
    const view = Reflect.get(window, "__view") as CanvasProbe;
    const ctx = view.ctx,
      moveTo = ctx.moveTo.bind(ctx),
      lineTo = ctx.lineTo.bind(ctx),
      stroke = ctx.stroke.bind(ctx);
    let from = { x: 0, y: 0 },
      to = from;
    const strokes: {
      from: { x: number; y: number };
      to: { x: number; y: number };
      color: unknown;
      dash: number[];
      alpha: number;
      width: number;
    }[] = [];
    const builds = view.staticLayer?.builds;
    try {
      ctx.moveTo = (x, y) => {
        from = { x, y };
        moveTo.call(ctx, x, y);
      };
      ctx.lineTo = (x, y) => {
        to = { x, y };
        lineTo.call(ctx, x, y);
      };
      ctx.stroke = (path?: Path2D) => {
        strokes.push({
          from,
          to,
          color: ctx.strokeStyle,
          dash: ctx.getLineDash(),
          alpha: ctx.globalAlpha,
          width: ctx.lineWidth,
        });
        Reflect.apply(stroke, ctx, path ? [path] : []);
      };
      view.framePaint.paint(performance.now());
      return {
        workers: view.activeScene.workers,
        actors: view.actors,
        strokes,
        builds,
        after: view.staticLayer?.builds,
      };
    } finally {
      ctx.moveTo = moveTo;
      ctx.lineTo = lineTo;
      ctx.stroke = stroke;
    }
  });
  let occupied = 0,
    away = 0;
  for (const worker of frame.workers) {
    if (!worker.connector) continue;
    const actor = frame.actors.find((value) => value.id === worker.id);
    const atChair =
      !!actor &&
      Math.hypot(actor.point.x - worker.chair.x, actor.point.y - worker.chair.y) <= 0.001;
    const from = project(worker.connector.from),
      to = project(worker.connector.to);
    const matches = frame.strokes.filter(
      (value) =>
        value.from.x === from.x &&
        value.from.y === from.y &&
        value.to.x === to.x &&
        value.to.y === to.y &&
        value.color === worker.accent &&
        value.dash.join() === "4,4" &&
        value.width === 1.5 &&
        value.alpha === 0.6,
    );
    assert.equal(
      matches.length,
      atChair ? 1 : 0,
      worker.id + ": native canvas link follows actual foot/chair occupancy",
    );
    if (atChair) occupied++;
    else away++;
  }
  assert.equal(frame.after, frame.builds, "native motion paint reuses static canvas");
  return { occupied, away };
}
async function observeRosterMutations(page: Page) {
  await page.evaluate(() => {
    Reflect.set(window, "__rosterMutations", 0);
    new MutationObserver((records) => {
      Reflect.set(
        window,
        "__rosterMutations",
        Number(Reflect.get(window, "__rosterMutations")) +
          records.filter((record) => record.type === "childList").length,
      );
    }).observe(document.getElementById("sessions") ?? document.body, {
      childList: true,
      subtree: true,
    });
  });
}
function signBodyOverlap(targets: Awaited<ReturnType<typeof paintedTargets>>) {
  for (const sign of targets.signs)
    for (const body of targets.bodies) {
      const left = Math.max(sign.left, body.left),
        top = Math.max(sign.top, body.top);
      const right = Math.min(sign.left + sign.width, body.left + body.width);
      const bottom = Math.min(sign.top + sign.height, body.top + body.height);
      if (right > left && bottom > top)
        return { left, top, width: right - left, height: bottom - top };
    }
  return null;
}
function snapshot() {
  const now = Date.now();
  const row = {
    id: "obs_aaaaaaaaaaaaaaaaaaaaaaaa",
    identity: "codex:11111111-1111-1111-1111-111111111111",
    provider: "codex",
    source: "herdr",
    project: "Fixture project",
    projectId: "project_fixture",
    projectKind: "group",
    repo: "fixture-repo",
    repoId: "repo_fixture",
    title: "Synthetic browser fixture",
    status: "working",
    observedAt: now,
    inventoryHealth: "available" as const,
    paneId: "w1:p1",
    hostId: "local",
  };
  return {
    health: "available",
    observedAt: now,
    error: null,
    sessions: [row],
    sources: {
      hosts: {
        local: { health: "available", observedAt: now, reason: null, agents: 1 },
        remote: { health: "available", observedAt: now, reason: null, agents: 0 },
      },
    },
  };
}
async function listen(http: HttpModule, options: FixtureOptions) {
  const server = http.createServer(options);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, url: `http://127.0.0.1:${String(address.port)}` };
}
async function ui(page: Page) {
  await expect(page.locator("#sessions")).toContainText("Synthetic browser fixture");
  await page.locator("#controls-help").click();
  await expect(page.locator("#controls-help")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator("#controls-help")).toHaveAttribute("aria-expanded", "false");
  await keyboardCamera(page);
  await page.locator("#fx-toggle").click();
  const preference = await page.evaluate(() => localStorage.getItem("observer.fx"));
  assert.ok(preference === "0" || preference === "1");
  await page.reload();
  await expect(page.locator("#sessions")).toContainText("Synthetic browser fixture");
  assert.equal(await page.evaluate(() => localStorage.getItem("observer.fx")), preference);
  await page.locator('[data-host="remote"]').click();
  assert.equal(await page.evaluate(() => localStorage.getItem("observer.host")), "remote");
  await page.locator('[data-host=""]').click();
}
async function lifecycle(page: Page) {
  let polls = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/observer/sessions")) polls++;
  });
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(2500);
  const hidden = polls;
  await page.waitForTimeout(2500);
  assert.equal(polls, hidden);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => polls).toBeGreaterThan(hidden);
  await expect(page.locator("#sessions")).toContainText("Synthetic browser fixture");
}
async function canvas(page: Page) {
  await expect
    .poll(async () =>
      page.locator("canvas").evaluate((element) => {
        if (!(element instanceof HTMLCanvasElement)) throw new Error("Expected canvas");
        const context = element.getContext("2d");
        if (!context) return 0;
        const bytes = context.getImageData(0, 0, element.width, element.height).data;
        return bytes.filter((value, index) => index % 4 !== 3 && value > 0).length;
      }),
    )
    .toBeGreaterThan(100);
}
async function runBrowserConsumer(root: string) {
  const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), "observer-browser-evidence-"));
  const http = (await import(
    pathToFileURL(path.join(root, "dist/runtime/src/server/http.js")).href
  )) as HttpModule;
  const browser = await chromium.launch({ headless: true });
  assert.equal(browser.version(), "156.0.8078.4");
  let stale = false;
  const fixture = await listen(http, {
    token: TOKEN,
    observer: {
      get: () => {
        const value = snapshot();
        if (stale) {
          value.observedAt = 1;
          for (const row of value.sessions) row.observedAt = 1;
        }
        return value;
      },
      inspect: () => ({ health: "unavailable", reason: "fixture", turns: [] }),
    },
  });
  try {
    const annexes = await nativeCanvas(browser, root, http, artifacts);
    await fs.mkdir(artifacts, { recursive: true });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    const errors = observeErrors(page);
    await prepaint(browser, fixture.url, "#dcf3e3");
    await page.goto(fixture.url);
    await canvas(page);
    await capture(page, path.join(artifacts, "canonical.png"));
    await ui(page);
    await lifecycle(page);
    await panel(page);
    stale = true;
    await expect(page.locator("#counts")).toContainText("Last known", { timeout: 10000 });
    stale = false;
    await packAndControls(browser, http, root, artifacts);
    await hostTabs(browser, http);
    assert.equal((await page.request.get(fixture.url + "/api/observer/sessions")).status(), 403);
    assert.equal(
      await page.evaluate(() =>
        Object.values(localStorage).some((value) =>
          String(value).includes("synthetic-browser-consumer-token"),
        ),
      ),
      false,
    );
    await expect(page.locator(".row-attach")).toHaveCount(0);
    assert.deepEqual(errors, []);
    const receipt = {
      playwright: "1.64.1",
      chromium: browser.version(),
      canvas: true,
      nativeCanvasClicks: true,
      annexes,
      helperCrew: {
        initialDisplayed: 20,
        initialRetainedRecords: 76,
        scopesAndCoverage: true,
        stableRoster: true,
        filterAndSettlementFocus: true,
        reducedAndNormalLifecycle: true,
        nativeChairOccupancyLinks: true,
        screenshots: ["helper-quarters.png", "helper-motion.png", "helper-arrival.png"],
      },
      prepaint: ["starnet", "synthetic-private"],
      fixtureControls: true,
      staleProof: true,
      panelsAndFocus: true,
      hostTabs: true,
      screenshotContext:
        "Fresh 1440x1000 contexts, reduced motion, no stored preferences; capture before interactions after fonts and paint. Fixture adds empty remote dock; old baseline differs in geometry and FX, so no exact pixel-parity claim.",
      ui: true,
      lifecycle: true,
      errors,
      screenshot: path.join(artifacts, "canonical.png"),
      manualVisualJudgment: "pending",
    };
    await fs.writeFile(
      path.join(artifacts, "receipt.json"),
      JSON.stringify(receipt, null, 2) + "\n",
    );
    console.log(`Browser evidence: ${artifacts}`);
    return receipt;
  } finally {
    await browser.close();
    fixture.server.closeAllConnections();
    await new Promise<void>((resolve) =>
      fixture.server.close(() => {
        resolve();
      }),
    );
  }
}
test("installed emitted application operates in real Chromium", async () => {
  await runBrowserConsumer(consumerRoot());
}, 120000);

async function hostTabs(browser: Browser, http: HttpModule) {
  const fixture = await listen(http, {
    token: TOKEN,
    observer: { get: snapshot, inspect: () => ({ health: "unavailable", turns: [] }) },
  });
  let page: Page | undefined;
  try {
    page = await browser.newPage({ reducedMotion: "reduce" });
    await page.goto(fixture.url);
    const remote = page.locator('#host-tabs [data-host="remote"]');
    await expect(remote).toBeVisible();
    await page.evaluate(() => {
      const original = localStorage.setItem.bind(localStorage);
      document.documentElement.dataset.hostWrites = "0";
      Storage.prototype.setItem = function (key, value) {
        if (key === "observer.host")
          document.documentElement.dataset.hostWrites = String(
            Number(document.documentElement.dataset.hostWrites) + 1,
          );
        original(key, value);
      };
    });
    await remote.focus();
    const bounds = await remote.boundingBox();
    assert.ok(bounds);
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    // An attribute mutation proves the poll reached Hosts.render, beyond merely receiving HTTP.
    await remote.evaluate(
      (tab) =>
        new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            observer.disconnect();
            reject(new Error("Host tab did not render during the native press"));
          }, 5000);
          const observer = new MutationObserver(() => {
            clearTimeout(timeout);
            observer.disconnect();
            resolve();
          });
          observer.observe(tab, { attributes: true, attributeFilter: ["aria-selected"] });
        }),
    );
    await expect(remote).toBeFocused();
    await page.mouse.up();
    await expect(remote).toHaveAttribute("aria-selected", "true");
    assert.equal(await page.evaluate(() => localStorage.getItem("observer.host")), "remote");
    assert.equal(await page.locator("html").getAttribute("data-host-writes"), "1");
    const local = page.locator('#host-tabs [data-host=""]');
    await local.focus();
    await page.keyboard.press("Enter");
    await expect(local).toHaveAttribute("aria-selected", "true");
    assert.equal(await page.evaluate(() => localStorage.getItem("observer.host")), null);
    await page.keyboard.press("Tab");
    await expect(remote).toBeFocused();
    await page.keyboard.press("Space");
    await expect(remote).toHaveAttribute("aria-selected", "true");
    assert.equal(await page.locator("html").getAttribute("data-host-writes"), "2");
  } finally {
    await page?.close();
    fixture.server.closeAllConnections();
    await new Promise<void>((resolve) =>
      fixture.server.close(() => {
        resolve();
      }),
    );
  }
}

async function panel(page: Page) {
  await page.locator(".row-inspect").first().click();
  await expect(page.getByRole("dialog").last()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function packAndControls(
  browser: Browser,
  http: HttpModule,
  root: string,
  artifacts: string,
) {
  const id = "acceptance-" + randomUUID().slice(0, 8);
  const pack = path.join(root, "dist/public/assets/themes", id);
  await fs.mkdir(pack);
  let attached = 0;
  await fs.writeFile(
    path.join(pack, "theme.json"),
    JSON.stringify({ version: 1, id, extends: "starnet", ui: { colors: { ink: "#123456" } } }),
  );
  const fixture = await listen(http, {
    token: TOKEN,
    theme: { pack: id },
    observer: { get: snapshot, inspect: () => ({ health: "unavailable", turns: [] }) },
    control: {
      attach: () => {
        attached++;
        return { paneId: "w1:p1" };
      },
    },
  });
  try {
    await prepaint(browser, fixture.url, "#123456");
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    const errors = observeErrors(page);
    await page.goto(fixture.url);
    await expect(page.locator(".row-attach")).toBeVisible();
    const response = await page.request.post(fixture.url + "/api/control/attach", {
      data: { paneId: "w1:p1" },
    });
    assert.equal(response.status(), 403);
    assert.equal(attached, 0);
    await canvas(page);
    await capture(page, path.join(artifacts, "synthetic-private.png"));
    await page.locator(".row-attach").click();
    await expect.poll(() => attached).toBe(1);
    assert.deepEqual(errors, []);

    await page.close();
  } finally {
    fixture.server.closeAllConnections();
    await new Promise<void>((resolve) =>
      fixture.server.close(() => {
        resolve();
      }),
    );
    await fs.rm(pack, { recursive: true, force: true });
  }
}

async function capture(page: Page, destination: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          resolve();
        }),
      ),
    );
  });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: destination, animations: "disabled" });
}

async function prepaint(browser: Browser, url: string, ink: string) {
  const page = await browser.newPage();
  try {
    await page.route("**/app/main.js", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: "/* Main paused to inspect synchronous prepaint. */",
      }),
    );
    await page.goto(url);
    assert.equal(
      await page.evaluate(() => document.documentElement.style.getPropertyValue("--ink")),
      ink,
    );
  } finally {
    await page.close();
  }
}

function observeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function canvasSignature(page: Page): Promise<string> {
  return page.locator("canvas").evaluate(async (element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error("Expected canvas");
    const bytes = new TextEncoder().encode(element.toDataURL());
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
  });
}
async function keyboardCamera(page: Page) {
  await page.locator("#world").focus();
  const overview = await canvasSignature(page);
  await page.keyboard.press("+");
  await expect
    .poll(() => canvasSignature(page), { message: "KEYBOARD_ZOOM_RENDER" })
    .not.toBe(overview);
  for (let index = 0; index < 8; index++) await page.keyboard.press("+");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            resolve();
          }),
        ),
      ),
  );
  const zoomed = await canvasSignature(page);
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => canvasSignature(page), { message: "KEYBOARD_PAN_RENDER" })
    .not.toBe(zoomed);
  await page.keyboard.press("0");
  await expect
    .poll(() => canvasSignature(page), { message: "KEYBOARD_OVERVIEW_RENDER" })
    .toBe(overview);
  await expect(page.locator("#world")).toBeFocused();
}
