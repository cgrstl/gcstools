/**
 * Test 100-5: Budget Recommendations (OptiScore).
 * - Source: 'recommendation' resource (Date Independent).
 * - Scope: All 6 Campaign Types (Search, Display, Video, PMax, Demand Gen, Shopping).
 * - Output: "YES ( [Min Recommended Budget] )"
 */
function testBudgetRecommendations() {
  
  const TEST_CID_RAW = '6662487282'; // Your Internal CID
  Logger.log(`\n=== STARTING BUDGET RECOMMENDATION TEST (CID: ${TEST_CID_RAW}) ===`);

  // --- 1. GAQL QUERY ---
  // We select campaign details directly from the recommendation resource.
  // We filter strictly for 'CAMPAIGN_BUDGET' recommendations.
  const QUERY = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.advertising_channel_type,
      recommendation.campaign_budget_recommendation.budget_options
    FROM
      recommendation
    WHERE
      recommendation.type = 'CAMPAIGN_BUDGET'
  `;

  try {
    // --- 2. CID CONVERSION ---
    const cidTrimmed = String(TEST_CID_RAW).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    
    let apiCid;
    if (extIds && extIds[cidTrimmed]) {
        apiCid = extIds[cidTrimmed].replace(/-/g, '');
    } else {
        throw new Error(`CID Lookup Failed for ${TEST_CID_RAW}`);
    }
    Logger.log(`> API CID: ${apiCid}`);

    // --- 3. EXECUTE QUERY ---
    Logger.log('\n[FETCHING OPTISCORE RECOMMENDATIONS]...');
    const request = { customerId: apiCid, query: QUERY };
    const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
    const response = JSON.parse(responseJson);
    const results = response.results || [];

    Logger.log(`> Recommendations Found: ${results.length}`);

    // --- 4. PROCESS & REPORT ---
    if (results.length > 0) {
      Logger.log("\n--- CAMPAIGNS WITH BUDGET RECOMMENDATIONS ---");
      
      results.forEach((row, index) => {
         const campName = row.campaign.name;
         const campType = row.campaign.advertisingChannelType;
         const options = row.recommendation.campaignBudgetRecommendation.budgetOptions;
         
         // Find Minimum Recommended Budget
         let minBudgetMicros = Infinity;
         
         if (options && options.length > 0) {
             // Map options to find the lowest value
             options.forEach(opt => {
                 const amount = parseFloat(opt.recommendedBudgetAmountMicros);
                 if (amount < minBudgetMicros) {
                     minBudgetMicros = amount;
                 }
             });
         }
         
         // Format the output
         let recommendationString = "NO"; // Default fallback
         if (minBudgetMicros !== Infinity) {
             const formattedAmount = (minBudgetMicros / 1000000).toFixed(2);
             recommendationString = `YES ( ${formattedAmount} )`;
         }

         // Log formatted result
         Logger.log(`${index + 1}. [${campType}] "${campName}"`);
         Logger.log(`   -> Budget Recommendation: ${recommendationString}`);
      });
      
    } else {
      Logger.log("> No 'Limited by Budget' recommendations found in OptiScore.");
      Logger.log("  (This means Google currently sees no budget limitations for any campaign).");
    }

  } catch (e) {
    Logger.log(`\nFATAL ERROR: ${e.message}`);
    Logger.log(e.stack);
  }
  
  Logger.log("\n=== TEST COMPLETED ===");
}