# Spike: sandboxed game loads its pack offline

**Question (design doc §8.3, §9.8, §16):** can a game run in a locked-down sandbox (no network, no storage, no access to the app) and still load its warm/cold art pack from the device with no connection?

**Answer: yes in Chromium (the engine behind Android's WebView). PASS, 9 of 9 checks.** A run on a real device is still needed.

## Result (2026-10-22, headless Chromium)

| Check | Result |
| --- | --- |
| Pack downloaded online, every file's sha256 verified against `pack.json` | PASS |
| Network really off (fetch fails) | PASS |
| Game launched offline from the stored pack | PASS — 3 of 3 images decoded in 20 ms |
| Game origin is opaque (`null`) | PASS |
| Game cannot reach the host page | PASS |
| Game cannot use the network (CSP `default-src 'none'`) | PASS |
| Game cannot use browser storage | PASS |
| One flipped byte in the stored pack → launch refused | PASS |
| No page errors | PASS |

## How it works

- The host verifies and stores packs (IndexedDB here; the Capacitor Filesystem plugin is the alternative for large packs).
- The game runs in `<iframe sandbox="allow-scripts" srcdoc="…">`: an opaque origin with its own CSP that allows no network at all.
- The host sends the pack as **transferable ArrayBuffers** over `postMessage`; the game turns them into `blob:` URLs. Only messages from that exact iframe are accepted, and a 10-second watchdog catches a game that never starts.

**Design change this suggests:** `srcdoc` makes the custom `emb-game://` scheme in §8.3 unnecessary. The game's HTML ships inside the app bundle (offline by definition in Capacitor), and its assets arrive over the bridge. Simpler, and the same on web, Android and iOS.

## Run it

```bash
pnpm make-pack      # regenerates the placeholder warm pack + sha256 manifest
pnpm build
pnpm spike:test     # automated check in Chromium (CHROMIUM_PATH=... to use a local browser)
```

## On a real device (still to do)

Android (needs Android Studio):

```bash
pnpm build && npx cap sync android && npx cap open android
```

Run on the Galaxy Tab, tap **Download pack**, switch on airplane mode, force-quit and reopen the app, tap **Play**. All five ticks should be green. Then tap **Corrupt stored pack** and **Play**: it must refuse.

iOS (needs a Mac with Xcode): `npx cap add ios && npx cap sync ios && npx cap open ios`, same steps on the iPad.
