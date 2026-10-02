# Deployment, CLASP mutation, and reconciliation

## Classification first

Before any Apps Script mutation (`clasp push`, `deploy`, `version`, or equivalent), classify the target:

- **Production deployment:** updating a live app deployment. Requires fresh explicit user authorization.
- **Production-impacting shared source:** a library/source push consumed live at HEAD/development mode. Requires fresh explicit user authorization even without `clasp deploy`.
- **Non-production mutation:** only when repository/project configuration establishes that the target cannot affect production. Do not infer this merely from a command name such as `push`.

If impact is uncertain, stop before mutation and explain the ambiguity.

## Existing production app

After explicit production authorization:

1. Confirm target app, Git SHA, clean/intended diff, and required validation.
2. Read local `.clasp.json` only to confirm project/rootDir. Never print/copy its Script ID into tracked files.
3. Read tracked `gas.config.json`; require `production.deploymentId`.
4. Run `clasp show-authorized-user`; do not silently change identity.
5. Ensure intended source is committed and pushed. Perform the pre-push audit if a push remains.
6. From the correct CLASP project directory, push source only when required by the deployment model.
7. Update the configured deployment only: `clasp deploy -i <CONFIGURED_DEPLOYMENT_ID> -d "<release description>"`.
8. Never use bare `clasp deploy` for an existing production app.
9. Capture Git SHA and Apps Script version/deployment output. Verify/smoke-test when the app provides a real mechanism.
10. Record release metadata using the repo convention. If none exists, use a compact append-only `.ai/deployments.md` record without secrets or Script IDs.

## Shared libraries

A library `clasp push` can be production-impacting when consumers reference HEAD/development mode. Inspect consumer manifests or repository-specific reference material before pushing a library.

If any live consumer uses HEAD/development mode, require fresh explicit production authorization and tell the user the affected consumers before mutation.

`clasp version` creates an immutable library version but does not by itself prove consumers use it. Update consumer pins only according to the repository's dependency model and validate affected consumers.

## Emergency Apps Script editor reconciliation

Local/Git is authoritative during normal work. Do not routinely `clasp pull`.

If the user explicitly says an emergency/browser edit exists in Apps Script and must be recovered:

1. Preserve the current local/Git state first (commit/stash safely as appropriate; never discard unrelated work).
2. Inspect remote Apps Script content without blindly replacing authoritative local source. Use a temporary clone/directory or another non-destructive comparison method when practical.
3. Diff the emergency remote change against Git/local.
4. Port/reconcile the intended fix into the authoritative local source deliberately.
5. Validate, commit, and push the reconciled change.
6. Only redeploy/push production after fresh production authorization if the reconciliation requires a production-impacting mutation.

## Rollback

After explicit rollback authorization:

1. Identify the current and immediately previous known-good release from release records and Git. If ambiguous, present candidates and stop.
2. Prefer updating the existing configured Deployment ID to a known-good Apps Script version when tooling supports it cleanly.
3. If source must be restored, create normal Git revert commit(s); never rewrite shared history.
4. Push rollback commits after the pre-push audit.
5. Redeploy only the configured production Deployment ID.
6. Verify the restored app using an available real check.
7. Append a rollback record linking the failed/current and restored Git/GAS states.
