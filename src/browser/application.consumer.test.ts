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
