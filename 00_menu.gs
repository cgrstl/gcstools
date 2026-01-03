/**
 * @file 00_menu.gs
 * @description Handles the creation of custom menus in the Google Sheet UI,
 * sidebar/dialog launchers, and the add-on homepage trigger.
 * @OnlyCurrentDoc
 */

// ================================================================
// SPREADSHEET UI & ADD-ON INITIALIZATION
// ================================================================

/**
 * Runs automatically when the spreadsheet is opened.
 * Creates a custom 'GCS Tools' menu in the spreadsheet UI.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('GCS Tools');
  
  // Existing tools
  menu.addItem('Send or draft emails', 'showEmailSenderSidebar_');
  menu.addItem('Schedule calls', 'showCallSchedulerSidebar_');
  menu.addItem('Find change history users', 'showFindUsersSidebar_');
  menu.addItem('Draft Budget Recommendations', 'showBudgetRecommendationsSidebar_'); 

  menu.addToUi();
}

/**
 * Creates and returns the initial card for the add-on when it's opened from a host.
 * @param {Object} e The event object.
 * @return {Card[]} An array of Card objects to display.
 */
function onGCSToolsHomepage(e) {
  Logger.log("onGCSToolsHomepage event object: " + JSON.stringify(e));

  const builder = CardService.newCardBuilder();
  builder.setHeader(CardService.newCardHeader().setTitle('GCS Tools - Welcome'));

  const section = CardService.newCardSection();
  section.addWidget(CardService.newTextParagraph()
    .setText("Welcome to GCS Tools! Access all features directly from the 'Extensions > GCS Tools' menu in Google Sheets."));

  builder.addSection(section);
  return [builder.build()];
}

// ================================================================
// SIDEBAR LAUNCH FUNCTIONS
// ================================================================

/** Launches the Email Sender sidebar. */
function showEmailSenderSidebar_() {
  try {
    const htmlOutput = HtmlService.createHtmlOutputFromFile('01-2_emailssidebar').setTitle('Send or draft emails');
    SpreadsheetApp.getUi().showSidebar(htmlOutput);
  } catch (e) {
    Logger.log(`Error showing Email Sender sidebar: ${e.message} Stack: ${e.stack}`);
    SpreadsheetApp.getUi().alert('Could not open the Email Sender sidebar. Please check logs or contact support.');
  }
}

/** Launches the Call Scheduler sidebar. */
function showCallSchedulerSidebar_() {
  try {
    const htmlOutput = HtmlService.createHtmlOutputFromFile('02-2_callssidebar').setTitle('Schedule Calls');
    SpreadsheetApp.getUi().showSidebar(htmlOutput);
  } catch (e) {
    Logger.log(`Error showing Call Scheduler sidebar: ${e.message} Stack: ${e.stack}`);
    SpreadsheetApp.getUi().alert('Could not open the Call Scheduler sidebar. Please check logs or contact support.');
  }
}

/** Launches the Find Change History Users sidebar. */
function showFindUsersSidebar_() {
  try {
    const htmlOutput = HtmlService.createHtmlOutputFromFile('03-2_chuserssidebar').setTitle('Find change history users');
    SpreadsheetApp.getUi().showSidebar(htmlOutput);
  } catch (e) {
    Logger.log(`Error showing Find Users sidebar: ${e.message} Stack: ${e.stack}`);
    SpreadsheetApp.getUi().alert('Could not open the Find Users sidebar. Please check logs or contact support.');
  }
}

/** * Launches the Budget Recommendations sidebar.
 */
function showBudgetRecommendationsSidebar_() {
  try {
    const htmlOutput = HtmlService.createHtmlOutputFromFile('04-2_budgetsidebar').setTitle('Send Budget Recommendations');
    SpreadsheetApp.getUi().showSidebar(htmlOutput);
  } catch (e) {
    Logger.log(`Error showing Budget Recommendations sidebar: ${e.message} Stack: ${e.stack}`);
    SpreadsheetApp.getUi().alert('Could not open the Budget Recommendations sidebar. Please check logs or contact support.');
  }
}