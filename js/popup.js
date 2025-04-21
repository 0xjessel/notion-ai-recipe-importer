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
        
        console.log('Executing script in tab:', tab.id);
        
        // Use chrome.scripting API to extract page content
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
              // We have the data, send it directly to background script
              statusElement.textContent = 'Processing... Please wait';
              
              // Start processing and store that we've initiated the process with timestamp
              chrome.storage.local.set({ 
                'processingRecipe': true,
                'processingStartTime': Date.now()
              }, () => {
                // Show cancel button
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
      } catch (err) {
        console.error('Error in click handler:', err);
        statusElement.textContent = err.message || 'An error occurred';
        statusElement.classList.add('error');
        importButton.disabled = false;
      }
    });
  });
});