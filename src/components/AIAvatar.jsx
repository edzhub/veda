import { useEffect, useRef, useState } from 'react'

export default function AIAvatar({ audioElement, state }) {
  const [isBlinking, setIsBlinking] = useState(false)
  const [amplitude, setAmplitude] = useState(0)
  const [pulseScale, setPulseScale] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [timeCounter, setTimeCounter] = useState(0)
  
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const sourceRef = useRef(null)
  const animationRef = useRef(null)
  const amplitudeRef = useRef(0)

  // 1. Random blink timer (every 3-5 seconds, blink for 140ms)
  useEffect(() => {
    let blinkTimeout
    function scheduleBlink() {
      blinkTimeout = setTimeout(() => {
        setIsBlinking(true)
        setTimeout(() => {
          setIsBlinking(false)
          scheduleBlink()
        }, 140)
      }, 2500 + Math.random() * 2500)
    }
    scheduleBlink()
    return () => clearTimeout(blinkTimeout)
  }, [])
  
  // 2. Web Audio Analyser or Animation Loop
  useEffect(() => {
    let time = 0

    if (!audioElement) {
      // Idle/Thinking animation loop when audio is not active
      function idleLoop() {
        time += 0.05
        setTimeCounter(time)
        setRotation(prev => (prev + 0.5) % 360)
        
        // Simulating mild breathing pulse
        if (state.ttsState === 'thinking' || state.isAnalyzing) {
          const val = 0.04 + Math.sin(time * 2.5) * 0.02
          setAmplitude(val)
          amplitudeRef.current = val
          setPulseScale(1 + Math.sin(time * 3) * 0.015)
        } else {
          setAmplitude(0)
          amplitudeRef.current = 0
          setPulseScale(1 + Math.sin(time * 0.8) * 0.012)
        }
        
        animationRef.current = requestAnimationFrame(idleLoop)
      }
      animationRef.current = requestAnimationFrame(idleLoop)
      return () => cancelAnimationFrame(animationRef.current)
    }

    try {
      if (!audioContextRef.current) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext
        audioContextRef.current = new AudioContextClass()
      }
      const audioContext = audioContextRef.current
      
      if (audioContext.state === 'suspended') {
        audioContext.resume()
      }

      if (!analyserRef.current) {
        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 64
        analyserRef.current = analyser
      }
      const analyser = analyserRef.current

      // Connect source to analyser only once
      if (!sourceRef.current) {
        const source = audioContext.createMediaElementSource(audioElement)
        source.connect(analyser)
        analyser.connect(audioContext.destination)
        sourceRef.current = source
      }

      const bufferLength = analyser.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)
      
      function updateVisuals() {
        time += 0.05
        setTimeCounter(time)
        setRotation(prev => (prev + (0.5 + amplitudeRef.current * 2)) % 360)
        
        if (audioElement.paused || audioElement.ended) {
          setAmplitude(0)
          amplitudeRef.current = 0
          setPulseScale(1)
          animationRef.current = requestAnimationFrame(updateVisuals)
          return
        }

        analyser.getByteFrequencyData(dataArray)
        
        let sum = 0
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i]
        }
        
        const avg = sum / bufferLength
        const normAmp = avg / 255.0
        
        setAmplitude(normAmp)
        amplitudeRef.current = normAmp
        setPulseScale(1 + normAmp * 0.12)
        
        animationRef.current = requestAnimationFrame(updateVisuals)
      }
      
      animationRef.current = requestAnimationFrame(updateVisuals)
    } catch (err) {
      console.warn('Web Audio API fallback active:', err)
      
      function fallbackLoop() {
        time += 0.15
        setTimeCounter(time)
        setRotation(prev => (prev + (0.6 + amplitudeRef.current * 2.5)) % 360)
        
        if (!audioElement.paused && !audioElement.ended) {
          const simulatedAmp = 0.16 + Math.sin(time) * 0.08 + Math.random() * 0.06
          setAmplitude(simulatedAmp)
          amplitudeRef.current = simulatedAmp
          setPulseScale(1 + simulatedAmp * 0.08)
        } else {
          setAmplitude(0)
          amplitudeRef.current = 0
          setPulseScale(1)
        }
        animationRef.current = requestAnimationFrame(fallbackLoop)
      }
      animationRef.current = requestAnimationFrame(fallbackLoop)
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [audioElement, state.ttsState, state.isAnalyzing])

  // Determine current active theme
  const isLight = state.theme === 'light'

  // Curated theme-specific palette variables
  let eyeColor = isLight ? '#d97706' : '#00f0ff'
  let ledColor = isLight ? '#d97706' : '#00f0ff'
  let helmetBg = isLight ? '#f1f3f5' : '#1a1c23'
  let helmetBorder = isLight ? '#d1d5db' : '#2d313f'
  let earColor = isLight ? '#e5e7eb' : '#242731'
  let visorBg = isLight ? '#1a1a24' : '#090a0f'
  let visorBorder = isLight ? '#374151' : '#1e2230'
  let stateName = 'idle'

  if (state.ttsState === 'speaking' || amplitude > 0.01) {
    eyeColor = isLight ? '#d97706' : '#ffd27a'
    ledColor = isLight ? '#d97706' : '#ffd27a'
    stateName = 'speaking'
  } else if (state.ttsState === 'paused') {
    eyeColor = isLight ? '#7c8a99' : '#00a3bd'
    ledColor = isLight ? '#7c8a99' : '#00a3bd'
    stateName = 'paused'
  } else if (state.isAnalyzing || state.ttsState === 'thinking') {
    eyeColor = isLight ? '#7c3aed' : '#b026ff'
    ledColor = isLight ? '#7c3aed' : '#b026ff'
    stateName = 'thinking'
  }

  // Draw floating particles rotating around the visor
  const bubble1X = 50 + Math.sin(rotation * Math.PI / 180) * 42
  const bubble1Y = 50 + Math.cos(rotation * Math.PI / 180) * 42
  const bubble2X = 50 + Math.sin((rotation + 180) * Math.PI / 180) * 42
  const bubble2Y = 50 + Math.cos((rotation + 180) * Math.PI / 180) * 42

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.65rem',
        padding: '0.35rem 0.75rem',
        borderRadius: '999px',
        background: isLight ? 'rgba(0, 0, 0, 0.025)' : 'rgba(255, 255, 255, 0.03)',
        border: isLight ? '1px solid rgba(0, 0, 0, 0.05)' : '1px solid rgba(255, 255, 255, 0.05)',
        width: 'fit-content',
        boxShadow: isLight ? '0 4px 12px rgba(0,0,0,0.02)' : '0 4px 12px rgba(0,0,0,0.15)',
        backdropFilter: 'blur(8px)',
        transition: 'all 0.3s ease',
      }}
    >
      {/* 90px animated character container */}
      <div 
        style={{ 
          width: '90px', 
          height: '90px', 
          position: 'relative', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          flexShrink: 0
        }}
      >
        {/* Floating orbit ring */}
        <div
          style={{
            position: 'absolute',
            width: '76px',
            height: '76px',
            borderRadius: '50%',
            border: `0.75px dashed ${eyeColor}28`,
            animation: stateName === 'thinking' ? 'spin 6s linear infinite' : 'spin 22s linear infinite',
            pointerEvents: 'none',
          }}
        />

        <svg
          width="90"
          height="90"
          viewBox="0 0 100 100"
          className="veda-robot-head"
          style={{
            transform: `scale(${pulseScale})`,
            transition: 'transform 0.08s ease-out',
            filter: `drop-shadow(0 0 5px ${eyeColor}33)`,
          }}
        >
          {/* Glowing particle orbits */}
          <circle cx={bubble1X} cy={bubble1Y} r="1.5" fill={eyeColor} style={{ opacity: 0.65 }} />
          <circle cx={bubble2X} cy={bubble2Y} r="1.2" fill={eyeColor} style={{ opacity: 0.5 }} />

          {/* Helmet Body & Details */}
          <g>
            {/* Pole Antenna */}
            <line x1="50" y1="24" x2="50" y2="15" stroke={isLight ? '#9ca3af' : '#4b5563'} strokeWidth="2" strokeLinecap="round" />
            <circle cx="50" cy="13" r={3 + amplitude * 1.5} fill={ledColor} style={{ transition: 'r 0.08s ease-out' }} />

            {/* Left Ear */}
            <rect x="16" y="40" width="6" height="20" rx="3" fill={earColor} />
            <rect x="18" y="44" width="2" height="12" rx="1" fill={eyeColor} style={{ opacity: 0.4 + amplitude * 0.6 }} />

            {/* Right Ear */}
            <rect x="78" y="40" width="6" height="20" rx="3" fill={earColor} />
            <rect x="80" y="44" width="2" height="12" rx="1" fill={eyeColor} style={{ opacity: 0.4 + amplitude * 0.6 }} />

            {/* Helmet Main Round Shell */}
            <rect x="22" y="24" width="56" height="52" rx="26" ry="26" fill={helmetBg} stroke={helmetBorder} strokeWidth="1.5" />
            
            {/* Visor Screen */}
            <rect x="28" y="32" width="44" height="34" rx="12" ry="12" fill={visorBg} stroke={visorBorder} strokeWidth="1.2" />
            
            {/* Glossy Visor Highlight */}
            <path d="M 33,35 L 67,35 C 62,39 40,39 33,35" fill="rgba(255,255,255,0.06)" />
          </g>

          {/* EXPRESSIVE FACE ELEMENTS */}
          <g>
            {/* EYES */}
            {isBlinking ? (
              // Blink state (flat lines)
              <>
                <line x1="38" y1="45" x2="45" y2="45" stroke={eyeColor} strokeWidth="2.2" strokeLinecap="round" />
                <line x1="55" y1="45" x2="62" y2="45" stroke={eyeColor} strokeWidth="2.2" strokeLinecap="round" />
              </>
            ) : stateName === 'thinking' ? (
              // Thinking state (pulsing loading rings)
              <>
                <circle cx="41.5" cy="45" r={3.2 + Math.sin(timeCounter * 6) * 1.0} fill="none" stroke={eyeColor} strokeWidth="1.8" />
                <circle cx="58.5" cy="45" r={3.2 + Math.cos(timeCounter * 6) * 1.0} fill="none" stroke={eyeColor} strokeWidth="1.8" />
              </>
            ) : stateName === 'speaking' ? (
              // Speaking state (cheerfully curved oval eyes)
              <>
                <path d="M 38.5,46 Q 41.5,41 44.5,46" fill="none" stroke={eyeColor} strokeWidth="2.5" strokeLinecap="round" />
                <path d="M 55.5,46 Q 58.5,41 61.5,46" fill="none" stroke={eyeColor} strokeWidth="2.5" strokeLinecap="round" />
              </>
            ) : (
              // Idle state (friendly round eyes)
              <>
                <ellipse cx="41.5" cy="45" rx="3.2" ry="3.5" fill={eyeColor} />
                <ellipse cx="58.5" cy="45" rx="3.2" ry="3.5" fill={eyeColor} />
                {/* Tiny gaze highlights */}
                <circle cx="42.5" cy="44" r="0.8" fill="#ffffff" />
                <circle cx="59.5" cy="44" r="0.8" fill="#ffffff" />
              </>
            )}

            {/* MOUTH */}
            {stateName === 'speaking' ? (
              // Speaking soundwave equalizer mouth
              <g stroke={eyeColor} strokeWidth="2.5" strokeLinecap="round">
                <line x1="41" y1={56 - amplitude * 5} x2="41" y2={56 + amplitude * 5} />
                <line x1="45.5" y1={56 - amplitude * 12} x2="45.5" y2={56 + amplitude * 12} />
                <line x1="50" y1={56 - amplitude * 17} x2="50" y2={56 + amplitude * 17} />
                <line x1="54.5" y1={56 - amplitude * 12} x2="54.5" y2={56 + amplitude * 12} />
                <line x1="59" y1={56 - amplitude * 5} x2="59" y2={56 + amplitude * 5} />
              </g>
            ) : stateName === 'thinking' ? (
              // Thinking state flat indicator line
              <line x1="42" y1="56" x2="58" y2="56" stroke={eyeColor} strokeWidth="2.2" strokeLinecap="round" />
            ) : (
              // Idle state friendly happy smile
              <path d="M 43,55 Q 50,59 57,55" fill="none" stroke={eyeColor} strokeWidth="2.2" strokeLinecap="round" />
            )}
          </g>
        </svg>
      </div>

      {/* Side status panel inside the pill */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', paddingRight: '0.4rem' }}>
        <span
          style={{
            fontSize: '0.62rem',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: eyeColor,
            transition: 'color 0.3s ease',
            textShadow: isLight ? 'none' : `0 0 4px ${eyeColor}55`,
          }}
        >
          Veda
        </span>
        <span
          style={{
            fontSize: '0.52rem',
            fontWeight: 600,
            color: isLight ? '#6b7280' : '#9ca3af',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
          }}
        >
          {state.isAnalyzing || state.ttsState === 'thinking'
            ? 'Thinking'
            : stateName === 'speaking'
              ? 'Speaking'
              : 'Online'}
        </span>
      </div>

      {/* Local keyframes injection */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes float-bob {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-4px); }
          100% { transform: translateY(0px); }
        }
        .veda-robot-head {
          animation: float-bob 3.2s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}
