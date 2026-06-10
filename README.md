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
- CSV export
- JSON backup and import
- Copyable summary for sharing with family
- Static app that works on GitHub Pages

## Use Locally

Open `index.html` in a browser.

## Publish With GitHub Pages

After pushing the repo to GitHub:

1. Open the repo on GitHub.
2. Go to **Settings > Pages**.
3. Set the source to **Deploy from a branch**.
4. Choose the `main` branch and `/root`.
5. Save.

GitHub will give you a public URL you can share.
