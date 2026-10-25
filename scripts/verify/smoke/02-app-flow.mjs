// スモーク: 体験の流れ（?app&input=mock）を開始画面 → ホーム → ロビー（手のボタン・キャリブレーション）→ 訓練の説明まで進める．
// ゴーグルの画面に入った後の文字は 3D の中に描かれ DOM から読めないため，各段階のスクリーンショットを目で確かめる
// （進み方の癖は .claude/verify-profile.md「待ち方・操作の癖」）
import { pressHandButton, VR_BUTTON, vrPanel } from "../session.mjs";

export default async function ({ open, check, expect, consoleLines }) {
  const errors = () => consoleLines.filter((l) => /pageerror|error:/.test(l));
  const page = await open("/?app&input=mock", { viewport: "phone" });

  await check(
    "開始画面で「はじめる」→「センサーなしで進む」を押すとホームに進む",
    async () => {
      await page.getByRole("button", { name: "はじめる" }).click();
      await page.getByRole("button", { name: "センサーなしで進む" }).click();
      await page.getByRole("button", { name: "スタート" }).waitFor({ timeout: 15_000 });
    },
    page,
  );

  await check(
    "ホームの「スタート」→「このまま始める」でゴーグルのセットの案内が出る",
    async () => {
      await page.getByRole("button", { name: "スタート" }).click({ force: true });
      await page.getByRole("button", { name: "このまま始める" }).click({ force: true });
      await page.getByText("スマホをゴーグルにセットしてください").waitFor({ timeout: 10_000 });
    },
    page,
  );

  await check(
    "ロビーの開始ボタンに手をかざすと案内の板が変わる（「見え方を合わせてください」に進む）",
    async () => {
      // ゴーグルの画面（3D）に切り替わり，手を認識し始めるまで待つ
      await page.waitForTimeout(5000);
      const before = await vrPanel(page);
      await pressHandButton(page, VR_BUTTON.lobbyStart);
      await page.waitForTimeout(1000);
      expect(!(await vrPanel(page)).equals(before), "手をかざしても案内の板が変わらない");
    },
    page,
  );

  await check(
    "見え方の確認のボタンに手をかざすと案内の板が変わる（キャリブレーションに進む）",
    async () => {
      const before = await vrPanel(page);
      await pressHandButton(page, VR_BUTTON.lobbyLower);
      await page.waitForTimeout(1000);
      expect(!(await vrPanel(page)).equals(before), "手をかざしても案内の板が変わらない");
    },
    page,
  );

  await check(
    "W を押し続けるとキャリブレーションを終えて訓練の説明に進む（最後のスクリーンショットが「今日の訓練」か「避難の注意」の説明か目で確認）",
    async () => {
      await page.keyboard.down("KeyW");
      // キャリブレーションは 5 手順で 1 分ほどかかる（手順ごとに残り秒数が出る）
      await page.waitForTimeout(75_000);
      await page.keyboard.up("KeyW");
      expect(errors().length === 0, `エラー: ${errors().join(" / ")}`);
    },
    page,
  );
}
