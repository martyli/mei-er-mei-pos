# 美而美早餐店｜平板點餐計價

免安裝、免伺服器的櫃檯點餐計價網頁，適用 iPad / Android 平板。

## 功能
- 分類點餐、同品項加減、總額即時計算
- 實收金額與找零計算、常用鈔額快捷鍵
- 可在網頁修改品項、分類、價格；菜單存於瀏覽器 localStorage
- 無第三方套件、無金流、無交易紀錄上傳

**注意：** 初始品項及價格為示範資料。正式使用前請先設定實際菜單。清除瀏覽器資料、使用無痕模式或換裝置可能導致菜單設定遺失。GitHub Pages 網站公開可訪問，請勿放入敏感資訊。

## GitHub Pages 部署
1. 在 GitHub 建立公開 repository，例如 `mei-er-mei-pos`。
2. 將 `index.html` 與 `README.md` 上傳至 repository 根目錄並 Commit。
3. 到 **Settings → Pages → Build and deployment**，Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾選 `/(root)`，按 Save。
4. 稍待部署完成，前往 `https://<GitHub使用者名稱>.github.io/mei-er-mei-pos/`。
5. 在平板瀏覽器開啟，設定菜單後可加到主畫面。

## 更新
程式修改後提交到 `main`，GitHub Pages 將重新部署。已儲存菜單不會因單純重新部署而自動同步成新版示範菜單。
