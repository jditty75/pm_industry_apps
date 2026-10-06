# Production observation: header freshness badge stretch

**Class:** Shell finding (visual-polish-spec §13 O1). **Not fixed in production** as part of CSAT Overview V3 prototype polish.

## Symptom

In the DM header, the “Data as of …” freshness badge can stretch to the full height of the header card (tall oval), because `.header` uses `align-items: stretch` and the badge is a direct flex child.

## Prototype containment

The isolated V3 prototype mirrors production markup/CSS but adds a **prototype-only** override:

```css
#csat-overview-v3-app .header .freshness-badge {
  align-self: center;
}
```

This is scoped to `#csat-overview-v3-app` so it does not imply a CoreLib change.

## Likely production fix (for a future whole-app review)

`align-self: center` on `.freshness-badge` (or equivalent) in `libraries/DepMngr/src/CoreUI_Css.js` — requires separate authorization and regression check across DM apps.

## Verification

Production UI was **not** browser-verified in this task. The prototype observation matches the pre-polish diagnosis in [visual-polish-spec.md](visual-polish-spec.md) D27.
