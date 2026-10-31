---
name: update-lvr
description: 下載內政部最新實價登錄（臺中市不動產買賣），重新產生 lvr-taichung.zip，並推上 GitHub Pages 讓鑑價工作台自動載入。可帶季別參數補資料，例如 /update-lvr 115S2,115S3。
disable-model-invocation: true
argument-hint: "[季別，如 115S3；可逗號分隔，留空=本期+上一季]"
---

# 更新實價登錄資料

`valuation.html` 開啟時會從同資料夾抓 `lvr-taichung.zip`。這個流程負責重新產生那個檔並上線。

## 步驟

1. **確認工作區**：在 repo 根目錄執行 `git status --short` 與 `git pull --ff-only`。
   - 如果 `lvr-taichung.zip` 以外有未提交的修改，先告訴使用者，不要把它們一起 commit。

2. **先試跑**（不寫檔）：
   ```bash
   node .claude/skills/update-lvr/scripts/build-lvr.mjs --dry-run
   ```
   - 使用者有給季別參數（`$ARGUMENTS`，如 `115S2,115S3`）時，加上 `--seasons $ARGUMENTS`。
   - 使用者自己下載了檔案時，用 `--csv <路徑...>`（可放 ZIP 或 `b_lvr_land_a.csv`），並加 `--no-current`。
   - 不帶參數 = 本期批次 + 上一季整季檔（上一季尚未發布會自動略過）。

3. **檢查試跑結果**，有以下情況就停下來問使用者，不要繼續：
   - 任何一個來源出錯（下載失敗、欄位不符）
   - 「更新」筆數超過數百筆（可能是 `valuation.html` 解析邏輯被改過，舊資料會整批變動）
   - 輸出筆數比現有資料少超過 5%，或 ZIP 超過 10 MB
   - 「實際新增」為 0：告訴使用者目前已是最新，不需要 commit，結束流程

4. **正式產生**：拿掉 `--dry-run` 再跑一次，參數相同。

5. **上線**：
   ```bash
   git add lvr-taichung.zip
   git commit -m "更新實價登錄資料（新增 N 筆，資料至 民國YYY/MM）"
   git push
   ```
   commit 訊息裡的筆數與月份取自腳本輸出。

6. **回報**：用一兩句話說明新增幾筆、資料期間，以及網址 https://kevin760131-max.github.io/house-calc/valuation.html （GitHub Pages 約 1 分鐘後更新，手機重新整理就會自動載入新資料）。

## 注意

- 解析邏輯直接取自 `valuation.html` 的 `<script id="core">`，所以跟網頁手動匯入的結果一定一致。修改那段程式後跑這個流程，「更新」筆數會反映改動影響了多少舊資料。
- 只保留臺中市、近 5 年的成交。超過 5 年的補登案件會被自動略過，這是正常現象。
- 實價登錄每月 1、11、21 日發布新批次；上一季整季檔約在每季第一個月初發布。
- 不要手動編輯 `lvr-taichung.zip`。
