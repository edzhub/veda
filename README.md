# PDF Media Player & Analyzer App

A web-based document reader and presentation app that extracts text and images from PDFs, performs semantic structure analysis using a local LLM, and reads narration scripts using high-quality neural voices with dual-panel layout and real-time word highlighting.

---

## ⚡ Quick Start

### 1. Backend Server Setup (`uv`)
This project utilizes **`uv`** (Astral's ultra-fast package installer) to manage Python dependencies in a local vendor folder.

Install backend dependencies:
```bash
# Using the absolute path to your uv installation
C:\Users\eakes\.local\bin\uv.exe pip install --target server/vendor -r server/requirements.txt
```

Launch the FastAPI TTS & analysis backend:
```bash
python server/tts_server.py
```
*The server will run on `http://127.0.0.1:8765`.*

### 2. Frontend Setup
Install npm dependencies and launch the Vite development server:
```bash
npm install
npm run dev
```
*The web interface will open on `http://localhost:5173/`.*

---

## 📂 Project Architecture

```
├── server/
│   ├── vendor/               # Fast dependencies resolved via uv
│   ├── tts_server.py         # FastAPI backend (Edge-TTS, local Qwen model, Whisper endpoint)
│   └── requirements.txt      # Python dependencies list
├── src/
│   ├── components/
│   │   ├── RightPanel.jsx    # Dual-panel Theater Mode, bottoms controls, Karaoke highlighter, Custom voice recording
│   │   ├── LeftPanel.jsx     # TOC viewer & PDF uploader
│   │   └── AIAvatar.jsx      # Dynamic animated AI voice avatar
│   ├── utils/
│   │   ├── pdfUtils.js       # Layout engine & extraction, title ribbon deduplication, semantic hooks
│   │   └── speechUtils.js    # TTS request maps & word highlights
│   ├── context/
│   │   └── PDFContext.jsx    # React context state engine (theme, page, voice, progress tracker)
│   ├── App.jsx               # Entry-point dashboard layout
│   └── index.css             # Styling rules
```

---

## ✨ Features

* **AI & Manual Narration Modes**: Toggle between Microsoft Edge Neural Voices or custom voice recordings.
* **Intelligent Auto-Alignment (Offline)**: Runs a custom punctuation-weighted linear alignment heuristic that distributes audio duration across word boundaries in real-time without needing any external server.
* **AI Whisper Alignment**: Sends custom voice recordings to the backend `/transcribe` endpoint to align text precisely word-by-word.
* **Ultra-Smooth Karaoke highlighting**: Uses a sub-20ms `requestAnimationFrame` loop to highlight spoken words on-the-fly.
* **Title Deduplication & Layout Parsing**: Adaptive column-grouping thresholds and heading merging to parse multi-column PDF layouts cleanly.
