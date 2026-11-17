import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { canvasCardsWorkspace } from '../fixtures/canvas-cards';
import { serializeWorkspace } from '../../packages/storage/src/workspace-codec';

declare global { interface Window { saveLab: { transactions: number; denied: boolean; failWrite: boolean; hold: boolean; release?: () => void } } }
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
    const lab: Window['saveLab'] = { transactions: 0, denied: false, failWrite: false, hold: false };
    window.saveLab = lab;
    Object.defineProperty(FileSystemDirectoryHandle.prototype,'queryPermission',{configurable:true,value:async()=>lab.denied?'denied':'granted'});
    const original=FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable=async function(options) {
      if (lab.failWrite && this.name === 'layout.yaml') throw new DOMException('Synthetic layout write failure', 'UnknownError');
      const stream=await original.call(this,options);const write=stream.write.bind(stream);const marker=this.name==='.nouty-transaction.json';
      stream.write=async chunk=>{
        if(marker) {
          const text=typeof chunk==='string'?chunk:chunk instanceof Uint8Array?new TextDecoder().decode(chunk):'';
          if(text.includes('"committed":false')) {
            lab.transactions++;
            if(lab.hold) {lab.hold=false;await new Promise<void>(resolve=>{lab.release=resolve;});}
          }
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
