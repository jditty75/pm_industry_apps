# DepMngr version history

Immutable GAS library versions are recorded in **Git** via the append-only ledger:

- `.ai/library-releases/depmngr.jsonl` (one JSON object per line per release)

Planning (consumer pins, blast radius): `.\release.ps1 DepMngr -Plan`

Pin strategy: `docs/analysis/dm-family/corelib-pin-strategy.md`

Do not fabricate historical version rows in this file. Legacy table below is retained only as a placeholder.

| Version | Date | Changes | Cut By |
|---|---|---|---|
| — | — | See ledger for post-tooling releases | — |

## How to cut a new version (after authorized release plan)

1. Complete validation on HEAD canary consumer(s).
2. Authorized `npm run push` in `libraries/DepMngr` if needed.
3. `npm run version -- "Description"` in `libraries/DepMngr`.
4. Bump consumer `appsscript.json` pins per release plan.
5. Authorized push + production deploy per affected consumer.
6. Append ledger row + commit.
