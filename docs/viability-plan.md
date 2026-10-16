# Long term viability plan

Working notes for cutting DiceCloud's hosting cost and speeding up creature computation without changing what any sheet shows.

Source: the "long term viability" thread in the DiceCloud Discord architecture channel (2025). Not tracked on GitHub yet. Being discussed with the maintainer on Discord before any PR goes upstream.

## Goal (from the thread)

> As a bill payer of DiceCloud's infrastructure, I want DiceCloud to cost as little as theoretically possible, so that it can have as many users as possible enjoying it without it falling over, financially or otherwise.

1. Store only the state needed to compute a creature. Compute when it loads into server memory and publish from there.
2. Memoise parsing in a shared `calculationHash -> AST` map, since most creatures share library calculations.
3. Later: cache creatures in Redis with a change channel so several servers can share a creature (tabletops across sticky sessions). redis-oplog is prior art, probably not a dependency.

## How it works today (`develop` @ 88fc9c83)

- All computation is server side. `app/imports/api/engine/computeCreature.ts` returns early on the client.
- Mutating methods in `app/imports/api/creature/creatureProperties/methods/` set `dirty: true`.
- `app/imports/api/engine/loadCreatures.ts` keeps each open creature's properties in a `LoadedCreature` map, observes `CreatureProperties` by `root.id`, and recomputes 100 ms (`COMPUTE_DEBOUNCE_TIME`) after a dirty change.
- A recompute rebuilds the whole dependency graph (`buildCreatureComputation.ts`, ngraph), computes every node (`computeCreatureComputation.ts`), diffs against the originals and bulk writes the changed keys (`writeComputation/writeAlteredProperties.js`). That write goes back out through the oplog to every subscriber.
- Parse cache: `parseCalculation` in `buildComputation/parseCalculationFields.js` skips the parse when `cyrb53(calculation) === calcObj.hash`. The cache is the `parseNode` and `hash` stored in Mongo on every calculation field (`app/imports/api/properties/subSchemas/computedField.ts`, `inlineCalculationField.ts`).
- `removeBeforeCompute` is tagged in 15 files and applied by `buildComputation/removeSchemaFields.js`. It doesn't cover `parseNode`, `hash` or computed values.
- `singleCharacter` publication recomputes when `computeVersion !== VERSION`.
- `app/redis-settings.json` exists but `cultofcoders:redis-oplog` isn't in `.meteor/packages`.
- No server code outside the engine queries computed fields. Clients get them through `singleCharacter` and `app/imports/server/rest/apiPublications/creature.js`.

## Upstream state to work around

- `upstream/DC-16-migrate-to-meteor-3` (last commit 2026-05-10): Meteor 3.4.1-rc, Vue 3, Vuetify 3, rspack, TS 5.10. 670 files, about +40k/-36k. Touches 70 engine files. Drops `peerlibrary:reactive-publish`, `simple:rest*`, `akryum:*`, swaps in `quave:synced-cron`. None of the plan's items are done there either: `parseNode`/`hash` still stored, same parse skip, no Redis.
- `DC-*` branch names point at a tracker we can't see.
- Older: `zod-schemas` (2025-01, 3 commits), `vite` (2023, Vue 3 attempt).
- Any engine PR against `develop` will conflict with DC-16. Which base to use is the first thing to ask.

## PR sequence

Each PR is small, one concern, and has to leave computed output identical.

- [ ] **0. Green tests.** Get `npm test` passing locally on the chosen base. Record how long it takes.
- [ ] **1. Snapshot tests.** Run a set of creature fixtures through `buildComputationFromProps` and `computeCreatureComputation`, snapshot the output. Tests only. Include a local benchmark so we have numbers without prod logs.
- [ ] **2. Shared parse memo.** Size capped `Map<hash, ParseNode>` keyed by the existing `cyrb53` hash. Must land before 3, otherwise removing the stored `parseNode` makes every load reparse.
- [ ] **3. Stop persisting `parseNode` and `hash`.** Memory only, removed from written keys, migration to unset existing fields.
- [ ] **4. Publish computed fields from memory.** `singleCharacter` and the REST creature endpoint serve computed fields from `LoadedCreature` through a custom publication. Agree on the approach with the maintainer first.
- [ ] **5. Redis.** Only if prod runs enough instances to need it.

Later, if wanted: incremental recompute (only dependents of the dirty node), engine in `worker_threads` so big sheets don't block DDP.

## Open questions for the maintainer

1. Base PRs on `develop` or `DC-16-migrate-to-meteor-3`? When is DC-16 likely to merge?
2. Is anyone working on any of this already?
3. Does anything outside this repo read computed fields from Mongo (Discord bot, v1, analytics)?
4. How many app instances does prod run?

## Constraints

- CLA via cla-assistant. Commit as `lithial`, no AI co-author trailers. PR #399 failed the CLA because `claude` was a committer.
- One maintainer, review is the bottleneck. Outside PRs that got merged were tiny. Keep diffs readable in one sitting.
- No access to prod logs or metrics. Every claim needs local evidence: tests, snapshots, benchmarks.

## Log

- 2026-10-17: Forked to `Lithial/DiceCloud`. Remotes: `origin` = fork, `upstream` = ThaumRystra. Found DC-16. Corrected the parse cache finding (it exists, stored in Mongo).
