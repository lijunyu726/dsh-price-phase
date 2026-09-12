# AGENTS.md

面向在本仓库工作的智能体与协作者的约束。**先读这份，再改代码。**

## 仓库定位

`dsh-price-phase` 是一个 **DSH（DeepSeek Harness）客户端插件**，发布到 npm，通过 DSH 的 profile 补丁层加载。它不是独立应用，也没有自己的运行时——脱离 DSH 宿主无法运行。

- 本仓库是**独立公开 Git 仓库**（`lijunyu726/dsh-price-phase`），不隶属于 DSH 大仓，也不消费其内部源码。
- 上游权威是 DSH 的**客户端槽位契约**。改槽位、改 bundle 形态前，必须先在已安装的 DSH 里核实契约，不要照抄本仓库的假设。

## 目录规范

| 路径 | 职责 |
|---|---|
| `lib/price-phase.js` | 纯逻辑：分时判定、北京时间换算、倒计时。**无 DOM、无 react、无副作用**，可在 Node 下直接单测 |
| `lib/client.js` | 浏览器半边。**打包产物形态**，手工维护，必须保持 `window.__ModuleLoader__.load({ id, factory })` 结构 |
| `lib/index.js` | 宿主半边。本插件宿主侧无功能，仅作为可加载的空插件存在 |
| `test/` | 两层测试，见下 |
| `cordis.patch.yml` | 供 DSH profile 补丁层引用的加载条目 |

## 硬约束

1. **`lib/client.js` 不是一个普通 ES 模块。** 它由宿主当普通脚本加载，必须自行调用 `window.__ModuleLoader__.load(...)`。漏掉这个调用，宿主报的是 `loaded without registering`，而**不会**抛语法错误——很容易误判成「加载成功但没效果」。
2. **`__ModuleLoader__.load` 的 `id` 必须与 `package.json` 的 `name` 逐字一致。**
3. **bundle 里 `require` 的每个模块都必须能被宿主解析。** 本包只允许 `react` 与 `dsh-price-phase/*`；后者走 `package.json` 的 `exports` 映射。新增跨包依赖前先确认宿主环境里存在该包。
4. **不要把判定逻辑写进 `lib/client.js`。** 纯逻辑一律放 `lib/price-phase.js`，bundle 只做 DOM 与槽位接线。bundle 里的代码在 Node 下跑不了，写进去就无法测试。
5. **不要引入第三方运行时依赖。** 本插件的卖点之一是零依赖、离线可用。任何新增依赖都视为破坏性变更，需在 README 中说明理由。
6. **不要把价格数值硬编码进代码。** 只提示时段。单价会变，硬编码必然过期。
7. **北京时间（UTC+8）是规则的一部分，不是实现细节。** 不要改成读本地时区——海外用户会算错。UTC+8 无夏令时，直接对时间戳做 +8h 位移读 UTC 字段即可。

## 验证方式

改任何逻辑后必须跑：

```sh
npm run verify   # = npm run check && npm test
```

- `npm run check`：三个入口文件的 `node --check` 语法预检。
- `npm test`：21 项测试，两层。
  - **纯逻辑层**：分时判定、跨日边界、跨周末倒计时。时间戳用 `Date.UTC(y, m, d, H-8, M)` 构造。
  - **bundle 契约层**：在 `node:vm` 里造最小浏览器环境真正执行 `lib/client.js`，检查 id 一致、依赖已声明、槽位注册正确、样式注入幂等。

两条要求：

- **期望值必须来自官方定价页脚注，不能从实现里反抄。** 从实现反抄等于把 bug 固化成期望。
- **新增边界行为时，同时加一条「落点确实翻转状态」这类不变量测试。** 本仓库已有两条这样的测试抓出过真 bug（周末误报、午夜假切换点），它们是这套测试里最有价值的部分。

发布前：`npm run verify` 必须全绿，且 `npm pack --dry-run` 的文件清单符合预期。

## 安全边界

- 本插件**不接触 API Key、不发网络请求、不读宿主状态**。任何引入这些行为的改动都是架构级变更，需先在设计上说明理由。
- 不要为了调试而把凭据、token 或用户数据写进仓库。`.gitignore` 已排除 `.env` 与 `*.tgz`；凭据类信息一律不入库。
- 发布到 npm 是不可逆的（同版本号不能覆盖）。发版前确认版本号已递增。

## 回退方法

本插件是**纯增量**的：它只往 `conversation.input.right` 槽位注册一个组件，不改动 DSH 的任何既有行为。

回退只需从 profile 补丁层移除那条 `insert` 条目并重新加载。仓库侧的改动用 `git revert`；npm 侧已发布版本无法撤回，只能发新版本 `deprecate` 或修正。
