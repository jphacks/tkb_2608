// 見守りの中継の動作を確かめる（student 2 つ・monitor 2 つをつなぎ，流れること・4 KiB 超と monitor からのものが捨てられること・
// 接続の検査を見る）．使い方: `npm run relay:check`（ローカルの `npm run relay:dev` に対して）
// または `npm run relay:check -- wss://<中継>`（デプロイした中継に対して）．ENV_04「見守りの中継」．
const base = (process.argv[2] ?? "ws://127.0.0.1:8787").replace(/\/+$/, "");
const httpBase = base.replace(/^ws/, "http");
// 他の人の部屋と重ならないよう，毎回乱数で部屋の ID を作る
const room = crypto
  .getRandomValues(new Uint8Array(12))
  .reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
const open = (path) =>
  new Promise((res, rej) => {
    const ws = new WebSocket(`${base}${path}`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => res(ws);
    ws.onerror = () => rej(new Error(`error ${path}`));
  });
const fails = async (path) => {
  try {
    const ws = await open(path);
    ws.close();
    return false;
  } catch {
    return true;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (name, cond) => {
  results.push([name, cond]);
  console.log(cond ? "OK  " : "NG  ", name);
};

const m1 = await open(`/rooms/${room}?role=monitor`);
const m2 = await open(`/rooms/${room}?role=monitor`);
const mOther = await open(`/rooms/${room}x?role=monitor`);
const s1 = await open(`/rooms/${room}?role=student`);
const s2 = await open(`/rooms/${room}?role=student`);
const got = { m1: [], m2: [], mOther: [], s1: [], s2: [] };
for (const [k, ws] of Object.entries({ m1, m2, mOther, s1, s2 }))
  ws.onmessage = (e) => got[k].push(e.data);

s1.send(JSON.stringify({ type: "hello", studentId: 1 }));
s2.send(JSON.stringify({ type: "hello", studentId: 2 }));
const bin = new Uint8Array(20);
bin[0] = 7;
s1.send(bin);
s1.send("a".repeat(4096)); // ちょうど 4 KiB は流す
s1.send("a".repeat(4097)); // 超えたら捨てる
s1.send("あ".repeat(1366)); // 4098 バイト（UTF-8）は捨てる
s2.send(new Uint8Array(5000)); // バイナリの超過も捨てる
m1.send("from monitor"); // monitor からは捨てる
await sleep(500);

for (const k of ["m1", "m2"]) {
  const g = got[k];
  ok(`${k}: 4 件届く`, g.length === 4);
  ok(
    `${k}: 2 人の hello`,
    g.filter((d) => typeof d === "string" && d.startsWith("{")).length === 2,
  );
  ok(
    `${k}: バイナリ 20 バイトがそのまま`,
    g.some((d) => d instanceof ArrayBuffer && d.byteLength === 20 && new Uint8Array(d)[0] === 7),
  );
  ok(
    `${k}: 4096 文字は届く`,
    g.some((d) => typeof d === "string" && d.length === 4096),
  );
  ok(
    `${k}: 超過と monitor からのものは届かない`,
    !g.some(
      (d) =>
        (typeof d === "string" &&
          (d.length > 4096 || d.startsWith("あ") || d === "from monitor")) ||
        (d instanceof ArrayBuffer && d.byteLength > 4096),
    ),
  );
}
ok("別の部屋の monitor には届かない", got.mOther.length === 0);
ok("student には何も届かない", got.s1.length === 0 && got.s2.length === 0);

// student が切れても monitor は残り，つなぎ直した student から届く
s1.close();
await sleep(200);
const s3 = await open(`/rooms/${room}?role=student`);
s3.send("again");
await sleep(300);
ok("つなぎ直した student から届く", got.m1.at(-1) === "again" && got.m2.at(-1) === "again");

ok("role 無しは断る", await fails(`/rooms/${room}`));
ok("role 不正は断る", await fails(`/rooms/${room}?role=admin`));
ok("部屋の ID が短いと断る", await fails(`/rooms/abc1234?role=monitor`));
ok("部屋の ID が 65 文字だと断る", await fails(`/rooms/${"a".repeat(65)}?role=monitor`));
ok("部屋の ID に記号があると断る", await fails(`/rooms/abcd.efgh?role=monitor`));
ok("別のパスは断る", await fails(`/room/${room}?role=monitor`));
ok("部屋の ID 64 文字はつながる", !(await fails(`/rooms/${"a".repeat(64)}?role=monitor`)));
const http = await fetch(`${httpBase}/rooms/${room}?role=monitor`);
ok("WebSocket でない要求は 426", http.status === 426);

for (const ws of [m1, m2, mOther, s2, s3]) ws.close();
const bad = results.filter(([, c]) => !c).length;
console.log(bad === 0 ? "ALL OK" : `${bad} NG`);
process.exit(bad === 0 ? 0 : 1);
