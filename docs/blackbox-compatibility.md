# Blackbox 対応範囲

更新日: 2026-10-22

## 基準

- 確認時の最新安定ファームウェア: Betaflight 2026.6.2。
- 解析コアの取り込み元: betaflight/betaflight-configurator、タグ `2026.6.2`。
- 固定コミット: `091127c1a5b15268321b0e5b71b8cec89f1de56b`。
- ファームウェア側のフィールド定義も同タグの `src/main/blackbox/blackbox.c` と照合。
- 開発版の全フィールドへの対応を保証するものではない。

参照:
- https://github.com/betaflight/betaflight-configurator/tree/091127c1a5b15268321b0e5b71b8cec89f1de56b/src/blackbox-viewer
- https://github.com/betaflight/betaflight/blob/2026.6.2/src/main/blackbox/blackbox.c
- https://github.com/betaflight/betaflight/releases/tag/2026.6.2

## 取り込み内容

`src/vendor/log-core` の parser、index、decoder、stream、FlightLog、IMU、GPS変換、fielddefs、cache、toolsを更新した。
debug定義は同コミットの `src/js/utils/debugModes.js` と `array.js` を取り込んだ。
MSP API定数だけを `api_versions.js` に切り出し、公式アプリ本体の依存を持ち込まない。
旧 `flightlog_fields_presenter.js` は依存がなくなったため削除した。

- 2025.12 / 2026.6 のファームウェア識別とMSP API版の対応。
- ファームウェア別のdebug番号解釈。selectorは版に応じた定義を利用する。
- 記録済み `imuQuaternion[0..2]` があれば、その姿勢から `heading[]` を生成。
- 古いログでは引き続きgyroと加速度から姿勢を推定する。
- 新しいdisabled-field mask、servo、GPSホーム高度、GPSホームepoch、GPS時刻を扱う。
- 設定サマリでは2025.12以降の追加D値をD maxとして表示する。

追加フィールドのデコードと、UIに表示・分析する機能は別である。
servo等は生フレームから参照できるが、今回専用パネルは追加していない。
GPSの時刻をDejaView用の共通時刻へ変換する作業も未実装。

## 検証

`src/domain/blackbox/adapter/blackboxCompatibility.test.js` は実際のヘッダーとバイナリを組み立て、parserおよびadapterを通す。
対象は2025.12.0 / 2026.6.2、gyro/accなしの記録姿勢、debug番号、servo、GPS H/Gフレーム、新旧mask。
これは実機録画ではなく合成データである。

既存の実ログ `data/BTFL_BLACKBOX_LOG_HYPER_20260308_145916_FOXEERF722V4.BBL` はfixtureテストとブラウザーsmokeの対象。
2026.6.2実機ログはまだ検証セットにない。新ファームの実機対応を確定するには、BBLと対応DVRを追加して姿勢・時刻・出力を照合する。

未知のヘッダーは上流と同じ扱いで警告される。警告がなくなったことだけを互換性の証拠にしない。
将来の更新でも固定コミットと実機・合成の検証範囲を記録する。
