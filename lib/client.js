/**
 * DSH Web GUI 客户端插件：在输入卡底部的工具行（conversation.input.right 槽位）
 * 显示当前处于高峰还是空闲时段，并给出距下次切换的倒计时。
 *
 * 本文件是打包产物，必须遵守浏览器的 __ModuleLoader__ 契约：
 * window.__ModuleLoader__.load({ id, factory }) —— id 必须与 npm 包名一致，
 * factory 接收 `require` 并返回模块 exports；缺失 load() 调用会被宿主报成
 * "loaded without registering"。
 *
 * 设计取向是「只做一件事」：零第三方依赖，只 require react；不读宿主状态、
 * 不发请求，全部判断都来自浏览器本地时钟按 UTC+8 的换算。
 */
window.__ModuleLoader__.load({
  id: 'dsh-price-phase',
  factory: (require) => {
    const react = require('react')

    // 纯逻辑与组件分开：lib/price-phase.js 可在 Node 下直接单测，
    // 这里只做 DOM 与槽位接线。
    const { describePhase } = require('dsh-price-phase/price-phase')

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
