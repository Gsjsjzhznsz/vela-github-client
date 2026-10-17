# InputMethod 组件（vendored）

来源：
- 上游组件：https://github.com/NEORUAA/Vela_input_method （MIT License，版权所有 (c) 2024 NEORUAA）
- 当前基底：**BandQQ main 分支**（v2.28.2，https://github.com/Gsjsjzhznsz/BandQQ ，同上游作者）逐字照搬

## v2.0.3-band 起的同步策略（band 分支）

- `InputMethod.ux` 与 `assets/`（arc/full/horizontal/t9 图片、dic.js、dicUtil.js、
  dictionaryLoader.js、dictionary/*.txt 词库）**逐字逐字节照搬 BandQQ main 分支**，
  不做本工程私有像素改动 —— band 9/10/11 走 `screentype="pill-shaped"`（192 原生
  布局，KB_H_PILL=333=28 拼音行+305 键区），布局/高度链/词库逻辑与 BandQQ
  手环版真机行为完全一致。
- **唯一增量**（本工程 token 输入场景需要，上游无此 prop）：
  - `initlang` prop（默认 "cn"）+ onInit 首帧语言应用 —— PAT/Token 输入直接进
    EN 模式，避免拼音候选缓冲吞字母造成隐性错码。
  - 以上增量在源码内以 `/* vgc v1.1.3 */` 注释标记，`scripts/test_pages_band.js`
    的「零漂移」断言会剥离该增量后与 BandQQ main 逐字节比对，防止后续手改漂移。

## 宿主集成要点

- manifest features 需声明 `system.file`（词库 file.readText 按需加载）/
  `system.device` / `system.vibrator`；
- 键盘物理高：circle 321 / rect 264 / pill 333（designWidth 192 下 1css=1px），
  页面 kb-dock / preview-box 显式定高需与 `kbTotalFor(screentype)` 对齐；
- 本工程用法：`src/pages/input/input.ux`（BandQQ compose 同构独立输入页，
  `hide` 恒 false 常驻，规避本固件 $watch 不触发）。
