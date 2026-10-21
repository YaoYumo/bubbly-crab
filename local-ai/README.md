# 本地模型接入预留目录

这里不包含模型权重或推理程序，也不会自动下载安装、运行模型。

```text
local-ai/
  config.example.json   默认关闭的配置样例（随项目分发）
  config.local.json     本机配置（运行 init 创建，不提交、不打包）
  models/               自行下载的 GGUF 权重等（不提交、不打包）
  runtimes/             可选本地推理程序存放位置（不提交、不自动执行）
  cache/                为以后准备的缓存目录（当前不写推理缓存）
  logs/                 为以后准备的日志目录（当前不写提示词/推理日志）
```

在项目根目录运行：

```sh
npm run local-ai:init
npm run local-ai:check
```

`init` 只创建目录与默认 `enabled:false` 的本机配置，不覆盖已有配置。
`check` 只检查配置、目录和可选 GGUF 文件是否存在，不连接服务、不加载权重、不推理。

实际安装 Ollama、LM Studio 或 llama.cpp 后，可按 [接入说明](../docs/local-ai.md) 手动配置服务，再选择启动 `npm run ai:local`。该命令只启动接入网关，不启动模型程序。Ollama / LM Studio 也可以使用自己的模型存储目录，不必搬到本文件夹。

**本地指运行网关的那台电脑。** Arena 云预览不能通过其 `127.0.0.1` 访问你电脑上的模型。准备在自己的电脑使用时，应将项目下载到本机，启动网页服务和可选网关。单文件 `previz-lab.html` 不会因为这个目录存在就自动读取磁盘或连接模型。

### 主动联调

`npm run local-ai:verify` 默认只列计划、不联网。配置并启用运行时后，可主动选择 `npm run local-ai:verify -- --probe` 检查模型列表，或 `npm run local-ai:verify -- --run` 运行最多五组隔离蓝图测试。没有自动重试或场景应用；真实模型尚未在本项目环境验收。详见 [联调说明与范围](../docs/local-ai-verification.md)。
