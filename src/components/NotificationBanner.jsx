import { usePDF } from '../context/PDFContext'
import { cn } from '../lib/cn'

export default function NotificationBanner() {
  const { state, dispatch } = usePDF()
  const notification = state.notification

  if (!notification) return null

  const isWarning = notification.type === 'warning'

  return (
    <div
      className={cn(
        'fixed top-4 left-1/2 z-[200] -translate-x-1/2 w-[calc(100%-32px)] max-w-xl',
        'flex items-start gap-3 px-4 py-3 rounded-2xl border shadow-lg backdrop-blur-md',
        'animate-fade-in-up',
        isWarning
          ? 'bg-amber-50/95 border-amber-300/60 text-amber-950 dark:bg-amber-950/90 dark:border-amber-500/40 dark:text-amber-50'
          : 'bg-red-50/95 border-red-300/60 text-red-950 dark:bg-red-950/90 dark:border-red-500/40 dark:text-red-50'
      )}
      role="alert"
    >
      <span className="text-lg shrink-0 leading-none mt-0.5" aria-hidden="true">
        {isWarning ? '⚠' : '✕'}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[0.72rem] font-bold uppercase tracking-widest opacity-80">
          Sarvam API
        </p>
        <p className="text-[0.85rem] leading-snug mt-0.5 font-medium">
          {notification.message}
        </p>
      </div>
      <button
        type="button"
        onClick={() => dispatch({ type: 'CLEAR_NOTIFICATION' })}
        className={cn(
          'shrink-0 w-7 h-7 rounded-full text-sm font-bold transition-all duration-200',
          'hover:scale-105 active:scale-95',
          isWarning
            ? 'bg-amber-200/60 hover:bg-amber-200 dark:bg-amber-800/50 dark:hover:bg-amber-800'
            : 'bg-red-200/60 hover:bg-red-200 dark:bg-red-800/50 dark:hover:bg-red-800'
        )}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  )
}
