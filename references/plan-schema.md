# 方案与状态

工作区 `private/plan.json` 和 `private/approval.json` 不作为静态文件公开；页面仅获取展示字段，文件身份留在私有文件中。

## plan.json（version 1）

```json
{
  "version": 1,
  "title": "我的相册整理",
  "mode": "live",
  "method": "move_in_place",
  "source": {"fid": "官方完整目录身份", "path": "/选中的相册"},
  "target": {"fid": "同一个目录身份", "path": "/选中的相册"},
  "rules": ["先按地点，再分媒体和主题", "证据不足放入未知"],
  "validation": {"ready": true, "providerDigest": "官方check返回值", "proposalPath": "/任务/proposal.json", "taskDir": "/任务", "executionSupported": true},
  "items": [
    {"id": "item-001", "fid": "完整文件身份", "parentFid": "原父目录", "filename": "原文件名.jpg", "media": "photo", "size": 1048576, "destination": ["地点A", "照片", "风景"], "thumbnail": "thumbs/item-001.svg"}
  ]
}
```

- 每个纳入范围的源文件恰好一项；`id` 和文件身份唯一。未知也有目标，不能遗漏。
- `size` 为非负字节数或 `null`（未知）。媒体类型为 `photo`、`video`、`other`，数量动态计算。
- `destination` 为相对目标根的目录名数组，禁止空段、`.`、`..`、路径分隔符和控制字符。
- `thumbnail` 可省略；提供时仅指向工作区 `public/thumbs/` 内的本地文件，禁止外部 URL、路径穿越和外部符号链接。
- `newName` 仅在用户要求改名时提供；同目标同名会被拒绝，不自动覆盖或补序号。
- `method` 为 `move_in_place`、`move`、`copy`。`move_in_place` 要求源目标相同；其他方式须由用户选择且提供方支持。
- `mode: demo` 使用虚构身份，永远不能生成真实执行指令。
- 未完成校验或不支持当前方式时，`validation.ready` / `executionSupported` 设为 false，预览可用、执行禁用。

导入生成规范化方案指纹。相同方案再次导入不清除确认；修订方案会使旧确认失效。已执行或结果未知的工作区不能覆盖来“重试”，先按提供方规则处理原任务。

## approval.json

最终按钮保存 `requestId`、`planDigest`、`providerDigest`、`source`、`target`、`method`、`itemCount`、`confirmedAt`，不含凭据。

Agent 执行前比对确认、当前方案和官方 proposal。确认仅授权显示的方案，不授权其他范围、后续修订或删除。

## status.json

`ready → queued / awaiting_agent → running → completed / partial / failed / needs_review`。

`delivery_unknown` 表示投递客户端超时，不能确定是否送达；保留原请求，不自动重发。`submitted` 表示只有接收回执，尚未完成。刷新与重播不清空状态。

状态含 `requestId`、`planDigest`、`phase`、`updatedAt`，可含 `serviceCounts: {success, failed, skipped}`、`fileCounts`、`resultLink`、`notice`、`error`。没有返回的计数为 null，不补零。

```text
node <skill-root>/scripts/status.mjs running --workspace <dir> --request-id <id> --message <进度>
node <skill-root>/scripts/status.mjs result --workspace <dir> --request-id <id> --result <官方结果JSON>
```

结果可为 JSON、NDJSON 或 `{result: {...}}`。脚本只回写网页，不操作云端、不自动重试。

无法取得本任务 apply 结果时，用 `problem --workspace <dir> --request-id <id> --error <错误>` 写入 `needs_review`，不宣称成功，也不推断是否发生部分变更。

真实方案必须提供官方 `taskDir`；回写结果的 `data.task_dir` 必须匹配该目录，不能把其他任务的成功结果当成本次完成。缺少字段时先按官方规则获取本任务结果，不能补造成功。
