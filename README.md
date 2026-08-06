# Curl Builder

Buscador e gerador de `curl` para `Evolution API`, `EVO-GO` e `EVO CRM`.

## Fluxo

1. Cadastre um ambiente por produto, quando quiser.
2. Busque um endpoint pronto no catalogo.
3. O app monta o `curl` completo.
4. Se nao houver ambiente, usa o fallback com URL de exemplo/localhost.
5. Voce pode testar a requisicao e salvar o historico.

## Executar

```powershell
cd "C:\Users\PC-GAMER\Desktop\Programação 2026\Assistente HTTP Request"
npm start
```

Abra:

```text
http://localhost:3020
```

O `npm start` executa `curl-builder/server.js`.

## Variaveis de ambiente

- `PORT` - porta do servidor, padrao `3020`
- `HOST` - host de bind, padrao `0.0.0.0`
- `SUPABASE_URL` - URL do projeto Supabase
- `SUPABASE_ANON_KEY` - chave anon do Supabase
- `SUPABASE_SERVICE_ROLE_KEY` - chave service role do Supabase
- `RUNTIME_STATE_FILE` - caminho do arquivo local de ambiente/historico

## Banco

Use [`supabase-schema.sql`](./supabase-schema.sql) para criar:

- `environments`
- `curl_history`

## Modo local

Sem Supabase configurado, o app usa persistencia local em arquivo para manter ambientes e historico entre reinicios.

## EasyPanel local

Use o `Dockerfile` do projeto como build method (Nixpacks tambem funciona, pois o `npm start` nao depende mais do arquivo `.env`).

Variaveis recomendadas no painel:

- `HOST=0.0.0.0`
- `PORT=3020`
- `SUPABASE_URL=https://cvujoawdmstajhmrqycq.supabase.co`
- `SUPABASE_ANON_KEY=...`
- `SUPABASE_SERVICE_ROLE_KEY=...`

Mapeie a porta publica do site para a porta **3020** do container.

Monte um volume no caminho:

- `/app/data/state`

Isso preserva ambientes e historico entre recriacoes do container **sem esconder o codigo** (`/app/data` contem o catalogo seed; o volume deve ir em `/app/data/state`).
