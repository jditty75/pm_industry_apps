/*******************
 * GLOBAL CONFIG & SCHEMAS
 *******************/

// Public URL to fallback Workday-style logo used in Slides.
const WORKDAY_FALLBACK_LOGO_URL =
  'https://avatars.slack-edge.com/2025-03-13/8593468002406_268b1623d3d91db2ae29_512.png';

// Canonical schemas for all sheets
const GoLivesSchemas = {
  sfdcPf: {
    required: [
      'Product_Area__c',
      'Function__c',
      'Deployment__c'
    ],
    optional: [
      'Production_Move_Date_Actual__c',
      'Production_Move_Date_Target__c',
      'Deployment__r.Customer__c'
    ]
  },
  sfdcDep: {
    required: [
      'Id',
      'Name',
      'Customer__c'
    ],
    optional: [
      'Customer__r.Name',
      'Customer__r.Website',
      'Customer__r.Industry',
      'Customer__r.Sub_Industry__c',
      'Customer__r.X2011_Employee_Ranges__c',
      'Customer__r.PS_Region_New__c',
      'Deployment_Partner_Name__c',
      'Workday_Engagement_Manager__c',
      'Workday_Engagement_Manager__r',
      'Contract_Type__c',
      'Deployment_Phase__c',
      'Current_MTP_Date__c'
    ]
  },
  sfdcComplete: {
    required: [
      'Account ID',
      'Deployment ID',
      'Account Name',
      'Product Area',
      'Go Live Date Actual'
    ],
    optional: [
      'Website',
      'Industry',
      'Sub-Industry',
      'Classification Range',
      'PS Sub Region',
      'Workday Engagement Manager: Full Name',
      'Priming Partner: Account Name',
      'Deployment Name',
      'In Production',
      'Contract Type',
      'Services Approach'
    ]
  },
  goLives: {
    columns: [
      'Account Id',
      'Account Name',
      'Effective Date',
      'Status',
      'Product Areas',
      'Functions',
      'Industry',
      'Sub-Industry',
      'Classification Range',
      'PS Sub Region',
      'Workday Engagement Manager: Full Name',
      'Priming Partner: Account Name',
      'Deployment Name',
      'Website',
      'Contract Type',
      'Services Approach',
      'Current MTP Date',
      'Is Phase Deployment',
      'In Production',
      'Logo URL'
    ]
  },
  logoMap: {
    columns: [
      'Account Id',
      'Account Name',
      'Website',
      'Domain',
      'Logo URL',
      'Manual Override',
      'Last Updated'
    ]
  }
};

/*******************
 * SCHEMA VALIDATION
 *******************/

function validateHeaders(sheet, expectedColumns, options) {
  options = options || {};
  const allowExtra = options.allowExtra !== false;

  const data = sheet.getDataRange().getValues();
  if (data.length === 0) {
    throw new Error('Sheet "' + sheet.getName() + '" has no header row.');
  }

  const headers = data[0] || [];
  const missing = [];
  expectedColumns.forEach(col => {
    if (headers.indexOf(col) === -1) missing.push(col);
  });

  if (missing.length) {
    throw new Error(
      'Sheet "' + sheet.getName() + '" is missing required columns: ' +
      missing.join(', ')
    );
  }

  if (!allowExtra) {
    const extras = headers.filter(h => expectedColumns.indexOf(h) === -1);
    if (extras.length) {
      throw new Error(
        'Sheet "' + sheet.getName() + '" has unexpected columns: ' +
        extras.join(', ')
      );
    }
  }

  return headers;
}

/*******************
 * UI MENU
 *******************/

function buildMenu(menuLabel) {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu(menuLabel)
    .addItem('Rebuild GoLives from SFDC', 'buildGoLivesSheet')
    .addSeparator()
    .addItem('Refresh LogoMap from GoLives', 'refreshLogoMapFromGoLives')
    .addItem('Fill Missing Logos in LogoMap', 'fillMissingLogosInLogoMap')
    .addItem('Force Refresh All Logos', 'forceRefreshAllLogosPublic')
    .addItem('Apply LogoMap to GoLives', 'applyLogoMapToGoLivesPublic')
    .addSeparator()
    .addItem('Consolidate LogoMap (one-time)', 'consolidateLogoMapPublic')
    .addItem('Backfill LogoMap Account Ids', 'backfillLogoMapAccountIdsPublic')
    .addSeparator()
    .addItem('Debug: LogoMap Name Matching', 'debugLogoMapNameMatchingPublic')
    .addToUi();
}

/*******************
 * SHARED UTILITIES
 *******************/

function parseDateValue_(v) {
  if (!v) return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    const d = new Date(v);
    d.setHours(0,0,0,0);
    return d;
  }
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  d.setHours(0,0,0,0);
  return d;
}

function formatDateYmd_(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function normalizeAccountName_(name) {
  if (!name) return '';
  let s = String(name);
  s = s.toLowerCase().replace(/\s+/g, ' ').trim();
  s = s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
  s = s.replace(/[.,'`"()&]/g, '');
  const dbaIdx = s.indexOf(' dba ');
  if (dbaIdx > -1) s = s.substring(0, dbaIdx);
  const dbaIdx2 = s.indexOf(' d/b/a ');
  if (dbaIdx2 > -1) s = s.substring(0, dbaIdx2);
  const suffixes = [
    'incorporated', 'inc',
    'llc', 'llp', 'lp',
    'corporation', 'corp', 'co',
    'company',
    'limited', 'ltd',
    'plc', 'pllc'
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < suffixes.length; i++) {
      const suf = suffixes[i];
      if (s.endsWith(' ' + suf)) {
        s = s.substring(0, s.length - suf.length - 1).trim();
        changed = true;
      } else if (s === suf) {
        s = '';
        changed = true;
      }
    }
  }
  return s.replace(/\s+/g, ' ').trim();
}

function normalizeDomain_(website) {
  if (!website) return '';
  let s = String(website).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '');
  s = s.replace(/^www\./, '');
  s = s.split('/')[0].split('?')[0].split('#')[0];
  return s;
}

function normalizeWebsite_(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (s.toLowerCase().startsWith('<a ')) {
    const m = s.match(/>([^<]+)<\/a>/i);
    if (m && m[1]) return m[1].trim();
  }
  return s;
}

function resolveUrl_(base, relative) {
  if (!relative) return '';
  if (/^https?:\/\//i.test(relative)) return relative;
  if (relative.startsWith('//')) {
    const protocol = base.startsWith('https://') ? 'https:' : 'http:';
    return protocol + relative;
  }
  const url = base.split('#')[0].split('?')[0];
  if (relative.startsWith('/')) {
    const parts = url.split('/');
    return parts[0] + '//' + parts[2] + relative;
  }
  const pathParts = url.split('/');
  pathParts.pop();
  return pathParts.join('/') + '/' + relative;
}

function onEditHandler(e) {
  const sheet = e.range.getSheet();
  const name = sheet.getName();
  if (name === 'LogoMap') applyLogoMapToGoLives();
}

/*******************
 * BUILD GoLives — DOMAIN-PARAMETERIZED CORE
 *
 * Single source of truth for the dual-source build. Three thin wrappers
 * (buildGoLivesSheetForHealthcare, buildGoLivesSheetForSLG,
 *  buildGoLivesSheetForHENP) call this with their own default tab names.
 *
 * Reads TWO non-overlapping sources:
 *   1) <completeSheetName>   — past go-lives (Salesforce report).
 *   2) <pfSheetName> + <depSheetName> — Active deployments (SOQL).
 *
 * options = {
 *   completeSheetName,
 *   pfSheetName,
 *   depSheetName,
 *   goLivesSheetName
 * }
 *
 * Defaults are SFDC_COMPLETE, SFDC_PF, SFDC_DEP, GoLives so the function
 * is callable without options (Healthcare's historical default).
 *******************/
function buildGoLivesSheetForDomain(options) {
  options = options || {};
  const completeSheetName = options.completeSheetName || 'SFDC_COMPLETE';
  const pfSheetName       = options.pfSheetName       || 'SFDC_PF';
  const depSheetName      = options.depSheetName      || 'SFDC_DEP';
  const goLivesSheetName  = options.goLivesSheetName  || 'GoLives';

  const ss = SpreadsheetApp.getActive();

  // ---------- Source 1: <completeSheetName> (past go-lives) ----------
  const pastRows = [];
  const completeSheet = ss.getSheetByName(completeSheetName);
  if (completeSheet) {
    validateHeaders(completeSheet, GoLivesSchemas.sfdcComplete.required, { allowExtra: true });
    const data = completeSheet.getDataRange().getValues();
    if (data.length >= 2) {
      const headers = data[0];
      const idx = {
        AccountId: headers.indexOf('Account ID'),
        DeploymentId: headers.indexOf('Deployment ID'),
        AccountName: headers.indexOf('Account Name'),
        Website: headers.indexOf('Website'),
        Industry: headers.indexOf('Industry'),
        SubIndustry: headers.indexOf('Sub-Industry'),
        Classification: headers.indexOf('Classification Range'),
        PSSubRegion: headers.indexOf('PS Sub Region'),
        EM: headers.indexOf('Workday Engagement Manager: Full Name'),
        Partner: headers.indexOf('Priming Partner: Account Name'),
        DeploymentName: headers.indexOf('Deployment Name'),
        ProductArea: headers.indexOf('Product Area'),
        GoLiveDate: headers.indexOf('Go Live Date Actual'),
        InProduction: headers.indexOf('In Production'),
        ContractType: headers.indexOf('Contract Type'),
        ServicesApproach: headers.indexOf('Services Approach')
      };

      const map = {};
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const account = row[idx.AccountName];
        const accountId = String(row[idx.AccountId] || '').trim();
        const goLiveCell = row[idx.GoLiveDate];
        const product = row[idx.ProductArea];
        if (!account || !goLiveCell || !product) continue;

        let d;
        if (goLiveCell instanceof Date) d = goLiveCell;
        else { d = new Date(goLiveCell); if (isNaN(d)) continue; }

        const key = (accountId || normalizeAccountName_(account)) + '||' + d.toISOString();
        if (!map[key]) {
          map[key] = {
            accountId, accountName: account,
            effectiveDate: d, status: 'Past',
            productAreas: new Set(), functions: new Set(),
            industry: '', subIndustry: '', classification: '', psSubRegion: '',
            em: '', partner: '', deploymentName: '', website: '',
            contractType: '', phase: '', currentMtp: '',
            isPhaseDeployment: false, inProductionFlag: true
          };
        }
        const entry = map[key];
        entry.productAreas.add(product);
        if (idx.Industry > -1 && row[idx.Industry] && !entry.industry) entry.industry = row[idx.Industry];
        if (idx.SubIndustry > -1 && row[idx.SubIndustry] && !entry.subIndustry) entry.subIndustry = row[idx.SubIndustry];
        if (idx.Classification > -1 && row[idx.Classification] && !entry.classification) entry.classification = row[idx.Classification];
        if (idx.PSSubRegion > -1 && row[idx.PSSubRegion] && !entry.psSubRegion) entry.psSubRegion = row[idx.PSSubRegion];
        if (idx.EM > -1 && row[idx.EM] && !entry.em) entry.em = row[idx.EM];
        if (idx.Partner > -1 && row[idx.Partner] && !entry.partner) entry.partner = row[idx.Partner];
        if (idx.DeploymentName > -1 && row[idx.DeploymentName] && !entry.deploymentName) entry.deploymentName = row[idx.DeploymentName];
        if (idx.Website > -1 && row[idx.Website] && !entry.website) entry.website = normalizeWebsite_(row[idx.Website]);
        if (idx.ContractType > -1 && row[idx.ContractType] && !entry.contractType) entry.contractType = row[idx.ContractType];
        if (idx.ServicesApproach > -1 && row[idx.ServicesApproach] && !entry.phase) entry.phase = row[idx.ServicesApproach];
      }
      Object.keys(map).forEach(k => pastRows.push(map[k]));
    }
  }

  // ---------- Source 2: <pfSheetName> + <depSheetName> (Active deployments) ----------
  const activeRows = [];
  const pfSheet = ss.getSheetByName(pfSheetName);
  const depSheet = ss.getSheetByName(depSheetName);

  if (pfSheet && depSheet) {
    validateHeaders(pfSheet, GoLivesSchemas.sfdcPf.required, { allowExtra: true });
    validateHeaders(depSheet, GoLivesSchemas.sfdcDep.required, { allowExtra: true });

    const pfData = pfSheet.getDataRange().getValues();
    const depData = depSheet.getDataRange().getValues();
    if (depData.length >= 2 && pfData.length >= 2) {
      const depHeaders = depData[0];
      const depIdx = {
        Id: depHeaders.indexOf('Id'),
        Name: depHeaders.indexOf('Name'),
        Customer__c: depHeaders.indexOf('Customer__c'),
        CustomerName: depHeaders.indexOf('Customer__r.Name'),
        CustomerWebsite: depHeaders.indexOf('Customer__r.Website'),
        CustomerIndustry: depHeaders.indexOf('Customer__r.Industry'),
        CustomerSubIndustry: depHeaders.indexOf('Customer__r.Sub_Industry__c'),
        CustomerClassification: depHeaders.indexOf('Customer__r.X2011_Employee_Ranges__c'),
        CustomerPSRegion: depHeaders.indexOf('Customer__r.PS_Region_New__c'),
        DeploymentPartner: depHeaders.indexOf('Deployment_Partner_Name__c'),
        EMName: depHeaders.indexOf('Workday_Engagement_Manager__r'),
        ContractType: depHeaders.indexOf('Contract_Type__c'),
        Phase: depHeaders.indexOf('Deployment_Phase__c'),
        CurrentMTP: depHeaders.indexOf('Current_MTP_Date__c')
      };

      const deploymentById = {};
      for (let i = 1; i < depData.length; i++) {
        const row = depData[i];
        const id = row[depIdx.Id];
        if (!id) continue;
        deploymentById[id] = {
          customerId: row[depIdx.Customer__c] || '',
          deploymentName: row[depIdx.Name] || '',
          customerName: row[depIdx.CustomerName] || '',
          website: row[depIdx.CustomerWebsite] || '',
          industry: row[depIdx.CustomerIndustry] || '',
          subIndustry: row[depIdx.CustomerSubIndustry] || '',
          classification: row[depIdx.CustomerClassification] || '',
          psSubRegion: row[depIdx.CustomerPSRegion] || '',
          partner: row[depIdx.DeploymentPartner] || '',
          em: row[depIdx.EMName] || '',
          contractType: row[depIdx.ContractType] || '',
          phase: row[depIdx.Phase] || '',
          currentMtp: row[depIdx.CurrentMTP] || ''
        };
      }

      const today = new Date(); today.setHours(0, 0, 0, 0);

      const pfHeaders = pfData[0];
      const pfIdx = {
        Product_Area__c: pfHeaders.indexOf('Product_Area__c'),
        Function__c: pfHeaders.indexOf('Function__c'),
        Production_Move_Date_Actual__c: pfHeaders.indexOf('Production_Move_Date_Actual__c'),
        Production_Move_Date_Target__c: pfHeaders.indexOf('Production_Move_Date_Target__c'),
        Deployment__c: pfHeaders.indexOf('Deployment__c'),
        CustomerId_PF: (function() {
          let i = pfHeaders.indexOf('Deployment__r.Customer__c');
          if (i === -1) i = pfHeaders.indexOf('Deployment__r.Customer');
          return i;
        })()
      };

      const classifiedRows = [];
      const datesByDeployment = {};
      for (let i = 1; i < pfData.length; i++) {
        const row = pfData[i];
        const productArea = row[pfIdx.Product_Area__c];
        const fnName = row[pfIdx.Function__c];
        const deploymentId = row[pfIdx.Deployment__c];
        if (!productArea || !deploymentId) continue;
        if (!deploymentById[deploymentId]) continue;

        const actual = parseDateValue_(row[pfIdx.Production_Move_Date_Actual__c]);
        const target = parseDateValue_(row[pfIdx.Production_Move_Date_Target__c]);
        let status = null, effectiveDate = null;
        if (actual) { status = 'Past'; effectiveDate = actual; }
        else if (target && target > today) { status = 'Upcoming'; effectiveDate = target; }
        else continue;

        classifiedRows.push({
          deploymentId, productArea,
          fnName: fnName || '',
          status, effectiveDate,
          pfAccountId: (pfIdx.CustomerId_PF > -1) ? (row[pfIdx.CustomerId_PF] || '') : ''
        });

        const key = formatDateYmd_(effectiveDate);
        if (!datesByDeployment[deploymentId]) datesByDeployment[deploymentId] = new Set();
        datesByDeployment[deploymentId].add(key);
      }

      const isPhaseByDeployment = {};
      Object.keys(datesByDeployment).forEach(deploymentId => {
        const dates = Array.from(datesByDeployment[deploymentId]);
        const dep = deploymentById[deploymentId];
        if (!dep) { isPhaseByDeployment[deploymentId] = dates.length > 1; return; }
        const currentMtp = parseDateValue_(dep.currentMtp);
        if (dates.length > 1) isPhaseByDeployment[deploymentId] = true;
        else if (currentMtp && dates[0] !== formatDateYmd_(currentMtp)) isPhaseByDeployment[deploymentId] = true;
        else isPhaseByDeployment[deploymentId] = false;
      });

      const aggregateByKey = {};
      classifiedRows.forEach(r => {
        const dep = deploymentById[r.deploymentId];
        if (!dep) return;
        const account = dep.customerName || '';
        const accountId = dep.customerId || r.pfAccountId || '';
        const effectiveDateKey = formatDateYmd_(r.effectiveDate);
        const groupKey = (accountId ? accountId : normalizeAccountName_(account)) + '||' + effectiveDateKey;

        let entry = aggregateByKey[groupKey];
        if (!entry) {
          entry = {
            accountId, accountName: account,
            effectiveDate: r.effectiveDate,
            status: r.status,
            productAreas: new Set(), functions: new Set(),
            industry: dep.industry, subIndustry: dep.subIndustry,
            classification: dep.classification, psSubRegion: dep.psSubRegion,
            em: dep.em, partner: dep.partner, deploymentName: dep.deploymentName,
            website: dep.website, contractType: dep.contractType,
            phase: dep.phase, currentMtp: dep.currentMtp,
            isPhaseDeployment: !!isPhaseByDeployment[r.deploymentId],
            inProductionFlag: r.status === 'Past'
          };
          aggregateByKey[groupKey] = entry;
        }
        entry.productAreas.add(r.productArea);
        if (r.fnName) entry.functions.add(r.fnName);
        if (r.status === 'Past') { entry.status = 'Past'; entry.inProductionFlag = true; }
      });

      Object.keys(aggregateByKey).forEach(k => activeRows.push(aggregateByKey[k]));
    }
  }

  // ---------- Merge, sort, write ----------
  const allRows = pastRows.concat(activeRows);
  allRows.sort((a, b) => {
    const accCmp = (a.accountName || '').localeCompare(b.accountName || '');
    if (accCmp !== 0) return accCmp;
    const ad = a.effectiveDate ? a.effectiveDate.getTime() : 0;
    const bd = b.effectiveDate ? b.effectiveDate.getTime() : 0;
    return ad - bd;
  });

  const out = [GoLivesSchemas.goLives.columns.slice()];
  allRows.forEach(e => {
    out.push([
      e.accountId || '',
      e.accountName || '',
      e.effectiveDate || '',
      e.status || '',
      Array.from(e.productAreas).sort().join(', '),
      Array.from(e.functions).sort().join(', '),
      e.industry || '',
      e.subIndustry || '',
      e.classification || '',
      e.psSubRegion || '',
      e.em || '',
      e.partner || '',
      e.deploymentName || '',
      e.website || '',
      e.contractType || '',
      e.phase || '',
      e.currentMtp || '',
      !!e.isPhaseDeployment,
      !!e.inProductionFlag,
      ''
    ]);
  });

  let goLivesSheet = ss.getSheetByName(goLivesSheetName);
  if (!goLivesSheet) goLivesSheet = ss.insertSheet(goLivesSheetName);
  goLivesSheet.clearContents();
  goLivesSheet.getRange(1, 1, out.length, out[0].length).setValues(out);

  applyLogoMapToGoLives();
}

/*******************
 * THIN WRAPPERS — preserved entry points called by consuming apps.
 * Each wrapper sets domain-specific default tab names; otherwise no logic.
 *******************/

function buildGoLivesSheetForHealthcare(options) {
  options = options || {};
  return buildGoLivesSheetForDomain({
    completeSheetName: options.completeSheetName || 'SFDC_COMPLETE',
    pfSheetName:       options.pfSheetName       || 'SFDC_PF',
    depSheetName:      options.depSheetName      || 'SFDC_DEP',
    goLivesSheetName:  options.goLivesSheetName  || 'GoLives'
  });
}

function buildGoLivesSheetForSLG(options) {
  options = options || {};
  return buildGoLivesSheetForDomain({
    completeSheetName: options.completeSheetName || 'SLG_COMPLETE',
    pfSheetName:       options.pfSheetName       || 'SLG_PF',
    depSheetName:      options.depSheetName      || 'SLG_DEP',
    goLivesSheetName:  options.goLivesSheetName  || 'GoLives'
  });
}

function buildGoLivesSheetForHENP(options) {
  options = options || {};
  return buildGoLivesSheetForDomain({
    completeSheetName: options.completeSheetName || 'HENP_COMPLETE',
    pfSheetName:       options.pfSheetName       || 'HENP_PF',
    depSheetName:      options.depSheetName      || 'HENP_DEP',
    goLivesSheetName:  options.goLivesSheetName  || 'GoLives'
  });
}
/*******************
 * LOGO PROVIDERS (PASS E)
 *******************/

const PASS_E_ALLOWED_LOGO_HOSTS = [
  'upload.wikimedia.org',
  'commons.wikimedia.org',
  'logo.clearbit.com',
  'www.google.com',
  'cdn.brandfetch.io',
  'images.seeklogo.com',
  'logos-world.net',
  'mma.prnewswire.com',
  'cdn.prod.website-files.com'
];

const PASS_E_BANNED_URL_PARTS = [
  'sprite', 'placeholder', '1x1', 'pixel', 'tracking',
  'default-', 'partner', 'customer', 'sponsor', 'award', 'press'
];

function passE_clearbitProvider_(domain) {
  if (!domain) return '';
  const url = 'https://logo.clearbit.com/' + encodeURIComponent(domain) + '?size=512&format=png';
  try {
    const resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'Accept': 'image/*' }
    });
    const code = resp.getResponseCode();
    if (code < 200 || code >= 300) return '';
    const ct = String(resp.getHeaders()['Content-Type'] || '').toLowerCase();
    if (ct.indexOf('image/') !== 0) return '';
    return url;
  } catch (e) {
    Logger.log('passE_clearbitProvider_ error for ' + domain + ': ' + e.message);
    return '';
  }
}

function passE_googleFaviconProvider_(domain) {
  if (!domain) return '';
  const url = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=256';
  try {
    const resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'Accept': 'image/*' }
    });
    const code = resp.getResponseCode();
    if (code < 200 || code >= 300) return '';
    const ct = String(resp.getHeaders()['Content-Type'] || '').toLowerCase();
    if (ct.indexOf('image/') !== 0) return '';
    return url;
  } catch (e) {
    Logger.log('passE_googleFaviconProvider_ error for ' + domain + ': ' + e.message);
    return '';
  }
}

function passE_onsiteScrapeProvider_(siteUrl, baseDomain) {
  if (!siteUrl) return '';
  let url = String(siteUrl).trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  let html;
  try {
    const resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,*/*;q=0.8'
      }
    });
    if (resp.getResponseCode() < 200 || resp.getResponseCode() >= 300) return '';
    html = resp.getContentText();
  } catch (e) {
    Logger.log('passE_onsiteScrapeProvider_ fetch error for ' + url + ': ' + e.message);
    return '';
  }

  // JSON-LD Organization.logo
  const ldMatches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (ldMatches) {
    for (let i = 0; i < ldMatches.length; i++) {
      const inner = ldMatches[i].replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
      try {
        const parsed = JSON.parse(inner);
        const nodes = Array.isArray(parsed) ? parsed : [parsed];
        for (let j = 0; j < nodes.length; j++) {
          const n = nodes[j];
          if (!n || typeof n !== 'object') continue;
          if (n['@type'] === 'Organization' && n.logo) {
            const candidate = (typeof n.logo === 'string') ? n.logo : (n.logo.url || '');
            if (candidate) return resolveUrl_(url, candidate);
          }
        }
      } catch (e) {}
    }
  }

  // apple-touch-icon
  const appleIcons = [];
  const linkRegex = /<link[^>]+rel=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    if ((m[1] || '').toLowerCase().indexOf('apple-touch-icon') === -1) continue;
    const tag = m[0];
    const hrefMatch = /href=["']([^"']+)["']/i.exec(tag);
    const sizesMatch = /sizes=["']([^"']+)["']/i.exec(tag);
    if (!hrefMatch || !hrefMatch[1]) continue;
    let size = 0;
    if (sizesMatch && sizesMatch[1]) {
      const sm = sizesMatch[1].match(/(\d+)x(\d+)/i);
      if (sm) size = Math.min(parseInt(sm[1], 10), parseInt(sm[2], 10));
    }
    appleIcons.push({ url: resolveUrl_(url, hrefMatch[1]), size });
  }
  if (appleIcons.length) {
    appleIcons.sort((a, b) => b.size - a.size);
    if (appleIcons[0].size === 0 || appleIcons[0].size >= 180) return appleIcons[0].url;
  }

  // Header/nav-scoped logo img
  let headerHtml = '';
  const headerMatch = html.match(/<(header|nav)[^>]*>([\s\S]*?)<\/(header|nav)>/i);
  if (headerMatch) headerHtml = headerMatch[0];
  if (headerHtml) {
    const imgRegex = /<img[^>]+>/gi;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(headerHtml)) !== null) {
      const tag = imgMatch[0];
      const looksLikeLogo =
        /class=["'][^"']*logo[^"']*["']/i.test(tag) ||
        /id=["'][^"']*logo[^"']*["']/i.test(tag) ||
        /alt=["'][^"']*logo[^"']*["']/i.test(tag);
      if (!looksLikeLogo) continue;
      const srcMatch = /src=["']([^"']+)["']/i.exec(tag);
      if (!srcMatch || !srcMatch[1]) continue;
      return resolveUrl_(url, srcMatch[1]);
    }
  }

  // og:image last resort
  const ogMatch = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i.exec(html);
  if (ogMatch && ogMatch[1]) return resolveUrl_(url, ogMatch[1]);
  return '';
}

function passE_validateCandidate_(candidateUrl, accountDomain) {
  if (!candidateUrl) return '';
  let u = String(candidateUrl).trim();
  if (u.startsWith('http://')) u = 'https://' + u.substring('http://'.length);
  if (!/^https:\/\//i.test(u)) return '';

  const lowerNoQuery = u.toLowerCase().split(/[?#]/)[0];
  for (let i = 0; i < PASS_E_BANNED_URL_PARTS.length; i++) {
    if (lowerNoQuery.indexOf(PASS_E_BANNED_URL_PARTS[i]) !== -1) return '';
  }
  if (lowerNoQuery.endsWith('.ico')) return '';

  let host = '';
  const hostMatch = lowerNoQuery.match(/^https:\/\/([^\/]+)/);
  if (hostMatch) host = hostMatch[1];
  if (!host) return '';

  const onAllowlist = PASS_E_ALLOWED_LOGO_HOSTS.indexOf(host) !== -1;
  const hostMatchesAccount = accountDomain && (
    host === accountDomain ||
    host.indexOf('.' + accountDomain) !== -1 ||
    accountDomain.indexOf('.' + host) !== -1
  );
  if (!onAllowlist && !hostMatchesAccount) return '';

  let resp;
  try {
    resp = UrlFetchApp.fetch(u, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*' }
    });
  } catch (e) { return ''; }

  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) return '';

  const ct = String(resp.getHeaders()['Content-Type'] || '').toLowerCase();
    const accepted = (
    ct.indexOf('image/png') !== -1 ||
    ct.indexOf('image/jpeg') !== -1 ||
    ct.indexOf('image/jpg') !== -1 ||
    ct.indexOf('image/webp') !== -1
  );
  if (!accepted) return '';

  // SVGs are rejected outright. They are unreliable in Google Slides
  // (class-based styling, embedded styles, and various edge cases cause
  // silent failures). Manual Override can be used to set an SVG URL
  // for a specific account if desired.
  if (ct.indexOf('image/svg') !== -1) {
    return '';
  }

  const blob = resp.getBlob();
  const dims = passE_imageDimensions_(blob, ct);
  if (!dims) return u;
  if (dims.width < 64 || dims.height < 64) return '';
  return u;
}

function passE_imageDimensions_(blob, contentType) {
  try {
    const bytes = blob.getBytes();
    if (contentType.indexOf('png') !== -1) {
      if (bytes.length < 24) return null;
      const w = ((bytes[16] & 0xff) << 24) | ((bytes[17] & 0xff) << 16) | ((bytes[18] & 0xff) << 8) | (bytes[19] & 0xff);
      const h = ((bytes[20] & 0xff) << 24) | ((bytes[21] & 0xff) << 16) | ((bytes[22] & 0xff) << 8) | (bytes[23] & 0xff);
      return { width: w, height: h };
    }
    if (contentType.indexOf('jpeg') !== -1 || contentType.indexOf('jpg') !== -1) {
      let i = 2;
      while (i < bytes.length) {
        if ((bytes[i] & 0xff) !== 0xff) return null;
        const marker = bytes[i + 1] & 0xff;
        i += 2;
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const h = ((bytes[i + 3] & 0xff) << 8) | (bytes[i + 4] & 0xff);
          const w = ((bytes[i + 5] & 0xff) << 8) | (bytes[i + 6] & 0xff);
          return { width: w, height: h };
        } else {
          const segLen = ((bytes[i] & 0xff) << 8) | (bytes[i + 1] & 0xff);
          i += segLen;
        }
      }
      return null;
    }
    if (contentType.indexOf('webp') !== -1) {
      if (bytes.length < 30) return null;
      const w = 1 + (((bytes[24] & 0xff) | ((bytes[25] & 0xff) << 8) | ((bytes[26] & 0xff) << 16)) & 0xffffff);
      const h = 1 + (((bytes[27] & 0xff) | ((bytes[28] & 0xff) << 8) | ((bytes[29] & 0xff) << 16)) & 0xffffff);
      return { width: w, height: h };
    }
    return null;
  } catch (e) { return null; }
}

function fetchLogoUrlForAccount_(accountDomain, siteUrl) {
  if (!accountDomain && !siteUrl) return '';
  const domain = accountDomain || normalizeDomain_(siteUrl);
  const clearbit = passE_clearbitProvider_(domain);
  if (clearbit) { const v = passE_validateCandidate_(clearbit, domain); if (v) return v; }
  const google = passE_googleFaviconProvider_(domain);
  if (google) { const v = passE_validateCandidate_(google, domain); if (v) return v; }
  const scraped = passE_onsiteScrapeProvider_(siteUrl || ('https://' + domain), domain);
  if (scraped) { const v = passE_validateCandidate_(scraped, domain); if (v) return v; }
  return '';
}

/*******************
 * LOGO MAP
 *******************/

function refreshLogoMapFromGoLives() {
  const ss = SpreadsheetApp.getActive();
  const goLivesSheet = ss.getSheetByName('GoLives');
  if (!goLivesSheet) throw new Error('GoLives sheet not found.');

  let mapSheet = ss.getSheetByName('LogoMap');
  if (!mapSheet) {
    mapSheet = ss.insertSheet('LogoMap');
    mapSheet.getRange(1, 1, 1, GoLivesSchemas.logoMap.columns.length)
      .setValues([GoLivesSchemas.logoMap.columns]);
  }

  let mapData = mapSheet.getDataRange().getValues();
  if (mapData.length === 0) mapData = [GoLivesSchemas.logoMap.columns.slice()];

  const headerRow = mapData[0];
  GoLivesSchemas.logoMap.columns.forEach(col => {
    if (headerRow.indexOf(col) === -1) headerRow.push(col);
  });
  for (let i = 1; i < mapData.length; i++) {
    while (mapData[i].length < headerRow.length) mapData[i].push('');
  }

  const mapIdx = {
    AccountId: headerRow.indexOf('Account Id'),
    AccountName: headerRow.indexOf('Account Name'),
    Website: headerRow.indexOf('Website'),
    Domain: headerRow.indexOf('Domain'),
    LogoUrl: headerRow.indexOf('Logo URL'),
    ManualOverride: headerRow.indexOf('Manual Override'),
    LastUpdated: headerRow.indexOf('Last Updated')
  };

  const idIndex = {}, nameIndex = {}, domainIndex = {};
  for (let i = 1; i < mapData.length; i++) {
    const row = mapData[i];
    const aId = row[mapIdx.AccountId];
    const aName = row[mapIdx.AccountName];
    const dom = row[mapIdx.Domain];
    if (aId) idIndex[String(aId).trim()] = i;
    if (aName) nameIndex[normalizeAccountName_(aName)] = i;
    if (dom) domainIndex[normalizeDomain_(dom)] = i;
  }

  const glData = goLivesSheet.getDataRange().getValues();
  if (glData.length < 2) return;
  const glHeaders = glData[0];
  const glIdx = {
    AccountId: glHeaders.indexOf('Account Id'),
    AccountName: glHeaders.indexOf('Account Name'),
    Website: glHeaders.indexOf('Website')
  };

  const now = new Date();
  for (let i = 1; i < glData.length; i++) {
    const row = glData[i];
    const accountId = glIdx.AccountId > -1 ? String(row[glIdx.AccountId] || '').trim() : '';
    const accountName = glIdx.AccountName > -1 ? String(row[glIdx.AccountName] || '').trim() : '';
    const website = glIdx.Website > -1 ? String(row[glIdx.Website] || '').trim() : '';
    const normName = normalizeAccountName_(accountName);
    const normDomain = normalizeDomain_(website);
    if (!accountName && !accountId) continue;

    let existingIdx = -1;
    if (accountId && idIndex[accountId] != null) existingIdx = idIndex[accountId];
    else if (normName && nameIndex[normName] != null) existingIdx = nameIndex[normName];
    else if (normDomain && domainIndex[normDomain] != null) existingIdx = domainIndex[normDomain];

    if (existingIdx > -1) {
      const existing = mapData[existingIdx];
      if (accountId && !existing[mapIdx.AccountId]) {
        existing[mapIdx.AccountId] = accountId;
        idIndex[accountId] = existingIdx;
      }
      if (accountName && !existing[mapIdx.AccountName]) {
        existing[mapIdx.AccountName] = accountName;
        nameIndex[normName] = existingIdx;
      }
      if (website && !existing[mapIdx.Website]) existing[mapIdx.Website] = website;
      if (normDomain && !existing[mapIdx.Domain]) {
        existing[mapIdx.Domain] = normDomain;
        domainIndex[normDomain] = existingIdx;
      }
    } else {
      const newRow = new Array(headerRow.length).fill('');
      if (mapIdx.AccountId > -1) newRow[mapIdx.AccountId] = accountId;
      if (mapIdx.AccountName > -1) newRow[mapIdx.AccountName] = accountName;
      if (mapIdx.Website > -1) newRow[mapIdx.Website] = website;
      if (mapIdx.Domain > -1) newRow[mapIdx.Domain] = normDomain;
      if (mapIdx.LogoUrl > -1) newRow[mapIdx.LogoUrl] = '';
      if (mapIdx.ManualOverride > -1) newRow[mapIdx.ManualOverride] = false;
      if (mapIdx.LastUpdated > -1) newRow[mapIdx.LastUpdated] = now;
      mapData.push(newRow);
      const newRowIdx = mapData.length - 1;
      if (accountId) idIndex[accountId] = newRowIdx;
      if (normName) nameIndex[normName] = newRowIdx;
      if (normDomain) domainIndex[normDomain] = newRowIdx;
    }
  }

  mapSheet.clearContents();
  mapSheet.getRange(1, 1, mapData.length, mapData[0].length).setValues(mapData);
}

function backfillLogoMapAccountIds() {
  const ss = SpreadsheetApp.getActive();
  const mapSheet = ss.getSheetByName('LogoMap');
  const glSheet = ss.getSheetByName('GoLives');
  if (!mapSheet) throw new Error('LogoMap sheet not found.');
  if (!glSheet) throw new Error('GoLives sheet not found.');

  const mapData = mapSheet.getDataRange().getValues();
  const glData = glSheet.getDataRange().getValues();
  if (mapData.length < 2 || glData.length < 2) return;

  const mh = mapData[0];
  const mId = mh.indexOf('Account Id');
  const mName = mh.indexOf('Account Name');
  const mWeb = mh.indexOf('Website');
  const mDom = mh.indexOf('Domain');
  const mUpdated = mh.indexOf('Last Updated');
  if (mId === -1 || mName === -1) throw new Error('LogoMap missing Account Id or Account Name.');

  const gh = glData[0];
  const gId = gh.indexOf('Account Id');
  const gName = gh.indexOf('Account Name');
  const gWeb = gh.indexOf('Website');
  if (gId === -1 || gName === -1) throw new Error('GoLives missing Account Id or Account Name.');

  const idByName = {}, idByDomain = {};
  for (let i = 1; i < glData.length; i++) {
    const id = String(glData[i][gId] || '').trim();
    if (!id) continue;
    const nN = normalizeAccountName_(glData[i][gName]);
    const nD = normalizeDomain_(gWeb > -1 ? glData[i][gWeb] : '');
    if (nN && !idByName[nN]) idByName[nN] = id;
    if (nD && !idByDomain[nD]) idByDomain[nD] = id;
  }

  const now = new Date();
  let backfilled = 0;
  for (let i = 1; i < mapData.length; i++) {
    const row = mapData[i];
    if (String(row[mId] || '').trim()) continue;
    const nN = normalizeAccountName_(row[mName]);
    const nD = normalizeDomain_(mDom > -1 ? row[mDom] : (mWeb > -1 ? row[mWeb] : ''));
    let id = '';
    if (nN && idByName[nN]) id = idByName[nN];
    else if (nD && idByDomain[nD]) id = idByDomain[nD];
    if (id) {
      row[mId] = id;
      if (mUpdated > -1) row[mUpdated] = now;
      backfilled++;
    }
  }

  mapSheet.clearContents();
  mapSheet.getRange(1, 1, mapData.length, mapData[0].length).setValues(mapData);
  SpreadsheetApp.getUi().alert('Backfilled ' + backfilled + ' LogoMap rows with Account Id.');
}

function backfillLogoMapAccountIdsPublic() {
  backfillLogoMapAccountIds();
}

function debugLogoMapNameMatching() {
  const ss = SpreadsheetApp.getActive();
  const mapSheet = ss.getSheetByName('LogoMap');
  const glSheet = ss.getSheetByName('GoLives');
  if (!mapSheet || !glSheet) { Logger.log('Missing sheets.'); return; }

  const mapData = mapSheet.getDataRange().getValues();
  const glData = glSheet.getDataRange().getValues();
  if (mapData.length < 2 || glData.length < 2) { Logger.log('Empty sheets.'); return; }

  const mh = mapData[0];
  const mId = mh.indexOf('Account Id');
  const mName = mh.indexOf('Account Name');
  const mWeb = mh.indexOf('Website');
  const mDom = mh.indexOf('Domain');

  const gh = glData[0];
  const gId = gh.indexOf('Account Id');
  const gName = gh.indexOf('Account Name');
  const gWeb = gh.indexOf('Website');

  Logger.log('LogoMap headers: ' + JSON.stringify(mh));
  Logger.log('GoLives headers: ' + JSON.stringify(gh));

  let glIdCount = 0;
  const idByName = {}, idByDomain = {};
  for (let i = 1; i < glData.length; i++) {
    const id = String(glData[i][gId] || '').trim();
    if (!id) continue;
    glIdCount++;
    const nN = normalizeAccountName_(glData[i][gName]);
    const nD = normalizeDomain_(gWeb > -1 ? glData[i][gWeb] : '');
    if (nN && !idByName[nN]) idByName[nN] = id;
    if (nD && !idByDomain[nD]) idByDomain[nD] = id;
  }
  Logger.log('GoLives rows with Account Id: ' + glIdCount);
  Logger.log('Distinct GoLives normalized names: ' + Object.keys(idByName).length);
  Logger.log('Distinct GoLives normalized domains: ' + Object.keys(idByDomain).length);

  let noId = 0, matchedByName = 0, matchedByDomain = 0;
  const samplesUnmatched = [];
  for (let i = 1; i < mapData.length; i++) {
    const row = mapData[i];
    if (String(row[mId] || '').trim()) continue;
    noId++;
    const name = row[mName];
    const website = mWeb > -1 ? row[mWeb] : '';
    const domainCell = mDom > -1 ? row[mDom] : '';
    const nN = normalizeAccountName_(name);
    const nD = normalizeDomain_(domainCell || website);
    if (nN && idByName[nN]) matchedByName++;
    else if (nD && idByDomain[nD]) matchedByDomain++;
    else if (samplesUnmatched.length < 10) {
      samplesUnmatched.push({ rawName: name, normName: nN, rawWebsite: website, rawDomain: domainCell, normDomain: nD });
    }
  }
  Logger.log('LogoMap rows without Account Id: ' + noId);
  Logger.log('Would match by name: ' + matchedByName);
  Logger.log('Would match by domain: ' + matchedByDomain);
  Logger.log('Unmatched sample (up to 10):');
  samplesUnmatched.forEach(s => Logger.log(JSON.stringify(s)));
}

function debugLogoMapNameMatchingPublic() {
  debugLogoMapNameMatching();
}

function consolidateLogoMap() {
  const ss = SpreadsheetApp.getActive();
  const mapSheet = ss.getSheetByName('LogoMap');
  if (!mapSheet) throw new Error('LogoMap sheet not found.');

  const data = mapSheet.getDataRange().getValues();
  if (data.length < 2) return;
  const headers = data[0].slice();
  const idIdx = headers.indexOf('Account Id');
  const nameIdx = headers.indexOf('Account Name');
  const websiteIdx = headers.indexOf('Website');
  const domainIdx = headers.indexOf('Domain');
  const logoIdx = headers.indexOf('Logo URL');
  const manualIdx = headers.indexOf('Manual Override');
  const updatedIdx = headers.indexOf('Last Updated');

  if (nameIdx === -1 || logoIdx === -1) {
    throw new Error('LogoMap is missing required columns: Account Name, Logo URL');
  }

  const parents = [];
  for (let i = 0; i < data.length; i++) parents.push(i);

  function find(i) {
    let r = i;
    while (parents[r] !== r) r = parents[r];
    let cur = i;
    while (parents[cur] !== r) {
      const next = parents[cur];
      parents[cur] = r;
      cur = next;
    }
    return r;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parents[ra] = rb;
  }

  const byId = {}, byName = {}, byDomain = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const aId = idIdx > -1 ? String(row[idIdx] || '').trim() : '';
    const name = nameIdx > -1 ? row[nameIdx] : '';
    const website = websiteIdx > -1 ? row[websiteIdx] : '';
    const domainCell = domainIdx > -1 ? row[domainIdx] : '';
    const nN = normalizeAccountName_(name);
    const nD = normalizeDomain_(domainCell || website);
    if (aId) {
      if (byId[aId] != null) union(byId[aId], i);
      else byId[aId] = i;
    }
    if (nN) {
      if (byName[nN] != null) union(byName[nN], i);
      else byName[nN] = i;
    }
    if (nD) {
      if (byDomain[nD] != null) union(byDomain[nD], i);
      else byDomain[nD] = i;
    }
  }

  const groups = {};
  for (let i = 1; i < data.length; i++) {
    const root = find(i);
    if (!groups[root]) groups[root] = [];
    groups[root].push(i);
  }

  function ts(v) {
    if (v instanceof Date) return v.getTime();
    if (v) {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d.getTime();
    }
    return 0;
  }
  function isManual(v) {
    return v === true || String(v).toUpperCase() === 'TRUE';
  }
  function pickSurvivor(rowIdxs) {
    let best = rowIdxs[0], bestScore = -1;
    rowIdxs.forEach(idx => {
      const r = data[idx];
      const manual = manualIdx > -1 ? isManual(r[manualIdx]) : false;
      const hasLogo = logoIdx > -1 && !!r[logoIdx];
      const updated = updatedIdx > -1 ? ts(r[updatedIdx]) : 0;
      const score = (manual ? 1e15 : 0) + (hasLogo ? 1e12 : 0) + updated;
      if (score > bestScore) { bestScore = score; best = idx; }
    });
    return best;
  }

  const survivorRows = [headers];
  Object.keys(groups).forEach(rootKey => {
    const groupIdxs = groups[rootKey];
    const survivorIdx = pickSurvivor(groupIdxs);
    const survivor = data[survivorIdx].slice();
    const sorted = groupIdxs.slice().sort((a, b) => {
      const ua = updatedIdx > -1 ? ts(data[a][updatedIdx]) : 0;
      const ub = updatedIdx > -1 ? ts(data[b][updatedIdx]) : 0;
      return ub - ua;
    });
    sorted.forEach(idx => {
      const row = data[idx];
      headers.forEach((col, c) => {
        if (!survivor[c] && row[c]) survivor[c] = row[c];
      });
      if (manualIdx > -1 && isManual(row[manualIdx])) survivor[manualIdx] = true;
    });
    survivorRows.push(survivor);
  });

  mapSheet.clearContents();
  mapSheet.getRange(1, 1, survivorRows.length, survivorRows[0].length).setValues(survivorRows);
  SpreadsheetApp.getUi().alert(
    'LogoMap consolidated. Kept ' + (survivorRows.length - 1) + ' rows from ' + (data.length - 1) + ' original rows.'
  );
}

function consolidateLogoMapPublic() {
  consolidateLogoMap();
}

function fillMissingLogosInLogoMap() {
  const ss = SpreadsheetApp.getActive();
  const mapSheet = ss.getSheetByName('LogoMap');
  if (!mapSheet) throw new Error('LogoMap sheet not found.');

  const data = mapSheet.getDataRange().getValues();
  if (data.length < 2) return;

  const headers = data[0];
  const accountIdx = headers.indexOf('Account Name');
  const websiteIdx = headers.indexOf('Website');
  const domainIdx = headers.indexOf('Domain');
  const logoIdx = headers.indexOf('Logo URL');
  const dateIdx = headers.indexOf('Last Updated');
  const manualIdx = headers.indexOf('Manual Override');

  if (accountIdx === -1 || logoIdx === -1) {
    throw new Error('LogoMap is missing required columns: Account Name, Logo URL');
  }

  const now = new Date();
  const cacheByDomain = {};
  let processed = 0, filled = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const account = row[accountIdx];
    const rawWebsite = websiteIdx > -1 ? row[websiteIdx] : '';
    const existingLogo = row[logoIdx];
    const manualOverride = manualIdx > -1 && (row[manualIdx] === true || String(row[manualIdx]).toUpperCase() === 'TRUE');
    const explicitDomain = domainIdx > -1 ? row[domainIdx] : '';

    if (!account || existingLogo || manualOverride) continue;
    const domain = normalizeDomain_(explicitDomain || rawWebsite);
    if (!domain) continue;

    processed++;
    if (!cacheByDomain.hasOwnProperty(domain)) {
      cacheByDomain[domain] = fetchLogoUrlForAccount_(domain, rawWebsite || ('https://' + domain));
    }
    const logoUrl = cacheByDomain[domain];
    if (!logoUrl) continue;
    row[logoIdx] = logoUrl;
    if (dateIdx > -1) row[dateIdx] = now;
    filled++;
  }

  mapSheet.clearContents();
  mapSheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  Logger.log('Pass E fillMissing: processed ' + processed + ', filled ' + filled);
  SpreadsheetApp.getUi().alert('Fill Missing Logos complete. Processed ' + processed + ', filled ' + filled + '.');
}

function forceRefreshAllLogos() {
  const ss = SpreadsheetApp.getActive();
  const mapSheet = ss.getSheetByName('LogoMap');
  if (!mapSheet) throw new Error('LogoMap sheet not found.');

  const data = mapSheet.getDataRange().getValues();
  if (data.length < 2) return;

  const headers = data[0];
  const accountIdx = headers.indexOf('Account Name');
  const websiteIdx = headers.indexOf('Website');
  const domainIdx = headers.indexOf('Domain');
  const logoIdx = headers.indexOf('Logo URL');
  const dateIdx = headers.indexOf('Last Updated');
  const manualIdx = headers.indexOf('Manual Override');

  if (accountIdx === -1 || logoIdx === -1) {
    throw new Error('LogoMap is missing required columns: Account Name, Logo URL');
  }

  const now = new Date();
  const cacheByDomain = {};
  let scanned = 0, replaced = 0, unchanged = 0, kept = 0, failed = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const account = row[accountIdx];
    const rawWebsite = websiteIdx > -1 ? row[websiteIdx] : '';
    const manualOverride = manualIdx > -1 && (row[manualIdx] === true || String(row[manualIdx]).toUpperCase() === 'TRUE');
    const explicitDomain = domainIdx > -1 ? row[domainIdx] : '';

    if (!account) continue;
    if (manualOverride) { kept++; continue; }
    const domain = normalizeDomain_(explicitDomain || rawWebsite);
    if (!domain) { failed++; continue; }

    scanned++;
    if (!cacheByDomain.hasOwnProperty(domain)) {
      cacheByDomain[domain] = fetchLogoUrlForAccount_(domain, rawWebsite || ('https://' + domain));
    }
    const newLogo = cacheByDomain[domain];
    const existing = row[logoIdx];
    if (!newLogo) { failed++; continue; }
    if (newLogo === existing) { unchanged++; continue; }
    row[logoIdx] = newLogo;
    if (dateIdx > -1) row[dateIdx] = now;
    replaced++;
  }

  mapSheet.clearContents();
  mapSheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  const msg = 'Force Refresh complete.\n' +
    'Scanned: ' + scanned + '\n' +
    'Replaced: ' + replaced + '\n' +
    'Unchanged: ' + unchanged + '\n' +
    'Failed (no logo): ' + failed + '\n' +
    'Kept (manual): ' + kept;
  Logger.log(msg.replace(/\n/g, ' | '));
  SpreadsheetApp.getUi().alert(msg);
}

function forceRefreshAllLogosPublic() {
  forceRefreshAllLogos();
}

function upgradeLogoMapUrlsToHttps() {
  const ss = SpreadsheetApp.getActive();
  const mapSheet = ss.getSheetByName('LogoMap');
  if (!mapSheet) throw new Error('LogoMap sheet not found.');
  const data = mapSheet.getDataRange().getValues();
  if (data.length < 2) return;
  const headers = data[0];
  const logoIdx = headers.indexOf('Logo URL');
  const dateIdx = headers.indexOf('Last Updated');
  if (logoIdx === -1) throw new Error('LogoMap missing Logo URL header.');
  let changed = 0;
  const now = new Date();
  for (let i = 1; i < data.length; i++) {
    const url = data[i][logoIdx];
    if (!url) continue;
    const s = String(url).trim();
    if (s.startsWith('http://')) {
      data[i][logoIdx] = 'https://' + s.substring('http://'.length);
      if (dateIdx > -1) data[i][dateIdx] = now;
      changed++;
    }
  }
  mapSheet.clearContents();
  mapSheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  Logger.log('Upgraded ' + changed + ' LogoMap URLs to HTTPS.');
}

function applyLogoMapToGoLives() {
  const ss = SpreadsheetApp.getActive();
  const goLivesSheet = ss.getSheetByName('GoLives');
  const mapSheet = ss.getSheetByName('LogoMap');
  if (!goLivesSheet || !mapSheet) return;

  const mapData = mapSheet.getDataRange().getValues();
  if (mapData.length < 2) return;
  const mapHeaders = mapData[0];
  const mAccountId = mapHeaders.indexOf('Account Id');
  const mAccountName = mapHeaders.indexOf('Account Name');
  const mWebsite = mapHeaders.indexOf('Website');
  const mDomain = mapHeaders.indexOf('Domain');
  const mLogo = mapHeaders.indexOf('Logo URL');
  if (mLogo === -1) return;

  const byId = {}, byName = {}, byDomain = {};
  for (let i = 1; i < mapData.length; i++) {
    const row = mapData[i];
    const id = mAccountId > -1 ? row[mAccountId] : '';
    const name = mAccountName > -1 ? row[mAccountName] : '';
    const website = mWebsite > -1 ? row[mWebsite] : '';
    const domain = (mDomain > -1 ? row[mDomain] : '') || normalizeDomain_(website);
    const logo = row[mLogo];
    if (!logo) continue;
    if (id) byId[String(id).trim()] = logo;
    if (name) byName[normalizeAccountName_(name)] = logo;
    if (domain) byDomain[normalizeDomain_(domain)] = logo;
  }

  const glData = goLivesSheet.getDataRange().getValues();
  if (glData.length < 2) return;
  const glHeaders = glData[0];
  const glIdAccount = glHeaders.indexOf('Account Id');
  const glIdName = glHeaders.indexOf('Account Name');
  const glIdWebsite = glHeaders.indexOf('Website');
  const glIdLogo = glHeaders.indexOf('Logo URL');
  if (glIdLogo === -1) return;

  const logoColValues = [];
  for (let i = 1; i < glData.length; i++) {
    const row = glData[i];
    const id = glIdAccount > -1 ? String(row[glIdAccount] || '').trim() : '';
    const name = glIdName > -1 ? String(row[glIdName] || '').trim() : '';
    const website = glIdWebsite > -1 ? String(row[glIdWebsite] || '').trim() : '';
    const normName = normalizeAccountName_(name);
    const normDomain = normalizeDomain_(website);
    let logo = '';
    if (id && byId[id]) logo = byId[id];
    else if (normName && byName[normName]) logo = byName[normName];
    else if (normDomain && byDomain[normDomain]) logo = byDomain[normDomain];
    logoColValues.push([logo]);
  }
  goLivesSheet.getRange(2, glIdLogo + 1, logoColValues.length, 1).setValues(logoColValues);
}

function applyLogoMapToGoLivesPublic() {
  applyLogoMapToGoLives();
}

/*******************
 * WEB APP DATA
 *******************/

function getGoLivesData(options) {
  options = options || {};
  const includePartner = !!options.includePartner;
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('GoLives');
  if (!sheet) throw new Error('GoLives sheet not found.');

  const headers = validateHeaders(sheet, GoLivesSchemas.goLives.columns, { allowExtra: true });
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const idx = {
    accountId: headers.indexOf('Account Id'),
    accountName: headers.indexOf('Account Name'),
    effectiveDate: headers.indexOf('Effective Date'),
    status: headers.indexOf('Status'),
    productAreas: headers.indexOf('Product Areas'),
    functions: headers.indexOf('Functions'),
    industry: headers.indexOf('Industry'),
    subIndustry: headers.indexOf('Sub-Industry'),
    classification: headers.indexOf('Classification Range'),
    psSubRegion: headers.indexOf('PS Sub Region'),
    em: headers.indexOf('Workday Engagement Manager: Full Name'),
    partner: headers.indexOf('Priming Partner: Account Name'),
    deploymentName: headers.indexOf('Deployment Name'),
    website: headers.indexOf('Website'),
    contractType: headers.indexOf('Contract Type'),
    phase: headers.indexOf('Services Approach'),
    currentMtp: headers.indexOf('Current MTP Date'),
    isPhase: headers.indexOf('Is Phase Deployment'),
    inProduction: headers.indexOf('In Production'),
    logoUrl: headers.indexOf('Logo URL')
  };

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const accountName = r[idx.accountName];
    if (!accountName) continue;

    const goLiveDate = r[idx.effectiveDate];
    let goLiveDateStr = '';
    if (goLiveDate instanceof Date && !isNaN(goLiveDate.getTime())) {
      goLiveDateStr = formatDateYmd_(goLiveDate);
    } else if (goLiveDate) {
      goLiveDateStr = String(goLiveDate);
    }

    let logoUrl = r[idx.logoUrl] ? String(r[idx.logoUrl]).trim() : '';
    if (logoUrl.startsWith('http://')) logoUrl = 'https://' + logoUrl.substring('http://'.length);

    const obj = {
      accountId: idx.accountId > -1 ? String(r[idx.accountId] || '') : '',
      accountName: String(accountName),
      productAreas: r[idx.productAreas] ? String(r[idx.productAreas]) : '',
      functions: idx.functions > -1 && r[idx.functions] ? String(r[idx.functions]) : '',
      goLiveDate: goLiveDateStr,
      effectiveDate: goLiveDateStr,
      status: idx.status > -1 ? String(r[idx.status] || '') : '',
      industry: idx.industry > -1 && r[idx.industry] ? String(r[idx.industry]) : '',
      subIndustry: idx.subIndustry > -1 && r[idx.subIndustry] ? String(r[idx.subIndustry]) : '',
      classification: idx.classification > -1 && r[idx.classification] ? String(r[idx.classification]) : '',
      subRegion: idx.psSubRegion > -1 && r[idx.psSubRegion] ? String(r[idx.psSubRegion]) : '',
      engagementManager: idx.em > -1 && r[idx.em] ? String(r[idx.em]) : '',
      deploymentName: idx.deploymentName > -1 ? String(r[idx.deploymentName] || '') : '',
      website: idx.website > -1 ? String(r[idx.website] || '') : '',
      contractType: idx.contractType > -1 ? String(r[idx.contractType] || '') : '',
      servicesApproach: idx.phase > -1 ? String(r[idx.phase] || '') : '',
      currentMtpDate: idx.currentMtp > -1 && r[idx.currentMtp]
        ? (r[idx.currentMtp] instanceof Date ? formatDateYmd_(r[idx.currentMtp]) : String(r[idx.currentMtp]))
        : '',
      isPhaseDeployment: idx.isPhase > -1 ? Boolean(r[idx.isPhase]) : false,
      inProduction: idx.inProduction > -1 ? Boolean(r[idx.inProduction]) : false,
      logoUrl: logoUrl
    };
    if (includePartner && idx.partner > -1 && r[idx.partner]) {
      obj.deploymentPartner = String(r[idx.partner]);
    }
    rows.push(obj);
  }
  return rows;
}

/*******************
 * SLIDES EXPORT
 *******************/

function getGoLivesRowsForSlides_() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('GoLives');
  if (!sheet) throw new Error('GoLives sheet not found.');

    const headers = validateHeaders(sheet, GoLivesSchemas.goLives.columns, { allowExtra: true });
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const idxAccount = headers.indexOf('Account Name');
  const idxProductAreas = headers.indexOf('Product Areas');
  const idxEffective = headers.indexOf('Effective Date');
  const idxLegacyGoLive = headers.indexOf('Go Live Date Actual');
  const idxLogoUrl = headers.indexOf('Logo URL');
  const idxIndustry = headers.indexOf('Industry');
  const idxSubIndustry = headers.indexOf('Sub-Industry');
  const idxClassification = headers.indexOf('Classification Range');
  const idxSubRegion = headers.indexOf('PS Sub Region');
  const idxEM = headers.indexOf('Workday Engagement Manager: Full Name');
  const idxPartner = headers.indexOf('Priming Partner: Account Name');
  const idxStatus = headers.indexOf('Status');

  if (idxAccount === -1 || idxProductAreas === -1) {
    throw new Error('GoLives must have "Account Name" and "Product Areas" columns.');
  }
  if (idxEffective === -1 && idxLegacyGoLive === -1) {
    throw new Error('GoLives must have either "Effective Date" or "Go Live Date Actual" column.');
  }

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const accountName = row[idxAccount];
    if (!accountName) continue;

    const productAreas = row[idxProductAreas] || '';
    const logoUrl = idxLogoUrl > -1 ? row[idxLogoUrl] : '';
    const industry = idxIndustry > -1 ? row[idxIndustry] : '';
    const subIndustry = idxSubIndustry > -1 ? row[idxSubIndustry] : '';
    const classification = idxClassification > -1 ? row[idxClassification] : '';
    const subRegion = idxSubRegion > -1 ? row[idxSubRegion] : '';
    const emName = idxEM > -1 ? row[idxEM] : '';
    const partner = idxPartner > -1 ? row[idxPartner] : '';
    const status = idxStatus > -1 ? row[idxStatus] : '';

    const effectiveCell = idxEffective > -1 ? row[idxEffective] : null;
    const legacyCell = idxLegacyGoLive > -1 ? row[idxLegacyGoLive] : null;
    const goLiveCell = (effectiveCell !== null && effectiveCell !== '') ? effectiveCell : legacyCell;

    let goLiveDateObj = null;
    let goLiveStr = '';
    if (goLiveCell instanceof Date) {
      goLiveDateObj = new Date(goLiveCell);
    } else if (goLiveCell) {
      const d = new Date(goLiveCell);
      if (!isNaN(d.getTime())) goLiveDateObj = d;
    }
    if (goLiveDateObj) {
      const m = goLiveDateObj.getMonth() + 1;
      const d = goLiveDateObj.getDate();
      const yy = String(goLiveDateObj.getFullYear()).slice(-2);
      const ddStr = d < 10 ? '0' + d : String(d);
      goLiveStr = m + '/' + ddStr + '/' + yy;
    }

    rows.push({
      accountName: String(accountName),
      productAreas: productAreas ? String(productAreas) : '',
      goLiveDateObj,
      goLiveDateStr: goLiveStr,
      logoUrl: logoUrl ? String(logoUrl) : '',
      industry: industry ? String(industry) : '',
      subIndustry: subIndustry ? String(subIndustry) : '',
      classification: classification ? String(classification) : '',
      subRegion: subRegion ? String(subRegion) : '',
      engagementManager: emName ? String(emName) : '',
      deploymentPartner: partner ? String(partner) : '',
      status: status ? String(status) : ''
    });
  }
  return rows;
}

function getQuarterRangesForExport_(today) {
  const y = today.getFullYear();
  const m = today.getMonth();
  let current = { start: null, end: null };
  let last = { start: null, end: null };

  if (m === 0) {
    current.start = new Date(y - 1, 10, 1);
    current.end   = new Date(y, 0, 31);
    last.start    = new Date(y - 1, 7, 1);
    last.end      = new Date(y - 1, 9, 31);
  } else if (m >= 1 && m <= 3) {
    current.start = new Date(y, 1, 1);
    current.end   = new Date(y, 3, 30);
    last.start    = new Date(y - 1, 10, 1);
    last.end      = new Date(y, 0, 31);
  } else if (m >= 4 && m <= 6) {
    current.start = new Date(y, 4, 1);
    current.end   = new Date(y, 6, 31);
    last.start    = new Date(y, 1, 1);
    last.end      = new Date(y, 3, 30);
  } else if (m >= 7 && m <= 9) {
    current.start = new Date(y, 7, 1);
    current.end   = new Date(y, 9, 31);
    last.start    = new Date(y, 4, 1);
    last.end      = new Date(y, 6, 31);
  } else {
    current.start = new Date(y, 10, 1);
    current.end   = new Date(y + 1, 0, 31);
    last.start    = new Date(y, 7, 1);
    last.end      = new Date(y, 9, 31);
  }
  [current.start, current.end, last.start, last.end].forEach(dt => {
    if (dt) dt.setHours(0, 0, 0, 0);
  });
  return { current, last };
}

/******************* * WORKDAY FISCAL HELPERS (server-side) *******************/
// Workday FY: Feb 1 .. Jan 31. FY label = calendar year of end date.
function workdayFiscalYearForDate_(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  const m = d.getMonth();
  const y = d.getFullYear();
  return m === 0 ? y : y + 1;
}

function workdayFiscalQuarterForDate_(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  const m = d.getMonth();
  if (m >= 1 && m <= 3) return 1;
  if (m >= 4 && m <= 6) return 2;
  if (m >= 7 && m <= 9) return 3;
  return 4;
}

function workdayFiscalQuarterRange_(fy, q) {
  // fy is the four-digit FY label (calendar year of Jan 31 end date).
  const startCalendarYear = fy - 1;
  let start, end;
  switch (Number(q)) {
    case 1:
      start = new Date(startCalendarYear, 1, 1);
      end = new Date(startCalendarYear, 3, 30);
      break;
    case 2:
      start = new Date(startCalendarYear, 4, 1);
      end = new Date(startCalendarYear, 6, 31);
      break;
    case 3:
      start = new Date(startCalendarYear, 7, 1);
      end = new Date(startCalendarYear, 9, 31);
      break;
    case 4:
      start = new Date(startCalendarYear, 10, 1);
      end = new Date(startCalendarYear + 1, 0, 31);
      break;
    default:
      return { start: null, end: null };
  }
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function workdayQmpQuarterRanges_(today) {
  today = today || new Date();
  const fy = workdayFiscalYearForDate_(today);
  const fq = workdayFiscalQuarterForDate_(today);
  const currentRange = workdayFiscalQuarterRange_(fy, fq);
  let prevFy = fy, prevQ = fq - 1;
  if (prevQ < 1) { prevQ = 4; prevFy = fy - 1; }
  const lastRange = workdayFiscalQuarterRange_(prevFy, prevQ);
  return {
    currentFy: fy, currentQ: fq, currentStart: currentRange.start, currentEnd: currentRange.end,
    lastFy: prevFy, lastQ: prevQ, lastStart: lastRange.start, lastEnd: lastRange.end
  };
}

function filterGoLivesForSlides_(rows, payload) {
  payload = payload || {};
  const searchQuery = (payload.searchQuery || '').toString().toLowerCase();
  const industry = payload.industry || '';
  const subIndustry = payload.subIndustry || '';
  const classification = payload.classification || '';
  const subRegion = payload.subRegion || '';
  const deploymentPartner = payload.deploymentPartner || '';
  const productAreas = Array.isArray(payload.productAreas)
    ? payload.productAreas.filter(Boolean) : [];
  const productAreasMatch = (payload.productAreasMatch || 'any').toString().toLowerCase();

  // view: 'past' | 'upcoming' | 'qmp'
  let view;
  if (payload.view === 'upcoming') view = 'upcoming';
  else if (payload.view === 'qmp') view = 'qmp';
  else view = 'past';

  let startDate = payload.start ? new Date(payload.start) : null;
  let endDate = payload.end ? new Date(payload.end) : null;
  if (startDate && isNaN(startDate.getTime())) startDate = null;
  if (endDate && isNaN(endDate.getTime())) endDate = null;

  if (!startDate && !endDate && payload.timeframe) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const tf = payload.timeframe;
    if (tf === '30' || tf === '180') {
      endDate = new Date(now);
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - parseInt(tf, 10));
    } else if (tf === 'currentQ' || tf === 'lastQ') {
      const qr = getQuarterRangesForExport_(now);
      const r = tf === 'currentQ' ? qr.current : qr.last;
      startDate = r.start;
      endDate = r.end;
    }
  }
  if (startDate) startDate.setHours(0, 0, 0, 0);
  if (endDate) endDate.setHours(23, 59, 59, 999);

  // QMP: compute the two FQ ranges once, used per-row below.
  const qmpRanges = (view === 'qmp') ? workdayQmpQuarterRanges_(new Date()) : null;

  // Local helper to extract a Date from a row (mirrors existing logic).
  function rowDate_(row) {
    if (row.goLiveDateObj instanceof Date && !isNaN(row.goLiveDateObj.getTime())) {
      return row.goLiveDateObj;
    }
    if (row.goLiveDate) {
      const d = new Date(row.goLiveDate);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }

  return rows.filter(row => {
    const rowStatus = (row.status || 'Past');

    if (view === 'qmp') {
      // QMP: status + date must fall into exactly one of the two halves.
      const d = rowDate_(row);
      if (!d) return false;
      const dt = new Date(d.getTime()); dt.setHours(0, 0, 0, 0);
      const inLast = (rowStatus === 'Past'
        && dt >= qmpRanges.lastStart && dt <= qmpRanges.lastEnd);
      const inCurrent = (rowStatus === 'Upcoming'
        && dt >= qmpRanges.currentStart && dt <= qmpRanges.currentEnd);
      if (!inLast && !inCurrent) return false;
    } else {
      if (view === 'upcoming' && rowStatus !== 'Upcoming') return false;
      if (view === 'past' && rowStatus !== 'Past') return false;
    }

    const a = (row.accountName || '').toLowerCase();
    const p = (row.productAreas || '').toLowerCase();
    if (searchQuery && !a.includes(searchQuery) && !p.includes(searchQuery)) return false;
    if (industry && row.industry !== industry) return false;
    if (subIndustry && row.subIndustry !== subIndustry) return false;
    if (classification && row.classification !== classification) return false;
    if (subRegion && row.subRegion !== subRegion) return false;
    if (deploymentPartner && row.deploymentPartner !== deploymentPartner) return false;

    if (productAreas.length) {
      const rowProducts = (row.productAreas || '').split(',').map(s => s.trim()).filter(Boolean);
      if (productAreasMatch === 'all') {
        const ok = productAreas.every(pa => rowProducts.indexOf(pa) !== -1);
        if (!ok) return false;
      } else {
        const ok = productAreas.some(pa => rowProducts.indexOf(pa) !== -1);
        if (!ok) return false;
      }
    }

    // In QMP mode the per-row date window is already enforced above.
    // For Past/Upcoming, apply the user-selected time window.
    if (view !== 'qmp' && (startDate || endDate)) {
      const d = row.goLiveDateObj || (row.goLiveDate ? new Date(row.goLiveDate) : null);
      if (!d || isNaN(d.getTime())) return false;
      const dt = new Date(d.getTime()); dt.setHours(0, 0, 0, 0);
      if (startDate && dt < startDate) return false;
      if (endDate && dt > endDate) return false;
    }

    return true;
  });
}

function looksLikeFaviconUrl_(url) {
  if (!url) return false;
  const u = url.toLowerCase().trim();
  if (u.startsWith('data:')) return true;
  const noQuery = u.split(/[?#]/)[0];
  if (noQuery.endsWith('.ico')) return true;
  // Google's high-res favicon API returns a proper PNG and should be allowed
  // even though "favicon" appears in the URL path.
  if (u.indexOf('google.com/s2/favicons') !== -1) return false;
  if (u.indexOf('favicon') !== -1) return true;
  return false;
}

function fetchImageBlobOrNull_(url) {
  try {
    let safe = String(url || '').trim();
    if (!safe) return null;
    if (safe.startsWith('http://')) safe = 'https://' + safe.substring('http://'.length);
    const resp = UrlFetchApp.fetch(safe, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'image/avif,image/webp,image/svg+xml,image/*,*/*;q=0.8'
      }
    });
    const code = resp.getResponseCode();
    if (code < 200 || code >= 300) return null;
    const blob = resp.getBlob();
    const lowerNoQuery = safe.toLowerCase().split(/[?#]/)[0];
    if (lowerNoQuery.endsWith('.svg')) blob.setContentType('image/svg+xml');
    return blob;
  } catch (e) { return null; }
}

// Inserts a plain centered-title divider slide used between QMP sections.
function insertSectionDividerSlide_(presentation, titleStr, pageWidth, pageHeight) {
  const slide = presentation.appendSlide();
  // Strip any default placeholders from the new slide for a clean canvas.
  slide.getPageElements().forEach(el => el.remove());

  const boxWidth = pageWidth * 0.8;
  const boxHeight = 100;
  const boxLeft = (pageWidth - boxWidth) / 2;
  const boxTop = (pageHeight - boxHeight) / 2;

  const box = slide.insertTextBox(titleStr, boxLeft, boxTop, boxWidth, boxHeight);
  const text = box.getText();
  text.getTextStyle()
    .setFontFamily('Arial')
    .setFontSize(28)
    .setBold(true);
  text.getParagraphStyle()
    .setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
  box.getFill().setTransparent();
  return slide;
}

function layOutLogosOnSlideForExport_(slide, rows, pageWidth, pageHeight) {
  const COLS = 5, ROWS = 3, MAX_CELLS = COLS * ROWS;
  const count = Math.min(rows.length, MAX_CELLS);
  const marginLeft = 20, marginTop = 40, marginRight = 20, marginBottom = 40;
  const boxWidth = pageWidth - marginLeft - marginRight;
  const boxHeight = pageHeight - marginTop - marginBottom;
  const cellWidth = boxWidth / COLS;
  const cellHeight = boxHeight / ROWS;

  const paddingTop = 6, paddingBetweenLogoAndText = 6;
  const paddingBetweenTitleAndProducts = 8, paddingBottom = 6;
  const titleFontSize = 7, titleLineHeight = titleFontSize + 4, titleLines = 2;
  const productFontSize = 6, productLineHeight = productFontSize + 3, productMaxLines = 2;
  const titleBlockHeight = titleLines * titleLineHeight;
  const productBlockHeight = productMaxLines * productLineHeight;
  const totalTextHeight = titleBlockHeight + paddingBetweenTitleAndProducts + productBlockHeight + paddingBottom;

  for (let idx = 0; idx < count; idx++) {
    const data = rows[idx];
    const r = Math.floor(idx / COLS);
    const c = idx % COLS;
    if (r >= ROWS) break;
    const cellLeft = marginLeft + c * cellWidth;
    const cellTop = marginTop + r * cellHeight;
    const availableHeight = cellHeight - paddingTop - paddingBottom;
    const maxLogoHeight = Math.max(28, availableHeight - totalTextHeight);
    const logoWidth = cellWidth * 0.85;
    const logoHeight = Math.min(maxLogoHeight, cellHeight * 0.55);
    const logoX = cellLeft + (cellWidth - logoWidth) / 2;
    const logoY = cellTop + paddingTop;

    let useFallback = false;
    let logoUrl = data.logoUrl || '';
    if (logoUrl) { if (looksLikeFaviconUrl_(logoUrl)) useFallback = true; }
    else useFallback = true;

    let imageInserted = false;
    if (!useFallback && logoUrl) {
      if (logoUrl.startsWith('http://')) logoUrl = 'https://' + logoUrl.substring('http://'.length);
      try {
        const image = slide.insertImage(logoUrl, logoX, logoY, logoWidth, logoHeight);
        image.setTitle(data.accountName + ' logo');
        imageInserted = true;
      } catch (eUrl) {
        Logger.log('Logo insert by URL failed for ' + data.accountName + ': ' + eUrl.message);
        const blob = fetchImageBlobOrNull_(logoUrl);
        if (blob) {
          try {
            const image = slide.insertImage(blob, logoX, logoY, logoWidth, logoHeight);
            image.setTitle(data.accountName + ' logo (blob)');
            imageInserted = true;
          } catch (eBlob) {}
        }
      }
    }
    if (!imageInserted) {
      let fallbackUrl = WORKDAY_FALLBACK_LOGO_URL;
      if (fallbackUrl.startsWith('http://')) fallbackUrl = 'https://' + fallbackUrl.substring('http://'.length);
      try {
        const image = slide.insertImage(fallbackUrl, logoX, logoY, logoWidth, logoHeight);
        image.setTitle('Workday logo (fallback for ' + data.accountName + ')');
        imageInserted = true;
      } catch (e) {}
    }
    if (!imageInserted) {
      const ph = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, logoX, logoY, logoWidth, logoHeight);
      ph.getFill().setTransparent();
      const t = ph.getText();
      t.setText('No Logo');
      const ts = t.getTextStyle();
      ts.setFontSize(titleFontSize);
      ts.setBold(true);
      ts.setFontFamily('Arial');
      t.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
    }

    const titleTop = logoY + logoHeight + paddingBetweenLogoAndText;
    const titleBox = slide.insertShape(SlidesApp.ShapeType.TEXT_BOX, cellLeft, titleTop, cellWidth, titleBlockHeight);
    const name = data.accountName || '';
    const date = data.goLiveDateStr || '';
    const titleRange = titleBox.getText();
    if (name && date) titleRange.setText(name + '\n' + date);
    else if (name) titleRange.setText(name);
    else titleRange.setText('');
    const titleStyle = titleRange.getTextStyle();
    titleStyle.setFontFamily('Arial');
    titleStyle.setFontSize(titleFontSize);
    titleStyle.setBold(true);
    titleRange.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
    titleBox.getFill().setTransparent();

    const productAreasRaw = (data.productAreas || '').toString().trim();
    if (productAreasRaw) {
      const approxCharsPerLine = 24;
      const maxChars = approxCharsPerLine * productMaxLines;
      let trimmed = productAreasRaw;
      if (trimmed.length > maxChars) {
        trimmed = trimmed.substring(0, Math.max(0, maxChars - 1)).replace(/\s+\S*$/, '') + '…';
      }
      const productTop = titleTop + titleBlockHeight + paddingBetweenTitleAndProducts;
      const productBox = slide.insertShape(SlidesApp.ShapeType.TEXT_BOX, cellLeft, productTop, cellWidth, productBlockHeight);
      const productRange = productBox.getText();
      productRange.setText(trimmed);
      const productStyle = productRange.getTextStyle();
      productStyle.setFontFamily('Arial');
      productStyle.setFontSize(productFontSize);
      productStyle.setBold(false);
      productStyle.setForegroundColor('#6B7280');
      productRange.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
      productBox.getFill().setTransparent();
    }
  }
}

function createSlidesFromFilteredGoLives(payload, options) {
  options = options || {};
  const deckTitlePrefix = options.deckTitlePrefix || 'Go Lives Export';
  const exportFolderId = options.exportFolderId || null;

  const rows = getGoLivesRowsForSlides_();
  const filtered = filterGoLivesForSlides_(rows, payload);
  if (!filtered.length) return '';

  // view: 'past' | 'upcoming' | 'qmp'
  let view;
  if (payload && payload.view === 'upcoming') view = 'upcoming';
  else if (payload && payload.view === 'qmp') view = 'qmp';
  else view = 'past';

  // Determine which rows go into the deck.
  // Past/Upcoming: apply rolling 12-month cap (existing behavior).
  // QMP: no cap — filterGoLivesForSlides_ already enforced the two FQ windows.
  let slidesRows;
  if (view === 'qmp') {
    slidesRows = filtered.slice();
  } else {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    let windowStart, windowEnd;
    if (view === 'upcoming') {
      windowStart = new Date(todayStart);
      windowEnd = new Date(todayStart);
      windowEnd.setFullYear(windowEnd.getFullYear() + 1);
      windowEnd.setHours(23, 59, 59, 999);
    } else {
      windowEnd = new Date(todayStart); windowEnd.setHours(23, 59, 59, 999);
      windowStart = new Date(todayStart);
      windowStart.setFullYear(windowStart.getFullYear() - 1);
    }
    slidesRows = filtered.filter(r => {
      const d = r.goLiveDateObj;
      if (!d || isNaN(d.getTime())) return false;
      return d >= windowStart && d <= windowEnd;
    });
  }
  if (!slidesRows.length) return '';

  let userEmail = '';
  try {
    if (Session && Session.getActiveUser) {
      const u = Session.getActiveUser().getEmail();
      if (u) userEmail = u;
    }
  } catch (e) {}

  const titleDate = new Date().toISOString().slice(0, 10);
  const emailPart = userEmail ? ' - ' + userEmail : '';
  const fullTitle = deckTitlePrefix + ' - ' + titleDate + emailPart;

  const newPres = SlidesApp.create(fullTitle);
  const pageWidth = newPres.getPageWidth();
  const pageHeight = newPres.getPageHeight();
  const slides = newPres.getSlides();
  const titleSlide = slides[0];
  titleSlide.getPageElements().forEach(el => el.remove());

  const titleBox = titleSlide.insertTextBox(
    fullTitle, pageWidth * 0.1, pageHeight * 0.3, pageWidth * 0.8, 80
  );
  const titleText = titleBox.getText();
  titleText.getTextStyle().setFontFamily('Arial').setFontSize(24).setBold(true);
  titleText.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);

  const MAX_PER_SLIDE = 15;

  if (view === 'qmp') {
    // Split into Past + Upcoming halves; sort each ascending by date.
    const qmpRanges = workdayQmpQuarterRanges_(new Date());
    const pastHalf = [];
    const upcomingHalf = [];
    slidesRows.forEach(r => {
      const status = (r.status || 'Past');
      if (status === 'Past') pastHalf.push(r);
      else if (status === 'Upcoming') upcomingHalf.push(r);
    });
    const byDateAsc = (a, b) => {
      const ad = a.goLiveDateObj ? a.goLiveDateObj.getTime() : 0;
      const bd = b.goLiveDateObj ? b.goLiveDateObj.getTime() : 0;
      return ad - bd;
    };
    pastHalf.sort(byDateAsc);
    upcomingHalf.sort(byDateAsc);

    const pad2 = n => (n < 10 ? '0' + n : String(n));

    if (pastHalf.length) {
      const dividerTitle = 'Last Quarter — Past Go Lives (FY'
        + pad2(qmpRanges.lastFy % 100) + ' Q' + qmpRanges.lastQ + ')';
      insertSectionDividerSlide_(newPres, dividerTitle, pageWidth, pageHeight);
      let remaining = pastHalf.slice();
      while (remaining.length > 0) {
        const chunk = remaining.splice(0, MAX_PER_SLIDE);
        const slide = newPres.appendSlide();
        layOutLogosOnSlideForExport_(slide, chunk, pageWidth, pageHeight);
      }
    }

    if (upcomingHalf.length) {
      const dividerTitle = 'This Quarter — Upcoming Go Lives (FY'
        + pad2(qmpRanges.currentFy % 100) + ' Q' + qmpRanges.currentQ + ')';
      insertSectionDividerSlide_(newPres, dividerTitle, pageWidth, pageHeight);
      let remaining = upcomingHalf.slice();
      while (remaining.length > 0) {
        const chunk = remaining.splice(0, MAX_PER_SLIDE);
        const slide = newPres.appendSlide();
        layOutLogosOnSlideForExport_(slide, chunk, pageWidth, pageHeight);
      }
    }
  } else {
    // Past / Upcoming: existing single-section behavior.
    let remaining = slidesRows.slice();
    while (remaining.length > 0) {
      const chunk = remaining.splice(0, MAX_PER_SLIDE);
      const slide = newPres.appendSlide();
      layOutLogosOnSlideForExport_(slide, chunk, pageWidth, pageHeight);
    }
  }

  if (exportFolderId) {
    try {
      const file = DriveApp.getFileById(newPres.getId());
      const exportFolder = DriveApp.getFolderById(exportFolderId);
      file.moveTo(exportFolder);
    } catch (e) {
      Logger.log('Error moving export to shared folder: ' + e);
    }
  }
  return newPres.getUrl();
}

function exportFilteredGoLivesAsCsv(payload) {
  payload = payload || {};
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('GoLives');
  if (!sheet) throw new Error('GoLives sheet not found.');

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return '';

  const headers = validateHeaders(sheet, GoLivesSchemas.goLives.columns, { allowExtra: true });

  const idxAccount = headers.indexOf('Account Name');
  const idxProductAreas = headers.indexOf('Product Areas');
  const idxEffective = headers.indexOf('Effective Date');
  const idxLegacyGoLive = headers.indexOf('Go Live Date Actual');
  const idxIndustry = headers.indexOf('Industry');
  const idxSubIndustry = headers.indexOf('Sub-Industry');
  const idxClass = headers.indexOf('Classification Range');
  const idxSubRegion = headers.indexOf('PS Sub Region');
  const idxPartner = headers.indexOf('Priming Partner: Account Name');
  const idxStatus = headers.indexOf('Status');

  const rowsForFilter = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[idxAccount]) continue;
    const effectiveCell = idxEffective > -1 ? row[idxEffective] : null;
    const legacyCell = idxLegacyGoLive > -1 ? row[idxLegacyGoLive] : null;
    const goLiveCell = (effectiveCell !== null && effectiveCell !== '') ? effectiveCell : legacyCell;
    let goLiveDateObj = null;
    if (goLiveCell instanceof Date) goLiveDateObj = new Date(goLiveCell);
    else if (goLiveCell) {
      const d = new Date(goLiveCell);
      if (!isNaN(d.getTime())) goLiveDateObj = d;
    }
    rowsForFilter.push({
      accountName: String(row[idxAccount]),
      productAreas: idxProductAreas > -1 ? String(row[idxProductAreas] || '') : '',
      goLiveDateObj,
      industry: idxIndustry > -1 ? String(row[idxIndustry] || '') : '',
      subIndustry: idxSubIndustry > -1 ? String(row[idxSubIndustry] || '') : '',
      classification: idxClass > -1 ? String(row[idxClass] || '') : '',
      subRegion: idxSubRegion > -1 ? String(row[idxSubRegion] || '') : '',
      deploymentPartner: idxPartner > -1 ? String(row[idxPartner] || '') : '',
      status: idxStatus > -1 ? String(row[idxStatus] || '') : '',
      _rowIndex: i
    });
  }

  const filtered = filterGoLivesForSlides_(rowsForFilter, payload);
  if (!filtered.length) return '';

  function esc(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (s.search(/[,\"\n\r]/) >= 0) {
      return '"' + s.replace(/\"/g, '""') + '"';
    }
    return s;
  }

  const lines = [];
  lines.push(headers.map(esc).join(','));
  filtered.forEach(obj => {
    const row = data[obj._rowIndex];
    const cells = headers.map((_, c) => esc(row[c]));
    lines.push(cells.join(','));
  });
  return lines.join('\r\n');
}