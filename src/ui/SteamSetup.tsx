import { useState, type ReactNode } from 'react';
import { Check, CircleAlert, Wrench } from 'lucide-react';
import { api, errorMessage, Notice } from './App';
import { repairCloses, repairSummary, repairWarning, type SteamSetup } from '../shared/steam-setup';

const configText = {
  installed: 'Installed',
  missing: 'Missing',
  outdated: 'From an older setup',
  unknown: 'Unknown',
} as const;
const launchText = { present: '-gamestateintegration is set', missing: 'Missing', unknown: 'Unknown' } as const;

function Item({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className={ok ? 'ok' : 'missing'}>
      {ok ? <Check size={15} aria-label="Done" /> : <CircleAlert size={15} aria-label="Needs attention" />}
      <b>{label}</b>
      <span>{detail}</span>
    </li>
  );
}

/** Checks the Steam side of the connection and repairs it after the user confirms. */
export function SteamSetupPanel({
  setup,
  changed,
  children,
}: {
  setup?: SteamSetup;
  changed(value: SteamSetup): void;
  /** Manual instructions, for when the automatic setup cannot be used. */
  children: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const [launch, setLaunch] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function repair() {
    setWorking(true);
    setError('');
    setMessage('');
    try {
      const result = await api.repairSteamSetup!(launch);
      setMessage(repairSummary(result));
      changed(result.status);
      setConfirming(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setWorking(false);
    }
  }
  const warning = setup && repairWarning(setup);
  const closing = setup && [setup.gameRunning && 'Dota 2', setup.steamRunning && 'Steam'].filter(Boolean).join(' and ');
  return (
    <>
      {!setup ? (
        <p className="muted">Checking Steam…</p>
      ) : (
        <>
          <ul className="setup-checks">
            <Item ok={!!setup.steamPath} label="Steam" detail={setup.steamPath ?? 'Not found'} />
            <Item ok={!!setup.dotaPath} label="Dota 2" detail={setup.dotaPath ?? 'Not found'} />
            <Item ok={setup.config === 'installed'} label="GSI file" detail={configText[setup.config]} />
            <Item ok={setup.launchOption === 'present'} label="Launch option" detail={launchText[setup.launchOption]} />
          </ul>
          {setup.state === 'ready' && <Notice>Dota 2 is set up to send game data to Ancient Lens.</Notice>}
          {setup.state === 'restart-game' && (
            <Notice>Dota 2 was started before the launch option was added. Restart Dota 2 to connect it.</Notice>
          )}
          {setup.state === 'unavailable' && setup.detail && (
            <Notice error>{setup.detail} Use the manual setup below.</Notice>
          )}
          {setup.state === 'repair' && api.repairSteamSetup && (
            <div className="steam-repair">
              {warning && <p className="muted">{warning}</p>}
              <label>
                <input
                  type="checkbox"
                  checked={launch}
                  disabled={working}
                  onChange={(event) => setLaunch(event.target.checked)}
                />
                Start Dota 2 afterwards
              </label>
              <div className="steam-repair-actions">
                {confirming ? (
                  <>
                    <button className="primary" disabled={working} onClick={() => void repair()}>
                      <Wrench size={16} />
                      {working ? 'Setting up…' : `Close ${closing} and set up`}
                    </button>
                    <button className="secondary" disabled={working} onClick={() => setConfirming(false)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    className="primary"
                    disabled={working}
                    onClick={() => (repairCloses(setup) ? setConfirming(true) : void repair())}
                  >
                    <Wrench size={16} />
                    {working ? 'Setting up…' : 'Set up automatically'}
                  </button>
                )}
              </div>
              {working && setup.steamRunning && setup.launchOption === 'missing' && (
                <p className="fine-print">Waiting for Steam to close. This can take up to a minute.</p>
              )}
            </div>
          )}
        </>
      )}
      {message && <Notice>{message}</Notice>}
      {error && <Notice error>{error}</Notice>}
      <details className="manual-setup" open={setup?.state === 'unavailable'}>
        <summary>Set up manually</summary>
        {children}
      </details>
    </>
  );
}
