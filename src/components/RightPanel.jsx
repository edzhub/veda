import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePDF } from '../context/PDFContext'
import { extractPagePresentation, extractPageText, fetchSemanticAnalysis, fetchTeluguDeck } from '../utils/pdfUtils'
import { requestCloudTTS, requestCloudTTSBoundaries, getTTSStreamUrl, supportsCloudTTS } from '../utils/speechUtils'
import AIAvatar from './AIAvatar'

function splitWords(text) {
  const words = []
  const regex = /\S+/g
  let match = regex.exec(text)

  while (match) {
    words.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
    match = regex.exec(text)
  }

  return words
}

function alignWords(text, boundaries) {
  const words = []
  let textIdx = 0
  const normalizedText = text.toLowerCase()

  for (const wb of boundaries) {
    if (!wb.text) continue
    const wordText = wb.text.toLowerCase()
    let foundIdx = normalizedText.indexOf(wordText, textIdx)

    if (foundIdx === -1) {
      foundIdx = normalizedText.indexOf(wordText, 0)
    }

    if (foundIdx === -1) {
      foundIdx = textIdx
    }

    let endIdx = foundIdx + wordText.length
    while (endIdx < text.length && !/\s/.test(text[endIdx])) {
      endIdx++
    }

    words.push({
      text: text.slice(foundIdx, endIdx),
      start: wb.start,
      end: wb.end
    })

    textIdx = endIdx
  }

  if (words.length === 0) {
    return splitWords(text)
  }

  return words
}


function getSelectedEntry(toc, selectedPage) {
  if (!toc || toc.length === 0) return null
  const exact = toc.find((item) => item.page === selectedPage)
  if (exact) return exact

  let closest = null
  for (const item of toc) {
    if (item.page <= selectedPage) {
      if (!closest || item.page > closest.page) {
        closest = item
      }
    }
  }
  return closest
}

function getProgressPercent(wordIndex, totalWords) {
  if (!totalWords || wordIndex < 0) {
    return 0
  }

  return Math.min(100, ((wordIndex + 1) / totalWords) * 100)
}

function mergeSemanticDeck(deck, semanticData) {
  if (!semanticData) return deck

  const mergedIsDigest = deck.isDigest || !!semanticData.isDigest
  const mergedTopics =
    (semanticData.isDigest && semanticData.topics)
      ? semanticData.topics.map((t, idx) => ({
        ...t,
        body: t.body || t.summary || '',
        image: deck.topics[idx]?.image || null
      }))
      : deck.topics
  const mergedNarration =
    mergedIsDigest
      ? (semanticData.isDigest && semanticData.narration ? semanticData.narration : deck.narration)
      : semanticData.narration

  const mergedHighlights = mergedIsDigest
    ? (semanticData.isDigest && semanticData.highlights && semanticData.highlights.length > 0
      ? semanticData.highlights
      : mergedTopics.map((t) => `${t.title}: ${t.body || t.summary || ''}`))
    : semanticData.highlights

  const mergedSupportingPoints = mergedIsDigest
    ? (semanticData.isDigest && semanticData.supportingPoints && semanticData.supportingPoints.length > 0
      ? semanticData.supportingPoints
      : mergedTopics.map((t) => t.body || t.summary || ''))
    : semanticData.supportingPoints

  const mergedNarrationTe =
    mergedIsDigest
      ? (semanticData.isDigest && semanticData.narration_te ? semanticData.narration_te : deck.narration_te)
      : semanticData.narration_te

  return {
    ...deck,
    title: semanticData.title,
    subtitle: semanticData.subtitle,
    summary: semanticData.summary,
    highlights: mergedHighlights,
    supportingPoints: mergedSupportingPoints,
    narration: mergedNarration,
    narration_te: mergedNarrationTe,
    topics: mergedTopics,
    isDigest: mergedIsDigest,
    isSemantic: true
  }
}

function getSpeechText(deck, language, pageText, digestTopicIndex = 0) {
  if (!deck) return pageText || ''

  if (deck.isDigest) {
    const topics = deck.topics || []
    const activeTopic = topics[digestTopicIndex]
    if (!activeTopic) return ''

    if (language === 'te-IN') {
      return activeTopic.narration_te
        || `${activeTopic.title || ''}. ${activeTopic.summary || activeTopic.body || ''}`.replace(/\s+/g, ' ').trim()
    }
    const title = activeTopic.title || ''
    const body = activeTopic.summary || activeTopic.body || ''
    return `${title}. ${body}`.replace(/\s+/g, ' ').trim()
  }

  if (language === 'te-IN') {
    return deck.narration_te || deck.narration || pageText || ''
  }
  return deck.narration || pageText || ''
}


function OriginalPageModal({ isOpen, onClose, canvasRef }) {
  const [dataUrl, setDataUrl] = useState('')

  useEffect(() => {
    if (isOpen && canvasRef.current) {
      try {
        setDataUrl(canvasRef.current.toDataURL('image/png'))
      } catch (err) {
        console.error('Error generating page data URL:', err)
      }
    } else {
      setDataUrl('')
    }
  }, [isOpen, canvasRef])

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(12px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '24px',
          padding: '1.25rem',
          maxWidth: '90vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          boxShadow: '0 25px 50px rgba(0,0,0,0.3)',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #eaebed', paddingBottom: '0.5rem' }}>
          <span style={{ fontWeight: 700, color: '#2c2c2c', fontSize: '1.05rem', fontFamily: 'system-ui, sans-serif' }}>Original PDF Page Render</span>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(0,0,0,0.05)',
              border: 'none',
              borderRadius: '50%',
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '0.9rem',
              color: '#555',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#f5f5f5', borderRadius: '12px', padding: '0.5rem' }}>
          {dataUrl ? (
            <img
              src={dataUrl}
              alt="High-resolution PDF Page"
              style={{
                maxWidth: '100%',
                maxHeight: '72vh',
                objectFit: 'contain',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                border: '1px solid #e0e0e0',
              }}
            />
          ) : (
            <p style={{ color: '#666', padding: '2rem' }}>Rendering high-res page...</p>
          )}
        </div>
      </div>
    </div>
  )
}

function EnlargedImageModal({ imageUrl, title, onClose }) {
  const [renderedImageUrl, setRenderedImageUrl] = useState(imageUrl)
  const [renderedTitle, setRenderedTitle] = useState(title)
  const [isClosing, setIsClosing] = useState(false)

  useEffect(() => {
    if (imageUrl) {
      setRenderedImageUrl(imageUrl)
      setRenderedTitle(title)
      setIsClosing(false)
    } else {
      setRenderedImageUrl(null)
      setIsClosing(false)
    }
  }, [imageUrl, title])

  const handleClose = useCallback(() => {
    if (isClosing) return
    setIsClosing(true)
    setTimeout(() => {
      onClose()
    }, 300)
  }, [isClosing, onClose])

  useEffect(() => {
    if (!renderedImageUrl) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [renderedImageUrl, handleClose])

  if (!renderedImageUrl) return null

  return (
    <div
      className={isClosing ? "animate-fade-out-backdrop" : "animate-fade-in-backdrop"}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        cursor: 'zoom-out'
      }}
      onClick={handleClose}
    >
      <button
        onClick={(e) => {
          e.stopPropagation()
          handleClose()
        }}
        style={{
          position: 'absolute',
          top: '24px',
          right: '24px',
          background: 'rgba(255, 255, 255, 0.08)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: '50%',
          width: '44px',
          height: '44px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: '#ffffff',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          zIndex: 2100,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.18)'
          e.currentTarget.style.transform = 'scale(1.08)'
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)'
          e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.35)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
          e.currentTarget.style.transform = 'scale(1)'
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)'
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.25)'
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      <div
        className={isClosing ? "animate-zoom-out-spring" : "animate-zoom-in-spring"}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem',
          maxWidth: '85vw',
          maxHeight: '80vh',
          cursor: 'default'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={renderedImageUrl}
          alt={renderedTitle || "Enlarged view"}
          style={{
            maxWidth: '100%',
            maxHeight: '75vh',
            objectFit: 'contain',
            borderRadius: '20px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 30px 60px rgba(0,0,0,0.6)',
          }}
        />
        {renderedTitle && (
          <span
            style={{
              color: '#ffffff',
              fontSize: '0.88rem',
              fontWeight: 500,
              fontFamily: "'Outfit', sans-serif",
              textAlign: 'center',
              background: 'rgba(20, 20, 20, 0.65)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              padding: '0.5rem 1.25rem',
              borderRadius: '999px',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
              marginTop: '0.4rem',
            }}
          >
            {renderedTitle}
          </span>
        )}
      </div>
    </div>
  )
}

export default function RightPanel() {
  const { state, dispatch } = usePDF()
  const isLight = state.theme === 'light'
  const renderCanvasRef = useRef(null)
  const renderTaskRef = useRef(null)
  const audioRef = useRef(null)
  const objectUrlRef = useRef(null)
  const cloudWordBoundariesRef = useRef([])
  const [cloudMessage, setCloudMessage] = useState('')
  const [pageDeck, setPageDeck] = useState(null)
  const [isPreparing, setIsPreparing] = useState(false)
  const [activeTab, setActiveTab] = useState('takeaways') // 'takeaways' or 'notes'
  const [activeBoundaries, setActiveBoundaries] = useState([])
  const [activeAudio, setActiveAudio] = useState(null)
  const [isOriginalModalOpen, setIsOriginalModalOpen] = useState(false)
  const [enlargedImage, setEnlargedImage] = useState(null)
  const [enlargedTitle, setEnlargedTitle] = useState('')

  // Cache for analysed pages
  const [pageCache, setPageCache] = useState({})
  const pageCacheRef = useRef(pageCache)
  useEffect(() => {
    pageCacheRef.current = pageCache
  }, [pageCache])

  // Clear cache when a new PDF document is uploaded
  useEffect(() => {
    setPageCache({})
  }, [state.pdfDoc])

  // Cache for preloaded audio and boundaries
  const [audioCache, setAudioCache] = useState({})
  const audioCacheRef = useRef(audioCache)
  useEffect(() => {
    audioCacheRef.current = audioCache
  }, [audioCache])

  // Clear audio cache and revoke URLs when a new PDF document is uploaded
  useEffect(() => {
    Object.values(audioCacheRef.current).forEach((item) => {
      if (item?.url && item.url.startsWith('blob:')) {
        URL.revokeObjectURL(item.url)
      }
    })
    setAudioCache({})
  }, [state.pdfDoc])

  const [speechRate, setSpeechRate] = useState('+0%')
  const [selectedVoice, setSelectedVoice] = useState('en-US-AriaNeural')
  const [activeImageIndex, setActiveImageIndex] = useState(0)
  const [digestTopicIndex, setDigestTopicIndex] = useState(0)
  const autoPlayAfterPreloadRef = useRef(false)

  const pageDeckRef = useRef(pageDeck)
  useEffect(() => {
    pageDeckRef.current = pageDeck
  }, [pageDeck])

  const digestTopicIndexRef = useRef(digestTopicIndex)
  useEffect(() => {
    digestTopicIndexRef.current = digestTopicIndex
  }, [digestTopicIndex])

  // Reset selected voice when language changes
  useEffect(() => {
    if (state.language === 'te-IN') {
      setSelectedVoice('te-IN-ShrutiNeural')
    } else {
      setSelectedVoice('en-US-AriaNeural')
    }
  }, [state.language])

  const speechText = useMemo(
    () => getSpeechText(pageDeck, state.language, state.pageText, digestTopicIndex),
    [pageDeck, digestTopicIndex, state.language, state.pageText]
  )

  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [pendingSemanticDeck, setPendingSemanticDeck] = useState(null)
  const ttsStateRef = useRef(state.ttsState)
  const lastWordIndexRef = useRef(-1)
  const activeWordRef = useRef(null)

  const clearCloudAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }

    if (objectUrlRef.current) {
      if (objectUrlRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(objectUrlRef.current)
      }
      objectUrlRef.current = null
    }
    setActiveAudio(null)
  }, [])



  const playPreloaded = useCallback(async (url, wordBoundaries) => {
    try {
      clearCloudAudio()
      dispatch({ type: 'SET_TTS_STATE', payload: 'speaking' })
      dispatch({ type: 'SET_WORD_INDEX', payload: 0 })
      lastWordIndexRef.current = 0
      setActiveBoundaries(wordBoundaries)

      cloudWordBoundariesRef.current = wordBoundaries
      objectUrlRef.current = url
      const audio = new Audio(url)
      audioRef.current = audio
      setActiveAudio(audio)

      audio.onended = () => {
        dispatch({ type: 'SET_TTS_STATE', payload: 'idle' })
        dispatch({ type: 'SET_WORD_INDEX', payload: -1 })
        lastWordIndexRef.current = -1
        setActiveBoundaries([])
        setCloudMessage('Natural voice playback complete')

        if (pageDeckRef.current?.isDigest) {
          const topics = pageDeckRef.current.topics || []
          if (digestTopicIndexRef.current < topics.length - 1) {
            autoPlayAfterPreloadRef.current = true
            setDigestTopicIndex((idx) => idx + 1)
          }
        }
      }

      audio.onpause = () => {
        if (audio.currentTime > 0 && !audio.ended) {
          dispatch({ type: 'SET_TTS_STATE', payload: 'paused' })
        }
      }

      await audio.play()
      setCloudMessage('Natural voice playback active')
    } catch (error) {
      console.error(error)
      dispatch({ type: 'SET_TTS_STATE', payload: 'idle' })
      dispatch({ type: 'SET_WORD_INDEX', payload: -1 })
      setActiveBoundaries([])
      setCloudMessage('Playback failed. Please try again.')
    }
  }, [clearCloudAudio, dispatch])

  const handleStop = useCallback(() => {
    autoPlayAfterPreloadRef.current = false
    clearCloudAudio()
    dispatch({ type: 'SET_TTS_STATE', payload: 'idle' })
    dispatch({ type: 'SET_WORD_INDEX', payload: -1 })
    lastWordIndexRef.current = -1
    setActiveBoundaries([])
    setCloudMessage('')
  }, [clearCloudAudio, dispatch])

  useEffect(() => {
    ttsStateRef.current = state.ttsState
  }, [state.ttsState])

  useEffect(() => {
    if (state.ttsState === 'idle' && pendingSemanticDeck) {
      setPageDeck(pendingSemanticDeck)
      setPendingSemanticDeck(null)
    }
  }, [state.ttsState, pendingSemanticDeck])

  // requestAnimationFrame loop for ultra-smooth sub-20ms word highlighting sync (karaoke lyrics style)
  useEffect(() => {
    let animationFrameId

    function updateProgress() {
      const audio = audioRef.current
      if (audio && !audio.paused && !audio.ended) {
        const currentTime = audio.currentTime
        const boundaries = cloudWordBoundariesRef.current

        if (boundaries && boundaries.length) {
          let currentWordIdx = boundaries.findIndex(
            (wb) => currentTime >= wb.start && currentTime < wb.end
          )

          if (currentWordIdx === -1) {
            currentWordIdx = boundaries.findIndex((wb) => wb.start > currentTime) - 1
            if (currentWordIdx < -1) {
              currentWordIdx = boundaries.length - 1
            }
          }

          if (currentWordIdx >= 0 && currentWordIdx < boundaries.length) {
            if (currentWordIdx !== lastWordIndexRef.current) {
              lastWordIndexRef.current = currentWordIdx
              dispatch({ type: 'SET_WORD_INDEX', payload: currentWordIdx })
            }
          }
        }
      }
      animationFrameId = requestAnimationFrame(updateProgress)
    }

    if (state.ttsState === 'speaking') {
      animationFrameId = requestAnimationFrame(updateProgress)
    }

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
      }
    }
  }, [state.ttsState, dispatch])

  // Smooth scroll active word into view within the scrollable container
  useEffect(() => {
    if (state.wordIndex !== -1 && activeWordRef.current) {
      activeWordRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    }
  }, [state.wordIndex])

  const selectedEntry = useMemo(
    () => getSelectedEntry(state.toc, state.selectedPage),
    [state.toc, state.selectedPage]
  )

  const words = useMemo(() => {
    if (activeBoundaries && activeBoundaries.length) {
      return alignWords(speechText, activeBoundaries)
    }
    return splitWords(speechText)
  }, [speechText, activeBoundaries])
  const progressPercent = getProgressPercent(state.wordIndex, words.length)
  const cloudEnabled = supportsCloudTTS()

  // Reset active image index and digest topic index when pageDeck changes
  useEffect(() => {
    setActiveImageIndex(0)
    setDigestTopicIndex(0)
  }, [pageDeck])

  // Stop playback when page, language, rate, or voice changes
  useEffect(() => {
    handleStop()
  }, [state.selectedPage, state.language, speechRate, selectedVoice, handleStop])

  // Preloading & Speculative Next-Page Caching/Pre-fetching
  useEffect(() => {
    if (!cloudEnabled) return undefined

    let isCancelled = false
    const currentPage = state.selectedPage
    const nextPage = currentPage + 1

    // Helper to get narration text for a deck
    function getNarrationText(deck) {
      return getSpeechText(deck, state.language, deck?.sourceText || '', 0)
    }

    async function runPreload() {
      // 1. First, check/preload CURRENT page audio
      if (speechText) {
        const currentCached = audioCacheRef.current[currentPage]
        const isCurrentMatch =
          currentCached &&
          currentCached.text === speechText &&
          currentCached.language === state.language &&
          currentCached.voice === selectedVoice &&
          currentCached.rate === speechRate

        if (!isCurrentMatch) {
          setCloudMessage('Pre-fetching narration...')
          try {
            const result = await requestCloudTTS({
              text: speechText,
              language: state.language,
              rate: speechRate,
              voice: selectedVoice,
            })
            if (isCancelled) {
              if (result.url) URL.revokeObjectURL(result.url)
              return
            }
            setAudioCache((prev) => ({
              ...prev,
              [currentPage]: {
                url: result.url,
                wordBoundaries: result.wordBoundaries,
                text: speechText,
                language: state.language,
                voice: selectedVoice,
                rate: speechRate,
              },
            }))
            setCloudMessage('Narration pre-fetched')
            if (autoPlayAfterPreloadRef.current) {
              autoPlayAfterPreloadRef.current = false
              playPreloaded(result.url, result.wordBoundaries)
            }
          } catch (error) {
            console.error('Current page preload failed:', error)
            if (!isCancelled) {
              setCloudMessage('Narration pre-fetch failed. Will stream on play.')
            }
          }
        } else {
          setCloudMessage('Narration pre-fetched')
          if (autoPlayAfterPreloadRef.current) {
            autoPlayAfterPreloadRef.current = false
            playPreloaded(currentCached.url, currentCached.wordBoundaries)
          }
        }
      }

      // 2. Next, check if we can speculative-preload the NEXT page
      // [DISABLED TO CONSERVE CREDITS] Speculative preloading of the next page is disabled.
      /*
      if (state.pdfDoc && nextPage <= state.pdfDoc.numPages) {
        let nextDeck = pageCacheRef.current[nextPage]

        // 2a. If next page is not in pageCache, extract and analyze in background
        if (!nextDeck) {
          try {
            console.log(`[Preload] Extracting next page ${nextPage}...`)
            await state.pdfDoc.getPage(nextPage)
            if (isCancelled) return

            const tocEntry = getSelectedEntry(state.toc, nextPage)
            const deck = await extractPagePresentation(
              state.pdfDoc,
              nextPage,
              tocEntry?.title || `Page ${nextPage}`
            )
            if (isCancelled) return

            // Cache the basic deck first
            setPageCache((prev) => ({ ...prev, [nextPage]: deck }))
            nextDeck = deck

            // Trigger background semantic analysis
            console.log(`[Preload] Analysing next page ${nextPage} semantically...`)
            const semanticData = await fetchSemanticAnalysis(deck.sourceText, deck.title, deck.isDigest)
            if (isCancelled) return

            if (semanticData) {
              const mergedIsDigest = deck.isDigest || !!semanticData.isDigest
              const mergedTopics = (semanticData.isDigest && semanticData.topics)
                ? semanticData.topics.map((t, idx) => ({
                  ...t,
                  body: t.body || t.summary || '',
                  image: deck.topics[idx]?.image || null
                }))
                : deck.topics
              const mergedNarration = mergedIsDigest
                ? (semanticData.isDigest && semanticData.narration ? semanticData.narration : deck.narration)
                : semanticData.narration

              const mergedHighlights = mergedIsDigest
                ? (semanticData.isDigest && semanticData.highlights && semanticData.highlights.length > 0
                  ? semanticData.highlights
                  : mergedTopics.map((t) => `${t.title}: ${t.body || t.summary || ''}`))
                : semanticData.highlights

              const mergedSupportingPoints = mergedIsDigest
                ? (semanticData.isDigest && semanticData.supportingPoints && semanticData.supportingPoints.length > 0
                  ? semanticData.supportingPoints
                  : mergedTopics.map((t) => t.body || t.summary || ''))
                : semanticData.supportingPoints

              nextDeck = {
                ...deck,
                title: semanticData.title,
                subtitle: semanticData.subtitle,
                summary: semanticData.summary,
                highlights: mergedHighlights,
                supportingPoints: mergedSupportingPoints,
                narration: mergedNarration,
                topics: mergedTopics,
                isDigest: mergedIsDigest,
                isSemantic: true
              }
              setPageCache((prev) => ({ ...prev, [nextPage]: nextDeck }))
              console.log(`[Preload] Next page ${nextPage} analysis cached`)
            }
          } catch (err) {
            console.error('[Preload] Next page background processing failed:', err)
          }
        }

        // 2b. Now check/preload NEXT page audio
        if (nextDeck) {
          const nextSpeechText = getNarrationText(nextDeck)
          if (nextSpeechText) {
            const nextCached = audioCacheRef.current[nextPage]
            const isNextMatch =
              nextCached &&
              nextCached.text === nextSpeechText &&
              nextCached.language === state.language &&
              nextCached.voice === selectedVoice &&
              nextCached.rate === speechRate

            if (!isNextMatch) {
              try {
                console.log(`[Preload] Pre-fetching audio for next page ${nextPage}...`)
                const result = await requestCloudTTS({
                  text: nextSpeechText,
                  language: state.language,
                  rate: speechRate,
                  voice: selectedVoice,
                })
                if (isCancelled) {
                  if (result.url) URL.revokeObjectURL(result.url)
                  return
                }
                setAudioCache((prev) => ({
                  ...prev,
                  [nextPage]: {
                    url: result.url,
                    wordBoundaries: result.wordBoundaries,
                    text: nextSpeechText,
                    language: state.language,
                    voice: selectedVoice,
                    rate: speechRate,
                  },
                }))
                console.log(`[Preload] Next page ${nextPage} audio cached`)
              } catch (error) {
                console.error('[Preload] Next page audio pre-fetch failed:', error)
              }
            }
          }
        }
      }
      */
    }

    // Wait until current page preparation and analysis are done
    if (!isPreparing && !isAnalyzing) {
      runPreload()
    }

    return () => {
      isCancelled = true
    }
  }, [
    speechText,
    state.selectedPage,
    state.language,
    speechRate,
    selectedVoice,
    state.pdfDoc,
    state.toc,
    isPreparing,
    isAnalyzing,
    playPreloaded,
    cloudEnabled
  ])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearCloudAudio()
    }
  }, [clearCloudAudio])


  useEffect(() => {
    if (!state.pdfDoc || !state.selectedPage) {
      setPageDeck(null)
      setIsAnalyzing(false)
      setPendingSemanticDeck(null)
      setActiveBoundaries([])
      return undefined
    }

    // Return cached page deck instantly if analysis or Telugu translation is complete
    const cacheKey = `${state.selectedPage}_${state.language}`
    const cachedDeck = pageCacheRef.current[cacheKey]
    if (cachedDeck?.isSemantic || cachedDeck?.isTelugu) {
      handleStop()
      dispatch({ type: 'SET_PAGE_TEXT', payload: cachedDeck.sourceText || '' })
      setPageDeck(cachedDeck)
      setIsPreparing(false)
      setIsAnalyzing(false)
      setPendingSemanticDeck(null)
      setActiveBoundaries([])
      return undefined
    }

    // Fast path: translate existing deck to Telugu (works even when local LLM is unavailable)
    if (state.language === 'te-IN') {
      const enCacheKey = `${state.selectedPage}_en-US`
      const sourceDeck = pageCacheRef.current[enCacheKey] || pageDeckRef.current
      if (sourceDeck && (sourceDeck.title || sourceDeck.topics?.length)) {
        let isCancelled = false
        setIsPreparing(false)
        setIsAnalyzing(true)
        setPendingSemanticDeck(null)
        setActiveBoundaries([])
        handleStop()
        setPageDeck(sourceDeck)

        fetchTeluguDeck(sourceDeck)
          .then((translatedDeck) => {
            if (isCancelled || !translatedDeck) {
              setIsAnalyzing(false)
              return
            }
            setIsAnalyzing(false)
            setPageCache((prev) => ({ ...prev, [cacheKey]: translatedDeck }))
            if (ttsStateRef.current === 'idle') {
              setPageDeck(translatedDeck)
            } else {
              setPendingSemanticDeck(translatedDeck)
            }
          })
          .catch((err) => {
            console.error('Telugu translation error:', err)
            setIsAnalyzing(false)
          })

        return () => {
          isCancelled = true
        }
      }
    }

    let isCancelled = false

    async function prepareDeck() {
      setIsPreparing(true)
      setIsAnalyzing(false)
      setPendingSemanticDeck(null)
      setActiveBoundaries([])
      handleStop()

      try {
        const page = await state.pdfDoc.getPage(state.selectedPage)
        const canvas = renderCanvasRef.current

        if (!canvas || isCancelled) {
          return
        }

        // Cancel any in-progress render task before starting a new one
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel()
          renderTaskRef.current = null
        }

        const viewport = page.getViewport({ scale: 1.45 })
        canvas.width = viewport.width
        canvas.height = viewport.height

        const context = canvas.getContext('2d')
        const renderTask = page.render({ canvasContext: context, viewport })
        renderTaskRef.current = renderTask
        try {
          await renderTask.promise
        } catch (renderErr) {
          // RenderingCancelledException is expected when we cancel mid-render — ignore it
          if (renderErr?.name === 'RenderingCancelledException') return
          throw renderErr
        }
        renderTaskRef.current = null

        if (isCancelled) {
          return
        }

        const pageText = await extractPageText(state.pdfDoc, state.selectedPage)
        const deck = await extractPagePresentation(
          state.pdfDoc,
          state.selectedPage,
          selectedEntry?.title || `Page ${state.selectedPage}`
        )

        if (isCancelled) {
          return
        }

        dispatch({ type: 'SET_PAGE_TEXT', payload: pageText })
        setPageDeck(deck)
        setIsPreparing(false)

        // Kick off semantic analysis in the background
        setIsAnalyzing(true)
        fetchSemanticAnalysis(deck.sourceText, deck.title, deck.isDigest, state.language)
          .then(async (semanticData) => {
            if (isCancelled) return

            let finalDeck = null
            if (semanticData) {
              finalDeck = mergeSemanticDeck(deck, semanticData)
            } else if (state.language === 'te-IN') {
              finalDeck = await fetchTeluguDeck(deck)
            }

            setIsAnalyzing(false)
            if (!finalDeck || isCancelled) return

            const semanticCacheKey = `${state.selectedPage}_${state.language}`
            setPageCache((prev) => ({ ...prev, [semanticCacheKey]: finalDeck }))

            if (ttsStateRef.current === 'idle') {
              setPageDeck(finalDeck)
            } else {
              setPendingSemanticDeck(finalDeck)
            }
          })
          .catch((err) => {
            console.error('Background analysis error:', err)
            setIsAnalyzing(false)
          })
      } catch (error) {
        console.error(error)
        if (!isCancelled) {
          setIsPreparing(false)
        }
      }
    }

    prepareDeck()

    return () => {
      isCancelled = true
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
        renderTaskRef.current = null
      }
    }
  }, [dispatch, selectedEntry?.title, state.pdfDoc, state.selectedPage, state.language, handleStop])

  function handleLanguageChange(language) {
    dispatch({ type: 'SET_LANGUAGE', payload: language })
  }

  async function handleCloudPlay() {
    if (!speechText || !cloudEnabled) {
      return
    }

    if (state.ttsState === 'paused' && audioRef.current) {
      try {
        await audioRef.current.play()
        dispatch({ type: 'SET_TTS_STATE', payload: 'speaking' })
        setCloudMessage('Natural voice playback active')
      } catch (error) {
        console.error(error)
      }
      return
    }

    // 1. Check if the audio is in audioCache
    const cached = audioCache[state.selectedPage]
    const isCachedMatch =
      cached &&
      cached.text === speechText &&
      cached.language === state.language &&
      cached.voice === selectedVoice &&
      cached.rate === speechRate

    if (isCachedMatch) {
      console.log(`[Play] Using cached audio for page ${state.selectedPage}`)
      playPreloaded(cached.url, cached.wordBoundaries)
      return
    }

    // 2. If not cached, fall back to streaming
    try {
      setCloudMessage('Streaming natural voice...')
      dispatch({ type: 'SET_TTS_STATE', payload: 'speaking' })
      dispatch({ type: 'SET_WORD_INDEX', payload: 0 })

      const streamUrl = getTTSStreamUrl({
        text: speechText,
        language: state.language,
        rate: speechRate,
        voice: selectedVoice,
      })

      // Start playing the stream immediately (100ms start time)
      playPreloaded(streamUrl, [])

      // Fetch word boundaries in parallel to sync highlights
      requestCloudTTSBoundaries({
        text: speechText,
        language: state.language,
        rate: speechRate,
        voice: selectedVoice,
      }).then((boundaries) => {
        // Ensure that this response still applies to the active audio stream
        if (audioRef.current && audioRef.current.src === streamUrl) {
          console.log(`[Streaming] Boundaries loaded for streaming: ${boundaries.length} words`)
          cloudWordBoundariesRef.current = boundaries
          setActiveBoundaries(boundaries)
        }
      }).catch((err) => {
        console.error('Failed to load streaming boundaries:', err)
      })

    } catch (error) {
      console.error(error)
      dispatch({ type: 'SET_TTS_STATE', payload: 'idle' })
      dispatch({ type: 'SET_WORD_INDEX', payload: -1 })
      setActiveBoundaries([])
      setCloudMessage('Cloud voice is unavailable. Start the local TTS server, then try again.')
      clearCloudAudio()
    }
  }


  function handlePlay() {
    handleCloudPlay()
  }

  function handlePause() {
    if (audioRef.current && state.ttsState === 'speaking') {
      audioRef.current.pause()
      dispatch({ type: 'SET_TTS_STATE', payload: 'paused' })
    }
  }



  function handleWordClick(index) {
    const boundaries = cloudWordBoundariesRef.current
    if (audioRef.current && boundaries && boundaries[index]) {
      const time = boundaries[index].start
      audioRef.current.currentTime = time
      lastWordIndexRef.current = index
      dispatch({ type: 'SET_WORD_INDEX', payload: index })
      if (state.ttsState !== 'speaking') {
        audioRef.current.play().then(() => {
          dispatch({ type: 'SET_TTS_STATE', payload: 'speaking' })
        })
      }
    }
  }

  function handleProgressBarClick(e) {
    const bar = e.currentTarget
    const rect = bar.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const percent = Math.max(0, Math.min(100, (clickX / rect.width) * 100))
    if (audioRef.current && audioRef.current.duration) {
      const targetTime = (percent / 100) * audioRef.current.duration
      audioRef.current.currentTime = targetTime

      const boundaries = cloudWordBoundariesRef.current
      if (boundaries.length) {
        let wordIdx = boundaries.findIndex((wb) => targetTime >= wb.start && targetTime < wb.end)
        if (wordIdx === -1) {
          wordIdx = boundaries.findIndex((wb) => wb.start > targetTime) - 1
          if (wordIdx < -1) wordIdx = boundaries.length - 1
        }
        if (wordIdx >= 0 && wordIdx < boundaries.length) {
          lastWordIndexRef.current = wordIdx
          dispatch({ type: 'SET_WORD_INDEX', payload: wordIdx })
        }
      }
    }
  }

  function renderNarrationScript() {
    if (!words.length) {
      return null
    }

    const isPlayingOrPaused = state.ttsState === 'speaking' || state.ttsState === 'paused'

    return (
      <div
        style={{
          lineHeight: '1.75',
          fontSize: '0.98rem',
          fontFamily: "'Inter', system-ui, sans-serif",
          letterSpacing: '-0.01em',
          wordSpacing: '0.04em',
          color: isLight ? '#2c2c2c' : '#ddd8ca',
          padding: '0.5rem',
        }}
      >
        {words.map((word, index) => {
          const isActive = state.wordIndex === index
          const isPast = state.wordIndex > index && state.wordIndex !== -1

          const textColor = isLight
            ? (isActive
              ? '#111111'
              : isPast
                ? '#b45309'
                : isPlayingOrPaused
                  ? 'rgba(0, 0, 0, 0.28)'
                  : '#333333')
            : (isActive
              ? '#ffffff'
              : isPast
                ? '#f5a623'
                : isPlayingOrPaused
                  ? 'rgba(255, 255, 255, 0.22)'
                  : '#ddd8ca')

          const textShadow = isActive
            ? (isLight ? 'none' : '0 0 15px rgba(255,255,255,0.7), 0 0 2px rgba(255,255,255,0.9)')
            : 'none'
          const transformScale = isActive ? 'scale(1.08)' : 'scale(1.0)'

          return (
            <span
              key={`${word.start}-${word.text}`}
              ref={isActive ? activeWordRef : null}
              onClick={() => handleWordClick(index)}
              className="karaoke-word"
              style={{
                display: 'inline-block',
                marginRight: isActive ? '0.12rem' : '0.32rem',
                color: textColor,
                textShadow: textShadow,
                transform: transformScale,
                fontWeight: isActive ? '700' : isPast ? '600' : '400',
                transition: 'all 240ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                cursor: 'pointer',
                backgroundColor: isActive
                  ? (isLight ? 'rgba(217, 119, 6, 0.14)' : 'rgba(255, 255, 255, 0.15)')
                  : 'transparent',
                borderRadius: '6px',
                padding: isActive ? '0px 6px' : '0px 2px',
                '--word-hover-color': isLight ? '#d97706' : '#ffd27a',
              }}
            >
              {word.text}
            </span>
          )
        })}
      </div>
    )
  }


  // Dynamic Theme Color Palette
  const bgMain = isLight ? '#faf9f6' : '#0b0c10'
  const bgHeader = isLight
    ? 'linear-gradient(180deg, #ffffff 0%, #faf9f6 100%)'
    : 'linear-gradient(180deg, #13151a 0%, #0d0f12 100%)'
  const borderHeader = isLight ? '#eaebed' : '#1e222b'
  const textPrimary = isLight ? '#2c2c2c' : '#f4f0e7'
  const textSecondary = isLight ? '#666666' : '#888880'

  const badgeBg = isLight ? 'rgba(217,119,6,0.06)' : 'rgba(245,166,35,0.16)'
  const badgeText = isLight ? '#d97706' : '#f5a623'
  const badgeBorder = isLight ? '1px solid rgba(217,119,6,0.12)' : '1px solid rgba(245,166,35,0.2)'
  const progressBarBg = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)'

  const cardBg = isLight ? '#ffffff' : '#13151a'
  const cardBorder = isLight ? '1px solid #eaebed' : '1px solid rgba(245,166,35,0.08)'
  const cardShadow = isLight ? '0 12px 30px rgba(0,0,0,0.02)' : '0 22px 50px rgba(0,0,0,0.28)'

  const studioBg = isLight ? 'linear-gradient(180deg, #ffffff 0%, #fcfbf9 100%)' : 'linear-gradient(180deg, #13151a 0%, #0d0f12 100%)'
  const studioBorder = isLight ? '1px solid #eaebed' : '1px solid #1e222b'

  const emptyStateBg = isLight
    ? 'radial-gradient(circle at top, rgba(217,119,6,0.04), rgba(255,255,255,0.98) 70%)'
    : 'radial-gradient(circle at top, rgba(245,166,35,0.08), rgba(11,12,16,0.92) 50%)'

  const themeColor = isLight ? '#d97706' : '#f5a623'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100vh', overflow: 'hidden', background: bgMain, transition: 'background 0.3s ease', position: 'relative' }}>
      <canvas ref={renderCanvasRef} style={{ display: 'none' }} />

      {/* Original PDF Page modal overlay */}
      <OriginalPageModal isOpen={isOriginalModalOpen} onClose={() => setIsOriginalModalOpen(false)} canvasRef={renderCanvasRef} />

      {/* Enlarged Image modal overlay */}
      <EnlargedImageModal imageUrl={enlargedImage} title={enlargedTitle} onClose={() => setEnlargedImage(null)} />

      {/* Top Header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1rem 1.5rem',
          borderBottom: `1px solid ${borderHeader}`,
          background: bgHeader,
          flexShrink: 0,
          transition: 'background 0.3s ease, border-color 0.3s ease',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.22rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: '0.7rem',
                padding: '0.25rem 0.55rem',
                borderRadius: '999px',
                background: badgeBg,
                color: badgeText,
                border: badgeBorder,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontWeight: 700,
              }}
            >
              Presentation View
            </span>
          </div>

          <span style={{ color: textPrimary, fontSize: '1.25rem', fontWeight: 800, fontFamily: 'Outfit, sans-serif' }}>
            {pageDeck?.title || selectedEntry?.title || 'Select a topic from the contents'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Page navigation controls */}
          {state.selectedPage && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              background: isLight ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.03)',
              padding: '0.3rem 0.6rem',
              borderRadius: '12px',
              border: isLight ? '1px solid rgba(0,0,0,0.06)' : '1px solid rgba(255,255,255,0.08)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              boxShadow: isLight ? '0 2px 8px rgba(0, 0, 0, 0.03)' : '0 4px 12px rgba(0, 0, 0, 0.15)'
            }}>
              <button
                onClick={() => {
                  if (state.selectedPage > 1) {
                    dispatch({ type: 'SET_PAGE', payload: state.selectedPage - 1 })
                  }
                }}
                disabled={state.selectedPage <= 1}
                className="glass-btn"
                style={{
                  background: isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)',
                  color: isLight ? '#2c2c2c' : '#ffffff',
                  border: isLight ? '1px solid rgba(0,0,0,0.04)' : '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '8px',
                  width: '26px',
                  height: '26px',
                  fontSize: '0.6rem',
                }}
                onMouseEnter={(e) => {
                  if (state.selectedPage > 1) {
                    e.currentTarget.style.background = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)'
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)'
                }}
                title="Previous Page"
              >
                ◀
              </button>

              <span style={{ color: textPrimary, fontSize: '0.78rem', fontWeight: 700, minWidth: '95px', textAlign: 'center', fontFamily: "'Outfit', sans-serif" }}>
                Page {state.selectedPage}
                {state.pageOffset && (state.selectedPage - state.pageOffset > 0)
                  ? ` (P. ${state.selectedPage - state.pageOffset})`
                  : ''}
              </span>

              <button
                onClick={() => {
                  if (state.pdfDoc && state.selectedPage < state.pdfDoc.numPages) {
                    dispatch({ type: 'SET_PAGE', payload: state.selectedPage + 1 })
                  }
                }}
                disabled={!state.pdfDoc || state.selectedPage >= state.pdfDoc.numPages}
                className="glass-btn"
                style={{
                  background: isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)',
                  color: isLight ? '#2c2c2c' : '#ffffff',
                  border: isLight ? '1px solid rgba(0,0,0,0.04)' : '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '8px',
                  width: '26px',
                  height: '26px',
                  fontSize: '0.6rem',
                }}
                onMouseEnter={(e) => {
                  if (state.pdfDoc && state.selectedPage < state.pdfDoc.numPages) {
                    e.currentTarget.style.background = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)'
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)'
                }}
                title="Next Page"
              >
                ▶
              </button>
            </div>
          )}

          {/* Sun/Moon Theme Switcher */}
          <button
            onClick={() => dispatch({ type: 'SET_THEME', payload: isLight ? 'dark' : 'light' })}
            className="glass-btn"
            style={{
              fontSize: '0.9rem',
              borderRadius: '50%',
              background: isLight ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.05)',
              color: isLight ? '#2c2c2c' : '#cfc6b1',
              border: isLight ? '1px solid rgba(0, 0, 0, 0.06)' : '1px solid rgba(255, 255, 255, 0.08)',
              width: '34px',
              height: '34px',
              boxShadow: isLight ? '0 2px 8px rgba(0, 0, 0, 0.04)' : '0 4px 12px rgba(0, 0, 0, 0.15)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = isLight ? 'rgba(255, 255, 255, 0.65)' : 'rgba(255, 255, 255, 0.12)';
              e.currentTarget.style.borderColor = isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.2)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = isLight ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.05)';
              e.currentTarget.style.borderColor = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.08)';
            }}
            title={isLight ? "Toggle Dark Mode" : "Toggle Light Mode"}
          >
            {isLight ? '🌙' : '☀️'}
          </button>
        </div>
      </div>

      {/* Main dashboard body */}
      <div style={{ flex: 1, display: 'flex', gap: '1.5rem', padding: '1.5rem 1.5rem 0 1.5rem', overflow: 'hidden', minHeight: 0 }}>
        {!state.selectedPage ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 1,
              gap: '1rem',
              borderRadius: '30px',
              border: isLight ? '1px solid #eaebed' : '1px solid #1e222b',
              background: emptyStateBg,
              marginBottom: '1.5rem',
            }}
          >
            <div style={{ fontSize: '3.4rem' }}>🎙️</div>
            <p style={{ color: isLight ? '#2c2c2c' : '#f3efe6', fontWeight: 700, fontSize: '1.15rem' }}>Nothing selected yet</p>
            <p style={{ color: '#888880', fontSize: '0.85rem' }}>Pick a topic from the table of contents and Veda will present it</p>
          </div>
        ) : (
          <>
            {/* Slide Stage Area (60% width) */}
            <div
              style={{
                flex: '0 0 60%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                paddingBottom: '7.5rem',
                height: '100%',
                minHeight: 0,
              }}
            >
              <div
                key={state.selectedPage}
                className="animate-fade-in-up"
                style={{
                  flex: 1,
                  width: '100%',
                  position: 'relative',
                  borderRadius: '24px',
                  border: cardBorder,
                  background: cardBg,
                  boxShadow: cardShadow,
                  padding: '1.5rem 1.75rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  transition: 'all 0.3s ease',
                  overflow: 'hidden',
                  minHeight: 0,
                }}
              >
                {/* Badge overlay indicating status */}
                <div style={{ position: 'absolute', top: '1rem', right: '1.25rem', fontSize: '0.68rem', color: textSecondary, fontWeight: 600 }}>
                  {isPreparing
                    ? 'Preparing page...'
                    : isAnalyzing
                      ? '🤖 Veda is analyzing text...'
                      : pageDeck?.isSemantic
                        ? '✨ AI Refined Presentation'
                        : 'Visual reconstructed'}
                </div>

                {pageDeck?.isDigest ? (
                  // ── Digest carousel: one story at a time ─────────────────
                  (() => {
                    const topics = pageDeck.topics || []
                    const total = topics.length
                    const activeTopic = topics[digestTopicIndex] || {}
                    const topicImage = activeTopic.image || null
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%', height: '100%', minHeight: 0 }}>

                        {/* Header row: section title + story counter */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <h2 style={{ margin: 0, color: isLight ? '#111111' : '#fff7ea', fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                              {pageDeck.title || selectedEntry?.title}
                            </h2>
                            <span style={{
                              fontSize: '0.62rem', padding: '0.18rem 0.5rem', borderRadius: '999px',
                              background: `${themeColor}22`, color: themeColor,
                              border: `1px solid ${themeColor}44`, fontWeight: 700,
                              letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
                            }}>
                              {total} stories
                            </span>
                          </div>
                        </div>

                        {/* Active story content */}
                        {/* Active story content */}
                        <div
                          key={digestTopicIndex}
                          className="animate-story-fade-in"
                          style={{
                            flex: 1, minHeight: 0,
                            display: 'grid',
                            gridTemplateColumns: topicImage ? '1fr 0.75fr' : '1fr',
                            gap: '1rem',
                            alignItems: 'start',
                          }}
                        >
                          {/* Story text */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', overflowY: 'auto', maxHeight: '100%', paddingRight: '0.3rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                              <span style={{ fontSize: '0.62rem', fontWeight: 700, color: themeColor, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Story {digestTopicIndex + 1}</span>
                              <span style={{ width: '20px', height: '1px', background: `${themeColor}66` }} />
                            </div>
                            <h3 style={{ margin: 0, color: isLight ? '#111111' : '#fff7ea', fontSize: '1.25rem', fontWeight: 800, lineHeight: 1.25, letterSpacing: '-0.02em' }}>
                              {activeTopic.title}
                            </h3>
                            {(activeTopic.body || activeTopic.summary) && (
                              <p style={{ margin: '0.2rem 0 0 0', color: isLight ? '#444444' : '#c8bfad', fontSize: '0.84rem', lineHeight: 1.65 }}>
                                {activeTopic.body || activeTopic.summary}
                              </p>
                            )}
                          </div>

                          {/* Per-topic image */}
                          {topicImage && (
                            <div
                              onClick={() => { setEnlargedImage(topicImage); setEnlargedTitle(activeTopic.title); }}
                              style={{
                                borderRadius: '14px', overflow: 'hidden',
                                border: isLight ? '1px solid #eaebed' : '1px solid rgba(255,255,255,0.06)',
                                background: isLight ? '#f8f8f6' : '#0c0d10',
                                boxShadow: isLight ? '0 4px 16px rgba(0,0,0,0.04)' : '0 8px 24px rgba(0,0,0,0.3)',
                                aspectRatio: '4/3', width: '100%',
                                cursor: 'zoom-in',
                                transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'scale(1.025)'
                                e.currentTarget.style.boxShadow = isLight 
                                  ? '0 12px 30px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.02)' 
                                  : '0 16px 40px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.2)'
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'scale(1)'
                                e.currentTarget.style.boxShadow = isLight 
                                  ? '0 4px 16px rgba(0,0,0,0.04)' 
                                  : '0 8px 24px rgba(0,0,0,0.3)'
                              }}
                            >
                              <img src={topicImage} alt={activeTopic.title} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                            </div>
                          )}
                        </div>

                        {/* Digest Controls: Prev Arrow + Dots + Counter + Next Arrow */}
                        <div
                          className="animate-nav-slide-up"
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.25rem', flexShrink: 0, marginTop: '0.8rem' }}
                        >
                          <button
                            onClick={() => { handleStop(); setDigestTopicIndex((i) => Math.max(0, i - 1)); }}
                            disabled={digestTopicIndex === 0}
                            className="glass-btn digest-nav-btn prev"
                            style={{
                              background: digestTopicIndex === 0
                                ? (isLight ? 'rgba(0, 0, 0, 0.02)' : 'rgba(255,255,255,0.04)')
                                : (isLight ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255,255,255,0.08)'),
                              border: digestTopicIndex === 0
                                ? (isLight ? '1px solid rgba(0,0,0,0.04)' : '1px solid rgba(255,255,255,0.05)')
                                : (isLight ? '1px solid rgba(0, 0, 0, 0.06)' : '1px solid rgba(255, 255, 255, 0.08)'),
                              color: digestTopicIndex === 0 ? (isLight ? '#ccc' : '#555') : (isLight ? '#2c2c2c' : '#ffffff'),
                              boxShadow: digestTopicIndex === 0 ? 'none' : (isLight ? '0 2px 6px rgba(0,0,0,0.03)' : '0 4px 12px rgba(0,0,0,0.2)'),
                              fontSize: '0.9rem',
                              width: '32px',
                              height: '32px',
                              borderRadius: '10px',
                            }}
                          >‹</button>

                          {/* Dot indicators */}
                          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                            {topics.map((_, idx) => (
                              <button
                                key={idx}
                                onClick={() => { handleStop(); setDigestTopicIndex(idx); }}
                                className={`digest-dot ${idx === digestTopicIndex ? 'active' : ''}`}
                                style={{
                                  width: idx === digestTopicIndex ? '20px' : '6px',
                                  background: idx === digestTopicIndex ? themeColor : (isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.15)'),
                                  border: idx === digestTopicIndex ? 'none' : (isLight ? '1px solid rgba(0,0,0,0.05)' : '1px solid rgba(255,255,255,0.08)'),
                                  backdropFilter: idx === digestTopicIndex ? 'none' : 'blur(4px)',
                                  WebkitBackdropFilter: idx === digestTopicIndex ? 'none' : 'blur(4px)',
                                }}
                              />
                            ))}
                          </div>

                          <span style={{ fontSize: '0.75rem', color: textSecondary, fontWeight: 700, minWidth: '40px', textAlign: 'center', fontFamily: 'Outfit, sans-serif' }}>
                            {digestTopicIndex + 1} / {total}
                          </span>

                          <button
                            onClick={() => { handleStop(); setDigestTopicIndex((i) => Math.min(total - 1, i + 1)); }}
                            disabled={digestTopicIndex === total - 1}
                            className="glass-btn digest-nav-btn next"
                            style={{
                              background: digestTopicIndex === total - 1
                                ? (isLight ? 'rgba(0, 0, 0, 0.02)' : 'rgba(255,255,255,0.04)')
                                : (isLight ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255,255,255,0.08)'),
                              border: digestTopicIndex === total - 1
                                ? (isLight ? '1px solid rgba(0,0,0,0.04)' : '1px solid rgba(255,255,255,0.05)')
                                : (isLight ? '1px solid rgba(0, 0, 0, 0.06)' : '1px solid rgba(255, 255, 255, 0.08)'),
                              color: digestTopicIndex === total - 1 ? (isLight ? '#ccc' : '#555') : (isLight ? '#2c2c2c' : '#ffffff'),
                              boxShadow: digestTopicIndex === total - 1 ? 'none' : (isLight ? '0 2px 6px rgba(0,0,0,0.03)' : '0 4px 12px rgba(0,0,0,0.2)'),
                              fontSize: '0.9rem',
                              width: '32px',
                              height: '32px',
                              borderRadius: '10px',
                            }}
                          >›</button>
                        </div>
                      </div>
                    )
                  })()
                ) : pageDeck?.images?.length > 0 ? (
                  // ── Split layout: text explainer + extracted image ─────────────────
                  <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: '1.5rem', alignItems: 'center', width: '100%', height: '100%', minHeight: 0 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', overflowY: 'auto', maxHeight: '100%', paddingRight: '0.4rem' }}>
                      <h2 style={{ margin: 0, color: isLight ? '#111111' : '#fff7ea', fontSize: '1.65rem', lineHeight: 1.25, fontWeight: 800, letterSpacing: '-0.02em' }}>
                        {pageDeck?.title || selectedEntry?.title}
                      </h2>
                      {pageDeck?.subtitle && (
                        <p style={{ color: themeColor, fontSize: '0.94rem', lineHeight: 1.35, margin: 0, fontWeight: 600 }}>
                          {pageDeck.subtitle}
                        </p>
                      )}
                      {pageDeck?.summary && (
                        <p style={{ color: isLight ? '#444444' : '#ccc2b2', fontSize: '0.88rem', lineHeight: 1.6, margin: '0.4rem 0 0 0' }}>
                          {pageDeck.summary}
                        </p>
                      )}
                    </div>

                    {/* Extracted high-res image box */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', alignItems: 'center', height: '100%', justifyContent: 'center', minHeight: 0 }}>
                      <div
                        onClick={() => { setEnlargedImage(pageDeck.images[activeImageIndex]); setEnlargedTitle(pageDeck.title || selectedEntry?.title); }}
                        style={{
                          position: 'relative',
                          width: '100%',
                          height: '180px',
                          borderRadius: '16px',
                          overflow: 'hidden',
                          border: isLight ? '1px solid #eaebed' : '1px solid rgba(255,255,255,0.05)',
                          background: isLight ? '#fcfcfa' : '#090a0d',
                          boxShadow: isLight ? '0 4px 18px rgba(0,0,0,0.03)' : '0 8px 24px rgba(0,0,0,0.3)',
                          cursor: 'zoom-in',
                          transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'scale(1.025)'
                          e.currentTarget.style.boxShadow = isLight 
                            ? '0 12px 30px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.02)' 
                            : '0 16px 40px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.2)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'scale(1)'
                          e.currentTarget.style.boxShadow = isLight 
                            ? '0 4px 18px rgba(0,0,0,0.03)' 
                            : '0 8px 24px rgba(0,0,0,0.3)'
                        }}
                      >
                        <img
                          src={pageDeck.images[activeImageIndex]}
                          alt="Extracted illustration"
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'contain',
                            display: 'block',
                          }}
                        />
                      </div>

                      {pageDeck.images.length > 1 && (
                        <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'center' }}>
                          {pageDeck.images.map((img, idx) => (
                            <button
                              key={idx}
                              onClick={() => setActiveImageIndex(idx)}
                              style={{
                                width: '28px',
                                height: '28px',
                                borderRadius: '6px',
                                overflow: 'hidden',
                                border: activeImageIndex === idx ? `2px solid ${themeColor}` : (isLight ? '1px solid #eaebed' : '1px solid rgba(255,255,255,0.1)'),
                                padding: 0,
                                cursor: 'pointer',
                                background: 'transparent',
                                transition: 'all 0.2s ease',
                              }}
                            >
                              <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  // ── Text-only single topic layout ──────────────────────────────────
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxWidth: '85%', overflowY: 'auto', maxHeight: '100%', paddingRight: '0.4rem' }}>
                    <h2 style={{ margin: 0, color: isLight ? '#111111' : '#fff7ea', fontSize: '1.9rem', lineHeight: 1.2, fontWeight: 800, letterSpacing: '-0.02em' }}>
                      {pageDeck?.title || selectedEntry?.title}
                    </h2>
                    {pageDeck?.subtitle && (
                      <p style={{ color: themeColor, fontSize: '1.05rem', lineHeight: 1.4, margin: 0, fontWeight: 600 }}>
                        {pageDeck.subtitle}
                      </p>
                    )}
                    {pageDeck?.summary && (
                      <p style={{ color: isLight ? '#444444' : '#e6dccb', fontSize: '0.94rem', lineHeight: 1.6, margin: '0.6rem 0 0 0' }}>
                        {pageDeck.summary}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Interaction Sidebar (40% width) */}
            <div
              key={state.selectedPage}
              className="animate-slide-in-right"
              style={{
                flex: '0 0 40%',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem',
                height: '100%',
                paddingBottom: '7.5rem',
                minHeight: 0,
              }}
            >
              {/* Tabbed Insights Card */}
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  borderRadius: '24px',
                  background: cardBg,
                  border: cardBorder,
                  overflow: 'hidden',
                  boxShadow: cardShadow,
                  transition: 'all 0.3s ease',
                  minHeight: 0,
                }}
              >
                {/* Tab Header Selector */}
                <div
                  style={{
                    display: 'flex',
                    background: isLight ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.03)',
                    border: isLight ? '1px solid rgba(0, 0, 0, 0.05)' : '1px solid rgba(255, 255, 255, 0.05)',
                    borderRadius: '999px',
                    margin: '0.75rem 1rem 0.25rem 1rem',
                    padding: '3px',
                    gap: '4px',
                    transition: 'all 0.3s ease',
                  }}
                >
                  {[
                    { id: 'takeaways', label: 'TAKEAWAYS' },
                    { id: 'notes', label: 'NOTES' },
                    { id: 'source', label: 'SOURCE' },
                  ].map((tab) => {
                    const isActive = activeTab === tab.id
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className="glass-btn"
                        style={{
                          flex: 1,
                          padding: '0.5rem 1rem',
                          fontSize: '0.7rem',
                          letterSpacing: '0.05em',
                          border: 'none',
                          borderRadius: '999px',
                          background: isActive ? (isLight ? '#ffffff' : 'rgba(255, 255, 255, 0.08)') : 'transparent',
                          color: isActive ? (isLight ? '#111111' : '#ffffff') : '#888880',
                          boxShadow: isActive ? (isLight ? '0 2px 8px rgba(0,0,0,0.06)' : '0 4px 12px rgba(0,0,0,0.25)') : 'none',
                          backdropFilter: isActive ? 'blur(8px)' : 'none',
                          WebkitBackdropFilter: isActive ? 'blur(8px)' : 'none',
                        }}
                      >
                        {tab.label}
                      </button>
                    )
                  })}
                </div>

                {/* Tab Content Body */}
                <div style={{ padding: '1rem', flex: 1, overflowY: 'auto', minHeight: 0 }}>
                  {activeTab === 'takeaways' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                      {(!pageDeck?.highlights || pageDeck.highlights.length === 0) ? (
                        <p style={{ color: '#888880', fontSize: '0.85rem', margin: 0 }}>No takeaways generated for this page.</p>
                      ) : (
                        pageDeck.highlights.map((highlight, index) => (
                          <div
                            key={`${highlight}-${index}`}
                            style={{
                              padding: '0.75rem 1rem',
                              borderRadius: '12px',
                              background: isLight ? 'rgba(217, 119, 6, 0.02)' : 'linear-gradient(180deg, rgba(245,166,35,0.06), rgba(255,255,255,0.015))',
                              border: isLight ? '1px solid rgba(217, 119, 6, 0.08)' : '1px solid rgba(245,166,35,0.07)',
                              color: isLight ? '#333333' : '#e6decd',
                              lineHeight: 1.6,
                              fontSize: '0.86rem',
                              transition: 'all 0.3s ease',
                            }}
                          >
                            {highlight}
                          </div>
                        ))
                      )}
                    </div>
                  ) : activeTab === 'notes' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {(!pageDeck?.supportingPoints || pageDeck.supportingPoints.length === 0) ? (
                        <p style={{ color: '#888880', fontSize: '0.85rem', margin: 0 }}>No detailed notes found for this page.</p>
                      ) : (
                        pageDeck.supportingPoints.map((point, index) => (
                          <div key={`${point}-${index}`} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                            <span style={{ color: themeColor, fontWeight: 700, fontSize: '0.86rem', paddingTop: '0.08rem' }}>
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            <span style={{ color: isLight ? '#444444' : '#d7d1c2', fontSize: '0.86rem', lineHeight: 1.65 }}>
                              {point}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  ) : (
                    // Raw extracted source text panel
                    <div style={{ color: isLight ? '#444444' : '#cfc8ba', fontSize: '0.85rem', lineHeight: 1.7, padding: '0.2rem' }}>
                      {pageDeck?.sourceText || 'No extractable text found on this page.'}
                    </div>
                  )}
                </div>
              </div>

              {/* Live Karaoke Narration Card */}
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '1.25rem',
                  borderRadius: '24px',
                  border: studioBorder,
                  background: studioBg,
                  transition: 'all 0.3s ease',
                  overflow: 'hidden',
                  minHeight: 0,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: isLight ? '1px solid #eaebed' : '1px solid #1e222b', paddingBottom: '0.6rem', marginBottom: '0.75rem', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ color: themeColor, fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>
                      AI Narration
                    </span>
                  </div>
                  <span style={{ color: isLight ? '#555555' : '#9d9586', fontSize: '0.72rem', background: isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)', padding: '0.2rem 0.5rem', borderRadius: '6px' }}>
                    {state.wordIndex >= 0 ? `${state.wordIndex + 1}/${words.length}` : `${words.length} words`}
                  </span>
                </div>

                {/* Live Karaoke Scrollable Container */}
                <div
                  style={{
                    flex: 1,
                    borderRadius: '16px',
                    border: isLight ? '1px solid #eaebed' : '1px solid rgba(255,255,255,0.04)',
                    background: isLight ? 'rgba(0,0,0,0.01)' : 'rgba(255,255,255,0.005)',
                    padding: '0.75rem',
                    overflowY: 'auto',
                    transition: 'all 0.3s ease',
                    minHeight: 0,
                  }}
                >
                  {renderNarrationScript()}
                </div>
              </div>

            </div>
          </>
        )}
      </div>

      {/* Apple-style Unified Persistent Bottom Media Player Dock */}
      {state.selectedPage && (
        <div
          style={{
            position: 'absolute',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'calc(100% - 48px)',
            maxWidth: '1100px',
            height: '84px',
            border: isLight ? '1px solid rgba(0, 0, 0, 0.08)' : '1px solid rgba(255, 255, 255, 0.1)',
            background: isLight ? 'rgba(255, 255, 255, 0.75)' : 'rgba(19, 21, 26, 0.75)',
            backdropFilter: 'blur(24px)',
            borderRadius: '40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.75rem 2rem',
            flexShrink: 0,
            transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            boxShadow: isLight ? '0 10px 30px rgba(0,0,0,0.06)' : '0 20px 50px rgba(0,0,0,0.45)',
            zIndex: 100,
          }}
        >
          {/* Left section: Talking Avatar & Narration Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', width: '30%', minWidth: '240px' }}>
            <AIAvatar audioElement={activeAudio} state={{ ...state, isAnalyzing }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              <span style={{ color: textSecondary, fontSize: '0.74rem', lineHeight: 1.35, fontWeight: 600 }}>
                {cloudMessage || 'Explanation server active'}
              </span>
            </div>
          </div>

          {/* Center section: Media controls & Progress slider */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, maxWidth: '480px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button
                onClick={handlePlay}
                disabled={!speechText}
                className="glass-btn"
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '50%',
                  background: state.ttsState !== 'speaking' ? (isLight ? 'rgba(217, 119, 6, 0.16)' : 'rgba(245, 166, 35, 0.22)') : (isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.05)') ,
                  color: state.ttsState !== 'speaking' ? (isLight ? '#b25e00' : '#ffd27a') : (isLight ? '#b5b5b5' : '#666'),
                  border: state.ttsState !== 'speaking' ? (isLight ? '1px solid rgba(217, 119, 6, 0.35)' : '1px solid rgba(245, 166, 35, 0.45)') : (isLight ? '1px solid rgba(0, 0, 0, 0.05)' : '1px solid rgba(255, 255, 255, 0.06)'),
                  boxShadow: state.ttsState !== 'speaking' ? (isLight ? '0 4px 12px rgba(217, 119, 6, 0.12)' : '0 8px 24px rgba(245, 166, 35, 0.25)') : 'none',
                  fontSize: '0.95rem',
                  paddingLeft: '3px',
                }}
                title="Play narration"
              >
                ▶
              </button>

              <button
                onClick={handlePause}
                disabled={!speechText || state.ttsState !== 'speaking'}
                className="glass-btn"
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: state.ttsState === 'speaking' ? (isLight ? 'rgba(217, 119, 6, 0.16)' : 'rgba(245, 166, 35, 0.22)') : (isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.05)'),
                  color: state.ttsState === 'speaking' ? (isLight ? '#b25e00' : '#ffd27a') : (isLight ? '#b5b5b5' : '#6d675b'),
                  border: state.ttsState === 'speaking' ? (isLight ? '1px solid rgba(217, 119, 6, 0.35)' : '1px solid rgba(245, 166, 35, 0.45)') : (isLight ? '1px solid rgba(0, 0, 0, 0.05)' : '1px solid rgba(255, 255, 255, 0.06)'),
                  boxShadow: state.ttsState === 'speaking' ? (isLight ? '0 4px 12px rgba(217, 119, 6, 0.12)' : '0 8px 24px rgba(245, 166, 35, 0.25)') : 'none',
                  fontSize: '0.75rem',
                }}
                title="Pause narration"
              >
                ⏸
              </button>

              <button
                onClick={handleStop}
                disabled={!speechText || state.ttsState === 'idle'}
                className="glass-btn"
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: state.ttsState !== 'idle' ? (isLight ? 'rgba(178, 34, 34, 0.12)' : 'rgba(220, 50, 50, 0.18)') : (isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.05)'),
                  color: state.ttsState !== 'idle' ? (isLight ? '#b22222' : '#ff5555') : (isLight ? '#b5b5b5' : '#6d675b'),
                  border: state.ttsState !== 'idle' ? (isLight ? '1px solid rgba(178, 34, 34, 0.35)' : '1px solid rgba(220, 50, 50, 0.4)') : (isLight ? '1px solid rgba(0, 0, 0, 0.05)' : '1px solid rgba(255, 255, 255, 0.06)'),
                  boxShadow: state.ttsState !== 'idle' ? (isLight ? '0 4px 12px rgba(178, 34, 34, 0.1)' : '0 8px 24px rgba(220, 50, 50, 0.15)') : 'none',
                  fontSize: '0.75rem',
                }}
                title="Stop narration"
              >
                ⏹
              </button>
            </div>

            {/* Progress Slider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%', marginTop: '0.35rem' }}>
              <span style={{ fontSize: '0.68rem', color: textSecondary, fontWeight: 700, minWidth: '28px', textAlign: 'right' }}>
                {state.wordIndex >= 0 ? `${state.wordIndex + 1}` : '0'}
              </span>
              <div
                onClick={handleProgressBarClick}
                className="progress-bar-container"
                style={{
                  flex: 1,
                  height: '6px',
                  borderRadius: '999px',
                  background: progressBarBg,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  position: 'relative'
                }}
              >
                <div
                  style={{
                    width: `${progressPercent}%`,
                    height: '100%',
                    background: isLight ? 'linear-gradient(90deg, #d97706 0%, #f5a623 100%)' : 'linear-gradient(90deg, #f5a623 0%, #ffd27a 100%)',
                    transition: 'width 140ms linear',
                  }}
                />
              </div>
              <span style={{ fontSize: '0.68rem', color: textSecondary, fontWeight: 700, minWidth: '28px' }}>
                {words.length}
              </span>
            </div>
          </div>

          {/* Right section: View page, Language, & Speed Rate */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', justifyContent: 'flex-end', width: '35%', minWidth: '385px' }}>
            {/* Playback voice selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{ color: '#888880', fontSize: '0.65rem', fontWeight: 700 }}>VOICE:</span>
              <select
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value)}
                className="glass-select"
                style={{
                  backgroundColor: isLight ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.05)',
                  color: themeColor,
                  border: isLight ? '1px solid rgba(0, 0, 0, 0.06)' : '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '8px',
                  padding: '0.22rem 1.6rem 0.22rem 0.5rem',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  outline: 'none',
                  maxWidth: '120px',
                  boxShadow: isLight ? '0 1px 4px rgba(0,0,0,0.02)' : '0 2px 8px rgba(0,0,0,0.15)',
                  backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="${themeColor.replace('#', '%23')}"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>')`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 8px center',
                  backgroundSize: '12px',
                }}
              >
                {state.language === 'te-IN' ? (
                  <>
                    <option value="te-IN-ShrutiNeural" style={{ background: isLight ? '#ffffff' : '#1e222b', color: isLight ? '#2c2c2c' : '#f4f0e7' }}>Shruti (F)</option>
                    <option value="te-IN-MohanNeural" style={{ background: isLight ? '#ffffff' : '#1e222b', color: isLight ? '#2c2c2c' : '#f4f0e7' }}>Mohan (M)</option>
                  </>
                ) : (
                  <>
                    <option value="en-US-AriaNeural" style={{ background: isLight ? '#ffffff' : '#1e222b', color: isLight ? '#2c2c2c' : '#f4f0e7' }}>Aria (F)</option>
                    <option value="en-US-JennyNeural" style={{ background: isLight ? '#ffffff' : '#1e222b', color: isLight ? '#2c2c2c' : '#f4f0e7' }}>Jenny (F)</option>
                    <option value="en-US-GuyNeural" style={{ background: isLight ? '#ffffff' : '#1e222b', color: isLight ? '#2c2c2c' : '#f4f0e7' }}>Guy (M)</option>
                    <option value="en-IN-NeerjaNeural" style={{ background: isLight ? '#ffffff' : '#1e222b', color: isLight ? '#2c2c2c' : '#f4f0e7' }}>Neerja (F-IN)</option>
                  </>
                )}
              </select>
            </div>

            {/* Playback speed selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{ color: '#888880', fontSize: '0.65rem', fontWeight: 700 }}>RATE:</span>
              <select
                value={speechRate}
                onChange={(e) => setSpeechRate(e.target.value)}
                className="glass-select"
                style={{
                  backgroundColor: isLight ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.05)',
                  color: themeColor,
                  border: isLight ? '1px solid rgba(0, 0, 0, 0.06)' : '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '8px',
                  padding: '0.22rem 1.6rem 0.22rem 0.5rem',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  outline: 'none',
                  boxShadow: isLight ? '0 1px 4px rgba(0,0,0,0.02)' : '0 2px 8px rgba(0,0,0,0.15)',
                  backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="${themeColor.replace('#', '%23')}"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>')`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 8px center',
                  backgroundSize: '12px',
                }}
              >
                <option value="+0%" style={{ background: isLight ? '#ffffff' : '#1e222b', color: isLight ? '#2c2c2c' : '#f4f0e7' }}>1.0x</option>
                <option value="+15%" style={{ background: isLight ? '#ffffff' : '#1e222b', color: isLight ? '#2c2c2c' : '#f4f0e7' }}>1.2x</option>
                <option value="+30%" style={{ background: isLight ? '#ffffff' : '#1e222b', color: isLight ? '#2c2c2c' : '#f4f0e7' }}>1.5x</option>
              </select>
            </div>

            {/* Language Selection buttons */}
            {[
              { label: 'EN', value: 'en-US' },
              { label: 'TE', value: 'te-IN' },
            ].map((language) => {
              const isActive = state.language === language.value
              return (
                <button
                  key={language.value}
                  onClick={() => handleLanguageChange(language.value)}
                  className="glass-btn"
                  style={{
                    fontSize: '0.7rem',
                    padding: '0.32rem 0.62rem',
                    borderRadius: '999px',
                    background: isActive ? (isLight ? 'rgba(217, 119, 6, 0.16)' : 'rgba(245, 166, 35, 0.22)') : (isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)'),
                    color: isActive ? themeColor : (isLight ? '#555555' : '#cfc6b1'),
                    border: isActive ? (isLight ? '1px solid rgba(217, 119, 6, 0.35)' : '1px solid rgba(245, 166, 35, 0.45)') : (isLight ? '1px solid rgba(0,0,0,0.05)' : '1px solid rgba(255,255,255,0.06)'),
                    boxShadow: isActive ? (isLight ? '0 2px 8px rgba(217, 119, 6, 0.1)' : '0 4px 12px rgba(245, 166, 35, 0.15)') : 'none',
                  }}
                >
                  {language.label}
                </button>
              )
            })}

            {/* High-resolution PDF view toggle */}
            <button
              onClick={() => setIsOriginalModalOpen(true)}
              className="glass-btn"
              style={{
                fontSize: '0.7rem',
                padding: '0.35rem 0.75rem',
                borderRadius: '999px',
                background: isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.06)',
                color: isLight ? '#2c2c2c' : '#f4f0e7',
                border: isLight ? '1px solid rgba(0,0,0,0.05)' : '1px solid rgba(255,255,255,0.08)',
                boxShadow: isLight ? '0 1px 4px rgba(0,0,0,0.02)' : '0 2px 8px rgba(0,0,0,0.1)',
              }}
              title="View original page layout"
            >
              📄 Original Page
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
