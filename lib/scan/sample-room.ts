/**
 * A made-up room as Gaussian splats, for trying the app before you've scanned
 * anything, and for testing the room fit against a known answer. It's written
 * the way a real scan arrives: turned at an angle, off-centre, and upside down
 * (most splat files have Y pointing at the floor).
 */

export type Splat = {
  x: number; y: number; z: number;
  r: number; g: number; b: number;
  /** Radius in metres. */
  size: number;
};

export const SAMPLE_ROOM = { widthM: 3.4, depthM: 4.2, heightM: 2.55, yawDeg: 23 };

/** Small deterministic generator, so the sample is the same every time. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Colour = [number, number, number];

export function sampleRoomSplats(density = 1): Splat[] {
  const { widthM: W, depthM: D, heightM: H, yawDeg } = SAMPLE_ROOM;
  const rand = random(7);
  const out: Splat[] = [];
  const step = 0.035 / Math.sqrt(density);
  const jitter = () => (rand() - 0.5) * 0.012;

  /** A flat rectangle from `origin`, spanned by edges `a` and `b`. */
  const panel = (
    origin: Colour, a: Colour, b: Colour,
    colour: (s: number, t: number) => Colour | null,
  ) => {
    const la = Math.hypot(...a);
    const lb = Math.hypot(...b);
    for (let s = step / 2; s < la; s += step) {
      for (let t = step / 2; t < lb; t += step) {
        const tone = colour(s, t);
        if (!tone) continue;
        const [r, g, bl] = tone;
        const shade = 0.94 + rand() * 0.06;
        out.push({
          x: origin[0] + (a[0] * s) / la + (b[0] * t) / lb + jitter(),
          y: origin[1] + (a[1] * s) / la + (b[1] * t) / lb + jitter(),
          z: origin[2] + (a[2] * s) / la + (b[2] * t) / lb + jitter(),
          r: r * shade, g: g * shade, b: bl * shade,
          size: step * 0.62,
        });
      }
    }
  };
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, c: Colour) => {
    const lit = (k: number): Colour => [c[0] * k, c[1] * k, c[2] * k];
    panel([x, y + h, z], [w, 0, 0], [0, 0, d], () => lit(1));
    panel([x, y, z], [w, 0, 0], [0, h, 0], () => lit(0.8));
    panel([x, y, z + d], [w, 0, 0], [0, h, 0], () => lit(0.86));
    panel([x, y, z], [0, 0, d], [0, h, 0], () => lit(0.72));
    panel([x + w, y, z], [0, 0, d], [0, h, 0], () => lit(0.9));
  };

  const wall: Colour = [0.9, 0.88, 0.83];
  const cork: Colour = [0.72, 0.55, 0.36];
  const inRect = (s: number, t: number, s0: number, t0: number, w: number, h: number) =>
    s > s0 && s < s0 + w && t > t0 && t < t0 + h;

  // Floor and ceiling. A scanner can't see the floor under a bed or a
  // wardrobe, so there's none there.
  const BED = { x: 0.05, z: 0.1, w: 0.95, d: 2.0 };
  const WARDROBE = { x: 0.05, z: D - 1.25, w: 0.6, d: 1.0 };
  // Nor the sliver between them and the wall they stand against.
  const under = (x: number, z: number) =>
    [BED, WARDROBE].some((f) => x < f.x + f.w && z > f.z && z < f.z + f.d);
  panel([0, 0, 0], [W, 0, 0], [0, 0, D], (s, t) =>
    under(s, t) ? null : Math.floor(s / 0.14) % 2 === 0 ? [0.55, 0.4, 0.27] : [0.5, 0.36, 0.24]);
  panel([0, H, 0], [W, 0, 0], [0, 0, D], () => [0.95, 0.95, 0.93]);
  // Wall at z = 0: the pin board wall.
  panel([0, 0, 0], [W, 0, 0], [0, H, 0], (s, t) =>
    inRect(s, t, 0.25, 0.85, 2.9, 1.3) ? cork : wall);
  // Wall at x = W, with a window.
  panel([W, 0, 0], [0, 0, D], [0, H, 0], (s, t) =>
    inRect(s, t, 1.3, 0.95, 1.5, 1.2) ? [0.62, 0.78, 0.92] : wall);
  // Wall at z = D, with the door.
  panel([W, 0, D], [-W, 0, 0], [0, H, 0], (s, t) =>
    inRect(s, t, 0.4, 0, 0.82, 2.0) ? [0.42, 0.3, 0.2] : wall);
  // Wall at x = 0, with a radiator.
  panel([0, 0, D], [0, 0, -D], [0, H, 0], (s, t) =>
    inRect(s, t, 2.6, 0.15, 1.0, 0.6) ? [0.97, 0.97, 0.97] : wall);

  // Furniture: a desk under the window, a bed, and a wardrobe.
  box(W - 0.65, 0.7, 1.35, 0.65, 0.04, 1.4, [0.7, 0.58, 0.42]);
  box(BED.x, 0, BED.z, BED.w, 0.5, BED.d, [0.32, 0.42, 0.6]);
  box(WARDROBE.x, 0, WARDROBE.z, WARDROBE.w, 1.95, WARDROBE.d, [0.6, 0.5, 0.4]);

  // Into the file's frame: turn, shift, then flip so Y points down.
  const theta = (yawDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return out.map((p) => {
    const x = p.x * cos - p.z * sin + 1.7;
    const z = p.x * sin + p.z * cos - 0.9;
    const y = p.y - 1.1;
    return { ...p, x, y: -y, z: -z };
  });
}

/** The x, y, z triples the room fit works from. */
export function splatCentres(splats: Splat[]): Float32Array {
  const out = new Float32Array(splats.length * 3);
  splats.forEach((s, i) => out.set([s.x, s.y, s.z], i * 3));
  return out;
}

const SH_C0 = 0.28209479177387814;

/** The standard Gaussian-splat PLY layout, which every viewer reads. */
export function writeSplatPly(splats: Splat[]): Buffer {
  const fields = [
    "x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
    "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3",
  ];
  const header =
    `ply\nformat binary_little_endian 1.0\nelement vertex ${splats.length}\n` +
    fields.map((f) => `property float ${f}\n`).join("") +
    "end_header\n";
  const body = Buffer.alloc(splats.length * fields.length * 4);
  splats.forEach((s, i) => {
    const scale = Math.log(s.size);
    const values = [
      s.x, s.y, s.z,
      (s.r - 0.5) / SH_C0, (s.g - 0.5) / SH_C0, (s.b - 0.5) / SH_C0,
      6, // opacity before the sigmoid: effectively solid
      scale, scale, scale,
      1, 0, 0, 0,
    ];
    values.forEach((v, k) => body.writeFloatLE(v, (i * fields.length + k) * 4));
  });
  return Buffer.concat([Buffer.from(header, "ascii"), body]);
}
