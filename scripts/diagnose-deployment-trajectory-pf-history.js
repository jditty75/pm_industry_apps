#!/usr/bin/env node
/**
 * Read-only diagnostic for Product Function History exports (CSV).
 *
 * Usage (paths are local only — never commit exports):
 *   node scripts/diagnose-deployment-trajectory-pf-history.js \
 *     --history path/to/SFDC_DeploymentProductFunctionHistory.csv \
 *     --product-functions path/to/SFDC_DeploymentProductFunctions.csv
 *
 * Optional:
 *   --mtp-events path/to/Deployment_Trajectory_MtpEvents.csv
 */

'use strict';

const fs = require('fs');
const path = require('path');
const pf = require('../libraries/DepMngr/diagnostics/pfHistoryExportAnalysis');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    if (argv[i] === '--history') out.history = argv[++i];
    else if (argv[i] === '--product-functions') out.productFunctions = argv[++i];
    else if (argv[i] === '--mtp-events') out.mtpEvents = argv[++i];
  }
  return out;
}

function parseCsv(text) {
  var lines = text.split(/\r?\n/).filter(function (l) { return l.length; });
  if (!lines.length) return [];
  var headers = splitCsvLine(lines[0]);
  var rows = [];
  for (var i = 1; i < lines.length; i++) {
    var cells = splitCsvLine(lines[i]);
    var row = {};
    headers.forEach(function (h, idx) {
      row[h] = cells[idx] != null ? cells[idx] : '';
    });
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line) {
  var result = [];
  var cur = '';
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

function countMtpEventTypes(rows) {
  var counts = {};
  (rows || []).forEach(function (row) {
    var t = String(row.event_type || row.Event_Type || '').trim();
    if (t) counts[t] = (counts[t] || 0) + 1;
  });
  return counts;
}

function main() {
  var args = parseArgs(process.argv);
  if (!args.history) {
    console.error('Missing --history <csv>');
    process.exit(1);
  }

  var historyRows = parseCsv(fs.readFileSync(path.resolve(args.history), 'utf8'));
  var pfRows = [];
  if (args.productFunctions) {
    pfRows = parseCsv(fs.readFileSync(path.resolve(args.productFunctions), 'utf8'));
  }
  var idSet = pf.productFunctionIdSetFromExport(pfRows);
  var analysis = pf.analyzeProductFunctionHistoryExport(historyRows, idSet);

  var report = {
    generatedAt: new Date().toISOString(),
    productFunctionExportRowCount: pfRows.length,
    analysis: analysis
  };

  if (args.mtpEvents) {
    var mtpRows = parseCsv(fs.readFileSync(path.resolve(args.mtpEvents), 'utf8'));
    report.mtpEventTypeCounts = countMtpEventTypes(mtpRows);
    report.mtpEventRowCount = mtpRows.length;
  }

  console.log(JSON.stringify(report, null, 2));
}

main();
