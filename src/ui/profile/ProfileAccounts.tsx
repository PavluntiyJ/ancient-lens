import { useEffect, useState, type FormEvent } from 'react';
import { accountId, type SteamIdentity } from '../../shared/domain';
import { api, errorMessage } from '../App';
import { ProfileMenu } from '../ProfileMenu';

function AccountChoice({
  id,
  selected,
  active,
  choose,
}: {
  id: string;
  selected: boolean;
  active: boolean;
  choose(): void;
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
  return (
    <button className="profile-account-choice" aria-pressed={selected} onClick={choose}>
      <span>
        {identity?.name ?? `Account ${id}`}
        <small>
          {id}
          {active ? ' · Current account' : ''}
        </small>
      </span>
      {selected && <small>Selected</small>}
    </button>
  );
}

export function ProfileAccounts({
  name,
  selected,
  active,
  accounts,
  choose,
  add,
}: {
  name: string;
  selected: string;
  active: string;
  accounts: string[];
  choose(id: string): void;
  add(id: string): Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
          <AccountChoice key={id} id={id} selected={id === selected} active={id === active} choose={() => choose(id)} />
        ))}
      </div>
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
