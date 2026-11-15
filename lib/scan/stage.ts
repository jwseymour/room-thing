import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import * as THREE from "three";
import { layoutQuote } from "../content/quote-layout";
import { rayToSurface, surfacePoint, type SurfaceFrame } from "./frame";

/**
 * The 3D room: the scan, the room's measured outline, and the pictures on its
 * walls. Plain three.js, driven by the React screens around it. Everything is
 * in the room frame, in metres: origin at a floor corner, Y up.
 */

export type StageSurface = {
  id: string;
  name: string;
  frame: SurfaceFrame;
  widthMm: number;
  heightMm: number;
};

export type StagePicture = {
  id: string;
  surfaceId: string;
  /** Bottom-left corner on the surface, and size, in millimetres. */
  u: number;
  v: number;
  w: number;
  h: number;
  imageUrl: string | null;
  body: string | null;
  attribution: string | null;
};

export type StagePick =
  | { type: "picture"; id: string }
  | { type: "surface"; surfaceId: string; u: number; v: number }
  | { type: "floor"; x: number; z: number }
  | null;

export type StageView = "inside" | "above";

export type StageEvents = {
  onProgress?: (fraction: number) => void;
  onReady?: (splatCount: number) => void;
  onError?: (message: string) => void;
  onTap?: (pick: StagePick) => void;
  /** A picture is being dragged along its wall. Positions are in millimetres. */
  onPictureDrag?: (id: string, u: number, v: number) => void;
  onPictureDrop?: (id: string) => void;
};

const EYE_HEIGHT_M = 1.5;
const WALL_MARGIN_M = 0.25;
/** Pictures sit this far off the wall, clear of the scan's slightly fuzzy surface. */
const PROUD_M = 0.015;
/**
 * Flat views are taken from far away with a narrow lens, which is as good as a
 * true orthographic view. The near plane then slices off whatever is in the
 * way: the ceiling for the view from above, the rest of the room for a wall.
 */
const FAR_VIEW_M = 30;
const TAP_SLOP_PX = 7;

type V3 = [number, number, number];

export class RoomStage {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private spark: SparkRenderer;
  private camera = new THREE.PerspectiveCamera(70, 1, 0.05, 100);
  private scanGroup = new THREE.Group();
  private overlay = new THREE.Group();
  private pictureGroup = new THREE.Group();
  private splat: SplatMesh;
  private box = { w: 4, d: 4, h: 2.5 };
  private aligned = false;
  private surfaces: StageSurface[] = [];
  private pictures: StagePicture[] = [];
  private selectedId: string | null = null;
  private view: StageView = "inside";
  private yaw = 0;
  private pitch = 0;
  private position = new THREE.Vector3(2, EYE_HEIGHT_M, 2);
  private glide: { from: THREE.Vector3; to: THREE.Vector3; start: number } | null = null;
  private dirty = true;
  private frame = 0;
  private disposed = false;
  private resizer: ResizeObserver;
  private textures = new Map<string, THREE.Texture>();
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture:
    | { kind: "look"; x: number; y: number; moved: number }
    | { kind: "picture"; id: string; grabU: number; grabV: number; moved: number; x: number; y: number }
    | { kind: "pinch"; span: number }
    | null = null;

  constructor(
    private container: HTMLElement,
    file: { url: string; fileType: string },
    private events: StageEvents = {},
  ) {
    // Antialiasing does nothing for splats and costs a lot.
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    // Splats are limited by how many pixels they fill, so cap the resolution.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 2 : 1.25));
    this.renderer.setClearColor(0x15130f);
    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.touchAction = "none";
    container.appendChild(canvas);

    this.spark = new SparkRenderer({
      renderer: this.renderer,
      onDirty: () => this.requestRender(),
    });
    this.scene.add(this.spark);

    this.scanGroup.matrixAutoUpdate = false;
    this.scene.add(this.scanGroup, this.overlay, this.pictureGroup);

    this.splat = new SplatMesh({
      url: file.url,
      fileName: `scan.${file.fileType}`,
      withCredentials: true,
      onProgress: (event) => {
        if (event.lengthComputable) events.onProgress?.(event.loaded / event.total);
      },
    });
    this.scanGroup.add(this.splat);
    this.splat.initialized.then(
      () => {
        if (this.disposed) return;
        events.onReady?.(this.splat.splats?.getNumSplats() ?? 0);
        this.requestRender();
      },
      () => events.onError?.("This file couldn't be read as a scan."),
    );

    this.camera.rotation.order = "YXZ";
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

  // ---- what's shown

  /** Where the room is in the scan, and the room's size in metres. */
  setAlignment(matrix: number[] | null, box: { w: number; d: number; h: number }) {
    this.aligned = matrix !== null;
    this.box = box;
    if (matrix) this.scanGroup.matrix.fromArray(matrix);
    else this.scanGroup.matrix.identity();
    this.scanGroup.matrixWorldNeedsUpdate = true;
    if (!this.insideRoom(this.position)) {
      this.position.set(box.w / 2, EYE_HEIGHT_M, box.d / 2);
    }
    this.rebuildOverlay();
    this.applyCamera();
  }

  setSurfaces(surfaces: StageSurface[]) {
    this.surfaces = surfaces;
    this.rebuildOverlay();
  }

  setPictures(pictures: StagePicture[], selectedId: string | null) {
    this.pictures = pictures;
    this.selectedId = selectedId;
    this.rebuildPictures();
  }

  setView(view: StageView) {
    this.view = view;
    this.rebuildOverlay();
    this.applyCamera();
  }

  /** Stand somewhere and look a particular way. Position is in metres. */
  lookFrom(position: V3, yawDeg: number, pitchDeg: number) {
    this.view = "inside";
    this.position.set(...position);
    this.yaw = (yawDeg * Math.PI) / 180;
    this.pitch = (pitchDeg * Math.PI) / 180;
    this.rebuildOverlay();
    this.applyCamera();
  }

  /** Turn to face a surface from a comfortable distance. */
  faceSurface(surfaceId: string) {
    const s = this.surfaces.find((x) => x.id === surfaceId);
    if (!s) return;
    const centre = surfacePoint(s.frame, s.widthMm / 2, EYE_HEIGHT_M * 1000);
    const back = Math.min(2.2, Math.max(1, s.widthMm / 1000));
    const stand = new THREE.Vector3(
      centre[0] + s.frame.normal[0] * back,
      EYE_HEIGHT_M,
      centre[2] + s.frame.normal[2] * back,
    );
    this.clampToRoom(stand);
    this.position.copy(stand);
    this.yaw = Math.atan2(s.frame.normal[0], s.frame.normal[2]);
    this.pitch = 0;
    this.view = "inside";
    this.rebuildOverlay();
    this.applyCamera();
  }

  getPose(): { position: V3; yawDeg: number; pitchDeg: number } {
    return {
      position: [this.position.x, this.position.y, this.position.z],
      yawDeg: (this.yaw * 180) / Math.PI,
      pitchDeg: (this.pitch * 180) / Math.PI,
    };
  }

  /** Every splat's centre, in the scan's own coordinates, for finding the room. */
  async centres(): Promise<Float32Array> {
    await this.splat.initialized;
    const count = this.splat.splats?.getNumSplats() ?? 0;
    const out = new Float32Array(count * 3);
    this.splat.forEachSplat((index, centre) => {
      out[index * 3] = centre.x;
      out[index * 3 + 1] = centre.y;
      out[index * 3 + 2] = centre.z;
    });
    return out;
  }

  /**
   * A flat, head-on image of one wall and whatever stands within a metre of
   * it, for the 2D wall planner to draw behind the pictures.
   */
  async captureWall(surface: StageSurface, widthPx = 1600): Promise<Blob> {
    const w = surface.widthMm / 1000;
    const h = surface.heightMm / 1000;
    const centre = surfacePoint(surface.frame, surface.widthMm / 2, surface.heightMm / 2);
    const n = surface.frame.normal;
    const camera = new THREE.PerspectiveCamera(
      (2 * Math.atan(h / 2 / FAR_VIEW_M) * 180) / Math.PI,
      w / h,
      FAR_VIEW_M - 1,
      FAR_VIEW_M + 0.4,
    );
    camera.position.set(
      centre[0] + n[0] * FAR_VIEW_M,
      centre[1],
      centre[2] + n[2] * FAR_VIEW_M,
    );
    camera.lookAt(centre[0], centre[1], centre[2]);
    camera.updateMatrixWorld();

    const size = this.renderer.getSize(new THREE.Vector2());
    const ratio = this.renderer.getPixelRatio();
    this.overlay.visible = false;
    this.pictureGroup.visible = false;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(widthPx, Math.round((widthPx * h) / w), false);
    try {
      // Splats are sorted for a camera in the background; wait for that.
      this.renderer.render(this.scene, camera);
      await this.spark.update({ scene: this.scene, camera });
      this.renderer.render(this.scene, camera);
      return await new Promise<Blob>((resolve, reject) =>
        this.renderer.domElement.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("No image"))),
          "image/png",
        ),
      );
    } finally {
      this.overlay.visible = true;
      this.pictureGroup.visible = true;
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(size.x, size.y, false);
      this.applyCamera();
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
    for (const texture of this.textures.values()) texture.dispose();
    this.splat.dispose();
    this.renderer.dispose();
    canvas.remove();
  }

  // ---- drawing

  private requestRender() {
    this.dirty = true;
  }

  private tick = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    if (this.glide) {
      const t = Math.min(1, (performance.now() - this.glide.start) / 450);
      const eased = t * t * (3 - 2 * t);
      this.position.lerpVectors(this.glide.from, this.glide.to, eased);
      if (t >= 1) this.glide = null;
      this.applyCamera();
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
  };

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.applyCamera();
  }

  private applyCamera() {
    const { clientWidth: w, clientHeight: h } = this.container;
    const aspect = w && h ? w / h : 1;
    const cam = this.camera;
    cam.aspect = aspect;
    if (this.view === "above") {
      // Fit the whole floor, with a margin, into the canvas.
      const margin = 0.35;
      const needH = Math.max(this.box.d + margin * 2, (this.box.w + margin * 2) / aspect);
      cam.fov = (2 * Math.atan(needH / 2 / FAR_VIEW_M) * 180) / Math.PI;
      // Start just under the ceiling, so the ceiling itself is cut away.
      const cut = Math.min(0.35, this.box.h * 0.15);
      cam.near = FAR_VIEW_M + cut;
      cam.far = FAR_VIEW_M + this.box.h + 0.5;
      cam.position.set(this.box.w / 2, this.box.h + FAR_VIEW_M, this.box.d / 2);
      cam.rotation.set(-Math.PI / 2, 0, 0);
    } else {
      // A wider lens on a tall phone screen, so a wall fits in view.
      cam.fov = aspect < 1 ? 78 : 62;
      cam.near = 0.05;
      cam.far = 100;
      cam.position.copy(this.position);
      cam.rotation.set(this.pitch, this.yaw, 0);
    }
    cam.updateProjectionMatrix();
    this.requestRender();
  }

  private rebuildOverlay() {
    for (const child of [...this.overlay.children]) {
      this.overlay.remove(child);
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | undefined;
      (material as THREE.SpriteMaterial | undefined)?.map?.dispose();
      material?.dispose();
    }
    if (!this.aligned) return;

    // The room's outline. From above it's the main thing to check against.
    const { w, d, h } = this.box;
    const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d));
    geometry.translate(w / 2, h / 2, d / 2);
    const outline = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: 0x8cc0ad, depthTest: false, transparent: true, opacity: this.view === "above" ? 1 : 0.35 }),
    );
    outline.renderOrder = 10;
    this.overlay.add(outline);

    for (const s of this.surfaces) {
      const label = makeLabel(s.name);
      const at =
        this.view === "above"
          ? surfacePoint(s.frame, s.widthMm / 2, s.heightMm, 0.28)
          : surfacePoint(s.frame, s.widthMm / 2, s.heightMm - 120, 0.03);
      label.position.set(at[0], this.view === "above" ? this.box.h : at[1], at[2]);
      const scale = this.view === "above" ? 0.42 : 0.13;
      label.scale.set(scale * label.userData.aspect, scale, 1);
      this.overlay.add(label);
    }
    this.requestRender();
  }

  private rebuildPictures() {
    for (const child of [...this.pictureGroup.children]) {
      this.pictureGroup.remove(child);
      const mesh = child as THREE.Mesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    for (const p of this.pictures) {
      const s = this.surfaces.find((x) => x.id === p.surfaceId);
      if (!s) continue;
      const w = p.w / 1000;
      const h = p.h / 1000;
      const texture = this.textureFor(p);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: texture, color: texture ? 0xffffff : 0xd8d2c6, toneMapped: false }),
      );
      const centre = surfacePoint(s.frame, p.u + p.w / 2, p.v + p.h / 2, PROUD_M);
      mesh.position.set(...centre);
      // The plane's front faces along the wall's normal, into the room.
      mesh.rotation.y = Math.atan2(s.frame.normal[0], s.frame.normal[2]);
      this.pictureGroup.add(mesh);

      if (p.id === this.selectedId) {
        const edge = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.PlaneGeometry(w + 0.012, h + 0.012)),
          new THREE.LineBasicMaterial({ color: 0x8cc0ad, depthTest: false }),
        );
        edge.position.copy(mesh.position);
        edge.rotation.copy(mesh.rotation);
        edge.renderOrder = 11;
        this.pictureGroup.add(edge);
      }
    }
    this.requestRender();
  }

  private textureFor(p: StagePicture): THREE.Texture | null {
    const key = p.imageUrl
      ? `${p.imageUrl}|${p.w}x${p.h}`
      : `quote|${p.body}|${p.attribution}|${p.w}x${p.h}`;
    const cached = this.textures.get(key);
    if (cached) return cached;

    let texture: THREE.Texture;
    if (p.imageUrl) {
      texture = new THREE.TextureLoader().load(p.imageUrl, (loaded) => {
        // Crop to fill the print, the same way the print file is cropped.
        const image = loaded.image as { width: number; height: number };
        const imageAspect = image.width / image.height;
        const printAspect = p.w / p.h;
        if (imageAspect > printAspect) {
          loaded.repeat.set(printAspect / imageAspect, 1);
        } else {
          loaded.repeat.set(1, imageAspect / printAspect);
        }
        loaded.offset.set((1 - loaded.repeat.x) / 2, (1 - loaded.repeat.y) / 2);
        this.requestRender();
      });
    } else {
      texture = new THREE.CanvasTexture(drawQuote(p));
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    this.textures.set(key, texture);
    return texture;
  }

  // ---- pointing and moving

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
    return {
      origin: [origin.x, origin.y, origin.z],
      direction: [direction.x, direction.y, direction.z],
    };
  }

  /** What's under a point on screen: a picture, a wall, or the floor. */
  pick(clientX: number, clientY: number): StagePick {
    if (!this.aligned) return null;
    const { origin, direction } = this.ray(clientX, clientY);
    let best: { distance: number; pick: StagePick } | null = null;
    for (const s of this.surfaces) {
      const hit = rayToSurface(s.frame, origin, direction);
      if (!hit) continue;
      if (hit.u < 0 || hit.u > s.widthMm || hit.v < 0 || hit.v > s.heightMm) continue;
      if (best && hit.distance >= best.distance) continue;
      const picture = this.pictures.find(
        (p) =>
          p.surfaceId === s.id &&
          hit.u >= p.u && hit.u <= p.u + p.w &&
          hit.v >= p.v && hit.v <= p.v + p.h,
      );
      best = {
        distance: hit.distance,
        pick: picture
          ? { type: "picture", id: picture.id }
          : { type: "surface", surfaceId: s.id, u: hit.u, v: hit.v },
      };
    }
    if (direction[1] < -1e-6) {
      const distance = -origin[1] / direction[1];
      const x = origin[0] + direction[0] * distance;
      const z = origin[2] + direction[2] * distance;
      const onFloor = x >= 0 && x <= this.box.w && z >= 0 && z <= this.box.d;
      if (onFloor && (!best || distance < best.distance)) {
        best = { distance, pick: { type: "floor", x, z } };
      }
    }
    return best?.pick ?? null;
  }

  private rayOnSurface(surfaceId: string, clientX: number, clientY: number) {
    const s = this.surfaces.find((x) => x.id === surfaceId);
    if (!s) return null;
    const { origin, direction } = this.ray(clientX, clientY);
    return rayToSurface(s.frame, origin, direction);
  }

  private insideRoom(p: THREE.Vector3) {
    return p.x > 0 && p.x < this.box.w && p.z > 0 && p.z < this.box.d;
  }

  private clampToRoom(p: THREE.Vector3) {
    if (!this.aligned) return;
    const m = Math.min(WALL_MARGIN_M, this.box.w / 4, this.box.d / 4);
    p.x = Math.min(Math.max(p.x, m), this.box.w - m);
    p.z = Math.min(Math.max(p.z, m), this.box.d - m);
  }

  private walk(metres: number) {
    const next = this.position.clone();
    next.x -= Math.sin(this.yaw) * metres;
    next.z -= Math.cos(this.yaw) * metres;
    this.clampToRoom(next);
    this.position.copy(next);
    this.glide = null;
    this.applyCamera();
  }

  private onDown = (event: PointerEvent) => {
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.gesture = { kind: "pinch", span: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    const pick = this.pick(event.clientX, event.clientY);
    if (pick?.type === "picture") {
      const picture = this.pictures.find((p) => p.id === pick.id)!;
      const hit = this.rayOnSurface(picture.surfaceId, event.clientX, event.clientY);
      this.gesture = {
        kind: "picture",
        id: picture.id,
        grabU: (hit?.u ?? picture.u) - picture.u,
        grabV: (hit?.v ?? picture.v) - picture.v,
        moved: 0,
        x: event.clientX,
        y: event.clientY,
      };
    } else {
      this.gesture = { kind: "look", x: event.clientX, y: event.clientY, moved: 0 };
    }
  };

  private onMove = (event: PointerEvent) => {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const g = this.gesture;
    if (!g) return;

    if (g.kind === "pinch" && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const span = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.view === "inside") this.walk((span - g.span) * 0.012);
      g.span = span;
      return;
    }
    if (g.kind === "picture") {
      g.moved += Math.hypot(event.clientX - g.x, event.clientY - g.y);
      g.x = event.clientX;
      g.y = event.clientY;
      if (g.moved < TAP_SLOP_PX) return;
      const picture = this.pictures.find((p) => p.id === g.id);
      const hit = picture && this.rayOnSurface(picture.surfaceId, event.clientX, event.clientY);
      if (hit) this.events.onPictureDrag?.(g.id, hit.u - g.grabU, hit.v - g.grabV);
      return;
    }
    if (g.kind === "look") {
      const dx = event.clientX - g.x;
      const dy = event.clientY - g.y;
      g.moved += Math.hypot(dx, dy);
      g.x = event.clientX;
      g.y = event.clientY;
      if (this.view !== "inside") return;
      // Drag the world, as on a phone's photo viewer: the scene follows the finger.
      const perPixel = ((this.camera.fov * Math.PI) / 180) / this.container.clientHeight;
      this.yaw += dx * perPixel;
      this.pitch = Math.min(1.3, Math.max(-1.3, this.pitch + dy * perPixel));
      this.applyCamera();
    }
  };

  private onUp = (event: PointerEvent) => {
    if (!this.pointers.delete(event.pointerId)) return;
    const g = this.gesture;
    if (this.pointers.size > 0) {
      // One finger of a pinch lifted: carry on as a look-around with the other.
      const [rest] = [...this.pointers.values()];
      this.gesture = { kind: "look", x: rest.x, y: rest.y, moved: TAP_SLOP_PX };
      return;
    }
    this.gesture = null;
    if (!g || g.kind === "pinch") return;
    if (g.moved < TAP_SLOP_PX) {
      const pick = this.pick(event.clientX, event.clientY);
      if (pick?.type === "floor" && this.view === "inside") {
        const to = new THREE.Vector3(pick.x, this.position.y, pick.z);
        this.clampToRoom(to);
        this.glide = { from: this.position.clone(), to, start: performance.now() };
      }
      this.events.onTap?.(pick);
    } else if (g.kind === "picture") {
      this.events.onPictureDrop?.(g.id);
    }
  };

  private onWheel = (event: WheelEvent) => {
    if (this.view !== "inside") return;
    event.preventDefault();
    this.walk(-event.deltaY * 0.002);
  };
}

function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  const font = "600 44px system-ui, sans-serif";
  context.font = font;
  canvas.width = Math.ceil(context.measureText(text).width) + 48;
  canvas.height = 72;
  context.font = font;
  context.fillStyle = "rgba(23, 21, 18, 0.72)";
  context.beginPath();
  context.roundRect(0, 0, canvas.width, canvas.height, 18);
  context.fill();
  context.fillStyle = "#f1ebe0";
  context.textBaseline = "middle";
  context.fillText(text, 24, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
  );
  sprite.renderOrder = 12;
  sprite.userData.aspect = canvas.width / canvas.height;
  return sprite;
}

/** A quote drawn with the same layout as the wall planner and the print file. */
function drawQuote(p: StagePicture): HTMLCanvasElement {
  const pxPerMm = Math.min(6, 1400 / Math.max(p.w, p.h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(p.w * pxPerMm);
  canvas.height = Math.round(p.h * pxPerMm);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fffdf9";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const layout = layoutQuote(p.body ?? "", p.attribution, p.w, p.h);
  context.textAlign = "center";
  context.fillStyle = "#211e1a";
  context.font = `${layout.fontSizeMm * pxPerMm}px Georgia, serif`;
  layout.lines.forEach((line, i) => {
    context.fillText(
      line,
      canvas.width / 2,
      (layout.firstBaselineMm + i * layout.lineHeightMm) * pxPerMm,
    );
  });
  if (layout.attribution) {
    context.fillStyle = "#5c564d";
    context.font = `${layout.attribution.fontSizeMm * pxPerMm}px Georgia, serif`;
    context.fillText(
      layout.attribution.text,
      canvas.width / 2,
      layout.attribution.baselineMm * pxPerMm,
    );
  }
  return canvas;
}
