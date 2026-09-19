import React from "react";

// Top-level safety net. Before this existed, ANY unhandled render error
// anywhere in the app (a bad date, a malformed stored record, whatever)
// would unmount the whole React tree and leave the WebView blank — which
// is almost certainly what users have been reporting as the app
// "crashing" while adding an entry, since there was previously no way
// for a render error to surface as anything other than a blank screen.
//
// Deliberately dependency-free: no i18n, no app context, no hooks. If
// something upstream in the app's own state/context is what broke, this
// still has to render on its own — reaching for anything from the app
// that might itself be in a bad state would defeat the purpose.
//
// Shows the actual error message + component stack so that the next time
// this fires, whoever hits it can screenshot the real cause instead of
// just reporting "it crashed" with nothing to go on. "Reload" does a full
// page reload — safe to do here since every save already persists before
// this screen could ever be reached, so at most an in-progress unsaved
// field is lost, not saved data.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // eslint-disable-next-line no-console
    console.error("Bejirond crashed:", error, info?.componentStack);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{
        minHeight: "100vh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", padding: "24px",
        background: "#0C1D37", color: "#FFFFFF", fontFamily: "sans-serif",
        textAlign: "center", gap: "12px",
      }}>
        <div style={{ fontSize: "40px" }}>⚠️</div>
        <div style={{ fontSize: "18px", fontWeight: 600 }}>Something went wrong</div>
        <div style={{ fontSize: "13px", opacity: 0.75, maxWidth: "420px" }}>
          The app hit an error and couldn't continue. Your saved entries are safe —
          this only affects the current screen. Please screenshot the details below
          and share them so this can get fixed.
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: "8px", background: "#127A3F", color: "#fff", border: "none",
            borderRadius: "10px", padding: "10px 20px", fontSize: "14px",
            fontWeight: 600, cursor: "pointer",
          }}
        >
          Reload app
        </button>
        <pre style={{
          marginTop: "16px", maxWidth: "100%", overflow: "auto", textAlign: "left",
          background: "rgba(255,255,255,0.08)", padding: "12px", borderRadius: "8px",
          fontSize: "11px", lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}>
          {String(error?.message || error)}
          {info?.componentStack ? `\n${info.componentStack}` : ""}
        </pre>
      </div>
    );
  }
}
