from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import sys
import threading
import fitz
import wave
from io import BytesIO
from pathlib import Path

try:
    from dotenv import load_dotenv
    # Load dotenv from BASE_DIR
    load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")
except ImportError:
    pass

import requests

BASE_DIR = Path(__file__).resolve().parent
VENDOR_DIR = BASE_DIR / "vendor"

if VENDOR_DIR.exists():
    sys.path.insert(0, str(VENDOR_DIR))

try:
    # pyrefly: ignore [missing-import]
    import edge_tts
except ModuleNotFoundError as exc:
    raise SystemExit(
        "edge-tts is not installed. Install it with:\n"
        "python -m pip install --target server/vendor -r server/requirements.txt"
    ) from exc

try:
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import StreamingResponse
    from pydantic import BaseModel
except ModuleNotFoundError:
    # Fallback to standard library if pip installation hasn't fully registered in-process yet
    print("FastAPI is not installed in the target vendor path. Installing requirements...")
    raise

app = FastAPI(title="TTS & Slide Analysis Server")

# Setup CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

VOICE_MAP = {
    "en-US": "en-US-AriaNeural",
    "te-IN": "te-IN-ShrutiNeural",
}

SARVAM_API_KEY = os.environ.get("SARVAM_API_KEY")

def get_sarvam_speaker(voice: str, lang: str) -> str:
    voice_lower = voice.lower() if voice else ""
    lang_lower = lang.lower() if lang else ""
    if "shruti" in voice_lower or lang_lower == "te-in":
        return "kavitha"
    if "aria" in voice_lower or lang_lower in ["en-us", "en-in"]:
        return "priya"
    return "shubh"

def parse_rate_to_pace(rate_str: str) -> float:
    if not rate_str:
        return 1.0
    match = re.search(r'([+-]?\d+)\s*%', rate_str)
    if match:
        try:
            pct = float(match.group(1))
            pace = 1.0 + (pct / 100.0)
            return max(0.5, min(2.0, pace))
        except ValueError:
            pass
    return 1.0

class SarvamMemoryCache:
    _lock = threading.Lock()
    last_text = None
    last_language = None
    last_voice = None
    last_rate = None
    last_audio_bytes = None
    last_word_boundaries = None

    @classmethod
    def get(cls, text: str, language: str, voice: str, rate: str):
        with cls._lock:
            if (cls.last_text == text and 
                cls.last_language == language and 
                cls.last_voice == voice and 
                cls.last_rate == rate):
                return cls.last_audio_bytes, cls.last_word_boundaries
        return None, None

    @classmethod
    def set(cls, text: str, language: str, voice: str, rate: str, audio_bytes: bytes, word_boundaries: list):
        with cls._lock:
            cls.last_text = text
            cls.last_language = language
            cls.last_voice = voice
            cls.last_rate = rate
            cls.last_audio_bytes = audio_bytes
            cls.last_word_boundaries = word_boundaries

def call_sarvam_tts(text: str, target_lang: str, speaker: str, pace: float) -> bytes:
    if not SARVAM_API_KEY:
        raise ValueError("SARVAM_API_KEY environment variable is not set")
    
    headers = {
        "api-subscription-key": SARVAM_API_KEY,
        "Content-Type": "application/json"
    }
    payload = {
        "text": text,
        "target_language_code": target_lang,
        "speaker": speaker,
        "model": "bulbul:v3",
        "properties": {
            "output_audio_codec": "wav",
            "speech_sample_rate": 24000,
            "pace": pace
        }
    }
    print(f"Calling Sarvam TTS API for text of len {len(text)} ({target_lang}, speaker: {speaker}, pace: {pace})...")
    try:
        response = requests.post("https://api.sarvam.ai/text-to-speech", json=payload, headers=headers, timeout=15)
        response.raise_for_status()
    except requests.exceptions.HTTPError as err:
        print(f"Sarvam HTTP Error: {err.response.text}")
        raise
    data = response.json()
    
    if "audios" not in data or not data["audios"]:
        raise ValueError("No audios returned from Sarvam TTS")
    
    audio_base64 = data["audios"][0]
    return base64.b64decode(audio_base64)

def call_sarvam_stt(audio_bytes: bytes, lang_code: str) -> list[dict]:
    if not SARVAM_API_KEY:
        raise ValueError("SARVAM_API_KEY environment variable is not set")
        
    headers = {
        "api-subscription-key": SARVAM_API_KEY
    }
    files = {
        "file": ("audio.wav", audio_bytes, "audio/wav")
    }
    data = {
        "model": "saaras:v3",
        "language_code": lang_code,
        "with_timestamps": "true"
    }
    print(f"Calling Sarvam STT API for audio alignment ({lang_code})...")
    response = requests.post("https://api.sarvam.ai/speech-to-text", files=files, data=data, headers=headers, timeout=20)
    response.raise_for_status()
    stt_data = response.json()
    
    word_boundaries = []
    if "timestamps" in stt_data:
        ts = stt_data["timestamps"]
        if isinstance(ts, dict) and "words" in ts:
            words_list = ts["words"]
            if isinstance(words_list, list) and len(words_list) > 0:
                if isinstance(words_list[0], dict):
                    for item in words_list:
                        word_boundaries.append({
                            "text": item.get("word", ""),
                            "start": float(item.get("start_time_seconds", 0.0)),
                            "end": float(item.get("end_time_seconds", 0.0))
                        })
                elif isinstance(words_list[0], str):
                    starts = ts.get("start_time_seconds", [])
                    ends = ts.get("end_time_seconds", [])
                    for i in range(min(len(words_list), len(starts), len(ends))):
                        word_boundaries.append({
                            "text": words_list[i],
                            "start": float(starts[i]),
                            "end": float(ends[i])
                        })
    
    print(f"Sarvam STT alignment complete. Extracted {len(word_boundaries)} words.")
    return word_boundaries

def get_wav_duration(wav_bytes: bytes) -> float:
    try:
        with wave.open(BytesIO(wav_bytes), "rb") as wav:
            frames = wav.getnframes()
            rate = wav.getframerate()
            if rate > 0:
                return frames / float(rate)
    except Exception as e:
        print(f"Failed to read WAV duration: {e}")
    return 0.0

def detect_speech_boundaries(wav_bytes: bytes, threshold: int = 300) -> tuple[float, float]:
    try:
        import struct
        with wave.open(BytesIO(wav_bytes), "rb") as wav:
            n_channels = wav.getnchannels()
            sampwidth = wav.getsampwidth()
            framerate = wav.getframerate()
            n_frames = wav.getnframes()
            
            if sampwidth != 2 or framerate <= 0 or n_frames <= 0:
                return 0.20, 0.15
                
            raw_data = wav.readframes(n_frames)
            num_samples = len(raw_data) // 2
            samples = struct.unpack(f"{num_samples}h", raw_data)
            
            window_size = int(framerate * 0.01) * n_channels
            if window_size <= 0:
                window_size = 1
                
            first_speech_idx = None
            last_speech_idx = None
            
            for i in range(0, num_samples, window_size):
                chunk = samples[i:i+window_size]
                if any(abs(s) > threshold for s in chunk):
                    first_speech_idx = i
                    break
                    
            for i in range(num_samples - window_size, -1, -window_size):
                chunk = samples[i:i+window_size]
                if any(abs(s) > threshold for s in chunk):
                    last_speech_idx = i + window_size
                    break
                    
            if first_speech_idx is None:
                first_speech_idx = 0
            if last_speech_idx is None:
                last_speech_idx = num_samples
                
            lead_in = (first_speech_idx / n_channels) / framerate
            lead_out = ((num_samples - last_speech_idx) / n_channels) / framerate
            
            return round(lead_in, 3), round(lead_out, 3)
    except Exception as e:
        print(f"Error detecting speech boundaries: {e}")
        return 0.20, 0.15

def adjust_boundaries_to_silence(boundaries: list[dict], wav_bytes: bytes) -> list[dict]:
    if not boundaries:
        return boundaries
    try:
        lead_in, lead_out = detect_speech_boundaries(wav_bytes)
        duration = get_wav_duration(wav_bytes)
        if duration <= 0.0:
            return boundaries
            
        actual_start = lead_in
        actual_end = duration - lead_out
        
        if actual_end <= actual_start:
            return boundaries
            
        orig_start = boundaries[0]["start"]
        orig_end = boundaries[-1]["end"]
        orig_range = orig_end - orig_start
        
        if orig_range <= 0.0:
            usable = actual_end - actual_start
            for i, b in enumerate(boundaries):
                fraction = i / len(boundaries)
                next_fraction = (i + 1) / len(boundaries)
                b["start"] = round(actual_start + usable * fraction, 3)
                b["end"] = round(actual_start + usable * next_fraction, 3)
            return boundaries
            
        actual_range = actual_end - actual_start
        scale = actual_range / orig_range
        
        for b in boundaries:
            b["start"] = round(actual_start + (b["start"] - orig_start) * scale, 3)
            b["end"] = round(actual_start + (b["end"] - orig_start) * scale, 3)
            
        return boundaries
    except Exception as e:
        print(f"Error adjusting boundaries: {e}")
        return boundaries

def generate_fallback_boundaries(text: str, duration: float, lead_in: float = None, lead_out: float = None) -> list[dict]:
    words = text.split()
    if not words:
        return []
    total_chars = sum(len(w) for w in words)
    if total_chars == 0:
        return []
    
    if lead_in is None:
        lead_in = min(0.20, duration * 0.05)
    if lead_out is None:
        lead_out = min(0.15, duration * 0.04)
        
    usable_duration = duration - (lead_in + lead_out)
    if usable_duration <= 0.1:
        usable_duration = duration
        lead_in = 0.0
        
    boundaries = []
    current_time = lead_in
    for w in words:
        char_fraction = len(w) / total_chars
        w_duration = usable_duration * char_fraction
        boundaries.append({
            "text": w,
            "start": round(current_time, 3),
            "end": round(current_time + w_duration, 3)
        })
        current_time += w_duration
    return boundaries

async def generate_sarvam_audio_and_boundaries(text: str, language: str, voice: str, rate: str) -> tuple[bytes, list[dict]]:
    cached_audio, cached_boundaries = SarvamMemoryCache.get(text, language, voice, rate)
    if cached_audio is not None:
        print("Using cached Sarvam audio and boundaries.")
        return cached_audio, cached_boundaries

    lang_code = "te-IN" if language == "te-IN" else "en-IN"
    speaker = get_sarvam_speaker(voice, language)
    pace = parse_rate_to_pace(rate)
    
    audio_bytes = await asyncio.to_thread(call_sarvam_tts, text, lang_code, speaker, pace)
    
    lead_in, lead_out = detect_speech_boundaries(audio_bytes)
    duration = get_wav_duration(audio_bytes)
    if duration <= 0.0:
        words_count = len(text.split())
        duration = max(1.0, words_count / 2.5)
        
    try:
        word_boundaries = await asyncio.to_thread(call_sarvam_stt, audio_bytes, lang_code)
        
        # Check if STT returned grouped segments rather than individual words
        input_words = text.split()
        if word_boundaries and len(word_boundaries) < len(input_words) * 0.7:
            print(f"Sarvam STT returned chunked segments ({len(word_boundaries)} segments for {len(input_words)} words). Re-aligning using fallback heuristic...")
            word_boundaries = generate_fallback_boundaries(text, duration, lead_in, lead_out)
        else:
            word_boundaries = adjust_boundaries_to_silence(word_boundaries, audio_bytes)
    except Exception as stt_err:
        print(f"Sarvam STT failed: {stt_err}. Using fallback heuristic alignment...")
        word_boundaries = generate_fallback_boundaries(text, duration, lead_in, lead_out)
        
    SarvamMemoryCache.set(text, language, voice, rate, audio_bytes, word_boundaries)
    return audio_bytes, word_boundaries

def reconstruct_line_text(spans) -> str:
    line_text = ""
    sorted_spans = sorted(spans, key=lambda s: s.get("origin", (0, 0))[0])
    for s in sorted_spans:
        text = s.get("text", "")
        if not text:
            continue
        if not line_text:
            line_text = text
        else:
            needs_space = not line_text.endswith('-') and not text.startswith(',') and not text.startswith('.')
            line_text += " " + text if needs_space else text
    return line_text.strip()

class PDFMetadataAnalyzer:
    def __init__(self, doc):
        self.running_headers_footers = set()
        self._analyze(doc)
        
    def _analyze(self, doc):
        from collections import Counter
        top_lines = []
        bottom_lines = []
        
        for page in doc:
            height = page.rect.height
            d = page.get_text("dict")
            for b in d.get("blocks", []):
                if b.get("type") == 0:
                    for l in b.get("lines", []):
                        spans = l.get("spans", [])
                        if not spans:
                            continue
                        line_text = reconstruct_line_text(spans)
                        if not line_text:
                            continue
                        y = spans[0]["origin"][1]
                        if y < height * 0.10:
                            top_lines.append(line_text)
                        elif y > height * 0.90:
                            bottom_lines.append(line_text)
                            
        top_counts = Counter(top_lines)
        bottom_counts = Counter(bottom_lines)
        
        total_pages = len(doc)
        min_count = max(2, min(3, total_pages))
        
        for text, count in top_counts.items():
            if count >= min_count:
                self.running_headers_footers.add(text)
                
        for text, count in bottom_counts.items():
            if count >= min_count:
                self.running_headers_footers.add(text)

active_doc = None
active_analyzer = None
active_doc_lock = threading.Lock()

# Shared LLM state
def get_selected_model_info() -> tuple[str, str, list[Path]]:
    size = os.environ.get("LOCAL_LLM_SIZE", "0.5B").strip().upper()
    if size == "1.5B":
        filename = "qwen2.5-1.5b-instruct-q4_k_m.gguf"
        url = "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf"
    elif size == "3B":
        filename = "qwen2.5-3b-instruct-q4_k_m.gguf"
        url = "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf"
    else:  # Default to 0.5B
        filename = "qwen2.5-0.5b-instruct-q4_k_m.gguf"
        url = "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"
        
    model_paths = [
        BASE_DIR / "models" / filename,
        Path(f"C:/Users/eakes/.gemini/antigravity-ide/brain/c37866b0-e84b-4655-a592-33e7bc7ddd61/scratch/models/{filename}"),
        Path(f"C:/Users/eakes/.gemini/antigravity/models/{filename}")
    ]
    return filename, url, model_paths

class LLMState:
    _llm = None
    _model_downloading = False
    _lock = threading.Lock()

    @classmethod
    def get_llm(cls):
        if cls._llm is not None:
            return cls._llm

        filename, url, model_paths = get_selected_model_info()

        found_path = None
        for path in model_paths:
            if path.exists():
                found_path = path
                break

        if not found_path:
            if cls._model_downloading:
                raise Exception("Local LLM model is still downloading in the background. Please wait a moment...")
            else:
                start_model_download()
                raise Exception(f"Local LLM model ({filename}) is not present. Download started in background. Please try again in a moment...")

        from llama_cpp import Llama
        n_threads = min(8, os.cpu_count() or 4)
        print(f"Loading Qwen LLM model from {found_path} with {n_threads} threads...")
        cls._llm = Llama(model_path=str(found_path), n_ctx=2048, n_threads=n_threads, verbose=False)
        print("Model loaded successfully.")
        return cls._llm

def _extract_json(text: str) -> dict:
    text = text.strip()
    
    # Clean markdown
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()
    
    # Extract outer braces
    first_brace = text.find('{')
    last_brace = text.rfind('}')
    if first_brace == -1 or last_brace == -1 or last_brace < first_brace:
        raise ValueError("No JSON object found in LLM response.")
    json_str = text[first_brace:last_brace + 1]
    
    # Try direct parse
    try:
        return json.loads(json_str)
    except json.JSONDecodeError:
        pass
        
    # Attempt simple auto-fixes
    print("Direct JSON parse failed. Attempting auto-fixes...")
    
    # Fix Qwen's trailing bracket bug: "narration": "..." \n ] \n }
    fixed_str = re.sub(r'"\s*\]\s*\}', '"\n}', json_str)
    fixed_str = re.sub(r'"\s*,\s*\]\s*\}', '"\n}', fixed_str)
    
    # Close open quotes and braces if cut off
    open_braces = fixed_str.count('{')
    close_braces = fixed_str.count('}')
    if open_braces > close_braces:
        if fixed_str.count('"') % 2 != 0:
            fixed_str += '"'
        fixed_str += '}' * (open_braces - close_braces)
        
    try:
        return json.loads(fixed_str)
    except Exception as e:
        print(f"Auto-fix failed: {e}")
        # Last resort fallback: extract key-values via regex
        fallback_dict = {}
        for key in ["title", "subtitle", "summary", "narration"]:
            match = re.search(r'"' + key + r'"\s*:\s*"([^"]*)"', json_str)
            if match:
                fallback_dict[key] = match.group(1)
        
        for key in ["highlights", "supportingPoints"]:
            array_match = re.search(r'"' + key + r'"\s*:\s*\[(.*?)\]', json_str, re.DOTALL)
            if array_match:
                items = re.findall(r'"([^"]*)"', array_match.group(1))
                fallback_dict[key] = items
                
        if "title" in fallback_dict:
            print("Extracted fields via regex fallback.")
            if "highlights" not in fallback_dict:
                fallback_dict["highlights"] = []
            if "supportingPoints" not in fallback_dict:
                fallback_dict["supportingPoints"] = []
            return fallback_dict
            
        raise ValueError(f"Failed to parse or repair JSON response: {e}")

def analyze_text_semantic(text: str, is_digest: bool = False, language: str = "en-US") -> dict:
    llm = LLMState.get_llm()
    if llm is None:
        raise Exception("LLM model not available yet.")

    if is_digest:
        system_instructions = (
            "You are a news digest summarizer. The user will give you the full text of a magazine "
            "or newspaper page that contains MULTIPLE separate articles or news items.\n"
            "Identify every distinct article on the page and output a JSON object with:\n"
            "- \"title\": The section heading of the whole page (e.g. 'Science Updates').\n"
            "- \"subtitle\": A short description like '6 stories this issue'.\n"
            "- \"summary\": One sentence summarising the page as a whole.\n"
            "- \"topics\": A JSON array where each element has:\n"
            "    - \"title\": The article headline (under 10 words).\n"
            "    - \"summary\": One clear sentence (15-30 words) summarising that article.\n"
            "- \"narration\": A natural narration (100-160 words) that introduces all the articles "
            "briefly, one by one, in the order they appear.\n"
            "Ensure the output is ONLY a valid JSON object."
        )
    else:
        system_instructions = (
            "You are a professional slide deck generator. Convert the user's text into a beautiful slide JSON object.\n"
            "The JSON object must contain exactly these fields:\n"
            "- \"title\": A concise title of the main topic (under 8 words).\n"
            "- \"subtitle\": A brief subheading (under 12 words).\n"
            "- \"summary\": A clear, 2-sentence explanation of the core concept. Exclude footers, headers, page numbers, and repeating metadata.\n"
            "- \"highlights\": An array of exactly 3 bullet points of key takeaways (10-25 words each).\n"
            "- \"supportingPoints\": An array of exactly 4 detailed notes or supporting facts.\n"
            "- \"narration\": A natural, professional narration script summarizing this slide for audio playback (50-80 words).\n"
            "Ensure the output is ONLY a valid JSON object."
        )

    messages = [
        {"role": "system", "content": system_instructions},
        {"role": "user", "content": text}
    ]

    with LLMState._lock:
        max_tokens = 1024
        response = llm.create_chat_completion(
            messages=messages,
            max_tokens=max_tokens,
            temperature=0.1,
            repeat_penalty=1.15
        )
        output_text = response["choices"][0]["message"]["content"].strip()
    
    try:
        return _extract_json(output_text)
    except Exception as e:
        print("--- LLM OUTPUT PARSE FAILURE ---")
        print(output_text)
        print(f"Error: {e}")
        print("--------------------------------")
        raise Exception(f"Failed to parse JSON response from local LLM: {e}")

# Request/Response Pydantic schemas
class TTSRequest(BaseModel):
    text: str
    language: str = "en-US"
    voice: str = ""
    rate: str = "+0%"

class AnalyzeRequest(BaseModel):
    text: str
    is_digest: bool = False
    language: str = "en-US"

class TranscribeRequest(BaseModel):
    audio: str
    text: str
    filename: str = "audio.wav"

@app.get("/health")
def health_check():
    return {"ok": True, "service": "edge-tts"}

async def generate_audio_and_boundaries(text: str, voice: str, rate: str) -> tuple[bytes, list[dict]]:
    stream = edge_tts.Communicate(text=text, voice=voice, rate=rate, boundary="WordBoundary")
    audio_buffer = BytesIO()
    word_boundaries = []

    async for chunk in stream.stream():
        if chunk["type"] == "audio":
            audio_buffer.write(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            word_boundaries.append({
                "text": chunk["text"],
                "start": chunk["offset"] / 10000000.0,
                "end": (chunk["offset"] + chunk["duration"]) / 10000000.0
            })

    return audio_buffer.getvalue(), word_boundaries

@app.post("/tts")
async def text_to_speech(req: TTSRequest):
    text = req.text.strip()
    language = req.language.strip() or "en-US"
    voice = req.voice.strip() or VOICE_MAP.get(language, VOICE_MAP["en-US"])
    rate = req.rate.strip() or "+0%"

    if not text:
        raise HTTPException(status_code=400, detail="Text is required")

    try:
        if SARVAM_API_KEY:
            print(f"Generating Sarvam TTS for {len(text)} chars (voice: {voice}, rate: {rate})...")
            try:
                audio_bytes, word_boundaries = await generate_sarvam_audio_and_boundaries(text, language, voice, rate)
            except Exception as sarvam_exc:
                print(f"Sarvam TTS generation failed: {sarvam_exc}. Falling back to edge-tts...")
                audio_bytes, word_boundaries = await generate_audio_and_boundaries(text, voice, rate)
        else:
            print(f"Generating edge-tts for {len(text)} chars (voice: {voice}, rate: {rate})...")
            audio_bytes, word_boundaries = await generate_audio_and_boundaries(text, voice, rate)
        
        print("TTS generation successful")
        audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")
        return {
            "audio": audio_base64,
            "word_boundaries": word_boundaries
        }
    except Exception as exc:
        print(f"TTS generation failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))

@app.get("/tts_stream")
async def text_to_speech_stream(text: str, language: str = "en-US", voice: str = "", rate: str = "+0%"):
    text = text.strip()
    language = language.strip() or "en-US"
    voice = voice.strip() or VOICE_MAP.get(language, VOICE_MAP["en-US"])
    rate = rate.strip() or "+0%"

    if not text:
        raise HTTPException(status_code=400, detail="Text is required")

    async def audio_generator():
        try:
            if SARVAM_API_KEY:
                print(f"Streaming Sarvam TTS for {len(text)} chars (voice: {voice}, rate: {rate})...")
                try:
                    audio_bytes, _ = await generate_sarvam_audio_and_boundaries(text, language, voice, rate)
                    yield audio_bytes
                    return
                except Exception as sarvam_exc:
                    print(f"Sarvam streaming failed: {sarvam_exc}. Falling back to edge-tts...")
            
            print(f"Streaming edge-tts for {len(text)} chars (voice: {voice}, rate: {rate})...")
            stream = edge_tts.Communicate(text=text, voice=voice, rate=rate)
            async for chunk in stream.stream():
                if chunk["type"] == "audio":
                    yield chunk["data"]
            print("Streaming TTS generation completed")
        except Exception as exc:
            print(f"Streaming TTS generator failed: {exc}")

    media_type = "audio/wav" if SARVAM_API_KEY else "audio/mpeg"
    return StreamingResponse(audio_generator(), media_type=media_type)

@app.post("/tts_boundaries")
async def text_to_speech_boundaries(req: TTSRequest):
    text = req.text.strip()
    language = req.language.strip() or "en-US"
    voice = req.voice.strip() or VOICE_MAP.get(language, VOICE_MAP["en-US"])
    rate = req.rate.strip() or "+0%"

    if not text:
        raise HTTPException(status_code=400, detail="Text is required")

    try:
        word_boundaries = []
        use_fallback = False
        
        if SARVAM_API_KEY:
            print(f"Generating Sarvam boundaries for {len(text)} chars (voice: {voice}, rate: {rate})...")
            try:
                _, word_boundaries = await generate_sarvam_audio_and_boundaries(text, language, voice, rate)
            except Exception as sarvam_exc:
                print(f"Sarvam boundaries failed: {sarvam_exc}. Falling back to edge-tts...")
                use_fallback = True
        else:
            use_fallback = True
            
        if use_fallback:
            print(f"Generating edge-tts boundaries for {len(text)} chars (voice: {voice}, rate: {rate})...")
            stream = edge_tts.Communicate(text=text, voice=voice, rate=rate, boundary="WordBoundary")
            async for chunk in stream.stream():
                if chunk["type"] == "WordBoundary":
                    word_boundaries.append({
                        "text": chunk["text"],
                        "start": chunk["offset"] / 10000000.0,
                        "end": (chunk["offset"] + chunk["duration"]) / 10000000.0
                    })
        print(f"TTS boundary generation successful: {len(word_boundaries)} words")
        return {"word_boundaries": word_boundaries}
    except Exception as exc:
        print(f"TTS boundary generation failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))

def extract_strings(obj, paths, current_path=[]):
    if isinstance(obj, str):
        paths.append((current_path, obj))
    elif isinstance(obj, list):
        for idx, item in enumerate(obj):
            extract_strings(item, paths, current_path + [idx])
    elif isinstance(obj, dict):
        for key, value in obj.items():
            if key in ["title", "subtitle", "summary", "narration", "body"]:
                extract_strings(value, paths, current_path + [key])
            elif key in ["highlights", "supportingPoints", "topics"]:
                extract_strings(value, paths, current_path + [key])

def set_by_path(obj, path, value):
    current = obj
    for step in path[:-1]:
        current = current[step]
    current[path[-1]] = value

def translate_strings_sarvam(texts: list[str], api_key: str) -> list[str]:
    delimiter = " |#| "
    combined = delimiter.join(texts)
    
    url = "https://api.sarvam.ai/translate"
    payload = {
        "input": combined,
        "source_language_code": "en-IN",
        "target_language_code": "te-IN",
        "model": "sarvam-translate:v1"
    }
    headers = {
        "api-subscription-key": api_key,
        "Content-Type": "application/json"
    }
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=15)
        response.raise_for_status()
        translated_combined = response.json()["translated_text"]
        translated_texts = re.split(r'\s*\|#\|\s*', translated_combined)
        if len(translated_texts) == len(texts):
            return [t.strip() for t in translated_texts]
        else:
            print(f"Translation split mismatch: got {len(translated_texts)}, expected {len(texts)}. Translating individually...")
    except Exception as e:
        print(f"Batch translation failed: {e}. Translating individually...")
        
    translated_texts = []
    for t in texts:
        try:
            payload["input"] = t
            response = requests.post(url, json=payload, headers=headers, timeout=10)
            response.raise_for_status()
            translated_texts.append(response.json()["translated_text"].strip())
        except Exception as err:
            print(f"Failed to translate '{t}': {err}")
            translated_texts.append(t)
    return translated_texts

@app.post("/analyze")
def analyze_text(req: AnalyzeRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")

    try:
        mode = "digest" if req.is_digest else "single-topic"
        print(f"Starting local LLM analysis ({mode}, language: {req.language}) for {len(text)} chars...")
        
        # We always generate the semantic structure in English first for high accuracy
        analysis = analyze_text_semantic(text, is_digest=req.is_digest, language="en-US")
        
        # If Telugu is selected and Sarvam API is active, translate only the narration fields into Telugu
        if req.language == "te-IN" and SARVAM_API_KEY:
            print("Translating only narration fields into Telugu via Sarvam Translation API...")
            try:
                texts_to_translate = []
                mappings = [] # list of tuples: (dict_ref, key_to_set)
                
                # 1. Single-topic narration
                eng_narration = analysis.get("narration")
                if eng_narration:
                    texts_to_translate.append(eng_narration)
                    mappings.append((analysis, "narration_te"))
                
                # 2. Digest topics narration
                if "topics" in analysis:
                    for t in analysis["topics"]:
                        title = t.get("title", "")
                        body = t.get("summary", t.get("body", ""))
                        combined = f"{title}. {body}".strip()
                        if combined:
                            texts_to_translate.append(combined)
                            mappings.append((t, "narration_te"))
                
                if texts_to_translate:
                    translated = translate_strings_sarvam(texts_to_translate, SARVAM_API_KEY)
                    for (obj, key), trans_val in zip(mappings, translated):
                        obj[key] = trans_val
                        
                print("Narration translation to Telugu complete.")
            except Exception as trans_err:
                print(f"Narration translation to Telugu failed: {trans_err}.")
        
        print("Local LLM analysis successful")
        return analysis
    except Exception as exc:
        print(f"Local LLM analysis failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))

@app.post("/upload_pdf")
async def upload_pdf(request: Request):
    global active_doc, active_analyzer
    pdf_bytes = await request.body()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Empty file bytes")
    
    with active_doc_lock:
        try:
            if active_doc is not None:
                active_doc.close()
                active_doc = None
                active_analyzer = None
            
            pdf_path = BASE_DIR / "active_doc.pdf"
            pdf_path.write_bytes(pdf_bytes)
            
            active_doc = fitz.open(str(pdf_path))
            active_analyzer = PDFMetadataAnalyzer(active_doc)
            print(f"Loaded active PDF document: {pdf_path} ({len(pdf_bytes)} bytes, {len(active_doc)} pages)")
            return {"ok": True, "num_pages": len(active_doc)}
        except Exception as e:
            print(f"Failed to load PDF document: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to load PDF: {e}")

@app.get("/page_layout")
def get_page_layout(page: int):
    global active_doc, active_analyzer
    if active_doc is None:
        pdf_path = BASE_DIR / "active_doc.pdf"
        if pdf_path.exists():
            try:
                active_doc = fitz.open(str(pdf_path))
                active_analyzer = PDFMetadataAnalyzer(active_doc)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Failed to open saved PDF: {e}")
        else:
            raise HTTPException(status_code=400, detail="No active PDF document uploaded")
            
    if active_analyzer is None and active_doc is not None:
        active_analyzer = PDFMetadataAnalyzer(active_doc)
    
    if page < 1 or page > len(active_doc):
        raise HTTPException(status_code=400, detail=f"Invalid page number {page}")
    
    with active_doc_lock:
        try:
            page_obj = active_doc[page - 1]
            rect = page_obj.rect
            width = rect.width
            height = rect.height
            
            d = page_obj.get_text("dict")
            
            lines = []
            images = []
            
            for b in d.get("blocks", []):
                if b.get("type") == 0:
                    for l in b.get("lines", []):
                        spans = l.get("spans", [])
                        if not spans:
                            continue
                        
                        line_text = reconstruct_line_text(spans)
                        if not line_text:
                            continue
                            
                        # 1. Filter out repeating headers & footers
                        if active_analyzer and line_text in active_analyzer.running_headers_footers:
                            continue
                            
                        # 2. Filter out page numbers (pure digits/Roman numerals) & "Page X" templates in margins (top/bottom 10%)
                        origin_y = spans[0]["origin"][1]
                        is_margin = (origin_y < height * 0.10) or (origin_y > height * 0.90)
                        
                        if is_margin:
                            # Standalone digits or Roman numerals
                            if re.match(r'^\d+$', line_text) or re.match(r'^[ivxIVX]+$', line_text):
                                continue
                            # Standard page patterns
                            if re.match(r'^(page|slide|p\.)\s*\d+$', line_text, re.IGNORECASE):
                                continue
                        
                        # Recompute coordinates using the helper logic
                        max_font_size = 0.0
                        min_x = float('inf')
                        baseline_y = 0.0
                        
                        for s in spans:
                            max_font_size = max(max_font_size, s["size"])
                            min_x = min(min_x, s["origin"][0])
                            baseline_y = max(baseline_y, height - s["origin"][1])
                        
                        lines.append({
                            "text": line_text,
                            "x": min_x,
                            "y": baseline_y,
                            "fontSize": max_font_size
                        })
                elif b.get("type") == 1:
                    bbox = b.get("bbox")
                    if bbox and b.get("image"):
                        image_bytes = b["image"]
                        ext = b.get("ext", "png")
                        img_base64 = base64.b64encode(image_bytes).decode("utf-8")
                        url = f"data:image/{ext};base64,{img_base64}"
                        images.append({
                            "url": url,
                            "x": bbox[0],
                            "y": height - bbox[3]
                        })
            
            return {
                "width": width,
                "height": height,
                "lines": lines,
                "images": images
            }
        except Exception as e:
            print(f"Failed to extract page layout for page {page}: {e}")
            raise HTTPException(status_code=500, detail=str(e))

@app.post("/transcribe")
async def transcribe_audio(req: TranscribeRequest):
    openai_key = os.environ.get("OPENAI_API_KEY")
    if not openai_key:
        return {
            "text": "",
            "word_boundaries": [],
            "error": "OpenAI API Key is not set in the server environment. Please configure it in your environment variables or server/.env."
        }

    audio_data = req.audio.strip()
    if not audio_data:
        raise HTTPException(status_code=400, detail="Audio base64 data is required")

    try:
        audio_bytes = base64.b64decode(audio_data)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to decode base64 audio: {exc}")

    import tempfile
    ext = os.path.splitext(req.filename)[1] or ".wav"

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        from openai import OpenAI
        print(f"Calling OpenAI Whisper API for file {tmp_path} ({len(audio_bytes)} bytes)...")
        client = OpenAI(api_key=openai_key)

        with open(tmp_path, "rb") as audio_file:
            transcript = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                response_format="verbose_json",
                timestamp_granularities=["word"]
            )

        word_boundaries = []
        words_list = getattr(transcript, "words", []) or []
        for w in words_list:
            if isinstance(w, dict):
                word_text = w.get("word")
                word_start = w.get("start")
                word_end = w.get("end")
            else:
                word_text = getattr(w, "word", None)
                word_start = getattr(w, "start", None)
                word_end = getattr(w, "end", None)

            if word_text is not None and word_start is not None and word_end is not None:
                word_boundaries.append({
                    "text": word_text,
                    "start": float(word_start),
                    "end": float(word_end)
                })

        print(f"Whisper transcription complete: {len(word_boundaries)} words extracted.")
        return {
            "text": getattr(transcript, "text", ""),
            "word_boundaries": word_boundaries
        }
    except Exception as exc:
        print(f"Whisper transcription failed: {exc}")
        return {
            "text": "",
            "word_boundaries": [],
            "error": f"Whisper API call failed: {exc}"
        }
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

def start_model_download() -> None:
    filename, url, model_paths = get_selected_model_info()
    
    for path in model_paths:
        if path.exists():
            print(f"Model already exists at {path}")
            return

    target_dir = Path("C:/Users/eakes/.gemini/antigravity/models")
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / filename

    def download():
        import urllib.request
        try:
            LLMState._model_downloading = True
            print(f"Downloading local LLM model from {url} to {target_path}...")
            urllib.request.urlretrieve(url, str(target_path))
            print("Download completed successfully.")
        except Exception as e:
            print(f"Download failed: {e}")
        finally:
            LLMState._model_downloading = False

    t = threading.Thread(target=download)
    t.daemon = True
    t.start()

if __name__ == "__main__":
    import uvicorn
    print("Starting FastAPI Uvicorn server on port 8765...")
    uvicorn.run("tts_server:app", host="127.0.0.1", port=8765, reload=False)
