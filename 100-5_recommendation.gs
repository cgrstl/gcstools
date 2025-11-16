/**
 * Test 100-5: Budget Recommendations (OptiScore Analysis).
 * - Checks for 'CAMPAIGN_BUDGET' and 'FORECASTING_CAMPAIGN_BUDGET'.
 * - Extracts the MINIMUM recommended amount from the options (Low/Mid/High).
 * - Output format: "YES ( <Amount> )"
 */
function testBudgetRecommendations_100_5() {
  
  const TEST_CID_RAW = '6652886860'; // Your Internal CID
  
  Logger.log(`\n=== STARTING OPTISCORE BUDGET TEST (CID: ${TEST_CID_RAW}) ===`);

  try {
    // 1. CID Conversion
    const cidTrimmed = String(TEST_CID_RAW).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    if (!extIds || !extIds[cidTrimmed]) throw new Error("CID Lookup Failed");
    const apiCid = extIds[cidTrimmed].replace(/-/g, '');
    Logger.log(`> API CID: ${apiCid}`);

    // 2. Define Query
    // We explicitly ask for both standard and forecasting recommendation details
    const QUERY = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.advertising_channel_type,
        recommendation.type,
        recommendation.campaign_budget_recommendation.budget_options,
        recommendation.forecasting_campaign_budget_recommendation.budget_amount_micros
      FROM
        recommendation
      WHERE
        recommendation.type IN ('CAMPAIGN_BUDGET', 'FORECASTING_CAMPAIGN_BUDGET')
        AND recommendation.status = 'ACTIVE'
    `;

    Logger.log(`\n[FETCHING RECOMMENDATIONS]...`);
    
    // 3. Execute
    const request = { customerId: apiCid, query: QUERY };
    const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
    const results = JSON.parse(responseJson).results || [];

    Logger.log(`> Rows Returned: ${results.length}`);

    if (results.length > 0) {
        Logger.log("\n--- BUDGET RECOMMENDATIONS FOUND ---");
        
        results.forEach((row, index) => {
            const name = row.campaign.name;
            const type = row.campaign.advertisingChannelType;
            const recType = row.recommendation.type;
            
            let minBudgetMicros = Infinity;
            let source = "";

            // A. Check Standard Budget Options (Low, Mid, High)
            if (row.recommendation.campaignBudgetRecommendation && 
                row.recommendation.campaignBudgetRecommendation.budgetOptions) {
                
                const options = row.recommendation.campaignBudgetRecommendation.budgetOptions;
                source = `Standard (${options.length} options)`;
                
                // Iterate to find minimum
                options.forEach(opt => {
                    const amt = parseFloat(opt.recommendedBudgetAmountMicros);
                    if (amt < minBudgetMicros) minBudgetMicros = amt;
                });
            }
            
            // B. Check Forecasting Recommendation (Single Value)
            if (row.recommendation.forecastingCampaignBudgetRecommendation) {
                const amt = parseFloat(row.recommendation.forecastingCampaignBudgetRecommendation.budgetAmountMicros);
                if (amt < minBudgetMicros) {
                    minBudgetMicros = amt;
                    source = "Forecasting (Single value)";
                }
            }

            // C. Format Output
            if (minBudgetMicros !== Infinity) {
                // Assuming USD/EUR standard formatting (divide by 1m)
                const amount = (minBudgetMicros / 1000000).toFixed(2);
                Logger.log(`${index+1}. [${type}] "${name}"`);
                Logger.log(`   -> Rec Type: ${recType} | Source: ${source}`);
                Logger.log(`   -> Result: YES ( ${amount} )`);
            } else {
                Logger.log(`${index+1}. [${type}] "${name}" -> Rec found but no amount parsed.`);
            }
            Logger.log('------------------------------------------------');
        });

    } else {
        Logger.log("> WARNING: 0 Budget Recommendations returned.");
        Logger.log("  (Verify that the 'OptiScore' recommendations are not 'Dismissed' or 'Applied' in the UI).");
    }

  } catch (e) {
    Logger.log(`\nFATAL ERROR: ${e.message}`);
    Logger.log(e.stack);
  }
  
  Logger.log("\n=== TEST COMPLETED ===");
}