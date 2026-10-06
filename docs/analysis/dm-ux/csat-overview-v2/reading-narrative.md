# Reading narrative

This is written before any layout. The visual hierarchy in [overview-information-design.md](overview-information-design.md) is derived from it. If a region does not serve a step here, it does not appear.

## The narrative

A Deployment Manager user opens CSAT → Overview and should be able to say, in this order:

1. **"I know whose satisfaction I'm looking at."**
   Workday-led deployments (by default), the last 12 months, the response import date. Any inherited DM scope (personalization owner, product mode) is stated.
2. **"I know how satisfied those customers are."**
   One mean Overall Satisfaction for the scope, on the familiar 1–5 scale.
3. **"I know how much evidence that rests on."**
   How many responses from how many deployments, and how many of the deployments due to be surveyed we heard from. Evidence is read in the same glance as the score and is never blended into it.
4. **"I know what that looks like at each survey stage."**
   MDS and PGL side by side, each with its own score, response bands and evidence. Each stage is a different group of deployments, so this is not a journey.
5. **"I know whether it is changing, or that we can't tell yet."**
   Improving, Stable or Declining only when both 6-month halves have ≥10 responses. Otherwise: *Too few responses to determine direction.*
6. **"I know how partner-led results compare, without being distracted by them."**
   One muted reference row of observed partner-led PGL satisfaction beside Workday-led PGL. It shows what differs, never why.
7. **"I know which customers told us something concerning, and exactly what."**
   A short list of deployments with the triggering fact for each (score, stage, date). Low verdicts are listed before early warnings.
8. **"I know which delivery ratings deserve a look."**
   The one or two lowest-rated delivery dimensions (plus the highest, for balance), with their n. No causal language.
9. **"I know whether deployments that answered both surveys held their satisfaction."**
   Only if enough deployments have both MDS and PGL. Otherwise the page says the evidence is too thin.
10. **"I know whether missing evidence or a broken survey process limits what I just read."**
    Evidence gaps qualify the satisfaction reading directly beneath it. Survey Operations problems appear in a separate status line at the foot of the page.
11. **"I know where to go next."**
    Every signal is a link to a pre-filtered Responses view, a deployment CSAT history, or Survey Operations.

## Changes from the brief's draft narrative

- **Step 4 split from step 2.** A single scope-level score is read first, then broken down by stage. A manager asking "what is our Workday-led CSAT?" gets one answer at once. The MDS/PGL split follows directly beneath, so the stage view is never hidden.
- **Journey (step 9) separated from stage (step 4).** The stage rows already put MDS and PGL cohort scores side by side. A second "stage comparison" visual would repeat them. The journey step therefore uses only *paired deployments*, which is the only evidence that adds something new.
- **Evidence gaps moved next to satisfaction (step 10 → attached to step 3).** A gap changes how far the score can be trusted, so it is read where the score is read. Survey Operations issues are about process. They stay at the foot of the page so they never compete with outcomes.
- **"Where to go next" is not a region.** It is a property of every region: each one ends in a link.

## The sentence the page should support

> *"Workday-led customers rate us 4.3 out of 5 across 52 responses from 40 deployments. We've heard from most deployments that were due. That's stable against the previous six months. Partner-led PGL is a little lower at 4.0. Two customers gave us a low verdict, here's who and what. Schedule management is our lowest-rated area. Seven due surveys are still outstanding and two invitations bounced."*

If a user can say that after about 30 seconds on the page, Overview has done its job. Everything else belongs in Responses.
