const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadEdmGlobals } = require('./loadGasSrc');

const g = loadEdmGlobals();

test('Responses folder layout creates Qualtrics/Responses/Inbox+Failed', () => {
  const tree = {};
  const driveApp = {
    getFolderById: (folderId) => ({
      getId: () => folderId,
      getFoldersByName: (name) => {
        const childId = tree[folderId] && tree[folderId][name];
        return {
          hasNext: () => !!childId,
          next: () => ({ getId: () => childId })
        };
      },
      createFolder: (name) => {
        if (!tree[folderId]) {
          tree[folderId] = {};
        }
        const childId = folderId + '__' + name;
        tree[folderId][name] = childId;
        return { getId: () => childId };
      }
    })
  };

  const ids = g.EdmQualtricsDriveSetup.ensureQualtricsResponsesFolders('ext-data-root', driveApp);
  assert.ok(ids.inboxId.includes('Inbox'));
  assert.ok(ids.failedId.includes('Failed'));
  assert.ok(ids.responsesFolderId.includes('Responses'));

  const again = g.EdmQualtricsDriveSetup.ensureQualtricsResponsesFolders('ext-data-root', driveApp);
  assert.equal(ids.inboxId, again.inboxId);
  assert.equal(ids.failedId, again.failedId);
});
