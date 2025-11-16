/**
 * Final Test: Search IS Metrics + Missed Conversion Calculation.
 * - Targets: SEARCH, PERFORMANCE_MAX, SHOPPING.
 * - Strategy: 7-Day Aggregation (No daily segmentation).
 * - Output: Logs calculation details for every campaign found.
 */
function testSearchISMetrics() {

  const TEST_CID_RAW = '6662487282'; 
  
  // Scoped constants to avoid global conflicts
  const DATE_START_MARKER = 'YYYY-MM-DD_START';
  const DATE_END_MARKER = 'YYYY-MM-DD_END';

  Logger.log(`\n=== STARTING MISSED CONVERSION TEST (CID: ${TEST_CID_RAW}) ===`);

  // --- 1. Local Helpers ---
  
  const getSafeDateRange = () => {
    const timeZone = "Europe/Dublin"; // Default from JSON
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 1); // Yesterday
    const startDate = new Date(endDate.getTime());
    startDate.setDate(endDate.getDate() - 6); // 7 Days ago
    return {
        start: Utilities.formatDate(startDate, timeZone, 'yyyy-MM-dd'),
        end: Utilities.formatDate(endDate, timeZone, 'yyyy-MM-dd')
    };
  };

  const executeLocalQuery = (clientId, query, dateRange) => {
    const finalQuery = query
      .replace(DATE_START_MARKER, dateRange.start)
      .replace(DATE_END_MARKER, dateRange.end);
      
    const request = { customerId: clientId, query: finalQuery };
    // Uses global InternalAdsApp
    const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
    return JSON.parse(responseJson).results || [];
  };

  // --- 2. Execution ---

  try {
    // CID Conversion
    const cidTrimmed = String(TEST_CID_RAW).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    
    let apiCid;
    if (extIds && extIds[cidTrimmed]) {
        apiCid = extIds[cidTrimmed].replace(/-/g, '');
    } else {
        throw new Error(`CID Lookup Failed for ${TEST_CID_RAW}`);
    }
    Logger.log(`> API CID: ${apiCid}`);

    // Date Range
    const dates = getSafeDateRange();
    Logger.log(`> Date Range: ${dates.start} to ${dates.end}`);

    // --- 3. The Query ---
    // Pulls Financials AND Impression Share in one AGGREGATED query (Safe for Search/PMax/Shopping)
    const QUERY = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.advertising_channel_type,
        metrics.cost_micros,
        metrics.conversions,
        metrics.clicks,
        metrics.impressions,
        metrics.search_impression_share,
        metrics.search_budget_lost_impression_share,
        metrics.search_rank_lost_impression_share
      FROM
        campaign
      WHERE
        campaign.status = 'ENABLED' 
        AND campaign.advertising_channel_type IN ('SEARCH', 'PERFORMANCE_MAX', 'SHOPPING')
        AND segments.date BETWEEN '${DATE_START_MARKER}' AND '${DATE_END_MARKER}'
    `;

    Logger.log(`\n[EXECUTING QUERY]...`);
    const results = executeLocalQuery(apiCid, QUERY, dates);

    Logger.log(`> Rows Returned: ${results.length}`);
    
    if (results.length > 0) {
        Logger.log("\n--- CAMPAIGN REPORT ---");
        
        results.forEach((row, index) => {
            const name = row.campaign.name;
            const type = row.campaign.advertisingChannelType;
            
            // Metrics
            const cost = parseFloat(row.metrics.costMicros || 0) / 1000000;
            const impr = parseFloat(row.metrics.impressions || 0);
            const clicks = parseFloat(row.metrics.clicks || 0);
            const conv = parseFloat(row.metrics.conversions || 0);
            
            // IS Metrics (0.1 = 10%)
            const isShare = parseFloat(row.metrics.searchImpressionShare || 0);
            const lostIsBudget = parseFloat(row.metrics.searchBudgetLostImpressionShare || 0);
            const lostIsRank = parseFloat(row.metrics.searchRankLostImpressionShare || 0);

            // --- CALCULATION ---
            let missedConv = "-";
            let calcNote = "";

            if (isShare > 0 && lostIsBudget > 0 && impr > 0 && clicks > 0) {
                // 1. Total Eligible Impressions = Impressions / IS
                const totalMarketImpr = impr / isShare;
                
                // 2. Lost Impressions (Budget)
                const lostImpr = totalMarketImpr * lostIsBudget;
                
                // 3. CTR & Conv Rate
                const ctr = clicks / impr;
                const convRate = conv / clicks;
                
                // 4. Missed Conversions
                const val = (lostImpr * ctr * convRate);
                missedConv = val.toFixed(2);
            } else {
                if (isShare === 0) calcNote = "(IS < 10% or 0)";
                else if (lostIsBudget === 0) calcNote = "(No Budget Loss)";
                else if (clicks === 0) calcNote = "(0 Clicks)";
            }

            // Log Entry
            Logger.log(`${index+1}. [${type}] "${name}"`);
            Logger.log(`   FINANCE: Cost: ${cost.toFixed(2)} | Conv: ${conv} | Clicks: ${clicks} | Impr: ${impr}`);
            Logger.log(`   IS DATA: IS: ${(isShare*100).toFixed(2)}% | Lost Budget: ${(lostIsBudget*100).toFixed(2)}% | Lost Rank: ${(lostIsRank*100).toFixed(2)}%`);
            
            if (missedConv !== "-") {
               Logger.log(`   >>> MISSED CONVERSIONS (Budget): ${missedConv}`);
            } else {
               Logger.log(`   >>> MISSED CONVERSIONS (Budget): - ${calcNote}`);
            }
            Logger.log('------------------------------------------------');
        });
    } else {
        Logger.log("> WARNING: 0 rows returned.");
    }

  } catch (e) {
    Logger.log(`\nFATAL ERROR: ${e.message}`);
    Logger.log(e.stack);
  }
  
  Logger.log("\n=== TEST COMPLETED ===");
}