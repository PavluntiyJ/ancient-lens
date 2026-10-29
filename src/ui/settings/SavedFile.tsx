import { useState } from 'react';
import { errorMessage, Notice } from '../App';

/** Runs a save dialog and shows where the file went, next to the button that saved it. */
export function useSavedFile(save: () => Promise<string | null>) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function run() {
    setError('');
    setMessage('');
    try {
      const path = await save();
      if (path) setMessage(`Saved: ${path}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const notice = (
    <>
      {message && <Notice>{message}</Notice>}
      {error && <Notice error>{error}</Notice>}
    </>
  );
  return { run: () => void run(), notice };
}
