export const SARVAM_CREDITS_MESSAGE =
  'Your Sarvam API credits are exhausted. Add credits at dashboard.sarvam.ai to restore TTS, translation, and read-along.'

export function isSarvamCreditsPayload(data, status) {
  if (!data) return status === 402
  if (data.sarvam_credits_exhausted) return true
  if (status === 402) return true

  const detail = data.detail
  if (detail?.code === 'sarvam_credits_exhausted') return true
  if (typeof detail === 'string' && /credit/i.test(detail)) return true

  return false
}

export function getSarvamCreditsMessage(data) {
  const detail = data?.detail
  if (detail?.message) return detail.message
  return SARVAM_CREDITS_MESSAGE
}
