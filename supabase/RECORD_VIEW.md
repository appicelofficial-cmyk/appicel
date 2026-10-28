# PV記録のデプロイ

1. Supabase SQL Editor で `migrations/202610290001_secure_cell_views.sql` を実行する。
2. サーバー環境に `SUPABASE_SERVICE_ROLE_KEY` があることを確認し、アプリをデプロイする。ブラウザ用の環境変数にはしない。
3. Vercel は `x-vercel-forwarded-for` を使用する。それ以外では、入口のプロキシが必ず上書きするIPヘッダー名を `PV_TRUSTED_IP_HEADER` に設定する。外部から渡されたヘッダーをそのまま転送しない。IPを取得できない本番リクエストは503で計上しない。
4. 任意でサーバー専用の `PV_IP_HASH_SECRET` を設定する。未設定時はservice role keyをHMACの鍵に使用する。鍵を変更すると既存IPハッシュとの比較ができなくなるため、移行直後の1時間には影響がある。

同一セルについてviewer_idまたはIPハッシュのどちらかが直近1時間に一致すれば計上しない。DBのトランザクションロックにより並列リクエストも同じ判定を使う。IPハッシュは非公開スキーマに保存し、生IPは保存しない。移行前のPVはIP情報がないためviewer_idでのみ照合する。24時間ランキングのSELECT・Realtime・既存PVは維持する。

## 公開INSERT policyの特定と削除SQL

このリポジトリには既存policyの定義も接続済みDB管理セッションもないため、実際のpolicy名はSQL Editorで以下を実行して確認する。名前を推測して削除しない。

```sql
select policyname, cmd, roles,
  format('DROP POLICY %I ON public.cell_views;', policyname) as delete_sql
from pg_policies
where schemaname = 'public' and tablename = 'cell_views'
  and cmd in ('INSERT', 'ALL');
```

マイグレーションはINSERT policyを実名に基づいて削除する。ALL policyはSELECTも兼ねる場合があるため残すが、`REVOKE INSERT, UPDATE, DELETE ON public.cell_views FROM PUBLIC, anon, authenticated` によりブラウザからの書き込みは拒否する。ALL policyを削除する場合は必要なSELECT policyを先に用意する。

## DB適用後の確認

- anonキー・認証済みユーザーによるcell_viewsへの直接INSERT、およびrecord_cell_view RPC呼び出しが拒否されること。
- セルを開くとAPIが200/recorded:trueを返すこと。同一セルを再度開く、同じIPでviewer_idを変える、同じviewer_idでIPを変える場合はいずれもrecorded:falseになること。
- 同時リクエストで1行だけ増えること。1時間経過後に再計上でき、別セルは独立して計上されること。
- 24時間ランキング・詳細表示が従来どおり表示されること。

DB未接続のため、これらの実DB確認はローカルビルドとは別に必要。
