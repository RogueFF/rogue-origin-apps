#!/usr/bin/env node

// Test weather notification payload

const weatherPayload = {
  type: 'weather',
  title: 'Weather Update',
  data: {
    locations: {
      'Eagle Point, OR': {
        temp: '48°F',
        conditions: 'Partly Cloudy',
        high: '55°F',
        low: '38°F',
        precip: '10%',
        wind: '5 mph NW',
        humidity: '65%'
      },
      'Medford, OR': {
        temp: '52°F',
        conditions: 'Clear',
        high: '58°F',
        low: '42°F',
        precip: '5%',
        wind: '3 mph W',
        humidity: '55%'
      },
      'Grants Pass, OR': {
        temp: '50°F',
        conditions: 'Overcast',
        high: '56°F',
        low: '40°F',
        precip: '15%',
        wind: '7 mph NW',
        humidity: '70%'
      }
    },
    defaultLocation: 'Eagle Point, OR'
  }
};

// Send to local API server
fetch('http://localhost:9400/notify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(weatherPayload)
})
  .then(res => res.json())
  .then(data => {
    console.log('✅ Weather notification sent:', data);
  })
  .catch(err => {
    console.error('❌ Failed to send:', err.message);
  });
