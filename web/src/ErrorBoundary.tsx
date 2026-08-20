import { Component, type ReactNode } from 'react'

// ErrorBoundary keeps a render-time exception in one component from unmounting
// the whole app to a blank page. Logs the error and shows either the provided
// compact fallback (per-panel use) or the full-page reload prompt.
export class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('app crashed', error)
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return <div role="alert">{this.props.fallback}</div>
      }
      return (
        <div role="alert" style={{ padding: 24, fontFamily: 'sans-serif' }}>
          <h1>Something broke.</h1>
          <p>Reload the page. If it keeps happening, check the browser console.</p>
        </div>
      )
    }
    return this.props.children
  }
}
