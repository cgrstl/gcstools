# GCS Tools for Google Sheets

GCS Tools is a Google Apps Script project designed to enhance Google Sheets with several productivity tools, including automated email drafting/sending, call scheduling, change history tracking, and AI-powered budget recommendations.

## Features

### 1. Mass Email Sender
- Send or draft mass emails using a Gmail draft as a template.
- Supports placeholders (e.g., `{{ContactName}}`) for personalization.
- Handles attachments and inline images from the Gmail draft.
- Optional BCC to a shared inbox.

### 2. Call Scheduler
- Automatically schedule calls based on available slots in your Google Calendar.
- Configurable availability windows, duration, and buffer times.
- Supports placeholders in event titles and descriptions.

### 3. Change History User Finder
- Fetches user emails from Google Ads change history for specified CIDs.
- Reports the last users who made changes within a lookback window (up to 30 days).

### 4. Budget Recommendations
- Generates AI-powered budget analysis for Google Ads campaigns using Gemini AI.
- Creates a detailed PDF report of campaign performance.
- Uses client-side polling to handle large datasets efficiently.

## Setup Instructions

### 1. Project Manifest
Ensure your `appsscript.json` includes the necessary scopes and advanced services (like Calendar V3).

### 2. Script Properties
The Budget tool requires a Gemini API key.
1. Go to Project Settings in the Apps Script editor.
2. Add a Script Property named `GEMINI_API_KEY` with your API key from Google AI Studio.

### 3. Usage
Once installed, a new menu 'GCS Tools' will appear in your Google Sheet.
1. Open the tool from the menu.
2. Follow the instructions in the sidebar to configure and run each tool.
3. Ensure your sheet data matches the expected format (e.g., CID in one column, trigger '1' in another).

## Development
The project is organized by numeric prefixes:
- `00`: Menu and initialization.
- `01`: Email module.
- `02`: Call module.
- `03`: User history module.
- `04`: Budget module.
- `100`: Shared helper functions.
