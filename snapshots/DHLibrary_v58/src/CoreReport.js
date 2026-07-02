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
    var effectiveByDeploymentId = {};
    CoreData.getAllEffectiveDeployments(cfg).forEach(function (r) {
      if (r.deploymentId) effectiveByDeploymentId[r.deploymentId] = r;
    });

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
      var effective   = effectiveByDeploymentId[row.deploymentId];
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
        td_(row.deploymentName) +
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
  var effectiveByDeploymentId = {};
  CoreData.getAllEffectiveDeployments(cfg).forEach(function (r) {
    if (r.deploymentId) effectiveByDeploymentId[r.deploymentId] = r;
  });

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
    var effective     = effectiveByDeploymentId[row.deploymentId];
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
      td_(row.deploymentName) +
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

  // --- EXPORTS ---------------------------------------------------------------

  return {
    buildInlineHtml: buildInlineHtml,
    buildOutlookHtml: buildOutlookHtml,
    buildInlineHtmlWithAnalytics: buildInlineHtmlWithAnalytics,
    exportInlineAndOutlookToDrive: exportInlineAndOutlookToDrive
  };
})();