// スモーク: 主な画面（ホーム・エディタ・結果画面・デモの校舎の 3D）がエラーなく開くか．ランナーの動作確認も兼ねる
export default async function ({ open, check, expect, consoleLines }) {
  const errorsSince = (start) =>
    consoleLines.slice(start).filter((l) => /pageerror|error:/.test(l));

  let start = consoleLines.length;
  const home = await open("/");
  await check(
    "ホーム画面に「エディタを開く」が出る",
    async () => {
      await home.getByText("エディタを開く").first().waitFor({ timeout: 10_000 });
      const errors = errorsSince(start);
      expect(errors.length === 0, `エラー: ${errors.join(" / ")}`);
    },
    home,
  );

  start = consoleLines.length;
  const editor = await open("/?editor");
  await check(
    "エディタが開き，マス目の canvas が出る",
    async () => {
      await editor.locator("canvas").first().waitFor({ timeout: 10_000 });
      const errors = errorsSince(start);
      expect(errors.length === 0, `エラー: ${errors.join(" / ")}`);
    },
    editor,
  );

  start = consoleLines.length;
  const debrief = await open("/?debrief");
  await check(
    "結果画面（dev の単独起動）がエラーなく開く",
    async () => {
      await debrief.waitForTimeout(2000);
      const errors = errorsSince(start);
      expect(errors.length === 0, `エラー: ${errors.join(" / ")}`);
    },
    debrief,
  );

  start = consoleLines.length;
  const school = await open("/?scene=school&input=mock&t=10");
  await check(
    "デモの校舎の 3D が描かれ，W で歩くと位置が変わる",
    async () => {
      const hud = school.locator("pre").first();
      await hud.waitFor({ timeout: 15_000 });
      // 左上の表示は alarm の行が毎フレーム進むため，pos の行だけを比べる
      const pos = async () => (await hud.textContent())?.match(/^pos .*$/m)?.[0] ?? "";
      // 開始直後は壁の正面を向いていて進めないため，ドラッグで右後ろ（ヨー約 -138°）へ向き直ってから歩く
      // （-90° の向きも壁で進めない．デモの校舎の開始地点 pos 2.50, 2.50 での値）
      await school.mouse.move(640, 400);
      await school.mouse.down();
      await school.mouse.move(1240, 400, { steps: 10 });
      await school.mouse.up();
      const before = await pos();
      await school.keyboard.down("KeyW");
      // SwiftShader では fps が低く，歩き出しの加速もあるため長めに押す
      await school.waitForTimeout(2500);
      await school.keyboard.up("KeyW");
      const after = await pos();
      expect(
        before !== "" && before !== after,
        `W を押しても位置が変わらない（${before} → ${after}）`,
      );
      const errors = errorsSince(start);
      expect(errors.length === 0, `エラー: ${errors.join(" / ")}`);
      return `${before} → ${after}`;
    },
    school,
  );
}
