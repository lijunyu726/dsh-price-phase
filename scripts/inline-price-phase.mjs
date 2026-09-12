/**
 * 由 lib/price-phase.js 生成 lib/client.js 中的内联逻辑段。
 *
 * 为什么需要这一步：DSH 的浏览器 bundle 解析器（dsh-client-modules）只认
 * 三条路——平台 seed 字面量（react / react-dom / cordis / dsh-client-*）、
 * 已物化的包（以**包 id** 为键）、已注册的 factory（同样以包 id 为键）。
 *
 *   makeRequire(edges) {
 *     if (this.seed.has(spec)) return this.seed.get(spec)
 *     const id = stripClientSuffix(spec)
 *     const record = this.loadCache.get(id)
 *     if (record !== undefined) return record.exports
 *     if (this.factories.has(id)) return this.materialize(id).exports
 *     throw new Error(`client-modules: require("${spec}") missed the module table ...`)
 *   }
 *
 * 因此 `require('dsh-price-phase/price-phase')` 这类**自身子路径**必然抛错：
 * 子路径永远不会作为一个包 id 被注册。本仓库第一版就是这么写的，是个真 bug，
 * 只不过被测试里那个 Node 版 require 掩盖了。
 *
 * 结论：bundle 必须自包含，跨模块的 require 一个都不能有。但逻辑又不能直接
 * 手写在 bundle 里——bundle 在 Node 下无法执行，写进去就没法测。于是采用折中：
 * lib/price-phase.js 仍是唯一真源（可被 Node 直接单测），构建期把去掉 export
 * 关键字的同一份代码内联进 bundle 的标记区。
 *
 * 用法：
 *   node scripts/inline-price-phase.mjs           # 写入 lib/client.js
 *   node scripts/inline-price-phase.mjs --check   # 只校验，不写入（CI/发布前用）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(root, 'lib', 'price-phase.js')
const bundlePath = path.join(root, 'lib', 'client.js')

const BEGIN = '    // #region 内联自 lib/price-phase.js（由 scripts/inline-price-phase.mjs 生成，勿手改）'
const END = '    // #endregion 内联自 lib/price-phase.js'

/**
 * 把 ESM 源转成可内联的片段：去掉 `export ` 前缀，其余逐字保留。
 * @param source - lib/price-phase.js 的全文。
 * @returns 可直接嵌入 factory 函数体的代码。
 */
export function toInlineFragment(source) {
  const stripped = source.replace(/^export (const|function|class) /gm, '$1 ')
  // 防呆：转换后不应再残留任何 export，否则 bundle 会变成非法语法。
  const leftover = stripped.match(/^export /m)
  if (leftover !== null) {
    throw new Error('内联转换后仍残留 export 关键字，请检查 lib/price-phase.js 的导出写法')
  }
  return stripped
}

/**
 * 用当前 lib/price-phase.js 的内容重写 bundle 中的标记区。
 * @param bundle - lib/client.js 的全文。
 * @param fragment - 待内联的代码。
 * @returns 重写后的 bundle 全文。
 */
export function spliceBundle(bundle, fragment) {
  const begin = bundle.indexOf(BEGIN)
  const end = bundle.indexOf(END)
  if (begin === -1 || end === -1) {
    throw new Error('lib/client.js 缺少内联标记区，无法定位插入点')
  }
  if (end < begin) throw new Error('lib/client.js 的内联标记区顺序颠倒')
  const head = bundle.slice(0, begin + BEGIN.length)
  const tail = bundle.slice(end)
  // 片段本身以换行结尾，这里统一成 "标记行 + 片段 + 标记行" 的形状。
  return `${head}\n${fragment.replace(/\n+$/, '')}\n${tail}`
}

function main() {
  const checkOnly = process.argv.includes('--check')
  const source = readFileSync(sourcePath, 'utf8')
  const bundle = readFileSync(bundlePath, 'utf8')
  const fragment = toInlineFragment(source)
  const next = spliceBundle(bundle, fragment)

  if (checkOnly) {
    if (next !== bundle) {
      console.error('✗ lib/client.js 的内联段与 lib/price-phase.js 不一致')
      console.error('  运行 `npm run build:bundle` 重新生成。')
      process.exit(1)
    }
    console.log('✓ 内联段与 lib/price-phase.js 一致')
    return
  }

  if (next === bundle) {
    console.log('内联段已是最新，无需改动')
    return
  }
  writeFileSync(bundlePath, next)
  console.log('✓ 已更新 lib/client.js 的内联段')
}

// 作为脚本直接运行时才执行；被测试 import 时只取纯函数。
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
