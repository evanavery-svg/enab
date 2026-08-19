import { useUi } from '../state/ui'

export function Toasts() {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismissToast)
  if (toasts.length === 0) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.tone === 'danger' ? ' danger' : ''}`}>
          <span>{t.message}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.run()
                dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
