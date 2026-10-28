# 管理者削除APIの認証試行制限

## 適用順序・設定

1. テスト環境で `migrations/202610290003_admin_delete_rate_limit.sql` を適用する。トランザクションで非公開テーブルとservice_role専用RPCを作成する。PV・コメント用マイグレーションとは独立して適用可能。実行済みマイグレーションは再実行しない。
2. サーバーに既存の `ADMIN_DELETE_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`NEXT_PUBLIC_SUPABASE_URL` が設定されていることを確認する。秘密値を画面・ログに出さず、秘密鍵にNEXT_PUBLIC_を付けない。入力パスワードの上限はJavaScript文字列長1024。既存パスワードがこの範囲内で、空白のみではないことを確認する。
3. Vercelでは `VERCEL=1` のとき入口で上書きされる `x-vercel-forwarded-for` だけを使う。任意のIPヘッダー設定より優先する。他の本番環境では `ADMIN_DELETE_TRUSTED_IP_HEADER` に、入口プロキシが必ず上書きし外部からの偽装を許さないヘッダー名を設定する。信頼できるIPがなければ503で削除を拒否する。開発時のみ127.0.0.1へフォールバックする。
4. 任意でサーバー専用の `ADMIN_DELETE_IP_HASH_SECRET` を設定する。未設定ならservice role keyをHMAC-SHA256の鍵として使う。同じIPのIPv6表記ゆれ・IPv4-mapped IPv6を正規化する。生IP・入力パスワードは保存・ログ出力しない。鍵の変更で過去ハッシュとの対応が切れ、15分以内の試行履歴が実質リセットされるため、変更時は削除APIを一時停止するか15分の切替時間を取る。
5. DB適用と設定確認の後でAPI・画面をリリースする。APIを先に切り替えた場合、RPCがない間は503となる。本作業ではコミット・push・デプロイ・本番SQL実行は行っていない。

## 制限・解除時刻

- **IPごとに直近15分間で最大5回**。セルID・入力パスワードには依存しない。正常な入力による認証試行は、認証成功・失敗・その後の削除失敗のいずれでも1回消費する。不正JSONや入力検証エラーは認証比較をせず、試行枠も消費しない。
- DB関数がIP単位のトランザクションアドバイザリロックを取り、期限切れ削除・件数確認・試行追加を原子的に行う。複数サーバーからの同時送信にも共通。同一IPを共有する利用者にも共通の制限となる。
- 6回目以降は、パスワードの正誤を調べず429。拒否されたリクエストは試行履歴を追加せず、解除時刻を延ばさない。最も古い有効な試行から15分経つと1枠空く。全5枠が一斉に戻る固定窓ではない。
- DB時刻で待ち時間を計算し、残り秒数を切り上げた整数（1〜900）を `Retry-After` と日本語メッセージに返す。端末の時計は使わない。待っている間に同じIPで別の認証試行があれば、再試行時に再び制限される場合がある。
- 認証比較はSHA-256の32バイトハッシュ同士をtimingSafeEqualで比較する。IP取得・DB制限・設定・応答形式の異常時は503で拒否する。内部エラーや環境変数名をレスポンスに出さない。
- DBに保存するのはIPのHMACと試行時刻のみ。対象IPの古い記録は次回の試行時に削除する。再アクセスしないIPの古い記録は、管理者の定期処理で `DELETE FROM private.admin_delete_attempts WHERE attempted_at < now() - interval '1 day';` を実行可能。

## 検証

ローカルのモックテスト（実DB・本番セルには接続しない）：

```text
node --test tests/admin-delete-cell.test.cjs tests/create-comment.test.cjs
npm.cmd run build
```

誤パスワード・制限到達・制限処理失敗時の削除禁止、正常時の処理順序、固定長比較、入力検証、IP正規化、エラー秘匿を検証する。モックテストは実PostgreSQLの並行動作を証明するものではない。

DB適用後、次の読み取り専用SQLで権限・RLSを確認できる（3列ともtrueが期待値）。

```sql
select
  not has_table_privilege('anon', 'private.admin_delete_attempts', 'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated', 'private.admin_delete_attempts', 'SELECT,INSERT,UPDATE,DELETE')
    as browser_table_denied,
  not has_function_privilege('anon', 'public.consume_admin_delete_attempt(text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.consume_admin_delete_attempt(text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.consume_admin_delete_attempt(text)', 'EXECUTE')
    as rpc_service_only,
  (select relrowsecurity from pg_class where oid = 'private.admin_delete_attempts'::regclass)
    as rls_enabled;
```

実DBでは未検証の項目：

- マイグレーションの適用、実際の権限と非公開スキーマへのアクセス拒否。
- 別DB接続・複数APIインスタンスから同一のテスト用ハッシュで6件以上同時実行し、allowed=trueが5件だけになること（セル削除を伴わないRPC単体で検証可能）。
- DB時刻で15分の境界・Retry-After・別IPの独立性を確認すること。
- 本番の入口ヘッダーと設定値の整合性。テスト環境で偽装ヘッダーが無視されること。
- テスト専用セルで正しい認証時だけ削除されること、画面の429・503表示。本番セルを検証に使わない。
