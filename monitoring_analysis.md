本项目通过 prometheus_fastapi_instrumentator 在 FastAPI 业务层自动埋点并暴露 `/metrics` 端点，再由 Prometheus 以 5s 间隔 Pull 拉取 `http_requests_total`、`http_request_duration_seconds` 等指标，实现三层可观测链路。

## 三层架构说明

### 第一层：业务处理层

业务逻辑位于 [backend/main.py](file:///d:/document/code/modelX/GSB0616/1017/GSB1017/backend/main.py)，包含以下 API 端点：

| 端点 | 方法 | 业务含义 |
|------|------|----------|
| `/` | GET | 欢迎页 |
| `/api/success` | GET | 模拟正常成功请求 |
| `/api/slow` | GET | 模拟 0.5~2s 随机耗时的慢请求 |
| `/api/error` | GET | 模拟抛出 500 错误的异常请求 |
| `/api/items` | GET | 从 PostgreSQL 读取 Item 列表 |
| `/api/items` | POST | 向 PostgreSQL 写入新 Item |

每个请求进入 FastAPI 路由时，由 `prometheus_fastapi_instrumentator` 的中间件自动拦截并记录指标数据，无需业务代码手动埋点。

### 第二层：/metrics 暴露层

在 [backend/main.py#L67-L75](file:///d:/document/code/modelX/GSB0616/1017/GSB1017/backend/main.py#L67-L75) 中完成指标暴露配置：

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

**关键配置解读：**

- `instrument(app)`：将 Prometheus 中间件注入 FastAPI，自动采集以下核心指标：
  - `http_requests_total`：Counter 类型，按 handler、method、status 维度累计请求总数
  - `http_request_duration_seconds`：Histogram 类型，记录请求耗时分布（含 `_sum`、`_count`、`_bucket`）
  - `http_request_size_bytes`：Histogram 类型，请求体大小分布
  - `http_response_size_bytes`：Histogram 类型，响应体大小分布
- `expose(app)`：在应用上注册 `/metrics` 端点，以 Prometheus 文本格式输出所有指标
- `should_group_status_codes=False`：不将状态码按 2xx/3xx/4xx/5xx 分组，保留精确状态码（如 200、500）
- `should_ignore_untemplated=True`：忽略未匹配到路由模板的请求（如 404），减少无效指标基数
- `should_respect_env_var=True` + `env_var_name="ENABLE_METRICS"`：需设置环境变量 `ENABLE_METRICS=true` 才会启用指标，可用于生产开关
- `excluded_handlers=[".*admin.*", "/metrics"]`：排除 admin 路径和 `/metrics` 自身的采集，避免自引用循环

### 第三层：Prometheus Pull 拉取层

拉取配置位于 [prometheus/prometheus.yml](file:///d:/document/code/modelX/GSB0616/1017/GSB1017/prometheus/prometheus.yml)：

```yaml
global:
  scrape_interval: 5s
  evaluation_interval: 5s

scrape_configs:
  - job_name: "fastapi-service"
    static_configs:
      - targets: ["backend:8000"]
```

**拉取流程：**

1. Prometheus 每 `scrape_interval=5s` 向 `backend:8000/metrics` 发起一次 HTTP GET 请求
2. FastAPI 的 `/metrics` 端点返回当前所有指标的文本快照（内存中累计值）
3. Prometheus 将抓取到的样本按时间序列存入本地 TSDB，标签 `job="fastapi-service"` 标识来源
4. `evaluation_interval=5s` 控制告警规则评估频率（本配置中暂无 rules）

### 完整数据流

```
客户端请求 → FastAPI 路由执行业务逻辑
                ↓
        Instrumentator 中间件拦截
                ↓
    更新内存中的 Prometheus 指标
    （http_requests_total、http_request_duration_seconds 等）
                ↓
    访问 /metrics 端点 → 输出文本格式指标
                ↑
        Prometheus 每 5s Pull 拉取
                ↓
        写入 Prometheus TSDB 存储
```

## 生产环境风险分析

| 风险描述 | 影响 | 建议 |
|----------|------|------|
| `scrape_interval` 仅 5 秒，采集频率过高 | 在多实例部署或高 QPS 场景下，会导致 Prometheus 存储膨胀、查询变慢，同时给被监控服务带来额外的 HTTP 请求压力，5 秒间隔在大规模集群中极易引发采集风暴 | 将生产环境 `scrape_interval` 调整为 15s~30s，对核心链路可单独配置 shorter interval，非核心指标使用默认 30s 或更长；同时评估增加 `scrape_timeout` 防止慢响应超时 |
| `ENABLE_METRICS` 环境变量控制指标开关，若未设置则指标不生效 | 生产部署时若遗漏配置 `ENABLE_METRICS=true`，`/metrics` 端点将不会暴露任何业务指标，Prometheus 拉取到空数据或 404，导致整个监控链路静默失效且难以察觉 | 在启动脚本或 Dockerfile 中显式设置 `ENABLE_METRICS=true` 作为默认值，或在健康检查脚本中增加 `/metrics` 端点可达性校验，确保监控可用 |
| CORS 配置 `allow_origins=["*"]` 完全放开跨域 | `/metrics` 端点虽通过 `excluded_handlers` 不被自身采集，但仍可被任意域的恶意页面通过跨域请求访问，结合 CSRF 或信息泄露风险，可能暴露内部服务指标细节 | 生产环境将 `allow_origins` 收紧为可信域名白名单；对 `/metrics` 端点增加 IP 白名单中间件或 Basic Auth 鉴权，仅允许 Prometheus 所在网段访问 |
| 数据库连接信息硬编码在默认值中（`postgresql://user:password@db:5432/prometheus_db`） | 若生产环境未通过 `DATABASE_URL` 环境变量覆盖，将使用默认弱密码，存在数据库被未授权访问的风险；同时密码以明文形式写入代码仓库，违反安全最佳实践 | 删除代码中的默认密码硬编码，改为启动时强制从环境变量读取；使用 Secret 管理工具（如 Kubernetes Secrets、HashiCorp Vault）存储敏感配置，并在 CI 中增加密钥扫描 |
| `should_ignore_untemplated=True` 忽略未模板化路由 | 所有 404 请求（如路径扫描、漏洞探测、拼写错误的 API 调用）不会被计入 `http_requests_total` 等指标，导致无法监控异常流量攻击或 API 误用，运维侧无法感知 404 洪峰 | 生产环境建议设为 `should_ignore_untemplated=False`，或在前端网关（Nginx/Envoy）层单独统计 4xx/5xx 错误率，作为补充可观测手段 |
