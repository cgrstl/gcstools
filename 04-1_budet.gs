/**
 * @file 04-1_budet.gs (Version 4.4 - Attachment Cleanup Logic)
 * @description Orchestrator f?r Budget-Empfehlungen.
 * - Verarbeitet Batch-Logik.
 * - Bereinigt alte Attachments beim Start.
 * - Pufferung von gro?en Anh?ngen ?ber DriveApp.
 */

const BATCH_SIZE = 3;
const TRIGGER_DELAY_SECONDS = 15;

function processEmailRequest(formData) {
  Logger.log(`\n=== START processEmailRequest (Orchestrator) ===`);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet();
    
    Logger.log(`> Initializing for Spreadsheet: "${ss.getName()}"`);

    // 1. Alte Trigger & Daten bereinigen
    deleteTrigger_('executeBudgetRun_');
    
    // WICHTIG: Alte Formulardaten explizit l?schen, damit keine alten Anh?nge ?berleben
    PropertiesService.getScriptProperties().deleteProperty('budgetBatchFormData');
    Logger.log("> Previous session data cleared.");
    
    // 2. GROSSE DATEIEN BEHANDELN (Drive Pufferung)
    if (formData.attachedFiles && formData.attachedFiles.length > 0) {
        Logger.log(`> Offloading ${formData.attachedFiles.length} attachments to Drive temp storage...`);
        const processedFiles = [];
        
        for (const file of formData.attachedFiles) {
            if (file.base64data) {
                const blob = Utilities.newBlob(Utilities.base64Decode(file.base64data), file.mimeType, file.filename);
                const driveFile = DriveApp.createFile(blob);
                
                processedFiles.push({
                    filename: file.filename,
                    mimeType: file.mimeType,
                    driveFileId: driveFile.getId(),
                    isTemp: true
                });
                Logger.log(`  - Uploaded "${file.filename}" to Drive (ID: ${driveFile.getId()})`);
            }
        }
        formData.attachedFiles = processedFiles;
    } else {
        // Wenn KEINE Dateien da sind, explizit leeres Array setzen
        formData.attachedFiles = [];
    }

    // 3. Konfiguration speichern
    formData.spreadsheetId = ss.getId();
    formData.sheetName = sheet.getName();
    
    PropertiesService.getScriptProperties().setProperty('budgetBatchFormData', JSON.stringify(formData));
    Logger.log("> New configuration saved.");

    // 4. Starten
    executeBudgetRun_();

    return {
      status: 'BATCH_RUNNING',
      succeeded: [1], failedInput: [], failedProcessing: [], skipped: []
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
  let formData = null; 

  try {
    // 1. Config laden
    const formDataJson = PropertiesService.getScriptProperties().getProperty('budgetBatchFormData');
    if (!formDataJson) {
      Logger.log("STOP: No configuration found.");
      deleteTrigger_('executeBudgetRun_');
      lock.releaseLock();
      return;
    }
    formData = JSON.parse(formDataJson);

    // 2. Sheet ?ffnen
    const spreadsheet = SpreadsheetApp.openById(formData.spreadsheetId);
    const sheet = spreadsheet.getSheetByName(formData.sheetName);
    if (!sheet) {
        Logger.log(`CRITICAL: Sheet "${formData.sheetName}" not found!`);
        lock.releaseLock();
        return;
    }

    // 3. Spalten Mapping
    const executionColIndex = columnLetterToIndex_(formData.executionCol, sheet);
    const cidColIndex = columnLetterToIndex_(formData.cidCol, sheet);
    const recipientColIndex = columnLetterToIndex_(formData.recipientCol, sheet);
    const statusColIndex = columnLetterToIndex_(formData.statusCol, sheet);
    const ccColIndex = formData.ccCol ? columnLetterToIndex_(formData.ccCol, sheet) : -1;
    
    if (executionColIndex === -1 || cidColIndex === -1 || statusColIndex === -1) {
        Logger.log("CRITICAL: Invalid column mapping.");
        lock.releaseLock();
        return;
    }

    // Placeholder Map
    const placeholderMap = buildPlaceholderMap_budget(formData, sheet);
    
    // Daten lesen
    const maxRows = sheet.getMaxRows();
    const allIndices = [executionColIndex, cidColIndex, recipientColIndex, statusColIndex, ccColIndex, ...Object.values(placeholderMap)];
    const readWidth = Math.max(...allIndices.filter(i => i > -1)) + 1;
    
    const data = sheet.getRange(1, 1, maxRows, readWidth).getValues();
    const rowsToProcess = [];

    for (let i = 0; i < data.length; i++) {
      const trigger = String(data[i][executionColIndex] || '').trim();
      const status = String(data[i][statusColIndex] || '').trim();
      if (trigger === '1' && status === '') {
        rowsToProcess.push({ rowNumber: i + 1, rowData: data[i] });
      }
    }

    // 4. Batch Check & Cleanup
    if (rowsToProcess.length === 0) {
      Logger.log("=== ALL DONE. Stopping Triggers & Cleaning up. ===");
      
      // CLEANUP: Tempor?re Dateien l?schen
      if (formData.attachedFiles && formData.attachedFiles.length > 0) {
          formData.attachedFiles.forEach(f => {
              if (f.driveFileId && f.isTemp) {
                  try { 
                      DriveApp.getFileById(f.driveFileId).setTrashed(true); 
                      Logger.log(`Deleted temp file: ${f.filename}`);
                  } catch(e) {
                      Logger.log(`Warning: Could not delete temp file ${f.driveFileId}: ${e.message}`);
                  }
              }
          });
      }

      deleteTrigger_('executeBudgetRun_');
      PropertiesService.getScriptProperties().deleteProperty('budgetBatchFormData');
      lock.releaseLock();
      return;
    }

    // 5. Batch Verarbeitung
    const currentBatch = rowsToProcess.slice(0, BATCH_SIZE);
    Logger.log(`> Processing Batch of ${currentBatch.length} rows...`);

    const emailTemplate = getGmailTemplateFromDrafts__emails(formData.subjectLine, true);
    
    // ANH?NGE LADEN
    const userAttachments = [];
    if (formData.attachedFiles && formData.attachedFiles.length > 0) {
        formData.attachedFiles.forEach(file => {
            if (file.driveFileId) {
                try {
                    const blob = DriveApp.getFileById(file.driveFileId).getBlob();
                    userAttachments.push(blob);
                } catch(e) {
                    Logger.log(`Error retrieving attachment "${file.filename}" from Drive: ${e.message}`);
                }
            }
        });
    }

    for (const item of currentBatch) {
      const rowNumber = item.rowNumber;
      const rowData = item.rowData;
      Logger.log(`\n--- Processing Row ${rowNumber} ---`);

      try {
        sheet.getRange(rowNumber, statusColIndex + 1).setValue("Processing...");
        
        const cidRaw = String(rowData[cidColIndex] || '').trim();
        const recipientRaw = String(rowData[recipientColIndex] || '').trim();
        const ccRaw = (ccColIndex > -1) ? String(rowData[ccColIndex] || '').trim() : "";

        if (!cidRaw) throw new Error("Missing CID");
        if (!recipientRaw.includes('@')) throw new Error("Invalid Email");

        // KI Analyse (Single Source of Truth)
        const analysisResult = generateUnifiedAiBudgetAnalysis(cidRaw, formData.dateRange);

        // Template
        const rowDataForPlaceholders = extractPlaceholderValues_(rowData, placeholderMap);
        const finalSubject = fillPlaceholdersInString_(formData.subjectLine, rowDataForPlaceholders);
        let finalBodyHtml = fillPlaceholdersInString_(emailTemplate.message.html, rowDataForPlaceholders);
        let finalBodyText = fillPlaceholdersInString_(emailTemplate.message.text, rowDataForPlaceholders);

        finalBodyHtml = finalBodyHtml.replace('{{ai_budget_recommendations}}', analysisResult.aiHtml);
        finalBodyText = finalBodyText.replace('{{ai_budget_recommendations}}', 'Siehe HTML-Version f?r AI-Analyse.');

        // Anh?nge
        const finalAttachments = [...emailTemplate.attachments, ...userAttachments];
        
        if (formData.enablePdfAttachment) {
           const pdfBlob = createBudgetReportPdf_(
             analysisResult.allCampaignsData, 
             analysisResult.currency, 
             analysisResult.externalCid,
             formData.dateRange
           );
           if (pdfBlob) finalAttachments.push(pdfBlob);
        }

        const options = {
          htmlBody: finalBodyHtml,
          cc: ccRaw.replace(/;\s*/g, ',').trim() || undefined,
          attachments: finalAttachments,
          inlineImages: emailTemplate.inlineImages,
          bcc: buildBccString_budget({ sharedInbox: formData.bccSharedInbox, pop: formData.bccPop })
        };

        GmailApp.createDraft(recipientRaw, finalSubject, finalBodyText, options);
        
        sheet.getRange(rowNumber, statusColIndex + 1).setValue("Draft Saved");
        Logger.log("  SUCCESS: Draft Created.");

      } catch (e) {
        Logger.log(`  ERROR Row ${rowNumber}: ${e.message}`);
        sheet.getRange(rowNumber, statusColIndex + 1).setValue(`Error: ${e.message}`);
      }
    }

    SpreadsheetApp.flush();

    if (rowsToProcess.length > BATCH_SIZE) {
      createTrigger_('executeBudgetRun_', TRIGGER_DELAY_SECONDS);
    } else {
      createTrigger_('executeBudgetRun_', TRIGGER_DELAY_SECONDS);
    }

  } catch (e) {
    Logger.log(`GLOBAL ERROR: ${e.message}`);
    createTrigger_('executeBudgetRun_', TRIGGER_DELAY_SECONDS);
  } finally {
    lock.releaseLock();
  }
}

// --- Helper Wrappers & Utils ---
function createTrigger_(func, sec) {
  deleteTrigger_(func);
  ScriptApp.newTrigger(func).timeBased().after(sec * 1000).create();
}

function deleteTrigger_(funcName) {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => { if(t.getHandlerFunction() === funcName) ScriptApp.deleteTrigger(t); });
}

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
    if (index > -1 && index < rowData.length) {
      values[name] = rowData[index]?.toString().trim() ?? "";
    } else {
      values[name] = "";
    }
  }
  return values;
}

function getGmailTemplateFromDrafts__emails(subject_line, requireUnique = false) {
  if (!subject_line || subject_line.trim() === "") throw new Error("Subject line cannot be empty.");
  const drafts = GmailApp.getDrafts();
  const matchingDrafts = drafts.filter(d => d.getMessage().getSubject() === subject_line);
  if (matchingDrafts.length === 0) throw new Error(`No Gmail draft found with subject: "${subject_line}"`);
  if (requireUnique && matchingDrafts.length > 1) throw new Error(`Multiple Gmail drafts found.`);

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

function convertBase64ToBlobs_(files) {
    if (!files || files.length === 0) return [];
    return files.map(file => Utilities.newBlob(Utilities.base64Decode(file.base64data), file.mimeType, file.filename));
}