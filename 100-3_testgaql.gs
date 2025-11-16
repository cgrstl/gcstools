/**
 * @file Test function to verify the entire GAQL cascade works for a specific customer ID.
 * This version relies entirely on the globally defined constants and functions 
 * from your main project files (04-1_budgetsender.gs, helperstools.gs, etc.).
 */
function testGAQLPerformanceQuery_() {
  
  // --- TEST PARAMETERS ---
  const TEST_CID_RAW = '6652886860'; // The internal CID to test
  
  Logger.log(`\n--- STARTING GAQL CASCADIAN TEST FOR CID: ${TEST_CID_RAW} ---`);

  try {
    // 1. Validate CID using the GLOBAL InternalAdsApp
    // We trust InternalAdsApp is defined globally, just like in chusers.gs
    const currentCidTrimmed = String(TEST_CID_RAW).trim();
    const externalIds = InternalAdsApp.getExternalCustomerIds([currentCidTrimmed]); 
    
    let apiCid;
    if (externalIds && externalIds[currentCidTrimmed]) {
        // Remove hyphens for the API call
        apiCid = externalIds[currentCidTrimmed].replace(/-/g, '');
    } else {
        throw new Error(`CID Lookup Error: Invalid CID or No Access via InternalAdsApp for ${TEST_CID_RAW}.`);
    }

    // 2. Get Date Range using the GLOBAL helper
    // This tests if get7DayDateRange_ is correctly defined in 04-1_budgetsender.gs
    const dateRange = get7DayDateRange_();
    Logger.log(`API CID (No Hyphens): ${apiCid}`);
    Logger.log(`Test Date Range: ${dateRange.startDateStr} to ${dateRange.endDateStr}`);
    
    // --------------------------------------------------------------------------------
    // --- QUERY 0: CURRENCY ---
    // Uses the global constant GAQL_QUERY_0_CURRENCY and global helper executeGAQLQuery
    // --------------------------------------------------------------------------------
    Logger.log('\n--- QUERY 0: CURRENCY ---');
    let q0Response = executeGAQLQuery(apiCid, GAQL_QUERY_0_CURRENCY);
    const currency = q0Response.results?.[0]?.customer?.currencyCode;
    Logger.log(`Status: OK. Currency Code: ${currency}`);

    // --------------------------------------------------------------------------------
    // --- QUERY 1: PERFORMANCE ---
    // Uses global GAQL_QUERY_1_PERFORMANCE
    // --------------------------------------------------------------------------------
    Logger.log('\n--- QUERY 1: PERFORMANCE (Cost, Conversions, IS) ---');
    let q1Response = executeGAQLQuery(apiCid, GAQL_QUERY_1_PERFORMANCE, { dateRange });
    const q1RowCount = q1Response.results?.length || 0;
    
    Logger.log(`Total Rows Returned (Campaign Days): ${q1RowCount}`);
    if (q1RowCount > 0) {
      const sampleRow = q1Response.results[0];
      Logger.log(`  Sample Campaign Name: ${sampleRow.campaign.name}`);
      Logger.log(`  Sample Cost (Micros): ${sampleRow.metrics.costMicros}`);
      Logger.log(`  Sample Conversions: ${sampleRow.metrics.conversions}`);
    } else {
      Logger.log('  STATUS: 0 rows returned. (Zero active spend/performance in the last 7 days).');
    }
    
    // --------------------------------------------------------------------------------
    // --- QUERY 2: TARGETS ---
    // Uses global GAQL_QUERY_2_TARGETS
    // --------------------------------------------------------------------------------
    Logger.log('\n--- QUERY 2: BIDDING TARGETS (CPA/ROAS) ---');
    let q2Response = executeGAQLQuery(apiCid, GAQL_QUERY_2_TARGETS);
    const q2RowCount = q2Response.results?.length || 0;
    Logger.log(`Rows Returned (Target Campaigns): ${q2RowCount}`);
    if (q2RowCount > 0) {
      const target = q2Response.results[0].campaign;
      Logger.log(`  Sample Target: CPA Micros: ${target.targetCpa?.targetCpaMicros || 'N/A'}`);
    }

    // --------------------------------------------------------------------------------
    // --- QUERY 4: RECOMMENDATIONS ---
    // Uses global GAQL_QUERY_4_RECOMMENDATIONS
    // --------------------------------------------------------------------------------
    Logger.log('\n--- QUERY 4: BUDGET RECOMMENDATIONS ---');
    let q4Response = executeGAQLQuery(apiCid, GAQL_QUERY_4_RECOMMENDATIONS);
    const q4RowCount = q4Response.results?.length || 0;
    Logger.log(`Rows Returned (Budget Recommendations): ${q4RowCount}`);
    if (q4RowCount > 0) {
      const rec = q4Response.results[0];
      const budgetOptions = rec.campaignBudgetRecommendation.budgetOptions;
      let minRec = Math.min(...budgetOptions.map(o => parseFloat(o.recommendedBudgetAmountMicros)));
      Logger.log(`  Sample Recommendation: Min Recommended Budget (Micros): ${minRec}`);
    }

    Logger.log(`\n--- TEST COMPLETED SUCCESSFULLY ---`);
    
  } catch (e) {
    Logger.log('\n--- FATAL TEST EXECUTION ERROR ---');
    Logger.log(`Error: ${e.message}`);
    Logger.log(`Stack: ${e.stack}`);
  }
}