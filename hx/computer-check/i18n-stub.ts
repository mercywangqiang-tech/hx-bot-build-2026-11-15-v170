// 只给打进公开仓库的检查程序用：把 @hxbot/i18n 换成这一行。界面文字表有 1 千多万字节，还写着服务器的
// 地址，不能、也不必放进公开的检查程序；检查只看键名和参数。
export function sourceText(key: string, params?: Readonly<Record<string, string | number>>): string {
  return params ? `${key} ${JSON.stringify(params)}` : key;
}
