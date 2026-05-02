import React from "react";
import { I18nProvider } from "@lingui/react";
import { DmsProvider } from "./store/dms-store";
import { ThemeProvider } from "./store/theme-store";
import { SettingsProvider } from "./store/settings-store";
import { LocaleProvider, useLocale } from "./store/locale-store";
import { i18n } from "./i18n";
import Dashboard from "./components/Dashboard";
import "./index.css";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[Syngrafo] render error:", error, info);
  }
  override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-8">
          <div className="max-w-xl w-full bg-slate-800 border border-rose-500/30 rounded-2xl p-8">
            <h1 className="text-xl font-black text-rose-400 mb-3">Render Error</h1>
            <pre className="text-xs text-rose-300/70 bg-black/40 p-4 rounded-xl overflow-auto max-h-48 mb-6">
              {this.state.error?.toString()}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold transition-colors"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Inner wrapper — waits for catalog load before rendering to avoid flash of untranslated text. */
function I18nApp() {
  const { loading } = useLocale();
  if (loading) return null;  // catalog not yet active — brief blank frame
  return (
    <I18nProvider i18n={i18n}>
      <ThemeProvider>
        <SettingsProvider>
          <DmsProvider>
            <Dashboard />
          </DmsProvider>
        </SettingsProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <LocaleProvider>
        <I18nApp />
      </LocaleProvider>
    </ErrorBoundary>
  );
}

export default App;
