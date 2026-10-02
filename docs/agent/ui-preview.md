# Local UI preview

Preview **layout and client-side UI** before any `clasp push` or production deployment. This is not Apps Script execution: no `SpreadsheetApp`, no live `google.script.run`, no production data.

## Quick start

From repo root (`C:\JD`):

```powershell
.\preview.ps1 SLG_DM
.\preview.ps1 --list
```

Or:

```powershell
python skills/gas-monorepo-engineer/scripts/preview_engine.py SLG_Capacity --no-open
```

Output: `.preview-out/<APP_ID>.html` (gitignored). Open in a browser manually with `--no-open`.

## Supported applications

Authoritative list: [`config/ui-preview.json`](../../config/ui-preview.json) (`previewSupport` per app).

| Support | Meaning |
|---------|---------|
| `FULL` | Static shell renders faithfully; little or no server data |
| `PARTIAL` | Shell, CSS, and structure render; data APIs are mocked |
| `NOT_YET` | Documented gap — do not assume preview works |
| `NO_STANDALONE_UI` | Libraries (`DepMngr`, `GoLives`) — preview a consumer |

## What is mocked

- `google.script.run` — chained no-op with console warnings
- `google.script.host` / `google.script.url`
- DepMngr `CoreLib.CoreUI.*` — inlined from **local** `libraries/DepMngr/src` via Node VM
- `APP_CONFIG` for DM apps — evaluated from local `Config_*.js` + `Code.js` constants
- Brand Drive assets (`<?!= assets.* ?>`) — placeholder SVGs (four-file / include apps)

## What is real

- Local HTML/CSS/JS source from `solutions/<app>/src`
- DepMngr stylesheet and client bundle strings (same files that would ship in CoreLib)
- Include graph for multi-file HtmlService templates

## Limitations

- No server-side GAS APIs
- No production URLs or Script IDs
- DM apps: tabs may be empty until mock handlers are extended
- Go Lives / Capacity / Marketing: large tools need future mock datasets for interactive flows

## Agent workflow (UI changes)

1. Edit local source (and shared library UI files if the family requires it).
2. Run static checks that exist for the app (`preview_engine.py --lint --folder …` only for Chris four-file apps).
3. **`.\preview.ps1 <app>`** when `previewSupport` is `FULL` or `PARTIAL`.
4. Git diff / review; commit and push source.
5. State **`READY FOR PRODUCTION AUTHORIZATION`** — preview success is **not** production verification.
6. After **explicit** Jeff authorization in the same interaction: CLASP push/deploy and real smoke test.

See also [`skills/gas-monorepo-engineer/references/application-families.md`](../../skills/gas-monorepo-engineer/references/application-families.md).

## Adding preview for a new app

1. Add an entry under `applications` in `config/ui-preview.json` with `profile`, `srcDir`, `entry`, and `previewSupport`.
2. Reuse `html-includes`, `golives-index`, `dm-depmngr-webapp`, or `static-html` when possible.
3. If server templates need new substitutions, extend `preview_engine.py` or `gas_bundle_extract.mjs` — keep profiles declarative.
4. Document limitations in the app entry and run `.\preview.ps1 <app> --no-open` once to verify assembly.

## Safety

Preview tooling must never use production credentials, call production web app URLs by default, or write to Google services. Mock data is local and labeled in the preview badge.
