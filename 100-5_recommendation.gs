/**
 * Test 100-5: Expanded Budget Recommendation Hunter.
 * Checks all 3 budget-related recommendation types to find the "missing" data.
 * - CAMPAIGN_BUDGET
 * - FORECASTING_CAMPAIGN_BUDGET
 * - MARGINAL_ROI_CAMPAIGN_BUDGET
 */
function testBudgetRecommendations_Expanded() {
  
  const TEST_CID_RAW = '6662487282'; 
  Logger.log(`\n=== STARTING EXPANDED BUDGET REC TEST (CID: ${TEST_CID_RAW}) ===`);

  try {
    // 1. CID Conversion
    const cidTrimmed = String(TEST_CID_RAW).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    const apiCid = extIds[cidTrimmed].replace(/-/g, '');
    Logger.log(`> API CID: ${apiCid}`);

    // 2. Define Expanded Query
    // We request specific fields for all 3 budget types
    const QUERY = `
      SELECT
        campaign.id,
        campaign.name,
        recommendation.type,
        recommendation.campaign_budget_recommendation.budget_options,
        recommendation.forecasting_campaign_budget_recommendation.budget_amount_micros,
        recommendation.marginal_roi_campaign_budget_recommendation.recommended_budget_amount_micros
      FROM
        recommendation
      WHERE
        recommendation.type IN ('CAMPAIGN_BUDGET', 'FORECASTING_CAMPAIGN_BUDGET', 'MARGINAL_ROI_CAMPAIGN_BUDGET')
    `;

    Logger.log(`\n[FETCHING EXPANDED RECOMMENDATIONS]...`);
    
    const request = { customerId: apiCid, query: QUERY };
    const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
    const results = JSON.parse(responseJson).results || [];

    Logger.log(`> Rows Returned: ${results.length}`);

    if (results.length > 0) {
      Logger.log("\n--- DATA FOUND ---");
      
      results.forEach((row, index) => {
         const campName = row.campaign.name;
         const type = row.recommendation.type;
         let amount = 0;
         let source = "";

         // 1. Standard (Options)
         if (row.recommendation.campaignBudgetRecommendation?.budgetOptions) {
             const opts = row.recommendation.campaignBudgetRecommendation.budgetOptions;
             // Find minimum
             let min = Infinity;
             opts.forEach(o => { if (parseFloat(o.recommendedBudgetAmountMicros) < min) min = parseFloat(o.recommendedBudgetAmountMicros); });
             if (min !== Infinity) {
                 amount = min;
                 source = "Standard (Min Option)";
             }
         }
         
         // 2. Forecasting (Single Value)
         if (row.recommendation.forecastingCampaignBudgetRecommendation) {
             amount = parseFloat(row.recommendation.forecastingCampaignBudgetRecommendation.budgetAmountMicros);
             source = "Forecasting (Target)";
         }

         // 3. Marginal ROI (Single Value)
         if (row.recommendation.marginalRoiCampaignBudgetRecommendation) {
             amount = parseFloat(row.recommendation.marginalRoiCampaignBudgetRecommendation.recommendedBudgetAmountMicros);
             source = "Marginal ROI";
         }

         // Report
         if (amount > 0) {
             const formatted = (amount / 1000000).toFixed(2);
             Logger.log(`${index+1}. [${type}] "${campName}"`);
             Logger.log(`   -> Recommendation: YES ( ${formatted} )`);
             Logger.log(`   -> Source: ${source}`);
         } else {
             Logger.log(`${index+1}. [${type}] "${campName}" -> Found object but no valid amount.`);
         }
      });
      
    } else {
      Logger.log("> 0 Recommendations found."); 
      Logger.log("  (If Campaign Status is 'Limited' but this returns 0, the API has not generated a recommendation object yet).");
      Logger.log("  (Fallback logic 'Check UI' is required).");
    }

  } catch (e) {
    Logger.log(`\nFATAL ERROR: ${e.message}`);
    Logger.log(e.stack);
  }
  
  Logger.log("\n=== TEST COMPLETED ===");
}