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
    - When the "Import Recipe" button is clicked on a YouTube page, the YouTube-specific workflow will be initiated **if a YouTube Data API key is configured in settings**.
    - If the key is missing, the popup should display a message prompting the user to configure it in Options.

2.  **Phase 1: Description Analysis:**

    - **Fetch Video Details:** The `background.js` script will use the configured YouTube Data API key to call the `youtube.videos.list` endpoint with the video ID (extracted from the URL) and `part=snippet`.
      - This API call retrieves the video's title and description text.
    - **Send Description to Claude:** Send the extracted description text from the API response to the Claude API using a prompt specifically designed to find and structure "Ingredients" and "Directions" sections within potentially unstructured description text.
      - _Prompt Engineering:_ Craft a prompt telling Claude to look for common recipe keywords and structures within the provided description text and return a JSON object containing `title` (video title from API), `ingredients` (array of strings), and `directions` (array of strings), or an indication that no recipe was found.
    - **Process Response:** If Claude successfully extracts ingredients and directions, proceed to the Notion Integration step.

3.  **Phase 2: Transcript Analysis (Fallback):**

    - **Trigger Fallback:** If the description text (from API) is empty, or if Claude indicates no recipe information was found in the description, initiate the transcript analysis.
    - **Fetch Transcript:** The `background.js` script will use the YouTube Data API key to call the `youtube.captions.list` endpoint with the video ID to get available caption tracks.
      - If a suitable track (e.g., standard language, not ASR if possible) is found, use its ID to call `youtube.captions.download` to get the transcript text (likely in SRT or similar format).
      - _Challenge:_ Parsing transcript formats (like SRT) to get plain text might be needed.
    - **Send Transcript to Claude:** If the transcript is successfully downloaded and parsed, send its text content to the Claude API with a prompt tailored for extracting recipe steps and ingredients from conversational text.
      - _Prompt Engineering:_ This prompt will be different from the description prompt, focusing on identifying cooking instructions and ingredient mentions within spoken dialogue.
    - **Process Response:** If Claude extracts usable information, proceed to Notion Integration.

4.  **Notion Integration:**

    - Format the extracted data (title from API, source URL (YouTube video), ingredients, directions) into the standard Notion API payload used by `background.js`.
    - Use the existing `createNotionPage` function to create the recipe page in the user's Notion database.
    - The video thumbnail can be reliably obtained from the `snippet.thumbnails` object in the `youtube.videos.list` API response.

5.  **User Interface & Feedback (`js/popup.js`):**

    - Update status messages: "Fetching video details...", "Checking video description...", "Fetching transcript...", "Analyzing video transcript...", "Could not find recipe in description or transcript.", "Importing YouTube recipe...", "YouTube API Key needed in Options".
    - Visually distinguish (perhaps with an icon) when the importer is targeting a YouTube video.
    - Handle errors gracefully (e.g., transcript not available, Claude fails, API errors) and inform the user via the status element and notifications.

6.  **Background Script (`js/background.js`):**
    - Add logic to handle the new message types for YouTube processing (e.g., `getYoutubeVideoDetails`, `getYoutubeTranscript`, `processYoutubeData`).
    - Add functions to interact with the YouTube Data API (`videos.list`, `captions.list`, `captions.download`) using the stored API key.
    - Adapt the Claude API call logic to use the different prompts required for description vs. transcript analysis.
    - Incorporate the existing state management and notification system.

## API Interactions

- **YouTube Data API v3:**
  - `videos.list` (part=snippet) - To get title, description, thumbnails (Cost: 1 unit).
  - `captions.list` - To find available transcript/caption tracks (Cost: 50 units).
  - `captions.download` - To download the transcript text (Cost: 200 units - _Note: Check current cost, might vary_).
- **Claude API:** Called potentially twice per video (description, then transcript), using different prompts. Cost implications should be considered.
- **Notion API:** Called once upon successful extraction.

## Potential Challenges & Considerations

- **API Key Management:** Users must obtain and configure their own YouTube Data API key, adding setup friction.
- **Transcript Availability & Format:** Not all videos have transcripts, or they may be auto-generated (ASR) and less accurate. Downloaded transcripts need parsing (e.g., SRT format).
- **Claude Extraction Accuracy:** Extracting structured data from unstructured descriptions or conversational transcripts remains challenging. Prompt engineering is key.
- **Quota Costs:** While the free daily quota (10,000 units) is generous for individual use, fetching captions (list: 50, download: 200) is more expensive than fetching basic video details (1 unit).
- **API Errors:** Need robust handling for YouTube API errors (invalid key, quota exceeded, video not found, captions unavailable etc.).

## Future Enhancements

- **Multimodal Analysis:** Use more advanced AI models that can directly analyze video/audio content (beyond transcripts) for higher accuracy (likely requires significant external services and cost).
- **Timestamp Linking:** If using transcripts, attempt to link extracted direction steps back to their corresponding timestamps in the video.
- **User-Assisted Extraction:** If automatic extraction fails, allow the user to manually copy/paste the description or transcript into the extension for processing.
- **Language Support:** Handle transcripts/descriptions in different languages.

This proposal uses the official YouTube Data API for fetching video details and transcripts, providing a more stable approach than DOM scraping, at the cost of requiring an API key from the user.
