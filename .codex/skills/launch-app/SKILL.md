---
name: launch-app
description: Launch the chess web app, validate it works, record a walkthrough video with playwright-cli, and upload proof to the Linear ticket.
---

# Launch App

Use this skill before marking work complete on any ticket that changes UI, game logic, or rendering.

## Step 1: Install and start

1. Install dependencies:
   - `npm install`, `yarn install`, or `pnpm install` based on lockfile present.
   - If no lockfile, use `npm install`.
2. Start the dev server in the background:
   - Check `package.json` for `dev` or `start` script.
   - Run it: `npm run dev &` or `npm run start &`.
3. Wait for the server to be ready:
   - Poll with `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000` (adjust port if needed).
   - Retry up to 10 times with 2s sleep between attempts.

## Step 2: Validate and record

1. Open the app and start video recording:
   ```bash
   playwright-cli open http://localhost:3000
   playwright-cli video-start
   ```
2. Take a snapshot to see the page state:
   ```bash
   playwright-cli snapshot
   ```
3. Interact with the app to validate the changes made in this ticket:
   - Navigate key UI flows affected by the ticket.
   - Click interactive elements, verify board renders, test piece movement, etc.
   - Take snapshots between interactions to verify state.
4. Stop recording and save:
   ```bash
   playwright-cli video-stop walkthrough.webm
   playwright-cli close
   ```

## Step 3: Upload video to Linear ticket

Use the `linear` skill's `linear_graphql` tool for all three steps.

1. Get the file size:
   ```bash
   stat -f%z walkthrough.webm   # macOS
   ```

2. Request an upload URL:
   ```graphql
   mutation FileUpload($filename: String!, $contentType: String!, $size: Int!, $makePublic: Boolean) {
     fileUpload(filename: $filename, contentType: $contentType, size: $size, makePublic: $makePublic) {
       success
       uploadFile {
         uploadUrl
         assetUrl
         headers { key value }
       }
     }
   }
   ```
   Variables: `{ "filename": "walkthrough.webm", "contentType": "video/webm", "size": <size>, "makePublic": true }`

3. Upload the file:
   ```bash
   curl -X PUT "<uploadUrl>" \
     -H "<key>: <value>" \
     --data-binary @walkthrough.webm
   ```
   Include every header from the `fileUpload` response.

4. Attach to the workpad comment using `commentUpdate`. Append to the existing body:
   ```markdown

   ### Walkthrough

   ![walkthrough](<assetUrl>)
   ```

## Step 4: Cleanup

Stop the dev server:
```bash
kill %1   # or kill the process by PID
```

## When to use

Run before marking any UI-touching ticket complete. Skip for tickets that only change config, docs, or non-visual logic.
