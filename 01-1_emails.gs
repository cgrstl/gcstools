/**
 * @file Combined_Email_Sender.gs
 * @description Consolidated server-side logic for the Mass Email Sender tool.
 * This file contains the main email processing functions and email-specific helpers.
 * It relies on '100-1_ghelpertools.gs' for general utility functions.
 * @OnlyCurrentDoc
 * @Needs GmailApp
 * @Needs SpreadsheetApp
 */

// ================================================================
// NEW FUNCTION: WEB APP FOR EMAIL OPEN TRACKING
// ================================================================

/**
 * Handles GET requests to the deployed script URL. This is the endpoint for the tracking pixel.
 * When an email is opened, this function is called, and it records the open event in the spreadsheet.
 *
 * @param {object} e The event parameter containing request details from the GET request.
 * Expected parameters: e.parameter.row and e.parameter.outputCol.
 * @return {ContentService.TextOutput} A 1x1 transparent GIF image.
 */
function doGet(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000); // Wait up to 15 seconds for the lock.

    const params = e.parameter;
    const row = parseInt(params.row, 10);
    const outputColLetter = params.outputCol;

    if (!isNaN(row) && outputColLetter) {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
      
      // Format the timestamp and create the specific "Opened" status message.
      const timestamp = new Date();
      const timezone = Session.getScriptTimeZone(); // Get the spreadsheet's timezone for accuracy
      const formattedDate = Utilities.formatDate(timestamp, timezone, "MM/dd/yyyy HH:mm");
      sheet.getRange(`${outputColLetter}${row}`).setValue(`Opened ${formattedDate}`);
    }
  } catch (err) {
    // Log errors but don't let it fail the image response.
    Logger.log(`Error in doGet tracking: ${err.message}`);
  } finally {
    lock.releaseLock();
  }

  // Return a 1x1 transparent GIF. This is crucial.
  const gifData = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  const image = Utilities.base64Decode(gifData);
  return ContentService.createImageOutput(image, ContentService.MimeType.GIF);
}


// ================================================================
// UPDATED FUNCTION: EMAIL SENDER CORE LOGIC
// ================================================================

/**
 * Processes an email request from the sidebar.
 * Fetches data, finds a Gmail draft, fills placeholders, adds a tracking pixel if enabled,
 * and then either sends emails or creates drafts.
 *
 * @param {object} formData An object containing user selections from the sidebar.
 * @return {object} A categorized results object for the sidebar's onSuccess handler.
 */
function processEmailRequest(formData) {
  Logger.log(`--- START processEmailRequest --- Action: ${formData.actionType}`);
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

    // Get tracking info from formData
    const enableTracking = formData.enableTracking;
    const trackingOutputCol = formData.trackingOutputCol;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet();

    const executionColIndex = columnLetterToIndex_(formData.executionCol, sheet);
    const recipientColIndex = columnLetterToIndex_(formData.recipientCol, sheet);
    const ccColIndex = formData.ccCol ? columnLetterToIndex_(formData.ccCol, sheet) : -1;
    const trackingOutputColIndex = enableTracking ? columnLetterToIndex_(trackingOutputCol, sheet) : -1;

    const enableBccSharedInbox = formData.bccSharedInbox;
    const sharedInboxBccAddress = 'gcs-sharedinbox@google.com';

    // Added validation for the new tracking column
    if (executionColIndex === -1) throw new Error(`Invalid Trigger Column letter: ${formData.executionCol}. Check if column exists and is accessible.`);
    if (recipientColIndex === -1) throw new Error(`Invalid Recipient Column letter: ${formData.recipientCol}. Check if column exists and is accessible.`);
    if (enableTracking && trackingOutputColIndex === -1) {
      throw new Error(`Invalid Tracking Output Column letter: ${trackingOutputCol}. Check if column exists and is accessible.`);
    }
    if (formData.ccCol && ccColIndex === -1) {
      Logger.log(`Warning: Invalid CC Column letter: ${formData.ccCol}. CC will be ignored. Check if column exists and is accessible.`);
    }

    const placeholderMap = {};
    const usedColumnIndices = new Set();
    if (executionColIndex !== -1) usedColumnIndices.add(executionColIndex);
    if (recipientColIndex !== -1) usedColumnIndices.add(recipientColIndex);
    if (ccColIndex !== -1) usedColumnIndices.add(ccColIndex);
    if (trackingOutputColIndex !== -1) usedColumnIndices.add(trackingOutputColIndex);

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

    let webAppUrl = null;
    if (enableTracking) {
      webAppUrl = ScriptApp.getService().getUrl();
      if (!webAppUrl) {
        throw new Error("Email tracking is enabled, but this script has not been deployed as a Web App. Please deploy it to use this feature.");
      }
    }

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

        // Add tracking pixel to the HTML body if enabled
        if (enableTracking && webAppUrl) {
          const trackingUrl = `${webAppUrl}?row=${sheetRowNumber}&outputCol=${trackingOutputCol}`;
          const trackingPixelHtml = `<img src="${trackingUrl}" width="1" height="1" style="display:none;border:0;width:1px;height:1px;" alt="" />`;
          finalBodyHtml += trackingPixelHtml;
        }

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

          // Set the initial "Not Opened" status in the sheet for sent emails.
          if (enableTracking) {
            sheet.getRange(`${trackingOutputCol}${sheetRowNumber}`).setValue("Not Opened");
          }
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
    Logger.log(`FATAL ERROR in processEmailRequest: ${e.message} \n Stack: ${e.stack ? e.stack : 'N/A'}`);
    results.failedProcessing.push({ row: 'N/A', recipient: 'N/A', details: `Script Error: ${e.message}` });
    return results;
  }
}


// ================================================================
// ORIGINAL HELPER FUNCTION (Must be kept)
// ================================================================

/**
 * Finds a unique Gmail draft matching the subject line and extracts its content.
 * Throws an error if no draft or multiple drafts are found when uniqueness is required.
 *
 * @param {string} subject_line The exact subject line of the draft to find.
 * @param {boolean} [requireUnique=false] If true, throws an error if multiple drafts match.
 * @return {object} An object containing message {text, html}, attachments (Array of Blobs), and inlineImages (Object).
 * @throws {Error} If no draft is found, or if multiple are found and requireUnique is true.
 */
function getGmailTemplateFromDrafts__emails(subject_line, requireUnique = false) {
  Logger.log(`Searching for Gmail draft with subject: "${subject_line}" (Require unique: ${requireUnique})`);
  if (!subject_line || subject_line.trim() === "") {
    throw new Error("Subject line for draft template cannot be empty.");
  }
  const drafts = GmailApp.getDrafts();
  const matchingDrafts = drafts.filter(d => d.getMessage().getSubject() === subject_line);

  if (matchingDrafts.length === 0) { throw new Error(`No Gmail draft found with subject: "${subject_line}"`); }
  if (requireUnique && matchingDrafts.length > 1) { throw new Error(`Multiple Gmail drafts (${matchingDrafts.length}) found with subject: "${subject_line}". Please ensure only one draft has this exact subject.`); }

  const draft = matchingDrafts[0];
  const msg = draft.getMessage();
  let attachments = [];
  let inlineImages = {};

  try {
    const regularAttachments = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });
    if (regularAttachments && regularAttachments.length > 0) {
      attachments = regularAttachments.map(a => {
        try { return a.copyBlob(); } catch (cbErr) { Logger.log(`Could not copy attachment blob "${a.getName()}": ${cbErr.message}`); return null; }
      }).filter(b => b !== null);
    }
  } catch (e) {
    Logger.log(`Could not get attachments for draft "${subject_line}": ${e.message}`);
  }

  try {
    const rawInlineImages = msg.getAttachments({ includeInlineImages: true, includeAttachments: false });
    if (rawInlineImages && rawInlineImages.length > 0) {
      rawInlineImages.forEach(img => {
        const headers = img.getHeaders();
        const cidHeader = headers && headers['Content-ID'];
        const cid = cidHeader ? String(cidHeader).replace(/[<>]/g, "") : null;

        if (cid) {
          try { inlineImages[cid] = img.copyBlob(); } catch (cbErr) { Logger.log(`Could not copy inline image blob "${img.getName()}" (CID: ${cid}): ${cbErr.message}`);}
        } else {
          Logger.log(`Warning: Found inline image named "${img.getName()}" without a Content-ID in draft "${subject_line}". It might not display correctly if referenced by CID.`);
        }
      });
    }
  } catch (e) {
    Logger.log(`Could not get inline images for draft "${subject_line}": ${e.message}`);
  }

  Logger.log(`Template extracted. Subject: "${msg.getSubject()}", Attachments: ${attachments.length}, Inline Images: ${Object.keys(inlineImages).length}`);
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
// GENERAL HELPER FUNCTIONS (Now assumed to be in 100-1_ghelpertools.gs)
// ================================================================
// It is assumed that functions like columnLetterToIndex_, fillPlaceholdersInString_,
// and getTriggeredRows_ are defined in your '100-1_ghelpertools.gs' file.
// ================================================================