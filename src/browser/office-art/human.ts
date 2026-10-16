import type { OfficeColors, OfficeContext, Point, HumanOptions } from "./types.js";
const HUMAN_WIDTH = 16;
const HEAD_RADIUS = 4.5;
const STANDING_HIP = 0.46;
const SEATED_HIP = 0.56;
const STANDING_SHOULDER = 0.74;
const SEATED_SHOULDER = 0.78;
const SEATED_HIP_X = 0.3;
const SEATED_HIP_WIDTH = 0.6;
const SEATED_HIP_HEIGHT = 0.12;
const SEATED_LEFT_SHIN = 0.26;
const SEATED_RIGHT_SHIN = 0.08;
const SEATED_SHIN_WIDTH = 0.18;
const SEATED_SHIN_HEIGHT = 0.14;
const STANDING_LEFT_LEG = 0.28;
const STANDING_RIGHT_LEG = 0.06;
const STANDING_LEG_WIDTH = 0.22;
const TORSO_HIP = 0.42;
const TORSO_SHOULDER = 0.36;
const FULL_TURN = 2 * Math.PI;
interface Geometry {
  foot: Point;
  h: number;
  w: number;
  head: number;
  hip: number;
  shoulder: number;
}
class HumanPainter<I> {
  constructor(
    private readonly context: OfficeContext<I>,
    private readonly colors: OfficeColors,
    private readonly geometry: Geometry,
  ) {}
  legs(sitting: boolean) {
    const {
      context: c,
      geometry: { foot, h, w, hip },
    } = this;
    c.strokeStyle = this.colors["body-outline"];
    c.lineWidth = 1;
    c.fillStyle = this.colors["viewer-body"];
    // Seated hips use cushion height; shins drop to the chair foot ring.
    if (sitting) {
      c.fillRect(foot.x - w * SEATED_HIP_X, hip, w * SEATED_HIP_WIDTH, h * SEATED_HIP_HEIGHT);
      c.fillRect(foot.x - w * SEATED_LEFT_SHIN, hip, w * SEATED_SHIN_WIDTH, h * SEATED_SHIN_HEIGHT);
      c.fillRect(
        foot.x + w * SEATED_RIGHT_SHIN,
        hip,
        w * SEATED_SHIN_WIDTH,
        h * SEATED_SHIN_HEIGHT,
      );
    } else {
      c.fillRect(foot.x - w * STANDING_LEFT_LEG, hip, w * STANDING_LEG_WIDTH, foot.y - hip);
      c.fillRect(foot.x + w * STANDING_RIGHT_LEG, hip, w * STANDING_LEG_WIDTH, foot.y - hip);
    }
  }
  torso(accent: string) {
    const {
      context: c,
      geometry: { foot, w, hip, shoulder },
    } = this;
    c.beginPath();
    c.moveTo(foot.x - w * TORSO_HIP, hip);
    c.lineTo(foot.x - w * TORSO_SHOULDER, shoulder);
    c.lineTo(foot.x + w * TORSO_SHOULDER, shoulder);
    c.lineTo(foot.x + w * TORSO_HIP, hip);
    c.closePath();
    c.fillStyle = accent;
    c.fill();
    c.stroke();
  }
  head(skin: string) {
    const {
      context: c,
      geometry: { foot, shoulder, head },
    } = this;
    c.beginPath();
    c.arc(foot.x, shoulder - head, head, 0, FULL_TURN);
    c.fillStyle = this.colors["viewer-body"];
    c.fill();
    c.stroke();
    // The logical skin controls provider hair tone. Unknown skins retain the neutral head.
    const tone =
      skin === "blank_amber" ? this.colors.amber : skin === "blank_blue" ? this.colors.cyan : null;
    if (tone) {
      c.beginPath();
      c.arc(foot.x, shoulder - head, head, Math.PI, FULL_TURN);
      c.closePath();
      c.fillStyle = tone;
      c.fill();
      c.stroke();
    }
  }
}
/* Original procedural human: provider-toned hair, accented torso and legs, inside the existing fallback bounds.
   Standing and sitting share the same bounds, so hit regions and plates never move. */
export function createHuman<I>(colors: OfficeColors, crewHeight: number) {
  return function human(
    context: OfficeContext<I>,
    foot: Point,
    {
      size = 1,
      sitting = false,
      accent = colors["viewer-body"],
      skin = "blank",
    }: HumanOptions = {},
  ) {
    const h = crewHeight * size,
      w = HUMAN_WIDTH * size,
      head = HEAD_RADIUS * size;
    const hip = foot.y - h * (sitting ? SEATED_HIP : STANDING_HIP);
    const shoulder = foot.y - h * (sitting ? SEATED_SHOULDER : STANDING_SHOULDER);
    const painter = new HumanPainter(context, colors, { foot, h, w, head, hip, shoulder });
    context.save();
    painter.legs(sitting);
    painter.torso(accent);
    painter.head(skin);
    context.restore();
    return { top: foot.y - h, w, h, fallback: true };
  };
}
