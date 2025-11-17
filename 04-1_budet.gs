/**
 * @file 04-1_budet.gs (Version 4.2 - DEBUG EDITION)
 * @description Orchestrator f?r Budget-Empfehlungen mit MAXIMALEM LOGGING.
 * - Enth?lt detaillierte Logs f?r Spalten-Mapping, Zeilen-Scan und Batch-Status.
 */

const BATCH_SIZE = 3;
const TRIGGER_DELAY_SECONDS = 15;

// ================================================================
// CORE PROCESSING FUNCTION (Called by 04-2_budgetsidebar.html)
// ================================================================

function processEmailRequest(formData) {
  Logger.log(`\n=== START processEmailRequest (Orchestrator) ===`);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet();
    
    Logger.log(`> Initializing for Spreadsheet: "${ss.getName()}"`);
    Logger.log(`> Active Sheet: "${sheet.getName()}"`);

    // 1. Trigger bereinigen
    deleteTrigger_('executeBudgetRun_');
    
    // 2. Konfiguration speichern
    formData.spreadsheetId = ss.getId();
    formData.sheetName = sheet.getName();
    PropertiesService.getScriptProperties().setProperty('budgetBatchFormData', JSON.stringify(formData));
    Logger.log("> Configuration saved to ScriptProperties.");

    // 3. Starten
    executeBudgetRun_();

    return {
      status: 'BATCH_RUNNING',
      succeeded: [1], 
      failedInput: [],
      failedProcessing: [],
      skipped: []
    };
  } catch (e) {
    Logger.log(`FATAL ERROR in processEmailRequest: ${e.message}`);
    return { status: 'ERROR', processedRowCount: 0, succeeded: [], failedInput: [], failedProcessing: [{ details: e.message }] };
  }
}

// ================================================================
// BATCH PROCESSING (Worker)
// ================================================================

function executeBudgetRun_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
      Logger.log("Skipping run: Lock busy.");
      return;
  }

  Logger.log("\n--- executeBudgetRun_ (Worker) Started ---");
  
  try {
    // 1. Config laden
    const formDataJson = PropertiesService.getScriptProperties().getProperty('budgetBatchFormData');
    if (!formDataJson) {
      Logger.log("STOP: No configuration found. Cleaning up.");
      deleteTrigger_('executeBudgetRun_');
      lock.releaseLock();
      return;
    }
    const formData = JSON.parse(formDataJson);

    // 2. Sheet ?ffnen
    const spreadsheet = SpreadsheetApp.openById(formData.spreadsheetId);
    const sheet = spreadsheet.getSheetByName(formData.sheetName);
    if (!sheet) {
        Logger.log(`CRITICAL: Sheet "${formData.sheetName}" not found!`);
        lock.releaseLock();
        return;
    }
    Logger.log(`> Accessing Sheet: "${sheet.getName()}" (ID check passed)`);

    // 3. Spalten Mapping & Validierung
    const executionColIndex = columnLetterToIndex_(formData.executionCol, sheet);
    const cidColIndex = columnLetterToIndex_(formData.cidCol, sheet);
    const recipientColIndex = columnLetterToIndex_(formData.recipientCol, sheet);
    const statusColIndex = columnLetterToIndex_(formData.statusCol, sheet);
    const ccColIndex = formData.ccCol ? columnLetterToIndex_(formData.ccCol, sheet) : -1;

    // --- DEBUG LOGGING: SPALTEN ---
    Logger.log(`> COLUMN MAPPING CHECK:`);
    Logger.log(`  - Trigger Col '${formData.executionCol}' -> Index ${executionColIndex}`);
    Logger.log(`  - CID Col '${formData.cidCol}' -> Index ${cidColIndex}`);
    Logger.log(`  - Status Col '${formData.statusCol}' -> Index ${statusColIndex}`);
    
    if (executionColIndex === -1 || cidColIndex === -1 || statusColIndex === -1) {
        Logger.log("CRITICAL: Invalid column mapping. Aborting.");
        lock.releaseLock();
        return;
    }

    // Placeholder Map
    const placeholderMap = buildPlaceholderMap_budget(formData, sheet);
    
    // Daten lesen
    const maxRows = sheet.getMaxRows();
    // Berechne Breite: Max Index + 1
    const allIndices = [executionColIndex, cidColIndex, recipientColIndex, statusColIndex, ccColIndex, ...Object.values(placeholderMap)];
    const readWidth = Math.max(...allIndices.filter(i => i > -1)) + 1;
    
    Logger.log(`> Reading Range: Rows 1-${maxRows}, Cols 1-${readWidth}`);
    const data = sheet.getRange(1, 1, maxRows, readWidth).getValues();
    const rowsToProcess = [];

    // --- DEBUG LOGGING: SCAN LOOP ---
    Logger.log(`> Scanning ${data.length} rows for Trigger='1' and Status=''...`);
    
    for (let i = 0; i < data.length; i++) {
      const rawTrigger = data[i][executionColIndex];
      const rawStatus = data[i][statusColIndex];
      
      const trigger = String(rawTrigger || '').trim();
      const status = String(rawStatus || '').trim();
      
      // Logge die ersten 10 Zeilen detailliert, damit wir sehen was passiert
      if (i < 10) {
          Logger.log(`  [Row ${i+1}] TriggerVal: "${trigger}" | StatusVal: "${status}"`);
      }

      if (trigger === '1' && status === '') {
        Logger.log(`  >>> MATCH FOUND at Row ${i+1}. Queueing.`);
        rowsToProcess.push({ rowNumber: i + 1, rowData: data[i] });
      }
    }
    Logger.log(`> Scan Complete. Found ${rowsToProcess.length} rows to process.`);


    // 4. Batch Check
    if (rowsToProcess.length === 0) {
      Logger.log("=== ALL DONE. Stopping Triggers. ===");
      deleteTrigger_('executeBudgetRun_');
      PropertiesService.getScriptProperties().deleteProperty('budgetBatchFormData');
      lock.releaseLock();
      return;
    }

    // 5. Batch Verarbeitung
    const currentBatch = rowsToProcess.slice(0, BATCH_SIZE);
    Logger.log(`> Processing Batch of ${currentBatch.length} rows (Limit: ${BATCH_SIZE})...`);

    const emailTemplate = getGmailTemplateFromDrafts__emails(formData.subjectLine, true);
    const userAttachments = convertBase64ToBlobs_(formData.attachedFiles || []);

    for (const item of currentBatch) {
      const rowNumber = item.rowNumber;
      const rowData = item.rowData;

      Logger.log(`\n--- Processing Row ${rowNumber} ---`);

      try {
        // Status Update: Processing
        sheet.getRange(rowNumber, statusColIndex + 1).setValue("Processing...");
        
        const cidRaw = String(rowData[cidColIndex] || '').trim();
        const recipientRaw = String(rowData[recipientColIndex] || '').trim();
        const ccRaw = (ccColIndex > -1) ? String(rowData[ccColIndex] || '').trim() : "";

        Logger.log(`  CID: ${cidRaw} | Recipient: ${recipientRaw}`);

        if (!cidRaw) throw new Error("Missing CID");
        if (!recipientRaw.includes('@')) throw new Error("Invalid Email");

        // >>> EXTERNAL AI CALL <<<
        Logger.log("  Invoking AI Analysis (1007-8)...");
        const analysisResult = generateUnifiedAiBudgetAnalysis(cidRaw, formData.dateRange);
        Logger.log("  AI Analysis returned.");
        // >>> END EXTERNAL CALL <<<

        // Template F?llung
        const rowDataForPlaceholders = extractPlaceholderValues_(rowData, placeholderMap);
        const finalSubject = fillPlaceholdersInString_(formData.subjectLine, rowDataForPlaceholders);
        
        let finalBodyHtml = fillPlaceholdersInString_(emailTemplate.message.html, rowDataForPlaceholders);
        let finalBodyText = fillPlaceholdersInString_(emailTemplate.message.text, rowDataForPlaceholders);

        finalBodyHtml = finalBodyHtml.replace('{{ai_budget_recommendations}}', analysisResult.aiHtml);
        finalBodyText = finalBodyText.replace('{{ai_budget_recommendations}}', 'Siehe HTML-Version f?r AI-Analyse.');

        const finalAttachments = [...emailTemplate.attachments, ...userAttachments];
        
        if (formData.enablePdfAttachment) {
           Logger.log("  Generating PDF...");
           const pdfBlob = createBudgetReportPdf_(
             analysisResult.allCampaignsData, 
             analysisResult.currency, 
             analysisResult.externalCid,
             formData.dateRange
           );
           if (pdfBlob) {
               finalAttachments.push(pdfBlob);
               Logger.log("  PDF attached.");
           } else {
               Logger.log("  PDF generation returned null.");
           }
        }

        const options = {
          htmlBody: finalBodyHtml,
          cc: ccRaw.replace(/;\s*/g, ',').trim() || undefined,
          attachments: finalAttachments,
          inlineImages: emailTemplate.inlineImages,
          bcc: buildBccString_budget({ sharedInbox: formData.bccSharedInbox, pop: formData.bccPop })
        };

        Logger.log("  Creating Gmail Draft...");
        GmailApp.createDraft(recipientRaw, finalSubject, finalBodyText, options);
        
        sheet.getRange(rowNumber, statusColIndex + 1).setValue("Draft Saved");
        Logger.log("  SUCCESS: Row finished.");

      } catch (e) {
        Logger.log(`  ERROR Row ${rowNumber}: ${e.message}`);
        sheet.getRange(rowNumber, statusColIndex + 1).setValue(`Error: ${e.message}`);
      }
    }

    SpreadsheetApp.flush();

    // 6. Trigger Management
    if (rowsToProcess.length > BATCH_SIZE) {
      Logger.log(`> Remaining rows: ${rowsToProcess.length - BATCH_SIZE}. Scheduling next trigger.`);
      createTrigger_('executeBudgetRun_', TRIGGER_DELAY_SECONDS);
    } else {
      Logger.log("> No more rows pending. Cleaning up.");
      deleteTrigger_('executeBudgetRun_');
      PropertiesService.getScriptProperties().deleteProperty('budgetBatchFormData');
    }

  } catch (e) {
    Logger.log(`GLOBAL ERROR in executeBudgetRun_: ${e.message}\n${e.stack}`);
    createTrigger_('executeBudgetRun_', TRIGGER_DELAY_SECONDS); // Retry mechanism
  } finally {
    lock.releaseLock();
    Logger.log("--- executeBudgetRun_ End ---\n");
  }
}


// ================================================================
// HELPERS & UTILS
// ================================================================

function createTrigger_(func, sec) {
  deleteTrigger_(func);
  ScriptApp.newTrigger(func).timeBased().after(sec * 1000).create();
}

function deleteTrigger_(funcName) {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => { if(t.getHandlerFunction() === funcName) ScriptApp.deleteTrigger(t); });
}

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
      if (ph.name && ph.col) {
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

  if (matchingDrafts.length === 0) throw new Error(`No Gmail draft found with subject: "${subject_line}"`);
  if (requireUnique && matchingDrafts.length > 1) throw new Error(`Multiple Gmail drafts found with subject: "${subject_line}".`);

  const msg = matchingDrafts[0].getMessage();
  let attachments = [];
  let inlineImages = {};

  try {
    attachments = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });
  } catch(e) { Logger.log(`Error attachments: ${e.message}`); }

  try {
    const rawInline = msg.getAttachments({ includeInlineImages: true, includeAttachments: false });
    rawInline.forEach(img => {
      const cidHeader = img.getHeaders()['Content-ID'];
      const cid = cidHeader ? String(cidHeader).replace(/[<>]/g, "") : null;
      if (cid) inlineImages[cid] = img.copyBlob();
    });
  } catch(e) { Logger.log(`Error inline images: ${e.message}`); }

  return {
    message: { text: msg.getPlainBody() || "", html: msg.getBody() || "" },
    attachments: attachments,
    inlineImages: inlineImages
  };
}