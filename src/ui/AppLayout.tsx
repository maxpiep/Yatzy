import type { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useClub } from '../state/club';
import { usePageTransition } from '../motion/hooks';
import { ConnectionStatus } from './ConnectionStatus';
import { LogoMark } from './Logo';
import { IconDice, IconHistory, IconHome, IconLock, IconSettings, IconTrophy, IconWallet } from './Icons';
import { usePinLock } from '../features/lock/PinGate';

export function AppLayout({ children }: { children: ReactNode }) {
  const { snapshot, room, backend } = useClub();
  const pin = usePinLock();
  const location = useLocation();
  const main = usePageTransition<HTMLElement>(location.pathname.split('/')[1] ?? '');
  const activeId = snapshot?.active?.game.id;
  const gameHref = activeId ? `/partie/${activeId}` : '/partie';

  const items = [
    { to: '/', label: 'Übersicht', icon: <IconHome />, end: true },
    { to: gameHref, label: 'Partie', icon: <IconDice />, live: Boolean(activeId), match: '/partie' },
    { to: '/bestenliste', label: 'Bestenliste', icon: <IconTrophy /> },
    { to: '/historie', label: 'Historie', icon: <IconHistory /> },
    { to: '/kasse', label: 'Kasse', icon: <IconWallet /> },
  ];

  const isCurrent = (to: string, match?: string, end?: boolean) =>
    end ? location.pathname === to : location.pathname.startsWith(match ?? to);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Zum Inhalt springen
      </a>
      <header className="topbar">
        <div className="topbar__inner">
          <Link to="/" className="brand" aria-label="Kniffel Club – Übersicht">
            <LogoMark />
            <span>
              <span className="brand__name">Kniffel Club</span>
              {room && <span className="brand__club">{room.name}</span>}
            </span>
          </Link>
          <nav className="mainnav" aria-label="Hauptnavigation">
            {items.map((i) => (
              <NavLink key={i.label} to={i.to} end={i.end} aria-current={isCurrent(i.to, i.match, i.end) ? 'page' : undefined}>
                {i.label}
                {i.live && <span className="chip chip--danger" style={{ minHeight: 20, padding: '0 6px', fontSize: 11 }}>live</span>}
              </NavLink>
            ))}
          </nav>
          {backend?.mode !== 'local' && <ConnectionStatus />}
          {pin && (
            <button type="button" className="btn btn--ghost btn--icon" aria-label="App sperren" onClick={pin.lockNow} data-testid="lock-now">
              <IconLock width={20} height={20} />
            </button>
          )}
          <NavLink to="/einstellungen" className="btn btn--ghost btn--icon" aria-label="Einstellungen">
            <IconSettings />
          </NavLink>
        </div>
      </header>
      <main id="main" ref={main} className="main" tabIndex={-1}>
        {children}
      </main>
      <nav className="tabbar" aria-label="Hauptnavigation mobil">
        {items.map((i) => (
          <NavLink key={i.label} to={i.to} end={i.end} aria-current={isCurrent(i.to, i.match, i.end) ? 'page' : undefined}>
            {i.icon}
            <span>{i.label}</span>
            {i.live && <span className="tabbar__live" aria-label="Partie läuft" />}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
