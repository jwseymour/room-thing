import * as THREE from "three";
import { layoutQuote } from "../content/quote-layout";
import { rayToSurface, surfacePoint, type SurfaceFrame } from "../scan/frame";

/**
 * The room as geometry: flat planes, plain blocks and fine outlines, drawn
 * with three.js. Everything is in the room frame, in metres: origin at a
 * floor corner, Y up. The React screen around it decides what to show; this
 * only draws, moves the camera, and reports what was tapped or dragged.
 */

export type StageWall = {
  id: string;
  name: string;
  frame: SurfaceFrame;
  widthMm: number;
  heightMm: number;
  /** The wall's own colour, used when it's the one being worked on. */
  accent: string;
  /** A flat picture of the wall from the scan, if there is one. */
  imageUrl: string | null;
};

export type StageBlock = {
  id: string;
  label: string;
  /** Millimetres on the floor plan, as stored in the room. */
  x: number;
  y: number;
  w: number;
  d: number;
  bottom: number;
  top: number;
  color: string;
  open: boolean;
};

export type StageMark = {
  id: string;
  surfaceId: string;
  kind: "door" | "window" | "shelf" | "furniture" | "other";
  label: string;
  u: number;
  v: number;
  w: number;
  h: number;
};

export type StagePicture = {
  id: string;
  surfaceId: string;
  u: number;
  v: number;
  w: number;
  h: number;
  imageUrl: string | null;
  body: string | null;
  attribution: string | null;
  /** Already on the real wall, rather than only planned. */
  up: boolean;
};

export type StageRoom = {
  /** Floor corners in metres, clockwise from above. */
  corners: [number, number][];
  heightM: number;
  walls: StageWall[];
  blocks: StageBlock[];
  marks: StageMark[];
};

export type StageMode =
  | { type: "orbit" }
  | { type: "plan" }
  | { type: "wall"; surfaceId: string }
  | { type: "inside"; position: [number, number, number]; yawDeg: number; pitchDeg: number };

export type StagePick =
  | { type: "picture"; id: string }
  | { type: "block"; id: string }
  | { type: "wall"; surfaceId: string; u: number; v: number }
  | { type: "floor"; x: number; z: number }
  | null;

export type StageEvents = {
  onTap?: (pick: StagePick) => void;
  onPictureDrag?: (id: string, u: number, v: number) => void;
  onPictureDrop?: (id: string) => void;
  /** A block is being slid across the floor. Millimetres on the floor plan. */
  onBlockDrag?: (id: string, x: number, y: number) => void;
  onBlockDrop?: (id: string) => void;
  onScanProgress?: (fraction: number) => void;
  onScanState?: (state: "loading" | "ready" | "error") => void;
};

export type Palette = {
  floor: number;
  wall: number;
  ink: number;
  faint: number;
  haze: number;
  free: number;
  paper: string;
  text: string;
};

export const PALETTES: Record<"light" | "dark", Palette> = {
  light: {
    floor: 0xe9e6de, wall: 0xfaf9f5, ink: 0x1f2430, faint: 0xb9bcc4,
    haze: 0xf1efe9, free: 0x3d6fd9, paper: "#fffefb", text: "#1f2430",
  },
  dark: {
    floor: 0x1b1f29, wall: 0x262b37, ink: 0xe9e6de, faint: 0x4a5162,
    haze: 0x10131a, free: 0x7fa2f0, paper: "#f4f1ea", text: "#e9e6de",
  },
};

const FAR_VIEW_M = 30;
const TAP_SLOP_PX = 7;
const PROUD_M = 0.012;
const EYE_M = 1.5;

type V3 = [number, number, number];
type Pose = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  focus: THREE.Vector3;
  /** Height of the view at the focus, which sets the lens. */
  span: number;
  near: number;
  far: number;
};

export class RoomStage {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
  private roomGroup = new THREE.Group();
  private echoGroup = new THREE.Group();
  private blockGroup = new THREE.Group();
  private markGroup = new THREE.Group();
  private pictureGroup = new THREE.Group();
  private freeGroup = new THREE.Group();
  private labelGroup = new THREE.Group();
  private photoGroup = new THREE.Group();
  private scanGroup = new THREE.Group();
  private room: StageRoom = { corners: [], heightM: 2.4, walls: [], blocks: [], marks: [] };
  private pictures: StagePicture[] = [];
  private selected: string | null = null;
  private mode: StageMode = { type: "orbit" };
  private orbit = { yaw: -0.6, pitch: 0.72, zoom: 1 };
  private wallView = { zoom: 1, panU: 0, panV: 0 };
  private inside = { position: new THREE.Vector3(1, EYE_M, 1), yaw: 0, pitch: 0 };
  private tween: { from: Pose; start: number } | null = null;
  private showPhotos = true;
  private scan: { visible: boolean; loaded: boolean; dispose?: () => void } = { visible: false, loaded: false };
  private dirty = true;
  private frame = 0;
  private disposed = false;
  private resizer: ResizeObserver;
  private textures = new Map<string, THREE.Texture>();
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture:
    | { kind: "view"; x: number; y: number; moved: number }
    | { kind: "picture"; id: string; grabU: number; grabV: number; x: number; y: number; moved: number }
    | { kind: "block"; id: string; grabX: number; grabZ: number; x: number; y: number; moved: number }
    | { kind: "pinch"; span: number }
    | null = null;

  constructor(
    private container: HTMLElement,
    private events: StageEvents,
    private palette: Palette,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.touchAction = "none";
    container.appendChild(canvas);

    this.scene.fog = new THREE.Fog(palette.haze, 14, 46);
    this.scanGroup.matrixAutoUpdate = false;
    this.scanGroup.visible = false;
    this.scene.add(
      this.echoGroup, this.roomGroup, this.photoGroup, this.markGroup, this.blockGroup,
      this.freeGroup, this.pictureGroup, this.labelGroup, this.scanGroup,
    );

    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(container);
    this.resize();

    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.tick();
  }

  // ---------------------------------------------------------- what's shown

  setRoom(room: StageRoom) {
    const first = this.room.corners.length === 0;
    this.room = room;
    this.rebuildRoom();
    this.rebuildBlocks();
    this.rebuildMarks();
    this.rebuildPictures();
    this.rebuildLabels();
    if (first) {
      const c = this.centre();
      this.inside.position.set(c.x, EYE_M, c.z);
      this.orbit.yaw = this.openSide();
      this.applyPose(this.poseFor(this.mode));
    }
    this.requestRender();
  }

  /** Only the furniture changed, as while one is being dragged. */
  setBlocks(blocks: StageBlock[]) {
    this.room = { ...this.room, blocks };
    this.rebuildBlocks();
  }

  setMarks(marks: StageMark[]) {
    this.room = { ...this.room, marks };
    this.rebuildMarks();
    this.rebuildLabels();
  }

  setPictures(pictures: StagePicture[]) {
    this.pictures = pictures;
    this.rebuildPictures();
  }

  setSelected(id: string | null) {
    this.selected = id;
    this.rebuildPictures();
    this.rebuildBlocks();
  }

  /** Clear space to shade on each wall, and the best spaces to outline, in millimetres. */
  setFree(
    spaces: {
      surfaceId: string;
      region: { u: number; v: number; w: number; h: number }[];
      best: { u: number; v: number; w: number; h: number }[];
    }[],
  ) {
    clear(this.freeGroup);
    for (const space of spaces) {
      const wall = this.room.walls.find((w) => w.id === space.surfaceId);
      if (!wall) continue;
      const colour = new THREE.Color(wall.accent);
      for (const r of space.region) {
        const plane = flatRect(r.w / 1000, r.h / 1000, colour, 0.2);
        place(plane, wall.frame, r.u + r.w / 2, r.v + r.h / 2, PROUD_M * 0.6);
        this.freeGroup.add(plane);
      }
      for (const r of space.best) {
        const plane = flatRect(r.w / 1000, r.h / 1000, colour, 0);
        place(plane, wall.frame, r.u + r.w / 2, r.v + r.h / 2, PROUD_M * 0.7);
        this.freeGroup.add(outline(plane, colour, 1));
        plane.geometry.dispose();
      }
    }
    this.requestRender();
  }

  setPhotos(visible: boolean) {
    this.showPhotos = visible;
    this.photoGroup.visible = visible;
    this.requestRender();
  }

  setMode(mode: StageMode) {
    const from = this.currentPose();
    this.mode = mode;
    if (mode.type === "wall") this.wallView = { zoom: 1, panU: 0, panV: 0 };
    if (mode.type === "inside") {
      this.inside.position.set(...mode.position);
      this.inside.yaw = (mode.yawDeg * Math.PI) / 180;
      this.inside.pitch = (mode.pitchDeg * Math.PI) / 180;
    }
    this.tween = { from, start: performance.now() };
    this.rebuildLabels();
    this.rebuildBlocks();
    this.requestRender();
  }

  getInsidePose(): { position: V3; yawDeg: number; pitchDeg: number } {
    const p = this.inside.position;
    return {
      position: [p.x, p.y, p.z],
      yawDeg: (this.inside.yaw * 180) / Math.PI,
      pitchDeg: (this.inside.pitch * 180) / Math.PI,
    };
  }

  /**
   * Shows the scan itself inside the geometry, to check one against the
   * other. The scan viewer is large, so it's only fetched when asked for.
   */
  async setScan(visible: boolean, file?: { url: string; fileType: string; matrix: number[] }) {
    this.scan.visible = visible;
    this.scanGroup.visible = visible;
    this.rebuildRoom();
    this.rebuildBlocks();
    this.requestRender();
    if (!visible || this.scan.loaded || !file) return;
    this.scan.loaded = true;
    this.events.onScanState?.("loading");
    try {
      const { SparkRenderer, SplatMesh } = await import("@sparkjsdev/spark");
      if (this.disposed) return;
      const spark = new SparkRenderer({ renderer: this.renderer, onDirty: () => this.requestRender() });
      this.scene.add(spark);
      const splat = new SplatMesh({
        url: file.url,
        fileName: `scan.${file.fileType}`,
        withCredentials: true,
        onProgress: (event) => {
          if (event.lengthComputable) this.events.onScanProgress?.(event.loaded / event.total);
        },
      });
      this.scanGroup.matrix.fromArray(file.matrix);
      this.scanGroup.matrixWorldNeedsUpdate = true;
      this.scanGroup.add(splat);
      this.scan.dispose = () => splat.dispose();
      await splat.initialized;
      this.events.onScanState?.("ready");
      this.requestRender();
    } catch {
      this.scan.loaded = false;
      this.events.onScanState?.("error");
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizer.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.onDown);
    canvas.removeEventListener("pointermove", this.onMove);
    canvas.removeEventListener("pointerup", this.onUp);
    canvas.removeEventListener("pointercancel", this.onUp);
    canvas.removeEventListener("wheel", this.onWheel);
    for (const group of [
      this.roomGroup, this.echoGroup, this.blockGroup, this.markGroup,
      this.pictureGroup, this.freeGroup, this.labelGroup, this.photoGroup,
    ]) clear(group);
    for (const texture of this.textures.values()) texture.dispose();
    this.scan.dispose?.();
    this.renderer.dispose();
    canvas.remove();
  }

  // ---------------------------------------------------------------- camera

  /**
   * The direction to look in from, so that tall furniture isn't in the way:
   * from behind the wall with the lowest things against it, turned a little
   * towards whichever neighbouring wall is the more open of the two.
   */
  private openSide(): number {
    const { walls, blocks } = this.room;
    if (walls.length < 3) return -0.6;
    const tallest = walls.map((wall) => {
      const [ox, , oz] = wall.frame.origin;
      const n = wall.frame.normal;
      let top = 0;
      for (const b of blocks) {
        const cx = (b.x + b.w / 2) / 1000 - ox;
        const cz = (b.y + b.d / 2) / 1000 - oz;
        const away = cx * n[0] + cz * n[2] - Math.min(b.w, b.d) / 2000;
        if (away < 0.5) top = Math.max(top, b.top / 1000);
      }
      return top;
    });
    let best = 0;
    for (let i = 1; i < walls.length; i++) if (tallest[i] < tallest[best]) best = i;
    const count = walls.length;
    const before = tallest[(best + count - 1) % count];
    const after = tallest[(best + 1) % count];
    const out = walls[best].frame.normal;
    const along = walls[best].frame.right;
    // `right` runs towards the next wall round, so lean that way if it's the lower one.
    const lean = after <= before ? 0.55 : -0.55;
    return Math.atan2(-out[0] + along[0] * lean, -out[2] + along[2] * lean);
  }

  private centre() {
    const { corners, heightM } = this.room;
    if (!corners.length) return new THREE.Vector3(2, 1.2, 2);
    const xs = corners.map((c) => c[0]);
    const zs = corners.map((c) => c[1]);
    return new THREE.Vector3(
      (Math.min(...xs) + Math.max(...xs)) / 2,
      heightM / 2,
      (Math.min(...zs) + Math.max(...zs)) / 2,
    );
  }

  private size() {
    const { corners } = this.room;
    if (!corners.length) return { w: 4, d: 4 };
    const xs = corners.map((c) => c[0]);
    const zs = corners.map((c) => c[1]);
    return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) };
  }

  private aspect() {
    const { clientWidth: w, clientHeight: h } = this.container;
    return w && h ? w / h : 1;
  }

  private poseFor(mode: StageMode): Pose {
    const centre = this.centre();
    const { w, d } = this.size();
    const h = this.room.heightM;
    const aspect = this.aspect();
    // A camera, not a plain object: `lookAt` points a camera's back at the
    // target's opposite, and anything else's front at the target.
    const look = new THREE.Camera();
    look.rotation.order = "YXZ";

    if (mode.type === "wall") {
      const wall = this.room.walls.find((x) => x.id === mode.surfaceId);
      if (wall) {
        const ww = wall.widthMm / 1000;
        const wh = wall.heightMm / 1000;
        const margin = 0.3;
        const span = Math.max(wh + margin, (ww + margin) / aspect) / this.wallView.zoom;
        const focus = new THREE.Vector3(
          ...surfacePoint(wall.frame, wall.widthMm / 2 + this.wallView.panU, wall.heightMm / 2 + this.wallView.panV),
        );
        const n = wall.frame.normal;
        const position = new THREE.Vector3(focus.x + n[0] * FAR_VIEW_M, focus.y, focus.z + n[2] * FAR_VIEW_M);
        look.position.copy(position);
        look.lookAt(focus);
        // Shows the metre of room in front of the wall: the furniture against it.
        return { position, quaternion: look.quaternion.clone(), focus, span, near: FAR_VIEW_M - 1.1, far: FAR_VIEW_M + 0.6 };
      }
    }
    if (mode.type === "plan") {
      // Room for the wall names round the outside, and the controls over the view.
      const margin = aspect < 1 ? 1.1 : 1.7;
      const span = Math.max(d + margin, (w + margin) / aspect);
      const focus = new THREE.Vector3(centre.x, 0, centre.z);
      const position = new THREE.Vector3(centre.x, FAR_VIEW_M, centre.z);
      look.rotation.set(-Math.PI / 2, 0, 0);
      return { position, quaternion: look.quaternion.clone(), focus, span, near: 1, far: FAR_VIEW_M + 1 };
    }
    if (mode.type === "inside") {
      const position = this.inside.position.clone();
      look.rotation.set(this.inside.pitch, this.inside.yaw, 0);
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(look.quaternion);
      const lens = aspect < 1 ? 78 : 62;
      return {
        position,
        quaternion: look.quaternion.clone(),
        focus: position.clone().addScaledVector(forward, 2),
        span: 4 * Math.tan((lens * Math.PI) / 360),
        near: 0.05,
        far: 200,
      };
    }
    // Looking in from outside and above, like a model on a table.
    const reach = Math.max(w, d, h) * 1.15;
    const span = (reach * (aspect < 1 ? 1.25 / aspect : 1.15)) / this.orbit.zoom;
    const distance = span / (2 * Math.tan((30 * Math.PI) / 360));
    const focus = new THREE.Vector3(centre.x, h * 0.42, centre.z);
    const { yaw, pitch } = this.orbit;
    const position = new THREE.Vector3(
      focus.x + distance * Math.cos(pitch) * Math.sin(yaw),
      focus.y + distance * Math.sin(pitch),
      focus.z + distance * Math.cos(pitch) * Math.cos(yaw),
    );
    look.position.copy(position);
    look.lookAt(focus);
    return { position, quaternion: look.quaternion.clone(), focus, span, near: 0.1, far: 200 };
  }

  private currentPose(): Pose {
    const cam = this.camera;
    const focus = this.lastFocus.clone();
    const distance = cam.position.distanceTo(focus);
    return {
      position: cam.position.clone(),
      quaternion: cam.quaternion.clone(),
      focus,
      span: 2 * distance * Math.tan((cam.fov * Math.PI) / 360),
      near: cam.near,
      far: cam.far,
    };
  }

  private lastFocus = new THREE.Vector3();

  private applyPose(pose: Pose) {
    const cam = this.camera;
    cam.aspect = this.aspect();
    cam.position.copy(pose.position);
    cam.quaternion.copy(pose.quaternion);
    const distance = Math.max(0.01, pose.position.distanceTo(pose.focus));
    cam.fov = (2 * Math.atan(pose.span / 2 / distance) * 180) / Math.PI;
    cam.near = pose.near;
    cam.far = pose.far;
    cam.updateProjectionMatrix();
    this.lastFocus.copy(pose.focus);
    // The haze is for depth when looking at the model, not when working flat-on.
    const fog = this.scene.fog as THREE.Fog;
    fog.near = distance + 6;
    fog.far = distance + 34;
    this.requestRender();
  }

  private updateCamera() {
    const to = this.poseFor(this.mode);
    if (!this.tween) {
      this.applyPose(to);
      return;
    }
    const t = Math.min(1, (performance.now() - this.tween.start) / 650);
    const e = t * t * (3 - 2 * t);
    const from = this.tween.from;
    this.applyPose({
      position: from.position.clone().lerp(to.position, e),
      quaternion: from.quaternion.clone().slerp(to.quaternion, e),
      focus: from.focus.clone().lerp(to.focus, e),
      span: from.span + (to.span - from.span) * e,
      near: from.near + (to.near - from.near) * e,
      far: from.far + (to.far - from.far) * e,
    });
    if (t >= 1) this.tween = null;
  }

  private requestRender() {
    this.dirty = true;
  }

  private tick = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    if (this.tween) this.updateCamera();
    if (!this.dirty) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
  };

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.updateCamera();
  }

  // --------------------------------------------------------------- drawing

  private rebuildRoom() {
    clear(this.roomGroup);
    clear(this.echoGroup);
    clear(this.photoGroup);
    const { corners, heightM, walls } = this.room;
    if (corners.length < 3) return;
    const p = this.palette;
    const ghost = this.scan.visible;

    // The floor, with a half-metre grid to judge sizes by.
    const shape = new THREE.Shape(corners.map(([x, z]) => new THREE.Vector2(x, z)));
    const floor = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({ color: p.floor, side: THREE.DoubleSide, transparent: ghost, opacity: ghost ? 0.15 : 1 }),
    );
    floor.rotation.x = Math.PI / 2;
    floor.position.y = -0.002;
    this.roomGroup.add(floor);

    const grid: number[] = [];
    const xs = corners.map((c) => c[0]);
    const zs = corners.map((c) => c[1]);
    const clip = (a: [number, number], b: [number, number]) => {
      // Keep the part of a line that lies inside the floor's outline.
      let t0 = 0, t1 = 1;
      for (let i = 0; i < corners.length; i++) {
        const c = corners[i];
        const n = corners[(i + 1) % corners.length];
        const nx = -(n[1] - c[1]), nz = n[0] - c[0];
        const da = (a[0] - c[0]) * nx + (a[1] - c[1]) * nz;
        const db = (b[0] - c[0]) * nx + (b[1] - c[1]) * nz;
        if (da < 0 && db < 0) return;
        if (da < 0) t0 = Math.max(t0, da / (da - db));
        else if (db < 0) t1 = Math.min(t1, da / (da - db));
      }
      if (t1 <= t0) return;
      grid.push(
        a[0] + (b[0] - a[0]) * t0, 0, a[1] + (b[1] - a[1]) * t0,
        a[0] + (b[0] - a[0]) * t1, 0, a[1] + (b[1] - a[1]) * t1,
      );
    };
    for (let x = Math.ceil(Math.min(...xs) * 2) / 2; x <= Math.max(...xs); x += 0.5) {
      clip([x, Math.min(...zs)], [x, Math.max(...zs)]);
    }
    for (let z = Math.ceil(Math.min(...zs) * 2) / 2; z <= Math.max(...zs); z += 0.5) {
      clip([Math.min(...xs), z], [Math.max(...xs), z]);
    }
    this.roomGroup.add(lines(grid, p.faint, 0.55));

    // Walls face into the room only, so from outside you look straight in.
    for (const wall of walls) {
      const w = wall.widthMm / 1000;
      const h = wall.heightMm / 1000;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: p.wall, transparent: ghost, opacity: ghost ? 0.08 : 1 }),
      );
      place(plane, wall.frame, wall.widthMm / 2, wall.heightMm / 2, 0);
      this.roomGroup.add(plane);

      if (wall.imageUrl) {
        const texture = this.texture(wall.imageUrl);
        const photo = new THREE.Mesh(
          new THREE.PlaneGeometry(w, h),
          new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.92, toneMapped: false }),
        );
        place(photo, wall.frame, wall.widthMm / 2, wall.heightMm / 2, 0.003);
        this.photoGroup.add(photo);
      }
    }
    this.photoGroup.visible = this.showPhotos && !ghost;

    // The frame of the room: floor, top, and each corner.
    const frame: number[] = [];
    corners.forEach(([x, z], i) => {
      const [nx, nz] = corners[(i + 1) % corners.length];
      frame.push(x, 0, z, nx, 0, nz, x, heightM, z, nx, heightM, nz, x, 0, z, x, heightM, z);
    });
    this.roomGroup.add(lines(frame, p.ink, 1));

    // The same frame, echoed out into the haze.
    const { w, d } = this.size();
    const stepX = w + 1.6;
    const stepZ = d + 1.6;
    const echo: number[] = [];
    for (let i = -4; i <= 4; i++) {
      for (let k = -4; k <= 4; k++) {
        if (!i && !k) continue;
        for (let s = 0; s < frame.length; s += 3) echo.push(frame[s] + i * stepX, frame[s + 1], frame[s + 2] + k * stepZ);
      }
    }
    this.echoGroup.add(lines(echo, p.faint, 0.5));
  }

  private rebuildBlocks() {
    clear(this.blockGroup);
    const p = this.palette;
    const ghost = this.scan.visible;
    const flat = this.mode.type === "plan";
    for (const b of this.room.blocks) {
      const w = b.w / 1000, d = b.d / 1000;
      const bottom = b.bottom / 1000, top = b.top / 1000;
      const cx = b.x / 1000 + w / 2, cz = b.y / 1000 + d / 2;
      // The scan's colour, washed towards the wall colour: it says "bed" or
      // "wood" without turning the room back into a photograph.
      const tint = new THREE.Color(b.color).lerp(new THREE.Color(p.wall), 0.38);
      const selected = b.id === this.selected;
      const parts: { size: V3; at: V3 }[] = [];
      if (b.open && top - bottom > 0.2) {
        const slab = 0.04, leg = 0.05;
        parts.push({ size: [w, slab, d], at: [cx, top - slab / 2, cz] });
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            parts.push({
              size: [leg, top - slab - bottom, leg],
              at: [cx + sx * (w / 2 - leg / 2), (bottom + top - slab) / 2, cz + sz * (d / 2 - leg / 2)],
            });
          }
        }
      } else {
        parts.push({ size: [w, top - bottom, d], at: [cx, (bottom + top) / 2, cz] });
      }
      for (const part of parts) {
        const geometry = new THREE.BoxGeometry(...part.size);
        // Each face its own flat tone, in place of lighting.
        const tones = [0.9, 0.9, 1.06, 0.7, 0.82, 0.82];
        const mesh = new THREE.Mesh(
          geometry,
          tones.map((tone) =>
            new THREE.MeshBasicMaterial({
              color: tint.clone().multiplyScalar(tone),
              transparent: ghost,
              opacity: ghost ? 0.1 : 1,
            }),
          ),
        );
        mesh.position.set(...part.at);
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry),
          new THREE.LineBasicMaterial({ color: selected ? new THREE.Color(0x3d6fd9) : p.ink }),
        );
        edges.position.copy(mesh.position);
        this.blockGroup.add(mesh, edges);
      }
      if (flat) {
        const label = makeLabel(b.label, p.text, 0.8);
        label.position.set(cx, top + 0.05, cz);
        scaleLabel(label, 0.12);
        this.blockGroup.add(label);
      }
    }
    this.requestRender();
  }

  private rebuildMarks() {
    clear(this.markGroup);
    const p = this.palette;
    const tones: Record<StageMark["kind"], number> = {
      door: 0xb98a5a, window: 0x9cc4e8, shelf: 0xc9b28f, furniture: 0x8d93a3, other: 0x8d93a3,
    };
    for (const mark of this.room.marks) {
      const wall = this.room.walls.find((w) => w.id === mark.surfaceId);
      if (!wall) continue;
      const colour = new THREE.Color(tones[mark.kind]);
      const plane = flatRect(mark.w / 1000, mark.h / 1000, colour, mark.kind === "window" ? 0.4 : 0.22);
      place(plane, wall.frame, mark.u + mark.w / 2, mark.v + mark.h / 2, 0.006);
      this.markGroup.add(plane, outline(plane, new THREE.Color(p.ink), 0.75));
      if (mark.kind === "door" || mark.kind === "window") {
        // The architect's shorthand: a diagonal for a door, a cross for a window.
        const hw = mark.w / 2000, hh = mark.h / 2000;
        const cross = mark.kind === "window"
          ? [-hw, -hh, 0, hw, hh, 0, -hw, hh, 0, hw, -hh, 0]
          : [-hw, -hh, 0, hw, hh, 0];
        const stroke = lines(cross, p.ink, 0.35);
        stroke.position.copy(plane.position);
        stroke.rotation.copy(plane.rotation);
        this.markGroup.add(stroke);
      }
    }
    this.requestRender();
  }

  private rebuildPictures() {
    clear(this.pictureGroup);
    const p = this.palette;
    for (const pic of this.pictures) {
      const wall = this.room.walls.find((w) => w.id === pic.surfaceId);
      if (!wall) continue;
      const w = pic.w / 1000, h = pic.h / 1000;
      const texture = this.pictureTexture(pic);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({
          map: texture, color: 0xffffff, toneMapped: false,
          // Planned things are a little faded until they're really up.
          transparent: !pic.up, opacity: pic.up ? 1 : 0.82,
        }),
      );
      place(mesh, wall.frame, pic.u + pic.w / 2, pic.v + pic.h / 2, PROUD_M);
      this.pictureGroup.add(mesh);
      const selected = pic.id === this.selected;
      const edge = outline(mesh, selected ? new THREE.Color(wall.accent) : new THREE.Color(p.ink), 1);
      this.pictureGroup.add(edge);
      if (selected) {
        const halo = flatRect(w + 0.05, h + 0.05, new THREE.Color(wall.accent), 0.35);
        place(halo, wall.frame, pic.u + pic.w / 2, pic.v + pic.h / 2, PROUD_M * 0.8);
        this.pictureGroup.add(halo);
      }
    }
    this.requestRender();
  }

  private rebuildLabels() {
    clear(this.labelGroup);
    const p = this.palette;
    const mode = this.mode;
    if (mode.type === "orbit" || mode.type === "plan") {
      for (const wall of this.room.walls) {
        const metres = (wall.widthMm / 1000).toFixed(2);
        const label = makeLabel(`${wall.name}  ${metres} m`, wall.accent, 1);
        const at = surfacePoint(wall.frame, wall.widthMm / 2, 0, -0.22);
        label.position.set(at[0], mode.type === "plan" ? this.room.heightM + 0.1 : 0.02, at[2]);
        scaleLabel(label, 0.12);
        this.labelGroup.add(label);
      }
    }
    if (mode.type === "wall") {
      for (const mark of this.room.marks) {
        if (mark.surfaceId !== mode.surfaceId || !mark.label || mark.w < 250) continue;
        const wall = this.room.walls.find((w) => w.id === mark.surfaceId)!;
        const label = makeLabel(mark.label, p.text, 0.75);
        const at = surfacePoint(wall.frame, mark.u + mark.w / 2, mark.v + mark.h / 2, 0.03);
        label.position.set(...at);
        scaleLabel(label, Math.min(0.085, (mark.w / 1000 / label.userData.aspect) * 0.9));
        this.labelGroup.add(label);
      }
    }
    this.requestRender();
  }

  private texture(url: string): THREE.Texture {
    const cached = this.textures.get(url);
    if (cached) return cached;
    const texture = new THREE.TextureLoader().load(url, () => this.requestRender());
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    this.textures.set(url, texture);
    return texture;
  }

  private pictureTexture(pic: StagePicture): THREE.Texture {
    if (!pic.imageUrl) {
      const key = `quote|${pic.body}|${pic.attribution}|${pic.w}x${pic.h}`;
      const cached = this.textures.get(key);
      if (cached) return cached;
      const texture = new THREE.CanvasTexture(drawQuote(pic, this.palette.paper));
      texture.colorSpace = THREE.SRGBColorSpace;
      this.textures.set(key, texture);
      return texture;
    }
    const key = `${pic.imageUrl}|${pic.w}x${pic.h}`;
    const cached = this.textures.get(key);
    if (cached) return cached;
    const texture = new THREE.TextureLoader().load(pic.imageUrl, (loaded) => {
      // Crop to fill, the same way a print is cropped.
      const image = loaded.image as { width: number; height: number };
      const imageAspect = image.width / image.height;
      const aspect = pic.w / pic.h;
      if (imageAspect > aspect) loaded.repeat.set(aspect / imageAspect, 1);
      else loaded.repeat.set(1, imageAspect / aspect);
      loaded.offset.set((1 - loaded.repeat.x) / 2, (1 - loaded.repeat.y) / 2);
      this.requestRender();
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    this.textures.set(key, texture);
    return texture;
  }

  // ------------------------------------------------- pointing and dragging

  private ray(clientX: number, clientY: number): { origin: V3; direction: V3 } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    this.camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, this.camera);
    const { origin, direction } = raycaster.ray;
    return { origin: [origin.x, origin.y, origin.z], direction: [direction.x, direction.y, direction.z] };
  }

  pick(clientX: number, clientY: number): StagePick {
    const { origin, direction } = this.ray(clientX, clientY);
    let best: { distance: number; pick: StagePick } | null = null;
    const offer = (distance: number, pick: StagePick) => {
      if (distance > 0 && (!best || distance < best.distance)) best = { distance, pick };
    };
    // Flat-on to a wall, only that wall and what's on it can be picked.
    const only = this.mode.type === "wall" ? this.mode.surfaceId : null;

    for (const wall of this.room.walls) {
      if (only && wall.id !== only) continue;
      const hit = rayToSurface(wall.frame, origin, direction);
      if (!hit || hit.u < 0 || hit.u > wall.widthMm || hit.v < 0 || hit.v > wall.heightMm) continue;
      const picture = [...this.pictures].reverse().find(
        (p) => p.surfaceId === wall.id && hit.u >= p.u && hit.u <= p.u + p.w && hit.v >= p.v && hit.v <= p.v + p.h,
      );
      // A hair nearer than the wall, so a picture wins over what it hangs on.
      if (picture) offer(hit.distance - 0.02, { type: "picture", id: picture.id });
      else offer(hit.distance, { type: "wall", surfaceId: wall.id, u: hit.u, v: hit.v });
    }
    if (!only) {
      for (const b of this.room.blocks) {
        const lo: V3 = [b.x / 1000, b.bottom / 1000, b.y / 1000];
        const hi: V3 = [(b.x + b.w) / 1000, b.top / 1000, (b.y + b.d) / 1000];
        let near = -Infinity, far = Infinity;
        for (let a = 0; a < 3; a++) {
          const inv = 1 / direction[a];
          const t0 = (lo[a] - origin[a]) * inv;
          const t1 = (hi[a] - origin[a]) * inv;
          near = Math.max(near, Math.min(t0, t1));
          far = Math.min(far, Math.max(t0, t1));
        }
        if (near <= far) offer(near, { type: "block", id: b.id });
      }
      if (direction[1] < -1e-6) {
        const distance = -origin[1] / direction[1];
        offer(distance, { type: "floor", x: origin[0] + direction[0] * distance, z: origin[2] + direction[2] * distance });
      }
    }
    return (best as { distance: number; pick: StagePick } | null)?.pick ?? null;
  }

  private onWall(surfaceId: string, clientX: number, clientY: number) {
    const wall = this.room.walls.find((x) => x.id === surfaceId);
    if (!wall) return null;
    const { origin, direction } = this.ray(clientX, clientY);
    return rayToSurface(wall.frame, origin, direction);
  }

  private onFloor(clientX: number, clientY: number, height: number) {
    const { origin, direction } = this.ray(clientX, clientY);
    if (Math.abs(direction[1]) < 1e-6) return null;
    const distance = (height - origin[1]) / direction[1];
    if (distance <= 0) return null;
    return { x: origin[0] + direction[0] * distance, z: origin[2] + direction[2] * distance };
  }

  private onDown = (event: PointerEvent) => {
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.gesture = { kind: "pinch", span: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    const base = { x: event.clientX, y: event.clientY, moved: 0 };
    const pick = this.pick(event.clientX, event.clientY);
    if (pick?.type === "picture") {
      const picture = this.pictures.find((p) => p.id === pick.id)!;
      const hit = this.onWall(picture.surfaceId, event.clientX, event.clientY);
      this.gesture = {
        kind: "picture", id: picture.id, ...base,
        grabU: (hit?.u ?? picture.u) - picture.u,
        grabV: (hit?.v ?? picture.v) - picture.v,
      };
      return;
    }
    // Furniture slides only in the plan view, where a drag can't mean "turn the room".
    if (pick?.type === "block" && this.mode.type === "plan") {
      const block = this.room.blocks.find((b) => b.id === pick.id)!;
      const at = this.onFloor(event.clientX, event.clientY, block.top / 1000);
      this.gesture = {
        kind: "block", id: block.id, ...base,
        grabX: (at?.x ?? 0) * 1000 - block.x,
        grabZ: (at?.z ?? 0) * 1000 - block.y,
      };
      return;
    }
    this.gesture = { kind: "view", ...base };
  };

  private onMove = (event: PointerEvent) => {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const g = this.gesture;
    if (!g) return;
    if (g.kind === "pinch") {
      if (this.pointers.size !== 2) return;
      const [a, b] = [...this.pointers.values()];
      const span = Math.hypot(a.x - b.x, a.y - b.y);
      this.zoom(span / g.span);
      g.span = span;
      return;
    }
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    g.moved += Math.hypot(dx, dy);
    g.x = event.clientX;
    g.y = event.clientY;
    if (g.moved < TAP_SLOP_PX) return;

    if (g.kind === "picture") {
      const picture = this.pictures.find((p) => p.id === g.id);
      const hit = picture && this.onWall(picture.surfaceId, event.clientX, event.clientY);
      if (hit) this.events.onPictureDrag?.(g.id, hit.u - g.grabU, hit.v - g.grabV);
      return;
    }
    if (g.kind === "block") {
      const block = this.room.blocks.find((b) => b.id === g.id);
      const at = block && this.onFloor(event.clientX, event.clientY, block.top / 1000);
      if (at) this.events.onBlockDrag?.(g.id, at.x * 1000 - g.grabX, at.z * 1000 - g.grabZ);
      return;
    }
    this.tween = null;
    const mode = this.mode;
    if (mode.type === "orbit") {
      this.orbit.yaw -= dx * 0.008;
      this.orbit.pitch = Math.min(1.5, Math.max(0.08, this.orbit.pitch + dy * 0.006));
    } else if (mode.type === "inside") {
      const perPixel = ((this.camera.fov * Math.PI) / 180) / this.container.clientHeight;
      this.inside.yaw += dx * perPixel;
      this.inside.pitch = Math.min(1.3, Math.max(-1.3, this.inside.pitch + dy * perPixel));
    } else if (mode.type === "wall") {
      const wall = this.room.walls.find((w) => w.id === mode.surfaceId);
      if (wall && this.wallView.zoom > 1) {
        const perPixel = (this.poseFor(mode).span / this.container.clientHeight) * 1000;
        const limitU = (wall.widthMm / 2) * (1 - 1 / this.wallView.zoom);
        const limitV = (wall.heightMm / 2) * (1 - 1 / this.wallView.zoom);
        this.wallView.panU = clamp(this.wallView.panU - dx * perPixel, -limitU, limitU);
        this.wallView.panV = clamp(this.wallView.panV + dy * perPixel, -limitV, limitV);
      }
    }
    this.updateCamera();
  };

  private onUp = (event: PointerEvent) => {
    if (!this.pointers.delete(event.pointerId)) return;
    const g = this.gesture;
    if (this.pointers.size > 0) {
      const [rest] = [...this.pointers.values()];
      this.gesture = { kind: "view", x: rest.x, y: rest.y, moved: TAP_SLOP_PX };
      return;
    }
    this.gesture = null;
    if (!g || g.kind === "pinch") return;
    if (g.moved < TAP_SLOP_PX) {
      const pick = this.pick(event.clientX, event.clientY);
      if (pick?.type === "floor" && this.mode.type === "inside") {
        this.inside.position.set(pick.x, this.inside.position.y, pick.z);
        this.tween = { from: this.currentPose(), start: performance.now() };
      }
      this.events.onTap?.(pick);
    } else if (g.kind === "picture") {
      this.events.onPictureDrop?.(g.id);
    } else if (g.kind === "block") {
      this.events.onBlockDrop?.(g.id);
    }
  };

  private zoom(factor: number) {
    this.tween = null;
    if (this.mode.type === "wall") {
      this.wallView.zoom = clamp(this.wallView.zoom * factor, 1, 6);
      if (this.wallView.zoom === 1) this.wallView.panU = this.wallView.panV = 0;
    } else if (this.mode.type === "orbit") {
      this.orbit.zoom = clamp(this.orbit.zoom * factor, 0.5, 4);
    } else if (this.mode.type === "inside") {
      const step = (factor - 1) * 1.5;
      this.inside.position.x -= Math.sin(this.inside.yaw) * step;
      this.inside.position.z -= Math.cos(this.inside.yaw) * step;
    }
    this.updateCamera();
  }

  private onWheel = (event: WheelEvent) => {
    if (this.mode.type === "plan") return;
    event.preventDefault();
    this.zoom(Math.exp(-event.deltaY * 0.0015));
  };
}

// ---------------------------------------------------------------- helpers

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function clear(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      // Label sprites own their texture; pictures share theirs through a cache.
      if (child instanceof THREE.Sprite) (material as THREE.SpriteMaterial).map?.dispose();
      material.dispose();
    }
  }
}

/** Puts a flat object on a wall, centred at `u`, `v` millimetres, facing the room. */
function place(object: THREE.Object3D, frame: SurfaceFrame, uMm: number, vMm: number, proudM: number) {
  object.position.set(...surfacePoint(frame, uMm, vMm, proudM));
  object.rotation.y = Math.atan2(frame.normal[0], frame.normal[2]);
}

function flatRect(w: number, h: number, colour: THREE.Color, opacity: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false }),
  );
}

function outline(mesh: THREE.Mesh, colour: THREE.Color, opacity: number): THREE.LineSegments {
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color: colour, transparent: opacity < 1, opacity }),
  );
  edge.position.copy(mesh.position);
  edge.rotation.copy(mesh.rotation);
  return edge;
}

function lines(points: number[], colour: number, opacity: number): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: colour, transparent: opacity < 1, opacity }),
  );
}

function makeLabel(text: string, colour: string, opacity: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  const shown = text.toUpperCase();
  const font = '500 40px "Avenir Next", "Century Gothic", Futura, system-ui, sans-serif';
  context.font = font;
  const spacing = 5;
  const width = [...shown].reduce((sum, ch) => sum + context.measureText(ch).width + spacing, 0);
  canvas.width = Math.ceil(width) + 16;
  canvas.height = 60;
  context.font = font;
  context.fillStyle = colour;
  context.textBaseline = "middle";
  let x = 8;
  for (const ch of shown) {
    context.fillText(ch, x, canvas.height / 2 + 2);
    x += context.measureText(ch).width + spacing;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, opacity, fog: false }),
  );
  sprite.renderOrder = 12;
  sprite.userData.aspect = canvas.width / canvas.height;
  return sprite;
}

function scaleLabel(sprite: THREE.Sprite, height: number) {
  sprite.scale.set(height * sprite.userData.aspect, height, 1);
}

/** A quote drawn with the same layout as the print file. */
function drawQuote(p: StagePicture, paper: string): HTMLCanvasElement {
  const pxPerMm = Math.min(6, 1400 / Math.max(p.w, p.h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(p.w * pxPerMm);
  canvas.height = Math.round(p.h * pxPerMm);
  const context = canvas.getContext("2d")!;
  context.fillStyle = paper;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const layout = layoutQuote(p.body ?? "", p.attribution, p.w, p.h);
  context.textAlign = "center";
  context.fillStyle = "#1f2430";
  context.font = `${layout.fontSizeMm * pxPerMm}px Georgia, serif`;
  layout.lines.forEach((line, i) => {
    context.fillText(line, canvas.width / 2, (layout.firstBaselineMm + i * layout.lineHeightMm) * pxPerMm);
  });
  if (layout.attribution) {
    context.fillStyle = "#5c6170";
    context.font = `${layout.attribution.fontSizeMm * pxPerMm}px Georgia, serif`;
    context.fillText(layout.attribution.text, canvas.width / 2, layout.attribution.baselineMm * pxPerMm);
  }
  return canvas;
}
