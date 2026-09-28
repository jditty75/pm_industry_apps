# Design Specification — Deployment Health Manager Google Site

This is a practical guide for manually building the page in Google Sites so
it reads as a modern, Workday-inspired system and approximates the approved
mockup as closely as native Sites components allow. It is not a pixel-exact
spec — see the Limitations section for where compromises are expected.

## Color tokens

| Name | Hex | Typical use |
|---|---|---|
| Dark navy / Ink | `#12376D` | Headings, header text, primary dark accents |
| After Hours navy | `#002B4C` | Optional deeper contrast/hover-adjacent accents |
| Workday blue / Ballpoint | `#005CB9` | Primary buttons ("Launch Tool") |
| Water Cooler blue | `#2B9CDC` | Secondary accents, link hover if configurable |
| Dark orange accent | `#FF5C00` | Accent bars, small highlight details only |
| Warm off-white / Keyboard | `#F7F3E8` | Section background alternation |
| White / Paper | `#FFFFFF` | Primary page background, card background |
| Light border blue | `#D7E3F3` | Card borders, dividers |

Use orange as an accent only (bars, thin highlights) — never as a large
fill, background, or button color. Reserve it for the small decorative
moments the SVG assets provide.

## Header layout

- Single full-width row at the very top of the page, above the hero.
- Build as a **custom section** (see
  [google-sites-build-notes.md](google-sites-build-notes.md)) rather than
  relying on the default Sites site-name header, so spacing and content can
  be controlled precisely.
- Background: White or Warm off-white.
- Height: compact — roughly 64–80px tall, not a full hero.
- **Logo placement:** far left, vertically centered. Insert the approved
  Workday logo image (supplied separately). Do not stretch or recolor it.
- **"Workday Professional Services" placement:** far right, vertically
  centered, single line. Use Dark navy (`#12376D`) text, medium weight.
- Optionally place `header-accent-bar.svg` as a thin full-width line at the
  very bottom edge of the header row to separate it from the hero.

## Hero layout

- Full-width section directly below the header.
- Background: White or Warm off-white (pick whichever contrasts with the
  header for a subtle separation).
- Optionally use `subtle-section-background.svg` as the section background
  image for gentle visual interest — confirm text stays readable on top of
  it.
- **Title** ("Deployment Health Manager"): large, centered or left-aligned
  (match mockup), Dark navy, largest heading style Sites offers (Heading 1
  / Title).
- **Subheading**: centered or left-aligned under the title, smaller than
  the title, dark gray or Dark navy at reduced weight, constrained to a
  readable line width (don't let it stretch full-bleed on wide screens).
- Generous vertical padding above and below (Sites' section padding
  setting, if available, or empty spacer rows).

## Section layout (Industry / Product Portfolio Apps)

- Each section begins with a heading ("Industry Portfolio Apps" /
  "Product Portfolio Apps") in Dark navy, Heading 2 style.
- Below the heading, a row of cards — three across where Sites' layout
  options allow a 3-column row on desktop.
- Alternate section backgrounds (e.g., White for one section, Warm
  off-white for the other) to visually separate the two card rows without
  adding heavy borders.
- Keep consistent spacing above/below each section.

## Card structure

Each card should contain, top to bottom:

1. Optional: `card-top-accent.svg` placed at the top of the card column for
   a thin orange accent detail.
2. **Title** — industry or product name only (e.g., "Healthcare"), not
   prefixed with "Deployment Health Manager." Dark navy, bold, Heading 3 or
   equivalent.
3. **Description** — one short sentence, standard body text, dark gray.
4. **Button** — labeled exactly "Launch Tool", Workday blue (`#005CB9`)
   background with white text, or an outlined navy button if Sites'
   button styles don't support a solid fill well. Linked to the
   corresponding Apps Script web app URL (see
   [link-inventory.md](link-inventory.md)).
5. Optional: `card-accent-bar.svg` beneath the button or beneath the title
   as a thin divider/accent.

Card container styling:
- White background with a Light border blue (`#D7E3F3`) border or Sites'
  built-in card/box style, if available.
- Consistent internal padding across all six cards.
- Consistent height is a "nice to have," not required — see Limitations.

## Footer layout

- Full-width section at the very bottom of the page.
- Background: Dark navy (`#12376D`) or After Hours navy (`#002B4C`) for
  contrast, with white or light text — or, if a dark footer clashes with
  the rest of the light page, use a light background with Dark navy text
  and a top border/accent bar instead. Choose whichever keeps contrast
  high and matches the mockup.
- Single centered line of text: the support statement from
  [site-copy.md](site-copy.md).
- No navigation links, no additional content — keep it minimal.

## Color usage summary

- **Backgrounds:** White and Warm off-white only, alternating by section.
- **Headings:** Dark navy.
- **Body text:** Dark gray or Dark navy at reduced weight/opacity — avoid
  pure black for a softer, modern feel if Sites allows custom text color.
- **Buttons:** Workday blue fill, white text.
- **Accents:** Dark orange, used only in thin bars/details from the SVG
  assets — never as a large area of color.
- **Borders/dividers:** Light border blue.

## Typography guidance (native Google Sites)

Google Sites' theme editor offers a limited set of font pairings and a
fixed heading hierarchy (Title, Heading 1–3, Subheading, body text). Use:

- **Title style** → hero title ("Deployment Health Manager").
- **Subheading style** → hero subheading.
- **Heading 2** → section headings ("Industry Portfolio Apps",
  "Product Portfolio Apps").
- **Heading 3** → card titles.
- **Body text** → card descriptions, footer text.

Pick one of Sites' built-in theme font pairs that reads as clean and modern
(a simple sans-serif for both headings and body is closest to the Workday
system). Avoid mixing more than one font pairing on the page — Sites
applies font choices site-wide via the theme, not per element, so this is
largely a one-time setup decision in the theme editor.

## Image asset usage

- Use the SVGs in `assets/svg/` as decorative accents only — headers,
  card tops, section backgrounds. See
  [assets/README.md](assets/README.md) for per-file guidance.
- If Google Sites renders an SVG poorly (sizing, cropping, or upload
  restrictions), export a PNG per
  [assets/png/README.md](assets/png/README.md) and use that instead.
- Never use a generated asset as a stand-in for the Workday logo.

## Accessibility notes

- Maintain high contrast: Dark navy text on White/Warm off-white
  backgrounds, white text on Workday blue buttons — both comfortably pass
  WCAG AA for normal text.
- Do not rely on orange accents alone to convey meaning; they are
  decorative only.
- Give every button a clear, descriptive label — "Launch Tool" is
  acceptable as-is since each card's title already establishes context
  immediately above it.
- Ensure the logo image has meaningful alt text (e.g., "Workday") once
  inserted.
- Keep the subheading and body text at a readable size — don't shrink body
  text below Sites' default body size to force a layout fit.
- Verify heading order is logical (Title → Heading 2 → Heading 3) rather
  than chosen purely for visual size.

## Limitations of Google Sites

Native Google Sites will not exactly reproduce the mockup. Expect these
gaps:

- No custom drop shadows on cards.
- No custom border-radius control beyond what Sites' built-in card/button
  styles provide.
- No custom hover states (button hover color, card hover elevation, etc.).
- Limited typography control — a fixed set of theme font pairs, no
  arbitrary font sizes/weights beyond the built-in heading levels.
- No pixel-level spacing control — spacing is governed by Sites' section
  and layout padding options.
- Column layouts may reflow to fewer columns at Sites' own breakpoints,
  which cannot be finely tuned.

## Recommended compromises

- Use Sites' built-in "card"/box layout element if available, rather than
  manually simulating a card with a text box and image, for more
  consistent spacing and borders.
- Accept Sites' default button shape/style and rely on color (Workday
  blue) to make it read as a primary action, rather than fighting the
  platform for a custom shape.
- Use the accent-bar SVGs to add the small amount of visual distinction
  (shadows/borders can't provide) that helps cards feel designed rather
  than plain.
- If three-column card rows collapse awkwardly on some screen sizes, prefer
  Sites' automatic responsive behavior over forcing a fixed layout — see
  [google-sites-build-notes.md](google-sites-build-notes.md).
