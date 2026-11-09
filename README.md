# Command Centre

Imran's personal dashboard for Windows. It runs on its own: no Claude, no subscriptions, no server.

**What's on it:** a 3×3 scramble and timer · today's meetings with one-click **Join** (Zoom / Teams / Meet) · Kuwait prayer times with a countdown · weather in °C · to-do list · plans (family, friends, travel) · goals with checkpoints · document and visa expiry reminders · travel history · Fitbit Air sleep and heart rate · Overwatch season countdown · quick notes.

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
3. In Command Centre → **Settings → Calendar**, paste it and click **Save**. Zoom links in your events become **Join** buttons.

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

## 5. Travel history

**Travel → Import CSV** and choose `travel-history.csv` (columns: `from,to,country,purpose,cities`, dates as `DD/MM/YYYY` or `YYYY-MM-DD`).

## Cube timer

Press and hold **Space** (or the timer) until it turns green, release to start, and press any key to stop. A new scramble appears after every solve. Use **+2 / DNF / ✕** for the last solve. Scrambles use WCA notation, 20 moves, randomly generated (official WCA scrambles come from TNoodle).

## Backup

**Settings → Backup → Download backup** saves everything (except document images) to one file you can restore later.

---

### For developers

- `web/`: the UI (plain HTML/CSS/JS, no build step). Open it with any static server to work on the layout.
- `src-tauri/`: the Windows shell (Tauri 2 / Rust): window, tray, autostart, notifications, CORS-free HTTP and loopback sign-in.
- Build locally: install Rust + the Visual Studio C++ Build Tools, then `npx @tauri-apps/cli@2 build`.
- `.github/workflows/build-windows.yml` builds and publishes the installer on every push to `main`.
