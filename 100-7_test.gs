/**
 * 100-6: Unified Campaign Performance Report (Test).
 * Combines logic from 100-3, 100-4, and 100-5.
 * - Aggregates 7-day data.
 * - Calculates: Budget Depletion, Missed Conversions, Target Hit/Miss.
 * - Reports: Budget Recommendations & Estimated Cost Increase.
 */
function testUnifiedCampaignReport() {
  
  const TEST_CID_RAW = '6662487282'; 
  const REPORT_DAYS = 7;

  // --- CONSTANTS ---
  const DATE_START = 'YYYY-MM-DD_START';
  const DATE_END = 'YYYY-MM-DD_END';
  
  // Campaign Filters
  const TYPES_ALL = "'SEARCH', 'DISPLAY', 'VIDEO', 'PERFORMANCE_MAX', 'DEMAND_GEN', 'SHOPPING'";
  const TYPES_IS_ELIGIBLE = "'SEARCH', 'PERFORMANCE_MAX', 'SHOPPING'";

  Logger.log(`\n=== STARTING UNIFIED REPORT (CID: ${TEST_CID_RAW}) ===`);

  // --- LOCAL HELPERS ---
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

  const executeLocalQuery = (clientId, query, dateRange) => {
    let finalQuery = query;
    if (dateRange) {
      finalQuery = query.replace(DATE_START, dateRange.start).replace(DATE_END, dateRange.end);
    }
    const request = { customerId: clientId, query: finalQuery };
    const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
    return JSON.parse(responseJson).results || [];
  };

  // --- QUERIES ---

  // Q0: Currency
  const Q0_CURRENCY = `SELECT customer.currency_code FROM customer`;

  // Q1: Financials + Daily Budget (Universal)
  const Q1_FINANCIALS = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.advertising_channel_type,
      campaign.bidding_strategy_type,
      campaign_budget.amount_micros,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.clicks,
      metrics.impressions
    FROM
      campaign
    WHERE
      campaign.status = 'ENABLED' 
      AND campaign.advertising_channel_type IN (${TYPES_ALL})
      AND segments.date BETWEEN '${DATE_START}' AND '${DATE_END}'
  `;

  // Q2: Targets (Bidding Strategy Settings)
  const Q2_TARGETS = `
    SELECT
      campaign.id,
      campaign.target_cpa.target_cpa_micros,
      campaign.target_roas.target_roas,
      campaign.maximize_conversion_value.target_roas,
      campaign.maximize_conversions.target_cpa_micros
    FROM
      campaign
    WHERE
      campaign.status = 'ENABLED' 
      AND campaign.advertising_channel_type IN (${TYPES_ALL})
  `;

  // Q3: Impression Share (Search/PMax/Shopping Only)
  const Q3_IS_METRICS = `
    SELECT
      campaign.id,
      metrics.search_impression_share,
      metrics.search_budget_lost_impression_share,
      metrics.search_rank_lost_impression_share
    FROM
      campaign
    WHERE
      campaign.status = 'ENABLED' 
      AND campaign.advertising_channel_type IN (${TYPES_IS_ELIGIBLE})
      AND segments.date BETWEEN '${DATE_START}' AND '${DATE_END}'
  `;

  // Q4: Budget Status & Recs (Budget Constrained Only)
  // Includes both CampaignBudget fields AND Recommendation Forecasting fields via JOIN logic if needed,
  // but for this unified report, we stick to the reliable CampaignBudget resource fields.
  const Q4_BUDGET_RECS = `
    SELECT 
      campaign.id, 
      campaign_budget.has_recommended_budget,
      campaign_budget.recommended_budget_amount_micros,
      campaign_budget.recommended_budget_estimated_change_weekly_cost_micros
    FROM campaign 
    WHERE 
      campaign.status = 'ENABLED'
      AND campaign.primary_status_reasons CONTAINS ANY ('BUDGET_CONSTRAINED')
  `;

  // --- EXECUTION ---
  try {
    // 1. CID & Dates
    const cidTrimmed = String(TEST_CID_RAW).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    if (!extIds || !extIds[cidTrimmed]) throw new Error("CID Lookup Failed");
    const apiCid = extIds[cidTrimmed].replace(/-/g, '');
    const dates = getSafeDateRange();
    
    Logger.log(`> API CID: ${apiCid}`);
    Logger.log(`> Date Range: ${dates.start} to ${dates.end}`);

    // 2. Fetch Data (Cascading)
    
    // Currency
    const curRes = executeLocalQuery(apiCid, Q0_CURRENCY, null);
    const currency = curRes[0]?.customer?.currencyCode || 'EUR';

    // Financials (Base Map)
    Logger.log("Fetching Financials...");
    const resQ1 = executeLocalQuery(apiCid, Q1_FINANCIALS, dates);
    
    // Initialize Campaign Map
    const campaigns = new Map();
    resQ1.forEach(row => {
        campaigns.set(row.campaign.id, {
            name: row.campaign.name,
            type: row.campaign.advertisingChannelType,
            strategy: row.campaign.biddingStrategyType,
            budget: parseFloat(row.campaignBudget.amountMicros || 0),
            cost: parseFloat(row.metrics.costMicros || 0),
            conv: parseFloat(row.metrics.conversions || 0),
            val: parseFloat(row.metrics.conversionsValue || 0),
            clicks: parseFloat(row.metrics.clicks || 0),
            impr: parseFloat(row.metrics.impressions || 0),
            // Defaults
            targetType: '-', targetVal: 0,
            isShare: 0, lostBudget: 0, lostRank: 0,
            recAmount: 0, recCostIncrease: 0, isLimited: false
        });
    });

    // Targets
    Logger.log("Fetching Targets...");
    const resQ2 = executeLocalQuery(apiCid, Q2_TARGETS, null);
    resQ2.forEach(row => {
        const c = campaigns.get(row.campaign.id);
        if (c) {
            // ROAS Logic
            let roas = parseFloat(row.campaign.targetRoas?.targetRoas || 0);
            if (roas === 0) roas = parseFloat(row.campaign.maximizeConversionValue?.targetRoas || 0);
            if (roas > 0) { c.targetType = 'ROAS'; c.targetVal = roas; }

            // CPA Logic
            let cpa = parseFloat(row.campaign.targetCpa?.targetCpaMicros || 0);
            if (cpa === 0) cpa = parseFloat(row.campaign.maximizeConversions?.targetCpaMicros || 0);
            if (cpa > 0) { c.targetType = 'CPA'; c.targetVal = cpa / 1000000; }
        }
    });

    // IS Metrics
    Logger.log("Fetching IS Metrics...");
    const resQ3 = executeLocalQuery(apiCid, Q3_IS_METRICS, dates);
    resQ3.forEach(row => {
        const c = campaigns.get(row.campaign.id);
        if (c) {
            c.isShare = parseFloat(row.metrics.searchImpressionShare || 0);
            c.lostBudget = parseFloat(row.metrics.searchBudgetLostImpressionShare || 0);
            c.lostRank = parseFloat(row.metrics.searchRankLostImpressionShare || 0);
        }
    });

    // Budget Recs
    Logger.log("Fetching Budget Recommendations...");
    const resQ4 = executeLocalQuery(apiCid, Q4_BUDGET_RECS, null);
    resQ4.forEach(row => {
        const c = campaigns.get(row.campaign.id);
        if (c) {
            c.isLimited = true;
            if (row.campaignBudget.hasRecommendedBudget) {
                c.recAmount = parseFloat(row.campaignBudget.recommendedBudgetAmountMicros || 0);
                c.recCostIncrease = parseFloat(row.campaignBudget.recommendedBudgetEstimatedChangeWeeklyCostMicros || 0);
            }
        }
    });

    // --- 3. REPORT GENERATION & LOGGING ---
    Logger.log(`\n=== UNIFIED REPORT (${campaigns.size} Campaigns) ===`);

    campaigns.forEach(c => {
        // A. Budget Depletion
        const dailyBudget = c.budget / 1000000;
        const totalCost = c.cost / 1000000; // Standard Units
        let depletion = 0;
        if (dailyBudget > 0) {
            const avgDailySpend = totalCost / REPORT_DAYS;
            depletion = (avgDailySpend / dailyBudget) * 100;
        }

        // B. Target Status
        let targetStatus = "-";
        if (c.targetType === 'ROAS' && c.targetVal > 0) {
            // FIX: Use totalCost (Standard) for Calculation, NOT c.cost (Micros)
            const actualRoas = (totalCost > 0) ? (c.val / totalCost) : 0;
            
            // Round to 2 decimals
            const actR = Math.round((actualRoas + Number.EPSILON) * 100) / 100;
            const tgtR = Math.round((c.targetVal + Number.EPSILON) * 100) / 100;
            
            // ROAS: Higher is Better. (Actual >= Target)
            targetStatus = (actR >= tgtR) ? `YES (Act: ${actR} >= Tgt: ${tgtR})` : `NO (Act: ${actR} < Tgt: ${tgtR})`;
            
        } else if (c.targetType === 'CPA' && c.targetVal > 0) {
            // FIX: Use totalCost (Standard)
            const actualCpa = (c.conv > 0) ? (totalCost / c.conv) : 0;
            
            const actC = Math.round((actualCpa + Number.EPSILON) * 100) / 100;
            const tgtC = Math.round((c.targetVal + Number.EPSILON) * 100) / 100;
            
            // CPA: Lower is Better. (Actual <= Target)
            targetStatus = (c.conv > 0 && actC <= tgtC) ? `YES (Act: ${actC} <= Tgt: ${tgtC})` : `NO (Act: ${actC} > Tgt: ${tgtC})`;
        }

        // C. Missed Conversions (Funnel)
        let missedConv = "-";
        // Calculation is valid only if we have IS data and Budget Loss > 0
        if (c.isShare > 0 && c.lostBudget > 0 && c.impr > 0 && c.clicks > 0) {
             const totalMarketImpr = c.impr / c.isShare;
             const lostImpr = totalMarketImpr * c.lostBudget;
             const ctr = c.clicks / c.impr;
             const convRate = (c.conv > 0) ? (c.conv / c.clicks) : 0;
             
             const val = (lostImpr * ctr * convRate);
             missedConv = val.toFixed(2);
        }

        // D. Budget Rec String
        let recString = "-";
        if (c.isLimited) {
            if (c.recAmount > 0) {
                const recDaily = (c.recAmount / 1000000).toFixed(2);
                const incWeekly = (c.recCostIncrease / 1000000).toFixed(2);
                recString = `YES (Rec: ${currency} ${recDaily}/day | Est. +${currency} ${incWeekly}/week)`;
            } else {
                recString = "YES (Limited, but no specific amount from API)";
            }
        }

        // LOG OUTPUT
        Logger.log(`[${c.type}] "${c.name}"`);
        Logger.log(`   > Spend: ${currency} ${totalCost.toFixed(2)} (Depletion: ${depletion.toFixed(1)}%)`);
        Logger.log(`   > Target Met: ${targetStatus}`);
        Logger.log(`   > Missed Conv. (Budget): ${missedConv}`);
        Logger.log(`   > Budget Rec: ${recString}`);
        Logger.log('------------------------------------------------');
    });

  } catch (e) {
    Logger.log(`\nFATAL ERROR: ${e.message}`);
    Logger.log(e.stack);
  }
  Logger.log("\n=== REPORT GENERATION COMPLETE ===");
}