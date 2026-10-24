# アイディア候補と類似事例 (Idea Candidates and Related Work)

[PLAN_06 類似事例の調査](PLAN_06_類似事例の調査.md) で，「VR 内の決まったシナリオを一人で避難し，行動を評価する」形には既存の事例が多いことがわかった．
そこで，VR を使うことは前提にしたまま，**誰と・誰の立場で・どう行動するか**をずらした案を 4 つ出し，それぞれの類似事例を調べた．
新しい方向を選ぶ時と，発表・README で「既存との違い」を説明する時の根拠として使う．

調査日: 2026-10-24（Web 検索による．多くは検索結果の要約や論文の要旨までの確認で，本文をすべて読んだわけではない．CHI・IEEE VR・J-STAGE 等の学会や論文のデータベースは網羅的には調べていない）

## 結論 (Summary)

4 案とも，組み合わせ全体で一致する事例は調べた範囲では見つからなかった．ただし，既にある部分の多さには大きな差がある．

| 案 | 新しさ | 今の資産を活かせるか | 主なリスク |
| --- | --- | --- | --- |
| 1. VR の中の人と外の人で協力して避難する | △ 仕組みは既にある | ◎ | 新しさの説明が弱い |
| 2. 逃げ遅れた人を声で助ける | ◎ | ○ 音声認識と LLM を足す | 音声認識と LLM の応答の速さ |
| 3. 支援が必要な人の立場で避難する | ○ 海外に近いものがある | ◎ | 倫理面の批判 |
| 4. 帰宅困難者として歩いて帰る | ◎ 体験型の教材は空いている | ◎ 足踏み歩行 | 街を作る手間，地図の規約 |

- 新しさを一番説明しやすいのは案 2．次点は案 4
- 案 1 の「外の人も参加できる」要素は，案 2 に足すデモ用の工夫として残せる
- ※ 「今の資産」は，足踏み歩行・しゃがみ・ハンドトラッキングの判定と，入力の記録・再生の仕組みを指す

## 案 1: VR の中の人と外の人で協力して避難する (Asymmetric Co-op Evacuation)

### 内容 (Concept)

- VR の中の人は，煙で前がほとんど見えない建物の中を足踏みで進む
- 外の人は PC やスマホで見取り図・火元・出口を見て，声だけで VR の中の人を出口まで導く
- 伝えたいこと: 災害時の情報の伝え方と共助（「右」ではなく「誘導灯の方へ 3 歩」のように伝える）
- デモで審査員や観客が外の役として参加できる

### 類似事例 (Related Work)

| 事例 | 内容 | この案との違い |
| --- | --- | --- |
| [HeatMeUp（Hasselt 大学，IEEE 3DUI 2012 コンテスト）](https://documentserver.uhasselt.be/handle/1942/13737) | 火災・ガス漏れのある多層ビルで，消防隊長が隊員に道順を伝える協調型のゲーム | **最も近い**．研究用の試作で，機器・声で伝えるか・視界の悪さは未確認．防災教育の位置付けは無い |
| [CARNAGE（Virginia Tech，3DUI 2012 コンテスト 1 位）](https://wordpress.cs.vt.edu/3digroup/2012/09/17/collaborative-navigation-in-virtual-search-and-rescue/) | 地図を見る現場指揮官が，建物内の救助者を誘導する捜索救助 | コンテストの条件で会話は禁止．避難ではなく捜索救助 |
| [Self-overlapping maze（Aalborg 大学，ArtsIT 2017）](https://eudl.eu/doi/10.1007/978-3-319-76908-0_19) | ゴーグルの人が迷路を歩き，地図を持つ外の人が口頭で導く | 構造はほぼ同じ．災害・煙・防災のテーマは無い |
| [Keep Talking and Nobody Explodes](https://bombmanual.com/how-to-play-vr.html) | VR の人が爆弾を解除し，外の人がマニュアルを読んで声で指示する．スマホ VR 版もある | 題材が爆弾解除 |
| [Yonsei 大学（VRST 2016 ポスター）](https://doi.org/10.1145/2993369.2996306)，[Purdue/GMU の火災避難 VR](https://par.nsf.gov/biblio/10583188) | 離れた場所の複数人が同じ VR 空間で協力して避難・誘導する | 全員がゴーグルを着ける対称型 |
| [Cosumnes 消防の訓練](https://www.fireengineering.com/apparatus-equipment/tech-zone/how-the-cosumnes-fire-department-incorporates-virtual-reality-into-its-fire-academy-training/) | 教官が PC からマイクで訓練生のゴーグルに話しかける | 教官による指導で，誘導役のゲーム性は無い |
| [理経「避難体験 VR」（スマホ版あり）](https://dcexpo.jp/archives/2020/online/en/techbiz/150/) | 煙の部屋を避難し，低い姿勢をとっているかを判定する | 1 人用．外からの誘導は無い |

- 使えそうな根拠: [VR と視線計測の研究](https://mdpi-res.com/d_attachment/fire/fire-07-00294/article_deploy/fire-07-00294.pdf)では，視界 2 m の時に目で見る誘導に従った割合は 78.7% に落ち，声の誘導にはどの条件でも 96% 以上が従った（要旨のみ確認）

### 評価 (Assessment)

- 「外の人が VR の中の人を声で導く」構造は 2012 年から知られている
- スマホ VR・足踏みでの移動・煙の中の避難・声だけの誘導・防災教育の組み合わせは見つからなかったが，新しさの説明はやや弱い

## 案 2: 逃げ遅れた人を声で助ける (Rescuing an AI NPC by Voice)

### 内容 (Concept)

- VR の中に，パニックになった人や動けない高齢者の NPC がいる．生成 AI（LLM）がその人物を演じる
- ユーザーは声をかけて落ち着かせ，ハンドトラッキングで手を引く・肩を貸すなどして一緒に避難する
- 声のかけ方が悪いと NPC は動いてくれない
- 自分が逃げるのではなく，他人を助けることを訓練する

### 類似事例 (Related Work)

| 事例 | 内容 | この案との違い |
| --- | --- | --- |
| [VirtualSpeech × Region Västra Götaland（Crisis Support VR）](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12436929/) | AI のアバターを相手に，心理的応急処置（被災者への心のケア）を VR で練習し，評価を受ける商用製品 | 商用では最も近い．会話だけで，避難の行動や手を取る動作は無い．LLM を使っているかは不明 |
| [CLiVR](https://arxiv.org/html/2510.19031v1) | Quest 3 上で，LLM が演じる患者と音声で問診を練習する | 医療面接が対象．災害も体の動作も無い |
| [VicSim](https://arxiv.org/html/2501.03139v1) | LLM が被災者を演じ，通報を受ける指令員を訓練する | 文字だけで VR ではない |
| [DiPS（arXiv 2026）](https://arxiv.org/pdf/2607.01557) | 火災時に避難を渋る住民を説得する対話の研究 | 説得する側が AI．VR ではない |
| [Kán ほか（TU Wien，EGVE 2023）](https://diglib7.eg.org/bitstream/handle/10.2312/egve20231310/027-036.pdf) | 救助隊員向けの VR で，音声認識・音声合成を使って市民役のエージェントと会話する（要約のみ確認） | LLM 以前．説得や体を使って一緒に避難する要素は確認できず |
| [米空軍の VR 自殺予防訓練](https://www.dvidshub.net/news/printable/389441) | 苦しんでいる人を説得して助けを求めさせる VR | LLM ではなく，決められた分岐のシナリオ（要約のみ確認） |
| [メタバースの避難訓練の NPC（ICCE）](https://library.apsce.net/index.php/ICCE/article/view/1408) | 記録した避難行動から NPC を作る | NPC は一緒に逃げる人で，助ける相手ではない |

- ※ [PLAN_06](PLAN_06_類似事例の調査.md) の「LLM を VR の教官役に使う研究（IWSDS 2025）」は，AI が教える側である

### 評価 (Assessment)

- 部品ごとの先例はある（LLM が演じる患者・被災者，AI 相手の心のケアの練習，避難を渋る住民の説得）
- **AI を助けられる側に置き，声で説得してから体を使って一緒に逃げる**という組み合わせは見つからなかった
- 狙える賞: ULS コンサルティング（AI エージェント），三菱重工（安心・安全）（[PLAN_03](PLAN_03_審査基準とアワード.md)）

## 案 3: 支援が必要な人の立場で避難する (Evacuating as a Person Needing Support)

### 内容 (Concept)

- 高齢者・車いす・視覚障害・乳幼児連れなどの立場で避難する
- 例: 足踏みしても進みが遅い，視界がぼやける，片手がふさがる
- 体験した後に，「近所にこういう人がいたら自分はどう手伝うか」を振り返る

### 類似事例 (Related Work)

| 事例 | 内容 | この案との違い |
| --- | --- | --- |
| [Escape or Die（クイーンズランド大学の学生作品，2023）](https://ixd-exhibit.uqcloud.net/archive/2023/teams/bakpia-patok) | 車いすの利用者として，火災のショッピングセンターから脱出する．障害者への共感が目的（要約のみ確認） | **最も近い**．火災・車いすのみで，専用の機材を使う．支援を振り返る部分は見当たらない |
| [イタリア・スイスの修士論文（univpm）](https://tesi.univpm.it/handle/20.500.12075/20839) | 病院の火災で，車いすの患者の立場の後に救助する側を体験する（要約のみ確認） | 「本人の立場 → 助ける側」の構成が似ている．病院・車いすのみで，研究目的 |
| [カンタベリー大学（2026）](https://www.canterbury.ac.nz/news-and-events/news/2026/vr-to-help-improve-fire-evacuation-for-people-in-wheelchairs)，[カールトン大学ほか（Mitacs）](https://www.mitacs.ca/our-projects/evaluating-egress-for-people-with-disabilities-using-virtual-reality/) | 車いす利用者・障害者本人が VR で火災から避難し，建物の設計を評価する | 当事者本人が体験する設計評価で，共感のための体験ではない |
| [北海道科学大学・東京大学の疑似体験 VR](https://www.iog.u-tokyo.ac.jp/wp-content/uploads/2023/10/日本臨床眼科学会ポスター.pdf) | 視野が狭い・視力が低い・筋力が落ちる・車いすの状態を VR で疑似体験する | 体の制約の表し方は最も近い．避難は扱っていない |
| [VR 認知症（シルバーウッド）](https://www.moguravr.com/dementia-vr/) | 認知症の人の立場で体験する研修．自治体でも使われている | 災害・避難の場面は見つからなかった |

- 国内の防災 VR（東京消防庁・自治体の教材等）で，支援が必要な人の立場を入れたものは見つからなかった

### 倫理面の注意 (Ethical Concerns)

- 全米視覚障害者連合の雑誌に載った [Silverman の論文](https://nfb.org/images/nfb/publications/jbir/jbir15/jbir050201.html)は，障害の疑似体験は障害になった直後の混乱ばかりを強調して大変さを誇張しやすく，当事者の工夫が見えなくなると批判している．目隠しを体験した学生が，かえって視覚障害者と関わりにくく感じるようになった例もある
- やる場合は，「できないこと」だけを描かない・当事者の声を入れる・振り返りを「かわいそう」で終わらせず具体的な支援の方法を学ぶ形にする

### 評価 (Assessment)

- 複数の立場・地震などからの避難・体の制約・支援の振り返り・スマホ VR の組み合わせは見つからなかった
- ただし，車いすの立場で火災から逃げる VR は海外に研究や学生作品としてあり，倫理面の批判にも備える必要がある

## 案 4: 帰宅困難者として歩いて帰る (Walking Home as a Stranded Commuter)

### 内容 (Concept)

- 大地震の後，VR の街を足踏みで歩いて自宅まで帰る
- 途中で余震・通行止め・群衆・水やトイレの不足，「帰るか，留まるか」の判断が起きる（東京都は「むやみに帰らない」ことを勧めている）
- 自分の実際の帰り道を使う案もある

### 類似事例 (Related Work)

| 事例 | 内容 | この案との違い |
| --- | --- | --- |
| [KUG（帰宅困難者支援施設運営ゲーム）／東京大学・廣井研と SOMPO リスクマネジメント](https://www.sompo-rc.co.jp/services/view/519) | 帰宅困難者を受け入れる施設の運営を机上で演習する | 受け入れる側の机上演習．歩く側の体験や VR は無い |
| [防災コンセンサスゲーム「帰宅困難サバイバル」](https://asobi-bosai.com/project/consensus-game/) | 首都直下地震後の帰宅困難を想定し，チームで議論する研修（要約のみ確認） | 議論型でデジタルではない |
| [東京都防災アプリ「帰宅困難者モード」](https://www.bousai.metro.tokyo.lg.jp/1028747/) | 発災時に一時滞在施設・鉄道の運行状況・混雑地域を表示する | 実際の災害時に使う道具で，体験教材ではない |
| [内閣府・中央防災会議の帰宅行動シミュレーション（2008）](https://www.bousai.go.jp/kohou/kouhoubousai/h20/05/news_03.html) | 「留まる／帰る」の選択をモデル化し，帰宅者の流れを再現する | 行政向けの計算で，個人が体験するものではない |
| [実写街路に避難シミュレーションを重ねる研究（Tsujihara ほか，ISEC）](https://www.isec-society.org/ISEC_PRESS/html/ISEC_08/O-2.html) | 車載の 360 度カメラで撮った街路の上で，津波・火災からの避難を体験し危険箇所を探す | 実写の街 × 災害の点で最も近い．帰宅困難ではなく，体の入力も無い |
| [Street View と歩数計をつないだ作品（GitHub）](https://github.com/andrewloable/treadmill-streetview) | 歩数を数えて Street View を前に進める | 運動目的．VR・災害の要素は無い |
| [群集密度の VR 研究（Virtual Reality 誌 2019）](https://link.springer.com/article/10.1007/s10055-018-0365-0) | 群集の密度が上がると不快感が増すことを VR で確かめる（要約のみ確認） | 研究用の実験．群集なだれは扱っていない |
| [東京消防庁の VR 防災体験車](https://www.tfd.metro.tokyo.lg.jp/ts/bousai_fukyu/bousai_vr.html)，[文京区「在宅避難 VR」](https://www.city.bunkyo.lg.jp/b009/p000159.html) | 地震・火災・水害の映像，在宅避難の体験 | 帰宅困難・徒歩帰宅は扱っていない |

### 地図の規約 (Map Terms)

[Google Maps Platform 利用規約](https://cloud.google.com/maps-platform/terms)は，次のことを禁止している．

- Street View の画像を事前に取得・保存・再ホストすること，一括でダウンロードすること
- Google の地図コンテンツを基に新しいコンテンツを作ること（画像に被害を描き足す加工が当たるおそれがある．解釈は要確認）
- Street View の画像と Google 以外の地図を同じ画面に出すこと

実在の経路を使うなら，OpenStreetMap のデータで作った街並みで表すのが安全．

### 評価 (Assessment)

- 帰宅困難者の教材は机上演習かアプリに限られ，**歩いて体験するものは見つからなかった**
- 足踏み歩行が一番活きる．街のモデルを作る手間が大きい

## 未確認の点 (Open Questions)

- 案 1: HeatMeUp の機器・声で伝えるか・視界の悪さの表し方（本文を取得できず）．消防の現場指揮訓練の製品（FAAC inCommand 等）に「隊員は VR，指揮官は PC」の構成があるか
- 案 2: VirtualSpeech の Crisis Support VR と Kán ほかの論文で，体の動作や LLM を使っているか．Inworld・Convai 等を使った個人のデモ（YouTube 等）
- 案 3: 視覚障害者・乳幼児連れの立場で避難する VR（専用の検索語で十分に調べていない）．国内の自治体・社会福祉協議会の研修資料
- 案 4: Google の検索要約に「廣井研が帰宅困難体験 VR を作成」とあったが，研究室のページでは確認できなかった（誤りの可能性が高い）．群集なだれを VR で体験させる事例
- 全体: 日本のハッカソン作品（ProtoPedia 等）に同種のものがあるか
