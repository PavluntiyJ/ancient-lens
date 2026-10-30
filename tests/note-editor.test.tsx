import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NoteEditor } from '../src/ui/NoteEditor';

vi.mock('../src/ui/App', () => ({ api: {}, errorMessage: String }));

it('offers to add a note, or shows the note with its date and an edit action', () => {
  expect(renderToStaticMarkup(<NoteEditor accountId="55" name="Kestrel" />)).toContain('Add note');
  const html = renderToStaticMarkup(
    <NoteEditor
      accountId="55"
      name="Kestrel"
      note={{ accountId: '55', name: 'Kestrel', text: 'Calls smokes', tag: 'avoid', updatedAt: '2026-10-26T12:00:00Z' }}
    />,
  );
  // One kind of note: an older note's type is not shown.
  expect(html).not.toContain('tag-');
  expect(html).toContain('Note of Oct 26, 2026');
  expect(html).not.toContain('Note type');
  expect(html).toContain('Calls smokes');
  expect(html).toContain('Edit note');
});

it('has no editor for the own account, only a compliment, and keeps an older note readable', () => {
  const html = renderToStaticMarkup(<NoteEditor accountId="1" name="Me" self />);
  expect(html).toContain('self-note');
  expect(html).toContain('aria-disabled="true"');
  expect(html).toContain('Everybody knows you are the best.');
  expect(html).not.toContain('role="button"');
  const older = renderToStaticMarkup(
    <NoteEditor
      accountId="1"
      name="Me"
      self
      note={{ accountId: '1', name: 'Me', text: 'Keep this note', tag: 'neutral', updatedAt: '2026-10-26T12:00:00Z' }}
    />,
  );
  expect(older).toContain('Keep this note');
  expect(older).not.toContain('Edit note');
  expect(older).not.toContain('Add note');
});
