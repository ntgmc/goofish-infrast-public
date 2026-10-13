# Nginx 安全部署

生产站点通过 HTTPS 提供前端和同源 API。将下列配置复制到
`/etc/nginx/snippets/`，保留原文件名：

| 配置 | 用途 |
| --- | --- |
| [goofish-security-headers.conf](../deploy/nginx/goofish-security-headers.conf) | 安全响应头，包含 HSTS |
| [goofish-server-hardening.conf](../deploy/nginx/goofish-server-hardening.conf) | 请求头、连接超时及服务器信息设置 |
| [goofish-static-files.conf](../deploy/nginx/goofish-static-files.conf) | 静态资源缓存、缺失资源 404 和 SPA 路由回退 |

在现有 HTTPS `server` 块中引入安全响应头和连接设置；静态文件配置放在
现有 API 代理配置之后：

```nginx
include /etc/nginx/snippets/goofish-security-headers.conf;
include /etc/nginx/snippets/goofish-server-hardening.conf;

# 保留现有 API 代理配置。
include /etc/nginx/snippets/goofish-static-files.conf;
```

安全响应头配置仅用于 TLS/HTTPS 的 `server` 块及其 `location`，不能加入
HTTP 跳转块。HSTS 包含 `includeSubDomains`，启用前应确认所有子域均支持 HTTPS。
静态文件配置会在设置缓存头的 `location` 中再次引入安全响应头，避免 Nginx 的
`add_header` 继承规则使安全响应头丢失。

修改后先运行 `nginx -t`，通过后再重载。检查首页、API 和不存在的 `/assets/`
文件的响应头；缺失资源应返回 404，SPA 页面路由应仍能打开。
仓库的自动检查为 `node scripts/check-http-security-baseline.mjs`。
