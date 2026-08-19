import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/**
 * Catches render-time crashes so a bug shows a readable message and a way out
 * rather than an empty white page.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ENAB crashed:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="content content-pad">
        <div className="onboarding card">
          <div className="mark">E</div>
          <h2>Something went wrong</h2>
          <p className="dim" style={{ marginTop: 8 }}>
            ENAB hit an error it couldn't recover from. Your budget is stored on this device and has not been
            touched — reloading usually clears it.
          </p>
          <pre
            style={{
              margin: '14px 0',
              padding: 10,
              overflowX: 'auto',
              textAlign: 'left',
              fontSize: 12,
              borderRadius: 8,
              background: 'var(--surface-2)',
              color: 'var(--text-dim)',
            }}
          >
            {error.message}
          </pre>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload ENAB
          </button>
        </div>
      </div>
    )
  }
}
