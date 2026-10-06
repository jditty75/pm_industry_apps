# Management attention model (Level 2) and supporting treatments

The five attention kinds from the reconciled architecture stay **separate**: different definitions, owners, systems of action and wording. They are never added into a "needs attention" total. Overview gives them **different visibility**.

## 1. The five kinds

| Kind | Definition (Overview) | Owner (programme) | System of action | Overview visibility |
|---|---|---|---|---|
| **Customer concern** | Deployment with ≥ 1 **Detractor** response (DSAT ≤ 3 or NPS ≤ 6) received in the **last 90 days** (V3-D4). A same-deployment MDS → PGL decline (PGL lower by ≥ 1 and now ≤ 3) adds a "Declined from MDS {v}" tag to the row. It is not a separate kind | Deployment Sponsor (else DD) for Workday-led | Qualtrics (conversation, ticket); DM (Notable, Executive Watch, Health Plan) | **Immediate.** Count in R1; named in R2 |
| **Prepare now** | `UPCOMING` survey in the **next round** with a readiness issue: required date missing, no customer PM or Executive Sponsor contact with email, or one of the two roles missing | EM (DD oversight) | SFDC; Services Care case | **Immediate.** Round + deadline in R1 C; named in R3 |
| **Chase now** | `IN_FLIGHT` survey where all invitations bounced, **or** closing ≤ 7 days with no response from any contact | EM | Customer conversation; VoC Slack for bounces | **Visible, subordinate.** One line in R3; leads R1 C only by the time-critical rule |
| **Follow-up expected** | Workday-led response received in the **last 30 days** (V3-D5): every MDS response (acknowledgement) and every Detractor (MDS or PGL). Never shown as completed, overdue or closed | MDS P/P: EM. Detractor: Deployment Sponsor (else DD) | **Qualtrics** | **Summarised.** A facet on R2 rows + one footer line in R2. The count appears in R1 only as "…, {f} with follow-up expected" |
| **Evidence gap** | Survey closed without response (while in the InFlight window) or `LAUNCH_NOT_SEEN`. Also, once DG-10 is validated, estimated-due deployments with no response | EM / DD (awareness); VoC for launch-not-seen | – / Slack (VoC) | **Behind an affordance.** One fact in R4. It enters R1 B only when evidence is limited (executive-message §5) |

**Why these three are immediate.** *Customer concern* is the main leadership and DS/DD question, and the guidebook's Detractor process exists for it. *Prepare now* is the primary operational use case: the launch is irreversible and the deadline is real (GB-15/17/18). *Chase now* is time-boxed too, but it is a smaller, EM-only action whose value peaks only in the last week. It stays visible as one line and is promoted by rule, not by layout. *Follow-up expected* is mostly routine (every MDS response creates one), so a big count would be false alarm. It is shown where it matters: on the concern rows. *Evidence gap* explains trust, so it lives with the evidence.

`CANNOT_FORECAST` (missing dates, so no survey month) is a **forecast limitation**. It appears as one muted line in R3 ("3 deployments can't be forecast: missing dates →"), because the fix is the same SFDC preparation work. It is not counted as Prepare now.

## 2. R2: Customer concerns

```
RESPOND · FOLLOW UP
Customer concerns                                         Last 90 days
[Detractor] Example Health Network                              PGL
  Satisfaction 2 · NPS 4 · 14 Sep · Follow-up expected: Deployment Sponsor · in Qualtrics
[Detractor] Sample Regional Medical Center                      MDS
  Satisfaction 3 · 5 Aug · Follow-up status in Qualtrics
…(≤ 4 rows) + "+k more in the last 90 days →"
Follow-up expected on 5 responses from the last 30 days (4 MDS acknowledgements, 1 Detractor) · tracked in Qualtrics
                                                    View all concerns in Responses →
```

| Rule | Detail |
|---|---|
| One row per deployment | Most recent Detractor response first. "+1 more response" when the deployment has several in the 90 days. Several respondents are never averaged |
| Fact line | "Satisfaction {v}" (DSAT) · "NPS {v}" (PGL only) · date · follow-up facet. No respondent role |
| Follow-up facet | Response ≤ 30 days old and Workday-led → "Follow-up expected: {owner role} · in Qualtrics". Older → "Follow-up status in Qualtrics". Partner-led → no facet (see §6) |
| Decline tag | Right of the name, before the survey tag: "Declined from MDS 5", neutral outline tag |
| Pill colour | Guidebook display band (GB-46): satisfaction 1–2 red, 3 or NPS-only yellow. The text is always "Detractor" |
| Empty state | "No Detractor responses in the last 90 days among {n90} responses received." Then muted: "{k} deployments had Detractor responses earlier in the 12-month window →" and/or "{g} surveys closed without a response: silence isn't a verdict →" |
| Never | Comments, themes, low-rating / negative-feedback early warnings (they are Responses lenses), owner names, status, "overdue" |

## 3. R3: Survey horizon (Upcoming + In Flight)

Upcoming is the primary operational use case, so it gets the top **two-thirds** of R3 and the only dated deadline on the page. In Flight gets the bottom third.

```
PREPARE · SURVEY
Survey horizon
Next round · Wed 4 Nov
9 deployments · 6 MDS · 3 PGL
Prepare by Wed 21 Oct · 12 days
2 with readiness issues:
  Example Children's Hospital        MDS     No Executive Sponsor contact
  Sample University Health           PGL     No customer contact with email
Following round · Wed 2 Dec · 7 deployments
3 deployments can't be forecast: missing dates →      (only if > 0)
──────────────
In flight · October round · closes 28 Oct
11 surveys · 3 responded · 8 without a response yet
1 to chase: all invitations bounced →
                                              Open Surveys →
```

| Element | Rule |
|---|---|
| Horizon | **Next round** in full, plus **one line** for the following round (≈ 30 / 60 days, J4 programme rules). A longer horizon belongs in Surveys |
| Counts | Deployments (one MDS and one PGL per deployment at most) with the MDS / PGL split. Never a % |
| Prepare-by | Open − 14 days, as weekday + date + "{k} days". ≤ 7 days with issues → ⚠ + yellow-fg text. After it passes: "Prepare-by date passed · launches {date} ({k} days)" in muted text. Correcting SFDC is still worth doing before launch, and the irreversible point is the launch itself (GB-15) |
| Readiness issues | Named, ≤ 3, issues before clean rows, nearest round first. The issue is named by its *missing role or date*. The word "ready" is never used (DM can see presence, not correctness) |
| No issues | "No readiness issues found (dates and contacts present)." |
| In flight | Round name + close date; "{s} surveys · {r} responded · {w} without a response yet". Bounced invitations are not "delivered"; delivery is inferred from no bounce and no finish (GB-24) |
| Chase | "{c} to chase: {reason}" with a breakdown when mixed: "4 closing in 6 days with no response · 2 all bounced". 0 → "Nothing to chase." |
| Launch not seen | Counts as an evidence gap (R4). R3 only adds "· {k} not yet seen in invitations" to the in-flight line |
| Scope | Follows the scope menu. Partner-led PGLs are forecast and in flight. In Partner-led scope the block reads "partner-led PGLs" |

## 4. R4: Learning and evidence (Level 3 entry)

Four labelled facts in one row, then the disclosure.

| Fact | Content | Rule |
|---|---|---|
| **Lowest delivery rating** | "Schedule management: 71% rated 4 or 5 (MDS, 21 responses)" | V3-D6: items with n ≥ 10, per survey (labels per survey; `aspect_value` never pooled; PGL `agree_sales_expectations` excluded until DG-15). Shown only when the item is ≥ 10 points below the median of eligible items on that survey. Otherwise "No delivery rating stands out (all within 10 points)". Fewer than 3 eligible on every survey → "Too few ratings to compare yet (10 per rating needed)". Wording is "lowest", never "driver" |
| **Recommendation (PGL NPS)** | "+41 · 31 responses" | PGL only, n ≥ 10. Otherwise "Not shown: fewer than 10 PGL responses ({n})". Never in R1 and never beside Top-2 Box at the same size |
| **Partner-led PGL, for context** | "74% rated 4 or 5 · 23 responses" | Default scope only. A quiet observed value: no delta, no "vs", no arrow, no ranking. In Partner-led scope it flips to "Workday-led PGL, for context". In All scope it is replaced by the composition "41 Workday-led · 23 partner-led responses" |
| **Evidence** | "7 deployments with Detractor responses in 12 months · 4 surveys closed without a response →" | The 12-month concern count (not "now") and the evidence-gap count, each with its own link. Due coverage appears here only after DG-10 validation, as "Heard from ~31 of 38 deployments due (estimated)". Until then: nothing. The disclosure explains why |

**Disclosure "Breakdown and method"** (collapsed `<details>`):

1. The single compact table, by survey: Top-2 Box (x of n), deployments, direction (with half values or "too few"), mean (detail only, one decimal), NPS (PGL), band counts satisfied · neutral · dissatisfied.
2. MDS → PGL journey counts (Workday-led, ≥ 5 pairs): "7 deployments answered both: held 5 · higher 1 · lower 1".
3. Method notes, one line each: Top-2 Box definition; a customer concern is a Detractor response (satisfaction ≤ 3 or NPS ≤ 6), so a 3 is neutral in a distribution but still triggers follow-up; the satisfaction words and their thresholds are DM rules, and the programme sets no target; the direction rule; earlier responses were restated by VoC to the 1–5 scale (when the window includes pre-Feb-2026); MDS and PGL ask about different stages and some different questions; coverage pending validation of the survey-due rule.
4. Freshness: "Responses imported 5 Oct 2026, 07:12 · Invitations imported 9 Oct 2026, 06:45".

## 5. Evidence strength: what the executive sees, and when

| Evidence fact | R1 | R4 | Disclosure |
|---|---|---|---|
| Responses (n) | Always (B) | – | Per survey |
| Deployments represented (d) | Always (B) | – | Per survey |
| Evidence tier (limited / too few) | Replaces the satisfaction word and figure | – | – |
| Direction sufficiency | "too few responses to tell direction" in B | – | Half counts |
| Surveys closed without response | Only at the LIMITED / INSUFFICIENT / NONE tiers | Always (count + link) | Definition |
| Estimated due coverage | Never in V1 | After DG-10 validation only | Method note on why it is absent |
| Today's `coveragePct` | **Never** (known invalid) | Never | Never |

## 6. Workday-led / partner-led context

- **Default lens:** Workday-led, stated in sentence A and in the scope menu label.
- **Quietest useful context:** one R4 fact ("Partner-led PGL, for context"). The reader learns where the Workday-led result sits, and the partner value never shares R1 or competes for size.
- **Switching:** the scope menu (Partner-led, All deployments). The composition stays the same. Text adapts:
  - Partner-led: sentence A uses "Partner-led". B adds "No partner-led MDS responses on record" (a fact, not a rule: DG-13). R2 rows show **no follow-up facet**, and the R2 footer says once: "Programme follow-up expectations cover Workday-led deployments; partner-led follow-up ownership is being confirmed with VoC." R3 shows partner-led PGLs. R4 context flips to Workday-led PGL. Team ratings carry the note "ratings may describe the partner team".
  - All deployments: A uses "across all deployments". B adds the composition "41 Workday-led · 23 partner-led responses". R2 rows add "· Partner-led" / "· Workday-led". Follow-up facets appear on Workday-led rows only.
- **Never:** side-by-side dashboards, deltas, "gap", rankings, winner/loser words, partner names.

## 7. Delivery Ratings and NPS: placement rationale

| | Placement | Why |
|---|---|---|
| Delivery Ratings | **One lowest-rated fact** in R4, or an honest "none stands out" / "too few" | Leadership needs one pointer to investigate, not a profile. A full matrix invites halo and false precision at these volumes |
| NPS | **R4 only**, PGL only, n ≥ 10 | It is a secondary PGL outcome with its own scale. Putting it in R1 would create two headline numbers and an implied composite |
