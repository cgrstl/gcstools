/**
 * 100-6: Unified Campaign Performance & AI Pitch Generation.
 * VERSION: Date-Range Update (Native GAQL).
 * * CONFIGURATION:
 * - Set TIME_RANGE to 'LAST_7_DAYS', 'LAST_14_DAYS', or 'LAST_30_DAYS'.
 */
function testUnifiedCampaignReportWithAI() {
  
  const TEST_CID_RAW = '6662487282'; 
  
  // --- CONFIGURATION ---
  // Options: 'LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS'
  const TIME_RANGE = 'LAST_30_DAYS'; 

  // --- DYNAMIC CONSTANTS ---
  // Automatically set the divisor for depletion calculation based on the range
  let reportDays = 7;
  if (TIME_RANGE === 'LAST_14_DAYS') reportDays = 14;
  if (TIME_RANGE === 'LAST_30_DAYS') reportDays = 30;

  const TYPES_ALL = "'SEARCH', 'DISPLAY', 'VIDEO', 'PERFORMANCE_MAX', 'DEMAND_GEN', 'SHOPPING'";
  const TYPES_FOR_CALCULATION = ['SEARCH', 'PERFORMANCE_MAX', 'SHOPPING']; 
  const TYPES_IS_QUERY = "'SEARCH', 'PERFORMANCE_MAX', 'SHOPPING'";

  Logger.log(`\n=== STARTING AI PITCH TEST (CID: ${TEST_CID_RAW}) ===`);
  Logger.log(`> Time Range: ${TIME_RANGE} (Calculating Depletion for ${reportDays} days)`);

  // --- LOCAL HELPERS ---
  const executeLocalQuery = (clientId, query) => {
    const request = { customerId: clientId, query: query };
    const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
    return JSON.parse(responseJson).results || [];
  };

  // --- QUERIES (Using Native DURING Clause) ---
  
  const Q0_CURRENCY = `SELECT customer.currency_code FROM customer`;

  // Q1: Financials & Metrics (Needs Date Range)
  const Q1_FINANCIALS = `
    SELECT
      campaign.id, campaign.name, campaign.advertising_channel_type, campaign.bidding_strategy_type,
      campaign.primary_status, campaign.primary_status_reasons,
      campaign_budget.amount_micros, metrics.cost_micros, metrics.conversions, metrics.conversions_value,
      metrics.clicks, metrics.impressions
    FROM campaign
    WHERE campaign.status = 'ENABLED' AND campaign.advertising_channel_type IN (${TYPES_ALL})
    AND segments.date DURING ${TIME_RANGE}
  `;

  // Q2: Strategy & Targets (Attribute Level - No Date Range needed usually, represents current settings)
  const Q2_TARGETS = `
    SELECT campaign.id, 
    campaign.target_cpa.target_cpa_micros, 
    campaign.target_roas.target_roas,
    campaign.maximize_conversion_value.target_roas, 
    campaign.maximize_conversions.target_cpa_micros
    FROM campaign WHERE campaign.status = 'ENABLED' AND campaign.advertising_channel_type IN (${TYPES_ALL})
  `;

  // Q3: Impression Share Metrics (Needs Date Range)
  const Q3_IS_METRICS = `
    SELECT campaign.id, metrics.search_impression_share, metrics.search_budget_lost_impression_share,
    metrics.search_rank_lost_impression_share
    FROM campaign WHERE campaign.status = 'ENABLED' AND campaign.advertising_channel_type IN (${TYPES_IS_QUERY})
    AND segments.date DURING ${TIME_RANGE}
  `;

  // Q4: Budget Recommendations (Current Status - No Date Range)
  const Q4_BUDGET_RECS = `
    SELECT campaign.id, campaign_budget.has_recommended_budget, campaign_budget.recommended_budget_amount_micros,
    campaign_budget.recommended_budget_estimated_change_weekly_cost_micros
    FROM campaign WHERE campaign.status = 'ENABLED' AND campaign.primary_status_reasons CONTAINS ANY ('BUDGET_CONSTRAINED')
  `;

  // --- MAIN EXECUTION ---
  try {
    const cidTrimmed = String(TEST_CID_RAW).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    const apiCid = extIds[cidTrimmed].replace(/-/g, '');
    
    Logger.log(`> API CID: ${apiCid}`);

    // 1. Fetch Data
    const curRes = executeLocalQuery(apiCid, Q0_CURRENCY);
    const currency = curRes[0]?.customer?.currencyCode || 'EUR';
    
    const resQ1 = executeLocalQuery(apiCid, Q1_FINANCIALS);
    const campaigns = new Map();
    
    resQ1.forEach(row => {
        const reasons = row.campaign.primaryStatusReasons || [];
        const isStatusLimited = reasons.includes('BUDGET_CONSTRAINED');

        campaigns.set(row.campaign.id, {
            name: row.campaign.name,
            type: row.campaign.advertisingChannelType,
            strategy: row.campaign.biddingStrategyType,
            budget: parseFloat(row.campaignBudget.amountMicros || 0) / 1000000,
            cost: parseFloat(row.metrics.costMicros || 0) / 1000000,
            conv: parseFloat(row.metrics.conversions || 0),
            val: parseFloat(row.metrics.conversionsValue || 0),
            clicks: parseFloat(row.metrics.clicks || 0),
            impr: parseFloat(row.metrics.impressions || 0),
            targetType: '-', targetVal: 0, 
            isShare: 0, lostBudget: 0, lostRank: 0,
            recAmount: 0, isLimited: isStatusLimited
        });
    });

    // Merge Targets
    const resQ2 = executeLocalQuery(apiCid, Q2_TARGETS);
    resQ2.forEach(row => {
        const c = campaigns.get(row.campaign.id);
        if (c) {
            // --- ROAS DETECTION (Universal) ---
            const standardRoas = parseFloat(row.campaign.targetRoas?.targetRoas || 0);
            const maxValRoas = parseFloat(row.campaign.maximizeConversionValue?.targetRoas || 0);

            if (standardRoas > 0) {
                c.targetType = 'ROAS'; c.targetVal = standardRoas; 
            } else if (maxValRoas > 0) {
                c.targetType = 'ROAS'; c.targetVal = maxValRoas;
            }

            // --- CPA DETECTION (Universal) ---
            if (c.targetType === '-') {
                const standardCpa = parseFloat(row.campaign.targetCpa?.targetCpaMicros || 0);
                const maxConvCpa = parseFloat(row.campaign.maximizeConversions?.targetCpaMicros || 0);

                if (standardCpa > 0) {
                    c.targetType = 'CPA'; c.targetVal = standardCpa / 1000000;
                } else if (maxConvCpa > 0) {
                    c.targetType = 'CPA'; c.targetVal = maxConvCpa / 1000000;
                }
            }
        }
    });

    // Merge IS
    const resQ3 = executeLocalQuery(apiCid, Q3_IS_METRICS);
    resQ3.forEach(row => {
        const c = campaigns.get(row.campaign.id);
        if (c) {
            c.isShare = parseFloat(row.metrics.searchImpressionShare || 0);
            c.lostBudget = parseFloat(row.metrics.searchBudgetLostImpressionShare || 0);
            c.lostRank = parseFloat(row.metrics.searchRankLostImpressionShare || 0);
        }
    });

    // Merge Recs
    const resQ4 = executeLocalQuery(apiCid, Q4_BUDGET_RECS);
    resQ4.forEach(row => {
        const c = campaigns.get(row.campaign.id);
        if (c) {
            c.isLimited = true;
            if (row.campaignBudget.hasRecommendedBudget) {
                c.recAmount = parseFloat(row.campaignBudget.recommendedBudgetAmountMicros || 0) / 1000000;
            }
        }
    });

    // --- 2. PREPARE DATA FOR AI ---
    const campaignsToAnalyze = [];

    campaigns.forEach(c => {
        
        const isEligibleType = TYPES_FOR_CALCULATION.includes(c.type);
        const hasConvData = c.conv > 0;

        // --- CALCULATIONS ---
        // DYNAMIC DEPLETION: Uses 'reportDays' (7, 14, or 30)
        let depletion = 0;
        if (c.budget > 0) depletion = ((c.cost / reportDays) / c.budget) * 100;

        // --- TARGET STATUS ---
        let targetStatus = "-";
        if (hasConvData && c.targetType !== '-') {
            if (c.targetType === 'ROAS') {
                 const actR = (c.cost > 0) ? (c.val / c.cost) : 0;
                 targetStatus = (actR >= c.targetVal) ? "Target Met" : "Target Missed";
            } else if (c.targetType === 'CPA') {
                 const actC = (c.conv > 0) ? (c.cost / c.conv) : 0;
                 targetStatus = (actC <= c.targetVal) ? "Target Met" : "Target Missed";
            }
        }

        // --- STATUS ---
        const statusStr = c.isLimited ? "Limited by Budget" : "-";

        // --- MISSED CONVERSIONS ---
        let missedConvStr = "-";
        let numericMissed = 0;
        
        if (isEligibleType && hasConvData && c.isShare > 0 && c.impr > 0 && c.clicks > 0) {
             const totalImpr = c.impr / c.isShare;
             const lostImpr = totalImpr * c.lostBudget;
             const ctr = c.clicks / c.impr;
             const convRate = c.conv / c.clicks; 
             
             const calcMissed = (lostImpr * ctr * convRate);
             numericMissed = calcMissed;
             missedConvStr = calcMissed.toFixed(1);
        }

        // --- RECOMMENDED BUDGET ---
        let recBudgetStr = "-";
        if (c.recAmount > 0) {
             recBudgetStr = `${currency} ${c.recAmount.toFixed(2)}`;
        } else if (c.isLimited) {
             recBudgetStr = "Check in Google Ads";
        }

        // --- IS METRICS ---
        const impressionShareStr = isEligibleType ? (c.isShare * 100).toFixed(1) + "%" : "-";
        const lostIsBudgetStr = isEligibleType ? (c.lostBudget * 100).toFixed(1) + "%" : "-";
        const lostIsRankStr = isEligibleType ? (c.lostRank * 100).toFixed(1) + "%" : "-";

        // --- FILTER FOR AI ---
        // Note: Depletion check now respects the selected time range math
        if (c.isLimited || depletion > 85 || numericMissed > 1) {
            campaignsToAnalyze.push({
                CampaignName: c.name,
                CampaignType: c.type,
                Status: statusStr,
                CurrentBudget: `${currency} ${c.budget.toFixed(2)}`,
                Depletion: depletion.toFixed(1) + "%", // Removed "7Day" from label as it varies now
                TimeRange: TIME_RANGE, // Added to JSON so AI knows the context
                TargetStatus: targetStatus, 
                ImpressionShare: impressionShareStr, 
                LostIS_Budget: lostIsBudgetStr,
                LostIS_Rank: lostIsRankStr,
                MissedConversions_Est: missedConvStr,
                RecommendedBudget_API: recBudgetStr
            });
        }
    });

    Logger.log(`\nSending ${campaignsToAnalyze.length} campaigns to Gemini AI for analysis...`);
    
    // --- 3. CALL AI ---
    if (campaignsToAnalyze.length > 0) {
        Logger.log("\n=== DATA SENT TO AI (JSON) ===");
        Logger.log(JSON.stringify(campaignsToAnalyze, null, 2)); 

        const aiResponse = callGeminiAI_(campaignsToAnalyze);
        Logger.log("\n=== GEMINI RECOMMENDATION ===\n");
        Logger.log(aiResponse);
    } else {
        Logger.log("No campaigns met the criteria for AI analysis.");
    }

  } catch (e) {
    Logger.log(`\nFATAL ERROR: ${e.message}`);
    Logger.log(e.stack);
  }
}

/**
 * Helper to call Gemini API.
 */
function callGeminiAI_(campaignData) {
  const API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!API_KEY) return "ERROR: 'GEMINI_API_KEY' missing.";

  const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

  const prompt = `
    DU BIST: Ein Senior Google Ads Daten-Analyst.
    DEINE AUFGABE: Erstelle eine pr?gnante, professionelle Budget-Analyse f?r eine E-Mail an einen Kunden.

    INPUT DATEN:
    ${JSON.stringify(campaignData, null, 2)}

    TECHNISCHE FORMATIERUNG (WICHTIG F?R GMAIL):
    1. Gib **ausschlie?lich** ein HTML-Fragment zur?ck (kein \`\`\`html Block, kein <body>).
    2. Nutze eine ungeordnete Liste: <ul> f?r den Container, <li> f?r die Punkte.
    3. Nutze KEIN Markdown (keine **Sternchen**). Nutze <b> f?r Fettdruck.

    SPRACHREGELUNG & LOGIK:
    1. **DATEN-INTERPRETATION:** - Wenn ein Feld "-" enth?lt: **Ignoriere dieses Feld komplett.**
       - Wenn Status = "-": Erw?hne den Status nicht (fokussiere dich auf Auslastung oder Empfehlungen).
       - Wenn TargetStatus = "-": Sprich nicht ?ber Ziele/Targets.
       - Wert "Check in Google Ads": Schreibe "Manuelle Pr?fung empfohlen".
       - Achte auf das Feld "TimeRange" in den Daten (z.B. LAST_7_DAYS oder LAST_30_DAYS) und beziehe dich ggf. darauf ("in den letzten 30 Tagen...").
    2. **PFLICHT-?BERSETZUNGEN:**
       - "Limited by Budget" -> "durch das Budget eingeschr?nkt"
       - "LostIS_Budget" -> "Anteil entgangener Impressionen (Budget)"
       - "Target Met" -> "Ziel erreicht"
    3. **NICHT** verwenden: "Depletion", "Efficiency Scale", "Missed", "Eligible".

    BEISPIEL OUTPUT:
    <ul>
    <li><b>"Search Brand"</b> ist durch das Budget eingeschr?nkt. In den letzten 7 Tagen entgingen uns rechnerisch ca. 5.2 Conversions. Empfehlung: Erh?hung auf <b>EUR 50.00</b>.</li>
    <li>Bei <b>"Shopping Top"</b> ist das Budget vollst?ndig ausgelastet. Da kein explizites Ziel (tROAS) definiert ist, empfehlen wir eine manuelle Pr?fung des Budgets.</li>
    </ul>
  `;

  const payload = {
    contents: [{
      parts: [{ text: prompt }]
    }]
  };

  try {
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(ENDPOINT, options);
    const json = JSON.parse(response.getContentText());
    
    if (json.candidates && json.candidates.length > 0) {
      let text = json.candidates[0].content.parts[0].text;
      text = text.replace(/```html/g, "").replace(/```/g, "").trim();
      return text;
    } else {
      return `AI Error: ${JSON.stringify(json)}`;
    }
  } catch (e) {
    return `AI Connection Failed: ${e.message}`;
  }
}