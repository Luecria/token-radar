# token-radar
[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Luecria/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Luecria/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
Token Radar ranks every pre-token protocol in a sealed DefiLlama snapshot by an implied launch value fitted on the snapshot's own launched-token comparables — a log-linear fit of market cap on TVL with shrunk per-category adjustments, evaluated on a reused same-snapshot development holdout (not a forward backtest) — and shows a concrete farm plan for each one.
## Run it
```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```
---
<sub>Entered on [make.fun](https://make.fun/?ref=t2m0zqpw&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
