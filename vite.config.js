import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { defineConfig } from "vite";
import { anniversaryApiMiddleware } from "./server/anniversary-api.js";

const anniversaryWeb = "oab-anniversary/web";
const anniversaryPages = new Map([
  [resolve(__dirname, "index.html"), resolve(__dirname, anniversaryWeb, "referral/index.html")],
  [resolve(__dirname, "pastcustomers.html"), resolve(__dirname, anniversaryWeb, "index.html")],
]);
const anniversaryRedirects = new Map([
  ["/referral", "/"],
  ["/referral/", "/"],
  ["/referral/index.html", "/"],
  ["/pastcustomers/", "/pastcustomers"],
  ["/pastcustomers/index.html", "/pastcustomers"],
]);

function anniversaryPageMiddleware(request, response, next) {
  if (request.method !== "GET" && request.method !== "HEAD") return next();

  const { pathname, search } = new URL(request.url, "http://localhost");
  const destination = anniversaryRedirects.get(pathname);
  if (destination) {
    response.writeHead(308, { Location: destination + search });
    response.end();
    return;
  }

  if (pathname === "/pastcustomers") request.url = "/pastcustomers.html" + search;
  next();
}

function notFoundPageMiddleware(server) {
  const isDev = typeof server.transformIndexHtml === "function";
  const root = isDev ? server.config.root : resolve(server.config.root, server.config.build.outDir);

  return async (request, response, next) => {
    const accept = request.headers.accept || "*/*";
    if (request.method !== "GET" && request.method !== "HEAD") return next();
    if (!accept.includes("text/html") && !accept.includes("*/*")) return next();

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    } catch {
      return next();
    }
    if (pathname === "/api" || pathname.startsWith("/api/")) return next();

    const extension = extname(pathname);
    if (extension && extension !== ".html" && !accept.includes("text/html")) return next();
    const requestedPage = resolve(root, `.${pathname}`);
    if (extension === ".html" && requestedPage.startsWith(root + sep) && existsSync(requestedPage)) {
      return next();
    }

    try {
      const source = await readFile(resolve(root, "404.html"), "utf8");
      const html = isDev ? await server.transformIndexHtml("/404.html", source) : source;
      response.writeHead(404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      response.end(request.method === "HEAD" ? undefined : html);
    } catch (error) {
      next(error);
    }
  };
}

function registerAnniversaryMiddleware(server) {
  const { middlewares } = server;
  middlewares.use(anniversaryPageMiddleware);
  middlewares.use(anniversaryApiMiddleware);
  return () => middlewares.use(notFoundPageMiddleware(server));
}

const anniversaryPlugin = {
  name: "anniversary-pages",
  configureServer: registerAnniversaryMiddleware,
  configurePreviewServer: registerAnniversaryMiddleware,
  transformIndexHtml: {
    order: "pre",
    async handler(html, { filename }) {
      const source = anniversaryPages.get(filename);
      if (!source) return html;

      const page = await readFile(source, "utf8");
      return page
        .replace(/((?:href|src)=")(?=\/(?:assets\/|styles\.css"|referral\/referral\.css"))/g, `$1/${anniversaryWeb}`)
        .replace(/<script src="(\/(?:app\.js|referral\/referral\.js))"(?: defer)?>/g, `<script type="module" src="/${anniversaryWeb}$1">`);
    },
  },
};

export default defineConfig({
  appType: "mpa",
  plugins: [anniversaryPlugin],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        pastCustomers: resolve(__dirname, "pastcustomers.html"),
        notFound: resolve(__dirname, "404.html"),
        login: resolve(__dirname, "login.html"),
        signup: resolve(__dirname, "signup.html"),
        crmdashboard: resolve(__dirname, "crmdashboard.html"),
      },
    },
  },
});
