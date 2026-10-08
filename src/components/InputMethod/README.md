# InputMethod 组件（vendored）

来源：https://github.com/NEORUAA/Vela_input_method （MIT License，版权所有 (c) 2024 NEORUAA）

本目录为原组件的 vendored 副本，以 BandQQ（NEORUAA）compose 模式集成：独立输入页常驻键盘（hide 恒 false，规避本固件 $watch 不触发），rect 布局保留 RW5 适配补丁：
- rect 布局总高 255px → 200px，拼音候选行 28px → 20px（原布局超出 257dp 屏高）
- T9 行容器 top 77px → 50px（避开候选横滚条），键高 55px → 46px
- QWERTY 横滚行键高 60px → 48px、字号 32px → 26px
- 全部改动仅限像素尺寸，未触碰输入算法与词库逻辑

宿主集成要点：manifest features 需声明 system.file / system.device / system.vibrator；
页面用法见 src/pages/search/search.ux（T9）与 settings.ux（QWERTY）。
