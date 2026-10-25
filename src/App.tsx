import { Component, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { BackendChoice } from './data/createBackend';
import { ClubProvider, useClub } from './state/club';
import { PreferencesProvider } from './state/preferences';
import { ToastProvider } from './state/toast';
import { AppLayout } from './ui/AppLayout';
import { EmptyState } from './ui/EmptyState';
import { SmoothScroll } from './motion/SmoothScroll';
import { DashboardPage } from './pages/DashboardPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { GameDetailPage } from './pages/GameDetailPage';
import { CashboxPage } from './pages/CashboxPage';
import { SettingsPage } from './pages/SettingsPage';
import { FatalScreen, JoinPage, LoadingScreen, SetupPage, UnconfiguredScreen } from './pages/SetupPages';
import { GamePage } from './features/game/GamePage';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <main className="boot">
          <div className="boot__card panel" role="alert">
            <h1 style={{ fontSize: 'var(--fs-2xl)' }}>Unerwarteter Fehler</h1>
            <p className="muted">Die Ansicht konnte nicht dargestellt werden. Eure Daten sind sicher auf dem Server gespeichert.</p>
            <button className="btn btn--primary" onClick={() => window.location.reload()}>
              Neu laden
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

function NotFound() {
  return (
    <EmptyState
      title="Seite nicht gefunden"
      action={
        <Link className="btn btn--primary" to="/">
          Zur Übersicht
        </Link>
      }
    >
      Diese Adresse gibt es im Kniffel Club nicht.
    </EmptyState>
  );
}

function ActiveGameRedirect() {
  const { snapshot } = useClub();
  const id = snapshot?.active?.game.id;
  return <Navigate to={id ? `/partie/${id}` : '/'} replace />;
}

function Shell() {
  const { phase, snapshot } = useClub();
  const location = useLocation();
  if (location.pathname.endsWith('/beitreten') && phase.kind !== 'booting' && phase.kind !== 'unconfigured') return <JoinPage />;
  if (phase.kind === 'booting') return <LoadingScreen />;
  if (phase.kind === 'unconfigured') return <UnconfiguredScreen />;
  if (phase.kind === 'fatal') return <FatalScreen error={phase.error} />;
  if (phase.kind === 'no-room') return <SetupPage />;
  if (!snapshot) return <LoadingScreen />;
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/partie" element={<ActiveGameRedirect />} />
        <Route path="/partie/:gameId" element={<GamePage />} />
        <Route path="/bestenliste" element={<LeaderboardPage />} />
        <Route path="/historie" element={<HistoryPage />} />
        <Route path="/historie/:gameId" element={<GameDetailPage />} />
        <Route path="/kasse" element={<CashboxPage />} />
        <Route path="/einstellungen" element={<SettingsPage />} />
        <Route path="/beitreten" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppLayout>
  );
}

export function App({ choice }: { choice?: () => BackendChoice }) {
  return (
    <ErrorBoundary>
      <PreferencesProvider>
        <ToastProvider>
          <ClubProvider choice={choice}>
            <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
              <SmoothScroll />
              <Shell />
            </BrowserRouter>
          </ClubProvider>
        </ToastProvider>
      </PreferencesProvider>
    </ErrorBoundary>
  );
}
