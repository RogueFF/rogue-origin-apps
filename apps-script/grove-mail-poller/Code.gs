/**
 * Grove Mail Poller — forwards Grove's order and shipping emails to the worker.
 *
 * Why this exists: the Cloudflare worker cannot read a mailbox, and the farm
 * Gmail already owns the Mail Relay script, so the same account polls its own
 * inbox here. A Gmail filter labels Grove's mail "Grove/Orders"; every five
 * minutes this reads the unread threads under that label, POSTs each message
 * to the worker's groveMail action, marks it read, and moves it to
 * "Grove/Applied" or "Grove/Review" by what the worker answered.
 *
 * Setup: docs/guides/grove-email-intake.md. The worker side is
 * workers/src/handlers/grove-intake.js.
 *
 * Script properties (Project Settings → Script Properties):
 *   WORKER_URL      https://rogue-origin-api.roguefamilyfarms.workers.dev
 *   WEBHOOK_SECRET  the worker's WEBHOOK_SECRET (same as the Shopify Flow one)
 */

var LABEL_IN = 'Grove/Orders';
var LABEL_APPLIED = 'Grove/Applied';
var LABEL_REVIEW = 'Grove/Review';
var MAX_THREADS = 20;

/** Time-driven trigger target: every 5 minutes. */
function pollGroveMail() {
  var props = PropertiesService.getScriptProperties();
  var workerUrl = props.getProperty('WORKER_URL');
  var secret = props.getProperty('WEBHOOK_SECRET');
  if (!workerUrl || !secret) throw new Error('Set WORKER_URL and WEBHOOK_SECRET in Script Properties');

  var inLabel = labelOrCreate(LABEL_IN);
  var applied = labelOrCreate(LABEL_APPLIED);
  var review = labelOrCreate(LABEL_REVIEW);

  var threads = GmailApp.search('label:' + LABEL_IN + ' is:unread', 0, MAX_THREADS);
  var n = 0;
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      if (!msg.isUnread()) return;
      var result = forwardMessage(workerUrl, secret, msg);
      msg.markRead();
      // The label says where it went; the worker's row (kanban_inbound_mail) says why.
      if (result.status === 'applied' || result.status === 'duplicate') thread.addLabel(applied);
      else thread.addLabel(review);
      thread.removeLabel(inLabel);
      n++;
      Logger.log('[grove-mail] ' + msg.getSubject() + ' -> ' + result.status + (result.missing ? ' (' + result.missing.join(', ') + ')' : ''));
    });
  });
  if (n) Logger.log('[grove-mail] forwarded ' + n + ' message(s)');
}

/** POST one message to the worker. Returns the worker's JSON ({ status, ... }) or { status: 'error', error }. */
function forwardMessage(workerUrl, secret, msg) {
  var payload = {
    messageId: msg.getId(),
    from: msg.getFrom(),
    subject: msg.getSubject(),
    receivedAt: msg.getDate().toISOString(),
    text: (msg.getPlainBody() || '').slice(0, 20000),
    // The HTML body only when there is no plain text: the worker strips tags itself.
    html: msg.getPlainBody() ? undefined : (msg.getBody() || '').slice(0, 60000),
  };
  var url = workerUrl.replace(/\/+$/, '') + '/api/kanban?action=groveMail';
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Webhook-Secret': secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  var body;
  try { body = JSON.parse(res.getContentText()); } catch (e) { body = null; }
  if (code !== 200 || !body || body.success === false) {
    Logger.log('[grove-mail] worker ' + code + ': ' + res.getContentText().slice(0, 300));
    return { status: 'error', error: body && body.error ? body.error : 'HTTP ' + code };
  }
  return body;
}

function labelOrCreate(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/** Run once by hand after setting the properties: a GET health check against the worker. */
function testWorkerReachable() {
  var workerUrl = PropertiesService.getScriptProperties().getProperty('WORKER_URL');
  var res = UrlFetchApp.fetch(workerUrl.replace(/\/+$/, '') + '/api', { muteHttpExceptions: true });
  Logger.log(res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
}
