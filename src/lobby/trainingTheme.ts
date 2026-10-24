// 許可の画面とホームで共通の背景（訓練施設の体験室のような，落ち着いた紺〜灰に薄いグリッドと柔らかい光）．
// 外部の画像・フォントは使わず CSS だけで作る

/** 背景の CSS の宣言（background の重ね）．上から光のにじみ・グリッド・紺〜灰のグラデーションの順 */
export const TRAINING_BACKGROUND_CSS = `
  background-color: #1a2333;
  background-image:
    radial-gradient(ellipse 70% 45% at 50% -5%, rgba(170, 200, 235, 0.28), transparent 70%),
    radial-gradient(ellipse 50% 40% at 85% 110%, rgba(120, 150, 190, 0.16), transparent 70%),
    linear-gradient(rgba(190, 210, 235, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(190, 210, 235, 0.06) 1px, transparent 1px),
    linear-gradient(180deg, #1c2a40 0%, #232d3d 55%, #2e3440 100%);
  background-size: 100% 100%, 100% 100%, 40px 40px, 40px 40px, 100% 100%;
  background-position: center;
`;

/** 文字の箱の CSS の宣言（背景のグリッドの上でも文字が読めるよう，半透明の板に載せる） */
export const TRAINING_BOX_CSS = `
  background: rgba(14, 20, 31, 0.72);
  border: 1px solid rgba(190, 210, 235, 0.18);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
`;
