/**
* @file 02-1_calls.gs
* @description Server-side logic for the Mass Call Scheduler tool.
* It processes scheduling requests, finds available calendar slots, creates events,
* and provides feedback. Relies on 'helperstools.gs'.
* @OnlyCurrentDoc
* @Needs CalendarApp
* @Needs GmailApp
*/

// ================================================================
// SCHEDULER CORE FUNCTION (Called by 02-2_callssidebar.html)
// ================================================================

/**
* Processes a scheduling request from the sidebar UI.
* Validates input, retrieves recipient data, finds available calendar slots based on user-defined availability,
* creates calendar events for recipients, and returns a categorized result object.
*
* @param {object} schedulingData An object containing all user selections from the sidebar,
* including core settings, availability, and placeholder configurations.
* @return {object} An object detailing the outcome for each processed row, categorized into
* 'scheduled', 'noSlot', and 'errors'.
* Example: { processedRowCount: number, scheduled: Array, noSlot: Array, errors: Array }
*/
function processMassScheduling(schedulingData) {
  Logger.log("--- START processMassScheduling ---");
  Logger.log(`Received schedulingData: ${JSON.stringify(schedulingData)}`);

  const results = {
    processedRowCount: 0,
    scheduled: [],
    noSlot: [],
    errors: []
  };

  try {
    if (!validateSchedulingData_(schedulingData)) { // Assuming validateSchedulingData_ is a local helper or moved to helperstools.gs
      // validateSchedulingData_ should throw an error if validation fails, which will be caught below.
      // If it returns false, we can also throw.
      throw new Error("Internal Error: Scheduling data failed validation (returned false).");
    }
    const titleTemplate = schedulingData.title;

    const calendar = CalendarApp.getDefaultCalendar();
    const timeZone = calendar.getTimeZone();
    Logger.log(`Using Calendar ID: ${calendar.getId()}, Time zone: ${timeZone}`);

    // Using centralized parseDateInCalendarTZ_ from helperstools.gs
    const startDate = parseDateInCalendarTZ_(schedulingData.startDate, timeZone);
    const endDate = parseDateInCalendarTZ_(schedulingData.endDate, timeZone);

    // Ensure endDate includes the full day for slot searching
    endDate.setHours(23, 59, 59, 999);
    Logger.log(`Scheduling window: ${startDate.toISOString()} to ${endDate.toISOString()}`);

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet(); // Get sheet for context

    // Using local helper getActivePlaceholdersMap_calls, ensure it uses centralized columnLetterToIndex_
    const { activePlaceholdersMap, usedColumnIndices } = getActivePlaceholdersMap_calls(schedulingData, sheet);

    // Using local helper getRecipientsData_calls, ensure it uses centralized columnLetterToIndex_
    // Refactor: getRecipientsData_calls now directly uses getTriggeredRows_
    const { recipientsToSchedule, recipientCount } = getRecipientsData_calls(
        schedulingData,
        activePlaceholdersMap,
        usedColumnIndices,
        sheet // Pass sheet for columnLetterToIndex_
    );
    results.processedRowCount = recipientCount; // Update processedRowCount from the helper result

    if (recipientCount === 0) {
      Logger.log("No recipients marked '1' (or matching criteria) found in the sheet.");
      results.noSlot.push({ row: 'N/A', recipient: 'N/A', details: "No rows marked '1' found in the sheet to process." });
      return results; // Return empty categorized results
    }
    Logger.log(`Found ${recipientCount} recipients to process for scheduling.`);

    // Using local helper getAvailableSlots_calls
    const availableSlots = getAvailableSlots_calls(schedulingData, calendar, timeZone, startDate, endDate);
    if (availableSlots.length === 0) {
      Logger.log("No available slots found in the specified window and availability criteria.");
      recipientsToSchedule.forEach(r => results.noSlot.push({
            row: r.row,
            recipient: r.email,
            details: 'No available slots found in the entire configured window.'
      }));
      return results;
    }
    Logger.log(`Found ${availableSlots.length} potential available slots after initial filtering.`);

    // Using local helper scheduleEvents_calls
    scheduleEvents_calls(
        availableSlots,
        recipientsToSchedule,
        titleTemplate,
        schedulingData.description,
        schedulingData.enableDescription,
        activePlaceholdersMap, // This map uses 0-based indices from columnLetterToIndex_
        calendar,
        timeZone,
        results
    );

    Logger.log("--- END processMassScheduling ---");
    Logger.log(`Returning results summary: Scheduled: ${results.scheduled.length}, No Slot: ${results.noSlot.length}, Errors: ${results.errors.length}`);
    return results;

  } catch (e) {
    Logger.log(`FATAL ERROR in processMassScheduling: ${e.message} \n Stack: ${e.stack ? e.stack : 'N/A'}`);
    results.errors.push({row: 'N/A', recipient: 'N/A', details: `Script Error: ${e.message}`});
    return results;
  }
}


// ================================================================
// EMAIL REPORT FUNCTION (REMOVED as per instruction)
// ================================================================
// The function sendReportViaEmail_calls(results) has been removed.


// ================================================================================
// HELPER FUNCTIONS (Specific to Call Scheduler - 02-1_calls.gs)
// These helpers may use generic helpers from 'helperstools.gs' where appropriate.
// Renamed with __calls suffix to avoid global namespace issues if similar helpers exist elsewhere,
// or they could be kept as is if this is the only file defining them.
// For this refactoring, I'll assume they are specific enough to keep them here but ensure they use centralized helpers.
// ================================================================================

/**
* Validates the core scheduling data received from the sidebar.
* Throws an error if validation fails.
* @param {object} data The schedulingData object.
* @return {boolean} True if data is valid.
* @throws {Error} if validation fails.
*/
function validateSchedulingData_(data) { // Renamed to show it's a local helper
  const required = ['operatorColumn', 'recipientColumn', 'title', 'duration', 'startDate', 'endDate', 'availability'];
  for (const key of required) {
    if (!data || data[key] === undefined || data[key] === null || String(data[key]).trim() === "") {
      Logger.log(`Validation failed: Missing or empty required field '${key}'. Value: "${data ? data[key] : 'data_is_null'}"`);
      throw new Error(`Configuration Error: Missing required field '${key}'.`);
    }
  }
  if (isNaN(parseInt(data.duration)) || parseInt(data.duration) <= 0) {
      throw new Error(`Configuration Error: Invalid duration '${data.duration}'. Must be a positive number.`);
  }
    if (data.buffer !== undefined && String(data.buffer).trim() !== "" && (isNaN(parseInt(data.buffer)) || parseInt(data.buffer) < 0)) {
      throw new Error(`Configuration Error: Invalid buffer time '${data.buffer}'. Must be a non-negative number or empty.`);
  }
  // Basic validation for availability structure
  if (typeof data.availability !== 'object' || data.availability === null) {
    throw new Error('Configuration Error: Availability data is missing or not in the correct format.');
  }
  // Further checks for date formats are done by parseDateInCalendarTZ_
  return true;
}

/**
* Extracts active placeholder information from schedulingData and maps tags to column indices.
* Uses the centralized columnLetterToIndex_ helper.
* @param {object} schedulingData The scheduling data from the sidebar.
* @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object for context.
* @return {{activePlaceholdersMap: Object<string, number>, usedColumnIndices: Set<number>}}
* @throws {Error} if placeholder configuration is invalid.
*/
function getActivePlaceholdersMap_calls(schedulingData, sheet) { // Renamed and added sheet
    const activePlaceholdersMap = {};
    const usedColumnIndices = new Set();

    if (Array.isArray(schedulingData.placeholders)) {
        schedulingData.placeholders.forEach((ph, idx) => {
            const phColLetter = ph.col;
            const phName = ph.name;
            const phColIndex = columnLetterToIndex_(phColLetter, sheet); // Using helper

            if (phColIndex === -1 && phColLetter) { // Only error if a letter was provided but invalid
                throw new Error(`Server Error: Invalid column letter "${phColLetter}" for Placeholder ${idx + 1} ('${phName || ''}') on sheet "${sheet.getName()}".`);
            }
            if (phColLetter && phColIndex !== -1) { // Only process if a valid column is set
              if (!phName || !(phName.startsWith('{{') && phName.endsWith('}}') && phName.length > 4)) {
                  throw new Error(`Server Error: Invalid format for Placeholder ${idx + 1} Tag ('${phName}'). Must be {{TagName}}.`);
              }
              activePlaceholdersMap[phName] = phColIndex;
              usedColumnIndices.add(phColIndex);
            }
        });
    }
    return { activePlaceholdersMap, usedColumnIndices };
}


/**
* Retrieves recipient data from the sheet for rows marked with '1'.
* Includes resolving placeholder values for each recipient.
* Uses the centralized columnLetterToIndex_ and getTriggeredRows_ helpers.
* @param {object} schedulingData Data from the sidebar.
* @param {Object<string, number>} activePlaceholdersMap Map of placeholder tags to their column indices.
* @param {Set<number>} usedColumnIndices Set of column indices already used by core fields or other placeholders, for validation.
* @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object to read from.
* @return {{recipientsToSchedule: Array<object>, recipientCount: number}}
* @throws {Error} if essential columns are invalid or data reading fails.
*/
function getRecipientsData_calls(schedulingData, activePlaceholdersMap, usedColumnIndices, sheet) { // Renamed and added sheet
  const recipientsToSchedule = [];
  let recipientCount = 0;

  try {
      const operatorColIndex = columnLetterToIndex_(schedulingData.operatorColumn, sheet); // Using helper
      const recipientColIndex = columnLetterToIndex_(schedulingData.recipientColumn, sheet); // Using helper

      if (operatorColIndex === -1) throw new Error(`Invalid column letter for Trigger Column: "${schedulingData.operatorColumn}" on sheet "${sheet.getName()}".`);
      if (recipientColIndex === -1) throw new Error(`Invalid column letter for Recipient Column: "${schedulingData.recipientColumn}" on sheet "${sheet.getName()}".`);

      // Validate that placeholder columns do not overlap with operator or recipient columns
      for (const phName in activePlaceholdersMap) {
          const phColIndex = activePlaceholdersMap[phName];
          if (phColIndex === operatorColIndex) throw new Error(`Placeholder column for "${phName}" conflicts with Trigger column "${schedulingData.operatorColumn}".`);
          if (phColIndex === recipientColIndex) throw new Error(`Placeholder column for "${phName}" conflicts with Recipient column "${schedulingData.recipientColumn}".`);
      }

      // Use the new helper to get only the rows marked for processing
      const triggeredRows = getTriggeredRows_(sheet, operatorColIndex);
      recipientCount = triggeredRows.length; // Total rows marked '1'

      triggeredRows.forEach(triggeredRow => {
          const sheetRowNumber = triggeredRow.rowNumber;
          const rowData = triggeredRow.data;

          if (recipientColIndex >= rowData.length) {
              Logger.log(`Skipping row ${sheetRowNumber}: Recipient column index ${recipientColIndex} out of bounds for row length ${rowData.length}.`);
              return; // Skip to next triggered row
          }
          const email = rowData[recipientColIndex]?.toString().trim() ?? "";
          if (email && email.includes('@')) {
              const recipientData = {
                  email: email,
                  row: sheetRowNumber,
                  placeholderValues: {}
              };
              for (const phName in activePlaceholdersMap) {
                  const colIndex = activePlaceholdersMap[phName];
                  recipientData.placeholderValues[phName] = (colIndex < rowData.length) ? (rowData[colIndex]?.toString().trim() ?? "") : "";
              }
              recipientsToSchedule.push(recipientData);
          } else {
              Logger.log(`Skipping row ${sheetRowNumber}: Invalid or missing email in column ${schedulingData.recipientColumn} ('${email}').`);
          }
      });

      return { recipientsToSchedule, recipientCount };
  } catch (e) {
        Logger.log(`Error getting recipient data: ${e.message} Stack: ${e.stack || 'N/A'}`);
        throw new Error(`Failed to read recipient data from sheet: ${e.message}`);
  }
}


/**
* Finds available time slots in the calendar based on user-defined availability, duration, and buffer.
* Uses centralized date/time parsing helpers.
* @param {object} schedulingData Scheduling parameters from the sidebar.
* @param {GoogleAppsScript.Calendar.Calendar} calendar The calendar to check.
* @param {string} timeZone The timezone of the calendar.
* @param {Date} startDate The start date for the scheduling window.
* @param {Date} endDate The end date for the scheduling window.
* @return {Array<{start: Date, end: Date}>} An array of available slot objects.
*/
function getAvailableSlots_calls(schedulingData, calendar, timeZone, startDate, endDate) { // Renamed
  const { availability, duration, buffer } = schedulingData;
  const durationMinutes = parseInt(duration);
  const bufferMinutes = parseInt(String(buffer).trim() === "" ? "0" : buffer) || 0; // Default buffer to 0 if empty or invalid
  const allSlots = [];
  let currentDate = new Date(startDate.getTime()); // Clone startDate

  Logger.log(`Generating slots from ${startDate.toISOString()} to ${endDate.toISOString()}, Duration=${durationMinutes}, Buffer=${bufferMinutes}`);

  while (currentDate <= endDate) {
    const dayOfWeek = Utilities.formatDate(currentDate, timeZone, "EEEE");
    const dayAvailability = availability[dayOfWeek];

      if (dayAvailability?.available && dayAvailability.start && dayAvailability.end) {
        try {
            // Using centralized helpers
            const dayStart = parseTimeAndSetOnDate_(dayAvailability.start, currentDate, timeZone);
            const dayEnd = parseTimeAndSetOnDate_(dayAvailability.end, currentDate, timeZone);

            if(dayStart.getTime() >= dayEnd.getTime()) {
                Logger.log(`Skipping ${dayOfWeek} for date ${Utilities.formatDate(currentDate, timeZone, "yyyy-MM-dd")}: Start time (${dayAvailability.start}) not before End time (${dayAvailability.end}).`);
                // current day processed, move to next
                currentDate.setDate(currentDate.getDate() + 1);
                currentDate.setHours(0,0,0,0);
                continue;
            }

            let slotStart = new Date(dayStart.getTime()); // Clone dayStart
            while (true) {
                const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);
                if (slotEnd.getTime() > dayEnd.getTime()) break;

                if (isSlotAvailable_calls(slotStart, slotEnd, bufferMinutes, calendar, timeZone)) { // Using local helper
                    allSlots.push({ start: new Date(slotStart.getTime()), end: new Date(slotEnd.getTime()) }); // Store clones
                }
                slotStart.setTime(slotEnd.getTime() + bufferMinutes * 60000);
            }
        } catch (e) {
            Logger.log(`Error processing availability for ${dayOfWeek} (${Utilities.formatDate(currentDate, timeZone, "yyyy-MM-dd")}): ${e.message}. Skipping day.`);
        }
    }
    currentDate.setDate(currentDate.getDate() + 1);
    currentDate.setHours(0,0,0,0);
  }
  allSlots.sort((a, b) => a.start.getTime() - b.start.getTime());
  Logger.log(`Found ${allSlots.length} total potential slots after checking calendar.`);
  return allSlots;
}

/**
* Checks if a given time slot (including buffer) is free on the calendar.
* @param {Date} start The proposed start time of the event.
* @param {Date} end The proposed end time of the event.
* @param {number} bufferMinutes Buffer time in minutes to add before and after the event.
* @param {GoogleAppsScript.Calendar.Calendar} calendar The calendar to check against.
* @param {string} timeZone The timezone for logging.
* @return {boolean} True if the slot is available, false otherwise.
*/
function isSlotAvailable_calls(start, end, bufferMinutes, calendar, timeZone) { // Renamed
  const checkStartTime = new Date(start.getTime() - bufferMinutes * 60000);
  const checkEndTime = new Date(end.getTime() + bufferMinutes * 60000);
  const conflictingEvents = calendar.getEvents(checkStartTime, checkEndTime);

  for (const event of conflictingEvents) {
    if (!event.isAllDayEvent()) {
        const eventStart = event.getStartTime();
        const eventEnd = event.getEndTime();
        // Standard overlap check: (StartA < EndB) && (EndA > StartB)
        if (eventStart.getTime() < checkEndTime.getTime() && eventEnd.getTime() > checkStartTime.getTime()) { // FIXED: Use checkStartTime/EndTime here
            Logger.log(`Conflict found: Slot ${formatDateTimeForDisplayUtils_(start, timeZone, "HH:mm")} - ${formatDateTimeForDisplayUtils_(end, timeZone, "HH:mm")} overlaps with event "${event.getTitle()}" (${formatDateTimeForDisplayUtils_(eventStart, timeZone, "HH:mm")} - ${formatDateTimeForDisplayUtils_(eventEnd, timeZone, "HH:mm")})`);
            return false;
        }
    }
  }
  return true;
}

/**
* Attempts to schedule events for recipients based on available slots.
* Populates the `results` object with outcomes (scheduled, noSlot, errors).
* Uses centralized fillPlaceholdersInTemplateObj_ and formatDateTimeForDisplayUtils_.
*
* @param {Array<{start: Date, end: Date}>} slots Array of available time slots.
* @param {Array<object>} recipientsToSchedule Array of recipient data objects.
* @param {string} titleTemplate Template for the event title.
* @param {string} descriptionTemplate Template for the event description.
* @param {boolean} enableDescription Whether to include a description.
* @param {Object<string, number>} activePlaceholdersMap Map of placeholder tags to column indices.
* @param {GoogleAppsScript.Calendar.Calendar} calendar The calendar to create events in.
* @param {string} timeZone The timezone for formatting output.
* @param {object} results The results object to populate.
*/
function scheduleEvents_calls(slots, recipientsToSchedule, titleTemplate, descriptionTemplate, enableDescription, activePlaceholdersMap, calendar, timeZone, results) { // Renamed
  const usedSlots = new Set();

  recipientsToSchedule.forEach(recipient => {
    let scheduledThisRecipient = false;

    for (const slot of slots) {
      const slotKey = slot.start.getTime();
      if (!usedSlots.has(slotKey)) {
        try {
          const finalTitle = fillPlaceholdersInString_(titleTemplate, recipient.placeholderValues); // Using helper

          let finalDescription = "";
          if (enableDescription && descriptionTemplate) { // Check if descriptionTemplate has content
              finalDescription = fillPlaceholdersInString_(descriptionTemplate, recipient.placeholderValues); // Using helper
          }

          const eventOptions = {
            guests: recipient.email.replace(/;\s*/g, ',').trim(),
            sendInvites: true
          };
          if (finalDescription) { // Only add description if it's not empty
            eventOptions.description = finalDescription;
          }

          calendar.createEvent(finalTitle, slot.start, slot.end, eventOptions);

          usedSlots.add(slotKey);
          results.scheduled.push({
            row: recipient.row,
            recipient: recipient.email,
            details: `Scheduled at ${formatDateTimeForDisplayUtils_(slot.start, timeZone, "yyyy-MM-dd HH:mm")}` // Using helper
          });
          scheduledThisRecipient = true;
          Logger.log(`Scheduled Row ${recipient.row} (${recipient.email}) at ${formatDateTimeForDisplayUtils_(slot.start, timeZone, "yyyy-MM-dd HH:mm")}`);
          break;

        } catch (e) {
          const errorMsg = `Error creating event for Row ${recipient.row} (${recipient.email}): ${e.message}`;
          Logger.log(`${errorMsg} Stack: ${e.stack || 'N/A'}`);
          results.errors.push({
            row: recipient.row,
            recipient: recipient.email,
            details: errorMsg.substring(0, 150)
          });
          scheduledThisRecipient = true; // Mark as processed (even if failed) to avoid "no slot"
          break;
        }
      }
    }

    if (!scheduledThisRecipient) {
        results.noSlot.push({
          row: recipient.row,
          recipient: recipient.email,
          details: 'No suitable available slot found after checking all possibilities.'
        });
        Logger.log(`Could not find slot for Row ${recipient.row} (${recipient.email})`);
    }
  });
}