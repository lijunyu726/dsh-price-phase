/**
 * 宿主端（Node）半边：本插件不注册任何宿主服务、工具或 RPC，全部工作都在
 * 浏览器半边（lib/client.js）完成。保留这个空插件是为了让包同时具备双面
 * 形态——DSH 的包清单会按 `dsh.client.platform` 查找客户端半边，宿主半边
 * 缺失会让加载器报解析失败。
 */

export const name = 'dsh-price-phase'

/** 宿主侧无依赖。 */
export const inject = []

/**
 * 空实现：仅用于让宿主半边可被正常加载与卸载。
 */
export function apply() {}
