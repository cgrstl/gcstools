/**
 * 100-6: Unified Campaign Performance & AI Pitch Generation.
 * - Fetches & Calculates all metrics.
 * - Strict Logic: No Missed Conv calculation for Video/Display/DemandGen.
 * - Strict Logic: No Missed Conv calculation for Search/Pmax/Shopping if Conv = 0.
 */
function testUnifiedCampaignReportWithAI() {
  
  const TEST_CID_RAW = '14677774'; 
  const REPORT_DAYS = 7;

  // --- CONSTANTS ---
  const DATE_START = 'YYYY-MM-DD_START';
  const DATE_END = 'YYYY-MM-DD_END';
  
  // Alle Typen f?r den Financial Abruf
  const TYPES_ALL = "'SEARCH', 'DISPLAY', 'VIDEO', 'PERFORMANCE_MAX', 'DEMAND_GEN', 'SHOPPING'";
  
  // Nur diese Typen d?rfen IS-Metriken haben und Missed Conversions berechnen
  // Video, Display, Demand Gen sind hier explizit NICHT enthalten.
  const TYPES_FOR_CALCULATION = ['SEARCH', 'PERFORMANCE_MAX', 'SHOPPING']; 
  
  // SQL Filter f?r IS Abruf
  const TYPES_IS_QUERY = "'SEARCH', 'PERFORMANCE_MAX', 'SHOPPING'";

  Logger.log(`\n=== STARTING AI PITCH TEST (CID: ${TEST_CID_RAW}) ===`);

  // --- LOCAL HELPERS (Data Fetching) ---
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

    // 1. Fetch All Data
    const curRes = executeLocalQuery(apiCid, Q0_CURRENCY, null);
    const currency = curRes[0]?.customer?.currencyCode || 'EUR';
    
    const resQ1 = executeLocalQuery(apiCid, Q1_FINANCIALS, dates);
    const campaigns = new Map();
    
    // Build Base Map
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
        
        // --- STRICT LOGIC GATES ---
        
        // 1. Check Campaign Type (Whitelist: Search, PMax, Shopping ONLY)
        // This automatically excludes Video, Display, Demand Gen from Calculations
        const isEligibleType = TYPES_FOR_CALCULATION.includes(c.type);
        
        // 2. Check Data Integrity (Must have conversions to calc missed opps)
        const hasConvData = c.conv > 0;

        // --- CALCULATIONS ---
        let depletion = 0;
        if (c.budget > 0) depletion = ((c.cost / REPORT_DAYS) / c.budget) * 100;

        // Target Status Logic
        let targetStatus = "No Target";
        // Logic: If no conversions, we can't honestly say "Target Missed" for CPA/ROAS.
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

        // Missed Conversions Logic (STRICT)
        let missedConvStr = "-";
        let numericMissed = 0; // For AI trigger logic only
        
        // HARD CHECK: 
        // 1. Must be Eligible Type (No Video/Display) 
        // 2. AND Must have conversions (No Div/0)
        // 3. AND Must have IS Lost Budget > 0
        if (isEligibleType && hasConvData && c.isShare > 0 && c.lostBudget > 0 && c.impr > 0 && c.clicks > 0) {
             const totalImpr = c.impr / c.isShare;
             const lostImpr = totalImpr * c.lostBudget;
             const ctr = c.clicks / c.impr;
             const convRate = c.conv / c.clicks; 
             
             const calcMissed = (lostImpr * ctr * convRate);
             numericMissed = calcMissed;
             missedConvStr = calcMissed.toFixed(1);
        }

        // Rec Budget Logic
        let recBudgetStr = "N/A";
        if (c.isLimited) {
            if (c.recAmount > 0) {
                recBudgetStr = `${currency} ${c.recAmount.toFixed(2)}`;
            } else {
                recBudgetStr = "Check in Google Ads";
            }
        }

        // IS Metrics Strings
        // If type is not eligible (e.g. Video), we force "-" even if API returned something weird
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
    1. **DATEN-INTERPRETATION:** - Wenn ein Wert "-" ist, bedeutet das "Keine Daten verf?gbar". Erfinde hier keine Zahlen.
       - Wenn MissedConversions_Est = "-", darfst du KEINE entgangenen Conversions erw?hnen.
       - Bei "Check in Google Ads" (RecommendedBudget): Schreibe "Manuelle Pr?fung empfohlen".
    2. **PFLICHT-?BERSETZUNGEN:**
       - "Limited by Budget" -> "durch das Budget eingeschr?nkt"
       - "LostIS_Budget" -> "Anteil entgangener Impressionen (Budget)"
       - "Target Met" -> "Ziel erreicht"
    3. **NICHT** verwenden: "Depletion", "Efficiency Scale", "Missed".

    BEISPIEL OUTPUT:
    <ul>
    <li><b>"Search Brand"</b> ist durch das Budget eingeschr?nkt. Es entgehen rechnerisch ca. 5.2 Conversions. Empfehlung: Erh?hung auf <b>EUR 50.00</b>.</li>
    <li><b>"Video Awareness"</b> (Video) ist stark eingeschr?nkt. Da hier keine Conversion-Daten vorliegen, empfehlen wir, das Budget schrittweise zu erh?hen, um die Reichweite zu testen. System-Empfehlung: Manuelle Pr?fung empfohlen.</li>
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