/**
 * Final Debug Function to verify GAQL data retrieval.
 * FIX: Splits Competitive queries by Campaign Type to avoid metric incompatibility.
 * FIX: Broadens Recommendation query to find the missing Demand Gen recommendation.
 */
function testGAQLPerformanceQuery() {

  // --- CONSTANTS ---
  const DATE_PLACEHOLDER_START = 'YYYY-MM-DD_START';
  const DATE_PLACEHOLDER_END = 'YYYY-MM-DD_END';
  const QUERY_0_CURRENCY = `SELECT customer.currency_code FROM customer`;

  // Q1: UNIVERSAL FINANCIALS (All Types) - working
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

  // Q3A: SEARCH IS (Search Only) - Supports Lost Budget/Rank
  const QUERY_3A_SEARCH_IS = `
    SELECT
      campaign.id,
      campaign.name,
      metrics.search_impression_share,
      metrics.search_impression_share_lost_budget,
      metrics.search_impression_share_lost_rank
    FROM
      campaign
    WHERE
      campaign.status = 'ENABLED' 
      AND campaign.advertising_channel_type = 'SEARCH'
      AND segments.date BETWEEN '${DATE_PLACEHOLDER_START}' AND '${DATE_PLACEHOLDER_END}'
  `;

  // Q3B: DISPLAY IS (Display Only) - Supports Content IS
  const QUERY_3B_DISPLAY_IS = `
    SELECT
      campaign.id,
      campaign.name,
      metrics.content_impression_share,
      metrics.content_budget_lost_impression_share,
      metrics.content_rank_lost_impression_share
    FROM
      campaign
    WHERE
      campaign.status = 'ENABLED' 
      AND campaign.advertising_channel_type = 'DISPLAY'
      AND segments.date BETWEEN '${DATE_PLACEHOLDER_START}' AND '${DATE_PLACEHOLDER_END}'
  `;

  // Q3C: PMAX IS (PMax Only) - Supports ONLY Search IS (No Lost Budget/Rank)
  const QUERY_3C_PMAX_IS = `
    SELECT
      campaign.id,
      campaign.name,
      metrics.search_impression_share
    FROM
      campaign
    WHERE
      campaign.status = 'ENABLED' 
      AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'
      AND segments.date BETWEEN '${DATE_PLACEHOLDER_START}' AND '${DATE_PLACEHOLDER_END}'
  `;

  // Q4: RECOMMENDATIONS (Broadened for Debugging)
  // Removed 'WHERE type=CAMPAIGN_BUDGET' to see ALL recs and find the Demand Gen one
  const QUERY_4_DEBUG_RECS = `
    SELECT
      recommendation.resource_name,
      recommendation.type,
      recommendation.campaign,
      recommendation.impact,
      recommendation.campaign_budget_recommendation.budget_options
    FROM
      recommendation
    LIMIT 50
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

    // 1. FINANCIALS
    executeLocalQuery("Q1_FINANCIALS", apiCid, QUERY_1_FINANCIALS, dateRange);

    // 2. COMPETITIVE (Split by Type)
    const q3a = executeLocalQuery("Q3A_SEARCH_IS", apiCid, QUERY_3A_SEARCH_IS, dateRange);
    if (q3a.length > 0) Logger.log(`> Sample Search IS: ${q3a[0].metrics.searchImpressionShare} | Lost Budget: ${q3a[0].metrics.searchImpressionShareLostBudget}`);

    const q3b = executeLocalQuery("Q3B_DISPLAY_IS", apiCid, QUERY_3B_DISPLAY_IS, dateRange);
    if (q3b.length > 0) Logger.log(`> Sample Display IS: ${q3b[0].metrics.contentImpressionShare}`);

    const q3c = executeLocalQuery("Q3C_PMAX_IS", apiCid, QUERY_3C_PMAX_IS, dateRange);
    if (q3c.length > 0) Logger.log(`> Sample PMax IS: ${q3c[0].metrics.searchImpressionShare}`);

    // 3. RECOMMENDATIONS (Debug Mode)
    const q4 = executeLocalQuery("Q4_ALL_RECS", apiCid, QUERY_4_DEBUG_RECS, null);
    if (q4.length > 0) {
        Logger.log("--- FOUND RECOMMENDATIONS ---");
        q4.forEach(row => {
            // Log every recommendation type found to identify the Demand Gen one
            Logger.log(`Type: ${row.recommendation.type} | Campaign: ${row.recommendation.campaign}`);
            if (row.recommendation.campaignBudgetRecommendation) {
                Logger.log(`  >> IS BUDGET REC! Options: ${row.recommendation.campaignBudgetRecommendation.budgetOptions.length}`);
            }
        });
    } else {
        Logger.log("No recommendations found via API.");
    }

  } catch (e) {
    Logger.log(`\nFATAL EXCEPTION: ${e.message}\n${e.stack}`);
  }
  
  Logger.log("\n=== DEBUG RUN COMPLETE ===");
}