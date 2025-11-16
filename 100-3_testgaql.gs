/**
 * Isolated test for Search Impression Share metrics.
 * - Targets: Active SEARCH campaigns only.
 * - Metrics: IS, Lost IS (Budget), Lost IS (Rank).
 * - Strategy: 7-Day Aggregation (No daily segmentation) to maximize data availability.
 */
function testSearchISMetricsOnly() {
  
  const TEST_CID_RAW = '6652886860'; 
  Logger.log(`\n=== STARTING SEARCH IS TEST (CID: ${TEST_CID_RAW}) ===`);

  // --- 1. Local Helpers (Safe & Isolated) ---
  
  const getSafeDateRange = () => {
    // Hardcoded to match your JSON config ("Europe/Dublin")
    const timeZone = "Europe/Dublin"; 
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 1); // Yesterday
    const startDate = new Date(endDate.getTime());
    startDate.setDate(endDate.getDate() - 6); // 7 Days ago
    
    return {
        start: Utilities.formatDate(startDate, timeZone, 'yyyy-MM-dd'),
        end: Utilities.formatDate(endDate, timeZone, 'yyyy-MM-dd')
    };
  };

  try {
    // --- 2. CID Validation ---
    const cidTrimmed = String(TEST_CID_RAW).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    
    if (!extIds || !extIds[cidTrimmed]) {
        throw new Error(`CID Lookup Failed for ${TEST_CID_RAW}`);
    }
    const apiCid = extIds[cidTrimmed].replace(/-/g, '');
    Logger.log(`> API CID: ${apiCid}`);

    // --- 3. Date Range ---
    const dates = getSafeDateRange();
    Logger.log(`> Date Range: ${dates.start} to ${dates.end}`);

    // --- 4. The Specific Query ---
    // Removing 'segments.date' from SELECT is key for aggregation.
    // We are NOT requesting 'cost' or 'conversions', just the IS metrics.
    const QUERY = `
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
        AND segments.date BETWEEN '${dates.start}' AND '${dates.end}'
    `;

    Logger.log(`\n[EXECUTING QUERY]...`);
    Logger.log(`Query: ${QUERY}`);

    // --- 5. Execute ---
    const request = { customerId: apiCid, query: QUERY };
    const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
    const response = JSON.parse(responseJson);
    const results = response.results || [];

    // --- 6. Report ---
    Logger.log(`> Rows Returned: ${results.length}`);
    
    if (results.length > 0) {
        Logger.log("--- SUCCESS: DATA FOUND ---");
        const count = Math.min(results.length, 3);
        for (let i = 0; i < count; i++) {
            const row = results[i];
            Logger.log(`Row ${i+1}: "${row.campaign.name}"`);
            Logger.log(`   - Search IS: ${row.metrics.searchImpressionShare}`);
            Logger.log(`   - Lost Budget: ${row.metrics.searchImpressionShareLostBudget}`);
            Logger.log(`   - Lost Rank: ${row.metrics.searchImpressionShareLostRank}`);
        }
    } else {
        Logger.log("> WARNING: 0 rows returned. The API returned no data for these specific metrics.");
    }

  } catch (e) {
    Logger.log(`\nFATAL ERROR: ${e.message}`);
    Logger.log(e.stack);
  }
  
  Logger.log("\n=== TEST COMPLETED ===");
}