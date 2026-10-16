import { expect, test } from '@playwright/test';

const RECENTS_KEY = 'noutynotes.recents.v1';

test('UX7-E2A-01/03: dos carpetas homónimas (y sus proyectos homónimos) no se fusionan en Recientes', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: RECENTS_KEY,
    value: JSON.stringify({
      version: 1,
      folders: [
        { id: 'web-conn-1', backend: 'web', name: 'PROYECTOS', origin: 'created', androidUri: null, lastUsedAt: 100 },
        { id: 'web-conn-2', backend: 'web', name: 'PROYECTOS', origin: 'created', androidUri: null, lastUsedAt: 200 },
      ],
      projects: [
        { id: 'web:web-conn-1:historias', workspaceId: 'historias', name: 'Historias', backend: 'web', folderId: 'web-conn-1', lastUsedAt: 100 },
        { id: 'web:web-conn-2:videojuegos', workspaceId: 'videojuegos', name: 'Videojuegos', backend: 'web', folderId: 'web-conn-2', lastUsedAt: 200 },
      ],
    }),
  });
  await page.reload();

  const recent = page.getByTestId('home-recent');
  await expect(recent).toBeVisible();
  // Dos filas de carpeta distintas, ambas tituladas "PROYECTOS" — no se fusionaron en una sola.
  await expect(page.getByTestId('recent-folder-web-conn-1')).toBeVisible();
  await expect(page.getByTestId('recent-folder-web-conn-2')).toBeVisible();
  await expect(page.getByTestId('recent-folder-web-conn-1')).toContainText('PROYECTOS');
  await expect(page.getByTestId('recent-folder-web-conn-2')).toContainText('PROYECTOS');
  // Cada proyecto aparece como entrada independiente, ninguno se mezcla con el otro.
  await expect(page.getByTestId('recent-project-web:web-conn-1:historias')).toContainText('Historias');
  await expect(page.getByTestId('recent-project-web:web-conn-2:videojuegos')).toContainText('Videojuegos');
  await recent.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/ux7-e2a-homonymous-folders.png', fullPage: true });
});

test('UX7-E2A-04/05: un registro heredado (formato E1, sin `origin`/`folderId`) se lee, se migra y sobrevive a releer sin duplicarse', async ({ page }) => {
  await page.goto('./');
  const legacy = JSON.stringify({
    version: 1,
    folders: [{ id: 'web:Historias', backend: 'web', key: 'Historias', name: 'Historias', lastUsedAt: 100 }],
    projects: [{ id: 'web:Historias:guion', workspaceId: 'guion', name: 'Guion', backend: 'web', folderKey: 'Historias', lastUsedAt: 100 }],
  });
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: RECENTS_KEY, value: legacy });
  await page.reload();

  const recent = page.getByTestId('home-recent');
  await expect(recent).toBeVisible();
  await expect(page.getByTestId('recent-folder-web:Historias')).toContainText('Historias');
  const project = page.getByTestId('recent-project-web:Historias:guion');
  await expect(project).toContainText('Guion');
  // Heredada, sin conexión activa: pide reconectar, no "Abrir" directo (no se presume acceso).
  await expect(project.getByText('Reconectar', { exact: true })).toBeVisible();
  await recent.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/ux7-e2a-legacy-migrated.png', fullPage: true });

  // Releer varias veces (recargar) no duplica ni pierde la entrada migrada.
  await page.reload();
  await expect(page.getByTestId('recent-folder-web:Historias')).toHaveCount(1);
  await expect(page.getByTestId('recent-project-web:Historias:guion')).toHaveCount(1);
  const stored = await page.evaluate((key) => localStorage.getItem(key), RECENTS_KEY);
  const parsed = JSON.parse(stored ?? '{}') as { folders: unknown[]; projects: unknown[] };
  expect(parsed.folders).toHaveLength(1);
  expect(parsed.projects).toHaveLength(1);
});
