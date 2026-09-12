/**
 * DSH Web GUI 客户端插件：在输入卡底部的工具行（conversation.input.right 槽位）
 * 显示当前处于高峰还是空闲时段，并给出距下次切换的倒计时。
 *
 * 本文件是打包产物，必须遵守浏览器的 __ModuleLoader__ 契约：
 * window.__ModuleLoader__.load({ id, factory }) —— id 必须与 npm 包名一致，
 * factory 接收 `require` 并返回模块 exports；缺失 load() 调用会被宿主报成
 * "loaded without registering"。
 *
 * 硬约束：**bundle 必须自包含。** DSH 的 bundle 解析器只认平台 seed 字面量
 * （react / react-dom / cordis / dsh-client-*）、已物化的包与已注册的 factory，
 * 后两者都以**包 id** 为键，因此 `require('dsh-price-phase/price-phase')` 这类
 * 自身子路径必然抛 "missed the module table"。本包的逻辑因此不通过 require
 * 引入，而是在构建期由 scripts/inline-price-phase.mjs 从 lib/price-phase.js
 * 内联进下面的标记区——真源仍是被 Node 直接单测的那一份。
 *
 * 设计取向是「只做一件事」：不读宿主状态、不发请求，全部判断都来自浏览器
 * 本地时钟按 UTC+8 的换算。
 */
window.__ModuleLoader__.load({
  id: 'dsh-price-phase',
  factory: (require) => {
    const react = require('react')

    // #region 内联自 lib/price-phase.js（由 scripts/inline-price-phase.mjs 生成，勿手改）
/**
 * DeepSeek 分时定价（峰谷价）判定 —— 纯逻辑，无 DOM、无框架依赖。
 *
 * 官方规则（api-docs.deepseek.com/zh-cn/quick_start/pricing 脚注 3）：
 *   高峰期   = 北京时间**周一至周五** 09:00–12:00、14:00–18:00
 *   空闲时段 = 其余全部时间（含周六、周日全天）
 *   空闲时段价格为高峰时段价格的一半（5 折）
 *
 * 北京时间固定为 UTC+8 且无夏令时，因此直接对时间戳做 +8h 位移后读 UTC
 * 字段即可，不依赖运行环境的本地时区，也不需要网络或宿主查询。
 */

/** 高峰时段窗口，单位：自当日 00:00 起的分钟数，左闭右开。 */
const PEAK_WINDOWS_MIN = [
  [9 * 60, 12 * 60],
  [14 * 60, 18 * 60],
]

/**
 * 高峰时段所属星期，取值同 `Date.prototype.getUTCDay()`：0=周日 … 6=周六。
 * 官方规则限定为周一至周五，漏掉这一条会让周末的 09:00–12:00 与
 * 14:00–18:00 各误报 3 小时。
 */
const PEAK_WEEKDAYS = [1, 2, 3, 4, 5]

/** 中文星期标签，索引同 `getUTCDay()`。 */
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const MINUTE_MS = 60 * 1000
const BEIJING_OFFSET_MS = 8 * 3600 * 1000

/**
 * 把一个时间戳换算为北京时间日历字段。
 * @param now - `Date.now()` 时间戳，或 `Date` 实例。
 * @returns 北京时间的时、分、星期，以及自当日 00:00 起的分钟数。
 */
function beijingClock(now) {
  const t = typeof now === 'number' ? now : now.getTime()
  const shifted = new Date(t + BEIJING_OFFSET_MS)
  const hours = shifted.getUTCHours()
  const minutes = shifted.getUTCMinutes()
  return {
    hours,
    minutes,
    weekday: shifted.getUTCDay(),
    dayMinutes: hours * 60 + minutes,
  }
}

/**
 * 判定某时刻处于高峰还是空闲时段。
 * @param now - `Date.now()` 时间戳，或 `Date` 实例。
 * @returns `'peak'` 或 `'offpeak'`。
 */
function pricePhase(now) {
  const { dayMinutes, weekday } = beijingClock(now)
  if (!PEAK_WEEKDAYS.includes(weekday)) return 'offpeak'
  const isPeak = PEAK_WINDOWS_MIN.some(([start, end]) => dayMinutes >= start && dayMinutes < end)
  return isPeak ? 'peak' : 'offpeak'
}

/**
 * 计算距下一次**时段状态切换**的剩余毫秒数。
 *
 * 注意这里找的是状态翻转点，而不是单纯的下一个时钟刻度：周末全天为空闲，
 * 因此周六 09:00 虽然是个窗口边界，状态却仍是空闲——把倒计时指向它，用户会
 * 看到倒计时归零而标签纹丝不动。真正的切换点要同时满足「落在窗口边界」和
 * 「该日属于高峰日」。
 *
 * 做法是扫描未来 8 天的每个窗口边界与跨日边界，对每个候选时刻比对它与其前
 * 一毫秒的时段，返回第一个真正翻转状态的时刻。按天扫描而非枚举本周剩余时间，
 * 是为了天然覆盖跨周情形：例如周五 18:00 之后，下一个切换点是下周一 09:00，
 * 中间隔着整个周末。
 *
 * @param now - `Date.now()` 时间戳，或 `Date` 实例。
 * @returns 剩余毫秒数（恒 > 0）；理论上不会返回 `null`，兜底为 1 分钟。
 */
function msUntilNextChange(now) {
  const t = typeof now === 'number' ? now : now.getTime()
  const { dayMinutes } = beijingClock(t)
  // 当前北京时间当天 00:00 对应的真实时间戳。
  const beijingMidnight = t - dayMinutes * MINUTE_MS

  const boundaries = [0]
  for (const [start, end] of PEAK_WINDOWS_MIN) boundaries.push(start, end)

  for (let day = 0; day <= 8; day += 1) {
    const dayStart = beijingMidnight + day * 24 * 60 * MINUTE_MS
    for (const boundary of boundaries) {
      const candidate = dayStart + boundary * MINUTE_MS
      if (candidate <= t) continue
      // 只认真正翻转状态的边界。窗口起点（09:00、14:00）进入高峰；窗口终点
      // （12:00、18:00）离开高峰。而 00:00 这类跨日边界两边都是空闲——尤其
      // 周一 00:00 距周五收盘只有 54 小时，若不过滤就会把跨周末的倒计时提前
      // 报到午夜，用户等到归零时状态却毫无变化。
      if (pricePhase(candidate) !== pricePhase(candidate - 1)) return candidate - t
    }
  }
  return MINUTE_MS
}

/**
 * 把剩余毫秒数格式化为紧凑倒计时文本。
 * @param ms - 剩余毫秒数。
 * @returns 形如 `2h13m`、`45m`、`38s` 的字符串。
 */
function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m`
  if (minutes > 0) return `${minutes}m`
  return `${seconds}s`
}

/** 高峰时段使用的强调色（与 DSH 主题的警告色一致）。 */
const PEAK_COLOR = '#D9A24A'
/** 空闲时段使用的强调色（与 DSH 主题的成功色一致）。 */
const OFFPEAK_COLOR = '#57C07C'

/**
 * 组装状态标签与悬停说明。抽成纯函数便于对文案做断言。
 * @param now - `Date.now()` 时间戳，或 `Date` 实例。
 * @returns 标签文本、颜色、悬停标题与倒计时文本。
 */
function describePhase(now) {
  const t = typeof now === 'number' ? now : now.getTime()
  const { hours, minutes, weekday } = beijingClock(t)
  const peak = pricePhase(t) === 'peak'
  const hh = String(hours).padStart(2, '0')
  const mm = String(minutes).padStart(2, '0')
  const clock = `北京 ${WEEKDAY_LABELS[weekday]} ${hh}:${mm}`
  const until = formatCountdown(msUntilNextChange(t))
  const window = '周一至周五 9:00–12:00 / 14:00–18:00'
  return {
    peak,
    color: peak ? PEAK_COLOR : OFFPEAK_COLOR,
    // 桌面端空间充足，用完整标签；手机端由调用方改用 compactLabel。
    label: peak ? '高峰时段' : '非高峰时段',
    compactLabel: peak ? '高峰' : '非高峰',
    countdown: until,
    title: peak
      ? `高峰时段（北京时间${window}）· 按标准价格计费；空闲时段为半价。${until} 后转为非高峰。当前 ${clock}。`
      : `非高峰时段 · 价格为高峰时段的一半（5 折）。高峰时段为北京时间${window}，周末全天为非高峰。${until} 后转为高峰。当前 ${clock}。`,
  }
}
    // #endregion 内联自 lib/price-phase.js

    const STYLE_ID = 'dsh-price-phase-css'
    const TICK_MS = 30 * 1000
    // 手机端窄屏与触摸设备：工具行同时容纳附件、模式、模型、上下文环与发送，
    // 居中的完整标签会压住模型 chip，因此改为行内普通 flex 项 + 短标签。
    const NARROW_QUERY = '(max-width: 760px), (pointer: coarse) and (max-width: 960px)'

    function installStyle() {
      if (document.getElementById(STYLE_ID) !== null) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = [
        // 宽屏：绝对定位在工具行正中，.uV2eYG_row 由本样式表补 position。
        '.uV2eYG_row { position: relative; }',
        '.dsh-price-phase { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); }',
        `@media ${NARROW_QUERY} {`,
        '  .dsh-price-phase { position: static; transform: none; margin-left: 4px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }',
        '}',
      ].join('\n')
      document.head.appendChild(style)
    }

    function PricePhaseBadge() {
      const [now, setNow] = react.useState(() => Date.now())
      const [narrow, setNarrow] = react.useState(() => window.matchMedia(NARROW_QUERY).matches)

      react.useEffect(() => {
        installStyle()
        const timer = window.setInterval(() => setNow(Date.now()), TICK_MS)
        const query = window.matchMedia(NARROW_QUERY)
        const onChange = () => setNarrow(query.matches)
        query.addEventListener('change', onChange)
        return () => {
          window.clearInterval(timer)
          query.removeEventListener('change', onChange)
        }
      }, [])

      const phase = describePhase(now)
      const text = narrow ? phase.compactLabel : phase.label

      return react.createElement(
        'span',
        {
          className: 'dsh-price-phase',
          title: phase.title,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            // 不拦截指针事件，悬停标题仍可触发，同时不挡住下层控件。
            pointerEvents: narrow ? 'none' : 'auto',
            color: phase.color,
            fontSize: '12px',
            fontWeight: 500,
            lineHeight: '20px',
            whiteSpace: 'nowrap',
            cursor: 'default',
            userSelect: 'none',
          },
        },
        // 手机端空间不足，靠文字颜色承担状态提示，省掉圆点。
        narrow
          ? null
          : react.createElement('span', {
              'aria-hidden': 'true',
              style: {
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: phase.color,
                flex: '0 0 auto',
              },
            }),
        text,
        narrow ? null : react.createElement(
          'span',
          { style: { opacity: 0.6, fontVariantNumeric: 'tabular-nums' } },
          phase.countdown,
        ),
      )
    }

    /** 本插件依赖的服务：UI 槽位注册表。 */
    const inject = ['slots']

    /**
     * 注册时段徽标。
     * @param ctx - 客户端根上下文。
     */
    function apply(ctx) {
      ctx.slots.inject('conversation.input.right', () => {
        ctx.slots.register(
          { name: 'conversation.input.right', id: 'price-phase', order: 90 },
          PricePhaseBadge,
        )
      })
    }

    return { apply, inject, name: 'dsh-price-phase' }
  },
})
