// Pure domain logic. All money is an integer number of New Taiwan Dollars.
export const VERSION = 2;
export const MAX_PRICE = 99999;
export const MAX_QTY = 999;
export const id = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(b => b.toString(16).padStart(2,'0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
};
export const money = value => '$' + value.toLocaleString('zh-TW');
export const dayKey = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(date);
export function requireValue(condition, message) { if (!condition) throw new Error(message); }
export function priceValue(value) {
  requireValue(value !== '' && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= MAX_PRICE, '價格請輸入 0～99,999 的整數');
  return Number(value);
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
  }))},counters:{},draft:null,parked:[],sales:[]};
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
    return {id:a.id,name:a.name,price:a.price};
  });
  return {id:id(),productId:item.id,name:item.name,categoryName:state.catalog.categories.find(c=>c.id===item.categoryId).name,
    basePrice:item.price,addons,qty,note:String(note).trim().slice(0,200)};
}
export function addLine(state,line) {
  const same=state.draft.lines.find(x=>lineKey(x)===lineKey(line));
  if(same){requireValue(same.qty+line.qty<=MAX_QTY,'同一組合最多 999 份');same.qty+=line.qty;}
  else state.draft.lines.push(structuredClone(line));
}
export function editLine(state,lineId,replacement) {
  requireValue(state.draft.lines.some(x=>x.id===lineId),'找不到這份餐點');
  requireValue(Number.isInteger(replacement.qty)&&replacement.qty>0&&replacement.qty<=MAX_QTY,'每列份數須為 1～999');
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
export function completeSale(state,paid,now=new Date()) {
  requireValue(state.draft.lines.length,'請先加入餐點');
  const total=orderTotal(state.draft);
  requireValue(Number.isSafeInteger(paid)&&paid>=0&&paid<=999999999,'實收請輸入有效的整數金額');
  requireValue(paid>=total,'實收金額不足');
  requireValue(!state.sales.some(x=>x.id===state.draft.id),'這筆訂單已結帳');
  const sale={...structuredClone(state.draft),total,paid,change:paid-total,payment:'cash',status:'paid',completedAt:now.toISOString(),businessDate:dayKey(now)};
  state.sales.push(sale);state.draft=newOrder(state,now);return sale;
}
export function dailySummary(state,date=dayKey()) {
  const sales=state.sales.filter(s=>s.businessDate===date&&s.status==='paid');
  const revenue=sales.reduce((n,s)=>n+s.total,0);
  const popular=new Map();
  for(const s of sales)for(const line of s.lines){const value=popular.get(line.name)||{name:line.name,qty:0,revenue:0};value.qty+=line.qty;value.revenue+=unitTotal(line)*line.qty;popular.set(line.name,value);}
  return {sales,revenue,count:sales.length,average:sales.length?Math.round(revenue/sales.length):0,items:[...popular.values()].sort((a,b)=>b.qty-a.qty)};
}

// Validate every imported/persisted record before enabling writes.
export function validateState(s) {
  const str=(v,max=120)=>typeof v==='string'&&v.length<=max;
  const named=v=>str(v,80)&&v.trim().length>0;
  const amount=v=>Number.isInteger(v)&&v>=0&&v<=MAX_PRICE;
  const timestamp=v=>str(v)&&Number.isFinite(Date.parse(v));
  const unique=list=>new Set(list.map(x=>x.id)).size===list.length;
  const identifier=v=>str(v)&&v.length>0;
  const array=(v,max=100000)=>Array.isArray(v)&&v.length<=max;
  requireValue(s?.schemaVersion===VERSION,'備份版本不相容');
  requireValue(Number.isSafeInteger(s.revision)&&s.revision>=0,'資料版本無效');
  const c=s.catalog;
  requireValue(c&&array(c.categories,100)&&c.categories.length>0&&unique(c.categories)&&c.categories.every(x=>identifier(x.id)&&named(x.name)&&Number.isInteger(x.color)&&x.color>=0&&x.color<5),'分類資料無效');
  requireValue(array(c.addons,1000)&&unique(c.addons)&&c.addons.every(x=>identifier(x.id)&&named(x.name)&&amount(x.price)&&typeof x.enabled==='boolean'),'加料資料無效');
  requireValue(array(c.items,10000)&&unique(c.items)&&c.items.every(x=>identifier(x.id)&&named(x.name)&&amount(x.price)&&typeof x.enabled==='boolean'&&c.categories.some(k=>k.id===x.categoryId)&&array(x.addonIds,1000)&&new Set(x.addonIds).size===x.addonIds.length&&x.addonIds.every(k=>c.addons.some(a=>a.id===k))),'餐點資料無效');
  const validLine=l=>l&&identifier(l.id)&&identifier(l.productId)&&named(l.name)&&named(l.categoryName)&&amount(l.basePrice)&&Number.isInteger(l.qty)&&l.qty>0&&l.qty<=MAX_QTY&&str(l.note,200)&&array(l.addons,1000)&&unique(l.addons)&&l.addons.every(a=>identifier(a.id)&&named(a.name)&&amount(a.price));
  const validOrder=o=>o&&identifier(o.id)&&Number.isSafeInteger(o.number)&&o.number>0&&str(o.date)&&/^\d{4}-\d{2}-\d{2}$/.test(o.date)&&['takeout','dinein'].includes(o.type)&&str(o.table,20)&&str(o.note,200)&&timestamp(o.createdAt)&&array(o.lines,2000)&&unique(o.lines)&&o.lines.every(validLine);
  requireValue(validOrder(s.draft),'目前訂單資料無效');
  requireValue(array(s.parked,10000)&&unique(s.parked)&&s.parked.every(o=>validOrder(o)&&timestamp(o.heldAt)&&o.lines.length>0),'暫存訂單資料無效');
  requireValue(array(s.sales)&&unique(s.sales)&&s.sales.every(o=>validOrder(o)&&o.lines.length>0&&timestamp(o.completedAt)&&str(o.businessDate)&&/^\d{4}-\d{2}-\d{2}$/.test(o.businessDate)&&o.status==='paid'&&o.payment==='cash'&&Number.isSafeInteger(o.total)&&o.total===orderTotal(o)&&Number.isSafeInteger(o.paid)&&o.paid>=o.total&&o.paid<=999999999&&o.change===o.paid-o.total),'交易資料無效');
  requireValue(unique([s.draft,...s.parked,...s.sales]),'訂單編號重複');
  requireValue(s.counters&&typeof s.counters==='object'&&!Array.isArray(s.counters)&&Object.entries(s.counters).every(([k,v])=>/^\d{4}-\d{2}-\d{2}$/.test(k)&&Number.isSafeInteger(v)&&v>=0),'流水號資料無效');
  for(const o of [s.draft,...s.parked,...s.sales])requireValue(s.counters[o.date]>=o.number,'流水號資料不完整');
  return true;
}
