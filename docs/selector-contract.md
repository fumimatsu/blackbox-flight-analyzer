# Selector Contract

`src/domain/blackbox/selectors/flightSelectors.js` は UI とドメイン層の境界です。
ここで欠損を `0` として埋めると、表示もイベント判定も比較も嘘をつきます。

## 基本方針

- フィールドが読めない場合は `null`
- 実際に 0 がありうる値を `0` で埋めてごまかさない
- 配列系は読めた値だけ返す
- 上位レイヤーは `null` を前提に表示と判定を行う

## 契約

- `rc`
  - `rcCommands[]` を優先し、なければ `rcCommand[]`
  - 取得できなければ `null`
- `rcRaw`
  - `rcData[]`
  - 取得できなければ `null`
- `setpoint`
  - `setpoint[]`
  - 取得できなければ `null`
- `gyro`
  - `gyroADC[]`
  - 取得できなければ `null`
- `error`
  - `axisError[]` を優先
  - なければ `setpoint - gyro`
  - 両方成立しなければ `null`
- `motors`
  - `motor[]` のうち読めた値だけ返す
- `rpm`
  - `eRPM[]` または `rpm[]` のうち読めた値だけ返す
- `aux`
  - `rcData[4+]` 由来
  - 値がなければ `value: null`, `active: null`

## 意図

欠損は欠損として見せる。
ここを曖昧にすると、UI が平然と正常値の顔をして壊れた値を出す。
