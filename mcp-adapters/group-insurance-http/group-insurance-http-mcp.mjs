/**
 * 团险HTTP MCP适配器 - 标准MCP协议实现
 *
 * 功能：
 * 1. 实现标准HTTP MCP协议（GET /health, POST /mcp）
 * 2. 支持JSON-RPC 2.0协议
 * 3. 实现initialize, tools/list, tools/call三个标准MCP方法
 * 4. 第一版只暴露一个工具：group_insurance_audit_workflow
 * 5. 将标准MCP请求翻译成现有Python服务的/call_tool请求
 *
 * 监听：127.0.0.1:17895
 * 协议：HTTP MCP (JSON-RPC 2.0)
 */

import http from 'http';
import fs from 'fs';

// 内联dotenv替代 - 读取.env文件
function loadEnv(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  } catch (e) { /* env文件不存在时使用默认值 */ }
}

// 尝试加载env文件
loadEnv('/root/.openclaw/mcp/http-proxy/group-insurance-http-mcp.env');
loadEnv('./group-insurance-http-mcp.env');

// 配置
const HOST = process.env.HOST || '127.0.0.1';
const PORT = process.env.PORT || 17895;
const GROUP_INSURANCE_WORKFLOW_URL = process.env.GROUP_INSURANCE_WORKFLOW_URL || 'http://127.0.0.1:6080/call_tool';
const GROUP_INSURANCE_INTERNAL_TOKEN = process.env.GROUP_INSURANCE_INTERNAL_TOKEN || 'replace-me';
const GROUP_INSURANCE_TIMEOUT_MS = parseInt(process.env.GROUP_INSURANCE_TIMEOUT_MS || '600000', 10);

// MCP协议版本
const MCP_PROTOCOL_VERSION = '2025-03-26';

// 工具定义 - 第一版只暴露一个工具
const TOOLS = [
  {
    name: 'group_insurance_audit_workflow',
    description: '调用团险审核/团单解读工作流，根据企业名称、任务编号、保单材料、报价单材料等信息，输出团险审核结论、风险点和处理建议。',
    inputSchema: {
      type: 'object',
      properties: {
        company: {
          type: 'string',
          description: '企业或投保单位名称'
        },
        task_id: {
          type: 'string',
          description: '业务任务编号，可选'
        },
        query: {
          type: 'string',
          description: '用户提出的审核问题或补充说明'
        },
        materials: {
          type: 'array',
          description: '材料列表，可放文件路径、URL、图片ID或文本摘要',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              name: { type: 'string' },
              path: { type: 'string' },
              url: { type: 'string' },
              text: { type: 'string' },
              image_id: { type: 'string' }
            }
          }
        }
      },
      required: ['company']
    }
  }
];

/**
 * 调用后端Python服务
 */
async function callBackendService(toolName, args, headers) {
  return new Promise((resolve, reject) => {
    const timeout = GROUP_INSURANCE_TIMEOUT_MS;
    const timer = setTimeout(() => {
      reject(new Error(`Backend service timeout after ${timeout}ms`));
    }, timeout);

    // 构造请求体 - 翻译成/call_tool格式
    const requestBody = JSON.stringify({
      tool: toolName,
      arguments: args
    });

    // 解析后端URL
    const urlParts = GROUP_INSURANCE_WORKFLOW_URL.split('/');
    const backendHost = urlParts[2].split(':')[0];
    const backendPort = urlParts[2].split(':')[1] || 80;
    const backendPath = '/' + urlParts.slice(3).join('/');

    // 构造请求选项
    const options = {
      hostname: backendHost,
      port: backendPort,
      path: backendPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
        'Authorization': `Bearer ${GROUP_INSURANCE_INTERNAL_TOKEN}`,
        'x-openclaw-agent-id': headers['x-openclaw-agent-id'] || '',
        'x-jiuwen-channel-id': headers['x-jiuwen-channel-id'] || '',
        'User-Agent': headers['user-agent'] || 'group-insurance-http-mcp'
      }
    };

    // 发送请求
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (error) {
          reject(new Error(`Failed to parse backend response: ${error.message}`));
        }
      });
    });

    req.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`Backend service error: ${error.message}`));
    });

    req.write(requestBody);
    req.end();
  });
}

/**
 * 处理JSON-RPC请求
 */
async function handleJsonRpcRequest(body, headers) {
  const { jsonrpc, id, method, params } = body;

  // 验证JSON-RPC版本
  if (jsonrpc !== '2.0') {
    return {
      jsonrpc: '2.0',
      id: id,
      error: {
        code: -32600,
        message: 'Invalid Request: jsonrpc version must be 2.0'
      }
    };
  }

  // 处理不同方法
  try {
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'group-insurance-http-mcp',
              version: '1.0.0'
            }
          }
        };

      case 'notifications/initialized':
        // 这是一个通知，不需要响应
        return null;

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id: id,
          result: {
            tools: TOOLS
          }
        };

      case 'tools/call':
        const { name, arguments: args } = params;

        // 验证工具名称
        if (!TOOLS.find(t => t.name === name)) {
          return {
            jsonrpc: '2.0',
            id: id,
            error: {
              code: -32602,
              message: `Invalid params: tool '${name}' not found`
            }
          };
        }

        // 调用后端服务
        const backendResult = await callBackendService(name, args || {}, headers);

        // 构造标准MCP响应
        return {
          jsonrpc: '2.0',
          id: id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(backendResult, null, 2)
              }
            ],
            details: {
              ok: backendResult.ok || true,
              source: backendResult.source || 'group-insurance-workflow'
            }
          }
        };

      default:
        return {
          jsonrpc: '2.0',
          id: id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`
          }
        };
    }
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id: id,
      error: {
        code: -32603,
        message: `Internal error: ${error.message}`
      }
    };
  }
}

/**
 * HTTP请求处理
 */
async function handleRequest(req, res) {
  const { method, url, headers } = req;

  // 记录请求日志
  console.log(`[${new Date().toISOString()}] ${method} ${url}`);

  // GET /health - 健康检查
  if (method === 'GET' && url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'group-insurance-http-mcp',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      backend_url: GROUP_INSURANCE_WORKFLOW_URL,
      backend_timeout_ms: GROUP_INSURANCE_TIMEOUT_MS
    }));
    return;
  }

  // POST /mcp - 标准MCP接口
  if (method === 'POST' && url === '/mcp') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const jsonBody = JSON.parse(body);
        const response = await handleJsonRpcRequest(jsonBody, headers);

        // notifications/initialized不需要响应
        if (response === null) {
          res.writeHead(204);
          res.end();
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: `Parse error: ${error.message}`
          }
        }));
      }
    });
    return;
  }

  // 其他请求 - 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: 'Not Found',
    message: `Unknown endpoint: ${method} ${url}`,
    available_endpoints: [
      'GET /health',
      'POST /mcp'
    ]
  }));
}

/**
 * 启动HTTP服务器
 */
const server = http.createServer(handleRequest);

server.listen(PORT, HOST, () => {
  console.log(`✅ 团险HTTP MCP适配器已启动`);
  console.log(`   监听地址: http://${HOST}:${PORT}`);
  console.log(`   MCP端点: POST http://${HOST}:${PORT}/mcp`);
  console.log(`   健康检查: GET http://${HOST}:${PORT}/health`);
  console.log(`   后端服务: ${GROUP_INSURANCE_WORKFLOW_URL}`);
  console.log(`   超时时间: ${GROUP_INSURANCE_TIMEOUT_MS}ms`);
  console.log(`   工具数量: ${TOOLS.length}个`);
  console.log(`   工具列表: ${TOOLS.map(t => t.name).join(', ')}`);
  console.log('');
  console.log('等待MCP请求...');
});

// 错误处理
server.on('error', (error) => {
  console.error(`❌ 服务器错误: ${error.message}`);
  if (error.code === 'EADDRINUSE') {
    console.error(`   端口 ${PORT} 已被占用`);
  }
  process.exit(1);
});

// 进程信号处理
process.on('SIGTERM', () => {
  console.log('收到SIGTERM信号，关闭服务器...');
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('收到SIGINT信号，关闭服务器...');
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});

export default server;