# Checklist for iPhone

The iPhone app is the same page as the website (`index.html`), packaged with
[Capacitor](https://capacitorjs.com) so it installs like a normal app and adds a few
things a website can't do:

- **Works offline.** The page, fonts, wood textures and the PDF reader are all inside the
  app, so it opens with no connection. Sync catches up when you're back online, and it
  syncs again every time you switch back to the app.
- **Due-date reminders.** A notification the evening before and the morning of anything
  that isn't finished yet, and one for each calendar event. They update by themselves when
  you check things off or sync, and there's an on/off switch in the ☰ menu.
- **Haptics.** A small tap when you mark something complete or turned in.
- **Status bar** text that stays readable on whatever header colour you pick, with a strip
  behind it so scrolled pages don't run under the clock.
- **Portrait only**, like most phone apps (sideways, the title slid under the camera cutout).

The website is not changed by any of this. The app gets its own copy of the page each time
you build it.

## Folder guide

| Path | What it is |
| --- | --- |
| `index.html` | The website (and the app's page). Edit this as usual. |
| `app/native.js` | The app-only extras listed above. |
| `app/fonts/` | The Google fonts, bundled for offline use. |
| `app/icon/` | App icon + launch screen, and the script that draws them. |
| `scripts/build-www.mjs` | Makes the app's offline copy of the page in `www/`. |
| `ios/` | The Xcode project. |
| `privacy.html` | Privacy policy (App Store needs a link to one). |
| `app-store/screenshots/` | Six 6.9" iPhone screenshots for the App Store listing. |
| `ios/App/App/PrivacyInfo.xcprivacy` | Apple's privacy manifest (matches the App Privacy answers). |

## Updating the app after you change the website

```bash
npm install          # first time only
npm run ios          # builds www/, copies it into the Xcode project, opens Xcode
```

(If `npm install` fails with a permissions error about `~/.npm`, run it as
`npm_config_cache=~/.npm-cache-checklist npm install`.)

Then press ▶ in Xcode. For an App Store update, bump the version (see below) and upload again.

## Getting it on the App Store

These steps need you (they involve your Apple account and money):

1. **Join the Apple Developer Program** ($99/year) at
   [developer.apple.com/programs](https://developer.apple.com/programs/enroll/).
   Approval usually takes a day or two.
2. **Sign in to Xcode** with that Apple ID: Xcode → Settings → Accounts → +.
3. **Pick your team:** open `ios/App/App.xcworkspace` (the workspace, not the `.xcodeproj`), click **App** in the left sidebar →
   **Signing & Capabilities** → choose your team under *Team*. Leave *Automatically manage
   signing* on. If Xcode says the bundle ID is taken, change `com.nicktavaf.checklist` to
   something else unique (also in `capacitor.config.json`).
4. **Try it on your iPhone:** plug it in, pick it at the top of Xcode, press ▶. (The first
   time, the phone asks you to turn on Developer Mode and trust the developer in Settings.)
5. **Create the App Store listing** at [App Store Connect](https://appstoreconnect.apple.com)
   → Apps → + → New App. Use the same bundle ID. You'll need:
   - a name (must be unique on the store; "Checklist" alone is probably taken), subtitle,
     description, keywords, and a support URL
   - **Privacy Policy URL:** `https://nicktavaf.github.io/checklist/privacy.html`
     (fill in your contact email in `privacy.html` first)
   - screenshots from a 6.9" or 6.5" iPhone (the simulator's iPhone 17 Pro Max works:
     File → Save Screen)
   - **App Privacy** answers: *User Content (other user content)* is collected, used for
     *App Functionality*, **not** linked to identity, **not** used for tracking.
   - the ready-to-paste listing text, reviewer notes and screenshot order are in the
     "Checklist: App Store listing kit" doc
   - Age rating questionnaire (all "None" → 4+)
6. **Upload:** in Xcode choose *Any iOS Device* at the top, then Product → Archive →
   Distribute App → App Store Connect → Upload.
7. Pick that build in App Store Connect, try it first with **TestFlight** if you like, then
   **Submit for Review**. Reviews usually take a day or two.

For each later release, raise *Version* (or *Build*) in Xcode → App → General before archiving.

## Your data vs. everyone else's

Nothing personal is built into the page anymore, on the website or in the app. Every
device starts with an **empty checklist and its own private sync code** (☰ menu → Sync
code). To see the same checklist on another device, tap **Change** there and type the code.
Keep your code to yourself: anyone who has it can see and edit that checklist.
