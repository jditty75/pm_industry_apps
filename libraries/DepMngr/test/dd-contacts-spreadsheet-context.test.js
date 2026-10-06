const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');

function loadInSandbox(relPath, sandbox) {
  const code = fs.readFileSync(path.join(SRC, relPath), 'utf8');
  vm.runInContext(code, sandbox, { filename: relPath });
}

test('getDdAssignmentsFromContacts_ uses CoreData workbook override when active spreadsheet is null', () => {
  const destinationSs = {
    getSheetByName: (name) => {
      if (name !== 'SFDC_DeploymentContacts') {
        return null;
      }
      return {
        getLastRow: () => 2,
        getLastColumn: () => 4,
        getRange: () => ({
          getValues: () => [
            ['Contact_Role__c', 'Deployment__c', 'Contact__r.Email', 'Contact__r.Name'],
            ['Deployment Sponsor', '001DEP0000000001AA', 'sponsor@example.com', 'Sponsor Name']
          ]
        })
      };
    }
  };

  const sandbox = {
    Logger: { log: () => {} },
    CoreData: {
      getWorkbookSpreadsheet: () => destinationSs
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => null
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => null,
        setProperty: () => {}
      })
    },
    Utilities: {
      gzip: (blob) => blob,
      ungzip: (blob) => blob,
      newBlob: (data) => ({
        getBytes: () => (typeof data === 'string' ? Buffer.from(data) : data),
        getDataAsString: () => (typeof data === 'string' ? data : '')
      }),
      base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
      base64Decode: (encoded) => Buffer.from(encoded, 'base64'),
      sleep: () => {}
    },
    CacheService: {
      getDocumentCache: () => ({
        get: () => null,
        put: () => {}
      }),
      getScriptCache: () => ({
        get: () => null,
        put: () => {},
        putAll: () => {},
        removeAll: () => {}
      })
    },
    _perfCacheKnownKeysS_: {},
    _ddContactsCache: null
  };
  vm.createContext(sandbox);
  loadInSandbox('CoreConfig.js', sandbox);
  loadInSandbox('CoreSalesforce.js', sandbox);

  if (typeof sandbox._clearDdContactsCache === 'function') {
    sandbox._clearDdContactsCache();
  }

  const cfg = sandbox.CoreConfig.withDefaults({
    appId: 'SLG_DM',
    sheets: { sfdcContacts: 'SFDC_DeploymentContacts' }
  });
  const map = sandbox.getDdAssignmentsFromContacts_(cfg);
  assert.equal(Object.keys(map).length, 1);
  assert.equal(map['001DEP0000000001AA'].length, 1);
});

test('getDdAssignmentsFromContacts_ uses active spreadsheet when CoreData has no override', () => {
  let activeAccessCount = 0;
  const activeSs = {
    getSheetByName: (name) => {
      if (name !== 'SFDC_DeploymentContacts') {
        return null;
      }
      return {
        getLastRow: () => 2,
        getLastColumn: () => 4,
        getRange: () => ({
          getValues: () => [
            ['Contact_Role__c', 'Deployment__c', 'Contact__r.Email', 'Contact__r.Name'],
            ['Deployment Sponsor', '001DEP0000000002BB', 'sponsor2@example.com', 'Sponsor Two']
          ]
        })
      };
    }
  };

  const sandbox = {
    Logger: { log: () => {} },
    CoreData: {
      getWorkbookSpreadsheet: () => {
        activeAccessCount++;
        return activeSs;
      }
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => {
        throw new Error('should not call getActiveSpreadsheet when CoreData resolver is present');
      }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => null,
        setProperty: () => {}
      })
    },
    Utilities: {
      gzip: (blob) => blob,
      ungzip: (blob) => blob,
      newBlob: (data) => ({
        getBytes: () => (typeof data === 'string' ? Buffer.from(data) : data),
        getDataAsString: () => (typeof data === 'string' ? data : '')
      }),
      base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
      base64Decode: (encoded) => Buffer.from(encoded, 'base64'),
      sleep: () => {}
    },
    CacheService: {
      getDocumentCache: () => ({ get: () => null, put: () => {} }),
      getScriptCache: () => ({
        get: () => null,
        put: () => {},
        putAll: () => {},
        removeAll: () => {}
      })
    },
    _perfCacheKnownKeysS_: {},
    _ddContactsCache: null
  };
  vm.createContext(sandbox);
  loadInSandbox('CoreConfig.js', sandbox);
  loadInSandbox('CoreSalesforce.js', sandbox);
  sandbox._clearDdContactsCache();

  const cfg = sandbox.CoreConfig.withDefaults({
    appId: 'HC_DM',
    sheets: { sfdcContacts: 'SFDC_DeploymentContacts' }
  });
  const map = sandbox.getDdAssignmentsFromContacts_(cfg);
  assert.equal(activeAccessCount >= 1, true);
  assert.equal(Object.keys(map).length, 1);
  assert.equal(map['001DEP0000000002BB'][0].email, 'sponsor2@example.com');
});

test('_resolveWorkbookSpreadsheetForSheetReads_ falls back to active spreadsheet without CoreData', () => {
  const activeSs = { id: 'container-bound' };
  const sandbox = {
    Logger: { log: () => {} },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => activeSs
    }
  };
  vm.createContext(sandbox);
  loadInSandbox('CoreConfig.js', sandbox);
  loadInSandbox('CoreSalesforce.js', sandbox);
  const cfg = sandbox.CoreConfig.withDefaults({ appId: 'SLG_DM' });
  assert.equal(sandbox._resolveWorkbookSpreadsheetForSheetReads_(cfg), activeSs);
});
