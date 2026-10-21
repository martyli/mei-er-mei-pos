import {initialState,validateState,upgradeState} from './core.mjs?v=20261021';
// Retain the original key so existing data and multi-tab conflict detection migrate together.
export const STORAGE_KEY='mei-er-mei-pos-v2';
export class Store {
  constructor(storage) {
    this.storage=storage;
    const raw=storage.getItem(STORAGE_KEY);
    if(raw!==null){
      const previous=JSON.parse(raw),next=upgradeState(previous);
      if(next.schemaVersion!==previous.schemaVersion){
        next.revision=previous.revision+1;validateState(next);
        this.raw=JSON.stringify(next);storage.setItem(STORAGE_KEY,this.raw);
      }else this.raw=raw;
      this.state=next;
    }
    else {
      const read=key=>{const value=storage.getItem(key);return value===null?null:JSON.parse(value);};
      this.state=initialState(read('mei-er-mei-menu-v1'),read('mei-er-mei-addons-v1'));
      this.raw=JSON.stringify(this.state);storage.setItem(STORAGE_KEY,this.raw);
    }
  }
  transaction(change) {
    if(this.storage.getItem(STORAGE_KEY)!==this.raw)throw new Error('另一個分頁已更新資料，請重新整理後繼續');
    const next=structuredClone(this.state),result=change(next);
    next.revision=this.state.revision+1;validateState(next);
    const raw=JSON.stringify(next);
    // Commit before updating UI state. A quota failure leaves the current order intact.
    this.storage.setItem(STORAGE_KEY,raw);
    this.state=next;this.raw=raw;return result;
  }
  restore(candidate){const upgraded=upgradeState(candidate);this.transaction(next=>{const revision=next.revision;Object.keys(next).forEach(k=>delete next[k]);Object.assign(next,upgraded,{revision});});}
}
