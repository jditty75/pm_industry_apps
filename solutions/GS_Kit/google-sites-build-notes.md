# Google Sites Build Notes — Deployment Health Manager

Practical implementation notes to supplement
[design-spec.md](design-spec.md) and
[google-sites-build-checklist.md](google-sites-build-checklist.md).

## Approximating cards with three-column layouts

Google Sites' layout picker includes multi-column row layouts. Use a
3-column row for each card section (Industry Portfolio Apps, Product
Portfolio Apps):

- Insert a layout row and choose the 3-equal-columns option.
- In each column, stack: an optional accent image, a heading text box, a
  body text box, and a button — in that order.
- Keep the same element order and spacing in all three columns so the row
  reads as a consistent set of cards rather than three unrelated blocks.
- If Sites' column layout doesn't visually separate the cards enough,
  use a light background box behind the content in each column (either a
  Sites "box"/card element, if available, or a light-bordered image behind
  the text) so each card reads as its own unit.
- On narrower viewports, Sites will typically stack the three columns
  vertically automatically — accept this rather than trying to force a
  fixed-width layout.

## Using accent-bar images above cards

- `card-top-accent.svg` is sized with transparent padding so it can sit at
  the very top of a card column without extra spacing adjustments.
- Insert it as the first element in each card column, above the title.
- Keep its display width matched to the column width so the orange bar
  reads as a clean top edge rather than a floating shape.
- `card-accent-bar.svg` is a plain thin bar without padding — use it as a
  divider between two stacked elements (e.g., under the title, above the
  description) rather than as a top-of-card element.
- Don't use both accents on the same card unless the mockup calls for it —
  one accent per card is enough to read as "designed" without becoming busy.

## Using a custom content section instead of the default header

Google Sites' built-in header (site name banner) is tied to site-wide
settings and offers limited layout control (typically a title/logo/cover
image band). To get a compact, precisely arranged header:

- Set the site's built-in header to its smallest/plainest option, or hide
  the site name if Sites allows it.
- Build the real header as the **first content section on the page**: a
  full-width row containing the logo image on the left and a text box with
  "Workday Professional Services" on the right, using Sites' row alignment
  options (left-align one element, right-align the other, or use a
  2-column layout with the logo in the left column and text in the right).
- This keeps the header's height, spacing, and content fully under manual
  control instead of depending on Sites' banner behavior.

## Keeping built-in navigation minimal

- This is a single-page front door — it does not need a multi-page
  navigation menu.
- If Sites automatically adds a navigation bar for site pages, keep it to
  a single entry (or hide it if the site truly has only one page) so it
  doesn't compete visually with the custom header.
- Do not add extra pages, dropdowns, or nav items unless the scope of the
  site changes beyond this front door.

## Handling Google Sites limitations

- **No custom shadows/hover states:** accept Sites' default flat card
  appearance; rely on color, spacing, and the accent-bar assets for visual
  interest instead of trying to fake shadows with layered images.
- **No arbitrary border radius:** use Sites' built-in card/button shape as-
  is rather than attempting to simulate rounded corners with image
  cropping.
- **Limited font control:** pick the closest built-in theme font pairing
  once, in the theme editor, and don't try to override individual text
  elements with different fonts.
- **SVG upload quirks:** if an SVG doesn't upload cleanly, displays with
  unexpected padding, or is otherwise rejected, export it as a PNG (see
  [assets/png/README.md](../GS_Kit/assets/png/README.md)) and use that
  instead — Sites' image handling for PNG/JPG is generally more reliable
  than for SVG.
- **Column reflow you can't fine-tune:** don't fight Sites' responsive
  breakpoints; verify the stacked mobile layout still reads clearly instead
  of trying to force a fixed multi-column layout at every width.

## Updating URLs later

1. Update the relevant row in [link-inventory.md](link-inventory.md) first
   — this file is the source of truth for what should be live.
2. In the Google Sites editor, select the corresponding "Launch Tool"
   button and update its link to the new URL.
3. Republish the site.
4. Re-test that specific button per the Testing section of
   [google-sites-build-checklist.md](google-sites-build-checklist.md).

## Updating the support owner later

If ownership or support responsibility for Deployment Health Manager moves
from Jeff Ditty to a team or group alias:

1. Update the footer statement in [site-copy.md](site-copy.md) and on the
   live site to reference the new contact (name and/or group alias).
2. Update the "Owner" column in [link-inventory.md](link-inventory.md).
3. Update the "Owner/support" reference in [README.md](README.md).
4. Confirm the new owner/group has edit access to the Google Site itself
   (Sites sharing settings), not just to the underlying Apps Script
   projects, so future URL or copy updates don't depend on a single
   individual.
