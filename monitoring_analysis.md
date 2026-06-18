本项目基于 prometheus_fastapi_instrumentator 实现 API 请求指标的自动采集与 Prometheus 拉取，三层架构链路清晰但存在生产环境下指标基数膨胀与采集间隔过短等风险。

## 一、三层架构指标流转说明

### 第一层：业务处理层（FastAPI 应用内部）

当 API 请求进入 FastAPI 应用时，`prometheus_fastapi_instrumentator.Instrumentator` 通过中间件机制自动拦截所有经过的请求，在请求生命周期内采集以下核心指标数据：

| 指标类型 | 采集时机 | 数据来源 |
|---------|---------|---------|
| 请求计数 | 请求响应后 | 按 handler + method + status_code 维度递增 |
| 请求耗时 | 请求响应后 | 记录请求进入到响应完成的时间差（Histogram） |
| 请求大小 | 请求接收时 | 从 request 对象读取 content-length |
| 响应大小 | 响应发送后 | 从 response 对象读取 content-length |

关键代码位于 [main.py](file:///d:/document/code/modelX/GSB0616/1017/GSB1017/backend/main.py#L67-L75) 第 67-75 行，通过 `instrumentator.instrument(app)` 将监控中间件注入 FastAPI 应用。配置项 `should_group_status_codes=False` 表示状态码不分组（如 200、201 分别计数），`excluded_handlers` 排除了 `/metrics` 端点自身的监控采集。

### 第二层：/metrics 暴露层

`instrumentator.expose(app)` 在 FastAPI 应用上自动注册了 `/metrics` 端点（默认路径），该端点具有以下特性：

- **端点路径**：`/metrics`（Prometheus 标准端点）
- **响应格式**：text/plain，符合 Prometheus exposition format
- **访问控制**：无认证，直接暴露所有采集到的指标
- **指标前缀**：默认以 `http_` 开头（由 instrumentator 库定义）

当 Prometheus 访问 `/metrics` 时，FastAPI 应用从内存中的 Prometheus Client 注册表（CollectorRegistry）中读取所有指标的当前值，序列化为文本格式后返回。主要暴露的指标包括：

- `http_requests_total` — Counter 类型，累计请求数
- `http_request_duration_seconds` — Histogram 类型，请求延迟分布
- `http_request_size_bytes` — Histogram 类型，请求体大小分布
- `http_response_size_bytes` — Histogram 类型，响应体大小分布
- `http_requests_exceptions_total` — Counter 类型，异常请求数

### 第三层：Prometheus Pull 拉取层

Prometheus 服务端采用 Pull 模式主动拉取指标，配置位于 [prometheus.yml](file:///d:/document/code/modelX/GSB0616/1017/GSB1017/prometheus/prometheus.yml)。

**拉取流程：**

1. Prometheus 读取 `scrape_configs` 中的 job 配置
2. 对于 `fastapi-service` 这个 job，每 5 秒（`scrape_interval: 5s`）触发一次采集
3. Prometheus 向目标地址 `backend:8000` 发起 HTTP GET 请求，路径为默认的 `/metrics`
4. 接收响应后解析指标文本，存入本地时序数据库（TSDB）
5. 每 5 秒（`evaluation_interval: 5s`）评估一次告警规则（本配置中未定义规则）

**目标发现方式：** 本项目使用 `static_configs` 静态配置目标地址，服务发现依赖 Docker Compose 的内部 DNS（`backend` 为服务名）。

---

## 二、生产环境风险分析

| 风险描述 | 影响 | 建议 |
|---------|------|------|
| **scrape_interval 设置为 5s 过短**，生产环境大量实例或高基数指标下会导致 Prometheus 存储压力剧增、内存占用过高、TSDB 压缩效率下降 | 单机部署时磁盘 IO 和内存快速耗尽，集群部署时成本成倍增加，长期保留历史数据时查询性能退化 | 将 scrape_interval 调整为 15s~30s 的生产标准值，对核心业务指标可单独配置较短间隔，遵循"默认长间隔、核心短间隔"原则 |
| **/metrics 端点无任何认证保护**，直接暴露在网络中可被任意访问，导致敏感业务路径、请求量等信息泄露 | 攻击者可通过指标数据推断业务规模、用户行为、系统瓶颈，甚至利用高基数指标发起 DoS 攻击 | 在 FastAPI 中为 /metrics 添加 Basic Auth 或 IP 白名单中间件，或通过反向代理（Nginx）做访问控制，仅允许 Prometheus 所在网段访问 |
| **should_group_status_codes=False 导致状态码维度爆炸**，若业务存在大量不同状态码（如自定义 4xx），每个状态码都会生成独立时间序列 | 高基数下 Prometheus 内存暴涨，查询变慢，严重时触发 OOM，且大部分细分状态码指标无实际监控价值 | 将 should_group_status_codes 设为 True，按 2xx、3xx、4xx、5xx 分组统计，仅对特别关注的状态码单独加标签记录 |
| **static_configs 静态服务发现不适用于动态扩缩容环境**，容器重启或新增实例后 Prometheus 无法自动发现新目标 | 扩容的实例指标无法被采集，监控覆盖率下降，故障时可能缺失关键实例的监控数据 | 改用 Docker Swarm 服务发现（docker_sd_configs）或 Kubernetes 服务发现（kubernetes_sd_configs），或引入 Consul 等注册中心做服务发现 |
| **excluded_handlers 仅排除 /metrics 但未排除健康检查端点**，若存在频繁的健康检查探针请求（如 K8s livenessProbe），会产生大量无效指标 | 健康检查请求通常占总请求量很大比例，徒增指标存储和计算开销，稀释真实业务请求的统计准确性 | 将健康检查路径（如 /health、/healthz）也加入 excluded_handlers 列表，避免非业务流量污染监控数据 |
