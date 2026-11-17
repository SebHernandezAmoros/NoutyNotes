import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ideaA, validWorkspace } from '../../packages/domain/src/__fixtures__/workspace';
import type { BoardId } from '../../packages/domain/src';
import { ReactiveWorkspaceEditor, editCardContent, editCardAppearance, moveCardOnBoard, resizeCardOnBoard, addCardToBoard } from '../../packages/application/src';
import { FolderStorage, serializeWorkspace } from '../../packages/storage/src';
import type { WorkspaceDirectory } from '../../packages/storage/src/folder-storage';

afterEach(() => vi.useRealTimers());
function fixture() {
  const seed = validWorkspace();
  const result = serializeWorkspace(seed); if (!result.ok) throw new Error('fixture');
  const files = new Map(Object.entries(result.value).map(([path,text])=>[path,new TextEncoder().encode(text)]));
  const metrics = { requests:0, persisted:0, started:0, completed:0, writes:0, errors:0 };
  const directory: WorkspaceDirectory = {
    listPaths: async()=>[...files.keys()], read:async path=>files.get(path)?.slice(),
    write: async(path,bytes)=>{ metrics.writes++; if(path==='.nouty-transaction.json') {
      if(JSON.parse(new TextDecoder().decode(bytes)).committed) metrics.completed++; else metrics.started++;
    } files.set(path,bytes.slice()); }, remove:async path=>{files.delete(path);},
  };
  const storage = new FolderStorage({permission:async()=>true,folders:async()=>[{key:'demo',folder:directory}],createFolder:async()=>directory});
  const save = storage.save.bind(storage);
  storage.save = async workspace=>{metrics.persisted++;const r=await save(workspace);if(!r.ok)metrics.errors++;return r;};
  return {seed,storage,metrics,files};
}

it('B9-R6-B: línea base reproducible de ocho trazas sobre FolderStorage', async () => {
  vi.useFakeTimers();
  const rows: Record<string, unknown>[] = [];
  for (const scenario of ['continuous-note','quick-note','move-resize','properties','create-edit','boards','shortcut','during-save']) {
    const {seed,storage,metrics}=fixture();
    const opened=await storage.open(seed.id); if(!opened.ok)throw new Error('open');
    const editor=new ReactiveWorkspaceEditor(storage,seed.id,opened.value, {idleMs:250,maxWaitMs:2000});
    const requests: Promise<unknown>[]=[];
    const dispatch=async(action:Parameters<typeof editor.dispatch>[0])=>{
      metrics.requests++;const r=editor.dispatch(action,{label:scenario}); requests.push(r.persisted);expect((await r.applied).ok).toBe(true);
      // Drain deterministic I/O microtasks without advancing the idle clock.
      for(let n=0;n<80;n++)await Promise.resolve();
    };
    if(scenario==='create-edit') {
      // Non-reactive creation is a real storage barrier, matching run() in the UI.
      await editor.flush();
      const added=await addCardToBoard(storage,seed.id,{kind:'note',title:'Nueva'});
      if(!added.ok)throw new Error('create');
      const next=await storage.open(seed.id);if(!next.ok)throw new Error('reload');editor.adopt(next.value,{label:'Crear'});
      for(let n=0;n<4;n++)await dispatch((s,id)=>editCardContent(s,id,added.value,{content:`Nueva ${n}`}));
    } else if(scenario==='move-resize') {
      for(let n=1;n<=3;n++) {
        await dispatch((s,id)=>moveCardOnBoard(s,id,{boardId:'overview' as BoardId,cardId:ideaA.id,to:{x:20+n,y:20}}));
        await dispatch((s,id)=>resizeCardOnBoard(s,id,{boardId:'overview' as BoardId,cardId:ideaA.id,size:{w:4+n,h:3}}));
      }
    } else if(scenario==='properties') {
      for(const bodySize of ['small','medium','large'] as const)await dispatch((s,id)=>editCardAppearance(s,id,ideaA.id,{bodySize}));
    } else {
      let release: (()=>void)|undefined;
      if(scenario==='during-save') {
        const original=storage.save.bind(storage);
        let first=true;storage.save=async w=>{if(first){first=false;await new Promise<void>(r=>{release=r;});}return original(w);};
      }
      // Continuous-note models the existing 700ms source debounce: a 1s burst yields one request.
      const count=scenario==='continuous-note'?1:scenario==='boards'?3:4;
      for(let n=0;n<count;n++) {
        await dispatch((s,id)=>editCardContent(s,id,ideaA.id,{content:`${scenario} ${n}`}));
        if(scenario==='boards')await editor.flush();
        if(scenario==='during-save' && n===0)await vi.advanceTimersByTimeAsync(250);
      }
      if(release)release();
    }
    await editor.flush();await Promise.all(requests);
    const disk=await storage.open(seed.id);expect(disk.ok && disk.value).toEqual(editor.snapshot().workspace);
    expect(metrics.started).toBe(metrics.completed);
    rows.push({scenario,...metrics});
  }
  console.table(rows);
  if(process.env.AUTOSAVE_MEASUREMENT) {
    mkdirSync('artifacts/b9-r6-b',{recursive:true});
    writeFileSync(`artifacts/b9-r6-b/${process.env.AUTOSAVE_MEASUREMENT}.json`,JSON.stringify(rows,null,2));
  }
});

it('B9-R6-B RED: agrupa snapshots compatibles, conserva promesas e historial y no escribe antes del flush', async()=>{
  vi.useFakeTimers();
  const {seed,storage,metrics}=fixture();await storage.open(seed.id);
  const editor=new ReactiveWorkspaceEditor(storage,seed.id,seed,{idleMs:250,maxWaitMs:2000});
  const a=editor.dispatch((s,id)=>editCardContent(s,id,ideaA.id,{title:'A'}),{label:'A'});await a.applied;
  const b=editor.dispatch((s,id)=>editCardContent(s,id,ideaA.id,{content:'B'}),{label:'B'});await b.applied;
  expect(metrics.persisted).toBe(0);
  expect(editor.snapshot().status).toBe('pending');
  await editor.flush();expect((await a.persisted).ok && (await b.persisted).ok).toBe(true);
  expect(metrics.started).toBe(1);expect(editor.snapshot().history.past).toHaveLength(2);
  const undo=editor.undo();expect(undo).not.toBeNull();await undo?.applied;await editor.flush();
  expect((await undo?.persisted)?.ok).toBe(true);
  expect(editor.snapshot().workspace.cards.find(card=>card.id===ideaA.id)?.content).toBe(ideaA.content);
  const redo=editor.redo();expect(redo).not.toBeNull();await redo?.applied;await editor.flush();
  expect((await redo?.persisted)?.ok).toBe(true);
  expect(editor.snapshot().workspace.cards.find(card=>card.id===ideaA.id)?.content).toBe('B');
});

it('B9-R6-B: un cambio externo durante el debounce bloquea el lote sin sobrescribir archivos',async()=>{
  vi.useFakeTimers();
  const {seed,storage,metrics,files}=fixture();await storage.open(seed.id);
  const editor=new ReactiveWorkspaceEditor(storage,seed.id,seed,{idleMs:250,maxWaitMs:2000});
  const local=editor.dispatch((s,id)=>editCardContent(s,id,ideaA.id,{title:'Local pendiente'}),{label:'Local'});
  await local.applied;
  const external=serializeWorkspace({...seed,cards:seed.cards.map(card=>card.id===ideaA.id?{...card,title:'Cambio externo'}:card)});
  if(!external.ok)throw new Error('fixture');
  const path=`cards/${ideaA.id}.md`;
  const bytes=new TextEncoder().encode(external.value[path]);files.set(path,bytes);
  expect((await editor.flush()).ok).toBe(false);
  expect((await local.persisted).ok).toBe(false);
  expect(editor.snapshot()).toMatchObject({status:'conflict',pendingCount:1});
  expect(editor.snapshot().workspace.cards.find(card=>card.id===ideaA.id)?.title).toBe('Local pendiente');
  expect(files.get(path)).toEqual(bytes);expect(metrics.writes).toBe(0);
});
