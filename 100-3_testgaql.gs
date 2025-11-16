function testSearchISMetricsOnly() {
  const TESTCIDRAW = '6652886860';
  Logger.log('STARTING SEARCH IS TEST | CID: ' + TESTCIDRAW);

  // 1. Local Helpers - Safe, Isolated ---
  const getSafeDateRange = () => {
    // 7-day period ending yesterday, EU/Dublin timezone
    const timeZone = 'Europe/Dublin';
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 1); // yesterday
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 6); // 7 days ago
    return {
      start: Utilities.formatDate(startDate, timeZone, 'yyyy-MM-dd'),
      end: Utilities.formatDate(endDate, timeZone, 'yyyy-MM-dd'),
    };
  };

  try {
    // 2. CID Validation ---
    const cidTrimmed = String(TESTCIDRAW).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds(cidTrimmed);
    if (!extIds || !extIds[cidTrimmed]) throw new Error('CID Lookup Failed for ' + TESTCIDRAW);
    const apiCid = extIds[cidTrimmed].replace(/-/g, '');
    Logger.log('API CID: ' + apiCid);

    // 3. Date Range ---
    const dates = getSafeDateRange();
    Logger.log('Date Range: ' + dates.start + ' to ' + dates.end);

    // 4. The Specific Query ---
    // **DO NOT put segments.date in SELECT! Just use it in WHERE filter**
    // Only pull IS metrics, not cost/conversion
    const QUERY = `
      SELECT
        campaign.id,
        campaign.name,
        metrics.search_impression_share,
        metrics.search_impression_share_lost_budget,
        metrics.search_impression_share_lost_rank
      FROM campaign
      WHERE
        campaign.status = ENABLED
        AND campaign.advertising_channel_type = SEARCH
        AND segments.date BETWEEN '${dates.start}' AND '${dates.end}'
    `;
    Logger.log('EXECUTING QUERY...');
    Logger.log('Query: ' + QUERY);

    // 5. Execute ---
    const request = { customerId: apiCid, query: QUERY };
    const responseJson = InternalAdsApp.search(JSON.stringify(request), { version: 'v19' });
    const response = JSON.parse(responseJson);
    const results = response.results;

    // 6. Report ---
    Logger.log('Rows Returned: ' + results.length);
    if (results.length > 0) {
      Logger.log('--- SUCCESS: DATA FOUND ---');
      const count = Math.min(results.length, 3);
      for (let i = 0; i < count; i++) {
        const row = results[i];
        Logger.log('Row ' + (i + 1) + ': ' + row.campaign.name);
        Logger.log(' - Search IS: ' + row.metrics.searchImpressionShare);
        Logger.log(' - Lost Budget: ' + row.metrics.searchImpressionShareLostBudget);
        Logger.log(' - Lost Rank: ' + row.metrics.searchImpressionShareLostRank);
      }
    } else {
      Logger.log('WARNING: 0 rows returned. The API returned no data for these specific metrics.');
    }

  } catch (e) {
    Logger.log('ERROR: ' + e.message);
    Logger.log(e.stack);
  }
  Logger.log('TEST COMPLETED');
}
