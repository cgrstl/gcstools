/**
 * Isolated test function to fetch ONLY Search Impression Share metrics
 * for active SEARCH campaigns.
 */
function testSearchISMetricsOnly() {
  
  const TEST_CID_RAW = '6652886860'; // Your Internal CID

  Logger.log(`\n=== STARTING SEARCH IS TEST (CID: ${TEST_CID_RAW}) ===`);

  try {
    // 1. CID Conversion (Using your global InternalAdsApp)
    const cidTrimmed = String(TEST_CID_RAW).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    
    if (!extIds || !extIds[cidTrimmed]) {
        throw new Error(`CID Lookup Failed for ${TEST_CID_RAW}`);
    }
    
    const apiCid = extIds[cidTrimmed].replace(/-/g, '');
    Logger.log(`> API CID: ${apiCid}`);

    // 2. Date Range (7 days ending yesterday)
    // Inline logic for simplicity
    let timeZone = "Europe/Dublin";
    try { timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(); } catch(e) {}
    
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 1);
    const startDate = new Date(endDate.getTime());
    startDate.setDate(endDate.getDate() - 6);
    
    const startStr = Utilities.formatDate(startDate, timeZone, 'yyyy-MM-dd');
    const endStr = Utilities.formatDate(endDate, timeZone, 'yyyy-MM-dd');
    Logger.log(`> Date Range: ${startStr} to ${endStr}`);

    // 3. Define Query (Strictly Search Only)
    const query = `
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
        AND segments.date BETWEEN '${startStr}' AND '${endStr}'
    `;

    // 4. Execute Query (Using your global InternalAdsApp)
    const request = { customerId: apiCid, query: query };
    const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
    const response = JSON.parse(responseJson);
    const results = response.results || [];

    // 5. Log Results
    Logger.log(`> Rows Returned: ${results.length}`);
    
    if (results.length > 0) {
        // Log up to 3 rows to verify data
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