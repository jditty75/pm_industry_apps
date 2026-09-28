# Google Sites Build Checklist — Deployment Health Manager

Step-by-step checklist for manually building the site in Google Sites.
Work through each section in order.

## Preparation

- [ ] Confirm the approved Workday logo asset has been received separately
      and is ready to upload (do not substitute any asset from this kit).
- [ ] Confirm all six Apps Script web apps are deployed (not just pushed to
      HEAD) and their production web app URLs are known.
- [ ] Fill in the real URLs in [link-inventory.md](link-inventory.md),
      replacing every `PASTE_..._URL_HERE` placeholder.
- [ ] Have [site-copy.md](site-copy.md) open in a second window/tab for
      copy-paste.
- [ ] Have the `assets/svg` files (or PNG exports, if used) accessible for
      upload.
- [ ] Confirm who should own the new Google Site (individual owner vs.
      shared drive/group — see
      [google-sites-build-notes.md](google-sites-build-notes.md)).

## Theme setup

- [ ] Create a new Google Site (or open the existing one designated for
      this project).
- [ ] Open the theme editor and choose a clean, modern font pairing
      (simple sans-serif for both headings and body).
- [ ] Set the site's default background to White or Warm off-white
      (`#F7F3E8`).
- [ ] If Sites' theme editor exposes an accent/button color setting, set it
      to Workday blue (`#005CB9`).
- [ ] Remove or minimize the default Sites site-name banner/header so the
      custom header section (below) is the only header the visitor sees.

## Header setup

- [ ] Add a custom section at the very top of the page (see
      [google-sites-build-notes.md](google-sites-build-notes.md) for how to
      build a compact custom header instead of the default banner).
- [ ] Insert the approved Workday logo image on the far left, vertically
      centered.
- [ ] Add a text box on the far right with "Workday Professional Services"
      in Dark navy (`#12376D`).
- [ ] Optionally insert `header-accent-bar.svg` as a thin divider at the
      bottom edge of the header section.
- [ ] Confirm the header row height stays compact (not a full hero) and
      looks correct at full browser width.

## Hero setup

- [ ] Add a full-width section directly below the header.
- [ ] Paste the hero title: "Deployment Health Manager" using the Title
      heading style, Dark navy.
- [ ] Paste the hero subheading text from [site-copy.md](site-copy.md)
      below the title, using the Subheading style.
- [ ] Optionally set `subtle-section-background.svg` as this section's
      background image; verify text remains fully readable on top of it.
- [ ] Confirm generous vertical spacing above and below the hero content.

## Industry card row setup

- [ ] Add a section heading: "Industry Portfolio Apps" (Heading 2, Dark
      navy).
- [ ] Insert a 3-column layout row (or the closest native equivalent).
- [ ] In column 1, build the **State & Local Government** card: title,
      description, "Launch Tool" button — paste text from
      [site-copy.md](site-copy.md).
- [ ] In column 2, build the **Higher Education / Nonprofit** card.
- [ ] In column 3, build the **Healthcare** card.
- [ ] Optionally add `card-top-accent.svg` and/or `card-accent-bar.svg` to
      each card for a consistent accent detail.
- [ ] Confirm all three cards have consistent internal padding and styling.

## Product card row setup

- [ ] Add a section heading: "Product Portfolio Apps" (Heading 2, Dark
      navy).
- [ ] Insert a second 3-column layout row.
- [ ] In column 1, build the **Evisort** card.
- [ ] In column 2, build the **HiredScore** card.
- [ ] In column 3, build the **Paradox** card.
- [ ] Confirm styling consistency with the Industry Portfolio Apps row
      (same card structure, spacing, and accent usage).

## Footer setup

- [ ] Add a full-width footer section at the bottom of the page.
- [ ] Paste the footer support statement from
      [site-copy.md](site-copy.md).
- [ ] Confirm footer contrast is high and legible against its background.
- [ ] Confirm no extra navigation, links, or content are in the footer
      beyond the single support statement.

## Link setup

- [ ] Link the **State & Local Government** "Launch Tool" button to its
      URL from [link-inventory.md](link-inventory.md).
- [ ] Link the **Higher Education / Nonprofit** button.
- [ ] Link the **Healthcare** button.
- [ ] Link the **Evisort** button.
- [ ] Link the **HiredScore** button.
- [ ] Link the **Paradox** button.
- [ ] Set each button link to open in a new tab, if Sites offers that
      option, so the front door page stays open in the visitor's browser.

## Validation

- [ ] Proofread all pasted copy against [site-copy.md](site-copy.md)
      exactly (titles, descriptions, button text, footer statement).
- [ ] Confirm card titles use only the industry/product name (no
      "Deployment Health Manager - X" prefixes).
- [ ] Confirm color usage matches [design-spec.md](design-spec.md) (navy
      headings, blue buttons, orange used only as thin accents).
- [ ] Confirm the Workday logo displays correctly, is not stretched or
      distorted, and is the approved asset (not a placeholder).
- [ ] Preview the page in Sites' built-in preview mode at desktop, tablet,
      and mobile widths.

## Testing

- [ ] Test all six "Launch Tool" buttons — confirm each opens the correct
      destination app.
- [ ] Test with the expected Google account (a normal Workday Professional
      Services user) to confirm each app opens as intended.
- [ ] Test with an account that may **not** have access to one or more
      destination apps, to confirm that app's own access controls behave
      as expected (e.g., an appropriate denial screen, not a broken link).
- [ ] Test in Chrome.
- [ ] Test at common screen sizes (desktop, laptop, tablet, mobile) to
      confirm the card rows reflow acceptably.
- [ ] Confirm the site URL is stable and shareable (copy it and open it in
      a fresh/incognito session to verify).
- [ ] Confirm each destination Apps Script app still enforces its own
      access controls when reached from the Google Site — the Google Site
      is a front door only and does not alter or bypass any app's existing
      permissions.

## Publish

- [ ] Set Google Sites sharing/publishing settings to the intended
      audience (e.g., Workday domain).
- [ ] Publish the site.
- [ ] Record the published site URL somewhere durable (e.g., alongside
      [link-inventory.md](link-inventory.md) or in team documentation).
- [ ] Share the published URL with Workday Professional Services.

## Post-publish maintenance

- [ ] When a destination app's deployment URL changes (a new deployment is
      cut), update [link-inventory.md](link-inventory.md) first, then
      update the corresponding button link in the live Google Site.
- [ ] Periodically re-test all six buttons after any destination app
      redeploy.
- [ ] If site ownership or support contact changes, update the footer
      statement and [link-inventory.md](link-inventory.md) — see
      [google-sites-build-notes.md](google-sites-build-notes.md) for
      guidance on moving to a group alias.
- [ ] Keep this kit's copy and link inventory in sync with whatever is
      live on the published site.
