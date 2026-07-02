/**
 * CoreSurveySchedule.gs
 *
 * Manages the MDS/PGL survey schedule calendar.
 *
 * Public surface:
 *   CoreSurveySchedule.resolve(yearMonth)  → schedule entry + isProjected flag
 *   CoreSurveySchedule.listKnownMonths()   → array of FY27 YYYY-MM keys
 *
 * FY27 constant: verbatim from MDS_PGL Upgrade.docx.
 * FY28+ months: projected via first-full-week-Wednesday algorithm.
 *
 * Phase MDS-PGL Redesign (2026-06)
 */

var CoreSurveySchedule = (function () {

  // ===========================================================================
  // FY27 CONSTANT (verbatim — do not normalise day-30 end dates)
  // ===========================================================================

  var _FY27 = Object.freeze({
    '2026-02': {
      surveyOpen: '2026-02-04', reminder1: '2026-02-11', reminder2: '2026-02-23', surveyClose: '2026-02-25',
      mdsOneThirdWindow: { start: '2026-01-01', end: '2026-01-31' },
      pglFirstMtpWindow: { start: '2025-12-01', end: '2025-12-31' }
    },
    '2026-03': {
      surveyOpen: '2026-03-04', reminder1: '2026-03-11', reminder2: '2026-03-23', surveyClose: '2026-03-25',
      mdsOneThirdWindow: { start: '2026-02-01', end: '2026-02-28' },
      pglFirstMtpWindow: { start: '2026-01-01', end: '2026-01-31' }
    },
    '2026-04': {
      surveyOpen: '2026-04-01', reminder1: '2026-04-08', reminder2: '2026-04-20', surveyClose: '2026-04-22',
      mdsOneThirdWindow: { start: '2026-03-01', end: '2026-03-31' },
      pglFirstMtpWindow: { start: '2026-02-01', end: '2026-02-28' }
    },
    '2026-05': {
      surveyOpen: '2026-05-06', reminder1: '2026-05-13', reminder2: '2026-05-25', surveyClose: '2026-05-27',
      mdsOneThirdWindow: { start: '2026-04-01', end: '2026-04-30' },
      pglFirstMtpWindow: { start: '2026-03-01', end: '2026-03-31' }
    },
    '2026-06': {
      surveyOpen: '2026-06-03', reminder1: '2026-06-10', reminder2: '2026-06-22', surveyClose: '2026-06-24',
      mdsOneThirdWindow: { start: '2026-05-01', end: '2026-05-31' },
      pglFirstMtpWindow: { start: '2026-04-01', end: '2026-04-30' }
    },
    '2026-07': {
      surveyOpen: '2026-07-08', reminder1: '2026-07-15', reminder2: '2026-07-27', surveyClose: '2026-07-29',
      // Source spec shows "5/31-6/30" — encode verbatim. Do NOT normalize.
      mdsOneThirdWindow: { start: '2026-05-31', end: '2026-06-30' },
      pglFirstMtpWindow: { start: '2026-05-01', end: '2026-05-31' }
    },
    '2026-08': {
      surveyOpen: '2026-08-05', reminder1: '2026-08-12', reminder2: '2026-08-24', surveyClose: '2026-08-26',
      // Source spec shows "7/1-7/30" — encode verbatim.
      mdsOneThirdWindow: { start: '2026-07-01', end: '2026-07-30' },
      pglFirstMtpWindow: { start: '2026-06-01', end: '2026-06-30' }
    },
    '2026-09': {
      surveyOpen: '2026-09-02', reminder1: '2026-09-09', reminder2: '2026-09-21', surveyClose: '2026-09-23',
      // Source spec shows "7/31-8/30" — encode verbatim.
      mdsOneThirdWindow: { start: '2026-07-31', end: '2026-08-30' },
      pglFirstMtpWindow: { start: '2026-07-01', end: '2026-07-31' }
    },
    '2026-10': {
      surveyOpen: '2026-10-07', reminder1: '2026-10-14', reminder2: '2026-10-26', surveyClose: '2026-10-28',
      // Source spec shows "8/31-9/30" — encode verbatim.
      mdsOneThirdWindow: { start: '2026-08-31', end: '2026-09-30' },
      pglFirstMtpWindow: { start: '2026-08-01', end: '2026-08-31' }
    },
    '2026-11': {
      surveyOpen: '2026-11-04', reminder1: '2026-11-11', reminder2: '2026-11-23', surveyClose: '2026-11-25',
      // Source spec shows "10/1-10/30" — encode verbatim.
      mdsOneThirdWindow: { start: '2026-10-01', end: '2026-10-30' },
      pglFirstMtpWindow: { start: '2026-09-01', end: '2026-09-30' }
    },
    '2026-12': {
      surveyOpen: '2026-12-02', reminder1: '2026-12-09', reminder2: '2026-12-21', surveyClose: '2026-12-23',
      // Source spec shows "10/31-11/30" — encode verbatim.
      mdsOneThirdWindow: { start: '2026-10-31', end: '2026-11-30' },
      pglFirstMtpWindow: { start: '2026-10-01', end: '2026-10-31' }
    },
    '2027-01': {
      surveyOpen: '2027-01-06', reminder1: '2027-01-13', reminder2: '2027-01-25', surveyClose: '2027-01-27',
      // Source spec shows "12/1-12/30" — encode verbatim.
      mdsOneThirdWindow: { start: '2026-12-01', end: '2026-12-30' },
      pglFirstMtpWindow: { start: '2026-11-01', end: '2026-11-30' }
    }
  });

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Formats a Date as 'YYYY-MM-DD'.
   * @param {Date} d
   * @return {string}
   * @private
   */
  function _fmt(d) {
    var yyyy = d.getFullYear();
    var mm   = String(d.getMonth() + 1).padStart(2, '0');
    var dd   = String(d.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }

  /**
   * Adds n whole days to a Date and returns a new Date.
   * @param {Date} d
   * @param {number} n
   * @return {Date}
   * @private
   */
  function _addDays(d, n) {
    return new Date(d.getTime() + n * 86400000);
  }

  /**
   * Returns the { start: 'YYYY-MM-01', end: 'YYYY-MM-DD' } range for a month.
   * monthIndex is 0-based and may be negative (prior year).
   * @param {number} year
   * @param {number} monthIndex  0-based; negative values wrap into the prior year.
   * @return {{ start: string, end: string }}
   * @private
   */
  function _monthRange(year, monthIndex) {
    // Normalise: JavaScript Date handles negative months correctly.
    var d = new Date(year, monthIndex, 1);
    var y = d.getFullYear();
    var m = d.getMonth(); // 0-based
    var lastDay = new Date(y, m + 1, 0).getDate();
    var mm = String(m + 1).padStart(2, '0');
    return {
      start: y + '-' + mm + '-01',
      end:   y + '-' + mm + '-' + String(lastDay).padStart(2, '0')
    };
  }

  /**
   * Returns the first Wednesday of (year, month) whose preceding Monday and
   * Tuesday also fall within the same calendar month.
   *
   * Algorithm per spec:
   *   For day 1..7: if day-of-week === 3 (Wed) and day-2 >= 1 and day-1 >= 1 → return.
   *   Safety net: for day 8..14 if day-of-week === 3 → return.
   *
   * @param {number} year
   * @param {number} month  0-based JS month index.
   * @return {Date}
   * @private
   */
  function _findFirstFullWeekWednesday(year, month) {
    // First pass: days 1..7
    for (var day = 1; day <= 7; day++) {
      var d = new Date(year, month, day);
      if (d.getDay() === 3) { // Wednesday
        var monday  = day - 2;
        var tuesday = day - 1;
        if (monday >= 1 && tuesday >= 1) {
          return d;
        }
      }
    }
    // Safety net: days 8..14
    for (var day2 = 8; day2 <= 14; day2++) {
      var d2 = new Date(year, month, day2);
      if (d2.getDay() === 3) {
        return d2;
      }
    }
    // Fallback (should never reach here for a valid month)
    return new Date(year, month, 1);
  }

  /**
   * Projects a schedule entry for months beyond the FY27 constant.
   * @param {string} yearMonth  'YYYY-MM'
   * @return {Object}  Full schedule entry with isProjected: true.
   * @private
   */
  function _projectMonth(yearMonth) {
    var parts = yearMonth.split('-');
    var year  = parseInt(parts[0], 10);
    var month = parseInt(parts[1], 10) - 1; // 0-based

    var surveyOpen  = _findFirstFullWeekWednesday(year, month);
    var reminder1   = _addDays(surveyOpen, 7);
    var reminder2   = _addDays(surveyOpen, 19);
    var surveyClose = _addDays(surveyOpen, 21);

    var mdsWin = _monthRange(year, month - 1);
    var pglWin = _monthRange(year, month - 2);

    return {
      yearMonth:          yearMonth,
      surveyOpen:         _fmt(surveyOpen),
      reminder1:          _fmt(reminder1),
      reminder2:          _fmt(reminder2),
      surveyClose:        _fmt(surveyClose),
      mdsOneThirdWindow:  mdsWin,
      pglFirstMtpWindow:  pglWin,
      isProjected:        true
    };
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Resolves a YYYY-MM key to its survey schedule entry.
   * Returns a FY27 constant entry (isProjected: false) or a computed fallback
   * (isProjected: true) for months not in the constant table.
   *
   * @param {string} yearMonth  'YYYY-MM'
   * @return {{
   *   yearMonth: string,
   *   surveyOpen: string,
   *   reminder1: string,
   *   reminder2: string,
   *   surveyClose: string,
   *   mdsOneThirdWindow: { start: string, end: string },
   *   pglFirstMtpWindow: { start: string, end: string },
   *   isProjected: boolean
   * }}
   */
  function resolve(yearMonth) {
    if (_FY27[yearMonth]) {
      return Object.assign({ yearMonth: yearMonth, isProjected: false }, _FY27[yearMonth]);
    }
    return _projectMonth(yearMonth);
  }

  /**
   * Returns an array of all yearMonth keys defined in the FY27 constant.
   * @return {Array<string>}
   */
  function listKnownMonths() {
    return Object.keys(_FY27).slice();
  }

  // ===========================================================================
  // SMOKE TEST
  // ===========================================================================

  /**
   * Smoke test — run manually from the Apps Script editor.
   * Verifies: FY27 lookup, basic projected month, and the 7/1-is-Thursday edge case.
   */
  function _test_surveySchedule() {
    var r1 = resolve('2026-03');
    Logger.log('_test_surveySchedule: resolve(2026-03) → surveyOpen=' + r1.surveyOpen +
               ', isProjected=' + r1.isProjected +
               ', mdsWin.start=' + r1.mdsOneThirdWindow.start);

    var r2 = resolve('2027-02');
    Logger.log('_test_surveySchedule: resolve(2027-02) → surveyOpen=' + r2.surveyOpen +
               ', isProjected=' + r2.isProjected +
               ' (expected 2027-02-03)');

    var r3 = resolve('2027-07');
    Logger.log('_test_surveySchedule: resolve(2027-07) → surveyOpen=' + r3.surveyOpen +
               ', isProjected=' + r3.isProjected +
               ' (expected 2027-07-07; 7/1 is Thursday)');
  }

  return {
    resolve:          resolve,
    listKnownMonths:  listKnownMonths,
    _test_surveySchedule: _test_surveySchedule
  };
})();
