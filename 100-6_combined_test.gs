/**
 * 100-6: Unified Campaign Performance & AI Pitch Generation.
 * - Fetches & Calculates all metrics (Financials, Targets, IS, Budget Recs).
 * - Sends structured data to Gemini AI using the Secure Property Key.
 * - Generates a "Pitch-Perfect" recommendation log using AI.
 */
function testUnifiedCampaignReportWithAI() {
  
  const TEST_CID_RAW = '6662487282'; 
  const REPORT_DAYS = 7;

  // --- CONSTANTS ---
  const DATE_START = 'YYYY-MM-DD_START';
  const DATE_END = 'YYYY-MM-DD_END';
  const TYPES_ALL = "'SEARCH', 'DISPLAY', 'VIDEO', 'PERFORMANCE_MAX', 'DEMAND_GEN', 'SHOPPING'";
  const TYPES_IS_ELIGIBLE = "'SEARCH', 'PERFORMANCE_MAX', 'SHOPPING'";

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

  // --- QUERIES (Standard 100-6 Set) ---
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
    FROM campaign WHERE campaign.status = 'ENABLED' AND campaign.advertising_channel_type IN (${TYPES_IS_ELIGIBLE})
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
        // Calculate Stats
        let depletion = 0;
        if (c.budget > 0) depletion = ((c.cost / REPORT_DAYS) / c.budget) * 100;

        let targetStatus = "No Target";
        if (c.targetType === 'ROAS') {
             const actR = (c.cost > 0) ? (c.val / c.cost) : 0;
             const rAct = Math.round((actR + Number.EPSILON) * 100) / 100;
             const rTgt = Math.round((c.targetVal + Number.EPSILON) * 100) / 100;
             targetStatus = (rAct >= rTgt) ? "Target Met" : "Target Missed";
        } else if (c.targetType === 'CPA') {
             const actC = (c.conv > 0) ? (c.cost / c.conv) : 0;
             const rAct = Math.round((actC + Number.EPSILON) * 100) / 100;
             const rTgt = Math.round((c.targetVal + Number.EPSILON) * 100) / 100;
             targetStatus = (c.conv > 0 && rAct <= rTgt) ? "Target Met" : "Target Missed";
        }

        let missedConv = 0;
        if (c.isShare > 0 && c.lostBudget > 0 && c.impr > 0 && c.clicks > 0) {
             const totalImpr = c.impr / c.isShare;
             const lostImpr = totalImpr * c.lostBudget;
             const ctr = c.clicks / c.impr;
             const convRate = (c.conv > 0) ? (c.conv / c.clicks) : 0;
             missedConv = (lostImpr * ctr * convRate);
        }

        // Only send interesting campaigns to AI
        if (c.isLimited || depletion > 85 || missedConv > 1) {
            campaignsToAnalyze.push({
                CampaignName: c.name,
                CampaignType: c.type,
                Status: c.isLimited ? "Limited by Budget" : "Eligible",
                CurrentBudget: `${currency} ${c.budget.toFixed(2)}`,
                Depletion7Day: depletion.toFixed(1) + "%",
                TargetStatus: targetStatus,
                MissedConversions_Est: missedConv > 0 ? missedConv.toFixed(1) : "None",
                RecommendedBudget_API: c.recAmount > 0 ? `${currency} ${c.recAmount.toFixed(2)}` : "N/A",
                // Metrics for Logic
                LostIS_Budget: (c.lostBudget * 100).toFixed(1) + "%",
                LostIS_Rank: (c.lostRank * 100).toFixed(1) + "%"
            });
        }
    });

    Logger.log(`\nSending ${campaignsToAnalyze.length} campaigns to Gemini AI for analysis...`);
    
    // --- 3. CALL AI ---
    if (campaignsToAnalyze.length > 0) {
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
 * Helper to call Gemini API (German Analyst Persona).
 * FIX: Generates clean HTML (ul/li) compatible with Gmail formatting.
 * FIX: Removes Markdown, uses HTML tags for bolding.
 * FIX: Prevents redundancy ("Wir verlieren entgangene...").
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
    4. Nutze KEINE Schriftarten-Stile (kein style="font-family..."). Der Text muss sich dem E-Mail-Layout anpassen.

    SPRACHREGELUNG (WICHTIG):
    - "Limited by Budget" -> "durch das Budget eingeschr?nkt"
    - "LostIS_Budget" -> "Anteil entgangener Impressionen aufgrund des Budgets"
    - "Target Met" -> "Ziel erreicht"
    - "RecommendedBudget" -> "empfohlene Tagesbudget"

    REGELN F?R DEN INHALT:
    1. **Abwechslung:** Variiere den Satzbau. Vermeide es, jeden Punkt identisch zu beginnen ("Die Kampagne...").
    2. **Keine Redundanz:** Schreibe NIEMALS "Wir verlieren entgangene Conversions". Das ist doppelt gemoppelt. 
       - RICHTIG: "Uns entgehen rechnerisch ca. [X] Conversions" oder "Das ungenutzte Potenzial liegt bei [X] Conversions".
    3. **Clustering:** Fasse Kampagnen mit gleicher Situation logisch zusammen.
    4. **Tonalit?t:** Neutral, analytisch, l?sungsorientiert.

    ANALYSE-PRIORIT?TEN:
    
    1. **Prio 1 (Effizienz-Skalierung):**
       - Wenn: Target Met = JA UND (Status = Limited ODER Depletion > 90%).
       - Strategie: Betone, dass die Kampagne effizient l?uft, aber vom Budget limitiert wird. Nenne die "entgangenen Conversions" und den "Anteil entgangener Impressionen aufgrund des Budgets". Schlage die Erh?hung auf das <b>[RecommendedBudget]</b> vor.

    2. **Prio 2 (Wachstums-Potenzial):**
       - Wenn: Target = "No Target" UND Limited.
       - Strategie: Weise auf die starke Nachfrage hin, die das aktuelle Budget ?bersteigt. Empfiehl einen Test mit h?herem Budget, um das Volumen zu pr?fen.

    3. **Prio 3 (Kapazit?ts-Warnung):**
       - Wenn: Depletion > 85% (aber nicht limited).
       - Strategie: Hinweis auf hohe Auslastung nahe der Kapazit?tsgrenze.

    BEISPIEL OUTPUT (Stil-Referenz):
    <ul>
    <li>Die Kampagnen <b>"Shopping"</b> und <b>"Generic Search"</b> arbeiten hocheffizient im Zielkorridor, sto?en jedoch t?glich an ihr Limit. Aktuell entgehen uns hierdurch rechnerisch ca. 20 Conversions pro Woche (Anteil entgangener Impressionen aufgrund des Budgets: 52%). Um dieses Potenzial voll auszusch?pfen, empfehlen wir eine Anhebung auf <b>EUR 1500.00</b>.</li>
    <li>Bei <b>"Demand Gen"</b> sehen wir eine extrem hohe Nachfrage, die das Budget von <b>EUR 200.00</b> vollst?ndig auslastet. Eine Anpassung w?rde helfen, die Sichtbarkeit an starken Tagen zu sichern.</li>
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