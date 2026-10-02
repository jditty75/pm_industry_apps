# Horizon Curves

Workday's signature structural element: a wide, shallow arc that acts as the edge
of a color band, standing in for a plain straight section break. The brand reads it
as the horizon of a new work day (sunrise), so it is calm and gentle, never a
dramatic swoop. It is the single fastest way to make a page feel authentically
Workday instead of a generic AI site with flat stacked rectangles.

See it live on workday.com/en-us/why-workday.html: every major section is a
`horizon` wrapper whose top and/or bottom edge is a curve tinted the section's own
color (`darkTheme` = After Hours `#022043`, `lightTheme` = Paper `#FFFFFF`), so the
boundary between two bands reads as one continuous arced horizon line.

## Table of contents

1. The rule of restraint (read first)
2. The workhorse: a two-color section divider
3. Recoloring and gradient-filling the curve
4. Placement, seams, and direction
5. Full curved-edge sections (hero / feature / footer)
6. Half-horizon content containers
7. Split / multi-panel curved tops
8. The brand path library (source of truth)
9. Do / don't

---

## 1. The rule of restraint (read first)

The brand guideline is explicit and it is the easiest thing to get wrong:

- **One horizon moment per page.** The guideline caps horizon containers at one per
  page for feature images, and icons at "one clear horizon curve, two maximum." A
  page where every section break is a curve looks seasick and off-brand. Pick the
  one transition that matters most (usually hero-to-body, or body-to-footer) and
  curve that. Leave the rest as clean color-blocked bands (see Cards and surfaces
  in SKILL.md).
- **Keep it shallow.** On brand the arc rises about 5% of its width (roughly a 1:20
  depth-to-width ratio). At a full-bleed ~1440px width that is a ~70px rise. Deeper
  than ~8% stops reading as a horizon and starts reading as a hill or a wave.
- **The curve is centered and symmetric.** Full horizons peak dead center. Don't
  skew them.

## 2. The workhorse: a two-color section divider

For almost every web use, you want a thin full-width strip that sits between two
stacked color bands and turns the seam into an arc. The most foolproof form paints
both colors itself (a background rect in the receiving section's color, a path in
the spilling section's color), so it renders correctly no matter what is behind it
and needs no parent-background coordination.

Inline it directly in `index.html` markup at the boundary. Do NOT route horizon
curves through the icon catalog or `DriveApp` / `getSvgAsset`; the path data is
tiny, it needs to be recolored and gradient-filled per design, and inlining means
it renders in local `preview.py` with no Drive auth.

```html
<!-- End of a navy band, start of a paper band. Navy spills DOWN into paper. -->
<section class="band band--navy"> ... </section>

<svg class="horizon" viewBox="0 0 1440 60" preserveAspectRatio="none" aria-hidden="true">
  <rect width="1440" height="60" fill="#FFFFFF"/>              <!-- receiving band color -->
  <path d="M0,0 H1440 V60 Q720,-40 0,60 Z" fill="#022043"/>   <!-- spilling band color -->
</svg>

<section class="band band--paper"> ... </section>
```

```css
.horizon { display: block; width: 100%; height: 72px; }  /* height = the visible rise */
.band--navy  { background: #022043; }
.band--paper { background: #FFFFFF; }
```

Why it works:

- `preserveAspectRatio="none"` lets the `viewBox` stretch to the element's exact
  width and height, so the same path fits any screen. The `1440`/`60` numbers are
  just a coordinate space, not pixels; the real size is the CSS `width`/`height`.
- Because the strip paints both band colors, the arc is visible against either
  neighbor and there is no transparent gap to leak the wrong color.
- The rendered rise is controlled purely by the element's CSS `height`. Set it to
  about 5% of the page width (~64-96px on desktop) for an on-brand shallow curve.
  Drop it toward ~40px on mobile so the arc doesn't eat the viewport.

The path `M0,0 H1440 V60 Q720,-40 0,60 Z` is a flat top with a single quadratic
bottom edge that dips deeper at the corners than the center (the navy tongue arcs
down into the paper, matching the brand "bottom curve"). To flip the arc so the
center dips lower than the corners (a valley), use
`M0,0 H1440 V10 Q720,80 0,10 Z`. Both are valid; the brand allows the curve
"oriented up or down." Pick the one whose high side points toward the busier band.

## 3. Recoloring and gradient-filling the curve

Solid is the default and the safest. Set the two `fill` values to the two band
colors in play (see the palette and Safe Color Combinations in
`visual_guidelines.md`). The common pairs are After Hours `#022043` <-> Paper
`#FFFFFF`, Ink `#0F2E66` <-> Paper, and Business Card `#F1F3F6` <-> Paper.

For a single dark-moment accent, the spilling path can be filled with a brand
sunrise gradient instead of a flat color. Define the gradient in the SVG's own
`<defs>` (an inline SVG can't reach a CSS gradient) using stops copied from the
toolkit gradient library (see SKILL.md Step 3), and point the path's `fill` at it.
Use this at most once on a page, the same way gradient-filled headlines are rationed.

```html
<svg class="horizon" viewBox="0 0 1440 60" preserveAspectRatio="none" aria-hidden="true">
  <defs>
    <!-- Workday GO primary, from the toolkit gradient library; vertical sunrise -->
    <linearGradient id="horizonGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0"   stop-color="#8579CF"/>
      <stop offset="0.5" stop-color="#EEC9DB"/>
      <stop offset="1"   stop-color="#FFCF95"/>
    </linearGradient>
  </defs>
  <rect width="1440" height="60" fill="#022043"/>              <!-- receiving band: After Hours -->
  <path d="M0,0 H1440 V60 Q720,-40 0,60 Z" fill="url(#horizonGrad)"/>
</svg>
```

Give every `<linearGradient>` a unique `id` if a page has more than one inline SVG,
or later definitions will win and repaint earlier curves.

## 4. Placement, seams, and direction

- **Kill the hairline seam.** Sub-pixel rounding can leave a 1px light line where
  the strip meets a band. Overlap it: `.horizon { margin-top: -1px; margin-bottom: -1px; }`,
  or give the strip a `background` equal to one of the two colors as insurance.
- **Direction vocabulary** (mirrors the real page's `horizon--top` / `horizon--bottom`
  and `outward` / `inward` modifiers): a curve either caps the **bottom** of a band
  or the **top** of a band, and it either **spills outward** (the band's color
  bulges into its neighbor, convex) or **scoops inward** (the neighbor's color
  cuts into the band, concave). The two-color divider above expresses all four by
  swapping which color is the `rect` vs the `path` and flipping the path's arc.
- **One horizon line, shared.** When two adjacent sections both want a curve, do
  NOT stack two strips. Use a single divider between them. Two curves back-to-back
  create a lens/wave that isn't in the brand system (the only sanctioned
  double-curve is the dedicated `two-curves` shape in section 8, used as one unit).

## 5. Full curved-edge sections (hero / feature / footer)

When you want an entire band's edge to be the curve (a hero whose whole navy
background ends in an arc, or a photo feature that sits inside an arced container),
don't use a thin divider; give the section itself a curved edge with `clip-path`.
This keeps the section's real background (gradient, image, solid) and just trims the
edge.

The responsive way is an inline SVG `clipPath` in normalized `objectBoundingBox`
units (0-1), so it scales with the element. This normalized path is the brand
bottom curve (corners at full depth, center pulled up, a shallow hill) mapped into a
unit box. Note the top edge uses `L1,0`, not `H1` (an `H` command with a stray
second number silently collapses the clip and blanks the section):

```html
<section class="hero hero--curved"> ... </section>

<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <clipPath id="horizonBottom" clipPathUnits="objectBoundingBox">
      <path d="M0,0 L1,0 L1,1 C0.68,0.87 0.32,0.87 0,1 Z"/>
    </clipPath>
  </defs>
</svg>
```

```css
.hero--curved { -webkit-clip-path: url(#horizonBottom); clip-path: url(#horizonBottom); }
```

For a curved **top** (a footer that arcs up into the body) mirror it:
`M0,0.07 C0.32,0 0.68,0 1,0.07 V1 H0 Z`. Because `clip-path` cuts the box, pad the
curved edge generously (extra bottom padding on a curved-bottom hero, extra top
padding on a curved-top footer) so the arc never clips text; the corners sit at full
depth, so content near a corner needs the most clearance.

If a browser you must support lacks `clip-path` on the element, fall back to the
two-color divider from section 2 layered over a solid section; it looks the same for
solid backgrounds.

## 6. Half-horizon content containers

A half-horizon curves only one side and is meant to hold a feature image or a
headline block spanning between the layout margins, with left-aligned text
alongside. On the web this is a two-up: a curved media panel on one side, text on
the other. Use `clip-path` with a half shape (see the half paths in section 8,
normalized the same way as section 5) on the media panel, and keep the text panel a
plain column. Limit to one per page, same as full horizons.

## 7. Split / multi-panel curved tops

The split shapes are one horizon arc broken into 2, 3, or 4 side-by-side panels
with a thin gap between them, so a row of columns (cards, stats, logos) can share a
single curved top or bottom. On the web you rarely need the exact SVG: give the row
a curved container with `clip-path` (section 5) and let normal grid gutters supply
the gaps. Reach for the literal split path in section 8 only when you need the
brand-exact segmented look as one background image behind a fixed set of columns.

## 8. The brand path library (source of truth)

Exact path data lifted from the brand SVGs in
`Design Reverse Engineer/Brand Assets/horizon-containers-core` and
`.../horizon-containers-split`. All use fill `#0f2e66` (Ink) by default; recolor as
needed. These are the fidelity reference: use them when you want a byte-accurate
brand shape rather than the simplified quadratic in section 2. The guideline
inventory is exactly three full-horizon shapes and six half-horizon shapes.

### Core - full horizon (`viewBox="0 0 216 153"`)

- Bottom curve: `M108,142.65c39.41,0,76.92,3.63,108,10.35V0H0v153c31.08-6.72,68.59-10.35,108-10.35Z`
- Top curve: `M216,0c-31.08,6.72-68.59,10.35-108,10.35S31.08,6.72,0,0v153h216V0Z`
- Two curves (top and bottom): `M108,10.35C68.58,10.35,31.08,6.72,0,0v153c31.08-6.72,68.59-10.35,108-10.35s76.92,3.63,108,10.35V0c-31.08,6.72-68.59,10.35-108,10.35Z`

### Core - half horizon (`viewBox="0 0 108 153"`)

- Bottom curve, left: `M0,0v153c31.08-6.72,68.58-10.35,108-10.35V0H0Z`
- Bottom curve, right: `M0,142.65c39.41,0,76.92,3.63,108,10.35V0H0v142.65Z`
- Top curve, left: `M108,10.35C68.58,10.35,31.08,6.72,0,0v153h108V10.35h0Z`
- Top curve, right: `M108,0C76.92,6.72,39.42,10.35,0,10.35v142.65h108V0Z`
- Two curves, left: `M108,10.35C68.58,10.35,31.08,6.72,0,0v153c31.08-6.72,68.59-10.35,108-10.35V10.35h0Z`
- Two curves, right: `M108,0C76.92,6.72,39.42,10.35,0,10.35v132.3c39.41,0,76.92,3.63,108,10.35V0Z`

### Split - multi-panel (each is one path of separate panels)

Bottom curve:
- Two-split (`viewBox="0 0 219.6 153"`): `M108,0v142.65c-39.42,0-76.92,3.63-108,10.35V0h108ZM111.6,142.65c39.41,0,76.92,3.63,108,10.35V0h-108v142.65Z`
- Three-split (`viewBox="0 0 223.2 153"`): `M147.6,0v143.68c-11.73-.68-23.77-1.03-36-1.03s-24.27.35-36,1.03V0h72ZM0,0v153c21.44-4.63,45.93-7.8,72-9.32V0H0ZM151.2,143.68c26.07,1.52,50.56,4.68,72,9.32V0h-72v143.68Z`
- Four-split (`viewBox="0 0 456.8 153"`): `M232.2,0h108.4v136.1c-34.7-3-71.2-4.6-108.4-4.6V0ZM348.4,136.8c38.7,3.6,75.2,9.1,108.1,16.2V0h-108.1v136.8ZM.3,153c32.8-7.1,69.1-12.5,107.5-16.2V0H.3v153ZM115.6,136.2c34.9-3.1,71.6-4.7,109.1-4.7V0h-109.1v136.2Z`

Top curve:
- Two-split (`viewBox="0 0 219.6 153"`): `M108,10.35v142.65H0V0c31.08,6.72,68.58,10.35,108,10.35h0ZM219.6,0c-31.08,6.72-68.58,10.35-108,10.35v142.65h108V0Z`
- Three-split (`viewBox="0 0 223.2 153"`): `M147.6,9.32v143.68h-72V9.32c11.73.68,23.77,1.03,36,1.03s24.27-.35,36-1.03ZM0,0v153h72V9.32C45.93,7.8,21.44,4.63,0,0ZM151.2,153h72V0c-21.44,4.63-45.93,7.8-72,9.32v143.68Z`
- Four-split (`viewBox="0 0 456.8 153"`): `M224.7,21.5c-37.3,0-73.7-1.5-108.4-4.5v136h108.4V21.5ZM108.5,16.2C69.7,12.5,33.3,7.1.3,0v153h108.2V16.2ZM456.5,0c-32.8,7.1-69.2,12.5-107.5,16.2v136.8h107.5V0ZM341.2,16.8c-34.9,3-71.5,4.7-109,4.7v131.5h109s0-136.2,0-136.2Z`

Two curves (top and bottom):
- Two-split (`viewBox="0 0 219.6 153"`): `M108,10.35v132.3c-39.41,0-76.92,3.63-108,10.35V0c31.08,6.72,68.58,10.35,108,10.35h0ZM219.6,0c-31.08,6.72-68.58,10.35-108,10.35v132.3c39.41,0,76.92,3.63,108,10.35V0Z`
- Three-split (`viewBox="0 0 223.2 153"`): `M147.6,9.3v134.4c-11.7-.7-23.8-1-36-1s-24.3.4-36,1V9.3c11.7.7,23.8,1,36,1s24.3-.4,36-1ZM0,0v153c21.4-4.6,45.9-7.8,72-9.3V9.3C45.9,7.8,21.4,4.6,0,0ZM151.2,143.7c26.1,1.5,50.6,4.7,72,9.3V0c-21.4,4.6-45.9,7.8-72,9.3v134.4h0Z`
- Four-split (`viewBox="0 0 456.8 153"`): `M340.6,136.1c-34.7-3-71.2-4.6-108.4-4.6V21.5c37.3,0,73.7-1.7,108.4-4.7v119.2ZM456.5,0c-32.8,7.1-69.2,12.5-107.5,16.2v120.7c38.5,3.6,74.7,9.1,107.5,16.1V0ZM107.9,136.8V16.1C69.3,12.4,33.1,7.1.3,0v153c32.8-7.1,69.1-12.5,107.5-16.2ZM116.3,17v119.1c34.7-3,71.1-4.6,108.4-4.6V21.5c-37.3,0-73.7-1.5-108.4-4.5Z`

To use any brand path as a full-width divider, drop it into
`<svg viewBox="..." preserveAspectRatio="none">` with the matching `viewBox` and set
the element's CSS `width`/`height`. Because these paths carry a tall solid body with
only a shallow arc at the edge, they suit full curved-edge **sections** (a tall
element) better than thin dividers; for a thin strip prefer the section-2 quadratic,
whose arc fills most of its box.

## 9. Do / don't

- Do limit to one horizon moment per page; color-block the rest.
- Do keep the rise shallow (~5% of width) and the arc centered and symmetric.
- Do match the curve color to the two real band colors, from the brand palette.
- Do inline the SVG in `index.html`; recolor via `fill`; gradient via inline `<defs>`.
- Do overlap the seam by 1px to avoid a hairline gap.
- Don't stack two separate curves at one boundary; use one shared divider (or the
  dedicated `two-curves` shape) instead.
- Don't route horizon curves through the icon catalog or `DriveApp`; they aren't
  icons and inlining previews without Drive auth.
- Don't deepen the curve for drama, skew it off-center, or curve every section.
