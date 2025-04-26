document.addEventListener('DOMContentLoaded', () => {
  const settingsForm = document.getElementById('settingsForm');
  const claudeApiKeyInput = document.getElementById('claudeApiKey');
  const notionTokenInput = document.getElementById('notionToken');
  const notionDatabaseIdInput = document.getElementById('notionDatabaseId');
  const youtubeApiKeyInput = document.getElementById('youtubeApiKey');
  const claudeApiKeyFeedback = document.getElementById('claudeApiKeyFeedback');
  const notionTokenFeedback = document.getElementById('notionTokenFeedback');
  const notionDatabaseIdFeedback = document.getElementById('notionDatabaseIdFeedback');
  const youtubeApiKeyFeedback = document.getElementById('youtubeApiKeyFeedback');
  const testConnectionBtn = document.getElementById('testConnectionBtn');
  const statusElement = document.getElementById('status');
  const toggleButtons = document.querySelectorAll('.toggle-visibility');
  
  // Set up visibility toggle for all inputs
  toggleButtons.forEach(button => {
    button.addEventListener('click', (e) => {
      e.preventDefault(); // Prevent form submission
      const targetId = button.getAttribute('data-for');
      const targetInput = document.getElementById(targetId);
      if (targetInput.type === 'password') {
        targetInput.type = 'text';
        button.querySelector('.eye-icon').textContent = 'abc'; // Change to text indicator
      } else {
        targetInput.type = 'password';
        button.querySelector('.eye-icon').textContent = '•••'; // Change back to hidden indicator
      }
    });
  });

  // Load saved settings
  chrome.storage.sync.get(['claudeApiKey', 'notionToken', 'notionDatabaseId', 'youtubeApiKey'], (result) => {
    if (result.claudeApiKey) claudeApiKeyInput.value = result.claudeApiKey;
    if (result.notionToken) notionTokenInput.value = result.notionToken;
    if (result.notionDatabaseId) notionDatabaseIdInput.value = result.notionDatabaseId;
    if (result.youtubeApiKey) youtubeApiKeyInput.value = result.youtubeApiKey;
  });

  // Validate Claude API Key format
  claudeApiKeyInput.addEventListener('input', () => {
    const value = claudeApiKeyInput.value.trim();
    if (value && !value.startsWith('sk-ant-')) {
      claudeApiKeyInput.classList.add('invalid');
      claudeApiKeyFeedback.textContent = 'Claude API Key should start with "sk-ant-"';
    } else {
      claudeApiKeyInput.classList.remove('invalid');
      claudeApiKeyFeedback.textContent = '';
    }
  });

  // Validate Notion token format
  notionTokenInput.addEventListener('input', () => {
    const value = notionTokenInput.value.trim();
    if (value && !value.startsWith('secret_') && !value.startsWith('ntn_')) {
      notionTokenInput.classList.add('invalid');
      notionTokenFeedback.textContent = 'Notion token should start with "secret_" or "ntn_"';
    } else {
      notionTokenInput.classList.remove('invalid');
      notionTokenFeedback.textContent = '';
    }
  });

  // Validate Notion database ID format
  notionDatabaseIdInput.addEventListener('input', () => {
    const value = notionDatabaseIdInput.value.trim();
    // Accept both UUID format with hyphens and plain string of hex characters (32 chars)
    const hyphenatedUuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    const plainIdPattern = /^[a-f0-9]{32}$/i;
    
    if (value && !hyphenatedUuidPattern.test(value) && !plainIdPattern.test(value)) {
      notionDatabaseIdInput.classList.add('invalid');
      notionDatabaseIdFeedback.textContent = 'Invalid database ID format';
    } else {
      notionDatabaseIdInput.classList.remove('invalid');
      notionDatabaseIdFeedback.textContent = '';
    }
  });

  // Validate YouTube API Key format (basic check)
  youtubeApiKeyInput.addEventListener('input', () => {
    const value = youtubeApiKeyInput.value.trim();
    if (value && !value.startsWith('AIza')) { // Common prefix for Google API keys
      youtubeApiKeyInput.classList.add('invalid');
      youtubeApiKeyFeedback.textContent = 'YouTube API Key often starts with "AIza"';
    } else {
      youtubeApiKeyInput.classList.remove('invalid');
      youtubeApiKeyFeedback.textContent = '';
    }
  });

  // Save settings
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Get values
    const claudeApiKey = claudeApiKeyInput.value.trim();
    const notionToken = notionTokenInput.value.trim();
    const notionDatabaseId = notionDatabaseIdInput.value.trim();
    const youtubeApiKey = youtubeApiKeyInput.value.trim();
    
    // Basic validation
    let isValid = true;
    
    if (claudeApiKey && !claudeApiKey.startsWith('sk-ant-')) {
      claudeApiKeyInput.classList.add('invalid');
      claudeApiKeyFeedback.textContent = 'Claude API Key should start with "sk-ant-"';
      isValid = false;
    }
    
    if (notionToken && !notionToken.startsWith('secret_') && !notionToken.startsWith('ntn_')) {
      notionTokenInput.classList.add('invalid');
      notionTokenFeedback.textContent = 'Notion token should start with "secret_" or "ntn_"';
      isValid = false;
    }
    
    // Accept both UUID format with hyphens and plain string of hex characters (32 chars)
    const hyphenatedUuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    const plainIdPattern = /^[a-f0-9]{32}$/i;
    
    if (notionDatabaseId && !hyphenatedUuidPattern.test(notionDatabaseId) && !plainIdPattern.test(notionDatabaseId)) {
      notionDatabaseIdInput.classList.add('invalid');
      notionDatabaseIdFeedback.textContent = 'Invalid database ID format';
      isValid = false;
    }
    
    if (youtubeApiKey && !youtubeApiKey.startsWith('AIza')) {
      youtubeApiKeyInput.classList.add('invalid');
      youtubeApiKeyFeedback.textContent = 'YouTube API Key often starts with "AIza"';
    }
    
    if (!isValid) {
      showStatus('Please fix the required field errors before saving', 'error');
      return;
    }
    
    // Save to storage
    chrome.storage.sync.set({
      claudeApiKey,
      notionToken,
      notionDatabaseId,
      youtubeApiKey
    }, () => {
      showStatus('Settings saved successfully!', 'success');
    });
  });

  // Test connection
  testConnectionBtn.addEventListener('click', async () => {
    // Get values
    const claudeApiKey = claudeApiKeyInput.value.trim();
    const notionToken = notionTokenInput.value.trim();
    const notionDatabaseId = notionDatabaseIdInput.value.trim();
    const youtubeApiKey = youtubeApiKeyInput.value.trim();
    
    // Validate that all fields are filled
    if (!claudeApiKey || !notionToken || !notionDatabaseId) {
      showStatus('Please fill in Claude & Notion fields to test connection', 'error');
      return;
    }
    
    // Show testing status
    showStatus('Testing connection...', '');
    testConnectionBtn.disabled = true;
    
    let allTestsPassed = true;
    let failureMessage = '';
    
    try {
      showStatus('Testing Claude API...', '');
      await testClaudeApi(claudeApiKey);
      showStatus('Claude API OK. Testing Notion API...', '');
      await testNotionApi(notionToken, notionDatabaseId);
      
      // Test YouTube API only if key is provided
      if (youtubeApiKey) {
        showStatus('Notion API OK. Testing YouTube API...', '');
        await testYouTubeApi(youtubeApiKey);
        showStatus('All connections successful!', 'success');
      } else {
        showStatus('Claude & Notion connections successful! (YouTube key not provided)', 'success');
      }
      
    } catch (error) {
      allTestsPassed = false;
      failureMessage = error.message;
      showStatus(`Connection failed: ${failureMessage}`, 'error');
    } finally {
      testConnectionBtn.disabled = false;
    }
  });

  // Test Claude API connection
  async function testClaudeApi(apiKey) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 10,
          messages: [
            {
              role: "user",
              content: "Test connection. Respond with 'ok'."
            }
          ]
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Claude API error: ${errorData.error?.message || response.statusText}`);
      }
      
      return true;
    } catch (error) {
      throw new Error(`Claude API: ${error.message}`);
    }
  }

  // Test Notion API connection
  // Helper to format database ID with hyphens if needed
  function formatDatabaseId(id) {
    // If already has hyphens, return as is
    if (id.includes('-')) {
      return id;
    }
    
    // Format as UUID with hyphens (8-4-4-4-12)
    return id.replace(
      /^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/i,
      '$1-$2-$3-$4-$5'
    );
  }

  async function testNotionApi(token, databaseId) {
    try {
      // Format database ID properly
      const formattedId = formatDatabaseId(databaseId);
      
      const response = await fetch(`https://api.notion.com/v1/databases/${formattedId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Notion-Version': '2022-06-28'
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        if (errorData.message && errorData.message.includes('not find database')) {
          throw new Error(`Notion API error: ${errorData.message}. Make sure you've shared the database with your integration in Notion.`);
        }
        throw new Error(`Notion API error: ${errorData.message || response.statusText}`);
      }
      
      return true;
    } catch (error) {
      throw new Error(`Notion API: ${error.message}`);
    }
  }

  // Test YouTube API connection
  async function testYouTubeApi(apiKey) {
    // Use a common, well-known video ID for testing
    const testVideoId = 'dQw4w9WgXcQ'; // Rick Astley - Never Gonna Give You Up
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${testVideoId}&key=${apiKey}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        let errorDetail = response.statusText;
        try {
          const errorData = await response.json();
          errorDetail = errorData.error?.message || errorDetail;
        } catch (e) { /* Ignore if response body is not JSON */ }
        throw new Error(`YouTube API error: ${errorDetail} (Status ${response.status})`);
      }
      
      // Check if we got data back
      const data = await response.json();
      if (!data.items || data.items.length === 0) {
        throw new Error('YouTube API returned no items for test video');
      }
      
      return true;
    } catch (error) {
      throw new Error(`YouTube API: ${error.message}`);
    }
  }

  // Helper to show status messages
  function showStatus(message, type) {
    statusElement.textContent = message;
    statusElement.className = 'status';
    
    if (type) {
      statusElement.classList.add(type);
    }
    
    // Clear success message after 3 seconds
    if (type === 'success') {
      setTimeout(() => {
        statusElement.textContent = '';
        statusElement.className = 'status';
      }, 3000);
    }
  }
});