import { useState, useEffect } from 'react'
import axios from 'axios'
import {
    Activity,
    BarChart3,
    Clock,
    AlertCircle,
    Plus,
    Database,
    Terminal,
    Server,
    Layout
} from 'lucide-react'
import { toast } from 'react-toastify'

const API_BASE_URL = 'http://localhost:8000';

function App() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [newItem, setNewItem] = useState({ name: '', description: '' });
    const [lastResponse, setLastResponse] = useState(null);

    const fetchItems = async () => {
        try {
            const response = await axios.get(`${API_BASE_URL}/api/items`);
            setItems(response.data);
        } catch (error) {
            toast.error('获取列表失败');
        }
    };

    useEffect(() => {
        fetchItems();
    }, []);

    const handleApiCall = async (type) => {
        setLoading(true);
        try {
            let response;
            const startTime = performance.now();

            switch (type) {
                case 'success':
                    response = await axios.get(`${API_BASE_URL}/api/success`);
                    toast.success('请求成功');
                    break;
                case 'slow':
                    response = await axios.get(`${API_BASE_URL}/api/slow`);
                    toast.info('慢请求完成');
                    break;
                case 'error':
                    response = await axios.get(`${API_BASE_URL}/api/error`);
                    break;
                default:
                    break;
            }

            const endTime = performance.now();
            setLastResponse({
                type,
                status: response.status,
                latency: (endTime - startTime).toFixed(0),
                data: response.data
            });
        } catch (error) {
            const endTime = performance.now();
            toast.error('请求失败');
            setLastResponse({
                type,
                status: error.response?.status || 500,
                latency: (endTime - startTime).toFixed(0),
                data: error.response?.data || 'Unknown error'
            });
        } finally {
            setLoading(false);
        }
    };

    const addItem = async (e) => {
        e.preventDefault();
        if (!newItem.name || !newItem.description) {
            toast.warning('请填写完整信息');
            return;
        }

        try {
            await axios.post(`${API_BASE_URL}/api/items?name=${newItem.name}&description=${newItem.description}`);
            toast.success('添加成功');
            setNewItem({ name: '', description: '' });
            fetchItems();
        } catch (error) {
            toast.error('添加失败');
        }
    };

    return (
        <div className="min-h-screen p-6 md:p-12 text-slate-100">
            <div className="max-w-6xl mx-auto space-y-8">

                {/* Header */}
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-700 pb-8">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-600 rounded-2xl shadow-lg shadow-blue-500/20">
                            <Activity className="w-8 h-8 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight">Prometheus 监控实战</h1>
                            <p className="text-slate-400">React + FastAPI + Prometheus + Grafana 示例工程</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <span className="px-3 py-1 bg-slate-800 rounded-full text-xs font-mono text-blue-400 border border-slate-700 flex items-center gap-1">
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                            Backend Online
                        </span>
                    </div>
                </header>

                {/* Dash Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                    {/* API Playground */}
                    <section className="md:col-span-2 glass-card rounded-3xl p-6 space-y-6">
                        <div className="flex items-center gap-2 mb-2">
                            <BarChart3 className="w-5 h-5 text-blue-400" />
                            <h2 className="text-xl font-semibold">请求模拟器 (Trigger Metrics)</h2>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <button
                                onClick={() => handleApiCall('success')}
                                disabled={loading}
                                className="flex flex-col items-center justify-center gap-3 p-6 rounded-2xl bg-slate-800/50 hover:bg-green-500/10 border border-slate-700 hover:border-green-500/30 transition-all group"
                            >
                                <div className="p-2 bg-green-500/20 rounded-lg group-hover:scale-110 transition-transform">
                                    <Activity className="w-6 h-6 text-green-400" />
                                </div>
                                <span className="font-medium text-green-400">成功请求</span>
                                <span className="text-xs text-slate-500">HTTP 200</span>
                            </button>

                            <button
                                onClick={() => handleApiCall('slow')}
                                disabled={loading}
                                className="flex flex-col items-center justify-center gap-3 p-6 rounded-2xl bg-slate-800/50 hover:bg-yellow-500/10 border border-slate-700 hover:border-yellow-500/30 transition-all group"
                            >
                                <div className="p-2 bg-yellow-500/20 rounded-lg group-hover:scale-110 transition-transform">
                                    <Clock className="w-6 h-6 text-yellow-400" />
                                </div>
                                <span className="font-medium text-yellow-400">延迟请求</span>
                                <span className="text-xs text-slate-500">Delay 1-2s</span>
                            </button>

                            <button
                                onClick={() => handleApiCall('error')}
                                disabled={loading}
                                className="flex flex-col items-center justify-center gap-3 p-6 rounded-2xl bg-slate-800/50 hover:bg-red-500/10 border border-slate-700 hover:border-red-500/30 transition-all group"
                            >
                                <div className="p-2 bg-red-500/20 rounded-lg group-hover:scale-110 transition-transform">
                                    <AlertCircle className="w-6 h-6 text-red-400" />
                                </div>
                                <span className="font-medium text-red-400">错误请求</span>
                                <span className="text-xs text-slate-500">HTTP 500</span>
                            </button>
                        </div>

                        {/* Last Response Info */}
                        <div className="rounded-2xl bg-slate-900/50 border border-slate-800 p-4 font-mono text-sm">
                            <div className="flex items-center gap-2 mb-2 text-slate-500">
                                <Terminal className="w-4 h-4" />
                                <span>Last Response</span>
                            </div>
                            {lastResponse ? (
                                <div className="space-y-1">
                                    <p><span className="text-blue-400">Status:</span> {lastResponse.status}</p>
                                    <p><span className="text-blue-400">Latency:</span> {lastResponse.latency}ms</p>
                                    <pre className="text-slate-400 overflow-x-auto text-xs mt-2">
                                        {JSON.stringify(lastResponse.data, null, 2)}
                                    </pre>
                                </div>
                            ) : (
                                <p className="text-slate-600 italic">等待操作...</p>
                            )}
                        </div>
                    </section>

                    {/* Monitoring Intro */}
                    <section className="glass-card rounded-3xl p-6 flex flex-col justify-between space-y-4">
                        <div>
                            <div className="flex items-center gap-2 mb-4">
                                <Server className="w-5 h-5 text-purple-400" />
                                <h2 className="text-xl font-semibold">指标说明</h2>
                            </div>
                            <ul className="space-y-4 text-sm text-slate-400">
                                <li className="flex gap-3">
                                    <div className="mt-1 w-1.5 h-1.5 bg-blue-500 rounded-full shrink-0"></div>
                                    <div>
                                        <strong className="text-slate-200 block mb-1">QPS (Queries Per Second)</strong>
                                        统计每秒请求数。Prometheus 通过 counter 指标 `http_requests_total` 计算获得。
                                    </div>
                                </li>
                                <li className="flex gap-3">
                                    <div className="mt-1 w-1.5 h-1.5 bg-yellow-500 rounded-full shrink-0"></div>
                                    <div>
                                        <strong className="text-slate-200 block mb-1">P99 Latency (耗时)</strong>
                                        表示 99% 的请求都在此耗时内。通过 histogram 指标 `http_request_duration_seconds_bucket` 计算。
                                    </div>
                                </li>
                                <li className="flex gap-3">
                                    <div className="mt-1 w-1.5 h-1.5 bg-red-500 rounded-full shrink-0"></div>
                                    <div>
                                        <strong className="text-slate-200 block mb-1">Error Rate (错误率)</strong>
                                        统计非 2xx/3xx 响应的占比。
                                    </div>
                                </li>
                            </ul>
                        </div>
                        <a
                            href="http://localhost:9090"
                            target="_blank"
                            rel="noreferrer"
                            className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-center font-medium transition-colors flex items-center justify-center gap-2"
                        >
                            <Layout className="w-4 h-4" />
                            查看 Prometheus 面板
                        </a>
                    </section>

                    {/* Database Demo */}
                    <section className="md:col-span-3 glass-card rounded-3xl p-6">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-2">
                                <Database className="w-5 h-5 text-emerald-400" />
                                <h2 className="text-xl font-semibold">数据库读写测试</h2>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                            {/* Form */}
                            <div className="lg:col-span-1 space-y-4">
                                <form onSubmit={addItem} className="space-y-4">
                                    <input
                                        type="text"
                                        placeholder="名称"
                                        value={newItem.name}
                                        onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-blue-500 outline-none transition-all"
                                    />
                                    <textarea
                                        placeholder="描述"
                                        value={newItem.description}
                                        onChange={e => setNewItem({ ...newItem, description: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-blue-500 outline-none transition-all h-24"
                                    />
                                    <button className="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors">
                                        <Plus className="w-4 h-4" />
                                        添加记录
                                    </button>
                                </form>
                            </div>

                            {/* Table */}
                            <div className="lg:col-span-2 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-800/50 text-slate-400 text-sm">
                                            <th className="px-6 py-4 font-medium">ID</th>
                                            <th className="px-6 py-4 font-medium">名称</th>
                                            <th className="px-6 py-4 font-medium">描述</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800">
                                        {items.length > 0 ? items.map(item => (
                                            <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                                                <td className="px-6 py-4 text-slate-500">{item.id}</td>
                                                <td className="px-6 py-4 font-medium">{item.name}</td>
                                                <td className="px-6 py-4 text-slate-400">{item.description}</td>
                                            </tr>
                                        )) : (
                                            <tr>
                                                <td colSpan="3" className="px-6 py-12 text-center text-slate-600 italic">暂无数据</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </section>
                </div>

                {/* Footer */}
                <footer className="text-center text-slate-500 text-sm py-8 border-t border-slate-800">
                    <p>© 2024 Prometheus Monitoring Fullstack Demo. Powered by FastAPI & React.</p>
                </footer>
            </div>
        </div>
    )
}

export default App
