// Google Apps Script - CORS-Enabled Backend for Weakness Analyzer
// Works with Google Sites, Netlify, and other web hosts

const SHEET_ID = '1_QmpN5CmFxxgBRpPkq69AABfKhltKf59bDPojzMfWQ8';

// IMPORTANT: Add your Claude API key here
const CLAUDE_API_KEY = 'YOUR_CLAUDE_API_KEY_HERE';

// Handle CORS preflight requests (OPTIONS)
function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeader('Access-Control-Allow-Origin', '*')
    .setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type')
    .setHeader('Access-Control-Max-Age', '86400');
}

// Handle all incoming POST requests
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    
    let response;
    
    if (action === 'analyze_paper') {
      response = analyzePaper(data);
    } else if (action === 'analyze_weaknesses') {
      response = analyzeWeaknesses(data);
    } else if (action === 'save_to_sheet') {
      response = saveToSheet(data);
    } else {
      response = createResponse({ success: false, error: 'Unknown action' });
    }
    
    // Add CORS headers to response
    return response
      .setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
  } catch (error) {
    return createResponse({ success: false, error: error.toString() })
      .setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

// Analyze uploaded question paper
function analyzePaper(data) {
  try {
    const { fileData, fileType, testConfig } = data;
    
    let contentBlock;
    if (fileType === 'application/pdf') {
      contentBlock = {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: fileData }
      };
    } else if (fileType.startsWith('image/')) {
      contentBlock = {
        type: 'image',
        source: { type: 'base64', media_type: fileType, data: fileData }
      };
    } else {
      throw new Error('Unsupported file type');
    }
    
    const prompt = `Analyze this ${testConfig.name} question paper. Map each question (Q1 to Q${testConfig.total}) to its chapter and subtopics.

Test structure:
${testConfig.subjects.map(s => `- ${s.name}: Questions ${s.start}-${s.end}`).join('\n')}

Return ONLY a JSON object (no markdown, no preamble) with this structure:
{
  "questions": [
    {
      "number": 1,
      "subject": "Physics",
      "chapter": "Mechanics",
      "subtopics": ["Newton's Laws", "Force Analysis"]
    }
  ]
}

Be specific with chapters and subtopics. Extract from the actual question content.`;

    const payload = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: [contentBlock, { type: 'text', text: prompt }]
        }
      ]
    };
    
    const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    const result = JSON.parse(response.getContentText());
    
    if (result.error) {
      throw new Error(result.error.message || 'API error');
    }
    
    const textContent = result.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
    
    const cleanedText = textContent
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    const parsed = JSON.parse(cleanedText);
    
    return createResponse({ success: true, data: parsed });
    
  } catch (error) {
    return createResponse({ success: false, error: error.toString() });
  }
}

// Analyze weaknesses from wrong answers
function analyzeWeaknesses(data) {
  try {
    const { wrongQuestions } = data;
    
    const prompt = `Analyze these wrong answers and identify weak topics:

${JSON.stringify(wrongQuestions, null, 2)}

Return ONLY a JSON object with:
{
  "summary": {
    "total_wrong": number,
    "by_subject": {"Physics": count, ...}
  },
  "weak_chapters": [
    {
      "subject": "Physics",
      "chapter": "Mechanics",
      "wrong_count": 3,
      "subtopics": ["Newton's Laws", "Friction"],
      "severity": "high"
    }
  ],
  "recommendations": ["Focus on...", "Practice..."]
}`;

    const payload = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    };
    
    const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    const result = JSON.parse(response.getContentText());
    
    if (result.error) {
      throw new Error(result.error.message || 'API error');
    }
    
    const textContent = result.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
    
    const cleanedText = textContent
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    const parsed = JSON.parse(cleanedText);
    
    return createResponse({ success: true, data: parsed });
    
  } catch (error) {
    return createResponse({ success: false, error: error.toString() });
  }
}

// Save analysis to Google Sheets
function saveToSheet(data) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName('Student Analysis');
    
    if (!sheet) {
      sheet = ss.insertSheet('Student Analysis');
      sheet.appendRow([
        'Timestamp',
        'Student Name',
        'Test Type',
        'Total Wrong',
        'Subject Breakdown',
        'Weak Chapters',
        'Recommendations'
      ]);
      
      const headerRange = sheet.getRange(1, 1, 1, 7);
      headerRange.setBackground('#1e293b');
      headerRange.setFontColor('#f1f5f9');
      headerRange.setFontWeight('bold');
      headerRange.setFontSize(11);
    }
    
    sheet.appendRow([
      data.timestamp,
      data.studentName,
      data.testType,
      data.totalWrong,
      data.subjects,
      data.weakChapters,
      data.recommendations
    ]);
    
    sheet.autoResizeColumns(1, 7);
    
    return createResponse({ success: true, message: 'Data saved successfully' });
    
  } catch (error) {
    return createResponse({ success: false, error: error.toString() });
  }
}

// Helper function to create JSON response
function createResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// Test function - run this to verify setup
function testSetup() {
  Logger.log('Testing Apps Script setup...');
  
  // Test 1: Check API key
  if (CLAUDE_API_KEY === 'YOUR_CLAUDE_API_KEY_HERE') {
    Logger.log('❌ ERROR: Claude API key not set!');
    Logger.log('Get your key from: https://console.anthropic.com/settings/keys');
    return;
  }
  Logger.log('✅ API key is set');
  
  // Test 2: Check sheet access
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    Logger.log('✅ Can access Google Sheet: ' + ss.getName());
  } catch (e) {
    Logger.log('❌ ERROR: Cannot access sheet: ' + e.toString());
    return;
  }
  
  // Test 3: Test API call
  try {
    const testPayload = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Say "API test successful" in exactly those words.' }]
    };
    
    const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      payload: JSON.stringify(testPayload),
      muteHttpExceptions: true
    });
    
    const result = JSON.parse(response.getContentText());
    
    if (result.error) {
      Logger.log('❌ API ERROR: ' + result.error.message);
      if (result.error.type === 'authentication_error') {
        Logger.log('Your API key is invalid. Get a new one from: https://console.anthropic.com/settings/keys');
      }
      return;
    }
    
    Logger.log('✅ Claude API working!');
    Logger.log('Response: ' + result.content[0].text);
    
  } catch (e) {
    Logger.log('❌ ERROR testing API: ' + e.toString());
    return;
  }
  
  Logger.log('\n✅ ALL TESTS PASSED! Your backend is ready.');
  Logger.log('Next step: Deploy as Web App with "Anyone" access');
}
