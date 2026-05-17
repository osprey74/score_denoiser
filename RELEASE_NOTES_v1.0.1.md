# Nitido v1.0.1

## English

Minor update adding a Ko-fi donation button to the About dialog, plus a hover-style fix.

### Added

- **Ko-fi donation button** in the About dialog
  - Allows users to support the developer via Ko-fi
  - Brand-correct styling (Ko-fi blue #0085FF + cup icon)
  - Opens in the system browser via `openUrl()`

### Fixed

- Ko-fi button hover state: white text became unreadable due to a global `button:hover` rule overriding the brand background. Specificity adjusted to preserve the blue background and white text on hover.

### Documentation

- [docs/manual-ja.md](https://github.com/osprey74/score_denoiser/blob/main/docs/manual-ja.md): Comprehensive Japanese user manual covering installation (with SmartScreen warning workaround), folder selection, preview operations, parameter tuning, batch processing, CSV export, and shortcuts. 19 annotated screenshots included.

---

## 日本語

About ダイアログに Ko-fi 寄付ボタンを追加するマイナーアップデートです。あわせてホバー時のスタイル不具合を修正しています。

### 追加

- **About ダイアログに Ko-fi 寄付ボタンを追加**
  - 「アプリ作者にコーヒーをご馳走する」セクションを追加
  - Ko-fi ブランドカラー (#0085FF) ＋カップアイコン
  - クリックで OS のブラウザが起動して Ko-fi ページに遷移

### 修正

- Ko-fi ボタンのホバー時、グローバル `button:hover` ルールが背景を薄灰に上書きして白文字が読めなくなる問題を修正。CSS specificity を調整して青背景・白文字を維持。

### ドキュメント

- [docs/manual-ja.md](https://github.com/osprey74/score_denoiser/blob/main/docs/manual-ja.md): インストール（SmartScreen 警告の対処手順含む）、フォルダ選択、プレビュー操作、パラメータ調整、一括処理、CSV エクスポート、ショートカットを網羅したユーザーマニュアル（日本語、スクリーンショット 19 枚付き）を公開。
