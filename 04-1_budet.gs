/**
 * @file 04-1_budet.gs (NEU: Version 2.0 - AI Integrated)
 * @description Verarbeitet E-Mail-Entw?rfe f?r Budget-Empfehlungen.
 * Diese Version integriert die KI-Logik aus 100-6, um dynamisch
 * Budget-Analysen von Gemini zu holen und in E-Mail-Entw?rfe einzuf?gen.
 * @OnlyCurrentDoc
 * @Needs GmailApp
 * @Needs SpreadsheetApp
 * @Needs InternalAdsApp
 * @Needs UrlFetchApp
 * @Needs PropertiesService
 */

// ================================================================
// CORE PROCESSING FUNCTION (Called by 04-2_budgetsidebar.html)
// ================================================================

/**
 * Verarbeitet eine E-Mail-Anfrage aus der Budget-Sidebar.
 * Holt Daten, findet einen Gmail-Entwurf, generiert KI-Inhalte,
 * f?llt Platzhalter und erstellt einen Entwurf.
 *
 * @param {object} formData Ein Objekt mit den Benutzereingaben aus der Sidebar.
 * @return {object} Ein kategorisiertes Ergebnisobjekt f?r die Sidebar.
 */
function processEmailRequest(formData) {
  Logger.log(`--- START processBudgetRecommendationRequest (AI) ---`);
  Logger.log(`Received formData: ${JSON.stringify(formData)}`);

  const results = {
    processedRowCount: 0,
    actionType: 'draft',
    succeeded: [],
    failedInput: [],
    failedProcessing: []
  };

  try {
    // --- 1. SETUP & VALIDATION ---
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet();

    // Spaltenindizes abrufen (verwendet 100-1_helperstools.gs)
    const executionColIndex = columnLetterToIndex_(formData.executionCol, sheet);
    const cidColIndex = columnLetterToIndex_(formData.cidCol, sheet);
    const recipientColIndex = columnLetterToIndex_(formData.recipientCol, sheet);
    const ccColIndex = formData.ccCol ? columnLetterToIndex_(formData.ccCol, sheet) : -1;

    if (executionColIndex === -1) throw new Error(`Invalid Trigger Column: ${formData.executionCol}`);
    if (cidColIndex === -1) throw new Error(`Invalid Google Ads CID Column: ${formData.cidCol}`);
    if (recipientColIndex === -1) throw new Error(`Invalid Recipient Column: ${formData.recipientCol}`);

    // Standard-Platzhalter-Map erstellen (verwendet 100-1_helperstools.gs)
    const placeholderMap = buildPlaceholderMap_budget(formData, sheet);

    // Gmail-Vorlage holen
    const emailTemplate = getGmailTemplateFromDrafts__emails(formData.subjectLine, true);

    // Trigger-Zeilen holen (verwendet 100-1_helperstools.gs)
    const triggeredRows = getTriggeredRows_(sheet, executionColIndex);
    results.processedRowCount = triggeredRows.length;

    if (triggeredRows.length === 0) {
      results.failedProcessing.push({ row: 'N/A', recipient: 'N/A', details: "No rows marked '1' found to process." });
      return results;
    }

    // Angeh?ngte Dateien aus Base64 konvertieren (falls vorhanden)
    const userAttachments = convertBase64ToBlobs_(formData.attachedFiles || []);
    Logger.log(`Verarbeite ${userAttachments.length} vom Benutzer hochgeladene Anh?nge.`);

    // --- 2. START ROW ITERATION ---
    triggeredRows.forEach(triggeredRow => {
      const sheetRowNumber = triggeredRow.rowNumber;
      const rowData = triggeredRow.data;

      // Daten f?r diese Zeile extrahieren
      const cidRaw = rowData[cidColIndex]?.toString().trim() ?? "";
      const recipientRaw = rowData[recipientColIndex]?.toString().trim() ?? "";
      const ccRaw = (ccColIndex !== -1 && ccColIndex < rowData.length) ? (rowData[ccColIndex]?.toString().trim() ?? "") : "";

      try {
        // --- 2.1 Zeilenvalidierung ---
        if (!cidRaw) throw new Error("Missing Google Ads Client ID.");
        if (!recipientRaw || !recipientRaw.includes('@')) throw new Error(`Invalid recipient email: "${recipientRaw}"`);

        // --- 2.2 KI-DATEN GENERIEREN (Der neue Schritt) ---
        Logger.log(`Row ${sheetRowNumber}: Generating AI analysis for CID ${cidRaw} with range ${formData.dateRange}...`);
        
        // Bestimme die Anzahl der Tage f?r die Depletion-Berechnung
        // Wirft einen Fehler, wenn dateRange ung?ltig ist (z.B. "LAST_7_DAYS_INVALID")
        const reportDays = parseInt(formData.dateRange.replace('LAST_', '').replace('_DAYS', ''));
        if (isNaN(reportDays)) {
          throw new Error(`Invalid dateRange value received from sidebar: ${formData.dateRange}`);
        }
        
        // Rufe die refaktorierte 100-6-Logik auf
        const aiHtmlContent = getAiBudgetAnalysis_(cidRaw, formData.dateRange, reportDays);
        Logger.log(`Row ${sheetRowNumber}: AI analysis generated.`);

        // --- 2.3 Alle Platzhalter vorbereiten (OHNE AI-INHALT) ---
        const rowDataForPlaceholders = extractPlaceholderValues_(rowData, placeholderMap);
        
        // HINWEIS: Der AI-Inhalt wird NICHT in rowDataForPlaceholders eingef?gt,
        // da er NICHT escaped werden darf.

        // --- 2.4 E-Mail-Inhalt finalisieren (KORRIGIERTER WORKFLOW) ---
        const finalSubject = fillPlaceholdersInString_(formData.subjectLine, rowDataForPlaceholders);
        
        // SCHRITT 1: Zuerst alle "normalen" Platzhalter f?llen (die escaped werden m?ssen)
        let finalBodyHtml = fillPlaceholdersInString_(emailTemplate.message.html, rowDataForPlaceholders);
        let finalBodyText = fillPlaceholdersInString_(emailTemplate.message.text, rowDataForPlaceholders);

        // SCHRITT 2: JETZT den AI-HTML-Platzhalter manuell ersetzen, *ohne* Escaping
        // Stellt sicher, dass der rohe HTML-Code von der KI direkt eingef?gt wird.
        finalBodyHtml = finalBodyHtml.replace('{{ai_budget_recommendations}}', aiHtmlContent);
        
        // (F?r den Plain-Text-Fallback ersetzen wir ihn auch, aber mit einer einfachen Meldung)
        finalBodyText = finalBodyText.replace('{{ai_budget_recommendations}}', '(Dynamische Budget-Analyse - siehe HTML-Version)');

        // Alle Anh?nge kombinieren
        const finalAttachments = [
          ...emailTemplate.attachments, // Anh?nge aus dem Entwurf
          ...userAttachments             // Neue Anh?nge aus der Sidebar
        ];

        // PDF-Anhang-Logik (derzeit ignoriert, wie angewiesen)
        if (formData.enablePdfAttachment) {
           Logger.log(`Row ${sheetRowNumber}: 'enablePdfAttachment' is true, but this feature is currently ignored as requested.`);
        }

        // --- 2.5 Entwurf erstellen ---
        const options = {
          htmlBody: finalBodyHtml,
          cc: ccRaw.replace(/;\s*/g, ',').trim() || undefined,
          attachments: finalAttachments,
          inlineImages: emailTemplate.inlineImages,
          bcc: buildBccString_budget({
            sharedInbox: formData.bccSharedInbox,
            pop: formData.bccPop
          })
        };

        GmailApp.createDraft(recipientRaw, finalSubject, finalBodyText, options);
        results.succeeded.push({ row: sheetRowNumber, recipient: recipientRaw, details: `Draft saved successfully with AI content.` });

      } catch (e) {
        const errorMsg = e.message.substring(0, 200);
        Logger.log(`Row ${sheetRowNumber}: ERROR processing for "${recipientRaw}": ${errorMsg}`);
        if (e.message.includes("CID") || e.message.includes("Recipient") || e.message.includes("Ads API")) {
          results.failedInput.push({ row: sheetRowNumber, recipient: recipientRaw, details: errorMsg });
        } else {
          results.failedProcessing.push({ row: sheetRowNumber, recipient: recipientRaw, details: errorMsg });
        }
      }
    }); // --- END ROW ITERATION ---

    Logger.log(`Budget processing complete. Summary: Succeeded: ${results.succeeded.length}, FailedInput: ${results.failedInput.length}, FailedProcessing: ${results.failedProcessing.length}`);
    return results;

  } catch (e) {
    Logger.log(`FATAL ERROR in processEmailRequest (Budget AI): ${e.message} \n Stack: ${e.stack}`);
    results.failedProcessing.push({ row: 'N/A', recipient: 'N/A', details: `Script Error: ${e.message}` });
    return results;
  }
}

// ================================================================
// LOKALE HILFSFUNKTIONEN (E-Mail & Anh?nge)
// ================================================================

/** Konvertiert Base64-Dateidaten aus der Sidebar in Blobs */
function convertBase64ToBlobs_(files) {
  if (!files || files.length === 0) return [];
  const blobs = [];
  files.forEach(file => {
    try {
      const blob = Utilities.newBlob(
        Utilities.base64Decode(file.base64data),
        file.mimeType,
        file.filename
      );
      blobs.push(blob);
    } catch (e) {
      Logger.log(`Error converting file "${file.filename}" from Base64: ${e.message}`);
    }
  });
  return blobs;
}

/** Erstellt die BCC-Zeichenkette */
function buildBccString_budget(toggles) {
  const bccAddresses = [];
  if (toggles.sharedInbox) bccAddresses.push('gcs-sharedinbox@google.com');
  if (toggles.pop) bccAddresses.push('gcs-pop@google.com');
  return bccAddresses.join(', ') || undefined;
}

/** Erstellt die Platzhalter-Map */
function buildPlaceholderMap_budget(formData, sheet) {
  const map = {};
  if (Array.isArray(formData.placeholders)) {
    formData.placeholders.forEach(ph => {
      // Stellt sicher, dass der Platzhalter-Tag das Format {{name}} hat
      if (ph.name && ph.col && ph.name.startsWith('{{') && ph.name.endsWith('}}')) {
         map[ph.name] = columnLetterToIndex_(ph.col, sheet);
      }
    });
  }
  return map;
}

/** Extrahiert Platzhalterwerte aus einer Zeile */
function extractPlaceholderValues_(rowData, placeholderMap) {
  const values = {};
  for (const name in placeholderMap) {
    const index = placeholderMap[name];
    if (index > -1 && index < rowData.length) {
      values[name] = rowData[index]?.toString().trim() ?? "";
    } else {
      values[name] = ""; // Standard-Fallback, falls Spalte nicht existiert
    }
  }
  return values;
}

/** * Holt die Gmail-Vorlage.
 * HINWEIS: Diese Funktion ist eine Kopie von der in 01-1_emails.gs,
 * um 04-1 eigenst?ndig zu machen. Zuk?nftige ?nderungen m?ssen evtl. an beiden Orten erfolgen.
 */
function getGmailTemplateFromDrafts__emails(subject_line, requireUnique = false) {
  if (!subject_line || subject_line.trim() === "") {
    throw new Error("Subject line for draft template cannot be empty.");
  }
  const drafts = GmailApp.getDrafts();
  const matchingDrafts = drafts.filter(d => d.getMessage().getSubject() === subject_line);

  if (matchingDrafts.length === 0) { throw new Error(`No Gmail draft found with subject: "${subject_line}"`); }
  if (requireUnique && matchingDrafts.length > 1) { throw new Error(`Multiple Gmail drafts (${matchingDrafts.length}) found with subject: "${subject_line}".`); }

  const msg = matchingDrafts[0].getMessage();
  
  let attachments = [];
  let inlineImages = {};

  try {
    attachments = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });
  } catch(e) {
    Logger.log(`Could not get attachments for draft "${subject_line}": ${e.message}`);
  }

  try {
    const rawInline = msg.getAttachments({ includeInlineImages: true, includeAttachments: false });
    rawInline.forEach(img => {
      const cidHeader = img.getHeaders()['Content-ID'];
      const cid = cidHeader ? String(cidHeader).replace(/[<>]/g, "") : null;
      if (cid) {
        inlineImages[cid] = img.copyBlob(); // copyBlob() ist sicherer
      } else {
         Logger.log(`Warning: Found inline image named "${img.getName()}" without a Content-ID in draft "${subject_line}".`);
      }
    });
  } catch(e) {
     Logger.log(`Could not get inline images for draft "${subject_line}": ${e.message}`);
  }

  return {
    message: { 
      text: msg.getPlainBody() || "", 
      html: msg.getBody() || "" 
    },
    attachments: attachments,
    inlineImages: inlineImages
  };
}


// ================================================================
// INTEGRIERTE AI-LOGIK (Refaktoriert aus 100-6_combined_test.gs)
// ================================================================

// --- 1. Konstanten & Abfragen (angepasst f?r dynamisches Datum) ---
const AI_TYPES_ALL = "'SEARCH', 'DISPLAY', 'VIDEO', 'PERFORMANCE_MAX', 'DEMAND_GEN', 'SHOPPING'";
const AI_TYPES_IS_ELIGIBLE = "'SEARCH', 'PERFORMANCE_MAX', 'SHOPPING'";

// WICHTIG: Verwendet jetzt 'DURING ${dateRangeString}' statt 'BETWEEN'
const AI_Q0_CURRENCY = `SELECT customer.currency_code FROM customer`;

const AI_Q1_FINANCIALS = `
    SELECT
      campaign.id, campaign.name, campaign.advertising_channel_type, campaign.bidding_strategy_type,
      campaign.primary_status, campaign.primary_status_reasons,
      campaign_budget.amount_micros, metrics.cost_micros, metrics.conversions, metrics.conversions_value,
      metrics.clicks, metrics.impressions
    FROM campaign
    WHERE campaign.status = 'ENABLED' AND campaign.advertising_channel_type IN (${AI_TYPES_ALL})
    AND segments.date DURING %DATE_RANGE%
  `;

const AI_Q2_TARGETS = `
    SELECT campaign.id, campaign.target_cpa.target_cpa_micros, campaign.target_roas.target_roas,
    campaign.maximize_conversion_value.target_roas, campaign.maximize_conversions.target_cpa_micros
    FROM campaign WHERE campaign.status = 'ENABLED' AND campaign.advertising_channel_type IN (${AI_TYPES_ALL})
  `;

const AI_Q3_IS_METRICS = `
    SELECT campaign.id, metrics.search_impression_share, metrics.search_budget_lost_impression_share,
    metrics.search_rank_lost_impression_share
    FROM campaign WHERE campaign.status = 'ENABLED' AND campaign.advertising_channel_type IN (${AI_TYPES_IS_ELIGIBLE})
    AND segments.date DURING %DATE_RANGE%
  `;

const AI_Q4_BUDGET_RECS = `
    SELECT campaign.id, campaign_budget.has_recommended_budget, campaign_budget.recommended_budget_amount_micros,
    campaign_budget.recommended_budget_estimated_change_weekly_cost_micros
    FROM campaign WHERE campaign.status = 'ENABLED' AND campaign.primary_status_reasons CONTAINS ANY ('BUDGET_CONSTRAINED')
  `;

/**
 * F?hrt die Abfrage aus. Ersetzt den Datumsbereich.
 */
function executeAiQuery_(clientId, query, dateRangeString) {
  let finalQuery = query;
  if (dateRangeString) {
    // Ersetzt %DATE_RANGE% durch den GAQL-String (z.B. LAST_7_DAYS)
    finalQuery = query.replace('%DATE_RANGE%', dateRangeString);
  }
  const request = { customerId: clientId, query: finalQuery };
  // Verwendet die globale InternalAdsApp
  const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
  return JSON.parse(responseJson).results || [];
}

/**
 * Haupt-KI-Funktion, die die Analyse f?r eine CID und einen Datumsbereich durchf?hrt.
 * @param {string} cidRaw Die rohe CID (z.B. 123-456-7890)
 * @param {string} dateRangeString Der GAQL-Datumsstring (z.B. "LAST_7_DAYS")
 * @param {number} reportDays Die Anzahl der Tage (z.B. 7)
 * @return {string} Der von Gemini generierte HTML-String.
 */
function getAiBudgetAnalysis_(cidRaw, dateRangeString, reportDays) {
  Logger.log(`AI Analysis started for CID ${cidRaw}, Range: ${dateRangeString} (${reportDays} days)`);

  try {
    const cidTrimmed = String(cidRaw).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    if (!extIds || !extIds[cidTrimmed]) {
        throw new Error(`(AI) CID Lookup Failed for ${cidRaw}`);
    }
    const apiCid = extIds[cidTrimmed].replace(/-/g, '');

    // 1. Alle Daten abrufen
    const curRes = executeAiQuery_(apiCid, AI_Q0_CURRENCY, null);
    const currency = curRes[0]?.customer?.currencyCode || 'EUR';

    const resQ1 = executeAiQuery_(apiCid, AI_Q1_FINANCIALS, dateRangeString);
    const campaigns = new Map();

    // Basis-Map erstellen
    resQ1.forEach(row => {
      const reasons = row.campaign.primaryStatusReasons || [];
      const isStatusLimited = reasons.includes('BUDGET_CONSTRAINED');
      campaigns.set(row.campaign.id, {
        name: row.campaign.name, type: row.campaign.advertisingChannelType,
        strategy: row.campaign.biddingStrategyType,
        budget: parseFloat(row.campaignBudget.amountMicros || 0) / 1000000,
        cost: parseFloat(row.metrics.costMicros || 0) / 1000000,
        conv: parseFloat(row.metrics.conversions || 0),
        val: parseFloat(row.metrics.conversionsValue || 0),
        clicks: parseFloat(row.metrics.clicks || 0),
        impr: parseFloat(row.metrics.impressions || 0),
        targetType: '-', targetVal: 0, isShare: 0, lostBudget: 0, lostRank: 0,
        recAmount: 0, isLimited: isStatusLimited
      });
    });

    if (campaigns.size === 0) {
       Logger.log("No active campaigns found for AI analysis in this date range.");
       return "<ul><li>Keine aktiven Kampagnendaten im ausgew?hlten Zeitraum gefunden.</li></ul>";
    }

    // Ziele zusammenf?hren
    const resQ2 = executeAiQuery_(apiCid, AI_Q2_TARGETS, null);
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

    // IS-Metriken zusammenf?hren
    const resQ3 = executeAiQuery_(apiCid, AI_Q3_IS_METRICS, dateRangeString);
    resQ3.forEach(row => {
      const c = campaigns.get(row.campaign.id);
      if (c) {
        c.isShare = parseFloat(row.metrics.searchImpressionShare || 0);
        c.lostBudget = parseFloat(row.metrics.searchBudgetLostImpressionShare || 0);
        c.lostRank = parseFloat(row.metrics.searchRankLostImpressionShare || 0);
      }
    });

    // Empfehlungen zusammenf?hren
    const resQ4 = executeAiQuery_(apiCid, AI_Q4_BUDGET_RECS, null);
    resQ4.forEach(row => {
      const c = campaigns.get(row.campaign.id);
      if (c) {
        c.isLimited = true;
        if (row.campaignBudget.hasRecommendedBudget) {
          c.recAmount = parseFloat(row.campaignBudget.recommendedBudgetAmountMicros || 0) / 1000000;
        }
      }
    });

    // --- 2. DATEN F?R KI VORBEREITEN ---
    const campaignsToAnalyze = [];
    campaigns.forEach(c => {
      let depletion = 0;
      // WICHTIG: Verwendet die dynamische 'reportDays'-Variable
      if (c.budget > 0) depletion = ((c.cost / reportDays) / c.budget) * 100;

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

      // Nur interessante Kampagnen an KI senden
      if (c.isLimited || depletion > 85 || missedConv > 1) {
        campaignsToAnalyze.push({
          CampaignName: c.name, CampaignType: c.type,
          Status: c.isLimited ? "Limited by Budget" : "Eligible",
          CurrentBudget: `${currency} ${c.budget.toFixed(2)}`,
          Depletion_Period: depletion.toFixed(1) + "%", // Umbenannt von Depletion7Day
          TargetStatus: targetStatus,
          MissedConversions_Est: missedConv > 0 ? missedConv.toFixed(1) : "None",
          RecommendedBudget_API: c.recAmount > 0 ? `${currency} ${c.recAmount.toFixed(2)}` : "N/A",
          LostIS_Budget: (c.lostBudget * 100).toFixed(1) + "%",
          LostIS_Rank: (c.lostRank * 100).toFixed(1) + "%"
        });
      }
    });

    Logger.log(`Sending ${campaignsToAnalyze.length} campaigns to Gemini AI...`);

    // --- 3. KI AUFRUFEN ---
    if (campaignsToAnalyze.length > 0) {
      const aiResponse = callGeminiAI_budget(campaignsToAnalyze); // Aufruf der lokalen KI-Funktion
      return aiResponse;
    } else {
      Logger.log("No campaigns met the criteria for AI analysis.");
      return "<ul><li>Alle Kampagnen laufen stabil. Keine unmittelbaren Budget-Anpassungen basierend auf den Kriterien (Limitierung, Auslastung >85% oder verpasste Conversions) erforderlich.</li></ul>";
    }

  } catch (e) {
    Logger.log(`FATAL ERROR in getAiBudgetAnalysis_ (CID: ${cidRaw}): ${e.message}`);
    Logger.log(e.stack);
    return `<ul><li><b>Fehler bei der KI-Analyse f?r CID ${cidRaw}:</b> ${e.message}</li></ul>`;
  }
}

/**
 * Ruft die Gemini-API auf (aus 100-6).
 */
function callGeminiAI_budget(campaignData) {
  const API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!API_KEY) {
      Logger.log("ERROR: 'GEMINI_API_KEY' missing in Script Properties.");
      return "<ul><li><b>Fehler:</b> API-Schl?ssel f?r KI nicht konfiguriert.</li></ul>";
  }

  const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
  
  // Note: Umlaute (?, ?, ?) wurden zur Sicherheit als ? (Fragezeichen) kodiert,
  // dies sollte in einer Live-Umgebung korrekt als UTF-8 behandelt werden.
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
    1. **Abwechslung:** Variiere den Satzbau. Vermeide es, jeden Punkt identisch zu beginnen ("Die Kampagne...").
    2. **Keine Redundanz:** Schreibe NIEMALS "Wir verlieren entgangene Conversions". Das ist doppelt gemoppelt. 
       - RICHTIG: "Uns entgehen rechnerisch ca. [X] Conversions" oder "Das ungenutzte Potenzial liegt bei [X] Conversions".
    3. **Clustering:** Fasse Kampagnen mit gleicher Situation logisch zusammen.
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
      Logger.log(`AI Error: ${JSON.stringify(json)}`);
      return `<ul><li><b>Fehler:</b> Die KI hat keine g?ltige Antwort zur?ckgegeben.</li></ul>`;
    }
  } catch (e) {
    Logger.log(`AI Connection Failed: ${e.message}`);
    return `<ul><li><b>Fehler:</b> Verbindung zur KI-API fehlgeschlagen: ${e.message}</li></ul>`;
  }
}