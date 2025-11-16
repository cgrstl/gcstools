/**
 * Public test function to verify the GAQL cascade for a specific CID.
 * FIX: Implements robust segmentation of queries to avoid API metric incompatibility,
 * ensuring data is retrieved for all segments (Search, PMax, Financials).
 */
function testGAQLPerformanceQuery() {

  // --- 1. LOCAL CONSTANTS ---
  const DATE_PLACEHOLDER_START = 'YYYY-MM-DD_START';
  const DATE_PLACEHOLDER_END = 'YYYY-MM-DD_END';
  
  const QUERY_0_CURRENCY = `SELECT customer.currency_code FROM customer`;

  // Q1: UNIVERSAL FINANCIALS (All 5 Types)
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

  // Q3: COMPETITIVE METRICS (Search & PMax ONLY for Search IS metrics)
  // This query respects the API's limitation by ONLY including compatible campaign types.
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

  // Q4: RECOMMENDATIONS (Specific Budget Recommendation Type)
  const QUERY_4_RECS = `
    SELECT
      recommendation.campaign,
      recommendation.campaign_budget_recommendation.budget_options
    FROM
      recommendation
    WHERE
      recommendation.type = 'CAMPAIGN_BUDGET'
  `;

  // --- 2. LOCAL HELPERS (Relying on Global Definitions) ---
  
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

  // --- 3. TEST EXECUTION ---

  const TEST_CID_RAW = '6652886860'; 

  Logger.log(`\n=== DEBUG RUN START: CID ${TEST_CID_RAW} ===`);

  try {
    const cidTrimmed = String(TEST_CID_RAW).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    if (!extIds || !extIds[cidTrimmed]) throw new Error("CID Lookup Failed");
    const apiCid = extIds[cidTrimmed].replace(/-/g, '');
    
    const dateRange = getLocal7DayRange();
    Logger.log(`> Date Range: ${dateRange.startDateStr} to ${dateRange.endDateStr}`);

    // Q0: Currency
    executeLocalQuery("Q0_CURRENCY", apiCid, QUERY_0_CURRENCY, null);

    // Q1: FINANCIALS (Universal - Should return 147 rows + financial data)
    Logger.log('\n[Q1: FINANCIALS] Fetching...');
    let q1 = executeLocalQuery("Q1_FINANCIALS", apiCid, QUERY_1_FINANCIALS, dateRange);
    if (q1.length > 0) {
       Logger.log("--- Q1: Financial Sample (First 3 Rows) ---");
       const count = Math.min(q1.length, 3);
       for(let i=0; i<count; i++) {
         const r = q1[i];
         Logger.log(`> Row ${i+1}: [${r.campaign.advertisingChannelType}] "${r.campaign.name}" | Cost: ${r.metrics.costMicros} | Conv: ${r.metrics.conversions}`);
       }
    } else {
       Logger.log(`> WARNING: 0 rows. No spend in date range.`);
    }

    // Q3: COMPETITIVE (Search/PMax IS - Should now work)
    Logger.log('\n[Q3: SEARCH/PMAX IS] Fetching...');
    let q3 = executeLocalQuery("Q3_SEARCH_PMAX_IS", apiCid, QUERY_3_SEARCH_PMAX_IS, dateRange);
    if (q3.length > 0) {
       Logger.log("--- Q3: Competitive Sample ---");
       Logger.log(`> Sample: "${q3[0].campaign.name}" | Search IS: ${q3[0].metrics.searchImpressionShare} | Lost Budget: ${q3[0].metrics.searchImpressionShareLostBudget}`);
    } else {
       Logger.log("> NOTE: 0 rows returned for IS. If Q1 found active Search campaigns, the issue is likely low volume/IS below reporting threshold.");
    }

    // Q4: RECOMMENDATIONS (Check specific type)
    Logger.log('\n[Q4: RECOMMENDATIONS] Fetching...');
    let q4 = executeLocalQuery(apiCid, QUERY_4_RECS, null);
    
    if (q4.length > 0) {
       Logger.log(`> Found ${q4.length} total recommendations.`);
       const rec = q4[0].campaignBudgetRecommendation.budgetOptions;
       let minRec = Math.min(...rec.map(o => parseFloat(o.recommendedBudgetAmountMicros)));
       Logger.log(`> Sample Rec: Min Recommended Budget (Micros): ${minRec}`);
    } else {
       Logger.log(`> No Budget Recommendations found. (The suggestion you see is likely an Optimization Score suggestion, not a GAQL Recommendation type.)`);
    }

    Logger.log(`\n=== TEST COMPLETED ===`);

  } catch (e) {
    Logger.log(`\nFATAL EXCEPTION: ${e.message}\n${e.stack}`);
  }
}