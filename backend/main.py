import logging
import time
import random
import os
import asyncio
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy import create_engine, Column, Integer, String
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

# 数据库配置
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@db:5432/prometheus_db")
engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# 数据库模型
class Item(Base):
    __tablename__ = "items"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    description = Column(String)

# 初始化数据库
def init_db():
    # 尝试连接并在失败时重试，适用于 Docker Compose 启动顺序
    retries = 5
    while retries > 0:
        try:
            Base.metadata.create_all(bind=engine)
            logger.info("Database tables created successfully.")
            break
        except Exception as e:
            logger.error(f"Database connection failed: {e}. Retrying in 5 seconds...")
            retries -= 1
            time.sleep(5)

app = FastAPI(title="FastAPI Prometheus Demo")

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 依赖项：获取数据库会话
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Prometheus 监控配置
instrumentator = Instrumentator(
    should_group_status_codes=False,
    should_ignore_untemplated=True,
    should_respect_env_var=True,
    excluded_handlers=[".*admin.*", "/metrics"],
    env_var_name="ENABLE_METRICS",
)
instrumentator.instrument(app).expose(app)

@app.on_event("startup")
async def startup_event():
    init_db()
    logger.info("Application started.")

@app.get("/")
async def root():
    return {"message": "Welcome to FastAPI Prometheus Demo API"}

@app.get("/api/success")
async def success_endpoint():
    """模拟成功的请求"""
    logger.info("Success endpoint called")
    return {"status": "success", "data": "Hello World"}

@app.get("/api/slow")
async def slow_endpoint():
    """模拟耗时较长的请求"""
    delay = random.uniform(0.5, 2.0)
    logger.info(f"Slow endpoint called, sleeping for {delay:.2f}s")
    await asyncio.sleep(delay)
    return {"status": "success", "delay": delay}

@app.get("/api/error")
async def error_endpoint():
    """模拟故障的请求"""
    logger.error("Error endpoint called - simulating 500 failure")
    raise HTTPException(status_code=500, detail="Simulated Internal Server Error")

@app.get("/api/items")
async def read_items(db: Session = Depends(get_db)):
    """从数据库读取数据"""
    items = db.query(Item).all()
    return items

@app.post("/api/items")
async def create_item(name: str, description: str, db: Session = Depends(get_db)):
    """向数据库写入数据"""
    db_item = Item(name=name, description=description)
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    logger.info(f"Created item: {db_item.name}")
    return db_item

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
