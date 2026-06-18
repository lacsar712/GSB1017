监控指标通过 FastAPI Instrumentator 中间件自动采集业务请求，经 /metrics 端点以 Prometheus 文本格式暴露，最终由 Prometheus 按 5s 间隔 Pull 拉取并存储。

## 三层架构流转说明

### 第一层：业务处理层
业务 API 接收请求后，由 `prometheus_fastapi_instrumentator` 中间件自动拦截，在不侵入业务代码的前提下采集请求级指标，如请求计数、耗时、状态码分布等。涉及的业务端点包括 `/api/success`、`/api/slow`、`/api/error`、`/api/items` 等，每个端点的调用都会触发指标采集。

### 第二层：/metrics 暴露层
通过 `Instrumentator().instrument(app).expose(app)` 在 FastAPI 应用上挂载 `/metrics` 端点，将采集到的指标以 Prometheus 文本格式对外暴露。核心指标包括 `http_requests_total`、`http_request_duration_seconds`、`http_request_size_bytes`、`http_response_size_bytes` 等，指标名保持原生 snake_case。配置项 `excluded_handlers: [".*admin.*", "/metrics"]` 确保 `/metrics` 自身不被纳入采集统计，避免递归计数。

### 第三层：Prometheus Pull 拉取层
Prometheus 服务端通过 `prometheus.yml` 中的 `scrape_configs` 配置，以 `scrape_interval: 5s` 的频率主动拉取 `backend:8000` 目标的 `/metrics` 数据，存入本地时序数据库。`job_name: fastapi-service` 作为标签标识数据来源，`evaluation_interval: 5s` 控制告警规则评估频率。

---

## 生产环境风险分析

| 风险描述 | 影响 | 建议 |
|---------|------|------|
| scrape_interval 设置为 5s 过短，生产环境高频拉取会导致 Prometheus 存储膨胀、网络开销增大，且给后端服务带来额外压力 | 磁盘 IO 和存储成本急剧上升，可能引发 Prometheus OOM 或查询性能下降；目标服务 QPS 变相增加 | 建议生产环境调整为 15s~60s，根据业务重要性分级配置，核心链路可适当加密但不低于 10s |
| /metrics 端点未做任何认证保护，且 CORS 配置 allow_origins=["*"] 完全放开，外部可直接访问所有监控指标数据 | 指标数据中可能包含接口路径、流量规律等敏感信息，被攻击者利用进行指纹识别或容量探测；存在跨域数据泄露风险 | 为 /metrics 增加 Basic Auth 或 Token 认证，在 Prometheus scrape_config 中配置 basic_auth；收紧 CORS 策略，仅允许可信来源 |
| should_respect_env_var=True 且依赖 ENABLE_METRICS 环境变量开关，若部署时遗漏配置该变量，指标端点将失效 | 生产环境监控数据断流，告警体系失明，故障无法及时发现；排查问题时无历史指标可追溯 | 明确默认开启策略，或将 should_respect_env_var 设为 False；在部署清单（Helm/Docker Compose）中强制注入该环境变量并增加启动校验 |
| 数据库连接重试采用固定 5s 间隔，无指数退避和熔断机制，数据库长时间不可用时会产生大量失败日志和连接冲击 | 错误日志风暴挤占存储和分析资源；反复重试可能加剧数据库恢复难度；应用启动阻塞时间不可控 | 引入指数退避（exponential backoff）+ 抖动（jitter）策略，设置最大重试次数上限和熔断机制，失败后进入降级状态 |
