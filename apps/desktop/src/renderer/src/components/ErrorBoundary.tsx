import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    // Avoid logging freeform content or sensitive component props.
    console.error('trueiris:renderer_error');
  }
  override render() {
    if (this.state.failed)
      return (
        <main className="error-state">
          <h1>Let’s start fresh.</h1>
          <p>TrueIris couldn’t display this view.</p>
          <button onClick={() => window.location.reload()}>
            Reload TrueIris
          </button>
        </main>
      );
    return this.props.children;
  }
}
