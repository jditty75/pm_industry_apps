# V2 visual diagnosis

Source: V2 Healthy and Risk pages, built from `skills/gas-monorepo-engineer/dm-ux-csat-overview-v2/` and captured at 1440×900 (see README, verification). Jeff's verdict: *"getting better, but still feels a little busy… it tries to give too much too fast."*

Counted by eye on the Healthy screenshot at 1440×900:

- **About 14 horizontal bands** before the satisfaction card ends: header, tabs, banner, sub-nav, scope bar, card title, headline label, headline row, table header, three table rows, stage note and qualifier.
- **About 40 numbers** in the satisfaction card alone.
- **4 controls**: segmented control, window select, Refresh, and the ⓘ button.
- **5 coloured pills**: three risk pills and two green freshness pills.
- **Two cards sit fully below the fold**, plus the Survey Operations strip.

## 1. What competes for attention

| Element | Why it competes |
|---|---|
| **Scope bar** (y≈310–352) | A full-width row with a filled blue segmented control, a select, a date range, a green freshness pill and a bordered Refresh button. It is the first saturated colour below the tabs, so the eye lands on *controls* before any *message* |
| **Two green pills** (header "Data as of", scope-bar "Responses imported") | Green reads as "good status". Here it means only "fresh data". Two green pills compete with the one fact that is actually about satisfaction |
| **The stage table** | Seven columns, three rows, and cells that wrap to three lines ("20 responses · / 17 / deployments", "Stable · 4.3 / → 4.4 (10 · 10 / responses)"). It is the densest and largest object, so it becomes the page's centre of gravity |
| **Risk card pills** | Red "Dissatisfied" pills are the most saturated marks on the page. They pull the eye right before the headline has been read |
| **Info banner** | A blue full-width bar that says what CSAT is. Every visit spends prime vertical space on a definition |

## 2. What requires too much interpretation

- **"4.3 / 5"** is a mean on a 1–5 scale. Is 4.3 good? The page never says. (It is also no longer the approved measure: J1.)
- **"17 · 2 · 1"** band counts under a bar. The reader has to decode the column header to learn the order.
- **"17 of 20 due" plus a 5-step meter.** The meter repeats the text, and the denominator is not yet trustworthy (DG-10).
- **"▬ Stable · 4.2 → 4.3 (24 · 28 responses)"** packs four facts into one phrase.
- **"2 deployments with a low verdict · 1 early warning"** uses two invented classes that the reader has to learn. Both are superseded by the guidebook's Detractor rule.
- **"↳ PARTNER-LED PGL · REFERENCE"** is a muted row inside the main table. The reader has to work out that it belongs to a different scope.

## 3. Valuable, but exposed too early

Per-survey satisfaction, band counts, per-survey evidence, heard-from coverage, per-survey direction with values, NPS, the partner-led reference row, the MDS/PGL stage note, the delivery-ratings profile (two lowest plus one highest), and MDS → PGL journey counts. All of these are true and useful. None is needed to decide whether to investigate. In V3 they become one fact each, or move into the disclosure ([drilldown-map.md §2](drilldown-map.md)).

## 4. Controls that dominate without need

- The delivery-leadership segmented control at full button size, with a filled active state. Workday-led is the default and changes rarely.
- The window select with a separate date range.
- The **Refresh** button. Refresh is maintenance, not monitoring.
- The ⓘ "how calculated" button competing with the card title.

## 5. Detail that belongs one level deeper

Table column headers, bars, meters, half-window counts, NPS sample size, "Not asked", the stage note, and the "View 7 evidence gaps" / "View responses" link pair in the card footer. Every region also repeated the scope/window subtitle: the scope was stated **four** times above the fold.

## 6. What is missing, which makes the page feel aimless

- **No survey horizon.** Upcoming and the preparation deadline, the primary operational use case, are absent. Survey Operations is a strip below the fold.
- **No sentence that says what the numbers mean.** The page is all evidence and no message.

## 7. What already fits DM and is retained

| Keep | Why |
|---|---|
| Real DM header, tab bar, `.csat-subtab-nav` underline sub-nav | Proportions and type are right |
| `.trends-section` card idiom (white, 1px border, radius 8, 16px padding) | Restrained, DM-native |
| Region title 14px/600 and muted 12px secondary text | Matches DM density |
| `.status-pill` with words, `.survey-pill` MDS/PGL tags | Familiar status semantics; text carries the meaning |
| Named deployment rows: pill + name link + stage tag + one fact line | The best part of V2. It is already deployment-first |
| Informative empty and low-n states ("too few responses…" as a normal state) | Honest, and does not look broken |
| Primary blue only for links and the active state; no orange or indigo | Correct colour budget |

**Net:** V2 failed on *sequence and density*, not on *visual language*. V3 keeps the language, removes the scope bar, banner and table from the first read, and adds the two things V2 lacked: a message and a horizon.
