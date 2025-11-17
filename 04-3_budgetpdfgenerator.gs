/**
 * @file 04-3_budgetpdfgenerator.gs
 * @description Erstellt ein PDF-Blob f?r den Budget Report.
 * - Verl?sst sich komplett auf die Datenstruktur aus 1007-8 (allCampaignsData).
 * - Keine Gesch?ftslogik, nur Formatierung und Rendering.
 * - Layout: Landscape, Plain (keine Farben/Bold in Rows).
 */

/**
 * Hauptfunktion zur Erstellung des PDF-Blobs.
 * @param {Array<Object>} allCampaignsData Das komplette Array aus 1007-8.
 * @param {string} currency Der W?hrungscode (z.B. "EUR").
 * @param {string} externalCid Die externe CID (z.B. "123-456-7890") f?r den Titel.
 * @param {string} dateRangeString Der Datumsbereich-String (z.B. "LAST_7_DAYS").
 * @return {GoogleAppsScript.Base.Blob} Das generierte PDF-Blob oder null bei Fehler.
 */
function createBudgetReportPdf_(allCampaignsData, currency, externalCid, dateRangeString) {
  Logger.log(`Generating PDF for ${allCampaignsData.length} campaigns, CID: ${externalCid}`);
  
  if (!allCampaignsData || allCampaignsData.length === 0) {
      Logger.log("No data provided for PDF generation.");
      return null;
  }

  try {
    // Titel Formatierung: "Campaign Budget Report for Google Ads Account 123-456-7890 (LAST_7_DAYS)"
    const reportTitle = `Campaign Budget Report for Google Ads Account ${externalCid} (${dateRangeString})`;

    // Generiere den HTML-Inhalt f?r die Tabelle
    const tableHtml = generatePdfHtmlTable_(allCampaignsData, currency);

    // Erstelle das vollst?ndige HTML-Dokument
    const fullHtml = `
      <html>
        <head>
          <title>${reportTitle}</title>
          <style>
            @page {
              size: A4 landscape;
              margin: 1cm;
            }
            body {
              font-family: Arial, sans-serif;
              font-size: 9pt;
              color: #000;
            }
            h1 {
              font-size: 14pt;
              font-weight: bold;
              margin-bottom: 20px;
              border-bottom: 1px solid #000;
              padding-bottom: 5px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              table-layout: auto; 
            }
            th, td {
              border: 1px solid #999; /* D?nner grauer Rahmen */
              padding: 5px;
              vertical-align: top;
            }
            th {
              background-color: #f0f0f0;
              font-weight: bold;
              text-align: left;
            }
            td {
              font-weight: normal; /* Keine Fettschrift in den Daten */
              color: #000; /* Kein farbiger Text */
            }
            /* Zahlen rechtsb?ndig */
            td:nth-child(3), td:nth-child(4), td:nth-child(6), 
            td:nth-child(7), td:nth-child(8), td:nth-child(9), td:nth-child(10) {
              text-align: right;
            }
            /* Text zentriert f?r Ja/Nein */
            td:nth-child(5) {
              text-align: center;
            }
          </style>
        </head>
        <body>
          <h1>${reportTitle}</h1>
          ${tableHtml}
        </body>
      </html>
    `;

    const htmlBlob = Utilities.newBlob(fullHtml, MimeType.HTML, `${reportTitle}.html`);
    const pdfBlob = htmlBlob.getAs(MimeType.PDF);
    pdfBlob.setName(`Budget_Report_${externalCid}_${dateRangeString}.pdf`);
    
    Logger.log("PDF Blob successfully created.");
    return pdfBlob;

  } catch (e) {
    Logger.log(`Error creating PDF Blob: ${e.message}`);
    return null;
  }
}

/**
 * Generiert die HTML-Tabelle basierend auf den Kampagnendaten.
 * Reihenfolge strikt nach User-Vorgabe.
 */
function generatePdfHtmlTable_(data, currency) {
  // Definierte Header (Englisch)
  const headers = [
    "Campaign", 
    "Campaign Type", 
    "Current Budget", 
    "Budget Depletion", 
    "Limited by Budget", 
    "Recommended Budget", 
    "Impression Share (IS)", 
    "Lost IS (rank)",      // User Order: Rank first
    "Lost IS (budget)",    // User Order: Budget second
    "Missed conversions"
  ];

  let html = '<table><thead><tr>';
  headers.forEach(h => html += `<th>${h}</th>`);
  html += '</tr></thead><tbody>';

  // Datenzeilen erstellen
  // data ist das allCampaignsData Array aus 1007-8
  data.forEach(c => {
    html += '<tr>';
    
    // 1. Campaign Name
    html += `<td>${escapeHtml_(c.name)}</td>`;
    
    // 2. Campaign Type
    html += `<td>${c.type}</td>`;
    
    // 3. Current Budget (Format Currency)
    html += `<td>${formatVal_('currency', c.budget, currency)}</td>`;
    
    // 4. Budget Depletion (Format Percent, Input is already 0-100 based like 85.5)
    html += `<td>${formatVal_('percent_100', c.depletion)}</td>`;
    
    // 5. Limited by Budget (Yes/No)
    html += `<td>${c.isLimited ? 'Yes' : 'No'}</td>`;
    
    // 6. Recommended Budget (Value or -)
    // Wir zeigen den Wert nur an, wenn isLimited=true ODER ein Wert da ist.
    // Da c.recAmount 0 ist wenn nicht vorhanden, reicht der Check auf > 0.
    html += `<td>${(c.recAmount > 0) ? formatVal_('currency', c.recAmount, currency) : '-'}</td>`;
    
    // 7. Impression Share (IS) (Input 0.xx -> Format Percent)
    html += `<td>${formatVal_('percent_decimal', c.isShare)}</td>`;
    
    // 8. Lost IS (rank) (Input 0.xx -> Format Percent)
    html += `<td>${formatVal_('percent_decimal', c.lostRank)}</td>`;
    
    // 9. Lost IS (budget) (Input 0.xx -> Format Percent)
    html += `<td>${formatVal_('percent_decimal', c.lostBudget)}</td>`;
    
    // 10. Missed Conversions (Number)
    html += `<td>${formatVal_('number', c.missedConv)}</td>`;
    
    html += '</tr>';
  });

  html += '</tbody></table>';
  return html;
}

/**
 * Zentraler Formatter f?r die PDF-Werte.
 */
function formatVal_(type, value, currency) {
  if (value === null || value === undefined || value === '') return '-';

  try {
    switch (type) {
      case 'currency':
        return `${currency} ${parseFloat(value).toFixed(2)}`;
      
      case 'percent_100': 
        // F?r Werte, die schon 0-100 sind (z.B. Depletion: 85.5)
        const p100 = parseFloat(value);
        return isNaN(p100) ? '-' : `${p100.toFixed(1)}%`;

      case 'percent_decimal':
        // F?r Werte, die 0.0 - 1.0 sind (z.B. IS: 0.85)
        const pDec = parseFloat(value);
        return isNaN(pDec) ? '-' : `${(pDec * 100).toFixed(2)}%`;

      case 'number':
        const num = parseFloat(value);
        // Zeige 0 als 0.0 an, oder '-' wenn wirklich leer/null
        return isNaN(num) ? '-' : num.toFixed(1);
        
      default:
        return String(value);
    }
  } catch (e) {
    return '-';
  }
}

/**
 * Hilfsfunktion um HTML-Sonderzeichen zu escapen (Sicherheit).
 */
function escapeHtml_(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}