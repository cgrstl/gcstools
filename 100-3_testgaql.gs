/**
 * DIAGNOSTIC FUNCTION: Search Impression Share
 * - Bypasses the broken 'get7DayDateRange_' helper to avoid Spreadsheet errors.
 * - Calculates dates locally using "Europe/Dublin".
 * - Runs 3 probes to check visibility of Search Campaigns vs. IS Metrics.
 */
function diagnoseSearchIS() {
  
  const TEST_CID_RAW = '6652886860'; 

  Logger.log(`\n=== STARTING DIAGNOSTIC FOR CID: ${TEST_CID_RAW} ===`);

  try {
    // 1. CID Conversion (Using Global InternalAdsApp)
    const cidTrimmed = String(TEST_CID_RAW).trim();
    const extIds = InternalAdsApp.getExternalCustomerIds([cidTrimmed]);
    
    if (!extIds || !extIds[cidTrimmed]) throw new Error("CID Lookup Failed");
    const apiCid = extIds[cidTrimmed].replace(/-/g, '');
    Logger.log(`> API CID: ${apiCid}`);

    // 2. SAFE DATE CALCULATION (Local - No Spreadsheet Dependency)
    // We hardcode the timezone to ensure this runs in the editor
    const timeZone = "Europe/Dublin"; 
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 1); // Yesterday
    const startDate = new Date(endDate.getTime());
    startDate.setDate(endDate.getDate() - 6); // 7 days ago
    
    const dateRange = {
        startDateStr: Utilities.formatDate(startDate, timeZone, 'yyyy-MM-dd'),
        endDateStr: Utilities.formatDate(endDate, timeZone, 'yyyy-MM-dd')
    };
    Logger.log(`> Date Range: ${dateRange.startDateStr} to ${dateRange.endDateStr}`);

    // --- PROBE 1: BASIC VISIBILITY ---
    // Can we see ANY Search campaigns?
    Logger.log('\n[PROBE 1] Checking Campaign Visibility (No IS metrics)...');
    const Q1_BASIC = `
      SELECT
        campaign.id,
        campaign.name,
        metrics.impressions,
        metrics.cost_micros,
        segments.date
      FROM
        campaign
      WHERE
        campaign.status = 'ENABLED' 
        AND campaign.advertising_channel_type = 'SEARCH'
        AND segments.date BETWEEN '${DATE_PLACEHOLDER_START}' AND '${DATE_PLACEHOLDER_END}'
    `;
    // We use the global executeGAQLQuery, passing our safe local dates
    const res1 = executeGAQLQuery(apiCid, Q1_BASIC, { dateRange: dateRange });
    Logger.log(`> Rows Returned: ${res1.results?.length || 0}`);
    
    if (res1.results?.length > 0) {
        const r = res1.results[0];
        Logger.log(`> Sample: "${r.campaign.name}" | Impr: ${r.metrics.impressions} | Cost: ${r.metrics.costMicros}`);
    } else {
        Logger.log("> WARNING: Probe 1 returned 0 rows. This means the API sees NO active Search campaigns with spend/impressions in this period.");
    }

    // --- PROBE 2: MAIN IS METRIC ONLY ---
    // Does adding 'search_impression_share' break it?
    Logger.log('\n[PROBE 2] Adding "search_impression_share"...');
    const Q2_IS_ONLY = `
      SELECT
        campaign.id,
        campaign.name,
        metrics.impressions,
        metrics.search_impression_share,
        segments.date
      FROM
        campaign
      WHERE
        campaign.status = 'ENABLED' 
        AND campaign.advertising_channel_type = 'SEARCH'
        AND segments.date BETWEEN '${DATE_PLACEHOLDER_START}' AND '${DATE_PLACEHOLDER_END}'
    `;
    const res2 = executeGAQLQuery(apiCid, Q2_IS_ONLY, { dateRange: dateRange });
    Logger.log(`> Rows Returned: ${res2.results?.length || 0}`);
    
    if (res2.results?.length > 0) {
         Logger.log(`> Sample IS: ${res2.results[0].metrics.searchImpressionShare}`);
    }

    // --- PROBE 3: FULL METRICS ---
    // The target query with Lost Budget/Rank
    Logger.log('\n[PROBE 3] Full Query (IS + Lost Budget + Lost Rank)...');
    const Q3_FULL = `
      SELECT
        campaign.id,
        campaign.name,
        metrics.search_impression_share,
        metrics.search_impression_share_lost_budget,
        metrics.search_impression_share_lost_rank,
        segments.date
      FROM
        campaign
      WHERE
        campaign.status = 'ENABLED' 
        AND campaign.advertising_channel_type = 'SEARCH'
        AND segments.date BETWEEN '${DATE_PLACEHOLDER_START}' AND '${DATE_PLACEHOLDER_END}'
    `;
    const res3 = executeGAQLQuery(apiCid, Q3_FULL, { dateRange: dateRange });
    Logger.log(`> Rows Returned: ${res3.results?.length || 0}`);
    
    if (res3.results?.length > 0) {
         const r = res3.results[0];
         Logger.log(`> Sample: IS=${r.metrics.searchImpressionShare} | LostBudget=${r.metrics.searchImpressionShareLostBudget} | LostRank=${r.metrics.searchImpressionShareLostRank}`);
    } else if (res2.results?.length > 0) {
         Logger.log("> WARNING: Probe 2 worked but Probe 3 failed. The 'Lost' metrics might be causing the filter.");
    }

  } catch (e) {
    Logger.log(`\nFATAL ERROR: ${e.message}`);
    Logger.log(e.stack);
  }
  Logger.log("\n=== DIAGNOSTIC COMPLETED ===");
}