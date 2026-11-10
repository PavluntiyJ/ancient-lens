import { useEffect, useState } from 'react';
import { api } from '../App';

/**
 * Whether the STRATZ service answers draft requests (`undefined` until known, `false` when the
 * provider cannot be read) and whether Connect STRATZ is offered. Read again at each provider
 * change; an answer from before the last change is dropped.
 */
export function useStratzProvider(providerRevision: number) {
  const [stratzDraft, setStratzDraft] = useState<boolean>();
  const [stratzConnectable, setStratzConnectable] = useState(false);
  useEffect(() => {
    let active = true;
    void api
      .getProvider()
      .then((info) => {
        if (!active) return;
        setStratzDraft(!!info.serviceConfigured);
        setStratzConnectable(!!info.connectable);
      })
      .catch(() => {
        if (active) setStratzDraft(false);
      });
    return () => {
      active = false;
    };
  }, [providerRevision]);
  return { stratzDraft, stratzConnectable };
}
