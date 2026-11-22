# Direct Google Sheets history (Railway)

## Data flow

n8n still appends one row to the existing **Mahan Market Agent → Market History** tab. Railway independently reads **only** \`timestamp\` and \`*_actual_price\` columns through the Google Sheets API. It caches the response for ten minutes and adds the historical points to \`GET /api/market\`. The live n8n publish flow is unchanged.

Importantly, the Sheets reader does **not** request the \`free_output\` or \`paid_output\` cells. The service account credentials never reach the browser, the public API, or the repository.

## Google Cloud setup (one-time)

1. Select an existing Google Cloud project or create one at https://console.cloud.google.com/ .
2. Enable **Google Sheets API** in **APIs & Services → Library**.
3. In **IAM & Admin → Service Accounts**, create a dedicated service account, e.g. \`mahan-market-history-reader\`. It does not need Project Editor/Owner permissions.
4. Open the service account **Keys → Add key → Create new key → JSON**, download the JSON locally, and store it securely. Do not upload it to GitHub, n8n nodes, logs, screenshots, or this chat. Treat it like a password.
5. From the key JSON, copy only its \`client_email\` (ending in \`.gserviceaccount.com\`). Open the existing private Google Sheet, click **Share**, grant that email **Viewer**. Do not switch the sheet to “anyone with the link”.

## Railway Variables

In the existing Railway **Mahan Market Agent** service, open **Variables** and set:

- \`GOOGLE_SHEETS_SPREADSHEET_ID\`: the spreadsheet's ID taken from its URL. Use the ID of **Mahan Market Agent**, not a tab ID.
- \`GOOGLE_SHEETS_SHEET_NAME\`: \`Market History\` (optional; this is the default).
- \`GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON\`: the complete service-account JSON contents as a **private** Railway variable. Do not commit the JSON. Railway must be able to read this value as a JSON string.

Keep existing \`N8N_PUSH_SECRET\` and other variables unchanged.

Once the environment variables take effect and the service deploys, GET \`/api/market\` reads the header row and actual-price columns. The server identifies currencies from headers like \`USD_actual_price\`, \`EUR_actual_price\`, etc. Up to twenty such currency columns in the first fifty-two sheet columns are supported. The cache is shared by visitors; at most one refresh is in flight at a time. A Google API error leaves the existing live n8n data available, rather than failing the website.

## Validation

1. Confirm a valid row exists with an ISO timestamp and numeric \`USD_actual_price\` (the active spreadsheet already has one sample row).
2. Deploy code and set the three Railway variables privately.
3. GET \`https://mahan-market-agent.up.railway.app/api/market\`. Check \`assets\` contains \`USD\` with its \`history\` array.
4. Future scheduled n8n appends create more history points. You do **not** need a Google Sheets Read Rows n8n node.
5. After a Railway redeploy, the API can reconstruct the history from Sheets, even if its temporary local file was reset. If Google is temporarily unavailable the API falls back to the last live n8n payload.

## Troubleshooting

- HTTP 403 from Google Sheets: check the exact service-account \`client_email\` has **Viewer** permission on the spreadsheet.
- HTTP 401 from Google OAuth: confirm the complete JSON private key was pasted into Railway and the Sheets API is enabled.
- Missing chart: check the timestamp and real price columns contain at least two valid historical rows from different executions. Do not fabricate repeated rows simply to force a chart.
- Keep the service account key out of screenshots, chat, browser-side JavaScript, and public routes.
