## 如何选择下载包

| 使用场景 | 下载 |
| --- | --- |
| 不确定显卡是否兼容、使用 macOS／ARM，或需要首次启动就能完全离线 | 按操作系统选择不带 `-gpu` 的标准包。无需 Python 或网络。 |
| Windows x64／Linux x64，且有兼容 NVIDIA 显卡 | 选择 `waterwave-windows-amd64-gpu.zip` 或 `waterwave-linux-amd64-gpu.zip`。包含标准启动器和 `GPU-accelerator/`；需要 GPU 时用该目录下的启动器。 |
| 只想为在线工作台或已有安装加速 | 下载 `waterwave-gpu-accelerator.zip`，完整解压后启动，再打开工作台。 |

**GPU 条件**：NVIDIA Turing 或更新架构（CUDA 计算能力 ≥ 7.5，例如 RTX 20 系列、GTX 16 系列及更新型号）、支持 CUDA 13.0 的 R580 或更新驱动、64 位 Python 3.11+。加速器首次安装需联网，不修改显卡驱动；没有兼容硬件或 GPU 初始化失败时可用其 CPU 模式。AMD、Intel 显卡和 Apple Silicon 不走此 CUDA 路径。

## 更新内容

- 工作台采用单屏布局，范围、采样、焦点和高级参数按需展开。
- 可独立抽取原始 TIFF，支持高度场 MAT、批量导入 RMS、自动或手动选焦、逐次与工况统计。
- 固定轴长与半高宽椭圆并行计算，增加功率剖面、拟合诊断、包围能量及参考配对检查。
- 重写使用教程并更新真实界面截图。`SHA256SUMS.txt` 用于检查归档完整性。

项目采用 MIT 许可证；第三方许可证及离线解码器源码随包提供。
