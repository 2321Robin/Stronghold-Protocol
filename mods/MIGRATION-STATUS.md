# 本地功能 → mod 迁移：完成报告

> 原《进度与交接单》。**17 笔本地线独有提交已全部转成 mod，并在纯上游 v0.2.4 上完成兼容性与可移植性验证。**
> 框架原理见同目录 `README.md`，迁移方法见 `MIGRATION.md`。

---

## 一、结果一句话

本地线 17 笔提交 → **9 个 mod、190 条补丁、40 个新增文件**（#22 联防视角裁定于 2026-10-13 废弃，见 §二）；
在纯上游 v0.2.4 上
`apply --all` **190/190 零漂移**，`revert --all` 后工作树干净；框架分支 `feat/mods-024`
相对纯上游仍**只新增 `mods/` 与 `tools/mod.mjs` 两条路径**。

## 二、功能清单（全部完成）

| 功能 | 本地提交 | mod id | 补丁 | 新增文件 | 备注 |
|---|---|---|---|---|---|
| 地灵 #17 | d5610658..798c7449 + ed83a0b0 | `earthspirit` | 60 | 1 | 含 4 语言包 i18n 补丁 |
| #30 同盟池 ×2 | 653ab495 + bbba5a4d | `coop-pool-x2` | 5 | 0 | `retiredIn: "0.2.4"`，到版本自动停用 |
| #16 策略/道具进度 | b4af72c6 + 49ef735f | `band-progress` | 30 | 3 | 4 语言包全部 json-merge |
| lastLineup | c8396341 | `last-lineup` | 6 | 0 | 自带 golden 重钉（3 场景） |
| #21 七名联动 | 62f16618 + 9398ac2a | `collab-kits` | 27 | 14 | golden 重钉 + 11 个新场景 |
| #28 预热 | 68eb594a + 03c44388 | `warmup` | 3 | 2 | — |
| 跨源迁移页 | 03c44388 | `origin-migrate` | 0 | 1 | 纯新增文件 |
| #33 资源包 | 60a7cd26 | `asset-pack` | 3 | 11 | `dependsOn: ["warmup"]` |
| #24 开发者模式 | ee66eac5 | `dev-mode` | 16 | 3 | `dependsOn: ["earthspirit"]` |

`apply` 顺序由 `dependsOn` 拓扑排序决定：`warmup → asset-pack`、`earthspirit → dev-mode`。

> **#22 联防视角已于 2026-10-13 废弃**（用户决定改用上游行为：联防视角构建 **rows 6–13**，不再裁到 9–13）。
> 对应 mod `unite-view` 目录**已删除**。注意这**不是** `retiredIn` 退役——上游**从未**收编该裁定，
> 是主动放弃本地观感裁定，故既不保留 mod 也不写 `retiredIn` 标记（写它会误导为"上游已原生实现"）。
> 随之 `test/render/playtest5-maps.test.js` 与 `test/ui/playtest2.test.js` 恢复上游断言，v0.2.5 上 **31 项全通过**。

## 三、兼容性（v0.2.4）

- `node tools/mod.mjs check` → **every patch found its anchor**（8 个未退役 mod 全部 0 drifted）。
- `node tools/mod.mjs apply` → 190 条补丁全部 applied、0 drifted。
- `node tools/mod.mjs apply --force` 重放 → 全部判 already in place，**字节级幂等**
  （`test/golden/diy.json` 的 sha256 重放前后一致）。
- `node tools/mod.mjs revert --all` → 工作树 `[clean]`，只剩 mod 目录本身。
- golden：`matches.json` 3 个场景、`diy.json` 5 个重钉 + 11 个新增，两个文件都与
  「应用全部 mod 后跑 `npm run golden:update`」的产出**字节一致**。
- i18n：`node tools/i18n.mjs check --all --strict` 四语 **100%（1209/1209，0 missing）**。
- eslint：`mods/_framework/` 与 `tools/mod.mjs` **0 problem**。
- 全量 `npm test`：6118 项，5901 通过。与**纯上游基线**（5995 项，5789 通过）逐条比对失败名单，
  多出的 6 项**全部为环境性**，与 mod 无关：
  - 5 项 `test/pack-assets.test.js` / `packSw.test.js`：`spawnSync` 在本机返回 `EBUSY`
    （`node --check public/sw.js` 手动跑通过），且需要 gitignored 的 `public/assets`。
    **在本地线原版实现上跑同样这 5 项，结果完全一致。**
  - 1 项 `test/sim/perf.test.js` 基准：单独跑 2/2 通过，仅在全量并发负载下超时。

## 四、可移植性

用一个**模拟上游演进**的提交（故意改掉若干 mod 锚点所在行：`server/lobby.js`、
`server/match/PlayerState.js`、`public/js/render/app/view.js`、`server/sim/content/kits/index.js`、
`public/js/main.js`）做对比实验：

| 分支 | `git merge-tree --write-tree` |
|---|---|
| `feat/mods-024`（框架 + 全部 mod） | 退出码 **0**，**零冲突** |
| `local-preview`（v0.2.3 + 17 笔本地提交） | 退出码 **1**，**18 个文件冲突** |

把框架+mod 放到那个模拟上游上跑 `check`，输出精确点名：**11 条漂移**，逐条给出
mod / 文件 / 补丁 id / 原因（`anchor-missing` 等）与锚点周围现在的内容——没有冲突块要解。

## 五、本轮修掉的框架缺陷（都很实质）

1. **`planJson` 整文件重序列化**：上游数据文件刻意混用样式（golden 里
   `"errors": {"count":0,"kinds":[]}` 紧挨多行场景对象），`JSON.stringify(x,null,2)` 会把
   6081 行炸成 57138 行。改为**跨度感知的外科合并**：解析时记录每个值的文本跨度，
   只重写被合并键的跨度，其余字节原样拷贝。
2. **rebuild 路径漏合已有键**：值长大出新字段时走 rebuild，旧字段被原样拷贝导致替换不生效
   （collab 的 golden 重钉因此有 5 条没落地）。
3. **写入器不匹配 golden.mjs 的行内规则**：`units` 每行、`players` 整行被拆开。
   复刻 `stringifyGolden` 的规则（标量与短标量对象保持一行、深度≥6 且够短才内联、
   标量数组恒紧凑），并按被替换值自身是否含行内嵌套来判定文件遵循哪套。
4. **键集相同时用替换代替递归合并**：递归保留上游键序，而 `golden:update` 写的是模拟器产出的
   顺序，恒差 11 行。键集一致时两者等价，改用替换以对齐字节。
5. **数组节点的样式探测**：数组记的是 `items` 不是 `entries`，`inlineNestedStyle` 对 `units`
   这类数组恒返回 false。
6. **apply 状态被覆盖**：`--force` 重放只碰 1 个文件时，状态丢掉首次 apply 的另外 15 个，
   revert 于是只还原 1 个。改为与既有条目合并（created/modified 取并集，哈希全量刷新）。
7. **`check --verbose` 崩溃**：`linesOf` 是 async，同步调用拿到 Promise，`excerpt` 一 slice 就炸。
   只有「漂移且锚点仍有命中」才会触发。
8. **`capture` 会把 `tools/mod.mjs` 自己也当新文件收进去**：已排除。

## 六、超出本地线的三处补齐（有意为之）

本地线一直带着这些缺口，整合到 v0.2.4 不该把绿着的门弄红：

1. **ja/ko/zh-TW 译文**：#16 与 #24 的字符串此前只有 en 条目，各缺 26 条，`--strict` 直接红。
   补齐 78 条；地灵的 7 条界面字符串也从本地线搬进 mod（此前 mod 里根本没有 i18n 补丁）。
2. **地灵房间 UI 的裸中文字面量**：包上 `t()`。`i18n.mjs check` 只校验已包裹的字符串所以看不见，
   而 `test/i18n.test.js` 的「no Chinese literal left unwrapped」直接红。
3. **地灵测试的深比较**：原先深比较整个 `extras`，dev-mode 往共享通道加 `devMode` 字段会误判为
   失败；改为只断言 `earthspirit` 自己那一项。

## 七、踩坑（下次直接照做）

- **改完文件先 commit，再 `git checkout -- .` / `git clean -fd`**。本轮因此白丢过四次成果
  （golden 更新、i18n 补丁、地灵断言放宽、dev-mode 同步），表现为"改了没生效"。
- **Edit 工具可能报成功但内容没落盘**：改完用 `node -e` 同进程读回验证，别信 grep/sed 的回显。
- **父提交顺序**：本地线从旧到新为 `d5610658 → … → 60a7cd26`，capture 的 `--from` 传**父**。
- **共享文件天然允许**：`public/js/main.js` 被 warmup 与 asset-pack 共用，靠锚点分工隔离
  （warmup 占 import 区 `startBuildGuard` 行 + boot 区 `data.load('assets')` 行；pack 占
  `installWarmup` 引用行）；asset-pack 因此必须 `dependsOn: ["warmup"]`。
- **本机 `spawnSync` 会间歇返回 `EBUSY`**：用 `node --check` / 手动跑复判，别急着归因于代码。

## 八、工作树

框架主线 `.worktrees/mods-024`（分支 `feat/mods-024`，基线纯上游 `bc50cac0` v0.2.4）。
各功能的 capture / 验证工作树（`cap-*`、`t-*`）与 `wip/mods-*` 分支已完成使命，可清理：
`git worktree remove` 后 `git branch -D wip/mods-*`。
