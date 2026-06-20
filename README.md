# Malibu Fuel Tracker

A tiny no-login fuel tracker for a 2015 Malibu 22 VLX. Enter the raw fuel value from system diagnosis and the app estimates a more useful fuel percentage, timestamps each entry, and keeps the history on the device.

## Fuel Formula

```text
percent = 114.610 - 0.40945 * raw_count
```

The app caps results between 0% and 100%. If the raw value bounces between two numbers, enter a range like `102-125` and the app will average it before calculating the estimate.

## Features

- Simple single text box for raw readings
- Timestamped history saved in the browser
- Smoothed estimate using the latest 3 entries
- Gallons remaining estimate with editable tank size
- Fill-up cost estimate from a saved premium price
- Session fuel-used cost from a saved start reading
- Jerry can estimate with editable litre size
- CSV export
- JSON backup and import
- Copyable summary for sharing with family
- Static frontend with a small Netlify function for cross-device sync
- Cloud sync for family devices through a shared GitHub-backed log file

## Use Locally

Open `index.html` in a browser.

## Publish With Netlify

GitHub Pages can host the static app, but it cannot save shared data. To sync the history across devices, deploy this repo on Netlify so the `/api/fuel-log` function can write to `data/fuel-log.json`.

1. Create a GitHub fine-grained personal access token with **Contents: Read and write** for this repo.
2. In Netlify, import this GitHub repo as a new site.
3. Add environment variables:
   - `GITHUB_TOKEN`: the token from step 1
   - `GITHUB_REPO`: `Charlieelliott24/malibu-fuel-tracker`
4. Deploy the site.

Family can use the Netlify URL without logging in. The app keeps a local cache, then syncs entries to the shared GitHub-backed log.

## Gas Prices

The app keeps the premium price editable instead of fetching it automatically. Google Maps and Waze may show current station prices, but they do not provide a simple public no-key fuel price feed for this static app. Update the saved `$/L` value when you buy premium, and the fill-up and session cost estimates recalculate immediately.

## Cloud Sync

Entries sync through `/api/fuel-log`, a Netlify function that stores the shared history in `data/fuel-log.json`. The GitHub token stays server-side in Netlify and is not exposed to browsers.
