const CUSTOM_TTS_URL = import.meta.env.VITE_TTS_API_URL || 'http://127.0.0.1:8765/tts'

export function getAvailableVoices(language) {
  const voices = window.speechSynthesis.getVoices()
  const normalizedLanguage = language.toLowerCase()
  const baseLanguage = normalizedLanguage.split('-')[0]

  return voices
    .filter((voice) => {
      const voiceLanguage = voice.lang.toLowerCase()
      return voiceLanguage === normalizedLanguage || voiceLanguage.startsWith(baseLanguage)
    })
    .sort((a, b) => Number(b.default) - Number(a.default) || a.name.localeCompare(b.name))
}

export function getPreferredVoice(language, voiceName) {
  const voices = getAvailableVoices(language)

  if (voiceName) {
    const exact = voices.find((voice) => voice.name === voiceName)
    if (exact) {
      return exact
    }
  }

  return voices[0] ?? null
}

export function supportsCloudTTS() {
  return Boolean(CUSTOM_TTS_URL)
}

export async function requestCloudTTS({ text, language, rate = '+0%', voice = '' }) {
  if (!CUSTOM_TTS_URL) {
    throw new Error('Cloud TTS is not configured')
  }

  const response = await fetch(CUSTOM_TTS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text, language, rate, voice }),
  })

  if (!response.ok) {
    throw new Error('Cloud TTS request failed')
  }

  const data = await response.json()
  const binaryString = atob(data.audio)
  const len = binaryString.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  const audioBlob = new Blob([bytes], { type: 'audio/mpeg' })
  const url = URL.createObjectURL(audioBlob)

  return {
    url,
    wordBoundaries: data.word_boundaries || []
  }
}

export async function requestCloudTTSBoundaries({ text, language, rate = '+0%', voice = '' }) {
  if (!CUSTOM_TTS_URL) {
    throw new Error('Cloud TTS is not configured')
  }

  const apiBase = CUSTOM_TTS_URL.endsWith('/tts')
    ? CUSTOM_TTS_URL.slice(0, -4)
    : CUSTOM_TTS_URL

  const response = await fetch(`${apiBase}/tts_boundaries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text, language, rate, voice }),
  })

  if (!response.ok) {
    throw new Error('Cloud TTS boundaries request failed')
  }

  const data = await response.json()
  return data.word_boundaries || []
}

export function getTTSStreamUrl({ text, language, rate = '+0%', voice = '' }) {
  if (!CUSTOM_TTS_URL) return ''
  const apiBase = CUSTOM_TTS_URL.endsWith('/tts')
    ? CUSTOM_TTS_URL.slice(0, -4)
    : CUSTOM_TTS_URL
  return `${apiBase}/tts_stream?text=${encodeURIComponent(text)}&language=${language}&voice=${voice}&rate=${encodeURIComponent(rate)}`
}


