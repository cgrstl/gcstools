/**
 * Test function to verify Search Impression Share data retrieval.
 * - Uses global InternalAdsApp.
 * - Avoids global variable collisions.
 * - Uses a local safe date helper to avoid SpreadsheetApp errors.
 */
function testSearchISMetrics() {
  
  const TEST_CID_RAW = '6652886860'; 

  Logger.log(`\n=== STARTING SEARCH IS TEST (CID: ${TEST_CID_RAW}) ===`);

  // --- 1. Local Date Helper (Safe from Spreadsheet Error) ---
  const getSafeDateRange = () => {
    const timeZone = "Europe/Dublin"; // Hardcoded from your appsscript.json preference
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
    // --- 2. CID Conversion (Using Global InternalAdsApp) ---
    const cidTrimmed = String(TEST_CID_RAW).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    
    if (!extIds || !extIds[cidTrimmed]) {
        throw new Error(`CID Lookup Failed for ${TEST_CID_RAW}`);
    }
    const apiCid = extIds[cidTrimmed].replace(/-/g, '');
    Logger.log(`> API CID: ${apiCid}`);

    // --- 3. Get Safe Date ---
    const dates = getSafeDateRange();
    Logger.log(`> Date Range: ${dates.start} to ${dates.end}`);

    // --- 4. Define Query (Locally to ensure correct "Search Only" filter) ---
    // We use the values calculated above directly to avoid dependency issues
    const QUERY_SEARCH_IS = `
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

    // --- 5. Execute Query ---
    Logger.log('\n[SEARCH IS QUERY] Fetching...');
    
    const request = { customerId: apiCid, query: QUERY_SEARCH_IS };
    const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
    const response = JSON.parse(responseJson);
    const results = response.results || [];

    Logger.log(`> Rows Returned: ${results.length}`);
    
    if (results.length > 0) {
        const count = Math.min(results.length, 3);
        for (let i = 0; i < count; i++) {
            const row = results[i];
            Logger.log(`Row ${i+1}: "${row.campaign.name}"`);
            Logger.log(`   - IS: ${row.metrics.searchImpressionShare}`);
            Logger.log(`   - Lost Budget: ${row.metrics.searchImpressionShareLostBudget}`);
            Logger.log(`   - Lost Rank: ${row.metrics.searchImpressionShareLostRank}`);
        }
    } else {
        Logger.log("> No active Search campaigns found with data in this period.");
    }

  } catch (e) {
    Logger.log(`\nFATAL ERROR: ${e.message}`);
    Logger.log(e.stack);
  }
  
  Logger.log("\n=== TEST COMPLETED ===");
}