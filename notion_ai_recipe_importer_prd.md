# Notion AI Recipe Importer Chrome Extension PRD

## Executive Summary
The Notion AI Recipe Importer Chrome Extension is a Manifest V3 extension that enables users to capture recipes from any website with a single click. It leverages the Claude API to extract the recipe name, cuisine type, featured image, ingredient list, and preparation steps, then creates a new page in a designated Notion database.

**User Flow:** Click the extension icon → Parse recipe via Claude API → Create a Notion page with structured blocks → Display success or error notification.

**Extension Branding:** Define the extension title and icon asset names (e.g., `icon16.png`, `icon48.png`, `icon128.png`) in `manifest.json` and UI components.

## Problem Statement
Copying and formatting recipes into Notion is time‑consuming and error‑prone. Users require an automated solution that ensures consistency and accuracy when transferring recipe data.

## Goals
- **Efficiency:** Reduce recipe capture to a single click.
- **Accuracy:** Extract only the relevant recipe data.
- **Integration:** Provide seamless Notion API integration for automatic page creation.

## User Stories
1. **Home Cook:** Clicks the extension icon on a recipe page; the recipe is parsed and saved to Notion without manual input.
2. **Recipe Collector:** Confident that only the core recipe information is extracted.

## Key Features
- **One‑Click Capture:** A toolbar icon triggers parsing and upload.
- **Claude API Parsing:** Sends the current URL to Claude API for the specified fields.
  - **Example Request:**
    ```json
    {
      "url": "string",
      "fields": ["name","cuisine","imageUrl","ingredients","directions"]
    }
    ```
  - **Example Response:**
    ```json
    {
      "name": "string",
      "cuisine": "string",
      "imageUrl": "string",
      "ingredients": ["string"],
      "directions": ["string"]
    }
    ```
- **Notion API Integration:** Creates a page in a specified database with:
  - **Title:** Exact recipe name.
  - **Cuisine:** Select field using existing tags (Chinese, Mexican, African, Thai, Korean, Indian, Filipino, Mediterranean, Caribbean, Soups, Brunch, American, Hawaiian, South America, Italian, Japanese). Create a new tag only if none match.
  - **Image Block:** Featured image URL matching the dish.
  - **Ingredients List:** Bulleted list matching website ingredients exactly.
  - **Directions List:** Bulleted list matching website directions verbatim.
- **Settings UI:** A modern, simple, and intuitive design that includes:
  - Claude API key field.
  - Notion integration token field.
  - Notion database ID field.
  - Inline validation feedback for invalid key formats.
  - “Test Connection” button for credential verification.
- **User Feedback:** Clear notifications for success and error states.

## Functional Requirements
1. **Manifest (`manifest.json`):**
   - Permissions: `activeTab`, `storage`.
   - Service Worker: `background.js`.
   - Content Script: `content.js` on all pages.
   - Content Security Policy: Strict CSP permitting external API calls to Claude and Notion only.
2. **Content Script:** Captures `location.href` and HTML, then sends a message to the background worker.
3. **Background Worker:**
   - Retrieves credentials from `chrome.storage.sync`.
   - Calls Claude API and validates the response.
   - Calls Notion API to create the page and content blocks.
   - Dispatches Chrome notifications for outcomes.
4. **Options Page:** Provides a form for entering API keys and the database ID. Validates inputs and stores data in `chrome.storage.sync`.
5. **Error Handling:**
   - Handle parsing failures with retry options and user notifications.
   - Retry network timeouts up to two times with exponential backoff, then notify the user.
   - Log invalid API responses and prompt the user to verify credentials.
   - Detect API credit exhaustion (e.g., HTTP 402); notify users to refill or update their key and disable capture until resolved.
   - Record errors to the developer console and optionally persist logs in `chrome.storage.local`.

## Non‑Functional Requirements
- **Performance:** Achieve a parse and upload time of under 2 seconds on average.
- **Permissions:** Limit to the minimum required scopes (`activeTab`, `storage`).
- **Offline Support:** Ensure UI components are accessible offline.
- **Security:** Store credentials securely and use HTTPS for all network traffic.
- **Rate Limiting & Quotas:**
  - Claude API: Maximum of 60 requests per minute.
  - Notion API: Maximum of 3 requests per second.
  - Implement exponential backoff for 429 status codes.

## Security & Privacy
- Handle page content transiently in memory only.
- Avoid third‑party analytics and tracking.
- Store tokens securely using the Chrome Storage API.

## Success Metrics
- **Adoption:** 1,000 weekly active users within three months.
- **Accuracy:** At least 90% successful extractions on the top 100 recipe websites.
- **Reliability:** Maintain an error rate below 5%.
- **Testing Coverage:** Include unit tests for parsing and UI logic, integration tests for API interactions, and end‑to‑end tests for the complete workflow.

## Implementation Steps
1. Scaffold the extension structure, including `manifest.json` and the popup UI.
2. Develop the content script and establish messaging with the background worker.
3. Implement the background worker logic for Claude API parsing.
4. Integrate the Notion API to create pages with the parsed data.
5. Build the settings UI with inline validation and a “Test Connection” feature.
6. Add comprehensive error handling, retry logic, and logging.
7. Implement rate limiting and backoff mechanisms for external API calls.
8. Develop unit, integration, and end‑to‑end tests.
9. Conduct final testing, apply bug fixes, optimize performance, and package the extension for publication.
