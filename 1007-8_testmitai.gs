/**
 * 100-6: Unified Campaign Performance & AI Pitch Generation.
 * - Strict Logic:
 * - Recommended Budget: Shows Value if exists, "Check in Google Ads" if limited but no value, "-" otherwise.
 * - Missed Conversions: "0.0" if calc is 0, "-" if not eligible.
 * - Strict type filtering for Video/Display/DemandGen (no IS metrics).
 */
function testUnifiedCampaignReportWithAI() {
  
  const TEST_CID_RAW = '14677774'; 
  const REPORT_DAYS = 7;

  // --- CONSTANTS ---
  const DATE_START = 'YYYY-MM-DD_START';
  const DATE_END = 'YYYY-MM-DD_END';
  
  const TYPES_ALL = "'SEARCH', 'DISPLAY', 'VIDEO', 'PERFORMANCE_MAX', 'DEMAND_GEN', 'SHOPPING'";
  
  // Types eligible for IS Metrics AND Missed Conversion Calculation
  const TYPES_FOR_CALCULATION = ['SEARCH', 'PERFORMANCE_MAX', 'SHOPPING']; 
  const TYPES_IS_QUERY = "'SEARCH', 'PERFORMANCE_MAX', 'SHOPPING'";

  Logger.log(`\n=== STARTING AI PITCH TEST (CID: ${TEST_CID_RAW}) ===`);

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
  const Q0_CURRENCY = `SELECT customer.currency_code FROM customer`;

  const Q1_FINANCIALS = `
    SELECT
      campaign.id, campaign.name, campaign.advertising_channel_type, campaign.bidding_strategy_type,
      campaign.primary_status, campaign.primary_status_reasons,
      campaign_budget.amount_micros, metrics.cost_micros, metrics.conversions, metrics.conversions_value,
      metrics.clicks, metrics.impressions
    FROM campaign
    WHERE campaign.status = 'ENABLED' AND campaign.advertising_channel_type IN (${TYPES_ALL})
    AND segments.date BETWEEN '${DATE_START}' AND '${DATE_END}'
  `;

  const Q2_TARGETS = `
    SELECT campaign.id, campaign.target_cpa.target_cpa_micros, campaign.target_roas.target_roas,
    campaign.maximize_conversion_value.target_roas, campaign.maximize_conversions.target_cpa_micros
    FROM campaign WHERE campaign.status = 'ENABLED' AND campaign.advertising_channel_type IN (${TYPES_ALL})
  `;

  const Q3_IS_METRICS = `
    SELECT campaign.id, metrics.search_impression_share, metrics.search_budget_lost_impression_share,
    metrics.search_rank_lost_impression_share
    FROM campaign WHERE campaign.status = 'ENABLED' AND campaign.advertising_channel_type IN (${TYPES_IS_QUERY})
    AND segments.date BETWEEN '${DATE_START}' AND '${DATE_END}'
  `;

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
    const dates = getSafeDateRange();
    
    Logger.log(`> API CID: ${apiCid}`);

    // 1. Fetch Data
    const curRes = executeLocalQuery(apiCid, Q0_CURRENCY, null);
    const currency = curRes[0]?.customer?.currencyCode || 'EUR';
    
    const resQ1 = executeLocalQuery(apiCid, Q1_FINANCIALS, dates);
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
    const resQ2 = executeLocalQuery(apiCid, Q2_TARGETS, null);
    resQ2.forEach(row => {
        const c = campaigns.get(row.campaign.id);
        if (c) {
            let roas = parseFloat(row.campaign.targetRoas?.targetRoas || 0);
            if (roas === 0) roas = parseFloat(row.campaign.maximizeConversionValue?.targetRoas || 0);
            if (roas > 0) { c.targetType = 'ROAS'; c.targetVal = roas; }

            let cpa = parseFloat(row.campaign.targetCpa?.targetCpaMicros || 0);
            if (cpa === 0) cpa = parseFloat(row.campaign.maximizeConversions?.targetCpaMicros || 0);
            if (cpa > 0) { c.targetType = 'CPA'; c.targetVal = cpa / 1000000; }
        }
    });

    // Merge IS
    const resQ3 = executeLocalQuery(apiCid, Q3_IS_METRICS, dates);
    resQ3.forEach(row => {
        const c = campaigns.get(row.campaign.id);
        if (c) {
            c.isShare = parseFloat(row.metrics.searchImpressionShare || 0);
            c.lostBudget = parseFloat(row.metrics.searchBudgetLostImpressionShare || 0);
            c.lostRank = parseFloat(row.metrics.searchRankLostImpressionShare || 0);
        }
    });

    // Merge Recs
    const resQ4 = executeLocalQuery(apiCid, Q4_BUDGET_RECS, null);
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
        
        // 1. Eligibility Checks
        const isEligibleType = TYPES_FOR_CALCULATION.includes(c.type);
        const hasConvData = c.conv > 0;

        // --- CALCULATIONS ---
        let depletion = 0;
        if (c.budget > 0) depletion = ((c.cost / REPORT_DAYS) / c.budget) * 100;

        // Target Status
        let targetStatus = "No Target";
        if (!hasConvData && (c.targetType === 'ROAS' || c.targetType === 'CPA')) {
            targetStatus = "-";
        } else {
            if (c.targetType === 'ROAS') {
                 const actR = (c.cost > 0) ? (c.val / c.cost) : 0;
                 targetStatus = (actR >= c.targetVal) ? "Target Met" : "Target Missed";
            } else if (c.targetType === 'CPA') {
                 const actC = (c.conv > 0) ? (c.cost / c.conv) : 0;
                 targetStatus = (actC <= c.targetVal) ? "Target Met" : "Target Missed";
            }
        }

        // Missed Conversions Logic
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

        // --- BUDGET RECOMMENDATION LOGIC (UPDATED) ---
        // Default: "-"
        let recBudgetStr = "-";
        
        // Priority 1: Actual API Recommendation exists (wins over everything)
        if (c.recAmount > 0) {
             recBudgetStr = `${currency} ${c.recAmount.toFixed(2)}`;
        } 
        // Priority 2: Limited status, but NO API value
        else if (c.isLimited) {
             recBudgetStr = "Check in Google Ads";
        }
        // Priority 3: Not limited -> remains "-"

        // IS Metrics Strings
        const impressionShareStr = isEligibleType ? (c.isShare * 100).toFixed(1) + "%" : "-";
        const lostIsBudgetStr = isEligibleType ? (c.lostBudget * 100).toFixed(1) + "%" : "-";
        const lostIsRankStr = isEligibleType ? (c.lostRank * 100).toFixed(1) + "%" : "-";

        // --- FILTER FOR AI ---
        if (c.isLimited || depletion > 85 || numericMissed > 1) {
            campaignsToAnalyze.push({
                CampaignName: c.name,
                CampaignType: c.type,
                Status: c.isLimited ? "Limited by Budget" : "Eligible",
                CurrentBudget: `${currency} ${c.budget.toFixed(2)}`,
                Depletion7Day: depletion.toFixed(1) + "%",
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
    1. **DATEN-INTERPRETATION:** - Wert "-": Keine Daten verf?gbar (nicht erw?hnen).
       - Wert "0.0" (MissedConversions): Bedeutet rechnerisch kein Verlust trotz Limitierung.
       - Wert "Check in Google Ads": Schreibe "Manuelle Pr?fung empfohlen".
       - Wert "EUR ...": Dies ist die konkrete Empfehlung, die genannt werden soll.
    2. **PFLICHT-?BERSETZUNGEN:**
       - "Limited by Budget" -> "durch das Budget eingeschr?nkt"
       - "LostIS_Budget" -> "Anteil entgangener Impressionen (Budget)"
       - "Target Met" -> "Ziel erreicht"
    3. **NICHT** verwenden: "Depletion", "Efficiency Scale", "Missed".

    BEISPIEL OUTPUT:
    <ul>
    <li><b>"Search Brand"</b> ist durch das Budget eingeschr?nkt. Es entgehen rechnerisch ca. 5.2 Conversions. Empfehlung: Erh?hung auf <b>EUR 50.00</b>.</li>
    <li><b>"Shopping Top"</b> ist eingeschr?nkt, jedoch gehen rechnerisch aktuell keine Conversions (0.0) verloren. Wir empfehlen eine manuelle Pr?fung.</li>
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