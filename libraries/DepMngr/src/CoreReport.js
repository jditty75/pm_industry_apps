/**
 * CoreReport.gs
 *
 * Shared report builder:
 * - Builds body sections (Executive Summary + all tables) from config.report.tables
 * - Special-case renderers for:
 *   - Red/Yellow deployments
 *   - Go Lives
 *   - Upcoming Go Lives
 * - Wraps sections in inline HTML shell and Outlook-optimized shell
 * - Provides helpers for:
 *   - Building full HTML
 *   - Building + running analytics
 *   - Exporting to Drive
 *
 * NOTE: This module does NOT reference app-specific globals; it uses AppConfig.
 */

var CoreReport = (function () {

  // --- PUBLIC HIGH-LEVEL API -------------------------------------------------

  /**
   * Builds the full inline (pure HTML) report for the given app.
   *
   * @param {AppConfig} config
   * @return {string} full <!DOCTYPE html> string
   */
  function buildInlineHtml(config) {
    var cfg = CoreConfig.withDefaults(config);
    var bodyContent = buildReportSections_(cfg, false);
    return wrapHtmlShellInline_(cfg, bodyContent);
  }

  /**
   * Builds the Outlook-optimized report for the given app.
   *
   * @param {AppConfig} config
   * @return {string} full <!DOCTYPE html> string
   */
  function buildOutlookHtml(config) {
    var cfg = CoreConfig.withDefaults(config);
    var bodyContent = buildReportSectionsForOutlook_(cfg);
    return wrapHtmlShellOutlook_(cfg, bodyContent);
  }

  /**
   * Convenience: run snapshot analytics, then build the inline report HTML.
   *
   * @param {AppConfig} config
   * @return {string}
   */
  function buildInlineHtmlWithAnalytics(config) {
    CoreAnalytics.update(config);
    return buildInlineHtml(config);
  }

  /**
   * Export inline + Outlook HTML files to the root of My Drive,
   * replacing existing files with the same names.
   *
   * @param {AppConfig} config
   * @return {void}
   */
  function exportInlineAndOutlookToDrive(config) {
    var cfg = CoreConfig.withDefaults(config);

    // 1) Ensure analytics are up to date (snapshots + dashboard)
    CoreAnalytics.update(cfg);

    // 2) Build HTMLs
    var htmlInline  = buildInlineHtml(cfg);
    var htmlOutlook = buildOutlookHtml(cfg);

    // 3) Write to Drive root
    var root = DriveApp.getRootFolder();

    // Inline version
    var filenameInline = cfg.report.inlineFilename;
    var existingInline = root.getFilesByName(filenameInline);
    while (existingInline.hasNext()) {
      existingInline.next().setTrashed(true);
    }
    root.createFile(filenameInline, htmlInline, MimeType.HTML);

    // Outlook version
    var filenameOutlook = cfg.report.outlookFilename;
    var existingOutlook = root.getFilesByName(filenameOutlook);
    while (existingOutlook.hasNext()) {
      existingOutlook.next().setTrashed(true);
    }
    root.createFile(filenameOutlook, htmlOutlook, MimeType.HTML);

    SpreadsheetApp.getActiveSpreadsheet().toast(
      filenameInline + ' and ' + filenameOutlook + ' saved to the root of My Drive.',
      '✅ Export Complete',
      7
    );
    Logger.log('✅ Saved: ' + filenameInline + ' and ' + filenameOutlook);
  }

  /**
   * Exports the V2 monthly report HTML to Drive root,
   * replacing any existing file with the same name.
   *
   * @param {AppConfig} config
   * @return {void}
   */
  function exportReportV2ToDrive(config) {
    var cfg = CoreConfig.withDefaults(config);

    var htmlV2 = buildReportV2WithAnalytics(cfg);

    var root = DriveApp.getRootFolder();
    var filenameV2 = cfg.report.v2ExportFilename;
    var existingV2 = root.getFilesByName(filenameV2);
    while (existingV2.hasNext()) {
      existingV2.next().setTrashed(true);
    }
    root.createFile(filenameV2, htmlV2, MimeType.HTML);

    SpreadsheetApp.getActiveSpreadsheet().toast(
      filenameV2 + ' saved to the root of My Drive.',
      '✅ Export Complete',
      7
    );
    Logger.log('exportReportV2ToDrive: ✅ Saved: ' + filenameV2);
  }

  // --- BODY SECTION BUILDER --------------------------------------------------

  /**
   * Builds the body sections (Executive Summary + all tables),
   * without the outer HTML shell.
   *
   * @param {AppConfig} config
   * @param {boolean} isOutlook
   * @return {string}
   * @private
   */
  function buildReportSections_(config, isOutlook) {
    var cfg = CoreConfig.withDefaults(config);
    isOutlook = !!isOutlook;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sections = [];

    // 1) Executive Summary block at the top
    var execHtml = CoreExecSummary.buildSectionHtml(cfg);
    if (execHtml) {
      sections.push(execHtml);
    }

    // 2) Render all configured tables
    (cfg.report.tables || []).forEach(function (tableCfg) {
      if (tableCfg.heading === 'Executive Summary') {
        return; // already rendered above
      }

      var sheet = ss.getSheetByName(tableCfg.sheetName);
      if (!sheet) {
        sections.push(renderMissingSheetSection_(tableCfg));
        return;
      }

      var tableRange = null;
      if (tableCfg.namedRange) {
        var nr = ss.getRangeByName(tableCfg.namedRange);
        if (nr) {
          tableRange = nr;
          Logger.log(
            '✅ Using named range "%s" for heading "%s": %s',
            tableCfg.namedRange,
            tableCfg.heading,
            nr.getA1Notation()
          );
        } else {
          Logger.log(
            '⚠ Named range not found: "%s" for heading "%s". ' +
            'Falling back to dynamic search using title "%s" on sheet "%s".',
            tableCfg.namedRange,
            tableCfg.heading,
            tableCfg.title,
            tableCfg.sheetName
          );
          tableRange = findTableDynamic_(sheet, tableCfg.title);
        }
      } else {
        tableRange = findTableDynamic_(sheet, tableCfg.title);
      }

      sections.push(renderTableSection_(cfg, tableCfg, tableRange, isOutlook));
    });

    return sections.join('\n');
  }

  /**
   * Outlook-specific: same content as buildReportSections_, but with
   * reduced bottom margin per section.
   *
   * @param {AppConfig} config
   * @return {string}
   * @private
   */
  function buildReportSectionsForOutlook_(config) {
    var html = buildReportSections_(config, true);
    // Reduce margin-bottom for Outlook layout
    html = html.replace(/margin-bottom:32px;/g, 'margin-bottom:12px;');
    return html;
  }

  // --- TABLE-FINDER ---------------------------------------------------------

  /**
   * Dynamic table finder used when a named range is not present.
   * It finds the title text and infers the header + table region below it.
   *
   * @param {Sheet} sheet
   * @param {string} title
   * @return {Range|null}
   * @private
   */
  function findTableDynamic_(sheet, title) {
    if (!title) return null;

    var data = sheet.getDataRange().getDisplayValues();
    var numRows = data.length;
    if (!numRows) return null;
    var numCols = data[0].length;

    var needle = CoreUtils.normalizeText(title);
    var candidates = [];

    for (var r = 0; r < numRows; r++) {
      for (var c = 0; c < numCols; c++) {
        if (CoreUtils.normalizeText(data[r][c]) === needle) {
          candidates.push({ row: r, col: c });
        }
      }
    }

    if (!candidates.length) {
      Logger.log('✗ Title not found on sheet "%s": "%s"', sheet.getName(), title);
      return null;
    }

    var match = candidates[0];
    var titleR = match.row;
    var titleC = match.col;

    var headerRow;
    var titleRowNonEmpty = data[titleR].slice(titleC).filter(function (cell) {
      return cell.toString().trim() !== '';
    }).length;

    if (titleRowNonEmpty <= 1 && titleR + 1 < numRows) {
      var nextRowNonEmpty = data[titleR + 1].slice(titleC).filter(function (cell) {
        return cell.toString().trim() !== '';
      }).length;
      if (nextRowNonEmpty > 1) {
        headerRow = titleR + 1;
      } else {
        headerRow = titleR;
      }
    } else {
      headerRow = titleR;
    }

    var endCol = titleC;
    for (var col = titleC; col < numCols; col++) {
      if (data[headerRow][col].toString().trim() === '') break;
      endCol = col;
    }

    var endRow = headerRow;
    for (var row = headerRow + 1; row < numRows; row++) {
      var slice = data[row].slice(titleC, endCol + 1);
      var isEmpty = slice.every(function (cell) {
        return cell.toString().trim() === '';
      });
      if (isEmpty) break;
      endRow = row;
    }

    var startR = headerRow + 1;
    var startC = titleC + 1;
    var numR = endRow - headerRow + 1;
    var numC = endCol - titleC + 1;

    if (numR <= 0 || numC <= 0) {
      Logger.log(
        '⚠ Title "%s" on "%s" found but no table data detected.',
        title,
        sheet.getName()
      );
      return null;
    }

    var range = sheet.getRange(startR, startC, numR, numC);
    Logger.log(
      '✅ Detected table for "%s" on "%s": %s',
      title,
      sheet.getName(),
      range.getA1Notation()
    );
    return range;
  }

  // --- HTML RENDERERS -------------------------------------------------------

  /**
   * Renders a full section: heading + optional description + table HTML.
   *
   * @param {AppConfig} config
   * @param {Object} tableCfg one element of config.report.tables
   * @param {Range|null} tableRange
   * @param {boolean} isOutlook
   * @return {string}
   * @private
   */
  function renderTableSection_(config, tableCfg, tableRange, isOutlook) {
    var headingHtml = renderSectionHeading_(tableCfg.heading);
    var descHtml = tableCfg.description
      ? '<p style="font-family:Arial,sans-serif; font-size:12px; color:#555555; ' +
        'margin-top:0; margin-bottom:10px;">' +
        CoreUtils.escapeHtml(tableCfg.description) +
        '</p>'
      : '';

    var tableHtml;

    if (tableCfg.title === 'RedYellow') {
      tableHtml = isOutlook
        ? buildRedYellowHtmlTableFromEffectiveDataForOutlook_(config, tableCfg)
        : buildRedYellowHtmlTableFromEffectiveData_(config, tableCfg);
    } else if (tableCfg.title === 'RecentGoLives') {
      tableHtml = buildRecentGoLivesHtmlTableFromEffectiveData_(config, tableCfg);
    } else if (tableCfg.title === 'FutureGoLives') {
      tableHtml = buildFutureGoLivesHtmlTableFromEffectiveData_(config, tableCfg);
    } else {
      if (!tableRange) {
        tableHtml =
          '<p style="font-size:11px; color:#cc0000; font-family:Arial,sans-serif;">' +
          '⚠ Table not found for title: "' +
          CoreUtils.escapeHtml(tableCfg.title || '') +
          '" on sheet "' +
          CoreUtils.escapeHtml(tableCfg.sheetName || '') +
          '". ' +
          'Run <b>Debug → Show detected table ranges</b> for details.' +
          '</p>';
      } else {
        tableHtml = buildHtmlTableAsBars_(config, tableCfg, tableRange);
      }
    }

    return (
      '<div style="margin-bottom:32px;">' +
      headingHtml +
      descHtml +
      tableHtml +
      '</div>'
    );
  }

  /**
   * Render missing sheet message for a section.
   *
   * @param {Object} tableCfg
   * @return {string}
   * @private
   */
  function renderMissingSheetSection_(tableCfg) {
    return (
      '<div style="margin-bottom:32px;">' +
      renderSectionHeading_(tableCfg.heading) +
      '<p style="font-size:11px; color:#cc0000; font-family:Arial,sans-serif;">' +
      '⚠ Sheet "' +
      CoreUtils.escapeHtml(tableCfg.sheetName || '') +
      '" not found. ' +
      'Unable to locate table for "' +
      CoreUtils.escapeHtml(tableCfg.title || '') +
      '".' +
      '</p>' +
      '</div>'
    );
  }

  /**
   * Standard section heading HTML.
   *
   * @param {string} text
   * @return {string}
   * @private
   */
  function renderSectionHeading_(text) {
    return (
      '<h2 style="font-family:Arial,sans-serif; color:#0f4c81; font-size:15px; ' +
      'border-bottom:2px solid #0f4c81; padding-bottom:4px; margin-bottom:6px;">' +
      CoreUtils.escapeHtml(text || '') +
      '</h2>'
    );
  }

/** 
 * Generic bar-table renderer (HealthTotal, PartnerTotal, ApproachTotal, etc.).
 *
 * For HealthTotal specifically, this version:
 * - Treats the bar column as a *count* column
 * - Scales the bar width relative to the max count in that column
 *   (so 266 is full width, 1 is very small, etc.)
 *
 * @param {AppConfig} config
 * @param {Object} tableCfg
 * @param {Range} range
 * @return {string}
 * @private
 */
function buildHtmlTableAsBars_(config, tableCfg, range) {
  var cfg = CoreConfig.withDefaults(config);
  var namedRange = tableCfg.namedRange || '';

  // Phase 3b: route the three migrated tables to code-computed breakdowns.
  // The range arg is not accessed for these named ranges.
  if (namedRange === 'HealthTotal')   return _renderHealthBreakdownFromCode_(cfg, tableCfg);
  if (namedRange === 'PartnerTotal')  return _renderPartnerBreakdownFromCode_(cfg, tableCfg);
  if (namedRange === 'ApproachTotal') return _renderApproachBreakdownFromCode_(cfg, tableCfg);

  var barCfg = (cfg.report.barConfig || {})[namedRange] || { columns: [] };
  var barCols = barCfg.columns || [];

  var isHealthTotal = (namedRange === 'HealthTotal');
  var isPartnerTotal = (namedRange === 'PartnerTotal');
  var isApproachTotal = (namedRange === 'ApproachTotal');

  var values = range.getDisplayValues();
  var bgs = range.getBackgrounds();
  if (!values || !values.length) {
    return '<p style="font-size:11px; font-family:Arial,sans-serif;">(No data)</p>';
  }

  var TABLE_STYLE =
    'border-collapse:collapse; width:100%; max-width:960px; ' +
    'font-size:11px; font-family:Arial,sans-serif;';
  var TH_STYLE =
    'border:1px solid #aaaaaa; background-color:#0f4c81; color:#ffffff; ' +
    'padding:6px 8px; text-align:left; white-space:nowrap; font-size:11px;';
  var TD_STYLE =
    'border:1px solid #dddddd; padding:5px 8px; ' +
    'text-align:left; font-size:11px;';

  var headerRow = values[0];

  // Data rows only (drop header + trailing empty rows)
  var dataRows = values.slice(1).filter(function (row) {
    return row.some(function (cell) {
      return String(cell || '').trim() !== '';
    });
  });

  // Determine how many real columns have any data
  var colCount = 0;
  values.forEach(function (row) {
    row.forEach(function (cell, ci) {
      if (cell.toString().trim() !== '') {
        colCount = Math.max(colCount, ci + 1);
      }
    });
  });
  if (!colCount) {
    return '<p style="font-size:11px;">(Table has no data)</p>';
  }

  // Decide which columns to display
  var displayCols = [];
  if (isHealthTotal) {
    // As in your existing config: show selected columns only
    var allowedCols1Based = [1, 2, 3, 8, 12];
    allowedCols1Based.forEach(function (c1) {
      var ci = c1 - 1;
      if (ci >= 0 && ci < colCount) displayCols.push(ci);
    });
  } else if (isPartnerTotal) {
    // partner total: first 3 non-empty columns
    for (var ci = 0; ci < Math.min(3, colCount); ci++) {
      displayCols.push(ci);
    }
  } else {
    for (var ci = 0; ci < colCount; ci++) {
      displayCols.push(ci);
    }
  }

  // For HealthTotal only, pre-compute the max count per bar column so we
  // can scale bars proportionally by count (not by absolute value 0–100).
  var maxCountForCol = {};
  if (isHealthTotal && barCols.length) {
    barCols.forEach(function (c1) {
      var ci = c1 - 1;
      var maxVal = 0;
      dataRows.forEach(function (row) {
        var raw = String(row[ci] || '').replace(/,/g, '').trim();
        if (!raw) return;
        var num = parseFloat(raw);
        if (!isNaN(num) && num > maxVal) {
          maxVal = num;
        }
      });
      maxCountForCol[ci] = maxVal;
    });
  }

  // THEAD
  var theadHtml = displayCols
    .map(function (ci) {
      return (
        '<th style="' +
        TH_STYLE +
        '">' +
        CoreUtils.escapeHtml(headerRow[ci]) +
        '</th>'
      );
    })
    .join('');

  // TBODY
  var tbodyHtml = dataRows
    .map(function (row, ri) {
      var defaultBg = ri % 2 === 0 ? '#ffffff' : '#f7f7f7';
      var bgsRowIdx = ri + 1; // backgrounds include header row at index 0

      // For HealthTotal, column 1 text color comes from the "Health" color
      var healthRowColor = null;
      if (isHealthTotal) {
        healthRowColor = String(row[3] || '').trim() || null;
      }

      var cellsHtml = [];
      displayCols.forEach(function (ci, di) {
        var v = row[ci];
        var bg = defaultBg;

        if (bgs[bgsRowIdx] && bgs[bgsRowIdx][ci]) {
          var rawBg = bgs[bgsRowIdx][ci];
          if (rawBg && rawBg !== '#ffffff' && rawBg !== '#000000') {
            bg = rawBg;
          }
        }

        var colIndex1 = ci + 1;
        var innerHtml;

        if (barCols.indexOf(colIndex1) !== -1) {
          // This is a bar column
          var labelText = v;
          var pct = null;
          var explicitColor = null;

          if (isHealthTotal) {
            // NEW BEHAVIOR:
            // - interpret v as a count
            // - scale relative to the max count in this column
            var raw = String(v || '').replace(/,/g, '').trim();
            var num = parseFloat(raw);
            var maxForThisCol = maxCountForCol[ci] || 0;
            if (!isNaN(num) && maxForThisCol > 0) {
              pct = CoreUtils.clamp((num / maxForThisCol) * 100, 0, 100);
            }
            // HealthTotal still uses the explicit color from the
            // existing "Health" color column
            explicitColor = String(row[3] || '').trim() || null;
          } else if (isPartnerTotal || isApproachTotal) {
            // Existing behavior for other bar tables
            var vStr = String(v || '').trim();
            var rawNumStr = vStr.replace('%', '').trim();
            var rawNum = parseFloat(rawNumStr);
            if (!isNaN(rawNum) && rawNum <= 1) {
              // Already a fraction or small value, show text only
              pct = null;
            } else {
              pct = CoreUtils.parsePercentage(v);
            }
          } else {
            // Default percentage-based behavior
            pct = CoreUtils.parsePercentage(v);
            if (isHealthTotal) {
              explicitColor = String(row[3] || '').trim() || null;
            }
          }

          if (pct !== null) {
            innerHtml = renderBarFromPctWithStyle_(
              pct,
              barCfg,
              explicitColor,
              labelText
            );
          } else {
            innerHtml = CoreUtils.escapeHtml(v);
          }
        } else {
          // Non-bar column
          innerHtml = CoreUtils.escapeHtml(v);
        }

        var extraStyle = '';
        if (isHealthTotal && di === 0 && healthRowColor) {
          extraStyle += ' color:' + healthRowColor + '; font-weight:bold;';
        }

        cellsHtml.push(
          '<td style="' +
            TD_STYLE +
            ' background-color:' +
            bg +
            ';' +
            extraStyle +
            '">' +
            innerHtml +
            '</td>'
        );
      });

      return '<tr>' + cellsHtml.join('') + '</tr>';
    })
    .join('');

  return (
    '<table style="' +
    TABLE_STYLE +
    '">' +
    '<thead><tr>' +
    theadHtml +
    '</tr></thead>' +
    '<tbody>' +
    tbodyHtml +
    '</tbody>' +
    '</table>'
  );
}

  /**
   * Render a percentage-width bar (0–100) using an inner table + label.
   *
   * @param {number} pct0to100
   * @param {Object} barCfg e.g. cfg.report.barConfig[namedRange]
   * @param {string|null} explicitColor
   * @param {any} labelText
   * @return {string}
   * @private
   */
  function renderBarFromPctWithStyle_(pct0to100, barCfg, explicitColor, labelText) {
    var pct = CoreUtils.clamp(pct0to100, 0, 100);
    var BAR_WIDTH  = 80; // px
    var BAR_HEIGHT = 24; // px

    barCfg = barCfg || {};
    var mode   = barCfg.mode   || 'solid';
    var colors = barCfg.colors || {};

    var color;
    if (explicitColor) {
      color = CoreUtils.escapeHtml(explicitColor);
    } else if (mode === 'threshold') {
      var highMin = (typeof colors.highMin === 'number') ? colors.highMin : 80;
      var midMin  = (typeof colors.midMin  === 'number') ? colors.midMin  : 50;
      if (pct >= highMin)      color = colors.high || '#4CAF50';
      else if (pct >= midMin)  color = colors.mid  || '#FF9800';
      else                     color = colors.low  || '#F44336';
    } else {
      color = colors.solid || '#0f4c81';
    }

    var remainderPct = 100 - pct;

    var innerTableHtml =
      '<table cellpadding="0" cellspacing="0" border="0" ' +
      'style="border-collapse:collapse; width:' + BAR_WIDTH + 'px; height:' +
      BAR_HEIGHT + 'px; background:#eeeeee; table-layout:fixed; font-size:1px; line-height:1px;">' +
      '<tr>' +
      '<td width="' + pct + '%" style="padding:0; margin:0; background:' + color + ';">&nbsp;</td>' +
      '<td width="' + remainderPct + '%" style="padding:0; margin:0; background:#eeeeee;">&nbsp;</td>' +
      '</tr>' +
      '</table>';

    if (!labelText) {
      return innerTableHtml;
    }

    var labelTd =
      '<td style="padding-left:4px; white-space:nowrap; ' +
      'font-family:Arial,sans-serif; font-size:11px; color:#333333;">' +
      CoreUtils.escapeHtml(String(labelText)) +
      '</td>';

    var outerHtml =
      '<table cellpadding="0" cellspacing="0" border="0" ' +
      'style="border-collapse:collapse; font-size:11px; line-height:1.2; font-family:Arial,sans-serif;">' +
      '<tr>' +
      '<td style="padding:0; margin:0;">' + innerTableHtml + '</td>' +
      labelTd +
      '</tr>' +
      '</table>';

    return outerHtml;
  }

  // --- PHASE 3b: CODE-COMPUTED BREAKDOWN RENDERERS ----------------------------

  /**
   * Renders a trend indicator cell for Health breakdown.
   * @private
   */
  function _renderTrendCell_(trend) {
    var color = trend.polarity === 'good' ? '#4CAF50'
              : trend.polarity === 'bad'  ? '#F44336'
              : '#999999';
    return '<span style="color:' + color + '; font-weight:bold; white-space:nowrap;">' +
      CoreUtils.escapeHtml(trend.arrow + ' ' + trend.label) + '</span>';
  }

  /**
   * Renders a plain HTML disclaimer paragraph.
   * @private
   */
  function _renderDisclaimerParagraph_(text) {
    if (!text) return '';
    return '<p style="font-size:11px; font-family:Arial,sans-serif; color:#666666; ' +
      'margin-top:6px; font-style:italic;">' +
      CoreUtils.escapeHtml(text) + '</p>';
  }

  /**
   * Phase 3b: renders the Health Breakdown table from CoreAnalytics code.
   * Columns: Health Indicator | Count (bar) | Total % | MoM Trend | YTD Trend
   * @private
   */
  function _renderHealthBreakdownFromCode_(cfg, tableCfg) {
    var result;
    try {
      result = CoreAnalytics.getHealthBreakdown(cfg);
    } catch (err) {
      Logger.log('CoreReport._renderHealthBreakdownFromCode_: failed: ' + err);
      return '<p style="font-size:11px; color:#cc0000; font-family:Arial,sans-serif;">' +
        '\u26A0 Health Breakdown unavailable: ' + CoreUtils.escapeHtml(String(err)) + '</p>';
    }

    var TABLE_STYLE = 'border-collapse:collapse; width:100%; max-width:960px; ' +
      'font-size:11px; font-family:Arial,sans-serif;';
    var TH_STYLE = 'border:1px solid #aaaaaa; background-color:#0f4c81; color:#ffffff; ' +
      'padding:6px 8px; text-align:left; white-space:nowrap; font-size:11px;';
    var TD_STYLE = 'border:1px solid #dddddd; padding:5px 8px; text-align:left; font-size:11px;';

    var namedRange = tableCfg.namedRange || 'HealthTotal';
    var barCfg = (cfg.report.barConfig || {})[namedRange] || {};

    var maxCount = 0;
    result.rows.forEach(function (row) {
      if (row.currentCount > maxCount) maxCount = row.currentCount;
    });

    var theadHtml =
      '<th style="' + TH_STYLE + '">Health Indicator</th>' +
      '<th style="' + TH_STYLE + '">Count</th>' +
      '<th style="' + TH_STYLE + '">Total %</th>' +
      '<th style="' + TH_STYLE + '">MoM Trend</th>' +
      '<th style="' + TH_STYLE + '">YTD Trend</th>';

    var tbodyHtml = result.rows.map(function (row, ri) {
      var bg = ri % 2 === 0 ? '#ffffff' : '#f7f7f7';
      var barPct = maxCount > 0 ? (row.currentCount / maxCount) * 100 : 0;
      var barHtml = renderBarFromPctWithStyle_(barPct, barCfg, row.color, row.currentCount);
      var pctStr = (row.currentPct * 100).toFixed(2) + '%';
      return '<tr>' +
        '<td style="' + TD_STYLE + ' background-color:' + bg + '; color:' +
          CoreUtils.escapeHtml(row.color) + '; font-weight:bold;">' +
          CoreUtils.escapeHtml(row.status) + '</td>' +
        '<td style="' + TD_STYLE + ' background-color:' + bg + ';">' + barHtml + '</td>' +
        '<td style="' + TD_STYLE + ' background-color:' + bg + ';">' +
          CoreUtils.escapeHtml(pctStr) + '</td>' +
        '<td style="' + TD_STYLE + ' background-color:' + bg + ';">' +
          _renderTrendCell_(row.momTrend) + '</td>' +
        '<td style="' + TD_STYLE + ' background-color:' + bg + ';">' +
          _renderTrendCell_(row.ytdTrend) + '</td>' +
        '</tr>';
    }).join('');

    var html = '<table style="' + TABLE_STYLE + '">' +
      '<thead><tr>' + theadHtml + '</tr></thead>' +
      '<tbody>' + tbodyHtml + '</tbody>' +
      '</table>';

    if (result.dataIntegrity.showDisclaimer) {
      html += _renderDisclaimerParagraph_(cfg.report.disclaimers.healthBreakdown);
    }
    var ad = cfg.activeDeployments || {};
    if (ad.productModeUnionEnabled && ad.productModeCountGrain &&
        ad.productModeDisplayGrain &&
        ad.productModeCountGrain !== ad.productModeDisplayGrain) {
      html += _renderDisclaimerParagraph_(
        'Health totals count unique product functions. The Deployments tab may group ' +
        'related functions into fewer display rows.');
    }
    return html;
  }

  /**
   * Phase 3b: renders the Partner Breakdown table from CoreAnalytics code.
   * Columns: Priming Partner | Count | Percentage (bar)
   * @private
   */
  function _renderPartnerBreakdownFromCode_(cfg, tableCfg) {
    var result;
    try {
      result = CoreAnalytics.getPartnerBreakdown(cfg);
    } catch (err) {
      Logger.log('CoreReport._renderPartnerBreakdownFromCode_: failed: ' + err);
      return '<p style="font-size:11px; color:#cc0000; font-family:Arial,sans-serif;">' +
        '\u26A0 Partner Breakdown unavailable: ' + CoreUtils.escapeHtml(String(err)) + '</p>';
    }

    var TABLE_STYLE = 'border-collapse:collapse; width:100%; max-width:960px; ' +
      'font-size:11px; font-family:Arial,sans-serif;';
    var TH_STYLE = 'border:1px solid #aaaaaa; background-color:#0f4c81; color:#ffffff; ' +
      'padding:6px 8px; text-align:left; white-space:nowrap; font-size:11px;';
    var TD_STYLE = 'border:1px solid #dddddd; padding:5px 8px; text-align:left; font-size:11px;';

    var namedRange = tableCfg.namedRange || 'PartnerTotal';
    var barCfg = (cfg.report.barConfig || {})[namedRange] || {};

    var theadHtml =
      '<th style="' + TH_STYLE + '">Priming Partner</th>' +
      '<th style="' + TH_STYLE + '">Count</th>' +
      '<th style="' + TH_STYLE + '">Percentage of the Total</th>';

    var tbodyHtml = result.rows.map(function (row, ri) {
      var bg = ri % 2 === 0 ? '#ffffff' : '#f7f7f7';
      var barHtml = renderBarFromPctWithStyle_(row.pct * 100, barCfg, null,
        (row.pct * 100).toFixed(1) + '%');
      return '<tr>' +
        '<td style="' + TD_STYLE + ' background-color:' + bg + ';">' +
          CoreUtils.escapeHtml(row.partner) + '</td>' +
        '<td style="' + TD_STYLE + ' background-color:' + bg + ';">' +
          CoreUtils.escapeHtml(String(row.count)) + '</td>' +
        '<td style="' + TD_STYLE + ' background-color:' + bg + ';">' + barHtml + '</td>' +
        '</tr>';
    }).join('');

    var html = '<table style="' + TABLE_STYLE + '">' +
      '<thead><tr>' + theadHtml + '</tr></thead>' +
      '<tbody>' + tbodyHtml + '</tbody>' +
      '</table>';

    if (result.dataIntegrity.showDisclaimer) {
      html += _renderDisclaimerParagraph_(cfg.report.disclaimers.partnerBreakdown);
    }
    return html;
  }

  /**
   * Phase 3b: renders the Services Approach Breakdown table from CoreAnalytics code.
   * Columns: Services Approach | Count | Percentage (bar)
   * @private
   */
  function _renderApproachBreakdownFromCode_(cfg, tableCfg) {
    var result;
    try {
      result = CoreAnalytics.getApproachBreakdown(cfg);
    } catch (err) {
      Logger.log('CoreReport._renderApproachBreakdownFromCode_: failed: ' + err);
      return '<p style="font-size:11px; color:#cc0000; font-family:Arial,sans-serif;">' +
        '\u26A0 Approach Breakdown unavailable: ' + CoreUtils.escapeHtml(String(err)) + '</p>';
    }

    var TABLE_STYLE = 'border-collapse:collapse; width:100%; max-width:960px; ' +
      'font-size:11px; font-family:Arial,sans-serif;';
    var TH_STYLE = 'border:1px solid #aaaaaa; background-color:#0f4c81; color:#ffffff; ' +
      'padding:6px 8px; text-align:left; white-space:nowrap; font-size:11px;';
    var TD_STYLE = 'border:1px solid #dddddd; padding:5px 8px; text-align:left; font-size:11px;';

    var namedRange = tableCfg.namedRange || 'ApproachTotal';
    var barCfg = (cfg.report.barConfig || {})[namedRange] || {};

    var theadHtml =
      '<th style="' + TH_STYLE + '">Services Approach</th>' +
      '<th style="' + TH_STYLE + '">Count</th>' +
      '<th style="' + TH_STYLE + '">Percentage of the Total</th>';

    var tbodyHtml = result.rows.map(function (row, ri) {
      var bg = ri % 2 === 0 ? '#ffffff' : '#f7f7f7';
      // C13: use largest-remainder integer displayPct for label so all rows sum to 100%.
      var displayLabel = (row.displayPct !== undefined ? row.displayPct : (row.pct * 100).toFixed(1)) + '%';
      var barHtml = renderBarFromPctWithStyle_(row.pct * 100, barCfg, null, displayLabel);
      return '<tr>' +
        '<td style="' + TD_STYLE + ' background-color:' + bg + ';">' +
          CoreUtils.escapeHtml(row.approach) + '</td>' +
        '<td style="' + TD_STYLE + ' background-color:' + bg + ';">' +
          CoreUtils.escapeHtml(String(row.count)) + '</td>' +
        '<td style="' + TD_STYLE + ' background-color:' + bg + ';">' + barHtml + '</td>' +
        '</tr>';
    }).join('');

    var html = '<table style="' + TABLE_STYLE + '">' +
      '<thead><tr>' + theadHtml + '</tr></thead>' +
      '<tbody>' + tbodyHtml + '</tbody>' +
      '</table>';

    if (result.dataIntegrity.showDisclaimer) {
      html += _renderDisclaimerParagraph_(cfg.report.disclaimers.approachBreakdown);
    }
    return html;
  }

  // --- SPECIAL TABLES: RED/YELLOW, GO LIVES, FUTURE GO LIVES -----------------

  function buildRedYellowHtmlTableFromEffectiveData_(config, tableCfg) {
    var cfg  = CoreConfig.withDefaults(config);
    var rows = CoreReportHelpers.getEffectiveRedYellowForExport_(cfg);
    if (!rows || !rows.length) {
      return '<p style="font-size:11px; font-family:Arial,sans-serif;">(No Red/Yellow deployments in report)</p>';
    }

    var TABLE_STYLE =
      'border-collapse:collapse; width:100%; max-width:960px; ' +
      'font-size:11px; font-family:Arial,sans-serif;';
    var TH_STYLE =
      'border:1px solid #aaaaaa; background-color:#0f4c81; color:#ffffff; ' +
      'padding:6px 8px; text-align:left; white-space:nowrap; font-size:11px;';
    var TD_STYLE =
      'border:1px solid #dddddd; padding:5px 8px; ' +
      'text-align:left; font-size:11px;';

    var includeIndustry = !!cfg.report.includeIndustryRedYellow;

    var theadParts = [
      '<th style="' + TH_STYLE + '">Health</th>',
      '<th style="' + TH_STYLE + '">Account Name</th>'
    ];

    if (includeIndustry) {
      theadParts.push('<th style="' + TH_STYLE + '">Industry</th>');
    }

    // SLG/HENP/HC differ by label; we keep it generic here, the text
    // can be updated per app if desired.
    theadParts.push(
      '<th style="' + TH_STYLE + '">Deployment Name</th>',
      '<th style="' + TH_STYLE + '">Partner</th>',
      '<th style="' + TH_STYLE + '">MTP Date</th>'
    );

    theadParts.push('<th style="' + TH_STYLE + '">' + (cfg.report.redYellowOwnerLabel || 'Owner') + '</th>');
    theadParts.push('<th style="' + TH_STYLE + '">Current Update</th>');

    var theadHtml = theadParts.join('');

    var tbodyHtml = rows
      .map(function (row, ri) {
        var defaultBg = (ri % 2 === 0) ? '#ffffff' : '#f7f7f7';

        function td(content, extraStyle) {
          extraStyle = extraStyle || '';
          return (
            '<td style="' + TD_STYLE + ' background-color:' + defaultBg + ';' + extraStyle + '">' +
            CoreUtils.escapeHtml(content || '') +
            '</td>'
          );
        }

        var healthStyle = '';
        var h = (row.health || '').toLowerCase();
        if (h === 'red') {
          healthStyle = ' color:red; font-weight:bold;';
        } else if (h === 'yellow') {
          healthStyle = ' color:orange; font-weight:bold;';
        }

        var mtpStr = '';
        if (row.mtpDate) {
          var d = new Date(row.mtpDate);
          if (!isNaN(d.getTime())) {
            mtpStr = d.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric'
            });
          } else {
            mtpStr = row.mtpDate;
          }
        }

        var ownerVal = row.deliveryDirector || row.wdEngManager || '';

        var tds = [
          td(row.health, healthStyle),
          td(row.accountName)
        ];

        if (includeIndustry) {
          tds.push(td(row.industry || ''));
        }

        tds.push(
          td(row.deploymentName),
          td(row.partner),
          td(mtpStr),
          td(ownerVal),
          td(row.currentUpdate || '')
        );

        return '<tr>' + tds.join('') + '</tr>';
      })
      .join('');

    return (
      '<table style="' + TABLE_STYLE + '">' +
      '<thead><tr>' + theadHtml + '</tr></thead>' +
      '<tbody>' + tbodyHtml + '</tbody>' +
      '</table>'
    );
  }

  function buildRedYellowHtmlTableFromEffectiveDataForOutlook_(config, tableCfg) {
    var cfg  = CoreConfig.withDefaults(config);
    var rows = CoreReportHelpers.getEffectiveRedYellowForExport_(cfg);
    if (!rows || !rows.length) {
      return '<p style="font-size:11px; font-family:Arial,sans-serif;">(No Red/Yellow deployments in report)</p>';
    }

    var TABLE_STYLE =
      'border-collapse:collapse; width:100%; max-width:960px; ' +
      'font-size:11px; font-family:Arial,sans-serif;';
    var TH_STYLE =
      'border:1px solid #aaaaaa; background-color:#0f4c81; color:#ffffff; ' +
      'padding:6px 8px; text-align:left; white-space:nowrap; font-size:11px;';
    var TD_STYLE =
      'border:1px solid #dddddd; padding:5px 8px; ' +
      'text-align:left; font-size:11px;';

    var includeIndustry = !!cfg.report.includeIndustryRedYellow;

    var theadParts = [
      '<th style="' + TH_STYLE + '">Health</th>',
      '<th style="' + TH_STYLE + '">Account Name</th>'
    ];
    if (includeIndustry) {
      theadParts.push('<th style="' + TH_STYLE + '">Industry</th>');
    }
    theadParts.push(
      '<th style="' + TH_STYLE + '">Deployment Name</th>',
      '<th style="' + TH_STYLE + '">Partner</th>',
      '<th style="' + TH_STYLE + '">MTP Date</th>',
      '<th style="' + TH_STYLE + '">' + (cfg.report.redYellowOwnerLabel || 'Owner') + '</th>'
    );

    var theadHtml = theadParts.join('');
    var tbodyParts = [];

    rows.forEach(function (row, ri) {
      var defaultBg = (ri % 2 === 0) ? '#ffffff' : '#f7f7f7';

      function td(content, extraStyle) {
        extraStyle = extraStyle || '';
        return (
          '<td style="' + TD_STYLE + ' background-color:' + defaultBg + ';' + extraStyle + '">' +
          CoreUtils.escapeHtml(content || '') +
          '</td>'
        );
      }

      var healthStyle = '';
      var h = (row.health || '').toLowerCase();
      if (h === 'red') {
        healthStyle = ' color:red; font-weight:bold;';
      } else if (h === 'yellow') {
        healthStyle = ' color:orange; font-weight:bold;';
      }

      var mtpStr = '';
      if (row.mtpDate) {
        var d = new Date(row.mtpDate);
        if (!isNaN(d.getTime())) {
          mtpStr = d.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          });
        } else {
          mtpStr = row.mtpDate;
        }
      }

      var ownerVal = row.deliveryDirector || row.wdEngManager || '';

      // Summary row
      var summaryTds = [
        td(row.health, healthStyle),
        td(row.accountName)
      ];
      if (includeIndustry) {
        summaryTds.push(td(row.industry || ''));
      }
      summaryTds.push(
        td(row.deploymentName),
        td(row.partner),
        td(mtpStr),
        td(ownerVal)
      );

      tbodyParts.push('<tr>' + summaryTds.join('') + '</tr>');

      // Second row: current update
      var updateText = row.currentUpdate || '';
      var separatorStyle =
        TD_STYLE +
        ' background-color:' + defaultBg + '; ' +
        'font-size:10px; color:#555555; ' +
        'border-bottom:2px solid #999999;';

      var colspan = includeIndustry ? 7 : 6;

      if (updateText) {
        tbodyParts.push(
          '<tr><td colspan="' + colspan + '" style="' + separatorStyle + '">' +
          '<strong>Current Update:&nbsp;</strong>' +
          CoreUtils.escapeHtml(updateText) +
          '</td></tr>'
        );
      } else {
        tbodyParts.push(
          '<tr><td colspan="' + colspan + '" style="' + separatorStyle + '">' +
          '<strong>Current Update:&nbsp;</strong>' +
          '<span style="color:#999999;">(no update provided)</span>' +
          '</td></tr>'
        );
      }
    });

    return (
      '<table style="' + TABLE_STYLE + '">' +
      '<thead><tr>' + theadHtml + '</tr></thead>' +
      '<tbody>' + tbodyParts.join('') + '</tbody>' +
      '</table>'
    );
  }

  /**
   * C13: Renders the Recent Go Lives table.
   *
   * Source: CoreData.getRecentGoLives(cfg, null) — 60-day window.
   * Columns: Date | Account | Deployment | Partner.
   * Sort: ascending by earliest in-window date (oldest go-live first).
   * Date cell: single date only when recentDates.length === 1;
   *   <br>-separated lines when multiple waves, products shown only on lines
   *   where the wave date differs from the deployment's parent MTP.
   */
  function buildRecentGoLivesHtmlTableFromEffectiveData_(config, tableCfg) {
    var cfg  = CoreConfig.withDefaults(config);

    var rows = CoreData.getRecentGoLives(cfg, null) || [];
    if (!rows || !rows.length) {
      return '<p style="font-size:11px; font-family:Arial,sans-serif;">(No recent go lives in report)</p>';
    }

    // Build effectiveByDeploymentId for parentMtp lookup.
    var effectiveByDeploymentId = _buildReportEffectiveLookup_(
      CoreData.getAllEffectiveDeployments(cfg)
    );

    // Re-sort ascending by earliest in-window date; ties broken by account name.
    function _earliestRecentDate_(r) {
      if (!r.recentDates || r.recentDates.length === 0) return '';
      return r.recentDates.reduce(function (min, d) {
        return (!min || d.date < min) ? d.date : min;
      }, '');
    }
    rows = rows.slice().sort(function (a, b) {
      var ad = _earliestRecentDate_(a);
      var bd = _earliestRecentDate_(b);
      if (ad < bd) return -1;
      if (ad > bd) return 1;
      return String(a.accountName || '').localeCompare(String(b.accountName || ''));
    });

    // C13.3: table-layout:fixed forces the browser to honor explicit column
    // widths declared via <colgroup>. Under the default table-layout:auto,
    // width declarations on <th>/<td> are advisory only and get overridden by
    // cell content. This is the only reliable cross-Outlook way to lock the
    // Date column width.
    var TABLE_STYLE =
      'border-collapse:collapse; width:100%; max-width:960px; ' +
      'table-layout:fixed; ' +
      'font-size:11px; font-family:Arial,sans-serif;';
    var TH_STYLE =
      'border:1px solid #aaaaaa; background-color:#0f4c81; color:#ffffff; ' +
      'padding:6px 8px; text-align:left; font-size:11px;';
    var TD_STYLE =
      'border:1px solid #dddddd; padding:5px 8px; ' +
      'text-align:left; font-size:11px; ' +
      'word-wrap:break-word; overflow-wrap:break-word;';
    var TD_VALIGN_STYLE = TD_STYLE + ' vertical-align:top;';

    // <colgroup> forces width allocation under table-layout:fixed.
    // 110px for Date; remaining width distributes across the other 3 columns.
    var colgroupHtml =
      '<colgroup>' +
      '<col style="width:110px;">' +
      '<col>' +
      '<col>' +
      '<col>' +
      '</colgroup>';

    var theadHtml =
      '<th style="' + TH_STYLE + '">Date</th>' +
      '<th style="' + TH_STYLE + '">Account</th>' +
      '<th style="' + TH_STYLE + '">Deployment</th>' +
      '<th style="' + TH_STYLE + '">Partner</th>';

    function _fmtReportDate_(dateStr) {
      if (!dateStr) return '';
      var d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
      });
    }

    var tbodyHtml = rows.map(function (row, ri) {
      var defaultBg = (ri % 2 === 0) ? '#ffffff' : '#f7f7f7';

      function td_(content) {
        return '<td style="' + TD_STYLE + ' background-color:' + defaultBg + ';">' +
          CoreUtils.escapeHtml(content || '') + '</td>';
      }
      function tdRaw_(html) {
        return '<td style="' + TD_VALIGN_STYLE + ' background-color:' + defaultBg + ';">' +
          html + '</td>';
      }

      var recentDates = row.recentDates || [];
      var effective   = _lookupEffectiveForGoLiveRow_(effectiveByDeploymentId, row);
      var parentMtp   = (effective && effective.mtpDate) || '';

      // Date cell per C13 §3.5.
      var dateCellHtml;
      if (recentDates.length === 0) {
        dateCellHtml = CoreUtils.escapeHtml('\u2014');
      } else if (recentDates.length === 1) {
        // Single date — show date only; no products.
        dateCellHtml = CoreUtils.escapeHtml(_fmtReportDate_(recentDates[0].date));
      } else {
        // Multiple distinct in-window dates: one line per date.
        // Show "date — products" only when the wave date differs from parent MTP
        // AND the wave has products.
        var lines = recentDates.map(function (d) {
          var dateStr           = _fmtReportDate_(d.date);
          var differsFromParent = (d.date !== parentMtp);
          var hasProducts       = d.products && d.products.length > 0;
          if (differsFromParent && hasProducts) {
            return CoreUtils.escapeHtml(dateStr + ' \u2014 ' + d.products.join(', '));
          }
          return CoreUtils.escapeHtml(dateStr);
        });
        dateCellHtml = lines.join('<br>');
      }

      return '<tr>' +
        tdRaw_(dateCellHtml) +
        td_(row.accountName) +
        td_(_resolveGoLiveDeploymentColumn_(row)) +
        td_(row.partner) +
        '</tr>';
    }).join('');

    return '<table style="' + TABLE_STYLE + '">' +
      colgroupHtml +
      '<thead><tr>' + theadHtml + '</tr></thead>' +
      '<tbody>' + tbodyHtml + '</tbody>' +
      '</table>';
  }

  /**
   * C13: Renders the Upcoming Go Lives table.
   *
   * Source: CoreData.getUpcomingGoLives(cfg, null) — 90-day window.
   * Columns: Date | Account | Deployment | Partner (matches Recent Go Lives).
   * Sort: ascending by earliest in-window date.
   * Date cell: same logic as Recent (§3.5) — single date only when
   *   upcomingDates.length === 1; <br>-separated lines for multi-wave,
   *   products shown only on lines where the wave date differs from parent MTP.
   */
  function buildFutureGoLivesHtmlTableFromEffectiveData_(config, tableCfg) {
  var cfg  = CoreConfig.withDefaults(config);
  var rows = CoreData.getUpcomingGoLives(cfg, null) || [];
  rows = rows.filter(function (row) { return !row.excludeFromReport; });

  if (!rows || !rows.length) {
    return '<p style="font-size:11px; font-family:Arial,sans-serif;">(No upcoming go lives in report)</p>';
  }

  // Build effectiveByDeploymentId for parentMtp lookup.
  var effectiveByDeploymentId = _buildReportEffectiveLookup_(
    CoreData.getAllEffectiveDeployments(cfg)
  );

  // Sort ascending by earliest in-window date.
  rows = rows.slice().sort(function (a, b) {
    var ad = a.nextGoLiveDate || a.mtpDate || '';
    var bd = b.nextGoLiveDate || b.mtpDate || '';
    if (ad < bd) return -1;
    if (ad > bd) return 1;
    return String(a.accountName || '').localeCompare(String(b.accountName || ''));
  });

  // C13.3: table-layout:fixed is the only reliable way to force a column to
  // honor a width constraint in HTML email and modern browsers. Combined with
  // explicit colgroup widths, this guarantees the Date column stays at 110px
  // regardless of cell content.
  var TABLE_STYLE =
    'border-collapse:collapse; width:100%; max-width:960px; ' +
    'table-layout:fixed; ' +
    'font-size:11px; font-family:Arial,sans-serif;';
  var TH_STYLE =
    'border:1px solid #aaaaaa; background-color:#0f4c81; color:#ffffff; ' +
    'padding:6px 8px; text-align:left; font-size:11px;';
  var TD_STYLE =
    'border:1px solid #dddddd; padding:5px 8px; ' +
    'text-align:left; font-size:11px; vertical-align:top; ' +
    'word-wrap:break-word; overflow-wrap:break-word;';

  // colgroup forces width allocation under table-layout:fixed.
  // 110px for Date; remaining width distributes across the other 3 columns.
  var colgroupHtml =
    '<colgroup>' +
    '<col style="width:110px;">' +
    '<col>' +
    '<col>' +
    '<col>' +
    '</colgroup>';

  var theadHtml =
    '<th style="' + TH_STYLE + '">Date</th>' +
    '<th style="' + TH_STYLE + '">Account</th>' +
    '<th style="' + TH_STYLE + '">Deployment</th>' +
    '<th style="' + TH_STYLE + '">Partner</th>';

  function _fmtReportDate_(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }

  var tbodyHtml = rows.map(function (row, ri) {
    var defaultBg = (ri % 2 === 0) ? '#ffffff' : '#f7f7f7';

    function td_(content) {
      return '<td style="' + TD_STYLE + ' background-color:' + defaultBg + ';">' +
        CoreUtils.escapeHtml(content || '') + '</td>';
    }
    function tdRaw_(html) {
      return '<td style="' + TD_STYLE + ' background-color:' + defaultBg + ';">' +
        html + '</td>';
    }

    var upcomingDates = row.upcomingDates || [];
    var effective     = _lookupEffectiveForGoLiveRow_(effectiveByDeploymentId, row);
    var parentMtp     = (effective && effective.mtpDate) || '';

    var dateCellHtml;
    if (upcomingDates.length === 0) {
      var singleDate = row.nextGoLiveDate || row.mtpDate || '';
      dateCellHtml = CoreUtils.escapeHtml(_fmtReportDate_(singleDate));
    } else if (upcomingDates.length === 1) {
      dateCellHtml = CoreUtils.escapeHtml(_fmtReportDate_(upcomingDates[0].date));
    } else {
      var lines = upcomingDates.map(function (d) {
        var dateStr           = _fmtReportDate_(d.date);
        var differsFromParent = (d.date !== parentMtp);
        var hasProducts       = d.products && d.products.length > 0;
        if (differsFromParent && hasProducts) {
          return CoreUtils.escapeHtml(dateStr + ' \u2014 ' + d.products.join(', '));
        }
        return CoreUtils.escapeHtml(dateStr);
      });
      dateCellHtml = lines.join('<br>');
    }

    return '<tr>' +
      tdRaw_(dateCellHtml) +
      td_(row.accountName) +
      td_(_resolveGoLiveDeploymentColumn_(row)) +
      td_(row.partner) +
      '</tr>';
  }).join('');

  return '<table style="' + TABLE_STYLE + '">' +
    colgroupHtml +
    '<thead><tr>' + theadHtml + '</tr></thead>' +
    '<tbody>' + tbodyHtml + '</tbody>' +
    '</table>';
}

  // --- EFFECTIVE-VIEW WRAPPERS USED BY TABLE BUILDERS -----------------------

  var CoreReportHelpers = {
    /**
     * Shared wrapper: effective Red/Yellow rows for HTML export.
     */
    getEffectiveRedYellowForExport_: function (config) {
      var rows = CoreData.getActiveDeployments(config);
      return rows.filter(function (row) {
        return !row.excludeFromReport;
      });
    },

    /**
     * Shared wrapper: effective recent Go Lives rows for HTML export.
     * Phase 3i: delegates to CoreData.getRecentGoLives() (SOQL-backed).
     * The legacy CoreData.getGoLives() call is no longer used here.
     */
    getEffectiveRecentGoLivesForExport_: function (config) {
      // Phase 3i: getRecentGoLives() does not set excludeFromReport; the
      // filter is harmless and preserves forward compatibility.
      var rows = CoreData.getRecentGoLives(config) || [];
      return rows.filter(function (row) {
        return !row.excludeFromReport;
      });
    },

    /**
     * Shared wrapper: effective future Go Lives rows for HTML export.
     */
    getEffectiveFutureGoLivesForExport_: function (config) {
      var rows = CoreData.getUpcomingGoLives(config) || [];
      return rows.filter(function (row) {
        return !row.excludeFromReport;
      });
    }
  };

  // --- HTML SHELLS ----------------------------------------------------------

  /**
   * N4 L3: Outlook-safe freshness warning banner for stale/failed data at report generation.
   * Table layout + inline styles only (no flex/grid).
   *
   * @param {AppConfig} config
   * @return {string} HTML fragment or ''
   * @private
   */
  function buildFreshnessReportBanner_(config) {
    var cfg = CoreConfig.withDefaults(config);
    if (!cfg.freshness || !cfg.freshness.enabled) return '';
    try {
      var freshness = CoreData.getDataFreshness(cfg);
      if (freshness.status !== 'stale' && freshness.lastRefreshStatus === 'Success') return '';

      var lastRefreshLocal = 'n/a';
      if (freshness.lastRefresh) {
        var refreshDate = new Date(freshness.lastRefresh);
        if (!isNaN(refreshDate.getTime())) {
          lastRefreshLocal = Utilities.formatDate(
            refreshDate,
            Session.getScriptTimeZone(),
            'M/d/yyyy h:mm a'
          );
        }
      }
      var ageStr = freshness.ageHours !== null ? Math.round(freshness.ageHours) : '?';
      var bannerText = '\u26A0 Data as of ' + lastRefreshLocal + ' \u2014 ' + ageStr +
                       'h old. Verify before distributing.';

      return (
        '<table width="100%" cellpadding="0" cellspacing="0" border="0" ' +
        'style="border-collapse:collapse; margin-bottom:16px;">' +
        '<tr>' +
        '<td style="background-color:#fdecea; border:1px solid #f5c6cb; ' +
        'padding:10px 14px; font-family:Arial,sans-serif; font-size:12px; ' +
        'color:#721c24; font-weight:600;">' +
        CoreUtils.escapeHtml(bannerText) +
        '</td>' +
        '</tr>' +
        '</table>'
      );
    } catch (e) {
      Logger.log('CoreReport.buildFreshnessReportBanner_: ' + e);
      return '';
    }
  }

  /**
   * Inline (pure HTML) shell: used for preview + inline export.
   *
   * @param {AppConfig} config
   * @param {string} bodyContent
   * @return {string}
   * @private
   */
  function wrapHtmlShellInline_(config, bodyContent) {
    var cfg = CoreConfig.withDefaults(config);
    var dateLbl = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'MMMM yyyy'
    );

    var title = cfg.report.title || 'Deployment Health Report';
    var freshnessBanner = buildFreshnessReportBanner_(cfg);

    var headerHtml =
      '<table width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="background-color:#0f4c81; margin-bottom:24px;">' +
      '<tr>' +
      '<td style="padding:18px 26px; width:160px; vertical-align:middle;">' +
      // SVG block copied once (same as your existing header)
      '<div style="background-color:#ffffff; padding:10px 14px; ' +
      'border-radius:6px; display:inline-block;">' +
      // (for brevity, we keep your existing SVG logo unchanged)
      '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ' +
      'viewBox="0 0 1540 2000" width="80" height="80">' +
      '<defs><style>' +
      '.cls-0 { fill: #ffffff; }' +
      '.cls-1 { fill: #0f2e66; }' +
      '.cls-2 { fill: #fc5b05; }' +
      '</style></defs>' +
      '<g><g id="Layer_1">' +
      '<rect class="cls-0" x="0" y="0" width="1540" height="2000" />' +
      '<path class="cls-1" d="M1221.5,1999.8h-179.3c-26.9,0-49-12.3-56.3-41.9l-216-760.4-216,760.6c-7.3,29.6-29.4,41.9-56.3,41.9h-179.3c-29.4,0-46.7-12.3-56.3-41.9C146.5,1637.3,68.1,1318.5,1.8,997.7c-7.3-32.3,7.3-54.4,41.5-54.4h159.7c29.4,0,49,14.8,54.2,41.9,41.5,227.3,90.9,461.5,157.2,691.5l191.4-691.5c7.3-27.1,26.9-41.9,56.3-41.9h216c29.4,0,49,14.8,56.3,41.9l191.4,691.5c66.3-229.4,115.7-464.2,157.2-691.5,4.8-27.1,24.6-41.9,54.2-41.9h159.7c34.2,0,49,22.3,41.5,54.4-66.3,320.9-144.7,639.6-260.1,960.4-10,29.6-27.1,41.7-56.5,41.7Z"/>' +
      '<path class="cls-2" d="M375.1,408.1c105.5-105.7,245.7-163.7,395-163.9,149.1,0,289.2,58,394.4,163.3,54.8,54.8,96.6,118.9,124.3,188.7,6.3,16.1,22.1,26.7,39.4,26.7h168.7c28.2,0,49-27.1,40.9-54-37.7-124.9-105.7-239.2-200.4-334.1C1185.9,83.6,984.5,0,770.3,0S354.2,83.6,202.6,235.4C107.7,330.3,39.8,444.6,2.4,569.1c-8.1,26.9,12.7,54,40.9,54h168.7c17.3,0,33-10.6,39.4-26.7,27.5-69.7,69.2-133.7,123.7-188.3Z"/>' +
      '</g></g></svg>' +
      '</div>' +
      '</td>' +
      '<td style="padding:18px 26px; vertical-align:middle;">' +
      '<div style="color:#ffffff; font-size:20px; font-weight:bold; ' +
      'font-family:Arial,sans-serif;">' +
      CoreUtils.escapeHtml(title) +
      '</div>' +
      '<div style="color:#c9d9f0; font-size:12px; margin-top:4px; ' +
      'font-family:Arial,sans-serif;">' +
      'Monthly Report – ' + dateLbl +
      '</div>' +
      '</td>' +
      '</tr>' +
      '</table>';

    var footerHtml =
      '<table width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="background-color:#0f4c81; margin-top:24px;">' +
      '<tr>' +
      '<td style="padding:10px 16px;">' +
      '<table width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="border-collapse:separate; border-spacing:0; ' +
      'background-color:#ffffff; border-radius:6px;">' +
      '<tr>' +
      '<td style="padding:8px 12px; font-size:11px; ' +
      'color:#555555; font-family:Arial,sans-serif;">' +
      '<strong style="color:#0f2e66;">' +
      CoreUtils.escapeHtml(cfg.report.footerAttribution || '') +
      '</strong>' +
      '<span> · Powered by Sana </span>' +
      (cfg.report.sanaLogoUrl
        ? '<img alt="Sana" style="height:12px; width:12px; margin-left:4px; ' +
          'vertical-align:middle; border:0; display:inline-block;" ' +
          'src="' + CoreUtils.escapeHtml(cfg.report.sanaLogoUrl) + '">'
        : ''
      ) +
      '</td>' +
      '<td align="right" style="padding:8px 12px; font-size:10px; ' +
      'color:#999999; font-family:Arial,sans-serif; white-space:nowrap;">' +
      'Generated ' + dateLbl +
      '</td>' +
      '</tr>' +
      '</table>' +
      '</td>' +
      '</tr>' +
      '</table>';

    return (
      '<!DOCTYPE html>' +
      '<html><head>' +
      '<meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      '<title>' + CoreUtils.escapeHtml(title) + '</title>' +
      '</head>' +
      '<body style="font-family:Arial,sans-serif; font-size:12px; color:#333333; ' +
      'max-width:1000px; margin:0 auto; padding:20px;">' +
      headerHtml +
      (cfg.student && cfg.student.reportDisclosure && cfg.student.reportDisclosure.enabled === true
        ? '<div style="font-family:Arial,sans-serif; font-size:11px; color:#4a628f; ' +
          'padding:4px 12px; font-style:italic;">' +
          CoreUtils.escapeHtml(cfg.student.reportDisclosure.copy || '') +
          '</div>'
        : '') +
      freshnessBanner +
      bodyContent +
      footerHtml +
      '</body></html>'
    );
  }

  /**
   * Outlook-optimized HTML shell (single version for desktop & mobile):
   *
   * @param {AppConfig} config
   * @param {string} bodyContent
   * @return {string}
   * @private
   */
  function wrapHtmlShellOutlook_(config, bodyContent) {
    var cfg = CoreConfig.withDefaults(config);
    var dateLbl = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'MMMM yyyy'
    );
    var title = cfg.report.title || 'Deployment Health Report';
    var freshnessBanner = buildFreshnessReportBanner_(cfg);

    var headerInner =
      '<table width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="border-collapse:collapse; background-color:#0f4c81;">' +
      '<tr>' +
      '<td style="padding:10px 10px 10px 10px;">' +
      '<table width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="border-collapse:separate; border-spacing:0; ' +
      'background-color:#ffffff; border-radius:6px;">' +
      '<tr>' +
      '<td valign="middle" align="left" width="72" ' +
      'style="padding:6px 8px; white-space:nowrap; width:72px; max-width:72px;">' +
      (cfg.report.headerLogoUrl
        ? '<img src="' + CoreUtils.escapeHtml(cfg.report.headerLogoUrl) + '" alt="Workday" ' +
          'width="32" height="32" ' +
          'style="display:block; width:32px; height:32px; border:0; ' +
          'outline:none; text-decoration:none;">'
        : ''
      ) +
      '</td>' +
      '<td valign="middle" align="left" style="padding:6px 12px 6px 4px;">' +
      '<div style="color:#0f2e66; font-size:18px; font-weight:bold; ' +
      'font-family:Arial, sans-serif; line-height:1.2;">' +
      CoreUtils.escapeHtml(title) +
      '</div>' +
      '<div style="color:#4a628f; font-size:11px; margin-top:4px; ' +
      'font-family:Arial, sans-serif; line-height:1.2;">' +
      'Monthly Report &#8211; ' + dateLbl +
      '</div>' +
      '</td>' +
      '</tr>' +
      '</table>' +
      '</td>' +
      '</tr>' +
      '</table>';

    var footerInner =
      '<table width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="border-collapse:collapse; background-color:#0f4c81;">' +
      '<tr>' +
      '<td style="padding:10px 10px 12px 10px;">' +
      '<table width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="border-collapse:separate; border-spacing:0; ' +
      'background-color:#ffffff; border-radius:6px;">' +
      '<tr>' +
      '<td valign="middle" align="left" ' +
      'style="padding:8px 12px; font-size:11px; ' +
      'color:#555555; font-family:Arial,sans-serif;">' +
      '<strong style="color:#0f2e66;">' +
      CoreUtils.escapeHtml(cfg.report.footerAttribution || '') +
      '</strong>' +
      '<span> &middot; Powered by Sana</span>' +
      (cfg.report.sanaLogoUrl
        ? '&nbsp;<img src="' + CoreUtils.escapeHtml(cfg.report.sanaLogoUrl) + '" alt="Sana" ' +
          'width="10" height="10" ' +
          'style="height:10px; width:10px; margin-left:4px; border:0; ' +
          'outline:none; text-decoration:none; vertical-align:middle; display:inline-block;">'
        : ''
      ) +
      '</td>' +
      '<td valign="middle" align="right" ' +
      'style="padding:8px 12px; font-size:10px; ' +
      'color:#999999; font-family:Arial,sans-serif; white-space:nowrap;">' +
      'Generated ' + dateLbl +
      '</td>' +
      '</tr>' +
      '</table>' +
      '</td>' +
      '</tr>' +
      '</table>';

    return (
      '<!DOCTYPE html>' +
      '<html><head>' +
      '<meta charset="UTF-8">' +
      '<meta http-equiv="X-UA-Compatible" content="IE=edge">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      '<title>' + CoreUtils.escapeHtml(title) + '</title>' +
      '</head>' +
      '<body style="margin:0; padding:0; font-family:Arial, sans-serif; ' +
      'font-size:13px; color:#333333;">' +
      '<table width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="background-color:#f5f5f5; margin:0; padding:16px 0;">' +
      '<tr>' +
      '<td align="center" valign="top">' +
      '<table width="640" cellpadding="0" cellspacing="0" border="0" ' +
      'style="background-color:#ffffff; border-collapse:collapse; max-width:100%;">' +
      '<tr><td>' + headerInner + '</td></tr>' +
      (cfg.student && cfg.student.reportDisclosure && cfg.student.reportDisclosure.enabled === true
        ? '<tr><td style="padding:4px 18px;"><div style="font-family:Arial,sans-serif; ' +
          'font-size:11px; color:#4a628f; font-style:italic;">' +
          CoreUtils.escapeHtml(cfg.student.reportDisclosure.copy || '') +
          '</div></td></tr>'
        : '') +
      (freshnessBanner
        ? '<tr><td style="padding:8px 18px 0 18px;">' + freshnessBanner + '</td></tr>'
        : '') +
      '<tr>' +
      '<td style="padding:16px 18px 6px 18px; font-size:14px; line-height:1.5;">' +
      bodyContent +
      '</td>' +
      '</tr>' +
      '<tr><td>' + footerInner + '</td></tr>' +
      '</table>' +
      '</td>' +
      '</tr>' +
      '</table>' +
      '</body></html>'
    );
  }

  // --- N8 V2 GMAIL REPORT PATH (additive; V1 untouched) ---------------------

  /** @const {number} V2.1: max visible rows per Partner/Approach breakdown column. */
  var V2_BREAKDOWN_TOP_N_ = 10;

  /** @const {Object} V2 monthly report analytics opts (product scope + exclusions). */
  var V2_REPORT_SCOPE_OPTS_ = {
    applyReportProductScope: true,
    applyReportExclusions:   true
  };

  /**
   * Builds a deployment lookup for report go-live sections.
   * Indexes PF synthetic ids and parent deployment ids.
   * @param {Array<Object>} rows
   * @return {Object}
   * @private
   */
  function _buildReportEffectiveLookup_(rows) {
    var lookup = {};
    (rows || []).forEach(function (r) {
      if (!r) return;
      if (r.deploymentId) lookup[r.deploymentId] = r;
      var parentId = CoreData._parentDeploymentLookupId_(r);
      if (parentId) {
        if (!lookup[parentId]) lookup[parentId] = r;
        if (parentId.length >= 15) {
          var p15 = parentId.slice(0, 15);
          if (!lookup[p15]) lookup[p15] = r;
        }
      }
    });
    return lookup;
  }

  /**
   * Resolves an effective deployment row for a go-live row (PF or parent id).
   * @param {Object} lookup
   * @param {Object} row
   * @return {Object|undefined}
   * @private
   */
  function _lookupEffectiveForGoLiveRow_(lookup, row) {
    if (!lookup || !row) return undefined;
    if (row.deploymentId && lookup[row.deploymentId]) return lookup[row.deploymentId];
    var parentId = CoreData._parentDeploymentLookupId_(row);
    if (parentId && lookup[parentId]) return lookup[parentId];
    if (parentId && parentId.length >= 15 && lookup[parentId.slice(0, 15)]) {
      return lookup[parentId.slice(0, 15)];
    }
    return undefined;
  }

  /**
   * Deployment column for go-live tables (includes ProductMode PF product/function context).
   * @param {Object} row
   * @return {string}
   * @private
   */
  function _resolveGoLiveDeploymentColumn_(row) {
    if (!row) return '';
    var primary = '';
    if (row.displayDeploymentName) primary = row.displayDeploymentName;
    else if (row.displayLabel) primary = row.displayLabel;
    else if (typeof CoreData.resolveGoLiveDisplayDeploymentName_ === 'function') {
      primary = CoreData.resolveGoLiveDisplayDeploymentName_(row);
    } else {
      var pa = String(row.productArea || '').trim();
      var fa = String(row.funcArea || '').trim();
      if (pa && fa) {
        var base = String(row.deploymentName || '').trim();
        var suffix = pa + ' / ' + fa;
        if (!base || base.indexOf(suffix) === -1) primary = (base ? base + ' \u2014 ' : '') + suffix;
        else primary = base;
      } else {
        primary = row.deploymentName || pa || fa || '';
      }
    }
    var summary = '';
    if (typeof CoreData.resolveGoLiveProductFunctionSummary_ === 'function') {
      summary = CoreData.resolveGoLiveProductFunctionSummary_(row);
    } else if (row.displayProductFunction) {
      summary = row.displayProductFunction;
    }
    if (summary && primary.indexOf(summary) < 0 && (row.productFunctionCount || 0) > 1) {
      return primary + ' \u2014 ' + summary;
    }
    return primary;
  }

  /**
   * V2 monthly report product scope filter (delegates to CoreData).
   * @param {Array<Object>} rows
   * @param {AppConfig} config
   * @return {Array<Object>}
   * @private
   */
  function _filterRowsByReportProductScopeV2_(rows, config) {
    var cfg = CoreConfig.withDefaults(config);
    return CoreData.filterRowsByReportProductScope_(rows, cfg);
  }

  /**
   * N8 V2: Gmail-targeted div bar (no nested-table bar hack).
   * V2.1: label row uses table layout (Gmail-safe; no flex).
   *
   * @param {string} label
   * @param {number} pct0to100
   * @param {string} barColor
   * @param {string} rightLabel
   * @return {string}
   * @private
   */
  function renderDivBarV2_(label, pct0to100, barColor, rightLabel) {
    var pct = CoreUtils.clamp(pct0to100, 0, 100);
    var color = barColor || '#0f4c81';
    return (
      '<div style="margin-bottom:10px; font-family:Arial,sans-serif;">' +
      '<table cellpadding="0" cellspacing="0" style="width:100%; margin-bottom:3px;">' +
      '<tr>' +
      '<td style="font-size:11px; color:#333333; overflow:hidden; text-overflow:ellipsis; ' +
      'white-space:nowrap; max-width:0; width:100%;">' +
      CoreUtils.escapeHtml(label) + '</td>' +
      '<td style="font-size:11px; color:#333333; white-space:nowrap; padding-left:8px; ' +
      'vertical-align:top; text-align:right;">' +
      CoreUtils.escapeHtml(rightLabel) + '</td>' +
      '</tr></table>' +
      '<div style="background-color:#eeeeee; border-radius:4px; height:18px; overflow:hidden;">' +
      '<div style="width:' + pct + '%; height:100%; background-color:' +
      CoreUtils.escapeHtml(color) + '; border-radius:4px;"></div>' +
      '</div>' +
      '</div>'
    );
  }

  /**
   * N8 V2: section heading.
   * @param {string} text
   * @return {string}
   * @private
   */
  function renderSectionHeadingV2_(text) {
    return (
      '<h2 style="font-family:Arial,sans-serif; color:#0f4c81; font-size:15px; ' +
      'border-bottom:2px solid #0f4c81; padding-bottom:4px; margin:0 0 10px 0;">' +
      CoreUtils.escapeHtml(text) +
      '</h2>'
    );
  }

  /**
   * N8 V2: wraps a section title + inner HTML.
   * @param {string} heading
   * @param {string} innerHtml
   * @return {string}
   * @private
   */
  function wrapSectionV2_(heading, innerHtml) {
    return (
      '<div style="margin-bottom:32px;">' +
      renderSectionHeadingV2_(heading) +
      innerHtml +
      '</div>'
    );
  }

  /**
   * V2.5: compact Red/Yellow deployment card (thin accent, inline health chip, identity line).
   * @param {Object} row
   * @param {AppConfig} cfg
   * @return {string}
   * @private
   */
  function _renderRedYellowCardV2_(row, cfg) {
    var h = (row.health || '').toLowerCase();
    var accentColor = h === 'red' ? '#F44336' : '#FBBC04';
    var badgeLabel = h === 'red' ? 'RED' : 'YELLOW';
    var ownerLabel = cfg.report.redYellowOwnerLabel || 'EM';
    var ownerVal = row.deliveryDirector || row.wdEngManager || '';

    var mtpStr = '';
    if (row.mtpDate) {
      var d = new Date(row.mtpDate);
      mtpStr = !isNaN(d.getTime())
        ? d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
        : String(row.mtpDate);
    }

    var CHIP =
      'display:inline-block; background-color:#f0f3f7; border:1px solid #e0e4ea; border-radius:3px; ' +
      'padding:1px 6px; margin:1px 4px 1px 0; font-size:9px; color:#444444; ' +
      'white-space:normal; word-wrap:break-word;';
    var CHIP_LABEL = 'color:#888888; font-weight:600; margin-right:2px;';

    function chip(label, value) {
      if (!value) return '';
      return (
        '<span style="' + CHIP + '">' +
        '<span style="' + CHIP_LABEL + '">' + CoreUtils.escapeHtml(label) + '</span>' +
        CoreUtils.escapeHtml(value) +
        '</span>'
      );
    }

    var healthChip =
      '<span style="display:inline-block; background-color:' + accentColor + '; color:#ffffff; ' +
      'font-size:9px; font-weight:bold; padding:1px 6px; border-radius:3px; ' +
      'letter-spacing:0.3px; vertical-align:baseline;">' + badgeLabel + '</span>';

    var accountName = CoreUtils.escapeHtml(row.accountName || '(No account)');
    var dot = '<span style="color:#cccccc; margin:0 5px;">&middot;</span>';
    var identityLine =
      healthChip + dot +
      '<span style="font-size:13px; font-weight:bold; color:#1a1a1a;">' + accountName + '</span>' +
      (mtpStr ? dot + '<span style="font-size:11px; color:#666666;">' + CoreUtils.escapeHtml(mtpStr) + '</span>' : '');

    var metaChips = [];
    if (row.deploymentName) metaChips.push(chip('Deployment', row.deploymentName));
    if (row.partner) metaChips.push(chip('Partner', row.partner));
    if (ownerVal) metaChips.push(chip(ownerLabel, ownerVal));
    if (cfg.report.includeIndustryRedYellow && row.industry) {
      metaChips.push(chip('Industry', row.industry));
    }

    return (
      '<div style="border:1px solid #e0e4ea; border-left:4px solid ' + accentColor + '; ' +
      'border-radius:3px; margin-bottom:10px; font-family:Arial,sans-serif; overflow:hidden; ' +
      'background-color:#ffffff;">' +
      '<div style="padding:8px 10px 4px 10px;">' +
      '<div style="line-height:1.45; margin-bottom:3px;">' + identityLine + '</div>' +
      (metaChips.length
        ? '<div style="line-height:1.55;">' + metaChips.join('') + '</div>'
        : '') +
      '</div>' +
      '<div style="border-top:1px solid #e8ebef; background-color:#f5f7fa; padding:6px 10px; ' +
      'font-size:10px; line-height:1.55; color:#555555;">' +
      '<span style="font-weight:600; color:#888888;">Current Update:</span> ' +
      '<span style="white-space:normal; word-wrap:break-word;">' +
      CoreUtils.escapeHtml(row.currentUpdate || '') +
      '</span></div></div>'
    );
  }

  /**
   * N8 V2: Red/Yellow deployments as per-deployment cards (code-built, no sheet reads).
   * @param {AppConfig} config
   * @return {string}
   * @private
   */
  function renderRedYellowSectionV2_(config) {
    var cfg = CoreConfig.withDefaults(config);
    var rows = CoreReportHelpers.getEffectiveRedYellowForExport_(cfg);
    rows = CoreData.filterRowsByReportProductScope_(rows, cfg);
    rows = CoreData.filterRowsExcludedFromReport_(rows);
    if (!rows || !rows.length) {
      return wrapSectionV2_('Red / Yellow Deployments',
        '<p style="font-size:11px; font-family:Arial,sans-serif; color:#666666;">' +
        '(No Red/Yellow deployments in report)</p>');
    }

    var cardsHtml = rows.map(function (row) {
      return _renderRedYellowCardV2_(row, cfg);
    }).join('');

    return wrapSectionV2_('Red / Yellow Deployments', cardsHtml);
  }

  /**
   * N8 V2: format a yyyy-MM-dd date for report display.
   * @param {string} dateStr
   * @return {string}
   * @private
   */
  function _fmtReportDateV2_(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  /**
   * V2.7: main Date cell for go-live rows (single-date or multi-date marker).
   * @param {Object} row
   * @param {string} dateField 'recentDates' | 'upcomingDates'
   * @return {string} escaped HTML
   * @private
   */
  function _renderGoLiveDateMainCellV2_(row, dateField) {
    var dates = row[dateField] || [];
    if (dates.length > 1) {
      return CoreUtils.escapeHtml('Multiple dates \u2014 ' + dates.length + ' go-lives');
    }
    if (dates.length === 1) {
      return CoreUtils.escapeHtml(_fmtReportDateV2_(dates[0].date));
    }
    if (row.goLiveDate) {
      return CoreUtils.escapeHtml(_fmtReportDateV2_(row.goLiveDate));
    }
    if (dateField === 'recentDates') {
      if (row.lastGoLiveDate) return CoreUtils.escapeHtml(_fmtReportDateV2_(row.lastGoLiveDate));
    } else {
      var single = row.nextGoLiveDate || row.mtpDate || '';
      return CoreUtils.escapeHtml(_fmtReportDateV2_(single));
    }
    return '';
  }

  /**
   * V2.7: detail block for multi-date go-live rows (one line per wave).
   * @param {Array<{date: string, products: Array<string>}>} dates
   * @return {string}
   * @private
   */
  function _renderGoLiveMultiDateDetailV2_(dates) {
    return dates.map(function (d) {
      var dateStr = _fmtReportDateV2_(d.date);
      var hasProducts = d.products && d.products.length > 0;
      if (hasProducts) {
        return '<strong>' + CoreUtils.escapeHtml(dateStr) + '</strong> \u2014 ' +
          CoreUtils.escapeHtml(d.products.join(', '));
      }
      return '<strong>' + CoreUtils.escapeHtml(dateStr) + '</strong>';
    }).join('<br>');
  }

  /**
   * V2.6: report-only tighter window for upcoming go-lives (renderer-side filter).
   * @param {Array<Object>} rows
   * @param {number} windowDays
   * @return {Array<Object>}
   * @private
   */
  function _filterUpcomingGoLivesForReportV2_(rows, windowDays) {
    if (!rows || !rows.length) return [];

    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var windowEnd = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);

    function inWindow_(dateStr) {
      if (!dateStr) return false;
      var d = new Date(dateStr);
      return !isNaN(d.getTime()) && d >= now && d <= windowEnd;
    }

    return rows.filter(function (row) {
      if (inWindow_(row.nextGoLiveDate)) return true;
      return (row.upcomingDates || []).some(function (ud) { return inWindow_(ud.date); });
    }).map(function (row) {
      var filtered = (row.upcomingDates || []).filter(function (ud) { return inWindow_(ud.date); });
      if (!filtered.length) return row;
      var copy = {};
      Object.keys(row).forEach(function (k) { copy[k] = row[k]; });
      copy.upcomingDates = filtered;
      return copy;
    });
  }

  /**
   * V2.3: full-width go-lives table with wrapping text columns (inner HTML only).
   * V2.7: multi-date rows render as main row + full-width detail row.
   * @param {Array<Object>} rows
   * @param {Object} effectiveByDeploymentId
   * @param {string} dateField 'recentDates' | 'upcomingDates'
   * @param {string} emptyMsg
   * @return {string}
   * @private
   */
  function _buildGoLivesTableV2_(rows, effectiveByDeploymentId, dateField, emptyMsg) {
    if (!rows || !rows.length) {
      return '<p style="font-size:11px; font-family:Arial,sans-serif; color:#666666;">' +
        CoreUtils.escapeHtml(emptyMsg) + '</p>';
    }

    var TABLE_STYLE =
      'border-collapse:collapse; width:100%; max-width:680px; table-layout:fixed; ' +
      'font-size:10px; font-family:Arial,sans-serif;';
    var TH_STYLE =
      'border:1px solid #aaaaaa; background-color:#0f4c81; color:#ffffff; padding:4px 6px; ' +
      'text-align:left; font-size:10px; vertical-align:top;';
    var TD_BASE =
      'border:1px solid #dddddd; padding:4px 6px; text-align:left; font-size:10px; vertical-align:top;';
    var TD_WRAP = TD_BASE + ' word-wrap:break-word; overflow-wrap:break-word;';
    var TD_DATE = TD_WRAP;
    var TD_DETAIL =
      TD_WRAP + ' background-color:#f0f3f7; color:#444444; line-height:1.5; padding:6px 8px;';

    var colgroupHtml =
      '<colgroup>' +
      '<col style="width:110px;">' +
      '<col style="width:30%;">' +
      '<col style="width:40%;">' +
      '<col style="width:20%;">' +
      '</colgroup>';

    var tbodyParts = [];
    rows.forEach(function (row, ri) {
      var bg = ri % 2 === 0 ? '#ffffff' : '#f7f7f7';
      var dates = row[dateField] || [];
      var isMulti = dates.length > 1;

      tbodyParts.push(
        '<tr>' +
        '<td style="' + TD_DATE + ' background-color:' + bg + ';">' +
        _renderGoLiveDateMainCellV2_(row, dateField) + '</td>' +
        '<td style="' + TD_WRAP + ' background-color:' + bg + ';">' +
        CoreUtils.escapeHtml(row.accountName || '') + '</td>' +
        '<td style="' + TD_WRAP + ' background-color:' + bg + ';">' +
        CoreUtils.escapeHtml(_resolveGoLiveDeploymentColumn_(row)) + '</td>' +
        '<td style="' + TD_WRAP + ' background-color:' + bg + ';">' +
        CoreUtils.escapeHtml(row.partner || '') + '</td>' +
        '</tr>'
      );

      if (isMulti) {
        tbodyParts.push(
          '<tr><td colspan="4" style="' + TD_DETAIL + '">' +
          _renderGoLiveMultiDateDetailV2_(dates) + '</td></tr>'
        );
      }
    });

    return '<table style="' + TABLE_STYLE + '">' + colgroupHtml + '<thead><tr>' +
      '<th style="' + TH_STYLE + '">Date</th>' +
      '<th style="' + TH_STYLE + '">Account</th>' +
      '<th style="' + TH_STYLE + '">Deployment</th>' +
      '<th style="' + TH_STYLE + '">Partner</th>' +
      '</tr></thead><tbody>' + tbodyParts.join('') + '</tbody></table>';
  }

  /**
   * N8 V2: Recent Go-Lives inner content (used by side-by-side renderer).
   * @param {AppConfig} config
   * @return {string}
   * @private
   */
  function _buildRecentGoLivesContentV2_(config) {
    var cfg = CoreConfig.withDefaults(config);
    var recentDays = cfg.report.recentWindowDays != null ? cfg.report.recentWindowDays : 30;
    var rows = CoreData.getRecentGoLives(cfg, null, recentDays) || [];
    rows = CoreData.filterRowsByReportProductScope_(rows, cfg);
    rows = CoreData.filterRowsExcludedFromReport_(rows);

    var effectiveRows = _filterRowsByReportProductScopeV2_(
      CoreData.getAllEffectiveDeployments(cfg), cfg
    );
    var effectiveByDeploymentId = _buildReportEffectiveLookup_(effectiveRows);

    function earliestDate_(r) {
      if (!r.recentDates || !r.recentDates.length) return r.lastGoLiveDate || '';
      return r.recentDates.reduce(function (min, d) {
        return (!min || d.date < min) ? d.date : min;
      }, '');
    }
    rows = rows.slice().sort(function (a, b) {
      var ad = earliestDate_(a);
      var bd = earliestDate_(b);
      if (ad < bd) return -1;
      if (ad > bd) return 1;
      return String(a.accountName || '').localeCompare(String(b.accountName || ''));
    });

    return _buildGoLivesTableV2_(rows, effectiveByDeploymentId, 'recentDates',
      '(No recent go lives in report)');
  }

  /**
   * N8 V2: Upcoming Go-Lives inner content (used by side-by-side renderer).
   * @param {AppConfig} config
   * @return {string}
   * @private
   */
  function _buildUpcomingGoLivesContentV2_(config) {
    var cfg = CoreConfig.withDefaults(config);
    var upcomingDays = cfg.report.upcomingWindowDays != null ? cfg.report.upcomingWindowDays : 60;
    var rows = CoreData.getUpcomingGoLives(cfg, null) || [];
    rows = _filterUpcomingGoLivesForReportV2_(rows, upcomingDays);
    rows = CoreData.filterRowsByReportProductScope_(rows, cfg);
    rows = CoreData.filterRowsExcludedFromReport_(rows);

    var effectiveRows = _filterRowsByReportProductScopeV2_(
      CoreData.getAllEffectiveDeployments(cfg), cfg
    );
    var effectiveByDeploymentId = _buildReportEffectiveLookup_(effectiveRows);

    rows = rows.slice().sort(function (a, b) {
      var ad = a.nextGoLiveDate || a.mtpDate || '';
      var bd = b.nextGoLiveDate || b.mtpDate || '';
      if (ad < bd) return -1;
      if (ad > bd) return 1;
      return String(a.accountName || '').localeCompare(String(b.accountName || ''));
    });

    return _buildGoLivesTableV2_(rows, effectiveByDeploymentId, 'upcomingDates',
      '(No upcoming go lives in report)');
  }

  /**
   * V2.1: Recent + Upcoming Go-Lives side-by-side (Gmail-safe two-column table).
   * @param {AppConfig} config
   * @return {string}
   * @private
   */
  function renderGoLivesSideBySideSectionV2_(config) {
    var cfg = CoreConfig.withDefaults(config);
    var recentHtml = _buildRecentGoLivesContentV2_(cfg);
    var upcomingHtml = _buildUpcomingGoLivesContentV2_(cfg);

    var SUB_HEADING =
      'font-family:Arial,sans-serif; color:#0f4c81; font-size:12px; font-weight:bold; ' +
      'border-bottom:1px solid #c9d9f0; padding-bottom:3px; margin:0 0 8px 0;';

    var innerHtml =
      '<table cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse;">' +
      '<tr>' +
      '<td style="width:50%; vertical-align:top; padding-right:8px;">' +
      '<div style="' + SUB_HEADING + '">Recent Go-Lives</div>' + recentHtml + '</td>' +
      '<td style="width:50%; vertical-align:top; padding-left:8px;">' +
      '<div style="' + SUB_HEADING + '">Upcoming Go-Lives</div>' + upcomingHtml + '</td>' +
      '</tr></table>';

    return '<div style="margin-bottom:32px;">' + innerHtml + '</div>';
  }

  /**
   * N8 V2: Recent Go-Lives section (standalone; retained for compatibility).
   * @param {AppConfig} config
   * @return {string}
   * @private
   */
  function renderRecentGoLivesSectionV2_(config) {
    return wrapSectionV2_('Recent Go-Lives', _buildRecentGoLivesContentV2_(config));
  }

  /**
   * N8 V2: Upcoming Go-Lives section (standalone; retained for compatibility).
   * @param {AppConfig} config
   * @return {string}
   * @private
   */
  function renderUpcomingGoLivesSectionV2_(config) {
    return wrapSectionV2_('Upcoming Go-Lives', _buildUpcomingGoLivesContentV2_(config));
  }

  /**
   * N8 V2: trend chip for KPI tiles.
   * @param {Object} trend
   * @param {string} label
   * @return {string}
   * @private
   */
  function _renderTrendChipV2_(trend, label) {
    var color = trend.polarity === 'good' ? '#4CAF50'
              : trend.polarity === 'bad'  ? '#F44336'
              : '#999999';
    return (
      '<div style="font-size:10px; color:#666666; margin-top:4px;">' +
      CoreUtils.escapeHtml(label) + ': ' +
      '<span style="color:' + color + '; font-weight:bold;">' +
      CoreUtils.escapeHtml(trend.arrow + ' ' + trend.label) + '</span></div>'
    );
  }

  /**
   * V2.8: direction-aware trend pill for health KPI hero cards (Gmail-safe).
   * @param {string} status Green|Red|Yellow
   * @param {number} delta  Signed count change (current − previous month)
   * @return {string}
   * @private
   */
  function _renderHealthTrendPill_(status, delta) {
    if (!delta) {
      return (
        '<span style="display:inline-block;background-color:#999999;color:#ffffff;' +
        'font-size:10px;font-weight:bold;padding:3px 10px;border-radius:12px;white-space:nowrap;">' +
        '\u25CF 0</span>'
      );
    }
    var arrow = delta > 0 ? '\u25B2' : '\u25BC';
    var sign = delta > 0 ? '+' : '';
    var bg;
    if (status === 'Green') {
      bg = delta > 0 ? '#4CAF50' : '#F44336';
    } else {
      bg = delta < 0 ? '#4CAF50' : '#F44336';
    }
    return (
      '<span style="display:inline-block;background-color:' + bg + ';color:#ffffff;' +
      'font-size:10px;font-weight:bold;padding:3px 10px;border-radius:12px;white-space:nowrap;">' +
      CoreUtils.escapeHtml(arrow + ' ' + sign + delta) + '</span>'
    );
  }

  /**
   * V2.8: unified portfolio share bar beneath health hero cards.
   * @param {Array<Object>} rows
   * @param {number} totalActive
   * @return {string}
   * @private
   */
  function _renderHealthPortfolioShareBar_(rows, totalActive) {
    if (!totalActive || !rows || !rows.length) return '';
    var cells = rows.map(function (row) {
      var w = (row.currentCount / totalActive) * 100;
      var label = w >= 12 ? (Math.round(row.currentPct * 100) + '%') : '';
      return (
        '<td style="width:' + w + '%;background-color:' + CoreUtils.escapeHtml(row.color) +
        ';text-align:center;font-size:10px;color:#ffffff;font-weight:bold;padding:6px 0;' +
        'font-family:Arial,sans-serif;vertical-align:middle;">' +
        CoreUtils.escapeHtml(label) + '</td>'
      );
    }).join('');
    return (
      '<table cellpadding="0" cellspacing="0" border="0" ' +
      'style="width:100%;border-collapse:collapse;margin-top:10px;height:24px;"><tr>' +
      cells + '</tr></table>'
    );
  }

  /**
   * N8 V2: Deployment Health Breakdown as Gmail-safe hero KPI cards.
   * @param {AppConfig} config
   * @return {string}
   * @private
   */
  function renderHealthBreakdownSectionV2_(config) {
    var cfg = CoreConfig.withDefaults(config);
    var result;
    var healthHistory;
    try {
      result = CoreAnalytics.getHealthBreakdown(cfg, V2_REPORT_SCOPE_OPTS_);
      healthHistory = CoreAnalytics.getHealthHistory(cfg);
    } catch (err) {
      Logger.log('CoreReport.renderHealthBreakdownSectionV2_: failed: ' + err);
      return wrapSectionV2_('Deployment Health Breakdown',
        '<p style="font-size:11px; color:#cc0000;">\u26A0 Health Breakdown unavailable: ' +
        CoreUtils.escapeHtml(String(err)) + '</p>');
    }

    var colCount = result.rows.length || 1;
    var colWidth = Math.floor(100 / colCount) + '%';

    var totalActive = result.dataIntegrity.reconciledTotal;
    if (totalActive === undefined || totalActive === null) {
      totalActive = result.rows.reduce(function (sum, row) {
        return sum + (row.currentCount || 0);
      }, 0);
    }

    var tilesHtml = result.rows.map(function (row) {
      var series = (healthHistory && healthHistory[row.status])
        ? healthHistory[row.status].slice()
        : [];
      if (series.length) {
        series[series.length - 1] = row.currentCount;
      } else {
        series = [row.currentCount];
      }
      var delta = series.length >= 2
        ? series[series.length - 1] - series[series.length - 2]
        : 0;
      var pillHtml = _renderHealthTrendPill_(row.status, delta);
      var pctRound = Math.round(row.currentPct * 100);

      return (
        '<td style="width:' + colWidth + '; vertical-align:top; padding:4px;">' +
        '<table cellpadding="0" cellspacing="0" border="0" ' +
        'style="width:100%; border-collapse:collapse; border:1px solid #dddddd; ' +
        'font-family:Arial,sans-serif;">' +
        '<tr><td style="background-color:' + CoreUtils.escapeHtml(row.color) + '; color:#ffffff; ' +
        'font-weight:bold; font-size:10px; text-transform:uppercase; padding:6px 8px; text-align:center;">' +
        CoreUtils.escapeHtml(String(row.status).toUpperCase()) + '</td></tr>' +
        '<tr><td style="padding:12px 10px; text-align:center; background-color:#ffffff;">' +
        '<div style="font-size:36px; font-weight:bold; color:' + CoreUtils.escapeHtml(row.color) +
        '; line-height:1;">' + CoreUtils.escapeHtml(String(row.currentCount)) + '</div>' +
        '<div style="font-size:12px; color:#94A3B8; margin-top:4px;">of ' +
        CoreUtils.escapeHtml(String(totalActive)) + ' active &middot; ' + pctRound + '%</div>' +
        '<div style="margin:8px auto 0;">' + pillHtml + '</div></td></tr></table></td>'
      );
    }).join('');

    var innerHtml =
      '<table cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse; margin-bottom:6px;">' +
      '<tr>' + tilesHtml + '</tr></table>' +
      '<div style="font-size:11px; color:#666666; font-family:Arial,sans-serif; margin-top:8px;">' +
      'Portfolio: <strong style="color:#333333;">' + CoreUtils.escapeHtml(String(totalActive)) +
      '</strong> active deployments</div>';

    if (result.dataIntegrity.showDisclaimer) {
      innerHtml += _renderDisclaimerParagraph_(cfg.report.disclaimers.healthBreakdown);
    }

    var ad = cfg.activeDeployments || {};
    if (ad.productModeUnionEnabled && ad.productModeCountGrain &&
        ad.productModeDisplayGrain &&
        ad.productModeCountGrain !== ad.productModeDisplayGrain) {
      innerHtml += _renderDisclaimerParagraph_(
        'Health totals count unique product functions. The Deployments tab may group ' +
        'related functions into fewer display rows.');
    }

    return wrapSectionV2_('Deployment Health Breakdown', innerHtml);
  }

  /**
   * V2.1: Partner breakdown inner HTML (top-N capped).
   * @param {AppConfig} config
   * @return {string}
   * @private
   */
  function _buildPartnerBreakdownContentV2_(config) {
    var cfg = CoreConfig.withDefaults(config);
    var result;
    try {
      result = CoreAnalytics.getPartnerBreakdown(cfg, V2_REPORT_SCOPE_OPTS_);
    } catch (err) {
      Logger.log('CoreReport._buildPartnerBreakdownContentV2_: failed: ' + err);
      return '<p style="font-size:11px; color:#cc0000;">\u26A0 Partner Breakdown unavailable: ' +
        CoreUtils.escapeHtml(String(err)) + '</p>';
    }

    if (!result.rows || !result.rows.length) {
      return '<p style="font-size:11px; color:#666666;">(No data)</p>';
    }

    var maxPct = 0;
    result.rows.forEach(function (row) {
      if (row.pct > maxPct) maxPct = row.pct;
    });

    var visible = result.rows.slice(0, V2_BREAKDOWN_TOP_N_);
    var remaining = result.rows.length - visible.length;

    var barsHtml = visible.map(function (row) {
      var barPct = maxPct > 0 ? (row.pct / maxPct) * 100 : 0;
      var rightLabel = row.count + ' (' + (row.pct * 100).toFixed(1) + '%)';
      return renderDivBarV2_(row.partner, barPct, '#0f4c81', rightLabel);
    }).join('');

    if (remaining > 0) {
      barsHtml += '<p style="font-size:10px; color:#999999; margin:4px 0 0 0; font-family:Arial,sans-serif;">+' +
        remaining + ' more</p>';
    }

    var innerHtml = barsHtml;
    if (result.dataIntegrity.showDisclaimer) {
      innerHtml += _renderDisclaimerParagraph_(cfg.report.disclaimers.partnerBreakdown);
    }
    return innerHtml;
  }

  /**
   * V2.1: Services Approach breakdown inner HTML (top-N capped).
   * @param {AppConfig} config
   * @return {string}
   * @private
   */
  function _buildApproachBreakdownContentV2_(config) {
    var cfg = CoreConfig.withDefaults(config);
    var result;
    try {
      result = CoreAnalytics.getApproachBreakdown(cfg, V2_REPORT_SCOPE_OPTS_);
    } catch (err) {
      Logger.log('CoreReport._buildApproachBreakdownContentV2_: failed: ' + err);
      return '<p style="font-size:11px; color:#cc0000;">\u26A0 Approach Breakdown unavailable: ' +
        CoreUtils.escapeHtml(String(err)) + '</p>';
    }

    if (!result.rows || !result.rows.length) {
      return '<p style="font-size:11px; color:#666666;">(No data)</p>';
    }

    var maxPct = 0;
    result.rows.forEach(function (row) {
      if (row.pct > maxPct) maxPct = row.pct;
    });

    var visible = result.rows.slice(0, V2_BREAKDOWN_TOP_N_);
    var remaining = result.rows.length - visible.length;

    var barsHtml = visible.map(function (row) {
      var barPct = maxPct > 0 ? (row.pct / maxPct) * 100 : 0;
      var displayPct = row.displayPct !== undefined ? row.displayPct : Math.round(row.pct * 100);
      var rightLabel = row.count + ' (' + displayPct + '%)';
      return renderDivBarV2_(row.approach, barPct, '#0f4c81', rightLabel);
    }).join('');

    if (remaining > 0) {
      barsHtml += '<p style="font-size:10px; color:#999999; margin:4px 0 0 0; font-family:Arial,sans-serif;">+' +
        remaining + ' more</p>';
    }

    var innerHtml = barsHtml;
    if (result.dataIntegrity.showDisclaimer) {
      innerHtml += _renderDisclaimerParagraph_(cfg.report.disclaimers.approachBreakdown);
    }
    return innerHtml;
  }

  /**
   * V2.1: Partner + Services Approach side-by-side (Gmail-safe two-column table).
   * @param {AppConfig} config
   * @return {string}
   * @private
   */
  function renderPartnerAndApproachSectionV2_(config) {
    var cfg = CoreConfig.withDefaults(config);
    var partnerHtml = _buildPartnerBreakdownContentV2_(cfg);

    var approachHtml;
    if (!cfg.report.sections || cfg.report.sections.approach !== false) {
      approachHtml = _buildApproachBreakdownContentV2_(cfg);
    } else {
      approachHtml = '<p style="font-size:11px; color:#666666;">(Section disabled)</p>';
    }

    var SUB_HEADING =
      'font-family:Arial,sans-serif; color:#0f4c81; font-size:12px; font-weight:bold; ' +
      'border-bottom:1px solid #c9d9f0; padding-bottom:3px; margin:0 0 8px 0;';

    var innerHtml =
      '<table cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse;">' +
      '<tr>' +
      '<td style="width:50%; vertical-align:top; padding-right:8px;">' +
      '<div style="' + SUB_HEADING + '">Partner Breakdown</div>' + partnerHtml + '</td>' +
      '<td style="width:50%; vertical-align:top; padding-left:8px;">' +
      '<div style="' + SUB_HEADING + '">Services Approach Breakdown</div>' + approachHtml + '</td>' +
      '</tr></table>';

    return '<div style="margin-bottom:32px;">' + innerHtml + '</div>';
  }

  /**
   * N8 V2: Partner Breakdown div bars (standalone; retained for compatibility).
   * @param {AppConfig} config
   * @return {string}
   * @private
   */
  function renderPartnerBreakdownSectionV2_(config) {
    return wrapSectionV2_('Partner Breakdown', _buildPartnerBreakdownContentV2_(config));
  }

  /**
   * N8 V2: Services Approach Breakdown div bars (standalone; retained for compatibility).
   * @param {AppConfig} config
   * @return {string}
   * @private
   */
  function renderApproachBreakdownSectionV2_(config) {
    return wrapSectionV2_('Services Approach Breakdown', _buildApproachBreakdownContentV2_(config));
  }

  /**
   * N8 V2: assembles body sections (health/partner/approach added in later phases).
   * @param {AppConfig} config
   * @return {string}
   * @private
   */
  function buildReportSectionsV2_(config) {
    var cfg = CoreConfig.withDefaults(config);
    var sections = [];

    var execHtml = CoreExecSummary.buildSectionHtmlV2(cfg);
    if (execHtml) sections.push(execHtml);

    sections.push(renderHealthBreakdownSectionV2_(cfg));
    sections.push(renderRedYellowSectionV2_(cfg));
    sections.push(renderPartnerAndApproachSectionV2_(cfg));
    sections.push(renderRecentGoLivesSectionV2_(cfg));
    sections.push(renderUpcomingGoLivesSectionV2_(cfg));

    return sections.join('\n');
  }

  /**
   * N8 V2: single Gmail HTML shell.
   * @param {AppConfig} config
   * @param {string} bodyContent
   * @return {string}
   * @private
   */
  function wrapReportShellV2_(config, bodyContent) {
    var cfg = CoreConfig.withDefaults(config);
    var dateLbl = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM yyyy');
    var title = cfg.report.title || 'Deployment Health Report';
    var freshnessBanner = buildFreshnessReportBanner_(cfg);

    var headerHtml =
      '<div style="background-color:#0f4c81; margin-bottom:24px; padding:18px 26px; ' +
      'display:flex; align-items:center; font-family:Arial,sans-serif;">' +
      '<div style="background-color:#ffffff; padding:10px 14px; border-radius:6px; margin-right:20px;">' +
      (cfg.report.headerLogoUrl
        ? '<img src="' + CoreUtils.escapeHtml(cfg.report.headerLogoUrl) + '" alt="Workday" ' +
          'width="40" height="40" style="display:block;border:0;outline:none;text-decoration:none;" />'
        : '') +
      '</div>' +
      '<div><div style="color:#ffffff; font-size:20px; font-weight:bold;">' +
      CoreUtils.escapeHtml(title) + '</div>' +
      '<div style="color:#c9d9f0; font-size:12px; margin-top:4px;">Monthly Report \u2013 ' +
      dateLbl + '</div></div></div>';

    var footerHtml =
      '<div style="background-color:#0f4c81; margin-top:24px; padding:10px 16px; font-family:Arial,sans-serif;">' +
      '<div style="background-color:#ffffff; border-radius:6px; padding:8px 12px; ' +
      'display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#555555;">' +
      '<div><strong style="color:#0f2e66;">' +
      CoreUtils.escapeHtml(cfg.report.footerAttribution || '') +
      '</strong><span> \u00b7 Powered by Sana </span>' +
      (cfg.report.sanaLogoUrl
        ? '<img alt="Sana" style="height:12px; width:12px; margin-left:4px; vertical-align:middle;" src="' +
          CoreUtils.escapeHtml(cfg.report.sanaLogoUrl) + '">'
        : '') +
      '</div>' +
      '<div style="font-size:10px; color:#999999; white-space:nowrap;">Generated ' + dateLbl + '</div>' +
      '</div></div>';

    return (
      '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      '<title>' + CoreUtils.escapeHtml(title) + '</title></head>' +
      '<body style="font-family:Arial,sans-serif; font-size:12px; color:#333333; ' +
      'max-width:680px; margin:0 auto; padding:20px;">' +
      headerHtml +
      (cfg.student && cfg.student.reportDisclosure && cfg.student.reportDisclosure.enabled === true
        ? '<div style="font-size:11px; color:#4a628f; padding:4px 12px; font-style:italic;">' +
          CoreUtils.escapeHtml(cfg.student.reportDisclosure.copy || '') + '</div>'
        : '') +
      freshnessBanner +
      bodyContent +
      footerHtml +
      '</body></html>'
    );
  }

  /**
   * N8 V2: builds the full Gmail-targeted monthly report HTML.
   * @param {AppConfig} config
   * @return {string}
   */
  function buildReportV2(config) {
    var cfg = CoreConfig.withDefaults(config);
    return wrapReportShellV2_(cfg, buildReportSectionsV2_(cfg));
  }

  /**
   * N8 V2: run analytics then build report.
   * @param {AppConfig} config
   * @return {string}
   */
  function buildReportV2WithAnalytics(config) {
    var cfg = CoreConfig.withDefaults(config);
    var totalStart = Date.now();
    var phaseStart = totalStart;
    CoreData.beginReportBuildContext_(cfg);
    try {
      CoreAnalytics.update(config);
      CoreData._markReportBuildPhase_('analytics.update', phaseStart, totalStart);
      phaseStart = Date.now();

      var html = buildReportV2(config);
      CoreData._markReportBuildPhase_('report.sections', phaseStart, totalStart);
      CoreData._markReportBuildPhase_('total', totalStart, totalStart);
      return html;
    } finally {
      CoreData.endReportBuildContext_();
    }
  }

  /**
   * Diagnostic: runs the Gmail report preview build with phase timings.
   * @param {AppConfig} config
   * @return {{ totalMs: number, phases: Array<Object> }}
   */
  function debugGmailReportPreviewPerformance(config) {
    var cfg = CoreConfig.withDefaults(config);
    var totalStart = Date.now();
    var phases = [];
    CoreData.beginReportBuildContext_(cfg);
    try {
      var phaseStart = totalStart;
      CoreAnalytics.update(cfg);
      phases.push({ phase: 'analytics.update', ms: Date.now() - phaseStart,
        totalMs: Date.now() - totalStart });
      phaseStart = Date.now();

      buildReportV2(cfg);
      phases.push({ phase: 'report.sections', ms: Date.now() - phaseStart,
        totalMs: Date.now() - totalStart });
    } finally {
      CoreData.endReportBuildContext_();
    }
    var totalMs = Date.now() - totalStart;
    var goLiveSummary = null;
    var usesPfGoLive = !!(cfg.activeDeployments &&
      cfg.activeDeployments.productModeUnionEnabled &&
      cfg.activeDeployments.productModeGoLiveSource === 'productFunction');
    if (usesPfGoLive) {
      try {
        var recent = CoreData.getRecentGoLives(cfg, null) || [];
        var upcoming = CoreData.getUpcomingGoLives(cfg, null) || [];
        var goLiveAnalysis = null;
        try {
          var dbg = CoreData._debugProductModeGoLiveEvents(cfg, null);
          goLiveAnalysis = dbg && dbg.analysis ? dbg.analysis : null;
        } catch (analysisErr) {
          Logger.log('CoreReport.debugGmailReportPreviewPerformance: go-live analysis failed: ' +
                     analysisErr);
        }
        goLiveSummary = {
          productModeGoLiveHelperUsed: true,
          recentGoLiveEventCount: recent.length,
          upcomingGoLiveEventCount: upcoming.length,
          rawRecentPfRowCount: goLiveAnalysis ? goLiveAnalysis.recentGoLiveRawPfRowCount : null,
          groupedRecentEventCount: goLiveAnalysis ? goLiveAnalysis.recentGoLiveGroupedEventCount : null,
          rawUpcomingPfRowCount: goLiveAnalysis ? goLiveAnalysis.upcomingGoLiveRawPfRowCount : null,
          groupedUpcomingEventCount: goLiveAnalysis ? goLiveAnalysis.upcomingGoLiveGroupedEventCount : null
        };
      } catch (e) {
        Logger.log('CoreReport.debugGmailReportPreviewPerformance: go-live counts failed: ' + e);
      }
    }
    phases.push({ phase: 'total', ms: totalMs, totalMs: totalMs });
    Logger.log('CoreReport.debugGmailReportPreviewPerformance(' + (cfg.appId || '?') +
               '): total=' + totalMs + 'ms');
    if (goLiveSummary) {
      Logger.log('  goLiveSummary=' + JSON.stringify(goLiveSummary));
    }
    phases.forEach(function (p) {
      Logger.log('  ' + p.phase + ': +' + p.ms + 'ms (total ' + p.totalMs + 'ms)');
    });
    return { totalMs: totalMs, phases: phases, goLiveSummary: goLiveSummary };
  }

  // --- EXPORTS ---------------------------------------------------------------

  return {
    buildInlineHtml: buildInlineHtml,
    buildOutlookHtml: buildOutlookHtml,
    buildInlineHtmlWithAnalytics: buildInlineHtmlWithAnalytics,
    exportInlineAndOutlookToDrive: exportInlineAndOutlookToDrive,
    exportReportV2ToDrive: exportReportV2ToDrive,
    buildReportV2: buildReportV2,
    buildReportV2WithAnalytics: buildReportV2WithAnalytics,
    debugGmailReportPreviewPerformance: debugGmailReportPreviewPerformance
  };
})();