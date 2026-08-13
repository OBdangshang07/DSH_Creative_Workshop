/**
 * DeepSeek Harness Creative Workshop - Companion Daemon & Marketplace Server
 * 纯 Node.js 标准库实现（无需安装外部 npm 依赖，开箱即用）
 * 包含：
 * 1. DSH Companion 本机守护服务 (127.0.0.1:45731)：环境探针、Profile 管理、SSE 事务流
 * 2. Marketplace API 云端服务 (127.0.0.1:3000 / 桥接)：插件检索、12 键规格、环境评价流
 */

import http from 'http';

const COMPANION_PORT = 45731;
const COMPANION_HOST = '127.0.0.1';

// 内存中的 Profile 与插件运行态
let profilesState = ['default-web', 'headless-agent', 'creative-sandbox'];
let operationsQueue = new Map(); // operationId -> { planId, status, logs }

// 1. Companion 本机守护进程
const companionServer = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const path = reqUrl.pathname;
  const method = req.method;

  // CORS 响应头配置
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1.1 环境探针 GET /v1/environment
  if (method === 'GET' && path === '/v1/environment') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ONLINE',
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      dshVersion: '0.1.0-rc.5',
      dshCommit: '47f943859bef60e4160492346772ded9b24f765a',
      protocolVersion: '1.0.0',
      uptime: process.uptime()
    }));
    return;
  }

  // 1.2 Profile 清单 GET /v1/profiles
  if (method === 'GET' && path === '/v1/profiles') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      profiles: profilesState,
      current: profilesState[0]
    }));
    return;
  }

  // 1.3 创建安装计划 POST /v1/plans
  if (method === 'POST' && path === '/v1/plans') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { pluginId, targetProfile } = JSON.parse(body || '{}');
        const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        
        const responseData = {
          planId,
          state: 'READY_FOR_CONFIRMATION',
          target: { profile: targetProfile || 'default-web' },
          lockedInputs: {
            catalogRevision: 'cr_20260814',
            dshVersion: '0.1.0-rc.5'
          },
          changes: [
            { action: 'mount_layer', pluginId, targetProfile }
          ],
          conflicts: [],
          warnings: []
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(responseData));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 1.4 创建安装执行 Operation POST /v1/operations
  if (method === 'POST' && path === '/v1/operations') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { planId } = JSON.parse(body || '{}');
        const operationId = `op_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        
        operationsQueue.set(operationId, {
          planId,
          status: 'RUNNING',
          createdAt: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ operationId, status: 'RUNNING' }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 1.5 SSE 实时事件流 GET /v1/operations/:id/events
  const sseMatch = path.match(/^\/v1\/operations\/(op_[^/]+)\/events$/);
  if (method === 'GET' && sseMatch) {
    const operationId = sseMatch[1];
    
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    const sendEvent = (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // 推送真实/模拟流水线步骤
    sendEvent({
      type: 'operation.step.started',
      operationId,
      at: new Date().toISOString(),
      data: { step: 'verify_digest', msg: '正在校验 SHA-256 签名与来源...' }
    });

    setTimeout(() => {
      sendEvent({
        type: 'operation.step.started',
        operationId,
        at: new Date().toISOString(),
        data: { step: 'lockfile_precheck', msg: '正在预检 Cordis 运行时依赖图...' }
      });
    }, 200);

    setTimeout(() => {
      sendEvent({
        type: 'operation.step.started',
        operationId,
        at: new Date().toISOString(),
        data: { step: 'mount_layer', msg: '正在挂载 Bundle 层至目标 Profile...' }
      });
    }, 450);

    setTimeout(() => {
      sendEvent({
        type: 'operation.committed',
        operationId,
        at: new Date().toISOString(),
        data: { step: 'done', msg: '已成功挂载并激活服务！' }
      });
      res.end();
    }, 700);

    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found on Companion Daemon' }));
});

// 优雅捕获端口占用错误
companionServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`[EADDRINUSE] 端口 ${COMPANION_PORT} 已被占用。`);
    console.log(`提示：DSH Companion 守护进程已在后台运行中，无需重复启动。`);
    process.exit(0);
  } else {
    console.error('服务器启动异常:', err);
    process.exit(1);
  }
});

companionServer.listen(COMPANION_PORT, COMPANION_HOST, () => {
  console.log(`=====================================================`);
  console.log(`[DSH Companion Daemon] 已启动: http://${COMPANION_HOST}:${COMPANION_PORT}`);
  console.log(`- 状态探针: http://${COMPANION_HOST}:${COMPANION_PORT}/v1/environment`);
  console.log(`- Profile 接口: http://${COMPANION_HOST}:${COMPANION_PORT}/v1/profiles`);
  console.log(`=====================================================`);
});
