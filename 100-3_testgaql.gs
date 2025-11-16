/**
 * Public test function to verify the GAQL cascade for a specific CID.
 * FIX: Splits Performance query into "Universal" and "Competitive" to avoid zero-row errors.
 */
function testGAQLPerformanceQuery() {

  // --- 1. LOCAL CONSTANTS ---
  const DATE_PLACEHOLDER_START = 'YYYY-MM-DD_START';
  const DATE_PLACEHOLDER_END = 'YYYY-MM-DD_END';
  
  // ALL Types (For Cost, Conversions, Clicks)
  const CAMPAIGN_TYPES_UNIVERSAL = "'SEARCH', 'DISPLAY', 'VIDEO', 'PERFORMANCE_MAX', 'DEMAND_GEN'";
  
  // IS Types (Search, Display, PMax - specific metrics only)
  // Note: 'search_impression_share_lost_budget' is widely supported for Search/Display. 
  // PMax supports 'search_impression_share' but often not the 'lost' breakdown in the same way.
  const CAMPAIGN_TYPES_COMPETITIVE = "'SEARCH', 'DISPLAY', 'PERFORMANCE_MAX'";

  const QUERY_0_CURRENCY = `SELECT customer.currency_code FROM customer`;

  // QUERY 1A: UNIVERSAL FINANCIALS (Safe for ALL types)
  // Removing IS metrics ensures this returns rows for Video/Demand Gen
  const QUERY_1A_FINANCIALS = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.advertising_channel_type,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.clicks,
      segments.date
    FROM
      campaign
    WHERE
      campaign.status = 'ENABLED' 
      AND campaign.advertising_channel_type IN (${CAMPAIGN_TYPES_UNIVERSAL})
      AND segments.date BETWEEN '${DATE_PLACEHOLDER_START}' AND '${DATE_PLACEHOLDER_END}'
  `;

  // QUERY 1B: COMPETITIVE METRICS (Safe for Search/Display/PMax)
  const QUERY_1B_COMPETITIVE = `
    SELECT
      campaign.id,
      metrics.search_impression_share,
      metrics.search_impression_share_lost_budget,
      metrics.search_impression_share_lost_rank,
      segments.date
    FROM
      campaign
    WHERE
      campaign.status = 'ENABLED' 
      AND campaign.advertising_channel_type IN (${CAMPAIGN_TYPES_COMPETITIVE})
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
      AND campaign.advertising_channel_type IN (${CAMPAIGN_TYPES_UNIVERSAL})
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

  // --- 2. LOCAL HELPERS (Fixed Timezone & Execution) ---
  
  const getLocal7DayRange = () => {
    let timeZone = "Europe/Dublin";
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        if (ss) timeZone = ss.getSpreadsheetTimeZone();
        else timeZone = Session.getScriptTimeZone() || "Europe/Dublin";
    } catch (e) {
        Logger.log("Using default timezone: " + timeZone);
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
  
  const TEST_CID_RAW = '6652886860'; 
  Logger.log(`\n=== STARTING GAQL TEST FOR CID: ${TEST_CID_RAW} ===`);

  try {
    // Step A: CID Conversion
    let apiCid;
    const currentCidTrimmed = String(TEST_CID_RAW).trim();
    const externalIds = InternalAdsApp.getExternalCustomerIds([currentCidTrimmed]); 
    
    if (externalIds && externalIds[currentCidTrimmed]) {
        apiCid = externalIds[currentCidTrimmed].replace(/-/g, '');
    } else {
        throw new Error(`CID Lookup Error: Invalid CID or No Access for ${TEST_CID_RAW}.`);
    }
    
    const dateRange = getLocal7DayRange();
    Logger.log(`> Date Range: ${dateRange.startDateStr} to ${dateRange.endDateStr}`);
    
    // --- RUN QUERIES ---
    
    // Q0: Currency
    let q0 = executeLocalQuery(apiCid, QUERY_0_CURRENCY, null);
    Logger.log(`\n[Q0 Currency] Code: ${q0.results?.[0]?.customer?.currencyCode || 'Unknown'}`);

    // Q1A: Financials (This SHOULD return rows now)
    Logger.log('\n[Q1A Financials] Fetching Universal Data...');
    let q1a = executeLocalQuery(apiCid, QUERY_1A_FINANCIALS, dateRange);
    const q1aCount = q1a.results?.length || 0;
    Logger.log(`> Rows Returned: ${q1aCount}`);
    if (q1aCount > 0) {
       const row = q1a.results[0];
       Logger.log(`> Sample: ${row.campaign.name} (${row.campaign.advertisingChannelType}) | Cost: ${row.metrics.costMicros} | Conv: ${row.metrics.conversions}`);
    } else {
       Logger.log(`> WARNING: 0 rows. This account truly has NO active spend in this period.`);
    }

    // Q1B: Competitive (IS)
    Logger.log('\n[Q1B Competitive] Fetching IS Data...');
    let q1b = executeLocalQuery(apiCid, QUERY_1B_COMPETITIVE, dateRange);
    Logger.log(`> Rows Returned: ${q1b.results?.length || 0}`);
    if (q1b.results?.length > 0) {
       const row = q1b.results[0];
       Logger.log(`> Sample IS Data: ${row.campaign.id} | Search IS: ${row.metrics.searchImpressionShare}`);
    }

    // Q2: Targets
    Logger.log('\n[Q2 Targets] Fetching...');
    let q2 = executeLocalQuery(apiCid, QUERY_2_TARGETS, null);
    Logger.log(`> Rows Returned: ${q2.results?.length || 0}`);

    // Q4: Recommendations
    Logger.log('\n[Q4 Recommendations] Fetching...');
    let q4 = executeLocalQuery(apiCid, QUERY_4_RECOMMENDATIONS, null);
    Logger.log(`> Rows Returned: ${q4.results?.length || 0}`);
    if (q4.results?.length > 0) {
       const rec = q4.results[0].campaignBudgetRecommendation.budgetOptions;
       let minRec = Math.min(...rec.map(o => parseFloat(o.recommendedBudgetAmountMicros)));
       Logger.log(`> Sample Rec: ${minRec} micros`);
    }

    Logger.log(`\n=== TEST COMPLETED ===`);

  } catch (e) {
    Logger.log(`\n!!! FATAL ERROR !!!`);
    Logger.log(`${e.message}`);
    Logger.log(e.stack);
  }
}