import { createContext, useContext, useReducer } from 'react'

const PDFContext = createContext(null)

const initialState = {
  pdfDoc: null,
  toc: [],
  selectedPage: null,
  pageText: '',
  pageOffset: 0,
  ttsState: 'idle',
  language: 'en-US',
  wordIndex: -1,
  voiceProvider: 'cloud',
  voiceName: '',
  theme: 'light',
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_PDF': return { ...state, pdfDoc: action.payload, toc: [], selectedPage: null, pageText: '', pageOffset: 0, ttsState: 'idle', wordIndex: -1 }
    case 'SET_TOC': return { ...state, toc: action.payload }
    case 'SET_PAGE': return { ...state, selectedPage: action.payload, wordIndex: -1 }
    case 'SET_PAGE_TEXT': return { ...state, pageText: action.payload }
    case 'SET_PAGE_OFFSET': return { ...state, pageOffset: action.payload }
    case 'SET_TTS_STATE': return { ...state, ttsState: action.payload }
    case 'SET_LANGUAGE': return { ...state, language: action.payload }
    case 'SET_WORD_INDEX': return { ...state, wordIndex: action.payload }
    case 'SET_VOICE_PROVIDER': return { ...state, voiceProvider: action.payload, ttsState: 'idle', wordIndex: -1 }
    case 'SET_VOICE_NAME': return { ...state, voiceName: action.payload }
    case 'SET_THEME': return { ...state, theme: action.payload }
    default: return state
  }
}

export function PDFProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  return (
    <PDFContext.Provider value={{ state, dispatch }}>
      {children}
    </PDFContext.Provider>
  )
}

export function usePDF() {
  return useContext(PDFContext)
}
