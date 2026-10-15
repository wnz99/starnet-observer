/* Home-office scene art: one complete, atomic PNG group per view and fixed role composition helpers.
   The role table (sizes, foot anchors, repetition) is application-owned; manifests only name the PNGs. Nothing here
   reads the observation, geometry or routes: painters pass world points and rects they already own. */
"use strict";
const ObserverOfficeArt = (() => {
  const ROLES =
    typeof module !== "undefined" && module.exports
      ? require("./scene-art-roles.js").SCENE_ART_ROLES
      : SCENE_ART_ROLES;
  const ROLE_NAMES = Object.freeze(Object.keys(ROLES));
  // Server-derived same-origin scene URLs only, mirroring the loader's `scene/*.png` path rule.
  const SCENE_URL =
    /^\/assets\/themes\/[a-z0-9][a-z0-9-]{0,31}\/scene\/(?:[a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9_-]*\.png$/;
  const failed = (reason) => Object.freeze({ state: "failed", reason });

  function decode(image) {
    if (typeof image.decode === "function") return image.decode();
    return new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    });
  }
  /* One load: every role resolves to one deduplicated image, all must decode at their exact native size, and only
     then does a frozen role map publish. Each image is checked against every role sharing its URL as soon as it
     decodes, so the first known failure (a decode rejection: scene-art-load; a wrong size: scene-art-dimensions)
     settles the whole group at once, without waiting for unrelated decodes, and discards the staged images. Later
     settlements are swallowed and change nothing. There is no retry or timeout. */
  function load(art, { Image } = {}) {
    const assets = art && art.assets;
    if (!assets || typeof assets !== "object" || typeof Image !== "function")
      return Promise.resolve(failed("scene-art-load"));
    if (
      ROLE_NAMES.some((role) => typeof assets[role] !== "string" || !SCENE_URL.test(assets[role]))
    )
      return Promise.resolve(failed("scene-art-load"));
    let staged = new Map();
    try {
      for (const role of ROLE_NAMES) {
        const url = assets[role];
        if (staged.has(url)) continue;
        const image = new Image();
        image.decoding = "async";
        image.src = url;
        staged.set(url, { image, decoded: decode(image) });
      }
    } catch (_) {
      staged.clear();
      return Promise.resolve(failed("scene-art-load"));
    }
    return new Promise((resolve) => {
      let remaining = staged.size;
      const settle = (result) => {
        if (!staged) return;
        staged.clear();
        staged = null;
        resolve(result);
      };
      const fits = (image, url) =>
        ROLE_NAMES.every(
          (role) =>
            assets[role] !== url ||
            (image.naturalWidth === ROLES[role].source.width &&
              image.naturalHeight === ROLES[role].source.height),
        );
      for (const [url, { image, decoded }] of staged) {
        Promise.resolve(decoded).then(
          () => {
            if (!staged) return;
            if (!fits(image, url)) return settle(failed("scene-art-dimensions"));
            if (--remaining) return;
            const images = Object.freeze(
              Object.fromEntries(ROLE_NAMES.map((role) => [role, staged.get(assets[role]).image])),
            );
            settle(Object.freeze({ state: "ready", images }));
          },
          () => settle(failed("scene-art-load")),
        );
      }
    });
  }

  /* Application-owned tone per logical crew skin (the view's provider mapping), drawn as the procedural human's hair
     so providers stay distinguishable without a ready replacement group. Unknown skins keep the neutral head. */
  const SKIN_TONE = Object.freeze({ blank_amber: "amber", blank_blue: "cyan" });

  /* Fixed role composition for the existing painter passes. `project` is the scene projection; every role draws at
     its native source size with its foot on the projected role origin, snapped to whole pixels, never rescaled. */
  function create({ images, colors, project, crewHeight }) {
    const C = colors;
    const origin = (role, point) => {
      const at = project(point),
        foot = ROLES[role].foot;
      return { x: Math.round(at.x - foot.x), y: Math.round(at.y - foot.y) };
    };
    function draw(ctx, role, point) {
      const image = images[role],
        { width, height } = ROLES[role].source,
        at = origin(role, point);
      ctx.drawImage(image, at.x, at.y, width, height);
    }
    // Diamond surface roles (repeat 'tile'): one native tile per whole cell, clipped to the floor rect.
    function tile(ctx, role, rect, z = 0) {
      const corners = [
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.w, y: rect.y },
        { x: rect.x + rect.w, y: rect.y + rect.h },
        { x: rect.x, y: rect.y + rect.h },
      ].map((p) => project({ ...p, z }));
      ctx.save();
      ctx.beginPath();
      corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.clip();
      for (let x = Math.floor(rect.x); x < rect.x + rect.w; x++)
        for (let y = Math.floor(rect.y); y < rect.y + rect.h; y++) draw(ctx, role, { x, y, z });
      ctx.restore();
    }
    /* Edge roles (repeat 'edge'): one native unit per whole step along the role's orientation ('x' walls stand on a
       constant x and run along y; 'y' walls the reverse), clipped to the rect's projected horizontal span. */
    function edge(ctx, role, rect, z = 0) {
      const alongY = ROLES[role].orientation === "x",
        length = alongY ? rect.h : rect.w;
      const xs = [
        project({ x: rect.x, y: rect.y + rect.h, z }).x,
        project({ x: rect.x + rect.w, y: rect.y, z }).x,
      ];
      ctx.save();
      ctx.beginPath();
      ctx.rect(Math.min(...xs), -1e6, Math.abs(xs[1] - xs[0]), 2e6);
      ctx.clip();
      for (let step = 0; step < length; step++)
        draw(
          ctx,
          role,
          alongY ? { x: rect.x, y: rect.y + step, z } : { x: rect.x + step, y: rect.y, z },
        );
      ctx.restore();
    }
    /* Original procedural human: head with a provider-toned hair cap (logical skin), torso in the worker's accent and
       legs, inside the existing fallback bounds (16 px wide, crewHeight tall, scaled by the worker size) so hit
       regions and plates never move. */
    function human(
      ctx,
      foot,
      { size = 1, sitting = false, accent = C["viewer-body"], skin = "blank" } = {},
    ) {
      const h = crewHeight * size,
        w = 16 * size,
        head = 4.5 * size,
        hip = foot.y - h * (sitting ? 0.56 : 0.46),
        shoulder = foot.y - h * (sitting ? 0.78 : 0.74);
      ctx.save();
      ctx.strokeStyle = C["body-outline"];
      ctx.lineWidth = 1;
      ctx.fillStyle = C["viewer-body"];
      // Seated hips sit at the office chair role's cushion height (extent 0.9 of crew height ~ 0.56); shins drop to its foot ring.
      if (sitting) {
        ctx.fillRect(foot.x - w * 0.3, hip, w * 0.6, h * 0.12);
        ctx.fillRect(foot.x - w * 0.26, hip, w * 0.18, h * 0.14);
        ctx.fillRect(foot.x + w * 0.08, hip, w * 0.18, h * 0.14);
      } else {
        ctx.fillRect(foot.x - w * 0.28, hip, w * 0.22, foot.y - hip);
        ctx.fillRect(foot.x + w * 0.06, hip, w * 0.22, foot.y - hip);
      }
      ctx.beginPath();
      ctx.moveTo(foot.x - w * 0.42, hip);
      ctx.lineTo(foot.x - w * 0.36, shoulder);
      ctx.lineTo(foot.x + w * 0.36, shoulder);
      ctx.lineTo(foot.x + w * 0.42, hip);
      ctx.closePath();
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(foot.x, shoulder - head, head, 0, Math.PI * 2);
      ctx.fillStyle = C["viewer-body"];
      ctx.fill();
      ctx.stroke();
      const tone = Object.hasOwn(SKIN_TONE, skin) ? C[SKIN_TONE[skin]] : null;
      if (tone) {
        ctx.beginPath();
        ctx.arc(foot.x, shoulder - head, head, Math.PI, Math.PI * 2);
        ctx.closePath();
        ctx.fillStyle = tone;
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
      return { top: foot.y - h, w, h, fallback: true };
    }
    return Object.freeze({ draw, tile, edge, human });
  }
  return Object.freeze({ load, create, ROLE_NAMES });
})();
if (typeof module !== "undefined" && module.exports) module.exports = ObserverOfficeArt;
