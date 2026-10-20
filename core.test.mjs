import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,makeLine,addLine,editLine,orderTotal,holdOrder,resumeOrder,completeSale,dailySummary,validateState,dayKey} from './core.mjs';
import {Store,STORAGE_KEY} from './storage.mjs';
const now=new Date('2026-10-20T04:00:00Z');
class MemoryStorage {
  values=new Map(); fail=false;
  getItem(k){return this.values.get(k)??null;}
  setItem(k,v){if(this.fail)throw new DOMException('full','QuotaExceededError');this.values.set(k,v);}
}
test('migrates custom legacy menu and addon prices without overwriting original keys',()=>{
  const memory=new MemoryStorage();
  const menu=JSON.stringify([{id:'custom',name:'店長漢堡',price:62,category:'漢堡'},{id:'tea',name:'紅茶',price:23,category:'飲料'}]);
  memory.setItem('mei-er-mei-menu-v1',menu);
  memory.setItem('mei-er-mei-addons-v1',JSON.stringify([{id:'egg',name:'加蛋',price:18}]));
  const store=new Store(memory);
  assert.equal(store.state.catalog.items[0].price,62);
  assert.equal(store.state.catalog.addons[0].price,18);
  assert.deepEqual(store.state.catalog.items[0].addonIds,['egg']);
  assert.deepEqual(store.state.catalog.items[1].addonIds,[]);
  assert.equal(memory.getItem('mei-er-mei-menu-v1'),menu);
  assert.ok(validateState(store.state));
});
test('addons multiply per portion and identical combinations merge independently of selection order',()=>{
  const s=initialState(null,null,now);
  addLine(s,makeLine(s,'demo0',{addonIds:['egg','cheese'],qty:2,note:'切半'}));
  addLine(s,makeLine(s,'demo0',{addonIds:['cheese','egg'],note:'切半'}));
  addLine(s,makeLine(s,'demo0'));
  assert.equal(s.draft.lines.length,2);
  assert.equal(s.draft.lines[0].qty,3);
  assert.equal(orderTotal(s.draft),255);
  assert.throws(()=>makeLine(s,'demo9',{addonIds:['egg']}),/已停用/);
});
test('editing merges matching combinations and retains one row',()=>{
  const s=initialState(null,null,now);
  addLine(s,makeLine(s,'demo0'));
  addLine(s,makeLine(s,'demo0',{addonIds:['egg'],qty:2}));
  const edited={...s.draft.lines[1],addons:[]};
  editLine(s,edited.id,edited);
  assert.equal(s.draft.lines.length,1);
  assert.equal(s.draft.lines[0].qty,3);
  assert.equal(orderTotal(s.draft),135);
});
test('held order swaps preserve both orders, settings never rewrite price snapshots',()=>{
  const s=initialState(null,null,now);
  addLine(s,makeLine(s,'demo0',{addonIds:['egg']}));
  const first=s.draft.id;holdOrder(s,now);
  addLine(s,makeLine(s,'demo9'));
  const second=s.draft.id;resumeOrder(s,first,now);
  s.catalog.items[0].price=90;s.catalog.addons[0].price=25;
  assert.equal(orderTotal(s.draft),60);
  assert.equal(s.parked[0].id,second);
  assert.ok(validateState(s));
});
test('cash checkout rejects shortage and decimals, snapshots a sale and prevents empty repeat',()=>{
  const s=initialState(null,null,now);addLine(s,makeLine(s,'demo0',{addonIds:['egg','cheese','floss'],qty:2}));
  assert.throws(()=>completeSale(s,159,now),/不足/);
  assert.throws(()=>completeSale(s,160.5,now),/整數/);
  const sale=completeSale(s,200,now);
  assert.equal(sale.total,160);assert.equal(sale.change,40);
  assert.equal(s.draft.lines.length,0);assert.notEqual(s.draft.id,sale.id);
  assert.throws(()=>completeSale(s,200,now),/請先/);
  assert.equal(s.sales.length,1);
  assert.deepEqual([dailySummary(s,dayKey(now)).revenue,dailySummary(s,dayKey(now)).count],[160,1]);
  assert.ok(validateState(s));
});
test('Taipei midnight resets sequence by date',()=>{
  const s=initialState(null,null,new Date('2026-10-20T15:59:00Z'));
  addLine(s,makeLine(s,'demo0'));completeSale(s,45,new Date('2026-10-20T16:01:00Z'));
  assert.equal(s.draft.date,'2026-10-21');assert.equal(s.draft.number,1);
  assert.equal(s.sales[0].businessDate,'2026-10-21');
});
test('failed storage writes leave order and sale records unchanged',()=>{
  const memory=new MemoryStorage(),store=new Store(memory);
  store.transaction(s=>addLine(s,makeLine(s,'demo0')));
  const before=JSON.stringify(store.state),raw=memory.getItem(STORAGE_KEY);memory.fail=true;
  assert.throws(()=>store.transaction(s=>completeSale(s,100)),{name:'QuotaExceededError'});
  assert.equal(JSON.stringify(store.state),before);assert.equal(memory.getItem(STORAGE_KEY),raw);
});
test('stale tabs cannot overwrite newer data',()=>{
  const memory=new MemoryStorage(),first=new Store(memory),second=new Store(memory);
  first.transaction(s=>addLine(s,makeLine(s,'demo0')));
  assert.throws(()=>second.transaction(s=>addLine(s,makeLine(s,'demo9'))),/另一個分頁/);
  assert.equal(new Store(memory).state.draft.lines[0].name,'豬肉漢堡');
});
test('malformed imports cannot replace good state',()=>{
  const memory=new MemoryStorage(),store=new Store(memory),before=store.raw;
  const invalid=structuredClone(store.state);invalid.catalog.items[0].price=-1;
  assert.throws(()=>store.restore(invalid),/餐點資料無效/);
  assert.equal(store.raw,before);assert.equal(memory.getItem(STORAGE_KEY),before);
});
test('valid backup restores orders and counters then survives reload',()=>{
  const memory=new MemoryStorage(),store=new Store(memory),backup=initialState(null,null,now);
  addLine(backup,makeLine(backup,'demo0',{addonIds:['floss']}));
  completeSale(backup,100,now);store.restore(backup);
  const reloaded=new Store(memory);assert.equal(reloaded.state.sales[0].total,55);assert.equal(reloaded.state.draft.number,2);
});
test('corrupt existing records are preserved instead of silently reset',()=>{
  const memory=new MemoryStorage();memory.setItem(STORAGE_KEY,'{bad JSON');
  assert.throws(()=>new Store(memory));assert.equal(memory.getItem(STORAGE_KEY),'{bad JSON');
});
