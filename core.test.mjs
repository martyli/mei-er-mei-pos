import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,makeLine,addLine,editLine,orderTotal,holdOrder,resumeOrder,completeSale,dailySummary,validateState,dayKey,adjustmentValue,adjustmentMoney,toggleAddonIds,memberBalance,createMember,topUpMember,upgradeState} from './core.mjs';
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

function removalState(){
  const s=initialState(null,null,now);s.catalog.items.find(x=>x.id==='demo3').addonIds.push('no-egg');return s;
}
test('negative modifiers apply per portion, coexist with other additions, and survive checkout',()=>{
  const s=removalState();
  addLine(s,makeLine(s,'demo3',{addonIds:['no-egg','cheese'],qty:2}));
  assert.equal(orderTotal(s.draft),70);
  const sale=completeSale(s,100,now);assert.equal(sale.change,30);
  assert.equal(sale.lines[0].addons.find(a=>a.id==='no-egg').price,-15);
  assert.equal(adjustmentMoney(-15),'−$15');assert.equal(adjustmentMoney(10),'+$10');
  assert.equal(adjustmentValue('-15'),-15);
  for(const bad of ['',null,'-1.5','-100000'])assert.throws(()=>adjustmentValue(bad));
  assert.ok(validateState(s));
});
test('negative totals are blocked, zero totals are allowed, conflicting egg choices switch',()=>{
  const s=removalState(),product=s.catalog.items.find(x=>x.id==='demo3');
  assert.deepEqual(toggleAddonIds(s.catalog.addons,['egg','cheese'],'no-egg'),['cheese','no-egg']);
  assert.throws(()=>makeLine(s,'demo3',{addonIds:['egg','no-egg']}),/不能同時/);
  product.price=10;assert.throws(()=>makeLine(s,'demo3',{addonIds:['no-egg']}),/超過/);
  product.price=15;assert.equal(orderTotal({lines:[makeLine(s,'demo3',{addonIds:['no-egg']})]}),0);
});
test('v2 migration preserves all order snapshots, adds preset once and keeps item applicability explicit',()=>{
  const old=initialState(null,null,now);
  old.catalog.addons=old.catalog.addons.filter(a=>a.id!=='no-egg');old.schemaVersion=2;delete old.members;delete old.walletEntries;
  addLine(old,makeLine(old,'demo0',{addonIds:['egg']}));
  const draft=structuredClone(old.draft),memory=new MemoryStorage();memory.setItem(STORAGE_KEY,JSON.stringify(old));
  const first=new Store(memory);assert.equal(first.state.schemaVersion,3);assert.deepEqual(first.state.draft,draft);
  assert.equal(first.state.catalog.addons.find(a=>a.name==='不加蛋').price,-15);
  assert.ok(first.state.catalog.items.every(p=>!p.addonIds.includes('no-egg')));
  assert.deepEqual(first.state.members,[]);assert.deepEqual(first.state.walletEntries,[]);
  first.transaction(s=>{s.catalog.addons=s.catalog.addons.filter(a=>a.id!=='no-egg');});
  assert.ok(!new Store(memory).state.catalog.addons.some(a=>a.id==='no-egg'));
  const bad=structuredClone(old);bad.catalog.addons[0].price=-15;assert.throws(()=>upgradeState(bad));
});
test('opening balance and deposits form a ledger; duplicate deposits and duplicate phones are rejected',()=>{
  const s=initialState(null,null,now),m=createMember(s,{name:'測試會員',phone:'0912-000-001',openingBalance:200},now);
  topUpMember(s,m.id,500,'現金','topup-1',now);
  assert.equal(memberBalance(s,m.id),700);
  assert.throws(()=>topUpMember(s,m.id,500,'現金','topup-1',now),/已完成/);
  assert.throws(()=>createMember(s,{name:'另一會員',phone:'0912000001'},now),/已有會員/);
  assert.throws(()=>topUpMember(s,m.id,-1),/整數/);
  assert.deepEqual([dailySummary(s,dayKey(now)).revenue,dailySummary(s,dayKey(now)).topupCash],[0,500]);
  assert.ok(validateState(s));
});
test('full stored-value payment deducts once and keeps sale and wallet balance consistent',()=>{
  const s=removalState(),m=createMember(s,{name:'測試會員',openingBalance:100},now);
  addLine(s,makeLine(s,'demo3',{addonIds:['no-egg']}));const orderId=s.draft.id;
  const sale=completeSale(s,0,now,{memberId:m.id,expectedOrderId:orderId});
  assert.deepEqual([sale.total,sale.walletAmount,sale.paid,sale.change,sale.balanceAfter],[25,25,0,0,75]);
  assert.equal(sale.payment,'wallet');assert.equal(memberBalance(s,m.id),75);
  assert.throws(()=>completeSale(s,0,now,{memberId:m.id,expectedOrderId:orderId}),/已結帳/);
  assert.equal(s.walletEntries.filter(e=>e.type==='spend').length,1);
  assert.ok(validateState(s));
});
test('split payment takes available wallet credit and cash shortage without overdraft',()=>{
  const s=initialState(null,null,now),m=createMember(s,{name:'測試會員',openingBalance:20},now);
  addLine(s,makeLine(s,'demo0'));
  assert.throws(()=>completeSale(s,24,now,{memberId:m.id,cashFallback:true}),/不足/);
  assert.equal(memberBalance(s,m.id),20);assert.equal(s.sales.length,0);
  const sale=completeSale(s,100,now,{memberId:m.id,cashFallback:true});
  assert.deepEqual([sale.payment,sale.walletAmount,sale.paid,sale.change,sale.balanceAfter],['mixed',20,100,75,0]);
  assert.equal(memberBalance(s,m.id),0);
  const summary=dailySummary(s,dayKey(now));assert.deepEqual([summary.revenue,summary.walletSales,summary.cashSales],[45,20,25]);
  assert.ok(validateState(s));
});
test('cash checkout does not affect any member wallet',()=>{
  const s=initialState(null,null,now),m=createMember(s,{name:'測試會員',openingBalance:300},now);
  addLine(s,makeLine(s,'demo0'));completeSale(s,100,now);
  assert.equal(memberBalance(s,m.id),300);assert.equal(s.walletEntries.length,1);
  assert.ok(validateState(s));
});
test('failed wallet checkout and deposit storage writes preserve balances, draft and ledger',()=>{
  const memory=new MemoryStorage(),store=new Store(memory);const m=store.transaction(s=>createMember(s,{name:'測試會員',openingBalance:100},now));
  store.transaction(s=>addLine(s,makeLine(s,'demo0')));
  const before=store.raw;memory.fail=true;
  assert.throws(()=>store.transaction(s=>completeSale(s,0,now,{memberId:m.id})),{name:'QuotaExceededError'});
  assert.throws(()=>store.transaction(s=>topUpMember(s,m.id,50)),{name:'QuotaExceededError'});
  assert.equal(store.raw,before);assert.equal(memberBalance(store.state,m.id),100);assert.equal(store.state.sales.length,0);assert.equal(store.state.draft.lines.length,1);
});
test('member wallet backup restores exactly and rejects missing or tampered ledger records',()=>{
  const s=initialState(null,null,now),m=createMember(s,{name:'測試會員',openingBalance:100},now);
  topUpMember(s,m.id,200,'','deposit',now);addLine(s,makeLine(s,'demo0'));completeSale(s,0,now,{memberId:m.id});
  const memory=new MemoryStorage(),store=new Store(memory);store.restore(s);
  assert.equal(memberBalance(new Store(memory).state,m.id),255);
  const invalid=structuredClone(s);invalid.walletEntries[2].balanceAfter++;
  assert.throws(()=>store.restore(invalid),/餘額/);
  const missing=structuredClone(s);missing.walletEntries.pop();assert.throws(()=>validateState(missing),/缺少儲值/);
  const negative=structuredClone(s);negative.walletEntries[0].amount=-10;assert.throws(()=>validateState(negative));
  assert.equal(memberBalance(store.state,m.id),255);
});
test('stale tab cannot duplicate a stored-value debit or top-up',()=>{
  const memory=new MemoryStorage(),first=new Store(memory),m=first.transaction(s=>createMember(s,{name:'測試會員',openingBalance:100},now));
  first.transaction(s=>addLine(s,makeLine(s,'demo0')));const stale=new Store(memory);
  first.transaction(s=>completeSale(s,0,now,{memberId:m.id}));
  assert.throws(()=>stale.transaction(s=>completeSale(s,0,now,{memberId:m.id})),/另一個分頁/);
  assert.throws(()=>stale.transaction(s=>topUpMember(s,m.id,50)),/另一個分頁/);
  assert.equal(memberBalance(new Store(memory).state,m.id),55);
});

test('stored-value payment permits negative balances and deposits pay down the debt',()=>{
  const s=initialState(null,null,now),m=createMember(s,{name:'測試會員',openingBalance:30},now);
  addLine(s,makeLine(s,'demo4'));const sale=completeSale(s,0,now,{memberId:m.id});
  assert.equal(sale.total,50);assert.equal(sale.balanceAfter,-20);assert.equal(sale.walletAmount,50);assert.equal(sale.payment,'wallet');
  topUpMember(s,m.id,100,'補儲值','debt-topup',now);assert.equal(memberBalance(s,m.id),80);assert.ok(validateState(s));
  const memory=new MemoryStorage(),store=new Store(memory);store.restore(s);assert.equal(memberBalance(new Store(memory).state,m.id),80);
});
test('zero and already-negative members can charge meals; opening debt is supported',()=>{
  const s=initialState(null,null,now),m=createMember(s,{name:'測試會員',openingBalance:-10},now);
  addLine(s,makeLine(s,'demo0'));completeSale(s,0,now,{memberId:m.id});assert.equal(memberBalance(s,m.id),-55);
  topUpMember(s,m.id,20,'','partial-debt',now);assert.equal(memberBalance(s,m.id),-35);assert.ok(validateState(s));
  const zero=createMember(s,{name:'零餘額測試'},now);addLine(s,makeLine(s,'demo9'));completeSale(s,0,now,{memberId:zero.id});assert.equal(memberBalance(s,zero.id),-20);assert.ok(validateState(s));
});
