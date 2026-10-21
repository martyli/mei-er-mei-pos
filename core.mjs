// Pure domain logic. All money is an integer number of New Taiwan Dollars.
export const VERSION = 3;
export const MAX_PRICE = 99999;
export const MAX_QTY = 999;
export const MAX_BALANCE = 999999999;
export const id = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(b => b.toString(16).padStart(2,'0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
};
export const money = value => (value < 0 ? '−$' : '$') + Math.abs(value).toLocaleString('zh-TW');
export const adjustmentMoney = value => (value < 0 ? '−' : '+') + money(Math.abs(value));
export const dayKey = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(date);
export function requireValue(condition, message) { if (!condition) throw new Error(message); }
export function priceValue(value) {
  requireValue(value !== '' && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= MAX_PRICE, '價格請輸入 0～99,999 的整數');
  return Number(value);
}
export function adjustmentValue(value) {
  requireValue(value !== null && String(value).trim() !== '' && Number.isInteger(Number(value)) && Math.abs(Number(value)) <= MAX_PRICE, '價格調整請輸入 -99,999～99,999 的整數');
  return Number(value);
}
export const addonsConflict = (a,b) => a.id !== b.id && ((a.excludes || []).includes(b.id) || (b.excludes || []).includes(a.id));
export function toggleAddonIds(available,selected,key) {
  const choice=available.find(a=>a.id===key);
  requireValue(choice,'找不到這個客製選項');
  if(selected.includes(key))return selected.filter(x=>x!==key);
  return [...selected.filter(x=>!addonsConflict(choice,available.find(a=>a.id===x))),key];
}
function checkLineAdjustments(line) {
  requireValue(line.addons.every((a,i)=>line.addons.slice(i+1).every(b=>!addonsConflict(a,b))),'這些客製選項不能同時選擇');
  requireValue(unitTotal(line)>=0,'減項金額超過餐點價格，請調整客製選項');
}
export const unitTotal = line => line.basePrice + line.addons.reduce((sum, addon) => sum + addon.price, 0);
export const orderTotal = order => order.lines.reduce((sum, line) => sum + unitTotal(line) * line.qty, 0);
export const orderCount = order => order.lines.reduce((sum, line) => sum + line.qty, 0);
export const lineKey = line => JSON.stringify([line.productId, line.name, line.categoryName, line.basePrice,
  line.addons.map(a => [a.id, a.name, a.price]).sort((a,b) => a[0].localeCompare(b[0])), line.note.trim()]);

const defaults = [
  ['漢堡','豬肉漢堡',45],['漢堡','起司漢堡',55],['漢堡','雞腿漢堡',70],
  ['吐司','火腿蛋吐司',40],['吐司','鮪魚蛋吐司',50],['吐司','培根蛋吐司',45],
  ['蛋餅','原味蛋餅',30],['蛋餅','起司蛋餅',40],['蛋餅','玉米蛋餅',40],
  ['飲料','紅茶',20],['飲料','奶茶',25],['飲料','豆漿',25],['其他','薯餅',25],['其他','雞塊',40]
];
export const DEFAULT_ADDONS = [{id:'egg',name:'加蛋',price:15,enabled:true},{id:'cheese',name:'起司',price:10,enabled:true},{id:'floss',name:'肉鬆',price:10,enabled:true}];
function seedRemoval(catalog) {
  // Add a configurable preset without guessing which recipes include an egg.
  if(catalog.addons.some(a=>a.name==='不加蛋' && a.price<0))return;
  const egg=catalog.addons.find(a=>a.name==='加蛋' && a.price>0);
  const key=catalog.addons.some(a=>a.id==='no-egg')?id():'no-egg';
  catalog.addons.push({id:key,name:'不加蛋',price:-15,enabled:true,excludes:egg?[egg.id]:[]});
}
export function upgradeState(candidate) {
  validateState(candidate,{allowLegacy:true});
  const next=structuredClone(candidate);
  if(next.schemaVersion===2){
    seedRemoval(next.catalog);
    next.members=[];next.walletEntries=[];
    next.schemaVersion=VERSION;
    validateState(next);
  }
  return next;
}
export function newOrder(state, now = new Date()) {
  const date = dayKey(now);
  state.counters[date] = (state.counters[date] || 0) + 1;
  return {id:id(),number:state.counters[date],date,type:'takeout',table:'',note:'',lines:[],createdAt:now.toISOString()};
}
export function initialState(legacyMenu = null, legacyAddons = null, now = new Date()) {
  const menu = legacyMenu ?? defaults.map(([category,name,price],i) => ({id:'demo'+i,category,name,price}));
  requireValue(Array.isArray(menu) && menu.every(x => x && typeof x.id === 'string' && typeof x.category === 'string' && typeof x.name === 'string' && Number.isInteger(x.price) && x.price >= 0 && x.price <= MAX_PRICE), '原有菜單資料無法讀取，請先保留資料備份');
  const addons = structuredClone(legacyAddons ?? DEFAULT_ADDONS).map(a => ({...a,enabled:true}));
  const names = [...new Set(['漢堡','吐司','蛋餅','飲料','其他',...menu.map(x => x.category)])];
  const categories = names.map((name,i) => ({id:'cat-'+i,name,color:i%5}));
  const state = {schemaVersion:VERSION,revision:0,catalog:{categories,addons,items:menu.map(x => ({
    id:x.id,name:x.name,price:x.price,categoryId:categories.find(c=>c.name===x.category).id,
    addonIds:x.category==='飲料'?[]:addons.map(a=>a.id),enabled:true
  }))},counters:{},draft:null,parked:[],sales:[],members:[],walletEntries:[]};
  seedRemoval(state.catalog);
  state.draft = newOrder(state,now);
  validateState(state);
  return state;
}
export function makeLine(state, productId, {addonIds=[],qty=1,note=''} = {}) {
  const item=state.catalog.items.find(x=>x.id===productId);
  requireValue(item?.enabled,'這個餐點已停售或移除');
  requireValue(Number.isInteger(qty) && qty>0 && qty<=MAX_QTY, '每列份數須為 1～999');
  const unique=[...new Set(addonIds)];
  const addons=unique.map(key=>{
    const a=state.catalog.addons.find(x=>x.id===key && x.enabled && item.addonIds.includes(key));
    requireValue(a,'所選加料已停用，請重新選擇');
    return {id:a.id,name:a.name,price:a.price,...(a.excludes?{excludes:[...a.excludes]}:{})};
  });
  const line={id:id(),productId:item.id,name:item.name,categoryName:state.catalog.categories.find(c=>c.id===item.categoryId).name,
    basePrice:item.price,addons,qty,note:String(note).trim().slice(0,200)};
  checkLineAdjustments(line);return line;
}
export function addLine(state,line) {
  checkLineAdjustments(line);
  const same=state.draft.lines.find(x=>lineKey(x)===lineKey(line));
  if(same){requireValue(same.qty+line.qty<=MAX_QTY,'同一組合最多 999 份');same.qty+=line.qty;}
  else state.draft.lines.push(structuredClone(line));
}
export function editLine(state,lineId,replacement) {
  requireValue(state.draft.lines.some(x=>x.id===lineId),'找不到這份餐點');
  requireValue(Number.isInteger(replacement.qty)&&replacement.qty>0&&replacement.qty<=MAX_QTY,'每列份數須為 1～999');
  checkLineAdjustments(replacement);
  state.draft.lines=state.draft.lines.filter(x=>x.id!==lineId);
  addLine(state,replacement);
}
export function changeQuantity(state,lineId,delta) {
  const line=state.draft.lines.find(x=>x.id===lineId);
  requireValue(line,'找不到這份餐點');
  requireValue(line.qty+delta<=MAX_QTY,'同一組合最多 999 份');
  line.qty+=delta;
  if(line.qty<=0)state.draft.lines=state.draft.lines.filter(x=>x.id!==lineId);
}
export function holdOrder(state,now=new Date()) {
  requireValue(state.draft.lines.length,'先加入餐點再暫存');
  state.parked.push({...structuredClone(state.draft),heldAt:now.toISOString()});
  state.draft=newOrder(state,now);
}
export function resumeOrder(state,orderId,now=new Date()) {
  const order=state.parked.find(x=>x.id===orderId);
  requireValue(order,'找不到這筆暫存訂單');
  if(state.draft.lines.length)state.parked.push({...structuredClone(state.draft),heldAt:now.toISOString()});
  state.parked=state.parked.filter(x=>x.id!==orderId);
  state.draft=structuredClone(order);delete state.draft.heldAt;
}
export const memberBalance=(state,memberId)=>state.walletEntries.filter(e=>e.memberId===memberId).reduce((n,e)=>n+e.amount,0);
export const memberCode=member=>'M-'+member.id.replaceAll('-','').slice(-6).toUpperCase();
const normalizedPhone=phone=>phone.replace(/[^\d+]/g,'');
function memberFields(state,{name,phone='',note=''},exceptId=null) {
  const values={name:String(name??'').trim(),phone:String(phone).trim(),note:String(note).trim()};
  requireValue(values.name.length>0&&values.name.length<=80,'請輸入 1～80 字的會員名稱');
  requireValue(values.phone.length<=30&&/^[\d+()\s-]*$/.test(values.phone),'電話請輸入數字，可包含 +、空格或連字號');
  requireValue(values.note.length<=200,'會員備註最多 200 字');
  requireValue(!values.phone||normalizedPhone(values.phone).length>0,'請輸入有效電話');
  requireValue(!values.phone||!state.members.some(m=>m.id!==exceptId&&normalizedPhone(m.phone)===normalizedPhone(values.phone)),'此電話已有會員，請查詢原帳戶');
  return values;
}
export function createMember(state,details,now=new Date(),memberId=id()) {
  const fields=memberFields(state,details),opening=details.openingBalance??0;
  requireValue(Number.isSafeInteger(opening)&&Math.abs(opening)<=MAX_BALANCE,'既有餘額須為 -999,999,999～999,999,999 的整數');
  requireValue(!state.members.some(m=>m.id===memberId),'會員已建立，請勿重複送出');
  const member={id:memberId,...fields,createdAt:now.toISOString()};
  state.members.push(member);
  state.walletEntries.push({id:id(),memberId,type:'opening',amount:opening,balanceAfter:opening,note:'首次建檔既有餘額',createdAt:now.toISOString()});
  return member;
}
export function updateMember(state,memberId,details) {
  const member=state.members.find(m=>m.id===memberId);requireValue(member,'找不到會員');
  Object.assign(member,memberFields(state,details,memberId));return member;
}
export function topUpMember(state,memberId,amount,note='',operationId=id(),now=new Date()) {
  requireValue(state.members.some(m=>m.id===memberId),'找不到會員');
  requireValue(Number.isSafeInteger(amount)&&amount>0&&amount<=MAX_BALANCE,'儲值金額須為 1～999,999,999 的整數');
  requireValue(!state.walletEntries.some(e=>e.id===operationId),'這筆儲值已完成，請勿重複送出');
  const balanceAfter=memberBalance(state,memberId)+amount;
  requireValue(balanceAfter<=MAX_BALANCE,'儲值後餘額超過上限');
  const entry={id:operationId,memberId,type:'topup',amount,balanceAfter,note:String(note).trim().slice(0,200),createdAt:now.toISOString()};
  state.walletEntries.push(entry);return entry;
}
export function completeSale(state,paid,now=new Date(),{memberId=null,expectedOrderId=null,cashFallback=false}={}) {
  requireValue(!expectedOrderId||state.draft.id===expectedOrderId,'訂單已變更或已結帳，請重新確認');
  requireValue(state.draft.lines.length,'請先加入餐點');
  state.draft.lines.forEach(checkLineAdjustments);
  const total=orderTotal(state.draft);
  const member=memberId?state.members.find(m=>m.id===memberId):null;
  requireValue(!memberId||member,'找不到會員');
  const balance=member?memberBalance(state,memberId):0;
  requireValue(!member||total>0,'零元訂單請改用現金結帳');
  const walletAmount=member?(cashFallback?Math.min(Math.max(balance,0),total):total):0,cashDue=total-walletAmount;
  requireValue(!member||balance-walletAmount>=-MAX_BALANCE,'扣款後欠款超過帳戶上限');
  requireValue(Number.isSafeInteger(paid)&&paid>=0&&paid<=999999999,'實收請輸入有效的整數金額');
  requireValue(paid>=cashDue,'實收金額不足');
  requireValue(cashDue>0||paid===0||!member,'全額儲值金付款不需輸入現金');
  requireValue(!state.sales.some(x=>x.id===state.draft.id),'這筆訂單已結帳');
  const sale={...structuredClone(state.draft),total,paid,change:paid-cashDue,walletAmount,payment:walletAmount?(cashDue?'mixed':'wallet'):'cash',status:'paid',completedAt:now.toISOString(),businessDate:dayKey(now)};
  if(member&&walletAmount>0){
    sale.member={id:member.id,name:member.name,code:memberCode(member)};sale.balanceAfter=balance-walletAmount;
    state.walletEntries.push({id:id(),memberId:member.id,type:'spend',amount:-walletAmount,balanceAfter:sale.balanceAfter,note:'訂單 #'+String(sale.number).padStart(3,'0'),saleId:sale.id,createdAt:now.toISOString()});
  }
  state.sales.push(sale);state.draft=newOrder(state,now);return sale;
}
export function dailySummary(state,date=dayKey()) {
  const sales=state.sales.filter(s=>s.businessDate===date&&s.status==='paid');
  const revenue=sales.reduce((n,s)=>n+s.total,0);
  const popular=new Map();
  for(const s of sales)for(const line of s.lines){const value=popular.get(line.name)||{name:line.name,qty:0,revenue:0};value.qty+=line.qty;value.revenue+=unitTotal(line)*line.qty;popular.set(line.name,value);}
  const walletSales=sales.reduce((n,s)=>n+(s.walletAmount||0),0);
  const topupCash=(state.walletEntries||[]).filter(e=>e.type==='topup'&&dayKey(new Date(e.createdAt))===date).reduce((n,e)=>n+e.amount,0);
  return {sales,revenue,count:sales.length,average:sales.length?Math.round(revenue/sales.length):0,walletSales,cashSales:revenue-walletSales,topupCash,items:[...popular.values()].sort((a,b)=>b.qty-a.qty)};
}

// Validate every imported/persisted record before enabling writes.
export function validateState(s,{allowLegacy=false}={}) {
  const str=(v,max=120)=>typeof v==='string'&&v.length<=max;
  const named=v=>str(v,80)&&v.trim().length>0;
  const amount=v=>Number.isInteger(v)&&v>=0&&v<=MAX_PRICE;
  const adjustment=v=>Number.isInteger(v)&&v>=(s?.schemaVersion===2?0:-MAX_PRICE)&&v<=MAX_PRICE;
  const timestamp=v=>str(v)&&Number.isFinite(Date.parse(v));
  const unique=list=>new Set(list.map(x=>x.id)).size===list.length;
  const identifier=v=>str(v)&&v.length>0;
  const array=(v,max=100000)=>Array.isArray(v)&&v.length<=max;
  const exclusions=a=>a.excludes===undefined||(array(a.excludes,1000)&&new Set(a.excludes).size===a.excludes.length&&a.excludes.every(k=>identifier(k)&&k!==a.id));
  requireValue(s?.schemaVersion===VERSION||(allowLegacy&&s?.schemaVersion===2),'備份版本不相容');
  requireValue(Number.isSafeInteger(s.revision)&&s.revision>=0,'資料版本無效');
  const c=s.catalog;
  requireValue(c&&array(c.categories,100)&&c.categories.length>0&&unique(c.categories)&&c.categories.every(x=>identifier(x.id)&&named(x.name)&&Number.isInteger(x.color)&&x.color>=0&&x.color<5),'分類資料無效');
  requireValue(array(c.addons,1000)&&unique(c.addons)&&c.addons.every(x=>identifier(x.id)&&named(x.name)&&adjustment(x.price)&&typeof x.enabled==='boolean'&&exclusions(x)&&(x.excludes||[]).every(k=>c.addons.some(a=>a.id===k))),'客製選項資料無效');
  requireValue(array(c.items,10000)&&unique(c.items)&&c.items.every(x=>identifier(x.id)&&named(x.name)&&amount(x.price)&&typeof x.enabled==='boolean'&&c.categories.some(k=>k.id===x.categoryId)&&array(x.addonIds,1000)&&new Set(x.addonIds).size===x.addonIds.length&&x.addonIds.every(k=>c.addons.some(a=>a.id===k))),'餐點資料無效');
  const validLine=l=>l&&identifier(l.id)&&identifier(l.productId)&&named(l.name)&&named(l.categoryName)&&amount(l.basePrice)&&Number.isInteger(l.qty)&&l.qty>0&&l.qty<=MAX_QTY&&str(l.note,200)&&array(l.addons,1000)&&unique(l.addons)&&l.addons.every(a=>identifier(a.id)&&named(a.name)&&adjustment(a.price)&&exclusions(a))&&unitTotal(l)>=0&&l.addons.every((a,i)=>l.addons.slice(i+1).every(b=>!addonsConflict(a,b)));
  const validOrder=o=>o&&identifier(o.id)&&Number.isSafeInteger(o.number)&&o.number>0&&str(o.date)&&/^\d{4}-\d{2}-\d{2}$/.test(o.date)&&['takeout','dinein'].includes(o.type)&&str(o.table,20)&&str(o.note,200)&&timestamp(o.createdAt)&&array(o.lines,2000)&&unique(o.lines)&&o.lines.every(validLine);
  requireValue(validOrder(s.draft),'目前訂單資料無效');
  requireValue(array(s.parked,10000)&&unique(s.parked)&&s.parked.every(o=>validOrder(o)&&timestamp(o.heldAt)&&o.lines.length>0),'暫存訂單資料無效');
  const validPayment=o=>{
    const wallet=o.walletAmount??0,cashDue=o.total-wallet;
    if(!Number.isSafeInteger(wallet)||wallet<0||wallet>o.total||!Number.isSafeInteger(o.paid)||o.paid<cashDue||o.paid>MAX_BALANCE||o.change!==o.paid-cashDue)return false;
    if(o.payment==='cash')return wallet===0;
    return s.schemaVersion===VERSION&&wallet>0&&o.member&&identifier(o.member.id)&&named(o.member.name)&&str(o.member.code)&&Number.isSafeInteger(o.balanceAfter)&&Math.abs(o.balanceAfter)<=MAX_BALANCE&&((o.payment==='wallet'&&cashDue===0&&o.paid===0)||(o.payment==='mixed'&&cashDue>0));
  };
  requireValue(array(s.sales)&&unique(s.sales)&&s.sales.every(o=>validOrder(o)&&o.lines.length>0&&timestamp(o.completedAt)&&str(o.businessDate)&&/^\d{4}-\d{2}-\d{2}$/.test(o.businessDate)&&o.status==='paid'&&Number.isSafeInteger(o.total)&&o.total===orderTotal(o)&&validPayment(o)),'交易資料無效');
  requireValue(unique([s.draft,...s.parked,...s.sales]),'訂單編號重複');
  requireValue(s.counters&&typeof s.counters==='object'&&!Array.isArray(s.counters)&&Object.entries(s.counters).every(([k,v])=>/^\d{4}-\d{2}-\d{2}$/.test(k)&&Number.isSafeInteger(v)&&v>=0),'流水號資料無效');
  for(const o of [s.draft,...s.parked,...s.sales])requireValue(s.counters[o.date]>=o.number,'流水號資料不完整');
  if(s.schemaVersion===VERSION){
    requireValue(array(s.members,10000)&&unique(s.members)&&s.members.every(m=>identifier(m.id)&&named(m.name)&&str(m.phone,30)&&/^[\d+()\s-]*$/.test(m.phone)&&(!m.phone||normalizedPhone(m.phone).length>0)&&str(m.note,200)&&timestamp(m.createdAt)),'會員資料無效');
    const phones=s.members.filter(m=>m.phone).map(m=>normalizedPhone(m.phone));
    requireValue(new Set(phones).size===phones.length,'會員電話重複');
    requireValue(array(s.walletEntries,200000)&&unique(s.walletEntries),'儲值紀錄無效');
    const balances=new Map(),openings=new Set(),spent=new Set(),salesById=new Map(s.sales.map(o=>[o.id,o])),memberIds=new Set(s.members.map(m=>m.id));
    for(const e of s.walletEntries){
      requireValue(e&&identifier(e.id)&&memberIds.has(e.memberId)&&['opening','topup','spend'].includes(e.type)&&Number.isSafeInteger(e.amount)&&Math.abs(e.amount)<=MAX_BALANCE&&timestamp(e.createdAt)&&str(e.note,200),'儲值紀錄內容無效');
      if(e.type==='opening'){
        requireValue(!openings.has(e.memberId)&&!balances.has(e.memberId)&&!e.saleId,'期初餘額紀錄無效');openings.add(e.memberId);
      }else requireValue(openings.has(e.memberId),'缺少會員期初紀錄');
      const balance=(balances.get(e.memberId)||0)+e.amount;
      requireValue(Math.abs(balance)<=MAX_BALANCE&&e.balanceAfter===balance,'儲值餘額與異動紀錄不符');balances.set(e.memberId,balance);
      if(e.type==='topup')requireValue(e.amount>0&&!e.saleId,'儲值金額無效');
      if(e.type==='spend'){
        const sale=salesById.get(e.saleId);
        requireValue(e.amount<0&&sale&&sale.member?.id===e.memberId&&sale.walletAmount===-e.amount&&sale.balanceAfter===balance&&sale.completedAt===e.createdAt&&!spent.has(e.saleId),'儲值扣款與交易不符');spent.add(e.saleId);
      }
    }
    requireValue(s.members.every(m=>openings.has(m.id))&&s.sales.every(o=>!(o.walletAmount>0)||spent.has(o.id)),'會員或交易缺少儲值紀錄');
  }
  return true;
}
