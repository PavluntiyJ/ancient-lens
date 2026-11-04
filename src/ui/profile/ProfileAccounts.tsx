import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { accountId, type SteamIdentity } from '../../shared/domain';
import { api, errorMessage } from '../App';
import { ProfileMenu } from '../ProfileMenu';

function AccountChoice({
  id,
  selected,
  active,
  choose,
  remove,
  removing,
}: {
  id: string;
  selected: boolean;
  active: boolean;
  choose(): void;
  /** Absent for the app's current account, which the game's key relies on. */
  remove?: () => void;
  removing?: boolean;
}) {
  const [identity, setIdentity] = useState<SteamIdentity>();
  useEffect(() => {
    let keep = true;
    void api
      .getSteamProfile?.(id)
      .then((value) => {
        if (keep && value.accountId === id) setIdentity(value);
      })
      .catch(() => {});
    return () => {
      keep = false;
    };
  }, [id]);
  const name = identity?.name ?? `Account ${id}`;
  return (
    <div className={`profile-account-entry${selected ? ' selected' : ''}`}>
      <button className="profile-account-pick" aria-pressed={selected} onClick={choose}>
        <span>
          {name}
          <small>
            {id}
            {active ? ' · Current account' : ''}
          </small>
        </span>
        {selected && <small>Selected</small>}
      </button>
      {remove && (
        <button
          className="icon-button profile-account-remove"
          aria-label={`Remove ${name}`}
          title="Remove saved profile"
          disabled={removing}
          onClick={remove}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

export function ProfileAccounts({
  name,
  selected,
  active,
  accounts,
  choose,
  add,
  remove,
}: {
  name: string;
  selected: string;
  active: string;
  accounts: string[];
  choose(id: string): void;
  add(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [removeError, setRemoveError] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string>();
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await add(accountId(query));
      setQuery('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function removeAccount(id: string) {
    setRemoveError('');
    setRemoving(id);
    try {
      await remove(id);
    } catch (e) {
      setRemoveError(errorMessage(e));
    } finally {
      setRemoving(undefined);
    }
  }
  return (
    <ProfileMenu
      label="Accounts"
      closeKey={selected}
      trigger={
        <span className="profile-name-text" title={name}>
          {name}
        </span>
      }
      caret
    >
      <div className="profile-account-list">
        {[...new Set([active, selected, ...accounts].filter(Boolean))].map((id) => (
          <AccountChoice
            key={id}
            id={id}
            selected={id === selected}
            active={id === active}
            choose={() => choose(id)}
            remove={id === active ? undefined : () => void removeAccount(id)}
            removing={removing === id}
          />
        ))}
      </div>
      {removeError && (
        <small role="alert" className="error-text">
          {removeError}
        </small>
      )}
      <form className="profile-account-add" onSubmit={(event) => void submit(event)}>
        <label htmlFor="add-profile-account">Add account</label>
        <input
          id="add-profile-account"
          placeholder="Dota ID / SteamID64"
          aria-label="Dota ID / SteamID64"
          maxLength={160}
          required
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="primary" disabled={busy}>
          {busy ? 'Adding…' : 'Add account'}
        </button>
        {error && (
          <small role="alert" className="error-text">
            {error}
          </small>
        )}
      </form>
    </ProfileMenu>
  );
}
