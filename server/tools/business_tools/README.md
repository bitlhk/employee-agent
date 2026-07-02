# Business Tools

Business tools are MCP implementations or adapters that expose domain data and domain actions to the agent runtime.

Current groups:

- `finance`: wealth assistant, Wind bridge, Qieman bridge, bond quote adapters
- `risk`: post-loan risk data MCP
- `credential`: credential extraction and workspace adapters
- `insurance`: insurance knowledge base and group-insurance adapters

Runtime deployment can still point to existing PM2 processes while the source lives here. Deployment configs should use environment variables or `.env.example` files and must not commit real credentials.
