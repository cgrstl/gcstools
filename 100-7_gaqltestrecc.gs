/**
 * Test 100-7: Deep Dive Inspection f?r Demand Gen Recommendations.
 * ?bernimmt die Logik aus 04-1, fokussiert sich aber rein auf das Logging
 * der Rohdaten f?r Demand Gen Kampagnen.
 */
function inspectDemandGenRecommendations() {
  
  const TEST_CID_RAW = '6662487282'; // Deine CID
  
  Logger.log(`\n=== STARTING DEMAND GEN INSPECTION (CID: ${TEST_CID_RAW}) ===`);

  try {
    // 1. CID Conversion
    const cidTrimmed = String(TEST_CID_RAW).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    const apiCid = extIds[cidTrimmed].replace(/-/g, '');
    Logger.log(`> API CID: ${apiCid}`);

    // --- SCHRITT 1: STATUS PR?FEN ---
    // Wir schauen erst, ob die Kampagne ?berhaupt "Budget Limited" ist.
    Logger.log('\n[1. CHECKING CAMPAIGN STATUS]');
    
    const Q_STATUS = `
      SELECT 
        campaign.id, 
        campaign.name, 
        campaign.primary_status, 
        campaign.primary_status_reasons
      FROM campaign 
      WHERE 
        campaign.status = 'ENABLED'
        AND campaign.advertising_channel_type = 'DEMAND_GEN'
    `;
    
    const resStatus = JSON.parse(InternalAdsApp.search(JSON.stringify({ customerId: apiCid, query: Q_STATUS }), { version: 'v19' })).results || [];

    if (resStatus.length > 0) {
        resStatus.forEach(row => {
            const isLimited = row.campaign.primaryStatusReasons ? row.campaign.primaryStatusReasons.includes('BUDGET_CONSTRAINED') : false;
            Logger.log(`Campaign: "${row.campaign.name}"`);
            Logger.log(`   ID: ${row.campaign.id}`);
            Logger.log(`   Status: ${row.campaign.primaryStatus}`);
            Logger.log(`   Reasons: ${JSON.stringify(row.campaign.primaryStatusReasons)}`);
            Logger.log(`   -> Is Budget Constrained? ${isLimited ? 'YES' : 'NO'}`);
        });
    } else {
        Logger.log("> No enabled Demand Gen campaigns found.");
        return;
    }

    // --- SCHRITT 2: RECOMMENDATIONS PR?FEN (Logik aus 04-1) ---
    // Wir nutzen exakt die Query aus 04-1, filtern aber auf Demand Gen.
    Logger.log('\n[2. CHECKING RECOMMENDATION OBJECTS]');
    
    const Q_RECS = `
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
        campaign.advertising_channel_type = 'DEMAND_GEN'
        AND recommendation.type IN ('CAMPAIGN_BUDGET', 'FORECASTING_CAMPAIGN_BUDGET', 'MARGINAL_ROI_CAMPAIGN_BUDGET')
    `;

    const resRecs = JSON.parse(InternalAdsApp.search(JSON.stringify({ customerId: apiCid, query: Q_RECS }), { version: 'v19' })).results || [];

    if (resRecs.length > 0) {
        resRecs.forEach(row => {
            Logger.log(`\nRecommendation Found for: "${row.campaign.name}"`);
            Logger.log(`   Type: ${row.recommendation.type}`);
            
            // Check Standard
            if (row.recommendation.campaignBudgetRecommendation) {
                Logger.log(`   -> Has 'campaignBudgetRecommendation'`);
                Logger.log(`   -> Options: ${JSON.stringify(row.recommendation.campaignBudgetRecommendation.budgetOptions)}`);
            }
            
            // Check Forecasting
            if (row.recommendation.forecastingCampaignBudgetRecommendation) {
                const amt = row.recommendation.forecastingCampaignBudgetRecommendation.budgetAmountMicros;
                Logger.log(`   -> Has 'forecastingCampaignBudgetRecommendation'`);
                Logger.log(`   -> Amount: ${amt} micros`);
            }

            // Check Marginal ROI
            if (row.recommendation.marginalRoiCampaignBudgetRecommendation) {
                const amt = row.recommendation.marginalRoiCampaignBudgetRecommendation.recommendedBudgetAmountMicros;
                Logger.log(`   -> Has 'marginalRoiCampaignBudgetRecommendation'`);
                Logger.log(`   -> Amount: ${amt} micros`);
            }
        });
    } else {
        Logger.log("> 0 Recommendations found for Demand Gen via API.");
        Logger.log("  (Das best?tigt, dass Google f?r diese Kampagne KEIN Recommendation-Objekt bereitstellt,");
        Logger.log("   obwohl der Status evtl. 'Limited' ist. Der 'Check UI' Fallback in 04-1 ist also korrekt).");
    }

  } catch (e) {
    Logger.log(`\nFATAL ERROR: ${e.message}`);
    Logger.log(e.stack);
  }
  
  Logger.log("\n=== INSPECTION COMPLETED ===");
}