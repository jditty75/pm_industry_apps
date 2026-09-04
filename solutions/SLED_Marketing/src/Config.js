const SHEET_DEPLOYMENTS = 'SFDC_SLED_Deployments';
const SHEET_PRODUCTS    = 'SFDC_SLED_DeploymentProducts';
const SHEET_CONTACTS    = 'SFDC_Contacts';

/**
 * Returns the source spreadsheet (bound or via Script Property).
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SOURCE_SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
}

// Deployment_Type__c values (confirmed)
const TYPE_INITIAL      = 'Initial Deployment';
const TYPE_SPEC_INITIAL = 'Specialized - Initial Deployment';
const TYPE_SUBSEQUENT   = 'Subsequent Deployment';
const INITIAL_TYPES     = [TYPE_INITIAL];

// Student exclusion (Revision 4)
const STUDENT_AREAS     = ['Student'];
const STUDENT_FUNCTIONS = [
  'Student Records', 'Student Finance', 'Financial Aid', 'Admissions',
  'Course Catalog', 'Academic Advising',
];
const STUDENT_NAME_REGEX = /student/i;

// Inclusion gate for Subsequent/Phase X (§4)
const TARGET_FUNCTIONS = ['Core HR', 'Financial Accounting', 'US Payroll'];
const NAME_MAJOR_REGEX = /\b(HCM|FIN|Financials?|PAY|Payroll)\b/i;

// Pill enrichment — cosmetic only (§5.4)
const FUNCTION_PILL = {
  'Core HR': 'HCM',
  'Financial Accounting': 'Financials',
  'US Payroll': 'Payroll',
};
const SIBLING_FUNCTION_PILL = {
  'Core Human Capital Management': 'HCM',
  'Payroll for the United States': 'Payroll',
  'General Ledger': 'Financials',
  'Accounts Payable': 'Financials',
  'Accounts Receivable': 'Financials',
  'Accounting and Finance': 'Financials',
};
const AREA_PILL = {
  'Human Capital Management': 'HCM',
  'Core HCM': 'HCM',
  'Financial Management': 'Financials',
  'Financials': 'Financials',
  'Payroll': 'Payroll',
  'Student': 'Student',
};
const PILL_ORDER = ['HCM', 'Financials', 'Payroll', 'Student', 'Core'];
const GENERIC_PILL = 'Core';

// Time window
const WINDOW_MONTHS = 6;
const DEFAULT_RANGE = 'd30';

const INTERNAL_PARTNER = 'workday professional services';

const FIELD_REGISTRY = [
  { key:'customerName', header:'Customer__r.Name', label:'Customer', type:'text', inCard:true, export:true, searchable:true },
  { key:'deploymentName', header:'Name', label:'Deployment Name', type:'text', inCard:true, export:true, searchable:true },
  { key:'industry', header:'Customer__r.Industry', label:'Industry', type:'text', inCard:true, export:true },
  { key:'region', header:'Customer__r.PS_Region_New__c', label:'Region', type:'text', export:true },
  { key:'subRegion', header:'Customer__r.PS_Sub_Region__c', label:'Sub-Region', type:'text', export:true },

  { key:'csm', header:'Customer__r.Customer_Success_Manager__r', label:'CSM', type:'person', inCard:true, export:true, optional:true },
  { key:'emdm', combine:['Workday_Engagement_Manager__r','Delivery_Assurance_Manager__r'], label:'EM/DM', type:'person', inCard:true, export:true, optional:true },
  { key:'ae', header:'Customer__r.Owner', label:'AE', type:'person', inCard:true, export:true },
  { key:'implementationPartner', header:'Deployment_Partner_Name__c', label:'Impl. Partner', type:'text', inCard:true, export:true, optional:true },
  { key:'managingPartner', header:'Customer__r.Managing_Partner__r', label:'Managing Partner', type:'person', inCard:true, export:true, optional:true },
];
