import { useState } from 'react';
import { IconCheck, IconCopy } from './Icons';

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="copy-field">
      <input className="input" readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="btn" onClick={copy} aria-label={`${label} kopieren`}>
        {copied ? <IconCheck /> : <IconCopy />}
        <span>{copied ? 'Kopiert' : 'Kopieren'}</span>
      </button>
    </div>
  );
}

export function inviteUrl(token: string): string {
  // Token im Fragment: wird nicht an Server gesendet und landet nicht in Zugriffslogs.
  return `${window.location.origin}${import.meta.env.BASE_URL}beitreten#t=${token}`;
}
