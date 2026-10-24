// 記録の再生と集計（npm run replay）．src/input/replay/replayCli.ts を vite の runnerImport で読み込んで実行する
// （TypeScript をそのまま読めるため，ビルドの手順を増やさない）．使い方は npm run replay -- --help
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

const cli = fileURLToPath(new URL("../src/input/replay/replayCli.ts", import.meta.url));
const { module } = await runnerImport(cli);
const out = await module.runReplayCli(process.argv.slice(2));
process.stdout.write(out.endsWith("\n") ? out : `${out}\n`);
