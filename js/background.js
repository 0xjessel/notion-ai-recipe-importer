// Processing cancellation flag
let isCancelled = false;

// Process recipe data and interact with Claude API
async function processRecipe(recipeData, tabId) {
  console.log('processRecipe function called with data:', recipeData ? typeof recipeData : 'no data');
  
  // Validate input data
  if (!recipeData || typeof recipeData !== 'object') {
    console.error('Invalid recipe data received:', recipeData);
    updateProcessingStatus('error', 'Invalid recipe data received', tabId);
    return;
  }
  
  try {
    // Store processing state
    const processingStartTime = Date.now();
    await chrome.storage.local.set({ 
      processingRecipe: true,
      processingStartTime: processingStartTime
    });
    
    // Get Notion API credentials from storage
    const { notionToken, notionDatabaseId } = await chrome.storage.sync.get(['notionToken', 'notionDatabaseId']);
    
    // First, check if we need to get available cuisine options from cache
    let cuisineOptions = await getCuisineOptionsFromCache();
    
    // If no cached options, fetch from Notion
    if (!cuisineOptions || cuisineOptions.length === 0) {
      console.log('No cached cuisine options, fetching from Notion');
      if (notionToken && notionDatabaseId) {
        cuisineOptions = await fetchCuisineOptionsFromNotion(notionToken, notionDatabaseId);
        
        // Cache the options for future use
        await chrome.storage.local.set({ 
          cuisineOptionsCache: cuisineOptions,
          cuisineOptionsCacheTime: Date.now()
        });
      }
    }
    
    // Update status to extracting
    updateProcessingStatus('extracting', 'Extracting recipe data with Claude...', tabId);
    
    // Call Claude API with recipe data and cuisine options
    const recipeJson = await extractRecipeWithClaude(recipeData, cuisineOptions);
    
    if (isCancelled) {
      console.log('Processing was cancelled, stopping');
      return;
    }
    
    // Update status to importing
    updateProcessingStatus('importing', 'Importing recipe to Notion...', tabId);
    
    // Call Notion API with extracted data
    // This would be implemented with actual Notion API calls
    await importToNotion(recipeJson);
    
    // Update status to complete
    updateProcessingStatus('complete', 'Recipe imported successfully!', tabId);
    
    // Show notification for completed import
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('images/icon128.png'),
      title: 'Recipe Import Complete',
      message: 'Your recipe has been successfully imported to Notion!',
      priority: 2
    });
    
  } catch (error) {
    console.error('Error processing recipe:', error);
    updateProcessingStatus('error', `Error: ${error.message}`, tabId);
    
    // Show notification for error
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('images/icon128.png'),
      title: 'Recipe Import Failed',
      message: `Error: ${error.message}`,
      priority: 2
    });
  } finally {
    // Clear processing state
    if (!isCancelled) {
      chrome.storage.local.remove(['processingRecipe', 'processingStartTime']);
    }
  }
}

// Helper function to update processing status
function updateProcessingStatus(status, message, tabId) {
  console.log(`Processing status: ${status} - ${message}`);
  
  // If we have a tab ID, send a message to the content script
  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      action: 'processingUpdate',
      status: status,
      message: message
    }).catch(err => console.error('Error sending status update to tab:', err));
  }
  
  // Also broadcast to all extension views (popup)
  chrome.runtime.sendMessage({
    action: 'processingUpdate',
    status: status,
    message: message
  }).catch(err => {
    // This error is expected if popup is closed, we can safely ignore it
    if (err.message !== "Could not establish connection. Receiving end does not exist.") {
      console.error('Error broadcasting status update:', err);
    }
  });
  
  // Store status in local storage for popup to read when opened
  if (status === 'complete') {
    chrome.storage.local.set({
      lastImportStatus: 'success',
      lastImportTime: Date.now()
    });
  } else if (status === 'error') {
    chrome.storage.local.set({
      lastImportStatus: 'error',
      lastImportError: message,
      lastImportTime: Date.now()
    });
  }
  
  // Update badge and popup if needed
  if (status === 'extracting' || status === 'importing') {
    chrome.action.setBadgeText({ text: '...' });
    chrome.action.setBadgeBackgroundColor({ color: '#FFA500' });
  } else if (status === 'complete') {
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
    // Clear badge after 5 seconds
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 5000);
  } else if (status === 'error') {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#F44336' });
  }
}

// Extract recipe data using Claude API
async function extractRecipeWithClaude(recipeData, cuisineOptions = []) {
  console.log('Calling Claude API to extract recipe data');
  
  // Get Claude API key from storage
  const { claudeApiKey } = await chrome.storage.sync.get(['claudeApiKey']);
  
  if (!claudeApiKey) {
    throw new Error('Claude API key not configured');
  }
  
  // Retry settings
  const maxRetries = 3;
  const retryDelay = 2000; // 2 seconds
  
  // Prepare the prompt for Claude
  const url = recipeData.url || '';
  const html = recipeData.html || '';
  
  // Create a simplified version of the HTML to reduce token usage
  const simplifiedHtml = simplifyHtml(html);
  
  // Default cuisine list to use if no options from Notion
  const defaultCuisines = [
    "Chinese", "Mexican", "African", "Thai", "Korean", "Indian", "Filipino", 
    "Mediterranean", "Caribbean", "Soups", "Brunch", "American", "Hawaiian", 
    "South America", "Italian", "Japanese"
  ];
  
  // Use cuisine options from Notion if available, otherwise use defaults
  const cuisineList = (cuisineOptions && cuisineOptions.length > 0) ? cuisineOptions : defaultCuisines;
  
  // Create the prompt for Claude
  const prompt = `
You are a precise and reliable recipe parser for a Chrome extension. Your job is to extract structured recipe data from real-world cooking websites. These pages often contain irrelevant content such as personal stories, ads, comments, nutritional info, or videos — ignore all of that. Focus only on the core recipe.

Analyze the HTML content below and extract the following fields:

name — the exact recipe name as written on the page

cuisine — deduce the most appropriate cuisine from this fixed list:
${cuisineList.join(', ')}
Only create a new value if none of these match reasonably.

imageUrl — a direct link to the main image showing what the final dish looks like

ingredients — an array of objects with the following structure:
- For regular ingredients: { "text": "2 cups flour", "isHeader": false }
- For section headers: { "text": "For the sauce:", "isHeader": true }
Preserve the exact wording and order as written on the page. Section headers are things like "For the sauce:", "Veggies and rice cakes", etc.

directions — an array of objects with the following structure:
- For regular steps: { "text": "Mix flour and water", "isHeader": false }
- For section headers: { "text": "Make the Burger Sauce:", "isHeader": true }
Preserve the exact wording and order as written on the page. Section headers are things like "Make the Burger Sauce:", "Cook the Beef", etc.

Return only a valid JSON object in this exact structure: 
{
  "name": "string", 
  "cuisine": "string", 
  "imageUrl": "string", 
  "ingredients": [{ "text": "string", "isHeader": boolean }, ...], 
  "directions": [{ "text": "string", "isHeader": boolean }, ...],
  "url": "${url}"
}

Do not add any extra commentary, explanations, markdown, or fields. If a field is missing, return an empty string or an empty array.

HTML Content:
${simplifiedHtml}
`;

  // Function to sleep for a specified time
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  
  // Retry logic
  let lastError = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Check if cancelled before making API call
      if (isCancelled) {
        throw new Error('Processing cancelled by user');
      }
      
      // Only log on first attempt or after retries
      if (attempt === 0) {
        console.log('Sending request to Claude API');
      } else {
        console.log(`Retry attempt ${attempt+1}/${maxRetries} for Claude API request`);
      }
      
      // Call Claude API with CORS header
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeApiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'yes' // Required CORS header
        },
        body: JSON.stringify({
          model: 'claude-3-7-sonnet-20250219',
          max_tokens: 4000,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        })
      });
      
      // Check if cancelled after API call
      if (isCancelled) {
        throw new Error('Processing cancelled by user');
      }
      
      console.log('Claude API response status:', response.status);
      
      // Handle overloaded errors (retry)
      if (response.status === 529) {
        const errorData = await response.text();
        console.log(`Claude API overloaded (attempt ${attempt+1}/${maxRetries}):`, errorData);
        lastError = new Error(`Claude API overloaded (status 529)`);
        
        // Wait before retrying, unless this is the last attempt
        if (attempt < maxRetries - 1) {
          const waitTime = retryDelay * (attempt + 1); // Exponential backoff
          console.log(`Waiting ${waitTime}ms before retry...`);
          await sleep(waitTime);
          continue; // Try again
        }
      }
      
      // Handle other errors (don't retry)
      if (!response.ok) {
        const errorData = await response.text();
        console.error('Claude API error:', errorData);
        throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('Claude API response received');
      
      // Extract JSON from Claude's response
      const content = data.content;
      
      if (!content || !content[0] || !content[0].text) {
        throw new Error('Invalid response from Claude API');
      }
      
      const responseText = content[0].text;
      
      // Try to extract JSON from the response
      let recipeJson = extractJsonFromText(responseText);
      
      if (!recipeJson) {
        throw new Error('Could not parse recipe data from Claude response');
      }
      
      console.log('Successfully extracted recipe data:', recipeJson);
      return recipeJson;
      
    } catch (error) {
      // Save the error to throw if all retries fail
      lastError = error;
      
      // If it's not a 529 error or it's the last retry, don't try again
      if (error.message && !error.message.includes('overloaded') && !error.message.includes('529')) {
        break;
      }
      
      // Wait before retrying, unless this is the last attempt
      if (attempt < maxRetries - 1) {
        const waitTime = retryDelay * (attempt + 1); // Exponential backoff
        console.log(`Waiting ${waitTime}ms before retry...`);
        await sleep(waitTime);
      }
    }
  }
  
  // If we got here, all retries failed
  console.error('Error extracting recipe with Claude after all retries:', lastError);
  throw lastError || new Error('Failed to extract recipe data after multiple attempts');
}

// Helper function to simplify HTML to reduce token usage
function simplifyHtml(html) {
  // This is a very basic implementation - could be improved with proper HTML parsing
  let simplified = html;
  
  // Remove scripts, styles, and comments
  simplified = simplified.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  simplified = simplified.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  simplified = simplified.replace(/<!--[\s\S]*?-->/g, '');
  
  // Remove common nav, header, footer, and sidebar elements
  simplified = simplified.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '');
  simplified = simplified.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '');
  simplified = simplified.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '');
  simplified = simplified.replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, '');
  
  // Remove all attributes except for src and alt on images
  simplified = simplified.replace(/<img\s+[^>]*?src\s*=\s*['"]([^'"]+)['"][^>]*?alt\s*=\s*['"]([^'"]+)['"][^>]*?>/gi, '<img src="$1" alt="$2">');
  simplified = simplified.replace(/<img\s+[^>]*?alt\s*=\s*['"]([^'"]+)['"][^>]*?src\s*=\s*['"]([^'"]+)['"][^>]*?>/gi, '<img src="$2" alt="$1">');
  
  // Limit the length to avoid token limit issues
  if (simplified.length > 100000) {
    simplified = simplified.substring(0, 100000);
  }
  
  return simplified;
}

// Helper function to extract JSON from text
function extractJsonFromText(text) {
  // Try to find JSON object in the response
  try {
    // First attempt: try to parse the entire response as JSON
    const parsed = JSON.parse(text);
    return convertToNewFormat(parsed);
  } catch (e) {
    console.log('Could not parse entire text as JSON, trying to extract JSON block');
    
    try {
      // Second attempt: look for JSON between backticks or triple backticks
      const jsonMatches = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || 
                          text.match(/`(\{[\s\S]*?\})`/);
      
      if (jsonMatches && jsonMatches[1]) {
        const parsed = JSON.parse(jsonMatches[1]);
        return convertToNewFormat(parsed);
      }
    } catch (e2) {
      console.log('Could not extract JSON from code blocks');
    }
    
    try {
      // Third attempt: look for anything that looks like a JSON object
      const jsonPattern = /(\{[\s\S]*\})/g;
      const jsonMatches = text.match(jsonPattern);
      
      if (jsonMatches) {
        for (const potentialJson of jsonMatches) {
          try {
            const parsed = JSON.parse(potentialJson);
            // Make sure it's the recipe object by checking for required fields
            if (parsed && typeof parsed === 'object' && parsed.name && 
                (parsed.ingredients || parsed.directions || parsed.instructions)) {
              return convertToNewFormat(parsed);
            }
          } catch (e) {
            // Continue to the next match
          }
        }
      }
    } catch (e3) {
      console.log('Could not extract JSON using pattern matching');
    }
  }
  
  return null;
}

// Helper function to convert legacy format to new format
function convertToNewFormat(parsed) {
  if (!parsed) return null;
  
  // Create a copy to avoid modifying the original
  const result = {...parsed};
  
  // Handle the rename from 'instructions' to 'directions' if needed
  if (result.instructions && !result.directions) {
    result.directions = result.instructions;
    delete result.instructions;
  }
  
  // Convert ingredients to new format if they're in the old format (array of strings)
  if (Array.isArray(result.ingredients) && result.ingredients.length > 0) {
    if (typeof result.ingredients[0] === 'string') {
      console.log('Converting ingredients from strings to objects with isHeader');
      result.ingredients = result.ingredients.map(item => ({
        text: item,
        isHeader: false // Default all to non-headers since we can't detect reliably
      }));
    }
  }
  
  // Convert directions to new format if they're in the old format (array of strings)
  if (Array.isArray(result.directions) && result.directions.length > 0) {
    if (typeof result.directions[0] === 'string') {
      console.log('Converting directions from strings to objects with isHeader');
      result.directions = result.directions.map(item => ({
        text: item,
        isHeader: false // Default all to non-headers since we can't detect reliably
      }));
    }
  }
  
  return result;
}

// Import recipe to Notion
async function importToNotion(recipeJson) {
  console.log('Importing recipe to Notion:', recipeJson);
  
  // Get Notion API credentials from storage
  const { notionToken, notionDatabaseId } = await chrome.storage.sync.get(['notionToken', 'notionDatabaseId']);
  
  if (!notionToken || !notionDatabaseId) {
    throw new Error('Notion API credentials not configured');
  }
  
  try {
    // First, check if we need to get available cuisine options from cache
    let cuisineOptions = await getCuisineOptionsFromCache();
    
    // If no cached options, fetch from Notion
    if (!cuisineOptions || cuisineOptions.length === 0) {
      console.log('No cached cuisine options, fetching from Notion');
      cuisineOptions = await fetchCuisineOptionsFromNotion(notionToken, notionDatabaseId);
      
      // Cache the options for future use
      await chrome.storage.local.set({ 
        cuisineOptionsCache: cuisineOptions,
        cuisineOptionsCacheTime: Date.now()
      });
    }
    
    // Check if cancelled
    if (isCancelled) {
      throw new Error('Processing cancelled by user');
    }
    
    // Find best matching cuisine option if one was extracted
    let cuisineValue = null;
    if (recipeJson.cuisine && cuisineOptions.length > 0) {
      cuisineValue = findBestMatchingCuisine(recipeJson.cuisine, cuisineOptions);
    }
    
    console.log('Creating page in Notion database');
    
    // Get database schema first to see available properties
    const dbResponse = await fetch(`https://api.notion.com/v1/databases/${notionDatabaseId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28'
      }
    });
    
    if (!dbResponse.ok) {
      throw new Error(`Failed to fetch database schema: ${dbResponse.status}`);
    }
    
    const dbData = await dbResponse.json();
    const dbProperties = dbData.properties || {};
    
    console.log('Available properties in Notion database:', Object.keys(dbProperties));
    
    // Start with the title/name property which is required
    let properties = {};
    
    // Find the title property (could be named anything)
    const titlePropName = Object.keys(dbProperties).find(key => dbProperties[key].type === 'title');
    
    if (!titlePropName) {
      throw new Error('No title property found in the database');
    }
    
    properties[titlePropName] = {
      "title": [
        {
          "text": {
            "content": recipeJson.name || "Untitled Recipe"
          }
        }
      ]
    };
    
    // Map of recipe data fields to possible property names in Notion
    // Only keeping URL as requested
    const propertyMappings = {
      "url": ["url", "source", "website", "link", "recipe url", "source url"]
    };
    
    // Add optional properties if they exist in the database
    for (const [recipeField, possibleNames] of Object.entries(propertyMappings)) {
      // Find if any of the possible property names exist in the database
      const matchingPropName = Object.keys(dbProperties).find(propName => 
        possibleNames.includes(propName.toLowerCase())
      );
      
      if (matchingPropName && recipeJson[recipeField]) {
        const propType = dbProperties[matchingPropName].type;
        
        if (propType === 'number' && typeof recipeJson[recipeField] === 'number') {
          properties[matchingPropName] = { "number": recipeJson[recipeField] };
        } else if (propType === 'url' && recipeField === 'url') {
          properties[matchingPropName] = { "url": recipeJson[recipeField] };
        } else if (propType === 'rich_text' || propType === 'text') {
          properties[matchingPropName] = {
            "rich_text": [
              {
                "text": {
                  "content": String(recipeJson[recipeField]) || ""
                }
              }
            ]
          };
        }
      }
    }
    
    // Add cuisine if we have a value and there's a corresponding property
    if (cuisineValue) {
      // Get the stored cuisine property name if available
      const { cuisinePropertyName } = await chrome.storage.local.get(['cuisinePropertyName']);
      
      let cuisinePropName = cuisinePropertyName;
      
      // If no stored property name, try to find it
      if (!cuisinePropName) {
        // Look for a multi_select property with cuisine-related name
        cuisinePropName = Object.keys(dbProperties).find(propName => 
          dbProperties[propName].type === 'multi_select' && (
            propName.toLowerCase() === 'cuisine' || 
            propName.toLowerCase().includes('cuisine') || 
            propName.toLowerCase().includes('category') ||
            propName.toLowerCase() === 'type'
          )
        );
        
        // If still not found, look for any multi_select property
        if (!cuisinePropName) {
          cuisinePropName = Object.keys(dbProperties).find(propName => 
            dbProperties[propName].type === 'multi_select'
          );
        }
      }
      
      if (cuisinePropName && dbProperties[cuisinePropName] && dbProperties[cuisinePropName].type === 'multi_select') {
        console.log(`Adding cuisine "${cuisineValue}" to multi_select property "${cuisinePropName}"`);
        
        properties[cuisinePropName] = {
          "multi_select": [
            {
              "name": cuisineValue
            }
          ]
        };
      } else {
        console.log(`No suitable multi_select property found for cuisine value "${cuisineValue}"`);
      }
    } else {
      console.log('No cuisine value to add to Notion');
    }
    
    // Create the page content with ingredients and instructions
    let content = [];
    
    // Add image if available
    if (recipeJson.imageUrl) {
      content.push({
        "object": "block",
        "type": "image",
        "image": {
          "type": "external",
          "external": {
            "url": recipeJson.imageUrl
          }
        }
      });
    }
    
    // Add ingredients heading
    content.push({
      "object": "block",
      "type": "heading_2",
      "heading_2": {
        "rich_text": [{ "type": "text", "text": { "content": "Ingredients" } }]
      }
    });
    
    // Add ingredients as bulleted list
    if (recipeJson.ingredients && recipeJson.ingredients.length > 0) {
      for (const ingredient of recipeJson.ingredients) {
        // Check if this is a header (indicated by isHeader property)
        if (ingredient.isHeader) {
          // Add section header as paragraph with bold text
          content.push({
            "object": "block",
            "type": "paragraph",
            "paragraph": {
              "rich_text": [{ 
                "type": "text", 
                "text": { "content": ingredient.text },
                "annotations": { "bold": true }
              }]
            }
          });
        } else {
          // Regular ingredient as bulleted list item
          content.push({
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {
              "rich_text": [{ 
                "type": "text", 
                "text": { "content": typeof ingredient === 'string' ? ingredient : ingredient.text }
              }]
            }
          });
        }
      }
    }
    
    // Add instructions heading
    content.push({
      "object": "block",
      "type": "heading_2",
      "heading_2": {
        "rich_text": [{ "type": "text", "text": { "content": "Instructions" } }]
      }
    });
    
    // Add directions as numbered list
    const directionsToUse = recipeJson.directions && recipeJson.directions.length > 0 
      ? recipeJson.directions 
      : (recipeJson.instructions && recipeJson.instructions.length > 0 ? recipeJson.instructions : []);
    
    if (directionsToUse.length > 0) {
      for (const direction of directionsToUse) {
        // Check if this is a header (indicated by isHeader property)
        if (direction.isHeader) {
          // Add section header as paragraph with bold text
          content.push({
            "object": "block",
            "type": "paragraph",
            "paragraph": {
              "rich_text": [{ 
                "type": "text", 
                "text": { "content": direction.text },
                "annotations": { "bold": true }
              }]
            }
          });
        } else {
          // Regular direction as numbered list item
          content.push({
            "object": "block",
            "type": "numbered_list_item",
            "numbered_list_item": {
              "rich_text": [{ 
                "type": "text", 
                "text": { "content": typeof direction === 'string' ? direction : direction.text }
              }]
            }
          });
        }
      }
    }
    
    // Check if cancelled before making API call
    if (isCancelled) {
      throw new Error('Processing cancelled by user');
    }
    
    // Call Notion API to create the page
    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        "parent": { "database_id": notionDatabaseId },
        "properties": properties,
        "children": content
      })
    });
    
    // Check if cancelled after API call
    if (isCancelled) {
      throw new Error('Processing cancelled by user');
    }
    
    if (!response.ok) {
      const errorData = await response.text();
      console.error('Notion API error:', errorData);
      throw new Error(`Notion API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Successfully created page in Notion:', data);
    
    return { 
      success: true, 
      pageId: data.id,
      pageUrl: data.url
    };
    
  } catch (error) {
    console.error('Error importing to Notion:', error);
    throw error;
  }
}

// Helper function to get cuisine options from cache
async function getCuisineOptionsFromCache() {
  const { cuisineOptionsCache, cuisineOptionsCacheTime } = await chrome.storage.local.get(['cuisineOptionsCache', 'cuisineOptionsCacheTime']);
  
  // If we have cached options and they're less than 1 day old, use them
  if (cuisineOptionsCache && cuisineOptionsCacheTime) {
    const cacheAge = Date.now() - cuisineOptionsCacheTime;
    const oneDayInMs = 24 * 60 * 60 * 1000;
    
    if (cacheAge < oneDayInMs) {
      console.log('Using cached cuisine options:', cuisineOptionsCache);
      return cuisineOptionsCache;
    } else {
      console.log('Cached cuisine options expired, fetching new ones');
    }
  } else {
    console.log('No cached cuisine options found');
  }
  
  return null;
}

// Helper function to fetch cuisine options from Notion
async function fetchCuisineOptionsFromNotion(notionToken, databaseId) {
  console.log('Fetching cuisine options from Notion database');
  
  try {
    // First, get the database to see its properties
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch database: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Look for multi_select properties that might contain cuisine/category options
    let cuisineOptions = [];
    let cuisinePropName = null;
    
    if (data.properties) {
      console.log('Available database properties:', Object.keys(data.properties));
      console.log('Database property types:', Object.fromEntries(
        Object.entries(data.properties).map(([key, value]) => [key, value.type])
      ));
      
      // First, look for multi_select properties with cuisine or category in the name
      for (const [propName, propValue] of Object.entries(data.properties)) {
        // Check if it's a multi_select property with "cuisine" or "category" in the name
        if (propValue.type === 'multi_select' && 
            (propName.toLowerCase() === 'cuisine' || 
             propName.toLowerCase().includes('cuisine') || 
             propName.toLowerCase().includes('category') ||
             propName.toLowerCase() === 'type')) {
          
          cuisinePropName = propName;
          
          if (propValue.multi_select && propValue.multi_select.options) {
            cuisineOptions = propValue.multi_select.options.map(option => option.name);
            console.log(`Found ${cuisineOptions.length} cuisine options in multi_select property "${propName}":`, cuisineOptions);
            break;
          }
        }
      }
      
      // If no cuisine-like property was found, look for any multi_select property
      if (cuisineOptions.length === 0) {
        for (const [propName, propValue] of Object.entries(data.properties)) {
          if (propValue.type === 'multi_select' && propValue.multi_select && propValue.multi_select.options) {
            cuisinePropName = propName;
            cuisineOptions = propValue.multi_select.options.map(option => option.name);
            console.log(`No cuisine property found, using multi_select property "${propName}" with ${cuisineOptions.length} options:`, cuisineOptions);
            break;
          }
        }
      }
    }
    
    // Store the cuisine property name for future use
    if (cuisinePropName) {
      console.log(`Storing cuisine property name: "${cuisinePropName}"`);
      await chrome.storage.local.set({ cuisinePropertyName: cuisinePropName });
    } else {
      console.log('No suitable multi_select property found in Notion database');
    }
    
    // If no options were found, use default values
    if (cuisineOptions.length === 0) {
      console.log('No cuisine options found in Notion, using default values');
      cuisineOptions = [
        "Chinese", "Mexican", "African", "Thai", "Korean", "Indian", "Filipino", 
        "Mediterranean", "Caribbean", "Soups", "Brunch", "American", "Hawaiian", 
        "South America", "Italian", "Japanese"
      ];
    }
    
    return cuisineOptions;
    
  } catch (error) {
    console.error('Error fetching cuisine options:', error);
    // Return default values as fallback
    return [
      "Chinese", "Mexican", "African", "Thai", "Korean", "Indian", "Filipino", 
      "Mediterranean", "Caribbean", "Soups", "Brunch", "American", "Hawaiian", 
      "South America", "Italian", "Japanese"
    ];
  }
}

// Helper function to find best matching cuisine from available options
function findBestMatchingCuisine(extractedCuisine, availableOptions) {
  if (!extractedCuisine || !availableOptions || availableOptions.length === 0) {
    return null;
  }
  
  console.log('Finding best match for cuisine:', extractedCuisine, 'from options:', availableOptions);
  
  // Convert to lowercase for comparison
  const normalizedInput = extractedCuisine.toLowerCase().trim();
  
  // First try exact match
  for (const option of availableOptions) {
    if (option.toLowerCase() === normalizedInput) {
      console.log('Found exact match for cuisine:', option);
      return option;
    }
  }
  
  // Then try contains match
  for (const option of availableOptions) {
    if (option.toLowerCase().includes(normalizedInput) || 
        normalizedInput.includes(option.toLowerCase())) {
      console.log('Found partial match for cuisine:', option);
      return option;
    }
  }
  
  // If no match was found, but the extracted cuisine looks reasonable and we want to add it
  // to the database, return it directly (will be added as a new option)
  if (extractedCuisine && extractedCuisine.trim().length > 0) {
    console.log('No match found, using extracted cuisine directly:', extractedCuisine);
    return extractedCuisine;
  }
  
  // No match found and no valid cuisine to use
  console.log('No match found and no valid cuisine to use');
  return null;
}

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message.action, 'from', sender.id || 'unknown');
  
  if (message.action === 'contentScriptLoaded' && sender.tab) {
    console.log('Content script loaded in tab:', sender.tab.id);
    sendResponse({status: 'acknowledged'});
  } else if (message.action === 'processRecipe') {
    // Reset cancellation flag when starting a new process
    isCancelled = false;
    
    const tabId = sender.tab ? sender.tab.id : null;
    console.log('Processing recipe from', sender.tab ? `tab: ${tabId}` : 'popup');
    console.log('Recipe data size:', message.data ? JSON.stringify(message.data).length : 'no data');
    
    // Send immediate response
    sendResponse({status: 'processing'});
    
    // Start processing
    processRecipe(message.data, tabId);
  } else if (message.action === 'cancelProcessing') {
    console.log('Cancelling recipe processing');
    isCancelled = true;
    
    // Clear the processing state
    chrome.storage.local.remove(['processingRecipe', 'processingStartTime'], () => {
      console.log('Processing state cleared due to cancellation');
      
      // Show notification for canceled operation
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('images/icon128.png'),
        title: 'Recipe Import Canceled',
        message: 'Recipe import was canceled',
        priority: 1
      });
    });
  }
  
  // Return true to indicate we will send a response asynchronously
  return true;
});