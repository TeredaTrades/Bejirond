# Wiring up the review widget

The download page (`docs/index.html`) has a star-rating + comment form.
Right now it's disabled — it shows "Feedback isn't connected yet" — because
it needs a Google Apps Script Web App URL to send to. Same pattern as the
teredatrades.com contact form's Sheets backup logger.

## 1. Create the Sheet

Create a new Google Sheet, name it whatever you like (e.g. "Bejirond
Reviews"). You don't need to add headers — the script adds them on the
first write.

## 2. Add the script

In the Sheet: **Extensions → Apps Script**. Delete the placeholder code and
paste this in:

```javascript
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Reviews')
    || SpreadsheetApp.getActiveSpreadsheet().insertSheet('Reviews');

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Timestamp', 'Rating', 'Comment', 'Language']);
  }

  var data = JSON.parse(e.postData.contents);
  var rating = Number(data.rating) || '';
  var comment = (data.comment || '').toString().slice(0, 2000);
  var lang = (data.lang || '').toString().slice(0, 10);

  sheet.appendRow([new Date(), rating, comment, lang]);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

Save it (any project name is fine).

## 3. Deploy as a Web App

**Deploy → New deployment**
- Type: **Web app**
- Execute as: **Me**
- Who has access: **Anyone**

Click Deploy, authorize it with your Google account, and copy the URL that
ends in `/exec`.

## 4. Wire it into the page

In `docs/index.html`, find this line near the bottom:

```javascript
const REVIEW_ENDPOINT = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";
```

Replace the placeholder with the URL you copied. Commit and push — the
form will start working immediately, no rebuild needed since it's a plain
static page.

## Notes

- The request is sent with `mode: 'no-cors'`, so the page can't read back
  whether it succeeded — it just shows "Thanks" optimistically after the
  request goes out. If you want failure detection later, that requires
  changing the Apps Script to set CORS headers explicitly (`doOptions`
  handler) instead of relying on `no-cors`.
- Every submission requires a star rating (1-5); the comment is optional.
- If you ever want to redeploy the script with changes, use **Manage
  deployments → Edit → New version** rather than creating a brand new
  deployment, so the URL already in the page keeps working.
