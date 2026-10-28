import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NoteEditor } from '../src/ui/NoteEditor';

vi.mock('../src/ui/App', () => ({ api: {}, errorMessage: String }));

it('offers to add a note, or shows the note with its tag and an edit action', () => {
  expect(renderToStaticMarkup(<NoteEditor accountId="55" name="Kestrel" />)).toContain('Add note');
  const html = renderToStaticMarkup(
    <NoteEditor
      accountId="55"
      name="Kestrel"
      note={{ accountId: '55', name: 'Kestrel', text: 'Calls smokes', tag: 'teammate', updatedAt: '' }}
    />,
  );
  expect(html).toContain('tag-teammate');
  expect(html).toContain('Calls smokes');
  expect(html).toContain('Edit note');
});
