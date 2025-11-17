/**
 * @file 04-3_budgetpdfgenerator.gs
 * @description Erstellt ein PDF-Blob.
 * - Nutzt die BEREITS FORMATIERTEN Daten aus 1007-8.
 * - Kein Formatieren oder Rechnen mehr n?tig.
 * - Layout: Landscape, Plain, mit Legende.
 */

function createBudgetReportPdf_(allCampaignsData, currency, externalCid, dateRangeString) {
  Logger.log(`Generating PDF for ${allCampaignsData.length} campaigns, CID: ${externalCid}`);
  
  if (!allCampaignsData || allCampaignsData.length === 0) return null;

  try {
    const reportTitle = `Campaign Budget Report for Google Ads Account ${externalCid} (${dateRangeString})`;
    const tableHtml = generatePdfHtmlTable_(allCampaignsData);

    // 1. Fu?noten-Text definiert
    const footerNote = "* Note: Cells marked with '-' indicate that the metric is not applicable to this campaign type or data is unavailable.";

    const fullHtml = `
      <html>
        <head>
          <title>${reportTitle}</title>
          <style>
            @page { size: A4 landscape; margin: 1cm; }
            body { font-family: Arial, sans-serif; font-size: 9pt; color: #000; }
            h1 { font-size: 14pt; font-weight: bold; margin-bottom: 20px; border-bottom: 1px solid #000; padding-bottom: 5px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #999; padding: 5px; vertical-align: top; }
            th { background-color: #f0f0f0; font-weight: bold; text-align: left; }
            td { font-weight: normal; color: #000; }
            /* Zahlen rechtsb?ndig (Index 2 bis 9) */
            td:nth-child(3), td:nth-child(4), td:nth-child(6), 
            td:nth-child(7), td:nth-child(8), td:nth-child(9), td:nth-child(10) { text-align: right; }
            /* Status zentriert */
            td:nth-child(5) { text-align: center; }
            
            /* 2. CSS f?r Fu?note */
            .footer-note { font-size: 8pt; font-style: italic; margin-top: 10px; color: #555; }
          </style>
        </head>
        <body>
          <h1>${reportTitle}</h1>
          ${tableHtml}
          <p class="footer-note">${footerNote}</p>
        </body>
      </html>
    `;

    const htmlBlob = Utilities.newBlob(fullHtml, MimeType.HTML, `${reportTitle}.html`);
    const pdfBlob = htmlBlob.getAs(MimeType.PDF);
    pdfBlob.setName(`Budget_Report_${externalCid}_${dateRangeString}.pdf`);
    return pdfBlob;

  } catch (e) {
    Logger.log(`Error creating PDF: ${e.message}`);
    return null;
  }
}

function generatePdfHtmlTable_(data) {
  const headers = [
    "Campaign", 
    "Campaign Type", 
    "Current Budget", 
    "Budget Depletion", 
    "Limited by Budget", 
    "Recommended Budget", 
    "Impression Share (IS)", 
    "Lost IS (rank)", 
    "Lost IS (budget)", 
    "Missed conversions (budget)" // 4. Header angepasst
  ];

  let html = '<table><thead><tr>';
  headers.forEach(h => html += `<th>${h}</th>`);
  html += '</tr></thead><tbody>';

  data.forEach(c => {
    const limitedText = (c.Status === 'Limited by Budget') ? 'Yes' : 'No';

    html += '<tr>';
    html += `<td>${escapeHtml_(c.CampaignName)}</td>`;
    html += `<td>${c.CampaignType}</td>`;
    html += `<td>${c.CurrentBudget}</td>`;     
    html += `<td>${c.Depletion_Period}</td>`;  
    html += `<td>${limitedText}</td>`;         
    html += `<td>${c.RecommendedBudget_API}</td>`; 
    html += `<td>${c.ImpressionShare}</td>`;   
    html += `<td>${c.LostIS_Rank}</td>`;
    html += `<td>${c.LostIS_Budget}</td>`;
    html += `<td>${c.MissedConversions_Est}</td>`;
    html += '</tr>';
  });

  html += '</tbody></table>';
  return html;
}

function escapeHtml_(text) {
  if (!text) return "";
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}