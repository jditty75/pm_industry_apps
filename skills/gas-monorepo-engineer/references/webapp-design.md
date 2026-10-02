# Original GAS Web App Builder Reference


## GAS Technical Constraints

Hard constraints. Never violate them.

### File Structure and Serving

- Entry point: `doGet(e)` in Code.gs returning evaluated HTML (see skeleton above)
- CSS and JS must live inside `.html` files; GAS has no `.css` or `.js` file types. That is why styles live in `styles.html` and JS in `scripts.html`.
- Scriptlets (`<?!= ... ?>`, `<?= ... ?>`) are evaluated only when served via `createTemplateFromFile(...).evaluate()`
- Files pulled in through `include()` are inserted as raw content; scriptlets inside them never run. Keep all scriptlets in index.html.

### Client-Side Rules

- No ES modules. No `import`/`export`. All JS runs in global scope.
- No npm packages or build tools. Vanilla HTML/CSS/JS only.
- External libraries CAN be loaded via CDN `<script>` and `<link>` tags.
- `google.script.run` calls server-side functions asynchronously:
  ```javascript
  google.script.run.withSuccessHandler(fn).withFailureHandler(fn).functionName(args)
  ```
- localStorage is available for client-side persistence.

### `google.script.run` Serialization (data-backed tools)

`google.script.run` can only pass primitives (String, Number, Boolean, null), Arrays, and plain Objects between server and client. Date objects, Functions, and DOM elements are not safe and will silently break the call: the success handler may receive `null` or never fire, with no error surfaced.

**Critical rule:** when returning spreadsheet data to the client, always use `getDisplayValues()` instead of `getValues()`. `getValues()` returns JavaScript Date objects for date-formatted cells, which fail serialization. `getDisplayValues()` returns formatted strings, which are always safe.

```javascript
// BAD: Date objects break google.script.run
return sheet.getDataRange().getValues();

// GOOD: all values returned as safe strings
return sheet.getDataRange().getDisplayValues();
```

If you need numeric precision (not display-formatted numbers), sanitize server-side before returning:
```javascript
var data = sheet.getDataRange().getValues();
return data.map(function(row) {
  return row.map(function(cell) {
    return cell instanceof Date
      ? Utilities.formatDate(cell, Session.getScriptTimeZone(), 'dd-MMM-yyyy')
      : cell;
  });
});
```

### Data Tool Patterns (Sheets-backed apps)

- **Lock writes.** Concurrent submissions to the same sheet race; wrap any write in `LockService` so one request finishes before the next starts:
  ```javascript
  function appendRow(values) {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000); // ms; throws if it can't get the lock in time
    try {
      SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Data').appendRow(values);
    } finally {
      lock.releaseLock();
    }
  }
  ```
- **Batch I/O only.** One `getDataRange().getDisplayValues()` read, one `setValues()` write. Never loop `getRange(i, 1).getValue()` or `setValue()` per row - each call is a round trip to the Sheets backend and a 200-row sheet turns a sub-second operation into a multi-second one.
- **Escape sheet-sourced strings.** Sheet data is user-writable (anyone with edit access can put anything in a cell), so treat it like untrusted input on the client: render with `textContent` or an escaping helper, never `innerHTML`.
  ```javascript
  // BAD: a cell containing "<img src=x onerror=...>" executes
  cell.innerHTML = rowValue;

  // GOOD
  cell.textContent = rowValue;
  ```

### Brand Asset Serving from Google Drive

The asset catalog contains Google Drive File IDs. Serve them with `DriveApp` from Code.gs.

**Server-side helpers (include when brand assets are used):**

```javascript
// Returns raw SVG markup for inline rendering.
// Optional color parameter is best-effort only: it rewrites double-quoted
// fill="..." attributes so the icon isn't stuck on its original color before
// CSS loads. It does NOT touch single-quoted fills, style="fill:#..."
// declarations, stroke, or <style> blocks inside the SVG - don't rely on it
// for guaranteed recoloring. currentColor (below) is the real mechanism.
function getSvgAsset(fileId, color) {
  var svg = DriveApp.getFileById(fileId).getBlob().getDataAsString();
  if (color) {
    svg = svg.replace(/fill="[^"]*"/g, 'fill="' + color + '"');
  }
  return svg;
}

// Returns a base64 data URI for .png and .jpg assets
function getRasterAsset(fileId) {
  var blob = DriveApp.getFileById(fileId).getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}
```

**Template-time embedding (use when 10 or fewer assets):** load assets in `doGet()` and inject via `template.assets` as in the skeleton above. Render in index.html with scriptlets:

- SVG icons and logos (inline markup): `<div class="brand-icon"><?!= assets.iconDashboard ?></div>`
- Raster images (data URI): `<img src="<?= assets.logo ?>" alt="Workday">`

CRITICAL: raw SVG markup must be rendered with `<?!= ... ?>` (force-unescaped). With `<?= ... ?>` GAS HTML-escapes the markup and the icon renders as text. Regular text values like titles should use the escaping `<?= ... ?>` form.

**Async batch loading (use when more than 10 assets):**

```javascript
// Code.gs
function getBrandAssets(fileIds) {
  var result = {};
  fileIds.forEach(function(id) {
    var blob = DriveApp.getFileById(id).getBlob();
    result[id] = blob.getContentType() === 'image/svg+xml'
      ? blob.getDataAsString()
      : 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  });
  return result;
}
```

```javascript
// scripts.html client side
var ASSET_IDS = { dashboard: 'FILE_ID', chart: 'FILE_ID' };
google.script.run
  .withSuccessHandler(function(assets) {
    Object.keys(assets).forEach(function(id) {
      var el = document.querySelector('[data-asset="' + id + '"]');
      if (el) el.innerHTML = assets[id];
    });
  })
  .getBrandAssets(Object.values(ASSET_IDS));
```

**CSS for brand icons:**
```css
.brand-icon svg {
  width: 1.5em;
  height: 1.5em;
  vertical-align: middle;
}

.brand-icon svg path,
.brand-icon svg circle,
.brand-icon svg rect,
.brand-icon svg polygon {
  fill: currentColor !important;
}

.brand-icon--lg svg { width: 3em; height: 3em; }
.brand-icon--xl svg { width: 5em; height: 5em; }

.brand-icon { color: var(--icon-color, #0F2E66); transition: color 0.2s; }
.brand-icon:hover { color: #0057AE; }
```

**Recoloring:** CSS `currentColor` is the primary mechanism - wrap the rendered icon in `.brand-icon` (or a variant) and set `color` on that wrapper; the `fill: currentColor !important` rule above always wins, handles hover/theme changes, and works regardless of how the source SVG authored its fills (`fill="..."`, `fill='...'`, `style="fill:#..."`). Only pass `getSvgAsset`'s `color` param as a best-effort nicety for icons rendered outside any `.brand-icon` wrapper (its regex only rewrites double-quoted `fill="..."` attributes, so it can silently no-op on some source files) - don't depend on it for guaranteed recoloring.

The deploying user must have read access to the Drive files containing brand assets.

**Caching Drive reads.** Every `getSvgAsset`/`getRasterAsset` call is a `DriveApp` round trip; on a page with several icons that adds up on every load. Wrap them in `CacheService.getScriptCache()` (shared script-wide, 6-hour max TTL) keyed on file ID + color, since a recolored SVG is a different cached string than the uncolored one:

```javascript
function getSvgAsset(fileId, color) {
  var cache = CacheService.getScriptCache();
  var key = 'svg_' + fileId + '_' + (color || 'default');
  var cached = cache.get(key);
  if (cached) return cached;

  var svg = DriveApp.getFileById(fileId).getBlob().getDataAsString();
  if (color) {
    svg = svg.replace(/fill="[^"]*"/g, 'fill="' + color + '"');
  }
  // Cache values are capped at 100 KB; skip caching (but still return) anything larger.
  if (svg.length < 100 * 1024) {
    cache.put(key, svg, 21600); // 6 hours, the ScriptCache maximum
  }
  return svg;
}
```

Fine for icons (a few KB each); skip caching full-page raster assets that might exceed the 100 KB per-value limit.

### Prohibited Patterns

- No `<script type="module">` or `import` statements
- No local file path references (`./styles.css`, `../lib/util.js`)
- No `fetch()` or `XMLHttpRequest` to external APIs from client-side
- No `document.write()`; use DOM manipulation
- No assuming a stable web app URL across deployments; use relative references

---

## Rules

- **Brand compliance is non-negotiable.** Workday palette and Archivo typography in every app unless the user explicitly overrides.
- **Every file must be complete and functional.** No placeholder code, no "// TODO" stubs. Ready to push or paste and deploy.
- **No generic AI aesthetics.** No Inter/Roboto/system fonts, no Bootstrap-clone layouts, no left-border accent stripes on cards (see Cards and surfaces in Step 3). No generic purple-on-white "AI gradient"; brand gradients must come from the toolkit gradient library (Step 3).
- **Minimize external dependencies.** If a CDN library is used, justify it.
- **Never fabricate GAS APIs.** If uncertain whether an Apps Script method exists, use a known alternative.
- **Priority when constraints conflict**: Brand guidelines > Functionality > Visual design > Code brevity.

## Interaction Guidelines

- On revisions, edit only the affected sections of the files on disk and summarize what changed. Do not regenerate the whole app unless the change impacts core architecture. If the app folder has a `.clasp.json`, push the change live yourself via the Step 6 default path (push, then redeploy the existing deployment id) instead of handing back files to paste; otherwise just summarize. Do not repeat the manual copy-paste checklist on revisions.
- Track context across the conversation: app structure, color choices, data models, layout decisions, which brand assets were selected.
- If a request is technically impossible in GAS, explain the constraint and immediately offer the closest feasible alternative.
- If asked which icons are available, grep the catalog and list relevant options by filename.
