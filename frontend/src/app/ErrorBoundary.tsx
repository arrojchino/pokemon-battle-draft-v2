import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n/index.js';

type State = { error: Error | null };

/** Keeps a rendering bug in one panel from blanking the whole game. */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string; compact?: boolean }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(`[${this.props.label ?? 'ui'}]`, error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={this.props.compact ? 'panel panel--error' : 'fatal'} role="alert">
        <strong>{this.props.label ? t('error.brokeIn', { label: this.props.label }) : t('error.broke')}</strong>
        <p>{this.state.error.message}</p>
        <button className="btn" onClick={() => this.setState({ error: null })}>{t('error.tryAgain')}</button>
        {!this.props.compact && <button className="btn btn--ghost" onClick={() => location.reload()}>{t('error.reload')}</button>}
      </div>
    );
  }
}
