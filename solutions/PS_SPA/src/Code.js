var APPS_CONFIG_SHEET_ID = '1A-ThKP3tr2zIkU6hzvHoalTqjLt2520vmbklQrTRE8Q'; // <-- same Sheet you already use
var APPS_SHEET_NAME = 'Apps';
var ANNOUNCEMENTS_SHEET_NAME = 'Announcements';

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Workday Professional Services - US Industry Tool Portal')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .setHeight(1500)
    .setWidth(1000);
}

function getPortalData() {
  return {
    apps: getAppsConfig(),
    announcements: getAnnouncements()
  };
}

function getAppsConfig() {
  var ss = SpreadsheetApp.openById(APPS_CONFIG_SHEET_ID);
  var sheet = ss.getSheetByName(APPS_SHEET_NAME);
  if (!sheet) return [];

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var headers = values[0];
  var rows = values.slice(1);

  var apps = rows.map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return {
      id: obj.app_id,
      name: obj.app_name,
      team: obj.team,
      description: obj.description,
      visibility: obj.visibility,
      url: obj.url,
      sortOrder: obj.sort_order || 9999
    };
  });

  return apps
    .filter(function(app) { return app.visibility !== 'INTERNAL_TOOLING'; })
    .sort(function(a, b) {
      return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
    });
}

function getAnnouncements() {
  var ss = SpreadsheetApp.openById(APPS_CONFIG_SHEET_ID);
  var sheet = ss.getSheetByName(ANNOUNCEMENTS_SHEET_NAME);
  if (!sheet) return [];

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var headers = values[0];
  var rows = values.slice(1);

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  return rows
    .map(function(row) {
      var obj = {};
      headers.forEach(function(h, i) { obj[h] = row[i]; });
      return obj;
    })
    .filter(function(a) {
      if (!a.active || a.active === false) return false;
      if (a.active === 'FALSE') return false;

      if (a.start_date) {
        var s = new Date(a.start_date);
        if (today < s) return false;
      }
      if (a.end_date) {
        var e = new Date(a.end_date);
        if (today > e) return false;
      }
      return true;
    })
    .map(function(a) {
      return {
        id: a.id,
        message: a.message,
        level: (a.level || 'INFO').toString().toUpperCase()
      };
    });
}
