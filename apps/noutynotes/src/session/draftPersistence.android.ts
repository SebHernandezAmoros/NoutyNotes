import { PersistentDraftStore } from '@noutynotes/application';
import type { DraftStore } from '@noutynotes/application';
import { File, Paths } from 'expo-file-system';

import { JournalDraftPersistence } from './draftPersistenceCore';

const slot = (index: 0 | 1) => new File(Paths.document, `nouty-editorial-drafts-v1-${index}.json`);

/** Dos archivos privados persistentes; `Paths.document` no es cache ni carpeta SAF pública. */
const journal = () => new JournalDraftPersistence({
  read: async (index) => {
    const file = slot(index);
    return file.exists ? file.text() : null;
  },
  write: async (index, serialized) => { slot(index).write(serialized); },
});

export function createDeviceDraftStore(): DraftStore {
  return new PersistentDraftStore(journal(), { now: () => new Date().toISOString() });
}
