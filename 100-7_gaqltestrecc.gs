/**
 * Test 100-7: Complete Budget Recommendation Scan (All Campaigns).
 * Strategie: Wir scannen ALLE Kampagnen nach ALLEN Budget-Empfehlungstypen.
 * Ziel: Pr?fen, ob die Demand Gen Empfehlung unter einem dieser Typen auftaucht.
 */
function testAllBudgetRecommendations() {
  
  const TEST_CID_RAW = '6662487282'; 
  
  Logger.log(`\n=== STARTING COMPLETE BUDGET REC SCAN (CID: ${TEST_CID_RAW}) ===`);

  try {
    // 1. CID Conversion
    const cidTrimmed = String(TEST_CID_RAW).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    if (!extIds || !extIds[cidTrimmed]) throw new Error("CID Lookup Failed");
    const apiCid = extIds[cidTrimmed].replace(/-/g, '');
    Logger.log(`> API CID: ${apiCid}`);

    // 2. Define Query (Broadest Possible Budget Search)
    // Wir suchen nach ALLEN 3 Budget-Typen f?r ALLE Kampagnen (kein Demand Gen Filter)
    const QUERY = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.advertising_channel_type,
        recommendation.type,
        recommendation.campaign_budget_recommendation.budget_options,
        recommendation.forecasting_campaign_budget_recommendation.budget_amount_micros,
        recommendation.marginal_roi_campaign_budget_recommendation.recommended_budget_amount_micros
      FROM
        recommendation
      WHERE
        recommendation.type IN ('CAMPAIGN_BUDGET', 'FORECASTING_CAMPAIGN_BUDGET', 'MARGINAL_ROI_CAMPAIGN_BUDGET')
    `;

    Logger.log(`\n[EXECUTING BROAD QUERY]...`);
    const request = { customerId: apiCid, query: QUERY };
    const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
    const results = JSON.parse(responseJson).results || [];

    Logger.log(`> Total Budget Recommendations Found: ${results.length}`);

    if (results.length > 0) {
        Logger.log("\n--- FINDINGS ---");
        
        results.forEach((row, index) => {
            const name = row.campaign.name;
            const type = row.campaign.advertisingChannelType;
            const recType = row.recommendation.type;
            let amount = 0;
            let details = "";

            // 1. Standard
            if (row.recommendation.campaignBudgetRecommendation?.budgetOptions) {
                details = "Standard (Options available)";
                // Find min
                let min = Infinity;
                row.recommendation.campaignBudgetRecommendation.budgetOptions.forEach(o => {
                    const v = parseFloat(o.recommendedBudgetAmountMicros);
                    if (v < min) min = v;
                });
                if (min !== Infinity) amount = min;
            }
            
            // 2. Forecasting
            if (row.recommendation.forecastingCampaignBudgetRecommendation) {
                details = "Forecasting (Specific Amount)";
                amount = parseFloat(row.recommendation.forecastingCampaignBudgetRecommendation.budgetAmountMicros);
            }

            // 3. Marginal ROI
            if (row.recommendation.marginalRoiCampaignBudgetRecommendation) {
                details = "Marginal ROI (Specific Amount)";
                amount = parseFloat(row.recommendation.marginalRoiCampaignBudgetRecommendation.recommendedBudgetAmountMicros);
            }

            // Logging with special focus on Demand Gen
            const prefix = type === 'DEMAND_GEN' ? ">>> DEMAND GEN FOUND: " : "";
            
            if (amount > 0) {
                Logger.log(`${prefix}[${type}] "${name}"`);
                Logger.log(`   Type: ${recType}`);
                Logger.log(`   Rec: ${(amount/1000000).toFixed(2)} (${details})`);
            } else {
                Logger.log(`${prefix}[${type}] "${name}" (Type: ${recType} - No amount parsed)`);
            }
            Logger.log('--------------------------------');
        });
    } else {
        Logger.log("> No budget recommendations found for ANY campaign.");
        Logger.log("  (Dies bedeutet, dass die API aktuell keine Recommendation-Objekte f?r Budget ausliefert,");
        Logger.log("   auch nicht f?r die Kampagnen, die im Status als 'Limited' markiert sind).");
    }

  } catch (e) {
    Logger.log(`\nFATAL ERROR: ${e.message}`);
    Logger.log(e.stack);
  }
  
  Logger.log("\n=== TEST COMPLETED ===");
}