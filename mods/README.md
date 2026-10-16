# The local mod layer

> 怎么把现有本地线切换过来、剩下 8 个功能怎么搬：见 [MIGRATION.md](MIGRATION.md)。
> 框架挂在哪个分支上是有讲究的——基线必须是纯上游，否则框架自己也会变成要手工 rebase 的东西。

Everything in here is **ours, never upstream**: personal-use features that will never go into a PR.
Upstream can be pulled as a clean fast-forward because a mod is not a commit on top of upstream —
it is a set of *declarations* that a tool replays onto whatever upstream looks like today.

```
git pull upstream          ← clean tree, no rebase
node tools/mod.mjs apply --all
```

## Why not just keep committing on a fork branch

17 local commits touched 94 files; 62 of those were upstream files. Every upstream release turns
those 62 into rebase conflicts, and each one has to be read and merged by hand — and a mistake
silently drops a feature (地灵 spans protocol + lobby + pool + six client files; miss one hunk and
it is gone with no error).

A mod instead declares *where* to write, not *what the file looked like*. Replaying re-finds that
place. Upstream moving a function or renaming its neighbours does not matter; only deleting or
duplicating the anchor does, and that is reported as **drift** with the candidate positions.

## Layout

```
mods/
  README.md              this file
  .gitignore             keeps .state.json off git
  _framework/            the engine (engine.mjs, report.mjs)
  <mod-id>/
    mod.json             manifest
    files/               new files, copied verbatim — paths mirror the repo
    checks/              the mod's own tests, applied under test/ (see below)
    patches/*.json       patch declarations, one file per target file
```

`tools/mod.mjs` is the command line.

## Commands

| command | what it does |
|---|---|
| `node tools/mod.mjs status` | which mods exist, which are applied |
| `node tools/mod.mjs check` | **dry run** — does every patch still find its anchor? The first thing to run after `git pull` |
| `node tools/mod.mjs apply --all` | replay every mod onto the current tree |
| `node tools/mod.mjs revert --all` | undo them; leaves a clean upstream tree, safe to pull |
| `node tools/mod.mjs doctor` | is the tree safe to pull? flags files edited since they were applied |

## Writing a patch

```json
{
  "file": "server/lobby.js",
  "patches": [
    {
      "id": "dispatch-setExtras",
      "anchor": "case 'room.setAiPicksLast': return this.setAiPicksLast(session, msg);",
      "op": "insert-after",
      "new": [
        "// local mod: the host opts a hidden operator into the next match's pool",
        "case 'room.setExtras': return this.setExtras(session, msg);"
      ]
    }
  ]
}
```

- **anchor** — a line that must occur exactly once (trimmed comparison). Zero or two-plus hits is
  drift, and the report prints the candidate lines. `anchorRegex` is available when a trimmed
  literal is too brittle.
- **op** — `insert-after`, `insert-before`, `replace`, `json-merge`.
- **replace** also carries `old`: the block must match line for line (trimmed) before it is
  swapped. If it does not, you get `context-changed` with both the expected and the found text.
- **Indentation is never written into a patch.** Blocks are written at their own left margin and
  rendered against the anchor's indent, so a re-indented upstream file still lines up.
- **json-merge** merges key by key (`config.json`, the i18n packs). Upstream editing other keys
  never collides — this is what takes `public/i18n/en.json` off the conflict list for good.
- **files/** — anything placed there is copied to the same relative path. New files can never
  conflict. A mod's *own tests* are the one exception — they go in **checks/**, see below.
- **checks/** — the mod's own tests, named `*.check.js`. Do **not** put them in `files/test/`:
  `node --test` with no paths globs every `*.test.js` anywhere and every `.js` inside a directory
  named `test`, so a test held in `files/test/` would run *on the framework branch* too — where its
  mod is not applied and the code it drives is missing — and fail, turning CI red on every push.
  `checks/` beats both patterns; `apply` writes its contents to `test/` (same sub-path, name
  unchanged: `checks/ui/pack.check.js` → `test/ui/pack.check.js`), where normal discovery picks it
  up again and runs it against really applied code. `revert` removes them like any other new file.
  Write imports relative to the applied location, not to `checks/`. `capture` writes new files into
  `files/`, so a captured test file has to be moved into `checks/` by hand.

`replace` on a JSDoc block is deliberately a separate patch from the code it documents: if upstream
rewords the comment, the doc patch drifts and the code patch still applies.

## The release ritual

```bash
node tools/mod.mjs doctor                 # anything edited since it was applied?
node tools/mod.mjs revert --all           # clean tree
git pull upstream                         # plain fast-forward, zero conflicts
node tools/mod.mjs check --verbose        # who drifted?
node tools/mod.mjs apply --all            # replay
# fix only the drifted entries, then:
node --test test/<the mod's tests>
```

`check` is the whole point: it names the mod, the file, the patch and the anchor, and prints the
lines now sitting there. You decide the new anchor; you never decode a conflict block.

## Retiring a mod

When upstream ships a feature natively, set `"retiredIn": "0.2.4"` in `mod.json`. Once
`package.json` reaches that version the mod is skipped everywhere and `status` says so — then
delete the directory. `coop-pool-x2` was the first of these (upstream 0.2.4 took it as
`poolCopiesCoopScale`; its directory has since been deleted).

## Golden results

A mod that changes gameplay numbers moves the golden digests. Declare `"golden": true` in
`mod.json`, replay, then re-pin and commit the new digests with the change, as `test/golden/README.md`
requires. Reverting restores them with the rest of the tree.

## Mods do not step on each other

Two mods touching the same file is normal — every lobby-side feature lands in `server/lobby.js`.
Restoring a file hands the *whole* file back to upstream, so reverting one mod replays the other
mods' patches onto the clean file afterwards, and says so:

```
- probe-shared reverted (0 removed, 1 restored)
    shared with another mod, replayed for it: server/lobby.js
```

A replay that itself drifted is reported as `could not replay <mod> <file> [<patch>] — <reason>`
with a non-zero exit — nothing goes missing quietly.

Whether a mod is still applied is decided per patch (is its own output in the file?), never by a file
hash: on a file two mods share, the other mod's edits change the hash every time, so a hash could
never tell "mine is still there" from "someone else just wrote".

Two mods may even share one anchor. They stack in mod-id order, and a mod recognises its own block
anywhere in the file, so `apply` never inserts the same block twice.

## Depending on another mod

`"dependsOn": ["earthspirit"]` in `mod.json` — a dev-mode hook that drives `room.setExtras` has to
see that flag exist before its own anchors are searched. Apply runs deps first, revert runs them
last. A dep that is not under `mods/` is reported at startup (`depends on "x", which is not under
mods/`) and does not stop the run — a retired mod you deleted is the usual reason.

## Rules

- Never put a mod's code in a pull request. `upstream: false` is the whole point.
- Keep one mod per feature. A mod is the unit you replay, revert and retire.
- Sharing a file with another mod is fine; depending on another mod's *behaviour* is what
  `dependsOn` is for.
- A patch that drifts twice is a sign the anchor was badly chosen — pick a line upstream is unlikely
  to touch, not the nearest one.
