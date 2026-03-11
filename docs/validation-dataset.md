# Validation Dataset

この文書は、実ログと実 DVR の検証セットを固定するための台帳です。
成功例だけを集めないこと。壊れる入力を含めない検証は無意味です。

## Storage Policy

- 実サンプルは repo 直下の `data/` に置いてローカル運用する
- `.gitignore` で `data/*.bbl`, `data/*.BBL`, `data/*.mp4` などは追跡しない
- docs には repo 相対の想定ファイル名を書く
- sample を他メンバーに渡す必要がある場合は、共有方法を別途決める。大容量バイナリを git に入れない

## Recording Rules

- 各サンプルに一意な ID を付ける
- `.bbl` と DVR を対にできる場合は対にする
- 「何を検証するためのサンプルか」を先に書く
- 成功したかどうかだけで終わらせず、ズレ方と壊れ方を書く
- 結果は `成功` `部分成功` `失敗` `未実施` の 4 つで書く
- `実観察` には最低でも 1 つ具体例を書く
- 失敗時は再現手順を残す

## Baseline Validation Flow

いま固定できている baseline pair は次です。

- `data/BTFL_BLACKBOX_LOG_HYPER_20260308_145916_FOXEERF722V4.BBL`
- `data/20260308.mp4`

baseline では最低でも次を毎回見直すこと。

1. `.bbl` が読み込める
2. flight tab が 1 件表示され、継続時間が `01:14.944` と一致する
3. overlay, compact history, event list がクラッシュせず出る
4. `20260308.mp4` を attach できる
5. `Auto sync ARMED` が成功し、`ARMED detected at 2.75s (OCR 96%)` を返す
6. `Video offset` が `2.749501` 付近に更新される

## Sample Inventory

| ID | Kind | File | Validation Purpose | Expected Observation | Actual Observation | Result |
| --- | --- | --- | --- | --- | --- | --- |
| LOG-001 | BBL | `BTFL_BLACKBOX_LOG_HYPER_20260308_145916_FOXEERF722V4.BBL` | Current baseline log for end-to-end review | Log opens, snapshot selectors stay stable, event list renders | Readable. One flight tab shown. Duration observed as `01:14.944`. Overlay and compact history render. Event list showed 12 entries in the current baseline review. | 成功 |
| LOG-002 | BBL | `BTFL_BLACKBOX_LOG_HYPER_20260308_145916_FOXEERF722V4.BBL` | Unknown-header warning tolerance | Parser prints warnings but review UI still loads | The baseline log emits many `Ignoring unsupported header ...` warnings and still loads successfully. This currently doubles as the unknown-header sample. | 成功 |
| LOG-003 | BBL | TBD | AUX / RPM variance or missing-field handling | Missing data should stay explicit and must not be shown as a valid zeroed signal | No fixed sample yet. Need a log where AUX or RPM fields differ from the baseline assumptions. | 未実施 |
| LOG-004 | BBL | TBD | Multi-section `.BBL` handling | One file should surface as multiple readable flights, with readable sections selectable independently | Covered in adapter unit tests through `loadFlightSessionsFromFile()`, but not yet fixed with a real fixture in `data/`. | 部分成功 |
| DVR-001 | DVR | `20260308.mp4` | Current baseline DVR for attach + sync | Video attaches, playback remains stable, auto sync can be re-checked from a known clip | Attach succeeds. Local review observed `1920x1080`, `60fps`, `135.808s`. Overlay stays responsive after attach. | 成功 |
| DVR-002 | DVR | `20260308.mp4` | `ARMED` OCR success path | Auto sync should detect `ARMED` in the early clip and update offset | `Auto sync ARMED` detected `ARMED` at `2.75s` with `OCR 96%` and updated `Video offset` to `2.749501`. | 成功 |
| DVR-003 | DVR | TBD | `ARMED` OCR failure path | Failure should be explicit and should return the user to manual offset adjustment without crashing | No fixed failure clip yet. Older observations from this same baseline clip are obsolete after the OCR improvements. | 未実施 |

## Current Gaps

1. A real multi-section `.BBL` fixture in `data/`
2. A real AUX / RPM variance sample
3. A fixed OCR failure clip
4. Manual offset adjustment notes after auto sync success and failure
5. More than one DVR format or OSD style
