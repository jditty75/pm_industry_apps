/**
 * Minimal SpreadsheetApp sheet mock with GAS-like Range dimensional checks.
 */

/**
 * @typedef {Object} GasRangeMock
 * @property {(values: unknown[][]) => void} setValues
 * @property {() => unknown[][]} getValues
 */

/**
 * @return {{
 *   sheet: Object,
 *   getGrid: () => unknown[][],
 *   spreadsheetApp: { create: (name: string) => { getId: () => string, getSheets: () => Object[] } }
 * }}
 */
function createGasSheetHarness() {
  /** @type {unknown[][]} 1-based rows stored at grid[row-1] */
  const grid = [];
  let lastRow = 0;

  /**
   * @param {number} row 1-based
   */
  function ensureRowsThrough(row) {
    while (grid.length < row) {
      grid.push([]);
    }
  }

  /**
   * @param {number} startRow
   * @param {number} startCol
   * @param {number} numRows
   * @param {number} numCols
   * @return {GasRangeMock}
   */
  function getRange(startRow, startCol, numRows, numCols) {
    return {
      setValues(values) {
        if (!Array.isArray(values) || values.length === 0) {
          throw new Error('setValues requires a non-empty 2D array');
        }
        const dataRows = values.length;
        const dataCols = values[0].length;
        if (dataRows !== numRows) {
          throw new Error(
            'The number of rows in the data does not match the number of rows in the range. ' +
              `The data has ${dataRows} but the range has ${numRows}.`
          );
        }
        for (let r = 0; r < dataRows; r += 1) {
          if (values[r].length !== numCols) {
            throw new Error(
              'The number of columns in the data does not match the number of columns in the range. ' +
                `Row ${r} has ${values[r].length} but the range has ${numCols}.`
            );
          }
        }
        for (let r = 0; r < numRows; r += 1) {
          const sheetRow = startRow + r;
          ensureRowsThrough(sheetRow);
          const rowValues = values[r].slice();
          while (rowValues.length < startCol - 1 + numCols) {
            rowValues.push('');
          }
          grid[sheetRow - 1] = rowValues.slice(startCol - 1, startCol - 1 + numCols);
          lastRow = Math.max(lastRow, sheetRow);
        }
      },
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r += 1) {
          const sheetRow = startRow + r;
          const row = grid[sheetRow - 1] || [];
          const slice = [];
          for (let c = 0; c < numCols; c += 1) {
            slice.push(row[c] != null ? row[c] : '');
          }
          out.push(slice);
        }
        return out;
      }
    };
  }

  const sheet = {
    getLastRow() {
      return lastRow;
    },
    setName(name) {
      this._name = name;
      return this;
    },
    setFrozenRows() {},
    getRange
  };

  const spreadsheetApp = {
    create(name) {
      const ss = {
        _id: 'mock-ss-' + name.replace(/\s+/g, '-'),
        getId() {
          return ss._id;
        },
        getSheets() {
          return [sheet];
        }
      };
      return ss;
    },
    openById() {
      return {
        getSheetByName() {
          return sheet;
        }
      };
    }
  };

  return {
    sheet,
    spreadsheetApp,
    getGrid: () => grid.map((r) => r.slice())
  };
}

module.exports = { createGasSheetHarness };
