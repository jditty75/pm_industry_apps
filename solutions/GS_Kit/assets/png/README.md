# PNG Assets

This folder holds two families of PNG assets for the Google Site: the
original accent fallbacks (small decorative bars/backgrounds), and the
production divider and card images used directly as content images on the
page. All SVG sources live in [../svg](../svg).

## Section dividers and portfolio cards (production assets)

| PNG file | Exact size | Text | Notes |
|---|---|---|---|
| `divider-industry-portfolio-apps.png` | 1440×160 | "Industry Portfolio Apps" | Warm off-white (`#F7F3E8`) section-divider band |
| `divider-product-portfolio-apps.png` | 1440×160 | "Product Portfolio Apps" | Warm off-white (`#F7F3E8`) section-divider band |
| `card-state-local-government.png` | 720×300 | "State & Local Government" | White card, civic/government building icon |
| `card-higher-education-nonprofit.png` | 720×300 | "Higher Education / Nonprofit" | White card, graduation cap icon |
| `card-healthcare.png` | 720×300 | "Healthcare" | White card, heart + pulse icon |
| `card-evisort.png` | 720×300 | "Evisort" | White card, document/magnifying-glass icon |
| `card-hiredscore.png` | 720×300 | "HiredScore" | White card, person/magnifying-glass icon |
| `card-paradox.png` | 720×300 | "Paradox" | White card, chat-bubble icon |

Design values used across these assets: divider background `#F7F3E8`; card
background `#FFFFFF` with a `#D7E3F3` border; title text `#12376D`; icon
linework `#005CB9`/`#002B4C`; a short `#FF5C00` accent bar under each title.
No Workday logo, no third-party product logos, no buttons, no long
descriptions, and no portfolio-label text are included in any of these
images — per the kit's design system, "Launch Tool" buttons and any
portfolio labeling are added natively in Google Sites, not baked into the
image.

Source SVGs (exact same 1440×160 / 720×300 viewBoxes as the PNGs):

- [../svg/dividers](../svg/dividers) — `divider-industry-portfolio-apps.svg`, `divider-product-portfolio-apps.svg`
- [../svg/cards](../svg/cards) — one `card-*.svg` per file above

### How these were generated

Each PNG was rasterized 1:1 from its SVG source (same pixel dimensions as
the SVG's `width`/`height`/`viewBox`, no scaling) using `@resvg/resvg-js`
(the Rust `resvg` engine via a Node binding), run once from a disposable
scratch script outside this repository — no build tooling, dependency, or
`node_modules` was added to `GS_Kit` or committed here. Text was rendered
with explicit local font files (`C:\Windows\Fonts\segoeui.ttf` /
`segoeuib.ttf`) passed directly to the renderer instead of system font
matching, so output is deterministic and independent of whatever fonts a
future machine happens to have installed. This produces exact, reproducible
pixel dimensions with real anti-aliased vector rendering — not an
AI-generated image and not a screenshot.

To regenerate: point the same renderer at the SVG source and render at that
SVG's native width/height. Any SVG-to-PNG renderer that honors `width`/
`height` exactly (resvg, an actual browser print/screenshot at 1x, Inkscape
CLI export, etc.) will reproduce these files pixel-for-pixel as long as the
same font files are used for text.

### How to use these in Google Sites

1. Insert each `divider-*.png` as a full-bleed image at the top of its
   corresponding portfolio section (Industry vs. Product), sized to the
   section's full width — the image is already 1440px wide, matching a
   standard Sites page width, so avoid stretching it further.
2. Insert each `card-*.png` as the image for its app's card/column, above
   or as the card's header image. Cards are sized 720×300 (2:1) — if a
   layout has a narrower column, let Sites scale the image down
   proportionally rather than cropping it, so the border and icon aren't
   cut off.
3. Do not add another text title, portfolio label, or button inside the
   image area — the image already contains the title text and accent bar,
   and a native Sites "Launch Tool" button belongs directly below it per
   [../../google-sites-build-checklist.md](../../google-sites-build-checklist.md).

## Accent fallback assets (original set)

PNG versions of all four SVG assets from [../svg](../svg) are included in
this folder. Use these if Google Sites does not handle an SVG upload well
(rejected upload, incorrect sizing, or unwanted cropping) — the SVGs remain
the source assets; these PNGs are the fallback.

### Files created

| PNG file | Size | Background | Notes |
|---|---|---|---|
| `header-accent-bar.png` | 1440×6 | Transparent | Dark orange (`#FF5C00`) rounded bar, full width |
| `card-accent-bar.png` | 420×6 | Transparent | Dark orange (`#FF5C00`) rounded bar, card width |
| `card-top-accent.png` | 420×16 | Transparent | Rounded orange bar positioned near the top of an otherwise transparent canvas |
| `subtle-section-background.png` | 1440×320 | Opaque, warm off-white (`#F7F3E8`) | Very low-opacity navy/blue/orange decorative circles, no text or logo |

Each PNG matches the visual design, dimensions, and color values of its
corresponding SVG. `header-accent-bar.png`, `card-accent-bar.png`, and
`card-top-accent.png` use a transparent (alpha) background so they can sit
on top of any Sites section color. `subtle-section-background.png` is fully
opaque since it's meant to be a section background image itself.

### How these were generated

No image-editing software, browser, or third-party conversion tool was
available or reliable in this environment (headless browser screenshot
attempts hung indefinitely and were abandoned rather than left running).
Instead, the PNGs were produced by a small script using only Node.js's
built-in `zlib` and `fs` modules — no new npm packages, no network access,
and no external image-generation dependency were added to the repository.
The script draws each shape directly into a pixel buffer (with edge
anti-aliasing for the rounded corners and soft circles) and encodes it as a
standard PNG. The script itself was a one-time scratch utility and is not
part of this kit — regenerate by re-deriving it from the SVG specs in
[../svg](../svg) if these PNGs ever need to be rebuilt.

### How to use these in Google Sites

- **header-accent-bar.png** — insert at the bottom edge of the custom
  header section as a thin full-width divider between the header and hero.
- **card-accent-bar.png** — insert inside a card as a divider (e.g.,
  between the title and description, or beneath the "Launch Tool" button).
- **card-top-accent.png** — insert as the first element at the top of a
  card column, above the card title, so the card reads as having an
  accented top edge.
- **subtle-section-background.png** — set as the hero section's background
  image. Confirm hero text stays fully readable on top of it; if contrast
  suffers, skip this asset and use a plain warm off-white background
  instead.

Use at most one accent-bar asset per card, per the guidance in
[../README.md](../README.md) and
[../../design-spec.md](../../design-spec.md) — the goal is a restrained,
professional accent, not a busy layout.

### If you need higher-resolution versions later

These PNGs are exported at native (1x) size to match the SVG viewBox
dimensions exactly. If a higher-density (2x) version is ever needed for
crisper rendering on high-DPI displays, regenerate at these sizes:

| File | Native size | 2x size |
|---|---|---|
| header-accent-bar.png | 1440×6 | 2880×12 |
| card-accent-bar.png | 420×6 | 840×12 |
| card-top-accent.png | 420×16 | 840×32 |
| subtle-section-background.png | 1440×320 | 2880×640 |

## Reminder

None of these PNGs are, or substitute for, the approved Workday logo. The
logo is supplied separately and is out of scope for this kit entirely. None
recreate any third-party product logo (Evisort, HiredScore, Paradox) —
each is represented only by a generic, hand-drawn line icon plus its plain
text name.
