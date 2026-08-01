const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { createMarkdownFromOpenApi } = require("@scalar/openapi-to-markdown");

const ROOT = path.join(__dirname, "..");
const SPEC_PATH = path.join(ROOT, "openapi.yaml");

function buildIndex(doc) {
  const methods = Object.entries(doc.paths || {})
    .flatMap(([route, operations]) =>
      Object.entries(operations)
        .filter(([method]) => ["get", "post", "put", "patch", "delete"].includes(method))
        .map(([method, op]) => `- \`${method.toUpperCase()} ${route}\` — ${op.summary || op.operationId || ""}`)
    )
    .join("\n");

  return `# ${doc.info.title}

> ${doc.info.description.trim().split("\n")[0]}

${doc.info.description.trim()}

## Docs

- [OpenAPI спецификация](/openapi.yaml)
- [Интерактивный референс (Scalar)](/docs)
- [Полная документация в Markdown](/llms-full.txt)

## Methods

${methods}
`;
}

async function main() {
  const doc = yaml.load(fs.readFileSync(SPEC_PATH, "utf8"));

  const full = await createMarkdownFromOpenApi(JSON.stringify(doc));
  fs.writeFileSync(path.join(ROOT, "llms-full.txt"), full);

  const index = buildIndex(doc);
  fs.writeFileSync(path.join(ROOT, "llms.txt"), index);

  console.log("[generate-llms-docs] Written llms.txt and llms-full.txt");
}

main().catch((err) => {
  console.error("[generate-llms-docs] Failed:", err);
  process.exit(1);
});
