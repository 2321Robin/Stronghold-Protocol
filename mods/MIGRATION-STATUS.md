# 本地功能 → mod 迁移：进度与交接

> 本文件是「把剩余本地自用功能迁移到 mod 框架」任务的**进度快照与下一步交接单**。
> 框架本身的原理、命令、规则见同目录 `README.md` 与 `MIGRATION.md`。
> 最后更新：撞到模型调用频率上限（429）的那一轮，已完成 5 个功能并提交到各自的 `wip/mods-*` 分支；`#33`/`#24` 已捕获补丁声明但**未**验证、未提交；`#21` 尚未开始。

---

## 一、当前进度（一句话）

框架分支已就绪、单测/隔离/依赖排序都已验证；17 笔本地线独有提交已逐功能盘点，**5 个功能已完成并落盘，2 个功能已捕获待收尾，1 个功能（#21）还没动手**。

## 二、功能清单与状态

| 功能 | 本地提交（tip） | mod id | capture 工作树(tip) | 验证分支(wip) | 提交 sha | 状态 | 备注 |
|---|---|---|---|---|---|---|---|
| 地灵 #17 | d5610658..798c7449 + ed83a0b0 | `earthspirit` | — | feat/mods-024 | — | 已完成 | 56 补丁；测试 11/11；v0.2.4 上 0 漂移 |
| #30 同盟池 ×2 | 653ab495 + bbba5a4d | `coop-pool-x2` | — | feat/mods-024 | — | 已完成 | `retiredIn: "0.2.4"`，到 0.2.4 自动跳过 |
| #16 策略/道具进度 | b4af72c6 + 49ef735f | `band-progress` | cap-band(49ef735f) | wip/mods-band | `00f61ca6` | 已完成 | 24 补丁；i18n→json-merge(15 key)；修 1 漂移；测试 18/18 |
| lastLineup | c8396341 | `last-lineup` | cap-lastlineup(c8396341) | wip/mods-lastlineup | `a6279f30` | 已完成(动 golden) | 5 补丁；测试 5/5；**会移动 3 场景/7 行 golden，需重钉** |
| 联防视角 #22 | 6ec14176 | `unite-view` | cap-unite(6ec14176) | wip/mods-unite | `95bafdee` | 已完成 | 4 补丁；测试 31/31；0 漂移 |
| #28 预热 | 68eb594a + 03c44388 | `warmup` + `origin-migrate` | cap-warmup(03c44388) | wip/mods-warmup | `ac969d3d` | 已完成 | warmup=3 补丁+2 新文件；origin-migrate=纯新文件；测试 8/8 |
| #21 七名联动 | 62f16618 + 9398ac2a | `collab-kits` | cap-collab(9398ac2a) | wip/mods-collab | — | **未开始** | 见第四节 |
| #33 资源包 | 60a7cd26 | `asset-pack` | cap-pack(60a7cd26) | wip/mods-pack | — | **已捕获未验证** | 见第三节 |
| #24 开发者模式 | ee66eac5 | `dev-mode` | cap-devmode(ee66eac5) | wip/mods-devmode | — | **已捕获未验证** | 见第三节；基线极旧(v0.2.0)，预期多漂移 |

> #24 位于 `feat/dev-mode` 分支，分叉点 `13033214`（约 v0.2.0）。补丁从 v0.2.0 时代文件生成、要在 v0.2.4 上重放，预期多条漂移，属正常，逐条按 `check` 报告修即可。

## 三、pack / devmode 半成品如何收尾

两者的 `mods/<id>` 目录已存在于对应 `cap-*` 工作树，但**没有**验证、没有在 `t-*` 提交、没有补 `mod.json` 的 `name`/`dependsOn`。对每个都按下面四步收尾：

1. 把 `cap-<feature>/mods/<id>` 整个目录复制到 `.worktrees/t-<feature>/mods/<id>`。
2. 补 `mod.json`（见下）。
3. 在 `t-<feature>` 工作树里：`node tools/mod.mjs check <id>` → 修到 0 drifted → `apply` → 跑该功能的测试 → `revert --all` → `git status --porcelain` 只剩 mod 目录 → `git add -A mods/<id> && git commit`。

### asset-pack (#33) 收尾要点
- `mod.json`：`{"id":"asset-pack","name":"#33 浏览器端资源包预导入（SW）","upstream":false,"dependsOn":["warmup"]}`
  - **必须 dependsOn warmup**：它的 `public/js/main.js` 两条补丁的锚点（`import { installWarmup }` 与 `installWarmup({...})`）是 warmup mod 注入的，没 warmup 先应用就会漂移。
- 11 个新增文件已正确放进 `files/`，`.gitignore` 与 `main.js` 两个行补丁已就绪、无 `_review`。
- 验证：`cd .worktrees/t-pack && node tools/mod.mjs apply && node --test test/pack-assets.test.js test/ui/pack.test.js test/ui/packSw.test.js test/ui/packZip.test.js`
- UI 测试若缺 `public/vendor/*.js`（gitignored），从主仓库 `C:/Users/Robin/Documents/GitHub/Stronghold-Protocol/public/vendor` 拷过去，不影响 git status。

### dev-mode (#24) 收尾要点
- `mod.json`：`{"id":"dev-mode","name":"#24 开发者模式（房主把本局标记为 dev）","upstream":false,"dependsOn":["earthspirit"]}`
  - **必须 dependsOn earthspirit**：开发者模式复用 `room.setExtras` 通道（extras 上加 `devMode`）。
- `public-i18n-en.json` 目前是**行补丁**，必须改 json-merge：先用
  `git -C .worktrees/cap-devmode diff 22d01ee5 -- public/i18n/en.json` 看清本功能新增了哪些 key，只放这些 key 进 `merge`。
- 有 2 个 `_review` 标记（`public-js-screens-game.js.json`、`server-lobby.js.json`）——锚点不唯一，需换成文件里唯一、上游不太会动的行。
- 最难点：v0.2.0→v0.2.4，预期多条漂移；`dependsOn` 保证地灵先落。先 `node tools/mod.mjs check dev-mode --verbose` 看报告，逐条改锚点。
- 若某补丁确实因**上游重写了那段代码**（非锚点选得不好）而换锚点也无法解决，不要硬凑：保留该补丁并在交接里点名「需按新代码重新实现」。
- 测试：`node --test test/dev-mode.test.js test/match/fuzz.test.js`

## 四、collab-kits (#21) 从零怎么做

capture 工作树 `cap-collab` 已就绪（在 `9398ac2a`，含 62f16618 + 9398ac2a 两笔）。

### 捕获命令（在 `cap-collab` 里执行）
```
node tools/mod.mjs capture collab-kits --from=6ec14176 \
  server/sim/content/kits/ops/op-ash.js \
  server/sim/content/kits/ops/op-ela.js \
  server/sim/content/kits/ops/op-makoto.js \
  server/sim/content/kits/ops/op-marcil.js \
  server/sim/content/kits/ops/op-oblvns.js \
  server/sim/content/kits/ops/op-orchd2.js \
  server/sim/content/kits/ops/op-yato2.js \
  server/sim/content/kits/index.js \
  server/sim/content/kits/README.md \
  public/i18n/ja.json public/i18n/ko.json public/i18n/zh-TW.json \
  test/content/op_ash.test.js test/content/op_ela.test.js test/content/op_makoto.test.js \
  test/content/op_marcil.test.js test/content/op_oblvns.test.js test/content/op_orchd2.test.js test/content/op_yato2.test.js \
  test/assets-diy.test.js test/backups.test.js test/content/feedback5-we2-summon-hand.test.js \
  test/data.test.js test/diy.test.js test/feedback7-voices.test.js test/full-potential.test.js \
  test/golden/matches.json test/potential.test.js test/render/issue25-downback.test.js test/sim/trait_attack_speed.test.js \
  data/assets.json data/backups.json test/golden/diy.json
```

### 关键难点
- **7 个 kit + 7 个 test 是新增文件**：capture 对 tracked 的新文件不会自动收，需手工从 `git show 9398ac2a:<path>` 拷进 `mods/collab-kits/files/<path>`（保留仓库相对路径）。
- **i18n 三个文件 → json-merge**，绝不用行补丁。
- **`data/assets.json` / `data/backups.json` 是生成数据**（SP_DIY_COLLAB 构建产物）：整文件替换会丢上游新增项。优先 json-merge；若是数组增项，需评估——必要时**向我请求给 json-merge 加 array-union 语义，不要自己改框架**。
- **`test/golden/matches.json` / `test/golden/diy.json` 是 golden 摘要**：在 `mod.json` 加 `"golden": true`，并随变更重钉（见第五节）。
- 其余 test 文件 → 行补丁，处理 `_review`。
- 验证分支 `wip/mods-collab` 已就绪；验证后提交。

## 五、全部完成后如何整合

1. 在 `feat/mods-024`（worktree `mods-024`）上，把 7 个 `wip/mods-*` 分支的 `mods/<id>` 目录逐个合并进来（每个分支只新增一个 `mods/<id>`，`git merge` 或手动复制皆可）。
2. 全量验证：
   - `node tools/mod.mjs check --all` → 必须 0 drifted（此时所有 mod 基于同一 v0.2.4，互相锚点已协调）。
   - `node tools/mod.mjs apply --all` → 全应用。
   - **golden 重钉**：因 last-lineup（及 collab 若动 golden）会移动 golden 摘要，一次性
     `npm run golden:update`（遵循 `test/golden/README.md`），把新摘要随对应 mod 提交。
   - 跑受影响测试套件 + `npx --no-install eslint mods/_framework tools/mod.mjs` + `node tools/check-imports.mjs`。
3. 可移植性（portability）验证：
   - 用一个模拟上游演进的提交（故意改若干锚点所在行），对 `feat/mods-024` 跑
     `git merge-tree --write-tree` 证零冲突（参照 `MIGRATION.md` 的对比实验：`feat/mods-024` 退出码 0 / `local-preview` 退出码 1 有 13 冲突）。
   - `node tools/mod.mjs revert --all` 后 `git status --porcelain` 必须为空（只剩 mod 目录）。

## 六、踩坑与约定（务必遵守）

- **Edit 工具可能报成功但内容没落盘**：改完用 `node -e` 同进程读回验证，**别信 grep/sed 的回显**。（本轮出现过 grep 看到 `visit(dep`、node 实际读到 `visit(d` 的不一致。）
- **先 `git commit` 再 `git checkout -- .`**：否则刚打的补丁会被一起还原，表现为「改了没生效」。（本轮因此空耗过时间。）
- **父提交顺序**：本地线从旧到新为 `d5610658 → … → 60a7cd26`；capture 的 `--from` 传**父**（更早的），不是子。注意 `49ef735f` 是 `c8396341` 的子（i18n 提交），不是父。
- **`public/js/main.js` 被 warmup 与 asset-pack 共用**：两 mod 已通过锚点分工隔离（warmup 占 import 区 `startBuildGuard` 行 + boot 区 `data.load('assets')` 行；pack 占 `installWarmup` 引用行）。后续再动 main.js 沿用同一分工，且 asset-pack 必须 `dependsOn:["warmup"]`。
- **i18n 一律 json-merge**，绝不走行补丁；但只放本功能新增 key，不要顺手收进别的功能的 key。
- **共享文件天然允许**：revert 会自动重放其他 mod 的同文件补丁，框架已验证（见 `README.md`「Mods do not step on each other」）。
- 目标 `t-*` 工作树若缺 `public/vendor/*.js`（gitignored），从主仓库 `public/vendor` 拷，不影响 git status。
- **不要把任何 mod 的代码提 PR**：`upstream: false` 是框架的立身之本。

## 七、工作树布局速查

| 用途 | 路径 |
|---|---|
| 框架主线 | `.worktrees/mods-024`（分支 `feat/mods-024`，基线纯上游 `bc50cac0` v0.2.4，仅新增 `mods/` + `tools/mod.mjs`） |
| 捕获（各功能 tip，含框架副本） | `.worktrees/cap-band`、`cap-lastlineup`、`cap-unite`、`cap-collab`、`cap-warmup`、`cap-pack`、`cap-devmode` |
| 验证目标（v0.2.4 + 框架，分支 `wip/mods-<feature>`） | `.worktrees/t-band`、`t-lastlineup`、`t-unite`、`t-collab`、`t-warmup`、`t-pack`、`t-devmode` |
| 旧线参考 | `.worktrees/port-020..023`、`SP-dev`(local-preview) 等 |

> 整合完成后，所有 `cap-*` / `t-*` 工作树可 `git worktree remove`（确认无未提交改动后）。
