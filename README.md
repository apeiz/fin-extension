# Fall in Night（入夜）

让指定的网站常驻暗色。装一次，列表里的站点以后打开就是暗的，不用每次手动切。

项目进展与赞助入口都在爱发电：[afdian.com/a/fin-extention](https://afdian.com/a/fin-extention)。
每次版本更新做了什么、踩过哪些坑，记在 [DEVLOG.md](DEVLOG.md)。

## 为什么它不拖慢网页

让网页变暗有两条路：解析页面的样式表、把每个颜色重算一遍；或者不解析，直接套一层滤镜。

这里走后者。不读 `CSSStyleSheet`、不算颜色、不生成替换样式表，只插一条规则：

```css
html { filter: invert(.92) hue-rotate(180deg); }
```

剩下的交给浏览器合成器，所以首屏没有 JavaScript 在主线程上做样式分析。代价是彩色会略微褪色，灰阶的文字与边框是准的。

## 安装

**Microsoft Edge**：加载项商店已上架，直接打开
[Fall in Night](https://microsoftedge.microsoft.com/addons/detail/mlchkmkainlgkedcdojlfkcfogclilki) 安装，之后随商店自动更新。

**Chrome**：应用商店没有上，用下面的开发者模式安装，代码是同一份。

**开发者模式**：

1. 打开 `edge://extensions/`（Chrome 是 `chrome://extensions/`）
2. 打开右上角「开发者模式」
3. 点「加载已解压的扩展程序」，选择本仓库目录

安装时会提示「读取和更改您在所有网站上的数据」。扩展要在任意站点上注入样式，而站点列表由你随时增删，没法每加一个域名就重新授权一次。实际只在命中列表的站点上动手。

## 使用

- 工具栏图标：总开关 + 当前站点开关，改动立即生效，不用刷新
- 弹窗右下角进设置页，管理站点列表与显示方式

设置页里几项值得知道的：

| 项 | 说明 |
| --- | --- |
| 所有网站入夜 | 默认关闭。打开后全站变暗，白名单随之出现 |
| `*.example.com` | 覆盖该域与所有子域。默认三条规则都用通配，因为子域常承载 iframe |
| 精确域名优先 | 已有 `*.a.com` 时再加 `www.a.com`，可用于单独排除一个子域 |
| 图片 / 视频 / 画布保持原色 | 默认开。关掉后整页变负片 |
| 保留原本深色的区块 | 默认开。深色导航条反色后会变亮块，开启后恢复原状 |

## 免费额度

免费版保存 5 个站点、3 条白名单。到上限不删已有条目，只是不能新增。

需要更多时赞助 ¥6 一次性换一个授权码，激活后不再限制数量。收款方是开发者，不是 Microsoft。

授权码在发码流程上走爱发电的订单系统，`tools/afdian.js` 用来查订单、核对哪些付款还没发码。

## 支持这个项目

- 爱发电主页：[afdian.com/a/fin-extention](https://afdian.com/a/fin-extention)，项目进展、版本说明都发在这里
- 授权码：[入夜 Fall in Night 激活码](https://afdian.com/item/980ad088db4e11f1a3da52540025c377)，¥6 一次性
- 开发记录：[DEVLOG.md](DEVLOG.md)，按时间记下每次取舍与踩过的坑
- 问题反馈：[Issues](https://github.com/apeiz/fin-extension/issues)

## 已知限制

1. 视频站与需要精确原色的站点不适合，用站点自带深色主题，或加进白名单
2. CSS 背景图会变成负片，大 banner 与纹理卡片可能出错，可用自定义 CSS 补救
3. 白底图片在暗色页面上仍是亮块，这是「保持原色」的取舍
4. 原生下拉框仍是亮色，由浏览器绘制，扩展改不到
5. 跨域 iframe 按它自己的域名判断，需要单独加规则

技术细节与实测数据见 [DEVELOPMENT.md](DEVELOPMENT.md)。

## 隐私

不收集数据，不上传信息，不发起网络请求，没有远程代码。设置只存在浏览器本地。详见 [PRIVACY.md](PRIVACY.md)。

## 许可

MIT，见 [LICENSE](LICENSE)。「入夜」「Fall in Night」名称与图标不在授权范围内。

问题与建议请提 Issue。
