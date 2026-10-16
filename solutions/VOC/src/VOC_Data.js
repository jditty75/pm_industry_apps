
/**
 * VOC - Unified Salesforce Source Reader
 *
 * Sources:
 *   SLG  - State and Local Government
 *   HENP - Higher Education and Nonprofit
 *   HC   - Healthcare
 *
 * Source access is READ ONLY.
 * No writes are performed to source workbooks.
 */

const VOC_CONFIG = {
  sources: [
    {
      industry: "SLG",
      industryName: "State and Local Government",
      spreadsheetId:
        "1v0wzRYd6CC00usYIGfgIgMI2QiN5FGbcReCPkOUbmhI"
    },
    {
      industry: "HENP",
      industryName: "Higher Education and Nonprofit",
      spreadsheetId:
        "17gzhQiSFJf1mQe8wl8YEySTTMZxbFoq4U4MptzW7SY8"
    },
    {
      industry: "HC",
      industryName: "Healthcare",
      spreadsheetId:
        "12GFRUfdPnqgKR8EilVUHpE1pIvDbb9zlYFtSQjHvDBM"
    }
  ],

  sheets: {
    deployments: "SFDC_Deployments",
    productFunctions: "SFDC_DeploymentProductFunctions"
  },

  fields: {
    deploymentId: "Id",
    childId: "Id",
    childDeploymentId: "Deployment__c"
  }
};


/**
 * Reads a source sheet and returns JavaScript objects.
 *
 * - Ignores fully blank header columns.
 * - Rejects duplicate nonblank headers.
 * - Skips completely empty data rows.
 * - Converts Date objects to ISO strings.
 * - Preserves original Salesforce field names.
 */
function vocReadSheet(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error(
      "Missing sheet '" + sheetName +
      "' in workbook '" + spreadsheet.getName() + "'"
    );
  }

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow === 0 || lastColumn === 0) {
    return [];
  }

  const values = sheet.getRange(
    1, 1, lastRow, lastColumn
  ).getValues();

  const headerRow = values[0];

  // Retain only columns with nonblank headers.
  const columns = [];

  headerRow.forEach((value, index) => {
    const header = String(value ?? "").trim();

    if (header) {
      columns.push({
        header: header,
        index: index
      });
    }
  });

  const headers = columns.map(col => col.header);

  if (new Set(headers).size !== headers.length) {
    throw new Error(
      "Duplicate headers found in sheet: " + sheetName
    );
  }

  if (headers.length === 0) {
    throw new Error(
      "No valid column headers in sheet: " + sheetName
    );
  }

  return values.slice(1)
    .filter(row =>
      columns.some(col => {
        const value = row[col.index];
        return value !== "" &&
          value !== null &&
          value !== undefined;
      })
    )
    .map(row => {
      const record = {};

      columns.forEach(col => {
        const value = row[col.index];

        record[col.header] =
          value instanceof Date
            ? value.toISOString()
            : value;
      });

      return record;
    });
}


/**
 * Loads all three workbooks and their two source sheets.
 *
 * Returns:
 * {
 *   deployments: [],
 *   productFunctions: [],
 *   summary: []
 * }
 */
function vocLoadAllSources() {
  const deployments = [];
  const productFunctions = [];
  const summary = [];

  VOC_CONFIG.sources.forEach(source => {
    console.log(
      "Reading " + source.industry + " workbook..."
    );

    const spreadsheet = SpreadsheetApp.openById(
      source.spreadsheetId
    );

    const parents = vocReadSheet(
      spreadsheet,
      VOC_CONFIG.sheets.deployments
    );

    const children = vocReadSheet(
      spreadsheet,
      VOC_CONFIG.sheets.productFunctions
    );

    // Validate required columns even if a sheet
    // contains zero data rows.
    const required = [
      {
        name: VOC_CONFIG.sheets.deployments,
        fields: [VOC_CONFIG.fields.deploymentId]
      },
      {
        name: VOC_CONFIG.sheets.productFunctions,
        fields: [
          VOC_CONFIG.fields.childId,
          VOC_CONFIG.fields.childDeploymentId
        ]
      }
    ];

    required.forEach(spec => {
      const sheet = spreadsheet.getSheetByName(spec.name);
      const width = sheet.getLastColumn();

      const headers = width
        ? sheet.getRange(1, 1, 1, width)
            .getValues()[0]
            .map(value => String(value ?? "").trim())
        : [];

      spec.fields.forEach(field => {
        if (!headers.includes(field)) {
          throw new Error(
            "Missing required field '" + field +
            "' in " + source.industry +
            " / " + spec.name
          );
        }
      });
    });

    parents.forEach(record => {
      deployments.push({
        ...record,
        _vocIndustry: source.industry,
        _vocIndustryName: source.industryName
      });
    });

    children.forEach(record => {
      productFunctions.push({
        ...record,
        _vocIndustry: source.industry,
        _vocIndustryName: source.industryName
      });
    });

    summary.push({
      industry: source.industry,
      industryName: source.industryName,
      deployments: parents.length,
      productFunctions: children.length
    });
  });

  return {
    deployments,
    productFunctions,
    summary
  };
}


/**
 * Validates the parent-child relationships.
 *
 * Relationship:
 *   Parent.Id = Child.Deployment__c
 *
 * Uses industry + Salesforce ID as a composite key.
 */
function vocValidateRelationships(data) {
  const parentKeys = new Set();
  const childKeys = new Set();

  const duplicateParents = [];
  const duplicateChildren = [];
  const missingParentIds = [];
  const missingChildIds = [];
  const orphanChildren = [];

  const parentIdField = VOC_CONFIG.fields.deploymentId;
  const childIdField = VOC_CONFIG.fields.childId;
  const foreignKeyField =
    VOC_CONFIG.fields.childDeploymentId;

  data.deployments.forEach((parent, index) => {
    const id = String(
      parent[parentIdField] ?? ""
    ).trim();

    if (!id) {
      missingParentIds.push({
        industry: parent._vocIndustry,
        recordIndex: index
      });
      return;
    }

    const key = parent._vocIndustry + ":" + id;

    if (parentKeys.has(key)) {
      duplicateParents.push(key);
    }

    parentKeys.add(key);
  });

  data.productFunctions.forEach((child, index) => {
    const childId = String(
      child[childIdField] ?? ""
    ).trim();

    const deploymentId = String(
      child[foreignKeyField] ?? ""
    ).trim();

    if (!childId) {
      missingChildIds.push({
        industry: child._vocIndustry,
        recordIndex: index
      });
    } else {
      const childKey =
        child._vocIndustry + ":" + childId;

      if (childKeys.has(childKey)) {
        duplicateChildren.push(childKey);
      }

      childKeys.add(childKey);
    }

    const parentKey =
      child._vocIndustry + ":" + deploymentId;

    if (!deploymentId || !parentKeys.has(parentKey)) {
      orphanChildren.push({
        industry: child._vocIndustry,
        childId: childId,
        deploymentId: deploymentId
      });
    }
  });

  return {
    totalDeployments: data.deployments.length,
    totalProductFunctions: data.productFunctions.length,
    duplicateParents,
    duplicateChildren,
    missingParentIds,
    missingChildIds,
    orphanChildren,
    valid:
      duplicateParents.length === 0 &&
      duplicateChildren.length === 0 &&
      missingParentIds.length === 0 &&
      missingChildIds.length === 0 &&
      orphanChildren.length === 0
  };
}


/**
 * Builds an in-memory deployment lookup.
 *
 * Each deployment receives a productFunctions array.
 */
function vocBuildDeploymentIndex(data) {
  const index = new Map();

  data.deployments.forEach(parent => {
    const id = String(parent.Id ?? "").trim();

    if (!id) return;

    const key = parent._vocIndustry + ":" + id;

    if (index.has(key)) {
      throw new Error("Duplicate deployment: " + key);
    }

    index.set(key, {
      ...parent,
      productFunctions: []
    });
  });

  data.productFunctions.forEach(child => {
    const deploymentId = String(
      child.Deployment__c ?? ""
    ).trim();

    const key =
      child._vocIndustry + ":" + deploymentId;

    const parent = index.get(key);

    if (parent) {
      parent.productFunctions.push(child);
    }
  });

  return index;
}


/**
 * Retrieves one deployment and its child records.
 *
 * Example:
 * vocGetDeployment("SLG", "SALESFORCE_DEPLOYMENT_ID");
 */
function vocGetDeployment(industry, deploymentId) {
  const data = vocLoadAllSources();
  const index = vocBuildDeploymentIndex(data);

  const key =
    industry + ":" + String(deploymentId).trim();

  return index.get(key) || null;
}


/**
 * PRIMARY TEST
 *
 * Reads all six sheets and logs:
 * - Parent counts by industry
 * - Child counts by industry
 * - Total records
 * - Relationship validation
 *
 * Does not write to any workbook.
 */
function testVOCSources() {
  console.log("================================");
  console.log("VOC SOURCE CONNECTION TEST");
  console.log("================================");

  const start = Date.now();

  const data = vocLoadAllSources();

  console.log("SOURCE COUNTS");

  data.summary.forEach(source => {
    console.log(
      source.industry +
      " | Deployments: " + source.deployments +
      " | Product Functions: " + source.productFunctions
    );
  });

  console.log("--------------------------------");

  console.log(
    "TOTAL DEPLOYMENTS: " + data.deployments.length
  );

  console.log(
    "TOTAL PRODUCT FUNCTIONS: " +
    data.productFunctions.length
  );

  const validation = vocValidateRelationships(data);

  console.log("--------------------------------");
  console.log("RELATIONSHIP VALIDATION");

  console.log(
    "Duplicate parents: " +
    validation.duplicateParents.length
  );

  console.log(
    "Duplicate children: " +
    validation.duplicateChildren.length
  );

  console.log(
    "Missing parent IDs: " +
    validation.missingParentIds.length
  );

  console.log(
    "Missing child IDs: " +
    validation.missingChildIds.length
  );

  console.log(
    "Orphan children: " +
    validation.orphanChildren.length
  );

  console.log(
    "RELATIONSHIPS VALID: " + validation.valid
  );

  // Log a small diagnostic sample if issues exist.
  if (!validation.valid) {
    console.log(
      "Validation issues (first 10 each): " +
      JSON.stringify({
        duplicateParents:
          validation.duplicateParents.slice(0, 10),
        duplicateChildren:
          validation.duplicateChildren.slice(0, 10),
        missingParentIds:
          validation.missingParentIds.slice(0, 10),
        missingChildIds:
          validation.missingChildIds.slice(0, 10),
        orphanChildren:
          validation.orphanChildren.slice(0, 10)
      })
    );
  }

  console.log("--------------------------------");

  console.log(
    "EXECUTION TIME: " +
    ((Date.now() - start) / 1000).toFixed(2) +
    " seconds"
  );

  console.log("VOC SOURCE TEST COMPLETED");

  return {
    summary: data.summary,
    validation: validation
  };
}

