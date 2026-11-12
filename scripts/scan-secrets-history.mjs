import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// Scanne les lignes ajoutées dans tout l'historique Git disponible.
// Les valeurs détectées ne sont jamais affichées dans les journaux CI.
const rules=[
  ["github-token",/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ["aws-access-key",/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["slack-token",/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ["google-api-key",/\bAIza[0-9A-Za-z_-]{30,}\b/],
  ["openai-style-key",/\bsk-[A-Za-z0-9_-]{24,}\b/],
  ["private-key",/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["credential-assignment",/\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|private[_-]?key|admin[_-]?token)\b\s*[:=]\s*["'][A-Za-z0-9_./+=-]{24,}["']/i]
];

const child=spawn("git",["log","--all","--format=","--no-ext-diff","-p"],{stdio:["ignore","pipe","inherit"]});
const rl=createInterface({input:child.stdout,crlfDelay:Infinity});
let currentFile="(unknown)",findings=0;
for await (const line of rl) {
  if(line.startsWith("+++ b/")) currentFile=line.slice(6);
  if(!line.startsWith("+")||line.startsWith("+++")) continue;
  for(const [name,pattern] of rules) {
    if(pattern.test(line)) {
      findings++;
      process.stderr.write("SECRET SCAN: correspondance "+name+" dans "+currentFile+" (valeur masquée)\n");
      break;
    }
  }
}
const code=await new Promise(resolve=>child.on("close",resolve));
if(code!==0) {
  process.stderr.write("Impossible de lire l'historique Git complet.\n");
  process.exitCode=2;
} else if(findings) {
  process.stderr.write("Échec : "+findings+" correspondance(s) à examiner.\n");
  process.exitCode=1;
} else {
  process.stdout.write("Aucune correspondance détectée par les règles locales dans l'historique Git disponible.\n");
}
