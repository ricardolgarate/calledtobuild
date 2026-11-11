import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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

function registerAnniversaryMiddleware({ middlewares }) {
  middlewares.use(anniversaryPageMiddleware);
  middlewares.use(anniversaryApiMiddleware);
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
