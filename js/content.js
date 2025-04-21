// Notify the background script that content script has been loaded
chrome.runtime.sendMessage({ action: 'contentScriptLoaded' });

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'importRecipe') {
    console.log('Recipe import requested');
    // Send response immediately to avoid connection issues
    sendResponse({ status: 'processing' });
    
    // Get the current URL and HTML content
    const url = window.location.href;
    const htmlContent = document.documentElement.outerHTML;
    
    // Send the data to the background script for processing
    chrome.runtime.sendMessage({
      action: 'processRecipe',
      data: {
        url: url,
        html: htmlContent
      }
    });
    
    return true; // Keep the message channel open for the async response
  }
});