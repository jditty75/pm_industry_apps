# GoLives version history

Immutable GAS library versions are recorded in **Git** via the append-only ledger:

- `.ai/library-releases/golives.jsonl`

Planning: `.\release.ps1 GoLives -Plan`

Pin strategy: `docs/analysis/golives-family/golives-pin-strategy.md`

| Version | Date | Changes | Cut By |
|---|---|---|---|
| — | — | See ledger for post-tooling releases | — |

## How to cut a new version (after authorized release plan)

1. Validate via a consumer preview / family checks.
2. Authorized library push if needed.
3. `npm run version -- "Description"` in `libraries/GoLives`.
4. Bump all `*_GoLives` manifests per plan.
5. Authorized push + production deploy per consumer.
6. Append ledger row + commit.
