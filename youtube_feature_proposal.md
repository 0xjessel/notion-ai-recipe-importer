# Proposal: YouTube Recipe Extraction Feature

This document outlines the proposed implementation for adding a feature to the Notion AI Recipe Importer to extract recipe ingredients and directions from YouTube videos.

## Goals

- Allow users to import recipes from YouTube video pages (`youtube.com/watch?v=...`).
- Prioritize extracting recipe details (ingredients, directions) from the video description text.
- Fall back to analyzing the video's transcript if the description does not contain usable recipe information.
- Integrate seamlessly with the existing Notion import workflow.
- Provide clear user feedback throughout the process.

## Implementation Steps

1.  **Triggering the Feature:**

    - The existing popup logic (`js/popup.js`) will detect when the active tab's URL matches `https://www.youtube.com/watch?v=*`.
    - When the "Import Recipe" button is clicked on a YouTube page, the YouTube-specific workflow will be initiated.
    - No API key is required for transcript extraction, reducing setup friction for users.

2.  **Phase 1: Description Analysis:**

    - **Fetch Video Details:** The extension will extract the video's title and description directly from the YouTube page DOM using content scripts.
    - **Send Description to Claude:** Send the extracted description text to the Claude API using a prompt specifically designed to find and structure "Ingredients" and "Directions" sections within potentially unstructured description text.
      - _Prompt Engineering:_ Craft a prompt telling Claude to look for common recipe keywords and structures within the provided description text and return a JSON object containing `title` (video title from the page), `ingredients` (array of strings), and `directions` (array of strings), or an indication that no recipe was found.
    - **Process Response:** If Claude successfully extracts ingredients and directions, proceed to the Notion Integration step.

3.  **Phase 2: Transcript Analysis (Fallback):**

    - **Trigger Fallback:** If the description text is empty, or if Claude indicates no recipe information was found in the description, initiate the transcript analysis.
    - **Fetch Transcript:** The extension will use a content script to programmatically interact with the YouTube page, open the transcript panel (if available), and scrape the full transcript from the DOM. The script will stitch together all transcript segments, clean up timestamps and speaker labels, and produce a single plain text transcript.
      - _Challenge:_ Handling dynamic loading of transcript segments and ensuring the transcript is complete and in the correct order.
    - **Send Transcript to Claude:** If the transcript is successfully scraped and cleaned, send its text content to the Claude API with a prompt tailored for extracting recipe steps and ingredients from conversational text.
      - _Prompt Engineering:_ This prompt will be different from the description prompt, focusing on identifying cooking instructions and ingredient mentions within spoken dialogue.
    - **Process Response:** If Claude extracts usable information, proceed to Notion Integration.

4.  **Notion Integration:**

    - Format the extracted data (title from the page, source URL (YouTube video), ingredients, directions) into the standard Notion API payload used by `background.js`.
    - Use the existing `createNotionPage` function to create the recipe page in the user's Notion database.
    - The video thumbnail can be obtained from the YouTube page's meta tags or DOM elements.

5.  **User Interface & Feedback (`js/popup.js`):**

    - Update status messages: "Fetching video details...", "Checking video description...", "Fetching transcript...", "Analyzing video transcript...", "Could not find recipe in description or transcript.", "Importing YouTube recipe...".
    - Visually distinguish (perhaps with an icon) when the importer is targeting a YouTube video.
    - Handle errors gracefully (e.g., transcript not available, Claude fails, DOM structure changes) and inform the user via the status element and notifications.

6.  **Background Script (`js/background.js`):**
    - Add logic to handle the new message types for YouTube processing (e.g., `getYoutubeVideoDetails`, `getYoutubeTranscript`, `processYoutubeData`).
    - Add functions to interact with the YouTube page DOM via content scripts to extract the required data.
    - Adapt the Claude API call logic to use the different prompts required for description vs. transcript analysis.
    - Incorporate the existing state management and notification system.
    - **Refactor Note:** The Claude API call, error handling, and JSON extraction logic is now centralized in a single function (`extractRecipeWithClaude`). This function accepts a prompt builder, so both the YouTube and normal website flows reuse the same robust logic, reducing code duplication and improving maintainability.

## Data Extraction Approach

- **YouTube Page Scraping:**
  - Extract video title, description, and thumbnail from the DOM (e.g., meta tags, visible elements).
  - Open and scrape the transcript panel using DOM manipulation and event simulation, then stitch together all transcript segments into a single plain text block.
- **Claude API:** Called potentially twice per video (description, then transcript), using different prompts. Cost implications should be considered.
- **Notion API:** Called once upon successful extraction.

## Potential Challenges & Considerations

- **Transcript Availability & Structure:** Not all videos have transcripts, and the transcript panel may not be available or may require user interaction to open. The DOM structure of the transcript may change, requiring maintenance of the scraping logic.
- **Transcript Stitching:** Ensuring the transcript is complete, in the correct order, and free of timestamps or extraneous text may require robust parsing and cleaning.
- **Claude Extraction Accuracy:** Extracting structured data from unstructured descriptions or conversational transcripts remains challenging. Prompt engineering is key.
- **YouTube DOM Changes:** YouTube may update its page structure, which could break the scraping logic. The extension should handle such errors gracefully and notify the user if extraction fails.
- **Permissions:** The extension will require permissions to inject content scripts and interact with YouTube pages.
- **Code Reuse:** The Claude API integration is now DRY: both YouTube and normal website flows use the same `extractRecipeWithClaude` function with a different prompt builder, making future changes and debugging easier.

## Future Enhancements

- **Multimodal Analysis:** Use more advanced AI models that can directly analyze video/audio content (beyond transcripts) for higher accuracy (likely requires significant external services and cost).
- **Timestamp Linking:** If using transcripts, attempt to link extracted direction steps back to their corresponding timestamps in the video.
- **User-Assisted Extraction:** If automatic extraction fails, allow the user to manually copy/paste the description or transcript into the extension for processing.
- **Language Support:** Handle transcripts/descriptions in different languages.

This proposal uses frontend scraping of the YouTube page to fetch video details and transcripts, eliminating the need for a YouTube Data API key and providing a more user-friendly and accessible approach for extracting recipe information from YouTube videos.
