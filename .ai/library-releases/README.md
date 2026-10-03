# Shared library release ledger

Append-only **JSON Lines** records for immutable GAS library cuts and consumer pin migrations.

- `depmngr.jsonl` — DepMngr / CoreLib (`*_DM`)
- `golives.jsonl` — GoLives (`*_GoLives`)

Agents append one line per completed library release (after verification). Do **not** fabricate historical rows that cannot be proven from Git + deployment evidence.

Each record schema (see `scripts/library_release/schema.py`):

| Field | Meaning |
|-------|---------|
| `library` | Registry key (`DepMngr`, `GoLives`) |
| `gasVersion` | Immutable library version number from `clasp version` |
| `gitSha` | Monorepo commit containing library source at cut time |
| `description` | Human release description |
| `releasedAt` | ISO-8601 UTC timestamp |
| `consumerPinsBefore` | `{ appId: { version, developmentMode } }` |
| `consumerPinsAfter` | Same shape after pin updates |
| `affectedConsumers` | App IDs touched |
| `verification` | What was run and outcome |

Planning is read-only; execution appends here.
