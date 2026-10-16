import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalTheme } from "../src/browser/theme.fixture.js";
const REPOSITORY = fileURLToPath(new URL("../", import.meta.url));
const PNG_HEADER = {
  size: 33,
  ihdrLength: 13,
  lengthOffset: 8,
  kind: "IHDR",
  kindOffset: 12,
  width: 144,
  height: 144,
  widthOffset: 16,
  heightOffset: 20,
};
function png() {
  const data = Buffer.alloc(PNG_HEADER.size);
  Buffer.from("89504e470d0a1a0a", "hex").copy(data);
  data.writeUInt32BE(PNG_HEADER.ihdrLength, PNG_HEADER.lengthOffset);
  data.write(PNG_HEADER.kind, PNG_HEADER.kindOffset);
  data.writeUInt32BE(PNG_HEADER.width, PNG_HEADER.widthOffset);
  data.writeUInt32BE(PNG_HEADER.height, PNG_HEADER.heightOffset);
  return data;
}
async function writeCrew(frontend: string) {
  const defaults = canonicalTheme();
  for (const group of Object.values(defaults.crew)) {
    for (const frames of Object.values(group.tracks)) {
      for (const frame of frames) {
        const file = path.join(frontend, frame);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, png());
      }
    }
  }
}
async function writePrivatePack(themes: string) {
  const privatePack = path.join(themes, "private");
  await fs.mkdir(privatePack);
  await fs.writeFile(
    path.join(privatePack, "theme.json"),
    JSON.stringify({
      version: 1,
      id: "private",
      extends: "starnet",
      ui: { colors: { ink: "#123456" } },
    }),
  );
  await fs.writeFile(path.join(privatePack, "untracked.png"), png());
  return privatePack;
}
export async function publicFixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "observer-public-")));
  const frontend = path.join(root, "frontend"),
    assets = path.join(frontend, "assets");
  await fs.mkdir(path.join(frontend, "app"), { recursive: true });
  for (const entry of ["observer-scene", "observer-view", "observer"])
    await fs.copyFile(
      path.join(REPOSITORY, "frontend", "app", `${entry}.js`),
      path.join(frontend, "app", `${entry}.js`),
    );
  await fs.copyFile(
    path.join(REPOSITORY, "frontend", "observer.html"),
    path.join(frontend, "observer.html"),
  );
  await fs.cp(path.join(REPOSITORY, "frontend", "css"), path.join(frontend, "css"), {
    recursive: true,
  });
  for (const directory of ["browser", "shared"])
    await fs.cp(path.join(REPOSITORY, "src", directory), path.join(root, "src", directory), {
      recursive: true,
      filter: (file) => !/\.(test|fixture)\.ts$/.test(file),
    });
  await writeCrew(frontend);
  const defaults = canonicalTheme();
  const themes = path.join(assets, "themes");
  await fs.mkdir(path.join(themes, "starnet"), { recursive: true });
  await fs.writeFile(path.join(themes, "starnet", "theme.json"), JSON.stringify(defaults));
  await fs.mkdir(path.join(assets, "fonts"));
  await fs.writeFile(path.join(assets, "fonts", "vt323.woff2"), "wOF2-fixture");
  await fs.copyFile(
    path.join(REPOSITORY, "frontend", "assets", "sprites", "manifest.json"),
    path.join(assets, "sprites", "manifest.json"),
  );
  await fs.writeFile(path.join(root, ".gitignore"), "frontend/assets/themes/private/\n");
  const privatePack = await writePrivatePack(themes);
  return {
    root,
    frontend,
    themes,
    privatePack,
    generated: path.join(root, "dist"),
    dispose: () => fs.rm(root, { recursive: true, force: true }),
  };
}
