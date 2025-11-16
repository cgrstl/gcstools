/**
 * Test function to verify Search Impression Share data retrieval.
 * FIX: Uses AGGREGATION (removing segments.date from SELECT) to avoid data suppression.
 * FIX: Scopes all constants internally to prevent global errors.
 */
function testSearchISMetrics() {

  // --- 1. LOCAL CONSTANTS (Scoped to avoid conflicts) ---
  const LOCAL_CID_RAW = '6652886860'; 
  const LOCAL_DATE_START = 'YYYY-MM-DD_START';
  const LOCAL_DATE_END = 'YYYY-MM-DD_END';

  Logger.log(`\n=== STARTING SEARCH IS TEST (AGGREGATED) ===`);
  Logger.log(`Target Internal CID: ${LOCAL_CID_RAW}`);

  // --- 2. LOCAL HELPERS ---
  
  // Helper: Get Date Range (Safe from Spreadsheet Error)
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

  // Helper: Execute Query
  const executeLocalQuery = (clientId, query, dateRange) => {
    let finalQuery = query
      .replace(LOCAL_DATE_START, dateRange.start)
      .replace(LOCAL_DATE_END, dateRange.end);
      
    const request = { customerId: clientId, query: finalQuery };
    // Uses global InternalAdsApp
    const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
    return JSON.parse(responseJson).results || [];
  };

  try {
    // --- 3. CID Conversion ---
    const cidTrimmed = String(LOCAL_CID_RAW).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    
    let apiCid;
    if (extIds && extIds[cidTrimmed]) {
        apiCid = extIds[cidTrimmed].replace(/-/g, '');
    } else {
        throw new Error(`CID Lookup Failed for ${LOCAL_CID_RAW}`);
    }
    Logger.log(`> API CID Resolved: ${apiCid}`);

    // --- 4. Date Setup ---
    const dates = getSafeDateRange();
    Logger.log(`> Date Range: ${dates.start} to ${dates.end}`);

    // --- 5. Define Query (AGGREGATE VIEW) ---
    // CRITICAL: 'segments.date' is removed from SELECT to get the 7-day summary.
    const QUERY_SEARCH_IS_AGGREGATE = `
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
        AND segments.date BETWEEN '${LOCAL_DATE_START}' AND '${LOCAL_DATE_END}'
    `;

    // --- 6. Execute ---
    Logger.log('\n[EXECUTING QUERY]...');
    Logger.log(`Query: ${QUERY_SEARCH_IS_AGGREGATE}`);

    const results = executeLocalQuery(apiCid, QUERY_SEARCH_IS_AGGREGATE, dates);

    Logger.log(`> Rows Returned: ${results.length}`);
    
    if (results.length > 0) {
        Logger.log("\n--- SUCCESS: DATA FOUND ---");
        // Log the first 3 rows
        const count = Math.min(results.length, 3);
        for (let i = 0; i < count; i++) {
            const row = results[i];
            Logger.log(`Row ${i+1}: "${row.campaign.name}"`);
            Logger.log(`   - Avg IS: ${row.metrics.searchImpressionShare}`);
            Logger.log(`   - Avg Lost Budget: ${row.metrics.searchImpressionShareLostBudget}`);
            Logger.log(`   - Avg Lost Rank: ${row.metrics.searchImpressionShareLostRank}`);
        }
    } else {
        Logger.log("> WARNING: 0 rows returned. Even aggregated data is missing. This suggests the metrics are incompatible or the campaigns have absolutely zero traffic.");
    }

  } catch (e) {
    Logger.log(`\nFATAL ERROR: ${e.message}`);
    Logger.log(e.stack);
  }
  
  Logger.log("\n=== TEST COMPLETED ===");
}