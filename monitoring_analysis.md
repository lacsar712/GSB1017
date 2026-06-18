监控指标经 FastAPI 业务处理层由 `prometheus_fastapi_instrumentator` 在进程内采集 `http_requests_total` 与 `http_request_duration_seconds`，再通过 `/metrics` 端点以文本格式暴露，最终由 Prometheus 每 5 秒 Pull 拉取入库，整条链路存在环境变量静默失效、采集间隔过激、端点无鉴权等多处生产风险。

## 一、三层架构：监控指标从 API 请求流入 Prometheus

### 第 1 层：业务处理层（`backend/main.py`）

业务层由 FastAPI 应用承载，定义了 `/`、`/api/success`、`/api/slow`、`/api/error`、`/api/items`（GET/POST）等路由。真正的指标采集发生在 [main.py:68-75](file:///d:/document/code/modelX/GSB0616/1017/GSB1017/backend/main.py#L68-L75)：

```python
instrumentator = Instrumentator(
    should_group_status_codes=False,
    should_ignore_untemplated=True,
    should_respect_env_var=True,
    excluded_handlers=[".*admin.*", "/metrics"],
    env_var_name="ENABLE_METRICS",
)
instrumentator.instrument(app).expose(app)
```

- `instrumentator.instrument(app)` 会包装每一个路由处理器，在请求进入与结束时埋点。
- 每次请求处理完成后，进程内会更新两个核心指标：
  - `http_requests_total`（Counter）：按 `handler`、`status`、`method` 三个 label 维度累加请求总数。
  - `http_request_duration_seconds`（Histogram）：记录请求耗时，并衍生出 `http_request_duration_seconds_bucket`、`http_request_duration_seconds_sum`、`http_request_duration_seconds_count` 三个序列。
- `should_group_status_codes=False` 表示状态码不聚合，`200`、`500` 等各自成为独立 label 值。
- `excluded_handlers=[".*admin.*", "/metrics"]` 将 admin 路由与 `/metrics` 自身排除，避免自监控产生反馈循环。
- `should_respect_env_var=True` 配合 `env_var_name="ENABLE_METRICS"`，意味着只有当环境变量 `ENABLE_METRICS` 为真值时才真正启用采集。

### 第 2 层：/metrics 暴露层（`backend/main.py`）

- `instrumentator.expose(app)` 在同一个 FastAPI 应用上注册 `/metrics` 端点。
- 当该端点被访问时，Instrumentator 将进程内累积的 `http_requests_total`、`http_request_duration_seconds` 等序列序列化为 Prometheus 文本展示格式（text exposition format）返回。
- 该端点与业务接口共用同一个 uvicorn 服务（监听 `0.0.0.0:8000`），无独立鉴权。

### 第 3 层：Prometheus Pull 拉取层（`prometheus/prometheus.yml`）

```yaml
global:
  scrape_interval: 5s
  evaluation_interval: 5s
scrape_configs:
  - job_name: "fastapi-service"
    static_configs:
      - targets: ["backend:8000"]
```

- Prometheus 以 `fastapi-service` 为 job 名，对 `backend:8000` 发起 HTTP GET（默认路径 `/metrics`）。
- `scrape_interval: 5s` 表示每 5 秒拉取一次；`evaluation_interval: 5s` 表示每 5 秒评估一次告警/记录规则。
- 拉取到的文本被解析为时间序列写入 Prometheus TSDB，指标名前会自动附加 `job="fastapi-service"`、`instance="backend:8000"` 等 label。

### 数据流向小结

API 请求 → FastAPI 路由处理器执行业务逻辑 → Instrumentator 在进程内更新 `http_requests_total` / `http_request_duration_seconds` → `/metrics` 端点以文本格式暴露 → Prometheus 每 5 秒 Pull 拉取并入库。

## 二、生产环境风险

| 风险描述 | 影响 | 建议 |
| --- | --- | --- |
| `should_respect_env_var=True` 且 `env_var_name="ENABLE_METRICS"`，若生产环境未设置该环境变量或设为假值，采集将被静默关闭，而 `/metrics` 端点仍可访问（仅返回空或默认值）。 | 监控数据无声丢失，`http_requests_total`、`http_request_duration_seconds` 长期为空，告警与看板全部失效却难以察觉。 | 在部署清单/容器编排中强制声明 `ENABLE_METRICS=true`，并增加针对 `/metrics` 返回内容是否包含 `http_requests_total` 的探活告警。 |
| `scrape_interval: 5s` 过于激进（注释亦自述“为了演示快一点”）。 | 高频拉取使 Prometheus TSDB 存储与磁盘 I/O 压力骤增，高基数 label 下更易触发内存膨胀；长期运行会显著缩短数据保留周期。 | 生产环境将 `scrape_interval` 调整为 `15s`~`30s`，并按 job 粒度区分采集频率。 |
| `/metrics` 端点与业务接口共用 `0.0.0.0:8000` 且无任何鉴权，`excluded_handlers` 仅排除采集而非访问。 | 任何能访问 `backend:8000` 的对象均可读取 `http_requests_total`、`http_request_duration_seconds` 等序列，泄露路由结构、状态码分布与延迟画像。 | 通过反向代理/网络策略限制 `/metrics` 仅对 Prometheus 可达，或为该端点增加 Basic Auth / mTLS。 |
| `http_request_duration_seconds` 使用默认 Histogram 桶，而 `/api/slow` 延迟为 0.5~2.0s，默认桶在低值密集、高值稀疏。 | 大量样本落入 `+Inf` 桶，导致 p95/p99 分位数计算失真，慢请求告警阈值无法准确设定。 | 通过 `Instrumentator` 自定义 `buckets` 参数，覆盖 0.1~5s 区间，或改用 Summary/原生直方图。 |
| `excluded_handlers=[".*admin.*"]` 将 admin 路由排除在采集之外。 | 管理类操作的 `http_requests_total`、`http_request_duration_seconds` 不被记录，形成监控盲区，异常调用难以追溯。 | 仅排除 `/metrics` 自身，admin 路由改为单独 job 或单独 label 进行受限采集。 |
| `should_group_status_codes=False` 使每个状态码成为独立 label 值，叠加 `handler` label 在含路径参数的路由上可能产生高基数。 | label 基数膨胀导致 Prometheus 内存与序列数激增，严重时拖垮服务端。 | 对含路径参数的路由统一模板化 handler，必要时启用 `should_ignore_untemplated=True` 并对高基数 label 做聚合。 |
