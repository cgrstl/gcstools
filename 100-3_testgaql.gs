/**
 * Enhanced Debug Function to verify GAQL data retrieval.
 * - Logs first 3 rows of Financials.
 * - Pulls ALL Recommendation types to find the "missing" one.
 */
function testGAQLPerformanceQuery() {

  // --- CONSTANTS ---
  const DATE_PLACEHOLDER_START = 'YYYY-MM-DD_START';
  const DATE_PLACEHOLDER_END = 'YYYY-MM-DD_END';
  
  const QUERY_0_CURRENCY = `SELECT customer.currency_code FROM customer`;

  // Q1: UNIVERSAL FINANCIALS
  const QUERY_1_FINANCIALS = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.advertising_channel_type,
      metrics.cost_micros,
      metrics.conversions,
      metrics.clicks,
      segments.date
    FROM
      campaign
    WHERE
      campaign.status = 'ENABLED' 
      AND campaign.advertising_channel_type IN ('SEARCH', 'DISPLAY', 'VIDEO', 'PERFORMANCE_MAX', 'DEMAND_GEN')
      AND segments.date BETWEEN '${DATE_PLACEHOLDER_START}' AND '${DATE_PLACEHOLDER_END}'
  `;

  // Q3: COMPETITIVE (Search & PMax)
  const QUERY_3_SEARCH_PMAX_IS = `
    SELECT
      campaign.id,
      campaign.name,
      metrics.search_impression_share,
      metrics.search_impression_share_lost_budget,
      metrics.search_impression_share_lost_rank,
      segments.date
    FROM
      campaign
    WHERE
      campaign.status = 'ENABLED' 
      AND campaign.advertising_channel_type IN ('SEARCH', 'PERFORMANCE_MAX')
      AND segments.date BETWEEN '${DATE_PLACEHOLDER_START}' AND '${DATE_PLACEHOLDER_END}'
  `;

  // Q4: ALL RECOMMENDATIONS (Broadened for Debugging)
  // Removing the type filter to see EVERYTHING returned by the API
  const QUERY_4_DEBUG_ALL_RECS = `
    SELECT
      recommendation.resource_name,
      recommendation.type,
      recommendation.campaign,
      recommendation.campaign_budget_recommendation.budget_options
    FROM
      recommendation
    LIMIT 100
  `;

  // --- HELPERS ---
  
  const getLocal7DayRange = () => {
    let timeZone = "Europe/Dublin"; 
    try {
       const ss = SpreadsheetApp.getActiveSpreadsheet();
       if (ss) timeZone = ss.getSpreadsheetTimeZone();
       else timeZone = Session.getScriptTimeZone() || "Europe/Dublin";
    } catch (e) { }

    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 1); 
    const startDate = new Date(endDate.getTime());
    startDate.setDate(endDate.getDate() - 6); 
    
    return {
        startDateStr: Utilities.formatDate(startDate, timeZone, 'yyyy-MM-dd'),
        endDateStr: Utilities.formatDate(endDate, timeZone, 'yyyy-MM-dd')
    };
  };

  const executeLocalQuery = (label, clientId, queryTemplate, dateRange) => {
    Logger.log(`\n--- EXEC ${label} ---`);
    let finalQuery = queryTemplate;
    if (dateRange) {
      finalQuery = finalQuery.replace(DATE_PLACEHOLDER_START, dateRange.startDateStr);
      finalQuery = finalQuery.replace(DATE_PLACEHOLDER_END, dateRange.endDateStr);
    }
    
    try {
        const request = { customerId: clientId, query: finalQuery };
        const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
        const response = JSON.parse(responseJson);
        const results = response.results || [];
        Logger.log(`Result: ${results.length} rows.`);
        return results;
    } catch (e) {
        Logger.log(`ERROR in ${label}: ${e.message}`);
        return [];
    }
  };

  // --- MAIN TEST ---

  const TEST_CID_RAW = '6652886860'; 

  Logger.log(`\n=== DEBUG RUN START: CID ${TEST_CID_RAW} ===`);

  try {
    const cidTrimmed = String(TEST_CID_RAW).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    if (!extIds || !extIds[cidTrimmed]) throw new Error("CID Lookup Failed");
    const apiCid = extIds[cidTrimmed].replace(/-/g, '');
    
    const dateRange = getLocal7DayRange();
    Logger.log(`Date Range: ${dateRange.startDateStr} -> ${dateRange.endDateStr}`);

    // 1. FINANCIALS (Detailed Log)
    let q1 = executeLocalQuery("Q1_FINANCIALS", apiCid, QUERY_1_FINANCIALS, dateRange);
    if (q1.length > 0) {
       // LOGGING FIRST 3 ROWS AS REQUESTED
       const count = Math.min(q1.length, 3);
       for(let i=0; i<count; i++) {
         const r = q1[i];
         Logger.log(`> Row ${i+1}: [${r.campaign.advertisingChannelType}] "${r.campaign.name}" | Cost: ${r.metrics.costMicros} | Conv: ${r.metrics.conversions}`);
       }
    } else {
       Logger.log(`> WARNING: 0 rows. No spend in date range.`);
    }

    // 2. COMPETITIVE
    let q3 = executeLocalQuery("Q3_SEARCH_PMAX_IS", apiCid, QUERY_3_SEARCH_PMAX_IS, dateRange);
    if (q3.length === 0) {
      Logger.log("> NOTE: 0 rows for IS. This is common if campaigns have low volume or are not Search/PMax.");
    } else {
      Logger.log(`> Sample IS: ${q3[0].metrics.searchImpressionShare}`);
    }

    // 3. RECOMMENDATIONS (ALL TYPES)
    let q4 = executeLocalQuery("Q4_DEBUG_ALL_RECS", apiCid, QUERY_4_DEBUG_ALL_RECS, null);
    
    if (q4.length > 0) {
       Logger.log(`> Found ${q4.length} total recommendations. Listing Types found:`);
       q4.forEach((r, index) => {
           // Log specific details to identify the missing one
           let details = "";
           if (r.recommendation.campaignBudgetRecommendation) {
               details = ` (BUDGET REC! Options: ${r.recommendation.campaignBudgetRecommendation.budgetOptions.length})`;
           }
           Logger.log(`  #${index+1}: Type=${r.recommendation.type} | Campaign=${r.recommendation.campaign} ${details}`);
       });
    } else {
       Logger.log(`> ABSOLUTELY NO recommendations found via API. If UI shows them, they might be 'Optimization Score' suggestions not exposed as 'Recommendations' or account-level opportunities.`);
    }

    Logger.log(`\n=== TEST COMPLETED ===`);

  } catch (e) {
    Logger.log(`\nFATAL EXCEPTION: ${e.message}`);
  }
}