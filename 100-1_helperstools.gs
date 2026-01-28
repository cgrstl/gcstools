/**
* @file 100-1_helperstools.gs
* @description This file contains shared server-side utility functions for the GCS Tools project.
* These functions are intended to be called from other .gs files within the same Apps Script project.
*/

/**
* Converts a column letter (e.g., "A", "B", "AA") to its 0-based index for a given sheet.
* Validates the column letter against the actual boundaries of the provided sheet.
*
* @param {string} columnLetter The column letter to convert (case-insensitive).
* @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object for context (to get max columns).
* @return {number} The 0-based column index if valid, otherwise -1.
*/
function columnLetterToIndex_(columnLetter, sheet) {
  if (!columnLetter || typeof columnLetter !== 'string') {
    Logger.log(`Error in columnLetterToIndex_: columnLetter is invalid (not a string or empty). Input: "${columnLetter}"`);
    return -1;
  }
  // Ensure sheet is a valid Sheet object that has getMaxColumns method
  if (!sheet || typeof sheet.getMaxColumns !== 'function') {
      Logger.log(`Error in columnLetterToIndex_ for column "${columnLetter}": sheet parameter is invalid or not a valid Sheet object. Type: ${typeof sheet}`);
      return -1;
  }
    const letter = columnLetter.toUpperCase().trim();
  if (letter.length === 0) {
      Logger.log(`Error in columnLetterToIndex_: columnLetter is an empty string for sheet "${sheet.getName()}".`);
      return -1;
  }

  let column = 0;
  for (let i = 0; i < letter.length; i++) {
      const charCode = letter.charCodeAt(i);
      if (charCode < 65 || charCode > 90) { // ASCII 'A' is 65, 'Z' is 90
          Logger.log(`Error in columnLetterToIndex_: columnLetter "${columnLetter}" contains invalid characters (not A-Z) for sheet "${sheet.getName()}".`);
          return -1;
      }
      column = column * 26 + (charCode - 64);
  }
    try {
    const maxSheetCols = sheet.getMaxColumns();
    if (column <= 0 || column > maxSheetCols) {
        Logger.log(`Error in columnLetterToIndex_: column "${columnLetter}" (parsed as 1-based ${column}) is out of bounds for sheet "${sheet.getName()}" (max cols: ${maxSheetCols}).`);
        return -1;
    }
  } catch (e) {
    Logger.log(`Error getting max columns for sheet "${sheet.getName()}" in columnLetterToIndex_: ${e.message}`);
    return -1; // Fail safe if sheet object is unusual (e.g., from a different context)
  }
  return column - 1; // Return 0-based index
}

/**
* Escapes special characters in a string for safe inclusion in contexts like JSON strings or email bodies.
* Handles null, undefined, Dates, and other types by converting them to strings first.
*
* @param {*} value The input value to escape.
* @return {string} The escaped string. Returns an empty string if input is null or undefined.
*/
function escapeData_(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) { return value.toISOString(); }
    let str = String(value);

  return str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
}

/**
* Formats a Date object into a string for display, using a specified format and timezone.
* Provides a fallback to Date.toString() if formatting fails.
*
* @param {Date} date The Date object to format.
* @param {string} timeZone The IANA timezone string (e.g., "Europe/Dublin", or from Session/Spreadsheet).
* @param {string} format The format string compatible with Utilities.formatDate (e.g., "yyyy-MM-dd HH:mm z").
* @return {string} The formatted date-time string, or "Invalid Date" / fallback string if input is invalid or formatting fails.
*/
function formatDateTimeForDisplayUtils_(date, timeZone, format) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
      Logger.log(`formatDateTimeForDisplayUtils_: Invalid date provided: ${date}`);
      return "Invalid Date";
    }
    let tz = timeZone;
    if (!tz) {
      Logger.log(`formatDateTimeForDisplayUtils_: Timezone not provided for date: ${date}, using script's default: ${Session.getScriptTimeZone()}`);
      tz = Session.getScriptTimeZone();
    }
    let fmt = format;
    if (!fmt) {
      Logger.log(`formatDateTimeForDisplayUtils_: Format string not provided for date: ${date}, using default "yyyy-MM-dd HH:mm:ss z"`);
      fmt = "yyyy-MM-dd HH:mm:ss z";
    }
    try {
        return Utilities.formatDate(date, tz, fmt);
    } catch (e) {
        Logger.log(`Error formatting date "${String(date)}" with timezone "${tz}" and format "${fmt}": ${e.message}`);
        return String(date);
    }
}

/**
* Parses a "yyyy-MM-dd" date string into a Date object, set to the beginning of that day
* in the specified timezone using Utilities.parseDate.
*
* @param {string} dateStr The date string in "yyyy-MM-dd" format.
* @param {string} timeZone The IANA timezone string (e.g., from calendar.getTimeZone() or Session.getScriptTimeZone()).
* @return {Date} The parsed Date object.
* @throws {Error} if the date string is invalid or timezone is missing.
*/
function parseDateInCalendarTZ_(dateStr, timeZone) {
  if (!dateStr || typeof dateStr !== 'string') {
    throw new Error("parseDateInCalendarTZ_: dateStr parameter is missing or not a string.");
  }
  if (!timeZone || typeof timeZone !== 'string') {
    throw new Error("parseDateInCalendarTZ_: timeZone parameter is missing or not a string.");
  }
  try {
      const date = Utilities.parseDate(dateStr, timeZone, "yyyy-MM-dd");
      if (isNaN(date.getTime())) {
        throw new Error(`getTime() returned NaN for parsed date of "${dateStr}" in timezone "${timeZone}". Check date format and timezone validity.`);
      }
      return date;
  } catch(e) {
      Logger.log(`Error parsing date string "${dateStr}" with timezone "${timeZone}": ${e.message} (Original error: ${e.toString()})`);
      throw new Error(`Invalid date format for "${dateStr}". Please useYYYY-MM-DD. Original error: ${e.message}`);
  }
}

/**
* Parses an "HH:MM" time string and sets these hours and minutes on a given Date object,
* returning a new Date object. The date part of the original dateObj is preserved correctly for the given timezone.
*
* @param {string} timeStr The time string in "HH:MM" format (24-hour).
* @param {Date} dateObj The Date object whose date part will be used.
* @param {string} timeZone The IANA timezone string.
* @return {Date} A new Date object with the time set.
* @throws {Error} if the time string, date object, or timezone is invalid.
*/
function parseTimeAndSetOnDate_(timeStr, dateObj, timeZone) {
    if (!dateObj || !(dateObj instanceof Date) || isNaN(dateObj.getTime())) {
        throw new Error("parseTimeAndSetOnDate_: Invalid or missing dateObj provided.");
    }
    if (!timeStr || typeof timeStr !== 'string' || !/^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/.test(timeStr)) {
        throw new Error(`Invalid time format: "${timeStr}". Use HH:MM (24-hour).`);
    }
    if (!timeZone || typeof timeZone !== 'string') {
        throw new Error("parseTimeAndSetOnDate_: timeZone parameter is missing or not a string.");
    }

    try {
      const dateStringForParsing = Utilities.formatDate(dateObj, timeZone, "yyyy-MM-dd") + " " + timeStr;
      const formatForParsing = "yyyy-MM-dd HH:mm";
      const newDate = Utilities.parseDate(dateStringForParsing, timeZone, formatForParsing);

      if (isNaN(newDate.getTime())) {
        throw new Error (`Failed to parse combined date and time: "${dateStringForParsing}" with format "${formatForParsing}" in timezone "${timeZone}"`);
      }
      return newDate;
    } catch(e) {
        Logger.log(`Error parsing time string "${timeStr}" for date ${dateObj.toISOString()} in timezone ${timeZone}: ${e.message} (Original error: ${e.toString()})`);
        throw new Error(`Invalid time format or error setting time: "${timeStr}". Original error: ${e.message}`);
    }
}

/**
* Fills placeholders in a template string using a provided data map.
* Placeholders in the template string must be in the format {{PlaceholderName}}.
* Keys in the placeholderDataMap must also be in the format {{PlaceholderName}}.
*
* @param {string} templateString The string containing placeholders. Can be null or undefined.
* @param {Object<string, string|number|Date>} placeholderDataMap An object where keys are placeholder tags and values are replacements.
* @return {string} The template string with placeholders filled. Returns empty string if templateString is null/undefined.
*/
function fillPlaceholdersInString_(templateString, placeholderDataMap) {
  if (templateString === null || templateString === undefined) return "";
  if (typeof templateString !== 'string') templateString = String(templateString);
  if (!placeholderDataMap || typeof placeholderDataMap !== 'object') {
      Logger.log("fillPlaceholdersInString_: placeholderDataMap is not a valid object. Returning original template string.");
      return templateString;
  }
  return templateString.replace(/\{\{([^{}]+?)\}\}/g, (matchWithBrackets) => {
      return placeholderDataMap.hasOwnProperty(matchWithBrackets) ?
              escapeData_(placeholderDataMap[matchWithBrackets]) :
              matchWithBrackets;
  });
}

/**
* Fills placeholders in all string properties of a template object.
* This is done by stringifying the object, performing replacements, then parsing back.
* Placeholders must be {{PlaceholderName}}. Keys in placeholderDataMap must also be {{PlaceholderName}}.
*
* @param {object} templateObj The object containing template strings.
* @param {Object<string, string|number|Date>} recipientPlaceholderData Map of placeholder tags to values.
* @return {object} A new object with placeholders filled. Returns original object on error.
*/
function fillPlaceholdersInTemplateObj_(templateObj, recipientPlaceholderData) {
    if (!templateObj || typeof templateObj !== 'object') {
        Logger.log(`fillPlaceholdersInTemplateObj_: templateObj is not a valid object. Input: ${templateObj}`);
        return templateObj;
    }
    if (!recipientPlaceholderData || typeof recipientPlaceholderData !== 'object') {
        Logger.log("fillPlaceholdersInTemplateObj_: recipientPlaceholderData is not a valid object. Placeholders will not be replaced.");
        return templateObj;
    }
    let templateString;
    try {
        templateString = JSON.stringify(templateObj);
    } catch (e) {
        Logger.log(`fillPlaceholdersInTemplateObj_: Error stringifying templateObj: ${e.message}. Returning original object.`);
        return templateObj;
    }
    const filledString = fillPlaceholdersInString_(templateString, recipientPlaceholderData);
    try {
        return JSON.parse(filledString);
    } catch (e) {
        Logger.log(`fillPlaceholdersInTemplateObj_: Error parsing template string after placeholder replacement: ${e.message}. Original string (first 500 chars): ${templateString.substring(0,500)} Filled string (first 500 chars): ${filledString.substring(0,500)}`);
        return templateObj;
    }
}

/**
* Retrieves all rows from a given sheet that have a specific trigger value ('1')
* in the specified trigger column.
* This function includes the header row (index 0) in its scan, so it will
* process the first row of the sheet if it contains the trigger.
*
* @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object to read from.
* @param {number} triggerColIndex The 0-based column index for the trigger value.
* @return {Array<{rowNumber: number, data: Array<any>}>} An array of objects,
* where each object contains the 1-based row number and the 0-based array of row data.
* @throws {Error} if sheet is invalid or triggerColIndex is out of bounds.
*/
function getTriggeredRows_(sheet, triggerColIndex) {
  if (!sheet || typeof sheet.getDataRange !== 'function') {
    throw new Error("Invalid Sheet object provided to getTriggeredRows_.");
  }
  if (triggerColIndex < 0) {
    throw new Error(`Invalid triggerColIndex (${triggerColIndex}) provided to getTriggeredRows_. Must be 0 or greater.`);
  }

  const allValues = sheet.getDataRange().getValues();
  const triggeredRows = [];

  if (allValues.length === 0) {
    Logger.log("Sheet is empty in getTriggeredRows_.");
    return triggeredRows;
  }

  // Loop through all rows, including the first row (index 0)
  for (let i = 0; i < allValues.length; i++) {
    const currentRow = allValues[i];
    // Ensure trigger column index is within current row bounds
    if (triggerColIndex >= currentRow.length) {
      Logger.log(`Row ${i + 1}: Skipping as trigger column index (${triggerColIndex}) is out of bounds for current row length (${currentRow.length}).`);
      continue; // Skip this row, it's too short to contain the trigger
    }

    const triggerValue = String(currentRow[triggerColIndex] || '').trim(); // Handle null/undefined values

    if (triggerValue === "1") {
      triggeredRows.push({
        rowNumber: i + 1, // 1-based row number for reporting
        data: currentRow   // The actual row data (0-based array)
      });
    }
  }
  Logger.log(`Found ${triggeredRows.length} triggered rows.`);
  return triggeredRows;
}

/**
 * Finds a unique Gmail draft matching the subject line and extracts its content.
 * Centralized helper for Email Sender and Budget Tool.
 */
function getGmailTemplateFromDrafts__emails(subject_line, requireUnique = false) {
  Logger.log(`Searching for Gmail draft with subject: "${subject_line}" (Require unique: ${requireUnique})`);
  
  if (!subject_line || subject_line.trim() === "") {
    throw new Error("Subject line for draft template cannot be empty.");
  }
  
  const drafts = GmailApp.getDrafts();
  const matchingDrafts = drafts.filter(d => d.getMessage().getSubject() === subject_line);
  
  if (matchingDrafts.length === 0) { 
    throw new Error(`No Gmail draft found with subject: "${subject_line}"`);
  }
  
  if (requireUnique && matchingDrafts.length > 1) { 
    throw new Error(`Multiple Gmail drafts (${matchingDrafts.length}) found with subject: "${subject_line}". Please ensure only one draft has this exact subject.`);
  }

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
          try { inlineImages[cid] = img.copyBlob(); } catch (cbErr) { Logger.log(`Could not copy inline image blob "${img.getName()}" (CID: ${cid}): ${cbErr.message}`); }
        } else {
          Logger.log(`Warning: Found inline image named "${img.getName()}" without a Content-ID in draft "${subject_line}".`);
        }
      });
    }
  } catch (e) {
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