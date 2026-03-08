GrammarFree Extension - AI & Dev Instructions
Tech Stack Summary
Platform/Framework: Google Chrome Extension (Manifest V3)

Core Languages: Vanilla JavaScript (ES6+), HTML5

Styling: Vanilla CSS (using Shadow DOM or strict .grammarfree- prefixes for isolation)

Grammar Engine: LanguageTool API (Free Tier REST API)

Version Control & AI: Git, GitHub, and Cursor (Composer)

Dev Environment Tips
Extension Loading: To test locally, open Chrome and navigate to chrome://extensions/. Enable "Developer mode" (top right), click "Load unpacked," and select the project's root directory.

Hot Reloading: Changes to popup.html or content.js usually update upon refreshing the host web page. However, if you modify manifest.json or background.js (Service Worker), you must click the refresh icon on the extension card in chrome://extensions/.

API Endpoint: Use https://api.languagetool.org/v2/check for the free tier. No authentication keys are required, but you must pass language=en-US and text in the body.

Node/Tooling (Optional): Even for a vanilla project, run npm init -y and npm install -D prettier eslint to keep the agent's code cleanly formatted before committing.

Testing & Validation
CORS & Network Verification: All API calls to LanguageTool MUST be routed through background.js. Check the service worker's console (via chrome://extensions/ -> "Inspect views: service worker") to verify network requests are succeeding without CORS errors.

Debounce Testing: Monitor the Network tab to ensure typing rapidly does not spam the LanguageTool API. The API should only trigger ~1000ms after the user stops typing.

DOM Injection & Isolation: Test the extension on complex sites (e.g., Gmail, Notion, GitHub issues). Ensure the custom tooltip CSS does not inherit the host site's styling or disrupt the page layout.

Target Elements: Validate that the content script successfully attaches event listeners to standard <textarea> elements, <input type="text">, and contenteditable="true" divs.

PR & Commit Instructions
Title Format: [feature/fix/chore/ui] <Brief Description>

Pre-commit Check: Run your formatter (e.g., npx prettier --write .) to ensure clean code before pushing to GitHub.

Windows CLI: Use PowerShell for your git workflow. For example, to push a new feature:
git add .
git commit -m "[feature] add hover tooltip UI"
git push origin main

Extension Generation Protocol (AI Instructions)
When generating the extension code, you (the AI Agent) must:

Strictly adhere to Manifest V3 constraints: No inline scripts in HTML files, and background scripts must be registered as service workers.

Prioritize Separation of Concerns: Keep DOM manipulation strictly in content.js, API fetching in background.js, and toggle logic in popup.js.

Message Passing: Use chrome.runtime.sendMessage and chrome.runtime.onMessage.addListener for all communication between the content script and the background service worker.

Performance: Implement a robust debouncing function in the content script before sending payloads to the background script.

Non-Destructive DOM Manipulation: When highlighting errors, do not destroy the native value or state of the text input. Use overlay divs positioned exactly beneath or over the text area, or wrap specific text nodes carefully if dealing with contenteditable elements.
