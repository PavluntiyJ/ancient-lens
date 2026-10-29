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
