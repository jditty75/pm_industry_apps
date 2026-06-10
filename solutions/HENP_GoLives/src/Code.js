/*******************
 * HENP Go Live Tracker — App 3
 * Thin wrappers around the shared GoLives library.
 *
 * FUNCTION INVENTORY (verify all present before saving):
 *   doGet
 *   onOpen
 *   onEdit
 *   buildGoLivesSheet
 *   refreshLogoMapFromGoLives
 *   fillMissingLogosInLogoMap
 *   forceRefreshAllLogosPublic
 *   applyLogoMapToGoLivesPublic
 *   consolidateLogoMapPublic
 *   backfillLogoMapAccountIdsPublic
 *   debugLogoMapNameMatchingPublic
 *   upgradeLogoMapUrlsToHttps
 *   getGoLivesData
 *   createSlidesFromFilteredGoLives
 *   exportFilteredGoLivesAsCsv
 *   testSlidesAuth
 *******************/

function doGet() {
  return HtmlService
    .createTemplateFromFile('Index')
    .evaluate()
    .setTitle('HENP Go Lives')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Folder where all HENP Slides exports will be stored.
 * SlideExports/HENP in the SLG Shared drive.
 */
const EXPORT_FOLDER_ID = '1TqSdEPUsSy5KMU-fVREmrHGIU7T3cjJZ';

/*******************
 * SPREADSHEET HOOKS
 *******************/

function onOpen() {
  GoLives.buildMenu('HENP Go Lives');
}

function onEdit(e) {
  GoLives.onEditHandler(e);
}

/*******************
 * MENU ACTIONS — must match menu items in GoLives.buildMenu
 *******************/

function buildGoLivesSheet() {
  GoLives.buildGoLivesSheetForHENP();
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

/**
 * Data endpoint used by Index.html front-end.
 * HENP includes deployment partner information (D3 confirmed).
 */
function getGoLivesData() {
  return GoLives.getGoLivesData({ includePartner: true });
}

/**
 * Slides export.
 * Payload supports:
 *   { searchQuery, start, end, industry, subIndustry, classification,
 *     subRegion, deploymentPartner, productAreas, productAreasMatch, view }
 *
 * The shared library applies a rolling 12-month cap for Past/Upcoming.
 * QMP view skips the cap and produces a two-section deck with dividers.
 */
function createSlidesFromFilteredGoLives(payload) {
  const rawView = payload && payload.view;
  let view;
  if (rawView === 'upcoming') view = 'upcoming';
  else if (rawView === 'qmp') view = 'qmp';
  else view = 'past';

  let deckTitlePrefix;
  if (view === 'qmp') {
    deckTitlePrefix = 'HENP Quarterly Meeting Prep Go Lives Export';
  } else if (view === 'upcoming') {
    deckTitlePrefix = 'HENP Upcoming Go Lives Export';
  } else {
    deckTitlePrefix = 'HENP Past Go Lives Export';
  }

  return GoLives.createSlidesFromFilteredGoLives(payload, {
    deckTitlePrefix: deckTitlePrefix,
    exportFolderId: EXPORT_FOLDER_ID
  });
}

/**
 * CSV/Excel export of filtered GoLives rows (no 12-month cap).
 * Uses the same filter semantics as the Slides export.
 */
function exportFilteredGoLivesAsCsv(payload) {
  return GoLives.exportFilteredGoLivesAsCsv(payload);
}

/*******************
 * OPTIONAL LOCAL UTILS
 *******************/

function testSlidesAuth() {
  const pres = SlidesApp.create('Auth Test - HENP Go Lives');
  pres.getSlides()[0].getShapes(); // no-op
}