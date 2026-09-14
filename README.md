# dsh-price-phase

[English](./README.en.md) | 中文

**DSH Web GUI 的 DeepSeek 峰谷时段徽标**：在输入卡底部的工具行居中显示当前处于**高峰**还是**空闲**时段，并给出距下次切换的倒计时。

> 依据 DeepSeek 官方分时定价：**高峰时段为北京时间周一至周五 09:00–12:00、14:00–18:00**，其余时间（含**周六、周日全天**）为空闲时段，空闲价格为高峰价格的一半（5 折）。

![DSH Web GUI 输入卡底部工具行居中的时段徽标，截图时显示「非高峰时段」](./docs/badge-off-peak.png)

---

## 这个插件不做什么

同时段指示器已经有几个实现，本插件的取向是**只做一件事**，因此刻意省略：

- 不做多时区转换（官方规则以北京时间为准，直接按 UTC+8 换算最不容易出错）
- 不做 24 小时时段轴、价格对照表、详情弹窗
- 不做点击交互、不读宿主状态、不发任何网络请求
- **零第三方依赖**，只 `require('react')`

全部判断来自浏览器本地时钟的 UTC+8 换算，因此离线可用、无延迟、也不会因为接口失败而显示错误状态。

## 功能

| 能力 | 说明 |
|---|---|
| 实时时段 | 高峰 / 空闲，每 30 秒随系统时钟重算 |
| 倒计时 | 距下次**状态真正翻转**的时刻，格式 `2h13m` / `45m` / `38s` |
| 悬停详情 | 当前北京时间（含星期）、前后时段、下一次切换说明 |
| 窄屏适配 | 手机端自动改为行内短标签并省掉圆点，避免压住模型 chip |
| 准确的跨周末倒计时 | 周五 18:00 之后指向**下周一 09:00**，而不是周六 09:00 |

## 安装

```sh
dsh plugin --profile web add dsh-price-phase
```

重启 DSH 后，输入卡底部工具行中央就会出现时段徽标。

`dsh plugin add` 会读取本包 `package.json` 里的 `dsh.bundle.patch`，**自动**把插件插进配置树，不需要手工编辑 `cordis.patch.yml`。下面是它替你做的事，仅供排查时参考：

```yaml
- insert:
    - id: dsh-price-phase
      name: 'dsh-price-phase'
```

也可以用 npm 直接装（例如自建 profile 或离线分发），但要自己补上面那条 insert：

```sh
npm install dsh-price-phase
```

## 开发

```sh
npm run build:bundle   # 由 lib/price-phase.js 重新生成 bundle 的内联段
npm run check          # 语法预检 + 校验内联段与源文件一致
npm test               # 23 项测试：纯逻辑 + bundle 契约
npm run verify         # 以上全部
```

`lib/client.js` 里的判定逻辑不是手写的，而是由 `scripts/inline-price-phase.mjs` 从 `lib/price-phase.js` **构建期内联**进去的。原因是 DSH 的 bundle 解析器只认平台 seed 字面量与已注册的包 id，`require` 自身子路径必定失败；而逻辑又不能直接手写在 bundle 里，否则无法在 Node 下单测。改动 `lib/price-phase.js` 后需重跑 `build:bundle`。

测试分两层：

- `test/price-phase.test.js` —— 分时判定、跨日与跨周末边界、倒计时落点。时间戳按 `Date.UTC(y, m, d, H-8, M)` 构造（北京 = UTC+8），期望值照官方脚注逐条翻译，不是从实现里反抄的。
- `test/client-contract.test.js` —— 在 `node:vm` 里造一个最小浏览器环境，真正执行 `lib/client.js`，验证 id 与包名一致、**只请求平台 seed 字面量**、**不请求自身子路径**、内联符号齐全、槽位注册正确、样式注入幂等。

  这一层是必需的：bundle 的打包错误在宿主侧只表现为「loaded without registering」或浏览器控制台里一句 `missed the module table`，`node --check` 这类语法检查**完全抓不到**。本插件第一版就因为在 bundle 里 `require` 自身子路径而带着这个 bug 发布过，正是这条测试补上了它。

## 已知边界

- **时段以北京时间为准**：官方规则写死了北京时间，海外用户看到的是北京时间所对应的时段，这是刻意的——按本地时区换算反而会算错。
- **不处理价格数值**：只提示时段，不显示单价。单价会变，硬编码在客户端早晚会过期。
- **只注册 `conversation.input.right` 槽位**：该槽位是 `kind: list`，可以与其他插件共存，靠 `order: 90` 排序。
- 依赖 DSH 0.1.5 的客户端槽位契约；更早版本未验证。

## 许可

MIT
