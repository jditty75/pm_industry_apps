/**
 * Port of solutions/SLG_Capacity/pipeline/transform_v4.py (four-file WoW contract).
 * @namespace SlgCapacityTransform
 */
var SlgCapacityTransform = (function () {
  'use strict';

  var JUNK = { '': true, '(Blank)': true, 'Total': true, 'nan': true, 'None': true };
  var FQM = { 1: 'Q4', 2: 'Q1', 3: 'Q1', 4: 'Q1', 5: 'Q2', 6: 'Q2', 7: 'Q2', 8: 'Q3', 9: 'Q3', 10: 'Q3', 11: 'Q4', 12: 'Q4' };

  /**
   * @param {*} v
   * @return {string}
   */
  function nid(v) {
    if (v == null || v === '') return '';
    var s = String(v).trim();
    if (!s || s.toLowerCase() === 'nan' || s.toLowerCase() === 'none') return '';
    return /^\d+\.0$/.test(s) ? s.slice(0, -2) : s;
  }

  /**
   * @param {*} v
   * @return {number}
   */
  function snum(v) {
    try {
      return parseFloat(String(v).replace(/,/g, '').replace(/%/g, '')) || 0;
    } catch (e) {
      return 0;
    }
  }

  /**
   * @param {*} s
   * @return {string}
   */
  function clean(s) {
    var t = String(s).trim();
    return (!t || t === 'nan' || t === 'None') ? 'Unclassified' : t;
  }

  /**
   * @param {*} v
   * @return {boolean}
   */
  function isJunk(v) {
    return JUNK[String(v).trim()] === true;
  }

  /**
   * @param {Date} d
   * @return {number} Monday=0 .. Sunday=6 (pandas dayofweek)
   */
  function pandasDow(d) {
    var js = d.getDay();
    return js === 0 ? 6 : js - 1;
  }

  /**
   * @param {*} value
   * @return {Date|null}
   */
  function parseDate(value) {
    if (value instanceof Date && !isNaN(value.getTime())) {
      return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    var s = String(value || '').trim();
    if (!s) return null;
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      return new Date(parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    }
    return null;
  }

  /**
   * @param {Date} weekEndSaturday
   * @return {string}
   */
  function fqFromWeekend(weekEndSaturday) {
    var d = parseDate(weekEndSaturday);
    if (!d) return '';
    var fri = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    var fy = fri.getMonth() >= 1 ? fri.getFullYear() + 1 : fri.getFullYear();
    var q = FQM[fri.getMonth() + 1];
    return 'FY' + String(fy).slice(-2) + '-' + q;
  }

  /**
   * @param {*} v
   * @return {string}
   */
  function fqLabel(v) {
    if (v == null) return '';
    var t = String(v).trim().toUpperCase().replace(/\s+/g, ' ');
    var m = t.match(/FY\s*(\d{2,4})\s*[-_\/ ]*Q\s*([1-4])/) ||
      t.match(/(\d{4})\s*[-_\/ ]*Q\s*([1-4])/);
    return m ? 'FY' + m[1].slice(-2) + '-Q' + m[2] : '';
  }

  /**
   * @param {Date|string} run
   * @return {string}
   */
  function curQuarter(run) {
    var d = parseDate(run);
    if (!d) return '';
    var sat = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6);
    return fqFromWeekend(sat);
  }

  /**
   * @param {string} worker
   * @param {string} regionWorker
   * @return {string}
   */
  function wclass(worker, regionWorker) {
    if (String(worker).indexOf('[C]') >= 0) return 'Contractor';
    return String(regionWorker).trim() === 'Government' ? 'SLG' : 'Non-SLG';
  }

  /**
   * @param {string} a
   * @param {string} b
   * @return {number}
   */
  function compareFq(a, b) {
    function rk(fq) {
      var m = String(fq).match(/FY(\d{2})-Q([1-4])/);
      return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [99, 9];
    }
    var ra = rk(a);
    var rb = rk(b);
    if (ra[0] !== rb[0] || ra[1] !== rb[1]) {
      if (ra[0] < rb[0] || (ra[0] === rb[0] && ra[1] < rb[1])) return -1;
      return 1;
    }
    return 0;
  }

  /**
   * @param {Date|string} run
   * @return {{ seamCut: Date, seamStart: Date }}
   */
  function computeSeam(run) {
    var d = parseDate(run);
    if (!d) throw new Error('Invalid run date');
    var daysToSat = (5 - pandasDow(d)) % 7;
    var inprogSat = new Date(d.getFullYear(), d.getMonth(), d.getDate() + daysToSat);
    var lastCompleted = new Date(inprogSat.getFullYear(), inprogSat.getMonth(), inprogSat.getDate() - 7);
    return { seamCut: lastCompleted, seamStart: inprogSat };
  }

  /**
   * @param {Date} d
   * @return {string}
   */
  function weekKeyYmd(d) {
    var x = parseDate(d);
    if (!x) return '';
    return x.getFullYear() + '-' +
      String(x.getMonth() + 1).padStart(2, '0') + '-' +
      String(x.getDate()).padStart(2, '0');
  }

  /**
   * @param {Date} d
   * @return {string}
   */
  function weekHeaderMmDdYyyy(d) {
    var x = parseDate(d);
    if (!x) return '';
    return String(x.getMonth() + 1).padStart(2, '0') + '/' +
      String(x.getDate()).padStart(2, '0') + '/' +
      x.getFullYear();
  }

  /**
   * @param {Object.<string, string>[]} hist
   * @return {{ roleMap: Object, workerRole: Object }}
   */
  function roleMaps(hist) {
    var roleMap = {};
    var workerRole = {};
    var byWp = {};
    var byW = {};
    hist.forEach(function (row) {
      var id = nid(row['Worker ID']);
      var icp = snum(row['ICP Hours']);
      var proj = clean(row.Project);
      var role = clean(row['Project Role Category']);
      var wpKey = id + '\t' + proj;
      if (!byWp[wpKey]) byWp[wpKey] = {};
      byWp[wpKey][role] = (byWp[wpKey][role] || 0) + icp;
      if (!byW[id]) byW[id] = {};
      byW[id][role] = (byW[id][role] || 0) + icp;
    });
    Object.keys(byWp).forEach(function (k) {
      var parts = k.split('\t');
      var best = 'Unclassified';
      var bestV = -1;
      Object.keys(byWp[k]).forEach(function (role) {
        if (byWp[k][role] > bestV) {
          bestV = byWp[k][role];
          best = role;
        }
      });
      roleMap[parts[0] + '\t' + parts[1]] = best;
    });
    Object.keys(byW).forEach(function (id) {
      var best = 'Unclassified';
      var bestV = -1;
      Object.keys(byW[id]).forEach(function (role) {
        if (byW[id][role] > bestV) {
          bestV = byW[id][role];
          best = role;
        }
      });
      workerRole[id] = best;
    });
    return { roleMap: roleMap, workerRole: workerRole };
  }

  /**
   * @param {Object.<string, string>[]} fc
   * @param {Object.<string, string>[]} ac
   * @param {Object} maps
   * @param {Date} seamCut
   * @param {Date} seamStart
   * @param {string} curQ
   * @param {string[]} log
   * @return {Array[]}
   */
  function buildCurrentActuals(fc, ac, maps, seamCut, seamStart, curQ, log) {
    var seamCutKey = weekKeyYmd(seamCut);
    var agg = {};
    ac.forEach(function (row) {
      var id = nid(row['Worker ID']);
      var name = String(row.Worker || '').trim();
      var hrs = snum(row['ICP Hours']);
      var wed = parseDate(row['Week End Transaction Date']);
      if (!wed || !id || hrs === 0) return;
      var wk = weekKeyYmd(wed);
      var fq = fqFromWeekend(wed);
      if (wk > seamCutKey || compareFq(fq, curQ) > 0) return;
      var proj = clean(row.Project);
      var key = id + '\t' + name + '\t' + wk + '\t' + proj;
      if (!agg[key]) {
        agg[key] = { id: id, name: name, wed: wed, wk: wk, proj: proj, hrs: 0 };
      }
      agg[key].hrs += hrs;
    });
    var rows = [];
    var i = 0;
    Object.keys(agg).forEach(function (key) {
      var r = agg[key];
      var rc = maps.roleMap[r.id + '\t' + r.proj] || maps.workerRole[r.id] || 'Unclassified';
      rows.push([
        r.id, r.name, r.wed, r.wk, r.proj, rc, Math.round(r.hrs * 100) / 100, i + 2
      ]);
      i++;
    });
    rows.forEach(function (row) {
      if (parseDate(row[2]).getDay() !== 6) {
        throw new Error('Actuals_Current: non-Saturday week_start detected.');
      }
    });
    log.push('Actuals_Current: ' + rows.length + ' rows; seam actuals<=' + seamCutKey);
    var header = SlgCapacitySchema.ACTCUR_COLS.slice();
    return [header].concat(rows);
  }

  /**
   * @param {Object.<string, string>[]} fc
   * @param {Date} seamStart
   * @param {string[]} log
   * @return {{ staffed: Array[], unstaffed: Array[], weekCols: string[], xorg: Array[] }}
   */
  function buildForecast(fc, seamStart, log) {
    var nTerm = 0;
    var slgRows = [];
    var xoRows = [];
    fc.forEach(function (row) {
      if (isJunk(row.Worker)) return;
      if (String(row.Worker || '').toLowerCase().indexOf('terminated') >= 0) {
        nTerm++;
        return;
      }
      var wed = parseDate(row['Week End Transaction Date']);
      if (!wed || wed < seamStart) return;
      var hrs = snum(row['Forecasted Hours']);
      var regionWorker = String(row['Worker Region'] || '');
      var wc = wclass(row.Worker, regionWorker);
      var rec = {
        id: nid(row['Worker ID']),
        worker: row.Worker,
        account: row['Customer Name'],
        project: row.Project,
        roleCat: row['Project Role Category'],
        specialty: row['Specialty - Text'],
        jobProfile: row['Job Profile'],
        regionWorker: regionWorker,
        manager: row["Worker's Manager"],
        wk: weekHeaderMmDdYyyy(wed),
        hrs: hrs,
        wc: wc
      };
      if (wc === 'SLG') slgRows.push(rec);
      else xoRows.push(rec);
    });

    var pivot = {};
    slgRows.forEach(function (r) {
      var ctx = [
        r.id, r.worker, r.account, r.project, r.roleCat, r.specialty,
        r.jobProfile, r.regionWorker, r.manager
      ].join('\t');
      if (!pivot[ctx]) pivot[ctx] = { ctx: ctx, weeks: {} };
      pivot[ctx].weeks[r.wk] = (pivot[ctx].weeks[r.wk] || 0) + r.hrs;
    });
    var weekSet = {};
    slgRows.forEach(function (r) { weekSet[r.wk] = true; });
    var weekCols = Object.keys(weekSet).sort(function (a, b) {
      return parseDate(a) - parseDate(b);
    });
    var staffedCtx = [
      'Employee ID', 'Worker', 'Project Role', 'Account', 'Region - Worker', "Worker's Manager",
      'Project', 'Project Region', 'Job Profile', 'Customer Segment Practice', 'Specialty Practice',
      'Engagement Manager', 'Customer Projects', 'Internal Projects (Excludes Education)',
      'Education Projects', 'Resource Type', 'Project Role Category'
    ];
    var staffedHeader = staffedCtx.concat(weekCols);
    var staffedBody = [];
    Object.keys(pivot).forEach(function (ctxKey) {
      var parts = pivot[ctxKey].ctx.split('\t');
      var row = [
        parts[0], parts[1], '', parts[2], parts[7], parts[8], parts[3], '',
        parts[6], '', parts[5], '', '', '', '', '', parts[4]
      ];
      weekCols.forEach(function (wk) {
        row.push(pivot[ctxKey].weeks[wk] || 0);
      });
      staffedBody.push(row);
    });
    var staffed = [staffedHeader].concat(staffedBody);
    var unstaffed = [staffedHeader];

    var xorgAgg = {};
    xoRows.forEach(function (r) {
      if (!r.hrs) return;
      var grp = r.wc === 'Contractor' ? 'Contractor' : 'Workday Regions';
      var region = grp === 'Contractor' ? 'Contractor' :
        (String(r.regionWorker).trim() || 'Unclassified');
      var fq = fqFromWeekend(parseDate(r.wk));
      var key = grp + '\t' + region + '\t' + fq;
      xorgAgg[key] = (xorgAgg[key] || 0) + r.hrs;
    });
    var xorgHeader = SlgCapacitySchema.XORG_COLS.slice();
    var xorgBody = Object.keys(xorgAgg).map(function (k) {
      var p = k.split('\t');
      return [p[0], p[1], p[2], Math.round(xorgAgg[k] * 100) / 100];
    });
    log.push('Forecast: ' + staffedBody.length + ' SLG staffed rows, ' + weekCols.length +
      ' week cols; xorg ' + xorgBody.length + ' rows; dropped ' + nTerm + ' terminated');
    return {
      staffed: staffed,
      unstaffed: unstaffed,
      weekCols: weekCols,
      xorg: [xorgHeader].concat(xorgBody)
    };
  }

  /**
   * @param {Object.<string, string>[]} hist
   * @param {string} curQ
   * @param {string[]} log
   * @return {Array[]}
   */
  function buildHistory(hist, curQ, log) {
    var agg = {};
    hist.forEach(function (row) {
      if (isJunk(row.Worker)) return;
      var id = nid(row['Worker ID']);
      if (!id) return;
      var fq = fqLabel(row['Fiscal Qtr']);
      if (!fq || compareFq(fq, curQ) >= 0) return;
      var wc = wclass(row.Worker, row['Region as of Date Worked']);
      var key = [
        id, row.Worker, wc, clean(row['Region as of Date Worked']), fq,
        clean(row.Project), clean(row['Project Role Category'])
      ].join('\t');
      if (!agg[key]) {
        agg[key] = {
          icp: 0, nonicp: 0,
          sp: clean(row['Specialty Practice']),
          ssp: clean(row['Sub-Specialty Practice'])
        };
      }
      agg[key].icp += snum(row['ICP Hours']);
      agg[key].nonicp += snum(row['Non-Billable Hours']);
    });
    var header = SlgCapacitySchema.HIST_COLS.slice();
    var body = Object.keys(agg).map(function (k) {
      var p = k.split('\t');
      var a = agg[k];
      return [
        p[0], p[1], p[2], p[3], p[4], p[5], p[6],
        Math.round(a.icp * 100) / 100, Math.round(a.nonicp * 100) / 100, a.sp, a.ssp
      ];
    });
    if (body.some(function (row) { return row[4] === curQ; })) {
      throw new Error('History: current quarter ' + curQ + ' must be excluded.');
    }
    log.push('History: ' + body.length + ' rows');
    return [header].concat(body);
  }

  /**
   * @param {string[][]} utilRaw
   * @param {Object.<string, string>[]} ac
   * @param {string} curQ
   * @param {string[]} log
   * @return {Array[]}
   */
  function buildUtil(utilRaw, ac, curQ, log) {
    if (!utilRaw || utilRaw.length < 4) {
      throw new Error('Utilization: source too short');
    }
    var band = utilRaw[1];
    var meas = utilRaw[2];
    var starts = [];
    for (var ci = 0; ci < band.length; ci++) {
      var v = String(band[ci] || '').trim();
      var m = v.match(/^(\d{4})-Q([1-4])$/);
      if (m) starts.push({ ci: ci, q: 'FY' + m[1].slice(-2) + '-Q' + m[2] });
    }
    starts.sort(function (a, b) { return a.ci - b.ci; });
    if (!starts.length) throw new Error('Utilization: no quarter bands in row 1.');
    var spans = {};
    for (var idx = 0; idx < starts.length; idx++) {
      var lo = starts[idx].ci;
      var hi = idx + 1 < starts.length ? starts[idx + 1].ci : utilRaw[0].length;
      spans[starts[idx].q] = { lo: lo, hi: hi };
    }
    function col(name, lo, hi) {
      for (var c = lo; c < hi; c++) {
        if (String(meas[c] || '').trim() === name) return c;
      }
      return -1;
    }
    var prevq = {};
    ac.forEach(function (row) {
      var id = nid(row['Worker ID']);
      var icp = snum(row['ICP Hours']);
      var wed = parseDate(row['Week End Transaction Date']);
      if (!id || !wed) return;
      var fq = fqFromWeekend(wed);
      var pk = id + '|' + fq;
      prevq[pk] = (prevq[pk] || 0) + icp;
    });
    var rows = [];
    var negDen = [];
    for (var ri = 3; ri < utilRaw.length; ri++) {
      var r = utilRaw[ri];
      var wid = nid(r[0]);
      var name = String(r[1] || '').trim();
      if (!wid || isJunk(name)) continue;
      var hasT = false;
      Object.keys(spans).forEach(function (q) {
        var span = spans[q];
        var tc = col('MAX(Target Hours by Quarter Calculation)', span.lo, span.hi);
        if (tc >= 0 && snum(r[tc]) > 0) hasT = true;
      });
      if (!hasT) continue;
      Object.keys(spans).forEach(function (q) {
        var span = spans[q];
        var lo = span.lo;
        var hi = span.hi;
        var tc = col('MAX(Target Hours by Quarter Calculation)', lo, hi);
        var rc = col('MAX(Utilization Target Percentage)', lo, hi);
        var tgt = tc >= 0 ? snum(r[tc]) : 0;
        var rate = rc >= 0 ? snum(r[rc]) : 0;
        if (tgt <= 0) return;
        var actual;
        var blend;
        if (compareFq(q, curQ) < 0) {
          actual = prevq[wid + '|' + q] || 0;
          blend = actual;
        } else {
          var ic = col('SUM(ICP Hours)', lo, hi);
          var fcc = col('SUM(Future Forecast)', lo, hi);
          var icp = ic >= 0 ? snum(r[ic]) : 0;
          var fut = fcc >= 0 ? snum(r[fcc]) : 0;
          actual = icp;
          blend = icp + fut;
        }
        var fsqC = col(SlgCapacitySchema.MEAS_FSQ, lo, hi);
        var twhC = col(SlgCapacitySchema.MEAS_TWH, lo, hi);
        var prodDen = '';
        if (fsqC >= 0 && twhC >= 0) {
          var diff = snum(r[fsqC]) - snum(r[twhC]);
          if (diff > 0) prodDen = Math.round(diff * 100) / 100;
          else negDen.push(wid + '|' + q);
        }
        rows.push([
          wid, name, q, Math.round(tgt * 100) / 100, rate,
          Math.round(actual * 100) / 100, Math.round(blend * 100) / 100,
          'SLG_Utilization_Quarter', prodDen
        ]);
      });
    }
    if (negDen.length) {
      log.push('Utilization: ' + negDen.length + ' worker×quarter productive_denominator_hours <= 0 (blanked)');
    }
    log.push('Utilization: ' + rows.length + ' rows');
    var header = SlgCapacitySchema.UTIL_COLS.slice();
    return [header].concat(rows);
  }

  /**
   * @param {Array[]} staffed
   * @param {Array[]} unstaffed
   * @param {string[]} weekCols
   * @param {Array[]} actuals
   * @param {Array[]} util
   * @param {Array[]} hist
   * @return {Array[]}
   */
  function buildManifest(staffed, unstaffed, weekCols, actuals, util, hist) {
    function whrs(sheet, cols) {
      if (!sheet || sheet.length < 2 || !cols.length) return 0;
      var hi = sheet[0];
      var sum = 0;
      for (var r = 1; r < sheet.length; r++) {
        cols.forEach(function (wk) {
          var ci = hi.indexOf(wk);
          if (ci >= 0) sum += snum(sheet[r][ci]);
        });
      }
      return Math.round(sum * 10) / 10;
    }
    function distinctCol(sheet, colName) {
      if (!sheet || sheet.length < 2) return 0;
      var ci = sheet[0].indexOf(colName);
      if (ci < 0) return 0;
      var set = {};
      for (var r = 1; r < sheet.length; r++) {
        var v = nid(sheet[r][ci]);
        if (v) set[v] = true;
      }
      return Object.keys(set).length;
    }
    var fmin = '';
    var fmax = '';
    if (weekCols.length) {
      var ds = weekCols.map(function (w) { return parseDate(w); }).filter(Boolean);
      ds.sort(function (a, b) { return a - b; });
      fmin = weekKeyYmd(ds[0]);
      fmax = weekKeyYmd(ds[ds.length - 1]);
    }
    var actBody = actuals.length > 1 ? actuals.slice(1) : [];
    var actSum = 0;
    var actMin = '';
    var actMax = '';
    actBody.forEach(function (row) {
      actSum += snum(row[6]);
      var wk = String(row[3] || '');
      if (!actMin || wk < actMin) actMin = wk;
      if (!actMax || wk > actMax) actMax = wk;
    });
    var header = SlgCapacitySchema.MANIFEST_COLS.slice();
    var body = [
      [SlgCapacitySchema.OUT_FORECAST, Math.max(staffed.length - 1, 0), 'forecast_hours',
        whrs(staffed, weekCols), distinctCol(staffed, 'Employee ID'), fmin, fmax],
      [SlgCapacitySchema.OUT_UNSTAFFED, Math.max(unstaffed.length - 1, 0), 'unstaffed_hours',
        whrs(unstaffed, weekCols), 0, fmin, fmax],
      [SlgCapacitySchema.OUT_ACTUALS, actBody.length, 'actual_icp_hours',
        Math.round(actSum * 10) / 10, distinctCol(actuals, 'employee_id'), actMin, actMax],
      [SlgCapacitySchema.OUT_UTIL, Math.max(util.length - 1, 0), 'target_hours',
        util.slice(1).reduce(function (s, row) { return s + snum(row[3]); }, 0),
        distinctCol(util, 'employee_id'),
        util.length > 1 ? util[1][2] : '', util.length > 1 ? util[util.length - 1][2] : ''],
      [SlgCapacitySchema.OUT_HISTORY, Math.max(hist.length - 1, 0), 'icp_hours',
        hist.slice(1).reduce(function (s, row) { return s + snum(row[7]); }, 0),
        distinctCol(hist, 'employee_id'),
        hist.length > 1 ? hist[1][4] : '', hist.length > 1 ? hist[hist.length - 1][4] : '']
    ];
    body.forEach(function (row) {
      if (typeof row[3] === 'number') row[3] = Math.round(row[3] * 10) / 10;
    });
    return [header].concat(body);
  }

  /**
   * @param {Array[]} staffed
   * @param {string[]} weekCols
   * @param {Array[]} actuals
   * @param {Array[]} util
   * @param {Array[]} hist
   * @param {string} curQ
   * @return {{ ok: boolean, results: Object[] }}
   */
  function validateOutputs(staffed, weekCols, actuals, util, hist, curQ) {
    var results = [];
    function chk(label, cond) {
      results.push({ ok: !!cond, label: label });
    }
    chk('Forecast_Staged: weekly headers present', weekCols.length > 0);
    var allSat = weekCols.every(function (w) {
      var d = parseDate(w);
      return d && d.getDay() === 6;
    });
    chk('Forecast_Staged: all week headers Saturdays', allSat);
    if (actuals.length > 1) {
      var hdr = actuals[0].map(String);
      chk('Actuals_Current: header order==ACTCUR_COLS',
        hdr.join('|') === SlgCapacitySchema.ACTCUR_COLS.join('|'));
    }
    var utilBody = util.slice(1);
    var fqSet = {};
    utilBody.forEach(function (row) { fqSet[row[2]] = true; });
    chk('Utilization: 3 fiscal quarters', Object.keys(fqSet).length === 3);
    chk('History: current quarter excluded', !hist.slice(1).some(function (row) {
      return row[4] === curQ;
    }));
    var ok = results.every(function (r) { return r.ok; });
    return { ok: ok, results: results };
  }

  /**
   * @param {Object} inputs
   * @param {Object.<string, string>[]} inputs.forecast
   * @param {Object.<string, string>[]} inputs.actualsPrevCurrent
   * @param {Object.<string, string>[]} inputs.actualsHistorical
   * @param {string[][]} inputs.utilizationGrid
   * @param {Date|string} [runDate]
   * @return {{ ok: boolean, sheets?: Object, log?: string[], error?: string, validation?: Object }}
   */
  function transform(inputs, runDate) {
    var log = [];
    try {
      var run = runDate || new Date();
      var curQ = curQuarter(run);
      var seam = computeSeam(run);
      log.push('Run=' + weekKeyYmd(run) + ' cur_q=' + curQ +
        ' seam: actuals<=' + weekKeyYmd(seam.seamCut) +
        ' forecast>=' + weekKeyYmd(seam.seamStart));
      var maps = roleMaps(inputs.actualsHistorical);
      var actuals = buildCurrentActuals(
        inputs.forecast, inputs.actualsPrevCurrent, maps,
        seam.seamCut, seam.seamStart, curQ, log
      );
      var fcOut = buildForecast(inputs.forecast, seam.seamStart, log);
      var history = buildHistory(inputs.actualsHistorical, curQ, log);
      var utiln = buildUtil(inputs.utilizationGrid, inputs.actualsPrevCurrent, curQ, log);
      var validation = validateOutputs(
        fcOut.staffed, fcOut.weekCols, actuals, utiln, history, curQ
      );
      if (!validation.ok) {
        return {
          ok: false,
          log: log,
          validation: validation,
          error: 'Transform validation failed'
        };
      }
      var manifest = buildManifest(
        fcOut.staffed, fcOut.unstaffed, fcOut.weekCols, actuals, utiln, history
      );
      return {
        ok: true,
        log: log,
        validation: validation,
        sheets: {
          Forecast_Staged: fcOut.staffed,
          Unstaffed_Demand: fcOut.unstaffed,
          Actuals_Current_Normalized: actuals,
          Utilization_Normalized: utiln,
          History_Normalized: history,
          Xorg_Forecast_Aggregate: fcOut.xorg,
          _manifest: manifest
        }
      };
    } catch (e) {
      return { ok: false, error: String(e), log: log };
    }
  }

  return {
    transform: transform,
    nid: nid,
    fqFromWeekend: fqFromWeekend,
    curQuarter: curQuarter,
    computeSeam: computeSeam,
    parseDate: parseDate,
    weekKeyYmd: weekKeyYmd
  };
})();
