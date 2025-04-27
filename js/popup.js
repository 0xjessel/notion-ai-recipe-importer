document.addEventListener('DOMContentLoaded', () => {
  const importButton = document.getElementById('importButton');
  const statusElement = document.getElementById('status');
  
  // Add cancel button to the DOM if it doesn't exist
  let cancelButton = document.getElementById('cancelButton');
  if (!cancelButton) {
    cancelButton = document.createElement('button');
    cancelButton.id = 'cancelButton';
    cancelButton.textContent = 'Cancel Import';
    cancelButton.className = 'cancel-button';
    cancelButton.style.display = 'none'; // Hide by default
    importButton.parentNode.insertBefore(cancelButton, importButton.nextSibling);
  }

  // Add reset button for debugging
  let resetButton = document.getElementById('resetButton');
  if (!resetButton) {
    resetButton = document.createElement('button');
    resetButton.id = 'resetButton';
    resetButton.textContent = 'Reset State';
    resetButton.className = 'reset-button';
    resetButton.style.display = 'none'; // Hide by default
    resetButton.style.marginTop = '10px';
    resetButton.style.fontSize = '12px';
    importButton.parentNode.appendChild(resetButton);
    
    // Show reset button on triple click of status text
    statusElement.addEventListener('click', (function() {
      let clickCount = 0;
      let clickTimer = null;
      
      return function() {
        clickCount++;
        if (clickCount === 1) {
          clickTimer = setTimeout(() => {
            clickCount = 0;
          }, 400);
        } else if (clickCount === 3) {
          resetButton.style.display = 'block';
          clearTimeout(clickTimer);
          clickCount = 0;
        }
      };
    })());
  }
  
  // Function to reset the processing state
  function resetProcessingState() {
    chrome.storage.local.remove(['processingRecipe', 'processingStartTime'], () => {
      console.log('Processing state reset');
      if (cancelButton) {
        cancelButton.style.display = 'none';
      }
    });
  }
  
  // Check for processing status first (if popup was reopened during processing)
  chrome.storage.local.get(['processingRecipe', 'processingStartTime', 'lastImportStatus', 'lastImportError', 'lastImportTime'], (localData) => {
    if (localData.processingRecipe === true) {
      // Check if processing has been going on too long (5 minutes) - might be stuck
      const maxProcessingTime = 5 * 60 * 1000; // 5 minutes
      const processingTime = localData.processingStartTime ? Date.now() - localData.processingStartTime : 0;
      
      if (processingTime > maxProcessingTime) {
        // Processing seems stuck, allow reset
        statusElement.textContent = 'Previous import may be stuck. Try again?';
        statusElement.classList.add('warning');
        importButton.disabled = false;
        resetProcessingState();
      } else {
        // Normal processing, show cancel button
        importButton.disabled = true;
        statusElement.textContent = 'Recipe import in progress...';
        cancelButton.style.display = 'block';
      }
      return;
    }
    
    // Check for previous import result
    if (localData.lastImportStatus === 'success' && localData.lastImportTime) {
      const importTime = new Date(localData.lastImportTime);
      const timeAgo = Math.round((new Date() - importTime) / 1000 / 60); // minutes
      
      if (timeAgo < 5) { // Only show if it happened in the last 5 minutes
        statusElement.textContent = `Recipe imported successfully! (${timeAgo}m ago)`;
        statusElement.classList.add('success');
        
        // Clear the status after showing it once
        chrome.storage.local.remove(['lastImportStatus', 'lastImportTime']);
      }
    } else if (localData.lastImportStatus === 'error' && localData.lastImportError) {
      statusElement.textContent = localData.lastImportError;
      statusElement.classList.add('error');
      
      // Clear the status after showing it once
      chrome.storage.local.remove(['lastImportStatus', 'lastImportError', 'lastImportTime']);
    }
  });

  // Check if we have the required credentials
  chrome.storage.sync.get(['claudeApiKey', 'notionToken', 'notionDatabaseId'], (result) => {
    if (!result.claudeApiKey || !result.notionToken || !result.notionDatabaseId) {
      importButton.disabled = true;
      statusElement.textContent = 'Please configure settings first';
      statusElement.classList.add('error');
      return;
    }
    
    // Set up cancel button event listener
    cancelButton.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'cancelProcessing' });
      statusElement.textContent = 'Import cancelled';
      statusElement.classList.add('warning');
      importButton.disabled = false;
      cancelButton.style.display = 'none';
      resetProcessingState();
    });
    
    // Set up reset button event listener
    resetButton.addEventListener('click', () => {
      resetProcessingState();
      statusElement.textContent = 'State reset. You can try again.';
      statusElement.classList.remove('error', 'success', 'warning');
      statusElement.classList.add('info');
      importButton.disabled = false;
      resetButton.style.display = 'none';
    });
    
    // Set up message listener for background script responses
    chrome.runtime.onMessage.addListener(function messageListener(message) {
      console.log('Popup received message:', message);
      
      if (message.action === 'processingUpdate') {
        // Update the status display
        statusElement.textContent = message.message || 'Processing...';
        
        // Handle different statuses
        if (message.status === 'complete') {
          statusElement.classList.add('success');
          statusElement.classList.remove('error', 'warning');
          importButton.disabled = false;
          cancelButton.style.display = 'none';
          resetProcessingState();
        } else if (message.status === 'error') {
          statusElement.classList.add('error');
          statusElement.classList.remove('success', 'warning');
          importButton.disabled = false;
          cancelButton.style.display = 'none';
          resetProcessingState();
        } else if (message.status === 'extracting' || message.status === 'importing') {
          // Processing in progress, ensure cancel button is visible
          cancelButton.style.display = 'block';
        }
      } else if (message.action === 'importComplete') {
        statusElement.textContent = 'Recipe imported successfully!';
        statusElement.classList.add('success');
        statusElement.classList.remove('error', 'warning');
        importButton.disabled = false;
        cancelButton.style.display = 'none';
        resetProcessingState();
      } else if (message.action === 'importError') {
        statusElement.textContent = message.error || 'An error occurred';
        statusElement.classList.add('error');
        statusElement.classList.remove('success', 'warning');
        importButton.disabled = false;
        cancelButton.style.display = 'none';
        resetProcessingState();
      } else if (message.action === 'importProgress') {
        statusElement.textContent = message.status || 'Processing...';
      }
    });

    // Add click handler for import button
    importButton.addEventListener('click', async () => {
      console.log('Import button clicked');
      importButton.disabled = true;
      statusElement.textContent = 'Importing recipe...';
      statusElement.classList.remove('success', 'error', 'warning', 'info');

      try {
        // Get current active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab) {
          throw new Error("Cannot access current tab");
        }
        console.log('Active tab URL:', tab.url);
        // Check if this is a YouTube video URL
        const youtubeRegex = /^https:\/\/(www\.)?youtube\.com\/watch\?v=[^&]+/;
        // Check if this is an Instagram post URL
        const instagramRegex = /^https:\/\/(www\.)?instagram\.com\/p\//;
        if (youtubeRegex.test(tab.url)) {
          console.log('Detected YouTube video URL, running YouTube code path');
          statusElement.textContent = 'Detected YouTube video. Scraping transcript and description...';
          // Use chrome.scripting to inject a YouTube-specific scraping function
          chrome.scripting.executeScript(
            {
              target: { tabId: tab.id },
              func: async function youtubeScrape() {
                // Debug: log start
                console.log('[YouTube Scraper] Running in page context');
                // Get video title
                let title = document.title;
                // Get description from meta tag or description box
                let description = '';
                const metaDesc = document.querySelector('meta[name="description"]');
                if (metaDesc) description = metaDesc.content;
                // Try to get description from the page (if expanded)
                const descBox = document.querySelector('#description yt-formatted-string');
                if (descBox && descBox.textContent) description = descBox.textContent;
                // Get thumbnail from meta tag only (revert to og:image method)
                let thumbnail = '';
                const metaThumb = document.querySelector('meta[property="og:image"]');
                if (metaThumb) thumbnail = metaThumb.content;
                // --- Transcript scraping logic ---
                let transcript = '';
                try {
                  // Helper to wait for a selector
                  async function waitForSelector(selector, timeout = 8000) {
                    return new Promise((resolve, reject) => {
                      const interval = 100;
                      let waited = 0;
                      const check = () => {
                        const el = document.querySelector(selector);
                        if (el) return resolve(el);
                        waited += interval;
                        if (waited >= timeout) return reject('Timeout waiting for ' + selector);
                        setTimeout(check, interval);
                      };
                      check();
                    });
                  }
                  // Check if transcript is already open
                  let transcriptSegments = document.querySelectorAll('ytd-transcript-segment-renderer');
                  if (!transcriptSegments.length) {
                    // Look for the Show transcript button inside the description area
                    let showTranscriptBtn = Array.from(document.querySelectorAll('ytd-text-inline-expander a, ytd-text-inline-expander button, #description a, #description button')).find(
                      el => el.textContent.trim().toLowerCase() === 'show transcript'
                    );
                    if (showTranscriptBtn) {
                      showTranscriptBtn.click();
                      // Wait for transcript panel to appear
                      await waitForSelector('ytd-transcript-segment-renderer');
                      // Give a little extra time for all segments to load
                      await new Promise(res => setTimeout(res, 500));
                    }
                  }
                  // After attempting to open, try to get transcript segments again
                  transcriptSegments = document.querySelectorAll('ytd-transcript-segment-renderer');
                  if (transcriptSegments.length > 0) {
                    // Remove timestamps from each segment
                    let cleanedSegments = Array.from(transcriptSegments).map(el => {
                      // Remove leading timestamp (e.g., 0:00, 12:34, 1:23:45)
                      let text = el.innerText.replace(/^	*\d{1,2}:\d{2}(?::\d{2})?\s*/g, '');
                      // Also remove timestamps at the end if present
                      text = text.replace(/\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/, '');
                      return text;
                    });
                    transcript = cleanedSegments.join('\n');
                  }
                } catch (err) {
                  // Only log errors if transcript scraping fails
                  console.log('[YouTube Scraper] Error while scraping transcript:', err);
                }
                // Return all scraped data
                return {
                  url: window.location.href,
                  title,
                  description,
                  thumbnail,
                  transcript
                };
              }
            },
            (results) => {
              console.log('[YouTube Scraper] Script execution results:', results);
              if (chrome.runtime.lastError) {
                console.error('[YouTube Scraper] Script execution error:', chrome.runtime.lastError);
                statusElement.textContent = 'Failed to scrape YouTube page.';
                statusElement.classList.add('error');
                importButton.disabled = false;
                return;
              }
              if (results && results[0] && results[0].result) {
                statusElement.textContent = 'Processing YouTube data...';
                chrome.storage.local.set({
                  'processingRecipe': true,
                  'processingStartTime': Date.now()
                }, () => {
                  cancelButton.style.display = 'block';
                  console.log('[YouTube Scraper] Sending YouTube data to background script:', {
                    action: 'processYouTubeRecipe',
                    data: results[0].result
                  });
                  chrome.runtime.sendMessage({
                    action: 'processYouTubeRecipe',
                    data: results[0].result
                  }, response => {
                    if (chrome.runtime.lastError) {
                      console.error('[YouTube Scraper] Error sending message to background:', chrome.runtime.lastError);
                    } else if (response) {
                      console.log('[YouTube Scraper] Background script response:', response);
                    } else {
                      console.log('[YouTube Scraper] Message sent to background, no response');
                    }
                  });
                });
              } else {
                statusElement.textContent = 'Failed to extract YouTube data.';
                statusElement.classList.add('error');
                importButton.disabled = false;
              }
            }
          );
        } else if (instagramRegex.test(tab.url)) {
          console.log('Detected Instagram post URL, running Instagram code path');
          statusElement.textContent = 'Detected Instagram post. Scraping post text...';
          chrome.scripting.executeScript(
            {
              target: { tabId: tab.id },
              func: function instagramScrape() {
                // Use meta/og tags for caption and image
                function extractMetaOgTags(html) {
                  if (!html || typeof html !== 'string') return {};
                  const doc = new DOMParser().parseFromString(html, 'text/html');
                  const getMeta = (name) => {
                    const el = doc.querySelector(`meta[name='${name}']`);
                    return el ? el.content : '';
                  };
                  const getOg = (property) => {
                    const el = doc.querySelector(`meta[property='og:${property}']`);
                    return el ? el.content : '';
                  };
                  return {
                    metaDescription: getMeta('description'),
                    ogTitle: getOg('title'),
                    ogDescription: getOg('description'),
                    ogImage: getOg('image'),
                  };
                }
                const html = document.documentElement.outerHTML;
                const metaOg = extractMetaOgTags(html);
                return {
                  url: window.location.href,
                  caption: metaOg.ogDescription || '',
                  imageUrl: metaOg.ogImage || ''
                };
              }
            },
            (results) => {
              console.log('[Instagram Scraper] Script execution results:', results);
              if (chrome.runtime.lastError) {
                console.error('[Instagram Scraper] Script execution error:', chrome.runtime.lastError);
                statusElement.textContent = 'Failed to scrape Instagram post.';
                statusElement.classList.add('error');
                importButton.disabled = false;
                return;
              }
              if (results && results[0] && results[0].result) {
                statusElement.textContent = 'Processing Instagram post...';
                chrome.storage.local.set({
                  'processingRecipe': true,
                  'processingStartTime': Date.now()
                }, () => {
                  cancelButton.style.display = 'block';
                  console.log('[Instagram Scraper] Sending Instagram data to background script:', {
                    action: 'processInstagramRecipe',
                    data: results[0].result
                  });
                  chrome.runtime.sendMessage({
                    action: 'processInstagramRecipe',
                    data: results[0].result
                  }, response => {
                    if (chrome.runtime.lastError) {
                      console.error('[Instagram Scraper] Error sending message to background:', chrome.runtime.lastError);
                    } else if (response) {
                      console.log('[Instagram Scraper] Background script response:', response);
                    } else {
                      console.log('[Instagram Scraper] Message sent to background, no response');
                    }
                  });
                });
              } else {
                statusElement.textContent = 'Failed to extract Instagram post.';
                statusElement.classList.add('error');
                importButton.disabled = false;
              }
            }
          );
        } else {
          // Normal code path for non-YouTube and non-Instagram URLs
          console.log('Non-YouTube and non-Instagram URL, running normal code path');
          chrome.scripting.executeScript(
            {
              target: { tabId: tab.id },
              func: function() {
                return {
                  url: window.location.href,
                  html: document.documentElement.outerHTML
                };
              }
            },
            (results) => {
              console.log('Script execution results:', results);
              if (chrome.runtime.lastError) {
                console.error('Script execution error:', chrome.runtime.lastError);
                statusElement.textContent = 'Cannot access this page content. Try a recipe website.';
                statusElement.classList.add('error');
                importButton.disabled = false;
                return;
              }
              if (results && results[0] && results[0].result) {
                statusElement.textContent = 'Processing... Please wait';
                chrome.storage.local.set({
                  'processingRecipe': true,
                  'processingStartTime': Date.now()
                }, () => {
                  cancelButton.style.display = 'block';
                  console.log('Sending data to background script:', {
                    action: 'processRecipe',
                    dataSize: JSON.stringify(results[0].result).length
                  });
                  chrome.runtime.sendMessage({
                    action: 'processRecipe',
                    data: results[0].result
                  }, response => {
                    if (chrome.runtime.lastError) {
                      console.error('Error sending message to background:', chrome.runtime.lastError);
                    } else if (response) {
                      console.log('Background script response:', response);
                    } else {
                      console.log('Message sent to background, no response');
                    }
                  });
                });
              } else {
                statusElement.textContent = 'Failed to extract page content.';
                statusElement.classList.add('error');
                importButton.disabled = false;
              }
            }
          );
        }
      } catch (err) {
        console.error('Error in click handler:', err);
        statusElement.textContent = err.message || 'An error occurred';
        statusElement.classList.add('error');
        importButton.disabled = false;
      }
    });
  });
});