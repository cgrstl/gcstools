function erzwingeBerechtigungen() {
  // 1. Drive Zugriff erzwingen
  try {
    DriveApp.getRootFolder();
    console.log("Drive Berechtigung: OK");
  } catch (e) {
    console.log("Drive Auth Info: " + e.message);
  }

  // 2. Externe Dienste erzwingen
  // WICHTIG: Wir nutzen die Gemini-URL, da diese in der Whitelist steht!
  // Das zwingt Google, den Scope "Verbindung zu externem Dienst" abzufragen.
  try {
    UrlFetchApp.fetch("https://generativelanguage.googleapis.com/"); 
    console.log("UrlFetch Berechtigung: OK");
  } catch (e) {
    // Ein Fehler (z.B. 404) ist hier egal und gut! 
    // Hauptsache der Request wurde versucht -> Trigger f?r das Auth-Popup.
    console.log("UrlFetch Attempted: " + e.message);
  }
}