# Deployment, rollback, ledger, and reconciliation

## Classification first

Before any Apps Script mutation (`clasp push`, `deploy`, `version`, or equivalent), classify the target:

- **Production deployment:** updating a live app deployment. Requires fresh explicit user authorization.
- **Production-impacting shared source:** a library/source push consumed live at HEAD/development mode. Requires fresh explicit user authorization even without `clasp deploy`.
- **Non-production mutation:** only when repository/project configuration establishes that the target cannot affect production.

If impact is uncertain, stop before mutation and explain the ambiguity.

## Existing production app

After explicit production authorization:

1. Confirm target app, intended Git SHA, Git push state, required validation, and release description.
2. Read local `.clasp.json` only to confirm project/rootDir. Never print/copy its Script ID into tracked files.
3. Read tracked `gas.config.json`; require the configured production Deployment ID and validate any configured URL embeds the same ID.
4. Run `clasp show-authorized-user`; do not silently change identity.
5. Confirm the configured Deployment ID exists in read-only `clasp deployments` output and capture its current GAS version as `previousGasVersion`.
6. Push intended source from the correct project/rootDir when required.
7. If normal `clasp push` says it skipped/no changes but Git contains intended source not proven present on Apps Script HEAD, investigate before forcing. Confirm correct project, rootDir, source set, Git SHA, and that local/Git is authoritative. Only then may `clasp push --force` be used. Record that it was used and why.
8. Update only the configured deployment: `clasp deploy -i <CONFIGURED_DEPLOYMENT_ID> -d "<description> (git <short-sha>)"`.
9. Never use bare `clasp deploy` for an existing production app.
10. Re-run read-only `clasp deployments`; capture the new live GAS version. The Deployment ID and production URL must remain unchanged.
11. Perform a real smoke/self-test only when supported. If not performed, state `PRODUCTION DEPLOYED` but not `PRODUCTION VERIFIED`.
12. Append a deployment ledger event and commit/push that bookkeeping separately if the repo convention tracks it.

## Deployment ledger

Use append-only `.ai/deployments.md` when the repository does not define another ledger. Never rewrite prior events merely because a release was rolled back.

For each production deploy/rollback, record compactly:

```markdown
### <timestamp> — <application> — deploy|rollback
- Git source: <full-or-short SHA that produced the deployed source, when known>
- Deployment ID: <configured production deployment ID>
- Previous GAS version: <N>
- Live GAS version: <N>
- Production URL: <configured URL>
- Description: <release/rollback description>
- Verification: <checks actually performed, or "not performed">
- Result: success|failed|partial
```

For a rollback, `Git source` may remain the current development Git state while production serves an older GAS version; say so rather than altering Git to make them match.

## Rollback semantics

After explicit rollback authorization:

1. Read `gas.config.json`, `.ai/deployments.md`, Git history, and read-only `clasp deployments` as needed.
2. Identify the current production version and immediately previous known-good production GAS version. If ambiguous, present candidates and stop.
3. Prefer deployment-only rollback: repoint the existing configured Deployment ID to the known-good version using the supported version selector (for example `clasp deploy -i <ID> -V <VERSION> -d "Rollback: ..."`).
4. Do **not** by default run `git revert`, `git reset`, `clasp push`, or force-push. Git/local and Apps Script HEAD may remain ahead of production after rollback.
5. Confirm the configured production Deployment ID now reports the restored version and the production URL is unchanged.
6. Perform only available real verification; distinguish `ROLLED BACK` from verified rollback.
7. Append a rollback ledger event and commit/push the ledger.
8. Stop. Source remediation/redeployment is a separate task unless explicitly included by the user.

## Shared libraries

A library `clasp push` can be production-impacting when consumers reference HEAD/development mode. Inspect current consumer manifests before pushing a library; do not rely on stale hard-coded consumer lists.

If any live consumer uses HEAD/development mode, require fresh explicit production authorization and name affected consumers before mutation.

`clasp version` creates an immutable library version but does not prove consumers use it. Update consumer pins only according to repository dependency model and validate affected consumers.

## Emergency Apps Script editor reconciliation

Local/Git is authoritative during normal work. Do not routinely `clasp pull`.

If the user explicitly says an emergency/browser edit exists in Apps Script and must be recovered:

1. Preserve current local/Git state first.
2. Inspect remote Apps Script content using a temporary clone/directory or another non-destructive comparison method when practical.
3. Diff the emergency remote change against Git/local.
4. Port/reconcile the intended fix into authoritative local source deliberately.
5. Validate, commit, and push the reconciled change.
6. Only redeploy/push production after fresh production authorization if required.
