import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { canvasCardsWorkspace } from '../fixtures/canvas-cards';
import { serializeWorkspace } from '../../packages/storage/src/workspace-codec';
import { EDITOR_AUTOSAVE } from '../../apps/noutynotes/src/workspace/editorialDraft';

declare global { interface Window { saveLab: { transactions: number; writes: number; committed: number; cardWrites: number; denied: boolean; failWrite: boolean; failCard: boolean; hold: boolean; release?: () => void } } }
async function openLab(page: Page) {
  const result=serializeWorkspace(canvasCardsWorkspace());if(!result.ok)throw new Error('fixture');
  await page.goto('./');
  await page.evaluate(async files=>{
    const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('autosave-lab',{create:true});
    for(const [path,text] of Object.entries(files)) {
      const parts=path.split('/');const name=parts.pop()!;let directory=root;
      for(const part of parts)directory=await directory.getDirectoryHandle(part,{create:true});
      const writer=await (await directory.getFileHandle(name,{create:true})).createWritable();await writer.write(text);await writer.close();
    }
    const lab: Window['saveLab'] = { transactions: 0, writes: 0, committed: 0, cardWrites: 0, denied: false, failWrite: false, failCard: false, hold: false };
    window.saveLab = lab;
    Object.defineProperty(FileSystemDirectoryHandle.prototype,'queryPermission',{configurable:true,value:async()=>lab.denied?'denied':'granted'});
    const original=FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable=async function(options) {
      if (lab.failWrite && this.name === 'layout.yaml') throw new DOMException('Synthetic layout write failure', 'UnknownError');
      if (lab.failCard && this.name === 'idea-a.md' && lab.cardWrites > 0) throw new DOMException('Synthetic later note failure', 'UnknownError');
      const stream=await original.call(this,options);const write=stream.write.bind(stream);const marker=this.name==='.nouty-transaction.json';
      stream.write=async chunk=>{
        lab.writes++;
        if(this.name==='idea-a.md')lab.cardWrites++;
        if(marker) {
          const text=typeof chunk==='string'?chunk:chunk instanceof Uint8Array?new TextDecoder().decode(chunk):'';
          if(text.includes('"committed":false')) {
            lab.transactions++;
            if(lab.hold) {lab.hold=false;await new Promise<void>(resolve=>{lab.release=resolve;});}
          }
          if(text.includes('"committed":true'))lab.committed++;
        }
        await write(chunk);
      };return stream;
    };
    Object.defineProperty(window,'showDirectoryPicker',{configurable:true,value:async()=>root});
  },result.value);
  await page.getByRole('button',{name:'Abrir proyecto',exact:true}).click();
  await page.getByRole('button',{name:'Abrir el proyecto Laboratorio Canvas',exact:true}).click();
  await expect(page.getByTestId('card-idea-a')).toBeVisible();
}
async function readCard(page:Page) {
  return page.evaluate(async()=>{
    const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('autosave-lab');
    return (await (await (await root.getDirectoryHandle('cards')).getFileHandle('idea-a.md')).getFile()).text();
  });
}
async function readProtectedDraft(page:Page) {
  return page.evaluate(()=>new Promise<string>((resolve,reject)=>{
    const open=indexedDB.open('noutynotes-private-drafts',1);
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const db=open.result;const tx=db.transaction('snapshots','readonly');
      const request=tx.objectStore('snapshots').get('editorial-v1');
      request.onsuccess=()=>resolve(String(request.result ?? ''));
      request.onerror=()=>reject(request.error);tx.oncomplete=()=>db.close();
    };
  }));
}
async function nav(page:Page,name:string) {
  const button=page.getByRole('button',{name,exact:true});
  if(!await button.isVisible())await page.getByRole('button',{name:'Más secciones',exact:true}).click();
  await button.click();
}
test('B9-R6-B: escritura continua, Ctrl/Cmd+S y navegación conservan los archivos',async({page},info)=>{
  await openLab(page);
  const card=page.getByTestId('card-idea-a');await card.focus();await page.keyboard.press('Shift+F10');
  await page.getByRole('button',{name:/^Abrir el Inspector de /}).click();
  const title=page.getByLabel('Nombre de la Nota',{exact:true});await title.fill('');
  const typing=title.pressSequentially('0123456789012345678901234567890123456789',{delay:160});
  await expect.poll(()=>page.evaluate(()=>window.saveLab.transactions),{timeout:6500}).toBeGreaterThan(0);
  await typing;
  expect(await page.evaluate(()=>window.saveLab.transactions)).toBeLessThanOrEqual(2);
  await title.fill('Confirmado con Ctrl');await page.keyboard.press('Control+s');
  await expect.poll(()=>readCard(page)).toContain('Confirmado con Ctrl');
  await title.fill('Confirmado con Cmd');await page.keyboard.press('Meta+s');
  await expect.poll(()=>readCard(page)).toContain('Confirmado con Cmd');
  await page.screenshot({path:info.outputPath('saved-inspector.png')});
  await page.getByRole('button',{name:info.project.name==='mobile'?'Volver al tablero':'Cerrar el editor de la tarjeta',exact:true}).click();
  if(info.project.name==='desktop') {
  await card.focus();await page.keyboard.press('Shift+F10');
  await page.getByRole('button',{name:/^Editar .* dentro de la ficha$/}).click();
  const body=page.getByLabel('Contenido visual',{exact:true});await body.fill('');
  const beforeQuick=await page.evaluate(()=>window.saveLab.transactions);
  const quickTyping=body.pressSequentially('Edicion continua rapida',{delay:260});
  await expect.poll(()=>page.evaluate(()=>window.saveLab.transactions),{timeout:6500}).toBeGreaterThan(beforeQuick);
  await quickTyping;
  await page.getByRole('button',{name:'Guardar y cerrar la edición rápida',exact:true}).click();
  await expect.poll(()=>readCard(page)).toContain('Edicion continua rapida');
  }
  await card.focus();await page.keyboard.press('Enter');await page.keyboard.press('Shift+ArrowRight');
  if(info.project.name==='mobile') {
    await page.getByRole('button',{name:'Abrir un tablero',exact:true}).click();
    await page.getByRole('button',{name:'Abrir el tablero Investigación',exact:true}).click();
  } else await page.getByRole('button',{name:'Tablero Investigación',exact:true}).click();
  await expect(page.getByRole('button',{name:'Tablero Investigación',exact:true})).toHaveAttribute('aria-pressed','true');
  await nav(page,'Abrir los assets');await expect(page.getByRole('heading',{name:'Assets',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('saved.png')});
});

test('B9-R6-B: visibilidad, error, reintento y cierre no anuncian guardado prematuro',async({page},info)=>{
  await openLab(page);
  const card=page.getByTestId('card-idea-a');await card.focus();await page.keyboard.press('Enter');
  await page.evaluate(()=>window.saveLab.hold=true);
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(()=>page.evaluate(()=>window.saveLab.transactions)).toBe(1);
  await expect(page.getByText('GUARDANDO EN LA CARPETA…',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>!window.dispatchEvent(new Event('beforeunload',{cancelable:true})))).toBe(true);
  await page.keyboard.press('Shift+ArrowDown');
  await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pagehide'));
  });
  await expect(page.getByText('CARPETA LOCAL · CAMBIOS GUARDADOS',{exact:true})).toHaveCount(0);
  await page.evaluate(()=>window.saveLab.release?.());
  await expect(page.getByText('CARPETA LOCAL · CAMBIOS GUARDADOS',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.saveLab.transactions)).toBe(2);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});window.saveLab.failWrite=true;});
  await card.focus();await page.keyboard.press('Shift+ArrowRight');
  await nav(page,'Abrir los assets');
  await expect(page.getByRole('heading',{name:'Assets',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Error al guardar. Revisar recuperación',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('save-error.png')});
  await nav(page,'Volver a mis espacios');
  await expect(page.getByTestId('card-idea-a')).toBeVisible();
  await page.evaluate(()=>window.saveLab.failWrite=false);
  // Existing recovery entry exposes the existing retry; no new recovery mechanism.
  await page.getByRole('button',{name:/Error al guardar.*Revisar/}).click();
  await page.getByRole('button',{name:/Reintentar|Volver a intentar/}).first().click();
  await page.getByRole('button',{name:'Cerrar centro de recuperación',exact:true}).click();
  await expect(page.getByText('CARPETA LOCAL · CAMBIOS GUARDADOS',{exact:true})).toBeVisible();
  await nav(page,'Volver a mis espacios');
  await expect(page.getByTestId('card-idea-a')).toHaveCount(0);
});

test('B9-R6-B: permiso denegado conserva el trabajo y la ruta de reconexión',async({page})=>{
  await openLab(page);
  await page.evaluate(()=>window.saveLab.denied=true);
  await page.getByTestId('card-idea-a').focus();await page.keyboard.press('Enter');await page.keyboard.press('Shift+ArrowRight');
  await nav(page,'Abrir los assets');
  await expect(page.getByRole('heading',{name:'Assets',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Error al guardar. Revisar recuperación',exact:true}).click();
  await expect(page.getByRole('button',{name:'Reconectar la carpeta conocida',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.saveLab.transactions)).toBe(0);
});

async function editBody(page: Page, quick = false) {
  await page.getByTestId('card-idea-a').focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('button', { name: quick ? /^Editar .* dentro de la ficha$/ : /^Abrir el Inspector de / }).click();
  return page.getByRole('textbox', { name: 'Contenido visual', exact: true });
}

async function chooseLabBoard(page: Page, mobile: boolean, name: string) {
  const tab=page.getByRole('button',{name:`Tablero ${name}`,exact:true});
  if(mobile && !await tab.isVisible()) {
    await page.getByRole('button',{name:'Abrir un tablero',exact:true}).click();
    await page.getByRole('button',{name:`Abrir el tablero ${name}`,exact:true}).click();
  } else await tab.click();
  await expect(tab).toHaveAttribute('aria-pressed','true');
}

test('BUG-B9-SAVE-LOSS: cambiar de tablero inmediatamente preserva todo el cuerpo', async ({page},info) => {
  await openLab(page);
  const body=await editBody(page, info.project.name==='desktop');
  const text='Cuerpo antes de cambiar de tablero. '.repeat(60)+'FINAL-TABLERO-18576';
  await body.fill(text);
  // Mobile fullscreen editing exposes boards after closing the sheet through its real exit.
  if(info.project.name==='mobile')await page.getByRole('button',{name:'Cerrar el editor de la tarjeta',exact:true}).click();
  await chooseLabBoard(page,info.project.name==='mobile','Investigación');
  expect(await readCard(page)).toContain(text);
  await chooseLabBoard(page,info.project.name==='mobile','Resumen');
  await editBody(page,info.project.name==='desktop');
  await expect(page.getByRole('textbox',{name:'Contenido visual',exact:true})).toHaveText(text);
});

test('BUG-B9-SAVE-LOSS: Ctrl+S confirma el cuerpo actual sin esperar el debounce de Lexical', async ({page}) => {
  await openLab(page);
  const body = await editBody(page);
  const text = 'Contenido largo completo. '.repeat(80) + 'FINAL-UNICO-CTRL-S-18573';
  await body.fill(text);
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('workspace-memory')).toHaveText('CARPETA LOCAL · CAMBIOS GUARDADOS');
  expect(await readCard(page)).toContain(text);
});

test('BUG-B9-SAVE-LOSS: salir inmediatamente de edición rápida conserva el final', async ({page}, info) => {
  await openLab(page);
  const quick=info.project.name==='desktop';
  const body = await editBody(page, quick);
  const text = 'Escritura antes de salir. '.repeat(40) + 'FINAL-UNICO-SALIDA-18574';
  await body.fill(text);
  await page.getByRole('button',{name:quick?'Guardar y cerrar la edición rápida':'Cerrar el editor de la tarjeta',exact:true}).click();
  await expect(body).toHaveCount(0);
  expect(await readCard(page)).toContain(text);
  await editBody(page, quick);
  await expect(page.getByRole('textbox',{name:'Contenido visual',exact:true})).toHaveText(text);
});

test('BUG-B9-SAVE-LOSS: cerrar con una escritura anterior en vuelo confirma también el texto posterior', async ({page}, info) => {
  await openLab(page);
  const quick=info.project.name==='desktop';
  const body=await editBody(page,quick);
  await page.evaluate(()=>window.saveLab.hold=true);
  await body.fill('Primera instantanea');
  await expect.poll(()=>page.evaluate(()=>window.saveLab.transactions)).toBe(1);
  const final='Segunda revision completa. '.repeat(50)+'FINAL-CONCURRENTE-18575';
  await body.fill(final);
  await page.getByRole('button',{name:quick?'Guardar y cerrar la edición rápida':'Cerrar el editor de la tarjeta',exact:true}).click();
  await expect(body).toBeVisible();
  await page.evaluate(()=>window.saveLab.release?.());
  await expect(body).toHaveCount(0);
  expect(await readCard(page)).toContain(final);
});

test('BUG-B9-SAVE-LOSS: un autosave local encolado no reemplaza la revisión más nueva al navegar',async({page},info)=>{
  test.skip(info.project.name==='mobile','La cola local pertenece a edición rápida desktop.');
  await openLab(page);
  const body=await editBody(page,true);await page.evaluate(()=>window.saveLab.hold=true);
  await body.fill('Revision A en disco');
  await expect.poll(()=>page.evaluate(()=>window.saveLab.transactions)).toBe(1);
  await body.fill('Revision B intermedia');
  // Deliberate user pause: the intermediate local autosave must be queued before the final edit.
  await page.waitForTimeout(EDITOR_AUTOSAVE.idleMs + 400);
  const final='Revision C que debe sobrevivir. '.repeat(55)+'FINAL-COLA-18577';
  await body.fill(final);
  await page.getByRole('button',{name:'Tablero Investigación',exact:true}).click();
  await expect(page.getByTestId('inline-card-editor')).toBeVisible();
  await page.evaluate(()=>window.saveLab.release?.());
  await expect(page.getByRole('button',{name:'Tablero Investigación',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(await readCard(page)).toContain(final);
  await chooseLabBoard(page,false,'Resumen');
  await editBody(page,true);
  await expect(page.getByRole('textbox',{name:'Contenido visual',exact:true})).toHaveText(final);
  await page.screenshot({path:info.outputPath('bug-reopened.png')});
  await page.getByRole('button',{name:'Guardar y cerrar la edición rápida',exact:true}).click();
  await nav(page,'Volver a mis espacios');
  await page.getByRole('button',{name:'Abrir el proyecto Laboratorio Canvas',exact:true}).click();
  await editBody(page,true);
  await expect(page.getByRole('textbox',{name:'Contenido visual',exact:true})).toHaveText(final);
});

test('BUG-B9-SAVE-LOSS: escribir continuamente en el cuerpo publica pendientes y tiene checkpoint',async({page})=>{
  await openLab(page);
  const body=await editBody(page);
  await body.fill('INICIO ');
  await page.keyboard.press('End');
  const typing=body.pressSequentially('escritura-continua-'.repeat(18),{delay:25});
  try {
    await expect.poll(()=>page.evaluate(()=>window.saveLab.transactions),{timeout:6500}).toBeGreaterThan(0);
  } finally { await typing; }
  await expect(page.getByTestId('workspace-memory')).not.toHaveText('CARPETA LOCAL · CAMBIOS GUARDADOS');
  await page.keyboard.insertText(' FINAL-CONTINUO-18578');
  const expected=await body.innerText();
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('workspace-memory')).toHaveText('CARPETA LOCAL · CAMBIOS GUARDADOS');
  expect(await readCard(page)).toContain(expected);
});

test('BUG-B9-SAVE-LOSS: abrir y cerrar una Nota intacta no genera transacciones',async({page},info)=>{
  await openLab(page);
  const body=await editBody(page,info.project.name==='desktop');
  await page.getByRole('button',{name:info.project.name==='desktop'?'Guardar y cerrar la edición rápida':'Cerrar el editor de la tarjeta',exact:true}).click();
  await expect(body).toHaveCount(0);
  console.info('BUG-B9-SAVE-LOSS untouched transactions',await page.evaluate(()=>window.saveLab.transactions));
  expect(await page.evaluate(()=>window.saveLab.transactions)).toBe(0);
});

test('BUG-B9-SAVE-LOSS: pausas breves se agrupan sin perder el texto final',async({page},info)=>{
  await openLab(page);const body=await editBody(page);
  for(const text of ['a','ab','abc']) {
    await body.fill(text);
    // A user pauses between short edits; 1100ms is the measured comparison workload, not a navigation delay.
    await page.waitForTimeout(1100);
  }
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('workspace-memory')).toHaveText('CARPETA LOCAL · CAMBIOS GUARDADOS');
  expect(await readCard(page)).toContain('<p>abc</p>');
  const metrics=await page.evaluate(()=>({transactions:window.saveLab.transactions,committed:window.saveLab.committed,writes:window.saveLab.writes,cardWrites:window.saveLab.cardWrites}));
  await info.attach('paced-edit-metrics',{body:JSON.stringify(metrics),contentType:'application/json'});
  console.info('BUG-B9-SAVE-LOSS paced edits',JSON.stringify(metrics));
  expect(metrics.transactions).toBe(1);
});

test('BUG-B9-SAVE-LOSS: fallo al salir conserva el cuerpo nuevo y su borrador protegido',async({page},info)=>{
  await openLab(page);const body=await editBody(page,info.project.name==='desktop');
  await page.evaluate(()=>window.saveLab.hold=true);
  await body.fill('Revision anterior confirmandose');
  await expect.poll(()=>page.evaluate(()=>window.saveLab.transactions)).toBe(1);
  const final='Texto protegido durante el fallo. '.repeat(30)+'FINAL-ERROR-18579';
  await body.fill(final);
  await expect.poll(()=>readProtectedDraft(page)).toContain(final);
  await page.evaluate(()=>window.saveLab.failCard=true);
  await nav(page,'Volver a mis espacios');
  await expect(body).toHaveText(final);
  await page.evaluate(()=>window.saveLab.release?.());
  await expect(page.getByRole('button',{name:'Error al guardar. Revisar recuperación',exact:true})).toBeVisible();
  await expect(body).toHaveText(final);
  expect(await readProtectedDraft(page)).toContain(final);
  await page.screenshot({path:info.outputPath('bug-save-error.png')});
  await page.evaluate(()=>window.saveLab.failCard=false);
  await page.getByRole('button',{name:'Error al guardar. Revisar recuperación',exact:true}).click();
  await page.getByRole('button',{name:'Reintentar los cambios pendientes',exact:true}).click();
  await page.getByRole('button',{name:'Cerrar centro de recuperación',exact:true}).click();
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('workspace-memory')).toHaveText('CARPETA LOCAL · CAMBIOS GUARDADOS');
  expect(await readCard(page)).toContain(final);
});
