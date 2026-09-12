# dsh-price-phase

English | [中文](./README.md)

**A DeepSeek peak / off-peak badge for the DSH Web GUI**: shows whether you are currently in a **peak** or **off-peak** billing window, centred in the composer's bottom tool row, with a countdown to the next switch.

> Based on DeepSeek's official time-of-day pricing: **peak hours are Monday–Friday 09:00–12:00 and 14:00–18:00 Beijing time**. Every other moment — including **all of Saturday and Sunday** — is off-peak, priced at half the peak rate.

---

## Why this exists

It started as a bug. The author's own implementation compared only hours and minutes and forgot to check the day of week, so **every weekend reported "peak" during 09:00–12:00 and 14:00–18:00** — users would believe they were paying full price while off-peak rates actually applied.

It was extracted into its own package because that particular rule is easy to miss, and missing it costs **six hours of wrong status every weekend**.

## What this plugin deliberately does not do

Several peak-hour indicators already exist. This one is scoped to **do one thing**:

- No timezone conversion (the official rule is defined in Beijing time; converting from UTC+8 is the least error-prone approach)
- No 24-hour timeline, price table, or detail modal
- No click interactions, no host state reads, no network requests
- **Zero third-party dependencies** — only `require('react')`

Every decision comes from the browser's local clock converted to UTC+8, so it works offline, has no latency, and can never show a stale state because a request failed.

## Features

| Capability | Notes |
|---|---|
| Live phase | Peak / off-peak, recomputed every 30 seconds from the system clock |
| Countdown | Time until the phase **actually flips** — `2h13m` / `45m` / `38s` |
| Hover detail | Current Beijing time (with weekday), both phases, and what happens next |
| Narrow-screen layout | On phones it becomes an inline short label without the dot, so it cannot overlap the model chip |
| Correct weekend countdown | After Friday 18:00 it points to **Monday 09:00**, not Saturday 09:00 |

## Install

```sh
npm install dsh-price-phase
```

Then add one entry to your DSH profile patch layer (for example `~/.dsh/profiles/web/cordis.patch.yml`):

```yaml
- insert:
    - id: dsh-price-phase
      name: 'dsh-price-phase'
```

Restart DSH (or let the profile reload). The badge appears centred in the composer's bottom tool row.

## Development

```sh
npm run check    # syntax preflight for all three entry points
npm test         # 21 tests: pure logic + bundle contract
npm run verify   # both
```

Tests come in two layers:

- `test/price-phase.test.js` — phase decisions, day and weekend boundaries, countdown landing points. Timestamps are built as `Date.UTC(y, m, d, H-8, M)` (Beijing = UTC+8), and expectations are transcribed from the official pricing footnote rather than copied out of the implementation.
- `test/client-contract.test.js` — builds a minimal browser environment in `node:vm`, actually executes `lib/client.js`, and checks that the `__ModuleLoader__.load({ id })` id matches the package name, that `factory` only requires declared modules, that `apply` registers into the right slot, and that style injection is idempotent. These packaging mistakes surface on the host side only as `loaded without registering`, so they are invisible without executing the bundle.

## Known limits

- **Beijing time is the reference.** The official rule is defined in Beijing time; overseas users see the phase that corresponds to Beijing time. This is intentional — converting to local time would produce wrong answers.
- **No price values.** The plugin reports the phase only. Rates change, and hardcoding them client-side goes stale.
- **Registers one slot**, `conversation.input.right`. That slot is `kind: list`, so it coexists with other plugins and orders by `order: 90`.
- Depends on the DSH 0.1.5 client slot contract; earlier versions are untested.

## License

MIT
