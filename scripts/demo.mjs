// Runs the app on a made-up room, so you can look round without scanning
// anything. Everything it makes goes in demo-data/, never in data/.
//
//   npm run demo            then open http://localhost:3111
//
// The first run fills demo-data/ with the sample room, some drawn posters and
// a few quotes. Delete that folder to start again.
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";

const PORT = process.env.PORT ?? "3111";
const DATA_DIR = path.resolve("demo-data");
const BASE = `http://localhost:${PORT}`;

if (!fs.existsSync(".env.local")) {
  console.error("Run `npm run setup` first: the demo signs in with the same password.");
  process.exit(1);
}
const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);

const INK = "#1c1c1c";
const PAPER = "#f6f3ec";

/** Flat things to put on the walls, each drawn here so nothing is borrowed. */
const THINGS = [
  {
    title: "Stairs, blue",
    w: 420,
    h: 594,
    art: (w, h) => `
      <rect width="${w}" height="${h}" fill="#dfe9f2"/>
      ${Array.from({ length: 9 }, (_, i) => {
        const s = w / 11;
        return `<path d="M${s * (i + 1)} ${h - s * (i + 2)} h${s} v${s} h${-s} z M${s * (i + 1)} ${h - s * (i + 2)} l${s * 0.5} ${-s * 0.5} h${s} l${-s * 0.5} ${s * 0.5} z" fill="${i % 2 ? "#3f6fb5" : "#f6f3ec"}" stroke="${INK}" stroke-width="3"/>`;
      }).join("")}
      <circle cx="${w * 0.74}" cy="${h * 0.2}" r="${w * 0.11}" fill="#e8b04a" stroke="${INK}" stroke-width="3"/>`,
  },
  {
    title: "Red arches",
    w: 500,
    h: 700,
    art: (w, h) => `
      <rect width="${w}" height="${h}" fill="${PAPER}"/>
      ${[0, 1, 2, 3]
        .map((i) => {
          const inset = w * (0.1 + i * 0.09);
          const top = h * (0.16 + i * 0.1);
          const r = (w - inset * 2) / 2;
          return `<path d="M${inset} ${h * 0.9} V${top + r} a${r} ${r} 0 0 1 ${r * 2} 0 V${h * 0.9} z" fill="${["#c8442f", "#e58a6b", "#f2c9a8", PAPER][i]}" stroke="${INK}" stroke-width="3"/>`;
        })
        .join("")}
      <line x1="${w * 0.06}" y1="${h * 0.9}" x2="${w * 0.94}" y2="${h * 0.9}" stroke="${INK}" stroke-width="4"/>`,
  },
  {
    title: "Tower block",
    w: 297,
    h: 420,
    art: (w, h) => `
      <rect width="${w}" height="${h}" fill="#f1e9c9"/>
      <rect x="${w * 0.28}" y="${h * 0.14}" width="${w * 0.44}" height="${h * 0.74}" fill="${PAPER}" stroke="${INK}" stroke-width="3"/>
      ${Array.from({ length: 30 }, (_, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        return `<rect x="${w * (0.32 + col * 0.125)}" y="${h * (0.18 + row * 0.068)}" width="${w * 0.09}" height="${h * 0.04}" fill="${(i * 7) % 5 === 0 ? "#e8b04a" : "#2f7d6b"}" stroke="${INK}" stroke-width="2"/>`;
      }).join("")}
      <line x1="0" y1="${h * 0.88}" x2="${w}" y2="${h * 0.88}" stroke="${INK}" stroke-width="3"/>`,
  },
  {
    title: "Green grid",
    w: 300,
    h: 300,
    art: (w, h) => `
      <rect width="${w}" height="${h}" fill="${PAPER}"/>
      ${Array.from({ length: 25 }, (_, i) => {
        const s = w / 7;
        const x = s * (1 + (i % 5));
        const y = s * (1 + Math.floor(i / 5));
        const on = (i * 3 + Math.floor(i / 5)) % 4;
        return on === 0
          ? `<circle cx="${x + s / 2}" cy="${y + s / 2}" r="${s * 0.42}" fill="#2f7d6b" stroke="${INK}" stroke-width="3"/>`
          : `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${on === 1 ? "#b9d8c2" : "none"}" stroke="${INK}" stroke-width="3"/>`;
      }).join("")}`,
  },
  {
    title: "Sun over water",
    w: 594,
    h: 420,
    art: (w, h) => `
      <rect width="${w}" height="${h}" fill="#f4dcc0"/>
      <circle cx="${w / 2}" cy="${h * 0.52}" r="${h * 0.3}" fill="#d8572f" stroke="${INK}" stroke-width="3"/>
      <rect y="${h * 0.52}" width="${w}" height="${h * 0.48}" fill="#3f6fb5"/>
      ${Array.from({ length: 7 }, (_, i) => `<line x1="${w * (0.5 - 0.06 * (i + 1))}" y1="${h * (0.58 + i * 0.055)}" x2="${w * (0.5 + 0.06 * (i + 1))}" y2="${h * (0.58 + i * 0.055)}" stroke="#f4dcc0" stroke-width="${3 + i}"/>`).join("")}
      <line x1="0" y1="${h * 0.52}" x2="${w}" y2="${h * 0.52}" stroke="${INK}" stroke-width="3"/>`,
  },
  {
    title: "Postcard, lighthouse",
    w: 105,
    h: 148,
    art: (w, h) => `
      <rect width="${w}" height="${h}" fill="#cfe3ea"/>
      <path d="M${w * 0.4} ${h * 0.85} L${w * 0.44} ${h * 0.3} h${w * 0.12} L${w * 0.6} ${h * 0.85} z" fill="${PAPER}" stroke="${INK}" stroke-width="3"/>
      <rect x="${w * 0.42}" y="${h * 0.22}" width="${w * 0.16}" height="${h * 0.08}" fill="#e8b04a" stroke="${INK}" stroke-width="3"/>
      <path d="M${w * 0.425} ${h * 0.5} h${w * 0.15} v${h * 0.1} h${-w * 0.156} z" fill="#c8442f"/>
      <rect y="${h * 0.85}" width="${w}" height="${h * 0.15}" fill="#3f6fb5"/>`,
  },
  {
    title: "Postcard, hills",
    w: 148,
    h: 105,
    art: (w, h) => `
      <rect width="${w}" height="${h}" fill="#f1e9c9"/>
      <path d="M0 ${h * 0.7} Q${w * 0.25} ${h * 0.25} ${w * 0.5} ${h * 0.62} T${w} ${h * 0.5} V${h} H0 z" fill="#b9d8c2" stroke="${INK}" stroke-width="3"/>
      <path d="M0 ${h * 0.85} Q${w * 0.35} ${h * 0.55} ${w * 0.65} ${h * 0.8} T${w} ${h * 0.75} V${h} H0 z" fill="#2f7d6b" stroke="${INK}" stroke-width="3"/>
      <circle cx="${w * 0.78}" cy="${h * 0.24}" r="${h * 0.1}" fill="#d8572f"/>`,
  },
  {
    title: "Print, three moons",
    w: 210,
    h: 297,
    art: (w, h) => `
      <rect width="${w}" height="${h}" fill="#23304a"/>
      ${[0.25, 0.5, 0.75]
        .map(
          (y, i) =>
            `<circle cx="${w / 2}" cy="${h * y}" r="${w * 0.17}" fill="${PAPER}"/><circle cx="${w * (0.5 + (i - 1) * 0.12)}" cy="${h * y}" r="${w * 0.17}" fill="#23304a"/>`,
        )
        .join("")}`,
  },
];

/** Pictures for the print library: the same idea, waiting to be sorted. */
const PHOTOS = [
  ["#d8572f", "#f4dcc0"],
  ["#3f6fb5", "#dfe9f2"],
  ["#2f7d6b", "#f1e9c9"],
  ["#e8b04a", "#23304a"],
].map(([a, b], i) => ({
  name: `pattern-${i + 1}.png`,
  w: 900,
  h: i % 2 ? 900 : 1200,
  art: (w, h) => `
    <rect width="${w}" height="${h}" fill="${b}"/>
    ${Array.from({ length: 6 }, (_, k) => `<circle cx="${w / 2}" cy="${h / 2}" r="${(w * (6 - k)) / 14}" fill="${k % 2 ? b : a}"/>`).join("")}`,
}));

const QUOTES = [
  { text: "A room is a tool for living, so sharpen it.", attribution: "Demo data" },
  { text: "Put the bright thing where you look first in the morning.", attribution: "Demo data" },
  { kind: "reminder", text: "Water the plant on the windowsill." },
];

/** Draws one picture as a PNG, with a paper border like a real print. */
async function draw({ w, h, art }, longPx = 1400) {
  const scale = longPx / Math.max(w, h);
  const [W, H] = [Math.round(w * scale), Math.round(h * scale)];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${art(W, H)}<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" fill="none" stroke="${INK}" stroke-width="3"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function sessionCookie() {
  const expires = String(Date.now() + 24 * 60 * 60 * 1000);
  const mac = createHmac("sha256", env.SESSION_SECRET).update(expires).digest("base64url");
  return `room_session=${expires}.${mac}`;
}

async function post(url, init) {
  const response = await fetch(BASE + url, { method: "POST", ...init });
  if (!response.ok) throw new Error(`${url} answered ${response.status}: ${await response.text()}`);
  return response.json();
}

async function upload(url, bytes, name, cookie) {
  const form = new FormData();
  form.set("file", new File([bytes], name, { type: "image/png" }));
  return post(url, { body: form, headers: { cookie } });
}

async function seed() {
  const cookie = sessionCookie();
  console.log("Demo: building the sample room…");
  await post("/api/scan/sample", { headers: { cookie } });

  console.log("Demo: drawing things for the walls…");
  const sized = [];
  for (const thing of THINGS) {
    const { id } = await upload("/api/upload/thing", await draw(thing), `${thing.title}.png`, cookie);
    sized.push({ id, ...thing });
  }
  // Names and sizes are normally typed in on each thing's page.
  const db = new Database(path.join(DATA_DIR, "room.db"));
  const set = db.prepare("update content set title = ?, width_mm = ?, height_mm = ? where id = ?");
  for (const { id, title, w, h } of sized) set.run(title, w, h, id);
  db.close();

  console.log("Demo: filling the print library…");
  for (const photo of PHOTOS) {
    await upload("/api/upload", await draw(photo, 1200), photo.name, cookie);
  }
  for (const quote of QUOTES) {
    await post("/api/capture", {
      body: JSON.stringify(quote),
      headers: { "content-type": "application/json", "x-capture-token": env.CAPTURE_TOKEN },
    });
  }
}

const fresh = !fs.existsSync(path.join(DATA_DIR, "room.db"));
const server = spawn("npx", ["next", "dev", "-p", PORT], {
  env: { ...process.env, DATA_DIR },
  stdio: "inherit",
});
const stop = () => server.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));

for (let tries = 0; ; tries++) {
  try {
    if ((await fetch(`${BASE}/login`)).ok) break;
  } catch {
    // Not listening yet.
  }
  if (tries > 120) {
    console.error("Demo: the server didn't start.");
    stop();
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

try {
  if (fresh) await seed();
  console.log(`\nDemo room ready: ${BASE}  (sign in with APP_PASSWORD from .env.local)`);
  console.log("Open a wall on the Room page and press “Arrange for me” to hang the things.\n");
} catch (error) {
  console.error("Demo: couldn't fill the room.", error);
  stop();
}
