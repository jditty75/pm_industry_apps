# DM UX visual review guide (Phase 1 prototypes)

Interactive **localhost-only** prototypes for Baseline, Concept A, and Concept B. Not production UI. No Apps Script deploy.

## Launch

From repo root (`C:\JD`):

```powershell
.\preview.ps1 DM_UX
```

Aliases: `.\preview.ps1 UX`

No browser open:

```powershell
.\preview.ps1 DM_UX -NoOpen
```

Stop server:

```powershell
.\preview.ps1 --stop
```

Default URL after launch:

`http://127.0.0.1:18765/DM_UX.html`

(Port may differ if 18765 is busy — read the console `serve:` line.)

## Prototype control panel

Fixed dark bar at top (amber accent). Changes apply immediately without restarting the server.

| Control | Values |
|---------|--------|
| Concept | Baseline — Current DM · Concept A · Concept B |
| App | SLG · HENP · EVI · PDX |
| Visual | Current DM Evolved · Selective Workday |
| Access | T1 · T2 |
| Scenario | Mixed Portfolio, Low Satisfaction, Deployment History, Mixed Sentiment, Multi Product Area, No Responses, Low-n, Loading, Error, High Volume |

Hash params stay in sync when you use the panel (shareable URLs).

## Recommended review sequence

1. **Baseline SLG** — confirm familiar shell, MGM/PGL CSAT label, In-Flight CSAT structure.
2. **Concept A SLG CSAT Overview** — sub-nav, KPI hierarchy, drill to Responses.
3. **Concept B SLG CSAT Overview** — same data; open deployment from attention list.
4. **Concept B Responses** — drawer from account chip; sort headers.
5. **Concept B Customer Feedback (T2)** — provenance badges; switch to T1 restricted state.
6. **Concept B drawer** — Timeline with MDS→PGL on `syn-dep-001`; CSAT section comments at T2.
7. **Concept B HENP** — Student banner + drawer Student section on university deployment.
8. **Concept B EVI** — reduced tabs; drawer without CSAT.
9. **PDX** — Escalations tab + drawer section on escalation deployment.
10. **Low-n scenario (T1)** — suppressed aggregates.
11. **Loading / No Responses** — skeleton and empty states.
12. **Selective Workday** — same Concept B screens; compare branding only (IA unchanged).

## Stable review URLs (hash examples)

Replace host/port if your server differs.

1. Baseline SLG:  
   `http://127.0.0.1:18765/DM_UX.html#concept=baseline&app=SLG&feature=csat&tier=T2&scenario=mixed-portfolio`
2. Concept A SLG CSAT Overview:  
   `http://127.0.0.1:18765/DM_UX.html#concept=conceptA&app=SLG&feature=csat&section=overview&tier=T2&scenario=mixed-portfolio`
3. Concept B SLG CSAT Overview:  
   `http://127.0.0.1:18765/DM_UX.html#concept=conceptB&app=SLG&feature=csat&section=overview&tier=T2&scenario=mixed-portfolio`
4. Concept B Responses:  
   `http://127.0.0.1:18765/DM_UX.html#concept=conceptB&app=SLG&feature=csat&section=responses&tier=T2&scenario=mixed-portfolio`
5. Concept B Customer Feedback:  
   `http://127.0.0.1:18765/DM_UX.html#concept=conceptB&app=SLG&feature=csat&section=feedback&tier=T2&scenario=mixed-sentiment`
6. Concept B drawer MDS→PGL:  
   `http://127.0.0.1:18765/DM_UX.html#concept=conceptB&app=SLG&feature=csat&section=overview&deployment=syn-dep-001&drawerSection=timeline&scenario=deployment-history`
7. Concept B HENP + Student:  
   `http://127.0.0.1:18765/DM_UX.html#concept=conceptB&app=HENP&feature=csat&section=overview&tier=T2&scenario=mixed-portfolio`
8. Concept B EVI reduced shell:  
   `http://127.0.0.1:18765/DM_UX.html#concept=conceptB&app=EVI&feature=overview&tier=T1&scenario=mixed-portfolio`
9. Low-n T1:  
   `http://127.0.0.1:18765/DM_UX.html#concept=conceptB&app=SLG&feature=csat&section=overview&tier=T1&scenario=low-n`
10. Loading:  
    `http://127.0.0.1:18765/DM_UX.html#concept=conceptB&app=SLG&feature=csat&section=overview&scenario=loading`
11. Empty:  
    `http://127.0.0.1:18765/DM_UX.html#concept=conceptB&app=SLG&feature=csat&section=overview&scenario=no-responses`
12. Selective Workday (Concept B overview):  
    `http://127.0.0.1:18765/DM_UX.html#concept=conceptB&app=SLG&feature=csat&section=overview&treatment=workday&tier=T2&scenario=mixed-portfolio`

## Visual review checklist

- [ ] Still recognizably Deployment Manager?
- [ ] Concept A meaningfully better than baseline?
- [ ] Concept B drawer solves navigation without feeling bolted on?
- [ ] Drawer size acceptable (~40% width)?
- [ ] CSAT feels like one coherent subsystem?
- [ ] Scan speed / information hierarchy?
- [ ] Tables dense enough?
- [ ] Portfolio → deployment transitions intuitive?
- [ ] T1 useful, not broken?
- [ ] Customer Feedback sensitivity / provenance clear?
- [ ] MDS→PGL history understandable?
- [ ] Selective Workday: better, worse, or different?
- [ ] Archivo on headings/KPIs: helps hierarchy or hurts density?
- [ ] HENP + Student still one product?
- [ ] EVI reduced shell feels complete, not empty?

## Accessibility (prototype)

Addressed in concept code (not WCAG certification): visible `:focus-visible`, tab/sub-nav roles, drawer dialog semantics, sortable header buttons, restricted-state messaging, reduced-motion for skeleton/drawer, non-color-only low-score cues where practical.

## Typography note

Selective Workday loads **Archivo** from Google Fonts for headings/KPI numerals only in the prototype. If offline, the stack falls back to system fonts — hierarchy difference may be reduced.

## Approval gate

Record visual approval explicitly:

**CSAT / DM UX VISUALLY APPROVED**

Until that phrase is given by Jeff:

- No R3 production UI
- No production CSS/shell redesign
- No production deployment drawer

## Related

- Build spec: [preview-concept-spec.md](preview-concept-spec.md)
- UI data needs: [`skills/gas-monorepo-engineer/dm-ux-concept/UI-DATA-NEEDS-INVENTORY.md`](../../skills/gas-monorepo-engineer/dm-ux-concept/UI-DATA-NEEDS-INVENTORY.md)
- Implementation: `skills/gas-monorepo-engineer/dm-ux-concept/` (isolated; not CLASP-pushed)
