# Command Center

Real-time production monitoring dashboard with predictive analytics and smart alerts.

## Quick Start

1. **Access**: Navigate to `/src/pages/command-center.html` or click "Command Center" in the sidebar
2. **Monitor**: Dashboard auto-refreshes every 5 seconds
3. **Respond**: Check alerts section for issues requiring attention

## Key Metrics

- **Current Hour**: Live production progress with target comparison
- **Crew Performance**: Trimmer/bucker breakdown with rate indicators
- **Bag Timer**: Visual countdown with status alerts
- **Predictive Analytics**: Projected EOD, finish time, required pace
- **Alerts**: Real-time warnings for rate drops, bag lag, target misses

## Files

```
src/pages/command-center.html      - Main dashboard page
src/css/command-center.css         - Premium dark theme styles
src/js/command-center/main.js      - Core logic and API integration
```

## Configuration

Edit `CONFIG` object in `main.js`:

```javascript
const CONFIG = {
  API_URL: 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production',
  POLL_INTERVAL: 5000,  // Refresh rate (ms)
  ALERT_THRESHOLDS: {
    rateDrop: 0.85,     // Alert if <85% of target
    bagLag: 1.2,        // Alert if >120% of target time
    targetMiss: 0.90    // Alert if <90% of daily target
  }
};
```

## Design Philosophy

**Premium, Not Generic**: Custom dark theme with distinctive colors, smooth animations, and thoughtful spacing. No off-the-shelf dashboard templates.

**At-a-Glance Visibility**: All critical metrics visible without scrolling on desktop. Color-coded indicators for instant status recognition.

**Actionable Insights**: Not just data display - includes predictions, recommendations, and alerts that guide decisions.

**Production-Ready**: Tested with real API data, error handling, responsive design, and optimized performance.

## Full Documentation

See `/docs/COMMAND_CENTER.md` for complete documentation including:
- Detailed feature descriptions
- Technical architecture
- API integration details
- Troubleshooting guide
- Future enhancements roadmap

---

**Built for production floor use - because "good enough" isn't good enough.**
