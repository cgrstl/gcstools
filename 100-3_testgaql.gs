/**
 * Final Corrected Test for Search & PMax IS Metrics.
 * - Now includes PERFORMANCE_MAX to verify metric compatibility.
 * - Uses AGGREGATION (no date segment) to maximize data availability.
 */
function testSearchAndPMaxISMetrics() {
  
  const TEST_CID_RAW = '6662487282'; 
  Logger.log(`\n=== STARTING SEARCH & PMAX IS TEST (CID: ${TEST_CID_RAW}) ===`);

  // 1. Date Helper
  const getSafeDateRange = () => {
    const timeZone = "Europe/Dublin"; 
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 1); 
    const startDate = new Date(endDate.getTime());
    startDate.setDate(endDate.getDate() - 6); 
    return {
        start: Utilities.formatDate(startDate, timeZone, 'yyyy-MM-dd'),
        end: Utilities.formatDate(endDate, timeZone, 'yyyy-MM-dd')
    };
  };

  try {
    // 2. CID Conversion
    const cidTrimmed = String(TEST_CID_RAW).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    if (!extIds || !extIds[cidTrimmed]) throw new Error(`CID Lookup Failed`);
    const apiCid = extIds[cidTrimmed].replace(/-/g, '');
    Logger.log(`> API CID: ${apiCid}`);

    const dates = getSafeDateRange();
    Logger.log(`> Date Range: ${dates.start} to ${dates.end}`);

    // 3. Define Query (Updated for SEARCH + PMAX)
    const QUERY = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.advertising_channel_type,
        metrics.search_impression_share,
        metrics.search_budget_lost_impression_share,
        metrics.search_rank_lost_impression_share
      FROM
        campaign
      WHERE
        campaign.status = 'ENABLED' 
        AND campaign.advertising_channel_type IN ('SEARCH', 'PERFORMANCE_MAX')
        AND segments.date BETWEEN '${dates.start}' AND '${dates.end}'
    `;

    Logger.log(`\n[EXECUTING QUERY]...`);
    const request = { customerId: apiCid, query: QUERY };
    const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
    const response = JSON.parse(responseJson);
    const results = response.results || [];

    // 4. Report
    Logger.log(`> Rows Returned: ${results.length}`);
    
    if (results.length > 0) {
        Logger.log("--- SUCCESS: DATA FOUND ---");
        // Log sample rows to see if PMax appears
        const count = Math.min(results.length, 5);
        for (let i = 0; i < count; i++) {
            const row = results[i];
            Logger.log(`Row ${i+1}: [${row.campaign.advertisingChannelType}] "${row.campaign.name}"`);
            Logger.log(`   - Search IS: ${row.metrics.searchImpressionShare}`);
            Logger.log(`   - Lost Budget: ${row.metrics.searchBudgetLostImpressionShare}`);
            Logger.log(`   - Lost Rank: ${row.metrics.searchRankLostImpressionShare}`);
        }
    } else {
        Logger.log("> WARNING: 0 rows returned.");
    }

  } catch (e) {
    Logger.log(`\nFATAL ERROR: ${e.message}`);
    Logger.log(e.stack);
  }
  
  Logger.log("\n=== TEST COMPLETED ===");
}