import { useEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn'

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

  useEffect(() => {
    let time = 0

    if (!audioElement) {
      function idleLoop() {
        time += 0.05
        setTimeCounter(time)
        setRotation((prev) => (prev + 0.5) % 360)

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
        setRotation((prev) => (prev + (0.5 + amplitudeRef.current * 2)) % 360)

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
        setRotation((prev) => (prev + (0.6 + amplitudeRef.current * 2.5)) % 360)

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

  const isLight = state.theme === 'light'

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

  const bubble1X = 50 + Math.sin(rotation * Math.PI / 180) * 42
  const bubble1Y = 50 + Math.cos(rotation * Math.PI / 180) * 42
  const bubble2X = 50 + Math.sin((rotation + 180) * Math.PI / 180) * 42
  const bubble2Y = 50 + Math.cos((rotation + 180) * Math.PI / 180) * 42

  return (
    <div className="veda-avatar-pill">
      <div className="w-[90px] h-[90px] relative flex items-center justify-center shrink-0">
        <div
          className={cn(
            'veda-avatar-orbit',
            stateName === 'thinking' ? 'veda-avatar-orbit-fast' : 'veda-avatar-orbit-slow'
          )}
          style={{ borderColor: `${eyeColor}28` }}
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
          <circle cx={bubble1X} cy={bubble1Y} r="1.5" fill={eyeColor} style={{ opacity: 0.65 }} />
          <circle cx={bubble2X} cy={bubble2Y} r="1.2" fill={eyeColor} style={{ opacity: 0.5 }} />

          <g>
            <line x1="50" y1="24" x2="50" y2="15" stroke={isLight ? '#9ca3af' : '#4b5563'} strokeWidth="2" strokeLinecap="round" />
            <circle cx="50" cy="13" r={3 + amplitude * 1.5} fill={ledColor} style={{ transition: 'r 0.08s ease-out' }} />

            <rect x="16" y="40" width="6" height="20" rx="3" fill={earColor} />
            <rect x="18" y="44" width="2" height="12" rx="1" fill={eyeColor} style={{ opacity: 0.4 + amplitude * 0.6 }} />

            <rect x="78" y="40" width="6" height="20" rx="3" fill={earColor} />
            <rect x="80" y="44" width="2" height="12" rx="1" fill={eyeColor} style={{ opacity: 0.4 + amplitude * 0.6 }} />

            <rect x="22" y="24" width="56" height="52" rx="26" ry="26" fill={helmetBg} stroke={helmetBorder} strokeWidth="1.5" />
            <rect x="28" y="32" width="44" height="34" rx="12" ry="12" fill={visorBg} stroke={visorBorder} strokeWidth="1.2" />
            <path d="M 33,35 L 67,35 C 62,39 40,39 33,35" fill="rgba(255,255,255,0.06)" />
          </g>

          <g>
            {isBlinking ? (
              <>
                <line x1="38" y1="45" x2="45" y2="45" stroke={eyeColor} strokeWidth="2.2" strokeLinecap="round" />
                <line x1="55" y1="45" x2="62" y2="45" stroke={eyeColor} strokeWidth="2.2" strokeLinecap="round" />
              </>
            ) : stateName === 'thinking' ? (
              <>
                <circle cx="41.5" cy="45" r={3.2 + Math.sin(timeCounter * 6) * 1.0} fill="none" stroke={eyeColor} strokeWidth="1.8" />
                <circle cx="58.5" cy="45" r={3.2 + Math.cos(timeCounter * 6) * 1.0} fill="none" stroke={eyeColor} strokeWidth="1.8" />
              </>
            ) : stateName === 'speaking' ? (
              <>
                <path d="M 38.5,46 Q 41.5,41 44.5,46" fill="none" stroke={eyeColor} strokeWidth="2.5" strokeLinecap="round" />
                <path d="M 55.5,46 Q 58.5,41 61.5,46" fill="none" stroke={eyeColor} strokeWidth="2.5" strokeLinecap="round" />
              </>
            ) : (
              <>
                <ellipse cx="41.5" cy="45" rx="3.2" ry="3.5" fill={eyeColor} />
                <ellipse cx="58.5" cy="45" rx="3.2" ry="3.5" fill={eyeColor} />
                <circle cx="42.5" cy="44" r="0.8" fill="#ffffff" />
                <circle cx="59.5" cy="44" r="0.8" fill="#ffffff" />
              </>
            )}

            {stateName === 'speaking' ? (
              <g stroke={eyeColor} strokeWidth="2.5" strokeLinecap="round">
                <line x1="41" y1={56 - amplitude * 5} x2="41" y2={56 + amplitude * 5} />
                <line x1="45.5" y1={56 - amplitude * 12} x2="45.5" y2={56 + amplitude * 12} />
                <line x1="50" y1={56 - amplitude * 17} x2="50" y2={56 + amplitude * 17} />
                <line x1="54.5" y1={56 - amplitude * 12} x2="54.5" y2={56 + amplitude * 12} />
                <line x1="59" y1={56 - amplitude * 5} x2="59" y2={56 + amplitude * 5} />
              </g>
            ) : stateName === 'thinking' ? (
              <line x1="42" y1="56" x2="58" y2="56" stroke={eyeColor} strokeWidth="2.2" strokeLinecap="round" />
            ) : (
              <path d="M 43,55 Q 50,59 57,55" fill="none" stroke={eyeColor} strokeWidth="2.2" strokeLinecap="round" />
            )}
          </g>
        </svg>
      </div>

      <div className="flex flex-col gap-0.5 pr-1.5">
        <span
          className="text-[0.62rem] font-extrabold uppercase tracking-widest transition-colors duration-300"
          style={{
            color: eyeColor,
            textShadow: isLight ? 'none' : `0 0 4px ${eyeColor}55`,
          }}
        >
          Veda
        </span>
        <span className="text-[0.52rem] font-semibold uppercase tracking-wide whitespace-nowrap text-[#6b7280] dark:text-[#9ca3af]">
          {state.isAnalyzing || state.ttsState === 'thinking'
            ? 'Thinking'
            : stateName === 'speaking'
              ? 'Speaking'
              : 'Online'}
        </span>
      </div>
    </div>
  )
}
