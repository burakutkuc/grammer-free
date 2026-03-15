# GrammarFree 🛡️✨
A 100% Local, Privacy-First AI Grammar Checker Extension

GrammarFree is a lightweight browser extension that brings the power of an AI writing assistant directly to your local machine. It acts as a free, offline alternative to tools like Grammarly. By utilizing [şüpheli bağlantı kaldırıldı] and small, highly-optimized local LLMs (like Qwen 2.5:3B), your keystrokes and text never leave your computer. No cloud, no subscriptions, no data harvesting.

✨ Features
100% Privacy: All text processing happens locally on your hardware. Zero API calls to external servers.

Smart UI: Highlights grammatical errors directly in your text fields with a clean, unobtrusive popup for suggestions.

1-Click Fix: Replace typos, fix tenses, and improve sentence structures with a single click.

Chunking Architecture: Designed to handle long paragraphs effortlessly. It splits text sentence-by-sentence to prevent local LLM hallucinations and memory timeouts.

Anti-Loop Guardrails: Built-in safeguards to ignore "No-Op" (identical) suggestions from the AI.

🛠️ Prerequisites
Since this extension runs a local AI model, you need to set up the backend first:

Install Ollama: Download and install Ollama from [şüpheli bağlantı kaldırıldı].

Download the AI Model: Open your terminal (or command prompt) and pull the recommended model:
ollama run qwen2.5:3b
(Note: The model is around 2.3 GB and needs to be running in the background).

🚀 Installation
Clone the repository:
git clone 

Open your browser and navigate to the Extensions page (chrome://extensions/).

Enable Developer mode (usually a toggle in the top right corner).

Click on Load unpacked.

Select the folder where you cloned this repository.

The GrammarFree icon should now appear in your browser toolbar!

💡 How to Use
Ensure Ollama is running in the background.

Go to any website and start typing in a text box.

If the AI detects a grammar issue, it will highlight the exact word or phrase with a subtle pink background.

Hover or click on the highlighted text to see the suggested fix.

Click the green Replace button to automatically fix the text.

⚙️ Under the Hood
Frontend: Vanilla JavaScript, CSS, HTML (Manifest V3 compatible).

Backend: Ollama REST API (http://localhost:11434/api/chat).

Prompt Engineering: Strict JSON schema enforcement and edge-case filtering handled directly in the Service Worker (background.js).

🤝 Contributing
Contributions, issues, and feature requests are welcome!

📜 License
Distributed under the MIT License. See LICENSE for more information.
