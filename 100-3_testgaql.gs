/**
 * Final Verification Test: Search Impression Share (Aggregated).
 * * FIX 1: REMOVES 'segments.date' from SELECT clause.
 * - This forces the API to return aggregated 7-day stats.
 * - This prevents 0-row returns caused by daily segmentation thresholds.
 * * FIX 2: Uses local, safe date calculation to avoid SpreadsheetApp errors.
 */
function testSearchISMetrics() {

  // 1. SETUP
  const TEST_CID_RAW = '6652886860'; 
  
  // We define the query LOCALLY to ensure 'segments.date' is NOT in the SELECT clause.
  // It remains in the WHERE clause to filter the time period.
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
      AND segments.date BETWEEN 'START_DATE' AND 'END_DATE'
  `;

  Logger.log(`\n=== STARTING AGGREGATE IS TEST (CID: ${TEST_CID_RAW}) ===`);

  // 2. SAFE DATE HELPER (Local)
  const getSafeDateRange = () => {
    const timeZone = "Europe/Dublin"; // As per appsscript.json
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
    // 3. CID CONVERSION
    const cidTrimmed = String(TEST_CID_RAW).trim();
    // Relies on your global InternalAdsApp
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    
    let apiCid;
    if (extIds && extIds[cidTrimmed]) {
        apiCid = extIds[cidTrimmed].replace(/-/g, '');
    } else {
        throw new Error(`CID Lookup Failed for ${TEST_CID_RAW}`);
    }
    Logger.log(`> API CID: ${apiCid}`);

    // 4. PREPARE QUERY
    const dates = getSafeDateRange();
    Logger.log(`> Date Range: ${dates.start} to ${dates.end}`);
    
    const finalQuery = QUERY_SEARCH_IS_AGGREGATE
        .replace('START_DATE', dates.start)
        .replace('END_DATE', dates.end);

    Logger.log(`> Querying for AGGREGATE metrics (No daily segmentation)...`);

    // 5. EXECUTE
    const request = { customerId: apiCid, query: finalQuery };
    const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
    const response = JSON.parse(responseJson);
    const results = response.results || [];

    Logger.log(`> Rows Returned: ${results.length}`);
    
    if (results.length > 0) {
        Logger.log("\n--- SUCCESS: DATA FOUND ---");
        // Log first 3 rows
        const count = Math.min(results.length, 3);
        for (let i = 0; i < count; i++) {
            const row = results[i];
            // Note: 0.0999 indicates < 10%
            Logger.log(`Row ${i+1}: "${row.campaign.name}"`);
            Logger.log(`   - Avg IS: ${row.metrics.searchImpressionShare}`);
            Logger.log(`   - Avg Lost Budget: ${row.metrics.searchImpressionShareLostBudget}`);
            Logger.log(`   - Avg Lost Rank: ${row.metrics.searchImpressionShareLostRank}`);
        }
    } else {
        Logger.log("> WARNING: 0 rows returned. Even aggregated data is missing.");
    }

  } catch (e) {
    Logger.log(`\nFATAL ERROR: ${e.message}`);
    Logger.log(e.stack);
  }
  
  Logger.log("\n=== TEST COMPLETED ===");
}