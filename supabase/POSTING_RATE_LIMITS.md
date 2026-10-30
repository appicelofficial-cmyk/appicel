# 投稿開始APIの回数制限

## 上限と通常画面の呼び出し

同一の正規化済みIPについて、直近10分のスライディング窓で判定する。

| API / scope | 上限 | 通常1投稿での呼び出し |
| --- | --- | --- |
| create-cell | 10回 | 無料投稿で1回 |
| create-checkout-session | 10回 | 有料投稿で1回 |
| upload-cell-image | 60回 | 選択枚数+1回 |

先頭画像は原本とトリミング版の2回、2枚目以降は原本だけ各1回。通常プランは最大2枚なので3回、プレミアムは最大5枚なので6回。60回なら最大枚数の投稿を10回試せるため、今回は引き上げない。別のAPIの枠は消費しない。同じ共有IPの利用者は枠を共有する。従来の無料投稿「24時間に3回」（viewer_idとIPのうち多い方）も残す。この既存の業務上限は、今回の10分の負荷制限とは別である。

## 適用順序（本作業では実行しない）

1. テスト用Supabaseに `migrations/202610300001_posting_rate_limits.sql` を管理者として適用する。privateスキーマ、専用テーブル、service_roleだけが実行できるRPCを作成する。他の制限用SQLからは独立しており、既存テーブル・投稿・画像・注文は変更しない。履歴に適用済みなら再実行しない。
2. 下記の権限確認SQLを実行する。Supabaseの公開スキーマ設定にprivateを追加しない。関数の所有者は管理用マイグレーションロール（通常postgres）とし、anon/authenticated/service_roleに所有権を移さない。
3. テスト環境でRPCの同時実行・時間境界・APIの429/503を確認する。実決済や本番セルを使わない。必要ならテスト環境専用のStripeテストキー・Storageを用いる。
4. サーバー専用の `NEXT_PUBLIC_SUPABASE_URL`（URLのみ公開可）と `SUPABASE_SERVICE_ROLE_KEY` を既存どおり設定する。任意で専用の `POSTING_IP_HASH_SECRET` を設定する。未設定時はservice_roleキーをHMACの鍵に使う。秘密値を表示・ログ出力せず、秘密鍵にNEXT_PUBLIC_を付けない。
5. Vercelでは `VERCEL=1` により `x-vercel-forwarded-for` を最優先で使用し、他の指定ヘッダーにはフォールバックしない。Vercel以外では、入口プロキシが必ず上書きし外部から偽装できないヘッダー名を `POSTING_TRUSTED_IP_HEADER` に設定する。信頼プロキシを経由しない直接アクセスを遮断する。アプリはヘッダーの先頭IPを利用するので、プロキシはクライアント提供値を追記せず置換すること。参考：[Vercel公式ヘッダー仕様](https://vercel.com/docs/headers/request-headers)。
6. DB適用・設定・権限確認を済ませてからAPIと画面をリリースする。先にAPIだけを出すとRPCがないため503となり、投稿・アップロード・Checkout作成は停止する。Webhook・payment-resultには制限を追加していない。

開発モードかつVercel以外のときだけ、IPがなければ127.0.0.1を使う。本番の未設定・不正IP・RPC不在/失敗/異常な戻り値は503。IPv6の省略・大文字小文字、IPv4-mapped IPv6を正規化して同じ枠にする。生IPはDBにもログにも出さず、RPCに渡すのはHMAC-SHA256とscopeのみ。

## 数え方・解除条件・失敗時

- create-cellとcreate-checkout-session：JSON・プラン・タイトル・URL・画像枚数などの既存入力検証の後、DB照会/保存・Stripeセッション作成の前に枠を確保する。入力検証で終了した場合は消費しない。Stripe設定不足も枠確保前に503。
- upload-cell-image：Origin検証の後、multipart解析・File読み込み・Sharp処理・Storage保存の前に枠を確保する。Origin不正は消費しない。ファイル欠落・不正画像・サイズ超過などは既に1回消費している。
- 枠を確保できたら、成功、日次上限、セル競合、DB/Storage/Stripeエラー、接続切断のいずれでも1回を消費する。枠は返却しない。手動再試行は新しい1回となる。通信応答が失われた際は、枠確保が成立していた可能性がある。自動再試行はしない。
- API+IPごとのトランザクションアドバイザリロック取得後にDB時刻を採取し、期限切れ削除・件数確認・受付記録の追加を直列化する。アプリサーバー内のメモリやviewer_idには依存しない。制限記録にセルIDの外部キーを持たず、セル・注文の変更や削除でも記録が消えない。
- 拒否時は記録を追加せず429。最も古い受付記録から10分が経過すると1枠空く。拒否アクセスで期限は延びない。DB時刻との差を切り上げた1〜600秒を `Retry-After` と日本語メッセージに返す。他の利用者の受付がある場合、待機後も再度制限されることはある。
- 制限の取得に失敗したら503として重い処理へ進めない。DB内部エラーや秘密値はレスポンスに含めない。制限取得に成功した後の処理失敗も一般的な日本語メッセージにする。
- 画面は同期的なrefロックと送信ボタンのdisabledで二重送信を防ぐ。429/503時にはメッセージを表示して入力・選択画像を保持する。成功時だけ入力を初期化し、有料投稿は決済画面への遷移までロックする。自動アップロード再試行や自動Checkout再作成はしない。手動再送では画像を再アップロードするため、途中成功した画像は今回の対応で自動削除しない。
- 旧 `image_upload_logs` の件数照会→成功後追加による20回制限は使用を終了する。既存テーブルは削除しない。新しい制限は成功前の試行も数える。
- 無料投稿の日次履歴には今後HMACだけを保存する。移行中の照会に限り正規化IPの旧SHA-256も検索条件に加え、従来の一般的なIPv4表記による24時間の履歴を引き継ぐ。旧コードの非正規化IPv6表記などは対応できない場合がある。既存の記録は書き換えない。HMAC鍵を変更すると対応する枠・日次IP履歴の照合が切れるため、計画的な切替を行う（10分の新制限だけでなく24時間の既存日次制限にも影響する）。viewer_idの日次履歴は鍵に依存しない。

## 権限の確認（読み取り専用）

管理者SQLエディタから実行する。最初の結果は全列true、2つ目はsecurity_definer=trueと空のsearch_path設定、管理用ownerが期待値。

```sql
select
  not has_schema_privilege('anon', 'private', 'USAGE')
    and not has_schema_privilege('authenticated', 'private', 'USAGE') as private_schema_denied,
  not has_table_privilege('anon', 'private.posting_attempts', 'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated', 'private.posting_attempts', 'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('service_role', 'private.posting_attempts', 'SELECT,INSERT,UPDATE,DELETE')
    as direct_table_denied,
  not has_function_privilege('anon', 'public.consume_posting_attempt(text,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.consume_posting_attempt(text,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.consume_posting_attempt(text,text)', 'EXECUTE')
    as rpc_service_only,
  (select relrowsecurity from pg_class where oid = 'private.posting_attempts'::regclass) as rls_enabled,
  not exists (select 1 from pg_policies where schemaname = 'private' and tablename = 'posting_attempts')
    as no_browser_policies;

select pg_get_userbyid(proowner) as owner, prosecdef as security_definer, proconfig
from pg_proc where oid = 'public.consume_posting_attempt(text,text)'::regprocedure;
```

## 古い記録の整理

同じAPI+IPの期限切れ記録は次のアクセス時に削除する。再アクセスしないIP分は管理者の定期処理（例：1日1回）で以下を実行できる。本作業では実行しない。10分以内の記録を消すと上限がリセットされるので、余裕を持った24時間前を使う。

```sql
delete from private.posting_attempts
where attempted_at < clock_timestamp() - interval '1 day';
```

非常に件数が多い場合は管理者の保守枠で分割削除する。従来のimage_upload_logsの保持・削除方針は別途確認し、このSQLで一括削除しない。

## 検証と未検証

```text
node --test tests/*.test.cjs
npm.cmd run build
```

モックで429/503時にフォーム解析・Sharp・Storage・セル保存・Stripe作成へ進まないこと、正常時の処理順序、IP正規化・HMAC・偽装無視、異常RPC応答、API/IPごとの独立性、期限・拒否での非延長、失敗時の消費、プレミアム・URL検証・Webhook既存動作を確認する。DBモデルのテストは実PostgreSQLの同時実行を証明しない。

実DBでは以下をテスト環境で別途確認する必要がある：マイグレーション適用・権限/RLS、複数接続から同じscope+テスト用HMACで同時RPCを送り10件/60件だけ受付されること、別API/IPの独立性、10分境界とDB時刻のRetry-After、定期整理、実Vercel入口ヘッダー、ブラウザ操作、実Storage・Stripe連携。本番データ・実決済を検証に使わない。
