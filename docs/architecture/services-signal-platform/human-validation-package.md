# Ten-deployment human validation package

Business validation is performed by deployment leadership. Engineering provides a **read-only evidence layout** and optional export tooling.

## Profiles to cover (~10 deployments)

1. Stable Green / stable schedule  
2. Long-tenure Green  
3. Yellow or Red current health  
4. Recent health deterioration  
5. Health recovery  
6. Significant parent or function target movement  
7. Multiple current Product Function production dates (`PRODUCT_FUNCTION` grain)  
8. Mix of completed and remaining Product Functions  
9. Open DHP + Action History + schedule movement  
10. Sparse or incomplete history (warnings expected)

## Per-deployment evidence checklist

Present only what is needed to validate:

- Current health and `Deployment_Trajectory` health metrics  
- `Deployment_Trajectory_HealthEvents` (if any)  
- Current MTP, parent target/actual fields from `SFDC_Deployments`  
- `Deployment_Trajectory_MtpEvents` (parent vs function events)  
- Actual vs target semantics on function rows  
- `mtp_analysis_grain` and PF rollups  
- DHP linkage (ids, recency) — narrative from `SFDC_DHPActionHistory` when relevant  
- `build_warnings` / reconciliation status  

## Closing question (required)

> Does this trajectory tell the same story a knowledgeable deployment leader would tell?

## Sanitized fixtures

Format reference: `libraries/DepMngr/test/fixtures/deployment-validation-profiles.json` (synthetic ids only).

## Generating a real package (local, read-only)

1. Export tabs to CSV under a **gitignored** folder (e.g. `.ai/signal-exports/`).  
2. Run PF history diagnostic if schedule questions remain:  
   `node scripts/diagnose-deployment-trajectory-pf-history.js --history ... --product-functions ... --mtp-events ...`  
3. In SLG Apps Script editor, run `debugDeploymentTrajectoryForDeployment('<deploymentId>')` for deep JSON (no sheet mutation).  
4. Assemble a short markdown or spreadsheet review tab from exports — **do not commit** customer exports.

## Next step after validation

Freeze Deployment Trajectory **v2** deterministics → implement Context Assembler → Sauna signal pilot (A/B vs production Exec Summary).
