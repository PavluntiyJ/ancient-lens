import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { playerSites, playerSiteUrl } from '../shared/player-sites';
import { api, errorMessage } from './App';

export function PlayerLinks({ id }: { id?: string }) {
  const [error, setError] = useState('');
  if (!id) return null;
  return (
    <span className="player-sites" aria-label="Player profiles">
      {playerSites.map((site) => (
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
