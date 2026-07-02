请从报价单图片<image>中提取以下信息：
1. 方案名称和方案内容
2. 特约条款
3. 层级信息
4. 保险责任和金额

以结构化JSON格式输出，格式如下：

result = {
    "scheme_name": "方案名称",
    "scheme_info": {
        "方案内容": "..."
    },
    "agreement": "特约内容",
    "hierarchy": {
        "层级": "..."
    }
}