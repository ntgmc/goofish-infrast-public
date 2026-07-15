import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss(), localDevCacheResetPlugin()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    headers: {
      "Cache-Control": "no-store",
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: false,
      },
    },
  },
});

function localDevCacheResetPlugin(): Plugin {
  return {
    name: "local-dev-cache-reset",
    configureServer(server) {
      server.middlewares.use("/__dev/reset-cache", (_req, res) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html;charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Clear-Site-Data", '"cache"');
        res.end(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Reset local dev cache</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; color: #172033; background: #f8fafc; }
      main { width: min(28rem, calc(100vw - 2rem)); border: 1px solid #d7dde8; border-radius: 12px; background: white; padding: 1.25rem; box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08); }
      h1 { margin: 0 0 0.75rem; font-size: 1.125rem; }
      pre { margin: 0; white-space: pre-wrap; color: #526071; line-height: 1.6; }
    </style>
  </head>
  <body>
    <main>
      <h1>正在清理本地开发缓存</h1>
      <pre id="status">准备中...</pre>
    </main>
    <script>
      const status = document.getElementById('status');
      const lines = [];

      async function reset() {
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((registration) => registration.unregister()));
          lines.push('Service workers: ' + registrations.length + ' removed');
        } else {
          lines.push('Service workers: unavailable');
        }

        if ('caches' in window) {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
          lines.push('CacheStorage: ' + cacheNames.length + ' removed');
        } else {
          lines.push('CacheStorage: unavailable');
        }

        lines.push('正在返回首页...');
        status.textContent = lines.join('\\n');

        const nextUrl = new URL('/', window.location.href);
        nextUrl.searchParams.set('dev_reset', String(Date.now()));
        window.setTimeout(() => window.location.replace(nextUrl.toString()), 600);
      }

      reset().catch((error) => {
        lines.push('清理失败: ' + (error && error.message ? error.message : String(error)));
        status.textContent = lines.join('\\n');
      });
    </script>
  </body>
</html>`);
      });
    },
  };
}
