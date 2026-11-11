import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerPath = resolve(projectRoot, "dist/server/index.js");
const manifestPath = resolve(projectRoot, "dist/.openai/hosting.json");

const [source, manifest] = await Promise.all([
  readFile(workerPath, "utf8"),
  readFile(manifestPath, "utf8"),
]);
JSON.parse(manifest);

// A data URL forces ESM parsing even though the generated output has no package.json.
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const workerModule = await import(moduleUrl);
assert.equal(
  typeof workerModule.default?.fetch,
  "function",
  `${pathToFileURL(workerPath)} must export default.fetch`,
);

const site=workerModule.default;
const pages=[['/', 'web/referral/index.html'], ['/pastcustomers', 'web/index.html']];
for(const origin of ['https://anniversary.organizedandbeautiful.com','https://preview.example']){
  for(const [route,file] of pages){
    const response=await site.fetch(new Request(origin+route),{});
    assert.equal(response.status,200,route+' must load');
    const html=await response.text();
    assert.equal(html,await readFile(resolve(projectRoot,file),'utf8'),route+' must serve the correct audience');
    for(const [,asset] of html.matchAll(/(?:src|href)="(\/(?:assets\/[^"?#]+|[^"?#]+\.(?:css|js)))"/g)){
      const assetResponse=await site.fetch(new Request(origin+asset),{});
      assert.equal(assetResponse.status,200,route+' asset '+asset+' must load');
      assert.ok(!assetResponse.headers.get('Content-Type').startsWith('text/html'),asset+' must be a real asset');
    }
    const head=await site.fetch(new Request(origin+route,{method:'HEAD'}),{});
    assert.equal(head.status,200);assert.equal(await head.text(),'');
  }
  for(const [from,to] of [['/referral','/'],['/referral/','/'],['/referral/index.html','/'],['/index.html','/'],['/pastcustomers/','/pastcustomers'],['/pastcustomers/index.html','/pastcustomers']]){
    const query='?code=Example1234&ref=Casey%20Example&utm_source=text';
    const redirect=await site.fetch(new Request(origin+from+query),{});
    assert.equal(redirect.status,308);
    assert.equal(redirect.headers.get('Location'),origin+to+query,'Existing links must keep their code and query');
  }
  const lookup=await site.fetch(new Request(origin+'/api/referral-clients',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({query:'Example'})}),{});
  assert.equal(lookup.status,200,'Same-origin API must work on either hostname');
  assert.deepEqual(await lookup.json(),{ok:true,matches:[]});
}
console.log("Artifact is valid ESM; both pages, assets, legacy links, HEAD requests, and custom-domain API origins pass.");
