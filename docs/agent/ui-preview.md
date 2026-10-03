# Local UI preview

Preview **layout and client-side UI** before any `clasp push` or production deployment. This is not Apps Script execution: no `SpreadsheetApp`, no live `google.script.run`, no production data.

## Quick start

From repo root (`C:\JD`):

```powershell
.\preview.ps1 SLG_DM
.\preview.ps1 --list
.\preview.ps1 SLG_DM -NoOpen
.\preview.ps1 --stop
```

Or:

```powershell
python skills/gas-monorepo-engineer/scripts/preview_engine.py SLG_Capacity --no-open
python skills/gas-monorepo-engineer/scripts/preview_selftest.py
```

## What happens when you preview

1. **Generate** — `preview_engine.py` assembles HTML under `.preview-out/<APP_ID>.html` (gitignored).
2. **Validate** — structural HTML checks (stdlib parser, marker checks, scriptlet/include detection). Generation **fails** if the artifact is not renderable HTML.
3. **Serve** — a tiny **localhost-only** server (`127.0.0.1`) serves `.preview-out/` with `Content-Type: text/html; charset=utf-8`.
4. **Open** — the default browser opens `http://127.0.0.1:<port>/<APP_ID>.html` (not `file:///`).

Stop the server when finished: `.\preview.ps1 --stop`.

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
- `APP_UI_CONFIG` / `APP_UI_CONFIG` stubs when server scriptlets are stripped
- Brand Drive assets (`<?!= assets.* ?>`) — placeholder SVGs (four-file / include apps)

## What is real

- Local HTML/CSS/JS source from `solutions/<app>/src`
- DepMngr stylesheet and client bundle strings (same files that would ship in CoreLib)
- Include graph for multi-file HtmlService templates

## Preview banner

Every generated file includes a **LOCAL PREVIEW** banner (preview output only; application source is never modified). Dismiss by clicking the badge.

## Limitations

- No server-side GAS APIs
- DM / Go Lives tabs may be empty until mock handlers and config stubs are extended
- **Shell markup may still contain production web app links** (e.g. “View as Read Only”) from evaluated config; preview JS does not call `google.script.run` against production
- Successful file generation alone is **not** verification — run structural validation and inspect the page in the browser when possible

## Agent workflow (UI changes)

1. Edit local source (and shared library UI files if the family requires it).
2. Run static checks that exist for the app (`preview_engine.py --lint --folder …` only for Chris four-file apps).
3. **`.\preview.ps1 <app>`** when `previewSupport` is `FULL` or `PARTIAL`.
4. Confirm `validate: PASS` and open the **localhost** URL; inspect layout in the browser when available.
5. Optional regression: `python skills/gas-monorepo-engineer/scripts/preview_selftest.py`
6. Git diff / review; commit and push source.
7. State **`READY FOR PRODUCTION AUTHORIZATION`** — preview success is **not** production verification.
8. After **explicit** Jeff authorization in the same interaction: CLASP push/deploy and real smoke test.

See also [`skills/gas-monorepo-engineer/references/application-families.md`](../../skills/gas-monorepo-engineer/references/application-families.md).

## Adding preview for a new app

1. Add an entry under `applications` in `config/ui-preview.json` with `profile`, `srcDir`, `entry`, and `previewSupport`.
2. Reuse `html-includes`, `golives-index`, `dm-depmngr-webapp`, or `static-html` when possible.
3. If server templates need new substitutions, extend `preview_engine.py` or `gas_bundle_extract.mjs` — keep profiles declarative.
4. Run `.\preview.ps1 <app> -NoOpen` and confirm structural validation passes.

## Safety

Preview tooling must never use production credentials, call production web app URLs by default, or write to Google services. The HTTP server binds to **127.0.0.1** only. Mock data is local and labeled in the preview badge.
