# Gradients in Apps: Heroes, Headlines, and Progress Fills

Full recipes for the gradient patterns the skill supports beyond flat
backgrounds: the gradient hero (the signature blue-to-peach opening section),
gradient-filled headlines (a rationed dark-moment accent), and gradient-filled
progress bars. For the gradient library itself (where stops come from, how to
inline them, direction convention), see SKILL.md Step 3 "Brand gradient
library" - read that first for the source-of-truth stops before using any
recipe here.

## Table of contents

1. Gradient hero (the blue-to-peach opening section)
2. Gradient-filled headlines (a dark-moment accent)
3. Gradient on a progress bar or any growing fill

---

## 1. Gradient hero (the blue-to-peach opening section)

The signature Workday page opener: a full-width section whose background is the
Workday GO night-crop gradient (deep blue at the top, flowing down through
purple and pink to a light peach base) with a single white headline pinned to
the dark top band. It is the same treatment as the workday.com "A unified AI
platform built to serve your entire organization." band. No card, photo, or
illustration required - the gradient plus one confident headline is the whole
design, and it reads as unmistakably Workday.

**Which gradient.** `workday-go-night-crop-4` from the toolkit gradient library,
authored specifically for background fills. It is the blue-to-orange Workday GO
gradient cropped so the base lands on soft peach instead of full orange. Run it
vertical (180deg) so the darkest blue is at the top under the headline. Exact
stops:

```
#2356aa 0%, #2559af 5%, #8579cf 35%, #c8a2e1 55%, #eec9db 75%, #ffdbba 95%, #ffd8b0 100%
```

**The contrast rule (the thing that makes or breaks it).** White text is only
legible on the top of this gradient. Measured against white: `#2356aa` is about
7:1 (AAA), the `#8579cf` midpoint at 35% is about 3.7:1 (passes AA for large
bold text only), and everything below ~40% (the light purples, pinks, and peach)
fails. So:

- Pin the headline block to the top of the section (`justify-content: flex-start`), never centered.
- Keep the big bold headline within the top third.
- Keep any smaller white text (eyebrow, subhead, CTA) tucked directly under the headline, in the top ~quarter where contrast clears 4.5:1.
- Never let white text cross the vertical midpoint. Below it, either leave the gradient blooming empty (it looks intentional and slick) or switch to Ink (`#0f2e66`) text on the peach.
- Give the section a generous `min-height` so "the top third" is a lot of pixels; a taller hero has more dark runway, so a wrapping headline still lands in the safe zone.

**Full recipe:**

```html
<section class="hero-gradient">
  <div class="hero-gradient__inner">
    <p class="hero-gradient__eyebrow">Workday AI</p>
    <h1 class="hero-gradient__title">A unified AI platform built to serve your entire organization.</h1>
    <p class="hero-gradient__sub">One system for HR, finance, IT, and operations, so every team works from the same source of truth.</p>
    <a class="hero-gradient__cta" href="#">See what's new <span aria-hidden="true">&rarr;</span></a>
  </div>
</section>
```

```css
.hero-gradient {
  /* workday-go-night-crop-4 (toolkit gradient library): deep blue -> light peach */
  background: linear-gradient(180deg,
    #2356aa 0%, #2559af 5%, #8579cf 35%,
    #c8a2e1 55%, #eec9db 75%, #ffdbba 95%, #ffd8b0 100%);
  background-color: #2356aa; /* solid fallback before paint */
  min-height: clamp(440px, 72vh, 780px);
  display: flex;
  flex-direction: column;
  justify-content: flex-start;      /* headline lives in the dark top band */
  padding: clamp(48px, 9vh, 120px) clamp(24px, 6vw, 96px) clamp(40px, 6vh, 80px);
}
.hero-gradient__inner { max-width: 60rem; }
.hero-gradient__eyebrow {
  color: #fff; font-weight: 700; font-size: 0.85rem;
  letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 1rem;
}
.hero-gradient__title {
  color: #fff; font-weight: 700; line-height: 1.08;
  font-size: clamp(2rem, 5vw, 4rem); margin: 0; max-width: 20ch;
  text-wrap: balance;
}
.hero-gradient__sub {
  color: #fff; font-size: clamp(1rem, 1.6vw, 1.375rem);
  line-height: 1.4; margin: 1.25rem 0 0; max-width: 46ch; opacity: 0.92;
}
.hero-gradient__cta {
  display: inline-flex; align-items: center; gap: 0.4em;
  margin-top: 2rem; color: #fff; font-weight: 600; text-decoration: none;
  border-bottom: 2px solid rgba(255,255,255,0.6); padding-bottom: 2px;
  transition: gap 0.2s, border-color 0.2s;
}
.hero-gradient__cta:hover { gap: 0.7em; border-color: #fff; }
```

The eyebrow, subhead, and CTA are all optional; the headline alone on the
gradient is the purest version. Keeping `justify-content: flex-start` plus the
`min-height` is what holds the whole block in the safe dark zone even as the
headline wraps.

**Variant: deep-navy top (closest to the workday.com screenshot).** The raw
night crop starts at a medium blue (`#2356aa`); the live homepage band reads
darker at the very top edge. Anchor After Hours before the blue for a richer,
more premium navy and extra white-text headroom:

```css
background: linear-gradient(180deg,
  #022043 0%, #2356aa 14%, #2559af 20%, #8579cf 44%,
  #c8a2e1 62%, #eec9db 80%, #ffdbba 96%, #ffd8b0 100%);
```

**Variant: compact, dark-only (short, centered headline).** When you want a
shorter hero with a vertically centered headline and can't guarantee the text
stays in the top third, crop the gradient to just the blue-to-purple range so
white text is legible across the whole band. You lose the peach bloom but gain a
safely centered headline (`#5642b1` is from agentic-it-set-a; ~5:1 on white):

```css
.hero-gradient--compact {
  min-height: clamp(300px, 46vh, 460px);
  justify-content: center;
  background: linear-gradient(180deg, #022043 0%, #2356aa 45%, #5642b1 100%);
}
```

**Variant: run it all the way to orange.** night-crop-4 ends on soft peach
(`#ffd8b0`). For a hero that reaches true Workday GO orange at the base, swap in
`workday-go-primary` stops (ending `#fd7e00`). The contrast rule is unchanged -
white type still only in the top third:

```css
background: linear-gradient(180deg,
  #4c66bc 0%, #8579cf 19%, #c8a2e1 44%, #eec9db 63%,
  #f9d5c6 69%, #ffdbba 75%, #ffcf95 83%, #ffbe61 89%, #fd7e00 100%);
```

**Transitioning out of the hero.** The peach base (`#ffd8b0`) blends naturally
into a Keyboard (`#fcf8e8`) or Paper (`#ffffff`) section below, so most heroes
need no divider - just stack the next section. If you want a crisp branded seam,
drop a single horizon curve at the hero's base that spills the peach into the
next band (see `horizon-curves.md`); that counts as the page's one horizon moment.

---

## 2. Gradient-filled headlines (a dark-moment accent)

On an After Hours background, a single hero headline can be filled with the brand sunrise gradient instead of solid Paper. Use it once per deck or page, on the hero/cover headline, not on every heading, or it stops reading as special. Only over After Hours or Ink; on light backgrounds the pastel stops wash out, so keep those headlines solid Ink. Always keep a solid fallback `color` so the text stays visible if `background-clip: text` is unsupported.

Match the gradient direction to the headline's shape, and the fill follows the eye the way the toolkit intends.

**One line: horizontal (90deg) on an inline `<span>`.** This is the one sanctioned use of a horizontal gradient on type (the brand otherwise reserves horizontal gradients for 3:1+ banners): one line of large, bold text running cool-blue left to warm-peach right. Put the gradient on an inline `<span>`, never the block element: a block-level `background-clip: text` picks up the full content-box width, so the fill stretches across the line's trailing whitespace and the crop looks off-center; an inline span hugs the glyphs.

```html
<h1 class="display"><span class="grad-text">Headline here</span></h1>
```

```css
.grad-text {
  /* Workday GO primary (from the toolkit gradient library), mid-crop: cool-left to warm-right */
  background: linear-gradient(90deg, #8579CF 0%, #C8A2E1 35%, #EEC9DB 65%, #FFCF95 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: #C8A2E1; /* fallback if background-clip:text is unsupported */
}
```

**Two lines: vertical (180deg) on the block element.** When the headline wraps to two lines, the gradient should run top-to-bottom across the whole headline: cool at the top of the top line, warm at the bottom of the bottom line, with one continuous transition spanning both. That requires the gradient to be painted over the full multi-line box, so apply it to the block heading itself (or a `display:block` span), NOT an inline span. Here the inline-span trick actively breaks: an inline element broken across two lines defaults to `box-decoration-break: slice`, which paints the background as if the fragments were rejoined into one single-line-tall strip, then slices it; a vertical gradient gets squeezed into one line's height and repeats identically on each line, so neither line spans the range. A block element's background box is the full two-line content box, so a 180deg gradient maps the top line to the top of the gradient and the bottom line to the bottom. Keep `line-height` tight (around 1.1) so the gradient hugs the glyphs from the top of the top line to the bottom of the bottom line instead of bleeding into the line leading.

```html
<h1 class="display grad-text-stack">Two-line headline<br>that spans the gradient</h1>
```

```css
.grad-text-stack {
  display: block;
  line-height: 1.1; /* tight, so the gradient hugs top-of-top-line to bottom-of-bottom-line */
  /* Workday GO primary (from the toolkit gradient library): cool-top to warm-bottom */
  background: linear-gradient(180deg, #8579CF 0%, #C8A2E1 35%, #EEC9DB 65%, #FFCF95 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: #C8A2E1; /* fallback if background-clip:text is unsupported */
}
```

## 3. Gradient on a progress bar or any growing fill

Anchor the gradient to the whole track, not the fill, so the bar reveals the gradient left-to-right as it grows instead of squeezing the entire spectrum into a sliver. Keep the gradient on the growing fill element, but lock its painted size to the full track width and stop it repeating:

```css
.progress-fill {
  width: 0;                    /* JS animates this up to 100% */
  background: linear-gradient(90deg, var(--grad-stops));
  background-size: 100vw 100%; /* paint at full track width, not fill width */
  background-repeat: no-repeat;
  transition: width 0.4s ease;
}
```

Use `100vw` when the track spans the viewport (a fixed top bar); use the parent's width for an inline bar.
