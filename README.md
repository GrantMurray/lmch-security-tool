# Security Tool

Web app for Lake Merwin Campers Hideaway security staff. It combines three
tools behind one access code, switched with the dropdown in the header:

- **Citation**: violation notices. Pick a site on the camp map (or type it),
  fill in the rest, and download a 4×6 PDF.
- **Shift report**: the security checklist and journal, laid out like the
  paper form, downloaded as a two-page PDF.
- **Incident report**: the LMCH incident report form, with a drawn
  signature, downloaded as a two-page PDF.

The PDFs are flattened: answers are printed on the page, not left as editable
form fields.

The open tool is in the URL hash, so `…/#shift-report`, `…/#citation` and
`…/#incident` open one directly; otherwise the app opens the tool used last on that device.

## Run

```sh
python3 -m http.server 8000
```

Open http://localhost:8000 (use `localhost`, not a LAN IP — unlocking needs
HTTPS or localhost). It must be served, not opened as a file. Needs
`assets/locked/bundle.bin`; see [Access code](#access-code).

## Access code

The app opens with an access-code screen. Both form templates, the site list,
the fines list and the maps are **encrypted** with that code (AES-256-GCM, key
derived with PBKDF2-SHA256, 600k iterations) into `assets/locked/bundle.bin`,
and only that bundle is committed — the readable files under `assets/forms/`,
`assets/data/` and `assets/maps/` are git-ignored and stay on your machine.
The code itself is not stored anywhere; a wrong code just fails to decrypt.

**Set or change the code** (also run after changing a form, the maps or the CSVs):

```sh
python3 tools/lock_assets.py      # prompts for the code twice
git add assets/locked/bundle.bin && git commit -m "Update bundle" && git push
```

Changing the code makes every device ask for the new one the next time it
picks up the update. "Remember on this device" keeps the derived key (not the
code) in a cookie for 400 days; the **Lock** button forgets it.

Use a long code (a few random words). Anyone can download the bundle and try
codes offline, so a short PIN can be guessed; a passphrase can't.

## Install on iPad / iPhone / Android (offline use)

The app works offline once installed. It has to be hosted on HTTPS first
(any static host, e.g. GitHub Pages, Netlify, Railway); devices then
install it once while connected.

- **iPad / iPhone:** open the site in Safari → Share → **Add to Home Screen**.
- **Android:** open the site in Chrome → menu → **Install app** (or Add to
  Home screen).

Open it once from the home screen while still connected. When the bottom of
the page says "✓ Available offline", it will work with no signal.

**Saving the PDF:**

- *Citation:* on phones and tablets, **Share / Print / Save** opens the system
  share sheet (Save to Files, Print, AirDrop, email…); elsewhere it's
  **Download PDF**.
- *Shift report:* **Submit packet** sends it. On phones and tablets it opens
  the share sheet with each file; on desktops it downloads the report as a
  PDF, or everything in one .zip if the packet has citations, incident reports
  or photos.

**Updating:** deploy the new files. Each device picks up the change the next
time it opens the app with a connection (the change shows on the following
launch). To force every device to re-download everything, bump `VERSION` in
`sw.js`. If you add or rename files the app loads, add them to `SHELL` in
`sw.js`.

## Layout

```
index.html                  app entry point (both tools' forms)
manifest.webmanifest        install metadata (name, icons)
sw.js                       service worker: offline cache
src/
  app.js                    access code, form picker, theme, offline status
  common.js                 shared helpers: drafts, signature pads, live PDF rebuild
  packet.js                 shift packet: citations and photos stored until submitted
  citation.js               citation: map picker, fines list, autofill
  shift-report.js           shift report: journal hint, PDF download/share
  incident.js               incident report: description hint, PDF download/share
  fill-citation.js          fills the citation PDF template (pdf-lib)
  fill-shift-report.js      fills the shift-report PDF template (pdf-lib)
  fill-incident.js          fills the incident-report PDF template (pdf-lib)
  vault.js                  access code: decrypts the bundle, remembers the key
  style.css
assets/
  locked/bundle.bin                 encrypted forms, site list and maps (committed)
  forms/citation_fillable.pdf       4×6 fillable citation template   (local only)
  forms/shift_report_fillable.pdf   fillable shift-report template   (local only)
  forms/incident_report_fillable.pdf  fillable incident-report template (local only)
  maps/camp_map_2024.pdf            source camp map                  (local only)
  maps/pages/                       rendered block maps              (local only)
  data/numbers.csv                  site positions on each block map (local only)
  data/fines.csv                    fines & penalties list           (local only)
  images/logo-circle.png            logo used on the citation and in the app
  icons/                            home-screen icons (generated)
vendor/pdf-lib.min.js       pdf-lib 1.17.1
tools/
  build_form.py             regenerates assets/forms/citation_fillable.pdf
  render_maps.py            regenerates assets/maps/pages/ from the map PDF
  make_icons.py             regenerates assets/icons/ from icon.svg
  lock_assets.py            encrypts the private files into assets/locked/
```

## Regenerating assets

- **Citation form:** `python3 tools/build_form.py` (needs `reportlab`). Field
  names in the form must match the `name` attributes in the citation form in
  `index.html`.
- **Map images:** `python3 tools/render_maps.py` (needs `pdftoppm`). Run after
  changing the map PDF or the `pdf_page`/`image` columns in `numbers.csv`.
- **Icons:** `python3 tools/make_icons.py` (needs ImageMagick).
- After changing a form, the maps or the CSVs, run `python3 tools/lock_assets.py`
  so the app gets the change.

`numbers.csv` coordinates (`left`, `top`, `width`, `height`, `x`, `y`) are
fractions of the full map page, so they stay valid at any render resolution.

### Shift-report template

The template's form fields can't be filled by name: all fourteen round and
bathhouse boxes are one field ("Time" / "Time 2"), both fuel gauges are one
dropdown, both totals are one field, and the Clean / Maintenance Issue radio
groups span two patrol areas. So `src/fill-shift-report.js` maps each answer
(the `name` attributes in the shift-report form in `index.html`) to one
widget — field name plus widget index — and prints it at that widget's
position, then removes the form. If the template's layout changes, update the
`TEXT`, `CHECKS`, `YES_NO` and `WRAPPED` tables there.

### Incident-report template

The incident report is filled the same way, by `src/fill-incident.js`: its
fields have unhelpful names ("1", "undefined_2", "Text5") and auto-sized
text. The incident description starts in the box on page 1 and continues in
the box at the top of page 2, shrinking if it still doesn't fit. The
management signature and date are left for management to sign on paper.

## Notes

- Each tool keeps its own draft (per browser, in localStorage), so a citation
  or report in progress survives switching forms or closing the app. Drawn
  signatures are never saved on the device (not even in the draft).
- **Citation numbers:** the next citation number, the device code and the
  "Issued by" name are remembered per browser. Give each device its own
  **Device code** (e.g. 001): it prints in front of the number (001-100000),
  so two devices counting from the same number never issue the same citation.
- **Violation category** has two modes. *Fines list* picks a violation
  from `assets/data/fines.csv` (transcribed from the LMCH Fines & Penalties
  List) and fills in the category, item #, fine amount and description
  (replacing what was there); *Manual* shows the category boxes. Each mode
  keeps its own description of violation. The choice is remembered per device.
  When the list changes, edit `fines.csv` and re-run `tools/lock_assets.py`.
- **Incident report:** "Reported by" is remembered per browser once a report
  has been shared, downloaded or added to the packet. Each report gets an id
  when it's started (e.g. IR-261102-2245), used in its file name.
- **Shift report:** the security journal wraps across the PDF's 18 ruled
  lines; longer entries print in smaller text to fit. Area comments wrap
  across their two lines.
- **Shift packet:** on the Citation and Incident report tabs, **Add to
  packet** keeps that document's PDF on the device (in IndexedDB). Editing it
  afterwards shows **Update in packet** to replace the stored copy. The Shift
  packet section at the bottom of the shift report lists them (each can be
  removed) and fills in the citations and incident reports totals. **Submit
  packet** hands over every document and photo as its own file, so each can
  be saved and filed separately: on phones and tablets it opens the share
  sheet with all of them (Save to Files saves each one), and elsewhere it
  downloads one uncompressed `.zip` holding them in a `shift-packet-<date>`
  folder. Photos are named after what they go with, e.g.
  `citation-001-100000-B4-S23-photo-1.jpg` or `shift-11-02-2026-photo-1.jpg`. Afterwards the app offers to remove
  what was submitted from the packet. Unlike drafts, packet documents include
  their drawn signatures, so they stay on the device until removed.
- **Photos:** **Add photos** on a citation (next to Pictures attached) or an
  incident report (under the description) puts them in the packet linked to
  that document, named after it; on a citation it also ticks Pictures
  attached: Yes. **Add shift photos** in the Shift packet section adds
  general photos. Photos are shrunk to 1600 px JPEGs before they're stored.
  Removing a document from the packet removes its photos too.
- The sun/moon button switches light and dark mode. It follows the device
  setting until used, then remembers the choice on that device.
