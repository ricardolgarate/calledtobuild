const backendOrigin = "https://oab-three-years-of-beautiful.ricardogarate.chatgpt.site";
const endpoints = new Set(["/api/referrals", "/api/referral-code", "/api/referral-clients"]);
const maxBodyBytes = 4096;

function respond(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function forwardRequest(request, response, path, protocol) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return respond(response, 405, { ok: false, message: "Please use the form to send your request." });
  }
  if (request.headers.origin !== `${protocol}://${request.headers.host}`) {
    return respond(response, 403, { ok: false, message: "Please open the form on the anniversary website." });
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) {
    return respond(response, 400, { ok: false, message: "Please check your details and try again." });
  }

  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > maxBodyBytes) {
        request.resume();
        return respond(response, 413, { ok: false, message: "Please check your details and try again." });
      }
      chunks.push(chunk);
    }

    const upstream = await fetch(backendOrigin + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: backendOrigin },
      body: Buffer.concat(chunks),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    return respond(response, upstream.status, await upstream.json());
  } catch {
    return respond(response, 503, {
      ok: false,
      message: "We could not send your request. Please try again or text OAB at 469-476-5735.",
    });
  }
}

export function handleAnniversaryApi(request, response) {
  const path = new URL(request.url, "https://localhost").pathname;
  if (!endpoints.has(path)) {
    return respond(response, 404, { ok: false, message: "Page not found." });
  }
  return forwardRequest(request, response, path, "https");
}

export function anniversaryApiMiddleware(request, response, next) {
  const path = new URL(request.url, "http://localhost").pathname;
  if (!endpoints.has(path)) return next();
  return forwardRequest(request, response, path, request.socket.encrypted ? "https" : "http");
}
