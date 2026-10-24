# 類似事例の調査 (Related Work Survey)

VR を使った災害シミュレーションのうち，このプロジェクトに近いもの（体を動かして入力し，災害時の行動を VR 内で行い，その行動を AI や人が評価する）を調べた結果をまとめる．
あわせて，「見取り図から VR の体験空間を作る」案の類似事例も調べた（後述「見取り図から VR 空間を作る事例」）．
発表・README で「既存との違い」を説明する時の根拠として使う．

調査日: 2026-10-24（Web 検索による．各論文は要旨・抜粋の確認までで，本文をすべて読んだわけではない）

## 結論 (Summary)

次の 4 つをすべて満たす事例は，調べた範囲では見つからなかった．

1. 体の動きで入力する（足踏み歩行・しゃがみ・ハンドトラッキング）
2. 災害時にとるべき行動を VR 内で実際に行う
3. 行動のログを AI や人が評価する
4. スマホと簡易 VR ゴーグルだけで動く

2〜3 個を満たす事例は多い．ただし調査は網羅的ではないため，「存在しない」とは言い切れない．

## 研究: 行動の記録・評価まであるもの (Research with Behavior Assessment)

| 事例 | 体験の内容 | 評価の方法 |
| --- | --- | --- |
| [広島市立大学の地震避難 VR（教育システム情報学会 2021）](https://www.jsise.org/taikai/2021/program/contents/pdf/B2-3.pdf)，[同 2020](https://www.jsise.org/taikai/2020/program/contents/pdf/B6-2.pdf) | ダイニングキッチン・オフィスで地震にあい，VR 内を移動して机の下に入る等の行動をとって脱出する | VR 内の動きを分析し，危険な行動に応じた助言を出す（自動）．入力方法（コントローラか歩行か）は未確認 |
| [Lee & Lin（Springer，2026）](https://econpapers.repec.org/RePEc:spr:prbchp:978-3-032-11983-4_4) | 過去の地震データをもとにした避難教育と行動分析のシステム | 行動を分析する．案内なしの初回では約 90% がしゃがむだけで，安全な場所を見つけられなかった |
| [Mitsuhara ほか（ICCE 2021）](https://library.apsce.net/index.php/ICCE/article/view/4294) | 予告なしで地震が起きる VR で避難行動を観察する | 研究者が観察する（1 人と 2 人の場合を比較） |
| [Liang ほか（VRCAI 2018）](https://staffprofiles.bournemouth.ac.uk/display/conference/310114) | 地震避難訓練の試作．行動への助言がある | 従来の訓練では参加者の行動を記録できない点を課題にしている |
| [津波避難 VR（日本 VR 学会大会 2025）](https://conference.vrsj.org/ac2025/program/doc/1B1-04.pdf) | 自動生成した街で津波から避難する | 移動の軌跡の分析とアンケート |
| [家具固定 VR（日本 VR 学会大会 2020）](https://conference.vrsj.org/ac2020/program/doc/2B2-5_PR0006.pdf) | 一体型ゴーグルの**ハンドトラッキング**で家具を配置・固定したあと揺れを体験する | 未確認 |
| [UMass Boston の地震 VR](https://www.cs.umb.edu/~craigyu/papers/earthquake.pdf) | 落下物で負傷する体験を通して「頭を守る」動作を訓練する | 行動の訓練と評価 |
| [ブータン向け地震 VR（Quest）](https://10wvvw.easychair.org/publications/preprint/4RK6/open) | 手で物を置いたあと強い揺れが来る | コントローラを使用（ハンドトラッキングではない） |

※ 避難訓練 VR の研究全体の傾向は，系統的レビュー [Immersive Virtual Reality Serious Games for Evacuation Training and Research](https://arxiv.org/pdf/1805.09138) がまとまっている．

## 自動採点・AI による評価があるもの (Automatic Scoring and AI Assessment)

| 事例 | 内容 | 評価の方法 |
| --- | --- | --- |
| [VR Fire safety training application（arXiv 2508.15788）](https://arxiv.org/pdf/2508.15788) | 火災時の安全訓練 | 反応時間・消火器の使い方・危険の発見・避難の手順をログから自動採点し，フィードバックのレポートを出す |
| [Nisme ほか（ICTICM 2026）](https://rda.sliit.lk/entities/publication/5164255c-c68c-4736-9f49-71eaec6f8591/full) | 火災避難 VR | 成績と行動を分析する．47 人の訓練前後の比較で，得点の中央値が 4 から 8 に上がった |
| [Xamk 大学の火災避難 VR（2025）](https://www.theseus.fi/handle/10024/894298) | キャンパスの火災避難 | 避難時間・反応時間を自動で記録する．階段の移動で VR 酔いが報告されている |
| [大規模災害の医療対応 VR（PLOS ONE，2025）](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12157235/) | 医療者 196 人の訓練 | 行動ログを機械学習で分析し，個人ごとのフィードバックを作る（セッション後に分析） |
| [LLM を VR の教官役に使う研究（IWSDS 2025）](https://preview.aclanthology.org/fix-sig-urls/2025.iwsds-1.23.pdf) | 緊急対応の VR 訓練 | LLM が指導役として応答する．ゲームの状態を LLM に渡すと応答の精度が上がった．**AI 評価の先行例として最も近い** |
| FLAIM Trainer（消防士向けの商用製品．[TEEX の検証](https://technode.global/?p=45355)，[バイタル計測](https://archive.vrroom.studio/?p=15939)，[JMIR Serious Games 2024](https://games.jmir.org/2024/1/e53683/PDF)） | 本物に近いホースを使う消火訓練 | 作業時間・空気と水の消費量・ストレス・視線と動きを記録し，教官がタブレットで見て振り返る．**人が評価する形の代表例** |

## 国内で使われているもの: 体験が中心 (Deployed Systems in Japan)

行動の評価はほとんど無く，「見て体験する」ものが中心．

| 事例 | 内容 |
| --- | --- |
| [東京消防庁の VR 防災体験車（2018〜）](https://www.metro.tokyo.lg.jp/governor/action/katsudo/2018/4/21_01) | 座席の振動・におい・熱を組み合わせた 360 度映像．座って見る形（[Business Insider の紹介](https://www.businessinsider.jp/article/167169/)） |
| 東京消防庁の地震 VR 教材「B-VR」 | 渋谷区立中学校での活用が[内閣府の事例集（2026-03）](https://www.bousai.go.jp/kyoiku/ima_sugu_tsunagaru/pdf/digitaltechnology_casestudies_2026.pdf)に載っている |
| [スマホ版「避難体験 VR」（2017）](https://www.moguravr.com/?p=62325) | スマホと VR ゴーグルで，煙で見えにくい中を誘導灯を頼りに出口まで進む．消火器の体験もある．**形式はこのプロジェクトに最も近い** |
| 自治体の貸し出し教材 | [神戸市](https://www.city.kobe.lg.jp/a86585/bosai/shobo/outline/center/simin_kenshu2/index.html)（地震・津波・火災・風水害），[松戸市](https://www.city.matsudo.chiba.jp/kurashi/anzen_anshin/sonae/bousai_taisaku/arvr.files/tirasi5.pdf)，[栃木県の防災体験車](https://www.pref.tochigi.lg.jp/l02/tiiki-bousai/vrbousaicar.html)（モバイル版もある） |
| [神奈川県総合防災センター](https://www.kanaloco.jp/news/culture/bunka/article-1107032.html) | ゴーグルで災害を体験したあと，避難行動のシミュレーションがある |

## このプロジェクトとの違い (Positioning)

| 観点 | 既存の事例 | このプロジェクト |
| --- | --- | --- |
| 機材 | 研究は一体型ゴーグル（Quest 等）や PC が中心．スマホ VR は見るだけの体験が中心 | スマホと簡易 VR ゴーグルだけ |
| 入力 | コントローラが中心．ハンドトラッキングは家具固定 VR 等の一部のみ | 足踏み歩行・しゃがみ・ハンドトラッキングを組み合わせる |
| 評価 | ログからの自動採点や教官による振り返りはある．LLM による評価は 2025 年に研究が始まった段階 | 行動ログをもとに AI や人が評価する（[PLAN_05](PLAN_05_追加機能の候補.md)「AI による振り返り」） |

「安い機材で体を動かして行動し，その行動を評価する」という組み合わせは，差別化の主張として使える．

## 見取り図から VR 空間を作る事例 (Floor Plan to VR)

想定する案: 見取り図を撮影し，避難経路・壁・炎などをユーザーが置き，完成したものを 3D 化して VR で歩く．

### 結論 (Summary)

調べた範囲では，「撮影 → ユーザーが危険を配置 → 3D 化 → VR で歩く」を 1 つにつなげたアプリは見つからなかった．各段階を部分的に持つものは実在する．

### 最も近い事例 (Closest Match)

ベルギー王立陸軍士官学校 XR Lab の「From Floor Plans to Virtual Reality」（[論文](https://www.researchgate.net/profile/Rob-Haelterman/publication/356253825_From_Floor_Plans_to_Virtual_Reality/links/619387aad7d1af224bf5aa88/From-Floor-Plans-to-Virtual-Reality.pdf)，[XR Lab](https://xrlab.rma.ac.be/?p=931)，[研究ポータル](https://researchportal.rma.ac.be/de/publications/from-floor-plans-to-virtual-reality-5/)）．

- 見取り図から，壁・ドア・窓・大きな家具のある VR 空間をほぼ自動で作る
- スマホのアプリで撮った写真や保存済みの写真を 3D ファイルに変換できる
- 論文には「消火訓練では，教官が選んだ場所にドア・窓・燃えやすい物を置く必要がある」とある．ただし配置の操作方法は確認できていない
- 対象は特殊部隊などの突入訓練で，一般向けの製品ではない

### 部分的に満たす事例 (Partial Matches)

| 段階 | 事例 | 防災の機能 |
| --- | --- | --- |
| 見取り図 → 3D | [AMC Bridge の VR-Architecture](https://www.engineering.com/?p=22783)（太い線で手描きした図の写真から壁・ドア・窓を認識する．2 点間の実際の距離を入れて縮尺を決める） | なし |
| 見取り図 → 3D → VR | [Empoli AI](https://apps.apple.com/us/app/-/id6746819798)（iPad），[Ritn3D](https://alternativeto.net/software/ritn3d/about)（認識した壁などを人が確かめてから 3D 化する） | なし |
| 間取り図 → 3D → 歩く視点 | [LIFULL HOME'S「3D 間取り」](https://aismiley.co.jp/ai_news/lifull-3d-room-map/)（賃貸の内見用） | なし |
| 見取り図 → VR（研究） | [TU Wien の不動産 VR](https://www.vr.tuwien.ac.at/publications/extraction-of-structural-and-semantic-data-from-2d-floor-plans-for-interactive-and-immersive-vr-real-estate-exploration-2018/) | なし |
| 建物モデル → 避難経路 → VR 訓練 | [ISARC 2022（BIM＋VR）](https://www.iaarc.org/publications/2022_proceedings_of_the_39th_isarc_bogota_colombia/fire_evacuation_and_management_model_based_on_building_information_modeling_and_virtual_reality.html)（最短の避難経路と避難時間を計算し，一人称の VR で訓練する），[Wang ほか 2014（BIM＋ゲームエンジン）](https://www.doi.org/10.1155/2014/589016) | あり．ただし設計データ（BIM）が前提で，ユーザーが炎の位置を決めるかは未確認 |
| 建物を自動で 3D 化 → 災害の再現 | [Microsoft Research「Building Scale VR」](https://www.microsoft.com/en-us/research/?p=454179)，名古屋大学（ロボットと全天球カメラで撮影する） | あり．ただし入力は見取り図ではなく実際の撮影 |
| 自分の部屋 → 揺れの体験 | [岐阜県の中学校の授業](https://school.gifu-net.ed.jp/wordpress/seino-asns/wp-content/uploads/sites/61/2025/09/e9b5f4b4d4277c3159f243148a8928b3.pdf)（自宅の家具配置を書き出し，ミニチュア模型で揺れを撮影してゴーグルで見る） | あり．ただし手作業でアナログ |

### この案の新しさ (Novelty)

次の 3 つの組み合わせは，先行例がほとんどない．

- ユーザーが危険（炎・ふさがった道）を自分で置く．既存の防災 VR はシナリオが決まっているものがほとんど
- 自分の家・学校・職場の見取り図から作る．既存のものは設計データ（BIM）や専用の撮影が前提
- スマホのカメラだけで完結する

※ 見取り図の画像から壁を自動で認識する処理は研究でも長く取り組まれてきた難しい処理である．ハッカソンでは「撮影した写真をなぞって壁を引く（半自動）」程度にとどめるのが現実的．

## 未確認の点 (Open Questions)

- 広島市立大学の地震避難 VR の入力方法と評価の詳細（PDF の本文を確認できていない）
- 家具固定 VR（日本 VR 学会大会 2020）の評価方法
- 一般の人が入手できる防災 VR アプリ（ストア配信のもの）の有無と機能
- From Floor Plans to Virtual Reality で，炎や障害物を配置する操作をユーザーが行えるか
- Empoli AI・Ritn3D の現在の提供状況と認識の精度
