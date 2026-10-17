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

### What DC-16 already changed that matters here

- Variables are off Mongo. Server `CreatureVariables` collection deleted, `writeScope.js` is now a stub: `// TODO write scope to loaded creature`. This is the plan's step 4 started for variables.
- That work is unfinished. The client reads `CreatureVariables` (`app/imports/client/localCollections/CreatureVariables.ts`, a `new Mongo.Collection(null)`) in 8 components, but nothing fills it, and a null collection can't receive a publication. `LoadedCreature.variablesObserver` is declared but never assigned, so the `variablesObserver.stop()` call in `loadCreatures.ts` should throw when a creature unloads.
- `singleCharacter.ts` is a plain async publication returning cursors. `peerlibrary:reactive-publish` is gone.
- Engine is async (`await buildCreatureComputation`). REST uses `simple:json-routes`. `percolate:migrations`, `meteortesting:mocha`, `aldeed:collection2`, `mdg:validated-method` kept.
- Still the same as `develop`: `parseNode`/`hash` stored per calculation, same parse skip, computed prop fields written back by `writeAlteredProperties.js`.

## PR sequence if based on DC-16 (preferred)

PRs target `upstream/DC-16-migrate-to-meteor-3`. Branch each one off it in the fork and rebase often, it moves.

- [ ] **0. Run it.** Install Meteor 3.4.1-rc, boot the app, run `npm test`. Write down what's broken. Don't fix unrelated things, just report the list to the maintainer.
- [ ] **1. Parity snapshots.** Same fixtures run through the engine on `develop` and on DC-16, snapshots compared. Tests only. Proves the migration didn't change any computed values, which is useful to him on its own, and gates every later PR. Includes a local benchmark.
- [ ] **2. Finish variables off Mongo.** Fill his `writeScope` TODO: keep scope on `LoadedCreature.variables`, publish it to the client through a named client collection with `this.added`/`changed`, fix the `variablesObserver` crash. Check the REST endpoint still gets variables. Only with his OK, he may be mid-way. This becomes the pattern for step 5.
- [ ] **3. Shared parse memo.** Size capped `Map<hash, ParseNode>` on the existing `cyrb53` hash. Before step 4.
- [ ] **4. Stop persisting `parseNode` and `hash`.** Memory only, plus a `percolate:migrations` migration to unset them.
- [ ] **5. Computed prop fields from memory.** Same pattern as step 2 applied to `CreatureProperties`: Mongo keeps only the fields needed to compute, `singleCharacter` and REST serve computed props from `LoadedCreature`. Agree on approach first.
- [ ] **6. Redis.** Only if prod needs several instances.

Not ours on this base: the Meteor 3 upgrade, package replacements, Vue/Vuetify 3. He's doing those.

Later, if wanted: incremental recompute, engine in `worker_threads`.

## PR sequence if based on `develop`

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

## DC-16 test run (step 0)

Why tests don't run as shipped:
- Collection2 isn't loaded in test mode. `server/main.js` imports `meteor/aldeed:collection2/static`, but `meteor test` skips the main module, so `EngineActions.attachSchema is not a function`.
- Most test files are async modules (top-level await somewhere in their imports) and finish loading after mocha has started, so they register nothing. There's no error, just a short run.
- `imports/parser/parseTree/accessor.ts:8` `const getFromScope = (await import('../../api/engine/shared/scope')).getFromScope;` deadlocks module loading (circular import through `loadCreatures`). Replacing it with a static import fixes it.

Local patches used to get a full run (not committed):
- `package.json` `meteor.testModule = tests/main.js`. That file imports collection2, holds `mochaInstance.run` until every `*.test.*` import resolves, and turns failed imports into failing tests.
- `accessor.ts` static import, as above.
- `computeVariable.ts`: restored `develop`'s `if (!node.data) node.data = {}` guards for the node and the linked node. Without them `aggregateClassLevel` throws `Cannot read properties of undefined (reading 'inactive')`, an unhandled rejection that kills the test process.

The 26 failures:
- 14 × `Cannot read properties of undefined (reading 'stop')` at `loadCreatures.ts:328` `this.variablesObserver.stop()` from `unloadAllCreatures` in `actionEngineTest.testFn.ts`. This is the predicted `variablesObserver` bug.
- 4 × action targeting results differ (`expected [ { targetIds… } ] to deeply equal …`), 1 × `Target property is required [not-found]`, 1 × `applyTask is not a function` (circular import, rspack warns about `applyTask.ts`).
- `computeCreatureComputation.test.ts`: inline calculation not substituted (`'test description inlineRef * 2…'`), constant computes to `NaN` instead of 6.
- `parentingFunctions.test.ts`: `remove is not available on the server. Please use removeAsync()`. Throws at load, which leaves mocha's suite stack open, so the later accessor/call tests show up nested under "Document tree filters". Their own failure: `context.errors` not empty when compiling a known variable.

Not yet compared with `develop` (needs Meteor 2.16 / Node 14), so some failures may predate DC-16.

## Constraints

- CLA via cla-assistant. Commit as `lithial`, no AI co-author trailers. PR #399 failed the CLA because `claude` was a committer.
- One maintainer, review is the bottleneck. Outside PRs that got merged were tiny. Keep diffs readable in one sitting.
- No access to prod logs or metrics. Every claim needs local evidence: tests, snapshots, benchmarks.

## Log

- 2026-10-17: Step 0 on DC-16 @ 05c522cd (worktree `../DiceCloud-dc16`, Meteor 3.4.1-rc.0, Node 22.22.1). `meteor npm install` OK. Typecheck: 1596 errors (679 in `api/engine`), mostly implicit any and missing types, not blocking. Out of the box `meteor test` runs 10 of 36 test files; the rest never register. After local patches: 53 passing, 26 failing. Details in "DC-16 test run" below.
- 2026-10-17: Reviewed DC-16. Variables already moved off Mongo but unfinished (stub `writeScope`, client collection never filled, `variablesObserver` never assigned). Added DC-16 plan. Meteor isn't installed locally yet.
- 2026-10-17: Forked to `Lithial/DiceCloud`. Remotes: `origin` = fork, `upstream` = ThaumRystra. Found DC-16. Corrected the parse cache finding (it exists, stored in Mongo).
