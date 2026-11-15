# Room

A personal app for turning a college room into a place worth being in. It runs entirely on this laptop. There's no hosting and no online database: your photos and data stay in the `data/` folder.

See `Room Design App — Design Intent.md` for what it's for.

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

The phone talks to the laptop directly, so the laptop has to be awake and running `npm run serve`. Try these in order.

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

Saved items wait in **Sort**.

## Back up `data/`

The database and every photo live only in `data/`, which is deliberately not in Git. If the laptop dies, so does anything not backed up. Copy that folder somewhere safe, or make sure Time Machine covers it.

## How it's built

- `lib/room/` holds the room model. Every length is in millimetres, and mounting rules are enforced on the server as well as in the interface.
- `lib/content/` handles the library, photo storage and sorting.
- `lib/actions/` holds Server Functions, each of which checks the session itself.
- `drizzle/` holds database migrations, which run automatically on start. After changing `lib/db/schema.ts`, run `npm run db:generate`.

The tape-measured room model is the source of truth for print sizes and hanging positions. Scans will only ever provide visuals, never measurements.
