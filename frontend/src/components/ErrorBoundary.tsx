import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode; label: string };
type State = { error: Error | null };

/** Catches a crash in one view (e.g. the map) so the rest of the app stays usable. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.label}]`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash-note" role="alert">
        <p>The {this.props.label} stopped working.</p>
        <button type="button" className="btn btn--m btn--primary" onClick={() => this.setState({ error: null })}>
          Reload {this.props.label}
        </button>
      </div>
    );
  }
}
