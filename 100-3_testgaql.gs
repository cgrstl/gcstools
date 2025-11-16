/**
 * @file Test function to verify the entire GAQL cascade works for a specific customer ID.
 * NOTE: This relies on InternalAdsApp, executeGAQLQuery, and get7DayDateRange_ 
 * being available and correctly defined in your project environment.
 */
function testGAQLPerformanceQuery_() {
  
  // --- TEST PARAMETERS ---
  const TEST_CID_RAW = '6652886860'; // The internal CID to test
  
  Logger.log(`\n--- STARTING GAQL CASCADIAN TEST FOR CID: ${TEST_CID_RAW} ---`);

  try {
    // 1. CID Validation and Conversion (Learning from 03-1_chusers.gs)
    let apiCid;
    const currentCidTrimmed = String(TEST_CID_RAW).trim();
    
    // Assumes InternalAdsApp.getExternalCustomerIds is globally available and performs the lookup
    const externalIds = InternalAdsApp.getExternalCustomerIds([currentCidTrimmed]); 
    
    if (externalIds && externalIds[currentCidTrimmed]) {
        // Successful lookup returns the external ID (e.g., XXX-XXX-XXXX)
        apiCid = externalIds[currentCidTrimmed].replace(/-/g, '');
    } else {
        throw new Error(`CID Lookup Error: Invalid CID or No Access via InternalAdsApp for ${TEST_CID_RAW}.`);
    }

    const dateRange = get7DayDateRange_();
    Logger.log(`API CID (No Hyphens): ${apiCid}`);
    Logger.log(`Test Date Range: ${dateRange.startDateStr} to ${dateRange.endDateStr}`);
    
    // --- QUERY 0: CURRENCY ---
    // Note: The execution function relies on the GAQL constants defined in the main file.
    let q0Response = executeGAQLQuery(apiCid, GAQL_QUERY_0_CURRENCY);
    const currency = q0Response.results[0]?.customer?.currencyCode;
    Logger.log(`\n[Q0: CURRENCY] Status: OK. Currency Code: ${currency}`);

    // --- QUERY 1: PERFORMANCE (The primary failing query) ---
    Logger.log('\n--- QUERY 1: PERFORMANCE (Cost, Conversions, IS) ---');
    let q1Response = executeGAQLQuery(apiCid, GAQL_QUERY_1_PERFORMANCE, { dateRange });
    const q1RowCount = q1Response.results?.length || 0;
    
    Logger.log(`Total Rows Returned (Campaign Days): ${q1RowCount}`);
    if (q1RowCount > 0) {
      const sampleRow = q1Response.results[0];
      Logger.log(`  Sample Data: Campaign: ${sampleRow.campaign.name} (${sampleRow.campaign.advertisingChannelType})`);
      Logger.log(`  Cost/Conversions: ${sampleRow.metrics.costMicros} / ${sampleRow.metrics.conversions}`);
      Logger.log(`  IS Lost Budget: ${sampleRow.metrics.searchImpressionShareLostBudget}`);
    } else {
      Logger.log('  STATUS: 0 rows returned. (This replicates the current error condition.)');
    }
    
    // --- QUERY 2: TARGETS ---
    Logger.log('\n--- QUERY 2: BIDDING TARGETS (CPA/ROAS) ---');
    let q2Response = executeGAQLQuery(apiCid, GAQL_QUERY_2_TARGETS);
    const q2RowCount = q2Response.results?.length || 0;
    Logger.log(`Rows Returned (Target Campaigns): ${q2RowCount}`);
    if (q2RowCount > 0) {
      const target = q2Response.results[0].campaign;
      Logger.log(`  Sample Target: CPA Micros: ${target.targetCpa?.targetCpaMicros || 'N/A'} | ROAS: ${target.targetRoas?.targetRoas || 'N/A'}`);
    }

    // --- QUERY 4: RECOMMENDATIONS ---
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
    Logger.log(`Ensure InternalAdsApp methods are globally defined.`);
  }
}