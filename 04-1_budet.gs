/**
 * @file 04-1_budet.gs (Version 7.3 - Client-Side Polling)
 * @description Orchestrator f?r Budget-Empfehlungen.
 * - Logik 1:1 ?bernommen aus v5.2.
 * - Architektur ge?ndert auf Client-Side Polling (vermeidet Trigger-Quotas).
 * - BATCH_SIZE = 3 (Sicherheitslimit).
 */

const BATCH_SIZE = 3; 

// ================================================================
// 1. SETUP (Wird einmalig beim Start geklickt)
// ================================================================
function setupBudgetRun(formData) {
  console.log("--- START: Setup Budget Run ---");
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) throw new Error("Kein aktives Spreadsheet gefunden. Bitte Add-on in Tabelle nutzen.");
    const sheet = ss.getActiveSheet();

    // 1. UserProperties bereinigen (Clean Slate)
    PropertiesService.getUserProperties().deleteProperty('budgetBatchFormData');

    // 2. Config anreichern
    formData.spreadsheetId = ss.getId();
    formData.sheetName = sheet.getName();
    
    // Config final speichern (User Scope)
    PropertiesService.getUserProperties().setProperty('budgetBatchFormData', JSON.stringify(formData));

    return { status: 'READY' };
  } catch (e) {
    console.error("Setup Failed:", e);
    throw new Error(e.message); 
  }
}

// ================================================================
// 2. WORKER (Wird immer wieder von der Sidebar aufgerufen)
// ================================================================
function processOneBatch() {
  // Lock verhindert Kollisionen, falls Sidebar zu schnell feuert
  const lock = LockService.getUserLock();
  if (!lock.tryLock(5000)) return { status: 'BUSY' }; 

  try {
    // 1. Config laden
    const formDataJson = PropertiesService.getUserProperties().getProperty('budgetBatchFormData');
    if (!formDataJson) return { status: 'ERROR', message: "Konfiguration verloren. Bitte neu starten." };
    const formData = JSON.parse(formDataJson);

    // 2. Sheet ?ffnen
    const sheet = SpreadsheetApp.openById(formData.spreadsheetId).getSheetByName(formData.sheetName);
    if (!sheet) return { status: 'ERROR', message: "Sheet nicht mehr gefunden." };
    
    // 3. Spalten & Daten holen (Logik aus v5.2)
    const executionColIndex = columnLetterToIndex_(formData.executionCol, sheet);
    const statusColIndex = columnLetterToIndex_(formData.statusCol, sheet);
    
    const lastRow = sheet.getLastRow();
    const data = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
    
    // Scan nach offenen Aufgaben
    const rowsToProcess = [];
    for (let i = 0; i < data.length; i++) {
      const trigger = String(data[i][executionColIndex] || '').trim();
      const status = String(data[i][statusColIndex] || '').trim();
      // Bedingung: Trigger ist '1' UND Status ist leer
      if (trigger === '1' && status === '') {
        rowsToProcess.push({ rowNumber: i + 1, rowData: data[i] });
      }
    }

    // --- CHECK: ALLES FERTIG? ---
    if (rowsToProcess.length === 0) {
        console.log("=== DONE: No more rows found. ===");
       
        PropertiesService.getUserProperties().deleteProperty('budgetBatchFormData');
        return { status: 'DONE' }; 
    }

    // --- BATCH STARTEN ---
    const currentBatch = rowsToProcess.slice(0, BATCH_SIZE);
    console.log(`Processing batch of ${currentBatch.length} rows...`);
    
    // Die eigentliche Arbeit ausf?hren (ausgelagert, um Hauptfunktion sauber zu halten)
    processBatchItems_(currentBatch, formData, sheet); 

    // R?ckmeldung an Sidebar
    return { 
        status: 'CONTINUE', 
        processed: currentBatch.length, 
        remaining: rowsToProcess.length - currentBatch.length 
    };

  } catch (e) {
    console.error("Worker Error:", e);
    return { status: 'ERROR', message: e.message };
  } finally {
    lock.releaseLock();
  }
}

// ================================================================
// 3. INTERNE VERARBEITUNG (1:1 Logik aus v5.2 executeBudgetRun_)
// ================================================================
function processBatchItems_(batch, formData, sheet) {
    // Mappings vorbereiten
    const cidColIndex = columnLetterToIndex_(formData.cidCol, sheet);
    const recipientColIndex = columnLetterToIndex_(formData.recipientCol, sheet);
    const statusColIndex = columnLetterToIndex_(formData.statusCol, sheet);
    const ccColIndex = formData.ccCol ? columnLetterToIndex_(formData.ccCol, sheet) : -1;
    
    const placeholderMap = buildPlaceholderMap_budget(formData, sheet);
    
    // Template laden
    let emailTemplate;
    try {
       emailTemplate = getGmailTemplateFromDrafts__emails(formData.subjectLine, true);
    } catch(e) {
       throw new Error(`Draft Template nicht gefunden: "${formData.subjectLine}"`);
    }

    // SCHLEIFE DURCH DIE ITEMS
    for (const item of batch) {
        const rowNumber = item.rowNumber;
        const rowData = item.rowData;

        try {
             // Status setzen
             sheet.getRange(rowNumber, statusColIndex + 1).setValue("Processing...");
             SpreadsheetApp.flush(); // Wichtig: Sofortiges Feedback im Sheet

             const cidRaw = String(rowData[cidColIndex] || '').trim();
             const recipientRaw = String(rowData[recipientColIndex] || '').trim();
             const ccRaw = (ccColIndex > -1) ? String(rowData[ccColIndex] || '').trim() : "";

             if (!cidRaw) throw new Error("Missing CID");
             if (!recipientRaw.includes('@')) throw new Error("Invalid Email");

             // 1. KI Analyse (External Tool)
             const analysisResult = generateUnifiedAiBudgetAnalysis(cidRaw, formData.dateRange);
             
             // 2. PDF Erstellung (External Tool) - mit Sicherheitscheck
             const finalAttachments = [...emailTemplate.attachments];
             
             if (formData.enablePdfAttachment) {
                // Fallbacks, falls Analyse-Daten unvollst?ndig
                const pdfData = analysisResult.allCampaignsData || [];
                const pdfCurr = analysisResult.currency || "EUR";
                const pdfCid = analysisResult.externalCid || cidRaw;

                if (pdfData.length > 0) {
                    try {
                        const pdfBlob = createBudgetReportPdf_(pdfData, pdfCurr, pdfCid, formData.dateRange);
                        if (pdfBlob) finalAttachments.push(pdfBlob);
                    } catch(pdfErr) {
                        console.error("PDF Gen Error:", pdfErr);
                    }
                }
             }

             // 3. Platzhalter & Template
             const rowDataForPlaceholders = extractPlaceholderValues_(rowData, placeholderMap);
             const finalSubject = fillPlaceholdersInString_(formData.subjectLine, rowDataForPlaceholders);
             let finalBodyHtml = fillPlaceholdersInString_(emailTemplate.message.html, rowDataForPlaceholders);
             let finalBodyText = fillPlaceholdersInString_(emailTemplate.message.text, rowDataForPlaceholders);

             // KI Content einf?gen
             const aiContent = analysisResult.aiHtml || "<p>Keine Analyse verf?gbar.</p>";
             finalBodyHtml = finalBodyHtml.replace('{{budget_recommendation}}', aiContent);
             finalBodyText = finalBodyText.replace('{{budget_recommendation}}', 'Siehe HTML-Version.');

             // 4. Draft erstellen
             const options = {
                 htmlBody: finalBodyHtml,
                 cc: ccRaw.replace(/;\s*/g, ',').trim() || undefined,
                 attachments: finalAttachments,
                 inlineImages: emailTemplate.inlineImages,
                 bcc: buildBccString_budget({ sharedInbox: formData.bccSharedInbox, pop: formData.bccPop })
             };
             
             GmailApp.createDraft(recipientRaw, finalSubject, finalBodyText, options);
             
             // Erfolg markieren
             sheet.getRange(rowNumber, statusColIndex + 1).setValue("Draft Saved");
             
        } catch (e) {
            sheet.getRange(rowNumber, statusColIndex + 1).setValue("Error: " + e.message);
        }
        
        // Nach jeder Zeile speichern!
        SpreadsheetApp.flush();
    }
}

// ================================================================
// LOKALE HELPER (Identisch zu v5.2)
// ================================================================

function buildBccString_budget(t) { 
  const b = []; 
  if(t.sharedInbox) b.push('gcs-sharedinbox@google.com'); 
  if(t.pop) b.push('gcs-pop@google.com'); 
  return b.join(', ') || undefined; 
}

function buildPlaceholderMap_budget(formData, sheet) {
  const map = {};
  if (Array.isArray(formData.placeholders)) {
    formData.placeholders.forEach(ph => {
      if (ph.name && ph.col) map[ph.name] = columnLetterToIndex_(ph.col, sheet);
    });
  }
  return map;
}

function extractPlaceholderValues_(rowData, placeholderMap) {
  const values = {};
  for (const name in placeholderMap) {
    const index = placeholderMap[name];
    values[name] = (index > -1 && index < rowData.length) ? (rowData[index]?.toString().trim() ?? "") : "";
  }
  return values;
}

// ANMERKUNG:
// Die Funktionen columnLetterToIndex_, generateUnifiedAiBudgetAnalysis, 
// createBudgetReportPdf_ und fillPlaceholdersInString_
// m?ssen in '100-1 helperstools.gs' vorhanden sein.
