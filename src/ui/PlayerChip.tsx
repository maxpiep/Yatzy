import type { CSSProperties } from 'react';
import type { Player } from '../domain/types';

export function playerStyle(color: string | undefined): CSSProperties {
  return { ['--player-color' as string]: color ?? 'var(--c-ink-3)' } as CSSProperties;
}

export function PlayerAvatar({ name, color, size }: { name: string; color?: string; size?: 'lg' }) {
  return (
    <span className={`avatar ${size === 'lg' ? 'avatar--lg' : ''}`} style={playerStyle(color)} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function PlayerName({ player, name }: { player?: Player; name?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, ...playerStyle(player?.color) }}>
      <span className="player-dot" aria-hidden="true" />
      {name ?? player?.displayName ?? '?'}
    </span>
  );
}
