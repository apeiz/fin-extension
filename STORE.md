# Edge Add-ons 上架材料

面向 Microsoft Edge 加载项商店的提交清单。Partner Center 里每个字段要填什么，这里都有可直接粘贴的内容。

## 素材清单

全部由 `tools/store-assets.js` 生成到 `store/`，图标由 `tools/make_icons.py` 生成。
`store/` 不入库，随时可以重新跑一遍。

```bash
node tools/store-assets.js
python tools/make_icons.py --size 300 --out store/logo-300.png
```

| 文件 | 尺寸 | 用途 |
| --- | --- | --- |
| `logo-300.png` | 300x300 | Extension logo，每种语言必填 |
| `01-site.png` | 1280x800 | 真实站点入夜后整屏 |
| `02-compare-sspai.png` | 1280x800 | 左右对比 |
| `03-compare-163.png` | 1280x800 | 图文站对比，展示图片保色 |
| `04-popup.png` | 1280x800 | 弹窗叠加在站点上 |
| `05-options.png` | 1280x800 | 设置页：站点列表 |
| `06-options-all.png` | 1280x800 | 设置页：全部入夜 + 白名单 |
| `promo-small.png` | 440x280 | 小宣传图 |
| `promo-large.png` | 1400x560 | 大宣传图 |

上传顺序按 01 到 06，最多 6 张，正好。

**小宣传图必须传。** 它标着 Optional，但不上传的话扩展不会出现在商店搜索结果里，只能靠直链访问。这是已知的坑。

## 包

```bash
npm run pack        # dist/fin-extension-<版本>.zip
```

## 商店字段

### 名称与短描述

两者都来自 `manifest.json`，在 Partner Center 里是只读的，要改只能改清单重新上传。

```
name:        入夜 Fall in Night
short_name:  入夜
description: 入夜 Fall in Night：把指定网站切换为暗色，一键让所有网站入夜。图片视频保持原色，也可作为网站深色适配的预览工具。
```

### 长描述（250 到 10000 字符）

> 入夜把网页收进夜色里。
>
> 装上之后，你指定的网站每次打开就是暗色的，不用再手动切换。它和普通的暗色扩展有一点不同：除了日常使用，它还被设计成一个**看效果**的工具——先看到页面暗下来是什么样，再决定要不要这么改。
>
> **它做什么**
>
> — 指定站点自动入夜。默认三条规则，也可以自己加。支持 `*.example.com` 这种写法，一条覆盖整个域及其所有子域。
>
> — 一键全部入夜。打开「所有网站入夜」，其余站点一并变暗；同时会出现白名单，把需要精确原色的站点挑出来保持原样。
>
> — 图片和视频保持原色。整页反色会把照片变成负片，入夜把图片、视频、画布再翻转一次还原，所以看到的照片还是原来的颜色。
>
> — 原本深色的区块不会被翻亮。深色导航条、深色页脚这类区块反色后本来是亮块，比原来还刺眼；扩展会把它们恢复成本来的深色。
>
> — 单站自定义修正 CSS。个别站点有残留问题，可以补一段只对该站生效的样式。
>
> **为什么值得装**
>
> 让网页变暗这件事已经有成熟的免费方案，做得比我们好，这一点不必掩饰。入夜的价值在另一头：前端做完了深色主题，想确认首屏有没有留下刺眼的白块；设计评审上要说清某个站的暗色适配差在哪；内容运营想知道文章页在暗色下读起来累不累——这些靠「打开页面看一眼」回答不了，需要并排的对比和可量的判断。扩展是这条链路上最轻的一环：随手切一下，看一眼。
>
> **为什么它不会拖慢网页**
>
> 让网页变暗有两条路：解析页面的样式表、把每个颜色重算一遍；或者不解析，直接套一层滤镜。入夜走后者。
>
> 它不读页面的 `CSSStyleSheet`，不计算任何颜色，不生成替换样式表，只在页面最前面插一条 `filter: invert(.92) hue-rotate(180deg)`，剩下的交给浏览器合成器。所以打开页面时没有 JavaScript 在主线程上做样式分析，首屏不会因为扩展而延迟。整个包 30 KB，省掉的就是那套解析与颜色映射的代码。
>
> 代价写在明处：彩色会轻微褪色，红色 `#d92b2b` 变成 `(184,67,67)`，色相保持、饱和度下降。纯灰阶的文字和边框是精确的，红涨绿跌不会颠倒。
>
> **怎么用**
>
> 1. 工具栏点图标，打开总开关。
> 2. 当前站点不在列表里时，打开站点开关，它会作为一条精确规则加入，优先级高于通配规则，立即生效，不用刷新。
> 3. 弹窗右下角进设置页，管理站点列表、白名单和显示方式。
>
> **免费版与解锁**
>
> 免费版可以保存 5 个站点和 3 条白名单，功能完整，没有试用期，也不限使用时长。到上限时不会删除任何已有条目，只是不能再新增。
>
> 需要更多站点时，可以赞助 6 元换取一个授权码，激活后不再限制数量。赞助通过爱发电完成，收款方是开发者本人，不是 Microsoft。授权码在扩展设置页的「站点数量」一栏里输入。
>
> **已知限制**
>
> 这些是方案的边界，不是待修的缺陷：
>
> 1. 视频站和需要精确原色的网站不适合，请用站点自带的深色主题，或加进白名单。
> 2. CSS 背景图会变成负片，大 banner、带纹理的卡片可能出现，可以用自定义 CSS 补救。
> 3. 白底图片在暗色页面上仍是亮块，这是「保持原色」的取舍。
> 4. 彩色有轻微褪色：涨红 `#d92b2b` 会变成偏灰的红，色相正确但饱和度下降。纯灰阶（文字、边框）是精确的，红涨绿跌不会颠倒。
> 5. 原生下拉框仍是亮色，由浏览器绘制，扩展改不到。
> 6. 跨域 iframe 内部按自己的域名判断是否生效，需要单独加规则。
>
> **隐私**
>
> 不收集任何数据，不上传浏览记录，不发起网络请求，没有远程代码，没有分析 SDK。设置只存在浏览器本地（`chrome.storage.local`）。扩展只在命中站点列表的页面上注入样式，其余页面一行都不注入。
>
> 为什么需要「读取和更改您在所有网站上的数据」：扩展要在任意站点上注入样式，而站点列表由你随时增删，不能每加一个域名就重新授权一次。这条权限是必须的，但扩展只在列表命中的站点上动手。
>
> **开源**
>
> 代码以 MIT 许可发布，可在 GitHub 上查看与自行构建。名称与图标不在授权范围内。

### 其他字段

| 字段 | 值 |
| --- | --- |
| Category | Productivity |
| Privacy policy URL | `https://apeiz.github.io/fin-extension/privacy.html` |
| Support URL | `https://apeiz.github.io/fin-extension/#support` |
| Website | `https://apeiz.github.io/fin-extension/` |
| Search terms | 暗色模式 深色模式 夜间模式 网页变暗 dark mode night mode 护眼 |
| YouTube video | 留空 |
| Mature content | 否 |
| Contains in-app purchases | **是**（政策 1.8.2 要求披露付费功能与价格区间，描述里已写明） |
| Visibility | Public |
| Markets | 全部 |

### 为什么不用 GitHub 仓库地址

Partner Center 的 URL 校验对 `github.com/<用户>/<仓库>` 这种路径经常判「unreachable」。
实测该地址本身返回 200，问题出在校验器这一侧，不是仓库挂了。

所以站点放在 GitHub Pages（`docs/` 目录）上，三个字段全部指向它：

| 用途 | 地址 |
| --- | --- |
| Website | `https://apeiz.github.io/fin-extension/` |
| Privacy policy URL | `https://apeiz.github.io/fin-extension/privacy.html` |
| Support URL | `https://apeiz.github.io/fin-extension/#support` |

开通方式：仓库 Settings，左侧 Pages，Source 选 `Deploy from a branch`，
分支 `main`、目录 `/docs`，保存。首次生效约 1 分钟。

站点文件在 `docs/`：`index.html`（介绍页，含下载与赞助入口）、`privacy.html`（隐私政策）。
`docs/fin-extension-<版本>.zip` 是下载按钮指向的包，**每次发版要和 `dist/` 里的新包一起替换**，
否则站点上挂的还是旧版本。

## Privacy 页面逐项答案

Partner Center 的 Privacy 页有六块，都是必填。下面每一段都可以直接粘贴。

字段建议用英文写：表单是英文的，读它的是微软的政策审核员，写英文减少误读。
每段后面附中文版，若你希望整页中文，替换成中文即可（两者内容一致）。

### 1. Single purpose description

```
Fall in Night has one purpose: turn the pages of websites the user chooses into a dark
colour scheme, so a bright page does not stay bright at night.

It injects one CSS filter rule (invert plus hue rotation) into pages on a list the user
maintains, plus four supporting rules so that photos keep their original colours,
already-dark blocks stay dark, and blur effects do not turn into bright patches. The user
decides which sites are affected, either by listing them or by enabling all sites and
excluding some.

The extension does not change page content, does not read page text, does not collect or
transmit anything, and makes no network requests. It does not parse stylesheets or compute
colour values, so it does not delay page load.
```

中文版：

```
把一个网页变成暗色，这就是它的全部用途。

做法是在用户维护的站点列表上注入一条 CSS 滤镜规则（反色加色相旋转），另加四条辅助规则：
图片视频保持原色、原本深色的区块保持深色、毛玻璃效果不退化成亮斑。哪些站点生效由用户决定，
逐个列出或者开启「所有网站入夜」再用白名单排除。

不修改网页内容，不读取页面文本，不收集也不上传任何数据，不发起任何网络请求。
不解析样式表、不计算颜色值，因此不会拖慢页面加载。
```

### 2. Permission justification

`storage`：

```
Remembers the user's own settings so they survive a restart: the list of sites to darken,
the whitelist, four display toggles, optional per-site correction CSS, and a licence code
if the user has entered one. Written with chrome.storage.local only. The data stays inside
the browser profile on the user's device and is never sent anywhere.
```

```
保存用户自己的设置，重启浏览器后仍然有效：站点列表、白名单、四个显示开关、可选的逐站修正 CSS，
以及用户自己填进来的授权码。只写入 chrome.storage.local，数据留在本机浏览器配置里，不发往任何地方。
```

`activeTab`：

```
Used only after the user clicks the toolbar icon. The popup reads the URL of the active tab
to show which site the on/off switch applies to, and whether that site is already covered
by a rule. The URL is used for that display only - not stored, not logged, not sent.
No page content is read.
```

```
只在用户点击工具栏图标之后使用。弹窗读取当前标签页的网址，用于显示这个开关作用于哪个站点、
该站点是否已在规则里。网址只用于这次显示，不存储、不记录、不外发，不读取任何页面内容。
```

**若表单里另有一栏问 `content_scripts` 的 `<all_urls>`（有的版本在 Properties 或 Site access 页）：**

```
The extension injects its dark rule into whatever site the user chooses, and that list
changes at any time, so domains cannot be enumerated in advance. Every page is matched by
the manifest, but the first thing the content script does is compare the host against the
user's list; pages that are not covered get no style, no DOM change and no reads.
```

```
用户想让哪个网站变暗就加哪个，列表随时变化，无法事先枚举域名，所以清单里声明了全网匹配。
但内容脚本运行后的第一件事就是把当前域名和用户列表比对，未命中的页面不注入样式、不改 DOM、不做读取。
```

### 3. Are you using remote code?

选 **No, I am not using remote code.**

Justification（不强制，但填上有利）：

```
All code ships inside the package. There is no eval, no new Function, no remote script or
WASM, no update_url and no externally_connectable. The extension makes no network requests
at all. The only outbound link is the optional sponsorship page in the settings UI, which
opens only when the user clicks it.
```

### 4. Data usage

九个复选框**全部不勾**（本扩展不收集任何一类数据）：

- Personally identifiable information
- Health information
- Financial and payment information
- Authentication information
- Personal communications
- Location
- Web history
- User activity
- Website content

一项都不勾是有依据的，不是漏填：扩展不读取页面文本，不记录访问过的网址，不采集设备信息与使用行为，
配置只写在本机 `chrome.storage.local`。

### 5. Privacy policy URL

```
https://github.com/apeiz/fin-extension/blob/main/PRIVACY.md
```

这个地址已实测可匿名访问（HTTP 200）。注意：仓库里当前是 1.0.0 的版本，
本地 1.0.1 的隐私政策（补了爱发电跳转说明）还没推上去，推完内容才一致。

### 6. I certify the following disclosures are true

三个复选框**全部勾选**：

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

三条都成立：扩展没有任何数据外发通道，连网络请求都没有。

## 提审前检查

- [ ] `manifest.json` 里没有 `update_url`
- [ ] `manifest.json` 的 `description` 里没有出现「Chrome」字样（会被要求改成 Edge 或去掉）
- [ ] 版本号高于上一次提交
- [ ] zip 根目录直接是 `manifest.json`，不是外层文件夹
- [ ] 6 张截图与 2 张宣传图都已上传
- [ ] Privacy 页面的六块都已填：Single purpose、storage、activeTab、Remote code、
      Data usage（全部不勾）、Privacy policy URL、三项认证复选框
- [ ] 上传的 zip 版本与 `CHANGELOG` 顶部那条一致

## 审核周期

首次提交最长 7 个工作日。审核期间再提交新版本会重新排队，别一边等一边改。

## 发新版本

商店不接受同版本号覆盖，所以每次更新都要先涨版本。

1. 改 `manifest.json` 的 `version`，`package.json` 同步（不一致 `npm test` 会报错）。
2. `npm test`，再 `npm run pack` 出 `dist/fin-extension-<版本>.zip`。
3. 把新包复制到 `docs/`，同步改 `docs/index.html` 里的下载链接与版本号，否则站点上挂的是旧包。
4. Partner Center 里打开该扩展，走「更新」，上传新包后提交。
4. 审核期间线上仍是旧版本，通过后自动替换。

两件事容易踩：

- **版本号必须大于已上传的**，等于或小于会被直接拒绝。
- **描述里写了价格和免费额度，改价就要一起改描述。** Edge 政策 1.8.2 要求如实披露付费功能与价格区间，描述与实现不一致会被打回。

## 赞助商品页（爱发电）

设置页里那个「爱发电 · ¥6 一次性」指向 `https://afdian.com/item/980ad088db4e11f1a3da52540025c377`。
商品页本身要填的内容如下，可以直接粘。

**商品名**

```
入夜 Fall in Night · 授权码（解锁不限站点）
```

**商品简介**

```
「入夜」是一款把网页收进夜色的浏览器扩展。免费版可以保存 5 个站点、3 条白名单，
对只用两三个站的人完全够用。

这个商品是解锁码：激活后不再限制站点数量与白名单条数，其余功能完全一样。
一次性买断，不订阅、不续费。

支持 Edge 与 Chrome（Manifest V3）。
```

**发货说明（自动随机回复之外的固定回复里写）**

```
感谢支持。授权码在上一条私信里，格式是 XXXX-XXXX-XXXX。

激活方式：扩展图标右键进入「选项」，拉到「站点数量」，把码粘进输入框，点「激活」。
激活后标题右侧的 3/5 会变成「不限」。

没收到码、或者提示不合法，直接私信我，我手动补发。
```

**售后**

七天内不满意可私信退款，不需要理由。

**关于分享（别写「分享会失效」，那是假的）**

激活码在本地校验，没有在线验证，所以复制传播在技术上拦不住。
可以请用户别公开贴出去——说清「防止传播只能靠自觉」比编一个不存在的失效机制更可信。
