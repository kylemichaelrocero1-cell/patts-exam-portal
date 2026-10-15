import { Component } from 'react';
import { isStaleBuildError, reloadForUpdate, isUpdateReload } from '../lib/staleBuild';

// Catches a screen that fails to render, so the student sees what happened
// and a Reload button instead of a blank page. A file of an old build
// (src/lib/staleBuild.js) reloads by itself onto the new one.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, updating: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    // The reload may already be under way (main.jsx starts it on Vite's
    // preloadError); either way, say so rather than "stopped working".
    if (isStaleBuildError(error)) this.setState({ updating: reloadForUpdate() || isUpdateReload() });
  }

  render() {
    const { error, updating } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg, #F6F7FB)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div role="alert" style={{ background: 'var(--surface, #fff)', border: '1px solid var(--line, #E3E7EF)', borderRadius: 'var(--r-lg, 16px)', padding: '28px 24px', maxWidth: 420, width: '100%', textAlign: 'center' }}>
          <img src="/patts-logo.png" alt="PATTS College of Aeronautics" style={{ height: 44, width: 'auto', objectFit: 'contain', marginBottom: 16 }} />
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>
            {updating ? 'Updating the portal…' : 'This screen stopped working'}
          </h1>
          <p style={{ color: 'var(--ink-3, #5B6475)', fontSize: 14, margin: '0 0 20px', lineHeight: 1.5 }}>
            {updating
              ? 'A newer version was just released. It opens in a moment, and anything you typed is kept.'
              : 'Anything you typed is saved on this device. Reload to carry on where you left off.'}
          </p>
          {!updating && (
            <button type="button" className="btn" onClick={() => window.location.reload()} style={{ width: 'auto', padding: '10px 24px' }}>
              Reload
            </button>
          )}
        </div>
      </div>
    );
  }
}
