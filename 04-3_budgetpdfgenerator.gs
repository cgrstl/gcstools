/**
 * @file 04-3_PdfGenerator.gs
 * @description Erstellt ein PDF-Blob f?r den Budget Report.
 * Diese Datei enth?lt die gesamte Logik zur HTML-Tabellenerstellung und PDF-Konvertierung.
 * @Needs Utilities
 * @Needs MimeType
 */

/**
 * Hauptfunktion zur Erstellung des PDF-Blobs.
 * @param {Array<Object>} allCampaignsData Das *komplette* Array aller berechneten Kampagnendaten.
 * @param {string} currency Der W?hrungscode (z.B. "EUR").
 * @param {string} externalCid Die externe CID (z.B. "123-456-7890") f?r den Titel.
 * @param {string} dateRangeString Der Datumsbereich-String (z.B. "LAST_7_DAYS").
 * @return {GoogleAppsScript.Base.Blob} Das generierte PDF-Blob.
 */
function createBudgetReportPdf_(allCampaignsData, currency, externalCid, dateRangeString) {
  Logger.log(`Generating PDF for ${allCampaignsData.length} campaigns, CID: ${externalCid}`);
  
  try {
    const reportTitle = `Budget Report for Google Ads Account ${externalCid} (${dateRangeString})`;
    
    // Generiere den HTML-Inhalt f?r die Tabelle
    const tableHtml = generatePdfHtmlTable_(allCampaignsData, currency);

    // Erstelle das vollst?ndige HTML-Dokument f?r das PDF
    const fullHtml = `
      <html>
        <head>
          <title>${reportTitle}</title>
          <style>
            @page {
              /* Wir verwenden Querformat (landscape), da 11 Spalten im Hochformat (portrait) nicht lesbar sind */
              size: A4 landscape;
              margin: 1.5cm;
            }
            body {
              font-family: Arial, sans-serif;
              font-size: 9pt;
              color: #333;
            }
            h1 {
              font-size: 14pt;
              color: #000;
              border-bottom: 2px solid #ccc;
              padding-bottom: 5px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 15px;
              page-break-inside: auto;
            }
            tr {
              page-break-inside: avoid;
              page-break-after: auto;
            }
            th, td {
              border: 1px solid #ccc;
              padding: 4px 6px;
              text-align: left;
              word-wrap: break-word;
            }
            th {
              background-color: #f2f2f2;
              font-size: 8pt;
              font-weight: bold;
              padding: 6px;
            }
            td {
              text-align: right; /* Standard f?r Zahlen */
            }
            /* Spalten mit Text linksb?ndig */
            td:nth-child(1), 
            td:nth-child(2), 
            td:nth-child(5), 
            td:nth-child(7) {
              text-align: left;
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
 * @param {Array<Object>} data Das Array der Kampagnenobjekte.
 * @param {string} currency W?hrungscode.
 * @return {string} Der HTML-String f?r die <table>.
 */
function generatePdfHtmlTable_(data, currency) {
  let html = '<table><thead><tr>';
  
  // Die von dir definierten Spalten?berschriften
  const headers = [
    "Campaign", "Campaign Type", "Current Budget", "Budget Depletion",
    "Limited by Budget", "Recommended Budget", "Meets Target",
    "Impression Share (IS)", "Lost IS (budget)", "Lost IS (rank)",
    "Missed Conversions (budget)"
  ];
  
  headers.forEach(h => html += `<th>${h}</th>`);
  html += '</tr></thead><tbody>';

  // Datenzeilen erstellen
  data.forEach(c => {
    html += '<tr>';
    html += `<td>${c.name}</td>`;
    html += `<td>${c.type}</td>`;
    html += `<td>${formatForPdf_('currency', c.budget, currency)}</td>`;
    html += `<td>${formatForPdf_('percent', c.depletion, 0)}</td>`; // c.depletion wird in 04-1 berechnet
    html += `<td>${formatForPdf_('yesno', c.isLimited)}</td>`;
    html += `<td>${c.isLimited ? formatForPdf_('currency', c.recAmount, currency) : '-'}</td>`;
    html += `<td>${formatForPdf_('target', c.targetStatus)}</td>`;
    html += `<td>${formatForPdf_('percent', c.isShare, 2)}</td>`;
    html += `<td>${formatForPdf_('percent', c.lostBudget, 2)}</td>`;
    html += `<td>${formatForPdf_('percent', c.lostRank, 2)}</td>`;
    html += `<td>${formatForPdf_('number', c.missedConv, 1)}</td>`;
    html += '</tr>';
  });

  html += '</tbody></table>';
  return html;
}

/**
 * Hilfsfunktion zur Formatierung der PDF-Daten.
 * @param {string} type Format-Typ (currency, percent, yesno, target, number).
 * @param {*} value Der Rohwert.
 * @param {string} [currency] W?hrungscode (nur f?r Typ 'currency').
 * @return {string} Der formatierte String.
 */
function formatForPdf_(type, value, currency) {
  try {
    switch (type) {
      case 'currency':
        if (value === 0 || value === 'N/A' || !value) return '-';
        return `${currency} ${parseFloat(value).toFixed(2)}`;
      case 'percent':
        if (value === 0 || !value) return '0.00%';
        // Der Wert kommt als 0.xx (f?r IS) oder xx.xx (f?r Depletion)
        const numVal = parseFloat(value);
        if (numVal > 1.0) { // Bereits als Prozent (Depletion)
            return `${numVal.toFixed(1)}%`;
        }
        return `${(numVal * 100).toFixed(2)}%`; // Muss multipliziert werden (IS)
      case 'yesno':
        return value ? 'Yes' : 'No';
      case 'target':
        if (value === 'Target Met') return 'Yes';
        if (value === 'Target Missed') return 'No';
        return '-'; // F?r "No Target"
      case 'number':
         if (value === 0 || value === 'None' || !value) return '0';
         return parseFloat(value).toFixed(1);
      default:
        return String(value);
    }
  } catch (e) {
    return '-';
  }
}