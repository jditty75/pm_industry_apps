# Google Sites Implementation Kit — Deployment Health Manager

This kit provides everything needed to manually build the Deployment Health
Manager front door as a native Google Site. It is a documentation and asset
package, not a piece of software.

## What this kit is

- Source-controlled copy (headlines, subheadings, card text, button labels,
  footer statement) ready to paste into Google Sites.
- A practical design specification describing layout, color usage, and
  typography guidance for native Google Sites components.
- A link inventory tracking the six destination Apps Script web app URLs.
- A step-by-step build checklist for manually assembling the site.
- Lightweight, restrained SVG accent assets that help a native Google Site
  visually approximate the approved mockup.

## What this kit is not

- **Not a deployable website.** There is no build step, server, or hosting
  target here — nothing in this folder runs.
- **Not an Apps Script web app.** This kit does not contain `.gs`/`.js`
  server code, `appsscript.json`, or any `clasp` project files.
- **Not embedded in Google Sites.** No iframe instructions, no embed codes,
  no Apps Script-in-Sites patterns are included anywhere in this kit.
- **Not a source of the Workday logo.** The approved logo asset is supplied
  separately and is never recreated, redrawn, or approximated here.

## Final implementation approach

The Deployment Health Manager front door is a single Google Site page,
manually assembled inside the Google Sites editor using native Sites
components (text boxes, images, buttons, and layout sections). This kit's
copy is pasted in, this kit's assets are uploaded as images, and each
"Launch Tool" button is manually linked to its corresponding Apps Script web
app URL. Google Sites' own publishing, sharing, and access-control
mechanisms are used as-is — no custom code is introduced.

## Owner / support

**Jeff Ditty** — jeffrey.ditty@workday.com

## Folder structure

```
GS_Kit
├── README.md                          This file
├── site-copy.md                       Paste-ready copy for the Google Site
├── design-spec.md                     Layout, color, and typography guidance
├── link-inventory.md                  Table of the six destination app URLs
├── google-sites-build-checklist.md    Step-by-step manual build checklist
├── google-sites-build-notes.md        Implementation notes and workarounds
└── assets
    ├── README.md                      How to use each asset
    ├── svg
    │   ├── header-accent-bar.svg
    │   ├── card-accent-bar.svg
    │   ├── subtle-section-background.svg
    │   └── card-top-accent.svg
    └── png
        └── README.md                  PNG export guidance
```

## How to use this kit

1. Read [design-spec.md](design-spec.md) to understand the intended layout
   and where native Google Sites will and won't match the mockup exactly.
2. Fill in the real Apps Script web app URLs in
   [link-inventory.md](link-inventory.md), replacing the placeholders.
3. Open the Google Sites editor and follow
   [google-sites-build-checklist.md](google-sites-build-checklist.md)
   step by step.
4. Copy text directly from [site-copy.md](site-copy.md) into the
   corresponding Sites text elements.
5. Upload the images in [assets/svg](assets/svg) (or PNG exports, see
   [assets/png/README.md](assets/png/README.md)) where the checklist calls
   for them.
6. Reference [google-sites-build-notes.md](google-sites-build-notes.md) for
   practical workarounds to Google Sites layout limitations.

## Reminders

- **The approved Workday logo must be supplied separately.** Nothing in
  `assets/` is a substitute for it — do not use any generated asset in the
  logo's place.
- **The final Google Site is manually built with native Google Sites
  components.** This kit does not automate that process; there is no script
  to run and no deployment step to trigger.
