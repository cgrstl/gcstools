/**
 * Test 100-5: Budget Fields on CampaignBudget Resource.
 * Purpose: Retrieves budget recommendations directly from the budget resource
 * instead of the recommendation resource.
 * Query: campaign + campaign_budget fields.
 */
function testBudgetFieldsDirectly() {
  
  const TEST_CID_RAW = '6652886860'; 
  Logger.log(`\n=== STARTING DIRECT BUDGET FIELD TEST (CID: ${TEST_CID_RAW}) ===`);

  try {
    // 1. CID Conversion
    const cidTrimmed = String(TEST_CID_RAW).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    if (!extIds || !extIds[cidTrimmed]) throw new Error("CID Lookup Failed");
    const apiCid = extIds[cidTrimmed].replace(/-/g, '');
    Logger.log(`> API CID: ${apiCid}`);

    // 2. Define Query
    // We select the specific recommendation fields FROM the campaign budget
    const QUERY = `
      SELECT 
        campaign.id, 
        campaign.name, 
        campaign.advertising_channel_type,
        campaign.primary_status,
        campaign_budget.amount_micros,
        campaign_budget.has_recommended_budget,
        campaign_budget.recommended_budget_amount_micros,
        campaign_budget.recommended_budget_estimated_change_weekly_clicks,
        campaign_budget.recommended_budget_estimated_change_weekly_cost_micros
      FROM campaign 
      WHERE 
        campaign.status = 'ENABLED'
        AND campaign.primary_status_reasons CONTAINS ANY ('BUDGET_CONSTRAINED')
    `;

    Logger.log(`\n[EXECUTING QUERY]...`);
    const request = { customerId: apiCid, query: QUERY };
    const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
    const response = JSON.parse(responseJson);
    const results = response.results || [];

    Logger.log(`> Limited Campaigns Found: ${results.length}`);

    if (results.length > 0) {
        Logger.log("\n--- CAMPAIGN BUDGET RECOMMENDATIONS ---");
        
        results.forEach((row, index) => {
            const name = row.campaign.name;
            const type = row.campaign.advertisingChannelType;
            const budget = row.campaignBudget;
            
            const currentAmount = parseFloat(budget.amountMicros || 0) / 1000000;
            const hasRec = budget.hasRecommendedBudget;
            
            let recString = "NO";
            let details = "";

            if (hasRec) {
                const recAmount = parseFloat(budget.recommendedBudgetAmountMicros || 0) / 1000000;
                const estCostChange = parseFloat(budget.recommendedBudgetEstimatedChangeWeeklyCostMicros || 0) / 1000000;
                
                recString = `YES ( ${recAmount.toFixed(2)} )`;
                details = `Current: ${currentAmount.toFixed(2)} | Est. Weekly Cost Increase: +${estCostChange.toFixed(2)}`;
            } else {
                recString = "NO (Status is Limited, but 'has_recommended_budget' is false)";
                details = `Current: ${currentAmount.toFixed(2)}`;
            }

            Logger.log(`${index + 1}. [${type}] "${name}"`);
            Logger.log(`   -> Recommendation: ${recString}`);
            if (details) Logger.log(`   -> Details: ${details}`);
            Logger.log('------------------------------------------------');
        });
    } else {
        Logger.log("> No campaigns found with 'BUDGET_CONSTRAINED' status.");
    }

  } catch (e) {
    Logger.log(`\nFATAL ERROR: ${e.message}`);
    Logger.log(e.stack);
  }
  
  Logger.log("\n=== TEST COMPLETED ===");
}