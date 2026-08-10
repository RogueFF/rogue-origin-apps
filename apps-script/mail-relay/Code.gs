/**
 * Mail Relay — sends transactional email on behalf of the Cloudflare worker.
 *
 * Why this exists: Cloudflare Workers can't speak SMTP, and the worker's Google
 * service account has no mailbox of its own. Sending as a person from a service
 * account requires domain-wide delegation, which is a super-admin grant. Apps
 * Script sidesteps that entirely — it runs as the account that owns the script,
 * so MailApp.sendEmail just works.
 *
 * Deployment and setup: see README.md in this folder.
 *
 * Contract:
 *   POST ?action=send   { secret, to, cc?, subject, body }
 *   ->  { success: true, remainingQuota: <n> }
 *   ->  { success: false, error: "..." }
 *
 * Consumed by workers/src/lib/mail-relay.js.
 */

/** Max lengths, so a malformed caller can't send an enormous message. */
var LIMITS = { to: 320, cc: 320, subject: 500, body: 20000 };

function doGet() {
  // No readable state here on purpose — a GET is only ever a health check, and
  // mail clients / scanners follow GETs.
  return jsonOut({ success: true, service: 'mail-relay', ok: true });
}

function doPost(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || '';
    if (action !== 'send') {
      return jsonOut({ success: false, error: 'Unknown action: ' + action });
    }

    var post = {};
    if (e && e.postData && e.postData.contents) {
      post = JSON.parse(e.postData.contents);
    }

    // Shared secret. Apps Script web apps deployed "anyone with the link" are
    // effectively public, so this is the only thing standing between the relay
    // and anyone who guesses the URL.
    var expected = PropertiesService.getScriptProperties().getProperty('RELAY_SECRET');
    if (!expected) {
      return jsonOut({ success: false, error: 'RELAY_SECRET not configured on the relay' });
    }
    if (!safeEquals(String(post.secret || ''), expected)) {
      return jsonOut({ success: false, error: 'Unauthorized' });
    }

    var to = clamp(post.to, LIMITS.to);
    var subject = clamp(post.subject, LIMITS.subject);
    var body = clamp(post.body, LIMITS.body);
    if (!to) return jsonOut({ success: false, error: 'to is required' });
    if (!subject) return jsonOut({ success: false, error: 'subject is required' });

    var options = { name: 'Rogue Origin Supply Kanban' };
    var cc = clamp(post.cc, LIMITS.cc);
    if (cc) options.cc = cc;

    MailApp.sendEmail(to, subject, body, options);

    return jsonOut({
      success: true,
      remainingQuota: MailApp.getRemainingDailyQuota()
    });
  } catch (err) {
    return jsonOut({ success: false, error: String(err && err.message ? err.message : err) });
  }
}

/**
 * Length-independent comparison, so response timing doesn't leak the secret a
 * character at a time.
 */
function safeEquals(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function clamp(value, max) {
  if (value === null || value === undefined) return '';
  return String(value).slice(0, max);
}

function jsonOut(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
