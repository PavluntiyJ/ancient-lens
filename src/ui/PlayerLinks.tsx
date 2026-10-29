import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { playerSites, playerSiteUrl, profileSites } from '../shared/player-sites';
import { api, errorMessage } from './App';

/** The player on the statistics sites and Steam; `labelled` shows tiles with the site name over a large icon. */
export function PlayerLinks({ id, labelled = false }: { id?: string; labelled?: boolean }) {
  const [error, setError] = useState('');
  if (!id) return null;
  return (
    <span className={`player-sites${labelled ? ' labelled' : ''}`} aria-label="Player profiles">
      {profileSites.map((site) => (
        <a
          key={site.id}
          className={`player-site site-${site.id}`}
          href={playerSiteUrl(id, site.id)}
          title={`Open ${site.name}`}
          aria-label={`Open ${site.name}`}
          onClick={(event) => {
            event.preventDefault();
            setError('');
            void api.openPlayerSite(id, site.id).catch((e) => setError(errorMessage(e)));
          }}
        >
          {labelled && <span>{site.name}</span>}
          <img src={`./sites/${site.icon}`} width={16} height={16} alt="" aria-hidden="true" />
        </a>
      ))}
      {error && (
        <span className="error-text player-site-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

/** A match on the three sites, and its ID to the clipboard. */
export function MatchLinks({ id }: { id: number }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <span className="match-links">
      {playerSites.map((site) => (
        <a
          key={site.id}
          className={`player-site site-${site.id}`}
          href={`https://${site.host}/matches/${id}`}
          title={error || `Open the match on ${site.name}`}
          aria-label={`Open match ${id} on ${site.name}`}
          onClick={(event) => {
            event.preventDefault();
            setError('');
            void api.openMatchSite?.(String(id), site.id).catch((e) => setError(errorMessage(e)));
          }}
        >
          <img src={`./sites/${site.icon}`} width={14} height={14} alt="" aria-hidden="true" />
        </a>
      ))}
      <button
        className="icon-button match-copy"
        title={copied ? 'Copied' : 'Copy match ID'}
        aria-label={`Copy match ID ${id}`}
        onClick={() => {
          void navigator.clipboard
            .writeText(String(id))
            .then(() => setCopied(true))
            .catch(() => setError('Could not copy the match ID'));
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </span>
  );
}
