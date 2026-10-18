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
test("native canvas clicks toggle immediately and double-click retains the first target", async () => {
  const root = consumerRoot();
  const http = (await import(
    pathToFileURL(path.join(root, "dist/runtime/src/server/http.js")).href
  )) as HttpModule;
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
  const browser = await chromium.launch({ headless: true });
  const fixture = await listen(http, {
    token: TOKEN,
    observer: {
      get: () => {
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
  try {
    assert.equal(browser.version(), "156.0.8078.4");
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
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
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    fixture.server.closeAllConnections();
    await new Promise<void>((resolve) =>
      fixture.server.close(() => {
        resolve();
      }),
    );
  }
}, 30000);
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
    inventoryHealth: "available",
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
      prepaint: ["starnet", "synthetic-private"],
      fixtureControls: true,
      staleProof: true,
      panelsAndFocus: true,
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
}, 60000);

test("host tabs retain native focus and activation across polls", async () => {
  const root = consumerRoot();
  const http = (await import(
    pathToFileURL(path.join(root, "dist/runtime/src/server/http.js")).href
  )) as HttpModule;
  const browser = await chromium.launch({ headless: true });
  const fixture = await listen(http, {
    token: TOKEN,
    observer: { get: snapshot, inspect: () => ({ health: "unavailable", turns: [] }) },
  });
  try {
    assert.equal(browser.version(), "156.0.8078.4");
    const page = await browser.newPage({ reducedMotion: "reduce" });
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
    await browser.close();
    fixture.server.closeAllConnections();
    await new Promise<void>((resolve) =>
      fixture.server.close(() => {
        resolve();
      }),
    );
  }
}, 15000);

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
