# What CSAT Overview V3 teaches about Deployment Manager

**Recorded only. Nothing outside CSAT Overview is redesigned here.** These lessons refine the portable principles in [../csat-reconciled-architecture/dm-design-principles.md](../csat-reconciled-architecture/dm-design-principles.md) (P-1…P-14) with what the visual pass showed.

| # | Lesson | Seen in CSAT Overview | Question for the whole-app review |
|---|---|---|---|
| L-1 | **Message before evidence** | V2 showed about 40 numbers and no conclusion. V3 leads with one figure and a rules-based sentence | Does each DM overview-type tab (Overview, Portfolio Health, Reporting summary) state its conclusion in words before showing tiles or tables? |
| L-2 | **Deterministic interpretation is a product feature** | A small published vocabulary (strong/mixed/concerning, stable/improving/declining, limited evidence), each word with a rule and visible inputs | Where does DM already imply judgements through colour (RAG, momentum) without a stated rule? Could one shared vocabulary serve all lenses? |
| L-3 | **Deployment-first drill-down** | Every count resolves to named deployments in ≤ 2 steps | Do Portfolio Health, Trends and Reporting figures drill to their deployments? |
| L-4 | **Portfolio-to-deployment traceability** | Programme measure kept separate from deployment counts. No composite | Does any DM portfolio figure re-weight or blend deployments in a way the reader cannot trace? |
| L-5 | **The operational horizon deserves first-screen space** | The survey round + prepare-by deadline outranks historical analytics for EMs | Go-live horizon, override expiry and escalation SLAs: are DM's other irreversible or time-boxed moments as visible as CSAT's? |
| L-6 | **State vs evidence vs action** | Survey state, customer verdict, follow-up expectation and evidence gap each have their own words, place and destination | Which DM indicators mix "what is happening", "what was observed" and "what someone must do"? |
| L-7 | **Progressive disclosure with three levels** | Message → named attention → collapsed evidence. A native `<details>` replaces extra cards | Could DM adopt one disclosure idiom instead of per-feature modals, drawers and secondary tiles? |
| L-8 | **Controls should be quiet when defaults are right** | The scope bar became one text button. Freshness moved to the header badge | Header controls (View-as, personalization, product mode) and per-tab filter bars: which dominate pages whose default scope is nearly always correct? |
| L-9 | **Scope is stated once** | V2 repeated scope four times. V3 says it in the headline sentence | Do tabs restate the active personalization / product mode consistently, once? |
| L-10 | **Empty and low-volume states are content** | "No concerns among 13 responses · silence isn't a verdict" | Do DM's 21 empty-state variants say what *is* known, or only what is absent? |
| L-11 | **Lifecycle through grouping, not diagrams** | Eyebrows (Prepare · Survey · Respond · Follow up · Learn) made the process legible at no visual cost | Can the deployment lifecycle (start → MDS → go-live → PGL → hypercare) be expressed the same way across tabs? |
| L-12 | **Name the system of action in the item** | "in Qualtrics", "missing contact → SFDC" | Do DM attention items say where the fix happens? |

Candidate first test, when the whole-app review starts: apply L-1, L-3 and L-8 to the app-level **Overview** and **Portfolio Health** tabs. They make the most overlapping "portfolio health" claims (`POTENTIAL_OVERLAP` in dm-design-principles §3).
