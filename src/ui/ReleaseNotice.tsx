import { CircleArrowUp } from 'lucide-react';
import type { Release } from '../shared/domain';

/** A new version is out: a link to its release page, nothing is downloaded. */
export function ReleaseNotice({
  release,
  current,
  open,
  later,
  skip,
}: {
  release: Release;
  current: string;
  open(): void;
  later(): void;
  skip(): void;
}) {
  return (
    <div className="notice release-notice" role="status">
      <CircleArrowUp size={16} />
      <span>
        <b>Ancient Lens {release.version}</b>
        {release.prerelease ? ' (prerelease)' : ''} is out; you have {current}.
      </span>
      <span className="release-actions">
        <button className="secondary" onClick={open}>
          What's new
        </button>
        <button className="secondary" onClick={later}>
          Later
        </button>
        <button className="secondary" onClick={skip}>
          Skip this version
        </button>
      </span>
    </div>
  );
}
