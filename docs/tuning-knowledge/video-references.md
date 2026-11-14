# 参考動画と取り込み方

[文書集の入口](README.md)

2026-11-13時点の調査記録です。公開字幕・概要の関係する節を読み、公式コードも照合しました。
チャンネル全体や全映像フレームを確認した記録ではありません。
自動字幕の名称・単位の誤認、説明中の言い直しに注意し、設定の意味は対象FWの実装を優先します。
字幕全文・有料コンテンツ・他ソフトのコードは、この文書集へ転載していません。

## UAV Tech

| 公開資料 | 主な参照箇所 | 活かす観点 |
|---|---|---|
| [Autotune修正の検証](https://www.youtube.com/watch?v=K-cPFVnmwrg) | 3:11〜10:10、10:13〜16:58 | 推奨計算の妥当性、良い状態に変更を勧め続けないこと |
| [GYRO_SAMPLE explained](https://www.youtube.com/watch?v=9i-rgazEzPk) | 0:47〜6:14、6:18〜11:50 | フィルター各段と、周波数×RPMの確認 |
| [入力方法の比較](https://www.youtube.com/watch?v=664muewsurs) | 3:20〜10:38、12:11〜16:39 | wobble、CHIRP、手動入力の違いと推定器への影響 |
| [実飛行の性能評価](https://www.youtube.com/watch?v=MNw_6fFmV-I) | 5:21〜8:11、12:32〜17:32 | 定めた入力、通常飛行、要求とgyroの追従を確認する |
| [解析ソフトの比較](https://www.youtube.com/watch?v=TWajzXGcNVM) | 11:44〜13:15、16:20〜20:27、26:14〜29:20、32:54〜35:55 | 同じログで異なる結果、個別応答、motor制限、仮想変更の限界 |

### 指定Autotune動画からの教訓

作者は、旧推奨に従ってDスライダーを下げると悪化した実例と、解析修正後の挙動を比較しています。
一方、修正後もDが不足する例に対してP側を下げてバランスを取る推奨を、十分ではないと評価しています。
これは作者の実例・評価であり、他機体に同じD値を推奨する根拠ではありません。

対応する[公式PR #5406](https://github.com/betaflight/betaflight-configurator/pull/5406)は2026-09-02にmergeされています。
閉ループから安定余裕を直接読んでいた問題等を直す、解析アプリ側の変更でした。
同じBBL・FWでも、解析ソフトの版で結果が変わる実例として捉えます。

確認した確定commitは `9b3607fb765b0a840b99299d1e2f0c44d66b1338`。
[解析コード](https://github.com/betaflight/betaflight-configurator/blob/9b3607fb765b0a840b99299d1e2f0c44d66b1338/src/js/blackbox/spectral_analysis.js#L295)には
開ループ回復とD倍率の保持があり、[テスト](https://github.com/betaflight/betaflight-configurator/blob/9b3607fb765b0a840b99299d1e2f0c44d66b1338/test/js/spectral_analysis.test.js#L420)でも確認できます。
ただし、Dを保持する設計は「今回の機体のDが十分」という測定結果ではありません。
masterへのmergeを、任意の安定配信版へ既に含まれる証明ともしません。

### GYRO_SAMPLEを使う場合の注意

調査対象FWの[実装](https://github.com/betaflight/betaflight/blob/e0b7bb01b17b21351057e9ead2d1ab39dd44fa16/src/main/sensors/gyro_filter_impl.c#L25)では、
選択軸のdebug[0..3]はdownsample前／後、RPM後、静的notch・LPF後を表します。
dynamic notch後は通常のfiltered gyroを確認します。

動画のgyroとPIDが同周期の例でLPF2を切る話を、8kHz→4kHz等の異なる条件へ移植しません。
また、既にD_MAXを記録したログから、未記録の各フィルター中間段は復元できません。
TPA、D_MAX、GYRO_SAMPLEは目的別の追加記録として選び、一つのdebug_modeで同時に取れるとは扱いません。

## PIDtoolbox

| 公開資料 | 主な参照箇所 | 活かす観点 |
|---|---|---|
| [Micro Tuning / CHIRP](https://www.youtube.com/watch?v=TQGPIL_a7JM) | 0:42〜2:40、7:14〜10:40、12:19〜16:22、18:00〜28:08 | 入力帯域、反復、応答とノイズのトレードオフ |
| [5インチ機の調整例](https://www.youtube.com/watch?v=TRBs2WGoA5g) | 4:08〜6:40、13:03〜17:12、18:05以降 | 基礎試験の後、屋外の高負荷やpropwashで確認する |
| [フィルター性能のQ&A](https://www.youtube.com/watch?v=TiwaQEkOdyo) | 23:14〜28:09、35:40〜41:12 | ノイズ低減と位相・遅れの両面を見る |
| [Betaflight 4.5の調整手順](https://www.youtube.com/watch?v=4lZ8BY_9KBs) | 1:00〜3:37、9:47〜15:59 | P/D比、軸差、マスター、I/FFを分けて考える |

CHIRPやホバーは比較しやすい入力を得る追加手段で、レース中の負荷・空力・出力制限を再現したことにはなりません。
入力の帯域外、信号不足、飽和、推定器の偏りがあれば結果を保留します。
特定の推定器で入力方法により図が変わった事例を、「CHIRPは不正確」「手動入力なら常に正しい」という一般則にしません。

マイクロ機の設定、屋内試験、開発版の反復機能、特定の位相余裕や遅延目安を、そのまま5インチの合格基準にしません。
例えば1〜25Hzの掃引だけで、31〜35Hzの応答を直接検証したことにはなりません。

## 製品へ反映したいこと

1. 原本・section・FWに加え、解析版と窓・前処理・採用条件を保存する。
2. 平均応答だけでなく、個別窓・入力・motor制限と、採用／除外の根拠へ戻れるようにする。
3. 要確認、判断保留、評価した範囲で追加変更不要、を区別する。
4. AIの説明と計測コードの結果を分け、根拠不足を自信のある文章で埋めない。
5. 設定差分と実フライトを確認し、普段のレース操作で受入する。

これは方法と設計上の知見であり、このブランチでそれらの自動判定を実装したという意味ではありません。
既知の応答や別フライトを再現できないモデルから、仮想PID最適値を出す段階へ進めないことも重要です。
