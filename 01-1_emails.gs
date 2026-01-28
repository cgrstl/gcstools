/**
 * @file 01-1_emails.gs
 * @description Consolidated server-side logic for the Mass Email Sender tool.
 * This file contains the main email processing functions and email-specific helpers.
 * It relies on '100-1_helperstools.gs' for general utility functions.
 * @OnlyCurrentDoc
 * @Needs GmailApp
 * @Needs SpreadsheetApp
 */

// ================================================================
// EMAIL SENDER CORE LOGIC
// ================================================================

/**
 * Processes an email request from the sidebar.
 * Fetches data, finds a Gmail draft, fills placeholders,
 * and then either sends emails or creates drafts.
 *
 * RENAMED: processEmailRequest -> processEmailRequest_emails
 * to avoid conflict with the Budget Tool.
 *
 * @param {object} formData An object containing user selections from the sidebar.
 * @return {object} A categorized results object for the sidebar's onSuccess handler.
 */
function processEmailRequest_emails(formData) {
  Logger.log(`--- START processEmailRequest_emails --- Action: ${formData.actionType}`);
  Logger.log(`Received formData for Email Sender: ${JSON.stringify(formData)}`);
  
  const results = {
    processedRowCount: 0,
    actionType: formData.actionType || 'send',
    succeeded: [],
    failedInput: [],
    failedProcessing: []
  };

  try {
    if (!formData || !formData.subjectLine || !formData.recipientCol || !formData.executionCol) {
      throw new Error('Core settings (Subject, Recipient Column, Trigger Column) are missing from formData.');
    }
    const subjectLineTemplate = formData.subjectLine;

    // Tracking logic removed for security/policy compliance
    // const enableTracking = formData.enableTracking; 

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet();

    const executionColIndex = columnLetterToIndex_(formData.executionCol, sheet);
    const recipientColIndex = columnLetterToIndex_(formData.recipientCol, sheet);
    const ccColIndex = formData.ccCol ? columnLetterToIndex_(formData.ccCol, sheet) : -1;
    
    const enableBccSharedInbox = formData.bccSharedInbox;
    const sharedInboxBccAddress = 'gcs-sharedinbox@google.com';
    
    if (executionColIndex === -1) throw new Error(`Invalid Trigger Column letter: ${formData.executionCol}. Check if column exists and is accessible.`);
    if (recipientColIndex === -1) throw new Error(`Invalid Recipient Column letter: ${formData.recipientCol}. Check if column exists and is accessible.`);
    
    if (formData.ccCol && ccColIndex === -1) {
      Logger.log(`Warning: Invalid CC Column letter: ${formData.ccCol}. CC will be ignored. Check if column exists and is accessible.`);
    }

    const placeholderMap = {};
    const usedColumnIndices = new Set();
    if (executionColIndex !== -1) usedColumnIndices.add(executionColIndex);
    if (recipientColIndex !== -1) usedColumnIndices.add(recipientColIndex);
    if (ccColIndex !== -1) usedColumnIndices.add(ccColIndex);
    
    if (Array.isArray(formData.placeholders)) {
      formData.placeholders.forEach((ph, idx) => {
        const phColLetter = ph.col;
        const phName = ph.name;
        const phColIndex = columnLetterToIndex_(phColLetter, sheet);

        if (!phColLetter || phColIndex === -1) throw new Error(`Placeholder ${idx + 1} ('${phName || 'Untitled'}') is active but has an invalid Column: ${phColLetter || 'None'}.`);
        if (!phName) throw new Error(`Placeholder ${idx + 1} (Column ${phColLetter}) is active but its Tag is missing.`);
        if (!(phName.startsWith('{{') && phName.endsWith('}}') && phName.length > 4)) throw new Error(`Placeholder ${idx + 1} Tag ('${phName}') must be in {{PlaceholderName}} format.`);
        if (usedColumnIndices.has(phColIndex)) throw new Error(`Column ${phColLetter} used for Placeholder Tag '${phName}' is already used for another purpose.`);

        usedColumnIndices.add(phColIndex);
        placeholderMap[phName] = phColIndex;
      });
    }
    Logger.log(`Placeholder Map for Email Sender: ${JSON.stringify(placeholderMap)}`);

    let emailTemplate;
    try {
      Logger.log(`Attempting to find unique Gmail draft with subject: "${subjectLineTemplate}"`);
      emailTemplate = getGmailTemplateFromDrafts__emails(subjectLineTemplate, true);
      Logger.log("Successfully found and parsed unique email template draft.");
    } catch (e) {
      Logger.log(`Error finding email template draft: ${e.message}`);
      results.failedProcessing.push({ row: 'N/A', recipient: 'N/A', details: `Setup Error - Email Template: ${e.message}` });
      return results;
    }

    const triggeredRows = getTriggeredRows_(sheet, executionColIndex);
    results.processedRowCount = triggeredRows.length;
    if (triggeredRows.length === 0) {
      Logger.log("No rows marked with '1' found in the sheet. Email processing stopped.");
      results.failedProcessing.push({ row: 'N/A', recipient: 'N/A', details: "No rows marked '1' found in the sheet to process." });
      return results;
    }

    triggeredRows.forEach(triggeredRow => {
      const sheetRowNumber = triggeredRow.rowNumber;
      const rowData = triggeredRow.data;

      if (recipientColIndex >= rowData.length) {
        const errorMsg = `Recipient column (${formData.recipientCol}) data missing or column index out of bounds for row ${sheetRowNumber}.`;
        Logger.log(errorMsg);
        results.failedInput.push({ row: sheetRowNumber, recipient: 'N/A', details: errorMsg });
        return;
      }
     
      const recipientRaw = rowData[recipientColIndex]?.toString().trim() ?? "";
      const ccRaw = (ccColIndex !== -1 && ccColIndex < rowData.length) ? (rowData[ccColIndex]?.toString().trim() ?? "") : "";

      const recipient = recipientRaw.replace(/;\s*/g, ',').trim();
      const cc = ccRaw.replace(/;\s*/g, ',').trim();

      try {
        if (!recipient || !recipient.includes('@')) {
          throw new Error(`Invalid recipient email format: "${recipientRaw || ''}" for row ${sheetRowNumber}`);
        }

        const rowDataForPlaceholders = {};
        for (const phName in placeholderMap) {
          const phColIdx = placeholderMap[phName];
          rowDataForPlaceholders[phName] = (phColIdx < rowData.length) ? (rowData[phColIdx]?.toString().trim() ?? "") : "";
        }

        const finalSubject = fillPlaceholdersInString_(subjectLineTemplate, rowDataForPlaceholders);
        const finalBodyText = fillPlaceholdersInString_(emailTemplate.message.text, rowDataForPlaceholders);
        let finalBodyHtml = fillPlaceholdersInString_(emailTemplate.message.html, rowDataForPlaceholders);

        const options = {
          htmlBody: finalBodyHtml,
          cc: cc || undefined,
          attachments: emailTemplate.attachments,
          inlineImages: emailTemplate.inlineImages,
          bcc: enableBccSharedInbox ? sharedInboxBccAddress : undefined
        };

        if (results.actionType === 'send') {
          GmailApp.sendEmail(recipient, finalSubject, finalBodyText, options);
          results.succeeded.push({ row: sheetRowNumber, recipient: recipient, details: `Email sent successfully` });
        } else {
          GmailApp.createDraft(recipient, finalSubject, finalBodyText, options);
          results.succeeded.push({ row: sheetRowNumber, recipient: recipient, details: `Draft saved successfully` });
        }
      } catch (e) {
        const errorMsg = e.message.substring(0, 200);
        Logger.log(`Row ${sheetRowNumber}: ERROR processing email for "${recipient}": ${errorMsg}`);
        if (e.message.toLowerCase().includes("invalid recipient") || e.message.toLowerCase().includes("invalid email")) {
          results.failedInput.push({ row: sheetRowNumber, recipient: recipientRaw, details: errorMsg });
        } else {
          results.failedProcessing.push({ row: sheetRowNumber, recipient: recipientRaw, details: errorMsg });
        }
      }
    });
    Logger.log(`Email processing complete. Summary: Succeeded: ${results.succeeded.length}, FailedInput: ${results.failedInput.length}, FailedProcessing: ${results.failedProcessing.length}`);
    return results;
  } catch (e) {
    Logger.log(`FATAL ERROR in processEmailRequest_emails: ${e.message} \n Stack: ${e.stack ? e.stack : 'N/A'}`);
    results.failedProcessing.push({ row: 'N/A', recipient: 'N/A', details: `Script Error: ${e.message}` });
    return results;
  }
}

// ================================================================
// GENERAL HELPER FUNCTIONS (Now assumed to be in 100-1_helperstools.gs)
// ================================================================
// NOTE: columnLetterToIndex_, fillPlaceholdersInString_, and getTriggeredRows_ 
// are expected to be in '100-1_helperstools.gs'.