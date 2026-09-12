/**
 * 浏览器半边（lib/client.js）的契约测试。
 *
 * 目的不是复测分时逻辑（那在 price-phase.test.js 里），而是抓打包错误：
 * 宿主把客户端半边当普通脚本加载，缺 `__ModuleLoader__.load()` 调用、id 与
 * 包名不一致、require 了不存在的模块，都会被报成 "loaded without registering"
 * 或加载静默失败——这类问题只有真正执行一遍 bundle 才会暴露。
 *
 * 做法是在 `node:vm` 里造一个最小浏览器环境，用假的 `react` 与宿主 require
 * 把 factory 跑起来，再对真实组件做一次渲染。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const bundle = readFileSync(path.join(root, 'lib/client.js'), 'utf8')

/** 假的 react：记录 createElement 调用即可，不需要真实渲染。 */
function fakeReact() {
  const calls = []
  return {
    calls,
    react: {
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect: (fn) => {
        fn()
      },
      createElement: (...args) => {
        calls.push(args)
        return { type: args[0], props: args[1] ?? {}, children: args.slice(2) }
      },
    },
  }
}

/** 最小 DOM / window 替身，只覆盖 bundle 实际用到的 API。 */
function fakeDom() {
  const headChildren = []
  const listeners = new Map()
  const mediaQuery = {
    matches: false,
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  }
  const document = {
    head: {
      appendChild: (el) => {
        headChildren.push(el)
      },
    },
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
  }
  const window = {
    matchMedia: () => mediaQuery,
    setInterval: () => 1,
    clearInterval: () => {},
  }
  return { document, window, headChildren, mediaQuery, listeners }
}

/**
 * 在沙箱里加载 bundle，返回模块 exports、DOM 替身与模块加载记录。
 * @returns 一次加载的全部可观测结果。
 */
/**
 * 模拟宿主 bundle 解析器（dsh-client-modules/lib/client.js:296-310）：
 * 只有平台 seed 字面量、已物化的包、已注册的 factory 三條路，其余一律抛错。
 *
 * 这里**刻意不给本包子路径开后门**——早先的版本为了让
 * `require('dsh-price-phase/price-phase')` 通过而在测试里注入 Node 版解析，
 * 结果把「bundle 在真实浏览器里必然抛 missed the module table」这个 bug
 * 掩盖了整个发布周期。测试必须比真实环境更严格，不能更宽松。
 */
const PLATFORM_SEEDS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'dsh-client-store',
  'dsh-client-ui-slots',
  'dsh-client-ui-primitives',
  'dsh-client-ui-dockkit',
]

function loadBundle() {
  const { calls, react } = fakeReact()
  const dom = fakeDom()
  const loaded = []
  const required = []
  const hostRequire = (id) => {
    required.push(id)
    if (id === 'react') return react
    if (PLATFORM_SEEDS.includes(id)) return {}
    // 复刻宿主的真实报错形状，让契约违反一眼可辨。
    throw new Error(
      `client-modules: require("${id}") missed the module table — ` +
        'not a platform seed word, not a materialized module, and no registered package factory',
    )
  }
  const sandbox = {
    window: Object.assign(dom.window, {
      __ModuleLoader__: {
        load: (definition) => {
          loaded.push(definition)
        },
      },
    }),
    document: dom.document,
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(bundle, sandbox, { filename: 'lib/client.js' })
  return { loaded, required, calls, dom, sandbox, hostRequire }
}

/** 取出 factory 并执行，返回模块 exports，同时要求必须用到宿主 require。 */
function loadModule(harness) {
  return harness.loaded[0].factory(harness.hostRequire)
}

test('bundle 恰好调用一次 __ModuleLoader__.load', () => {
  const { loaded } = loadBundle()
  assert.equal(loaded.length, 1, '必须且只能注册一个模块')
})

test('注册的 id 与 package.json 的包名一致', () => {
  const { loaded } = loadBundle()
  assert.equal(loaded[0].id, pkg.name)
})

test('factory 返回 apply / inject，且 inject 声明 slots 服务', () => {
  const harness = loadBundle()
  const module = loadModule(harness)
  assert.equal(typeof module.apply, 'function')
  // bundle 在 vm 沙箱里执行，其数组与测试 realm 的原型不同，
  // deepStrictEqual 会因引用不同而失败；这里只关心元素与顺序。
  assert.deepEqual([...module.inject], ['slots'])
  assert.equal(module.name, pkg.name)
})

test('bundle 自包含：运行时只请求平台 seed 字面量', () => {
  const harness = loadBundle()
  loadModule(harness)
  const { required } = harness
  assert.ok(required.length > 0, 'factory 应当至少 require 了 react')
  for (const id of required) {
    assert.ok(
      PLATFORM_SEEDS.includes(id),
      `bundle 请求了非 seed 模块 "${id}"；宿主解析器只认平台 seed 与已注册的包 id，` +
        '自身子路径（如 dsh-price-phase/price-phase）必然抛 missed the module table',
    )
  }
})

test('bundle 不请求本包的任何子路径（回归：曾用 require 引自身子路径）', () => {
  const harness = loadBundle()
  loadModule(harness)
  const offenders = harness.required.filter((id) => id.startsWith(`${pkg.name}/`))
  assert.deepEqual(
    offenders,
    [],
    `bundle 不得 require 自身子路径：${offenders.join(', ')}。` +
      '该子路径在浏览器里永远无法解析，逻辑应由 scripts/inline-price-phase.mjs 内联。',
  )
})

test('内联段确实包含全部核心逻辑', () => {
  // 逻辑被内联进 bundle 后，若源文件新增导出却忘了重新生成，这里会失败。
  for (const symbol of ['PEAK_WINDOWS_MIN', 'PEAK_WEEKDAYS', 'pricePhase', 'beijingClock', 'msUntilNextChange', 'describePhase', 'formatCountdown']) {
    assert.ok(bundle.includes(symbol), `bundle 缺少内联符号 ${symbol}，请运行 npm run build:bundle`)
  }
})

test('dsh.client.inject 只声明官方槽位服务', () => {
  assert.deepEqual(pkg.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-slots'])
  assert.equal(pkg.dsh.client.platform, 'web')
})

test('apply 把徽标注册进 conversation.input.right，并支持重复注册', () => {
  const harness = loadBundle()
  const registrations = []
  const injections = []
  const module = loadModule(harness)
  const ctx = {
    slots: {
      inject: (name, fn) => {
        injections.push(name)
        fn()
      },
      register: (options, component) => {
        registrations.push({ options, component })
      },
    },
  }
  module.apply(ctx)
  assert.deepEqual(injections, ['conversation.input.right'])
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].options.name, 'conversation.input.right')
  assert.equal(registrations[0].options.id, 'price-phase')
  // 槽位是 kind:list，多个插件共存靠 order 排序。
  assert.equal(typeof registrations[0].options.order, 'number')
  assert.equal(typeof registrations[0].component, 'function')
})

test('组件渲染出状态文本，并把样式注入 head', () => {
  const harness = loadBundle()
  const module = loadModule(harness)
  const { calls, dom } = harness
  const registrations = []
  module.apply({
    slots: {
      inject: (_name, fn) => fn(),
      register: (options, component) => registrations.push(component),
    },
  })
  const Badge = registrations[0]
  const tree = Badge()

  // 渲染结果里应包含标签文本与倒计时。
  const texts = calls
    .map((args) => args.slice(2).flat(Infinity))
    .flat()
    .filter((v) => typeof v === 'string')
  assert.ok(
    texts.some((t) => t === '高峰时段' || t === '非高峰时段'),
    `未渲染出时段标签，实际文本：${JSON.stringify(texts)}`,
  )
  assert.ok(
    texts.some((t) => /^(\d+h\d{2}m|\d+m|\d+s)$/.test(t)),
    `未渲染出倒计时，实际文本：${JSON.stringify(texts)}`,
  )
  assert.ok(tree.props.title.length > 0, '应带悬停说明')
  assert.equal(dom.headChildren.length, 1, '样式表应注入一次')
  assert.match(dom.headChildren[0].textContent, /uV2eYG_row/)
})

test('样式表重复注入被幂等拦截', () => {
  const harness = loadBundle()
  const { dom } = harness
  // 第二次调用时 getElementById 应已能查到元素：这里改为模拟已存在。
  const existing = new Set()
  dom.document.getElementById = (id) => (existing.has(id) ? { id } : null)
  const originalAppend = dom.document.head.appendChild
  dom.document.head.appendChild = (el) => {
    existing.add(el.id)
    originalAppend(el)
  }
  const module = loadModule(harness)
  const registrations = []
  module.apply({
    slots: {
      inject: (_name, fn) => fn(),
      register: (_options, component) => registrations.push(component),
    },
  })
  registrations[0]()
  registrations[0]()
  assert.equal(dom.headChildren.length, 1, '样式只应注入一次')
})
