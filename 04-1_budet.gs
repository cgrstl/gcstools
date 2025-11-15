/**
 * @file 04-1_budgetsender.gs
 * @description Core function for fetching Google Ads data, generating the dynamic 
 * PDF report, inserting content blocks into the draft, and saving the personalized draft.
 * NOTE: This script integrates shared utility functions and requires the user to insert 
 * specific code for the InternalAdsApp and Gmail Draft Retrieval.
 * @OnlyCurrentDoc
 * @Needs GmailApp
 * @Needs SpreadsheetApp
 * @Needs InternalAdsApp 
 */

// ================================================================
// GAQL QUERY DEFINITIONS
// ================================================================

const DATE_PLACEHOLDER_START = 'YYYY-MM-DD_START';
const DATE_PLACEHOLDER_END = 'YYYY-MM-DD_END';
const CAMPAIGN_TYPES_FILTER = "'SEARCH', 'DISPLAY', 'VIDEO', 'PERFORMANCE_MAX', 'DEMAND_GEN'";

const GAQL_QUERY_0_CURRENCY = `
  SELECT customer.currency_code
  FROM customer
`;

const GAQL_QUERY_1_PERFORMANCE = `
  SELECT
    campaign.id,
    campaign.name,
    campaign.status,
    campaign.advertising_channel_type,
    campaign_budget.amount_micros,
    campaign.bidding_strategy_type,
    metrics.conversions,
    metrics.conversions_value,
    metrics.cost_micros,
    metrics.clicks,
    metrics.search_impression_share,
    metrics.search_impression_share_lost_budget,
    metrics.search_impression_share_lost_rank,
    metrics.content_impression_share,
    metrics.content_budget_lost_impression_share,
    segments.date
  FROM
    campaign
  WHERE
    campaign.status = 'ENABLED' 
    AND campaign.advertising_channel_type IN (${CAMPAIGN_TYPES_FILTER})
    AND segments.date BETWEEN '${DATE_PLACEHOLDER_START}' AND '${DATE_PLACEHOLDER_END}'
`;

const GAQL_QUERY_2_TARGETS = `
  SELECT
    campaign.id,
    campaign.target_cpa.target_cpa_micros,
    campaign.target_roas.target_roas
  FROM
    campaign
  WHERE
    campaign.status = 'ENABLED' 
    AND campaign.advertising_channel_type IN (${CAMPAIGN_TYPES_FILTER})
    AND campaign.bidding_strategy_type IN ('TARGET_CPA', 'TARGET_ROAS', 'MAXIMIZE_CONVERSION_VALUE', 'MAXIMIZE_CONVERSIONS')
`;

const GAQL_QUERY_4_RECOMMENDATIONS = `
  SELECT
    recommendation.campaign,
    recommendation.campaign_budget_recommendation.budget_options
  FROM
    recommendation
  WHERE
    recommendation.type = 'CAMPAIGN_BUDGET'
`;


// ================================================================
// CORE PROCESSING FUNCTION (Replaces the generic processEmailRequest)
// ================================================================

/**
 * Processes a Budget Recommendation request from the sidebar.
 * Fetches Google Ads data, performs calculations, conditionally generates a PDF report,
 * and saves a personalized draft for each triggered row.
 * * This function is the new processEmailRequest called by the 04_2_budgetsidebar.html.
 * @param {object} formData An object containing user selections.
 * @returns {object} A categorized results object for the sidebar.
 */
function processEmailRequest(formData) {
    Logger.log(`--- START processBudgetRecommendationRequest ---`);

    const results = {
        processedRowCount: 0,
        actionType: 'draft',
        succeeded: [],
        failedInput: [],
        failedProcessing: []
    };

    try {
        // --- 1. SETUP & VALIDATION ---
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = ss.getActiveSheet();
        
        // Use integrated helpers for column mapping
        const executionColIndex = columnLetterToIndex_(formData.executionCol, sheet);
        const cidColIndex = columnLetterToIndex_(formData.cidCol, sheet);
        const recipientColIndex = columnLetterToIndex_(formData.recipientCol, sheet);
        const ccColIndex = formData.ccCol ? columnLetterToIndex_(formData.ccCol, sheet) : -1;

        if (executionColIndex === -1 || cidColIndex === -1 || recipientColIndex === -1) {
            throw new Error('Core settings (Trigger, CID, or Recipient Column) are missing or invalid.');
        }

        const placeholderMap = buildPlaceholderMap_(formData, sheet); 
        const emailTemplate = getGmailTemplateFromDrafts__emails(formData.subjectLine, true); 
        const triggeredRows = getTriggeredRows_(sheet, executionColIndex); 
        results.processedRowCount = triggeredRows.length;

        if (triggeredRows.length === 0) {
            results.failedProcessing.push({ row: 'N/A', recipient: 'N/A', details: "No rows marked '1' found to process." });
            return results;
        }
        
        const dateRange = get7DayDateRange_(); 

        // --- 2. START ROW ITERATION ---
        triggeredRows.forEach(triggeredRow => {
            const sheetRowNumber = triggeredRow.rowNumber;
            const rowData = triggeredRow.data;
            const cidRaw = rowData[cidColIndex]?.toString().trim() ?? "";
            const recipientRaw = rowData[recipientColIndex]?.toString().trim() ?? "";
            const ccRaw = (ccColIndex !== -1 && ccColIndex < rowData.length) ? (rowData[ccColIndex]?.toString().trim() ?? "") : "";
            
            try {
                // --- 2.1 CID Validation & Conversion (Requires InternalAdsApp access) ---
                let apiCid;
                if (!cidRaw) throw new Error("Missing Google Ads Client ID.");
                
                // **CID LOOKUP** (Uses InternalAdsApp implementation)
                const externalIds = InternalAdsApp.getExternalCustomerIds([cidRaw]); 
                if (externalIds && externalIds[cidRaw]) {
                    // Assuming externalIds[cidRaw] returns XXX-XXX-XXXX format
                    apiCid = externalIds[cidRaw].replace(/-/g, '');
                } else {
                    throw new Error("Invalid CID or No Access from Ads API (InternalAdsApp failed lookup).");
                }

                // --- 2.2 DATA FETCH (4 GAQL Queries) ---
                
                // Q0: Currency Code
                const currencyQueryResponse = executeGAQLQuery(apiCid, GAQL_QUERY_0_CURRENCY);
                const clientCurrencyCode = currencyQueryResponse.results[0]?.customer?.currencyCode || 'EUR';
                
                // Q1: Universal Data 
                const perfData = executeGAQLQuery(apiCid, GAQL_QUERY_1_PERFORMANCE, { dateRange });
                if (!perfData.results || perfData.results.length === 0) throw new Error("No active campaign data found in the last 7 days.");
                
                // Q2: Target Bids
                const targetData = executeGAQLQuery(apiCid, GAQL_QUERY_2_TARGETS); 
                
                // Q4: Recommendations
                const recommendationData = executeGAQLQuery(apiCid, GAQL_QUERY_4_RECOMMENDATIONS);

                // --- 2.3 DATA PROCESSING & CALCULATIONS ---
                
                const mergedCampaigns = mergeAndCalculateData(
                    perfData.results, targetData.results, recommendationData.results, clientCurrencyCode
                );

                // Filter only budget-limited campaigns for the report
                const budgetLimitedCampaigns = mergedCampaigns.filter(c => c.isBudgetLimited === 'Ja');

                // --- 2.4 DYNAMIC CONTENT GENERATION ---
                
                const tableHtml = generateBudgetTableHtml(budgetLimitedCampaigns, clientCurrencyCode);
                
                const rowDataForPlaceholders = extractPlaceholderValues_(rowData, placeholderMap); 
                
                const finalSubject = fillPlaceholdersInString_(formData.subjectLine, rowDataForPlaceholders); 
                
                let finalBodyHtml = fillPlaceholdersInString_(emailTemplate.message.html, rowDataForPlaceholders); 
                // Replace Block placeholder with generated HTML table ([BUDGET_TABLE] assumed)
                finalBodyHtml = finalBodyHtml.replace('[BUDGET_TABLE]', tableHtml); 

                // --- 2.5 PDF REPORT GENERATION (CONDITIONAL) ---
                
                let pdfBlob = null;
                const finalAttachments = [...emailTemplate.attachments];
                
                if (formData.enablePdfAttachment && budgetLimitedCampaigns.length > 0) {
                    pdfBlob = createCampaignReportPdf(budgetLimitedCampaigns, clientCurrencyCode, apiCid); 
                    if (pdfBlob) {
                        finalAttachments.push(pdfBlob);
                    }
                }

                // --- 2.6 DRAFT CREATION ---
                
                const options = {
                    htmlBody: finalBodyHtml,
                    cc: ccRaw.replace(/;\s*/g, ',').trim() || undefined,
                    attachments: finalAttachments,
                    inlineImages: emailTemplate.inlineImages,
                    bcc: buildBccString_({ 
                        sharedInbox: formData.bccSharedInbox, 
                        pop: formData.bccPop 
                    })
                };
                
                GmailApp.createDraft(recipientRaw, finalSubject, emailTemplate.message.text, options);
                results.succeeded.push({ row: sheetRowNumber, recipient: recipientRaw, details: `Draft saved successfully` });
                
            } catch (e) {
                const errorMsg = e.message.substring(0, 200);
                Logger.log(`Row ${sheetRowNumber}: ERROR processing for "${recipientRaw}": ${errorMsg}`);
                
                if (e.message.includes("CID") || e.message.includes("Recipient") || e.message.includes("InternalAdsApp")) {
                    results.failedInput.push({ row: sheetRowNumber, recipient: recipientRaw, details: errorMsg });
                } else {
                    results.failedProcessing.push({ row: sheetRowNumber, recipient: recipientRaw, details: errorMsg });
                }
            }
        }); 

        Logger.log(`Budget processing complete. Summary: Succeeded: ${results.succeeded.length}, FailedInput: ${results.failedInput.length}, FailedProcessing: ${results.failedProcessing.length}`);
        return results;

    } catch (e) {
        Logger.log(`FATAL ERROR in processBudgetRecommendationRequest: ${e.message} \n Stack: ${e.stack}`);
        results.failedProcessing.push({ row: 'N/A', recipient: 'N/A', details: `Script Error: ${e.message}` });
        return results;
    }
}


// ================================================================
// ***CRITICAL PLACEHOLDERS: ADS API & DRAFT RETRIEVAL***
// (MUST BE REPLACED WITH YOUR PROJECT'S WORKING CODE)
// ================================================================

/**
 * Finds a unique Gmail draft matching the subject line and extracts its content.
 * (BODY FROM 01-1_emails.gs)
 * @throws {Error} If no draft or multiple drafts are found.
 */
function getGmailTemplateFromDrafts__emails(subject_line, requireUnique = false) {
  // ***REPLACE BODY: Paste the full implementation from your existing 01-1_emails.gs file here.***
  
  // NOTE: The original function body is large (lines 418-434 in 01-1_emails.gs)
  // Ensure you copy the entire body, including logic for attachments and inline images.
  throw new Error("Placeholder function 'getGmailTemplateFromDrafts__emails' called. Replace with actual implementation.");
}

/** Placeholder for your Ads API wrapper object. */
const InternalAdsApp = {
    getExternalCustomerIds: (cids) => {
        // ***REPLACE BODY: Paste the full CID validation/lookup implementation from your project here.***
        const mockResult = {};
        mockResult[cids[0]] = cids[0]; 
        return mockResult; 
    },
    search: (requestJson, options) => {
        // ***REPLACE BODY: Paste the full GAQL execution logic (connecting to Google Ads API) here.***
        throw new Error("Placeholder function 'InternalAdsApp.search' called. Replace with actual implementation returning GAQL JSON data.");
    }
};

// ================================================================
// INTEGRATED UTILITY FUNCTIONS (FROM helperstools.gs)
// ================================================================

/**
 * Converts a column letter (e.g., "A", "B", "AA") to its 0-based index for a given sheet.
 */
function columnLetterToIndex_(columnLetter, sheet) {
  if (!columnLetter || typeof columnLetter !== 'string') { return -1; }
  if (!sheet || typeof sheet.getMaxColumns !== 'function') { return -1; }
  const letter = columnLetter.toUpperCase().trim();
  if (letter.length === 0) { return -1; }

  let column = 0;
  for (let i = 0; i < letter.length; i++) {
      const charCode = letter.charCodeAt(i);
      if (charCode < 65 || charCode > 90) { return -1; }
      column = column * 26 + (charCode - 64);
  }
  try {
    const maxSheetCols = sheet.getMaxColumns();
    if (column <= 0 || column > maxSheetCols) { return -1; }
  } catch (e) { return -1; }
  return column - 1;
}

/**
 * Retrieves all rows from a given sheet that have a specific trigger value ('1')
 * in the specified trigger column.
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

  if (allValues.length === 0) { return triggeredRows; }

  for (let i = 0; i < allValues.length; i++) {
    const currentRow = allValues[i];
    if (triggerColIndex >= currentRow.length) { continue; }

    const triggerValue = String(currentRow[triggerColIndex] || '').trim(); 

    if (triggerValue === "1") {
      triggeredRows.push({
        rowNumber: i + 1, 
        data: currentRow   
      });
    }
  }
  return triggeredRows;
}

/** Fills placeholders in a template string using a provided data map. */
function fillPlaceholdersInString_(templateString, placeholderDataMap) {
  // Uses escapeData_ logic integrated here
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

  if (templateString === null || templateString === undefined) return "";
  if (typeof templateString !== 'string') templateString = String(templateString);
  if (!placeholderDataMap || typeof placeholderDataMap !== 'object') {
      return templateString;
  }
  return templateString.replace(/\{\{([^{}]+?)\}\}/g, (matchWithBrackets) => {
      // Keys in the map must match the full placeholder tag, e.g., {{ContactName}}
      return placeholderDataMap.hasOwnProperty(matchWithBrackets) ?
              escapeData_(placeholderDataMap[matchWithBrackets]) :
              matchWithBrackets;
  });
}

// ================================================================
// NEW LOGIC FUNCTIONS (Integrated)
// ================================================================

/** Executes GAQL query, replaces date placeholders, and calls InternalAdsApp.search. */
function executeGAQLQuery(clientId, query, options = {}) {
  let finalQuery = query;
  if (options.dateRange) {
    finalQuery = finalQuery.replace(DATE_PLACEHOLDER_START, options.dateRange.startDateStr);
    finalQuery = finalQuery.replace(DATE_PLACEHOLDER_END, options.dateRange.endDateStr);
  }
  
  const request = {
    customerId: clientId,
    query: finalQuery
  };
  
  const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
  return JSON.parse(responseJson);
}

/** Builds the BCC string from toggles. */
function buildBccString_(toggles) {
    const bccAddresses = [];
    if (toggles.sharedInbox) bccAddresses.push('gcs-sharedinbox@google.com');
    if (toggles.pop) bccAddresses.push('gcs-pop@google.com');
    return bccAddresses.join(', ') || undefined;
}

/** Determines the 7-day date range for segmented queries. */
function get7DayDateRange_() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const timeZone = ss.getSpreadsheetTimeZone() || "Europe/Dublin"; 
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 7); 
    
    return {
        startDateStr: Utilities.formatDate(startDate, timeZone, 'yyyy-MM-dd'),
        endDateStr: Utilities.formatDate(endDate, timeZone, 'yyyy-MM-dd')
    };
}

/** Formats micros amount to currency string with ISO code. */
function formatMicrosToCurrency(micros, currencyCode) {
    if (micros === Infinity || !micros || isNaN(micros)) return '-';
    const amount = (micros / 1000000).toFixed(2);
    return `${currencyCode} ${amount}`;
}

/** Builds the placeholder map from formData. */
function buildPlaceholderMap_(formData, sheet) {
    const map = {};
    if (Array.isArray(formData.placeholders)) {
      formData.placeholders.forEach(ph => {
        if(ph.name && ph.col) map[ph.name] = columnLetterToIndex_(ph.col, sheet);
      });
    }
    return map;
}

/** Extracts values from row based on map. */
function extractPlaceholderValues_(rowData, placeholderMap) {
    const values = {};
    for(const name in placeholderMap) {
        const index = placeholderMap[name];
        values[name] = rowData[index]?.toString().trim() ?? "";
    }
    return values;
}

/** Merges all data sources and performs the complex budget/efficiency calculations. */
function mergeAndCalculateData(perfData, targetData, recommendationData, currencyCode) {
    const mergedMap = new Map();

    // 1. Aggregate Performance Data (Q1)
    perfData.forEach(row => {
        const campaignId = row.campaign.id;
        if (!mergedMap.has(campaignId)) {
            mergedMap.set(campaignId, { 
                id: campaignId, 
                name: row.campaign.name,
                type: row.campaign.advertisingChannelType,
                budgetMicros: parseFloat(row.campaignBudget.amountMicros || 0),
                biddingType: row.campaign.biddingStrategyType,
                currency: currencyCode,
                costMicros: 0, conversions: 0, conversionsValue: 0, clicks: 0,
                searchIS: 0, searchISLostBudget: 0, searchISLostRank: 0,
                rowCount: 0 
            });
        }
        
        const campaign = mergedMap.get(campaignId);
        campaign.costMicros += parseFloat(row.metrics.costMicros || 0);
        campaign.conversions += parseFloat(row.metrics.conversions || 0);
        campaign.conversionsValue += parseFloat(row.metrics.conversionsValue || 0);
        campaign.clicks += parseFloat(row.metrics.clicks || 0);
        
        campaign.searchIS = parseFloat(row.metrics.searchImpressionShare || 0);
        campaign.searchISLostBudget = parseFloat(row.metrics.searchImpressionShareLostBudget || 0);
        campaign.searchISLostRank = parseFloat(row.metrics.searchImpressionShareLostRank || 0);
    });
    
    // Convert to Array and add calculated fields
    const finalCampaigns = Array.from(mergedMap.values()).map(c => {
        // Calculations
        c.CPA = c.conversions > 0 ? c.costMicros / c.conversions : Infinity;
        c.ROAS = c.costMicros > 0 ? c.conversionsValue / c.costMicros : 0;
        const totalDailyBudgetMicros = c.budgetMicros * 7;
        c.budgetDepletion = totalDailyBudgetMicros > 0 ? c.costMicros / totalDailyBudgetMicros : 0; 
        
        // Lost Conversions
        if (c.type === 'SEARCH' || c.type === 'DISPLAY') {
            const currentISDecimal = c.searchIS / 100;
            const lostISBudgetDecimal = c.searchISLostBudget / 100;
            c.estimatedLostConversions = (currentISDecimal > 0 && c.conversions > 0) ? 
                c.conversions * (lostISBudgetDecimal / currentISDecimal) : 0;
        } else {
            c.estimatedLostConversions = 0;
        }
        
        // Target/Recommendation Placeholders
        c.targetCPA = null; c.targetROAS = null;
        c.meetsTargetCPA = '-'; c.meetsTargetROAS = '-';
        c.isBudgetLimited = 'Nein'; c.recommendedBudget = '-';

        return c;
    });

    // 2. Merge Target Data (Q2)
    targetData.forEach(row => {
        const campaign = finalCampaigns.find(c => c.id === row.campaign.id);
        if (campaign) {
            if (row.campaign.targetCpa) {
                campaign.targetCPA = parseFloat(row.campaign.targetCpa.targetCpaMicros);
                campaign.meetsTargetCPA = (campaign.targetCPA >= campaign.CPA) ? 'Ja' : 'Nein';
            }
            if (row.campaign.targetRoas) {
                campaign.targetROAS = parseFloat(row.campaign.targetRoas.targetRoas);
                campaign.meetsTargetROAS = (campaign.targetROAS <= campaign.ROAS) ? 'Ja' : 'Nein';
            }
        }
    });

    // 3. Merge Recommendation Data (Q4)
    recommendationData.forEach(row => {
        const resourceParts = row.recommendation.campaign.split('~');
        const campaignId = resourceParts.length > 1 ? resourceParts[1] : null;
        
        const campaign = finalCampaigns.find(c => c.id === campaignId);
        
        if (campaign && row.campaignBudgetRecommendation && row.campaignBudgetRecommendation.budgetOptions) {
            campaign.isBudgetLimited = 'Ja';
            
            let minBudgetMicros = Infinity;
            row.campaignBudgetRecommendation.budgetOptions.forEach(opt => {
                const micros = parseFloat(opt.recommendedBudgetAmountMicros);
                if (micros < minBudgetMicros) {
                    minBudgetMicros = micros;
                }
            });
            campaign.recommendedBudget = formatMicrosToCurrency(minBudgetMicros, campaign.currency);
        }
    });
    
    return finalCampaigns;
}

/** Generates the main HTML table for the draft body. */
function generateBudgetTableHtml(campaignsData, currencyCode) {
    if (campaignsData.length === 0) return 'Keine Kampagnen mit Budget-Einschr?nkung gefunden.';

    let html = `
    <h3 style="color:#007bff;">Budget-Empfehlungen f?r Black Friday Readiness:</h3>
    <table border="1" style="width:100%; border-collapse: collapse; font-size:12px;">
    <thead>
        <tr style="background-color:#f2f2f2;">
            <th style="padding: 8px;">Kampagne</th>
            <th style="padding: 8px;">Typ</th>
            <th style="padding: 8px;">Budget-Empfehlung</th>
            <th style="padding: 8px;">Entgang. Conversions (gesch.)</th>
            <th style="padding: 8px;">Budget-Aussch?pfung (7 Tage)</th>
            <th style="padding: 8px;">Ist CPA/ROAS im Ziel?</th>
            <th style="padding: 8px;">Akt. CPA</th>
            <th style="padding: 8px;">Akt. Wert</th>
            <th style="padding: 8px;">Entgang. IS (Rang)</th>
        </tr>
    </thead>
    <tbody>`;

    campaignsData.forEach(c => {
        const isSearchOrDisplay = c.type === 'SEARCH' || c.type === 'DISPLAY';
        
        let meetsTargetStatus = '-';
        if (c.meetsTargetCPA !== '-') meetsTargetStatus = `CPA: ${c.meetsTargetCPA}`;
        else if (c.meetsTargetROAS !== '-') meetsTargetStatus = `ROAS: ${c.meetsTargetROAS}`;
        
        const meetsTargetColor = meetsTargetStatus.includes('Ja') ? 'green' : (meetsTargetStatus.includes('Nein') ? 'red' : 'initial');

        const lostConvValue = c.estimatedLostConversions > 0 ? 
            c.estimatedLostConversions.toFixed(0) : '-';
        
        const currentCPA = c.CPA === Infinity ? '-' : formatMicrosToCurrency(c.CPA, currencyCode);

        html += `
        <tr>
            <td style="padding: 8px;">${c.name}</td>
            <td style="padding: 8px;">${c.type}</td>
            <td style="padding: 8px; font-weight:bold; color: #2ecc71;">${c.recommendedBudget}</td>
            <td style="padding: 8px;">${lostConvValue}</td>
            <td style="padding: 8px;">${(c.budgetDepletion * 100).toFixed(0)}%</td>
            <td style="padding: 8px; color:${meetsTargetColor};">${meetsTargetStatus}</td>
            <td style="padding: 8px;">${currentCPA}</td>
            <td style="padding: 8px;">${formatMicrosToCurrency(c.conversionsValue, currencyCode)}</td>
            <td style="padding: 8px;">${isSearchOrDisplay ? c.searchISLostRank.toFixed(1) + '%' : '-'}</td>
        </tr>`;
    });

    html += `
    </tbody>
    </table>`;

    return html;
}

/** Generates the PDF blob from the campaigns data. */
function createCampaignReportPdf(campaignsData, currencyCode, clientId) {
    const reportHtml = generateBudgetTableHtml(campaignsData, currencyCode); 

    const pdfTitle = `Budget Report - ${clientId} - ${new Date().toLocaleDateString()}`;
    const fullHtml = `
      <html>
        <head>
          <title>${pdfTitle}</title>
          <style>
            body { font-family: sans-serif; margin: 20px; }
            h1 { font-size: 18px; color: #3498db; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ccc; padding: 10px; text-align: left; font-size: 10px; }
            th { background-color: #f2f2f2; font-weight: bold; }
            td:nth-child(3) { font-weight: bold; color: #2ecc71; }
            td:nth-child(6) { font-weight: bold; }
          </style>
        </head>
        <body>
          <h1>Budget Recommendation Report for Client ${clientId}</h1>
          ${reportHtml}
        </body>
      </html>
    `;

    const htmlBlob = Utilities.newBlob(fullHtml, MimeType.HTML, pdfTitle + '.html');
    const pdfBlob = htmlBlob.getAs(MimeType.PDF);
    pdfBlob.setName(pdfTitle.replace(/\s/g, '_') + '.pdf');
    
    return pdfBlob;
}