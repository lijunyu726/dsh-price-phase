# ARCHITECTURE.md

## 这个插件在 DSH 里的位置

DSH 的界面由**槽位（slot）**拼装：宿主渲染出命名好的插槽点位，插件往点位里注册组件。本插件占一个点位，不介入任何其他环节。

```
DSH Web GUI（浏览器）
├── @deepseek-ai/dsh-client-ui-conversation
│   └── 渲染 conversation.input.right 槽位（kind: list, scope: session）
│       └── dsh-price-phase 的 PricePhaseBadge  ← 本插件注册在这里
│           └── 只读浏览器本地时钟，不请求任何数据
└── （宿主 Node 进程）
    └── dsh-price-phase 的宿主半边：空插件，无服务、无 RPC
```

**没有数据流。** 这是刻意的设计选择：时段判定是纯函数，输入只有「当前时间戳」，输出只有「高峰/空闲」。不依赖宿主状态意味着没有加载时序问题、没有接口失败态、离线也能正确工作。

## 模块职责

### `lib/price-phase.js` —— 纯逻辑层

| 导出 | 职责 |
|---|---|
| `PEAK_WINDOWS_MIN` | 高峰窗口常量 `[[540,720],[840,1080]]`，单位是自当日 00:00 起的分钟数 |
| `PEAK_WEEKDAYS` | 高峰日 `[1,2,3,4,5]`，取值同 `Date.getUTCDay()`（0=周日） |
| `WEEKDAY_LABELS` | 中文星期标签，索引同 `getUTCDay()` |
| `beijingClock(now)` | 时间戳 → 北京时间的时、分、星期、当日分钟数 |
| `pricePhase(now)` | → `'peak'` \| `'offpeak'` |
| `msUntilNextChange(now)` | → 距下次**状态翻转**的毫秒数 |
| `formatCountdown(ms)` | → `2h13m` \| `45m` \| `38s` |
| `describePhase(now)` | → 组装好的标签、颜色、悬停说明（供渲染层直接消费） |

这一层**不 import 任何东西**，不碰 DOM、不碰 react，因此可以在 Node 下直接单测。所有可测的复杂度都集中在这里。

### `lib/client.js` —— 浏览器半边

只做三件事：

1. `installStyle()` 往 `document.head` 注入样式表（幂等，用 `id` 去重）
2. `PricePhaseBadge()` 组件：`useState` 持有当前时间戳，`useEffect` 起 30 秒定时器与窄屏媒体查询监听
3. `apply(ctx)` 把组件注册进槽位

判定、格式化、文案全部来自标记区里内联的 `lib/price-phase.js`。**这一层不含手写业务逻辑**，因为它无法在 Node 下测试。

### `scripts/inline-price-phase.mjs` —— 构建期内联

把 `lib/price-phase.js` 的代码（去掉 `export` 关键字）替换进 `lib/client.js` 的标记区：

```
    // #region 内联自 lib/price-phase.js（由 scripts/inline-price-phase.mjs 生成，勿手改）
    … 「const PEAK_WINDOWS_MIN = …」到「function describePhase(…) {…}」逐字内联 …
    // #endregion 内联自 lib/price-phase.js
```

为什么必须内联、而不能 `require` 进来——见下面「为什么 bundle 必须自包含」。

### `lib/index.js` —— 宿主半边

空插件。存在的原因是 DSH 的包清单按 `dsh.client.platform` 查找客户端半边，宿主半边缺失会让加载器解析失败。

## 关键设计决策

### 为什么 bundle 必须自包含（本仓库踩过的坑）

DSH 的浏览器 bundle 解析器（`@deepseek-ai/dsh-client-modules`）只有三条路：

```js
makeRequire(edges) {
  return (spec) => {
    if (this.seed.has(spec)) return this.seed.get(spec)        // 平台 seed 字面量
    const id = stripClientSuffix(spec)
    const record = this.loadCache.get(id)                       // 已物化的包，键 = 包 id
    if (record !== undefined) return record.exports
    if (this.factories.has(id)) return this.materialize(id).exports  // 已注册的 factory，键 = 包 id
    throw new Error(`client-modules: require("${spec}") missed the module table …`)
  }
}
```

`loadCache` 与 `factories` **都以包 id 为键**。因此 `require('dsh-price-phase/price-phase')` 这类**自身子路径**永远命中不了，在真实浏览器里必然抛错。

第一版正是这么写的，而且带病发布：

- `node --check` 只看语法，抓不到；
- 当时的契约测试为了让这条 require 通过，**在测试里注入了 Node 版解析当后门**，把 bug 掩盖了整个发布周期。

修法不是把逻辑手写进 bundle（那样就无法在 Node 下单测），而是**构建期内联**：`lib/price-phase.js` 仍是唯一真源，`scripts/inline-price-phase.mjs` 在构建时把同一份代码去掉 `export` 后写入标记区。测试也改成只放行平台 seed 字面量、并复刻宿主的报错形状。

**结论：测试必须比真实宿主更严格，绝不能为了「让它跑通」而放宽。**

### 为什么用 UTC+8 位移而不是本地时区

官方规则的措辞是**北京时间**，不是「用户当地时间」。北京时间固定 UTC+8 且无夏令时，所以：

```js
const shifted = new Date(t + 8 * 3600 * 1000)
shifted.getUTCHours()   // 就是北京时间的时
```

这样得到的判定与运行环境时区无关——同一个绝对时刻，在东京、伦敦、洛杉矶的机器上算出同一个结果。若改用 `getHours()`（本地时区），海外用户的判定会整体偏移，且在有夏令时的地区还会随季节变化。

### 倒计时找的是「状态翻转点」，不是「下一个时钟刻度」

这是实现中最容易写错的地方，本仓库的测试抓到过两次：

**错误一（漏判星期）**：只比时分不判星期，把周六日的窗口内也判成高峰。代价是**每个周末误报 6 小时**。

**错误二（午夜假切换点）**：把每个窗口边界和跨日边界都当成切换点。周五 18:00 收盘后，最近的边界是周六 09:00——但周六全天都是空闲，状态根本没变；更糟的是周一 00:00 也是个边界，倒计时会指向它。用户盯着倒计时归零，标签却纹丝不动。

正确做法是对每个候选边界比较它与其前一毫秒的时段：

```js
if (pricePhase(candidate) !== pricePhase(candidate - 1)) return candidate - t
```

只有真正翻转状态的边界才算切换点。这样周五 18:00 之后自然指向**下周一 09:00**（63 小时），跨过整个周末。

### 为什么按天扫描而不是枚举本周剩余时间

扫描未来 8 天的所有边界，天然覆盖跨周情形：周五收盘后的下一个切换点在下周一，中间隔着整个周末。枚举「本周剩余天数」则需要处理周日→周一的回绕，多一处易错逻辑。

最长的真实等待是 63 小时（周五 18:00 → 周一 09:00），8 天窗口有充足余量。

### 窄屏行为

工具行同时容纳附件、模式切换、模型 chip、上下文环与发送按钮。宽屏下徽标绝对定位在行的正中；窄屏（`max-width: 760px`）或触摸设备下改为行内普通 flex 项，并换成短标签（`高峰`/`非高峰`）、省掉圆点——由文字颜色承担状态提示。这样布局不会重叠，只是让本就可省略的模型标签变窄。

### 颜色取自 DSH 主题

`#D9A24A`（警告色）与 `#57C07C`（成功色）与 DSH 主题一致，避免自己发明色值导致在深色/浅色主题下不协调。

## 外部依赖

**运行时零依赖。** bundle 只 `require('react')`，由宿主提供（与所有官方客户端插件一致）。

`lib/client.js` 只 `require('react')`，由宿主提供（与所有官方客户端插件一致）。bundle 内不再有任何跨模块 require——判定逻辑由构建期内联进来（见上）。

`package.json` 的 `exports` 里保留 `./price-phase` 映射，是给**外部 Node 消费者**用的（例如想在宿主侧复用同一套判定）。仓库内的测试用的是相对路径导入（`../lib/price-phase.js`），因此这条映射**当前没有测试覆盖**——改动它不会让测试失败，这是已知的覆盖缺口。

## 已知边界与未实现

| 项 | 状态 |
|---|---|
| 多时区显示 | 未实现，且刻意不做（官方规则以北京时间为准） |
| 价格数值展示 | 未实现，刻意不做（单价会变，硬编码必然过期） |
| 24 小时时段轴 / 详情弹窗 | 未实现，刻意不做（本插件定位是「只做一件事」） |
| 点击交互 | 未实现，只有悬停说明 |
| 宿主侧服务 / RPC | 无。本插件不接触凭据、不发网络请求 |
| `exports["./price-phase"]` 的可用性 | 无测试覆盖（仓库内用相对路径导入）；外部消费者依赖它 |
| 上游解析器行为变更 | 内联方案不依赖解析器细节，比 require 子路径更耐久；但 `dsh-client-modules` 若改变 bundle 形态仍需复核 |
| DSH 版本兼容性 | 只验证过 0.1.5 的 `conversation.input.right` 契约 |
| 深浅色主题 | 复用 DSH 主题色值，未单独适配 |
