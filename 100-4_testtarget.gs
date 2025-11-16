/**
 * Test 100-4: Budget Depletion & Smart Bidding Performance.
 * - Scope: All Active Campaigns (Search, Display, Video, Shopping, PMax, Demand Gen).
 * - Metric 1: Budget Depletion (7-Day Avg Spend / Daily Budget).
 * - Metric 2: Target Met/Not Met (Only for Target CPA/ROAS strategies).
 */
function testBudgetAndBiddingLogic() {

  const TEST_CID_RAW = '6662487282'; 
  
  Logger.log(`\n=== STARTING BUDGET & BIDDING TEST (CID: ${TEST_CID_RAW}) ===`);

  // --- 1. CONSTANTS ---
  // We use the exact 7-day window established previously
  const REPORT_DAYS_COUNT = 7;
  const CAMPAIGN_TYPES_ALL = "'SEARCH', 'DISPLAY', 'VIDEO', 'PERFORMANCE_MAX', 'DEMAND_GEN', 'SHOPPING'";

  // --- 2. LOCAL HELPERS ---
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

  // --- 3. EXECUTION ---
  try {
    // A. CID Conversion
    const cidTrimmed = String(TEST_CID_RAW).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    if (!extIds || !extIds[cidTrimmed]) throw new Error(`CID Lookup Failed`);
    const apiCid = extIds[cidTrimmed].replace(/-/g, '');
    
    // B. Date Range
    const dates = getSafeDateRange();
    Logger.log(`> API CID: ${apiCid}`);
    Logger.log(`> Date Range: ${dates.start} to ${dates.end} (${REPORT_DAYS_COUNT} Days)`);

    // C. Define Query
    // We pull aggregated metrics (no segments.date in SELECT) to get 7-day totals.
    // We include campaign_budget and target fields.
    const QUERY = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.advertising_channel_type,
        campaign.bidding_strategy_type,
        campaign_budget.amount_micros,
        campaign.target_cpa.target_cpa_micros,
        campaign.target_roas.target_roas,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM
        campaign
      WHERE
        campaign.status = 'ENABLED' 
        AND campaign.advertising_channel_type IN (${CAMPAIGN_TYPES_ALL})
        AND segments.date BETWEEN '${dates.start}' AND '${dates.end}'
    `;

    Logger.log(`\n[EXECUTING QUERY]...`);
    
    const request = { customerId: apiCid, query: QUERY };
    const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
    const results = JSON.parse(responseJson).results || [];

    Logger.log(`> Rows Returned: ${results.length}`);

    if (results.length > 0) {
        Logger.log("\n--- UNIFIED CAMPAIGN REPORT ---");
        
        results.forEach((row, index) => {
            const name = row.campaign.name;
            const type = row.campaign.advertisingChannelType;
            const bidStrategy = row.campaign.biddingStrategyType;
            
            // 1. Parse Financials (Micros -> Standard)
            const cost7Days = parseFloat(row.metrics.costMicros || 0) / 1000000;
            const conversions = parseFloat(row.metrics.conversions || 0);
            const convValue = parseFloat(row.metrics.conversionsValue || 0);
            const dailyBudget = parseFloat(row.campaignBudget.amountMicros || 0) / 1000000;

            // 2. Calculate Budget Depletion
            // Formula: (7-Day Cost / 7) / Daily Budget
            let depletionPct = 0;
            if (dailyBudget > 0) {
                const avgDailySpend = cost7Days / REPORT_DAYS_COUNT;
                depletionPct = (avgDailySpend / dailyBudget) * 100;
            }
            
            // 3. Analyze Bidding Target
            let targetReport = "-";
            let targetDebug = "";

            if (bidStrategy === 'TARGET_CPA') {
                const targetCpa = parseFloat(row.campaign.targetCpa?.targetCpaMicros || 0) / 1000000;
                
                if (targetCpa > 0 && conversions > 0) {
                    const actualCpa = cost7Days / conversions;
                    const met = actualCpa <= targetCpa;
                    targetReport = met ? "YES (Target Met)" : "NO (Missed)";
                    targetDebug = `(Act. CPA: ${actualCpa.toFixed(2)} vs Tgt: ${targetCpa.toFixed(2)})`;
                } else if (conversions === 0) {
                     targetReport = "NO (0 Conv)";
                }
                
            } else if (bidStrategy === 'TARGET_ROAS') {
                const targetRoas = parseFloat(row.campaign.targetRoas?.targetRoas || 0);
                
                if (targetRoas > 0 && cost7Days > 0) {
                    const actualRoas = convValue / cost7Days;
                    const met = actualRoas >= targetRoas;
                    targetReport = met ? "YES (Target Met)" : "NO (Missed)";
                    targetDebug = `(Act. ROAS: ${actualRoas.toFixed(2)} vs Tgt: ${targetRoas.toFixed(2)})`;
                } else if (cost7Days === 0) {
                    targetReport = "- (0 Spend)";
                }
            }

            // 4. Log Output
            Logger.log(`${index+1}. [${type}] "${name}"`);
            Logger.log(`   - Budget: ${dailyBudget.toFixed(2)}/day | 7-Day Spend: ${cost7Days.toFixed(2)}`);
            Logger.log(`   - Depletion: ${depletionPct.toFixed(2)}%`);
            Logger.log(`   - Strategy: ${bidStrategy}`);
            Logger.log(`   - Target Status: ${targetReport} ${targetDebug}`);
            Logger.log('------------------------------------------------');
        });

    } else {
        Logger.log("> WARNING: 0 rows returned. No active campaigns found.");
    }

  } catch (e) {
    Logger.log(`\nFATAL ERROR: ${e.message}`);
    Logger.log(e.stack);
  }
  
  Logger.log("\n=== TEST COMPLETED ===");
}
