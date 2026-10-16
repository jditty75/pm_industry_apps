/**
 * VOC V1 Deployment Contacts
 * Reads the contacts sheet only for the requested deployment.
 * Requires existing VOC_CONFIG and vocReadSheet from VOC_Data.gs.
 * Source workbooks are never modified.
 */
const VOC_CONTACTS_SHEET = 'SFDC_DeploymentContacts';

function vocGetDeploymentContacts_(industry, deploymentId) {
  const source = VOC_CONFIG.sources.find(s => s.industry === industry);
  if (!source) throw new Error('Unknown industry: ' + industry);
  const spreadsheet = SpreadsheetApp.openById(source.spreadsheetId);
  const contacts = vocReadSheet(spreadsheet, VOC_CONTACTS_SHEET);
  const id = String(deploymentId || '').trim();
  return contacts.filter(c => String(c.Deployment__c || '').trim() === id)
    .map(c => ({
      ...c,
      _vocIndustry: industry
    }));
}

/** Run separately to verify that all three contact sheets are accessible. */
function testVOCContactSources() {
  for (const source of VOC_CONFIG.sources) {
    const spreadsheet = SpreadsheetApp.openById(source.spreadsheetId);
    const sheet = spreadsheet.getSheetByName(VOC_CONTACTS_SHEET);
    if (!sheet) throw new Error('Missing ' + VOC_CONTACTS_SHEET + ' in ' + source.industry);
    const headers = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn())
      .getValues()[0].map(h => String(h || '').trim()) : [];
    for (const field of ['Id', 'Deployment__c', 'Contact__c', 'Contact__r.Name', 'Contact__r.Email', 'Contact_Role__c']) {
      if (!headers.includes(field)) throw new Error('Missing ' + field + ' in ' + source.industry);
    }
    console.log(source.industry + ' contacts: ' + Math.max(0, sheet.getLastRow() - 1) + ' data rows');
  }
  console.log('VOC contact source checks passed');
}

