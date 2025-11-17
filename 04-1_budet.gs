/**
 * @file 04-1_budet.gs (Version 3.3 - Korrigierte Trigger-Logik & KI-Fehlerbehandlung)
 * @description Verarbeitet E-Mail-Entw?rfe f?r Budget-Empfehlungen.
 * Diese Version ist f?r gro?e Auftr?ge (>20) ausgelegt, indem sie
 * eine Status-Spalte und Zeit-Trigger verwendet, um Timeouts zu vermeiden.
 * @OnlyCurrentDoc
 * @Needs GmailApp
 * @Needs SpreadsheetApp
 * @Needs InternalAdsApp
 * @Needs UrlFetchApp
 * @Needs PropertiesService
 * @Needs ScriptApp
 * @Needs LockService
 */

// WIE VIELE ZEILEN PRO 6-MINUTEN-LAUF? (1 Account dauert ca. 30-45s)
// 3 ist ein sehr sicherer Wert, wie von dir vorgeschlagen.
const BATCH_SIZE = 3;

// WIE LANGE WARTEN BIS ZUM N?CHSTEN BATCH?
// 15 Sekunden (statt 1 Minute) ist ein schneller, aber sicherer Wert.
const TRIGGER_DELAY_SECONDS = 15;

// ================================================================
// CORE PROCESSING FUNCTION (Called by 04-2_budgetsidebar.html)
// ================================================================

/**
 * INITIATOR-Funktion. Wird von der Sidebar aufgerufen.
 * Speichert die Konfiguration und startet den ersten Batch-Lauf.
 *
 * @param {object} formData Ein Objekt mit den Benutzereingaben aus der Sidebar.
 * @return {object} Ein Ergebnisobjekt f?r die Sidebar (zeigt "Running" an).
 */
function processEmailRequest(formData) {
  Logger.log(`--- START processBudgetRecommendationRequest (AI + PDF) ---`);
  
  try {
    // 1. Alle alten Trigger l?schen, um Duplikate zu vermeiden
    // KORREKTUR: Ruft deleteTrigger_ mit dem *Funktionsnamen* auf.
    deleteTrigger_('runBatchTask_');

    // 2. FormData f?r den Trigger-Prozess speichern
    PropertiesService.getScriptProperties().setProperty('budgetBatchFormData', JSON.stringify(formData));

    // 3. Den allerersten Task sofort starten
    runBatchTask_();

    // 4. An die Sidebar melden, dass der Prozess l?uft
    Logger.log("Batch process initiated. Returning 'BATCH_RUNNING' to sidebar.");
    return {
      status: 'BATCH_RUNNING',
      succeeded: [1], // Platzhalter, um "Processed 0 rows" in der Sidebar zu verhindern
      failedInput: [],
      failedProcessing: [],
      skipped: []
    };

  } catch (e) {
    Logger.log(`FATAL ERROR in processEmailRequest (Initiator): ${e.message} \n Stack: ${e.stack}`);
    return {
      status: 'ERROR',
      processedRowCount: 0,
      succeeded: [],
      failedInput: [],
      failedProcessing: [{ row: 'N/A', recipient: 'N/A', details: `Script Error: ${e.message}` }],
      skipped: []
    };
  }
}

// ================================================================
// BATCH PROCESSING FUNCTIONS (Worker & Trigger)
// ================================================================

/**
 * WORKER-Funktion. Verarbeitet einen BATCH (z.B. 3 Zeilen) pro Ausf?hrung.
 * Wird von processEmailRequest() und dann von sich selbst per Trigger aufgerufen.
 */
function runBatchTask_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log("Skipping runBatchTask_: Another instance is already running.");
    return; 
  }

  Logger.log("--- runBatchTask_ started ---");
  let sheet;
  let statusColIndex = -1;
  
  try {
    // 1. Gespeicherte Konfiguration laden
    const formDataJson = PropertiesService.getScriptProperties().getProperty('budgetBatchFormData');
    if (!formDataJson) {
      Logger.log("Batch task stopped: No formData found in PropertiesService.");
      deleteTrigger_('runBatchTask_'); // Aufr?umen
      lock.releaseLock();
      return;
    }
    const formData = JSON.parse(formDataJson);

    // 2. Sheet und Spaltenindizes holen
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    sheet = ss.getActiveSheet();
    
    const executionColIndex = columnLetterToIndex_(formData.executionCol, sheet);
    const cidColIndex = columnLetterToIndex_(formData.cidCol, sheet);
    const recipientColIndex = columnLetterToIndex_(formData.recipientCol, sheet);
    statusColIndex = columnLetterToIndex_(formData.statusCol, sheet);
    const ccColIndex = formData.ccCol ? columnLetterToIndex_(formData.ccCol, sheet) : -1;

    // --- Finde die am weitesten rechts liegende Spalte ---
    const placeholderMap = buildPlaceholderMap_budget(formData, sheet);
    const placeholderIndices = Object.values(placeholderMap);
    const allDefinedIndices = [
      executionColIndex, cidColIndex, recipientColIndex,
      statusColIndex, ccColIndex, ...placeholderIndices
    ];
    const maxDefinedIndex = Math.max(...allDefinedIndices.filter(idx => idx > -1));
    const requiredWidth = maxDefinedIndex + 1; 
    
    // KORREKTUR: Nimm die gr??te Breite (entweder die ben?tigte oder die Max. Spalten)
    const readWidth = Math.max(requiredWidth, sheet.getMaxColumns());

    // 3. ALLE zu verarbeitenden Zeilen finden
    Logger.log(`Reading sheet data. Required width: ${requiredWidth}. Actual read width: ${readWidth}.`);
    
    // --- KORREKTUR HIER: ---
    // Ersetze getLastRow() (unzuverl?ssig) durch getMaxRows() (zuverl?ssig)
    const data = sheet.getRange(1, 1, sheet.getMaxRows(), readWidth).getValues();
    // --- ENDE KORREKTUR ---
    
    const rowsToProcess = []; // Sammelt alle Zeilen, die verarbeitet werden m?ssen
    for (let i = 0; i < data.length; i++) {
      const trigger = data[i][executionColIndex]?.toString().trim();
      const status = data[i][statusColIndex]?.toString().trim() || ''; 
      
      if (trigger == '1' && status === '') { // Verwendet == f?r flexiblen Trigger-Vergleich
        rowsToProcess.push({
          rowNumber: i + 1, // 1-basiert
          rowData: data[i]
        });
      }
    }

    // 4. Pr?fen, ob Arbeit getan ist
    if (rowsToProcess.length === 0) {
      Logger.log("Batch processing complete. No more rows to process.");
      deleteTrigger_('runBatchTask_'); // KORREKTUR: Funktionsnamen verwenden
      PropertiesService.getScriptProperties().deleteProperty('budgetBatchFormData');
      lock.releaseLock();
      return;
    }

    Logger.log(`Found ${rowsToProcess.length} total rows remaining. Processing first ${BATCH_SIZE}.`);
    
    // 5. Den aktuellen Batch (z.B. die ersten 3) holen
    const currentBatch = rowsToProcess.slice(0, BATCH_SIZE);

    // Gmail-Vorlage (nur einmal pro Batch holen)
    const emailTemplate = getGmailTemplateFromDrafts__emails(formData.subjectLine, true);
    // Angeh?ngte Dateien (nur einmal pro Batch holen)
    const userAttachments = convertBase64ToBlobs_(formData.attachedFiles || []);

    // 6. Den BATCH (z.B. 3 Zeilen) verarbeiten
    for (const item of currentBatch) {
      const rowNumber = item.rowNumber;
      const rowData = item.rowData;

      try {
        // Zeile "sperren", indem Status gesetzt wird
        sheet.getRange(rowNumber, statusColIndex + 1).setValue("Processing...");

        // --- Start der Einzelzeilen-Logik ---
        const cidRaw = rowData[cidColIndex]?.toString().trim() ?? "";
        const recipientRaw = rowData[recipientColIndex]?.toString().trim() ?? "";
        const ccRaw = (ccColIndex !== -1 && ccColIndex < rowData.length) ? (rowData[ccColIndex]?.toString().trim() ?? "") : "";

        if (!cidRaw) throw new Error("Missing Google Ads Client ID.");
        if (!recipientRaw || !recipientRaw.includes('@')) throw new Error(`Invalid recipient email: "${recipientRaw}"`);

        const reportDays = parseInt(formData.dateRange.replace('LAST_', '').replace('_DAYS', ''));
        if (isNaN(reportDays)) throw new Error(`Invalid dateRange value: ${formData.dateRange}`);
        
        const analysisResult = getAiBudgetAnalysis_(cidRaw, formData.dateRange, reportDays);
        const rowDataForPlaceholders = extractPlaceholderValues_(rowData, placeholderMap);

        const finalSubject = fillPlaceholdersInString_(formData.subjectLine, rowDataForPlaceholders);
        let finalBodyHtml = fillPlaceholdersInString_(emailTemplate.message.html, rowDataForPlaceholders);
        let finalBodyText = fillPlaceholdersInString_(emailTemplate.message.text, rowDataForPlaceholders);

        finalBodyHtml = finalBodyHtml.replace('{{ai_budget_recommendations}}', analysisResult.aiHtml);
        finalBodyText = finalBodyText.replace('{{ai_budget_recommendations}}', '(Dynamische Budget-Analyse - siehe HTML-Version)');

        const finalAttachments = [ ...emailTemplate.attachments, ...userAttachments ];

        if (formData.enablePdfAttachment) {
           Logger.log(`Row ${rowNumber}: 'enablePdfAttachment' is true. Generating PDF...`);
           const pdfBlob = createBudgetReportPdf_(
             analysisResult.allCampaignsData, 
             analysisResult.currency, 
             analysisResult.externalCid,
             formData.dateRange
           );
           if (pdfBlob) {
             finalAttachments.push(pdfBlob);
             Logger.log(`Row ${rowNumber}: PDF Blob successfully attached.`);
           } else {
             Logger.log(`Row ${rowNumber}: PDF Blob generation FAILED.`);
           }
        }

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
        
        const successMsg = `Draft Saved ${formData.enablePdfAttachment ? '+ PDF' : ''}`;
        sheet.getRange(rowNumber, statusColIndex + 1).setValue(successMsg);
        Logger.log(`Row ${rowNumber}: Success. Status set to '${successMsg}'.`);
        // --- Ende der Einzelzeilen-Logik ---

      } catch (e) {
        // FEHLERBEHANDLUNG f?r die *einzelne Zeile*
        const errorMsg = e.message.substring(0, 300);
        Logger.log(`FATAL ERROR processing row ${rowNumber}: ${e.message} \n Stack: ${e.stack}`);
        if (sheet && rowNumber > -1 && statusColIndex > -1) {
          sheet.getRange(rowNumber, statusColIndex + 1).setValue(`Error: ${errorMsg}`);
        }
      }
    } // --- Ende der Batch-Schleife (z.B. 3 Zeilen) ---

    // 7. N?chsten Trigger erstellen, WENN N?TIG
    if (rowsToProcess.length > BATCH_SIZE) {
      // Es gibt noch mehr Arbeit (z.B. 10 gefunden, 3 verarbeitet -> 7 ?brig)
      createTrigger_('runBatchTask_', TRIGGER_DELAY_SECONDS); // 15 Sekunden
      Logger.log(`Batch finished. ${rowsToProcess.length - BATCH_SIZE} rows remaining. Setting trigger.`);
    } else {
      // Fertig
      Logger.log("Batch processing complete. All rows processed.");
      deleteTrigger_('runBatchTask_');
      PropertiesService.getScriptProperties().deleteProperty('budgetBatchFormData');
    }

  } catch (e) {
    // Globaler Fehler (z.B. Konfiguration laden, Daten lesen)
    Logger.log(`FATAL ERROR in runBatchTask_ (global): ${e.message} \n Stack: ${e.stack}`);
    // Wir erstellen einen Trigger, um es erneut zu versuchen, falls es ein tempor?rer Fehler war
    createTrigger_('runBatchTask_', TRIGGER_DELAY_SECONDS); // 15 Sekunden
  } finally {
    lock.releaseLock();
  }
}

/**
 * Erstellt einen zeitbasierten Trigger, der eine Funktion in X Sekunden aufruft.
 * L?scht zuerst alle vorhandenen Trigger mit demselben Namen.
 * @param {string} functionToRun Die Funktion, die aufgerufen werden soll (z.B. 'runBatchTask_').
 * @param {number} seconds Die Anzahl der Sekunden, nach denen der Trigger ausl?sen soll.
 */
function createTrigger_(functionToRun, seconds) {
  // Zuerst alle alten Trigger l?schen, die diesen Job ausf?hren
  deleteTrigger_(functionToRun); // Wichtig: L?sche basierend auf dem Funktionsnamen
  
  // Neuen Trigger erstellen
  ScriptApp.newTrigger(functionToRun)
      .timeBased()
      .after(seconds * 1000) // Ge?ndert auf Sekunden
      .create();
  Logger.log(`Trigger created to run '${functionToRun}' in ${seconds} seconds.`);
}

/**
 * L?scht alle Trigger, die eine bestimmte Funktion ausf?hren.
 * @param {string} functionName Der Name der Funktion (z.B. 'runBatchTask_').
 */
function deleteTrigger_(functionName) {
  const triggers = ScriptApp.getProjectTriggers();
  let deleted = false;
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(trigger);
      deleted = true;
    }
  }
  if(deleted) {
     Logger.log(`Deleted all existing triggers for function '${functionName}'.`);
  }
}


// ================================================================
// LOKALE HILFSFUNKTIONEN (E-Mail & Anh?nge)
// (Unver?ndert)
// ================================================================

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

function buildBccString_budget(toggles) {
  const bccAddresses = [];
  if (toggles.sharedInbox) bccAddresses.push('gcs-sharedinbox@google.com');
  if (toggles.pop) bccAddresses.push('gcs-pop@google.com');
  return bccAddresses.join(', ') || undefined;
}

function buildPlaceholderMap_budget(formData, sheet) {
  const map = {};
  if (Array.isArray(formData.placeholders)) {
    formData.placeholders.forEach(ph => {
      if (ph.name && ph.col && ph.name.startsWith('{{') && ph.name.endsWith('}}')) {
         map[ph.name] = columnLetterToIndex_(ph.col, sheet);
      }
    });
  }
  return map;
}

function extractPlaceholderValues_(rowData, placeholderMap) {
  const values = {};
  for (const name in placeholderMap) {
    const index = placeholderMap[name];
    if (index > -1 && index < rowData.length) {
      values[name] = rowData[index]?.toString().trim() ?? "";
    } else {
      values[name] = "";
    }
  }
  return values;
}

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
        inlineImages[cid] = img.copyBlob();
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

const AI_TYPES_ALL = "'SEARCH', 'DISPLAY', 'VIDEO', 'PERFORMANCE_MAX', 'DEMAND_GEN', 'SHOPPING'";
const AI_TYPES_IS_ELIGIBLE = "'SEARCH', 'PERFORMANCE_MAX', 'SHOPPING'";
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

function executeAiQuery_(clientId, query, dateRangeString) {
  let finalQuery = query;
  if (dateRangeString) {
    finalQuery = query.replace('%DATE_RANGE%', dateRangeString);
  }
  const request = { customerId: clientId, query: finalQuery };
  const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
  return JSON.parse(responseJson).results || [];
}

function getAiBudgetAnalysis_(cidRaw, dateRangeString, reportDays) {
  Logger.log(`AI Analysis started for CID ${cidRaw}, Range: ${dateRangeString} (${reportDays} days)`);
  
  let externalCid = cidRaw; 
  let currency = 'EUR'; 
  
  try {
    const cidTrimmed = String(cidRaw).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    if (!extIds || !extIds[cidTrimmed]) {
        throw new Error(`(AI) CID Lookup Failed for ${cidRaw}`);
    }
    const apiCid = extIds[cidTrimmed].replace(/-/g, '');
    externalCid = extIds[cidTrimmed]; 

    // 1. Alle Daten abrufen
    const curRes = executeAiQuery_(apiCid, AI_Q0_CURRENCY, null);
    currency = curRes[0]?.customer?.currencyCode || 'EUR';

    const resQ1 = executeAiQuery_(apiCid, AI_Q1_FINANCIALS, dateRangeString);
    const campaigns = new Map();

    // Basis-Map erstellen
    resQ1.forEach(row => {
      const reasons = row.campaign.primaryStatusReasons || [];
      const isStatusLimited = reasons.includes('BUDGET_CONSTRAINED');
      campaigns.set(row.campaign.id, {
        id: row.campaign.id, 
        name: row.campaign.name, type: row.campaign.advertisingChannelType,
        strategy: row.campaign.biddingStrategyType,
        budget: parseFloat(row.campaignBudget.amount_micros || 0) / 1000000,
        cost: parseFloat(row.metrics.cost_micros || 0) / 1000000,
        conv: parseFloat(row.metrics.conversions || 0),
        val: parseFloat(row.metrics.conversions_value || 0),
        clicks: parseFloat(row.metrics.clicks || 0),
        impr: parseFloat(row.metrics.impressions || 0),
        targetType: '-', targetVal: 0, isShare: 0, lostBudget: 0, lostRank: 0,
        recAmount: 0, isLimited: isStatusLimited,
        depletion: 0, targetStatus: 'No Target', missedConv: 0
      });
    });

    if (campaigns.size === 0) {
       Logger.log("No active campaigns found for AI analysis in this date range.");
       return {
         aiHtml: "<ul><li>Keine aktiven Kampagnendaten im ausgew?hlten Zeitraum gefunden.</li></ul>",
         allCampaignsData: [],
         currency: currency,
         externalCid: externalCid
       };
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
      
      // KORREKTUR (aus deinem Log abgeleitet): Pr?fen, ob row.metrics existiert
      if (c && row.metrics) {
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

    // --- 2. DATEN F?R KI (UND PDF) VORBEREITEN ---
    const campaignsToAnalyze = []; // Nur f?r KI
    
    campaigns.forEach(c => {
      let depletion = 0;
      if (c.budget > 0) depletion = ((c.cost / reportDays) / c.budget) * 100;

      let targetStatus = "No Target";
      if (c.targetType === 'ROAS') {
        const actR = (c.cost > 0) ? (c.val / c.cost) : 0;
        const rAct = Math.round((actR + Number.EPSILON) * 100) / 100;
        const rTgt = Math.round((c.targetVal + Number.EPSILON)*100) / 100;
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

      // F?ge berechnete Metriken dem *Hauptobjekt* f?r das PDF hinzu
      c.depletion = depletion;
      c.targetStatus = targetStatus;
      c.missedConv = missedConv;

      // Nur interessante Kampagnen an KI senden
      if (c.isLimited || depletion > 85 || missedConv > 1) {
        campaignsToAnalyze.push({
          CampaignName: c.name, CampaignType: c.type,
          Status: c.isLimited ? "Limited by Budget" : "Eligible",
          CurrentBudget: `${currency} ${c.budget.toFixed(2)}`,
          Depletion_Period: depletion.toFixed(1) + "%", 
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
    let finalAiHtml;
    if (campaignsToAnalyze.length > 0) {
      finalAiHtml = callGeminiAI_budget(campaignsToAnalyze); // Aufruf der lokalen KI-Funktion
    } else {
      Logger.log("No campaigns met the criteria for AI analysis.");
      finalAiHtml = "<ul><li>Alle Kampagnen laufen stabil. Keine unmittelbaren Budget-Anpassungen basierend auf den Kriterien (Limitierung, Auslastung >85% oder verpasste Conversions) erforderlich.</li></ul>";
    }

    // Gib das volle Objekt zur?ck
    return {
      aiHtml: finalAiHtml,
      allCampaignsData: Array.from(campaigns.values()), // Die *komplette* Liste
      currency: currency,
      externalCid: externalCid
    };

  } catch (e) {
    Logger.log(`FATAL ERROR in getAiBudgetAnalysis_ (CID: ${cidRaw}): ${e.message}`);
    Logger.log(e.stack);
    // Gib ein Fehlerobjekt zur?ck, damit processEmailRequest nicht fehlschl?gt
    return {
      aiHtml: `<ul><li><b>Fehler bei der KI-Analyse f?r CID ${cidRaw}:</b> ${e.message}</li></ul>`,
      allCampaignsData: [],
      currency: currency,
      externalCid: externalCid
    };
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
      Logger.log(`AI Error: ${JSON.stringify(json)}`);
      return `<ul><li><b>Fehler:</b> Die KI hat keine g?ltige Antwort zur?ckgegeben.</li></ul>`;
    }
  } catch (e) {
    Logger.log(`AI Connection Failed: ${e.message}`);
    return `<ul><li><b>Fehler:</b> Verbindung zur KI-API fehlgeschlagen: ${e.message}</li></ul>`;
  }
}