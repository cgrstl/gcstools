/**
* @file 03-1_chusers.gs
* @description Server-side logic for the "Find Change History Users" tool.
* This script processes requests from its corresponding sidebar (03-2_chuserssidebar.html),
* fetches user data from Google Ads change history based on sheet triggers and CIDs,
* and writes the results back to the sheet. Relies on helper functions from 'helperstools.gs'.
* @OnlyCurrentDoc
* @Needs InternalAdsApp // Or your specific Ads API service, ensure its scope is in appsscript.json
* @Needs GmailApp // For sending email reports
*/

// ================================================================
// FIND USERS CORE FUNCTIONS (Called by 03-2_chuserssidebar.html)
// ================================================================

/**
* Processes form data submitted from the sidebar to fetch Google Ads change history users.
* Writes results (last user, and optionally prior users) back to the active sheet.
* Returns a categorized results object for display in the sidebar.
*
* @param {object} formData An object containing the user's selections from the sidebar, including
* column letters for trigger, CID, output columns, lookback window,
* and settings for retrieving additional users.
* @return {object} An object structured as {
* processedRowCount: number,
* succeeded: Array<{row: number, details: string}>,
* notFound: Array<{row: number, details: string}>,
* errorsLookup: Array<{row: number, details: string}>
* }
*/
function processFormData(formData) {
  Logger.log(`Starting processFormData (Find Users) with formData: ${JSON.stringify(formData)}`);

  const results = {
    processedRowCount: 0,
    succeeded: [],
    notFound: [],
    errorsLookup: []
  };

  try {
    // --- 1. Setup & Get Active Sheet Data ---
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet();

    // --- 2. Map Column Letters to Indices & Validate ---
    // Using centralized columnLetterToIndex_ from helperstools.gs
    const cidColIndex = columnLetterToIndex_(formData.cidCol, sheet);
    const triggerColIndex = columnLetterToIndex_(formData.triggerCol, sheet);
    const lastUserColIndex = columnLetterToIndex_(formData.lastUserCol, sheet);

    let secondLastUserColIndex = -1;
    if (formData.activateSecondLastUser && formData.reportAdditionalUsersSeparately && formData.secondLastUserCol) {
        secondLastUserColIndex = columnLetterToIndex_(formData.secondLastUserCol, sheet);
    }
    let thirdLastUserColIndex = -1;
    if (formData.activateThirdLastUser && formData.reportAdditionalUsersSeparately && formData.thirdLastUserCol) {
        thirdLastUserColIndex = columnLetterToIndex_(formData.thirdLastUserCol, sheet);
    }
    let fourthLastUserColIndex = -1;
    if (formData.activateFourthLastUser && formData.reportAdditionalUsersSeparately && formData.fourthLastUserCol) {
        fourthLastUserColIndex = columnLetterToIndex_(formData.fourthLastUserCol, sheet);
    }

    let colErrors = [];
    if (cidColIndex === -1 && formData.cidCol) colErrors.push(`CID ('${formData.cidCol}')`);
    if (triggerColIndex === -1 && formData.triggerCol) colErrors.push(`Trigger ('${formData.triggerCol}')`);
    if (lastUserColIndex === -1 && formData.lastUserCol) colErrors.push(`Last User (Output) ('${formData.lastUserCol}')`);
    if (formData.reportAdditionalUsersSeparately) {
        if (formData.activateSecondLastUser && secondLastUserColIndex === -1 && formData.secondLastUserCol) colErrors.push(`2nd Last User ('${formData.secondLastUserCol}')`);
        if (formData.activateThirdLastUser && thirdLastUserColIndex === -1 && formData.thirdLastUserCol) colErrors.push(`3rd Last User ('${formData.thirdLastUserCol}')`);
        if (formData.activateFourthLastUser && fourthLastUserColIndex === -1 && formData.fourthLastUserCol) colErrors.push(`4th Last User ('${formData.fourthLastUserCol}')`);
    }
    if (colErrors.length > 0) {
        throw new Error(`Invalid column letter(s) for sheet "${sheet.getName()}": ${colErrors.join(', ')}.`);
    }
    Logger.log(`Find Users - Column Indices: CID=${cidColIndex}, Trigger=${triggerColIndex}, LastUser=${lastUserColIndex}, 2nd=${secondLastUserColIndex}, 3rd=${thirdLastUserColIndex}, 4th=${fourthLastUserColIndex}`);

    // --- 3. Calculate Lookback Dates ---
    const lookbackDays = parseInt(formData.lookbackWindow);
      if (isNaN(lookbackDays) || lookbackDays <= 0 || lookbackDays > 30) {
        throw new Error("Invalid lookback window (must be an integer between 1-30 days).");
      }
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - (lookbackDays - 1));
    // FIX: Get spreadsheet timezone, and if it's not a valid (truthy) string, use hardcoded "Europe/Dublin"
    const timeZone = ss.getSpreadsheetTimeZone() || "Europe/Dublin"; // Fallback to hardcoded if spreadsheet timezone is problematic
    const startDateStr = Utilities.formatDate(startDate, timeZone, 'yyyy-MM-dd');
    const endDateStr = Utilities.formatDate(endDate, timeZone, 'yyyy-MM-dd');
    const dateCondition = `change_event.change_date_time BETWEEN '${startDateStr}' AND '${endDateStr}'`;
    Logger.log(`Find Users - Date Range: '${startDateStr}' to '${endDateStr}'. Condition: ${dateCondition}`);

    // --- 4. Get Triggered Rows and Iterate ---
    const triggeredRows = getTriggeredRows_(sheet, triggerColIndex);
    results.processedRowCount = triggeredRows.length; // Update processedRowCount

    if (triggeredRows.length === 0) {
      Logger.log(`Find Users - No rows met the trigger condition ('1').`);
      results.notFound.push({ row: 'N/A', details: "No rows marked '1' found in the sheet to process." });
      return results;
    }

    // Deep copy all sheet values to modify and write back. Need to ensure `outputValues` grows as needed.
    const range = sheet.getDataRange();
    const allValues = range.getValues();
    const outputValues = JSON.parse(JSON.stringify(allValues));

    triggeredRows.forEach(triggeredRow => {
      const sheetRowNumber = triggeredRow.rowNumber; // 1-based row number
      const currentRowData = triggeredRow.data;       // The array of cell values for this row (0-based)
      const rowIndex = sheetRowNumber - 1;            // 0-based index for `outputValues`

      // Ensure CID column index is within current row bounds
      if (cidColIndex >= currentRowData.length) {
          const errorMsg = "CID column missing in this row (index out of bounds).";
          Logger.log(`Row ${sheetRowNumber}: ${errorMsg}`);
          writeStatusToSheet_chusers(outputValues, rowIndex, lastUserColIndex, `Error: ${errorMsg}`); // Using specific helper
          results.errorsLookup.push({ row: sheetRowNumber, details: errorMsg });
          return; // Skip to next triggered row
      }
      const cid = currentRowData[cidColIndex];

      clearOutputForRow_chusers(outputValues, rowIndex, lastUserColIndex, secondLastUserColIndex, thirdLastUserColIndex, fourthLastUserColIndex, formData); // Using specific helper

      if (!cid) {
        const errorMsg = "Missing CID in trigger-marked row.";
        Logger.log(`Row ${sheetRowNumber}: Skipping - ${errorMsg}.`);
        writeStatusToSheet_chusers(outputValues, rowIndex, lastUserColIndex, `Error: ${errorMsg}`);
        results.errorsLookup.push({ row: sheetRowNumber, details: errorMsg });
        return; // Skip to next triggered row
      }

      let externalCid;
      try {
        const currentCidTrimmed = String(cid).trim();
        // Replace InternalAdsApp.getExternalCustomerIds with your actual Ads API call if different
        const externalIds = InternalAdsApp.getExternalCustomerIds([currentCidTrimmed]);
        if (externalIds && externalIds[currentCidTrimmed]) {
          externalCid = externalIds[currentCidTrimmed];
        } else {
          throw new Error("Invalid CID or No Access from Ads API.");
        }
      } catch (e) {
        const errorMsg = `CID Lookup Error: ${e.message.substring(0, 100)}`;
        Logger.log(`Row ${sheetRowNumber}: ERROR during External CID lookup for "${cid}": ${e.message}`);
        writeStatusToSheet_chusers(outputValues, rowIndex, lastUserColIndex, `Error: ${errorMsg}`);
        results.errorsLookup.push({ row: sheetRowNumber, details: errorMsg });
        return; // Skip to next triggered row
      }

      try {
        const apiCid = externalCid.replace(/-/g, ''); // Remove hyphens for API usage
        const request = {
          customerId: apiCid,
          query: `
            SELECT change_event.change_date_time, change_event.user_email
            FROM change_event WHERE ${dateCondition}
            ORDER BY change_event.change_date_time DESC
            LIMIT 500`, // Sufficient limit to find up to 4 unique users
        };

        // Replace InternalAdsApp.search with your actual Ads API call if different
        const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
        const response = JSON.parse(responseJson);

        const uniqueUsers = [];
        const seenEmails = new Set();

        let maxNeeded = 1; // Always need at least the last user
        if (formData.activateSecondLastUser) maxNeeded++;
        if (formData.activateThirdLastUser) maxNeeded++;
        if (formData.activateFourthLastUser) maxNeeded++;

        if (response.results && response.results.length > 0) {
          for (const result of response.results) {
              if (!result.changeEvent || !result.changeEvent.userEmail) continue;
              const userEmail = result.changeEvent.userEmail;
              if (userEmail && typeof userEmail === 'string' && userEmail.includes('@') && !seenEmails.has(userEmail)) {
                  uniqueUsers.push(userEmail);
                  seenEmails.add(userEmail);
                  // Stop if we have enough users for the requested separate columns, or up to 4 for combined.
                  if (uniqueUsers.length >= maxNeeded) break;
              }
          }
        }

        if (uniqueUsers.length > 0) {
          writeUsersToSheet_chusers(outputValues, rowIndex, uniqueUsers, lastUserColIndex, secondLastUserColIndex, thirdLastUserColIndex, fourthLastUserColIndex, formData); // Using specific helper
          results.succeeded.push({ row: sheetRowNumber, details: uniqueUsers.join('; ') });
        } else {
          const notFoundMsg = "No valid changes/users found in lookback period.";
          writeStatusToSheet_chusers(outputValues, rowIndex, lastUserColIndex, notFoundMsg);
          results.notFound.push({ row: sheetRowNumber, details: notFoundMsg });
        }

      } catch (error) {
        const errorMsg = `Ads API Error: ${error.message.substring(0, 150)}`;
        Logger.log(`Row ${sheetRowNumber} / CID ${cid}: ERROR during Ads API call: ${error.message} Stack: ${error.stack ? error.stack : 'N/A'}`);
        writeStatusToSheet_chusers(outputValues, rowIndex, lastUserColIndex, `Error: ${errorMsg}`);
        results.errorsLookup.push({ row: sheetRowNumber, details: errorMsg });
      }
    });

    if (results.processedRowCount > 0) {
      Logger.log(`Find Users - Processed ${results.processedRowCount} rows. Writing results back to sheet.`);
        const finalNumCols = outputValues.reduce((max, r) => Math.max(max, r.length), 0);
        const correctedOutputValues = outputValues.map(r => {
            while (r.length < finalNumCols) r.push("");
            return r;
        });

        if (correctedOutputValues.length > 0 && (finalNumCols > 0 || correctedOutputValues.length === 0) ) {
            if (correctedOutputValues.length > 0 && finalNumCols > 0) {
              sheet.getRange(1,1, correctedOutputValues.length, finalNumCols).setValues(correctedOutputValues);
            } else if (correctedOutputValues.length === 0) {
              Logger.log("Find Users - No data to write back (outputValues is empty).");
            } else {
              Logger.log("Find Users - No columns to write back (finalNumCols is 0).");
            }
        } else if (allValues.length > 0) { // Check against initial allValues length if outputValues somehow empty
            Logger.log(`CRITICAL ERROR: Output array dimension mismatch or empty (Find Users). Write cancelled. outputValues.length: ${correctedOutputValues.length}. finalNumCols: ${finalNumCols}`);
            results.errorsLookup.push({row: 'N/A', details: 'Internal Error: Output dimension mismatch on write (Find Users).'});
        }
    } else {
        Logger.log(`Find Users - Processing complete. No rows met the trigger condition ('1').`);
    }

    Logger.log(`Find Users - Returning results: Succeeded: ${results.succeeded.length}, Not Found: ${results.notFound.length}, Errors: ${results.errorsLookup.length}`);
    return results;

  } catch (e) {
    Logger.log(`FATAL ERROR in processFormData (Find Users): ${e.message} \n Stack: ${e.stack ? e.stack : 'N/A'}`);
    results.errorsLookup.push({row: 'N/A', details: `Script Error: ${e.message}`});
    return results;
  }
}


// ================================================================
// EMAIL REPORT FUNCTION (REMOVED as per instruction)
// ================================================================
// The function sendReportViaEmail_chusers(results) has been removed.


// ================================================================
// HELPER FUNCTIONS (Specific to Find Users - 03-1_chusers.gs)
// These helpers are kept here as their logic is tightly coupled with this tool's specific output needs.
// ================================================================

/**
* Writes found users to the outputValues array for sheet update, for the Find Users tool.
* Handles single or multiple column output based on formData.
* @param {Array<Array<any>>} outputValues The 2D array representing sheet data to be modified.
* @param {number} rowIndex The 0-based row index in outputValues.
* @param {string[]} uniqueUsers Array of unique user email strings found.
* @param {number} lastUserColIndex 0-based index for the primary output column.
* @param {number} secondLastUserColIndex 0-based index for the 2nd user (if separate).
* @param {number} thirdLastUserColIndex 0-based index for the 3rd user (if separate).
* @param {number} fourthLastUserColIndex 0-based index for the 4th user (if separate).
* @param {object} formData The form data containing output preferences.
*/
function writeUsersToSheet_chusers(outputValues, rowIndex, uniqueUsers, lastUserColIndex, secondLastUserColIndex, thirdLastUserColIndex, fourthLastUserColIndex, formData) {
  const numUniqueUsers = uniqueUsers.length;
  if (numUniqueUsers === 0) return; // Should not happen if called after finding users
  if (rowIndex >= outputValues.length) {
      Logger.log(`Error in writeUsersToSheet_chusers: rowIndex ${rowIndex + 1} out of bounds.`);
      return;
  }
  const row = outputValues[rowIndex];

  const neededUsers = [uniqueUsers[0]]; // Always take the first one for the lastUserCol or combined output
  if (formData.activateSecondLastUser && numUniqueUsers >= 2) neededUsers.push(uniqueUsers[1]);
  if (formData.activateThirdLastUser && numUniqueUsers >= 3) neededUsers.push(uniqueUsers[2]);
  if (formData.activateFourthLastUser && numUniqueUsers >= 4) neededUsers.push(uniqueUsers[3]);

  const safeWrite = (colIndex, valueToWrite) => {
      if (colIndex !== -1) {
        while(row.length <= colIndex) row.push(""); // Ensure array is long enough
        row[colIndex] = valueToWrite;
      } else if (valueToWrite && String(valueToWrite).trim() !== "") {
          // This case means a user was found but the column to write to was not configured (colIndex is -1)
          Logger.log(`Warning in writeUsersToSheet_chusers: Attempted to write value "${valueToWrite}" to an invalid column index (-1) for row ${rowIndex + 1}. This output is skipped.`);
      }
  };

  if (formData.reportAdditionalUsersSeparately) {
    safeWrite(lastUserColIndex, neededUsers[0] || "");
    // Only write to additional columns if they were activated AND a user exists for that slot
    if(formData.activateSecondLastUser) safeWrite(secondLastUserColIndex, neededUsers.length >= 2 ? neededUsers[1] : "");
    if(formData.activateThirdLastUser)  safeWrite(thirdLastUserColIndex,  neededUsers.length >= 3 ? neededUsers[2] : "");
    if(formData.activateFourthLastUser) safeWrite(fourthLastUserColIndex, neededUsers.length >= 4 ? neededUsers[3] : "");
  } else {
    // Combine all 'neededUsers' (up to 4) into the primary output column
    safeWrite(lastUserColIndex, neededUsers.join('; '));
  }
}

/** * Writes a status/error message to the primary output column for a given row.
* Specific to Find Users tool.
* @param {Array<Array<any>>} outputValues The 2D array of sheet data.
* @param {number} rowIndex The 0-based row index.
* @param {number} primaryColIndex The 0-based column index to write the message to.
* @param {string} message The message to write.
*/
function writeStatusToSheet_chusers(outputValues, rowIndex, primaryColIndex, message) {
  if (rowIndex >= outputValues.length) {
      Logger.log(`Error in writeStatusToSheet_chusers: rowIndex ${rowIndex + 1} out of bounds.`);
      return;
  }
  const row = outputValues[rowIndex];

  if (primaryColIndex !== -1) {
      while(row.length <= primaryColIndex) row.push("");
      row[primaryColIndex] = message;
  } else {
      Logger.log(`Error in writeStatusToSheet_chusers: Invalid primary column index (-1) for row ${rowIndex + 1}. Message: "${message}" not written.`);
  }
}

/** * Clears the relevant output columns for a specific row in the output array.
* Specific to Find Users tool.
* @param {Array<Array<any>>} outputValues The 2D array of sheet data.
* @param {number} rowIndex The 0-based row index.
* @param {number} lastUserColIndex 0-based index.
* @param {number} secondLastUserColIndex 0-based index.
* @param {number} thirdLastUserColIndex 0-based index.
* @param {number} fourthLastUserColIndex 0-based index.
* @param {object} formData The form data to check reportAdditionalUsersSeparately.
*/
function clearOutputForRow_chusers(outputValues, rowIndex, lastUserColIndex, secondLastUserColIndex, thirdLastUserColIndex, fourthLastUserColIndex, formData) {
    if (rowIndex >= outputValues.length) {
        Logger.log(`Error in clearOutputForRow_chusers: rowIndex ${rowIndex + 1} out of bounds.`);
        return;
    }
    const row = outputValues[rowIndex];
    const safeClear = (colIndex) => {
        if (colIndex !== -1) {
            while(row.length <= colIndex) row.push("");
            row[colIndex] = "";
        }
    };

    safeClear(lastUserColIndex);

    if(formData.reportAdditionalUsersSeparately) {
      safeClear(secondLastUserColIndex);
      safeClear(thirdLastUserColIndex);
      safeClear(fourthLastUserColIndex);
    }
}