import { callbacksFor } from "./callbacks.js";
import { drawingEnvironment } from "./environment.js";
import { GeometryPainter } from "./geometry-painter.js";
import type { ViewBody } from "./state-types.js";
import type { ThemeSceneColor } from "../../shared/theme-keys.js";
import * as Scene from "../scene/index.js";
import type { ActorFrame, Camera, Scene as SceneGeometry, Worker } from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import { statusSignature } from "./helpers.js";
import { resolveLook } from "./look.js";
import { paintersFor } from "./painters.js";
import type {
  OfficeState,
  Pixie,
  PlainStar,
  Readiness,
  Starfield,
  StaticLayer,
} from "./state-types.js";
import type {
  Anchor,
  MailFrame,
  PlateFrame,
  ShipBox,
  SignBox,
  TargetBox,
  TitleBox,
  UpdateOptions,
  ViewDefaults,
  ViewObserver,
  ViewOptions,
  ZoomLimits,
} from "./types.js";
import { Aura } from "./aura.js";
import { Cache } from "./cache.js";
import { CameraControl } from "./camera-control.js";
import { Crew } from "./crew.js";
import { Effects } from "./effects.js";
import { FramePaint } from "./frame-paint.js";
import { FurnitureEffects } from "./furniture-effects.js";
import { Interaction } from "./interaction.js";
import { Lifecycle } from "./lifecycle.js";
import { Mail } from "./mail.js";
import { Plates } from "./plates.js";
import { PlatformEffects } from "./platform-effects.js";
import { Resources } from "./resources.js";
import { Space } from "./space.js";
import { StarsPaint } from "./stars-paint.js";
import { present as required } from "./values.js";
export class ViewRuntime<R extends SpriteResource, B extends R = R> {
  get activeScene(): SceneGeometry {
    return required(this.scene);
  }

  constructor(
    readonly factory: ViewDefaults,
    readonly options: ViewOptions<R, B>,
  ) {
    this.theme = this.options.theme;
    this.canvas = this.options.canvas;
    this.env = this.options.env ?? {};
    this.callbacks = callbacksFor(options);
    const environment = drawingEnvironment(this.env);
    this.win = environment.win;
    this.raf = environment.raf;
    this.caf = environment.caf;
    this.dprOf = environment.dprOf;
    this.makeCanvas = environment.makeCanvas;
    this.clock = environment.clock;
    this.sprites = this.env.sprites ?? null;
    this.ctx = required(this.canvas.getContext("2d"));
    this.geometry = new GeometryPainter(this.ctx);
    this.look = resolveLook(this.theme, this.factory.defaults);
    this.C = this.look.colors;
    this.S = this.look.status;
    this.decor = this.look.ambientFx === "station";
    this.rain = this.look.backgroundFx === "rain";
    this.station = paintersFor<R>(this.look);
    this.status = this.env.themeStatus || this.factory.themeStatus;
    this.packId =
      this.theme && typeof this.theme.effectiveId === "string" ? this.theme.effectiveId : "starnet";
    this.office = this.look.art === "home-office" ? { state: "pending", composition: null } : null;
    this.stationArt = {
      paintStatic: this.station.paintStatic,
      desk: this.station.paintDesk,
      helperDesk: this.station.paintHelperDesk,
      chair: this.station.paintChair,
      partition: this.station.paintPartition,
      apron: this.station.paintApronProp,
      planningDesk: this.station.paintPlanningDesk,
      viewer: this.station.paintViewer,
      screen: this.station.paintObservatoryScreen,
      telescope: this.station.paintTelescope,
      plant: this.station.paintPlant,
      lamp: this.station.paintLamp,
      drone: this.station.paintDrone,
    };
    this.resources.initialize();
  }

  readonly callbacks;
  theme;

  canvas;

  env;

  win;

  raf;

  caf;

  dprOf;

  makeCanvas;

  sprites;

  ctx;
  readonly geometry;

  look;

  C;

  S;

  decor;

  rain;

  station;

  movement = Scene.createMovement();

  bodies: Map<string, ViewBody<B>> = new Map();

  scene: SceneGeometry | null = null;

  stale = () => false;

  rowStale: (worker: Worker) => boolean = () => false;

  mailFrame: ((now: number) => MailFrame) | null = null;

  inspected: () => string | null = () => null;

  workerStale = (worker: Worker) => this.stale() || this.rowStale(worker);

  camera: Camera = { zoom: 1, tx: 0, ty: 0 };

  mode = "overview";

  platform: string | null = null;

  focused: string | null = null;

  hovered: string | null = null;

  regions: Anchor[] = [];

  anchors: Anchor[] = [];

  titleRegions: TitleBox[] = [];
  badgeRegions: (TitleBox & { text: string })[] = [];

  signRegions: SignBox[] = [];
  platformRegions: TitleBox[] = [];

  plateFrame: PlateFrame | null = null;

  repositories: Set<string> = new Set();

  repositorySelection: () => string | null = () => null;

  onRepositoryToggle: (repo: string) => void = () => {};

  observatoryRegion: TargetBox | null = null;

  shipRegions: ShipBox[] = [];

  attentionRegions: TitleBox[] = [];

  viewport = { width: 0, height: 0 };

  dpr = 1;

  frame: number | null = null;

  running = false;

  staticLayer: StaticLayer<R> | null = null;

  stars: Starfield | null = null;

  observer: ViewObserver<R> | null = null;

  fx = false;

  dirty = false;

  reported: ZoomLimits | null = null;

  workerIndex: Map<string, Worker> = new Map();

  signature = "";

  platformCounts: Map<string, number> = new Map();

  readiness: Map<string, Readiness> = new Map();

  watchers: (() => void)[] = [];

  status;

  packId;

  office: OfficeState<R> | null;

  stationArt;

  actors: ActorFrame[] = [];
  private settlementGeneration = 0;
  private settlements = new Set<string>();
  private onHelperSettled: UpdateOptions["onHelperSettled"];
  clearSettlements() {
    this.settlementGeneration++;
    this.settlements.clear();
    this.onHelperSettled = undefined;
  }
  dispatchSettlements() {
    const generation = this.settlementGeneration;
    const callback = this.onHelperSettled;
    for (const actor of this.actors) {
      if (!actor.settled) continue;
      const phase = actor.settled,
        id = actor.id,
        key = JSON.stringify([id, phase]);
      if (this.settlements.has(key)) continue;
      this.settlements.add(key);
      void Promise.resolve().then(() => {
        if (this.running && generation === this.settlementGeneration) callback?.(id, phase);
      });
    }
  }

  clock;

  STAR_TINTS: ThemeSceneColor[] = [
    "star-cool",
    "star-white",
    "star-blue",
    "star-warm",
    "star-teal",
  ];

  plainStars: PlainStar[] | null = null;

  RAIN_GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789Z:・"*+-<>¦|╌≡ЖλΣΨ';

  RAIN_COL = 16;

  RAIN_ROW = 15;

  pixies: Pixie[] | null = null;

  visibleArea: { left: number; top: number; right: number; bottom: number } | null = null;

  update = (next: SceneGeometry, options: UpdateOptions = {}) => {
    this.badgeRegions = [];
    this.canvas.title = "";
    this.clearSettlements();
    this.onHelperSettled = options.onHelperSettled;
    const revised = !this.scene || this.activeScene.revision !== next.revision;
    this.scene = next;
    this.indexWorkers();
    this.cameraControl.measure();
    this.setUpdateOptions(options);
    this.indexRepositories();
    this.movement.reconcile(this.activeScene, {
      now: this.clock(),
      stale: this.workerStale,
      reduced: this.callbacks.reducedMotion(),
    });
    this.reconcileSelection();
    if (revised) this.cameraControl.reframe();
    this.lifecycle.invalidate();
  };
  private indexWorkers() {
    this.workerIndex = new Map(this.activeScene.workers.map((worker) => [worker.id, worker]));
    this.signature = statusSignature(this.activeScene);
    this.platformCounts = new Map();
    for (const worker of this.activeScene.workers)
      this.platformCounts.set(
        worker.platformKey,
        (this.platformCounts.get(worker.platformKey) || 0) + 1,
      );
  }
  private setUpdateOptions(options: UpdateOptions) {
    if (typeof options.stale === "function") this.stale = options.stale;
    if (typeof options.rowStale === "function") this.rowStale = options.rowStale;
    if (typeof options.mailFrame === "function") this.mailFrame = options.mailFrame;
    if (typeof options.inspected === "function") this.inspected = options.inspected;
    if (typeof options.repositorySelection === "function")
      this.repositorySelection = options.repositorySelection;
    if (typeof options.onRepositoryToggle === "function")
      this.onRepositoryToggle = options.onRepositoryToggle;
  }
  private indexRepositories() {
    // A section sign names a repository only when a worker on the floor carries that exact repository id.
    this.repositories = new Set(
      this.activeScene.workers
        .map((worker) => worker.row.repoId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    );
  }
  private reconcileSelection() {
    for (const id of this.bodies.keys())
      if (!this.activeScene.workers.some((worker) => worker.id === id)) this.bodies.delete(id);
    if (this.focused && !this.activeScene.workers.some((worker) => worker.id === this.focused)) {
      this.focused = null;
      if (this.mode === "focus") this.cameraControl.setMode("overview");
    }
    if (
      this.mode === "platform" &&
      !this.activeScene.platforms.some((value) => value.key === this.platform)
    )
      this.cameraControl.setMode("overview");
  }
  cameraControl: CameraControl<R, B> = new CameraControl(this);
  lifecycle: Lifecycle<R, B> = new Lifecycle(this);
  resources: Resources<R, B> = new Resources(this);
  cache: Cache<R, B> = new Cache(this);
  starsPaint: StarsPaint<R, B> = new StarsPaint(this);
  space: Space<R, B> = new Space(this);
  effects: Effects<R, B> = new Effects(this);
  platformEffects: PlatformEffects<R, B> = new PlatformEffects(this);
  furnitureEffects: FurnitureEffects<R, B> = new FurnitureEffects(this);
  aura: Aura<R, B> = new Aura(this);
  crew: Crew<R, B> = new Crew(this);
  mail: Mail<R, B> = new Mail(this);
  plates: Plates<R, B> = new Plates(this);
  framePaint: FramePaint<R, B> = new FramePaint(this);
  interaction: Interaction<R, B> = new Interaction(this);
}
