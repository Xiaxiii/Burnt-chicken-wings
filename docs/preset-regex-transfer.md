# 预设内置正则缝合

入口：缝合页，来源选择预设或完整预设 JSON 文件，目标选择预设，点击来源栏的「正则」。它独立于提示词缝合，无需选择提示词或插入位置。

默认选择 `markdownOnly && !promptOnly` 的显示规则。其他规则可手动选择。这里保留源规则的 `disabled`、作用位置、深度、替换内容和未知字段，不重写表达式、不运行替换 HTML。规则原本关闭，搬入后仍关闭。

完全重复按除 `id` 外的全部数据比较，对象键顺序不影响比较。重复规则跳过；同名或同 ID 但数据不同，可以保留两份（必要时生成新 ID）、跳过，或明确替换目标中的一条。多个目标冲突时必须指定替换哪条。替换保留目标 ID 和位置，新规则按来源顺序追加；不会批量删除冲突规则。

确认前检查来源、目标、草稿身份和焦点是否变化。只有确认才修改目标，使用现有自动保存、修改前备份、外部修改冲突检查、本地恢复及撤销机制。取消不修改目标。

## 原生存储与生效

2026-10-19 核对 SillyTavern `release` 分支（package.json 为 1.19.0）的官方源码：

- [regex/engine.js](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/extensions/regex/engine.js)：预设规则位于 `extensions.regex_scripts`；原生许可位于 `extension_settings.preset_allowed_regex[apiId]` 的预设名数组。聊天补全的 API ID 为 `openai`，与模型提供商无关。引擎每次读取规则，编译缓存按查找式区分，无需导入私有模块或清空缓存。
- [regex/index.js](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/extensions/regex/index.js)：监听 `PRESET_CHANGED` 刷新正则面板；未获许可时可能弹出原生信任确认，已获许可时可提示重载聊天。
- [preset-manager.js](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/preset-manager.js)：`savePreset(..., {skipUpdate:true})` 不负责更新内存或发换预设事件。

因此沿用原有写入流程同步文件、预设列表和当前设置。只有正则发生变化、目标为当前预设、原生已允许这个预设且正则扩展未停用时，追加标准 `PRESET_CHANGED` 通知。通知失败会单独提示已保存、需重新选择预设，不把成功写入误报成失败。未获许可时不发这次通知，避免本工具遮住原生信任窗口，也不修改许可名单；需要用户在酒馆正则面板开启。非当前目标在自然切换到该预设时由酒馆处理。

只迁移随预设保存的规则，不迁移全局或角色卡正则。没有这类规则的来源会明确提示。状态栏能否显示，还取决于配套提示词、世界书及实际输出是否符合查找式；搬运正则不生成这些内容，也不会自动重写既有聊天。

## 验证范围

`node test/run-core.cjs` 包含独立的规则规划及宿主保存回归；`PW_CHROME=/usr/bin/chromium node test/regex-transfer-check.mjs` 使用合成预设在真实 Chromium 中验证手机、桌面、取消、保存与撤销、冲突、过期预览、完整 JSON 文件和 HTML 文本转义。浏览器与宿主回归使用仓库的模拟酒馆环境，未将用户的私人预设或完整 SillyTavern 服务器作为已验证范围。
