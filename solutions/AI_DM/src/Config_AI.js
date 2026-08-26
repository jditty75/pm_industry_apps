/**
 * AI Deployment Health App configuration for CoreLib.
 *
 * V3.0-PRODFILTER-P1: enables the global Product Area filter for web tabs.
 * Merge this ui.productFilter block into the live AI APP_CONFIG as needed.
 */

/** @type {AppConfig} */
var APP_CONFIG = {
  appId: 'AI',

  ui: {
    productFilter: {
      enabled: true,
      areas: [
        'Contract Management and Document Intelligence',
        'Workday HiredScore',
        'Workday Paradox'
      ],
      aliases: {
        'Contract Management and Document Intelligence': 'Evisort (Contract Mgmt & DI)',
        'Workday HiredScore': 'HiredScore',
        'Workday Paradox': 'Paradox'
      },
      nameTokens: {
        'Contract Management and Document Intelligence': ['Evisort', 'CLM'],
        'Workday HiredScore': ['HiredScore'],
        'Workday Paradox': ['Paradox']
      }
    }
  }
};
