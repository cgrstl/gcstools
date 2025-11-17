/**
 * 100-6: Unified Campaign Performance & AI Pitch Generation.
 * VERSION: "CLEAN JSON EDITION"
 * * FIX: Removed internal helper '_sortKey' from final JSON output.
 */
function testUnifiedCampaignReportWithAI() {
  
  const TEST_CID_RAW = '6662487282'; 
  const TIME_RANGE = 'LAST_7_DAYS'; // Options: LAST_7_DAYS, LAST_14_DAYS, LAST_30_DAYS

  // --- DYNAMIC CONSTANTS ---
  let reportDays = 7;
  if (TIME_RANGE === 'LAST_14_DAYS') reportDays = 14;
  if (TIME_RANGE === 'LAST_30_DAYS') reportDays = 30;

  const TYPES_ALL = "'SEARCH', 'DISPLAY', 'VIDEO', 'PERFORMANCE_MAX', 'DEMAND_GEN', 'SHOPPING'";
  const TYPES_FOR_CALCULATION = ['SEARCH', 'PERFORMANCE_MAX', 'SHOPPING']; 
  const TYPES_IS_QUERY = "'SEARCH', 'PERFORMANCE_MAX', 'SHOPPING'";

  Logger.log(`\n=== STARTING AI PITCH TEST (CID: ${TEST_CID_RAW}) ===`);

  // --- LOCAL HELPERS ---
  const executeLocalQuery = (clientId, query) => {
    const request = { customerId: clientId, query: query };
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
    AND segments.date DURING ${TIME_RANGE}
  `;

  const Q2_TARGETS = `
    SELECT campaign.id, 
    campaign.target_cpa.target_cpa_micros, 
    campaign.target_roas.target_roas,
    campaign.maximize_conversion_value.target_roas, 
    campaign.maximize_conversions.target_cpa_micros
    FROM campaign WHERE campaign.status = 'ENABLED' AND campaign.advertising_channel_type IN (${TYPES_ALL})
  `;

  const Q3_IS_METRICS = `
    SELECT campaign.id, metrics.search_impression_share, metrics.search_budget_lost_impression_share,
    metrics.search_rank_lost_impression_share
    FROM campaign WHERE campaign.status = 'ENABLED' AND campaign.advertising_channel_type IN (${TYPES_IS_QUERY})
    AND segments.date DURING ${TIME_RANGE}
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
            const standardRoas = parseFloat(row.campaign.targetRoas?.targetRoas || 0);
            const maxValRoas = parseFloat(row.campaign.maximizeConversionValue?.targetRoas || 0);
            if (standardRoas > 0) { c.targetType = 'ROAS'; c.targetVal = standardRoas; } 
            else if (maxValRoas > 0) { c.targetType = 'ROAS'; c.targetVal = maxValRoas; }

            if (c.targetType === '-') {
                const standardCpa = parseFloat(row.campaign.targetCpa?.targetCpaMicros || 0);
                const maxConvCpa = parseFloat(row.campaign.maximizeConversions?.targetCpaMicros || 0);
                if (standardCpa > 0) { c.targetType = 'CPA'; c.targetVal = standardCpa / 1000000; } 
                else if (maxConvCpa > 0) { c.targetType = 'CPA'; c.targetVal = maxConvCpa / 1000000; }
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
        let depletion = 0;
        if (c.budget > 0) depletion = ((c.cost / reportDays) / c.budget) * 100;

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

        const statusStr = c.isLimited ? "Limited by Budget" : "-";
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

        let recBudgetStr = "-";
        if (c.recAmount > 0) recBudgetStr = `${currency} ${c.recAmount.toFixed(2)}`;
        else if (c.isLimited) recBudgetStr = "Check in Google Ads";

        const impressionShareStr = isEligibleType ? (c.isShare * 100).toFixed(1) + "%" : "-";
        const lostIsBudgetStr = isEligibleType ? (c.lostBudget * 100).toFixed(1) + "%" : "-";
        const lostIsRankStr = isEligibleType ? (c.lostRank * 100).toFixed(1) + "%" : "-";

        if (c.isLimited || depletion > 85 || numericMissed > 1) {
            campaignsToAnalyze.push({
                CampaignName: c.name,
                CampaignType: c.type,
                Status: statusStr,
                CurrentBudget: `${currency} ${c.budget.toFixed(2)}`,
                Depletion_Period: depletion.toFixed(1) + "%", 
                TargetStatus: targetStatus,
                MissedConversions_Est: missedConvStr,
                RecommendedBudget_API: recBudgetStr,
                LostIS_Budget: lostIsBudgetStr,
                
                // Sort Helper (Will be removed before sending)
                _sortKey: c.isLimited ? 2 : (depletion > 95 ? 1 : 0)
            });
        }
    });

    // --- 3. SAFETY & CLEANUP ---
    
    // 1. Sortierung (Wichtigste zuerst)
    campaignsToAnalyze.sort((a, b) => b._sortKey - a._sortKey);
    
    // 2. Limitierung auf Top 15
    let campaignsToSend = campaignsToAnalyze.slice(0, 15);

    // 3. BEREINIGUNG: Sort Key entfernen f?r sauberes JSON
    campaignsToSend = campaignsToSend.map(item => {
        delete item._sortKey;
        return item;
    });

    if (campaignsToSend.length > 0) {
        Logger.log("\n=== DATA SENT TO AI (CLEAN JSON - Top 15) ===");
        Logger.log(JSON.stringify(campaignsToSend, null, 2)); 
        
        const aiHtml = callGeminiAI_standalone(campaignsToSend);
        
        Logger.log("\n=== GEMINI RECOMMENDATION (FINAL) ===\n");
        Logger.log(aiHtml);
    } else {
        Logger.log("No campaigns met the criteria for AI analysis.");
    }

  } catch (e) {
    Logger.log(`\nFATAL ERROR: ${e.message}`);
    Logger.log(e.stack);
  }
}

/**
 * Helper: Uses the Robust Prompt.
 */
function callGeminiAI_standalone(campaignData) {
  const API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!API_KEY) return "<ul><li><b>Fehler:</b> API-Schl?ssel fehlt.</li></ul>";

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

SPRACHREGELUNG (STRIKT):
    1. **VERBOTENE WORTE (Niemals nutzen):** "Depletion", "Limited", "Budget Limited", "Missed", "Target Met", "Recommendation", "Efficiency Scale".
    2. **PFLICHT-?BERSETZUNGEN:**
       - "Limited by Budget" -> "durch das Budget eingeschr?nkt"
       - "LostIS_Budget" -> "Anteil entgangener Impressionen aufgrund des Budgets"
       - "Target Met" -> "Ziel erreicht"
       - "RecommendedBudget" -> "empfohlene Tagesbudget"
       - "Depletion_Period" -> "Budget-Aussch?pfung" oder "Auslastung"
    3. **AUSNAHME:** Das Wort "Conversion" oder "Conversions" darf (und soll) verwendet werden.

    REGELN F?R DEN INHALT:
    1. **FOKUSSIERUNG (WICHTIG):** Beschr?nke dich auf die **maximal 3 wichtigsten** Bullet Points (\`<li>\`). Fasse Kampagnen mit identischen Problemen (z.B. Prio 1) zu *einem* Punkt zusammen (Clustering).
    2. **Abwechslung:** Variiere den Satzbau. Vermeide es, jeden Punkt identisch zu beginnen ("Die Kampagne...").
    3. **Keine Redundanz:** Schreibe NIEMALS "Wir verlieren entgangene Conversions". Das ist doppelt gemoppelt. 
       - RICHTIG: "Uns entgehen rechnerisch ca. [X] Conversions" oder "Das ungenutzte Potenzial liegt bei [X] Conversions".
    4. **Tonalit?t:** Neutral, analytisch, l?sungsorientiert.

    ANALYSE-PRIORIT?TEN:
    
    1. **Prio 1 (Effizienz-Skalierung):**
       - Wenn: TargetStatus = "Target Met" UND (Status = "Limited by Budget" ODER Depletion_Period > 90%).
       - Strategie: Betone, dass die Kampagne effizient l?uft, aber vom Budget limitiert wird. Nenne die "MissedConversions_Est" und den "LostIS_Budget". Schlage die Erh?hung auf das <b>[RecommendedBudget_API]</b> vor (falls "N/A", schlage eine schrittweise Erh?hung vor).

    2. **Prio 2 (Wachstums-Potenzial):**
       - Wenn: TargetStatus = "No Target" UND Status = "Limited by Budget".
       - Strategie: Weise auf die starke Nachfrage hin, die das aktuelle Budget ?bersteigt. Empfiehl einen Test mit h?herem Budget, um das Volumen zu pr?fen.

    3. **Prio 3 (Kapazit?ts-Warnung):**
       - Wenn: Depletion_Period > 85% (aber nicht "Limited by Budget").
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
      return `<ul><li><b>KI-Fehler:</b> Keine Antwort generiert. (JSON: ${JSON.stringify(json)})</li></ul>`;
    }
  } catch (e) {
    return `<ul><li><b>Verbindungsfehler:</b> ${e.message}</li></ul>`;
  }
}