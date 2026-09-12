/**
 * 分时定价判定测试。
 *
 * 期望值不是从实现里抄的，而是照官方定价页脚注逐条翻译：
 *   api-docs.deepseek.com/zh-cn/quick_start/pricing
 *   「空闲时段价格为高峰时段价格的一半。高峰时段为北京时间周一至周五
 *     9:00 - 12:00、14:00 - 18:00（其余为空闲时段）。」
 *
 * 时间戳构造约定：北京 = UTC+8，所以北京 H:M 对应 `Date.UTC(..., H-8, M)`。
 * 2026 年 9 月的日历基准：9/7 周一、9/11 周五、9/12 周六、9/13 周日。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PEAK_WEEKDAYS,
  PEAK_WINDOWS_MIN,
  beijingClock,
  describePhase,
  formatCountdown,
  msUntilNextChange,
  pricePhase,
} from '../lib/price-phase.js'

const bj = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 8, mi)

test('工作日窗口边界：09:00 与 14:00 开始计高峰，12:00 与 18:00 结束', () => {
  const cases = [
    [bj(2026, 9, 7, 8, 59), 'offpeak'],
    [bj(2026, 9, 7, 9, 0), 'peak'],
    [bj(2026, 9, 7, 11, 59), 'peak'],
    [bj(2026, 9, 7, 12, 0), 'offpeak'],
    [bj(2026, 9, 7, 13, 59), 'offpeak'],
    [bj(2026, 9, 7, 14, 0), 'peak'],
    [bj(2026, 9, 7, 17, 59), 'peak'],
    [bj(2026, 9, 7, 18, 0), 'offpeak'],
    [bj(2026, 9, 7, 23, 59), 'offpeak'],
  ]
  for (const [ts, expected] of cases) {
    const { hours, minutes } = beijingClock(ts)
    assert.equal(
      pricePhase(ts),
      expected,
      `北京 ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} 应为 ${expected}`,
    )
  }
})

test('周一至周五的窗口内均为高峰', () => {
  const weekdays = [
    [2026, 9, 7],
    [2026, 9, 8],
    [2026, 9, 9],
    [2026, 9, 10],
    [2026, 9, 11],
  ]
  for (const [y, mo, d] of weekdays) {
    assert.equal(pricePhase(bj(y, mo, d, 10, 0)), 'peak', `${mo}/${d} 10:00 应为高峰`)
    assert.equal(pricePhase(bj(y, mo, d, 15, 0)), 'peak', `${mo}/${d} 15:00 应为高峰`)
  }
})

test('回归：周末全天为空闲，窗口内也不例外', () => {
  // 这是本插件第一版漏掉的规则——只比时分、不判星期，会把周六日的
  // 09:00-12:00 与 14:00-18:00 各 3 小时误报成高峰。
  for (const [y, mo, d, label] of [
    [2026, 9, 12, '周六'],
    [2026, 9, 13, '周日'],
  ]) {
    for (const hour of [0, 9, 10, 12, 14, 15, 18, 23]) {
      assert.equal(
        pricePhase(bj(y, mo, d, hour, 0)),
        'offpeak',
        `${label} ${hour}:00 应为空闲（周末无高峰）`,
      )
    }
  }
})

test('跨日边界按北京日期判定，不受 UTC 日期影响', () => {
  // 北京周一 00:30 = UTC 周日 16:30：必须算周一而非周日。
  assert.equal(beijingClock(bj(2026, 9, 7, 0, 30)).weekday, 1)
  assert.equal(pricePhase(bj(2026, 9, 7, 0, 30)), 'offpeak')
  // 北京周一 09:30 落在窗口内。
  assert.equal(pricePhase(bj(2026, 9, 7, 9, 30)), 'peak')
  // 北京周六 00:30 = UTC 周五 16:30：必须算周六而非周五。
  assert.equal(beijingClock(bj(2026, 9, 12, 0, 30)).weekday, 6)
  assert.equal(pricePhase(bj(2026, 9, 12, 0, 30)), 'offpeak')
})

test('accepts a Date instance as well as a timestamp', () => {
  const ts = bj(2026, 9, 7, 10, 0)
  assert.equal(pricePhase(new Date(ts)), 'peak')
  assert.equal(pricePhase(ts), pricePhase(new Date(ts)))
})

test('常量与官方规则一致', () => {
  assert.deepEqual(PEAK_WINDOWS_MIN, [
    [540, 720],
    [840, 1080],
  ])
  assert.deepEqual(PEAK_WEEKDAYS, [1, 2, 3, 4, 5])
})

test('倒计时：工作日窗口内指向窗口结束', () => {
  assert.equal(msUntilNextChange(bj(2026, 9, 7, 9, 0)), 3 * 3600 * 1000)
  assert.equal(msUntilNextChange(bj(2026, 9, 7, 11, 30)), 30 * 60 * 1000)
  assert.equal(msUntilNextChange(bj(2026, 9, 7, 14, 0)), 4 * 3600 * 1000)
})

test('倒计时：午休间隙指向下午窗口开始', () => {
  assert.equal(msUntilNextChange(bj(2026, 9, 7, 12, 0)), 2 * 3600 * 1000)
})

test('倒计时：周五收盘后指向下周一开盘，跨过整个周末', () => {
  // 周五 18:00 收市后，下一个真正翻转状态的点是下周一 09:00；
  // 周末的窗口边界不是切换点，不能指向它们。
  // 周五 18:00 -> 周一 09:00 = 2 天 + 15 小时 = 63 小时。
  assert.equal(msUntilNextChange(bj(2026, 9, 11, 18, 0)), 63 * 3600 * 1000)
  // 周六任意时刻同样指向下周一 09:00：周六 09:00 -> 周一 09:00 = 48 小时。
  assert.equal(msUntilNextChange(bj(2026, 9, 12, 9, 0)), 48 * 3600 * 1000)
  // 周日 23:00 -> 周一 09:00 = 10 小时。
  assert.equal(msUntilNextChange(bj(2026, 9, 13, 23, 0)), 10 * 3600 * 1000)
})

test('倒计时恒为正，且不超过跨周末的最长等待', () => {
  // 逐 7 分钟扫过连续 9 天，覆盖所有窗口边界与周末。
  const start = bj(2026, 9, 7, 0, 0)
  const nineDays = 9 * 24 * 60 * 60 * 1000
  const longest = 63 * 3600 * 1000
  for (let t = start; t < start + nineDays; t += 7 * 60 * 1000) {
    const ms = msUntilNextChange(t)
    assert.ok(ms > 0, `倒计时应为正：${new Date(t).toISOString()}`)
    assert.ok(ms <= longest, `倒计时不应超过 63h：${new Date(t).toISOString()} 得到 ${ms}`)
  }
})

test('倒计时落点确实翻转时段状态', () => {
  const start = bj(2026, 9, 7, 0, 0)
  const nineDays = 9 * 24 * 60 * 60 * 1000
  for (let t = start; t < start + nineDays; t += 13 * 60 * 1000) {
    const ms = msUntilNextChange(t)
    // 倒计时归零的瞬间状态必须已经翻转；而它前一毫秒仍是原状态。
    assert.notEqual(pricePhase(t + ms), pricePhase(t), `切换点未翻转：${new Date(t).toISOString()}`)
    assert.equal(pricePhase(t + ms - 1), pricePhase(t), `切换点提前翻转：${new Date(t).toISOString()}`)
  }
})

test('倒计时文本格式', () => {
  assert.equal(formatCountdown(38 * 1000), '38s')
  assert.equal(formatCountdown(45 * 60 * 1000), '45m')
  assert.equal(formatCountdown((2 * 3600 + 13 * 60) * 1000), '2h13m')
  assert.equal(formatCountdown(0), '0s')
  assert.equal(formatCountdown(-5000), '0s')
})

test('describePhase 输出标签、颜色与倒计时', () => {
  const peak = describePhase(bj(2026, 9, 7, 10, 0))
  assert.equal(peak.peak, true)
  assert.equal(peak.label, '高峰时段')
  assert.equal(peak.compactLabel, '高峰')
  assert.match(peak.title, /周一至周五/)
  assert.match(peak.title, /标准价格/)

  const offpeak = describePhase(bj(2026, 9, 12, 10, 0))
  assert.equal(offpeak.peak, false)
  assert.equal(offpeak.label, '非高峰时段')
  assert.equal(offpeak.compactLabel, '非高峰')
  assert.match(offpeak.title, /半价|5 折/)
  assert.match(offpeak.title, /周末全天为非高峰/)

  assert.notEqual(peak.color, offpeak.color)
})
