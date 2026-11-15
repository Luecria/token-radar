# Candidate build — not ready for submission

Starting point: d88e92297affb609799799b2923b5e115f078b77. Model label: launch-3.

Same snapshot and 29-row development holdout: median error factor 3.21617 -> 3.04798; within 2x 7/29 -> 8/29. See evaluation/report.md. Improvement is modest and not statistically established. An additional unfinished Theil-Sen exploration ran in parallel; it was not adopted. The adopted candidate was selected using grouped inner CV, but aggregate exploration and prior holdout inspection mean this is development evidence, not independent confirmation.

The entrypoint now validates options and artifact names, protects source paths, copies in stable order, and checks basic output caps. Two actual builds produced 10 byte-identical output files; boardIssue and evaluation/verify.ts passed (178 rows; 40 watchlist protocols). Dashboard source is 50,669 bytes. Dossier with OLD screenshots is 1,135,126 bytes. Server-only judgement is not tested.

## GGMU screenshot handoff

Use Node >=22.18. Obtain the official kit from https://make.fun/c/token-radar-01/kit and unpack it outside this repository.

```sh
node main.ts --input /path/to/token-radar-01-kit/input/snapshot.json --output out
```

Open out/dashboard/index.html locally, without network. Capture the board, one protocol detail, filtered board, and model view. Existing screenshots/ images are from v2 and STALE. Replace them, do not add beyond four. Each image must be PNG/JPEG, <=512 KiB, long side <=1440 and short side >=800; aim for 300–350 KiB. Preserve the exact source commit when taking screenshots.

## Outstanding checks

The kit has no grade-local for this bounty. Its bundle command refused to create a transcript bundle because the real provider and harness version were not declared/recorded completely. Therefore the attempted CLI check stopped at the missing bundle. Full transcript eligibility (including session timestamps, family completeness, authorship and model pricing) is NOT verified. Do not fabricate metadata or modify recorded logs to pass it. No submission is authorized.
