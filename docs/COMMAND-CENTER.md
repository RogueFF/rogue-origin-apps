# Command Center - Real-Time Production Dashboard

## Overview
The Command Center is a premium, production-ready dashboard for real-time production monitoring on the floor. Built with live data updates, predictive analytics, and a distinctive design that stands out from generic dashboards.

## Features

### Core Metrics
- **Current Rate**: Real-time last-hour production with target comparison
- **Daily Progress**: Total production vs target with visual progress bar
- **Crew Performance**: Per-person rates and crew breakdown (trimmers/buckers)
- **Bag Timer**: Live tracking of time since last bag with status indicators
- **Shift Information**: Elapsed time and hours logged tracking
- **Predictive Analytics**: Estimated finish time based on current pace

### Alert System
Automatic alerts for:
- Rate drops below 15% of target
- Bag timer exceeding 2 minutes over target
- Daily production >10% behind target (after 2+ hours logged)

### Real-Time Updates
- Polls production API every 5 seconds
- Smooth animations on data changes
- Live countdown/up timers
- Auto-updating predictions throughout the day

## Architecture

### Files
```
src/
├── pages/command-center.html    # Main HTML structure
├── css/command-center.css       # Premium styling
└── js/command-center/
    └── main.js                  # Core logic and API integration
```

### Design System
- Uses shared Rogue Origin design tokens (colors, fonts, spacing)
- Phosphor Icons for consistent iconography
- Outfit font family for UI elements
- JetBrains Mono for metrics and data
- DM Serif Display for headings

### Color Palette
- **Primary**: Rogue Origin Green (#668971)
- **Accent**: Gold (#e4aa4f)
- **Danger**: Red (#c45c4a)
- **Status Indicators**: Color-coded performance levels

### Responsive Design
- Desktop-optimized with mobile support
- Grid layout adapts to screen size
- Touch-friendly controls
- Maintains readability at all sizes

## Usage

### Accessing the Dashboard
Navigate to: `https://rogueff.github.io/rogue-origin-apps/src/pages/command-center.html`

Or use the navigation link in the main dashboard.

### Shift Tracking
1. Click "Start Shift" when production begins
2. Dashboard tracks elapsed time and calculates predictions
3. Click "Reset" to start a new shift

### Understanding Status Indicators

**Rate Performance:**
- 🟢 Excellent: ≥100% of target
- 🟡 Good: 90-99% of target
- 🟠 Warning: 75-89% of target
- 🔴 Danger: <75% of target

**Bag Timer:**
- 🟢 On pace: Under target time
- 🟡 Good: <1 minute over target
- 🟠 Slow: 1-2 minutes over target
- 🔴 Critical: >2 minutes over target

### Reading the Data

**Current Rate Card:**
- Last hour's production vs target
- Performance percentage
- Visual status indicator

**Daily Progress Card:**
- Cumulative production for the day
- Progress bar showing completion %
- Target comparison

**Crew Performance Card:**
- Per-person production rate
- Current crew count (trimmers/buckers)
- Last hour crew count

**Bag Timer Card:**
- Time since last bag completion
- Target cycle time
- Total bags and average cycle time today
- Status indicator

**Shift Information Card:**
- Shift start time
- Elapsed time
- Hours logged in system

**Predictive Analytics Card:**
- Estimated finish time to meet target
- Projected total production

## Technical Details

### API Integration
- Endpoint: `https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=scoreboard`
- Method: GET
- Polling: Every 5 seconds
- Timeout: Standard browser timeout
- Error handling: Auto-retry on connection loss

### Data Structure
```javascript
{
  scoreboard: {
    lastHourLbs: number,
    lastHourTarget: number,
    todayLbs: number,
    todayTarget: number,
    hoursLogged: number,
    currentHourTrimmers: number,
    currentHourBuckers: number,
    // ... more fields
  },
  timer: {
    lastBagTime: string | null,
    secondsSinceLastBag: number,
    targetSeconds: number,
    bagsToday: number,
    avgSecondsToday: number,
    // ... more fields
  }
}
```

### Performance Optimizations
- Deferred script loading
- CSS transitions over JavaScript animations
- Efficient DOM updates (only changed elements)
- Preconnect to API domain
- Font display: optional (prevents FOIT)

### Browser Support
- Modern browsers (Chrome, Firefox, Safari, Edge)
- ES6+ JavaScript required
- CSS Grid and Flexbox support needed

## Customization

### Alert Thresholds
Edit in `main.js`:
```javascript
config: {
  alertThresholds: {
    rateDropPercent: 15,    // Rate drop alert
    bagLagSeconds: 120,     // Bag timer alert
    targetMissPercent: 10   // Target miss alert
  }
}
```

### Poll Interval
Edit in `main.js`:
```javascript
config: {
  pollInterval: 5000  // milliseconds (5 seconds)
}
```

### Colors and Styling
Edit `src/css/command-center.css` or use CSS variables:
```css
--ro-green: #668971;
--ro-gold: #e4aa4f;
--danger: #c45c4a;
```

## Development

### Local Testing
1. Ensure API is accessible
2. Open `command-center.html` in browser
3. Check browser console for errors
4. Verify data updates every 5 seconds

### Adding Features
1. Add UI elements to HTML
2. Style in CSS with appropriate animations
3. Update JavaScript logic in `main.js`
4. Test with real API data
5. Commit and push changes

### Code Style
- Clean, readable code
- Descriptive variable/function names
- Comments for complex logic
- Consistent formatting (2-space indent)
- Modular structure

## Deployment

### GitHub Pages
Automatically deployed when pushed to master:
1. Commit changes to `src/pages/command-center.html`
2. Push to `master` branch
3. GitHub Actions builds and deploys
4. Live at: `https://rogueff.github.io/rogue-origin-apps/src/pages/command-center.html`

### Manual Deployment
If needed:
1. Ensure all files are in place
2. Test locally first
3. Push to repository
4. Verify live deployment

## Troubleshooting

### No Data Showing
- Check API endpoint is accessible
- Verify network connection
- Check browser console for errors
- Ensure API returns valid JSON

### Updates Not Happening
- Check polling interval hasn't stopped
- Verify API is returning new data
- Check for JavaScript errors in console
- Refresh page to reset polling

### Styling Issues
- Verify CSS files are loaded
- Check for CSS conflicts
- Ensure shared-base.css is loaded first
- Clear browser cache

### Performance Issues
- Check polling interval (5s is recommended)
- Verify no JavaScript errors blocking updates
- Monitor browser memory usage
- Check API response times

## Future Enhancements

Potential additions:
- Historical data view (charts/graphs)
- Export/download capability
- SMS/push notifications for alerts
- Crew member individual tracking
- Strain-specific analytics
- Shift comparison tools
- Customizable dashboard layouts

## Credits
Built for Rogue Origin by Koa's development team.
Designed to be premium, distinctive, and production-ready.

## License
Proprietary - Rogue Origin internal use only.
