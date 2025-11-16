/**
 * Public test function to verify the GAQL cascade for a specific CID.
 * Fixed to handle missing Spreadsheet context safely by falling back to Session or default timezone.
 */
function testGAQLPerformanceQuery() {

  // --- 1. LOCAL CONSTANTS ---
  const DATE_PLACEHOLDER_START = 'YYYY-MM-DD_START';
  const DATE_PLACEHOLDER_END = 'YYYY-MM-DD_END';
  const CAMPAIGN_TYPES_FILTER = "'SEARCH', 'DISPLAY', 'VIDEO', 'PERFORMANCE_MAX', 'DEMAND_GEN'";

  const QUERY_0_CURRENCY = `SELECT customer.currency_code FROM customer`;

  const QUERY_1_PERFORMANCE = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.advertising_channel_type,
      metrics.cost_micros,
      metrics.conversions,
      metrics.search_impression_share,
      metrics.search_impression_share_lost_budget,
      segments.date
    FROM
      campaign
    WHERE
      campaign.status = 'ENABLED' 
      AND campaign.advertising_channel_type IN (${CAMPAIGN_TYPES_FILTER})
      AND segments.date BETWEEN '${DATE_PLACEHOLDER_START}' AND '${DATE_PLACEHOLDER_END}'
  `;

  const QUERY_2_TARGETS = `
    SELECT
      campaign.id,
      campaign.target_cpa.target_cpa_micros,
      campaign.target_roas.target_roas
    FROM
      campaign
    WHERE
      campaign.status = 'ENABLED' 
      AND campaign.advertising_channel_type IN (${CAMPAIGN_TYPES_FILTER})
      AND campaign.bidding_strategy_type IN ('TARGET_CPA', 'TARGET_ROAS', 'MAXIMIZE_CONVERSION_VALUE', 'MAXIMIZE_CONVERSIONS')
  `;

  const QUERY_4_RECOMMENDATIONS = `
    SELECT
      recommendation.campaign,
      recommendation.campaign_budget_recommendation.budget_options
    FROM
      recommendation
    WHERE
      recommendation.type = 'CAMPAIGN_BUDGET'
  `;

  // --- 2. LOCAL HELPERS (FIXED TIMEZONE LOGIC) ---
  
  // Helper: Get Date Range (Robust Timezone Handling)
  const getLocal7DayRange = () => {
    let timeZone = "Europe/Dublin"; // Default fallback from appsscript.json
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        if (ss) {
            timeZone = ss.getSpreadsheetTimeZone();
        } else {
            // If run from editor without active sheet, use script/session timezone
            timeZone = Session.getScriptTimeZone() || "Europe/Dublin";
            Logger.log("Notice: No Active Spreadsheet. Using Session/Default Timezone: " + timeZone);
        }
    } catch (e) {
        Logger.log("Warning: Timezone detection failed. Using default Europe/Dublin.");
    }

    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 1); 
    const startDate = new Date(endDate.getTime());
    startDate.setDate(endDate.getDate() - 6); 
    
    return {
        startDateStr: Utilities.formatDate(startDate, timeZone, 'yyyy-MM-dd'),
        endDateStr: Utilities.formatDate(endDate, timeZone, 'yyyy-MM-dd')
    };
  };

  // Helper: Execute Query
  const executeLocalQuery = (clientId, query, dateRange) => {
    let finalQuery = query;
    if (dateRange) {
      finalQuery = finalQuery.replace(DATE_PLACEHOLDER_START, dateRange.startDateStr);
      finalQuery = finalQuery.replace(DATE_PLACEHOLDER_END, dateRange.endDateStr);
    }
    const request = { customerId: clientId, query: finalQuery };
    // Uses the GLOBAL InternalAdsApp object
    const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
    return JSON.parse(responseJson);
  };

  // --- 3. TEST EXECUTION LOGIC ---
  
  const TEST_CID_RAW = '6652886860'; // The internal CID to test
  Logger.log(`\n=== STARTING GAQL TEST FOR CID: ${TEST_CID_RAW} ===`);

  try {
    // Step A: CID Conversion
    let apiCid;
    const currentCidTrimmed = String(TEST_CID_RAW).trim();
    // Using GLOBAL InternalAdsApp
    const externalIds = InternalAdsApp.getExternalCustomerIds([currentCidTrimmed]); 
    
    if (externalIds && externalIds[currentCidTrimmed]) {
        apiCid = externalIds[currentCidTrimmed].replace(/-/g, '');
    } else {
        throw new Error(`CID Lookup Error: Invalid CID or No Access via InternalAdsApp for ${TEST_CID_RAW}.`);
    }
    Logger.log(`> API CID Resolved: ${apiCid}`);

    // Step B: Date Calculation
    const dateRange = getLocal7DayRange();
    Logger.log(`> Date Range: ${dateRange.startDateStr} to ${dateRange.endDateStr}`);
    
    // Step C: Run Queries
    
    // Q0
    let q0 = executeLocalQuery(apiCid, QUERY_0_CURRENCY, null);
    Logger.log(`\n[Q0 Currency] Code: ${q0.results?.[0]?.customer?.currencyCode || 'Unknown'}`);

    // Q1
    Logger.log('\n[Q1 Performance] Fetching...');
    let q1 = executeLocalQuery(apiCid, QUERY_1_PERFORMANCE, dateRange);
    const q1Count = q1.results?.length || 0;
    Logger.log(`> Rows Returned: ${q1Count}`);
    if (q1Count > 0) {
       const row = q1.results[0];
       Logger.log(`> Sample: ${row.campaign.name} | Cost: ${row.metrics.costMicros} | Conv: ${row.metrics.conversions}`);
    } else {
       Logger.log(`> NOTE: 0 rows means no active spend/metrics in this date range.`);
    }

    // Q2
    Logger.log('\n[Q2 Targets] Fetching...');
    let q2 = executeLocalQuery(apiCid, QUERY_2_TARGETS, null);
    Logger.log(`> Rows Returned: ${q2.results?.length || 0}`);

    // Q4
    Logger.log('\n[Q4 Recommendations] Fetching...');
    let q4 = executeLocalQuery(apiCid, QUERY_4_RECOMMENDATIONS, null);
    const q4Count = q4.results?.length || 0;
    Logger.log(`> Rows Returned: ${q4Count}`);
    if (q4Count > 0) {
       const rec = q4.results[0].campaignBudgetRecommendation.budgetOptions;
       Logger.log(`> Sample: Found ${rec.length} budget options for a campaign.`);
    }

    Logger.log(`\n=== TEST COMPLETED ===`);

  } catch (e) {
    Logger.log(`\n!!! FATAL ERROR !!!`);
    Logger.log(`${e.message}`);
    Logger.log(e.stack);
  }
}