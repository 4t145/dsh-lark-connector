/** 支持的飞书开放平台品牌：feishu（国内飞书）或 lark（Lark 国际版）。 */
export const BRANDS = ["feishu", "lark"] as const;

/** 飞书开放平台品牌，决定 lark-cli 使用的服务端点。 */
export type Brand = (typeof BRANDS)[number];

/** 默认品牌：国内飞书。 */
export const DEFAULT_BRAND: Brand = "feishu";
