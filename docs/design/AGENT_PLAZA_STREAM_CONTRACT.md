# Agent Plaza Stream Contract

本文记录智能体广场 `/api/claw/business-chat-stream` 当前前端消费的 SSE 事件形态。后端拆分 runtime adapter 时，默认必须保持这些事件兼容，避免误伤 `task-*` 的定制展示。

## 基本传输

- 请求：`POST /api/claw/business-chat-stream`
- 请求体：`{ agentId, message, sessionKey? }`
- 响应头：`Content-Type: text/event-stream`
- 会话头：`X-Session-Key`
- 结束标记：`data: [DONE]`

## 通用文本事件

OpenAI-style delta 是最基础的文本输出协议：

```json
{
  "choices": [
    {
      "delta": {
        "content": "文本增量"
      }
    }
  ]
}
```

前端行为：

- `client/src/lib/businessChatStore.ts` 将 `choices[0].delta.content` 追加到最后一条 assistant 消息。
- MCP / A2A adapter 当前也归一化成这个形态。

## 状态事件

```json
{
  "__status": "A2A: message/send..."
}
```

前端行为：

- 显示为最后一条 assistant 消息的临时状态。
- 收到文本 delta 后状态会被清空。

## Hermes 工具事件

工具开始：

```json
{
  "__hermes_tool": "started",
  "id": "tool-id",
  "name": "tool-name",
  "preview": "可选预览"
}
```

工具完成：

```json
{
  "__hermes_tool": "completed",
  "is_error": false,
  "durationMs": 1234
}
```

前端行为：

- `started` 增加 running toolCall。
- `completed` 将最近一个 running toolCall 标记为 done/error。

## Hermes 推理事件

```json
{
  "__reasoning": "推理过程增量"
}
```

前端行为：

- 追加到 assistant 消息的 `reasoning` 字段。

## 错误事件

```json
{
  "error": "错误信息"
}
```

前端行为：

- 结束当前消息，并显示错误文本。

## 文件产物兼容

PPT / Code / Slides 等任务仍依赖历史文件服务与文本标记：

```html
<!-- __files:[{"name":"xxx.pptx","url":"..."}] -->
```

前端行为：

- `client/src/components/CollabDrawer.tsx` 会从 assistant 文本中提取 `__files` 标记。
- 文件下载仍走 `/api/claw/business-files/download?agentId=...&file=...`。
- 文件列表仍走 `/api/claw/business-files?agentId=...`。

## 重构守则

1. 先迁移后端执行代码，不改变 SSE 输出形态。
2. 每迁一个 adapter，至少验证 `choices.delta.content`、`__status`、错误事件不回归。
3. `task-ppt`、`task-code`、`task-slides` 迁移前必须验证 `__files` 标记和 file-service source。
4. Hermes 系列迁移前必须验证 `__hermes_tool` 与 `__reasoning`。
5. 统一新事件协议前，保留以上 legacy event 作为兼容层。
