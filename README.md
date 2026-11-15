# Room

A personal app for turning a college room into a place worth being in. It runs entirely on this laptop. There's no hosting and no online database: your photos and data stay in the `data/` folder.

See `Room Design App — Design Intent.md` for what it's for.

## How it works

The room starts from a 3D scan. You walk round with your phone, add the file here, and the app turns it into geometry: where the walls are and how big, what furniture stands where, and how much clear wall is left once the door, the window and the furniture are taken out. Everything else sits on that.

1. **Scan** with any app that exports a Gaussian splat as a `.ply` file. The Room page has the step-by-step.
2. **Look at the room.** It's drawn as plain blocks and planes, not as the scan. Turn it round, look straight down at the plan, stand inside it, or face one wall. Switch the scan on over the top to check the model against it.
3. **Correct what it got wrong.** Mark doors, windows and anything to keep clear on each wall. Rename, resize or drag the furniture. Measure one wall with a tape and the whole room is rescaled to match.
4. **Photograph your things**: posters, prints, postcards, whether they're already up or still in a drawer. Mark the four corners of each and the photo is cut down and straightened. Give it its real size.
5. **Place them** on a wall at true size, by hand or all at once: "Arrange for me" lays them out as one group in the clear space, centred on eye level.
6. **Hang** gives each item's position, measured from the left of the wall and from the floor.

Photos and quotes you'd like printed still have their own route, under **Prints**: collect, sort, place, then order.

No scan yet? "Try a sample room" on the scan page loads a made-up one.

### What the scan can and can't tell

Wall positions and furniture sizes come from the scan, which on a LiDAR iPhone is usually right to within two or three centimetres across a room. Three things to know:

- **Ceilings are often missing.** They're blank and above eye level, so scans skip them. The app then uses the top of whatever it did see as the height, and says so.
- **Only what the camera saw is known.** Where the floor is visible, nothing stands there. Where nothing is visible between a piece of furniture's face and the wall behind it, the furniture is taken to carry on to the wall. So a wardrobe comes out the right depth even though nobody scanned inside it.
- **It finds shapes, not meanings.** A block the size of a bed is called a bed, but doors, windows and what's already on the walls have to be marked by hand, over the scan's own picture of each wall.

Files other than `.ply`, such as `.spz`, can be shown and lined up by hand, but the furniture isn't found in them.

## Running it

You need Node 24 (`nvm install 24`, then `nvm use`).

```sh
npm install
npm run setup    # creates .env.local with your password and secrets
npm run build
npm run serve    # prints the address to open on your phone
```

Your password is `APP_PASSWORD` in `.env.local`. Change it to anything you like, then restart the server.

For development, use `npm run dev`. Run `npm test` for the tests.

## Using it from your phone

The phone talks to the laptop directly, so the laptop has to be awake and running `npm run serve`. While it runs, `npm run serve` stops the laptop going to sleep when idle. Closing the lid still sleeps it, so leave it open and plugged in if you want to sort from elsewhere. Try these in order.

1. **Same Wi-Fi.** Open the address `npm run serve` prints. University and college networks may block devices from reaching each other. If the page never loads, that's the likely cause, so move on to option 2.
2. **iPhone Personal Hotspot.** Join the laptop to your phone's hotspot, restart `npm run serve`, and open the new address it prints. This needs nothing installed.
3. **Tailscale.** Install it on both devices and use the laptop's Tailscale address. It works on any network and encrypts the connection. It's the most convenient if you'll use the app often, though it's the one outside service here: it connects your devices, and your photos and data stay on the laptop.

On shared Wi-Fi, traffic between the phone and laptop is plain `http`, including your password when you sign in. The hotspot and Tailscale options avoid that.

Add the page to your Home Screen from Safari's Share menu for a full-screen app.

## Saving things from your phone

iOS doesn't let web apps appear in the Share sheet, so a Shortcut does the job. In the Shortcuts app, create one with **Show in Share Sheet** turned on, accepting text and images, and a **Get Contents of URL** action:

- **URL:** `http://<laptop-address>:3000/api/capture`
- **Method:** POST
- **Header:** `x-capture-token`, set to `CAPTURE_TOKEN` from `.env.local`
- **For text:** Request Body set to JSON, with a `text` field. `attribution` is optional, and `kind` can be `quote` or `reminder`.
- **For images:** Request Body set to Form, with a `file` field.

Saved items wait under **Prints**, to be sorted.

## Printing and hanging

**Prints** holds photos and quotes to be printed. Its print list downloads print-ready files, in a folder per size. Once you mark them as ordered, later downloads hold only what's new. Things you already own never appear there.

**Hang** gives each item's position, measured from the left of the wall and from the floor, and lists the pins or strips to have ready. Mark items as up as you go.

## Back up `data/`

The database and every photo live only in `data/`, which is deliberately not in Git. If the laptop dies, so does anything not backed up. Copy that folder somewhere safe, or make sure Time Machine covers it.

## How it's built

- `lib/scan/` reads a scan. `fit.ts` finds the room in its points, fitting each wall on its own since old rooms are rarely square. `survey.ts` finds the furniture and draws a flat picture of each wall. `ingest.ts` runs both when a scan arrives and writes the result into the room.
- `lib/room3d/stage.ts` is the 3D view, in plain three.js. It only draws and reports taps and drags; `components/room/RoomScreen.tsx` decides what's shown. The scan itself is drawn with [Spark](https://sparkjs.dev), loaded only when you switch it on.
- `lib/room/` holds the room model. Every length is in millimetres, and mounting rules are enforced on the server as well as in the interface. `space.ts` works out clear wall space, and `arrange.ts` lays things out in it.
- `lib/content/` handles things, the print library, photo storage and sorting. `rectify.ts` straightens a photo from its four marked corners.
- `lib/actions/` holds Server Functions, each of which checks the session itself.
- `drizzle/` holds database migrations, which run automatically on start. After changing `lib/db/schema.ts`, run `npm run db:generate`.
