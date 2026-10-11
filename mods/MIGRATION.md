# 迁移到 mod 模式

`mods/README.md` 说明框架怎么工作；这份说明怎么把现有的本地线**切换**过去，以及剩下的
本地功能怎么逐个搬进来。

## 一、为什么必须换基线，不能只加个目录

框架挂在哪个分支上，决定了它自己会不会变成下一个要手工 rebase 的东西。

`feat/mod-framework` 是基于 `60a7cd2`（含 17 笔本地提交）建的——加个 `mods/` 目录并不能让那
17 笔消失，上游一更新这个分支照样要 rebase。**框架救不了它自己的载体。**

正确的载体是：**基线 = 纯上游，本地内容只有两个新增路径**（`mods/`、`tools/mod.mjs`）。
`feat/mods-024` 就是这样建的：

```
bc50cac0 (v0.2.4) ── a3f2d18e  只新增 mods/ + tools/mod.mjs
```

上游从未有过这两条路径（`git log --all -- mods tools/mod.mjs` 只有我们这一次提交），所以上游
永远不可能与之冲突。用同一个模拟上游提交分别合并，实测：

| 分支 | 合并结果 |
|---|---|
| `feat/mods-024`（纯上游 + 框架） | 退出码 0，**零冲突** |
| `local-preview`（v0.2.3 + 17 笔本地） | 退出码 1，**13 个文件冲突** |

那 13 个（`Match.js`、`gamedata.js`、`pool.js`、`config.json`、4 个 i18n、2 个 golden、
`build-data.mjs`…）正是每次升级要手动解的东西。

**结论：`feat/mod-framework` 作废，以 `feat/mods-024` 为准。** 前者只作开发过程留档。

## 二、把整合线切过去

当前线上是 `local-preview` @ `ed83a0b0`（v0.2.3 + 16 笔本地 + #30 三笔）。切换要等一个时机：
**上游 0.2.5 发布**，同时 PR #496 / #497 审合、#30 退役。在那之前线上不动。

```bash
# 1. 在 SP-dev 上把整合线重建为纯上游 + 框架（旧的 17 笔不再进这条线）
git -C ../SP-dev switch local-preview
git -C ../SP-dev reset --hard origin/master        # 旧线先备份 tag

# 2. 把框架搬过来（两个新增路径，不可能冲突）
git -C ../SP-dev checkout feat/mods-024 -- mods tools/mod.mjs
git -C ../SP-dev commit -m "本地 mod 层：mods/ + tools/mod.mjs"

# 3. 重放，看漂移
node tools/mod.mjs status
node tools/mod.mjs apply --all

# 4. 已退役的 mod 会自己跳过；确认后删掉
node tools/mod.mjs status        # 标 [retired in 0.2.4] 的就是
```

旧线务必先打 tag 再 reset：`git tag backup/local-preview-ed83a0b`。`.worktrees/*` 里还有
`port-020/021/022/023` 等历史快照可对照。

## 三、逐个迁移剩下的本地功能

现有 9 项里地灵和 #30 已完成。剩下的按迁移成本从低到高：

| 功能 | 形态 | 预期成本 |
|---|---|---|
| #21 七名联动 | 7 个新 kit + `kits/index.js` 一处 + 构建脚本 | 低（几乎全是新增文件） |
| #33 SW 资源包 | 8 个新文件 + `main.js` 一处注册 | 低 |
| 联防视角 | `render/app/view.js` 单 hunk | 低 |
| #28 首战预热 | 新文件 + `main.js::boot()` 两处 | 低 |
| #24 开发者模式 | 新文件 + extras 管道数处，且在旧 0.2.0 基线上 | 中（要先重放到新线） |
| #16 策略/道具进度 | 新文件 + 3 处挂载 | 中 |
| lastLineup | 3 个服务端插入点 | 中 |
| i18n 本地内容 | 4 个 JSON，上游高频改动 | 中（改用 json-merge 后可根治） |

每个功能的迁移流程：

```bash
# 1. 照常实现、照常提交（现在这样最顺手）
git commit -m "..."

# 2. 自动生成补丁声明
node tools/mod.mjs capture <id> --from=<实现前的sha>

# 3. 处理 _review 标记（锚点在文件里出现多次，需要换一行更特别的）
grep -h "_review" mods/<id>/patches/*.json

# 4. 在纯上游基线上验证能完整重放
node tools/mod.mjs revert --all && node tools/mod.mjs apply <id> --force
node tools/mod.mjs check --verbose          # 必须 0 drifted
node --test test/<该功能的测试>

# 5. 回退原提交，之后由 mod 接管
git reset --hard <实现前的sha>
```

第 4 步不能省。capture 只保证"生成了补丁"，不保证"补丁能在别的版本上重放"。

### 多个 mod 改同一个文件

联防视角、开发者模式、lastLineup 都会落进 `server/lobby.js`、`main.js` 这类集中文件，共用是
常态，不用为了避开而拆分：

- revert 一个 mod 会把文件整份交回上游，随后**自动把其他仍在应用的 mod 在该文件上的补丁重放
  一遍**，并在输出里点名（`shared with another mod, replayed for it: …`）。重放失败会报
  `could not replay …` 并以非零退出，不会悄悄丢东西。
- 两个 mod 用同一个锚点也成立：按 mod id 排序堆叠，`apply` 重复执行不会插两遍。
- 只有当一个 mod 依赖另一个 mod **先落地**（开发者模式要用房主的 `room.setExtras`），才在
  `mod.json` 里写 `"dependsOn": ["earthspirit"]`——apply 正向、revert 逆向。

## 四、以后的上游升级

```bash
node tools/mod.mjs doctor                   # 有没有文件在应用后被改过
node tools/mod.mjs revert --all             # 工作树回到纯上游
git pull origin master                      # 快进，零冲突
node tools/mod.mjs status                   # 谁退役了
node tools/mod.mjs check --verbose          # 谁漂移了
node tools/mod.mjs apply --all
node --test test/…
```

框架本身不需要跟着更新——它由上游不存在的文件组成。要更新的只有 mod 里的补丁，而且只更新
`check` 报出来的那几条。

## 五、实测：跨版本重放能力

地灵的 56 条补丁是针对 v0.2.3 写的。在 v0.2.4 上重放：

- **56/56 命中，0 漂移**
- 功能测试 11/11 通过
- `coop-pool-x2` 自动识别为「上游 0.2.4 已原生收编」并跳过，删掉它之后地灵测试照样 11/11
  （因为上游原生 `poolCopiesCoopScale` 提供了 ×2）

这说明：上游的小版本演进基本不会打断补丁；真正需要人介入的，是上游重写了某个文件的结构。
那时候 `check` 会精确点名是哪条补丁的哪个锚点，并打印它周围现在的内容。

### 共享文件的隔离实测

用一个和地灵共用 `server/lobby.js`、且共用同一个锚点的探针 mod 验证：

| 步骤 | 结果 |
|---|---|
| `apply --all` | 地灵 56/56、探针 1/1，0 漂移 |
| `apply --force`（重放） | 56 + 1 全部判为 already in place，标记数不变（无重复插入） |
| `revert 探针` | 探针标记 0；地灵的 extras 字段、setExtras、dispatch 全部保住，并打印重放 |
| `revert 地灵` | 工作树 `[clean]`，只剩 mod 目录本身 |
| 测试 | 两个 mod 同时应用时地灵 11/11 通过 |
