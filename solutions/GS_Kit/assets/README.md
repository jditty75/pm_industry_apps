# Assets — Deployment Health Manager Google Site Kit

Lightweight, restrained decorative assets to help a native Google Site
approximate the approved mockup. All SVGs are simple, inline-only vector
shapes — no scripts, external references, embedded fonts, or base64 images.

**These assets are not, and are not a substitute for, the approved Workday
logo.** The logo is supplied separately and must be used as provided —
never recreated, redrawn, or approximated with anything in this folder.

## header-accent-bar.svg

- **Size:** 1440×6
- **Description:** A simple, full-width dark orange (`#FF5C00`) horizontal
  bar with slightly rounded edges.
- **Use:** Place as a thin divider at the bottom edge of the custom header
  section, separating the header from the hero section below it. Optional —
  omit if it doesn't read cleanly against your final header layout.

## card-accent-bar.svg

- **Size:** 420×6
- **Description:** A simple dark orange (`#FF5C00`) horizontal bar with
  rounded corners, sized for a single card column.
- **Use:** Place as a divider inside a card — for example, between the
  title and description, or beneath the "Launch Tool" button — to add a
  small consistent accent detail. Use at most one per card.

## card-top-accent.svg

- **Size:** 420×16
- **Description:** A mostly transparent canvas with a dark orange
  (`#FF5C00`) rounded bar (approximately 420×6) positioned at the top.
- **Use:** Place as the first element at the top of a card column, above
  the card title, so the card reads as having a clean accented top edge.
  This is the preferred accent for cards; use `card-accent-bar.svg` instead
  if you want an accent between two stacked elements rather than at the
  very top.

## subtle-section-background.svg

- **Size:** 1440×320
- **Description:** A warm off-white (`#F7F3E8`) background with very
  subtle, low-opacity decorative accents in dark navy (`#12376D`), Workday
  blue (`#005CB9`), and dark orange (`#FF5C00`). No patterns, text, or logo
  content.
- **Use:** Optional background image for the hero section. Confirm hero
  text remains fully readable when layered on top of it — if contrast
  suffers, use a plain warm off-white background instead and skip this
  asset.

## PNG fallback guidance

PNG versions of all four assets above are already provided in
[png/](png/) for cases where Google Sites has trouble uploading or
rendering an SVG cleanly (sizing, cropping, or format restrictions). See
[png/README.md](png/README.md) for the full file list and per-asset usage
guidance. Use the PNGs only as a fallback — the SVGs remain the source
assets.

## Reminder

Do not use any asset in this folder — now or after future edits — as a
substitute for the approved Workday logo. The logo is supplied separately
and is out of scope for this kit entirely.
