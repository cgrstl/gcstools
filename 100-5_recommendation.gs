/**
 * Test 100-5: Budget Simulation Exploration.
 * Purpose: To find recommended budget amounts when the standard 'recommendation' resource is empty.
 * Source: 'campaign_simulation' (The backing data for budget forecasts).
 */
function testBudgetSimulations() {
  
  const TEST_CID_RAW = '6662487282'; 
  Logger.log(`\n=== STARTING BUDGET SIMULATION TEST (CID: ${TEST_CID_RAW}) ===`);

  try {
    // 1. CID Conversion
    const cidTrimmed = String(TEST_CID_RAW).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    if (!extIds || !extIds[cidTrimmed]) throw new Error("CID Lookup Failed");
    const apiCid = extIds[cidTrimmed].replace(/-/g, '');
    Logger.log(`> API CID: ${apiCid}`);

    // 2. Find Limited Campaigns (To get IDs)
    const Q_LIMITED = `
      SELECT campaign.id, campaign.name 
      FROM campaign 
      WHERE campaign.status = 'ENABLED' AND campaign.primary_status_reasons CONTAINS ANY ('BUDGET_CONSTRAINED')
    `;
    const resLimited = JSON.parse(InternalAdsApp.search(JSON.stringify({ customerId: apiCid, query: Q_LIMITED }), { version: 'v19' })).results || [];
    
    if (resLimited.length === 0) {
        Logger.log("> No campaigns found with 'BUDGET_CONSTRAINED' status via API.");
        return;
    }

    const limitedIds = resLimited.map(r => r.campaign.id);
    Logger.log(`> Found ${limitedIds.length} Limited Campaigns: ${limitedIds.join(', ')}`);

    // 3. Query Simulations for these Campaigns
    // We look for Type = BUDGET to get budget-specific points
    const Q_SIM = `
      SELECT 
        campaign_simulation.campaign_id,
        campaign_simulation.type,
        campaign_simulation.budget_point_list.points
      FROM campaign_simulation
      WHERE 
        campaign_simulation.type = 'BUDGET'
        AND campaign_simulation.campaign_id IN (${limitedIds.join(',')})
    `;

    Logger.log('\n[FETCHING SIMULATIONS]...');
    const resSim = JSON.parse(InternalAdsApp.search(JSON.stringify({ customerId: apiCid, query: Q_SIM }), { version: 'v19' })).results || [];
    
    if (resSim.length > 0) {
        resSim.forEach(row => {
            const campId = row.campaignSimulation.campaignId;
            const points = row.campaignSimulation.budgetPointList.points;
            
            Logger.log(`\nCampaign ID: ${campId}`);
            if (points && points.length > 0) {
                Logger.log(`> Found ${points.length} Simulation Points.`);
                // Log the first 3 points as examples (usually current, low, high)
                points.slice(0, 3).forEach((pt, i) => {
                    const budget = parseFloat(pt.budgetAmountMicros) / 1000000;
                    const clicks = pt.clicks;
                    const cost = parseFloat(pt.costMicros) / 1000000;
                    Logger.log(`   Point ${i+1}: Budget ${budget.toFixed(2)} -> Est. Cost ${cost.toFixed(2)} | Clicks ${clicks}`);
                });
            } else {
                Logger.log("> No data points in simulation.");
            }
        });
    } else {
        Logger.log("> No simulations returned. (Google may not have generated forecast data for these campaigns yet).");
    }

  } catch (e) {
    Logger.log(`\nFATAL ERROR: ${e.message}`);
    Logger.log(e.stack);
  }
  Logger.log("\n=== TEST COMPLETED ===");
}