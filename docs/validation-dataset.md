# Validation Dataset

この文書は、実ログと実 DVR の検証セットを固定するための台帳です。
成功例だけを集めないこと。壊れる入力を含めない検証は無意味です。

## 使い方

- 各サンプルに一意な ID を付ける
- `.bbl` と DVR を対にできる場合は対にする
- 「何を検証するためのサンプルか」を先に書く
- 成功したかどうかだけで終わらせず、ズレ方と壊れ方を書く

## サンプル一覧

| ID | 種別 | ファイル名 | 目的 | 期待観察 | 実観察 | 結果 |
| --- | --- | --- | --- | --- | --- | --- |
| LOG-001 | BBL | `BTFL_BLACKBOX_LOG_HYPER_20260308_145916_FOXEERF722V4.BBL` | 現在の baseline ログ | 読み込み成功、snapshot が破綻しない | 読み込み成功。flight tab 表示あり。継続時間は 01:14.944 と観察。event list は 12 件表示 | 成功 |
| LOG-002 | BBL | TBD | 未知ヘッダを含むログ | 読み込み継続、warning のみ | サンプル未追加 | 未実施 |
| LOG-003 | BBL | TBD | AUX / RPM 差異のあるログ | 欠損を誤表示しない | サンプル未追加 | 未実施 |
| LOG-004 | BBL | TBD | 複数 readable section を含むログ | 1 ファイルから複数 flight tab が出る。各 section が区別できる。unreadable section があれば skip が分かる | コード上は `loadFlightSessionsFromFile()` と adapter test で担保済み。実 fixture はまだ repo 内で固定できていない | 部分成功 |
| DVR-001 | DVR | `BTFL_BLACKBOX_LOG_HYPER_20260308_145916_FOXEERF722V4.mp4` | 現在の baseline DVR | 動画 attach 成功、auto sync の観察起点になる | attach 後も画面は継続。1920x1080 / 60fps / 135.808s。auto sync は `ARMED text was not detected in the first 10 seconds.` と表示 | 部分成功 |
| DVR-002 | DVR | `BTFL_BLACKBOX_LOG_HYPER_20260308_145916_FOXEERF722V4.mp4` | OCR 失敗時 UX の確認 | 失敗を表示し手動調整に戻れる | 失敗メッセージは表示された。少なくともクラッシュはしない。手動 offset 調整の細かい操作確認は未記録 | 部分成功 |

## 記録ルール

- 結果は `成功` `部分成功` `失敗` の 3 つで書く
- `実観察` には最低でも 1 つ具体例を書く
- 失敗時は再現手順を残す

## 次に埋めるべき項目

1. 手動 offset 調整の観察記録
2. 複数 section を含む `.BBL` の固定 fixture
3. 追加の失敗系サンプル
4. ログ形式や DVR 形式の違い
5. 既知のズレや注意点
