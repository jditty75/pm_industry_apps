/**
 * Reads sheet rows keyed by header name.
 * @param {string} sheetName
 * @returns {Array<Object<string, *>>}
 */
function readSheetRows_(sheetName) {
  Logger.log('readSheetRows_: start ' + sheetName);
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('readSheetRows_: missing sheet ' + sheetName);

  const headerIndex = buildHeaderIndex_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow, sheet.getLastColumn()).getValues();
  const rows = [];
  values.forEach(function(row) {
    const obj = {};
    Object.keys(headerIndex).forEach(function(header) {
      obj[header] = row[headerIndex[header]];
    });
    rows.push(obj);
  });
  Logger.log('readSheetRows_: read ' + rows.length + ' rows from ' + sheetName);
  return rows;
}

/**
 * Reads all deployment rows keyed by header name.
 * @returns {Array<Object<string, *>>}
 */
function readDeployments_() {
  return readSheetRows_(SHEET_DEPLOYMENTS);
}

/**
 * Reads all deployment-product rows keyed by header name.
 * @returns {Array<Object<string, *>>}
 */
function readProducts_() {
  return readSheetRows_(SHEET_PRODUCTS);
}

/**
 * Reads all deployment-contact rows keyed by header name.
 * @returns {Array<Object<string, *>>}
 */
function readContacts_() {
  return readSheetRows_(SHEET_CONTACTS);
}

/**
 * Returns true when ≥1 product has Function__c in TARGET_FUNCTIONS.
 * @param {Array<Object<string, *>>} products
 * @returns {boolean}
 */
function hasTargetFunction_(products) {
  return products.some(function(p) {
    const fn = String(p['Function__c'] || '').trim();
    return TARGET_FUNCTIONS.indexOf(fn) !== -1;
  });
}

/**
 * Returns true when deployment Name matches a major-product token (§4).
 * @param {Object<string, *>} deployment
 * @returns {boolean}
 */
function nameHasMajorProduct_(deployment) {
  const name = String(deployment['Name'] || '').trim();
  return NAME_MAJOR_REGEX.test(name);
}

/**
 * Returns true when any product row or deployment name indicates Student (Revision 4).
 * @param {Object<string, *>} deployment
 * @param {Array<Object<string, *>>} products
 * @returns {boolean}
 */
function isStudentDeployment_(deployment, products) {
  const name = String(deployment['Name'] || '').trim();
  if (STUDENT_NAME_REGEX.test(name)) return true;

  return (products || []).some(function(p) {
    const area = String(p['Product_Area__c'] || '').trim();
    if (STUDENT_AREAS.indexOf(area) !== -1) return true;
    const fn = String(p['Function__c'] || '').trim();
    return STUDENT_FUNCTIONS.indexOf(fn) !== -1;
  });
}

/**
 * Returns true when a deployment meets inclusion rules (§4, Revision 4).
 * @param {Object<string, *>} deployment
 * @param {Array<Object<string, *>>} products
 * @returns {boolean}
 */
function qualifies_(deployment, products) {
  const status = String(deployment['Overall_Status__c'] || '').trim();
  if (status !== 'Active') return false;
  if (isStudentDeployment_(deployment, products)) return false;

  const type = String(deployment['Deployment_Type__c'] || '').trim();
  if (type === TYPE_INITIAL) return true;
  if (type === TYPE_SUBSEQUENT) {
    return hasTargetFunction_(products) || nameHasMajorProduct_(deployment);
  }
  return false;
}

/**
 * Computed go-live date for a product row (§5.1).
 * @param {Date|null} parentMtp Current_MTP_Date__c
 * @param {Date|null} productTarget Production_Move_Date_Target__c
 * @returns {Date|null}
 */
function computeGoLiveDate_(parentMtp, productTarget) {
  const parent = parentMtp instanceof Date && !isNaN(parentMtp.getTime()) ? parentMtp : null;
  const target = productTarget instanceof Date && !isNaN(productTarget.getTime()) ? productTarget : null;
  return maxDate(parent, target);
}

/**
 * Returns true when Deployment_Partner_Name__c is Workday Professional Services (§8).
 * @param {Object<string, *>} deployment
 * @returns {boolean}
 */
function isWorkdayDelivered_(deployment) {
  const partner = String(deployment['Deployment_Partner_Name__c'] || '').trim().toLowerCase();
  return partner === INTERNAL_PARTNER;
}

/**
 * Derives pill labels from deployment Name tokens (§5.4 step 4).
 * @param {*} name
 * @returns {string[]}
 */
function pillsFromName_(name) {
  const pills = [];
  const n = String(name || '');
  if (/\bHCM\b/i.test(n)) pills.push('HCM');
  if (/\b(FIN|Financials?)\b/i.test(n)) pills.push('Financials');
  if (/\b(PAY|Payroll)\b/i.test(n)) pills.push('Payroll');
  return pills;
}

/**
 * Deduplicates and sorts pills by PILL_ORDER.
 * @param {string[]} pills
 * @returns {string[]}
 */
function sortPills_(pills) {
  const unique = {};
  pills.forEach(function(p) { unique[p] = true; });
  return PILL_ORDER.filter(function(p) { return unique[p]; });
}

/**
 * Resolves cosmetic product pills for one go-live event (§5.4).
 * @param {Array<Object<string, *>>} productsOnDate products grouped on this date
 * @param {Object<string, *>} deployment
 * @returns {string[]}
 */
function resolvePillsForEvent_(productsOnDate, deployment) {
  const prods = productsOnDate || [];
  const pills = [];

  prods.forEach(function(p) {
    const fn = String(p['Function__c'] || '').trim();
    if (FUNCTION_PILL[fn]) pills.push(FUNCTION_PILL[fn]);
  });
  if (pills.length) return sortPills_(pills);

  prods.forEach(function(p) {
    const fn = String(p['Function__c'] || '').trim();
    if (SIBLING_FUNCTION_PILL[fn]) pills.push(SIBLING_FUNCTION_PILL[fn]);
  });
  if (pills.length) return sortPills_(pills);

  prods.forEach(function(p) {
    const area = String(p['Product_Area__c'] || '').trim();
    if (AREA_PILL[area]) pills.push(AREA_PILL[area]);
  });
  if (pills.length) return sortPills_(pills);

  if (nameHasMajorProduct_(deployment)) {
    const namePills = pillsFromName_(deployment['Name']);
    if (namePills.length) return sortPills_(namePills);
  }

  return [GENERIC_PILL];
}

/**
 * Resolves a FIELD_REGISTRY entry against a deployment row.
 * @param {Object<string, *>} deployment
 * @param {Object} fieldDef
 * @returns {string}
 */
function resolveFieldValue_(deployment, fieldDef) {
  if (!fieldDef) return '';

  if (fieldDef.combine) {
    const parts = [];
    fieldDef.combine.forEach(function(header) {
      const raw = deployment[header];
      const val = fieldDef.type === 'person' ? parsePersonName(raw) : String(raw || '').trim();
      if (val) parts.push(val);
    });
    return parts.join(' / ');
  }

  const raw = deployment[fieldDef.header];
  if (fieldDef.type === 'person') return parsePersonName(raw);
  if (raw === null || raw === undefined) return '';
  return String(raw).trim();
}

/**
 * Finds a FIELD_REGISTRY entry by key.
 * @param {string} key
 * @returns {Object|undefined}
 */
function getFieldByKey_(key) {
  for (let i = 0; i < FIELD_REGISTRY.length; i++) {
    if (FIELD_REGISTRY[i].key === key) return FIELD_REGISTRY[i];
  }
  return undefined;
}

/**
 * Builds milestone object for one go-live event (§5.5).
 * @param {Object<string, *>} deployment
 * @param {string} iso yyyy-MM-dd
 * @param {string[]} coreProducts
 * @param {string} depType
 * @param {Array<{name:string,email:string,role:string}>} deploymentContacts
 * @returns {Object}
 */
function buildMilestoneObject_(deployment, iso, coreProducts, depType, deploymentContacts) {
  const depId = String(deployment['Id'] || '').trim();
  const keyContacts = {
    csm: resolveFieldValue_(deployment, getFieldByKey_('csm')),
    emdm: resolveFieldValue_(deployment, getFieldByKey_('emdm')),
    ae: resolveFieldValue_(deployment, getFieldByKey_('ae')),
    implementationPartner: resolveFieldValue_(deployment, getFieldByKey_('implementationPartner')),
    managingPartner: resolveFieldValue_(deployment, getFieldByKey_('managingPartner')),
  };

  return {
    id: depId + '-' + iso,
    customerName: resolveFieldValue_(deployment, getFieldByKey_('customerName')),
    deploymentName: String(deployment['Name'] || '').trim(),
    industry: resolveFieldValue_(deployment, getFieldByKey_('industry')),
    goLiveDate: iso,
    countdownDays: 0,
    coreProducts: coreProducts,
    deploymentType: depType,
    isWorkdayDelivered: isWorkdayDelivered_(deployment),
    region: resolveFieldValue_(deployment, getFieldByKey_('region')),
    subRegion: resolveFieldValue_(deployment, getFieldByKey_('subRegion')),
    keyContacts: keyContacts,
    deploymentContacts: deploymentContacts || [],
  };
}

/**
 * Builds milestone events for a single deployment (§5).
 * @param {Object<string, *>} deployment
 * @param {Array<Object<string, *>>} products child rows for this deployment
 * @param {Array<{name:string,email:string,role:string}>} deploymentContacts
 * @returns {Array<Object>}
 */
function buildMilestonesForDeployment_(deployment, products, deploymentContacts) {
  const depType = String(deployment['Deployment_Type__c'] || '').trim();
  const parentMtp = deployment['Current_MTP_Date__c'];
  const isParentAlreadyLive = isActualDateSet_(deployment['First_Move_to_Production_Date_Actual__c']);
  const isSubsequent = depType === TYPE_SUBSEQUENT;
  const isInitial = depType === TYPE_INITIAL;
  const hasTargetFn = hasTargetFunction_(products);
  const matchedByName = nameHasMajorProduct_(deployment);
  const milestones = [];

  function isProductLive(product) {
    return isActualDateSet_(product['Production_Move_Date_Actual__c']);
  }

  // Subsequent qualified by NAME only — one event at parent MTP (§5.3)
  if (isSubsequent && !hasTargetFn && matchedByName) {
    if (!isParentAlreadyLive) {
      const parentDate = parentMtp instanceof Date && !isNaN(parentMtp.getTime()) ? parentMtp : null;
      if (parentDate) {
        const iso = toIso(parentDate);
        if (iso) {
          const pills = resolvePillsForEvent_(products, deployment);
          milestones.push(buildMilestoneObject_(deployment, iso, pills, depType, deploymentContacts));
        }
      }
    }
    return milestones;
  }

  const eligibleProducts = [];
  products.forEach(function(product) {
    if (isProductLive(product)) return;

    if (isSubsequent) {
      const fn = String(product['Function__c'] || '').trim();
      if (TARGET_FUNCTIONS.indexOf(fn) === -1) return;
    }

    const computed = computeGoLiveDate_(parentMtp, product['Production_Move_Date_Target__c']);
    if (!computed) return;

    eligibleProducts.push({ product: product, computed: computed });
  });

  // Initial with no product rows — one event at parent MTP (§5.2)
  if (products.length === 0 && isInitial && !isParentAlreadyLive) {
    const parentDate = parentMtp instanceof Date && !isNaN(parentMtp.getTime()) ? parentMtp : null;
    if (parentDate) {
      const iso = toIso(parentDate);
      if (iso) {
        const pills = resolvePillsForEvent_([], deployment);
        milestones.push(buildMilestoneObject_(deployment, iso, pills, depType, deploymentContacts));
      }
    }
    return milestones;
  }

  if (eligibleProducts.length === 0) return milestones;

  const byDate = {};
  eligibleProducts.forEach(function(item) {
    const iso = toIso(item.computed);
    if (!iso) return;
    if (!byDate[iso]) byDate[iso] = [];
    byDate[iso].push(item.product);
  });

  Object.keys(byDate).forEach(function(iso) {
    const productsOnDate = byDate[iso];
    const pills = resolvePillsForEvent_(productsOnDate, deployment);
    milestones.push(buildMilestoneObject_(deployment, iso, pills, depType, deploymentContacts));
  });

  return milestones;
}

/**
 * Groups product rows by Deployment__c Id.
 * @param {Array<Object<string, *>>} products
 * @returns {Object<string, Array<Object<string, *>>>}
 */
function groupProductsByDeployment_(products) {
  const map = {};
  products.forEach(function(product) {
    const depId = String(product['Deployment__c'] || '').trim();
    if (!depId) return;
    if (!map[depId]) map[depId] = [];
    map[depId].push(product);
  });
  return map;
}

/**
 * Groups contact rows by Deployment__c Id (§7.2).
 * @param {Array<Object<string, *>>} contacts
 * @returns {Object<string, Array<{name:string,email:string,role:string}>>}
 */
function groupContactsByDeployment_(contacts) {
  const map = {};
  contacts.forEach(function(row) {
    const depId = String(row['Deployment__c'] || '').trim();
    if (!depId) return;
    if (!map[depId]) map[depId] = [];
    map[depId].push({
      name: String(row['Contact__r.Name'] || '').trim(),
      email: String(row['Contact__r.Email'] || '').trim(),
      role: String(row['Contact_Role__c'] || '').trim(),
    });
  });
  Object.keys(map).forEach(function(depId) {
    map[depId].sort(function(a, b) { return a.role.localeCompare(b.role); });
  });
  return map;
}

/**
 * Builds all milestone events from sheet data (no time-window filter).
 * @returns {Array<Object>}
 */
function buildMilestones_() {
  Logger.log('buildMilestones_: start');
  const deployments = readDeployments_();
  const products = readProducts_();
  const contacts = readContacts_();
  const productsByDep = groupProductsByDeployment_(products);
  const contactsByDep = groupContactsByDeployment_(contacts);
  const all = [];

  deployments.forEach(function(deployment) {
    const depId = String(deployment['Id'] || '').trim();
    const childProducts = productsByDep[depId] || [];
    if (!qualifies_(deployment, childProducts)) return;

    const depContacts = contactsByDep[depId] || [];
    const events = buildMilestonesForDeployment_(deployment, childProducts, depContacts);
    events.forEach(function(m) { all.push(m); });
  });

  all.sort(function(a, b) {
    if (a.goLiveDate < b.goLiveDate) return -1;
    if (a.goLiveDate > b.goLiveDate) return 1;
    return a.customerName.localeCompare(b.customerName);
  });

  Logger.log('buildMilestones_: built ' + all.length + ' events');
  return all;
}

/**
 * Returns today's date as yyyy-MM-dd in script timezone.
 * @returns {string}
 */
function getTodayIso_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/**
 * Returns the upper bound (today + WINDOW_MONTHS) as yyyy-MM-dd.
 * @returns {string}
 */
function getWindowEndIso_() {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth() + WINDOW_MONTHS, today.getDate());
  return Utilities.formatDate(end, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/**
 * Filters milestones to the server-side 6-month window (§6).
 * @param {Array<Object>} milestones
 * @returns {Array<Object>}
 */
function filterMilestonesToWindow_(milestones) {
  const todayIso = getTodayIso_();
  const endIso = getWindowEndIso_();
  return milestones.filter(function(m) {
    return m.goLiveDate >= todayIso && m.goLiveDate <= endIso;
  });
}

/**
 * Public subset of FIELD_REGISTRY for client rendering.
 * @returns {Array<Object>}
 */
function getPublicFieldRegistry_() {
  return FIELD_REGISTRY.map(function(f) {
    return {
      key: f.key,
      label: f.label,
      inCard: f.inCard || false,
      optional: f.optional || false,
      export: f.export || false,
    };
  });
}

/**
 * Inclusion diagnostics for self-test (§4, §14).
 * @returns {Object}
 */
function getInclusionDiagnostics_() {
  const deployments = readDeployments_();
  const products = readProducts_();
  const productsByDep = groupProductsByDeployment_(products);

  let initial = 0;
  let specInitial = 0;
  let subsequent = 0;
  let excludedSubsequent = 0;
  let studentExcluded = 0;
  let qualifying = 0;
  const badSubsequent = [];

  deployments.forEach(function(deployment) {
    const depId = String(deployment['Id'] || '').trim();
    const childProducts = productsByDep[depId] || [];
    const type = String(deployment['Deployment_Type__c'] || '').trim();
    const status = String(deployment['Overall_Status__c'] || '').trim();

    if (status !== 'Active') return;

    if (isStudentDeployment_(deployment, childProducts)) {
      studentExcluded++;
      return;
    }

    if (type === TYPE_SUBSEQUENT) {
      const hasFn = hasTargetFunction_(childProducts);
      const hasName = nameHasMajorProduct_(deployment);
      if (!hasFn && !hasName) {
        excludedSubsequent++;
        return;
      }
    }

    if (!qualifies_(deployment, childProducts)) return;

    qualifying++;
    if (type === TYPE_INITIAL) initial++;
    else if (type === TYPE_SPEC_INITIAL) specInitial++;
    else if (type === TYPE_SUBSEQUENT) subsequent++;
    else badSubsequent.push({ id: depId, type: type });
  });

  return {
    qualifying: qualifying,
    initial: initial,
    specInitial: specInitial,
    subsequent: subsequent,
    excludedSubsequent: excludedSubsequent,
    studentExcluded: studentExcluded,
    badSubsequent: badSubsequent,
  };
}

/**
 * Finds a qualifying deployment with at least one contact for self-test.
 * @returns {{depId:string, contactCount:number}|null}
 */
function findSampleDeploymentWithContacts_() {
  const deployments = readDeployments_();
  const products = readProducts_();
  const contacts = readContacts_();
  const productsByDep = groupProductsByDeployment_(products);
  const contactsByDep = groupContactsByDeployment_(contacts);

  for (let i = 0; i < deployments.length; i++) {
    const dep = deployments[i];
    const depId = String(dep['Id'] || '').trim();
    const childProducts = productsByDep[depId] || [];
    if (!qualifies_(dep, childProducts)) continue;
    const depContacts = contactsByDep[depId] || [];
    if (depContacts.length > 0) {
      return { depId: depId, contactCount: depContacts.length, contacts: depContacts };
    }
  }
  return null;
}
