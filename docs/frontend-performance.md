# 干员列表交互与 React Compiler 试点

干员管理面板按数据变化缓存排序和拥有数量，用 `useDeferredValue` 将搜索输入与列表更新分开。匹配条目超过 100 名时使用 TanStack Virtual，沿用抽屉滚动区域，动态测量技能展开后的行高，并保留展开状态和键盘焦点。

## 混合拼音查询

[`filterSearch`](../src/lib/search.ts) 批量处理同一查询：先匹配完整词，再对未命中的条目按片段依次匹配。`pinyin-match` 1.2.10 只缓存最后一个查询的拼音组合；逐条处理 `ganyuan4`、`liuxing2026` 等混合查询会反复切换完整词和子片段，重建缓存。按片段批量处理可复用库内缓存，不新增持久缓存或拼音字典。

批量接口保留原有 `matchesSearch` 的规则：忽略大小写、空白分词全部命中、拼音和首字母匹配、混合片段按文本顺序匹配。返回的条目顺序和对象引用保持不变。当前由干员管理面板使用；其他搜索入口继续调用 `matchesSearch`。

## Compiler 范围与开关

默认构建保留现有 `memo`。以下命令开启局部试点：

```sh
REACT_COMPILER=1 pnpm run dev
REACT_COMPILER=1 pnpm run build:web
```

Vite 的 React 插件以 `compilationMode: 'annotation'` 调用 `oxc-transform-react`，只编译带 `'use memo'` 的函数。目前仅标记 [`OperatorRow`](../src/pages/v2/OperatorRows.tsx)，保持其他组件的编译方式。`oxc-transform-react` 是 Vite 插件支持的实验性 Rust 实现，版本遵循 `@vitejs/plugin-react` 的 peer 约束。

包含 `useVirtualizer` 的列表控制层不加入试点。编译器会将该 API 识别为不兼容：它返回的可变接口不适合自动记忆化。单条内容组件不读取虚拟器接口，继续通过 props 接收干员数据。试点保留原有 `memo`，使开启和关闭 Compiler 时都能跳过重复渲染。

## 对比方法

使用生产 profiling 构建，将 `react-dom/client` 临时别名到 `react-dom/profiling`，加载相同的 432 名干员和页面样式。Chromium 153、375 × 812、CPU 6 倍降速，预热后交错运行三组：上一版本、仅批量搜索、批量搜索加 Compiler。分别记录输入事件到首次提交、输入到列表最后一次提交，以及 React `actualDuration`；这些指标不等同于浏览器绘制完成或真实手机耗时。

搜索纯函数另行交错测试，预热两轮后各取五轮中位数；每个查询都比较完整结果。2026-10-27 的本地结果：

| 查询 | 原逐条筛选 | 批量筛选 |
| --- | ---: | ---: |
| `no-matching-operator` | 188.5 ms | 5.3 ms |
| `ganyuan4` | 182.8 ms | 5.5 ms |
| `liuxing2026` | 248.3 ms | 4.5 ms |
| `nengtianshinengtianshi` | 2.3 ms | 1.9 ms |
| `amiya` | 2.7 ms | 2.7 ms |

这些是共享开发机上的 CPU 降速样本，主机竞争会影响绝对耗时。主要收益来自避免混合查询反复重建拼音组合，不能推导为所有查询都有同样增幅。Compiler 的额外交互收益尚未稳定，保留为可开启的试点，不默认推广。

验证编译结果时，应确认单条组件生成了 `react/compiler-runtime` 缓存调用，构建没有出现跳过优化的诊断；再用开启试点的产物验证滚动、展开后回收和恢复、Tab 遍历、导入更新练度、搜索与抽屉关闭重开。普通 Vitest 配置不运行 Compiler，源码测试通过不能替代编译产物的浏览器验证。

数据库请求、网络等待和服务端计算应按各自边界测量，见[服务端性能观测](performance-observation.md)。
