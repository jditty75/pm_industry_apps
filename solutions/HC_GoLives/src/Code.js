/*******************
 * HC Go Live Tracker — App 2
 * Thin wrappers around the shared GoLives library
 *******************/

function doGet() {
  return HtmlService
    .createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Healthcare Go Lives')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

const EXPORT_FOLDER_ID = '1F2DCiV6q2IBGiArqFdGSc78P59Y4CC0Z';

function onOpen() {
  GoLives.buildMenu('Healthcare Go Lives');
}

function onEdit(e) {
  GoLives.onEditHandler(e);
}

/*******************
 * MENU ACTIONS — must match menu items in buildMenu
 *******************/

function buildGoLivesSheet() {
  GoLives.buildGoLivesSheetForHealthcare();
}

function refreshLogoMapFromGoLives() {
  GoLives.refreshLogoMapFromGoLives();
}

function fillMissingLogosInLogoMap() {
  GoLives.fillMissingLogosInLogoMap();
}

function forceRefreshAllLogosPublic() {
  GoLives.forceRefreshAllLogosPublic();
}

function applyLogoMapToGoLivesPublic() {
  GoLives.applyLogoMapToGoLives();
  SpreadsheetApp.getUi().alert('Applied LogoMap → GoLives.');
}

function consolidateLogoMapPublic() {
  GoLives.consolidateLogoMapPublic();
}

function backfillLogoMapAccountIdsPublic() {
  GoLives.backfillLogoMapAccountIdsPublic();
}

function debugLogoMapNameMatchingPublic() {
  GoLives.debugLogoMapNameMatchingPublic();
}

function upgradeLogoMapUrlsToHttps() {
  GoLives.upgradeLogoMapUrlsToHttps();
}

/*******************
 * WEB APP ENDPOINTS
 *******************/

function getGoLivesData() {
  return GoLives.getGoLivesData({ includePartner: false });
}

function createSlidesFromFilteredGoLives(payload) {
  const rawView = payload && payload.view;
  let view;
  if (rawView === 'upcoming') view = 'upcoming';
  else if (rawView === 'qmp') view = 'qmp';
  else view = 'past';

  let deckTitlePrefix;
  if (view === 'qmp') {
    deckTitlePrefix = 'Healthcare Quarterly Meeting Prep Go Lives Export';
  } else if (view === 'upcoming') {
    deckTitlePrefix = 'Healthcare Upcoming Go Lives Export';
  } else {
    deckTitlePrefix = 'Healthcare Past Go Lives Export';
  }

  return GoLives.createSlidesFromFilteredGoLives(payload, {
    deckTitlePrefix: deckTitlePrefix,
    exportFolderId: EXPORT_FOLDER_ID
  });
}

function exportFilteredGoLivesAsCsv(payload) {
  return GoLives.exportFilteredGoLivesAsCsv(payload);
}

/*******************
 * OPTIONAL LOCAL UTILS
 *******************/

function testMoveToSlideExports() {
  const FOLDER_ID = EXPORT_FOLDER_ID;
  Logger.log('testMoveToSlideExports: starting');
  const title = 'TEST Move to HC SlideExports - ' + new Date().toISOString();
  const pres = SlidesApp.create(title);
  const fileId = pres.getId();
  Logger.log('Created test presentation [fileId=' + fileId + ']: ' + title);
  try {
    const file = DriveApp.getFileById(fileId);
    const folder = DriveApp.getFolderById(FOLDER_ID);
    Logger.log('Target folder: ' + folder.getName() + ' [' + FOLDER_ID + ']');
    file.moveTo(folder);
    Logger.log('Move complete.');
  } catch (e) {
    Logger.log('Error moving test file: ' + e);
  }
  Logger.log('testMoveToSlideExports: done');
}

function debugSvgInsert() {
  const url = 'https://pacesemi.org/wp-content/uploads/2025/01/pace-logo.svg';
  const pres = SlidesApp.create('TEST SVG Insert ' + new Date().toISOString());
  const slide = pres.getSlides()[0];

  // Try URL insert
  try {
    slide.insertImage(url, 50, 50, 200, 200);
    Logger.log('SVG URL insert SUCCEEDED');
  } catch (e) {
    Logger.log('SVG URL insert FAILED: ' + e.message);
  }

  // Try blob insert with forced SVG content type
  try {
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    Logger.log('Fetch code: ' + resp.getResponseCode());
    Logger.log('Fetch Content-Type: ' + resp.getHeaders()['Content-Type']);
    const blob = resp.getBlob();
    blob.setContentType('image/svg+xml');
    slide.insertImage(blob, 270, 50, 200, 200);
    Logger.log('SVG blob insert SUCCEEDED');
  } catch (e) {
    Logger.log('SVG blob insert FAILED: ' + e.message);
  }

  // Inspect SVG contents for known troublesome elements
  try {
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    const svgText = resp.getContentText();
    Logger.log('SVG size (chars): ' + svgText.length);
    Logger.log('Has <style>: ' + /<style/i.test(svgText));
    Logger.log('Has <filter>: ' + /<filter/i.test(svgText));
    Logger.log('Has <mask>: ' + /<mask/i.test(svgText));
    Logger.log('Has <clipPath>: ' + /<clipPath/i.test(svgText));
    Logger.log('Has <use>: ' + /<use/i.test(svgText));
    Logger.log('Has <image>: ' + /<image\s/i.test(svgText));
    Logger.log('Has xlink:href: ' + /xlink:href/i.test(svgText));
    Logger.log('Has external font @import or url(http): ' + /(?:@import|url\(\s*['"]?https?:)/i.test(svgText));
    Logger.log('First 500 chars: ' + svgText.substring(0, 500));
  } catch (e) {
    Logger.log('Inspection failed: ' + e.message);
  }
}

function debugWpComInsert() {
  const url = 'https://i0.wp.com/comacc.org/wp-content/uploads/2024/03/Memorial-Sloan-Kettering-Cancer-Center.png';
  const pres = SlidesApp.create('TEST WPCOM Insert ' + new Date().toISOString());
  const slide = pres.getSlides()[0];

  // URL insert
  try {
    slide.insertImage(url, 50, 50, 200, 200);
    Logger.log('URL insert SUCCEEDED');
  } catch (e) {
    Logger.log('URL insert FAILED: ' + e.message);
  }

  // Direct fetch and inspect
  try {
    const resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'image/*'
      }
    });
    Logger.log('Fetch code: ' + resp.getResponseCode());
    Logger.log('Fetch Content-Type: ' + resp.getHeaders()['Content-Type']);
    Logger.log('Fetch Content-Length: ' + resp.getHeaders()['Content-Length']);
    const finalUrl = resp.getHeaders()['Location'] || 'no redirect header';
    Logger.log('Final URL: ' + finalUrl);
    
    const blob = resp.getBlob();
    Logger.log('Blob size: ' + blob.getBytes().length);
    
    // Try blob insert
    slide.insertImage(blob, 270, 50, 200, 200);
    Logger.log('Blob insert SUCCEEDED');
  } catch (e) {
    Logger.log('Fetch or blob insert FAILED: ' + e.message);
  }
}

function debugRealSlidesExportForAccountPublic() {
  GoLives.debugRealSlidesExportForAccount('Memorial Sloan-Kettering');
}

function debugSlidesBuilderForAccountPublic() {
  GoLives.debugSlidesBuilderForAccount('Memorial Sloan-Kettering');
}