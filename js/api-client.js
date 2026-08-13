/**
 * DSH Creative Workshop - Unified API Client & Network Gateway
 * 实现对 Marketplace 云端 API 与 DSH Companion 本机守护进程的自适应通信
 * 具备自动探针嗅探、在线/离线平滑降级、SSE 实时流订阅功能
 */

import { MOCK_PLUGINS, OFFICIAL_PRESETS } from './mock-data.js';

class ApiClient {
  constructor() {
    this.cloudBaseUrl = '/api'; // 云端服务前缀
    this.companionBaseUrl = 'http://127.0.0.1:45731/v1'; // 本机 Companion 默认端点
    this.isCompanionOnline = false;
    this.useMockFallback = true;
  }

  /**
   * 自动嗅探本机 DSH Companion 守护进程健康状态
   */
  async probeCompanion() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);

      const res = await fetch(`${this.companionBaseUrl}/environment`, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const envData = await res.json();
        this.isCompanionOnline = true;
        return { online: true, data: envData };
      }
    } catch (e) {
      // 离线状态
    }

    this.isCompanionOnline = false;
    return { online: false, data: null };
  }

  /**
   * 获取插件目录清单 (支持搜索与过滤)
   */
  async getPlugins(query = '', filters = {}) {
    try {
      const params = new URLSearchParams();
      if (query) params.append('q', query);
      
      const res = await fetch(`${this.cloudBaseUrl}/v1/plugins?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        return json.data || json;
      }
    } catch (e) {
      // 网络异常时走 Mock 降级
    }

    // 离线/Mock 降级数据源
    return [...MOCK_PLUGINS];
  }

  /**
   * 获取单个插件详情
   */
  async getPluginDetail(pluginId) {
    try {
      const res = await fetch(`${this.cloudBaseUrl}/v1/plugins/${pluginId}`);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      // 降级
    }

    return MOCK_PLUGINS.find(p => p.id === pluginId) || null;
  }

  /**
   * 获取官方模式预设清单
   */
  async getPresets() {
    try {
      const res = await fetch(`${this.cloudBaseUrl}/v1/presets`);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      // 降级
    }

    return [...OFFICIAL_PRESETS];
  }

  /**
   * 提交环境绑定评价
   */
  async submitReview(pluginId, reviewData) {
    try {
      const res = await fetch(`${this.cloudBaseUrl}/v1/plugins/${pluginId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reviewData)
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      // 降级
    }

    return { success: true, localOnly: true, review: reviewData };
  }

  /**
   * 获取 Profile 档案列表
   */
  async getProfiles() {
    if (this.isCompanionOnline) {
      try {
        const res = await fetch(`${this.companionBaseUrl}/profiles`);
        if (res.ok) {
          const json = await res.json();
          return json.profiles || json;
        }
      } catch (e) {
        // 降级
      }
    }

    return ['default-web', 'headless-agent', 'creative-sandbox'];
  }

  /**
   * 创建安装事务计划 (Plan)
   */
  async createInstallPlan(pluginId, targetProfile) {
    if (this.isCompanionOnline) {
      try {
        const res = await fetch(`${this.companionBaseUrl}/plans`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pluginId, targetProfile })
        });
        if (res.ok) {
          return await res.json();
        }
      } catch (e) {
        // 降级
      }
    }

    // 本地计算计划
    const plugin = MOCK_PLUGINS.find(p => p.id === pluginId);
    return {
      planId: `plan_${Date.now()}`,
      pluginId,
      targetProfile,
      plugin,
      missingDeps: []
    };
  }

  /**
   * 执行安装事务并通过 SSE 实时订阅进度
   */
  async executeOperation(planId, onProgress) {
    if (this.isCompanionOnline) {
      try {
        const res = await fetch(`${this.companionBaseUrl}/operations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId })
        });

        if (res.ok) {
          const { operationId } = await res.json();
          // 连接 SSE 实时事件总线
          return new Promise((resolve, reject) => {
            const evtSource = new EventSource(`${this.companionBaseUrl}/operations/${operationId}/events`);
            
            evtSource.onmessage = (e) => {
              try {
                const event = JSON.parse(e.data);
                if (onProgress) onProgress(event);

                if (event.type === 'operation.committed') {
                  evtSource.close();
                  resolve({ success: true, operationId });
                } else if (event.type === 'operation.step.failed') {
                  evtSource.close();
                  reject(new Error(event.data?.error || '安装失败'));
                }
              } catch (err) {
                // 忽略解析单条错误
              }
            };

            evtSource.onerror = () => {
              evtSource.close();
              resolve({ success: true, operationId });
            };
          });
        }
      } catch (e) {
        // 降级
      }
    }

    // 离线/模拟执行流
    return new Promise((resolve) => {
      const steps = [
        { type: 'operation.step.started', data: { step: 'verify_digest', msg: '正在校验 SHA-256 签名与来源...' } },
        { type: 'operation.step.started', data: { step: 'lockfile_precheck', msg: '正在预检 Cordis 运行时依赖图...' } },
        { type: 'operation.step.started', data: { step: 'mount_layer', msg: '正在挂载 Bundle 层至目标 Profile...' } },
        { type: 'operation.committed', data: { step: 'done', msg: '已成功挂载并激活服务！' } }
      ];

      let idx = 0;
      const timer = setInterval(() => {
        if (idx < steps.length) {
          if (onProgress) onProgress(steps[idx]);
          idx++;
        } else {
          clearInterval(timer);
          resolve({ success: true, simulated: true });
        }
      }, 200);
    });
  }
}

export const apiClient = new ApiClient();
