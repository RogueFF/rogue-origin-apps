#!/usr/bin/env node

/**
 * Atlas Notifications CLI Sender
 * 
 * Usage:
 *   node tools/notify.js toast "Title" "Body"
 *   node tools/notify.js alert "Alert Title" "Alert body"
 *   node tools/notify.js production --dailyTotal=47.2 --pct=55 --rate=1.05 --crew=12 --pace=ahead
 *   node tools/notify.js briefing "Morning Brief" --segments='[{"label":"Production","text":"93 lbs"}]'
 * 
 * Options:
 *   --host=IP:PORT    API host (default: 100.65.60.42:9400)
 *   --tts             Enable text-to-speech
 *   --tts-text="..."  Custom TTS text
 *   --priority=low|normal|high
 *   --category="..."
 */

const DEFAULT_HOST = 'gablewindowed-ivelisse-latently.ngrok-free.dev';

// ─── Argument Parser ────────────────────────────────────────────────

function parseArgs(args) {
  const result = { flags: {}, positional: [] };
  
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, ...valueParts] = arg.slice(2).split('=');
      const value = valueParts.join('=') || true;
      
      // Parse numbers
      if (value !== true && !isNaN(value)) {
        result.flags[key] = parseFloat(value);
      } else if (value === 'true') {
        result.flags[key] = true;
      } else if (value === 'false') {
        result.flags[key] = false;
      } else {
        result.flags[key] = value;
      }
    } else {
      result.positional.push(arg);
    }
  }
  
  return result;
}

// ─── Notification Builders ──────────────────────────────────────────

function buildToast(title, body, flags) {
  return {
    type: 'toast',
    title: title || 'Toast Notification',
    body: body || '',
    priority: flags.priority || 'normal',
    category: flags.category || null,
    tts: flags.tts || false,
    tts_text: flags['tts-text'] || null
  };
}

function buildAlert(title, body, flags) {
  return {
    type: 'alert',
    title: title || 'Alert',
    body: body || '',
    priority: flags.priority || 'high',
    category: flags.category || null,
    tts: flags.tts || false,
    tts_text: flags['tts-text'] || null
  };
}

function buildProduction(flags) {
  const dailyTotal = flags.dailyTotal || flags.daily || 0;
  const percentOfTarget = flags.pct || flags.percent || 0;
  const rate = flags.rate || 0;
  const crew = flags.crew || flags.trimmers || 0;
  const paceStatus = flags.pace || 'on-pace';
  const targetRate = flags.targetRate || flags.target || 0.85;
  
  // Parse hourly data if provided
  let hourly = [];
  if (flags.hourly) {
    try {
      hourly = JSON.parse(flags.hourly);
    } catch (e) {
      console.error('Warning: Failed to parse --hourly JSON. Using empty array.');
    }
  }
  
  return {
    type: 'production-card',
    title: flags.title || 'Production Update',
    priority: flags.priority || 'normal',
    category: flags.category || null,
    tts: flags.tts || false,
    tts_text: flags['tts-text'] || null,
    data: {
      dailyTotal,
      percentOfTarget,
      rate,
      targetRate,
      crew,
      trimmers: crew,
      paceStatus,
      hourly
    }
  };
}

function buildBriefing(title, flags) {
  let segments = [];
  
  if (flags.segments) {
    try {
      segments = JSON.parse(flags.segments);
    } catch (e) {
      console.error('Error: Failed to parse --segments JSON.');
      process.exit(1);
    }
  }
  
  return {
    type: 'briefing',
    title: title || 'Briefing',
    priority: flags.priority || 'normal',
    category: flags.category || null,
    tts: flags.tts || false,
    tts_text: flags['tts-text'] || null,
    data: { segments }
  };
}

// ─── API Sender ─────────────────────────────────────────────────────

async function sendNotification(payload, host) {
  const url = `http://${host}/notify`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    
    if (response.ok) {
      console.log(`✅ Notification sent successfully (ID: ${result.id})`);
      return true;
    } else {
      console.error(`❌ API Error: ${result.error || 'Unknown error'}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Network Error: ${error.message}`);
    console.error(`   Could not reach ${url}`);
    console.error(`   Check that Atlas Notifications is running and host is correct.`);
    return false;
  }
}

// ─── Help Text ──────────────────────────────────────────────────────

function showHelp() {
  console.log(`
Atlas Notifications CLI Sender

Usage:
  node tools/notify.js <type> [args...] [options...]

Types:

  toast <title> <body>
    Simple notification.
    Example: node tools/notify.js toast "System Update" "All clear"

  alert <title> <body>
    High-priority alert requiring acknowledgment.
    Example: node tools/notify.js alert "Security Alert" "Change password now"

  production [options]
    Production monitoring card with stats and pace.
    Options:
      --dailyTotal=N    Total pounds produced (required)
      --pct=N          Percent of target (required)
      --rate=N         Current rate (required)
      --crew=N         Crew size
      --trimmers=N     Number of trimmers (alias for --crew)
      --pace=STATUS    Pace status: ahead, on-pace, behind
      --targetRate=N   Target rate (default: 0.85)
      --hourly=JSON    Hourly data array: [{"actual":5.1,"target":3.5},...]
    
    Example: node tools/notify.js production --dailyTotal=47.2 --pct=55 --rate=1.05 --crew=12 --pace=ahead

  briefing <title> [options]
    Multi-segment briefing.
    Options:
      --segments=JSON  Array of segments (required)
    
    Segment schema:
      { "label": "Production", "text": "93 lbs today", "icon": "chart" }
    
    Example:
      node tools/notify.js briefing "Morning Brief" \\
        --segments='[{"label":"Production","text":"93 lbs today"},{"label":"Weather","text":"Clear, 58°F"}]'

Global Options:
  --host=IP:PORT        API host (default: ${DEFAULT_HOST})
  --tts                 Enable text-to-speech
  --tts-text="..."      Custom text for TTS (overrides auto-generated)
  --priority=LEVEL      Priority: low, normal, high
  --category="..."      Optional category label
  --title="..."         Custom title (production/briefing only)

Examples:
  node tools/notify.js toast "Break Time" "15 minute break starting now"
  
  node tools/notify.js alert "Security Alert" "Unauthorized access" --tts
  
  node tools/notify.js production \\
    --dailyTotal=93.3 --pct=108.6 --rate=1.15 --crew=12 --pace=ahead
  
  node tools/notify.js briefing "Morning Brief" --tts \\
    --segments='[{"label":"Production","text":"93.3 lbs (108.6% of target)","icon":"chart"}]'
`);
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }
  
  const parsed = parseArgs(args);
  const type = parsed.positional[0];
  const host = parsed.flags.host || DEFAULT_HOST;
  
  let payload;
  
  switch (type) {
    case 'toast':
      payload = buildToast(parsed.positional[1], parsed.positional[2], parsed.flags);
      break;
    
    case 'alert':
      payload = buildAlert(parsed.positional[1], parsed.positional[2], parsed.flags);
      break;
    
    case 'production':
      payload = buildProduction(parsed.flags);
      break;
    
    case 'briefing':
      payload = buildBriefing(parsed.positional[1], parsed.flags);
      break;
    
    default:
      console.error(`❌ Unknown notification type: ${type}`);
      console.error(`   Valid types: toast, alert, production, briefing`);
      console.error(`   Run with --help for usage.`);
      process.exit(1);
  }
  
  const success = await sendNotification(payload, host);
  process.exit(success ? 0 : 1);
}

main();
