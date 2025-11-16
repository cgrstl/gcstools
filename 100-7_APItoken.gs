/**
 * Diagnostic: List available Gemini Models for the API Key.
 * Helps resolve "404 Model Not Found" errors by showing valid model names.
 */
function listGeminiModels() {
  const API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!API_KEY) {
    Logger.log("ERROR: GEMINI_API_KEY not found in Script Properties.");
    return;
  }

  const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

  try {
    const response = UrlFetchApp.fetch(ENDPOINT, {
      method: 'get',
      muteHttpExceptions: true
    });
    
    const json = JSON.parse(response.getContentText());
    
    if (json.models) {
      Logger.log("\n=== AVAILABLE GEMINI MODELS ===");
      json.models.forEach(model => {
        if (model.name.includes("gemini")) { // Filter for Gemini models
            Logger.log(`Model: ${model.name}`);
            Logger.log(`   DisplayName: ${model.displayName}`);
            Logger.log(`   Methods: ${model.supportedGenerationMethods.join(', ')}`);
            Logger.log("------------------------------------------------");
        }
      });
    } else {
      Logger.log("No models returned. API Response:");
      Logger.log(JSON.stringify(json, null, 2));
    }

  } catch (e) {
    Logger.log(`FATAL ERROR: ${e.message}`);
  }
}