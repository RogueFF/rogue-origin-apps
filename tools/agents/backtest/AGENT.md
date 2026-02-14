# Backtest Agent

**Domain:** Trading
**Glyph:** 📈
**Color:** #8b5cf6

## Purpose
Validates trading desk performance against random baselines using Monte Carlo simulation. Computes confidence scores for new plays based on historical data + current conditions.

## Commands
```bash
# Replay closed trades and compute metrics
node engine.js replay

# Generate random portfolio baseline (50 trials default)
node engine.js random --trials=100

# Full validation: replay + random + sigma comparison
node engine.js validate

# Validate and post report to Mission Control
node engine.js report

# Score a specific play
node confidence.js --ticker=AAPL --direction=bullish --rr=2.5
```

## Key Metrics
- **Sigma Distance** — how many standard deviations above random our performance is
  - >3σ = strong signal (0.27% chance of luck)
  - >2σ = promising (2.3% chance)
  - >1σ = inconclusive
  - <1σ = weak or below random
- **Win Rate** — % of trades profitable
- **Expectancy** — average $ per trade
- **Sharpe Ratio** — risk-adjusted return (annualized)

## Schedule
- Weekly validation (Fridays after market close)
- On-demand via `node engine.js report`
