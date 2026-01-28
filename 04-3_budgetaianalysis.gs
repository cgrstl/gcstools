/**
 * @file 04-3_budgetaianalysis.gs
 * @description Unified Campaign Performance & AI Pitch Generation.
 * VERSION: "API SAFETY FIX + SHOPPING REMEDY COMPLIANCE + FALLBACK LOGIC"
 */
function generateUnifiedAiBudgetAnalysis(cidRaw, dateRangeString) {
  
  const TIME_RANGE = dateRangeString || 'LAST_7_DAYS'; 
  let reportDays = 7;
  if (TIME_RANGE === 'LAST_14_DAYS') reportDays = 14;
  if (TIME_RANGE === 'LAST_30_DAYS') reportDays = 30;

  const TYPES_ALL = "'SEARCH', 'DISPLAY', 'VIDEO', 'PERFORMANCE_MAX', 'DEMAND_GEN', 'SHOPPING'";
  const TYPES_FOR_CALCULATION = ['SEARCH', 'PERFORMANCE_MAX', 'SHOPPING']; 
  const TYPES_IS_QUERY = "'SEARCH', 'PERFORMANCE_MAX', 'SHOPPING'";

  // --- COMPLIANCE: List of EEA, UK, and CH Country IDs ---
  const REMEDY_COUNTRY_IDS = [
    2040, 2056, 2100, 2191, 2196, 2203, 2208, 2233, 2246, 2250, 
    2276, 2300, 2348, 2372, 2380, 2428, 2440, 2442, 2470, 2528, 
    2616, 2620, 2642, 2703, 2705, 2724, 2752, 2826, 2756, 2578, 
    2352, 2438
  ];

  Logger.log(`\n=== STARTING AI ANALYSIS (CID: ${cidRaw}, Range: ${TIME_RANGE}) ===`);

  let externalCid = cidRaw;
  let currency = 'EUR';
  let finalAiHtml = "<ul><li>No relevant recommendations found.</li></ul>"; // Default Fallback
  
  // EINZIGE Liste für ALLE Kampagnen (für PDF)
  const allCampaignsData = []; 

  // --- LOCAL HELPERS & QUERIES ---
  const executeLocalQuery = (clientId, query) => {
    const request = { customerId: clientId, query: query };
    const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
    return JSON.parse(responseJson).results || [];
  };

  const Q0_CURRENCY = `SELECT customer.currency_code FROM customer`;
  const Q1_FINANCIALS = `SELECT campaign.id, campaign.name, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign.primary_status, campaign.primary_status_reasons, campaign_budget.amount_micros, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks, metrics.impressions FROM campaign WHERE campaign.status = 'ENABLED' AND campaign.advertising_channel_type IN (${TYPES_ALL}) AND segments.date DURING ${TIME_RANGE}`;
  const Q2_TARGETS = `SELECT campaign.id, campaign.target_cpa.target_cpa_micros, campaign.target_roas.target_roas, campaign.maximize_conversion_value.target_roas, campaign.maximize_conversions.target_cpa_micros FROM campaign WHERE campaign.status = 'ENABLED' AND campaign.advertising_channel_type IN (${TYPES_ALL})`;
  const Q3_IS_METRICS = `SELECT campaign.id, metrics.search_impression_share, metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share FROM campaign WHERE campaign.status = 'ENABLED' AND campaign.advertising_channel_type IN (${TYPES_IS_QUERY}) AND segments.date DURING ${TIME_RANGE}`;
  const Q4_BUDGET_RECS = `SELECT campaign.id, campaign_budget.has_recommended_budget, campaign_budget.recommended_budget_amount_micros, campaign_budget.recommended_budget_estimated_change_weekly_cost_micros FROM campaign WHERE campaign.status = 'ENABLED' AND campaign.primary_status_reasons CONTAINS ANY ('BUDGET_CONSTRAINED')`;

  // --- COMPLIANCE QUERIES ---
  const Q_PMAX_WITH_FEED = `SELECT campaign.id FROM campaign WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX' AND campaign.shopping_setting.merchant_id IS NOT NULL`;
  const Q_LOCATIONS = `SELECT campaign.id, campaign_criterion.location.geo_target_constant FROM campaign_criterion WHERE campaign_criterion.type = 'LOCATION' AND campaign_criterion.negative = FALSE AND campaign.status = 'ENABLED'`;

  try {
    const cidTrimmed = String(cidRaw).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    if (!extIds || !extIds[cidTrimmed]) throw new Error("Invalid CID");
    const apiCid = extIds[cidTrimmed].replace(/-/g, '');
    externalCid = extIds[cidTrimmed];
    
    const curRes = executeLocalQuery(apiCid, Q0_CURRENCY);
    currency = curRes[0]?.customer?.currencyCode || 'EUR';
    
    // --- PRE-CALCULATE COMPLIANCE LISTS ---
    const pmaxFeedSet = new Set();
    const campaignsTargetingRemedy = new Set();

    const feedRes = executeLocalQuery(apiCid, Q_PMAX_WITH_FEED);
    feedRes.forEach(row => pmaxFeedSet.add(row.campaign.id));

    const locRes = executeLocalQuery(apiCid, Q_LOCATIONS);
    locRes.forEach(row => {
        if(row.campaignCriterion && row.campaignCriterion.location && row.campaignCriterion.location.geoTargetConstant) {
            const geoId = parseInt(row.campaignCriterion.location.geoTargetConstant.split('/').pop());
            if (REMEDY_COUNTRY_IDS.includes(geoId)) {
                campaignsTargetingRemedy.add(row.campaign.id);
            }
        }
    });

    const resQ1 = executeLocalQuery(apiCid, Q1_FINANCIALS);
    const campaigns = new Map();
    
    resQ1.forEach(row => {
        const cId = row.campaign.id;
        const cType = row.campaign.advertisingChannelType;

        // --- COMPLIANCE FILTER LOGIC ---
        const isShoppingOrFeedPmax = (cType === 'SHOPPING') || (cType === 'PERFORMANCE_MAX' && pmaxFeedSet.has(cId));
        
        if (isShoppingOrFeedPmax && campaignsTargetingRemedy.has(cId)) {
            return; // Skip this campaign
        }

        const reasons = row.campaign.primaryStatusReasons || [];
        const isStatusLimited = reasons.includes('BUDGET_CONSTRAINED');
        
        const metrics = row.metrics || {};
        const campaignBudget = row.campaignBudget || {};

        campaigns.set(row.campaign.id, {
            name: row.campaign.name, type: row.campaign.advertisingChannelType,
            budget: parseFloat(campaignBudget.amountMicros || 0) / 1000000,
            cost: parseFloat(metrics.costMicros || 0) / 1000000,
            conv: parseFloat(metrics.conversions || 0),
            val: parseFloat(metrics.conversionsValue || 0),
            clicks: parseFloat(metrics.clicks || 0),
            impr: parseFloat(metrics.impressions || 0),
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
            const sRoas = parseFloat(row.campaign.targetRoas?.targetRoas || 0);
            const mRoas = parseFloat(row.campaign.maximizeConversionValue?.targetRoas || 0);
            if (sRoas > 0) { c.targetType = 'ROAS'; c.targetVal = sRoas; } 
            else if (mRoas > 0) { c.targetType = 'ROAS'; c.targetVal = mRoas; }
            if (c.targetType === '-') {
                const sCpa = parseFloat(row.campaign.targetCpa?.targetCpaMicros || 0);
                const mCpa = parseFloat(row.campaign.maximizeConversions?.targetCpaMicros || 0);
                if (sCpa > 0) { c.targetType = 'CPA'; c.targetVal = sCpa / 1000000; } 
                else if (mCpa > 0) { c.targetType = 'CPA'; c.targetVal = mCpa / 1000000; }
            }
        }
    });

    // Merge IS
    const resQ3 = executeLocalQuery(apiCid, Q3_IS_METRICS);
    resQ3.forEach(row => {
        const c = campaigns.get(row.campaign.id);
        if (c && row.metrics) {
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
            if (row.campaignBudget && row.campaignBudget.hasRecommendedBudget) {
                c.recAmount = parseFloat(row.campaignBudget.recommendedBudgetAmountMicros || 0) / 1000000;
            }
        }
    });

    // --- 2. PREPARE UNIFIED DATA OBJECT ---
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

        let missedConvStr = "-";
        let numericMissed = 0; 
        if (isEligibleType && hasConvData && c.isShare > 0 && c.impr > 0 && c.clicks > 0) {
             const totalImpr = c.impr / c.isShare;
             const lostImpr = totalImpr * c.lostBudget;
             const ctr = c.clicks / c.impr;
             const convRate = c.conv / c.clicks; 
             numericMissed = (lostImpr * ctr * convRate);
             missedConvStr = numericMissed.toFixed(1);
        }

        let recBudgetStr = "-";
        if (c.recAmount > 0) recBudgetStr = `${currency} ${c.recAmount.toFixed(2)}`;
        else if (c.isLimited) recBudgetStr = "Check in Google Ads";

        const statusStr = c.isLimited ? "Limited by Budget" : "-";

        const unifiedObj = {
            CampaignName: c.name,
            CampaignType: c.type,
            Status: statusStr,
            Conversions: c.conv.toFixed(1), // NEU: Für Relevanz-Check durch KI
            CurrentBudget: `${currency} ${c.budget.toFixed(2)}`,
            Depletion_Period: depletion.toFixed(1) + "%", 
            TimeRange: TIME_RANGE,
            TargetStatus: targetStatus,
            MissedConversions_Est: missedConvStr,
            RecommendedBudget_API: recBudgetStr,
            
            ImpressionShare: isEligibleType ? (c.isShare * 100).toFixed(1) + "%" : "-",
            LostIS_Budget: isEligibleType ? (c.lostBudget * 100).toFixed(1) + "%" : "-",
            LostIS_Rank: isEligibleType ? (c.lostRank * 100).toFixed(1) + "%" : "-",

            _isLimited: c.isLimited,
            _depletionVal: depletion,
            _missedVal: numericMissed
        };
        
        allCampaignsData.push(unifiedObj);

        if (c.isLimited || depletion > 85 || numericMissed > 1) {
             campaignsToAnalyze.push(unifiedObj);
        }
    });

    // --- 3. AI CALL ---
    campaignsToAnalyze.sort((a, b) => {
        const scoreA = (a._isLimited ? 200 : 0) + (a._depletionVal > 95 ? 100 : 0) + a._missedVal;
        const scoreB = (b._isLimited ? 200 : 0) + (b._depletionVal > 95 ? 100 : 0) + b._missedVal;
        return scoreB - scoreA;
    });
    
    // Cleanup internal keys
    allCampaignsData.forEach(item => {
        delete item._isLimited;
        delete item._depletionVal;
        delete item._missedVal;
    });

    let campaignsToSend = campaignsToAnalyze.slice(0, 15);

    if (campaignsToSend.length > 0) {
        Logger.log(`Sending ${campaignsToSend.length} campaigns to AI.`);
        Logger.log(JSON.stringify(campaignsToSend, null, 2)); 
        finalAiHtml = callGeminiAI_standalone(campaignsToSend);
    } else {
        // --- NEW STANDARD FALLBACK MESSAGE ---
        finalAiHtml = "<ul><li>No relevant recommendations found.</li></ul>";
    }

  } catch (e) {
    Logger.log(`ERROR in AI Analysis: ${e.message}`);
    finalAiHtml = `<ul><li>Error during analysis: ${e.message}</li></ul>`;
  }

  return {
    aiHtml: finalAiHtml,
    allCampaignsData: allCampaignsData, 
    currency: currency,
    externalCid: externalCid
  };
}

function callGeminiAI_standalone(campaignData) {
  const API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!API_KEY) return "<ul><li><b>Fehler:</b> API-Schlüssel fehlt.</li></ul>";
  const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
  
  const prompt = `
    DU BIST: Ein Senior Google Ads Daten-Analyst.
    DEINE AUFGABE: Erstelle eine prägnante, professionelle Budget-Analyse für eine E-Mail an einen Kunden.
    INPUT DATEN: ${JSON.stringify(campaignData, null, 2)}
    TECHNISCHE FORMATIERUNG (WICHTIG FÜR GMAIL):
    1. Gib **ausschließlich** ein HTML-Fragment zurück (kein \`\`\`html Block, kein <body>).
    2. Nutze eine ungeordnete Liste: <ul> für den Container, <li> für die Punkte.
    3. Nutze KEIN Markdown (keine **Sternchen**). Nutze <b> für Fettdruck.
    4. Nutze KEINE Schriftarten-Stile (kein style="font-family..."). Der Text muss sich dem E-Mail-Layout anpassen.

    SPRACHREGELUNG (STRIKT):
    1. **VERBOTENE WORTE (Niemals nutzen):** "Depletion", "Limited", "Budget Limited", "Missed", "Target Met", "Recommendation", "Efficiency Scale".
    2. **PFLICHT-ÜBERSETZUNGEN:**
       - "Limited by Budget" -> "durch das Budget eingeschränkt"
       - "LostIS_Budget" -> "Anteil entgangener Impressionen aufgrund des Budgets"
       - "LostIS_Rank" -> "Anteil entgangener Impressionen aufgrund des Ranges"
       - "Target Met" -> "Ziel erreicht"
       - "RecommendedBudget" -> "empfohlene Tagesbudget"
       - "Depletion_Period" -> "Budget-Ausschöpfung" oder "Auslastung"
    3. **AUSNAHME:** Das Wort "Conversion" oder "Conversions" darf (und soll) verwendet werden.

    REGELN FÜR DEN INHALT:
    1. **FOKUSSIERUNG (WICHTIG):** Beschränke dich auf die **maximal 3 wichtigsten** Bullet Points (\`<li>\`). Fasse Kampagnen mit identischen Problemen (z.B. Prio 1) zu *einem* Punkt zusammen (Clustering).
    2. **Abwechslung:** Variiere den Satzbau. Vermeide es, jeden Punkt identisch zu beginnen ("Die Kampagne...").
    3. **Keine Redundanz:** Schreibe NIEMALS "Wir verlieren entgangene Conversions". Das ist doppelt gemoppelt. 
       - RICHTIG: "Uns entgehen rechnerisch ca. [X] Conversions" oder "Das ungenutzte Potenzial liegt bei [X] Conversions".
    4. **Tonalität:** Neutral, analytisch, lösungsorientiert.
    5. **Intelligenter Relevanz-Filter (WICHTIG):** - Setze "MissedConversions_Est" ins Verhältnis zu den erzielten "Conversions".
       - IGNORIERE Bagatell-Werte (z.B. 0.5 entgangen bei 100 erzielt -> irrelevant).
       - Erwähne entgangene Conversions NUR, wenn sie signifikant sind (z.B. > 10% Zuwachs-Potenzial ODER absolute Menge > 3).

    ANALYSE-PRIORITÄTEN (Reihenfolge strikt beachten):
    
    1. **Prio 1 (Effizienz-Skalierung - Kritisch):**
       - Wenn: TargetStatus = "Target Met" UND (Status = "Limited by Budget" ODER Depletion_Period > 90%).
       - Strategie: Betone, dass die Kampagne effizient läuft, aber vom Budget limitiert wird. Nenne die "MissedConversions_Est" (unter Beachtung des Relevanz-Filters) und den "LostIS_Budget". Schlage die Erhöhung auf das <b>[RecommendedBudget_API]</b> vor (falls "N/A", schlage eine schrittweise Erhöhung vor).

    2. **Prio 2 (Wachstums-Potenzial bei Limitierung):**
       - Wenn: TargetStatus = "No Target" UND Status = "Limited by Budget".
       - Strategie: Weise auf die starke Nachfrage hin, die das aktuelle Budget übersteigt. Empfiehl einen Test mit höherem Budget, um das Volumen zu prüfen.

    3. **Prio 3 (Kapazitäts-Warnung):**
       - Wenn: Depletion_Period > 80% (aber nicht "Limited by Budget").
       - Strategie: Hinweis auf hohe Auslastung nahe der Kapazitätsgrenze.

    4. **Prio 4 (Investitions-Chance / Skalierung - FALLBACK):**
       - Wenn: KEINE der oben genannten Bedingungen (Prio 1-3) zutrifft (d.h. das Konto läuft stabil ohne Limitierung und ohne hohe Auslastung).
       - Strategie: Suche nach Kampagnen mit Potenzial ("Target Met" oder stabil).
       - **WICHTIG (Rank-Verluste):** Prüfe den "LostIS_Rank". Wenn dieser hoch ist (> 25%), gehen Conversions nicht durch fehlendes Budget, sondern durch zu niedrige Gebote verloren.
       - Empfehlung: Schlage vor, das <b>vorhandene, freie Budget</b> offensiver zu nutzen. Empfiehl eine Anpassung der Zielvorgaben (z.B. ROAS leicht senken oder CPA erhöhen), um in aggressiveren Auktionen mehr Sichtbarkeit zu gewinnen (Angriff auf den "LostIS_Rank").

    BEISPIEL OUTPUT (Stil-Referenz):
    <ul>
    <li>Die Kampagnen <b>"Shopping"</b> und <b>"Generic Search"</b> arbeiten hocheffizient im Zielkorridor, stoßen jedoch täglich an ihr Limit. Aktuell entgehen uns hierdurch ein signifikantes Volumen von ca. 20 Conversions pro Woche. Um dieses Potenzial voll auszuschöpfen, empfehlen wir eine Anhebung auf <b>EUR 1500.00</b>.</li>
    <li>Bei <b>"Demand Gen"</b> sehen wir eine extrem hohe Nachfrage, die das Budget von <b>EUR 200.00</b> vollständig auslastet. Eine Anpassung würde helfen, die Sichtbarkeit an starken Tagen zu sichern.</li>
    </ul>
    
    ODER (Falls Prio 4 greift - Stabil aber ungenutzt):
    <ul>
    <li>Die Kampagnen <b>"Performance Max"</b> und <b>"Search Brand"</b> laufen stabil, schöpfen ihr Tagesbudget jedoch derzeit nicht aus. Wir sehen jedoch Potenziale im Auktionsumfeld (Lost IS Rank: 45%). Um das Wachstum anzukurbeln, empfehlen wir eine offensivere Investitionsstrategie: Durch eine Anpassung der Zielvorgaben (z.B. Senkung des ROAS-Ziels) könnten wir das bereits vorhandene Budget nutzen, um zusätzliche Marktanteile zu gewinnen.</li>
    </ul>`;

  const payload = { contents: [{ parts: [{ text: prompt }] }] };
  try {
    const options = { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true };
    const response = UrlFetchApp.fetch(ENDPOINT, options);
    const json = JSON.parse(response.getContentText());
    if (json.candidates && json.candidates.length > 0) {
      return json.candidates[0].content.parts[0].text.replace(/```html/g, "").replace(/```/g, "").trim();
    } else return "<ul><li>Keine Antwort.</li></ul>";
  } catch (e) { return `<ul><li>Verbindung fehlgeschlagen.</li></ul>`; }
}