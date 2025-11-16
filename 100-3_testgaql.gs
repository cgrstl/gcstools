/**
 * Test function for "Missed Conversions" Calculation.
 * - Targets: SEARCH, PERFORMANCE_MAX, SHOPPING.
 * - Metrics: Impressions, Clicks, Conversions, Search IS, Lost IS (Budget), Lost IS (Rank).
 * - Logic: Calculates missed conversions using the funnel formula:
 * ((Impressions / IS * Lost IS Budget) * CTR) * Conv. Rate
 */
function testMissedConversionsCalculation() {
  
  const TEST_CID_RAW = '6652886860'; 

  Logger.log(`\n=== STARTING MISSED CONVERSION TEST (CID: ${TEST_CID_RAW}) ===`);

  // 1. Date Helper (Local & Safe)
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
    // 2. CID Conversion (Using Global InternalAdsApp)
    const cidTrimmed = String(TEST_CID_RAW).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    if (!extIds || !extIds[cidTrimmed]) throw new Error(`CID Lookup Failed`);
    const apiCid = extIds[cidTrimmed].replace(/-/g, '');
    Logger.log(`> API CID: ${apiCid}`);

    // 3. Date Range
    const dates = getSafeDateRange();
    Logger.log(`> Date Range: ${dates.start} to ${dates.end}`);

    // 4. Define Query (Aggregated - No segments.date)
    // Requesting all metrics needed for the formula + the 3 IS metrics for reporting
    const QUERY = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.advertising_channel_type,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions,
        metrics.search_impression_share,
        metrics.search_budget_lost_impression_share,
        metrics.search_rank_lost_impression_share
      FROM
        campaign
      WHERE
        campaign.status = 'ENABLED' 
        AND campaign.advertising_channel_type IN ('SEARCH', 'PERFORMANCE_MAX', 'SHOPPING')
        AND segments.date BETWEEN '${dates.start}' AND '${dates.end}'
    `;

    Logger.log(`\n[EXECUTING QUERY]...`);
    const request = { customerId: apiCid, query: QUERY };
    const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
    const response = JSON.parse(responseJson);
    const results = response.results || [];

    // 5. Process & Log
    Logger.log(`> Rows Returned: ${results.length}`);
    
    if (results.length > 0) {
        Logger.log("\n--- CAMPAIGN REPORT ---");
        
        results.forEach((row, index) => {
            const name = row.campaign.name;
            const type = row.campaign.advertisingChannelType;
            
            // Extract Metrics (Handle nulls with 0)
            const impr = parseFloat(row.metrics.impressions || 0);
            const clicks = parseFloat(row.metrics.clicks || 0);
            const conv = parseFloat(row.metrics.conversions || 0);
            
            // IS Metrics (0.1 = 10%)
            const isShare = parseFloat(row.metrics.searchImpressionShare || 0);
            const lostIsBudget = parseFloat(row.metrics.searchBudgetLostImpressionShare || 0);
            const lostIsRank = parseFloat(row.metrics.searchRankLostImpressionShare || 0);

            // --- CALCULATION LOGIC ---
            let missedConversions = "-";
            let debugFormula = "";

            // Valid calculation requires:
            // 1. Valid IS (to calculate total market)
            // 2. Valid Impressions/Clicks (to calculate CTR)
            // 3. Valid Clicks (to calculate Conv Rate, avoiding div by zero)
            if (isShare > 0 && impr > 0 && clicks > 0) {
                
                // Step 1: Total Market Impressions
                const totalEligibleImpr = impr / isShare;
                
                // Step 2: Impressions Lost to Budget
                const lostImprBudget = totalEligibleImpr * lostIsBudget;
                
                // Step 3: CTR
                const ctr = clicks / impr;
                
                // Step 4: Conversion Rate
                const convRate = conv / clicks;
                
                // Final: Missed Conversions
                const calcValue = (lostImprBudget * ctr * convRate);
                missedConversions = calcValue.toFixed(2);
                
                // (Optional) Validate against simplified formula: Conv * (LostBudget / IS)
                // const check = conv * (lostIsBudget / isShare);
            } else {
                // Handle specific missing data cases
                if (isShare === 0) missedConversions = "- (IS < 10% or 0)";
                else if (clicks === 0) missedConversions = "- (0 Clicks)";
            }

            // Logging: Only show relevant campaigns (Limited by budget OR High Volume)
            if (lostIsBudget > 0 || index < 3) { 
                Logger.log(`Row ${index+1}: [${type}] "${name}"`);
                Logger.log(`   - Metrics: Conv: ${conv} | Impr: ${impr} | Clicks: ${clicks}`);
                Logger.log(`   - IS Stats: IS: ${(isShare*100).toFixed(1)}% | Lost Budget: ${(lostIsBudget*100).toFixed(1)}% | Lost Rank: ${(lostIsRank*100).toFixed(1)}%`);
                Logger.log(`   - Missed Conversions (Budget): ${missedConversions}`);
                Logger.log('------------------------------------------------');
            }
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