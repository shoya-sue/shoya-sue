# README自動更新 GitHub Actions - 改善設計書

## 現状の課題

### 1. データ収集の不十分さ
- **単一リポジトリのみ集計**: `shoya-sue/shoya-sue` リポジトリのコミット・Issue・PRのみ取得
- **言語統計が不正確**: プロファイルリポジトリの言語のみで、全リポジトリの言語使用状況を反映していない
- **イベント取得漏れ**: `repos.listCommits` はリポジトリ単位。ユーザー全体のアクティビティを捕捉できていない

### 2. README解析の脆弱性
- **正規表現依存**: `## 🛠️ Tech Arsenal` や `## 🤝 Connect with Me` を正規表現で検索しており、見出しテキストが少しでも変わると壊れる
- **セクション境界の曖昧さ**: `---\n` をセクション区切りとして使っているが、README内に複数の `---` があるため意図しない位置で切断されるリスク

### 3. エラー時の耐障害性
- API取得失敗時に `null` を返すだけで、部分的なデータ活用ができない
- README書き込みに失敗しても検知・通知されない

---

## 改善方針

### A. 全リポジトリ横断集計（GitHub Events API + REST API）

| 項目 | 現行 | 改善後 |
|---|---|---|
| コミット数 | `repos.listCommits` (1リポのみ) | `GET /users/{user}/events` で `PushEvent` を集計 |
| PR数 | `issues.listForRepo` (1リポのみ) | Events API の `PullRequestEvent` を集計 |
| Issue数 | `issues.listForRepo` (1リポのみ) | Events API の `IssuesEvent` を集計 |
| 言語統計 | `repos.listLanguages` (1リポのみ) | 全publicリポジトリの `listLanguages` をバイト数ベースで合算 |
| アクティブリポ | 取得なし | Events から変更があったリポジトリ名を抽出 |

**Events API の利点:**
- 1回の呼び出しで最大300イベント（10ページ × 30件）取得可能
- PushEvent にはコミット数が含まれるため正確なカウントが可能
- リポジトリ横断のアクティビティが取れる

### B. HTMLコメントマーカーによるセクション管理

```html
<!-- WEEKLY_ACTIVITY_START -->
（ここに動的コンテンツを挿入）
<!-- WEEKLY_ACTIVITY_END -->
```

- 正規表現で見出しテキストを探す代わりに、**HTMLコメントマーカー**で更新範囲を厳密に制御
- マーカー外のコンテンツは一切変更されない
- マーカーが見つからない場合はエラーとして処理（意図しない書き込みを防止）

### C. データ正確性の向上

1. **PushEvent のコミット数**: `event.payload.size` でリアルなコミット数を取得（同一pushに複数コミットがある場合にも対応）
2. **言語バイト数の割合計算**: 全リポジトリのバイト数を合算し、百分率で表示
3. **レートリミット対応**: API呼び出し前に `rateLimit.get()` でリミットを確認。残数が少ない場合は最低限のデータのみ取得

---

## アーキテクチャ

```
update-readme.js
├── GitHubDataCollector (データ収集層)
│   ├── fetchUserEvents()        → Events API で全アクティビティ取得
│   ├── fetchAllRepoLanguages()  → 全リポジトリの言語統計を合算
│   ├── fetchRepoStats()         → スター・フォーク数の合計
│   └── checkRateLimit()         → レートリミット確認
│
├── StatsAggregator (集計層)
│   ├── aggregateWeeklyStats()   → イベントから週次統計を集計
│   ├── calculateLanguageRatio() → 言語バイト比率を計算
│   └── extractActiveRepos()     → アクティブリポジトリ名を抽出
│
├── ReadmeRenderer (描画層)
│   └── generateActivitySection() → Markdown/HTMLコンテンツ生成
│
└── ReadmeWriter (書き込み層)
    ├── parseMarkers()           → HTMLコメントマーカーの検出
    └── replaceSection()         → マーカー間のコンテンツ置換
```

---

## ファイル変更一覧

| ファイル | 変更内容 |
|---|---|
| `scripts/update-readme.js` | 全面リファクタリング（クラス分割、Events API対応、マーカー方式） |
| `README.md` | HTMLコメントマーカーの挿入 |
| `.github/workflows/update-readme.yml` | Node.js 20 へ更新、エラー通知ステップ追加 |
| `scripts/update-readme.test.js` | 新アーキテクチャに合わせたテスト更新 |
| `scripts/package.json` | 依存パッケージの最新化 |

---

## 表示項目（改善後）

### Weekly Activity セクション

- **期間表示**: `YYYY/MM/DD - YYYY/MM/DD`
- **This Week's Highlights**:
  - コミット数（全リポジトリ合計）
  - PR数（全リポジトリ合計）
  - Issue数（全リポジトリ合計）
- **Languages Used**: バイト数ベースのTop 5言語（パーセント付き）
- **Recent Activity**: 直近5件のコミットメッセージ（リポジトリ名付き）
- **Active Repositories**: 今週変更があったリポジトリ一覧
- **Repository Stats**: 全リポジトリのスター・フォーク合計
- **Last updated**: タイムスタンプ
