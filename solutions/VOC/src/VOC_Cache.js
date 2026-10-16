/**
 * VOC V1.2 persistent forecast snapshot.
 * Requires the existing container-bound VOC workbook, VOC_Data.gs,
 * VOC_Forecast.gs and VOC_Contacts.gs.
 *
 * Data stays inside the VOC workbook. This code NEVER writes to source workbooks.
 * Deploy web app as owner, restricted to authorized users.
 */
const VOC_CACHE = Object.freeze({
  property: 'VOC_CACHE_ACTIVE_SLOT',
  slots: ['VOC_Snapshot_A', 'VOC_Snapshot_B'],
  chunkSize: 30000,
  hotSeconds: 900,
  schema: 3
});

function vocCacheBook_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('VOC cache requires a spreadsheet-bound Apps Script project');
  return ss;
}
function vocCacheMeta_() {
  const raw = PropertiesService.getScriptProperties().getProperty(VOC_CACHE.property);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { throw new Error('Invalid VOC cache metadata'); }
}
function vocCacheHotKey_(kind, version, id) {
  // CacheService keys cannot exceed 250 characters.
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(id));
  return 'voc:' + kind + ':' + version + ':' + Utilities.base64EncodeWebSafe(digest).slice(0, 38);
}
function vocCacheEncode_(obj) {
  const bytes = Utilities.newBlob(JSON.stringify(obj), 'application/json').getBytes();
  return Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(bytes, 'application/json')).getBytes());
}
function vocCacheDecode_(base64) {
  const bytes = Utilities.base64Decode(base64);
  return JSON.parse(Utilities.ungzip(Utilities.newBlob(bytes, 'application/x-gzip')).getDataAsString('UTF-8'));
}
function vocCacheReadSnapshot_() {
  const meta = vocCacheMeta_();
  if (!meta) throw new Error('VOC snapshot not initialized. Run vocRefreshCache() once in the Apps Script editor.');
  const cache = CacheService.getScriptCache();
  const hotKey = 'voc:meta:' + meta.version;
  const hot = cache.get(hotKey);
  // CacheService has a 100 KB per-item limit. Only use it for small snapshots.
  if (hot) return { data: vocCacheDecode_(hot), meta };
  const sheet = vocCacheBook_().getSheetByName(meta.slot);
  if (!sheet) throw new Error('Missing VOC snapshot sheet: ' + meta.slot);
  const count = Number(meta.chunks);
  if (!Number.isInteger(count) || count < 1 || count > 50000) throw new Error('Invalid VOC snapshot chunk count');
  const parts = sheet.getRange(2, 1, count, 1).getValues().map(r => String(r[0] || ''));
  if (parts.some(p => !p)) throw new Error('Incomplete VOC snapshot: missing chunk');
  const encoded = parts.join('');
  if (encoded.length !== meta.length) throw new Error('Incomplete VOC snapshot: length mismatch');
  const data = vocCacheDecode_(encoded);
  if (data.schema !== VOC_CACHE.schema) throw new Error('VOC snapshot schema mismatch; refresh required');
  if (encoded.length < 90000) cache.put(hotKey, encoded, VOC_CACHE.hotSeconds);
  return { data, meta };
}
function vocCacheGetStatus() {
  const meta = vocCacheMeta_();
  return meta ? { ready: true, refreshedAt: meta.refreshedAt, version: meta.version } :
    { ready: false, refreshedAt: null, version: null };
}

/**
 * Builds all source data and contacts, then atomically switches to a new snapshot.
 * An exception leaves the last successful snapshot intact.
 */
function vocRefreshCache() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('A VOC refresh is already running. Try again shortly.');
  try {
    const source = vocLoadAllSources();
    const forecast = vocBuildForecast_(source);
    const contactsByKey = {};
    const sanaByKey = {};
    // Read each contact sheet once, not once per deployment.
    for (const industrySource of VOC_CONFIG.sources) {
      const ss = SpreadsheetApp.openById(industrySource.spreadsheetId);
      const contacts = vocReadSheet(ss, VOC_CONTACTS_SHEET);
      // A single Sana summary per deployment, joined within the industry.
      // Missing sheet/headers fail the refresh; the prior snapshot stays active.
      const summarySheet = ss.getSheetByName('CSAT_Summary');
      if (!summarySheet) throw new Error('Missing CSAT_Summary in ' + industrySource.industry);
      const summaryWidth = summarySheet.getLastColumn();
      const summaryHeaders = summaryWidth ? summarySheet.getRange(1, 1, 1, summaryWidth)
        .getValues()[0].map(v => String(v || '').trim()) : [];
      const requiredSummaryHeaders = [
        'deployment_id', 'deployment_name', 'account_name', 'executive_summary',
        'last_updated_at', 'source_rows_responses', 'source_rows_inflight'
      ];
      for (const field of requiredSummaryHeaders) {
        if (!summaryHeaders.includes(field)) throw new Error('Missing CSAT_Summary field ' + field + ' in ' + industrySource.industry);
      }
      const summaries = vocReadSheet(ss, 'CSAT_Summary');
      for (const summary of summaries) {
        const id = String(summary.deployment_id || '').trim();
        if (!id) continue;
        const key = industrySource.industry + ':' + id;
        if (Object.prototype.hasOwnProperty.call(sanaByKey, key)) {
          throw new Error('Duplicate Sana summary for ' + key);
        }
        sanaByKey[key] = summary;
      }
      for (const contact of contacts) {
        const parentId = String(contact.Deployment__c || '').trim();
        if (!parentId) continue;
        const key = industrySource.industry + ':' + parentId;
        if (!contactsByKey[key]) contactsByKey[key] = [];
        contactsByKey[key].push({ ...contact, _vocIndustry: industrySource.industry });
      }
    }
    // Contacts and complete attributes are retained in VOC's private workbook.
    const payload = { schema: VOC_CACHE.schema, forecast, contactsByKey, sanaByKey };
    const encoded = vocCacheEncode_(payload);
    const chunks = encoded.match(/.{1,30000}/g) || [];
    if (!chunks.length) throw new Error('Empty VOC snapshot; existing snapshot preserved');
    const old = vocCacheMeta_();
    const slot = !old || old.slot === VOC_CACHE.slots[1] ? VOC_CACHE.slots[0] : VOC_CACHE.slots[1];
    const book = vocCacheBook_();
    const sheet = book.getSheetByName(slot) || book.insertSheet(slot);
    sheet.clearContents();
    sheet.getRange(1, 1).setValue('VOC compressed snapshot chunks - do not edit');
    const batchSize = 3000;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize).map(c => [c]);
      sheet.getRange(i + 2, 1, batch.length, 1).setValues(batch);
    }
    SpreadsheetApp.flush();
    // Validate the inactive slot BEFORE switching the active pointer.
    const readBack = sheet.getRange(2, 1, chunks.length, 1).getValues().map(r => r[0]).join('');
    if (readBack.length !== encoded.length) throw new Error('Snapshot verification failed');
    const verify = vocCacheDecode_(readBack);
    if (verify.schema !== VOC_CACHE.schema || !verify.forecast || !verify.contactsByKey || !verify.sanaByKey) {
      throw new Error('Snapshot verification failed');
    }
    const refreshedAt = new Date().toISOString();
    const meta = { slot, chunks: chunks.length, length: encoded.length,
      refreshedAt, version: String(Date.now()) };
    PropertiesService.getScriptProperties().setProperty(VOC_CACHE.property, JSON.stringify(meta));
    console.log('VOC cache refreshed at ' + refreshedAt + '; deployments=' + forecast.deployments.length +
      '; survey events=' + forecast.events.length + '; chunks=' + chunks.length);
    return { ready: true, refreshedAt, deployments: forecast.deployments.length,
      surveyEvents: forecast.events.length };
  } finally { lock.releaseLock(); }
}

/** Install once; Apps Script time-driven triggers run in a morning window. */
function vocInstallDailyRefresh() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'vocRefreshCache')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('vocRefreshCache').timeBased().everyDays(1).atHour(7).create();
  const owner = Session.getEffectiveUser().getEmail();
  if (!owner) throw new Error('Cannot determine trigger owner email; configure VOC_CACHE_ADMIN_EMAIL manually in Script Properties.');
  PropertiesService.getScriptProperties().setProperty('VOC_CACHE_ADMIN_EMAIL', owner.toLowerCase());
  console.log('Daily VOC refresh installed near 7 AM in project timezone.');
}
function vocRemoveDailyRefresh() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'vocRefreshCache')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

/** Manual refresh endpoint. Restricted to the owner to protect source refresh and quotas. */
function vocManualRefresh() {
  const admin = String(PropertiesService.getScriptProperties().getProperty('VOC_CACHE_ADMIN_EMAIL') || '').toLowerCase();
  const caller = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!admin || !caller || caller !== admin) throw new Error('Manual refresh requires the configured VOC cache administrator.');
  return vocRefreshCache();
}
/** Group raw phase calculations into one distribution per deployment/type/month. */
function vocGroupDistributions_(events) {
  const groups = new Map();
  for (const e of (events || [])) {
    const date = String(e.surveyDate || '');
    const key = String(e.type || '') + ':' + date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, { type:e.type, surveyDate:date, phases:[], basis:e.basis });
    const group = groups.get(key);
    group.phases.push(e);
    if (date < group.surveyDate) group.surveyDate = date;
  }
  return [...groups.values()].map(g => {
    const bases = [...new Set(g.phases.map(p => p.basis))];
    return { type:g.type, surveyDate:g.surveyDate,
      basis:bases.length > 1 ? 'Mixed' : bases[0],
      phaseCount:g.phases.length, phases:g.phases };
  }).sort((a,b)=>a.surveyDate.localeCompare(b.surveyDate)||a.type.localeCompare(b.type));
}

/** Student classification: HENP only, parent Name contains Student OR child Product_Area__c equals Student. */
function vocIsStudentDeployment_(d) {
  if (d.industry !== 'HENP') return false;
  if (/student/i.test(String(d.name || ''))) return true;
  return (d.children || []).some(c => String(c.Product_Area__c || '').trim().toLowerCase() === 'student');
}

function vocGetCachedForecast(month, industry, surveyType, search, includePartners, includeStudents) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) throw new Error('Invalid month');
  const { data, meta } = vocCacheReadSnapshot_();
  const q = String(search || '').trim().toLowerCase();
  const showPartners = includePartners === true;
  const showStudents = industry === 'HENP' && includeStudents === true;
  const rows = data.forecast.deployments.map(d => {
    const matching = vocGroupDistributions_(d.events.filter(e => e.surveyDate.startsWith(month) &&
      (surveyType === 'All' || e.type === surveyType)));
    const surveyOpportunityInsights = vocCollectSurveyOpportunityInsights_(d, month);
    return { key: d.key, industry: d.industry, customer: d.customer, deployment: d.name,
      partnerName: d.partnerName, isWorkdayPS: d.isWorkdayPS, isStudent: vocIsStudentDeployment_(d),
      status: d.status, health: d.health, flags: d.flags, infoNotices: d.infoNotices || [],
      pglForecastOnly: d.pglForecastOnly === true,
      surveyOpportunityInsights,
      ...vocDurationRowFields_(d.duration),
      events: matching.map(e => ({ type:e.type, basis:e.basis, surveyDate:e.surveyDate, phaseCount:e.phaseCount })) };
  }).filter(d => d.events.length && (showPartners || d.isWorkdayPS) &&
    (industry === 'All' || d.industry === industry) &&
    (showStudents || !d.isStudent) &&
    (!q || (d.customer + ' ' + d.deployment).toLowerCase().includes(q)));
  rows.sort((a,b) => a.events[0].surveyDate.localeCompare(b.events[0].surveyDate) || a.customer.localeCompare(b.customer));
  return { rows, summary: { deployments: rows.length,
    events: rows.reduce((n,r)=>n+r.events.length,0), flagged: rows.filter(r=>r.flags.length).length },
    refreshedAt: meta.refreshedAt, cacheVersion: meta.version };
}
function vocGetCachedDeploymentDetails(key, forecastMonth) {
  const { data, meta } = vocCacheReadSnapshot_();
  const d = data.forecast.deployments.find(r => r.key === key);
  if (!d) throw new Error('Deployment not found in current snapshot');
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(forecastMonth || '')) ? forecastMonth : null;
  const enriched = {
    ...d,
    isStudent: vocIsStudentDeployment_(d),
    contacts: data.contactsByKey[key] || [],
    cacheVersion: meta.version,
    refreshedAt: meta.refreshedAt,
    surveyIntelligence: vocBuildSurveyIntelligence_(d, new Date(), month)
  };
  return enriched;
}
function testVOCCache() {
  const status = vocCacheGetStatus();
  if (!status.ready) throw new Error('Run vocRefreshCache() first');
  const result = vocGetCachedForecast(new Date().toISOString().slice(0, 7), 'All', 'All', '', false);
  console.log(JSON.stringify({ status, currentMonthRows: result.rows.length,
    currentMonthEvents: result.summary.events }));
}
