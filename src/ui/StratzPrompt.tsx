/** An empty STRATZ panel with a way to connect, or the plain hint where the app cannot. */
export function StratzPrompt({ feature, connect }: { feature: string; connect?(): void }) {
  if (!connect) return <>Connect STRATZ for {feature.toLowerCase()}</>;
  return (
    <>
      {feature} need STRATZ.{' '}
      <button type="button" className="link-button stratz-prompt" onClick={connect}>
        Connect STRATZ
      </button>
    </>
  );
}
