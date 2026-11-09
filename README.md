# Command Centre

Imran's personal dashboard for **Windows, iPhone and iPad**, kept in sync. It runs on its own: no Claude, no subscriptions, nothing to pay for.

**What's on it:** a 3×3 scramble and timer · Kuwait time plus London, New York and Karachi clocks · a month calendar of your meetings and plans, with **Join** opening the Zoom/Teams app directly · Kuwait prayer times with a countdown · a 7-day forecast in °C with an hourly chart and moon phase · to-do list · goals with checkpoints · document and visa expiry reminders · travel history · Fitbit Air sleep and heart rate · Overwatch season countdown · quick notes.

Your data stays on your PC (inside the app). Nothing personal is in this repository.

---

## 1. Install the app

1. Open the **Releases** section of this repository (right-hand side on GitHub) and download the newest file ending in **`-setup.exe`**.
2. Run it. Windows may say *"Windows protected your PC"* because the app isn't signed with a paid certificate. Click **More info → Run anyway**.
3. Command Centre opens, adds itself to startup, and keeps running in the **system tray** (bottom-right, near the clock) when you close the window. Right-click the tray icon to quit.

A new installer is built automatically on GitHub each time the code changes. To update, install the newest one over the old one. Your data is kept.

## 2. Meetings (about 2 minutes, no sign-in)

1. Open **calendar.google.com** on a computer → ⚙ **Settings** → under *Settings for my calendars* click your calendar → **Integrate calendar**.
2. Copy **Secret address in iCal format**.
3. In Command Centre → **Settings → Calendar**, paste it and click **Save**. Zoom links in your events become **Join** buttons that open the Zoom app straight into the meeting.

The app checks your calendar every minute while it's open, and immediately when you switch back to it. Google itself can take a few minutes to publish a change to this link.

To add a work calendar too, paste its link on a new line.

## 3. Fitbit Air: sleep and heart rate (optional, about 10 minutes, free)

Google only lets apps read health data if they're registered under your own Google account, so you create a free "key":

1. Go to **console.cloud.google.com** → create a project called `Command Centre` (no billing needed).
2. **APIs & Services → Library** → search **Google Health API** → **Enable**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - User type **External**, app name `Command Centre`, your email for support/contact.
   - **Data access / Scopes** → add `googlehealth.sleep.readonly` and `googlehealth.health_metrics_and_measurements.readonly`.
   - **Audience / Test users** → add your own Gmail address.
4. **Clients → Create client** → Application type **Desktop app** → name `Command Centre` → **Create**. Copy the **Client ID** and **Client secret**.
5. In Command Centre → **Settings → Fitbit Air**, paste both, click **Save**, then **Connect**. Your browser opens. Pick your Google account, click through the "Google hasn't verified this app" warning (**Advanced → Go to Command Centre**: it's your own app), and allow access.

Sleep and heart rate then refresh every hour.
*While the app is in "Testing" mode, Google expires the sign-in after 7 days, so you'd click **Reconnect** once a week. To avoid that, set Publishing status to **In production** on the Audience page. You don't need to submit it for verification for personal use.*

## 4. Microsoft To Do (optional)

The to-do list already works inside the app. Only do this if you also want tasks from the Microsoft To Do app:

1. **portal.azure.com** → **App registrations → New registration** → name `Command Centre`, account type **Personal Microsoft accounts only**.
2. **Authentication → Add a platform → Mobile and desktop applications** → tick/add `http://localhost` → Save. Turn on **Allow public client flows**.
3. Copy the **Application (client) ID** into Command Centre → **Settings → Microsoft To Do** → **Connect**.

## 5. Travel history and flights

- **Travel → Trips → Import CSV**: choose `travel-history.csv` (columns `from,to,country,cities`, dates as `DD/MM/YYYY` or `YYYY-MM-DD`).
- **Travel → Flights → Import Flightradar24 CSV**: the export from my.flightradar24.com (Settings → Export).

## 6. Files (family document vault)

**Files** keeps passport copies, visas, civil IDs, CVs, interview documents and so on for you and each family member. Click **+ Add family member** to add people, then drag files onto the page or use **+ Add files**. They're saved as normal files in `Documents\Command Centre Vault\<Person>\<Folder>`, so you can also open that folder in File Explorer or back it up to a USB drive or cloud folder. Deleted files go to a hidden `.trash` folder inside the vault.

## Running in the background

Closing the window keeps Command Centre running in the system tray. It starts with Windows and keeps syncing your calendar, weather and Fitbit data, and keeps sending reminders. To quit completely, right-click the tray icon → **Quit**. To stop it starting with Windows, use Task Manager → Startup apps.

## 7. iPhone and iPad

The phone and tablet version is the same app, hosted free at **https://01im.github.io/command-centre/**.

1. On the iPhone or iPad, open that link in **Safari**.
2. Tap **Share** (the square with the arrow) → **Add to Home Screen** → **Add**.
3. Open **Command** from the home screen. It runs full-screen like a normal app and works offline.

The layout is tuned for the iPhone 16 Pro and the iPad 10th gen in both orientations. A real App Store app would need Apple's paid developer account, which is why it's done this way.

## 8. Sync between the laptop, iPhone and iPad (free, encrypted)

Sync uses your own free **Supabase** project. Everything is **encrypted on the device with a passphrase only you know** before it's uploaded, so Supabase only ever stores scrambled data.

**One-time setup (about 10 minutes, on the laptop):**
1. Go to **supabase.com** → **Start your project** → sign in with GitHub.
2. **New project**: any name (e.g. `command-centre`), set a database password (save it somewhere, though you won't need it day to day), pick the region closest to Kuwait (e.g. *Frankfurt* or *Mumbai*), Free plan → **Create**. Wait about 2 minutes.
3. **SQL Editor** → **New query** → paste the whole of [`docs/supabase-setup.sql`](docs/supabase-setup.sql) → **Run**. It should say *Success*.
4. **Authentication → Sign In / Providers → Email**: turn **Confirm email** OFF → Save. This avoids a confirmation email for an account only you use.
5. **Project Settings → API Keys** (or *Data API*): copy the **Project URL** and the **anon / publishable** key.
6. In Command Centre on the laptop → **Settings → Sync across devices**: paste the URL and key, enter your email, choose a password and an **encryption passphrase** → **Create account (first device)**.

**On the iPhone and iPad:** Settings → Sync across devices → the same URL, key, email, password and passphrase → **Sign in**.

What syncs: plans, to-dos, goals, notes, expiry dates, travel and flights, Overwatch dates, family members, calendars, your profile picture, cube solves, and every file in **Files** (encrypted). Changes reach the other devices within about a minute, and straight away when you open the app.

**Calendars and Fitbit on the phone:** iPhones can't read Google/Outlook calendar links or Fitbit directly, so the Windows app (running in the tray) passes them on through sync. To let the phone and iPad refresh calendars **on their own**, even with the laptop off, add the optional calendar helper: Supabase → **Edge Functions → Deploy a new function → Via Editor** → name it `ics` → paste [`docs/ics-function.ts`](docs/ics-function.ts) → **Deploy**.

**Free-plan notes:** 500 MB of data plus 1 GB of files, which is plenty. Supabase pauses free projects after 7 days with no activity, but daily use keeps it awake. If it ever pauses, click *Restore* in the dashboard.

## Cube timer

Press and hold **Space**, or touch and hold the timer on the phone/iPad, until it turns green, release to start, and press any key to stop. A new scramble appears after every solve. Use **+2 / DNF / ✕** for the last solve. Scrambles use WCA notation, 20 moves, randomly generated (official WCA scrambles come from TNoodle).

## Backup

**Settings → Backup → Download backup** saves everything (except document images) to one file you can restore later.

---

### For developers

- `web/`: the UI (plain HTML/CSS/JS, no build step). Open it with any static server to work on the layout.
- `src-tauri/`: the Windows shell (Tauri 2 / Rust): window, tray, autostart, notifications, CORS-free HTTP and loopback sign-in.
- Build locally: install Rust + the Visual Studio C++ Build Tools, then `npx @tauri-apps/cli@2 build`.
- `.github/workflows/build-windows.yml` builds and publishes the installer on every push to `main`.
