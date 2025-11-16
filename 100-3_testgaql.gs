/**
 * Final Test for Search IS Metrics with HTML Output.
 * - Fetches Aggregated Search IS Data.
 * - Generates an HTML Table of the results.
 * - Logs the HTML and attempts to show a visual modal (if run from Sheet).
 */
function testSearchISMetricsWithTable() {
  
  const TEST_CID_RAW = '6652886860'; 
  Logger.log(`\n=== STARTING SEARCH IS TEST (CID: ${TEST_CID_RAW}) ===`);

  // --- 1. Local Helpers ---
  const getSafeDateRange = () => {
    let timeZone = "Europe/Dublin"; 
    try {
       const ss = SpreadsheetApp.getActiveSpreadsheet();
       if (ss) timeZone = ss.getSpreadsheetTimeZone();
    } catch (e) {}
    
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 1); 
    const startDate = new Date(endDate.getTime());
    startDate.setDate(endDate.getDate() - 6); 
    
    return {
        start: Utilities.formatDate(startDate, timeZone, 'yyyy-MM-dd'),
        end: Utilities.formatDate(endDate, timeZone, 'yyyy-MM-dd')
    };
  };

  // --- 2. HTML Generator (Adjusted for 100-3 Data) ---
  const generateLocalHtmlTable = (rows) => {
      if (!rows || rows.length === 0) return '<p>No Data Found</p>';

      let html = `
      <div style="font-family: sans-serif; padding: 20px;">
        <h3 style="color:#007bff;">Search Impression Share Report (7-Day Aggregated)</h3>
        <table border="1" style="width:100%; border-collapse: collapse; text-align: left; font-size: 12px;">
          <thead style="background-color: #f2f2f2;">
            <tr>
              <th style="padding: 8px;">Campaign Name</th>
              <th style="padding: 8px;">Search IS</th>
              <th style="padding: 8px;">Lost IS (Budget)</th>
              <th style="padding: 8px;">Lost IS (Rank)</th>
            </tr>
          </thead>
          <tbody>`;
      
      rows.forEach(row => {
          // Format Metrics to %
          const toPct = (val) => (val !== undefined && val !== null) ? (val * 100).toFixed(2) + '%' : '-';
          
          html += `
            <tr>
              <td style="padding: 8px;">${row.campaign.name}</td>
              <td style="padding: 8px;">${toPct(row.metrics.searchImpressionShare)}</td>
              <td style="padding: 8px; color: #d93025; font-weight: bold;">${toPct(row.metrics.searchBudgetLostImpressionShare)}</td>
              <td style="padding: 8px;">${toPct(row.metrics.searchRankLostImpressionShare)}</td>
            </tr>`;
      });

      html += `
          </tbody>
        </table>
      </div>`;
      return html;
  };

  try {
    // --- 3. CID Conversion ---
    const cidTrimmed = String(TEST_CID_RAW).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    if (!extIds || !extIds[cidTrimmed]) throw new Error(`CID Lookup Failed`);
    const apiCid = extIds[cidTrimmed].replace(/-/g, '');
    
    // --- 4. Execute Query ---
    const dates = getSafeDateRange();
    Logger.log(`> Date Range: ${dates.start} to ${dates.end}`);

    const QUERY = `
      SELECT
        campaign.id,
        campaign.name,
        metrics.search_impression_share,
        metrics.search_budget_lost_impression_share,
        metrics.search_rank_lost_impression_share
      FROM
        campaign
      WHERE
        campaign.status = 'ENABLED' 
        AND campaign.advertising_channel_type = 'SEARCH'
        AND segments.date BETWEEN '${dates.start}' AND '${dates.end}'
    `;

    const request = { customerId: apiCid, query: QUERY };
    const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
    const results = JSON.parse(responseJson).results || [];

    Logger.log(`> Rows Returned: ${results.length}`);

    // --- 5. Generate & Log HTML ---
    if (results.length > 0) {
        const htmlOutput = generateLocalHtmlTable(results);
        
        Logger.log("\n--- GENERATED HTML (PREVIEW) ---");
        Logger.log(htmlOutput);
        
        // Optional: Try to show as a pop-up if running in Sheet context
        try {
            const ui = SpreadsheetApp.getUi();
            const output = HtmlService.createHtmlOutput(htmlOutput).setWidth(800).setHeight(600);
            ui.showModalDialog(output, 'Test Report Result');
        } catch(e) {
            Logger.log("> Note: Could not display modal (likely running from Editor). HTML is logged above.");
        }

    } else {
        Logger.log("> WARNING: 0 rows returned. Cannot generate table.");
    }

  } catch (e) {
    Logger.log(`\nFATAL ERROR: ${e.message}`);
    Logger.log(e.stack);
  }
  
  Logger.log("\n=== TEST COMPLETED ===");
}