# EA Tools

EA tools are split by runtime purpose:

- `platform_tools`: platform control tools exposed back to the agent runtime, such as scheduling, notifications, channel lookup, and external Agent task submission.
- `business_tools`: business capability MCP implementations or adapters used directly by the agent runtime to answer user questions.

Business tool server IDs should stay domain-oriented, for example `wealth_assistant_customer`, `post_loan_risk_data`, or `credential_image_workspace`.
Platform control tools use the shared server ID `platform_tools`.
